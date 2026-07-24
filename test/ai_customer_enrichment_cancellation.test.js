'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');
const {
  heartbeatContactReconJob,
  submitReconResult,
  submitContactReconResult,
} = require('../lib/db');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');
const { propagateLegacyCancellation } = require('../lib/ai_stations/enrichment/adapters');

function linkedDispatch(db, suffix, legacyTaskType, legacyTaskId) {
  let sequence = 0;
  const store = createCustomerEnrichmentStore(db, {
    idFactory: prefix => `${prefix}-${suffix}-${++sequence}`,
  });
  const run = store.createTrigger({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    triggerSource: 'manual_create',
    triggeredBy: 'U-MGR',
    inputFingerprint: suffix.padEnd(64, 'f').slice(0, 64),
    pipelineVersion: 'v1',
  });
  const jobs = createAIJobStore(db, { idFactory: () => `AIJ-CANCEL-${suffix}` });
  const station = legacyTaskType === 'recon' ? 'recon_dispatch' : 'contact_dispatch';
  const job = jobs.enqueue({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    station,
    executionResource: 'deterministic',
    contextHash: run.inputFingerprint,
    workflowId: `AIW-${suffix}`,
    createdBy: 'U-MGR',
    payload: { enrichmentRunId: run.id },
  }, `test:cancel:${suffix}`);
  jobs.complete(jobs.claimById(job.id, 'worker-a').id, 'worker-a');
  store.linkNode({
    runId: run.id,
    nodeKey: station,
    aiJobId: job.id,
    legacyTaskType,
    legacyTaskId,
  });
  return { store, run, jobs, job };
}

test('legacy queue schema carries durable cancellation timestamps', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  for (const table of ['recon_jobs', 'contact_recon_jobs']) {
    const columns = new Set(fx.db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    assert.equal(columns.has('cancel_requested_at'), true);
    assert.equal(columns.has('cancelled_at'), true);
  }
});

test('cancelling a completed adapter cancels queued legacy work through the authorized API', async t => {
  const fx = await fixtures.seededFixture({
    permissions: { view_customers: true, cancel_ai_tasks: true },
  });
  t.after(() => fx.close());
  const legacyJobId = 'RECON-CANCEL-QUEUED';
  fx.db.prepare(`INSERT INTO recon_jobs
    (job_id,customer_id,company_name,status,requested_at,updated_at)
    VALUES (?,'RU-9002','Owned Fixture','queued','2026-07-24 04:00:00','2026-07-24 04:00:00')`)
    .run(legacyJobId);
  const linked = linkedDispatch(fx.db, 'QUEUED', 'recon', legacyJobId);

  const response = await fx.request(`/api/sales-crm/ai/jobs/${linked.job.id}/cancel`, {
    cookie: fx.cookie,
    method: 'POST',
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).job.state, 'cancelled');
  const legacy = fx.db.prepare('SELECT status,cancel_requested_at,cancelled_at FROM recon_jobs WHERE job_id=?')
    .get(legacyJobId);
  assert.equal(legacy.status, 'cancelled');
  assert.notEqual(legacy.cancel_requested_at, '');
  assert.notEqual(legacy.cancelled_at, '');
});

test('running legacy work observes cancellation on heartbeat and releases its lease', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const legacyJobId = 'CONTACT-CANCEL-RUNNING';
  fx.db.prepare(`INSERT INTO contact_recon_jobs
    (job_id,customer_id,company_name,status,stage,worker_id,lease_expires_at,created_at,updated_at)
    VALUES (?,'RU-9002','Owned Fixture','running','researching','contact-worker',
      '2026-07-24 06:00:00','2026-07-24 04:00:00','2026-07-24 04:00:00')`).run(legacyJobId);
  const linked = linkedDispatch(fx.db, 'RUNNING', 'contact_recon', legacyJobId);

  const propagation = propagateLegacyCancellation(fx.db, linked.job.id);
  assert.equal(propagation.state, 'cancel_requested');
  const heartbeat = heartbeatContactReconJob({
    job_id: legacyJobId,
    worker_id: 'contact-worker',
  });
  assert.equal(heartbeat.cancel_requested, true);
  const legacy = fx.db.prepare('SELECT status,lease_expires_at,cancelled_at FROM contact_recon_jobs WHERE job_id=?')
    .get(legacyJobId);
  assert.equal(legacy.status, 'cancelled');
  assert.equal(legacy.lease_expires_at, '');
  assert.notEqual(legacy.cancelled_at, '');
});

test('late Recon callback after cancellation stores evidence without mutating customer fields', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const legacyJobId = 'RECON-CANCEL-LATE';
  fx.db.prepare(`INSERT INTO recon_jobs
    (job_id,customer_id,company_name,status,cancel_requested_at,requested_at,updated_at)
    VALUES (?,'RU-9002','Owned Fixture','running','2026-07-24 04:01:00',
      '2026-07-24 04:00:00','2026-07-24 04:01:00')`).run(legacyJobId);
  linkedDispatch(fx.db, 'LATE', 'recon', legacyJobId);

  const response = submitReconResult({
    job_id: legacyJobId,
    result: {
      company_name: 'Owned Fixture',
      website: 'https://late-result.example',
      opportunity_summary: 'must remain evidence only',
    },
    evidence: [{
      field_name: 'website',
      value: 'https://late-result.example',
      source_url: 'https://late-result.example/about',
      checked_at: '2026-07-24T04:02:00.000Z',
      confidence: 'high',
    }],
  }, { db: fx.db });

  assert.equal(response.late_result, true);
  assert.equal(fx.db.prepare('SELECT website FROM customer_pool WHERE customer_id=?').get('RU-9002').website, '');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM recon_evidence WHERE job_id=?')
    .get(legacyJobId).count, 1);
  assert.equal(fx.db.prepare('SELECT status FROM recon_jobs WHERE job_id=?').get(legacyJobId).status, 'cancelled');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_enrichment_events WHERE legacy_task_id=?')
    .get(legacyJobId).count, 0);
});

test('late Contact Recon callback keeps raw evidence but does not publish people or best-contact fields', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const legacyJobId = 'CONTACT-CANCEL-LATE';
  fx.db.prepare(`INSERT INTO contact_recon_jobs
    (job_id,customer_id,company_name,status,cancel_requested_at,created_at,updated_at)
    VALUES (?,'RU-9002','Owned Fixture','running','2026-07-24 04:01:00',
      '2026-07-24 04:00:00','2026-07-24 04:01:00')`).run(legacyJobId);
  linkedDispatch(fx.db, 'CONTACT-LATE', 'contact_recon', legacyJobId);
  const result = {
    schema_version: 'contact-recon-v1',
    job_id: legacyJobId,
    customer_id: 'RU-9002',
    people: [{
      person_id: 'P1',
      full_name: 'Иванов Иван Иванович',
      role_category: 'procurement',
      decision_role: 'decision_maker',
      employment: { status: 'verified_current', confidence: 90 },
      methods: [],
    }],
    evidence: [{
      evidence_id: 'E1',
      person_id: 'P1',
      evidence_type: 'official_page',
      field_name: 'employment',
      value: 'Procurement Director',
      source_url: 'https://owned.example/team',
      checked_at: '2026-07-24T04:02:00.000Z',
      supports_current_employment: true,
      supports_decision_role: true,
    }],
  };

  const response = submitContactReconResult({ job_id: legacyJobId, result }, { db: fx.db });

  assert.equal(response.late_result, true);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM person_candidates WHERE contact_recon_job_id=?')
    .get(legacyJobId).count, 0);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM person_evidence WHERE contact_recon_job_id=?')
    .get(legacyJobId).count, 1);
  const pool = fx.db.prepare(`SELECT best_contact_level,best_person_id
    FROM customer_pool WHERE customer_id='RU-9002'`).get();
  assert.deepEqual(pool, { best_contact_level: 'L0', best_person_id: '' });
});

test('both Python legacy workers compile with cancellation safe points', () => {
  const root = path.resolve(__dirname, '..');
  const result = spawnSync('python3', [
    '-m', 'py_compile',
    path.join(root, 'scripts/recon_agent_worker.py'),
    path.join(root, 'scripts/contact_recon_worker.py'),
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const file of ['scripts/recon_agent_worker.py', 'scripts/contact_recon_worker.py']) {
    const source = require('node:fs').readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /JobCancelled/);
    assert.match(source, /cancel_requested/);
  }
});
