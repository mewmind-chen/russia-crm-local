'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { adminFixture, seededFixture } = require('./helpers/permission_fixture');
const {
  projectCustomerState,
  projectAssignmentState,
  projectManagerState,
  projectNextAction,
  projectAccountState,
} = require('../lib/domains/lifecycle/state_projection');

test('lost is a terminal customer stage', () => {
  assert.deepEqual(projectCustomerState({ stage: 'lost' }), { key: 'lost', terminal: true });
});

test('recycled lifecycle is projected without changing the source row', () => {
  const account = { lifecycle_status: 'recycled' };
  const state = projectAccountState(account);
  assert.equal(state.lifecycleStatus, 'recycled');
  assert.deepEqual(state.state.lifecycle, { key: 'recycled', recycled: true });
  assert.equal(account.lifecycle_status, 'recycled');
});

test('returned assignment is not current ownership', () => {
  const state = projectAssignmentState({ assignment_status: 'returned', owner_id: 'U-1' });
  assert.deepEqual(state, { key: 'returned', ownerId: 'U-1', current: false });
});

test('manager_required without a status falls back to waiting', () => {
  assert.deepEqual(projectManagerState({ manager_required: 1, manager_status: '' }), {
    required: true,
    status: '待介入',
  });
  assert.deepEqual(projectManagerState({ manager_required: 0, manager_status: '已完成' }), {
    required: false,
    status: '已完成',
  });
});

test('next action without a time is marked as degraded', () => {
  assert.deepEqual(projectNextAction({ next_action: '确认采购周期' }, Date.parse('2026-08-28T00:00:00Z')), {
    text: '确认采购周期',
    at: '',
    planned: false,
    degraded: true,
    overdue: false,
  });
});

test('expired next action preserves the original timestamp and is only marked overdue', () => {
  const account = { next_action: '跟进报价', next_action_at: '2026-08-27 09:00:00' };
  const state = projectNextAction(account, Date.parse('2026-08-28T09:00:00Z'));
  assert.equal(state.at, account.next_action_at);
  assert.equal(state.overdue, true);
  assert.equal(account.next_action_at, '2026-08-27 09:00:00');
});

test('missing legacy fields use compatibility defaults', () => {
  assert.deepEqual(projectAccountState({}), {
    stage: 'new',
    lifecycleStatus: 'active',
    assignmentStatus: 'claimed',
    managerStatus: '',
    nextAction: '',
    nextActionAt: '',
    state: {
      stage: { key: 'new', terminal: false },
      lifecycle: { key: 'active', recycled: false },
      assignment: { key: 'claimed', ownerId: '', current: false },
      manager: { required: false, status: '' },
      nextAction: { text: '', at: '', planned: false, degraded: false, overdue: false },
    },
  });
});

test('intake status can supply assignment state when account field is absent', () => {
  assert.deepEqual(projectAssignmentState({ owner_id: 'U-2' }, { status: 'assigned', assigned_owner_id: 'U-2' }), {
    key: 'assigned', ownerId: 'U-2', current: true,
  });
});

test('accounts list response includes state projection for each row', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const accounts = await fx.requestJson('/api/sales-crm/accounts', { cookie: fx.adminCookie });
  assert.ok(accounts.rows.length > 0);
  for (const row of accounts.rows) {
    assert.ok('state' in row, 'each account row must have state');
    assert.ok(row.state.stage, 'state.stage must be present');
    assert.ok(typeof row.state.stage.terminal === 'boolean', 'state.stage.terminal must be boolean');
    assert.ok('stage' in row, 'legacy stage field must be preserved');
  }
});

test('bootstrap response includes state projection for each account', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.ok(bootstrap.accounts.length > 0);
  for (const account of bootstrap.accounts) {
    assert.ok('state' in account, 'each bootstrap account must have state');
    assert.ok(account.state.stage, 'state.stage must be present');
    assert.ok('stage' in account, 'legacy stage field must be preserved');
  }
});

test('profile for accessible CRM account includes state', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const profile = await fx.requestJson('/api/sales-crm/profile/RU-9001', { cookie: fx.adminCookie });
  assert.ok(profile.state, 'profile must include state for accessible CRM account');
  assert.ok(profile.state.stage, 'state.stage must be present');
  assert.equal(profile.state.stage.key, 'qualified');
});

test('master profile without CRM account does not include state', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  fx.db.prepare('INSERT INTO customer_pool(customer_id,company_name) VALUES (?,?)')
    .run('BR-9999', 'Master Only');
  const profile = await fx.requestJson('/api/sales-crm/profile/BR-9999', { cookie: fx.adminCookie });
  assert.equal(profile.state, undefined, 'master-only profile must not include state');
  assert.ok(profile.customerPool, 'profile payload must still include customer data');
});

test('sales user profile for out-of-scope account does not include state', async t => {
  const fx = await seededFixture({ managerViewAll: false });
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { view_customers: true, view_all_customers: false });
  const cookie = await fx.login('other@example.com', 'Password123!');
  const response = await fx.request('/api/sales-crm/profile/RU-9002', { cookie });
  const profile = await response.json();
  assert.equal(response.status, 403, profile.error);
  assert.equal(profile.state, undefined, 'out-of-scope profile must not include state');
});
