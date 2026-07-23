'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installAIStationSchema } = require('../lib/ai_stations/schema');
const { createAIJobStore } = require('../lib/ai_stations/jobs');

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE customer_pool (customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '');
    CREATE TABLE crm_accounts (id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '');
    CREATE TABLE assistant_runtime_settings (id TEXT PRIMARY KEY, mode TEXT NOT NULL);
    INSERT INTO customer_pool(customer_id) VALUES ('CUST-1');
    INSERT INTO crm_accounts(id) VALUES ('ACC-1');
    INSERT INTO assistant_runtime_settings(id,mode) VALUES ('default','auto');
  `);
  return db;
}

const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('AI schema installation is idempotent and leaves identity/router tables unchanged', () => {
  const db = fixture();
  const before = db.prepare('SELECT * FROM assistant_runtime_settings').all();
  installAIStationSchema(db);
  installAIStationSchema(db);
  assert.equal(db.prepare("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'crm_ai_%'").get().count, 4);
  assert.deepEqual(db.prepare('SELECT * FROM assistant_runtime_settings').all(), before);
  assert.equal(db.prepare('SELECT count(*) count FROM customer_pool').get().count, 1);
  db.close();
});

test('AI jobs are idempotent, claimable by text customer IDs, and lease protected', () => {
  let current = new Date('2026-07-23T11:00:00.000Z');
  const db = fixture();
  const jobs = createAIJobStore(db, {
    now: () => current,
    leaseMs: 1000,
    retryBaseMs: 1000,
    maxAttempts: 2,
    idFactory: () => 'AIJ-1',
  });
  const input = { customerId: 'CUST-1', crmAccountId: 'ACC-1', station: 'customer_fit', contextHash: hash, payload: { source: 'test' } };
  const first = jobs.enqueue(input, 'job:CUST-1:fit:v1');
  const replay = jobs.enqueue(input, 'job:CUST-1:fit:v1');
  assert.equal(replay.id, first.id);
  assert.throws(() => jobs.enqueue({ ...input, contextHash: hash.replace(/^a/, 'b') }, 'job:CUST-1:fit:v1'), /idempotency collision/);

  const claimed = jobs.claimNext('worker-1');
  assert.equal(claimed.state, 'running');
  assert.equal(claimed.attempts, 1);
  assert.equal(jobs.claimNext('worker-2'), null);
  const retry = jobs.fail(claimed.id, 'worker-1', new Error('Bearer secret-token failed'));
  assert.equal(retry.state, 'retry_wait');
  assert.match(retry.errorSummary, /Bearer \[REDACTED\]/);
  current = new Date('2026-07-23T11:00:02.000Z');
  const second = jobs.claimNext('worker-2');
  assert.equal(second.attempts, 2);
  const dead = jobs.fail(second.id, 'worker-2', { code: 'MODEL_FAILED', message: 'upstream failed' });
  assert.equal(dead.state, 'dead_letter');
  assert.equal(dead.finishedAt, '2026-07-23T11:00:02.000Z');
  db.close();
});

test('expired running leases are recoverable and eventually dead-lettered', () => {
  let current = new Date('2026-07-23T11:00:00.000Z');
  const db = fixture();
  const jobs = createAIJobStore(db, { now: () => current, leaseMs: 1000, maxAttempts: 2, idFactory: () => 'AIJ-2' });
  jobs.enqueue({ customerId: 'CUST-1', station: 'customer_fit', contextHash: hash }, 'job:lease');
  jobs.claimNext('worker-1');
  current = new Date('2026-07-23T11:00:02.000Z');
  assert.equal(jobs.releaseExpiredLeases(), 1);
  const reclaimed = jobs.claimNext('worker-2');
  assert.equal(reclaimed.state, 'running');
  current = new Date('2026-07-23T11:00:04.000Z');
  assert.equal(jobs.releaseExpiredLeases(), 1);
  assert.equal(jobs.getJob('AIJ-2').state, 'dead_letter');
  db.close();
});

test('a requested job is claimed without consuming another customer job', () => {
  const db = fixture();
  db.prepare("INSERT INTO customer_pool(customer_id) VALUES ('CUST-2')").run();
  let serial = 0;
  const jobs = createAIJobStore(db, { idFactory: () => `AIJ-EXACT-${++serial}` });
  const first = jobs.enqueue({ customerId: 'CUST-1', station: 'customer_fit', contextHash: hash }, 'job:first');
  const second = jobs.enqueue({ customerId: 'CUST-2', station: 'customer_fit', contextHash: hash }, 'job:second');
  const claimed = jobs.claimById(second.id, 'worker-exact');
  assert.equal(claimed.id, second.id);
  assert.equal(jobs.getJob(first.id).state, 'queued');
  db.close();
});

test('manual retry accepts only retryable states and revives dead letters', () => {
  const db = fixture();
  const jobs = createAIJobStore(db, { maxAttempts: 1, idFactory: () => 'AIJ-RETRY' });
  const job = jobs.enqueue({ customerId: 'CUST-1', station: 'customer_fit', contextHash: hash }, 'job:retry');
  const claimed = jobs.claimById(job.id, 'worker-retry');
  jobs.fail(claimed.id, 'worker-retry', new Error('failed'));
  assert.equal(jobs.getJob(job.id).state, 'dead_letter');
  const retried = jobs.retry(job.id);
  assert.equal(retried.state, 'queued');
  assert.equal(retried.attempts, 1);
  assert.equal(retried.maxAttempts, 2);
  assert.equal(jobs.claimById(job.id, 'worker-retry-2').attempts, 2);
  assert.throws(() => jobs.retry(job.id), error => error.statusCode === 409 && error.code === 'AI_JOB_NOT_RETRYABLE');
  db.close();
});
