'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

function futureSql(days = 7) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

test('plan-only save updates the plan without creating an activity or fake progress', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const before = fx.db.prepare("SELECT COUNT(*) n FROM crm_activities WHERE customer_id='CRM-OTHER'").get().n;
  const response = await fx.request('/api/sales-crm/activities/plan-only', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OTHER',
      nextAction: '联系客户采购负责人，确认是否有新项目',
      nextActionAt: futureSql(),
      note: '目前没有发生新的客户动作，只补充下一步安排',
      idempotencyKey: 'plan-only-1',
    },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const account = fx.db.prepare("SELECT * FROM crm_accounts WHERE id='CRM-OTHER'").get();
  assert.equal(account.next_action, '联系客户采购负责人，确认是否有新项目');
  assert.equal(account.next_action_time_basis, 'utc');
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) n FROM crm_activities WHERE customer_id='CRM-OTHER'").get().n,
    before,
  );
  const audit = fx.db.prepare(`SELECT * FROM crm_audit_log
    WHERE action='activity_plan_only_saved' AND entity_id='CRM-OTHER' ORDER BY created_at DESC LIMIT 1`).get();
  assert.ok(audit);
  assert.equal(JSON.parse(audit.detail_json).note, '目前没有发生新的客户动作，只补充下一步安排');
});

test('plan-only is idempotent on the same key and requires a real plan pair', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const payload = {
    customerId: 'CRM-OTHER', nextAction: '两天后电话联系', nextActionAt: futureSql(),
    idempotencyKey: 'plan-only-2',
  };
  const first = await fx.request('/api/sales-crm/activities/plan-only', {
    cookie: fx.otherCookie, method: 'POST', body: payload,
  });
  assert.equal(first.status, 200);
  const second = await fx.request('/api/sales-crm/activities/plan-only', {
    cookie: fx.otherCookie, method: 'POST', body: payload,
  });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).deduplicated, true);

  const missing = await fx.request('/api/sales-crm/activities/plan-only', {
    cookie: fx.otherCookie, method: 'POST',
    body: { customerId: 'CRM-OTHER', nextAction: '只有动作', nextActionAt: '', idempotencyKey: 'x-1' },
  });
  assert.equal(missing.status, 400);
});

test('sales cannot plan-only for a customer outside their scope', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/activities/plan-only', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', nextAction: '越权写计划', nextActionAt: futureSql(),
      idempotencyKey: 'plan-only-3',
    },
  });
  assert.equal(response.status, 403);
});
