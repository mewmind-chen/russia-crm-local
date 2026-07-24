'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
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
  assert.equal(db.prepare("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'crm_ai_%'").get().count, 14);
  assert.deepEqual(db.prepare('SELECT * FROM assistant_runtime_settings').all(), before);
  assert.equal(db.prepare('SELECT count(*) count FROM customer_pool').get().count, 1);
  db.close();
});

test('AI schema migration is serialized across concurrent processes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-ai-schema-'));
  const dbPath = path.join(dir, 'crm.db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const setup = new Database(dbPath);
  setup.exec(`
    CREATE TABLE customer_pool (customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '');
    CREATE TABLE crm_accounts (id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '');
  `);
  setup.close();
  const schemaPath = path.join(__dirname, '..', 'lib', 'ai_stations', 'schema.js');
  const childCode = `
    const Database = require('better-sqlite3');
    const { installAIStationSchema } = require(process.env.AI_SCHEMA_MODULE);
    const db = new Database(process.env.AI_SCHEMA_DB);
    installAIStationSchema(db);
    db.close();
  `;
  const install = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', childCode], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, AI_SCHEMA_MODULE: schemaPath, AI_SCHEMA_DB: dbPath },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(error || `installer exited ${code}`)));
  });
  await Promise.all([install(), install()]);
  const verified = new Database(dbPath, { readonly: true });
  assert.equal(verified.prepare('SELECT MAX(version) version FROM crm_ai_schema_migrations').get().version, 3);
  assert.equal(verified.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'crm_ai_%'").get().count, 14);
  verified.close();
});

test('AI schema incrementally migrates the legacy four-table layout without losing jobs', () => {
  const db = fixture();
  db.exec(`
    CREATE TABLE crm_ai_jobs (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      crm_account_id TEXT,
      station TEXT NOT NULL,
      state TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      context_hash TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      priority INTEGER NOT NULL DEFAULT 0,
      next_run_at TEXT NOT NULL,
      lease_owner TEXT NOT NULL DEFAULT '',
      lease_expires_at TEXT NOT NULL DEFAULT '',
      error_summary TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (customer_id) REFERENCES customer_pool(customer_id) ON DELETE RESTRICT,
      FOREIGN KEY (crm_account_id) REFERENCES crm_accounts(id) ON DELETE RESTRICT
    );
    CREATE TABLE crm_ai_station_results (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      station TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
    CREATE TABLE crm_ai_evidence_bindings (result_id TEXT NOT NULL, evidence_id TEXT NOT NULL);
    CREATE TABLE crm_ai_model_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, attempt INTEGER NOT NULL);
    INSERT INTO crm_ai_jobs (
      id,customer_id,station,state,idempotency_key,context_hash,input_json,attempts,max_attempts,
      priority,next_run_at,created_at,updated_at,finished_at
    ) VALUES (
      'AIJ-LEGACY','CUST-1','customer_fit','succeeded','legacy:job',
      '${hash}','{}',1,3,0,'2026-07-23T00:00:00.000Z','2026-07-23T00:00:00.000Z',
      '2026-07-23T00:01:00.000Z','2026-07-23T00:01:00.000Z'
    );
  `);

  installAIStationSchema(db);
  installAIStationSchema(db);

  const columns = new Set(db.prepare('PRAGMA table_info(crm_ai_jobs)').all().map(row => row.name));
  for (const name of [
    'workflow_id',
    'parent_job_id',
    'control_state',
    'blocked_kind',
    'blocked_reason',
    'cancel_requested_at',
    'cancelled_at',
    'execution_resource',
    'fairness_at',
  ]) assert.equal(columns.has(name), true, `missing migrated column ${name}`);
  assert.equal(db.prepare("SELECT count(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'crm_ai_%'").get().count, 14);
  assert.deepEqual(
    db.prepare('SELECT id,state,attempts,finished_at FROM crm_ai_jobs WHERE id=?').get('AIJ-LEGACY'),
    {
      id: 'AIJ-LEGACY',
      state: 'succeeded',
      attempts: 1,
      finished_at: '2026-07-23T00:01:00.000Z',
    },
  );

  const jobs = createAIJobStore(db, { idFactory: () => 'AIJ-AFTER-MIGRATION' });
  const child = jobs.enqueue({
    customerId: 'CUST-1',
    station: 'customer_fit',
    contextHash: hash,
    workflowId: 'migrated-workflow',
    parentJobId: 'AIJ-LEGACY',
    dependsOn: ['AIJ-LEGACY'],
  }, 'migration:child');
  assert.equal(child.state, 'queued');
  assert.equal(jobs.claimById(child.id, 'worker-after-migration').state, 'running');
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

test('persistent DAG jobs remain blocked until each dependency succeeds', () => {
  const current = new Date('2026-07-24T01:00:00.000Z');
  const db = fixture();
  let serial = 0;
  const jobs = createAIJobStore(db, {
    now: () => current,
    idFactory: () => `AIJ-DAG-${++serial}`,
  });
  const common = {
    customerId: 'CUST-1',
    station: 'customer_fit',
    contextHash: hash,
    workflowId: 'customer-enrichment:CUST-1',
  };
  const root = jobs.enqueue(common, 'dag:root');
  const child = jobs.enqueue({ ...common, parentJobId: root.id, dependsOn: [root.id] }, 'dag:child');
  const leaf = jobs.enqueue({ ...common, parentJobId: child.id, dependsOn: [child.id] }, 'dag:leaf');

  assert.equal(child.state, 'blocked');
  assert.equal(child.blockedKind, 'dependency');
  assert.equal(leaf.state, 'blocked');
  assert.deepEqual(child.dependencyIds, [root.id]);
  assert.equal(child.parentJobId, root.id);
  assert.equal(child.workflowId, 'customer-enrichment:CUST-1');
  assert.deepEqual(
    db.prepare('SELECT job_id,depends_on_job_id FROM crm_ai_job_dependencies ORDER BY job_id').all(),
    [
      { job_id: child.id, depends_on_job_id: root.id },
      { job_id: leaf.id, depends_on_job_id: child.id },
    ],
  );

  // Rebuilding the store simulates a worker restart; queue and dependency state live in SQLite.
  const resumed = createAIJobStore(db, { now: () => current });
  assert.equal(resumed.claimNext('worker-root').id, root.id);
  assert.equal(resumed.claimNext('worker-blocked'), null);

  db.prepare(`UPDATE crm_ai_jobs SET state='succeeded',lease_owner='',lease_expires_at='',
    finished_at=?,updated_at=? WHERE id=?`).run(current.toISOString(), current.toISOString(), root.id);
  const claimedChild = resumed.claimNext('worker-child');
  assert.equal(claimedChild.id, child.id);
  assert.equal(claimedChild.state, 'running');
  assert.equal(resumed.getJob(leaf.id).state, 'blocked');

  db.prepare(`UPDATE crm_ai_jobs SET state='succeeded',lease_owner='',lease_expires_at='',
    finished_at=?,updated_at=? WHERE id=?`).run(current.toISOString(), current.toISOString(), child.id);
  const claimedLeaf = resumed.claimNext('worker-leaf');
  assert.equal(claimedLeaf.id, leaf.id);
  assert.equal(claimedLeaf.state, 'running');
  db.close();
});

test('claiming honors priority among due jobs without bypassing nextRunAt', () => {
  let current = new Date('2026-07-24T02:00:00.000Z');
  const db = fixture();
  let serial = 0;
  const jobs = createAIJobStore(db, { now: () => current, idFactory: () => `AIJ-SCHEDULE-${++serial}` });
  const common = { customerId: 'CUST-1', station: 'customer_fit', contextHash: hash };
  const low = jobs.enqueue({ ...common, priority: -10 }, 'schedule:low');
  const future = jobs.enqueue({
    ...common,
    priority: 100,
    nextRunAt: new Date('2026-07-24T02:05:00.000Z'),
  }, 'schedule:future');
  const high = jobs.enqueue({ ...common, priority: 10 }, 'schedule:high');

  assert.equal(jobs.claimNext('worker-high').id, high.id);
  assert.equal(jobs.claimNext('worker-low').id, low.id);
  assert.equal(jobs.claimNext('worker-too-early'), null);
  assert.equal(jobs.getJob(future.id).state, 'queued');
  assert.equal(jobs.getJob(future.id).nextRunAt, '2026-07-24T02:05:00.000Z');

  current = new Date('2026-07-24T02:05:00.000Z');
  assert.equal(jobs.claimNext('worker-future').id, future.id);
  db.close();
});

test('queued and running cancellation are durable and lease protected', () => {
  let current = new Date('2026-07-24T03:00:00.000Z');
  const db = fixture();
  let serial = 0;
  const jobs = createAIJobStore(db, {
    now: () => current,
    leaseMs: 1000,
    idFactory: () => `AIJ-CANCEL-${++serial}`,
  });
  const common = { customerId: 'CUST-1', station: 'customer_fit', contextHash: hash };
  const queued = jobs.enqueue(common, 'cancel:queued');
  const cancelled = jobs.requestCancel(queued.id);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.baseState, 'queued');
  assert.equal(cancelled.cancelRequestedAt, current.toISOString());
  assert.equal(cancelled.cancelledAt, current.toISOString());
  assert.equal(jobs.claimById(queued.id, 'worker-cancelled'), null);

  const active = jobs.enqueue(common, 'cancel:running');
  assert.equal(jobs.claimById(active.id, 'worker-active').state, 'running');
  const requested = jobs.requestCancel(active.id);
  assert.equal(requested.state, 'cancel_requested');
  assert.equal(requested.baseState, 'running');
  assert.equal(jobs.heartbeat(active.id, 'worker-active').state, 'cancel_requested');
  assert.throws(() => jobs.completeCancellation(active.id, 'worker-other'), /not owned/);
  const completed = jobs.completeCancellation(active.id, 'worker-active');
  assert.equal(completed.state, 'cancelled');
  assert.equal(completed.leaseOwner, '');
  assert.equal(completed.leaseExpiresAt, '');

  const abandoned = jobs.enqueue(common, 'cancel:expired-running');
  jobs.claimById(abandoned.id, 'worker-abandoned');
  jobs.requestCancel(abandoned.id);
  current = new Date('2026-07-24T03:00:02.000Z');
  assert.equal(jobs.releaseExpiredLeases(), 1);
  assert.equal(jobs.getJob(abandoned.id).state, 'cancelled');
  assert.equal(jobs.claimById(abandoned.id, 'worker-after-expiry'), null);
  db.close();
});

test('cancelled dependency jobs cannot bypass the DAG when retried or tampered', () => {
  const current = new Date('2026-07-24T04:00:00.000Z');
  const db = fixture();
  let serial = 0;
  const jobs = createAIJobStore(db, { now: () => current, idFactory: () => `AIJ-GUARD-${++serial}` });
  const common = { customerId: 'CUST-1', station: 'customer_fit', contextHash: hash };
  const parent = jobs.enqueue(common, 'guard:parent');
  const child = jobs.enqueue({ ...common, dependsOn: [parent.id] }, 'guard:child');
  assert.equal(child.state, 'blocked');
  assert.equal(jobs.requestCancel(child.id).state, 'cancelled');
  const retried = jobs.retry(child.id);
  assert.equal(retried.state, 'blocked');
  assert.equal(retried.cancelRequestedAt, '');
  assert.equal(retried.cancelledAt, '');
  assert.equal(jobs.claimById(child.id, 'worker-child-early'), null);

  // Defense in depth: claim SQL still rejects an inconsistent row whose control state was cleared.
  db.prepare("UPDATE crm_ai_jobs SET control_state='',blocked_reason='' WHERE id=?").run(child.id);
  assert.equal(jobs.claimById(child.id, 'worker-child-tampered'), null);
  assert.equal(jobs.claimNext('worker-parent').id, parent.id);
  db.close();
});

test('blocked jobs can resume safely and queue health reports backlog and wait alerts', () => {
  let current = new Date('2026-07-24T05:00:00.000Z');
  const db = fixture();
  const jobs = createAIJobStore(db, { now: () => current, idFactory: () => 'AIJ-HEALTH' });
  const job = jobs.enqueue({
    customerId: 'CUST-1', station: 'customer_fit', contextHash: hash,
    eventType: 'customer_created', eventId: 'EVENT-1',
  }, 'health:event');
  assert.equal(job.eventType, 'customer_created');
  assert.equal(job.eventId, 'EVENT-1');
  current = new Date('2026-07-24T05:10:00.000Z');
  const health = jobs.queueHealth({ backlogWarning: 1, maxWaitMs: 60_000 });
  assert.equal(health.pendingCount, 1);
  assert.equal(health.blockedCount, 0);
  assert.equal(health.oldestWaitMs, 600_000);
  assert.deepEqual(health.alerts.map(alert => alert.code), ['AI_QUEUE_BACKLOG', 'AI_QUEUE_WAIT']);
  jobs.block(job.id, '', 'permission temporarily unavailable');
  assert.equal(jobs.getJob(job.id).state, 'blocked');
  assert.equal(jobs.getJob(job.id).blockedKind, 'policy');
  const blockedHealth = jobs.queueHealth({ backlogWarning: 1, maxWaitMs: 60_000 });
  assert.equal(blockedHealth.blockedCount, 1);
  assert.equal(blockedHealth.oldestWaitMs, 0);
  assert.deepEqual(blockedHealth.alerts.map(alert => alert.code), ['AI_QUEUE_BACKLOG']);
  assert.equal(jobs.retry(job.id).state, 'queued');
  assert.equal(jobs.claimNext('worker-resumed').id, job.id);
  db.close();
});
