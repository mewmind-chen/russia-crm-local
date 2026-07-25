'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const {
  buildSalesCoachingSnapshot,
} = require('../lib/ai_stations/sales_coaching');
const { validateStationOutput } = require('../lib/ai_stations/contracts');
const { createAIStationWorker } = require('../lib/ai_stations/worker');

function coachingOutput(snapshot, evidenceIds) {
  return {
    version: 'v1',
    salesUserId: snapshot.salesUserId,
    sampleSize: snapshot.sampleSize,
    sampleStatus: snapshot.sampleStatus,
    reasonCodes: ['REPLY_STRENGTH', 'RFQ_GAP'],
    strengths: ['有效回复转化表现稳定，可继续复用当前沟通方式。'],
    gaps: ['会议到询价的转化仍有提升空间。'],
    recommendations: ['经理陪同复盘三场近期会议，明确需求确认和 BOM 引导动作。'],
    evidenceIds,
    confidence: snapshot.sampleStatus === 'limited' ? 0.6 : 0.82,
    reviewRequired: true,
  };
}

test('sales coaching snapshot contains aggregate outcomes and SLA only', () => {
  const snapshot = buildSalesCoachingSnapshot({
    user: { id: 'U-SALES', name: '销售甲' },
    accounts: Array.from({ length: 12 }, (_, index) => ({
      id: `CRM-${index}`,
      owner_id: 'U-SALES',
      next_action: index < 10 ? '跟进' : '',
      next_action_at: index === 0 ? '2026-07-01 00:00:00' : '2099-01-01 00:00:00',
    })),
    activities: [
      { customer_id: 'CRM-0', activity_type: 'email' },
      { customer_id: 'CRM-0', activity_type: 'reply' },
      { customer_id: 'CRM-0', activity_type: 'meeting' },
    ],
    rfqs: [{ customer_id: 'CRM-0', completeness: 80 }],
    quotes: [{ customer_id: 'CRM-0' }],
    orders: [{ customer_id: 'CRM-0', amount: 1000, gross_margin: 20 }],
    now: new Date('2026-07-25T12:00:00.000Z'),
  });

  assert.equal(snapshot.salesUserId, 'U-SALES');
  assert.equal(snapshot.populationSize, 12);
  assert.equal(snapshot.sampleSize, 10);
  assert.equal(snapshot.sampleStatus, 'limited');
  assert.equal(snapshot.metrics.overdue, 1);
  assert.equal(snapshot.metrics.orders, 1);
  assert.equal(snapshot.rates.reply, 100);
  assert.equal(JSON.stringify(snapshot).includes('CRM-0'), false);
});

test('sales coaching contract rejects invented scope, evidence, low-sample precision, and non-Chinese text', () => {
  const snapshot = {
    salesUserId: 'U-SALES',
    sampleSize: 12,
    sampleStatus: 'limited',
  };
  const context = {
    evidenceIds: ['SCE-0001'],
    salesUserIds: ['U-SALES'],
    sampleSizes: [12],
    sampleStatuses: ['limited'],
  };
  const valid = coachingOutput(snapshot, ['SCE-0001']);
  assert.equal(validateStationOutput('sales_coaching', 'v1', valid, context).ok, true);
  assert.equal(validateStationOutput('sales_coaching', 'v1', {
    ...valid, salesUserId: 'U-OTHER',
  }, context).ok, false);
  assert.equal(validateStationOutput('sales_coaching', 'v1', {
    ...valid, evidenceIds: ['SCE-INVENTED'],
  }, context).ok, false);
  assert.equal(validateStationOutput('sales_coaching', 'v1', {
    ...valid, confidence: 0.9,
  }, context).ok, false);
  assert.equal(validateStationOutput('sales_coaching', 'v1', {
    ...valid, strengths: ['Fast first response'],
  }, context).ok, false);
});

async function fixture() {
  const fx = await fixtures.seededFixture({
    permissions: {
      use_ai_assistant: true,
      view_team: true,
      view_customers: true,
      review_ai_tasks: true,
    },
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  const now = '2026-07-21 08:00:00';
  for (let index = 0; index < 10; index += 1) {
    const accountId = `CRM-COACH-${index}`;
    const externalId = `RU-${9100 + index}`;
    fx.db.prepare(`INSERT INTO crm_accounts
      (id,external_customer_id,company_name,owner_id,stage,assignment_status,next_action,next_action_at,created_at,updated_at)
      VALUES (?,?,?,'U-OTHER','qualified','claimed','跟进','2099-01-01 00:00:00',?,?)`)
      .run(accountId, externalId, `Coaching ${index}`, now, now);
    fx.db.prepare('INSERT INTO customer_pool(customer_id,company_name) VALUES (?,?)')
      .run(externalId, `Coaching ${index}`);
    fx.db.prepare(`INSERT INTO crm_activities
      (id,customer_id,user_id,activity_type,channel,occurred_at,created_at)
      VALUES (?,?,?,'email','email',?,?)`)
      .run(`ACT-COACH-${index}`, accountId, 'U-OTHER', now, now);
  }
  return fx;
}

test('manager can run scoped coaching asynchronously while sales cannot read team coaching', async t => {
  const fx = await fixture();
  t.after(() => fx.close());

  const before = fx.db.prepare(`SELECT COUNT(*) count FROM crm_activities`).get().count;
  const started = await fx.request('/api/sales-crm/ai/sales-coaching/U-OTHER/run', {
    cookie: fx.cookie, method: 'POST', body: {},
  });
  assert.equal(started.status, 202);
  const startedBody = await started.json();
  assert.equal(startedBody.job.station, 'sales_coaching');
  assert.equal(startedBody.snapshot.salesUserId, 'U-OTHER');

  const worker = createAIStationWorker({
    workerId: 'sales-coaching-worker',
    openDb: () => new Database(fx.dbPath),
    executorOptions: {
      modelCall: async messages => {
        const input = JSON.parse(messages[1].content);
        return {
          answer: JSON.stringify(coachingOutput(
            input.trustedCrmContext.snapshot,
            input.evidence.map(item => item.id),
          )),
          engine: 'test',
          model: 'sales-coaching-fixture',
          cost: 0,
        };
      },
    },
  });
  const execution = await worker.runOnce();
  assert.equal(execution.status, 'succeeded', execution.error?.stack || execution.job?.errorSummary);

  const listed = await fx.request('/api/sales-crm/ai/sales-coaching', { cookie: fx.cookie });
  assert.equal(listed.status, 200);
  const item = (await listed.json()).items.find(row => row.salesUserId === 'U-OTHER');
  assert.ok(item.ai.result.value.strengths[0].includes('回复'));
  assert.equal(item.ai.result.value.reviewRequired, true);

  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='archived'
    WHERE id='CRM-COACH-0'`).run();
  const staleResponse = await fx.request('/api/sales-crm/ai/sales-coaching', { cookie: fx.cookie });
  const staleItem = (await staleResponse.json()).items.find(row => row.salesUserId === 'U-OTHER');
  assert.equal(staleItem.snapshot.sampleStatus, 'insufficient');
  assert.equal(staleItem.ai.stale, true);

  const salesCookie = await fx.login('other@example.com', 'Password123!');
  const denied = await fx.request('/api/sales-crm/ai/sales-coaching', { cookie: salesCookie });
  assert.equal(denied.status, 403);
  const hiddenTasks = await fx.request('/api/sales-crm/ai/tasks?type=sales_coaching', {
    cookie: salesCookie,
  });
  assert.equal(hiddenTasks.status, 403);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_activities').get().count, before);
});

test('insufficient samples are explicit and do not enqueue a model job', async t => {
  const fx = await fixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,
     languages_json,countries_json,channels_json,permission_group_id,created_at,updated_at)
    SELECT 'U-LIMIT','limit@example.com','Limit','sales',password_hash,password_salt,1,0,
      '[]','[]','[]',permission_group_id,created_at,updated_at
    FROM sales_users WHERE id='U-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,created_at,updated_at)
    VALUES ('CRM-LIMIT','RU-9999','Limited Sample','U-LIMIT','qualified','claimed',
      '2026-07-21 08:00:00','2026-07-21 08:00:00')`).run();
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name)
    VALUES ('RU-9999','Limited Sample')`).run();
  const response = await fx.request('/api/sales-crm/ai/sales-coaching/U-LIMIT/run', {
    cookie: fx.cookie, method: 'POST', body: {},
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'AI_SALES_COACHING_SAMPLE_INSUFFICIENT');
  assert.match(body.error, /样本不足/);
  const hasJobsTable = Boolean(fx.db.prepare(`SELECT 1 found FROM sqlite_master
    WHERE type='table' AND name='crm_ai_jobs'`).get());
  assert.equal(hasJobsTable
    ? fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_jobs WHERE station='sales_coaching'`).get().count
    : 0, 0);
});

test('sales coaching appears in the existing team capability page with explicit human review', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  assert.match(html, /id="teamCoachingStatus"/);
  assert.match(app, /sales-coaching/);
  assert.match(app, /AI 辅导建议仅供经理复核/);
  assert.match(app, /SALES_COACHING_MAX_POLLS = 72/);
  assert.doesNotMatch(app, /autoCoach|autoChangePrompt|autoReassignFromCoaching/);
});
