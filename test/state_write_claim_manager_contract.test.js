'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');
const {
  functionSlice,
  STATE_COLUMNS,
  PLAN_COLUMNS,
  assertNoColumns,
} = require('./helpers/lifecycle_gate_contract');

const root = path.join(__dirname, '..');
const salesCrmSource = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

const STATE = [/applyAccountStatePatch\(/];
const STATE_AND_PLAN = [/applyAccountStatePatch\(/, /applyAccountPlanPatch\(/];

test('claiming an intake item routes assignment and first-touch plan through the gateways', () => {
  const body = functionSlice(salesCrmSource, 'manageIntake', 'deferAccountPlan');
  assertNoColumns(body, STATE_COLUMNS, STATE, 'manageIntake claim');
  assertNoColumns(body, PLAN_COLUMNS, [/applyAccountPlanPatch\(/], 'manageIntake claim');
});

test('manager task change routes stage, plan, and assignment writes through the gateways', () => {
  const body = functionSlice(salesCrmSource, 'managerTaskChange', 'resolveManagerTaskAction');
  assertNoColumns(body, STATE_COLUMNS, STATE_AND_PLAN, 'managerTaskChange');
  assertNoColumns(body, PLAN_COLUMNS, STATE_AND_PLAN, 'managerTaskChange');
});

test('overdue-lead resolution routes owner and assignment writes through the state gateway', () => {
  assertNoColumns(
    functionSlice(salesCrmSource, 'resolveOverdueLeadTodayTask', 'addNextPlanTodayTask'),
    STATE_COLUMNS,
    STATE,
    'resolveOverdueLeadTodayTask',
  );
});

test('reassigning a recycled customer routes lifecycle and assignment through the state gateway', () => {
  assertNoColumns(
    functionSlice(salesCrmSource, 'reassignReturnedCustomer', 'userReferenceReasons'),
    STATE_COLUMNS,
    STATE,
    'reassignReturnedCustomer',
  );
});

test('reassigning a recycled mismatch customer restores the account through the gateway', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const rejected = await fx.request('/api/sales-crm/accounts/CRM-WU/reject', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '网格不对口' },
  });
  assert.equal(rejected.status, 200, await rejected.text());

  const res = await fx.request('/api/sales-crm/accounts/CRM-WU/reassign', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { ownerId: 'U-OTHER', reason: '重新分配跟进' },
  });
  assert.equal(res.status, 200, await res.text());

  const row = fx.db.prepare(`SELECT lifecycle_status,recycle_kind,assignment_status,owner_id
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(row.lifecycle_status, 'active');
  assert.equal(row.recycle_kind, '');
  assert.equal(row.assignment_status, 'assigned');
  assert.equal(row.owner_id, 'U-OTHER');
});