'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { submitReconResult, claimReconJob } = require('../lib/db');
const { buildAccessContext } = require('../lib/access_control');
const { hydrateUserPermissions } = require('../lib/permission_groups');
const { buildCustomerContext } = require('../lib/ai_stations/context');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createAIBudgetStore } = require('../lib/ai_stations/budgets');
const { executeCustomerFitJob } = require('../lib/ai_stations/executor');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');
const { executeIdentityVerifyJob } = require('../lib/ai_stations/enrichment/identity');
const { createEnrichmentEvidenceStore } = require('../lib/ai_stations/enrichment/evidence');
const { createEnrichmentProposalStore } = require('../lib/ai_stations/enrichment/proposals');
const { findExactDuplicate } = require('../lib/ai_stations/enrichment/dedupe');
const { dispatchPendingEnrichment } = require('../lib/ai_stations/enrichment/workflow');
const { createCustomerEnrichmentRouteService } = require('../lib/ai_stations/enrichment/routes');

const FULL = {
  view_customers: true,
  use_ai_assistant: true,
  run_recon: true,
  view_recon: true,
  view_contacts: true,
  cancel_ai_tasks: true,
};

function actorAndScope(db) {
  const actor = hydrateUserPermissions(db, db.prepare("SELECT * FROM sales_users WHERE id='U-MGR'").get());
  return { actor, accessContext: buildAccessContext(db, actor) };
}

function createRun(db, suffix) {
  const store = createCustomerEnrichmentStore(db, {
    idFactory: prefix => `${prefix}-${suffix}`,
  });
  const run = store.createTrigger({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    triggerSource: 'manual_rerun',
    triggeredBy: 'U-MGR',
    inputFingerprint: suffix.padEnd(64, 'f').slice(0, 64),
    pipelineVersion: `failure-${suffix}`,
  });
  return { store, run };
}

test('trigger, event, AI job, and legacy task leases all recover after expiry', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: FULL });
  t.after(() => fx.close());
  let current = new Date('2026-07-24T07:00:00.000Z');
  const store = createCustomerEnrichmentStore(fx.db, {
    now: () => current,
    leaseMs: 1_000,
    idFactory: prefix => `${prefix}-RECOVERY`,
  });
  const run = store.createTrigger({
    customerId: 'RU-9002', crmAccountId: 'CRM-OWN', triggerSource: 'manual_rerun',
    triggeredBy: 'U-MGR', inputFingerprint: '1'.repeat(64), pipelineVersion: 'recovery-v1',
  });
  assert.equal(store.claimTrigger('dispatcher-a').dispatchOwner, 'dispatcher-a');
  current = new Date('2026-07-24T07:00:02.000Z');
  assert.equal(store.claimTrigger('dispatcher-b').dispatchOwner, 'dispatcher-b');
  store.recordEvent({
    eventKey: 'failure:lease:event',
    runId: run.id,
    nodeKey: 'recon_dispatch',
    legacyTaskType: 'recon',
    legacyTaskId: 'LEASE-RECOVERY',
    eventType: 'completed',
    payloadHash: 'a'.repeat(64),
  });
  assert.equal(store.claimEvent('consumer-a').leaseOwner, 'consumer-a');
  current = new Date('2026-07-24T07:00:04.000Z');
  assert.equal(store.claimEvent('consumer-b').leaseOwner, 'consumer-b');

  const jobs = createAIJobStore(fx.db, { now: () => current, leaseMs: 1_000 });
  const job = jobs.enqueue({
    customerId: 'RU-9002', crmAccountId: 'CRM-OWN', station: 'intake_precheck',
    executionResource: 'deterministic', contextHash: 'b'.repeat(64), createdBy: 'U-MGR',
  }, 'failure:lease:ai-job');
  assert.equal(jobs.claimById(job.id, 'worker-a').leaseOwner, 'worker-a');
  current = new Date('2026-07-24T07:00:06.000Z');
  assert.equal(jobs.releaseExpiredLeases(), 1);
  assert.equal(jobs.claimById(job.id, 'worker-b').leaseOwner, 'worker-b');

  fx.db.prepare(`INSERT INTO recon_jobs
    (job_id,customer_id,company_name,status,worker_id,lease_expires_at,requested_at,updated_at)
    VALUES ('LEASE-RECOVERY','RU-9002','Owned Fixture','running','legacy-a',
      '2000-01-01 00:00:00','2026-07-24 07:00:00','2026-07-24 07:00:00')`).run();
  assert.equal(claimReconJob({ worker_id: 'legacy-b', lease_seconds: 60 }).job.worker_id, 'legacy-b');
});

test('429, timeout, fallback, permanent failure, and budget block retain governed accounting', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: FULL });
  t.after(() => fx.close());
  const { actor, accessContext } = actorAndScope(fx.db);
  const context = buildCustomerContext(fx.db, accessContext, 'RU-9002');
  const jobs = createAIJobStore(fx.db);
  let sequence = 0;

  async function execute(kind, options = {}) {
    const job = jobs.enqueue({
      customerId: 'RU-9002',
      crmAccountId: 'CRM-OWN',
      station: 'customer_fit',
      contextHash: context.contextHash,
      createdBy: 'U-MGR',
      maxAttempts: options.maxAttempts || 3,
    }, `failure:model:${kind}:${++sequence}`);
    jobs.claimById(job.id, `worker-${kind}`);
    const input = {
      db: fx.db,
      jobs,
      jobId: job.id,
      workerId: `worker-${kind}`,
      accessContext,
      actor: {
        id: actor.id,
        role: actor.role,
        permissions: Object.entries(actor.permissions).filter(([, value]) => value).map(([key]) => key),
      },
    };
    if (kind === 'fallback') {
      const result = await executeCustomerFitJob({
        ...input,
        modelCall: async messages => ({
          answer: JSON.stringify({
            version: 'v1',
            confidence: 0.88,
            evidenceIds: JSON.parse(messages[1].content).evidence.slice(0, 2).map(item => item.id),
            reasonCodes: ['PRODUCT_MATCH'],
            fitScore: 82,
            grade: 'B',
            reviewRequired: false,
          }),
          engine: 'fallback-engine',
          model: 'fallback-model',
          usage: { input_tokens: 80, output_tokens: 20 },
          cost: 0.001,
          engineAttempts: [
            { engine: 'primary-engine', model: 'primary-model', ok: false, code: 'PROVIDER_RATE_LIMIT' },
            { engine: 'fallback-engine', model: 'fallback-model', ok: true, usage: { input_tokens: 80, output_tokens: 20 }, cost: 0.001 },
          ],
        }),
      });
      return { job: jobs.getJob(job.id), result };
    }
    const error = new Error(kind === 'timeout' ? 'provider timed out' : `${kind} provider failed`);
    error.code = kind === 'rate-limit' ? 'PROVIDER_RATE_LIMIT'
      : kind === 'timeout' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_PERMANENT';
    error.engine = 'primary-engine';
    error.engineAttempts = [{ engine: 'primary-engine', model: 'primary-model', ok: false, code: error.code }];
    await assert.rejects(() => executeCustomerFitJob({
      ...input,
      modelCall: async () => { throw error; },
    }), new RegExp(kind === 'timeout' ? 'timed out' : 'failed'));
    return { job: jobs.getJob(job.id) };
  }

  assert.equal((await execute('rate-limit')).job.state, 'retry_wait');
  assert.equal((await execute('timeout')).job.state, 'retry_wait');
  const fallback = await execute('fallback');
  assert.equal(fallback.job.state, 'succeeded');
  assert.equal(fallback.result.engine, 'fallback-engine');
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_usage_ledger
    WHERE job_id=?`).get(fallback.job.id).count, 2);
  assert.equal((await execute('permanent', { maxAttempts: 1 })).job.state, 'dead_letter');

  const budgets = createAIBudgetStore(fx.db);
  budgets.setPolicy({
    scopeType: 'station',
    scopeId: 'customer_fit',
    dailyLimit: 10,
    monthlyLimit: 10,
    perTaskLimit: 0.001,
  });
  assert.throws(() => budgets.reserve({
    jobId: 'BUDGET-BLOCK',
    attempt: 1,
    actorId: 'U-MGR',
    station: 'customer_fit',
  }), error => error.code === 'AI_BUDGET_EXHAUSTED');
});

test('exact duplicate, uncertain identity, no contacts, and evidence conflict route conservatively', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: FULL });
  t.after(() => fx.close());
  assert.equal(findExactDuplicate(fx.db, { companyName: 'Owned Fixture' }).customerId, 'RU-9002');

  const uncertain = createRun(fx.db, 'UNCERTAIN');
  const claimed = uncertain.store.claimTrigger('identity-dispatcher');
  uncertain.store.attachWorkflow(claimed.id, 'AIW-UNCERTAIN');
  const jobs = createAIJobStore(fx.db, { idFactory: () => 'AIJ-UNCERTAIN' });
  const identity = jobs.enqueue({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    station: 'identity_verify',
    executionResource: 'deterministic',
    contextHash: claimed.inputFingerprint,
    workflowId: 'AIW-UNCERTAIN',
    createdBy: 'U-MGR',
    payload: { enrichmentRunId: claimed.id },
  }, 'failure:identity:uncertain');
  jobs.claimById(identity.id, 'identity-worker');
  const identityResult = await executeIdentityVerifyJob({
    db: fx.db,
    jobs,
    jobId: identity.id,
    workerId: 'identity-worker',
    identityResolver: async () => null,
  });
  assert.equal(identityResult.reasonCode, 'identity_uncertain');
  assert.equal(identityResult.run.state, 'needs_review');

  const missing = createRun(fx.db, 'NO-CONTACT');
  fx.db.prepare(`UPDATE customer_pool SET website='https://owned.example',country='RU',
    industry='电力电子',customer_type='终端制造商',products='MCU',description='Factory',
    best_contact_level='L0' WHERE customer_id='RU-9002'`).run();
  assert.equal(createEnrichmentProposalStore(fx.db).finalize(missing.run.id).routeState, 'missing_info');

  const conflict = createRun(fx.db, 'CONFLICT');
  const evidenceStore = createEnrichmentEvidenceStore(fx.db);
  const firstEvidence = evidenceStore.recordEvidence({
    customerId: 'RU-9002', runId: conflict.run.id, nodeKey: 'recon_collect',
    sourceUrl: 'https://owned.example/a', sourceType: 'official',
    collectedAt: '2026-07-24T07:10:00.000Z', summary: 'source a', content: 'a',
    confidence: 0.9, collector: 'test', collectorVersion: 'v1',
  });
  const secondEvidence = evidenceStore.recordEvidence({
    customerId: 'RU-9002', runId: conflict.run.id, nodeKey: 'recon_collect',
    sourceUrl: 'https://owned.example/b', sourceType: 'registry',
    collectedAt: '2026-07-24T07:11:00.000Z', summary: 'source b', content: 'b',
    confidence: 0.9, collector: 'test', collectorVersion: 'v1',
  });
  fx.db.prepare("UPDATE customer_pool SET industry='' WHERE customer_id='RU-9002'").run();
  const proposals = createEnrichmentProposalStore(fx.db);
  assert.equal(proposals.propose({
    runId: conflict.run.id, fieldName: 'industry', proposedValue: '电力电子',
    evidenceIds: [firstEvidence.id], confidence: 0.9,
  }).state, 'auto_applied');
  const competing = proposals.propose({
    runId: conflict.run.id, fieldName: 'industry', proposedValue: '汽车电子',
    evidenceIds: [secondEvidence.id], confidence: 0.9,
  });
  assert.equal(competing.state, 'needs_review');
  assert.equal(competing.reasonCode, 'reliable_source_conflict');
});

test('permission revocation and owner scope change skip queued triggers before work creation', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: FULL });
  t.after(() => fx.close());
  createRun(fx.db, 'PERMISSION');
  fx.setUserPermissions('U-MGR', { view_contacts: false });
  const permission = await dispatchPendingEnrichment(fx.db, undefined, { dispatcherId: 'revoked' });
  assert.equal(permission.run.reasonCode, 'permission_revoked');
  fx.setUserPermissions('U-MGR', { view_contacts: true });
  createRun(fx.db, 'SCOPE');
  fx.db.prepare("UPDATE crm_accounts SET owner_id='U-OTHER' WHERE id='CRM-OWN'").run();
  const scope = await dispatchPendingEnrichment(fx.db, undefined, { dispatcherId: 'scope' });
  assert.equal(scope.run.reasonCode, 'customer_scope_revoked');
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_jobs
    WHERE workflow_id LIKE 'AEW-%'`).get().count, 0);
});

test('cancellation wins over a late Recon result and preserves evidence without proposals or events', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: FULL });
  t.after(() => fx.close());
  const linked = createRun(fx.db, 'LATE');
  const jobs = createAIJobStore(fx.db, { idFactory: () => 'AIJ-LATE' });
  const dispatch = jobs.enqueue({
    customerId: 'RU-9002', crmAccountId: 'CRM-OWN', station: 'recon_dispatch',
    executionResource: 'deterministic', contextHash: linked.run.inputFingerprint,
    workflowId: 'AIW-LATE', createdBy: 'U-MGR',
    payload: { enrichmentRunId: linked.run.id },
  }, 'failure:late:dispatch');
  jobs.complete(jobs.claimById(dispatch.id, 'late-worker').id, 'late-worker');
  fx.db.prepare(`INSERT INTO recon_jobs
    (job_id,customer_id,company_name,status,requested_at,updated_at)
    VALUES ('RECON-LATE','RU-9002','Owned Fixture','running',
      '2026-07-24 07:20:00','2026-07-24 07:20:00')`).run();
  linked.store.linkNode({
    runId: linked.run.id,
    nodeKey: 'recon_dispatch',
    aiJobId: dispatch.id,
    legacyTaskType: 'recon',
    legacyTaskId: 'RECON-LATE',
  });
  const { accessContext } = actorAndScope(fx.db);
  const cancelled = createCustomerEnrichmentRouteService({
    flags: { enabled: true, autoTriggerEnabled: true },
  }).cancel({ db: fx.db, accessContext, runId: linked.run.id });
  assert.equal(cancelled.run.state, 'cancelled');

  const late = submitReconResult({
    job_id: 'RECON-LATE',
    result: { company_name: 'Owned Fixture', website: 'https://late.example' },
    evidence: [{
      field_name: 'website', value: 'https://late.example',
      source_url: 'https://late.example/about',
      checked_at: '2026-07-24T07:21:00.000Z', confidence: 'high',
    }],
  }, { db: fx.db });
  assert.equal(late.late_result, true);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_enrichment_events
    WHERE run_id=?`).get(linked.run.id).count, 0);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_field_proposals
    WHERE run_id=?`).get(linked.run.id).count, 0);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM recon_evidence
    WHERE job_id='RECON-LATE'`).get().count, 1);
});
