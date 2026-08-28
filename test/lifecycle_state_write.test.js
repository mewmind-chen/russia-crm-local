'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { adminFixture } = require('./helpers/permission_fixture');

const {
  buildAccountStatePatch,
  buildAccountInsertState,
  applyAccountStatePatch,
} = require('../lib/domains/lifecycle/state_write');

test('buildAccountStatePatch normalizes a valid state transition', () => {
  assert.deepEqual(buildAccountStatePatch({
    stage: 'lost',
    lifecycleStatus: 'recycled',
    assignmentStatus: 'returned',
    ownerId: null,
    updatedAt: '2026-08-28 10:00:00',
  }), {
    stage: 'lost',
    lifecycle_status: 'recycled',
    assignment_status: 'returned',
    owner_id: null,
    updated_at: '2026-08-28 10:00:00',
  });
});

test('buildAccountStatePatch rejects unknown state values before SQL executes', () => {
  assert.throws(() => buildAccountStatePatch({ assignmentStatus: 'returned-ish' }), /无效的分配状态/);
  assert.throws(() => buildAccountStatePatch({ lifecycleStatus: 'deleted' }), /无效的生命周期状态/);
  assert.throws(() => buildAccountStatePatch({ stage: 'unknown' }), /无效的客户阶段/);
});

test('applyAccountStatePatch updates only requested state columns in one SQL operation', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE crm_accounts (
    id TEXT PRIMARY KEY, stage TEXT, lifecycle_status TEXT,
    assignment_status TEXT, owner_id TEXT, updated_at TEXT
  )`);
  db.prepare('INSERT INTO crm_accounts VALUES (?,?,?,?,?,?)')
    .run('CRM-1', 'qualified', 'active', 'claimed', 'U-1', 'before');
  const result = applyAccountStatePatch(db, 'CRM-1', {
    assignmentStatus: 'returned', ownerId: null, updatedAt: 'after',
  });
  assert.deepEqual(result, {
    changed: true,
    patch: { assignment_status: 'returned', owner_id: null, updated_at: 'after' },
  });
  assert.deepEqual(db.prepare('SELECT * FROM crm_accounts WHERE id=?').get('CRM-1'), {
    id: 'CRM-1', stage: 'qualified', lifecycle_status: 'active',
    assignment_status: 'returned', owner_id: null, updated_at: 'after',
  });
  db.close();
});

test('applyAccountStatePatch reports missing accounts without changing data', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE crm_accounts (id TEXT PRIMARY KEY, stage TEXT)');
  const result = applyAccountStatePatch(db, 'missing', { stage: 'lost' });
  assert.deepEqual(result, { changed: false, patch: { stage: 'lost' } });
  db.close();
});

test('buildAccountInsertState normalizes a valid creation state', () => {
  assert.deepEqual(buildAccountInsertState({
    stage: 'qualified',
    lifecycleStatus: 'active',
    assignmentStatus: 'claimed',
    ownerId: 'U-WU',
  }), {
    stage: 'qualified',
    lifecycle_status: 'active',
    assignment_status: 'claimed',
    owner_id: 'U-WU',
  });
  assert.deepEqual(buildAccountInsertState({
    stage: 'lost',
    lifecycleStatus: 'active',
    assignmentStatus: 'unassigned',
    ownerId: '',
  }), {
    stage: 'lost',
    lifecycle_status: 'active',
    assignment_status: 'unassigned',
    owner_id: null,
  });
});

test('buildAccountInsertState rejects invalid creation states', () => {
  assert.throws(() => buildAccountInsertState({ stage: 'not-a-stage' }), /无效的客户阶段/);
  assert.throws(() => buildAccountInsertState({ lifecycleStatus: 'deleted' }), /无效的生命周期状态/);
  assert.throws(() => buildAccountInsertState({ assignmentStatus: 'pending' }), /无效的分配状态/);
});

test('manual customer creation stores a validated initial account state', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      companyName: 'State Create Fixture',
      stage: 'meeting',
      ownerId: 'U-OTHER',
      nextAction: '确认采购周期',
    },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  const account = fx.db.prepare(`SELECT stage,lifecycle_status,assignment_status,owner_id
    FROM crm_accounts WHERE external_customer_id=?`).get(body.externalCustomerId);
  assert.deepEqual(account, {
    stage: 'meeting',
    lifecycle_status: 'active',
    assignment_status: 'claimed',
    owner_id: 'U-OTHER',
  });
});

test('manual customer creation without an owner is stored as unassigned', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { companyName: 'Unassigned Create Fixture' },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  const account = fx.db.prepare(`SELECT assignment_status,owner_id
    FROM crm_accounts WHERE external_customer_id=?`).get(body.externalCustomerId);
  assert.equal(account.assignment_status, 'unassigned');
  assert.equal(account.owner_id, null);
});

test('profile edit routes stage changes through the validated state writer', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { stage: 'negotiating' },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(
    fx.db.prepare('SELECT stage FROM crm_accounts WHERE id=?').get('CRM-WU').stage,
    'negotiating',
  );
});

test('profile edit rejects an invalid stage before any state change', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const before = fx.db.prepare('SELECT stage FROM crm_accounts WHERE id=?').get('CRM-WU').stage;
  const response = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { stage: 'not-a-stage' },
  });
  assert.equal(response.status, 400);
  assert.equal(
    fx.db.prepare('SELECT stage FROM crm_accounts WHERE id=?').get('CRM-WU').stage,
    before,
  );
});

test('profile edit owner change keeps assignment status consistent', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { ownerId: 'U-OTHER' },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  const account = fx.db.prepare(`SELECT owner_id,assignment_status
    FROM crm_accounts WHERE id=?`).get('CRM-OWN');
  assert.equal(account.owner_id, 'U-OTHER');
  assert.equal(account.assignment_status, 'claimed');
});
