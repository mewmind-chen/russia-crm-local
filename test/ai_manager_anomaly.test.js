'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const { buildManagerAnomalies } = require('../lib/ai_stations/manager_anomaly');
const { validateStationOutput } = require('../lib/ai_stations/contracts');
const { createAIStationWorker } = require('../lib/ai_stations/worker');

const NOW = new Date('2026-07-25T12:00:00.000Z');

function account(id, ownerId, overrides = {}) {
  return {
    id,
    external_customer_id: `RU-${id}`,
    company_name: `客户 ${id}`,
    owner_id: ownerId,
    stage: 'qualified',
    priority: 'B',
    potential_value: 10000,
    last_activity_at: '2026-07-24 12:00:00',
    created_at: '2026-07-01 00:00:00',
    lifecycle_status: 'active',
    assignment_status: 'claimed',
    ...overrides,
  };
}

function aiOutput(anomaly, evidenceIds = []) {
  return {
    version: 'v1',
    anomalyId: anomaly.id,
    anomalyCode: anomaly.code,
    customerId: anomaly.customerId,
    severity: anomaly.severity,
    priorityScore: anomaly.severity === 'critical' ? 95 : 70,
    explanation: '该异常已超过规则时限，可能影响当前客户转化。',
    interventionSuggestion: '请经理先与负责人确认阻塞点，再决定是否陪同推进。',
    evidenceIds,
    confidence: 0.9,
    reviewRequired: true,
  };
}

test('manager anomaly scan covers all five deterministic rule types', () => {
  const users = [
    { id: 'U-A', name: '销售甲', role: 'sales', active: 1 },
    { id: 'U-B', name: '销售乙', role: 'sales', active: 1 },
  ];
  const accounts = [
    account('MEETING', 'U-A', { stage: 'meeting', last_activity_at: '2026-07-10 09:00:00' }),
    account('RFQ', 'U-A'),
    account('QUOTE', 'U-A', { stage: 'quoted', last_activity_at: '2026-07-20 09:00:00' }),
    account('VALUE', 'U-A', {
      priority: 'A', potential_value: 120000, last_activity_at: '2026-07-15 09:00:00',
    }),
    account('LOAD-1', 'U-A'),
    account('LOAD-2', 'U-A'),
    account('LIGHT', 'U-B'),
  ];
  const activities = [{
    id: 'ACT-MEETING', customer_id: 'MEETING', activity_type: 'meeting',
    occurred_at: '2026-07-10 09:00:00',
  }];
  const rfqs = [{
    id: 'RFQ-1', customer_id: 'RFQ', received_at: '2026-07-23 08:00:00',
    quoted_at: '', bom_lines: 25,
  }];
  const quotes = [{
    id: 'QUOTE-1', customer_id: 'QUOTE', sent_at: '2026-07-21 08:00:00',
    status: 'sent', amount: 20000,
  }];

  const anomalies = buildManagerAnomalies({ users, accounts, activities, rfqs, quotes, now: NOW });
  const codes = new Set(anomalies.map(item => item.code));
  assert.deepEqual(
    [...codes].sort(),
    ['HIGH_VALUE_STALE', 'MEETING_NO_RFQ', 'QUOTE_IDLE', 'RFQ_UNQUOTED', 'WORKLOAD_IMBALANCE'].sort(),
  );
  assert.equal(anomalies.every(item => item.customerId && item.externalCustomerId), true);
});

test('manager anomaly contract rejects invented anomaly, customer, evidence, and non-Chinese advice', () => {
  const anomaly = {
    id: 'MANAGER-MEETING_NO_RFQ-CRM-1',
    code: 'MEETING_NO_RFQ',
    customerId: 'CRM-1',
    severity: 'critical',
  };
  const context = {
    evidenceIds: ['MAE-0001'],
    anomalyIds: [anomaly.id],
    anomalyCodes: [anomaly.code],
    customerIds: [anomaly.customerId],
  };
  assert.equal(validateStationOutput('manager_anomaly', 'v1', aiOutput(anomaly, ['MAE-0001']), context).ok, true);
  assert.equal(validateStationOutput('manager_anomaly', 'v1', aiOutput({
    ...anomaly, id: 'INVENTED',
  }, ['MAE-0001']), context).ok, false);
  assert.equal(validateStationOutput('manager_anomaly', 'v1', aiOutput({
    ...anomaly, customerId: 'CRM-INVENTED',
  }, ['MAE-0001']), context).ok, false);
  assert.equal(validateStationOutput('manager_anomaly', 'v1', aiOutput(anomaly, ['MAE-INVENTED']), context).ok, false);
  assert.equal(validateStationOutput('manager_anomaly', 'v1', {
    ...aiOutput(anomaly, ['MAE-0001']),
    explanation: 'Customer has stalled after the meeting.',
  }, context).ok, false);
});

async function fixture() {
  return fixtures.seededFixture({
    permissions: {
      use_ai_assistant: true,
      view_alerts: true,
      view_team: true,
      view_customers: true,
      view_contacts: true,
      review_ai_tasks: true,
    },
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
}

test('manager scope enqueues idempotent review-only jobs while sales is denied', async t => {
  const fx = await fixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET stage='meeting',priority='A',potential_value=100000,
    last_activity_at='2026-06-01 00:00:00',updated_at='2026-06-01 00:00:00'
    WHERE id='CRM-OWN'`).run();

  const before = fx.db.prepare(`SELECT stage,potential_value,last_activity_at,next_action
    FROM crm_accounts WHERE id='CRM-OWN'`).get();
  const first = await fx.request('/api/sales-crm/ai/manager-anomalies/run', {
    cookie: fx.cookie, method: 'POST', body: {},
  });
  assert.equal(first.status, 202);
  const firstBody = await first.json();
  assert.ok(firstBody.jobs.length >= 2);
  assert.equal(firstBody.jobs.every(job => job.station === 'manager_anomaly'), true);

  const repeated = await fx.request('/api/sales-crm/ai/manager-anomalies/run', {
    cookie: fx.cookie, method: 'POST', body: {},
  });
  assert.equal(repeated.status, 202);
  assert.deepEqual(
    (await repeated.json()).jobs.map(job => job.id).sort(),
    firstBody.jobs.map(job => job.id).sort(),
  );

  const salesCookie = await fx.login('other@example.com', 'Password123!');
  const denied = await fx.request('/api/sales-crm/ai/manager-anomalies', { cookie: salesCookie });
  assert.equal(denied.status, 403);
  const hiddenTasks = await fx.request('/api/sales-crm/ai/tasks?type=manager_anomaly', {
    cookie: salesCookie,
  });
  assert.equal(hiddenTasks.status, 200);
  assert.equal((await hiddenTasks.json()).total, 0);
  const hiddenDetail = await fx.request(`/api/sales-crm/ai/tasks/${firstBody.jobs[0].id}`, {
    cookie: salesCookie,
  });
  assert.equal(hiddenDetail.status, 404);

  const workerOptions = {
    workerId: 'manager-anomaly-worker',
    openDb: () => new Database(fx.dbPath),
    executorOptions: {
      modelCall: async messages => {
        const input = JSON.parse(messages[1].content);
        return {
          answer: JSON.stringify(aiOutput(
            input.trustedCrmContext.anomaly,
            input.evidence.map(item => item.id),
          )),
          engine: 'test',
          model: 'manager-anomaly-fixture',
          cost: 0,
        };
      },
    },
  };
  let worker = createAIStationWorker(workerOptions);
  const firstRun = await worker.runOnce();
  assert.equal(firstRun.status, 'succeeded', firstRun.error?.stack || firstRun.job?.errorSummary);
  worker = createAIStationWorker({ ...workerOptions, workerId: 'manager-anomaly-worker-restarted' });
  for (let index = 1; index < firstBody.jobs.length; index += 1) {
    const run = await worker.runOnce();
    assert.equal(run.status, 'succeeded', run.error?.stack || run.job?.errorSummary);
  }

  const listed = await fx.request('/api/sales-crm/ai/manager-anomalies', { cookie: fx.cookie });
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  assert.ok(listedBody.anomalies.some(item => item.ai?.result?.value?.explanation.includes('异常')));
  assert.equal(listedBody.anomalies.every(item => item.ai?.result?.value?.reviewRequired === true), true);
  assert.deepEqual(
    fx.db.prepare(`SELECT stage,potential_value,last_activity_at,next_action
      FROM crm_accounts WHERE id='CRM-OWN'`).get(),
    before,
  );
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_activities').get().count, 0);
});

test('manager anomaly UI remains manager-gated and exposes explicit AI scan control', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  assert.match(html, /id="runManagerAnomaly"/);
  assert.match(html, /data-permission="view_team"/);
  assert.match(app, /manager-anomalies\/run/);
  assert.match(app, /AI建议仅供经理复核/);
  assert.doesNotMatch(app, /autoIntervene|autoWriteManagerAction/);
});
