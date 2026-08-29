'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');
const {
  functionSlice,
  PLAN_COLUMNS,
  MANAGER_COLUMNS,
  assertNoColumns,
} = require('./helpers/lifecycle_gate_contract');

const root = path.join(__dirname, '..');
const salesCrmSource = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

const PLAN_ONLY = [/applyAccountPlanPatch\(/];
const MANAGER = [/applyManagerStatusPatch\(/];

test('deferring a plan clears the account plan through the plan gateway', () => {
  assertNoColumns(
    functionSlice(salesCrmSource, 'deferAccountPlan', 'scopedManagerAccount'),
    PLAN_COLUMNS,
    PLAN_ONLY,
    'deferAccountPlan',
  );
});

test('adding a next plan from today tasks goes through the plan gateway', () => {
  assertNoColumns(
    functionSlice(salesCrmSource, 'addNextPlanTodayTask', 'completeManagerAssistanceTodayTask'),
    PLAN_COLUMNS,
    PLAN_ONLY,
    'addNextPlanTodayTask',
  );
});

test('completing manager assistance writes the reply through the manager gateway', () => {
  assertNoColumns(
    functionSlice(salesCrmSource, 'completeManagerAssistanceTodayTask', 'confirmManagerAssistanceTodayTask'),
    MANAGER_COLUMNS,
    MANAGER,
    'completeManagerAssistanceTodayTask',
  );
});

test('confirming manager assistance writes plan and manager fields through both gateways', () => {
  const body = functionSlice(salesCrmSource, 'confirmManagerAssistanceTodayTask', 'executeTodayTaskAction');
  assertNoColumns(body, PLAN_COLUMNS, PLAN_ONLY, 'confirmManagerAssistanceTodayTask');
  assertNoColumns(body, MANAGER_COLUMNS, MANAGER, 'confirmManagerAssistanceTodayTask');
});

test('saving a plan-only activity goes through the plan gateway', () => {
  assertNoColumns(
    functionSlice(salesCrmSource, 'planOnlyActivity', 'addQuote'),
    PLAN_COLUMNS,
    PLAN_ONLY,
    'planOnlyActivity',
  );
});

test('plan-only save persists the plan fields through the gateway', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const res = await fx.request('/api/sales-crm/activities/plan-only', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU',
      nextAction: '寄送样品并跟进反馈',
      nextActionAt: '2099-08-06 09:00:00',
      idempotencyKey: 'plan-only-contract-1',
      note: '契约测试',
    },
  });
  assert.equal(res.status, 200, await res.text());

  const row = fx.db.prepare(`SELECT next_action,next_action_at,next_action_time_basis,updated_at
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(row.next_action, '寄送样品并跟进反馈');
  assert.ok(row.next_action_at, 'next_action_at must be preserved');
  assert.equal(row.next_action_time_basis, 'utc');
  assert.ok(row.updated_at);
});