'use strict';

const { createReconJob, createContactReconJob } = require('../../db');
const { createCustomerEnrichmentStore } = require('./store');

function reserveDispatchBudget(budgets, job, actor, engine) {
  return budgets.reserve({
    jobId: job.id,
    attempt: job.attempts,
    actorId: actor.id,
    teamId: actor.teamId || '',
    station: job.station,
    engine,
    model: engine,
    maxEngineAttempts: 1,
  });
}

function settleDispatchBudget(budgets, reservation, engine) {
  return budgets.settle(reservation.id, [{
    engine,
    model: engine,
    status: 'succeeded',
  }]);
}

function dispatchLegacy({
  type,
  db,
  jobs,
  budgets,
  job,
  workerId,
  actor,
}) {
  if (!job || job.state !== 'running') throw new Error('running AI dispatch job is required');
  const store = createCustomerEnrichmentStore(db);
  const engine = type === 'recon' ? 'legacy-recon' : 'legacy-contact-recon';
  const table = type === 'recon' ? 'recon_jobs' : 'contact_recon_jobs';
  const active = db.prepare(`SELECT * FROM ${table}
    WHERE customer_id=? AND status IN ('queued','running') ORDER BY updated_at DESC,job_id LIMIT 1`)
    .get(job.customerId);
  let legacy;
  let reservation = null;
  if (active) {
    legacy = { job: active, created: false };
    budgets.recordNonBillable?.({
      jobId: job.id,
      eventKey: `enrichment:${job.id}:${type}:deduplicated`,
      actorId: actor.id,
      teamId: actor.teamId || '',
      station: job.station,
      status: 'deduplicated',
      engine,
      model: engine,
      attempt: job.attempts,
    });
  } else {
    reservation = reserveDispatchBudget(budgets, job, actor, engine);
    try {
      legacy = type === 'recon'
        ? createReconJob(job.customerId, 'pool', { db, requestedBy: 'ai-enrichment' })
        : createContactReconJob(job.customerId, { db, requestedBy: 'ai-enrichment' });
      if (legacy.created === false) budgets.release?.(reservation.id, 'legacy task deduplicated');
      else settleDispatchBudget(budgets, reservation, engine);
    } catch (error) {
      if (reservation) budgets.release?.(reservation.id, 'legacy dispatch failed');
      throw error;
    }
  }
  const legacyJobId = legacy.job.job_id;
  store.linkNode({
    runId: String(job.input.enrichmentRunId || ''),
    nodeKey: job.station,
    aiJobId: job.id,
    legacyTaskType: type,
    legacyTaskId: legacyJobId,
  });
  return Object.freeze({
    type,
    created: legacy.created !== false,
    legacyJobId,
    budget: reservation,
    job: jobs.complete(job.id, workerId),
  });
}

function dispatchLegacyRecon(input) {
  return dispatchLegacy({ ...input, type: 'recon' });
}

function dispatchLegacyContactRecon(input) {
  return dispatchLegacy({ ...input, type: 'contact_recon' });
}

async function executeReconDispatchJob(input) {
  return dispatchLegacyRecon({ ...input, job: input.jobs.getJob(input.jobId) });
}

async function executeContactDispatchJob(input) {
  return dispatchLegacyContactRecon({ ...input, job: input.jobs.getJob(input.jobId) });
}

module.exports = {
  dispatchLegacyRecon,
  dispatchLegacyContactRecon,
  executeReconDispatchJob,
  executeContactDispatchJob,
};
