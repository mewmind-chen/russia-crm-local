'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createAIStationWorker } = require('../lib/ai_stations/worker');
const {
  claimDelivery,
  createNotification,
  finishDelivery,
} = require('../lib/crm_notifications');

function stationOutput(station, evidenceIds = []) {
  if (station === 'sales_pack') {
    return {
      version: 'v1',
      summary: '客户已认领，存在经 CRM 验证的采购线索。',
      entryPoints: ['由销售人工复核后发送首次触达邮件。'],
      risks: ['发送前确认联系人和当前采购窗口。'],
      draft: {
        channel: 'email',
        subject: 'Component sourcing support',
        body: 'Hello, please review our component sourcing support.',
      },
      evidenceIds,
      confidence: 0.86,
      reviewRequired: true,
    };
  }
  return {
    version: 'v1',
    nextAction: '确认 BOM 明细并安排技术评审',
    nextActionAt: '2026-07-29 09:00:00',
    managerRequired: false,
    reason: '客户已由销售人工触达，应在承诺窗口内确认需求。',
    missingFields: [],
    evidenceIds,
    confidence: 0.88,
    reviewRequired: true,
  };
}

async function fixture() {
  const fx = await fixtures.seededFixture({
    appOptions: {
      salesCrm: {
        aiStationsEnabled: true,
        salesPackEnabled: true,
      },
    },
  });
  fx.setUserPermissions('U-OTHER', {
    use_ai_assistant: true,
    view_customers: true,
    view_contacts: true,
    view_recon: true,
    record_activity: true,
    record_quote: true,
    record_order: true,
    review_ai_tasks: true,
  });
  fx.db.prepare("INSERT INTO customer_pool(customer_id,company_name) VALUES ('BR-9004','Intake Other')").run();
  fx.otherCookie = await fx.login('other@example.com', 'Password123!');
  return fx;
}

function createWorker(fx, workerId) {
  return createAIStationWorker({
    workerId,
    openDb: () => new Database(fx.dbPath),
    executorOptions: {
      modelCall: async (messages, options) => {
        const input = JSON.parse(messages[1].content);
        return {
          answer: JSON.stringify(stationOutput(
            options.station,
            input.evidence.map(item => item.id),
          )),
          engine: 'test',
          model: `${options.station}-a3-06`,
          usage: { inputTokens: 80, outputTokens: 60 },
          cost: 0,
        };
      },
    },
  });
}

test('A3-06 sales execution gate keeps one human-confirmed timeline through worker recovery', async t => {
  const fx = await fixture();
  t.after(() => fx.close());

  const claimPayload = {
    action: 'claim',
    itemId: 'INTAKE-OTHER',
    idempotencyKey: 'a3-06-claim',
  };
  const claimed = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: claimPayload,
  });
  assert.equal(claimed.status, 200);
  const claim = await claimed.json();
  const customerId = claim.customerId;
  assert.match(customerId, /^CRM-/);
  assert.match(claim.salesPackJobId, /^AIJ-/);

  const replayedClaim = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: claimPayload,
  });
  assert.equal(replayedClaim.status, 200);
  assert.equal((await replayedClaim.json()).deduplicated, true);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_jobs
    WHERE station='sales_pack' AND event_type='customer_claimed' AND event_id='INTAKE-OTHER'`).get().count, 1);

  const jobsBeforeRestart = createAIJobStore(fx.db);
  const leased = jobsBeforeRestart.claimById(claim.salesPackJobId, 'worker-before-restart');
  assert.equal(leased.state, 'running');
  fx.db.prepare(`UPDATE crm_ai_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z'
    WHERE id=?`).run(claim.salesPackJobId);

  const recovered = await createWorker(fx, 'worker-after-restart').runOnce();
  assert.equal(recovered.status, 'succeeded');
  assert.equal(recovered.job.id, claim.salesPackJobId);
  assert.equal(recovered.job.attempts, 2);
  assert.ok(['succeeded', 'needs_review'].includes(recovered.job.state));
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_station_results WHERE job_id=?')
    .get(claim.salesPackJobId).count, 1);
  assert.deepEqual(fx.db.prepare(`SELECT code,status FROM crm_notifications
    WHERE dedupe_key=?`).get(`sales-pack:${claim.salesPackJobId}:ready`), {
    code: 'SALES_PACK_READY',
    status: 'unread',
  });
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_activities WHERE customer_id=?')
    .get(customerId).count, 0);

  const activityResponse = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      customerId,
      activityType: 'email',
      channel: 'email',
      outcome: '已人工发送',
      summary: '销售复核资料包后人工发送首次触达邮件。',
      nextAction: '等待客户回复',
      nextActionAt: '2026-07-28 09:00:00',
      occurredAt: '2026-07-25 10:00:00',
    },
  });
  assert.equal(activityResponse.status, 200);
  const activity = await activityResponse.json();
  assert.match(activity.nextActionJobId, /^AIJ-/);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_activities WHERE customer_id=?')
    .get(customerId).count, 1);

  const nextActionRun = await createWorker(fx, 'next-action-worker').runOnce();
  assert.equal(nextActionRun.status, 'succeeded');
  assert.equal(nextActionRun.job.id, activity.nextActionJobId);
  assert.equal(nextActionRun.job.state, 'needs_review');
  assert.equal(fx.db.prepare('SELECT next_action FROM crm_accounts WHERE id=?')
    .get(customerId).next_action, '等待客户回复');

  const adoptionPayload = {
    nextAction: '确认 BOM 明细并安排技术评审',
    nextActionAt: '2026-07-29 09:00:00',
    managerRequired: false,
  };
  const adopted = await fx.request(`/api/sales-crm/ai/jobs/${activity.nextActionJobId}/next-action/adopt`, {
    cookie: fx.otherCookie,
    method: 'POST',
    body: adoptionPayload,
  });
  assert.equal(adopted.status, 200);
  assert.equal((await adopted.json()).deduplicated, false);
  const repeatedAdoption = await fx.request(`/api/sales-crm/ai/jobs/${activity.nextActionJobId}/next-action/adopt`, {
    cookie: fx.otherCookie,
    method: 'POST',
    body: adoptionPayload,
  });
  assert.equal(repeatedAdoption.status, 200);
  assert.equal((await repeatedAdoption.json()).deduplicated, true);

  const rfqResponse = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      customerId,
      activityType: 'rfq',
      channel: 'email',
      outcome: '收到正式 BOM',
      summary: '客户人工确认进入询价阶段。',
      nextAction: '准备报价',
      nextActionAt: '2026-07-30 09:00:00',
      reference: 'RFQ-A3-06',
      bomLines: 18,
      expectedValue: 15000,
      productCategory: 'MCU',
      completeness: 92,
      occurredAt: '2026-07-25 11:00:00',
    },
  });
  assert.equal(rfqResponse.status, 200);
  const rfq = fx.db.prepare('SELECT * FROM crm_rfqs WHERE customer_id=?').get(customerId);
  assert.ok(rfq);

  const quotePayload = {
    customerId,
    rfqId: rfq.id,
    amount: 12800,
    currency: 'USD',
    grossMargin: 9,
    nextFollowAt: '2026-07-31 09:00:00',
    sentAt: '2026-07-25 12:00:00',
    idempotencyKey: 'a3-06-quote',
  };
  const quoteResponse = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: quotePayload,
  });
  assert.equal(quoteResponse.status, 200);
  const quote = await quoteResponse.json();
  const replayedQuote = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: quotePayload,
  });
  assert.equal(replayedQuote.status, 200);
  assert.equal((await replayedQuote.json()).deduplicated, true);

  const orderPayload = {
    customerId,
    quoteId: quote.quoteId,
    amount: 12800,
    currency: 'USD',
    grossMargin: 7,
    orderedAt: '2026-07-25 13:00:00',
    nextActionAt: '2026-08-08 09:00:00',
    idempotencyKey: 'a3-06-order',
  };
  const orderResponse = await fx.request('/api/sales-crm/orders', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: orderPayload,
  });
  assert.equal(orderResponse.status, 200);
  const replayedOrder = await fx.request('/api/sales-crm/orders', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: orderPayload,
  });
  assert.equal(replayedOrder.status, 200);
  assert.equal((await replayedOrder.json()).deduplicated, true);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_quotes WHERE customer_id=?')
    .get(customerId).count, 1);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_orders WHERE customer_id=?')
    .get(customerId).count, 1);

  const notification = createNotification(fx.db, {
    userId: 'U-OTHER',
    customerId,
    code: 'A3_06_WECOM_FAILURE',
    title: '企微降级验收',
    dedupeKey: 'a3-06:wecom-failure',
  }, { wecomEnabled: true, at: '2026-07-25T14:00:00.000Z' });
  const wecomDelivery = claimDelivery(fx.db, {
    channel: 'wecom',
    workerId: 'a3-06-notifier',
    at: '2026-07-25T14:00:01.000Z',
  });
  finishDelivery(fx.db, {
    deliveryId: wecomDelivery.id,
    workerId: 'a3-06-notifier',
    success: false,
    error: 'HTTP 503',
    at: '2026-07-25T14:00:02.000Z',
  });
  assert.equal(fx.db.prepare('SELECT status FROM crm_notifications WHERE id=?')
    .get(notification.id).status, 'unread');
  assert.equal(fx.db.prepare(`SELECT status FROM crm_notification_deliveries
    WHERE notification_id=? AND channel='web'`).get(notification.id).status, 'sent');
  assert.equal(fx.db.prepare(`SELECT status FROM crm_notification_deliveries
    WHERE notification_id=? AND channel='wecom'`).get(notification.id).status, 'failed');

  const bootstrapResponse = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  assert.equal(bootstrapResponse.status, 200);
  const bootstrap = await bootstrapResponse.json();
  const timeline = bootstrap.timeline.filter(event => event.customer_id === customerId);
  assert.deepEqual(
    [...new Set(timeline.map(event => event.kind))].sort(),
    ['activity', 'claim', 'next_action', 'order', 'quote', 'rfq', 'sales_pack'],
  );
  assert.ok(timeline.every(event => event.occurred_at));
  assert.equal(bootstrap.notifications.find(item => item.id === notification.id).web_delivery_status, 'sent');
});

test('customer drawer renders the unified timeline kinds returned by bootstrap', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  assert.match(app, /state\.data\.timeline/);
  assert.match(app, /data-timeline-kind=/);
  assert.doesNotMatch(app, /完整客户时间线[\s\S]{0,300}\$\{activities\.length\} 条记录/);
});
