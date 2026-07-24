'use strict';

const crypto = require('node:crypto');
const { validateStationOutput } = require('./contracts');
const { installAIStationSchema } = require('./schema');
const { asIso, nonempty, parseJson, safeCost, summarizeError } = require('./audit');

function mapResult(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    jobId: row.job_id,
    customerId: row.customer_id,
    crmAccountId: row.crm_account_id || null,
    station: row.station,
    contextHash: row.context_hash,
    value: parseJson(row.value_json, {}),
    confidence: row.confidence,
    reviewRequired: Boolean(row.review_required),
    engine: row.engine,
    model: row.model,
    promptVersion: row.prompt_version,
    schemaVersion: row.schema_version,
    usage: parseJson(row.usage_json, {}),
    cost: row.cost,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    staleAt: row.stale_at || '',
    staleReason: row.stale_reason || '',
    stale: Boolean(row.stale_at),
  });
}

function createAIResultStore(db, options = {}) {
  installAIStationSchema(db);
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || (prefix => `${prefix}-${crypto.randomUUID()}`);
  const findResultById = db.prepare('SELECT * FROM crm_ai_station_results WHERE id=?');
  const findResultByKey = db.prepare('SELECT * FROM crm_ai_station_results WHERE idempotency_key=?');

  function timestamp() {
    return asIso(now());
  }

  function saveResult(input, idempotencyKey) {
    if (!input || typeof input !== 'object') throw new Error('result input is required');
    const jobId = nonempty(input.jobId, 'jobId');
    const workerId = nonempty(input.workerId, 'workerId');
    const key = nonempty(idempotencyKey, 'idempotencyKey');
    const existing = findResultByKey.get(key);
    if (existing) {
      if (existing.job_id !== jobId) throw new Error('AI result idempotency collision');
      return mapResult(existing);
    }
    const job = db.prepare('SELECT * FROM crm_ai_jobs WHERE id=?').get(jobId);
    if (!job) throw new Error('AI job not found');
    if (job.state !== 'running' || job.lease_owner !== workerId || job.control_state) {
      throw new Error(job.control_state === 'cancel_requested'
        ? 'AI job cancellation was requested'
        : 'AI job lease is not owned by this worker');
    }
    const contextHash = nonempty(input.contextHash, 'contextHash');
    if (job.context_hash !== contextHash) throw new Error('AI result context hash is stale');
    const metadata = input.metadata || {};
    const schemaVersion = nonempty(metadata.schemaVersion, 'schemaVersion');
    const validated = validateStationOutput(job.station, schemaVersion, input.value, {
      evidenceIds: input.evidenceIds,
      ...(input.contactIds ? { contactIds: input.contactIds } : {}),
    });
    if (!validated.ok) throw new Error(`AI result validation failed: ${validated.errors.join('; ')}`);
    const engine = nonempty(metadata.engine, 'engine');
    const model = nonempty(metadata.model, 'model');
    const promptVersion = nonempty(metadata.promptVersion, 'promptVersion');
    const at = timestamp();
    const resultId = nonempty(idFactory('AIR'), 'resultId');
    const state = validated.value.reviewRequired ? 'needs_review' : 'succeeded';
    const transaction = db.transaction(() => {
      db.prepare(`INSERT INTO crm_ai_station_results
        (id,job_id,customer_id,crm_account_id,station,context_hash,value_json,confidence,review_required,
         engine,model,prompt_version,schema_version,usage_json,cost,idempotency_key,generated_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        resultId, job.id, job.customer_id, job.crm_account_id, job.station, contextHash,
        JSON.stringify(validated.value), validated.value.confidence, validated.value.reviewRequired ? 1 : 0,
        engine, model, promptVersion, schemaVersion, JSON.stringify(metadata.usage || {}), safeCost(metadata.cost), key, at, at,
      );
      validated.value.evidenceIds.forEach((evidenceId, position) => {
        db.prepare(`INSERT INTO crm_ai_evidence_bindings
          (result_id,evidence_id,position,idempotency_key,created_at) VALUES (?,?,?,?,?)`)
          .run(resultId, evidenceId, position, `${key}:evidence:${position}`, at);
      });
      const updated = db.prepare(`UPDATE crm_ai_jobs SET state=?,lease_owner='',lease_expires_at='',
        error_summary='',finished_at=?,updated_at=?
        WHERE id=? AND state='running' AND lease_owner=? AND control_state=''`)
        .run(state, at, at, job.id, workerId);
      if (updated.changes !== 1) throw new Error('AI job lease is not owned by this worker');
      if (typeof input.afterSave === 'function') {
        input.afterSave(Object.freeze({
          id: resultId,
          jobId: job.id,
          customerId: job.customer_id,
          crmAccountId: job.crm_account_id || null,
          station: job.station,
          value: validated.value,
          generatedAt: at,
        }));
      }
    });
    transaction.immediate();
    return mapResult(findResultById.get(resultId));
  }

  function recordModelRun(input, idempotencyKey) {
    if (!input || typeof input !== 'object') throw new Error('model run input is required');
    const key = nonempty(idempotencyKey, 'idempotencyKey');
    const existing = db.prepare('SELECT * FROM crm_ai_model_runs WHERE idempotency_key=?').get(key);
    if (existing) {
      if (existing.job_id !== input.jobId) throw new Error('AI model run idempotency collision');
      return Object.freeze({ ...existing, usage: parseJson(existing.usage_json, {}) });
    }
    const job = db.prepare('SELECT station FROM crm_ai_jobs WHERE id=?').get(nonempty(input.jobId, 'jobId'));
    if (!job) throw new Error('AI job not found');
    if (!Number.isInteger(input.attempt) || input.attempt < 1) throw new Error('attempt must be a positive integer');
    if (!['succeeded', 'failed', 'invalid_output'].includes(input.status)) throw new Error('invalid model run status');
    const startedAt = asIso(input.startedAt);
    const finishedAt = asIso(input.finishedAt);
    const durationMs = Math.max(0, Number(input.durationMs) || 0);
    const id = nonempty(idFactory('AIM'), 'modelRunId');
    db.prepare(`INSERT INTO crm_ai_model_runs
      (id,job_id,attempt,station,engine,model,status,duration_ms,usage_json,cost,error_summary,
       idempotency_key,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.jobId, input.attempt, job.station, nonempty(input.engine, 'engine'), nonempty(input.model, 'model'),
      input.status, Math.floor(durationMs), JSON.stringify(input.usage || {}), safeCost(input.cost),
      input.error ? summarizeError(input.error) : '', key, startedAt, finishedAt,
    );
    return Object.freeze({ ...db.prepare('SELECT * FROM crm_ai_model_runs WHERE id=?').get(id), usage: input.usage || {} });
  }

  return Object.freeze({
    saveResult,
    recordModelRun,
    getResult: id => mapResult(findResultById.get(id)),
    getForJob: jobId => mapResult(db.prepare('SELECT * FROM crm_ai_station_results WHERE job_id=?').get(jobId)),
    latestForCustomer: (customerId, station) => mapResult(db.prepare(`SELECT * FROM crm_ai_station_results
      WHERE customer_id=? AND station=? ORDER BY generated_at DESC,id DESC LIMIT 1`).get(customerId, station)),
    latestFreshForCustomer: (customerId, station) => mapResult(db.prepare(`SELECT * FROM crm_ai_station_results
      WHERE customer_id=? AND station=? AND stale_at='' ORDER BY generated_at DESC,id DESC LIMIT 1`)
      .get(customerId, station)),
  });
}

module.exports = { createAIResultStore };
