'use strict';

const crypto = require('node:crypto');
const { installAIStationSchema } = require('../schema');

const DEFAULT_LEASE_MS = 60_000;

function required(value, name) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

function positiveInteger(value, fallback, name) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 1) throw new Error(`${name} must be a positive integer`);
  return result;
}

function iso(value) {
  const result = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error('invalid timestamp');
  return result.toISOString();
}

function mapRun(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    crmAccountId: row.crm_account_id,
    workflowId: row.workflow_id,
    triggerSource: row.trigger_source,
    triggeredBy: row.triggered_by,
    inputFingerprint: row.input_fingerprint,
    pipelineVersion: row.pipeline_version,
    state: row.state,
    routeState: row.route_state,
    reasonCode: row.reason_code,
    dispatchOwner: row.dispatch_owner,
    dispatchLeaseExpiresAt: row.dispatch_lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  });
}

function mapLink(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    runId: row.run_id,
    nodeKey: row.node_key,
    aiJobId: row.ai_job_id || null,
    legacyTaskType: row.legacy_task_type,
    legacyTaskId: row.legacy_task_id,
    adapterState: row.adapter_state,
    completionVersion: row.completion_version,
    cancelRequestedAt: row.cancel_requested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapEvent(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    eventKey: row.event_key,
    runId: row.run_id,
    nodeKey: row.node_key,
    legacyTaskType: row.legacy_task_type,
    legacyTaskId: row.legacy_task_id,
    eventType: row.event_type,
    payloadHash: row.payload_hash,
    state: row.state,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    consumedAt: row.consumed_at,
  });
}

function createCustomerEnrichmentStore(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('database is required');
  installAIStationSchema(db);
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || (prefix => `${prefix}-${crypto.randomUUID()}`);
  const leaseMs = positiveInteger(options.leaseMs, DEFAULT_LEASE_MS, 'leaseMs');

  const findRun = db.prepare('SELECT * FROM crm_ai_enrichment_runs WHERE id=?');
  const findRunByFingerprint = db.prepare(`SELECT * FROM crm_ai_enrichment_runs
    WHERE customer_id=? AND input_fingerprint=? AND pipeline_version=?`);
  const findLinkByNode = db.prepare('SELECT * FROM crm_ai_enrichment_node_links WHERE run_id=? AND node_key=?');
  const findEventByKey = db.prepare('SELECT * FROM crm_ai_enrichment_events WHERE event_key=?');

  function timestamp() {
    return iso(now());
  }

  function createTrigger(input) {
    if (!input || typeof input !== 'object') throw new Error('trigger input is required');
    const customerId = required(input.customerId, 'customerId');
    const crmAccountId = required(input.crmAccountId, 'crmAccountId');
    const triggerSource = required(input.triggerSource, 'triggerSource');
    const triggeredBy = required(input.triggeredBy, 'triggeredBy');
    const fingerprint = required(input.inputFingerprint, 'inputFingerprint');
    const pipelineVersion = required(input.pipelineVersion || 'v1', 'pipelineVersion');
    const existing = findRunByFingerprint.get(customerId, fingerprint, pipelineVersion);
    if (existing) return mapRun(existing);
    const at = timestamp();
    const id = required(idFactory('AER'), 'runId');
    try {
      db.prepare(`INSERT INTO crm_ai_enrichment_runs
        (id,customer_id,crm_account_id,trigger_source,triggered_by,input_fingerprint,pipeline_version,
         state,reason_code,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'pending_dispatch',?,?,?)`).run(
        id, customerId, crmAccountId, triggerSource, triggeredBy, fingerprint, pipelineVersion,
        String(input.reasonCode || ''), at, at,
      );
    } catch (error) {
      const replay = findRunByFingerprint.get(customerId, fingerprint, pipelineVersion);
      if (replay) return mapRun(replay);
      throw error;
    }
    return mapRun(findRun.get(id));
  }

  function claimTrigger(dispatcherId) {
    const owner = required(dispatcherId, 'dispatcherId');
    const claim = db.transaction(() => {
      const at = timestamp();
      const row = db.prepare(`SELECT * FROM crm_ai_enrichment_runs
        WHERE state='pending_dispatch'
           OR (state='dispatching' AND dispatch_lease_expires_at!='' AND dispatch_lease_expires_at<=?)
        ORDER BY created_at,id LIMIT 1`).get(at);
      if (!row) return null;
      const expires = iso(new Date(new Date(at).getTime() + leaseMs));
      const changed = db.prepare(`UPDATE crm_ai_enrichment_runs
        SET state='dispatching',dispatch_owner=?,dispatch_lease_expires_at=?,updated_at=?
        WHERE id=? AND (
          state='pending_dispatch'
          OR (state='dispatching' AND dispatch_lease_expires_at!='' AND dispatch_lease_expires_at<=?)
        )`).run(owner, expires, at, row.id, at);
      return changed.changes === 1 ? mapRun(findRun.get(row.id)) : null;
    });
    return claim.immediate();
  }

  function markSkipped(runId, reasonCode) {
    const id = required(runId, 'runId');
    const reason = required(reasonCode, 'reasonCode');
    const at = timestamp();
    const changed = db.prepare(`UPDATE crm_ai_enrichment_runs
      SET state='skipped',reason_code=?,dispatch_owner='',dispatch_lease_expires_at='',
        updated_at=?,finished_at=? WHERE id=? AND state IN ('pending_dispatch','dispatching')`)
      .run(reason, at, at, id);
    if (changed.changes !== 1) throw new Error('enrichment run is not skippable');
    return mapRun(findRun.get(id));
  }

  function markNeedsReview(runId, reasonCode) {
    const id = required(runId, 'runId');
    const reason = required(reasonCode, 'reasonCode');
    const at = timestamp();
    const changed = db.prepare(`UPDATE crm_ai_enrichment_runs
      SET state='needs_review',route_state='needs_review',reason_code=?,
        dispatch_owner='',dispatch_lease_expires_at='',updated_at=?
      WHERE id=? AND state IN ('queued','running','dispatching')`).run(reason, at, id);
    if (changed.changes !== 1) {
      const current = findRun.get(id);
      if (current?.state === 'needs_review' && current.reason_code === reason) return mapRun(current);
      throw new Error('enrichment run cannot enter review');
    }
    return mapRun(findRun.get(id));
  }

  function attachWorkflow(runId, workflowId) {
    const id = required(runId, 'runId');
    const workflow = required(workflowId, 'workflowId');
    const at = timestamp();
    const changed = db.prepare(`UPDATE crm_ai_enrichment_runs
      SET workflow_id=?,state='queued',dispatch_owner='',dispatch_lease_expires_at='',updated_at=?
      WHERE id=? AND state='dispatching' AND (workflow_id='' OR workflow_id=?)`)
      .run(workflow, at, id, workflow);
    if (changed.changes !== 1) {
      const current = findRun.get(id);
      if (current?.workflow_id === workflow) return mapRun(current);
      throw new Error('enrichment run cannot attach workflow');
    }
    return mapRun(findRun.get(id));
  }

  function linkNode(input) {
    if (!input || typeof input !== 'object') throw new Error('node link input is required');
    const runId = required(input.runId, 'runId');
    const nodeKey = required(input.nodeKey, 'nodeKey');
    const aiJobId = input.aiJobId ? required(input.aiJobId, 'aiJobId') : null;
    const legacyTaskType = String(input.legacyTaskType || '').trim();
    const legacyTaskId = String(input.legacyTaskId || '').trim();
    if (Boolean(legacyTaskType) !== Boolean(legacyTaskId)) {
      throw new Error('legacyTaskType and legacyTaskId must be provided together');
    }
    const existing = findLinkByNode.get(runId, nodeKey);
    if (existing) {
      if (!existing.ai_job_id && aiJobId) {
        db.prepare(`UPDATE crm_ai_enrichment_node_links SET ai_job_id=?,updated_at=?
          WHERE id=? AND ai_job_id IS NULL`).run(aiJobId, timestamp(), existing.id);
        return mapLink(findLinkByNode.get(runId, nodeKey));
      }
      if ((existing.ai_job_id || null) !== aiJobId
          || existing.legacy_task_type !== legacyTaskType
          || existing.legacy_task_id !== legacyTaskId) throw new Error('enrichment node link collision');
      return mapLink(existing);
    }
    const at = timestamp();
    const id = required(idFactory('AEL'), 'linkId');
    db.prepare(`INSERT INTO crm_ai_enrichment_node_links
      (id,run_id,node_key,ai_job_id,legacy_task_type,legacy_task_id,adapter_state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'linked',?,?)`).run(
      id, runId, nodeKey, aiJobId, legacyTaskType, legacyTaskId, at, at,
    );
    return mapLink(findLinkByNode.get(runId, nodeKey));
  }

  function recordEvent(input) {
    if (!input || typeof input !== 'object') throw new Error('event input is required');
    const eventKey = required(input.eventKey, 'eventKey');
    const values = {
      runId: required(input.runId, 'runId'),
      nodeKey: required(input.nodeKey, 'nodeKey'),
      legacyTaskType: required(input.legacyTaskType, 'legacyTaskType'),
      legacyTaskId: required(input.legacyTaskId, 'legacyTaskId'),
      eventType: required(input.eventType, 'eventType'),
      payloadHash: required(input.payloadHash, 'payloadHash'),
    };
    const existing = findEventByKey.get(eventKey);
    if (existing) {
      if (existing.run_id !== values.runId || existing.node_key !== values.nodeKey
          || existing.legacy_task_type !== values.legacyTaskType
          || existing.legacy_task_id !== values.legacyTaskId
          || existing.event_type !== values.eventType || existing.payload_hash !== values.payloadHash) {
        throw new Error('enrichment event collision');
      }
      return mapEvent(existing);
    }
    const at = timestamp();
    const id = required(idFactory('AEE'), 'eventId');
    db.prepare(`INSERT INTO crm_ai_enrichment_events
      (id,event_key,run_id,node_key,legacy_task_type,legacy_task_id,event_type,payload_hash,
       state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'pending',?,?)`).run(
      id, eventKey, values.runId, values.nodeKey, values.legacyTaskType,
      values.legacyTaskId, values.eventType, values.payloadHash, at, at,
    );
    return mapEvent(findEventByKey.get(eventKey));
  }

  function claimEvent(consumerId) {
    const owner = required(consumerId, 'consumerId');
    const claim = db.transaction(() => {
      const at = timestamp();
      const row = db.prepare(`SELECT * FROM crm_ai_enrichment_events
        WHERE state='pending' OR (state='processing' AND lease_expires_at!='' AND lease_expires_at<=?)
        ORDER BY created_at,id LIMIT 1`).get(at);
      if (!row) return null;
      const expires = iso(new Date(new Date(at).getTime() + leaseMs));
      const changed = db.prepare(`UPDATE crm_ai_enrichment_events
        SET state='processing',lease_owner=?,lease_expires_at=?,updated_at=?
        WHERE id=? AND (
          state='pending' OR (state='processing' AND lease_expires_at!='' AND lease_expires_at<=?)
        )`).run(owner, expires, at, row.id, at);
      return changed.changes === 1 ? mapEvent(findEventByKey.get(row.event_key)) : null;
    });
    return claim.immediate();
  }

  function completeEvent(eventKey, consumerId) {
    const key = required(eventKey, 'eventKey');
    const owner = required(consumerId, 'consumerId');
    const at = timestamp();
    const changed = db.prepare(`UPDATE crm_ai_enrichment_events
      SET state='consumed',lease_owner='',lease_expires_at='',consumed_at=?,updated_at=?
      WHERE event_key=? AND state='processing' AND lease_owner=?`).run(at, at, key, owner);
    if (changed.changes !== 1) throw new Error('enrichment event lease is not owned');
    return mapEvent(findEventByKey.get(key));
  }

  return Object.freeze({
    createTrigger,
    getRun: runId => mapRun(findRun.get(required(runId, 'runId'))),
    latestForCustomer: customerId => mapRun(db.prepare(`SELECT * FROM crm_ai_enrichment_runs
      WHERE customer_id=? ORDER BY created_at DESC,id DESC LIMIT 1`).get(required(customerId, 'customerId'))),
    claimTrigger,
    markSkipped,
    markNeedsReview,
    attachWorkflow,
    linkNode,
    recordEvent,
    claimEvent,
    completeEvent,
    leaseMs,
  });
}

module.exports = { createCustomerEnrichmentStore };
