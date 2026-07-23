'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { buildCustomerContext } = require('../lib/ai_stations/context');
const { createAIJobStore } = require('../lib/ai_stations/jobs');

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
    appOptions: { salesCrm: { executeCustomerFitJob: successfulExecutor(calls) } },
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
  assert.equal(run.status, 200);
  const runBody = await run.json();
  assert.equal(runBody.job.state, 'succeeded');
  assert.equal(runBody.result.value.fitScore, 89);
  assert.equal(calls.length, 1);

  const replay = await fx.request('/api/sales-crm/ai/customers/RU-9002/stations/customer_fit/run', {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).job.id, runBody.job.id);
  assert.equal(calls.length, 1);

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
  assert.equal(run.status, 200);
  const failed = await run.json();
  assert.equal(failed.job.state, 'dead_letter');

  const retried = await fx.request(`/api/sales-crm/ai/jobs/${failed.job.id}/retry`, {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).job.state, 'succeeded');
  const rejected = await fx.request(`/api/sales-crm/ai/jobs/${failed.job.id}/retry`, {
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
  assert.equal(calls.length, 0);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='crm_ai_jobs'").get().count, 0);
});
