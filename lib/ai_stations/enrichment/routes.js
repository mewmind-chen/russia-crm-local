'use strict';

const { assertExternalCustomerAccess } = require('../../access_control');
const { createAIJobStore } = require('../jobs');
const { presentAIResult } = require('../presentation');
const { createCustomerEnrichmentStore } = require('./store');
const { createEnrichmentProposalStore } = require('./proposals');
const { createEnrichmentTrigger } = require('./intake');
const { propagateLegacyCancellation } = require('./adapters');

function routeError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function effectiveJobState(row) {
  return ['blocked', 'cancel_requested', 'cancelled'].includes(row?.control_state)
    ? row.control_state : row?.state || 'unknown';
}

function proposalCurrentValues(db, run) {
  const row = db.prepare(`SELECT website,country,industry,customer_type,products,
    description,rating,current_pool FROM customer_pool WHERE customer_id=?`)
    .get(run.customerId) || {};
  return row;
}

function createCustomerEnrichmentRouteService(options = {}) {
  const flags = options.flags || { enabled: false, autoTriggerEnabled: false };

  function getEnrichment({ db, accessContext, customerId }) {
    assertExternalCustomerAccess(accessContext, customerId);
    const store = createCustomerEnrichmentStore(db);
    const run = store.latestForCustomer(customerId);
    if (!run) {
      return {
        run: null,
        nodes: [],
        proposals: [],
        evidence: [],
        restricted: {
          contacts: !accessContext.permissions.view_contacts,
          recon: !accessContext.permissions.view_recon,
        },
      };
    }
    const nodes = db.prepare(`SELECT l.node_key,l.adapter_state,l.legacy_task_type,l.legacy_task_id,
      j.id ai_job_id,j.state,j.control_state,j.error_summary,j.created_at,j.updated_at
      FROM crm_ai_enrichment_node_links l
      LEFT JOIN crm_ai_jobs j ON j.id=l.ai_job_id
      WHERE l.run_id=? ORDER BY l.created_at,l.node_key`).all(run.id).map(row => ({
      nodeKey: row.node_key,
      state: row.ai_job_id ? effectiveJobState(row) : row.adapter_state,
      aiJobId: row.ai_job_id || null,
      legacyTask: row.legacy_task_id ? {
        type: row.legacy_task_type,
        taskId: `${row.legacy_task_type === 'contact_recon' ? 'contact' : 'recon'}:${row.legacy_task_id}`,
      } : null,
      errorSummary: row.error_summary || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
    }));
    const currentValues = proposalCurrentValues(db, run);
    const proposals = createEnrichmentProposalStore(db).listForRun(run.id).map(proposal => ({
      ...proposal,
      currentValue: currentValues[proposal.fieldName] ?? '',
    }));
    const evidence = db.prepare(`SELECT id,node_key,source_url,source_type,collected_at,summary,
      confidence,collector,collector_version,contact_sensitive,created_at
      FROM crm_ai_enrichment_evidence WHERE run_id=? ORDER BY created_at,id`).all(run.id)
      .filter(row => row.contact_sensitive ? accessContext.permissions.view_contacts
        : accessContext.permissions.view_recon)
      .map(row => ({
        id: row.id,
        nodeKey: row.node_key,
        sourceUrl: row.source_url,
        sourceType: row.source_type,
        collectedAt: row.collected_at,
        summary: row.summary,
        confidence: row.confidence,
        collector: row.collector,
        collectorVersion: row.collector_version,
        contactSensitive: Boolean(row.contact_sensitive),
        createdAt: row.created_at,
      }));
    const presentation = presentAIResult({
      job: {
        station: 'enrichment',
        workflowId: run.workflowId,
        finishedAt: run.finishedAt,
        trigger: {
          source: ['manual_create', 'manual_rerun'].includes(run.triggerSource)
            ? 'manual'
            : run.triggerSource === 'bulk_import' ? 'api' : 'legacy_unknown',
          actorId: run.triggeredBy,
          workflowId: run.workflowId,
          reason: run.triggerSource,
          triggeredAt: run.createdAt,
        },
      },
      result: {
        value: { proposals, tags: run.tags },
        generatedAt: run.finishedAt || run.updatedAt,
      },
      evidence,
      coverage: {
        state: evidence.length ? (run.completeness >= 100 ? 'covered' : 'partial') : 'none',
        coveredFields: proposals.map(item => item.fieldName).filter(Boolean),
        missingFields: run.missingItems,
        restrictedFields: [
          ...(!accessContext.permissions.view_contacts ? ['联系人依据'] : []),
          ...(!accessContext.permissions.view_recon ? ['Recon 依据'] : []),
        ],
        analyzed: evidence.length,
        total: evidence.length + run.missingItems.length,
      },
      permissions: accessContext.permissions,
    });
    return {
      run,
      nodes,
      proposals,
      evidence,
      presentation,
      restricted: {
        contacts: !accessContext.permissions.view_contacts,
        recon: !accessContext.permissions.view_recon,
      },
    };
  }

  function start({ db, accessContext, actor, customerId }) {
    assertExternalCustomerAccess(accessContext, customerId);
    if (!flags.enabled) {
      throw routeError('Customer enrichment is disabled', 409, 'AI_ENRICHMENT_DISABLED');
    }
    const account = db.prepare(`SELECT id,external_customer_id,company_name,country,website
      FROM crm_accounts WHERE external_customer_id=?`).get(customerId);
    if (!account) throw routeError('CRM customer not found', 404, 'CUSTOMER_NOT_FOUND');
    const trigger = createEnrichmentTrigger(db, actor, {
      customerId: account.id,
      externalCustomerId: account.external_customer_id,
    }, {
      companyName: account.company_name,
      website: account.website,
      country: account.country,
    }, {
      flags: { enabled: true, autoTriggerEnabled: true },
      triggerSource: 'manual_rerun',
      pipelineVersion: 'manual-v1',
    });
    return {
      run: createCustomerEnrichmentStore(db).getRun(trigger.runId),
      accepted: true,
    };
  }

  function cancel({ db, accessContext, runId }) {
    const store = createCustomerEnrichmentStore(db);
    const run = store.getRun(runId);
    if (!run) throw routeError('Enrichment run not found', 404, 'AI_ENRICHMENT_NOT_FOUND');
    assertExternalCustomerAccess(accessContext, run.customerId);
    if (run.state === 'cancelled') return { run };
    const jobs = createAIJobStore(db);
    const transaction = db.transaction(() => {
      const links = db.prepare(`SELECT * FROM crm_ai_enrichment_node_links
        WHERE run_id=? ORDER BY created_at,id`).all(run.id);
      for (const link of links) {
        if (!link.ai_job_id) continue;
        const job = jobs.getJob(link.ai_job_id);
        if (!job) continue;
        const legacy = propagateLegacyCancellation(db, job.id);
        if (['queued', 'running', 'retry_wait', 'blocked'].includes(job.state)) {
          try { jobs.requestCancel(job.id); } catch (error) {
            if (error.code !== 'AI_JOB_NOT_CANCELLABLE') throw error;
          }
        } else if (legacy && ['cancelled', 'cancel_requested'].includes(legacy.state)
            && ['succeeded', 'needs_review'].includes(job.state)) {
          const at = new Date().toISOString();
          db.prepare(`UPDATE crm_ai_jobs SET control_state='cancelled',cancel_requested_at=?,
            cancelled_at=?,finished_at=?,updated_at=? WHERE id=? AND control_state=''`)
            .run(at, at, at, at, job.id);
        }
      }
      const at = new Date().toISOString();
      db.prepare(`UPDATE crm_ai_enrichment_node_links
        SET adapter_state=CASE WHEN adapter_state='completed' THEN adapter_state ELSE 'cancelled' END,
          cancel_requested_at=COALESCE(NULLIF(cancel_requested_at,''),?),updated_at=?
        WHERE run_id=?`).run(at, at, run.id);
      db.prepare(`UPDATE crm_ai_enrichment_runs SET state='cancelled',route_state='',
        reason_code='cancelled_by_user',dispatch_owner='',dispatch_lease_expires_at='',
        updated_at=?,finished_at=? WHERE id=? AND state!='cancelled'`).run(at, at, run.id);
    });
    transaction.immediate();
    return { run: store.getRun(run.id) };
  }

  function review({ db, accessContext, actor, proposalId, body }) {
    const proposals = createEnrichmentProposalStore(db);
    const proposal = proposals.get(proposalId);
    if (!proposal) throw routeError('Enrichment proposal not found', 404, 'AI_PROPOSAL_NOT_FOUND');
    assertExternalCustomerAccess(accessContext, proposal.customerId);
    return {
      proposal: proposals.review(proposal.id, {
        decision: body?.decision,
        reviewerId: actor.id,
      }),
    };
  }

  return Object.freeze({ getEnrichment, start, cancel, review });
}

module.exports = { createCustomerEnrichmentRouteService };
