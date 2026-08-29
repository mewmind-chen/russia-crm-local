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
  MANAGER_COLUMNS,
  assertNoColumns,
} = require('./helpers/lifecycle_gate_contract');

const root = path.join(__dirname, '..');
const salesCrmSource = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 B §1：addActivity 对 crm_accounts 的写必须经 state/plan/manager 网关。
// last_activity_at 是活动时间戳（不在网关列），允许直写。
test('addActivity routes stage, plan, and manager writes through the lifecycle gateways', () => {
  const body = functionSlice(salesCrmSource, 'addActivity', 'planOnlyActivity');
  assertNoColumns(body, STATE_COLUMNS, [/applyAccountStatePatch\(/], 'addActivity');
  assertNoColumns(body, PLAN_COLUMNS, [/applyAccountPlanPatch\(/], 'addActivity');
  assertNoColumns(body, MANAGER_COLUMNS, [/applyManagerStatusPatch\(/], 'addActivity');
});

async function recordActivity(fx, body) {
  return fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie,
    method: 'POST',
    body,
  });
}

test('a plan-carrying activity advances the account through the state gateways', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const res = await recordActivity(fx, {
    customerId: 'CRM-WU',
    progressType: 'call',
    reactionOptionId: 'REACTION-FOLLOW-UP',
    summary: '电话沟通采购意向',
    nextAction: '确认采购窗口',
    nextActionAt: '2099-08-05 09:00:00',
  });
  assert.equal(res.status, 200, await res.text());

  const row = fx.db.prepare(`SELECT stage,last_activity_at,next_action,next_action_at,next_action_time_basis,
    manager_required,manager_status,updated_at FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(row.stage, 'contacted');
  assert.ok(row.last_activity_at, 'last_activity_at must be preserved');
  assert.equal(row.next_action, '确认采购窗口');
  assert.ok(row.next_action_at, 'next_action_at must be preserved');
  assert.equal(row.next_action_time_basis, 'utc');
  assert.equal(row.manager_required, 0);
  assert.equal(row.manager_status, '');
  assert.ok(row.updated_at);
});

test('a lost activity advances to the terminal stage and clears the plan', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const res = await recordActivity(fx, {
    customerId: 'CRM-WU',
    progressType: 'lost',
    reactionOptionId: 'REACTION-REJECTED',
    summary: '明确拒绝',
  });
  assert.equal(res.status, 200, await res.text());

  const row = fx.db.prepare(`SELECT stage,next_action,next_action_at,next_action_time_basis,loss_reason
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(row.stage, 'lost');
  assert.equal(row.next_action, '');
  assert.equal(row.next_action_at, '');
  assert.equal(row.next_action_time_basis, '');
  assert.equal(row.loss_reason, '明确拒绝');
});

test('a manager-required activity sets the manager collaboration fields', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const res = await recordActivity(fx, {
    customerId: 'CRM-WU',
    progressType: 'call',
    reactionOptionId: 'REACTION-MANAGEMENT',
    summary: '对接到老板，需要主管协助',
    managerRequired: true,
  });
  assert.equal(res.status, 200, await res.text());

  const row = fx.db.prepare(`SELECT manager_required,manager_status
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(row.manager_required, 1);
  assert.equal(row.manager_status, '待介入');
});