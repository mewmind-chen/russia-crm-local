'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createAIGovernanceStore } = require('../lib/ai_stations/governance');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { getStation } = require('../lib/ai_stations/prompt_registry');
const { stationModel } = require('../lib/ai_stations/model_policy');
const fixtures = require('./helpers/permission_fixture');

function enqueue(jobs, idFactory, input, key) {
  idFactory.next = input.id;
  return jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: input.customerId,
    crmAccountId: input.crmAccountId,
    station: input.station || 'customer_fit',
    contextHash: input.contextHash || `${input.id}-context`,
    createdBy: input.createdBy,
    payload: input.payload || {},
  }, key);
}

test('A4-04 manager metrics are limited to authorized customers and sales has no team surfaces', async t => {
  const fx = await fixtures.adminFixture({
    managerViewAll: false,
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  t.after(() => fx.close());
  const idFactory = prefix => idFactory.next || `${prefix}-A4-04`;
  const jobs = createAIJobStore(fx.db, { idFactory });
  const own = enqueue(jobs, idFactory, {
    id: 'AIJ-A4-04-OWN',
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    createdBy: 'U-MGR',
    payload: { promptVersion: 'prompt-v1', ruleVersion: 'rules-v1' },
  }, 'a4-04:own');
  const other = enqueue(jobs, idFactory, {
    id: 'AIJ-A4-04-OTHER',
    customerId: 'RU-9003',
    crmAccountId: 'CRM-OTHER',
    createdBy: 'U-OTHER',
    payload: { promptVersion: 'prompt-secret', ruleVersion: 'rules-secret' },
  }, 'a4-04:other');
  let governanceId = 0;
  const governance = createAIGovernanceStore(fx.db, {
    idFactory: prefix => `${prefix}-A4-04-${++governanceId}`,
  });
  governance.feedback({
    jobId: own.id, label: 'replied', idempotencyKey: 'a4-04:feedback:own',
    actor: { id: 'U-MGR', role: 'manager' },
  });
  governance.feedback({
    jobId: other.id, label: 'won', idempotencyKey: 'a4-04:feedback:other',
    actor: { id: 'USR-ADMIN', role: 'admin' },
  });

  const manager = await fx.request('/api/sales-crm/ai/governance', { cookie: fx.cookie });
  assert.equal(manager.status, 200);
  const managerBody = await manager.json();
  assert.equal(managerBody.metrics.length, 1);
  assert.equal(managerBody.metrics[0].promptVersion, 'prompt-v1');
  assert.equal(managerBody.metrics[0].ruleVersion, 'rules-v1');
  assert.doesNotMatch(JSON.stringify(managerBody), /prompt-secret|rules-secret/);

  assert.equal((await fx.request('/api/sales-crm/ai/governance', { cookie: fx.otherCookie })).status, 403);
  const salesBootstrap = await (await fx.request('/api/sales-crm/bootstrap', { cookie: fx.otherCookie })).json();
  assert.deepEqual(salesBootstrap.teamReport, []);

  const managerAnomaly = enqueue(jobs, idFactory, {
    id: 'AIJ-A4-04-ANOMALY',
    customerId: 'RU-9003',
    crmAccountId: 'CRM-OTHER',
    station: 'manager_anomaly',
    createdBy: 'U-OTHER',
  }, 'a4-04:manager-anomaly');
  assert.equal((await fx.request(`/api/sales-crm/ai/tasks/${managerAnomaly.id}`, {
    cookie: fx.otherCookie,
  })).status, 404);
  const salesTasks = await (await fx.request('/api/sales-crm/ai/tasks', { cookie: fx.otherCookie })).json();
  assert.equal(salesTasks.items.some(item => item.taskType === 'manager_anomaly'), false);
});

test('A4-04 governance versions remain offline and cannot alter runtime station or model policy', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE customer_pool (customer_id TEXT PRIMARY KEY);
    CREATE TABLE crm_accounts (id TEXT PRIMARY KEY);
    INSERT INTO customer_pool(customer_id) VALUES ('CUST-1');
    INSERT INTO crm_accounts(id) VALUES ('ACC-1');
  `);
  const stationBefore = getStation('customer_fit');
  const modelBefore = stationModel('customer_fit', {}, {});
  const governance = createAIGovernanceStore(db, {
    idFactory: (() => {
      let index = 0;
      return prefix => `${prefix}-${++index}`;
    })(),
  });
  const actor = { id: 'U-MANAGER', role: 'manager' };
  const shadow = governance.createShadow({
    actor,
    strategyKey: 'customer-fit-default',
    version: 'offline-v2',
    station: 'customer_fit',
    model: 'untrusted-online-model',
    promptVersion: 'untrusted-prompt-v2',
    ruleVersion: 'untrusted-rules-v2',
    config: { threshold: 0.99, systemPolicy: 'must never become an online prompt' },
  });
  governance.recordShadowEvaluation({
    actor, strategyVersionId: shadow.id, outcome: 'better', metrics: { replyRateDelta: 1 },
  });
  governance.requestPublish({ actor, strategyVersionId: shadow.id });
  governance.approve({ actor: { id: 'USR-ADMIN', role: 'admin' }, strategyVersionId: shadow.id });

  assert.strictEqual(getStation('customer_fit'), stationBefore);
  assert.equal(getStation('customer_fit').version, 'v1');
  assert.equal(stationModel('customer_fit', {}, {}), modelBefore);
  assert.notEqual(stationModel('customer_fit', {}, {}), 'untrusted-online-model');
  db.close();
});

test('A4-04 old and new model, prompt and rule metrics remain independently comparable', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE customer_pool (customer_id TEXT PRIMARY KEY);
    CREATE TABLE crm_accounts (id TEXT PRIMARY KEY);
    INSERT INTO customer_pool(customer_id) VALUES ('CUST-1');
    INSERT INTO crm_accounts(id) VALUES ('ACC-1');
  `);
  const jobs = createAIJobStore(db, {
    idFactory: (() => {
      let index = 0;
      return () => `AIJ-METRIC-${++index}`;
    })(),
  });
  const oldJob = jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: 'CUST-1', crmAccountId: 'ACC-1', station: 'customer_fit',
    contextHash: 'context-old', payload: { promptVersion: 'prompt-v1', ruleVersion: 'rules-v1' },
  }, 'metric:old');
  const newJob = jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: 'CUST-1', crmAccountId: 'ACC-1', station: 'customer_fit',
    contextHash: 'context-new', payload: { promptVersion: 'prompt-v2', ruleVersion: 'rules-v2' },
  }, 'metric:new');
  db.prepare(`INSERT INTO crm_ai_model_runs
    (id,job_id,attempt,station,engine,model,status,duration_ms,usage_json,cost,error_summary,
     idempotency_key,started_at,finished_at)
    VALUES
    ('RUN-OLD',?,1,'customer_fit','qwen','model-v1','succeeded',1,'{}',0,'','run:old',?,?),
    ('RUN-NEW',?,1,'customer_fit','qwen','model-v2','succeeded',1,'{}',0,'','run:new',?,?)`)
    .run(oldJob.id, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:01.000Z',
      newJob.id, '2026-07-02T00:00:00.000Z', '2026-07-02T00:00:01.000Z');
  const governance = createAIGovernanceStore(db);
  governance.feedback({
    jobId: oldJob.id, label: 'replied', idempotencyKey: 'feedback:old',
    actor: { id: 'U-MANAGER', role: 'manager' },
  });
  governance.feedback({
    jobId: newJob.id, label: 'won', idempotencyKey: 'feedback:new',
    actor: { id: 'U-MANAGER', role: 'manager' },
  });

  const metrics = governance.metrics({ customerIds: new Set(['CUST-1']) });
  assert.equal(metrics.length, 2);
  assert.deepEqual(new Set(metrics.map(item => item.model)), new Set(['model-v1', 'model-v2']));
  assert.deepEqual(new Set(metrics.map(item => item.promptVersion)), new Set(['prompt-v1', 'prompt-v2']));
  assert.deepEqual(new Set(metrics.map(item => item.ruleVersion)), new Set(['rules-v1', 'rules-v2']));
  assert.equal(metrics.find(item => item.model === 'model-v1').replyRate, 1);
  assert.equal(metrics.find(item => item.model === 'model-v2').winRate, 1);
  db.close();
});
