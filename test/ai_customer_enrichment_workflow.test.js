'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { ROLE_PERMISSIONS } = require('../lib/access_control');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');
const {
  ENRICHMENT_NODE_KEYS,
  createEnrichmentWorkflow,
  dispatchPendingEnrichment,
} = require('../lib/ai_stations/enrichment/workflow');
const { createEnrichmentExecutors } = require('../lib/ai_stations/enrichment/executors');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createAIStationWorker } = require('../lib/ai_stations/worker');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-enrichment-workflow-'));
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
  db.prepare(`INSERT INTO permission_groups(id,name,role_key,permissions_json)
    VALUES ('PGRP-MANAGER','Enrichment manager','manager',?)`).run(JSON.stringify({
    ...ROLE_PERMISSIONS.manager,
    view_all_customers: false,
    view_contacts: true,
    view_recon: true,
    run_recon: true,
    use_ai_assistant: true,
  }));
  db.prepare(`INSERT INTO sales_users
    (id,email,name,role,active,permission_group_id)
    VALUES ('U-ACTOR','actor@example.test','Actor','manager',1,'PGRP-MANAGER')`).run();
  db.prepare("INSERT INTO customer_pool(customer_id,company_name) VALUES ('CUST-1','Fixture')").run();
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,assignment_status)
    VALUES ('ACC-1','CUST-1','Fixture','U-ACTOR','claimed')`).run();
  let enrichmentSequence = 0;
  const store = createCustomerEnrichmentStore(db, {
    idFactory: prefix => `${prefix}-${++enrichmentSequence}`,
    now: () => new Date('2026-07-24T08:00:00.000Z'),
  });

  function trigger(overrides = {}) {
    return store.createTrigger({
      customerId: 'CUST-1',
      crmAccountId: 'ACC-1',
      triggerSource: 'manual_create',
      triggeredBy: 'U-ACTOR',
      inputFingerprint: 'a'.repeat(64),
      pipelineVersion: 'v1',
      ...overrides,
    });
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

  return { db, dbPath, store, trigger, openDb, close };
}

test('eligible trigger creates one stable workflow and only the runnable precheck job', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const run = fx.trigger();

  const dispatched = await dispatchPendingEnrichment(fx.db, undefined, {
    dispatcherId: 'dispatcher-a',
    workflowIdFactory: claimed => `AEW-${claimed.id}`,
    jobIdFactory: () => 'AIJ-PRECHECK-1',
  });
  const replay = createEnrichmentWorkflow(fx.db, run, {
    workflowIdFactory: claimed => `AEW-${claimed.id}`,
    jobIdFactory: () => 'AIJ-PRECHECK-REPLAY',
  });

  assert.equal(dispatched.status, 'queued');
  assert.equal(dispatched.run.workflowId, `AEW-${run.id}`);
  assert.equal(replay.workflowId, dispatched.run.workflowId);
  const jobs = fx.db.prepare(`SELECT id,station,workflow_id,parent_job_id,idempotency_key
    FROM crm_ai_jobs ORDER BY created_at,id`).all();
  assert.deepEqual(jobs, [{
    id: 'AIJ-PRECHECK-1',
    station: 'intake_precheck',
    workflow_id: `AEW-${run.id}`,
    parent_job_id: null,
    idempotency_key: `enrichment:${run.id}:intake_precheck:v1`,
  }]);
  const links = fx.db.prepare(`SELECT node_key,ai_job_id FROM crm_ai_enrichment_node_links
    WHERE run_id=? ORDER BY created_at,id`).all(run.id);
  assert.deepEqual(new Set(links.map(row => row.node_key)), new Set(ENRICHMENT_NODE_KEYS));
  assert.equal(links.find(row => row.node_key === 'intake_precheck').ai_job_id, 'AIJ-PRECHECK-1');
  assert.equal(links.filter(row => row.node_key !== 'intake_precheck').every(row => row.ai_job_id === null), true);
});

test('competing dispatchers cannot duplicate a workflow or its jobs', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  fx.trigger();

  const first = await dispatchPendingEnrichment(fx.db, undefined, {
    dispatcherId: 'dispatcher-a',
    jobIdFactory: () => 'AIJ-PRECHECK-1',
  });
  const second = await dispatchPendingEnrichment(fx.db, undefined, {
    dispatcherId: 'dispatcher-b',
    jobIdFactory: () => 'AIJ-PRECHECK-2',
  });

  assert.equal(first.status, 'queued');
  assert.equal(second.status, 'idle');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_jobs').get().count, 1);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_enrichment_node_links').get().count,
    ENRICHMENT_NODE_KEYS.length);
});

test('dispatcher revalidates permissions and customer scope before creating jobs', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const permissionRun = fx.trigger();
  fx.db.prepare(`INSERT INTO user_permission_overrides(user_id,permission_key,effect)
    VALUES ('U-ACTOR','view_contacts','deny')`).run();

  const revoked = await dispatchPendingEnrichment(fx.db, undefined, { dispatcherId: 'dispatcher-a' });
  assert.equal(revoked.status, 'skipped');
  assert.equal(revoked.run.id, permissionRun.id);
  assert.equal(revoked.run.reasonCode, 'permission_revoked');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_jobs').get().count, 0);

  fx.db.prepare("DELETE FROM user_permission_overrides WHERE user_id='U-ACTOR'").run();
  fx.db.prepare("UPDATE crm_accounts SET owner_id='U-NOBODY' WHERE id='ACC-1'").run();
  fx.trigger({ inputFingerprint: 'b'.repeat(64) });
  const scopeRevoked = await dispatchPendingEnrichment(fx.db, undefined, { dispatcherId: 'dispatcher-b' });
  assert.equal(scopeRevoked.status, 'skipped');
  assert.equal(scopeRevoked.run.reasonCode, 'customer_scope_revoked');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_jobs').get().count, 0);
});

test('Worker beforeClaim dispatches one trigger and completes deterministic intake precheck', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const run = fx.trigger();
  let hookCalls = 0;
  const worker = createAIStationWorker({
    workerId: 'worker-enrichment',
    openDb: fx.openDb,
    beforeClaim: async ({ db, workerId }) => {
      hookCalls += 1;
      return dispatchPendingEnrichment(db, undefined, {
        dispatcherId: `${workerId}:dispatcher`,
        jobIdFactory: () => 'AIJ-PRECHECK-1',
      });
    },
    executors: createEnrichmentExecutors(),
  });

  const outcome = await worker.runOnce();

  assert.equal(hookCalls, 1);
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.job.station, 'intake_precheck');
  assert.equal(outcome.job.state, 'succeeded');
  assert.equal(fx.store.getRun(run.id).state, 'queued');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_jobs').get().count, 1);
});

test('deterministic job completion still requires the owning worker lease', t => {
  const fx = fixture();
  t.after(() => fx.close());
  const run = fx.trigger();
  const claimedRun = fx.store.claimTrigger('dispatcher-a');
  const workflow = createEnrichmentWorkflow(fx.db, claimedRun, {
    jobIdFactory: () => 'AIJ-PRECHECK-1',
  });
  fx.store.attachWorkflow(run.id, workflow.workflowId);
  const jobs = createAIJobStore(fx.db);
  const job = jobs.claimNext('worker-a');
  assert.throws(() => jobs.complete(job.id, 'worker-b'), /lease is not owned/);
  assert.equal(jobs.complete(job.id, 'worker-a').state, 'succeeded');
});
