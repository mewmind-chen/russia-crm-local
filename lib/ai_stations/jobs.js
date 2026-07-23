'use strict';

const crypto = require('node:crypto');
const { getStation } = require('./prompt_registry');
const { installAIStationSchema } = require('./schema');
const { asIso, nonempty, parseJson, summarizeError } = require('./audit');

const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_RETRY_BASE_MS = 5_000;

function mapJob(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    crmAccountId: row.crm_account_id || null,
    station: row.station,
    state: row.state,
    idempotencyKey: row.idempotency_key,
    contextHash: row.context_hash,
    input: parseJson(row.input_json, {}),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    priority: row.priority,
    nextRunAt: row.next_run_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    errorSummary: row.error_summary,
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

  function timestamp() {
    return asIso(now());
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
    const existing = findByKey.get(key);
    if (existing) {
      if (existing.customer_id !== customerId || existing.crm_account_id !== crmAccountId
          || existing.station !== station || existing.context_hash !== contextHash || existing.input_json !== payload) {
        throw new Error('AI job idempotency collision');
      }
      return mapJob(existing);
    }
    const at = timestamp();
    db.prepare(`INSERT INTO crm_ai_jobs
      (id,customer_id,crm_account_id,station,state,idempotency_key,context_hash,input_json,
       attempts,max_attempts,priority,next_run_at,created_by,created_at,updated_at)
      VALUES (?,?,?,?, 'queued', ?,?,?,0,?,?,?,?,?,?)`).run(
      nonempty(idFactory(), 'jobId'), customerId, crmAccountId, station, key, contextHash, payload,
      maxAttempts, priority, input.nextRunAt ? asIso(input.nextRunAt) : at,
      String(input.createdBy || ''), at, at,
    );
    return mapJob(findByKey.get(key));
  }

  function claimNext(workerId) {
    const owner = nonempty(workerId, 'workerId');
    const claim = db.transaction(() => {
      const at = timestamp();
      const row = db.prepare(`SELECT * FROM crm_ai_jobs
        WHERE state IN ('queued','retry_wait') AND next_run_at<=?
        ORDER BY priority DESC,created_at,id LIMIT 1`).get(at);
      if (!row) return null;
      const expires = new Date(new Date(at).getTime() + leaseMs).toISOString();
      const updated = db.prepare(`UPDATE crm_ai_jobs SET state='running',attempts=attempts+1,
        lease_owner=?,lease_expires_at=?,error_summary='',updated_at=?
        WHERE id=? AND state IN ('queued','retry_wait') AND next_run_at<=?`)
        .run(owner, expires, at, row.id, at);
      return updated.changes === 1 ? mapJob(findById.get(row.id)) : null;
    });
    return claim.immediate();
  }

  function fail(jobId, workerId, error) {
    const owner = nonempty(workerId, 'workerId');
    const row = findById.get(nonempty(jobId, 'jobId'));
    if (!row) throw new Error('AI job not found');
    const exhausted = row.attempts >= row.max_attempts;
    const state = exhausted ? 'dead_letter' : 'retry_wait';
    const at = timestamp();
    const nextRunAt = exhausted ? at : new Date(new Date(at).getTime() + retryBaseMs * (2 ** Math.max(0, row.attempts - 1))).toISOString();
    const updated = db.prepare(`UPDATE crm_ai_jobs SET state=?,next_run_at=?,lease_owner='',lease_expires_at='',
      error_summary=?,finished_at=?,updated_at=? WHERE id=? AND state='running' AND lease_owner=?`)
      .run(state, nextRunAt, summarizeError(error), exhausted ? at : '', at, row.id, owner);
    if (updated.changes !== 1) throw new Error('AI job lease is not owned by this worker');
    return mapJob(findById.get(row.id));
  }

  function releaseExpiredLeases() {
    const at = timestamp();
    const rows = db.prepare(`SELECT * FROM crm_ai_jobs
      WHERE state='running' AND lease_expires_at!='' AND lease_expires_at<=? ORDER BY id`).all(at);
    let released = 0;
    for (const row of rows) {
      const exhausted = row.attempts >= row.max_attempts;
      const state = exhausted ? 'dead_letter' : 'retry_wait';
      const updated = db.prepare(`UPDATE crm_ai_jobs SET state=?,next_run_at=?,lease_owner='',lease_expires_at='',
        error_summary='AI worker lease expired',finished_at=?,updated_at=?
        WHERE id=? AND state='running' AND lease_expires_at<=?`)
        .run(state, at, exhausted ? at : '', at, row.id, at);
      released += updated.changes;
    }
    return released;
  }

  return Object.freeze({
    enqueue,
    claimNext,
    fail,
    releaseExpiredLeases,
    getJob: id => mapJob(findById.get(id)),
    findByIdempotencyKey: key => mapJob(findByKey.get(key)),
  });
}

module.exports = { createAIJobStore };
