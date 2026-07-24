'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { submitReconResult, submitContactReconResult } = require('../lib/db');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');
const { consumePendingEnrichmentEvent } = require('../lib/ai_stations/enrichment/events');

function setupLinkedRecon(db, suffix) {
  let sequence = 0;
  const store = createCustomerEnrichmentStore(db, {
    idFactory: prefix => `${prefix}-${suffix}-${++sequence}`,
  });
  const run = store.createTrigger({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    triggerSource: 'manual_create',
    triggeredBy: 'U-MGR',
    inputFingerprint: suffix.padEnd(64, 'a').slice(0, 64),
    pipelineVersion: 'v1',
  });
  const jobs = createAIJobStore(db, { idFactory: () => `AIJ-DISPATCH-${suffix}` });
  const dispatch = jobs.enqueue({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    station: 'recon_dispatch',
    executionResource: 'deterministic',
    contextHash: run.inputFingerprint,
    workflowId: `AIW-${suffix}`,
    createdBy: 'U-MGR',
    payload: { enrichmentRunId: run.id, pipelineVersion: 'v1' },
  }, `test:event:dispatch:${suffix}`);
  jobs.complete(jobs.claimById(dispatch.id, 'worker-a').id, 'worker-a');
  const legacyJobId = `RECON-EVENT-${suffix}`;
  db.prepare(`INSERT INTO recon_jobs
    (job_id,customer_id,company_name,status,requested_at,updated_at)
    VALUES (?,?,'Owned Fixture','running','2026-07-24 04:00:00','2026-07-24 04:00:00')`)
    .run(legacyJobId, 'RU-9002');
  store.linkNode({
    runId: run.id,
    nodeKey: 'recon_dispatch',
    aiJobId: dispatch.id,
    legacyTaskType: 'recon',
    legacyTaskId: legacyJobId,
  });
  for (const nodeKey of ['recon_collect', 'contact_dispatch', 'contact_collect']) {
    store.linkNode({ runId: run.id, nodeKey });
  }
  return { store, run, jobs, dispatch, legacyJobId };
}

function reconPayload(jobId) {
  return {
    job_id: jobId,
    result: {
      company_name: 'Owned Fixture',
      website: 'https://owned.example',
      opportunity_summary: 'Evidence-backed opportunity',
    },
    evidence: [{
      field_name: 'website',
      value: 'https://owned.example',
      source_url: 'https://owned.example/about',
      source_title: 'About',
      checked_at: '2026-07-24T04:00:00.000Z',
      confidence: 'high',
    }],
  };
}

test('Recon completion and enrichment event commit together and duplicate callbacks stay singular', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const linked = setupLinkedRecon(fx.db, 'TX');

  submitReconResult(reconPayload(linked.legacyJobId), { db: fx.db });
  submitReconResult(reconPayload(linked.legacyJobId), { db: fx.db });

  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM recon_results WHERE job_id=?')
    .get(linked.legacyJobId).count, 1);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_enrichment_events WHERE legacy_task_id=?')
    .get(linked.legacyJobId).count, 1);
  assert.equal(fx.db.prepare('SELECT adapter_state state FROM crm_ai_enrichment_node_links WHERE legacy_task_id=?')
    .get(linked.legacyJobId).state, 'completed');
});

test('event insert failure rolls back the legacy result and job completion', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const linked = setupLinkedRecon(fx.db, 'ROLLBACK');
  fx.db.exec(`CREATE TEMP TRIGGER reject_enrichment_event
    BEFORE INSERT ON crm_ai_enrichment_events
    BEGIN SELECT RAISE(ABORT, 'event rejected'); END`);

  assert.throws(() => submitReconResult(reconPayload(linked.legacyJobId), { db: fx.db }), /event rejected/);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM recon_results WHERE job_id=?')
    .get(linked.legacyJobId).count, 0);
  assert.equal(fx.db.prepare('SELECT status FROM recon_jobs WHERE job_id=?')
    .get(linked.legacyJobId).status, 'running');
});

test('Contact Recon completion records its linked event in the same transaction', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const linked = setupLinkedRecon(fx.db, 'CONTACT');
  const jobs = createAIJobStore(fx.db, { idFactory: () => 'AIJ-CONTACT-CONTACT' });
  const dispatch = jobs.enqueue({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    station: 'contact_dispatch',
    executionResource: 'deterministic',
    contextHash: linked.run.inputFingerprint,
    workflowId: 'AIW-CONTACT',
    createdBy: 'U-MGR',
    payload: { enrichmentRunId: linked.run.id, pipelineVersion: 'v1' },
  }, 'test:event:contact:dispatch');
  jobs.complete(jobs.claimById(dispatch.id, 'worker-a').id, 'worker-a');
  const contactJobId = 'CONTACT-EVENT-TX';
  fx.db.prepare(`INSERT INTO contact_recon_jobs
    (job_id,customer_id,company_name,status,created_at,updated_at)
    VALUES (?,'RU-9002','Owned Fixture','running','2026-07-24 04:00:00','2026-07-24 04:00:00')`)
    .run(contactJobId);
  linked.store.linkNode({
    runId: linked.run.id,
    nodeKey: 'contact_dispatch',
    aiJobId: dispatch.id,
    legacyTaskType: 'contact_recon',
    legacyTaskId: contactJobId,
  });
  const result = {
    schema_version: 'contact-recon-v1',
    job_id: contactJobId,
    customer_id: 'RU-9002',
    target_roles: ['procurement'],
    people: [],
    company_entry_points: [{
      type: 'email',
      value: 'sales@example.test',
      discovery_type: 'company_generic',
      verification_status: 'verified',
      source_url: 'https://owned.example/contact',
    }],
    evidence: [],
  };

  submitContactReconResult({ job_id: contactJobId, result }, { db: fx.db });

  assert.equal(fx.db.prepare('SELECT status FROM contact_recon_jobs WHERE job_id=?')
    .get(contactJobId).status, 'done');
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_enrichment_events
    WHERE legacy_task_type='contact_recon' AND legacy_task_id=?`).get(contactJobId).count, 1);
  const consumed = consumePendingEnrichmentEvent(fx.db, 'contact-consumer');
  assert.deepEqual(consumed.jobs.map(job => job.station), [
    'contact_collect',
    'customer_fit',
  ]);
  assert.deepEqual(consumed.jobs[1].dependencyIds, [consumed.jobs[0].id]);
});

test('expired event lease recovers and idempotently creates collect plus contact dispatch jobs', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const linked = setupLinkedRecon(fx.db, 'RECOVER');
  let current = new Date('2026-07-24T04:00:00.000Z');
  const store = createCustomerEnrichmentStore(fx.db, {
    now: () => current,
    leaseMs: 1_000,
    idFactory: prefix => `${prefix}-RECOVER-EVENT`,
  });
  store.recordEvent({
    eventKey: `recon:${linked.legacyJobId}:completed:v1`,
    runId: linked.run.id,
    nodeKey: 'recon_dispatch',
    legacyTaskType: 'recon',
    legacyTaskId: linked.legacyJobId,
    eventType: 'completed',
    payloadHash: 'c'.repeat(64),
  });
  assert.equal(store.claimEvent('crashed-consumer').leaseOwner, 'crashed-consumer');
  current = new Date('2026-07-24T04:00:02.000Z');

  const recovered = consumePendingEnrichmentEvent(fx.db, 'consumer-b', {
    storeOptions: { now: () => current, leaseMs: 1_000 },
  });
  assert.equal(recovered.event.state, 'consumed');
  assert.deepEqual(recovered.jobs.map(job => job.station), ['recon_collect', 'contact_dispatch']);
  assert.equal(consumePendingEnrichmentEvent(fx.db, 'consumer-b', {
    storeOptions: { now: () => current, leaseMs: 1_000 },
  }), null);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_jobs
    WHERE workflow_id=? AND station IN ('recon_collect','contact_dispatch')`).get(`AIW-RECOVER`).count, 2);
});
