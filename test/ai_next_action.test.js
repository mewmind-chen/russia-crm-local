'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');
const { getStation, renderPrompt } = require('../lib/ai_stations/prompt_registry');
const { validateStationOutput } = require('../lib/ai_stations/contracts');
const { createAIStationWorker } = require('../lib/ai_stations/worker');
const { buildAlerts } = require('../lib/sales_crm');

function output(overrides = {}) {
  return {
    version: 'v1',
    nextAction: '确认客户 BOM 完成时间并安排技术评审',
    nextActionAt: '2026-07-28 09:00:00',
    managerRequired: false,
    reason: '客户已回复并准备 BOM，应在承诺窗口内推进需求确认。',
    missingFields: [],
    evidenceIds: [],
    confidence: 0.88,
    reviewRequired: true,
    ...overrides,
  };
}

async function fixture() {
  return fixtures.seededFixture({
    managerViewAll: false,
    permissions: {
      use_ai_assistant: true,
      record_activity: true,
      record_quote: true,
      review_ai_tasks: true,
      view_customers: true,
      view_contacts: true,
    },
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
}

test('next_action is a strict human-review contract', () => {
  assert.equal(getStation('next_action').name, 'next_action');
  assert.equal(validateStationOutput('next_action', 'v1', output(), { evidenceIds: [] }).ok, true);
  assert.equal(validateStationOutput('next_action', 'v1', output({ reviewRequired: false }), {
    evidenceIds: [],
  }).ok, false);
  const prompt = renderPrompt('next_action', {
    actor: { id: 'U-SALES', role: 'sales', permissions: ['record_activity'] },
    trustedCrmContext: { customerId: 'RU-1' },
    evidence: [],
  });
  assert.match(prompt.systemPolicy, /Never update CRM state or schedule reminders/);
});

test('activity event creates an async next-action proposal and adoption is idempotent', async t => {
  const fx = await fixture();
  t.after(() => fx.close());

  const created = await fx.request('/api/sales-crm/activities', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN',
      activityType: 'reply',
      channel: 'email',
      outcome: '有兴趣',
      summary: '客户确认正在整理 BOM。',
      nextAction: '人工临时计划',
      nextActionAt: '2026-07-27 09:00:00',
    },
  });
  assert.equal(created.status, 200);
  const activity = await created.json();
  assert.match(activity.nextActionJobId, /^AIJ-/);
  const job = fx.db.prepare('SELECT * FROM crm_ai_jobs WHERE id=?').get(activity.nextActionJobId);
  assert.equal(job.station, 'next_action');
  assert.equal(job.event_type, 'activity_recorded');
  assert.equal(job.event_id, activity.activityId);

  const worker = createAIStationWorker({
    workerId: 'next-action-worker',
    openDb: () => new Database(fx.dbPath),
    executorOptions: {
      modelCall: async () => ({
        answer: JSON.stringify(output()), engine: 'test', model: 'next-action-fixture', cost: 0,
      }),
    },
  });
  assert.equal((await worker.runOnce()).status, 'succeeded');
  assert.equal(fx.db.prepare('SELECT state FROM crm_ai_jobs WHERE id=?').get(job.id).state, 'needs_review');
  assert.equal(fx.db.prepare('SELECT next_action FROM crm_accounts WHERE id=?').get('CRM-OWN').next_action, '人工临时计划');

  const payload = {
    nextAction: '确认客户 BOM 完成时间并安排技术评审',
    nextActionAt: '2026-07-28 09:00:00',
    managerRequired: false,
  };
  const adopted = await fx.request(`/api/sales-crm/ai/jobs/${job.id}/next-action/adopt`, {
    cookie: fx.cookie, method: 'POST', body: payload,
  });
  assert.equal(adopted.status, 200);
  assert.equal((await adopted.json()).deduplicated, false);
  const account = fx.db.prepare('SELECT * FROM crm_accounts WHERE id=?').get('CRM-OWN');
  assert.equal(account.next_action, payload.nextAction);
  assert.equal(account.next_action_at, payload.nextActionAt);

  const repeated = await fx.request(`/api/sales-crm/ai/jobs/${job.id}/next-action/adopt`, {
    cookie: fx.cookie, method: 'POST', body: payload,
  });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).deduplicated, true);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_next_action_consumptions WHERE job_id=?')
    .get(job.id).count, 1);
  assert.equal(fx.db.prepare('SELECT state FROM crm_ai_jobs WHERE id=?').get(job.id).state, 'succeeded');
});

test('RFQ and quote events enqueue one proposal each without blocking business writes', async t => {
  const fx = await fixture();
  t.after(() => fx.close());

  const rfqResponse = await fx.request('/api/sales-crm/activities', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN', activityType: 'rfq', channel: 'email', outcome: '收到BOM',
      summary: '收到正式询价', nextAction: '准备报价', nextActionAt: '2026-07-27 09:00:00',
      reference: 'RFQ-A3-03', bomLines: 20, expectedValue: 12000, completeness: 85,
    },
  });
  const rfqBody = await rfqResponse.json();
  assert.equal(rfqResponse.status, 200);
  assert.match(rfqBody.nextActionJobId, /^AIJ-/);

  const rfq = fx.db.prepare('SELECT id FROM crm_rfqs WHERE customer_id=? ORDER BY created_at DESC LIMIT 1').get('CRM-OWN');
  const quoteResponse = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN', rfqId: rfq.id, amount: 11000, currency: 'USD',
      nextFollowAt: '2026-07-30 09:00:00',
    },
  });
  const quoteBody = await quoteResponse.json();
  assert.equal(quoteResponse.status, 200);
  assert.match(quoteBody.nextActionJobId, /^AIJ-/);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_ai_jobs WHERE station='next_action'").get().count, 2);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_quotes WHERE id=?').get(quoteBody.quoteId).count, 1);
});

test('another salesperson cannot adopt a proposal and missing fields remain review-only', async t => {
  const fx = await fixture();
  t.after(() => fx.close());
  const created = await fx.request('/api/sales-crm/activities', {
    cookie: fx.cookie, method: 'POST',
    body: {
      customerId: 'CRM-OWN', activityType: 'meeting', channel: 'video', outcome: '已完成',
      summary: '完成需求会议', nextAction: '待定', nextActionAt: '2026-07-27 09:00:00',
    },
  });
  const jobId = (await created.json()).nextActionJobId;
  const worker = createAIStationWorker({
    workerId: 'next-action-incomplete-worker',
    openDb: () => new Database(fx.dbPath),
    executorOptions: {
      modelCall: async () => ({
        answer: JSON.stringify(output({ nextActionAt: '', missingFields: ['nextActionAt'], confidence: 0.4 })),
        engine: 'test', model: 'next-action-fixture',
      }),
    },
  });
  await worker.runOnce();

  const forbidden = await fx.request(`/api/sales-crm/ai/jobs/${jobId}/next-action/adopt`, {
    cookie: await fx.login('other@example.com', 'Password123!'),
    method: 'POST',
    body: { nextAction: '越权修改', nextActionAt: '2026-08-01 09:00:00' },
  });
  assert.equal(forbidden.status, 403);

  const incomplete = await fx.request(`/api/sales-crm/ai/jobs/${jobId}/next-action/adopt`, {
    cookie: fx.cookie, method: 'POST', body: { nextAction: '确认需求', nextActionAt: '' },
  });
  assert.equal(incomplete.status, 400);
  assert.equal((await incomplete.json()).code, 'AI_NEXT_ACTION_INCOMPLETE');
  assert.equal(fx.db.prepare('SELECT state FROM crm_ai_jobs WHERE id=?').get(jobId).state, 'needs_review');
});

test('revoked contact permission hides and blocks an existing next-action result', async t => {
  const fx = await fixture();
  t.after(() => fx.close());
  const created = await fx.request('/api/sales-crm/activities', {
    cookie: fx.cookie, method: 'POST',
    body: {
      customerId: 'CRM-OWN', activityType: 'reply', channel: 'email', outcome: '有兴趣',
      summary: '客户披露了采购计划', nextAction: '待确认', nextActionAt: '2026-07-27 09:00:00',
    },
  });
  const jobId = (await created.json()).nextActionJobId;
  const worker = createAIStationWorker({
    workerId: 'next-action-revoked-worker',
    openDb: () => new Database(fx.dbPath),
    executorOptions: {
      modelCall: async () => ({
        answer: JSON.stringify(output()), engine: 'test', model: 'next-action-fixture',
      }),
    },
  });
  await worker.runOnce();
  fx.setUserPermissions('U-MGR', { view_contacts: false });

  const results = await fx.request('/api/sales-crm/ai/customers/RU-9002/results', { cookie: fx.cookie });
  assert.equal(results.status, 200);
  assert.equal((await results.json()).nextAction.result, null);
  const adoption = await fx.request(`/api/sales-crm/ai/jobs/${jobId}/next-action/adopt`, {
    cookie: fx.cookie, method: 'POST',
    body: { nextAction: '不应采纳', nextActionAt: '2026-08-01 09:00:00' },
  });
  assert.equal(adoption.status, 403);
});

test('deterministic SLA alerts remain available when AI execution fails', () => {
  const account = {
    id: 'CRM-1', company_name: 'SLA Fixture', stage: 'replied', next_action: '',
    next_action_at: '', last_activity_at: '2026-07-20 00:00:00', manager_required: 0,
  };
  const alerts = buildAlerts([account], [], [], []);
  assert.ok(alerts.some(item => item.code === 'NO_NEXT'));
  assert.ok(alerts.some(item => item.code === 'REPLY_IDLE'));
});

test('customer UI exposes editable next-action adoption and keeps explicit confirmation', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  assert.match(app, /next-action\/adopt/);
  assert.match(app, /采纳下一步建议/);
  assert.match(app, /nextActionSuggestion/);
  assert.doesNotMatch(app, /autoAdoptNextAction|autoWriteNextAction/);
});
