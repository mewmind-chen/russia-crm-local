'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const { buildCustomerContext } = require('../lib/ai_stations/context');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createAIStationWorker } = require('../lib/ai_stations/worker');

function successfulExecutor(calls) {
  return async input => {
    calls.push(input.jobId);
    const context = buildCustomerContext(input.db, input.accessContext, input.jobs.getJob(input.jobId).customerId);
    const result = input.results.saveResult({
      jobId: input.jobId,
      workerId: input.workerId,
      contextHash: context.contextHash,
      value: {
        version: 'v1', confidence: 0.91, evidenceIds: context.evidenceIds.slice(0, 2),
        reasonCodes: ['PRODUCT_MATCH'], fitScore: 89, grade: 'A', reviewRequired: false,
      },
      evidenceIds: context.evidenceIds,
      metadata: {
        engine: 'test-router', model: 'test-model', promptVersion: 'v1', schemaVersion: 'v1', usage: {}, cost: 0,
      },
    }, `test-result:${input.jobId}`);
    return { result };
  };
}

test('AI station APIs enforce login, permissions, row scope, idempotency and anonymous audit', async t => {
  const calls = [];
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { use_ai_assistant: true, view_customers: true },
    appOptions: { salesCrm: {} },
  });
  t.after(() => fx.close());

  assert.equal((await fx.request('/api/sales-crm/ai/customers/RU-9002/results')).status, 401);
  assert.equal((await fx.request('/api/sales-crm/ai/customers/RU-9003/results', { cookie: fx.cookie })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/ai/customers/RU-9003/stations/customer_fit/run', {
    cookie: fx.cookie, method: 'POST',
  })).status, 403);

  const run = await fx.request('/api/sales-crm/ai/customers/RU-9002/stations/customer_fit/run', {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(run.status, 202);
  const runBody = await run.json();
  assert.equal(runBody.job.state, 'queued');
  assert.equal(runBody.result, null);
  assert.equal(calls.length, 0);

  const pendingReplay = await fx.request('/api/sales-crm/ai/customers/RU-9002/stations/customer_fit/run', {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(pendingReplay.status, 202);
  assert.equal((await pendingReplay.json()).job.id, runBody.job.id);
  assert.deepEqual(fx.db.prepare(`SELECT status,charged_cost_micros,cost_source
    FROM crm_ai_usage_ledger WHERE job_id=?`).all(runBody.job.id), [{
    status: 'deduplicated',
    charged_cost_micros: 0,
    cost_source: 'not_billable',
  }]);

  const worker = createAIStationWorker({
    openDb: () => new Database(fx.dbPath),
    workerId: 'api-test-worker',
    executeCustomerFitJob: successfulExecutor(calls),
  });
  assert.equal((await worker.runOnce()).status, 'succeeded');
  assert.equal(calls.length, 1);

  const replay = await fx.request('/api/sales-crm/ai/customers/RU-9002/stations/customer_fit/run', {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).job.id, runBody.job.id);
  assert.equal(calls.length, 1);
  assert.deepEqual(fx.db.prepare(`SELECT status,charged_cost_micros,cost_source
    FROM crm_ai_usage_ledger WHERE job_id=? ORDER BY status`).all(runBody.job.id), [
    {
      status: 'cache_hit',
      charged_cost_micros: 0,
      cost_source: 'not_billable',
    },
    {
      status: 'deduplicated',
      charged_cost_micros: 0,
      cost_source: 'not_billable',
    },
  ]);

  const results = await fx.request('/api/sales-crm/ai/customers/RU-9002/results', { cookie: fx.cookie });
  assert.equal(results.status, 200);
  const resultBody = await results.json();
  assert.equal(resultBody.result.value.grade, 'A');
  assert.equal(resultBody.stale, false);
  assert.ok(resultBody.evidence.length > 0);

  await new Promise(resolve => setImmediate(resolve));
  const audit = fx.db.prepare("SELECT * FROM crm_audit_log WHERE entity_type='ai_station' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(audit.action, 'POST /ai/customers/:customerId/stations/customer_fit/run');
  assert.equal(audit.entity_id, '');
  assert.doesNotMatch(audit.detail_json, /RU-9002|AIJ-/);
});

test('AI execution requires use_ai_assistant and reading requires view_customers', async t => {
  const fx = await fixtures.seededFixture({
    permissions: { use_ai_assistant: false, view_customers: false },
    appOptions: { salesCrm: { executeCustomerFitJob: async () => assert.fail('executor must not run') } },
  });
  t.after(() => fx.close());
  assert.equal((await fx.request('/api/sales-crm/ai/customers/RU-9001/results', { cookie: fx.cookie })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/ai/customers/RU-9001/stations/customer_fit/run', {
    cookie: fx.cookie, method: 'POST',
  })).status, 403);
});

test('AI enqueue requires customer visibility even when use_ai_assistant is granted', async t => {
  const fx = await fixtures.seededFixture({
    permissions: { use_ai_assistant: true, view_customers: false },
  });
  t.after(() => fx.close());
  assert.equal((await fx.request('/api/sales-crm/ai/customers/RU-9001/stations/customer_fit/run', {
    cookie: fx.cookie, method: 'POST',
  })).status, 403);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='crm_ai_jobs'").get().count, 0);
});

test('retry is scope checked, revives dead letters and rejects a completed job', async t => {
  let attempts = 0;
  const calls = [];
  const executor = async input => {
    attempts += 1;
    if (attempts === 1) {
      input.db.prepare('UPDATE crm_ai_jobs SET max_attempts=1 WHERE id=?').run(input.jobId);
      input.jobs.fail(input.jobId, input.workerId, new Error('temporary model failure'));
      throw new Error('temporary model failure');
    }
    return successfulExecutor(calls)(input);
  };
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { use_ai_assistant: true },
    appOptions: { salesCrm: { executeCustomerFitJob: executor } },
  });
  t.after(() => fx.close());

  const run = await fx.request('/api/sales-crm/ai/customers/RU-9002/stations/customer_fit/run', {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(run.status, 202);
  const queued = await run.json();
  const worker = createAIStationWorker({
    openDb: () => new Database(fx.dbPath),
    workerId: 'retry-test-worker',
    executeCustomerFitJob: executor,
  });
  assert.equal((await worker.runOnce()).status, 'failed');
  const failed = createAIJobStore(fx.db).getJob(queued.job.id);
  assert.equal(failed.state, 'dead_letter');

  const retried = await fx.request(`/api/sales-crm/ai/jobs/${failed.id}/retry`, {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(retried.status, 202);
  assert.equal((await retried.json()).job.state, 'queued');
  assert.equal((await worker.runOnce()).status, 'succeeded');
  const rejected = await fx.request(`/api/sales-crm/ai/jobs/${failed.id}/retry`, {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(rejected.status, 409);

  const jobs = createAIJobStore(fx.db, { idFactory: () => 'AIJ-OTHER-SCOPE' });
  const other = jobs.enqueue({
    customerId: 'RU-9003', crmAccountId: 'CRM-OTHER', station: 'customer_fit', contextHash: 'a'.repeat(64),
  }, 'other-scope-retry');
  fx.db.prepare("UPDATE crm_ai_jobs SET state='retry_wait' WHERE id=?").run(other.id);
  assert.equal((await fx.request(`/api/sales-crm/ai/jobs/${other.id}/retry`, {
    cookie: fx.cookie, method: 'POST',
  })).status, 403);
});

test('identity inspection blocks AI execution and retry before creating model work', async t => {
  const calls = [];
  const fx = await fixtures.adminFixture({
    appOptions: { salesCrm: { executeCustomerFitJob: successfulExecutor(calls) } },
  });
  t.after(() => fx.close());
  await fx.startImpersonation('U-MGR');
  assert.equal((await fx.request('/api/sales-crm/ai/customers/RU-9002/stations/customer_fit/run', {
    cookie: fx.adminCookie, method: 'POST',
  })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/ai/jobs/AIJ-NONE/retry', {
    cookie: fx.adminCookie, method: 'POST',
  })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/ai/jobs/AIJ-NONE/cancel', {
    cookie: fx.adminCookie, method: 'POST',
  })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='crm_ai_jobs'").get().count, 0);
});

test('queued cancellation is scope checked, prevents execution and can be retried', async t => {
  const calls = [];
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { use_ai_assistant: true },
  });
  t.after(() => fx.close());
  const otherCookie = await fx.login('other@example.com', 'Password123!');
  const run = await fx.request('/api/sales-crm/ai/customers/RU-9002/stations/customer_fit/run', {
    cookie: fx.cookie, method: 'POST',
  });
  const queued = await run.json();
  assert.equal((await fx.request(`/api/sales-crm/ai/jobs/${queued.job.id}/cancel`, {
    cookie: otherCookie, method: 'POST',
  })).status, 403);
  const cancelled = await fx.request(`/api/sales-crm/ai/jobs/${queued.job.id}/cancel`, {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).job.state, 'cancelled');
  const worker = createAIStationWorker({
    openDb: () => new Database(fx.dbPath), workerId: 'cancel-test-worker',
    executeCustomerFitJob: successfulExecutor(calls),
  });
  assert.equal((await worker.runOnce()).status, 'idle');
  assert.equal(calls.length, 0);
  const retried = await fx.request(`/api/sales-crm/ai/jobs/${queued.job.id}/retry`, {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(retried.status, 202);
  assert.equal((await retried.json()).job.state, 'queued');
  assert.equal((await worker.runOnce()).status, 'succeeded');
  assert.equal(calls.length, 1);

  const jobs = createAIJobStore(fx.db, { idFactory: () => 'AIJ-RUNNING-CANCEL' });
  const active = jobs.enqueue({
    customerId: 'RU-9002', crmAccountId: 'CRM-OWN', station: 'customer_fit',
    contextHash: 'b'.repeat(64), createdBy: 'U-MGR',
  }, 'cancel:running-api');
  jobs.claimById(active.id, 'worker-running-api');
  const requested = await fx.request(`/api/sales-crm/ai/jobs/${active.id}/cancel`, {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(requested.status, 202);
  assert.equal((await requested.json()).job.state, 'cancel_requested');
  jobs.completeCancellation(active.id, 'worker-running-api');
});
