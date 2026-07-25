'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createAIResultStore } = require('../lib/ai_stations/results');

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE customer_pool (customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '');
    CREATE TABLE crm_accounts (id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '');
    INSERT INTO customer_pool(customer_id) VALUES ('CUST-1');
    INSERT INTO crm_accounts(id) VALUES ('ACC-1');
  `);
  return db;
}

const hash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const value = {
  version: 'v1', confidence: 0.9, evidenceIds: ['EV-1', 'EV-2'], reasonCodes: ['PRODUCT_MATCH'],
  fitScore: 84, grade: 'B', reviewRequired: false,
};

function prepareJob(db, id = 'AIJ-RESULT') {
  const jobs = createAIJobStore(db, { idFactory: () => id });
  jobs.enqueue({
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    station: 'customer_fit',
    contextHash: hash,
    trigger: { source: 'api', reason: 'test_fixture' },
  }, `job:${id}`);
  const claimed = jobs.claimNext('worker-1');
  return { jobs, claimed };
}

test('results persist validated output, evidence bindings, metadata, and job state', () => {
  const db = fixture();
  const { claimed } = prepareJob(db);
  const results = createAIResultStore(db, { idFactory: prefix => `${prefix}-1` });
  const result = results.saveResult({
    jobId: claimed.id, workerId: 'worker-1', contextHash: hash, value,
    evidenceIds: ['EV-1', 'EV-2'],
    metadata: { engine: 'hermes', model: 'deepseek-v4-flash', promptVersion: 'v1', schemaVersion: 'v1', usage: { input: 10 }, cost: 0.02 },
  }, 'result:CUST-1:fit:v1');
  assert.equal(result.station, 'customer_fit');
  assert.equal(result.engine, 'hermes');
  assert.deepEqual(result.usage, { input: 10 });
  assert.equal(db.prepare('SELECT state FROM crm_ai_jobs WHERE id=?').get(claimed.id).state, 'succeeded');
  assert.deepEqual(db.prepare('SELECT evidence_id FROM crm_ai_evidence_bindings WHERE result_id=? ORDER BY position').all(result.id).map(row => row.evidence_id), ['EV-1', 'EV-2']);
  assert.equal(results.saveResult({ jobId: claimed.id, workerId: 'worker-1', contextHash: hash, value, evidenceIds: ['EV-1', 'EV-2'], metadata: { engine: 'hermes', model: 'deepseek-v4-flash', promptVersion: 'v1', schemaVersion: 'v1' } }, 'result:CUST-1:fit:v1').id, result.id);
  db.close();
});

test('results reject stale context, invented evidence, and an unowned lease', () => {
  const db = fixture();
  const { claimed } = prepareJob(db, 'AIJ-REJECT');
  const results = createAIResultStore(db);
  const metadata = { engine: 'hermes', model: 'm', promptVersion: 'v1', schemaVersion: 'v1' };
  assert.throws(() => results.saveResult({ jobId: claimed.id, workerId: 'worker-1', contextHash: 'c'.repeat(64), value, evidenceIds: ['EV-1', 'EV-2'], metadata }, 'result:stale'), /context hash is stale/);
  assert.throws(() => results.saveResult({ jobId: claimed.id, workerId: 'worker-1', contextHash: hash, value, evidenceIds: ['EV-OTHER'], metadata }, 'result:evidence'), /validation failed/);
  assert.throws(() => results.saveResult({ jobId: claimed.id, workerId: 'worker-2', contextHash: hash, value, evidenceIds: ['EV-1', 'EV-2'], metadata }, 'result:owner'), /lease is not owned/);
  db.close();
});

test('review-required output moves a job to needs_review and model runs redact errors', () => {
  const db = fixture();
  const { claimed } = prepareJob(db, 'AIJ-REVIEW');
  const results = createAIResultStore(db, { idFactory: prefix => `${prefix}-review` });
  const reviewValue = { ...value, reviewRequired: true };
  results.saveResult({
    jobId: claimed.id, workerId: 'worker-1', contextHash: hash, value: reviewValue, evidenceIds: ['EV-1', 'EV-2'],
    metadata: { engine: 'hermes', model: 'm', promptVersion: 'v1', schemaVersion: 'v1' },
  }, 'result:review');
  assert.equal(db.prepare('SELECT state FROM crm_ai_jobs WHERE id=?').get(claimed.id).state, 'needs_review');
  const run = results.recordModelRun({ jobId: claimed.id, attempt: 1, engine: 'hermes', model: 'm', status: 'failed', startedAt: '2026-07-23T11:00:00Z', finishedAt: '2026-07-23T11:00:01Z', error: 'token=secret-value' }, 'model-run:1');
  assert.equal(run.status, 'failed');
  assert.match(run.error_summary, /token=\[REDACTED\]/);
  db.close();
});
