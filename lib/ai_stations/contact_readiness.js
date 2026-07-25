'use strict';

const {
  buildAccessContext,
  hasPermission,
} = require('../access_control');
const { hydrateUserPermissions } = require('../permission_groups');
const { canonicalize, contextHash, createEvidenceCollector } = require('./evidence');
const { buildCustomerContext } = require('./context');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');
const { createCustomerEnrichmentStore } = require('./enrichment/store');

const CONTACT_READINESS_SCHEMA_VERSION = 8;
const CONTACT_READINESS_PERMISSIONS = Object.freeze([
  'use_ai_assistant',
  'view_customers',
  'view_contacts',
]);

function tableExists(db, name) {
  return Boolean(db.prepare(`SELECT 1 found FROM sqlite_master
    WHERE type='table' AND name=?`).get(name));
}

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function mapLocalContact(row) {
  return {
    contactId: `local:${text(row.id, 120)}`,
    name: text(row.name, 300),
    title: text(row.title, 300),
    department: text(row.department, 200),
    methods: [
      ['phone', row.phone],
      ['email', row.email],
      ['social', row.social],
    ].filter(([, value]) => text(value)).map(([type, value]) => ({
      type,
      value: text(value, 500),
      verificationStatus: 'employee_confirmed',
    })),
    updatedAt: text(row.updated_at, 80),
  };
}

function mapEntryPoint(row) {
  return {
    contactId: `entry:${text(row.id, 120)}`,
    type: text(row.method_type, 80),
    value: text(row.value, 500),
    discoveryType: text(row.discovery_type, 100),
    verificationStatus: text(row.verification_status, 100),
    sourceUrl: text(row.source_url, 1000),
    checkedAt: text(row.checked_at, 80),
  };
}

function addReadinessEvidence(collector, sourceTable, sourceId, field, value, metadata = {}) {
  return collector.add({
    sourceTable,
    sourceId,
    field,
    value,
    sourceUrl: metadata.sourceUrl,
    checkedAt: metadata.checkedAt,
    confidence: metadata.confidence,
  });
}

function buildContactReadinessContext(db, accessContext, customerId, options = {}) {
  const base = buildCustomerContext(db, accessContext, customerId, options);
  const results = options.results || createAIResultStore(db);
  const fit = options.fitJobId
    ? results.getForJob(String(options.fitJobId))
    : results.latestFreshForCustomer(customerId, 'customer_fit');
  if (!fit || fit.station !== 'customer_fit' || fit.stale) {
    throw new Error('A fresh customer_fit result is required');
  }

  const localContacts = base.context.crmAccountId && tableExists(db, 'crm_account_contacts')
    ? db.prepare(`SELECT * FROM crm_account_contacts
      WHERE customer_id=? ORDER BY updated_at DESC,id`).all(base.context.crmAccountId).map(mapLocalContact)
    : [];
  const entryPoints = tableExists(db, 'company_entry_points')
    ? db.prepare(`SELECT * FROM company_entry_points
      WHERE customer_id=? ORDER BY checked_at DESC,id`).all(customerId).map(mapEntryPoint)
    : [];
  const readinessEvidence = createEvidenceCollector({
    maxEvidence: options.maxEvidence || 300,
    idPrefix: 'CR-EV',
  });

  for (const person of base.context.people) {
    for (const method of person.methods || []) {
      addReadinessEvidence(
        readinessEvidence,
        'contact_methods',
        `${person.personId}:${method.type}:${method.value}`,
        method.type,
        method.value,
        {
          sourceUrl: method.sourceUrl,
          checkedAt: method.lastVerifiedAt,
          confidence: method.confidence,
        },
      );
    }
  }
  for (const contact of localContacts) {
    addReadinessEvidence(
      readinessEvidence,
      'crm_account_contacts',
      contact.contactId,
      'employee_contact',
      [contact.name, contact.title, contact.department, ...contact.methods.map(method => `${method.type}:${method.value}`)]
        .filter(Boolean).join(' | '),
      { checkedAt: contact.updatedAt, confidence: 1 },
    );
  }
  for (const entry of entryPoints) {
    addReadinessEvidence(
      readinessEvidence,
      'company_entry_points',
      entry.contactId,
      entry.type,
      entry.value,
      { sourceUrl: entry.sourceUrl, checkedAt: entry.checkedAt },
    );
  }

  const extraEvidence = readinessEvidence.all();
  const evidence = Object.freeze([...base.evidence, ...extraEvidence]);
  const evidenceIds = Object.freeze(evidence.map(item => item.id));
  const contactIds = Object.freeze([
    ...base.context.people.map(person => person.personId),
    ...localContacts.map(contact => contact.contactId),
    ...entryPoints.map(entry => entry.contactId),
  ].filter(Boolean).sort());
  const context = Object.freeze({
    ...base.context,
    station: 'contact_readiness',
    customerFit: Object.freeze({
      resultId: fit.id,
      jobId: fit.jobId,
      value: fit.value,
      confidence: fit.confidence,
      generatedAt: fit.generatedAt,
    }),
    localContacts: Object.freeze(localContacts),
    companyEntryPoints: Object.freeze(entryPoints),
    allowedContactIds: contactIds,
    evidenceIds,
  });

  return Object.freeze({
    context,
    evidence,
    evidenceIds,
    contactIds,
    contextHash: contextHash(canonicalize({ ...context, evidenceIds: undefined })),
    fitResult: fit,
  });
}

function routingAction(readiness) {
  if (readiness === 'partial') {
    return Object.freeze({
      reasonCode: 'contact_readiness_partial',
      action: '补充验证联系人身份与可直达联系方式',
    });
  }
  if (readiness === 'not_ready') {
    return Object.freeze({
      reasonCode: 'contact_not_ready',
      action: '继续补研采购或技术负责人及可验证联系方式',
    });
  }
  return Object.freeze({ reasonCode: '', action: '联系人已就绪，可进入后续规则判断' });
}

function applyContactReadinessRouting(db, job, result) {
  const readiness = String(result.value.readiness || '');
  const decision = routingAction(readiness);
  db.prepare('UPDATE customer_pool SET contact_next_action=? WHERE customer_id=?')
    .run(decision.action, job.customerId);
  const runId = String(job.input.enrichmentRunId || '');
  if (runId && readiness !== 'ready') {
    db.prepare(`UPDATE crm_ai_enrichment_runs
      SET route_state='missing_info',reason_code=?,updated_at=?
      WHERE id=? AND customer_id=?`).run(
      decision.reasonCode,
      result.generatedAt,
      runId,
      job.customerId,
    );
  }
  return Object.freeze({ readiness, ...decision });
}

function actorAccessContext(db, actorId) {
  const row = db.prepare('SELECT * FROM sales_users WHERE id=? AND active=1').get(actorId);
  if (!row) return null;
  const actor = hydrateUserPermissions(db, row);
  if (CONTACT_READINESS_PERMISSIONS.some(permission => !hasPermission(actor, permission))) return null;
  return { actor, accessContext: buildAccessContext(db, actor) };
}

function scheduleContactReadinessForCompletedFits(db, options = {}) {
  const jobs = createAIJobStore(db, options.jobStoreOptions);
  const results = createAIResultStore(db);
  const migration = db.prepare('SELECT applied_at FROM crm_ai_schema_migrations WHERE version=?')
    .get(CONTACT_READINESS_SCHEMA_VERSION);
  if (!migration) return Object.freeze({ scheduled: 0, jobs: Object.freeze([]) });
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? Math.min(options.limit, 100) : 20;
  const fitRows = db.prepare(`SELECT id FROM crm_ai_jobs
    WHERE station='customer_fit' AND state='succeeded' AND control_state=''
      AND finished_at>=?
    ORDER BY finished_at,id LIMIT ?`).all(migration.applied_at, limit);
  const scheduled = [];

  for (const row of fitRows) {
    const fitJob = jobs.getJob(row.id);
    if (!fitJob) continue;
    const identity = actorAccessContext(db, fitJob.createdBy);
    if (!identity) continue;
    let readinessContext;
    try {
      readinessContext = buildContactReadinessContext(
        db,
        identity.accessContext,
        fitJob.customerId,
        { fitJobId: fitJob.id, results },
      );
    } catch (_error) {
      continue;
    }
    const existing = db.prepare(`SELECT id FROM crm_ai_jobs
      WHERE parent_job_id=? AND station='contact_readiness' AND context_hash=?
        AND control_state NOT IN ('cancel_requested','cancelled')
      ORDER BY created_at DESC,id DESC LIMIT 1`).get(fitJob.id, readinessContext.contextHash);
    if (existing) continue;

    const transaction = db.transaction(() => {
      const runId = String(fitJob.input.enrichmentRunId || '');
      const readiness = jobs.enqueue({
        customerId: fitJob.customerId,
        crmAccountId: fitJob.crmAccountId,
        station: 'contact_readiness',
        contextHash: readinessContext.contextHash,
        workflowId: fitJob.workflowId,
        parentJobId: fitJob.id,
        dependsOn: [fitJob.id],
        createdBy: fitJob.createdBy,
        payload: {
          customerFitJobId: fitJob.id,
          contextVersion: 'crm-contact-v1',
          stationVersion: 'v1',
          ...(runId ? { enrichmentRunId: runId } : {}),
        },
      }, `ai-successor:contact_readiness:v1:${fitJob.id}:${readinessContext.contextHash}`);
      const created = [readiness];

      if (runId) {
        const enrichment = createCustomerEnrichmentStore(db);
        const existingLink = db.prepare(`SELECT ai_job_id FROM crm_ai_enrichment_node_links
          WHERE run_id=? AND node_key='contact_readiness'`).get(runId);
        if (!existingLink?.ai_job_id) {
          enrichment.linkNode({ runId, nodeKey: 'contact_readiness', aiJobId: readiness.id });
          const finalize = jobs.enqueue({
            customerId: fitJob.customerId,
            crmAccountId: fitJob.crmAccountId,
            station: 'enrichment_finalize',
            executionResource: 'deterministic',
            contextHash: readinessContext.contextHash,
            workflowId: fitJob.workflowId,
            parentJobId: readiness.id,
            dependsOn: [readiness.id],
            createdBy: fitJob.createdBy,
            payload: {
              enrichmentRunId: runId,
              pipelineVersion: String(fitJob.input.pipelineVersion || 'v1'),
            },
          }, `enrichment:${runId}:enrichment_finalize:after-contact-readiness:v1`);
          enrichment.linkNode({ runId, nodeKey: 'enrichment_finalize', aiJobId: finalize.id });
          created.push(finalize);
        }
      }
      return created;
    });
    scheduled.push(...transaction.immediate());
  }

  return Object.freeze({ scheduled: scheduled.length, jobs: Object.freeze(scheduled) });
}

function markContactReadinessStale(db, customerId, reason = 'contact_changed', options = {}) {
  if (!tableExists(db, 'crm_ai_station_results')) {
    return Object.freeze({ results: 0, cancelledJobs: 0, cancellationRequestedJobs: 0 });
  }
  const columns = new Set(db.prepare('PRAGMA table_info(crm_ai_station_results)').all().map(row => row.name));
  if (!columns.has('stale_at') || !columns.has('stale_reason')) {
    return Object.freeze({ results: 0, cancelledJobs: 0, cancellationRequestedJobs: 0 });
  }
  const selectedCustomer = text(customerId, 160);
  if (!selectedCustomer) throw new Error('customerId is required');
  const selectedReason = text(reason, 120) || 'contact_changed';
  const at = new Date(options.now ? options.now() : new Date()).toISOString();
  const transaction = db.transaction(() => {
    const results = db.prepare(`UPDATE crm_ai_station_results
      SET stale_at=?,stale_reason=?
      WHERE customer_id=? AND station='contact_readiness' AND stale_at=''`)
      .run(at, selectedReason, selectedCustomer).changes;
    const cancelledJobs = db.prepare(`UPDATE crm_ai_jobs
      SET control_state='cancelled',cancel_requested_at=?,cancelled_at=?,finished_at=?,updated_at=?
      WHERE customer_id=? AND station='contact_readiness' AND state IN ('queued','retry_wait')
        AND control_state=''`).run(at, at, at, at, selectedCustomer).changes;
    const cancellationRequestedJobs = db.prepare(`UPDATE crm_ai_jobs
      SET control_state='cancel_requested',cancel_requested_at=?,updated_at=?
      WHERE customer_id=? AND station='contact_readiness' AND state='running'
        AND control_state=''`).run(at, at, selectedCustomer).changes;
    if (tableExists(db, 'crm_ai_enrichment_runs')) {
      db.prepare(`UPDATE crm_ai_enrichment_runs
        SET route_state='missing_info',reason_code='contact_readiness_stale',updated_at=?
        WHERE customer_id=? AND route_state='pending_assignment'`).run(at, selectedCustomer);
    }
    db.prepare(`UPDATE customer_pool SET contact_next_action='联系人信息已变化，等待重新评估就绪度'
      WHERE customer_id=?`).run(selectedCustomer);
    return { results, cancelledJobs, cancellationRequestedJobs };
  });
  return Object.freeze(transaction.immediate());
}

module.exports = {
  applyContactReadinessRouting,
  buildContactReadinessContext,
  markContactReadinessStale,
  scheduleContactReadinessForCompletedFits,
};
