'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createAIJobStore } = require('../lib/ai_stations/jobs');
const {
  BATCH_ELIGIBLE_STATIONS,
  BATCH_FORBIDDEN_STATIONS,
  createPricingStore,
  createQwenBatchCoordinator,
  createQwenBatchProvider,
  withinSchedule,
} = require('../lib/ai_stations/qwen_batch');
const { runOnce, workerIdFromEnvironment } = require('../scripts/qwen-batch-worker');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE customer_pool (customer_id TEXT PRIMARY KEY);
    CREATE TABLE crm_accounts (id TEXT PRIMARY KEY);
    INSERT INTO customer_pool(customer_id) VALUES ('CUST-1'),('CUST-2'),('CUST-3');
    INSERT INTO crm_accounts(id) VALUES ('ACC-1'),('ACC-2'),('ACC-3');
  `);
  return db;
}

function ids() {
  let sequence = 0;
  return prefix => `${prefix}-${++sequence}`;
}

function installRates(pricing, at = '2026-07-25T00:00:00.000Z') {
  pricing.upsertPricing({
    version: 'qwen-batch-2026-07',
    provider: 'qwen',
    model: 'qwen3.7-flash',
    executionType: 'batch',
    currency: 'CNY',
    inputPerMillion: 0.4,
    outputPerMillion: 1,
    effectiveFrom: at,
  });
  pricing.upsertFx({
    version: 'fx-2026-07-25',
    baseCurrency: 'CNY',
    quoteCurrency: 'USD',
    rate: 0.14,
    effectiveFrom: at,
    source: 'finance-approved',
  });
}

function response(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[String(name).toLowerCase()] || '' },
    text: async () => text,
  };
}

test('Batch policy is explicit and schedule uses the configured timezone', () => {
  assert.deepEqual(BATCH_ELIGIBLE_STATIONS, [
    'customer_fit', 'contact_readiness', 'distribution_priority', 'manager_anomaly', 'sales_coaching',
  ]);
  assert.deepEqual(BATCH_FORBIDDEN_STATIONS, [
    'assistant_chat', 'next_action', 'sales_match', 'action_proposal',
  ]);
  assert.equal(withinSchedule('2026-07-24T18:04:00.000Z', '02:00', 'Asia/Shanghai'), true);
  assert.equal(withinSchedule('2026-07-24T18:20:00.000Z', '02:00', 'Asia/Shanghai'), false);
  assert.equal(workerIdFromEnvironment({}, 'crm host/1'), 'qwen-batch-crm-host-1');
  assert.equal(workerIdFromEnvironment({ CRM_AI_QWEN_BATCH_WORKER_ID: 'batch-production-1' }, 'ignored'), 'batch-production-1');
});

test('disabled Qwen Batch worker exits cleanly without calling the provider', async () => {
  const db = fixture();
  const result = await runOnce({
    db,
    env: {
      CRM_AI_QWEN_BATCH_ENABLED: 'true',
      CRM_AI_QWEN_BATCH_SCHEDULE: '02:00',
      CRM_AI_QWEN_BATCH_TIMEZONE: 'Asia/Shanghai',
    },
    provider: {
      submit: async () => assert.fail('disabled Batch must not submit'),
      poll: async () => assert.fail('empty Batch queue must not poll'),
    },
    ignoreSchedule: true,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.polled, []);
  assert.deepEqual(result.submitted, { status: 'disabled' });
  db.close();
});

test('Qwen Batch provider uploads JSONL, creates a file-backed batch and downloads both result files', async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/files') && init.method === 'POST') {
      assert.equal(init.headers['Content-Type'], undefined);
      assert.equal(init.body.get('purpose'), 'batch');
      const jsonl = await init.body.get('file').text();
      assert.deepEqual(jsonl.trim().split('\n').map(JSON.parse), [{
        custom_id: 'ITEM-1',
        method: 'POST',
        url: '/v1/chat/completions',
        body: { model: 'qwen3.7-flash', messages: [] },
      }]);
      return response(200, { id: 'file-input-1' });
    }
    if (url.endsWith('/batches') && init.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), {
        input_file_id: 'file-input-1',
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
        metadata: { tradepulse_idempotency_key: 'batch-key-1' },
      });
      return response(200, { id: 'batch-1', input_file_id: 'file-input-1' });
    }
    if (url.endsWith('/batches/batch-1')) {
      return response(200, {
        id: 'batch-1',
        status: 'completed',
        input_file_id: 'file-input-1',
        output_file_id: 'file-output-1',
        error_file_id: 'file-error-1',
      });
    }
    if (url.endsWith('/files/file-output-1/content')) {
      return response(200, `${JSON.stringify({
        id: 'provider-item-1',
        custom_id: 'ITEM-1',
        response: {
          status_code: 200,
          request_id: 'request-1',
          body: {
            id: 'chat-1',
            usage: { prompt_tokens: 10, completion_tokens: 2 },
            choices: [{ message: { content: '{"version":"v1"}' } }],
          },
        },
        error: null,
      })}\n`);
    }
    if (url.endsWith('/files/file-error-1/content')) {
      return response(200, `${JSON.stringify({
        id: 'provider-item-2',
        custom_id: 'ITEM-2',
        response: { status_code: 400, request_id: 'request-2' },
        error: { message: 'invalid request' },
      })}\n`);
    }
    throw new Error(`Unexpected request: ${init.method || 'GET'} ${url}`);
  };
  const provider = createQwenBatchProvider({
    apiKey: 'test-secret',
    baseUrl: 'https://dashscope.example/compatible-mode/v1',
    fetch,
  });
  const submitted = await provider.submit([{
    custom_id: 'ITEM-1',
    method: 'POST',
    url: '/v1/chat/completions',
    body: { model: 'qwen3.7-flash', messages: [] },
  }], { idempotencyKey: 'batch-key-1' });
  assert.equal(submitted.id, 'batch-1');
  assert.equal(submitted.input_file_id, 'file-input-1');

  const polled = await provider.poll('batch-1');
  assert.equal(polled.items.length, 2);
  assert.deepEqual(polled.items[0], {
    custom_id: 'ITEM-1',
    id: 'provider-item-1',
    requestId: 'request-1',
    status: 'succeeded',
    usage: { prompt_tokens: 10, completion_tokens: 2 },
    response: {
      id: 'chat-1',
      usage: { prompt_tokens: 10, completion_tokens: 2 },
      choices: [{ message: { content: '{"version":"v1"}' } }],
    },
    error: null,
  });
  assert.equal(polled.items[1].status, 'failed');
  assert.equal(calls.length, 5);
});

test('versioned Qwen Batch pricing rejects expired promotion and missing FX instead of zero cost', () => {
  const db = fixture();
  const pricing = createPricingStore(db, {
    now: () => new Date('2026-07-25T02:00:00.000Z'),
    idFactory: ids(),
  });
  pricing.upsertPricing({
    version: 'promo-expired',
    model: 'qwen3.7-flash',
    executionType: 'batch',
    currency: 'CNY',
    inputPerMillion: 0.4,
    outputPerMillion: 1,
    effectiveFrom: '2026-07-01T00:00:00.000Z',
    promotionEndsAt: '2026-07-24T00:00:00.000Z',
  });
  assert.throws(() => pricing.quote({
    model: 'qwen3.7-flash',
    executionType: 'batch',
    inputTokens: 100,
    outputTokens: 20,
  }), error => error.code === 'AI_BATCH_PRICING_MISSING');

  pricing.upsertPricing({
    version: 'active-no-fx',
    model: 'qwen3.7-flash',
    executionType: 'batch',
    currency: 'CNY',
    inputPerMillion: 0.4,
    outputPerMillion: 1,
    effectiveFrom: '2026-07-25T00:00:00.000Z',
  });
  assert.throws(() => pricing.quote({
    model: 'qwen3.7-flash',
    executionType: 'batch',
    inputTokens: 100,
    outputTokens: 20,
  }), error => error.code === 'AI_BATCH_FX_MISSING');
  db.close();
});

test('Qwen Batch pricing rejects zero input or output rates', () => {
  const db = fixture();
  const pricing = createPricingStore(db, {
    now: () => new Date('2026-07-25T02:00:00.000Z'),
    idFactory: ids(),
  });
  const rate = {
    model: 'qwen3.7-flash',
    executionType: 'batch',
    currency: 'CNY',
    effectiveFrom: '2026-07-25T00:00:00.000Z',
  };
  assert.throws(() => pricing.upsertPricing({
    ...rate,
    version: 'zero-input',
    inputPerMillion: 0,
    outputPerMillion: 1,
  }), /pricing rates must be positive/);
  assert.throws(() => pricing.upsertPricing({
    ...rate,
    version: 'zero-output',
    inputPerMillion: 0.4,
    outputPerMillion: 0,
  }), /pricing rates must be positive/);
  db.close();
});

test('Qwen Batch submit, poll, import and duplicate poll remain idempotent with CNY and USD audit', async () => {
  const db = fixture();
  const idFactory = ids();
  const now = () => new Date('2026-07-25T02:02:00.000Z');
  const jobs = createAIJobStore(db, { idFactory, now, retryBaseMs: 1 });
  const pricing = createPricingStore(db, { idFactory, now });
  installRates(pricing);
  const job = jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    station: 'customer_fit',
    contextHash: 'context-v1',
    executionMode: 'batch_eligible',
    createdBy: 'U-1',
    payload: {
      evidenceIds: ['EV-1'],
      batchRequest: { messages: [{ role: 'user', content: '仅返回 JSON' }] },
    },
  }, 'batch-job-1');
  const provider = {
    async submit(items, input) {
      assert.equal(items.length, 1);
      assert.match(input.idempotencyKey, /^qwen-batch:/);
      return { id: 'provider-batch-1' };
    },
    async poll() {
      const item = db.prepare('SELECT custom_id FROM crm_ai_batch_items').get();
      return {
        status: 'completed',
        items: [{
          custom_id: item.custom_id,
          id: 'provider-item-1',
          status: 'succeeded',
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
          cost_cny: 0.00006,
          response: { version: 'v1' },
        }],
      };
    },
  };
  const coordinator = createQwenBatchCoordinator(db, {
    now,
    idFactory,
    jobs,
    pricing,
    provider,
    enabled: true,
    workerId: 'batch-worker',
    config: { schedule: '02:00', timezone: 'Asia/Shanghai', maxItems: 10, staleRequeueLimit: 2 },
  });
  const submitted = await coordinator.submitReady({ ignoreSchedule: true });
  assert.equal(submitted.runs.length, 1);
  assert.equal(submitted.runs[0].provider_batch_id, 'provider-batch-1');
  assert.equal(jobs.getJob(job.id).state, 'running');

  const imported = await coordinator.pollAndImport(submitted.runs[0].id);
  assert.equal(imported.state, 'review_required');
  assert.equal(jobs.getJob(job.id).state, 'needs_review');
  const item = coordinator.listItems(imported.id)[0];
  assert.equal(item.state, 'review_required');
  assert.equal(item.original_currency, 'CNY');
  assert.equal(item.original_cost, 0.00006);
  assert.ok(Math.abs(item.converted_cost_usd - 0.0000084) < 1e-12);
  assert.equal(item.pricing_version, 'qwen-batch-2026-07');
  assert.equal(item.fx_version, 'fx-2026-07-25');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_ai_usage_ledger').get().count, 1);

  await coordinator.pollAndImport(imported.id);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_ai_usage_ledger').get().count, 1);
  db.close();
});

test('Batch missing usage remains reconcilable and stale context is retained then requeued', async () => {
  const db = fixture();
  const idFactory = ids();
  let currentTime = new Date('2026-07-25T02:02:00.000Z');
  const now = () => currentTime;
  const jobs = createAIJobStore(db, { idFactory, now, retryBaseMs: 1 });
  const pricing = createPricingStore(db, { idFactory, now });
  installRates(pricing);
  const missing = jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: 'CUST-2', crmAccountId: 'ACC-2', station: 'customer_fit',
    contextHash: 'missing-v1', executionMode: 'batch_eligible', createdBy: 'U-1',
    payload: { evidenceIds: ['EV-2'], batchRequest: { messages: [] } },
  }, 'batch-missing');
  const stale = jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: 'CUST-3', crmAccountId: 'ACC-3', station: 'customer_fit',
    contextHash: 'stale-v1', executionMode: 'batch_eligible', createdBy: 'U-1',
    payload: { evidenceIds: ['EV-3'], batchRequest: { messages: [] } },
  }, 'batch-stale');
  let batchNumber = 0;
  const provider = {
    async submit() { batchNumber += 1; return { id: `provider-${batchNumber}` }; },
    async poll(id) {
      const run = db.prepare('SELECT id FROM crm_ai_batch_runs WHERE provider_batch_id=?').get(id);
      const items = db.prepare('SELECT custom_id,job_id FROM crm_ai_batch_items WHERE run_id=?').all(run.id);
      return {
        status: 'completed',
        items: items.map(item => item.job_id === missing.id
          ? { custom_id: item.custom_id, status: 'succeeded', response: {} }
          : {
            custom_id: item.custom_id,
            status: 'succeeded',
            usage: { prompt_tokens: 10, completion_tokens: 2 },
            cost_cny: 0.00001,
            response: {},
          }),
      };
    },
  };
  const coordinator = createQwenBatchCoordinator(db, {
    now, idFactory, jobs, pricing, provider, enabled: true, workerId: 'batch-worker',
    config: { schedule: '02:00', timezone: 'Asia/Shanghai', maxItems: 10, staleRequeueLimit: 2 },
    currentSnapshot(job) {
      return job.id === stale.id
        ? { contextHash: 'stale-v2', evidenceIds: ['EV-3'] }
        : { contextHash: job.contextHash, evidenceIds: job.input.evidenceIds };
    },
  });
  const submitted = await coordinator.submitReady({ ignoreSchedule: true });
  assert.equal(submitted.runs.length, 1);
  const imported = await coordinator.pollAndImport(submitted.runs[0].id);
  assert.equal(imported.state, 'partial_failed');
  const items = coordinator.listItems(imported.id);
  assert.equal(items.find(item => item.job_id === missing.id).state, 'missing_usage');
  assert.equal(db.prepare('SELECT state FROM crm_ai_budget_reservations WHERE job_id=?').get(missing.id).state, 'reserved');
  assert.equal(items.find(item => item.job_id === stale.id).state, 'stale');
  assert.equal(jobs.getJob(stale.id).state, 'retry_wait');
  assert.equal(jobs.getJob(stale.id).staleRequeueCount, 1);
  assert.equal(jobs.getJob(stale.id).contextHash, 'stale-v2');
  currentTime = new Date('2026-07-25T02:02:00.002Z');
  assert.equal(coordinator.candidateRows().some(row => row.id === stale.id), true);
  db.close();
});

test('Batch completion with an omitted result remains partial and keeps its reservation reconcilable', async () => {
  const db = fixture();
  const idFactory = ids();
  const now = () => new Date('2026-07-25T02:02:00.000Z');
  const jobs = createAIJobStore(db, { idFactory, now });
  const pricing = createPricingStore(db, { idFactory, now });
  installRates(pricing);
  const job = jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: 'CUST-1', crmAccountId: 'ACC-1', station: 'customer_fit',
    contextHash: 'context-v1', executionMode: 'batch_eligible', createdBy: 'U-1',
    payload: { evidenceIds: ['EV-1'], batchRequest: { messages: [] } },
  }, 'batch-omitted');
  const provider = {
    async submit() { return { id: 'provider-omitted' }; },
    async poll() { return { status: 'completed', items: [] }; },
  };
  const coordinator = createQwenBatchCoordinator(db, {
    now, idFactory, jobs, pricing, provider, enabled: true, workerId: 'batch-worker',
    config: { schedule: '02:00', timezone: 'Asia/Shanghai', maxItems: 10, staleRequeueLimit: 2 },
  });

  const submitted = await coordinator.submitReady({ ignoreSchedule: true });
  const imported = await coordinator.pollAndImport(submitted.runs[0].id);

  assert.equal(imported.state, 'partial_failed');
  assert.equal(coordinator.listItems(imported.id)[0].state, 'missing_usage');
  assert.equal(jobs.getJob(job.id).state, 'running');
  assert.equal(db.prepare('SELECT state FROM crm_ai_budget_reservations WHERE job_id=?').get(job.id).state, 'reserved');
  db.close();
});

test('Batch schema rejection charges actual usage and returns the job to retry', async () => {
  const db = fixture();
  const idFactory = ids();
  const now = () => new Date('2026-07-25T02:02:00.000Z');
  const jobs = createAIJobStore(db, { idFactory, now, retryBaseMs: 1 });
  const pricing = createPricingStore(db, { idFactory, now });
  installRates(pricing);
  const job = jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: 'CUST-1', crmAccountId: 'ACC-1', station: 'customer_fit',
    contextHash: 'context-v1', executionMode: 'batch_eligible', createdBy: 'U-1',
    payload: { evidenceIds: ['EV-1'], batchRequest: { messages: [] } },
  }, 'batch-invalid-output');
  const provider = {
    async submit() { return { id: 'provider-invalid' }; },
    async poll() {
      const item = db.prepare('SELECT custom_id FROM crm_ai_batch_items').get();
      return {
        status: 'completed',
        items: [{
          custom_id: item.custom_id,
          status: 'succeeded',
          usage: { prompt_tokens: 10, completion_tokens: 2 },
          response: { invalid: true },
        }],
      };
    },
  };
  const coordinator = createQwenBatchCoordinator(db, {
    now, idFactory, jobs, pricing, provider, enabled: true, workerId: 'batch-worker',
    config: { schedule: '02:00', timezone: 'Asia/Shanghai', maxItems: 10, staleRequeueLimit: 2 },
    validateResult() {
      throw Object.assign(new Error('schema rejected output'), { code: 'AI_BATCH_INVALID_OUTPUT' });
    },
  });

  const submitted = await coordinator.submitReady({ ignoreSchedule: true });
  const imported = await coordinator.pollAndImport(submitted.runs[0].id);

  assert.equal(imported.state, 'partial_failed');
  assert.equal(coordinator.listItems(imported.id)[0].state, 'failed');
  assert.equal(jobs.getJob(job.id).state, 'retry_wait');
  assert.equal(db.prepare('SELECT state FROM crm_ai_budget_reservations WHERE job_id=?').get(job.id).state, 'settled');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_ai_usage_ledger WHERE job_id=?').get(job.id).count, 1);
  db.close();
});

test('forbidden immediate stations cannot be marked batch eligible', () => {
  const db = fixture();
  const jobs = createAIJobStore(db, { idFactory: ids() });
  assert.throws(() => jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    station: 'next_action',
    contextHash: 'context',
    executionMode: 'batch_eligible',
  }, 'forbidden-batch'), /not eligible for batch execution/);
  db.close();
});
