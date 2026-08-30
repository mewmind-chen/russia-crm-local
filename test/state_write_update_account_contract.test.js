'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

function functionSlice(sourceText, functionName, nextFunctionName) {
  const start = sourceText.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = sourceText.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return sourceText.slice(start, end);
}

const body = functionSlice(source, 'updateAccount', 'updateCustomerMaster');

const FUTURE = '2099-08-28 09:00:00';

// 阶段 B §1 纠正：updateAccount（profile 编辑）不再经动态字段直写网关列，
// stage/owner/assignment/next_action*/manager_* 必须走 state_write/collaboration_write 网关。
test('updateAccount routes gateway columns through the lifecycle gateways', () => {
  assert.match(body, /applyAccountStatePatch\(/, 'stage/owner/assignment must go through state gateway');
  assert.match(body, /applyAccountPlanPatch\(/, 'plan fields must go through plan gateway');
  assert.match(body, /applyManagerStatusPatch\(/, 'manager fields must go through manager gateway');
  assert.doesNotMatch(body, /fields\.push\('stage=\?'\)/, 'stage must not be a raw field write');
  assert.doesNotMatch(body, /fields\.push\('owner_id=\?'\)/, 'owner_id must not be a raw field write');
  assert.doesNotMatch(body, /fields\.push\('next_action_time_basis=\?'\)/, 'time basis must not be a raw field write');
  assert.doesNotMatch(body, /fields\.push\('manager_required=\?'\)/, 'manager_required must not be a raw field write');
  assert.doesNotMatch(body, /fields\.push\('manager_status=\?'\)/, 'manager_status must not be a raw field write');
});

// 行为契约：stage 编辑经网关落库。
test('PATCH stage edit updates the account stage', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH', body: { stage: 'meeting' },
  });
  assert.equal(response.status, 200);
  const row = fx.db.prepare(`SELECT stage FROM crm_accounts WHERE id='CRM-OWN'`).get();
  assert.equal(row.stage, 'meeting');
});

// 行为契约：计划编辑经 plan 网关写 next_action/at/time_basis='utc'。
test('PATCH plan edit writes plan fields with utc basis', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH',
    body: { nextAction: '跟进报价', nextActionAt: FUTURE },
  });
  assert.equal(response.status, 200);
  const row = fx.db.prepare(
    `SELECT next_action,next_action_at,next_action_time_basis FROM crm_accounts WHERE id='CRM-OWN'`,
  ).get();
  assert.equal(row.next_action, '跟进报价');
  assert.equal(row.next_action_time_basis, 'utc');
});

// 行为契约：负责人变更经 state 网关写 owner_id/assignment_status='claimed'，
// assigned_at 仍直写（非网关列）。
test('PATCH owner assign writes owner via state gateway', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH', body: { ownerId: 'U-OTHER' },
  });
  assert.equal(response.status, 200);
  const row = fx.db.prepare(
    `SELECT owner_id,assignment_status,assigned_at FROM crm_accounts WHERE id='CRM-OWN'`,
  ).get();
  assert.equal(row.owner_id, 'U-OTHER');
  assert.equal(row.assignment_status, 'claimed');
  assert.ok(String(row.assigned_at || '').length > 0, 'assigned_at must be stamped');
});

// 行为契约：转入未分配经 state 网关写 owner null + assignment_status='unassigned'，
// 且写 unassign 审计。
test('PATCH unassign writes owner null and unassigned status with audit', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH',
    body: { ownerId: '__unassigned__', unassignConfirmed: true, unassignReason: '测试转入未分配' },
  });
  assert.equal(response.status, 200);
  const row = fx.db.prepare(
    `SELECT owner_id,assignment_status FROM crm_accounts WHERE id='CRM-OWN'`,
  ).get();
  assert.equal(row.owner_id, null);
  assert.equal(row.assignment_status, 'unassigned');
  const audit = fx.db.prepare(
    `SELECT COUNT(*) count FROM crm_audit_log WHERE entity_id='CRM-OWN' AND action='customer_unassigned'`,
  ).get();
  assert.equal(audit.count, 1);
});

// 行为契约：进入 lost（stopsFollowUp）时计划字段被清空。
test('PATCH moving to lost clears the plan fields', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH',
    body: { stage: 'lost', nextAction: '不该写入', nextActionAt: FUTURE },
  });
  assert.equal(response.status, 200);
  const row = fx.db.prepare(
    `SELECT next_action,next_action_at,next_action_time_basis FROM crm_accounts WHERE id='CRM-OWN'`,
  ).get();
  assert.equal(row.next_action, '');
  assert.equal(row.next_action_at, '');
  assert.equal(row.next_action_time_basis, '');
});

// 行为契约：manager_required 经 manager 网关写入，manager_status 不被隐式改动。
test('PATCH managerRequired writes via manager gateway without touching status', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const before = fx.db.prepare(
    `SELECT manager_required,manager_status FROM crm_accounts WHERE id='CRM-OWN'`,
  ).get();
  const response = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH', body: { managerRequired: true },
  });
  assert.equal(response.status, 200);
  const after = fx.db.prepare(
    `SELECT manager_required,manager_status FROM crm_accounts WHERE id='CRM-OWN'`,
  ).get();
  assert.equal(after.manager_required, 1);
  assert.equal(after.manager_status, before.manager_status);
});