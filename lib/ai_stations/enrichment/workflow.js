'use strict';

const { buildAccessContext, hasPermission, assertExternalCustomerAccess } = require('../../access_control');
const { hydrateUserPermissions } = require('../../permission_groups');
const { createAIJobStore } = require('../jobs');
const { createCustomerEnrichmentStore } = require('./store');
const { REQUIRED_PERMISSIONS } = require('./intake');

const ENRICHMENT_NODE_KEYS = Object.freeze([
  'intake_precheck',
  'identity_verify',
  'recon_dispatch',
  'recon_collect',
  'contact_dispatch',
  'contact_collect',
  'customer_fit',
  'contact_readiness',
  'enrichment_finalize',
]);

function defaultWorkflowId(run) {
  return `AEW-${run.id}`;
}

function createEnrichmentWorkflow(db, run, options = {}) {
  if (!run?.id) throw new Error('enrichment run is required');
  const workflowId = String((options.workflowIdFactory || defaultWorkflowId)(run) || '').trim();
  if (!workflowId) throw new Error('workflowId is required');
  const jobs = createAIJobStore(db, {
    ...(options.jobStoreOptions || {}),
    ...(options.jobIdFactory ? { idFactory: options.jobIdFactory } : {}),
  });
  const store = createCustomerEnrichmentStore(db, options.storeOptions);
  const precheck = jobs.enqueue({
    customerId: run.customerId,
    crmAccountId: run.crmAccountId,
    station: 'intake_precheck',
    executionResource: 'deterministic',
    contextHash: run.inputFingerprint,
    workflowId,
    createdBy: run.triggeredBy,
    payload: {
      enrichmentRunId: run.id,
      pipelineVersion: run.pipelineVersion,
    },
  }, `enrichment:${run.id}:intake_precheck:${run.pipelineVersion}`);
  const identity = jobs.enqueue({
    customerId: run.customerId,
    crmAccountId: run.crmAccountId,
    station: 'identity_verify',
    executionResource: 'deterministic',
    contextHash: run.inputFingerprint,
    workflowId,
    parentJobId: precheck.id,
    dependsOn: [precheck.id],
    createdBy: run.triggeredBy,
    payload: {
      enrichmentRunId: run.id,
      pipelineVersion: run.pipelineVersion,
    },
  }, `enrichment:${run.id}:identity_verify:${run.pipelineVersion}`);
  const reconDispatch = jobs.enqueue({
    customerId: run.customerId,
    crmAccountId: run.crmAccountId,
    station: 'recon_dispatch',
    executionResource: 'deterministic',
    contextHash: run.inputFingerprint,
    workflowId,
    parentJobId: identity.id,
    dependsOn: [identity.id],
    createdBy: run.triggeredBy,
    payload: {
      enrichmentRunId: run.id,
      pipelineVersion: run.pipelineVersion,
    },
  }, `enrichment:${run.id}:recon_dispatch:${run.pipelineVersion}`);
  for (const nodeKey of ENRICHMENT_NODE_KEYS) {
    store.linkNode({
      runId: run.id,
      nodeKey,
      aiJobId: nodeKey === 'intake_precheck' ? precheck.id
        : nodeKey === 'identity_verify' ? identity.id
          : nodeKey === 'recon_dispatch' ? reconDispatch.id : null,
    });
  }
  return Object.freeze({ workflowId, jobs: Object.freeze([precheck, identity, reconDispatch]) });
}

function currentActor(db, run) {
  const row = db.prepare('SELECT * FROM sales_users WHERE id=? AND active=1').get(run.triggeredBy);
  return row ? hydrateUserPermissions(db, row) : null;
}

async function dispatchPendingEnrichment(db, actorResolver, options = {}) {
  const dispatcherId = String(options.dispatcherId || 'customer-enrichment-dispatcher').trim();
  if (!dispatcherId) throw new Error('dispatcherId is required');
  const store = createCustomerEnrichmentStore(db, options.storeOptions);
  const run = store.claimTrigger(dispatcherId);
  if (!run) return Object.freeze({ status: 'idle', run: null, workflow: null });

  const actor = typeof actorResolver === 'function'
    ? await actorResolver(db, run)
    : currentActor(db, run);
  if (!actor || REQUIRED_PERMISSIONS.some(permission => !hasPermission(actor, permission))) {
    return Object.freeze({
      status: 'skipped',
      run: store.markSkipped(run.id, 'permission_revoked'),
      workflow: null,
    });
  }
  try {
    assertExternalCustomerAccess(buildAccessContext(db, actor), run.customerId);
  } catch (_error) {
    return Object.freeze({
      status: 'skipped',
      run: store.markSkipped(run.id, 'customer_scope_revoked'),
      workflow: null,
    });
  }

  const workflow = createEnrichmentWorkflow(db, run, options);
  return Object.freeze({
    status: 'queued',
    run: store.attachWorkflow(run.id, workflow.workflowId),
    workflow,
  });
}

module.exports = {
  ENRICHMENT_NODE_KEYS,
  createEnrichmentWorkflow,
  dispatchPendingEnrichment,
};
