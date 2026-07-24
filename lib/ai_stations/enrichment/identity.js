'use strict';

const { normalizeWebsite } = require('./intake');
const { createEnrichmentEvidenceStore } = require('./evidence');
const { findFuzzyDuplicateCandidates } = require('./dedupe');
const { createCustomerEnrichmentStore } = require('./store');

const ACCEPTED_FIELDS = Object.freeze([
  { resultKey: 'officialWebsite', column: 'website' },
  { resultKey: 'country', column: 'country' },
]);

function reviewIdentity(db, jobs, job, workerId, runId, reasonCode) {
  const runs = createCustomerEnrichmentStore(db);
  const run = runs.markNeedsReview(runId, reasonCode);
  return Object.freeze({
    status: 'needs_review',
    reasonCode,
    run,
    job: jobs.complete(job.id, workerId, { state: 'needs_review' }),
  });
}

async function executeIdentityVerifyJob({
  db,
  jobs,
  jobId,
  workerId,
  identityResolver,
}) {
  const job = jobs.getJob(jobId);
  if (!job) throw new Error('AI job not found');
  const runId = String(job.input.enrichmentRunId || '');
  const account = db.prepare(`SELECT id,external_customer_id,company_name,country,website
    FROM crm_accounts WHERE id=?`).get(job.crmAccountId);
  if (!account || account.external_customer_id !== job.customerId) {
    throw new Error('Customer enrichment identity context is stale');
  }

  const fuzzyCandidates = findFuzzyDuplicateCandidates(db, {
    companyName: account.company_name,
    website: account.website,
  }, { excludeCustomerId: job.customerId });
  if (fuzzyCandidates.length) {
    return reviewIdentity(db, jobs, job, workerId, runId, 'possible_duplicate');
  }
  if (typeof identityResolver !== 'function') throw new Error('identityResolver is required');
  const resolved = await identityResolver(Object.freeze({
    customerId: job.customerId,
    crmAccountId: job.crmAccountId,
    companyName: account.company_name,
    country: account.country,
    website: account.website,
  }));
  if (!resolved || typeof resolved !== 'object') {
    return reviewIdentity(db, jobs, job, workerId, runId, 'identity_uncertain');
  }

  const evidenceStore = createEnrichmentEvidenceStore(db);
  const evidence = (Array.isArray(resolved.sources) ? resolved.sources : []).map((source, index) =>
    evidenceStore.recordEvidence({
      customerId: job.customerId,
      runId,
      nodeKey: 'identity_verify',
      sourceUrl: source.url,
      sourceType: source.type || 'official_website',
      collectedAt: source.collectedAt,
      summary: source.summary,
      content: source.content,
      contentHash: source.contentHash,
      confidence: source.confidence ?? resolved.confidence,
      collector: 'identity-resolver',
      collectorVersion: 'v1',
      contactSensitive: false,
      idempotencyKey: `enrichment:${runId}:identity:evidence:${index}:v1`,
    }));
  if (resolved.risk?.blocked) {
    return reviewIdentity(db, jobs, job, workerId, runId, 'risk_precheck_failed');
  }
  const confidence = Number(resolved.confidence);
  const proposed = ACCEPTED_FIELDS.filter(field => String(resolved[field.resultKey] || '').trim());
  if (!evidence.length || !Number.isFinite(confidence) || confidence < 0.75 || !proposed.length) {
    return reviewIdentity(db, jobs, job, workerId, runId, 'identity_uncertain');
  }

  const applied = [];
  const transaction = db.transaction(() => {
    for (const field of proposed) {
      const current = String(account[field.column] || '').trim();
      if (current) continue;
      const value = field.column === 'website'
        ? normalizeWebsite(resolved[field.resultKey])
        : String(resolved[field.resultKey]).trim();
      db.prepare(`UPDATE crm_accounts SET ${field.column}=? WHERE id=?`)
        .run(value, account.id);
      db.prepare(`UPDATE customer_pool SET ${field.column}=? WHERE customer_id=?`)
        .run(value, job.customerId);
      evidenceStore.setFieldProvenance({
        customerId: job.customerId,
        crmAccountId: job.crmAccountId,
        targetType: 'crm_account',
        targetId: job.crmAccountId,
        fieldName: field.column,
        value,
        sourceState: 'ai_provisional',
        evidenceId: evidence[0].id,
      });
      applied.push(field.column);
    }
  });
  transaction.immediate();
  return Object.freeze({
    status: 'succeeded',
    applied: Object.freeze(applied),
    evidence: Object.freeze(evidence),
    job: jobs.complete(job.id, workerId),
  });
}

module.exports = { executeIdentityVerifyJob };
