'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

function managerPayload(overrides = {}) {
  return {
    customerId: 'CRM-OTHER',
    progressType: 'email',
    reactionOptionId: '',
    summary: '客户暂无回复，需要主管协助梳理联系人',
    occurredAt: '2026-08-13 13:50:00',
    managerRequired: true,
    nextAction: '希望主管协助查询联系人',
    nextActionAt: '',
    ...overrides,
  };
}

function accountPlan(fx) {
  return fx.db.prepare(
    "SELECT next_action, next_action_at, next_action_time_basis FROM crm_accounts WHERE id='CRM-OTHER'",
  ).get();
}

test('manager assistance accepts a text-only original plan without a time', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const before = accountPlan(fx);

  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: managerPayload(),
  });
  assert.equal(response.status, 200, await response.clone().text());

  const task = fx.db.prepare(
    "SELECT * FROM crm_manager_tasks WHERE reason='manager_assistance'",
  ).get();
  assert.ok(task);
  const evidence = JSON.parse(task.evidence_json);
  assert.equal(evidence.requestReason, '客户暂无回复，需要主管协助梳理联系人');
  assert.equal(evidence.originalPlan, '希望主管协助查询联系人');
  assert.equal(evidence.nextActionAt, '');
});

test('manager assistance keeps the customer plan untouched', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  fx.db.prepare(
    "UPDATE crm_accounts SET next_action='原定计划', next_action_at='2026-08-25 09:00:00', next_action_time_basis='utc' WHERE id='CRM-OTHER'",
  ).run();
  const before = accountPlan(fx);

  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: managerPayload({ nextAction: '原计划快照', nextActionAt: '' }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const after = accountPlan(fx);
  assert.deepEqual(after, before, 'manager request must not overwrite customer plan');
});

test('manager assistance without a reason is still rejected before any write', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: managerPayload({ summary: '' }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error || '', /申请原因/);
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) AS n FROM crm_manager_tasks WHERE reason='manager_assistance'").get().n,
    0,
  );
});

test('non-manager activities still require paired plan and time', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OTHER',
      progressType: 'email',
      reactionOptionId: '',
      summary: '正常进展',
      nextAction: '有下一步计划但没有时间',
      nextActionAt: '',
    },
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error || '', /下一步计划和计划时间必须同时填写/);
});
