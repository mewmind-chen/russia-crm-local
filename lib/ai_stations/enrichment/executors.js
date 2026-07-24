'use strict';

const { executeIdentityVerifyJob } = require('./identity');
const { executeReconDispatchJob, executeContactDispatchJob } = require('./adapters');
const {
  executeReconCollectJob,
  executeContactCollectJob,
  executeEnrichmentFinalizeJob,
} = require('./events');

async function executeIntakePrecheckJob({ db, jobs, jobId, workerId }) {
  const job = jobs.getJob(jobId);
  if (!job) throw new Error('AI job not found');
  const account = db.prepare(`SELECT id,external_customer_id FROM crm_accounts
    WHERE id=?`).get(job.crmAccountId);
  if (!account || account.external_customer_id !== job.customerId) {
    throw new Error('Customer enrichment intake context is stale');
  }
  return Object.freeze({
    job: jobs.complete(jobId, workerId),
    precheck: Object.freeze({
      customerId: job.customerId,
      crmAccountId: job.crmAccountId,
      enrichmentRunId: String(job.input.enrichmentRunId || ''),
    }),
  });
}

function createEnrichmentExecutors() {
  return Object.freeze({
    intake_precheck: executeIntakePrecheckJob,
    identity_verify: executeIdentityVerifyJob,
    recon_dispatch: executeReconDispatchJob,
    recon_collect: executeReconCollectJob,
    contact_dispatch: executeContactDispatchJob,
    contact_collect: executeContactCollectJob,
    enrichment_finalize: executeEnrichmentFinalizeJob,
  });
}

module.exports = { createEnrichmentExecutors, executeIntakePrecheckJob };
