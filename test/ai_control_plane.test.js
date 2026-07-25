'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const { ROLE_PERMISSIONS } = require('../lib/access_control');
const { createAIJobStore } = require('../lib/ai_stations/jobs');

const contextHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const resources = Object.freeze({
  global: { maxConcurrency: 4, rateLimit: 0, rateWindowMs: 60_000 },
  deepseek: { maxConcurrency: 1, rateLimit: 0, rateWindowMs: 60_000 },
});

function databaseFixture(customerCount = 3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-ai-control-plane-'));
  const dbPath = path.join(dir, 'crm.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
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
    CREATE TABLE control_plane_test_events (
      job_id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE control_plane_test_metrics (
      id TEXT PRIMARY KEY, max_active INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO control_plane_test_metrics(id,max_active) VALUES ('global',0);
  `);
  db.prepare(`INSERT INTO permission_groups(id,name,role_key,permissions_json)
    VALUES ('PGRP-MANAGER','Manager','manager',?)`).run(JSON.stringify(ROLE_PERMISSIONS.manager));
  db.prepare(`INSERT INTO sales_users
    (id,email,name,role,active,permission_group_id) VALUES
    ('U-ACTOR','actor@example.test','Actor','manager',1,'PGRP-MANAGER')`).run();
  const insertCustomer = db.prepare('INSERT INTO customer_pool(customer_id,company_name) VALUES (?,?)');
  const insertAccount = db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,assignment_status) VALUES (?,?,?,?,?)`);
  for (let index = 1; index <= customerCount; index += 1) {
    const customerId = `CUST-${index}`;
    insertCustomer.run(customerId, `Customer ${index}`);
    insertAccount.run(`ACC-${index}`, customerId, `Customer ${index}`, 'U-ACTOR', 'claimed');
  }
  let sequence = 0;
  const jobs = createAIJobStore(db, {
    executionResources: resources,
    idFactory: () => `AIJ-CONTROL-${++sequence}`,
  });
  return {
    db,
    dbPath,
    jobs,
    close() {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function enqueue(jobs, customerIndex, key) {
  return jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: `CUST-${customerIndex}`,
    crmAccountId: `ACC-${customerIndex}`,
    station: 'customer_fit',
    contextHash,
    createdBy: 'U-ACTOR',
  }, key);
}

function openStore(dbPath, options = {}) {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return { db, jobs: createAIJobStore(db, { executionResources: resources, ...options }) };
}

function runChild(code, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', exitCode => {
      if (exitCode === 0) resolve();
      else reject(new Error(stderr || `worker exited ${exitCode}`));
    });
  });
}

test('six Worker processes execute 20 cross-customer jobs once within the global slot limit', async t => {
  const fx = databaseFixture(20);
  t.after(() => fx.close());
  for (let index = 1; index <= 20; index += 1) enqueue(fx.jobs, index, `control:twenty:${index}`);
  const workerModule = path.join(__dirname, '..', 'lib', 'ai_stations', 'worker.js');
  const childCode = `
    const Database = require('better-sqlite3');
    const { createAIStationWorker } = require(process.env.AI_WORKER_MODULE);
    const resources = JSON.parse(process.env.AI_RESOURCES);
    const openDb = () => {
      const db = new Database(process.env.AI_DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 5000');
      db.pragma('foreign_keys = ON');
      return db;
    };
    const worker = createAIStationWorker({
      workerId: process.env.AI_WORKER_ID,
      openDb,
      jobStoreOptions: { executionResources: resources },
      executors: {
        customer_fit: async ({ db, jobId, workerId }) => {
          const active = db.prepare("SELECT COUNT(*) count FROM crm_ai_resource_slots WHERE resource='global' AND lease_expires_at>?")
            .get(new Date().toISOString()).count;
          db.prepare("UPDATE control_plane_test_metrics SET max_active=MAX(max_active,?) WHERE id='global'").run(active);
          db.prepare("INSERT INTO control_plane_test_events(job_id,worker_id,started_at) VALUES (?,?,?)")
            .run(jobId, workerId, Date.now());
          await new Promise(resolve => setTimeout(resolve, 30));
          db.prepare("UPDATE control_plane_test_events SET finished_at=? WHERE job_id=?").run(Date.now(), jobId);
          const updated = db.prepare("UPDATE crm_ai_jobs SET state='succeeded',lease_owner='',lease_expires_at='',finished_at=?,updated_at=? WHERE id=? AND state='running' AND lease_owner=?")
            .run(new Date().toISOString(), new Date().toISOString(), jobId, workerId);
          if (updated.changes !== 1) throw new Error('worker lost its lease');
          return { jobId };
        },
      },
    });
    (async () => {
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const check = openDb();
        const pending = check.prepare("SELECT COUNT(*) count FROM crm_ai_jobs WHERE state!='succeeded'").get().count;
        check.close();
        if (pending === 0) return;
        const outcome = await worker.runOnce();
        if (outcome.status === 'idle') await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error('worker loop exhausted before the queue drained');
    })().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
  `;
  await Promise.all(Array.from({ length: 6 }, (_, index) => runChild(childCode, {
    AI_WORKER_MODULE: workerModule,
    AI_DB_PATH: fx.dbPath,
    AI_RESOURCES: JSON.stringify(resources),
    AI_WORKER_ID: `process-worker-${index + 1}`,
  }, path.join(__dirname, '..'))));

  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_ai_jobs WHERE state='succeeded'").get().count, 20);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM control_plane_test_events').get().count, 20);
  assert.equal(fx.db.prepare('SELECT MAX(attempts) attempts FROM crm_ai_jobs').get().attempts, 1);
  assert.equal(fx.db.prepare("SELECT max_active FROM control_plane_test_metrics WHERE id='global'").get().max_active, 4);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_resource_slots').get().count, 0);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_customer_locks').get().count, 0);
});

test('customer lock serializes two jobs for the same customer across connections', t => {
  const fx = databaseFixture(1);
  t.after(() => fx.close());
  const first = enqueue(fx.jobs, 1, 'control:customer:first');
  const second = enqueue(fx.jobs, 1, 'control:customer:second');
  const one = openStore(fx.dbPath);
  const two = openStore(fx.dbPath);
  t.after(() => { one.db.close(); two.db.close(); });

  assert.equal(one.jobs.claimById(first.id, 'worker-one').id, first.id);
  assert.equal(two.jobs.claimById(second.id, 'worker-two'), null);
  one.db.prepare(`UPDATE crm_ai_jobs SET state='succeeded',lease_owner='',lease_expires_at='',
    finished_at=?,updated_at=? WHERE id=?`).run(new Date().toISOString(), new Date().toISOString(), first.id);
  assert.equal(two.jobs.claimById(second.id, 'worker-two').id, second.id);
});

test('lease recovery releases global, engine, and customer claims for another Worker', t => {
  const fx = databaseFixture(1);
  t.after(() => fx.close());
  const job = enqueue(fx.jobs, 1, 'control:lease');
  let current = new Date('2099-07-24T01:00:00.000Z');
  const one = openStore(fx.dbPath, { now: () => current, leaseMs: 1_000 });
  const two = openStore(fx.dbPath, { now: () => current, leaseMs: 1_000 });
  t.after(() => { one.db.close(); two.db.close(); });

  assert.equal(one.jobs.claimById(job.id, 'worker-one').state, 'running');
  assert.equal(one.jobs.acquireResource('deepseek', job.id, 'worker-one').acquired, true);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_resource_slots').get().count, 2);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_customer_locks').get().count, 1);
  current = new Date('2099-07-24T01:00:02.000Z');
  assert.equal(two.jobs.releaseExpiredLeases(), 1);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_resource_slots').get().count, 0);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_customer_locks').get().count, 0);
  assert.equal(two.jobs.claimById(job.id, 'worker-two').leaseOwner, 'worker-two');
});

test('resource rate window blocks excess claims and reopens on the next window', t => {
  const fx = databaseFixture(3);
  t.after(() => fx.close());
  let current = new Date('2026-07-24T02:00:00.000Z');
  const configured = openStore(fx.dbPath, {
    now: () => current,
    executionResources: {
      global: { maxConcurrency: 3, rateLimit: 2, rateWindowMs: 1_000 },
    },
  });
  t.after(() => configured.db.close());
  const jobs = [
    enqueue(configured.jobs, 1, 'control:rate:1'),
    enqueue(configured.jobs, 2, 'control:rate:2'),
    enqueue(configured.jobs, 3, 'control:rate:3'),
  ];
  for (const job of jobs.slice(0, 2)) {
    assert.equal(configured.jobs.claimById(job.id, `worker-${job.id}`).id, job.id);
    configured.db.prepare(`UPDATE crm_ai_jobs SET state='succeeded',lease_owner='',lease_expires_at='',
      finished_at=?,updated_at=? WHERE id=?`).run(current.toISOString(), current.toISOString(), job.id);
  }
  assert.equal(configured.jobs.claimById(jobs[2].id, 'worker-rate-limited'), null);
  current = new Date('2026-07-24T02:00:01.000Z');
  assert.equal(configured.jobs.claimById(jobs[2].id, 'worker-next-window').id, jobs[2].id);
});

test('engine slots are acquired at Router-call time and released independently of the job slot', t => {
  const fx = databaseFixture(2);
  t.after(() => fx.close());
  const first = enqueue(fx.jobs, 1, 'control:engine:1');
  const second = enqueue(fx.jobs, 2, 'control:engine:2');
  const one = openStore(fx.dbPath);
  const two = openStore(fx.dbPath);
  t.after(() => { one.db.close(); two.db.close(); });
  one.jobs.claimById(first.id, 'worker-one');
  two.jobs.claimById(second.id, 'worker-two');

  const acquired = one.jobs.acquireResource('deepseek', first.id, 'worker-one');
  assert.equal(acquired.acquired, true);
  assert.equal(acquired.releaseRequired, true);
  assert.equal(two.jobs.acquireResource('deepseek', second.id, 'worker-two').acquired, false);
  one.jobs.releaseResource('deepseek', first.id, 'worker-one');
  assert.equal(two.jobs.acquireResource('deepseek', second.id, 'worker-two').acquired, true);
});

test('fair dispatch gives another customer a turn before an earlier customer batch', t => {
  const fx = databaseFixture(2);
  t.after(() => fx.close());
  const first = enqueue(fx.jobs, 1, 'control:fair:first');
  enqueue(fx.jobs, 1, 'control:fair:second');
  const other = enqueue(fx.jobs, 2, 'control:fair:other');

  assert.equal(fx.jobs.claimNext('worker-first').id, first.id);
  fx.db.prepare(`UPDATE crm_ai_jobs SET state='succeeded',lease_owner='',lease_expires_at='',
    finished_at=?,updated_at=? WHERE id=?`).run(new Date().toISOString(), new Date().toISOString(), first.id);
  assert.equal(fx.jobs.claimNext('worker-fair').id, other.id);
});

test('Worker station mapping applies to jobs enqueued with the default station resource', t => {
  const fx = databaseFixture(2);
  t.after(() => fx.close());
  const first = enqueue(fx.jobs, 1, 'control:mapped:first');
  const second = enqueue(fx.jobs, 2, 'control:mapped:second');
  const mapped = openStore(fx.dbPath, {
    executionResources: {
      deepseek: { maxConcurrency: 1, rateLimit: 0, rateWindowMs: 60_000 },
    },
    resourceForStation: { customer_fit: 'deepseek' },
  });
  t.after(() => mapped.db.close());

  assert.equal(mapped.jobs.claimById(first.id, 'worker-mapped-one').id, first.id);
  assert.equal(mapped.jobs.claimById(second.id, 'worker-mapped-two'), null);
});
