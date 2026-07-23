'use strict';

const crypto = require('node:crypto');
const { getStation } = require('./prompt_registry');
const { installAIStationSchema } = require('./schema');
const { asIso, nonempty, parseJson, summarizeError } = require('./audit');

const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_RETRY_BASE_MS = 5_000;
const CONTROL_STATES = new Set(['blocked', 'cancel_requested', 'cancelled']);
const RUNNABLE_DEPENDENCIES_SQL = `NOT EXISTS (
  SELECT 1 FROM crm_ai_job_dependencies d
  JOIN crm_ai_jobs dependency ON dependency.id=d.depends_on_job_id
  WHERE d.job_id=crm_ai_jobs.id
    AND (CASE WHEN dependency.control_state IN ('blocked','cancel_requested','cancelled')
      THEN dependency.control_state ELSE dependency.state END) != d.required_state
)`;

function effectiveState(row) {
  return CONTROL_STATES.has(row?.control_state) ? row.control_state : row?.state;
}

function mapJob(row, dependencyIds = []) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    crmAccountId: row.crm_account_id || null,
    station: row.station,
    state: effectiveState(row),
    baseState: row.state,
    workflowId: row.workflow_id || '',
    parentJobId: row.parent_job_id || null,
    eventType: row.event_type || '',
    eventId: row.event_id || '',
    dependencyIds: Object.freeze([...dependencyIds]),
    idempotencyKey: row.idempotency_key,
    contextHash: row.context_hash,
    input: parseJson(row.input_json, {}),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    priority: row.priority,
    nextRunAt: row.next_run_at,
    queuedAt: row.queued_at || row.created_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    errorSummary: row.error_summary,
    blockedKind: row.blocked_kind || '',
    blockedReason: row.blocked_reason || '',
    cancelRequestedAt: row.cancel_requested_at || '',
    cancelledAt: row.cancelled_at || '',
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  });
}

function positiveInteger(value, fallback, name) {
  const selected = value === undefined ? fallback : value;
  if (!Number.isInteger(selected) || selected < 1) throw new Error(`${name} must be a positive integer`);
  return selected;
}

function normalizedIds(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return [...new Set(value.map(item => nonempty(item, name)))].sort();
}

function sameIds(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createAIJobStore(db, options = {}) {
  installAIStationSchema(db);
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || (() => `AIJ-${crypto.randomUUID()}`);
  const leaseMs = positiveInteger(options.leaseMs, DEFAULT_LEASE_MS, 'leaseMs');
  const retryBaseMs = positiveInteger(options.retryBaseMs, DEFAULT_RETRY_BASE_MS, 'retryBaseMs');
  const defaultMaxAttempts = positiveInteger(options.maxAttempts, 3, 'maxAttempts');
  if (defaultMaxAttempts > 20) throw new Error('maxAttempts cannot exceed 20');

  const findById = db.prepare('SELECT * FROM crm_ai_jobs WHERE id=?');
  const findByKey = db.prepare('SELECT * FROM crm_ai_jobs WHERE idempotency_key=?');
  const dependencyRows = db.prepare(`SELECT d.depends_on_job_id,j.state,j.control_state,d.required_state
    FROM crm_ai_job_dependencies d JOIN crm_ai_jobs j ON j.id=d.depends_on_job_id
    WHERE d.job_id=? ORDER BY d.depends_on_job_id`);

  function timestamp() {
    return asIso(now());
  }

  function dependencies(jobId) {
    return dependencyRows.all(jobId);
  }

  function mapped(row) {
    return mapJob(row, row ? dependencies(row.id).map(item => item.depends_on_job_id) : []);
  }

  function dependencyDecision(jobId) {
    const rows = dependencies(jobId);
    if (!rows.length) return { ready: true, reason: '' };
    const unsatisfied = rows.filter(row => effectiveState(row) !== row.required_state);
    if (!unsatisfied.length) return { ready: true, reason: '' };
    const terminal = unsatisfied.find(row => ['dead_letter', 'cancelled'].includes(effectiveState(row)));
    return {
      ready: false,
      reason: terminal
        ? `Dependency ${terminal.depends_on_job_id} ended as ${effectiveState(terminal)}`
        : `Waiting for ${unsatisfied.length} dependency job(s)`,
    };
  }

  function refreshDependencyStates(jobId = '') {
    const selected = jobId
      ? db.prepare(`SELECT id FROM crm_ai_jobs WHERE id=? AND control_state='blocked' AND blocked_kind='dependency'
          AND EXISTS (SELECT 1 FROM crm_ai_job_dependencies d WHERE d.job_id=crm_ai_jobs.id)`).all(jobId)
      : db.prepare(`SELECT id FROM crm_ai_jobs WHERE control_state='blocked' AND blocked_kind='dependency'
          AND EXISTS (SELECT 1 FROM crm_ai_job_dependencies d WHERE d.job_id=crm_ai_jobs.id)`).all();
    const at = timestamp();
    let changed = 0;
    for (const row of selected) {
      const decision = dependencyDecision(row.id);
      const update = decision.ready
        ? db.prepare(`UPDATE crm_ai_jobs SET control_state='',blocked_kind='',blocked_reason='',updated_at=?
            WHERE id=? AND control_state='blocked' AND blocked_kind='dependency'`).run(at, row.id)
        : db.prepare(`UPDATE crm_ai_jobs SET blocked_reason=?,updated_at=?
            WHERE id=? AND control_state='blocked' AND blocked_kind='dependency' AND blocked_reason!=?`)
          .run(decision.reason, at, row.id, decision.reason);
      changed += update.changes;
    }
    return changed;
  }

  function validateRelations(customerId, parentJobId, dependencyIds, jobId) {
    if (parentJobId === jobId || dependencyIds.includes(jobId)) throw new Error('AI job cannot depend on itself');
    for (const relatedId of [...new Set([parentJobId, ...dependencyIds].filter(Boolean))]) {
      const related = findById.get(relatedId);
      if (!related) throw new Error(`AI job relation not found: ${relatedId}`);
      if (related.customer_id !== customerId) throw new Error('AI job relations must belong to the same customer');
    }
  }

  function enqueue(input, idempotencyKey) {
    if (!input || typeof input !== 'object') throw new Error('job input is required');
    const customerId = nonempty(input.customerId, 'customerId');
    const crmAccountId = input.crmAccountId ? nonempty(input.crmAccountId, 'crmAccountId') : null;
    const station = nonempty(input.station, 'station');
    getStation(station, 'v1');
    const contextHash = nonempty(input.contextHash, 'contextHash');
    const key = nonempty(idempotencyKey, 'idempotencyKey');
    const maxAttempts = positiveInteger(input.maxAttempts, defaultMaxAttempts, 'maxAttempts');
    if (maxAttempts > 20) throw new Error('maxAttempts cannot exceed 20');
    const priority = input.priority ?? 0;
    if (!Number.isInteger(priority) || priority < -100 || priority > 100) throw new Error('priority must be between -100 and 100');
    const payload = JSON.stringify(input.payload || {});
    const workflowId = String(input.workflowId || '').trim();
    const parentJobId = input.parentJobId ? nonempty(input.parentJobId, 'parentJobId') : null;
    const eventType = String(input.eventType || '').trim();
    const eventId = String(input.eventId || '').trim();
    if (Boolean(eventType) !== Boolean(eventId)) throw new Error('eventType and eventId must be provided together');
    const dependencyIds = normalizedIds(input.dependsOn, 'dependsOn');
    const existing = findByKey.get(key);
    if (existing) {
      const existingDependencies = dependencies(existing.id).map(item => item.depends_on_job_id);
      if (existing.customer_id !== customerId || existing.crm_account_id !== crmAccountId
          || existing.station !== station || existing.context_hash !== contextHash || existing.input_json !== payload
          || existing.workflow_id !== workflowId || existing.parent_job_id !== parentJobId
          || existing.event_type !== eventType || existing.event_id !== eventId
          || !sameIds(existingDependencies, dependencyIds)) {
        throw new Error('AI job idempotency collision');
      }
      refreshDependencyStates(existing.id);
      return mapped(findById.get(existing.id));
    }
    const at = timestamp();
    const id = nonempty(idFactory(), 'jobId');
    validateRelations(customerId, parentJobId, dependencyIds, id);
    const transaction = db.transaction(() => {
      db.prepare(`INSERT INTO crm_ai_jobs
        (id,customer_id,crm_account_id,station,state,idempotency_key,context_hash,input_json,
         attempts,max_attempts,priority,next_run_at,created_by,created_at,updated_at,workflow_id,parent_job_id)
        VALUES (?,?,?,?, 'queued', ?,?,?,0,?,?,?,?,?,?,?,?)`).run(
        id, customerId, crmAccountId, station, key, contextHash, payload,
        maxAttempts, priority, input.nextRunAt ? asIso(input.nextRunAt) : at,
        String(input.createdBy || ''), at, at, workflowId, parentJobId,
      );
      db.prepare('UPDATE crm_ai_jobs SET event_type=?,event_id=? WHERE id=?').run(eventType, eventId, id);
      db.prepare('UPDATE crm_ai_jobs SET queued_at=? WHERE id=?').run(at, id);
      const insertDependency = db.prepare(`INSERT INTO crm_ai_job_dependencies
        (job_id,depends_on_job_id,required_state,created_at) VALUES (?,?,'succeeded',?)`);
      dependencyIds.forEach(dependencyId => insertDependency.run(id, dependencyId, at));
      if (dependencyIds.length) {
        const decision = dependencyDecision(id);
        if (!decision.ready) db.prepare(`UPDATE crm_ai_jobs
          SET control_state='blocked',blocked_kind='dependency',blocked_reason=? WHERE id=?`)
          .run(decision.reason, id);
      }
    });
    transaction.immediate();
    return mapped(findById.get(id));
  }

  function claimNext(workerId) {
    const owner = nonempty(workerId, 'workerId');
    const claim = db.transaction(() => {
      refreshDependencyStates();
      const at = timestamp();
      const row = db.prepare(`SELECT * FROM crm_ai_jobs
        WHERE control_state='' AND state IN ('queued','retry_wait') AND next_run_at<=?
          AND ${RUNNABLE_DEPENDENCIES_SQL}
        ORDER BY priority DESC,created_at,id LIMIT 1`).get(at);
      if (!row) return null;
      const expires = new Date(new Date(at).getTime() + leaseMs).toISOString();
      const updated = db.prepare(`UPDATE crm_ai_jobs SET state='running',attempts=attempts+1,
        lease_owner=?,lease_expires_at=?,error_summary='',updated_at=?
        WHERE id=? AND control_state='' AND state IN ('queued','retry_wait') AND next_run_at<=?
          AND ${RUNNABLE_DEPENDENCIES_SQL}`)
        .run(owner, expires, at, row.id, at);
      return updated.changes === 1 ? mapped(findById.get(row.id)) : null;
    });
    return claim.immediate();
  }

  function claimById(jobId, workerId) {
    const selectedId = nonempty(jobId, 'jobId');
    const owner = nonempty(workerId, 'workerId');
    const claim = db.transaction(() => {
      refreshDependencyStates(selectedId);
      const at = timestamp();
      const row = findById.get(selectedId);
      if (!row || row.control_state || !['queued', 'retry_wait'].includes(row.state) || row.next_run_at > at) return null;
      const expires = new Date(new Date(at).getTime() + leaseMs).toISOString();
      const updated = db.prepare(`UPDATE crm_ai_jobs SET state='running',attempts=attempts+1,
        lease_owner=?,lease_expires_at=?,error_summary='',updated_at=?
        WHERE id=? AND control_state='' AND state IN ('queued','retry_wait') AND next_run_at<=?
          AND ${RUNNABLE_DEPENDENCIES_SQL}`)
        .run(owner, expires, at, selectedId, at);
      return updated.changes === 1 ? mapped(findById.get(selectedId)) : null;
    });
    return claim.immediate();
  }

  function retry(jobId) {
    const selectedId = nonempty(jobId, 'jobId');
    const row = findById.get(selectedId);
    if (!row) throw Object.assign(new Error('AI job not found'), { statusCode: 404 });
    if (['cancelled', 'blocked'].includes(row.control_state)) {
      const resume = db.transaction(() => {
        const current = findById.get(selectedId);
        if (!current || !['cancelled', 'blocked'].includes(current.control_state)) {
          throw Object.assign(new Error('AI job state changed; refresh and retry'), { statusCode: 409, code: 'AI_JOB_STATE_CHANGED' });
        }
        const at = timestamp();
        const decision = dependencyDecision(selectedId);
        const updated = db.prepare(`UPDATE crm_ai_jobs SET state='queued',control_state=?,blocked_kind=?,next_run_at=?,
          lease_owner='',lease_expires_at='',error_summary='',blocked_reason=?,finished_at='',
          cancel_requested_at='',cancelled_at='',queued_at=?,updated_at=?
          WHERE id=? AND control_state=?`)
          .run(decision.ready ? '' : 'blocked', decision.ready ? '' : 'dependency', at,
            decision.reason, at, at, selectedId, current.control_state);
        if (updated.changes !== 1) {
          throw Object.assign(new Error('AI job state changed; refresh and retry'), { statusCode: 409, code: 'AI_JOB_STATE_CHANGED' });
        }
        return mapped(findById.get(selectedId));
      });
      return resume.immediate();
    }
    if (row.control_state) {
      throw Object.assign(new Error('AI job is not retryable'), { statusCode: 409, code: 'AI_JOB_NOT_RETRYABLE' });
    }
    if (!['retry_wait', 'dead_letter'].includes(row.state)) {
      throw Object.assign(new Error('AI job is not retryable'), { statusCode: 409, code: 'AI_JOB_NOT_RETRYABLE' });
    }
    if (row.state === 'dead_letter' && row.attempts >= 20) {
      throw Object.assign(new Error('AI job reached the retry limit'), { statusCode: 409, code: 'AI_JOB_RETRY_LIMIT' });
    }
    const at = timestamp();
    const maxAttempts = row.state === 'dead_letter'
      ? Math.min(20, Math.max(row.max_attempts, row.attempts + 1))
      : row.max_attempts;
    const updated = db.prepare(`UPDATE crm_ai_jobs SET state='queued',max_attempts=?,next_run_at=?,
      lease_owner='',lease_expires_at='',error_summary='',finished_at='',queued_at=?,updated_at=?
      WHERE id=? AND state=? AND control_state=''`).run(maxAttempts, at, at, at, selectedId, row.state);
    if (updated.changes !== 1) {
      throw Object.assign(new Error('AI job state changed; refresh and retry'), { statusCode: 409, code: 'AI_JOB_STATE_CHANGED' });
    }
    return mapped(findById.get(selectedId));
  }

  function heartbeat(jobId, workerId) {
    const id = nonempty(jobId, 'jobId');
    const owner = nonempty(workerId, 'workerId');
    const at = timestamp();
    const expires = new Date(new Date(at).getTime() + leaseMs).toISOString();
    const updated = db.prepare(`UPDATE crm_ai_jobs SET lease_expires_at=?,updated_at=?
      WHERE id=? AND state='running' AND lease_owner=? AND control_state IN ('','cancel_requested')`)
      .run(expires, at, id, owner);
    if (updated.changes !== 1) throw new Error('AI job lease is not owned by this worker');
    return mapped(findById.get(id));
  }

  function fail(jobId, workerId, error) {
    const owner = nonempty(workerId, 'workerId');
    const row = findById.get(nonempty(jobId, 'jobId'));
    if (!row) throw new Error('AI job not found');
    if (row.control_state === 'cancel_requested') return completeCancellation(row.id, owner);
    const exhausted = row.attempts >= row.max_attempts;
    const state = exhausted ? 'dead_letter' : 'retry_wait';
    const at = timestamp();
    const nextRunAt = exhausted ? at : new Date(new Date(at).getTime() + retryBaseMs * (2 ** Math.max(0, row.attempts - 1))).toISOString();
    const updated = db.prepare(`UPDATE crm_ai_jobs SET state=?,next_run_at=?,lease_owner='',lease_expires_at='',
      error_summary=?,finished_at=?,queued_at=?,updated_at=?
      WHERE id=? AND state='running' AND lease_owner=? AND control_state=''`)
      .run(state, nextRunAt, summarizeError(error), exhausted ? at : '', exhausted ? '' : at, at, row.id, owner);
    if (updated.changes !== 1) throw new Error('AI job lease is not owned by this worker');
    return mapped(findById.get(row.id));
  }

  function block(jobId, workerId, reason) {
    const id = nonempty(jobId, 'jobId');
    const row = findById.get(id);
    if (!row) throw new Error('AI job not found');
    const owner = String(workerId || '').trim();
    if (row.state === 'running' && row.lease_owner !== owner) throw new Error('AI job lease is not owned by this worker');
    if (!['queued', 'retry_wait', 'running'].includes(row.state) || row.control_state) throw new Error('AI job cannot be blocked');
    const at = timestamp();
    const updated = db.prepare(`UPDATE crm_ai_jobs SET state='queued',control_state='blocked',blocked_kind='policy',blocked_reason=?,
      lease_owner='',lease_expires_at='',error_summary=?,finished_at='',queued_at=?,updated_at=?
      WHERE id=? AND control_state=''`).run(summarizeError(reason), summarizeError(reason), at, at, id);
    if (updated.changes !== 1) throw new Error('AI job state changed');
    return mapped(findById.get(id));
  }

  function requestCancel(jobId) {
    const id = nonempty(jobId, 'jobId');
    const cancel = db.transaction(() => {
      const row = findById.get(id);
      if (!row) throw Object.assign(new Error('AI job not found'), { statusCode: 404 });
      if (['succeeded', 'needs_review'].includes(row.state) || row.control_state === 'cancelled') {
        throw Object.assign(new Error('AI job cannot be cancelled'), { statusCode: 409, code: 'AI_JOB_NOT_CANCELLABLE' });
      }
      const at = timestamp();
      const running = row.state === 'running';
      const controlState = running ? 'cancel_requested' : 'cancelled';
      const updated = db.prepare(`UPDATE crm_ai_jobs SET control_state=?,blocked_kind='',cancel_requested_at=?,cancelled_at=?,
        finished_at=?,lease_owner=CASE WHEN ? THEN lease_owner ELSE '' END,
        lease_expires_at=CASE WHEN ? THEN lease_expires_at ELSE '' END,updated_at=?
        WHERE id=? AND state=? AND control_state=?`)
        .run(controlState, at, running ? '' : at, running ? '' : at,
          running ? 1 : 0, running ? 1 : 0, at, id, row.state, row.control_state);
      if (updated.changes !== 1) {
        throw Object.assign(new Error('AI job state changed; refresh and retry'), { statusCode: 409, code: 'AI_JOB_STATE_CHANGED' });
      }
      return mapped(findById.get(id));
    });
    return cancel.immediate();
  }

  function queueHealth(optionsForHealth = {}) {
    refreshDependencyStates();
    const at = timestamp();
    const atMs = new Date(at).getTime();
    const backlogWarning = positiveInteger(optionsForHealth.backlogWarning, 100, 'backlogWarning');
    const maxWaitMs = positiveInteger(optionsForHealth.maxWaitMs, 300_000, 'maxWaitMs');
    const rows = db.prepare(`SELECT state,control_state,created_at,queued_at,next_run_at FROM crm_ai_jobs
      WHERE state IN ('queued','running','retry_wait') OR control_state IN ('blocked','cancel_requested')`).all();
    const pending = rows.filter(row => effectiveState(row) !== 'cancelled');
    const waiting = db.prepare(`SELECT queued_at FROM crm_ai_jobs
      WHERE control_state='' AND state IN ('queued','retry_wait') AND next_run_at<=?
        AND ${RUNNABLE_DEPENDENCIES_SQL} ORDER BY queued_at LIMIT 1`).all(at);
    const oldestWaitingAt = waiting[0]?.queued_at || '';
    const oldestWaitMs = oldestWaitingAt ? Math.max(0, atMs - new Date(oldestWaitingAt).getTime()) : 0;
    const alerts = [];
    if (pending.length >= backlogWarning) alerts.push({ code: 'AI_QUEUE_BACKLOG', value: pending.length, threshold: backlogWarning });
    if (oldestWaitMs >= maxWaitMs) alerts.push({ code: 'AI_QUEUE_WAIT', value: oldestWaitMs, threshold: maxWaitMs });
    return Object.freeze({
      pendingCount: pending.length,
      runningCount: pending.filter(row => row.state === 'running').length,
      blockedCount: pending.filter(row => effectiveState(row) === 'blocked').length,
      oldestWaitingAt,
      oldestWaitMs,
      alerts: Object.freeze(alerts.map(alert => Object.freeze(alert))),
      checkedAt: at,
    });
  }

  function completeCancellation(jobId, workerId) {
    const id = nonempty(jobId, 'jobId');
    const owner = nonempty(workerId, 'workerId');
    const at = timestamp();
    const updated = db.prepare(`UPDATE crm_ai_jobs SET control_state='cancelled',cancelled_at=?,finished_at=?,
      lease_owner='',lease_expires_at='',updated_at=?
      WHERE id=? AND state='running' AND lease_owner=? AND control_state='cancel_requested'`)
      .run(at, at, at, id, owner);
    if (updated.changes !== 1) throw new Error('AI job cancellation is not owned by this worker');
    return mapped(findById.get(id));
  }

  function releaseExpiredLeases() {
    const at = timestamp();
    const rows = db.prepare(`SELECT * FROM crm_ai_jobs
      WHERE state='running' AND lease_expires_at!='' AND lease_expires_at<=? ORDER BY id`).all(at);
    let released = 0;
    for (const row of rows) {
      if (row.control_state === 'cancel_requested') {
        const updated = db.prepare(`UPDATE crm_ai_jobs SET control_state='cancelled',cancelled_at=?,finished_at=?,
          lease_owner='',lease_expires_at='',updated_at=?
          WHERE id=? AND state='running' AND control_state='cancel_requested' AND lease_expires_at<=?`)
          .run(at, at, at, row.id, at);
        released += updated.changes;
        continue;
      }
      const exhausted = row.attempts >= row.max_attempts;
      const state = exhausted ? 'dead_letter' : 'retry_wait';
      const updated = db.prepare(`UPDATE crm_ai_jobs SET state=?,next_run_at=?,lease_owner='',lease_expires_at='',
        error_summary='AI worker lease expired',finished_at=?,queued_at=?,updated_at=?
        WHERE id=? AND state='running' AND control_state='' AND lease_expires_at<=?`)
        .run(state, at, exhausted ? at : '', exhausted ? '' : at, at, row.id, at);
      released += updated.changes;
    }
    return released;
  }

  function getJob(id) {
    const selectedId = String(id || '').trim();
    if (!selectedId) return null;
    refreshDependencyStates(selectedId);
    return mapped(findById.get(selectedId));
  }

  return Object.freeze({
    enqueue,
    claimNext,
    claimById,
    retry,
    heartbeat,
    fail,
    block,
    requestCancel,
    completeCancellation,
    queueHealth,
    refreshDependencyStates,
    releaseExpiredLeases,
    getJob,
    findByIdempotencyKey: key => {
      const row = findByKey.get(key);
      if (row) refreshDependencyStates(row.id);
      return mapped(row ? findById.get(row.id) : null);
    },
    latestForCustomer: (customerId, station) => {
      const row = db.prepare(`SELECT * FROM crm_ai_jobs
        WHERE customer_id=? AND station=? ORDER BY created_at DESC,id DESC LIMIT 1`).get(customerId, station);
      if (row) refreshDependencyStates(row.id);
      return mapped(row ? findById.get(row.id) : null);
    },
    leaseMs,
  });
}

module.exports = { createAIJobStore, effectiveState };
