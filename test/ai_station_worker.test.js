'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { ROLE_PERMISSIONS } = require('../lib/access_control');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createAIStationWorker } = require('../lib/ai_stations/worker');
const { featureState } = require('../lib/ai_stations/feature_flags');

const contextHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-ai-worker-'));
  const dbPath = path.join(dir, 'crm.db');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
      active INTEGER NOT NULL, permission_group_id TEXT NOT NULL, permissions_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE permission_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role_key TEXT NOT NULL, permissions_json TEXT NOT NULL
    );
    CREATE TABLE user_permission_overrides (
      user_id TEXT NOT NULL, permission_key TEXT NOT NULL, effect TEXT NOT NULL,
      PRIMARY KEY (user_id, permission_key)
    );
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY, external_customer_id TEXT, company_name TEXT NOT NULL DEFAULT '',
      owner_id TEXT, assignment_status TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare(`INSERT INTO permission_groups (id,name,role_key,permissions_json)
    VALUES ('PGRP-MANAGER','Scoped manager','manager',?)`).run(JSON.stringify({
    ...ROLE_PERMISSIONS.manager,
    view_all_customers: false,
  }));
  db.prepare(`INSERT INTO sales_users
    (id,email,name,role,active,permission_group_id) VALUES ('U-ACTOR','actor@example.test','Actor','manager',1,'PGRP-MANAGER')`).run();
  db.prepare(`INSERT INTO sales_users
    (id,email,name,role,active,permission_group_id) VALUES ('U-OTHER','other@example.test','Other','manager',1,'PGRP-MANAGER')`).run();
  db.prepare("INSERT INTO customer_pool (customer_id,company_name) VALUES ('CUST-1','Worker Fixture')").run();
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,assignment_status)
    VALUES ('ACC-1','CUST-1','Worker Fixture','U-ACTOR','claimed')`).run();
  let jobSequence = 0;
  const jobs = createAIJobStore(db, { idFactory: () => `AIJ-WORKER-${++jobSequence}`, retryBaseMs: 1 });

  function enqueue(overrides = {}) {
    return jobs.enqueue({
      customerId: 'CUST-1',
      crmAccountId: 'ACC-1',
      station: 'customer_fit',
      contextHash,
      createdBy: 'U-ACTOR',
      ...overrides,
    }, overrides.idempotencyKey || 'worker:CUST-1:customer-fit:v1');
  }

  function openDb() {
    const connection = new Database(dbPath);
    connection.pragma('foreign_keys = ON');
    return connection;
  }

  function close() {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return { db, dbPath, jobs, enqueue, openDb, close };
}

function successfulExecutor(observe = () => {}) {
  return async ({ results, jobId, workerId, actor, accessContext }) => {
    await new Promise(resolve => setImmediate(resolve));
    observe({ jobId, workerId, actor, accessContext });
    const result = results.saveResult({
      jobId,
      workerId,
      contextHash,
      value: {
        version: 'v1',
        confidence: 0.8,
        evidenceIds: [],
        reasonCodes: ['PRODUCT_MATCH'],
        fitScore: 80,
        grade: 'A',
        reviewRequired: false,
      },
      evidenceIds: [],
      metadata: {
        engine: 'test',
        model: 'worker-fixture',
        promptVersion: 'v1',
        schemaVersion: 'v1',
      },
    }, `${jobId}:result`);
    return { result };
  };
}

test('worker asynchronously claims a queued job and executes it with a freshly hydrated actor', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const queued = fx.enqueue();
  let observed;
  const worker = createAIStationWorker({
    workerId: 'worker-success',
    openDb: fx.openDb,
    executeCustomerFitJob: successfulExecutor(value => { observed = value; }),
  });

  assert.equal(fx.jobs.getJob(queued.id).state, 'queued');
  assert.equal(observed, undefined);
  const outcome = await worker.runOnce();

  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.job.state, 'succeeded');
  assert.equal(outcome.job.attempts, 1);
  assert.equal(observed.actor.id, 'U-ACTOR');
  assert.equal(observed.actor.permissions.includes('use_ai_assistant'), true);
  assert.equal(observed.accessContext.externalCustomerIds.has('CUST-1'), true);
  assert.equal(fx.jobs.getJob(queued.id).state, 'succeeded');
});

test('worker does not claim queued jobs after the runtime AI station switch is disabled', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const queued = fx.enqueue();
  const hardFlags = { ai_stations: true };
  featureState(fx.db, hardFlags);
  fx.db.prepare("UPDATE crm_ai_feature_flags SET enabled=0 WHERE feature_key='ai_stations'").run();
  const worker = createAIStationWorker({
    workerId: 'worker-runtime-disabled',
    openDb: fx.openDb,
    isWorkerEnabled: ({ db }) => featureState(db, hardFlags).ai_stations.effectiveEnabled,
    beforeClaim: async () => assert.fail('disabled worker must not dispatch prerequisite work'),
    executeCustomerFitJob: async () => assert.fail('disabled worker must not execute a job'),
  });

  const outcome = await worker.runOnce();

  assert.equal(outcome.status, 'idle');
  assert.equal(outcome.disabled, true);
  assert.equal(fx.jobs.getJob(queued.id).state, 'queued');
  assert.equal(fx.jobs.getJob(queued.id).attempts, 0);
});

test('worker blocks a claimed job when the actor AI permission was revoked after enqueue', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const queued = fx.enqueue();
  fx.db.prepare(`INSERT INTO user_permission_overrides (user_id,permission_key,effect)
    VALUES ('U-ACTOR','use_ai_assistant','deny')`).run();
  let executed = false;
  const worker = createAIStationWorker({
    workerId: 'worker-permission-block',
    openDb: fx.openDb,
    executeCustomerFitJob: async () => { executed = true; },
  });

  const outcome = await worker.runOnce();

  assert.equal(executed, false);
  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.job.state, 'blocked');
  assert.equal(outcome.job.baseState, 'queued');
  assert.equal(outcome.job.blockedKind, 'policy');
  assert.match(outcome.job.blockedReason, /no longer has use_ai_assistant/);
  assert.equal(outcome.job.leaseOwner, '');
  assert.equal(fx.jobs.getJob(queued.id).state, 'blocked');
});

test('worker does not auto-release a policy block after DAG dependencies are satisfied', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const root = fx.enqueue({ idempotencyKey: 'worker:dag:root' });
  const successfulWorker = createAIStationWorker({
    workerId: 'worker-dag-root',
    openDb: fx.openDb,
    executeCustomerFitJob: successfulExecutor(),
  });
  assert.equal((await successfulWorker.runOnce()).status, 'succeeded');
  const child = fx.enqueue({
    idempotencyKey: 'worker:dag:child',
    dependsOn: [root.id],
    parentJobId: root.id,
  });
  fx.db.prepare(`INSERT INTO user_permission_overrides (user_id,permission_key,effect)
    VALUES ('U-ACTOR','use_ai_assistant','deny')`).run();
  const blockedWorker = createAIStationWorker({
    workerId: 'worker-dag-policy-block',
    openDb: fx.openDb,
    executeCustomerFitJob: async () => assert.fail('policy-blocked job must not execute'),
  });

  const outcome = await blockedWorker.runOnce();

  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.job.id, child.id);
  assert.equal(outcome.job.blockedKind, 'policy');
  assert.equal(fx.jobs.getJob(child.id).state, 'blocked');
  assert.equal(fx.jobs.claimNext('worker-must-stay-blocked'), null);
  assert.equal(fx.jobs.getJob(child.id).attempts, 1);
});

test('worker blocks a claimed job when the customer left the actor scope after enqueue', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const queued = fx.enqueue();
  fx.db.prepare("UPDATE crm_accounts SET owner_id='U-OTHER' WHERE id='ACC-1'").run();
  let executed = false;
  const worker = createAIStationWorker({
    workerId: 'worker-scope-block',
    openDb: fx.openDb,
    executeCustomerFitJob: async () => { executed = true; },
  });

  const outcome = await worker.runOnce();

  assert.equal(executed, false);
  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.job.state, 'blocked');
  assert.match(outcome.job.blockedReason, /无权访问该客户/);
  assert.equal(fx.jobs.getJob(queued.id).state, 'blocked');
});

test('worker records executor failures as retryable job failures', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const queued = fx.enqueue();
  const worker = createAIStationWorker({
    workerId: 'worker-failure',
    openDb: fx.openDb,
    executeCustomerFitJob: async () => { throw new Error('model request failed'); },
  });

  const outcome = await worker.runOnce();

  assert.equal(outcome.status, 'failed');
  assert.match(outcome.error.message, /model request failed/);
  assert.equal(outcome.job.state, 'retry_wait');
  assert.equal(outcome.job.attempts, 1);
  assert.match(outcome.job.errorSummary, /model request failed/);
  assert.equal(outcome.job.leaseOwner, '');
  assert.equal(fx.jobs.getJob(queued.id).state, 'retry_wait');
});

test('worker turns a 100 percent budget rejection into a durable policy block without calling a model', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const queued = fx.enqueue();
  let modelCalled = false;
  const worker = createAIStationWorker({
    workerId: 'worker-budget-block',
    openDb: fx.openDb,
    budgetPolicies: [{
      scopeType: 'user',
      scopeId: 'U-ACTOR',
      dailyLimit: 0.05,
    }],
    executeCustomerFitJob: async ({ budgets, jobId, actor }) => {
      budgets.reserve({
        jobId,
        attempt: 1,
        actorId: actor.id,
        station: 'customer_fit',
        estimatedCost: 0.05,
      });
      modelCalled = true;
    },
  });

  const outcome = await worker.runOnce();

  assert.equal(modelCalled, false);
  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.error.code, 'AI_BUDGET_EXHAUSTED');
  assert.equal(outcome.job.id, queued.id);
  assert.equal(outcome.job.state, 'blocked');
  assert.equal(outcome.job.blockedKind, 'policy');
  assert.match(outcome.job.blockedReason, /AI budget exhausted/);
  assert.equal(outcome.job.leaseOwner, '');
});

test('worker completes a cancellation requested while the executor is running', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const queued = fx.enqueue();
  let executionStarted;
  const started = new Promise(resolve => { executionStarted = resolve; });
  let stopExecution;
  const stopped = new Promise((resolve, reject) => { stopExecution = () => reject(new Error('execution aborted')); });
  const worker = createAIStationWorker({
    workerId: 'worker-cancel',
    openDb: fx.openDb,
    executeCustomerFitJob: async () => {
      executionStarted();
      return stopped;
    },
  });

  const running = worker.runOnce();
  await started;
  assert.equal(fx.jobs.getJob(queued.id).state, 'running');
  const requested = fx.jobs.requestCancel(queued.id);
  assert.equal(requested.state, 'cancel_requested');
  stopExecution();
  const outcome = await running;

  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.job.state, 'cancelled');
  assert.equal(outcome.job.baseState, 'running');
  assert.notEqual(outcome.job.cancelRequestedAt, '');
  assert.notEqual(outcome.job.cancelledAt, '');
  assert.equal(outcome.job.leaseOwner, '');
  assert.equal(fx.jobs.getJob(queued.id).state, 'cancelled');
});

test('worker completes cancellation racing with execution-time authorization', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const queued = fx.enqueue();
  fx.db.prepare(`INSERT INTO user_permission_overrides (user_id,permission_key,effect)
    VALUES ('U-ACTOR','use_ai_assistant','deny')`).run();
  let executed = false;
  const worker = createAIStationWorker({
    workerId: 'worker-cancel-authorization-race',
    openDb: fx.openDb,
    beforeExecutionIdentity: () => fx.jobs.requestCancel(queued.id),
    executeCustomerFitJob: async () => { executed = true; },
  });

  const outcome = await worker.runOnce();

  assert.equal(executed, false);
  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.job.state, 'cancelled');
  assert.equal(outcome.job.leaseOwner, '');
  assert.equal(fx.jobs.getJob(queued.id).state, 'cancelled');
});

for (const failure of [
  { name: 'engine 429', code: 'DEEPSEEK_HTTP_ERROR', statusCode: 429 },
  { name: 'engine timeout', code: 'DEEPSEEK_TIMEOUT', statusCode: 504 },
]) {
  test(`worker releases persistent execution claims after ${failure.name}`, async t => {
    const fx = fixture();
    t.after(() => fx.close());
    const queued = fx.enqueue();
    const error = Object.assign(new Error(failure.name), failure);
    const worker = createAIStationWorker({
      workerId: `worker-${failure.statusCode}`,
      openDb: fx.openDb,
      jobStoreOptions: {
        executionResources: {
          global: { maxConcurrency: 2, rateLimit: 0, rateWindowMs: 60_000 },
          deepseek: { maxConcurrency: 1, rateLimit: 0, rateWindowMs: 60_000 },
        },
      },
      executeCustomerFitJob: async ({ jobs, jobId, workerId }) => {
        const claim = jobs.acquireResource('deepseek', jobId, workerId);
        assert.equal(claim.acquired, true);
        throw error;
      },
    });

    const outcome = await worker.runOnce();

    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.job.id, queued.id);
    assert.equal(outcome.job.state, 'retry_wait');
    assert.equal(outcome.job.errorSummary, failure.name);
    assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_resource_slots').get().count, 0);
    assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_customer_locks').get().count, 0);
  });
}
