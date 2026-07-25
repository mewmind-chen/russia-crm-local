'use strict';

const { createAIJobStore } = require('../jobs');
const { buildCustomerContext } = require('../context');
const { createCustomerEnrichmentStore } = require('./store');
const { createEnrichmentEvidenceStore } = require('./evidence');
const { createEnrichmentProposalStore } = require('./proposals');

function eventStations(type) {
  if (type === 'recon') {
    return { collect: 'recon_collect', nextDispatch: 'contact_dispatch' };
  }
  if (type === 'contact_recon') return { collect: 'contact_collect', nextDispatch: '' };
  throw new Error(`unsupported enrichment legacy task type: ${type}`);
}

function consumePendingEnrichmentEvent(db, consumerId, options = {}) {
  const store = createCustomerEnrichmentStore(db, options.storeOptions);
  const event = store.claimEvent(consumerId);
  if (!event) return null;
  const stations = eventStations(event.legacyTaskType);
  const jobs = createAIJobStore(db, options.jobStoreOptions);
  const run = store.getRun(event.runId);
  const dispatchLink = db.prepare(`SELECT * FROM crm_ai_enrichment_node_links
    WHERE run_id=? AND legacy_task_type=? AND legacy_task_id=?`).get(
    event.runId, event.legacyTaskType, event.legacyTaskId,
  );
  const dispatch = dispatchLink?.ai_job_id ? jobs.getJob(dispatchLink.ai_job_id) : null;
  if (!run || !dispatch) throw new Error('enrichment completion event has no dispatch job');

  const collect = jobs.enqueue({
    customerId: run.customerId,
    crmAccountId: run.crmAccountId,
    station: stations.collect,
    executionResource: 'deterministic',
    contextHash: run.inputFingerprint,
    workflowId: dispatch.workflowId,
    trigger: {
      source: 'workflow',
      workflowId: dispatch.workflowId,
      eventType: 'legacy_completed',
      eventId: event.id,
      actorId: run.triggeredBy,
      reason: 'customer_enrichment_completion_event',
    },
    parentJobId: dispatch.id,
    dependsOn: [dispatch.id],
    eventType: 'legacy_completed',
    eventId: event.id,
    createdBy: run.triggeredBy,
    payload: {
      enrichmentRunId: run.id,
      legacyTaskType: event.legacyTaskType,
      legacyTaskId: event.legacyTaskId,
      eventKey: event.eventKey,
    },
  }, `enrichment:${run.id}:${stations.collect}:${event.eventKey}`);
  store.linkNode({ runId: run.id, nodeKey: stations.collect, aiJobId: collect.id });

  const created = [collect];
  if (stations.nextDispatch) {
    const next = jobs.enqueue({
      customerId: run.customerId,
      crmAccountId: run.crmAccountId,
      station: stations.nextDispatch,
      executionResource: 'deterministic',
      contextHash: run.inputFingerprint,
      workflowId: dispatch.workflowId,
      trigger: {
        source: 'workflow',
        workflowId: dispatch.workflowId,
        actorId: run.triggeredBy,
        reason: 'customer_enrichment_next_node',
      },
      parentJobId: collect.id,
      dependsOn: [collect.id],
      createdBy: run.triggeredBy,
      payload: {
        enrichmentRunId: run.id,
        pipelineVersion: run.pipelineVersion,
      },
    }, `enrichment:${run.id}:${stations.nextDispatch}:${run.pipelineVersion}`);
    store.linkNode({ runId: run.id, nodeKey: stations.nextDispatch, aiJobId: next.id });
    created.push(next);
  } else {
    const context = buildCustomerContext(db, {
      permissions: { view_customers: true, view_recon: true, view_contacts: true },
      accountIds: new Set([run.crmAccountId]),
      externalCustomerIds: new Set([run.customerId]),
    }, run.customerId);
    const fit = jobs.enqueue({
      customerId: run.customerId,
      crmAccountId: run.crmAccountId,
      station: 'customer_fit',
      contextHash: context.contextHash,
      workflowId: dispatch.workflowId,
      trigger: {
        source: 'workflow',
        workflowId: dispatch.workflowId,
        actorId: run.triggeredBy,
        reason: 'customer_enrichment_customer_fit',
      },
      parentJobId: collect.id,
      dependsOn: [collect.id],
      createdBy: run.triggeredBy,
      payload: { enrichmentRunId: run.id, pipelineVersion: run.pipelineVersion },
    }, `enrichment:${run.id}:customer_fit:${run.pipelineVersion}`);
    store.linkNode({ runId: run.id, nodeKey: 'customer_fit', aiJobId: fit.id });
    created.push(fit);
  }
  return Object.freeze({
    event: store.completeEvent(event.eventKey, consumerId),
    jobs: Object.freeze(created),
  });
}

function normalizedTimestamp(value) {
  const selected = String(value || '').trim();
  if (!selected) return new Date().toISOString();
  const parsed = new Date(selected.includes('T') ? selected : `${selected.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function numericConfidence(value) {
  const selected = Number(value);
  if (Number.isFinite(selected)) return Math.max(0, Math.min(selected > 1 ? selected / 100 : selected, 1));
  return ({ low: 0.35, medium: 0.65, high: 0.9 })[String(value || '').toLowerCase()] || 0.5;
}

function executeReconCollectJob({ db, jobs, jobId, workerId }) {
  const job = jobs.getJob(jobId);
  if (!job) throw new Error('AI job not found');
  const legacyTaskId = String(job.input.legacyTaskId || '');
  const result = db.prepare('SELECT * FROM recon_results WHERE job_id=?').get(legacyTaskId);
  if (!result) throw new Error('Recon result is not available');
  const evidence = db.prepare(`SELECT * FROM recon_evidence
    WHERE job_id=? AND trim(source_url)!='' ORDER BY id`).all(legacyTaskId);
  const evidenceStore = createEnrichmentEvidenceStore(db);
  const saved = evidence.map(item => evidenceStore.recordEvidence({
    customerId: job.customerId,
    runId: String(job.input.enrichmentRunId || ''),
    nodeKey: 'recon_collect',
    sourceUrl: item.source_url,
    sourceType: 'legacy_recon',
    collectedAt: normalizedTimestamp(item.checked_at),
    summary: `${item.field_name}: ${item.value}`,
    content: `${item.field_name}\n${item.value}`,
    confidence: numericConfidence(item.confidence),
    collector: 'legacy-recon-adapter',
    collectorVersion: 'v1',
  }));
  const proposalStore = createEnrichmentProposalStore(db);
  const evidenceIds = saved.map(item => item.id);
  const fields = [
    ['website', result.website],
    ['industry', result.industry],
    ['customer_type', result.customer_type],
    ['products', result.recommended_products],
    ['description', result.description || result.opportunity_summary],
    ['rating', result.rating],
    ['current_pool', result.current_pool],
  ];
  const proposals = evidenceIds.length ? fields.filter(([, value]) => String(value || '').trim())
    .map(([fieldName, proposedValue]) => proposalStore.propose({
      runId: String(job.input.enrichmentRunId || ''),
      fieldName,
      proposedValue,
      evidenceIds,
      confidence: 0.75,
    })) : [];
  return Object.freeze({
    job: jobs.complete(jobId, workerId),
    evidenceIds: Object.freeze(evidenceIds),
    proposalIds: Object.freeze(proposals.map(item => item.id)),
  });
}

function executeContactCollectJob({ db, jobs, jobId, workerId }) {
  const job = jobs.getJob(jobId);
  if (!job) throw new Error('AI job not found');
  const legacyTaskId = String(job.input.legacyTaskId || '');
  const legacy = db.prepare('SELECT * FROM contact_recon_jobs WHERE job_id=?').get(legacyTaskId);
  if (!legacy || legacy.status !== 'done') throw new Error('Contact Recon result is not available');
  const evidence = db.prepare(`SELECT * FROM person_evidence
    WHERE contact_recon_job_id=? AND trim(source_url)!='' ORDER BY id`).all(legacyTaskId);
  const evidenceStore = createEnrichmentEvidenceStore(db);
  const saved = evidence.map(item => evidenceStore.recordEvidence({
    customerId: job.customerId,
    runId: String(job.input.enrichmentRunId || ''),
    nodeKey: 'contact_collect',
    sourceUrl: item.source_url,
    sourceType: 'legacy_contact_recon',
    collectedAt: normalizedTimestamp(item.checked_at),
    summary: `${item.field_name}: ${item.value}`,
    content: `${item.field_name}\n${item.value}`,
    confidence: numericConfidence(item.confidence),
    collector: 'legacy-contact-recon-adapter',
    collectorVersion: 'v1',
    contactSensitive: true,
  }));
  const completed = jobs.complete(jobId, workerId);
  return Object.freeze({
    job: completed,
    evidenceIds: Object.freeze(saved.map(item => item.id)),
  });
}

function executeEnrichmentFinalizeJob({ db, jobs, jobId, workerId }) {
  const job = jobs.getJob(jobId);
  if (!job) throw new Error('AI job not found');
  const finalization = createEnrichmentProposalStore(db).finalize(
    String(job.input.enrichmentRunId || ''),
  );
  return Object.freeze({
    job: jobs.complete(jobId, workerId, {
      state: finalization.routeState === 'needs_review' ? 'needs_review' : 'succeeded',
    }),
    finalization,
  });
}

module.exports = {
  consumePendingEnrichmentEvent,
  executeContactCollectJob,
  executeEnrichmentFinalizeJob,
  executeReconCollectJob,
};
