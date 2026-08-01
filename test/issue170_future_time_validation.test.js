'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const { createAIStationWorker } = require('../lib/ai_stations/worker');
const { adoptNextAction } = require('../lib/ai_stations/next_action');

const PAST = '2000-01-01 00:00:00';
const FUTURE = '2099-08-08 09:00:00';
const FUTURE_ERROR = '下一步时间必须晚于当前时间';

async function enabledFixture(t, options = {}) {
  const previous = process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
  process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = 'true';
  const fx = await fixtures.adminFixture(options);
  t.after(async () => {
    await fx.close();
    if (previous === undefined) delete process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
    else process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = previous;
  });
  return fx;
}

async function expectFutureError(response, label) {
  const body = await response.json();
  assert.equal(response.status, 400, `${label}: ${body.error || body.code || ''}`);
  assert.equal(body.error, FUTURE_ERROR, label);
}

function request(fx, route, body, cookie = fx.adminCookie) {
  return fx.request(route, { cookie, method: 'POST', body });
}

function seedRfq(fx, id = 'RFQ-170-FUTURE') {
  fx.db.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,reference,status,bom_lines,expected_value,product_category,
     completeness,received_at,quoted_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, 'CRM-OWN', 'U-MGR', id, 'open', 2, 1200, 'MCU', 80, PAST, '', PAST,
  );
}

test('business datetime parser treats browser local time as Asia/Shanghai and rejects past or equal now', () => {
  const { parseBusinessDateTime, resolveBusinessTimezone } = require('../lib/deferred_plan');
  assert.equal(resolveBusinessTimezone({}), 'Asia/Shanghai');
  assert.equal(
    resolveBusinessTimezone({ CRM_BUSINESS_TIMEZONE: 'Europe/Moscow' }),
    'Europe/Moscow',
  );
  assert.throws(
    () => resolveBusinessTimezone({ CRM_BUSINESS_TIMEZONE: '' }),
    error => error.statusCode === 500 && error.code === 'BUSINESS_TIMEZONE_INVALID',
  );
  assert.equal(parseBusinessDateTime('2026-08-01T12:30', {
    now: '2026-08-01T04:29:59.000Z',
    timezone: 'Asia/Shanghai',
  }), '2026-08-01 04:30:00');
  for (const input of ['2026-08-01T12:29:59', '2026-08-01T12:30:00']) {
    assert.throws(
      () => parseBusinessDateTime(input, {
        now: '2026-08-01T04:30:00.000Z',
        timezone: 'Asia/Shanghai',
      }),
      error => error.statusCode === 400 && error.message === FUTURE_ERROR,
      input,
    );
  }
  assert.throws(
    () => parseBusinessDateTime('2026-08-01T04:30:00.500Z', {
      now: '2026-08-01T04:30:00.100Z',
      timezone: 'Asia/Shanghai',
    }),
    error => error.statusCode === 400 && error.message === FUTURE_ERROR,
  );
});

test('today task plan rejects a past time before changing the account snapshot', async t => {
  const fx = await enabledFixture(t);
  fx.db.prepare("UPDATE crm_accounts SET next_action='',next_action_at='' WHERE id='CRM-OTHER'").run();
  await expectFutureError(await request(fx, '/api/sales-crm/today-tasks/actions', {
    actionType: 'add_next_plan', customerId: 'CRM-OTHER', nextAction: '联系采购',
    nextActionAt: PAST, idempotencyKey: 'issue170-today-past',
  }), '今日待办补计划');
  assert.deepEqual(fx.db.prepare(
    "SELECT next_action,next_action_at FROM crm_accounts WHERE id='CRM-OTHER'",
  ).get(), { next_action: '', next_action_at: '' });
});

test('recording progress rejects a past plan but still permits historical occurredAt', async t => {
  const fx = await enabledFixture(t);
  const invalid = await request(fx, '/api/sales-crm/activities', {
    customerId: 'CRM-OWN', progressType: 'email', reactionOptionId: 'REACTION-FOLLOW-UP',
    summary: '补录历史邮件', nextAction: '继续跟进', nextActionAt: PAST,
    occurredAt: PAST, idempotencyKey: 'issue170-progress-past-plan',
  });
  await expectFutureError(invalid, '记录新进展');
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_activities WHERE summary='补录历史邮件'").get().count, 0);

  const valid = await request(fx, '/api/sales-crm/activities', {
    customerId: 'CRM-OWN', progressType: 'email', reactionOptionId: 'REACTION-FOLLOW-UP',
    summary: '合法补录历史邮件', nextAction: '继续跟进', nextActionAt: FUTURE,
    occurredAt: PAST, idempotencyKey: 'issue170-progress-historical-occurred-at',
  });
  assert.equal(valid.status, 200, (await valid.clone().text()));
  assert.equal(fx.db.prepare("SELECT occurred_at FROM crm_activities WHERE summary='合法补录历史邮件'").get().occurred_at, PAST);
});

test('new and edited customers reject past plan times without partial writes', async t => {
  const fx = await enabledFixture(t);
  const beforeAccounts = fx.db.prepare('SELECT COUNT(*) count FROM crm_accounts').get().count;
  await expectFutureError(await request(fx, '/api/sales-crm/accounts', {
    companyName: 'Issue 170 Past Create', country: '俄罗斯', ownerId: '__unassigned__',
    nextAction: '首次触达', nextActionAt: PAST,
  }), '新增客户');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_accounts').get().count, beforeAccounts);

  const before = fx.db.prepare("SELECT next_action,next_action_at FROM crm_accounts WHERE id='CRM-OWN'").get();
  const edited = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH',
    body: { nextAction: '编辑后跟进', nextActionAt: PAST },
  });
  await expectFutureError(edited, '编辑客户');
  assert.deepEqual(
    fx.db.prepare("SELECT next_action,next_action_at FROM crm_accounts WHERE id='CRM-OWN'").get(),
    before,
  );
});

test('quote and order reject past follow-up times before commerce writes', async t => {
  const fx = await enabledFixture(t);
  seedRfq(fx);
  await expectFutureError(await request(fx, '/api/sales-crm/quotes', {
    customerId: 'CRM-OWN', rfqId: 'RFQ-170-FUTURE', amount: 1000, currency: 'USD',
    grossMargin: 10, nextFollowAt: PAST, idempotencyKey: 'issue170-quote-past',
  }), '报价后跟进');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_quotes').get().count, 0);

  const quote = fx.db.prepare(`INSERT INTO crm_quotes
    (id,rfq_id,customer_id,user_id,amount,currency,gross_margin,loss_leader,status,
     sent_at,next_follow_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  quote.run('Q-170-FUTURE', 'RFQ-170-FUTURE', 'CRM-OWN', 'U-MGR', 1000, 'USD', 10, 0,
    'sent', PAST, FUTURE, PAST);
  await expectFutureError(await request(fx, '/api/sales-crm/orders', {
    customerId: 'CRM-OWN', quoteId: 'Q-170-FUTURE', amount: 1000, currency: 'USD',
    grossMargin: 8, nextActionAt: PAST, idempotencyKey: 'issue170-order-past',
  }), '订单后经营动作');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_orders').get().count, 0);
});

test('AI adoption validates future time and effective AI gate cannot be bypassed', async t => {
  const fx = await enabledFixture(t, {
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  const activity = await (await request(fx, '/api/sales-crm/activities', {
    customerId: 'CRM-OWN', progressType: 'email', reactionOptionId: 'REACTION-FOLLOW-UP',
    summary: '产生 AI 建议', nextAction: '人工计划', nextActionAt: FUTURE,
    idempotencyKey: 'issue170-ai-proposal-source',
  })).json();
  const worker = createAIStationWorker({
    workerId: 'issue170-next-action-worker',
    openDb: () => new Database(fx.dbPath),
    executorOptions: {
      modelCall: async () => ({
        answer: JSON.stringify({
          version: 'v1', nextAction: 'AI 计划', nextActionAt: FUTURE,
          managerRequired: false, reason: '测试', missingFields: [], evidenceIds: [],
          confidence: 0.9, reviewRequired: true,
        }),
        engine: 'test', model: 'issue170-fixture', cost: 0,
      }),
    },
  });
  assert.equal((await worker.runOnce()).status, 'succeeded');
  const route = `/api/sales-crm/ai/jobs/${activity.nextActionJobId}/next-action/adopt`;
  await expectFutureError(await request(fx, route, {
    nextAction: 'AI 计划', nextActionAt: PAST, managerRequired: false,
  }), '采纳 AI 下一步建议');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_next_action_consumptions').get().count, 0);

  fx.db.prepare("UPDATE crm_ai_feature_flags SET enabled=0 WHERE feature_key='ai_stations'").run();
  const disabled = await request(fx, route, {
    nextAction: 'AI 计划', nextActionAt: FUTURE, managerRequired: false,
  });
  const disabledBody = await disabled.json();
  assert.equal(disabled.status, 409);
  assert.equal(disabledBody.code, 'AI_FEATURE_DISABLED');
  assert.throws(() => adoptNextAction(fx.db, {
    jobId: activity.nextActionJobId,
    actorId: 'U-MGR',
    crmAccountId: 'CRM-OWN',
    confirmed: { nextAction: '直接调用也不应采纳', nextActionAt: FUTURE },
    hardFlags: { ai_stations: false },
  }), error => error.statusCode === 409 && error.code === 'AI_FEATURE_DISABLED');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_next_action_consumptions').get().count, 0);
});
