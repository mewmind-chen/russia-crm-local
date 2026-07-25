'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createAIGovernanceStore, FEEDBACK_LABELS } = require('../lib/ai_stations/governance');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createAIResultStore } = require('../lib/ai_stations/results');
const fixtures = require('./helpers/permission_fixture');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE customer_pool (customer_id TEXT PRIMARY KEY);
    CREATE TABLE crm_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE crm_audit_log (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL
    );
    INSERT INTO customer_pool(customer_id) VALUES ('CUST-1');
    INSERT INTO crm_accounts(id) VALUES ('ACC-1');
  `);
  return db;
}

function ids() {
  let sequence = 0;
  return prefix => `${prefix}-${++sequence}`;
}

function seedResult(db, idFactory) {
  const jobs = createAIJobStore(db, { idFactory });
  const results = createAIResultStore(db, { idFactory });
  const job = jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    station: 'customer_fit',
    contextHash: 'context-v1',
    createdBy: 'U-MANAGER',
    payload: { ruleVersion: 'fit-rules-v3' },
  }, 'governance-job');
  jobs.claimById(job.id, 'worker');
  results.recordModelRun({
    jobId: job.id,
    attempt: 1,
    engine: 'qwen',
    model: 'qwen3.7-flash',
    status: 'succeeded',
    usage: { prompt_tokens: 10, completion_tokens: 4 },
    cost: 0.001,
    startedAt: '2026-07-25T00:00:00.000Z',
    finishedAt: '2026-07-25T00:00:01.000Z',
  }, 'governance-run');
  const result = results.saveResult({
    jobId: job.id,
    workerId: 'worker',
    contextHash: 'context-v1',
    value: {
      version: 'v1',
      confidence: 0.8,
      evidenceIds: ['EV-1'],
      reasonCodes: ['PRODUCT_MATCH'],
      fitScore: 80,
      grade: 'B',
      reviewRequired: false,
    },
    evidenceIds: ['EV-1'],
    metadata: {
      engine: 'qwen',
      model: 'qwen3.7-flash',
      promptVersion: 'fit-prompt-v2',
      schemaVersion: 'v1',
    },
  }, 'governance-result');
  return { job, result };
}

test('feedback labels persist Chinese outcomes and metrics compare model, prompt and rule versions', () => {
  const db = fixture();
  const idFactory = ids();
  const seeded = seedResult(db, idFactory);
  const governance = createAIGovernanceStore(db, {
    idFactory,
    now: () => new Date('2026-07-25T03:00:00.000Z'),
  });
  assert.deepEqual(FEEDBACK_LABELS, {
    won: '成交',
    replied: '回复',
    returned: '退回',
    stalled: '停滞',
    human_rejected: '人工驳回',
  });
  const won = governance.feedback({
    jobId: seeded.job.id,
    label: 'won',
    actor: { id: 'U-MANAGER', role: 'manager' },
    idempotencyKey: 'feedback-won',
  });
  governance.feedback({
    jobId: seeded.job.id,
    label: 'replied',
    actor: { id: 'U-MANAGER', role: 'manager' },
    idempotencyKey: 'feedback-replied',
  });
  assert.equal(won.labelName, '成交');
  const metric = governance.metrics({ customerIds: new Set(['CUST-1']) })[0];
  assert.deepEqual({
    station: metric.station,
    model: metric.model,
    promptVersion: metric.promptVersion,
    ruleVersion: metric.ruleVersion,
    total: metric.total,
    won: metric.labels.won,
    replied: metric.labels.replied,
  }, {
    station: 'customer_fit',
    model: 'qwen3.7-flash',
    promptVersion: 'fit-prompt-v2',
    ruleVersion: 'fit-rules-v3',
    total: 2,
    won: 1,
    replied: 1,
  });
  assert.equal(governance.metrics({ customerIds: new Set(['CUST-HIDDEN']) }).length, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE action='ai_feedback_recorded'`).get().count, 2);
  db.close();
});

test('strategies must run in shadow, require a human approval, and retain rollback versions', () => {
  const db = fixture();
  const idFactory = ids();
  const governance = createAIGovernanceStore(db, {
    idFactory,
    now: () => new Date('2026-07-25T03:00:00.000Z'),
  });
  const manager = { id: 'U-MANAGER', role: 'manager' };
  const admin = { id: 'U-ADMIN', role: 'admin' };
  const first = governance.createShadow({
    actor: manager,
    strategyKey: 'customer-fit-default',
    version: '2026.07.1',
    station: 'customer_fit',
    model: 'qwen3.7-flash',
    promptVersion: 'v2',
    ruleVersion: 'v3',
    config: { threshold: 0.7 },
  });
  assert.equal(first.status, 'shadow');
  assert.throws(() => governance.requestPublish({
    actor: manager,
    strategyVersionId: first.id,
  }), error => error.code === 'AI_STRATEGY_SHADOW_REQUIRED');
  governance.recordShadowEvaluation({
    actor: manager,
    strategyVersionId: first.id,
    outcome: 'better',
    metrics: { replyRateDelta: 0.08 },
  });
  assert.equal(governance.requestPublish({ actor: manager, strategyVersionId: first.id }).status, 'pending_approval');
  assert.equal(governance.approve({ actor: admin, strategyVersionId: first.id }).status, 'published');

  const second = governance.createShadow({
    actor: manager,
    strategyKey: 'customer-fit-default',
    version: '2026.07.2',
    station: 'customer_fit',
    model: 'qwen3.7-flash',
    promptVersion: 'v3',
    ruleVersion: 'v4',
    config: { threshold: 0.75 },
  });
  governance.recordShadowEvaluation({
    actor: manager,
    strategyVersionId: second.id,
    outcome: 'same',
    metrics: {},
  });
  governance.requestPublish({ actor: manager, strategyVersionId: second.id });
  const published = governance.approve({ actor: admin, strategyVersionId: second.id });
  assert.equal(published.status, 'published');
  assert.equal(published.supersedesId, first.id);
  assert.equal(governance.strategy(first.id).status, 'retired');
  assert.deepEqual(governance.strategy(first.id).config, { threshold: 0.7 });

  assert.equal(governance.rollback({ actor: admin, strategyVersionId: first.id }).status, 'published');
  assert.equal(governance.strategy(second.id).status, 'retired');
  assert.throws(() => governance.createShadow({
    actor: { id: 'MODEL', role: 'assistant' },
    strategyKey: 'forbidden',
    version: 'v1',
    station: 'customer_fit',
    model: 'qwen',
    promptVersion: 'v1',
    ruleVersion: 'v1',
    config: {},
  }), error => error.code === 'AI_GOVERNANCE_FORBIDDEN');
  db.close();
});

test('governance API and every strategy write are restricted to administrators', async t => {
  const fx = await fixtures.adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  t.after(() => fx.close());
  const managerView = await fx.request('/api/sales-crm/ai/governance', { cookie: fx.cookie });
  assert.equal(managerView.status, 403);
  assert.equal((await fx.request('/api/sales-crm/ai/governance', { cookie: fx.otherCookie })).status, 403);
  const adminView = await fx.request('/api/sales-crm/ai/governance', { cookie: fx.adminCookie });
  assert.equal(adminView.status, 200);
  assert.deepEqual((await adminView.json()).feedbackLabels, FEEDBACK_LABELS);

  const created = await fx.request('/api/sales-crm/ai/governance/strategies', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      strategyKey: 'api-customer-fit',
      version: 'v2',
      station: 'customer_fit',
      model: 'qwen3.7-flash',
      promptVersion: 'v2',
      ruleVersion: 'v2',
      config: { threshold: 0.7 },
    },
  });
  assert.equal(created.status, 200);
  const createdPayload = await created.json();
  assert.equal(createdPayload.strategy.status, 'shadow');
  const strategyId = createdPayload.strategy.id;
  const evaluated = await fx.request(
    `/api/sales-crm/ai/governance/strategies/${strategyId}/evaluations`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: { outcome: 'better', metrics: { replyRateDelta: 0.08 } },
    },
  );
  assert.equal(evaluated.status, 200);
  assert.equal((await evaluated.json()).strategy.evaluationCount, 1);
  const requested = await fx.request(
    `/api/sales-crm/ai/governance/strategies/${strategyId}/request-publish`,
    { cookie: fx.adminCookie, method: 'POST' },
  );
  assert.equal(requested.status, 200);
  assert.equal((await requested.json()).strategy.status, 'pending_approval');
  const approved = await fx.request(
    `/api/sales-crm/ai/governance/strategies/${strategyId}/approve`,
    { cookie: fx.adminCookie, method: 'POST' },
  );
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).strategy.status, 'published');
  assert.equal((await fx.request('/api/sales-crm/ai/governance/strategies', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      strategyKey: 'manager-forbidden',
      version: 'v1',
      station: 'customer_fit',
      model: 'qwen',
      promptVersion: 'v1',
      ruleVersion: 'v1',
      config: {},
    },
  })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/ai/governance/strategies', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      strategyKey: 'forbidden',
      version: 'v1',
      station: 'customer_fit',
      model: 'qwen',
      promptVersion: 'v1',
      ruleVersion: 'v1',
      config: {},
    },
  })).status, 403);
});
