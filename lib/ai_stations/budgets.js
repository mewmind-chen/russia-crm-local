'use strict';

const crypto = require('node:crypto');
const { asIso } = require('./audit');
const { installAIStationSchema } = require('./schema');

const MICROS_PER_UNIT = 1_000_000;
const DEFAULT_COMPANY_ID = 'default';
const DEFAULT_PRICING = Object.freeze({
  version: 'control-plane-default-v1',
  currency: 'USD',
  defaultAttemptCost: 0.05,
  inputPerMillion: 1,
  outputPerMillion: 4,
  reserveInputTokens: 3_000,
  reserveOutputTokens: 1_500,
});

function finiteNonnegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function toMicros(value) {
  return Math.max(0, Math.ceil(finiteNonnegative(value) * MICROS_PER_UNIT));
}

function fromMicros(value) {
  return Number(value || 0) / MICROS_PER_UNIT;
}

function integerToken(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function firstToken(source, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = integerToken(source[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function normalizeUsage(usage, pricing = DEFAULT_PRICING) {
  const source = usage && typeof usage === 'object' && !Array.isArray(usage) ? usage : {};
  const input = firstToken(source, ['input_tokens', 'prompt_tokens', 'input', 'promptTokens']);
  const output = firstToken(source, ['output_tokens', 'completion_tokens', 'output', 'completionTokens']);
  const total = firstToken(source, ['total_tokens', 'total', 'totalTokens']);
  const supplied = input !== null || output !== null || total !== null;
  if (!supplied) {
    const estimatedInput = Math.floor(finiteNonnegative(pricing.reserveInputTokens, DEFAULT_PRICING.reserveInputTokens));
    const estimatedOutput = Math.floor(finiteNonnegative(pricing.reserveOutputTokens, DEFAULT_PRICING.reserveOutputTokens));
    return Object.freeze({
      inputTokens: estimatedInput,
      outputTokens: estimatedOutput,
      totalTokens: estimatedInput + estimatedOutput,
      source: 'estimated_missing',
    });
  }
  const inputTokens = input || 0;
  let outputTokens = output || 0;
  let adjustedInputTokens = inputTokens;
  if (total !== null) {
    if (input === null && output === null) outputTokens = total;
    else if (input === null) adjustedInputTokens = Math.max(0, total - outputTokens);
    else if (output === null) outputTokens = Math.max(0, total - adjustedInputTokens);
  }
  return Object.freeze({
    inputTokens: adjustedInputTokens,
    outputTokens,
    totalTokens: total === null
      ? adjustedInputTokens + outputTokens
      : Math.max(total, adjustedInputTokens + outputTokens),
    source: 'provider',
  });
}

function normalizePricing(value = {}) {
  const pricing = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const defaults = pricing.default && typeof pricing.default === 'object' ? pricing.default : {};
  return Object.freeze({
    version: String(pricing.version || DEFAULT_PRICING.version),
    currency: String(pricing.currency || DEFAULT_PRICING.currency),
    default: Object.freeze({
      defaultAttemptCost: finiteNonnegative(defaults.defaultAttemptCost, DEFAULT_PRICING.defaultAttemptCost),
      inputPerMillion: finiteNonnegative(defaults.inputPerMillion, DEFAULT_PRICING.inputPerMillion),
      outputPerMillion: finiteNonnegative(defaults.outputPerMillion, DEFAULT_PRICING.outputPerMillion),
      reserveInputTokens: finiteNonnegative(defaults.reserveInputTokens, DEFAULT_PRICING.reserveInputTokens),
      reserveOutputTokens: finiteNonnegative(defaults.reserveOutputTokens, DEFAULT_PRICING.reserveOutputTokens),
    }),
    engines: pricing.engines && typeof pricing.engines === 'object' && !Array.isArray(pricing.engines)
      ? pricing.engines : {},
    models: pricing.models && typeof pricing.models === 'object' && !Array.isArray(pricing.models)
      ? pricing.models : {},
  });
}

function pricingFor(config, engine = '', model = '') {
  const selected = {
    ...config.default,
    ...(config.engines[String(engine || '')] || {}),
    ...(config.models[String(model || '')] || {}),
  };
  return {
    defaultAttemptCost: finiteNonnegative(selected.defaultAttemptCost, config.default.defaultAttemptCost),
    inputPerMillion: finiteNonnegative(selected.inputPerMillion, config.default.inputPerMillion),
    outputPerMillion: finiteNonnegative(selected.outputPerMillion, config.default.outputPerMillion),
    reserveInputTokens: finiteNonnegative(selected.reserveInputTokens, config.default.reserveInputTokens),
    reserveOutputTokens: finiteNonnegative(selected.reserveOutputTokens, config.default.reserveOutputTokens),
  };
}

function estimatedMicros(usage, pricing) {
  if (usage.source === 'estimated_missing') return toMicros(pricing.defaultAttemptCost);
  return Math.max(0, Math.ceil(
    usage.inputTokens * finiteNonnegative(pricing.inputPerMillion)
    + usage.outputTokens * finiteNonnegative(pricing.outputPerMillion),
  ));
}

function scopeIdentity(input = {}, defaultCompanyId = DEFAULT_COMPANY_ID) {
  return Object.freeze({
    company: String(input.companyId || defaultCompanyId).trim() || defaultCompanyId,
    team: String(input.teamId || '').trim(),
    user: String(input.actorId || '').trim(),
    station: String(input.station || '').trim(),
  });
}

function policyApplies(policy, scopes) {
  return scopes[policy.scope_type] === policy.scope_id;
}

function scopeFilter(scopeType) {
  if (scopeType === 'company') return 'company_id=?';
  if (scopeType === 'team') return 'team_id=?';
  if (scopeType === 'user') return 'actor_id=?';
  if (scopeType === 'station') return 'station=?';
  throw new Error(`Unsupported AI budget scope: ${scopeType}`);
}

function periodBounds(date, kind) {
  const value = new Date(date);
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  const day = kind === 'daily' ? value.getUTCDate() : 1;
  const start = new Date(Date.UTC(year, month, day));
  const end = kind === 'daily'
    ? new Date(Date.UTC(year, month, day + 1))
    : new Date(Date.UTC(year, month + 1, 1));
  return { start: start.toISOString(), end: end.toISOString(), key: start.toISOString().slice(0, kind === 'daily' ? 10 : 7) };
}

function createBudgetError(decision) {
  const error = new Error(
    `AI budget exhausted for ${decision.scopeType}:${decision.scopeId} (${decision.periodKind})`,
  );
  error.code = 'AI_BUDGET_EXHAUSTED';
  error.statusCode = 429;
  error.budget = decision;
  return error;
}

function createAIBudgetStore(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('database is required');
  installAIStationSchema(db);
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const idFactory = options.idFactory || (prefix => `${prefix}-${crypto.randomUUID()}`);
  const pricing = normalizePricing(options.pricing);
  const defaultCompanyId = String(options.companyId || DEFAULT_COMPANY_ID);
  const onAlert = typeof options.onAlert === 'function' ? options.onAlert : null;

  const policyRows = () => db.prepare(`SELECT * FROM crm_ai_budget_policies
    WHERE enabled=1 ORDER BY scope_type,scope_id`).all();

  function setPolicy(input = {}) {
    const scopeType = String(input.scopeType || '').trim();
    const scopeId = String(input.scopeId || '').trim();
    if (!['company', 'team', 'user', 'station'].includes(scopeType)) throw new Error('scopeType is invalid');
    if (!scopeId) throw new Error('scopeId is required');
    const at = asIso(input.at || now());
    const warningRatio = Number(input.warningRatio ?? 0.8);
    if (!Number.isFinite(warningRatio) || warningRatio <= 0 || warningRatio >= 1) {
      throw new Error('warningRatio must be greater than 0 and less than 1');
    }
    const existing = db.prepare('SELECT id,created_at FROM crm_ai_budget_policies WHERE scope_type=? AND scope_id=?')
      .get(scopeType, scopeId);
    const id = existing?.id || idFactory('AIBP');
    db.prepare(`INSERT INTO crm_ai_budget_policies
      (id,scope_type,scope_id,daily_limit_micros,monthly_limit_micros,per_task_limit_micros,
       warning_ratio,enabled,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(scope_type,scope_id) DO UPDATE SET
        daily_limit_micros=excluded.daily_limit_micros,
        monthly_limit_micros=excluded.monthly_limit_micros,
        per_task_limit_micros=excluded.per_task_limit_micros,
        warning_ratio=excluded.warning_ratio,
        enabled=excluded.enabled,
        updated_at=excluded.updated_at`).run(
      id,
      scopeType,
      scopeId,
      toMicros(input.dailyLimit),
      toMicros(input.monthlyLimit),
      toMicros(input.perTaskLimit),
      warningRatio,
      input.enabled === false ? 0 : 1,
      existing?.created_at || at,
      at,
    );
    return db.prepare('SELECT * FROM crm_ai_budget_policies WHERE id=?').get(id);
  }

  function syncPolicies(policies = []) {
    if (!Array.isArray(policies)) throw new Error('AI budget policies must be an array');
    const sync = db.transaction(() => policies.map(setPolicy));
    return sync.immediate();
  }

  function spentFor(policy, bounds) {
    const filter = scopeFilter(policy.scope_type);
    return Number(db.prepare(`SELECT COALESCE(SUM(charged_cost_micros),0) total
      FROM crm_ai_usage_ledger WHERE ${filter} AND accounted_at>=? AND accounted_at<?`)
      .get(policy.scope_id, bounds.start, bounds.end).total || 0);
  }

  function activeReservationsFor(policy, bounds) {
    const filter = scopeFilter(policy.scope_type);
    return Number(db.prepare(`SELECT COALESCE(SUM(reserved_micros),0) total
      FROM crm_ai_budget_reservations
      WHERE state='reserved' AND ${filter} AND accounted_at>=? AND accounted_at<?`)
      .get(policy.scope_id, bounds.start, bounds.end).total || 0);
  }

  function recordAlert(policy, periodKind, periodKey, threshold, projected, limit, at) {
    const id = idFactory('AIBA');
    const inserted = db.prepare(`INSERT OR IGNORE INTO crm_ai_budget_alerts
      (id,policy_id,scope_type,scope_id,period_kind,period_key,threshold_ratio,
       projected_micros,limit_micros,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      id, policy.id, policy.scope_type, policy.scope_id, periodKind, periodKey,
      threshold, projected, limit, at,
    );
    if (inserted.changes && onAlert) {
      try {
        onAlert(Object.freeze({
          id,
          scopeType: policy.scope_type,
          scopeId: policy.scope_id,
          periodKind,
          periodKey,
          thresholdRatio: threshold,
          projectedCost: fromMicros(projected),
          limit: fromMicros(limit),
          createdAt: at,
        }));
      } catch (_error) {
        // Budget persistence must not depend on an operational alert transport.
      }
    }
  }

  function evaluatePolicies(scopes, amount, at, input = {}) {
    let denied = null;
    for (const policy of policyRows().filter(row => policyApplies(row, scopes))) {
      const perTaskLimit = Number(policy.per_task_limit_micros || 0);
      if (perTaskLimit > 0 && amount >= perTaskLimit) {
        recordAlert(policy, 'task', input.jobId, 1, amount, perTaskLimit, at);
        if (!input.essential) {
          denied ||= {
            scopeType: policy.scope_type,
            scopeId: policy.scope_id,
            periodKind: 'task',
            projected: fromMicros(amount),
            limit: fromMicros(perTaskLimit),
          };
        }
      } else if (perTaskLimit > 0 && amount >= Math.ceil(perTaskLimit * Number(policy.warning_ratio))) {
        recordAlert(policy, 'task', input.jobId, Number(policy.warning_ratio), amount, perTaskLimit, at);
      }
      for (const periodKind of ['daily', 'monthly']) {
        const limit = Number(policy[`${periodKind}_limit_micros`] || 0);
        if (limit <= 0) continue;
        const bounds = periodBounds(at, periodKind);
        const projected = spentFor(policy, bounds) + activeReservationsFor(policy, bounds) + amount;
        if (projected >= limit) {
          recordAlert(policy, periodKind, bounds.key, 1, projected, limit, at);
          if (!input.essential) {
            denied ||= {
              scopeType: policy.scope_type,
              scopeId: policy.scope_id,
              periodKind,
              projected: fromMicros(projected),
              limit: fromMicros(limit),
            };
          }
        } else if (projected >= Math.ceil(limit * Number(policy.warning_ratio))) {
          recordAlert(policy, periodKind, bounds.key, Number(policy.warning_ratio), projected, limit, at);
        }
      }
    }
    return denied;
  }

  function reserve(input = {}) {
    const jobId = String(input.jobId || '').trim();
    const attempt = Number(input.attempt);
    const scopes = scopeIdentity(input, defaultCompanyId);
    if (!jobId) throw new Error('jobId is required');
    if (!Number.isInteger(attempt) || attempt < 1) throw new Error('attempt must be a positive integer');
    if (!scopes.user) throw new Error('actorId is required');
    if (!scopes.station) throw new Error('station is required');
    const at = asIso(input.at || now());
    const attempts = Number.isInteger(input.maxEngineAttempts) && input.maxEngineAttempts > 0
      ? input.maxEngineAttempts : 1;
    const attemptPricing = pricingFor(pricing, input.engine, input.model);
    const normalized = normalizeUsage(input.estimatedUsage, attemptPricing);
    const perAttempt = input.estimatedCost === undefined
      ? estimatedMicros(normalized, attemptPricing) : toMicros(input.estimatedCost);
    const amount = Math.max(0, perAttempt * attempts);
    const create = db.transaction(() => {
      const existing = db.prepare(`SELECT * FROM crm_ai_budget_reservations
        WHERE job_id=? AND attempt=?`).get(jobId, attempt);
      if (existing) return { reservation: existing, denied: null };
      const denied = evaluatePolicies(scopes, amount, at, {
        essential: Boolean(input.essential),
        jobId,
      });
      if (denied) return { reservation: null, denied };
      const id = idFactory('AIBR');
      db.prepare(`INSERT INTO crm_ai_budget_reservations
        (id,job_id,attempt,company_id,team_id,actor_id,station,reserved_micros,charged_micros,
         released_micros,state,essential,pricing_version,accounted_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,0,0,'reserved',?,?,?,?,?)`).run(
        id, jobId, attempt, scopes.company, scopes.team, scopes.user, scopes.station, amount,
        input.essential ? 1 : 0, pricing.version, at, at, at,
      );
      return {
        reservation: db.prepare('SELECT * FROM crm_ai_budget_reservations WHERE id=?').get(id),
        denied: null,
      };
    });
    const result = create.immediate();
    if (result.denied) throw createBudgetError(result.denied);
    return Object.freeze({ ...result.reservation, reservedCost: fromMicros(result.reservation.reserved_micros) });
  }

  function normalizeAttempt(attempt, index) {
    const engine = String(attempt?.engine || 'unknown');
    const model = String(attempt?.model || 'unknown');
    const selectedPricing = pricingFor(pricing, engine, model);
    const billable = attempt?.billable !== false;
    const usage = billable
      ? normalizeUsage(attempt?.usage, selectedPricing)
      : { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: 'not_applicable' };
    const estimate = billable ? estimatedMicros(usage, selectedPricing) : 0;
    const hasActualCost = billable && attempt?.cost !== undefined
      && Number.isFinite(Number(attempt.cost)) && Number(attempt.cost) >= 0;
    const actual = hasActualCost ? toMicros(attempt.cost) : 0;
    return {
      sequence: index + 1,
      engine,
      model,
      status: ['succeeded', 'failed', 'invalid_output'].includes(attempt?.status)
        ? attempt.status : (attempt?.ok === false ? 'failed' : 'succeeded'),
      usage,
      estimatedCostMicros: estimate,
      actualCostMicros: actual,
      chargedCostMicros: billable ? (hasActualCost ? actual : estimate) : 0,
      costSource: !billable ? 'not_billable'
        : hasActualCost ? 'provider'
          : usage.source === 'provider' ? 'estimated_usage' : 'estimated_missing',
      fallbackFrom: index > 0 ? String(attempt?.fallbackFrom || '') : '',
      errorCode: String(attempt?.code || attempt?.errorCode || ''),
    };
  }

  function settle(reservationId, attempts = [], input = {}) {
    const id = String(reservationId || '').trim();
    if (!id) throw new Error('reservationId is required');
    if (!Array.isArray(attempts) || attempts.length < 1) throw new Error('at least one model attempt is required');
    const at = asIso(input.at || now());
    const settleTransaction = db.transaction(() => {
      const reservation = db.prepare('SELECT * FROM crm_ai_budget_reservations WHERE id=?').get(id);
      if (!reservation) throw new Error('AI budget reservation not found');
      if (reservation.state === 'released') throw new Error('AI budget reservation was already released');
      if (reservation.state === 'settled') return reservation;
      const normalized = attempts.map((attempt, index) => normalizeAttempt(attempt, index));
      normalized.forEach((attempt, index) => {
        const fallbackFrom = index > 0
          ? (attempt.fallbackFrom || normalized[index - 1].engine) : '';
        db.prepare(`INSERT OR IGNORE INTO crm_ai_usage_ledger
          (id,event_key,reservation_id,job_id,attempt,sequence,company_id,team_id,actor_id,station,
           engine,model,status,input_tokens,output_tokens,total_tokens,usage_source,estimated_cost_micros,
           actual_cost_micros,charged_cost_micros,cost_source,fallback_from,error_code,pricing_version,
           accounted_at,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          idFactory('AIUL'), `reservation:${id}:attempt:${attempt.sequence}`, id, reservation.job_id,
          reservation.attempt, attempt.sequence, reservation.company_id, reservation.team_id,
          reservation.actor_id, reservation.station, attempt.engine, attempt.model, attempt.status,
          attempt.usage.inputTokens, attempt.usage.outputTokens, attempt.usage.totalTokens,
          attempt.usage.source, attempt.estimatedCostMicros, attempt.actualCostMicros,
          attempt.chargedCostMicros, attempt.costSource, fallbackFrom, attempt.errorCode,
          reservation.pricing_version, reservation.accounted_at, at,
        );
      });
      const charged = Number(db.prepare(`SELECT COALESCE(SUM(charged_cost_micros),0) total
        FROM crm_ai_usage_ledger WHERE reservation_id=?`).get(id).total || 0);
      const released = Math.max(0, Number(reservation.reserved_micros) - charged);
      db.prepare(`UPDATE crm_ai_budget_reservations SET state='settled',charged_micros=?,
        released_micros=?,settled_at=?,updated_at=? WHERE id=?`).run(charged, released, at, at, id);
      const scopes = scopeIdentity({
        companyId: reservation.company_id,
        teamId: reservation.team_id,
        actorId: reservation.actor_id,
        station: reservation.station,
      }, defaultCompanyId);
      for (const policy of policyRows().filter(row => policyApplies(row, scopes))) {
        for (const periodKind of ['daily', 'monthly']) {
          const limit = Number(policy[`${periodKind}_limit_micros`] || 0);
          if (limit <= 0) continue;
          const bounds = periodBounds(reservation.accounted_at, periodKind);
          const spent = spentFor(policy, bounds);
          if (spent >= limit) recordAlert(policy, periodKind, bounds.key, 1, spent, limit, at);
          else if (spent >= Math.ceil(limit * Number(policy.warning_ratio))) {
            recordAlert(policy, periodKind, bounds.key, Number(policy.warning_ratio), spent, limit, at);
          }
        }
      }
      return db.prepare('SELECT * FROM crm_ai_budget_reservations WHERE id=?').get(id);
    });
    const reservation = settleTransaction.immediate();
    return Object.freeze({
      ...reservation,
      chargedCost: fromMicros(reservation.charged_micros),
      releasedCost: fromMicros(reservation.released_micros),
      attempts: ledgerForJob(reservation.job_id).filter(row => row.reservation_id === id),
    });
  }

  function release(reservationId, reason = '', input = {}) {
    const id = String(reservationId || '').trim();
    if (!id) throw new Error('reservationId is required');
    const at = asIso(input.at || now());
    db.prepare(`UPDATE crm_ai_budget_reservations SET state='released',released_micros=reserved_micros,
      settled_at=?,release_reason=?,updated_at=? WHERE id=? AND state='reserved'`)
      .run(at, String(reason || ''), at, id);
    const row = db.prepare('SELECT * FROM crm_ai_budget_reservations WHERE id=?').get(id);
    if (!row) throw new Error('AI budget reservation not found');
    return Object.freeze({ ...row, releasedCost: fromMicros(row.released_micros) });
  }

  function releaseOrphanedReservations(input = {}) {
    const at = asIso(input.at || now());
    return db.prepare(`UPDATE crm_ai_budget_reservations
      SET state='released',released_micros=reserved_micros,settled_at=?,
          release_reason='job is no longer running',updated_at=?
      WHERE state='reserved' AND NOT EXISTS (
        SELECT 1 FROM crm_ai_jobs job
        WHERE job.id=crm_ai_budget_reservations.job_id
          AND job.state='running' AND job.control_state=''
      )`).run(at, at).changes;
  }

  function recordNonBillable(input = {}) {
    const jobId = String(input.jobId || '').trim();
    const eventKey = String(input.eventKey || '').trim();
    const scopes = scopeIdentity(input, defaultCompanyId);
    const status = String(input.status || '');
    if (!jobId || !eventKey) throw new Error('jobId and eventKey are required');
    if (!['cache_hit', 'deduplicated'].includes(status)) throw new Error('non-billable status is invalid');
    if (!scopes.user || !scopes.station) throw new Error('actorId and station are required');
    const at = asIso(input.at || now());
    db.prepare(`INSERT OR IGNORE INTO crm_ai_usage_ledger
      (id,event_key,reservation_id,job_id,attempt,sequence,company_id,team_id,actor_id,station,
       engine,model,status,input_tokens,output_tokens,total_tokens,usage_source,estimated_cost_micros,
       actual_cost_micros,charged_cost_micros,cost_source,fallback_from,error_code,pricing_version,
       accounted_at,created_at)
      VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,'not_applicable',0,0,0,'not_billable','','',?,?,?)`).run(
      idFactory('AIUL'), eventKey, jobId, Number.isInteger(input.attempt) ? input.attempt : 0,
      Number.isInteger(input.sequence) ? input.sequence : 0, scopes.company, scopes.team, scopes.user,
      scopes.station, String(input.engine || ''), String(input.model || ''), status, 0, 0, 0,
      pricing.version, at, at,
    );
    return db.prepare('SELECT * FROM crm_ai_usage_ledger WHERE event_key=?').get(eventKey);
  }

  function ledgerForJob(jobId) {
    return db.prepare(`SELECT * FROM crm_ai_usage_ledger WHERE job_id=?
      ORDER BY attempt,sequence,created_at,id`).all(String(jobId || ''));
  }

  return Object.freeze({
    pricing,
    setPolicy,
    syncPolicies,
    reserve,
    settle,
    release,
    releaseOrphanedReservations,
    recordNonBillable,
    ledgerForJob,
    getReservation: id => db.prepare('SELECT * FROM crm_ai_budget_reservations WHERE id=?').get(String(id || '')),
    listPolicies: () => db.prepare('SELECT * FROM crm_ai_budget_policies ORDER BY scope_type,scope_id').all(),
    listAlerts: () => db.prepare('SELECT * FROM crm_ai_budget_alerts ORDER BY created_at,id').all(),
  });
}

module.exports = {
  DEFAULT_PRICING,
  MICROS_PER_UNIT,
  createAIBudgetStore,
  fromMicros,
  normalizePricing,
  normalizeUsage,
  toMicros,
};
