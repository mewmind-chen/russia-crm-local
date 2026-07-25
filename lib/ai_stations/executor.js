'use strict';

const { callAssistantModel, assistantAdapters } = require('../assistant');
const { validateStationOutput } = require('./contracts');
const { buildCustomerContext } = require('./context');
const {
  applyContactReadinessRouting,
  buildContactReadinessContext,
} = require('./contact_readiness');
const { renderPrompt } = require('./prompt_registry');
const { recordSalesPackNotification } = require('./sales_pack');
const {
  buildManagerAnomalyContext,
  recordManagerAnomalyNotification,
} = require('./manager_anomaly');
const {
  buildSalesCoachingContext,
  recordSalesCoachingNotification,
} = require('./sales_coaching');
const { createAIBudgetStore } = require('./budgets');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');
const { onlineModelPolicy } = require('./model_policy');
const { asIso, summarizeError } = require('./audit');

function jsonObjectCandidates(raw) {
  const candidates = [];
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          candidates.push(raw.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

function parseOutput(answer) {
  const raw = String(answer || '').trim();
  if (!raw) throw createStationError('AI station returned an empty answer', 'AI_STATION_INVALID_OUTPUT', 422);
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidates = [fenced, raw, ...jsonObjectCandidates(raw)].filter(Boolean).map(value => value.trim());
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch (_error) {
      // Try the next bounded JSON object; schema validation remains fail-closed.
    }
  }
  throw createStationError('AI station returned invalid JSON', 'AI_STATION_INVALID_OUTPUT', 422);
}

function stationMessages(prompt) {
  return [
    {
      role: 'system',
      content: [
        prompt.systemPolicy,
        `Server actor scope:\n${JSON.stringify(prompt.actorScope)}`,
        `Output schema:\n${JSON.stringify(prompt.outputSchema)}`,
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        trustedCrmContext: prompt.trustedCrmContext,
        evidence: prompt.evidence,
        untrustedUserContent: prompt.untrustedUserContent,
      }),
    },
  ];
}

function actorPermissions(actor, accessContext) {
  if (Array.isArray(actor?.permissions)) return actor.permissions;
  return Object.entries(accessContext?.permissions || {})
    .filter(([, allowed]) => allowed)
    .map(([permission]) => permission);
}

function createStationError(message, code = 'AI_STATION_FAILED', statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function governedAdapters(jobStore, jobId, workerId, adapters) {
  if (!jobStore || typeof jobStore.acquireResource !== 'function') return adapters;
  return Object.fromEntries(Object.entries(adapters || {}).map(([engine, adapter]) => [
    engine,
    async (...args) => {
      const claim = jobStore.acquireResource(engine, jobId, workerId);
      if (!claim.acquired) {
        const error = createStationError(
          `AI execution resource ${engine} is at its configured limit`,
          `${String(engine).replace(/[^a-z0-9]+/gi, '_').toUpperCase()}_CONTROL_PLANE_LIMIT`,
          429,
        );
        error.engine = engine;
        if (claim.retryAt) error.retryAt = claim.retryAt;
        throw error;
      }
      try {
        return await adapter(...args);
      } catch (error) {
        if (!error.engine) error.engine = engine;
        throw error;
      } finally {
        if (claim.releaseRequired) jobStore.releaseResource(engine, jobId, workerId);
      }
    },
  ]));
}

function isNonBillableControlPlaneAttempt(attempt) {
  return /_CONTROL_PLANE_LIMIT$/.test(String(attempt?.code || attempt?.errorCode || ''));
}

function costedAttempts(source, finalStatus = 'succeeded') {
  const provided = Array.isArray(source?.engineAttempts) && source.engineAttempts.length
    ? source.engineAttempts : (source?.engine ? [{ engine: source.engine, ok: true }] : []);
  return provided.map((attempt, index) => {
    const isFinal = index === provided.length - 1;
    const succeeded = attempt.ok !== false && isFinal;
    return {
      ...attempt,
      model: attempt.model || (succeeded ? source?.model : '') || 'unknown',
      status: succeeded ? finalStatus : (attempt.status === 'invalid_output' ? 'invalid_output' : 'failed'),
      usage: attempt.usage || (succeeded ? source?.usage : undefined),
      cost: attempt.cost === undefined && succeeded ? source?.cost : attempt.cost,
      billable: !isNonBillableControlPlaneAttempt(attempt),
    };
  });
}

function recordAttemptRuns(resultStore, source, input = {}) {
  const attempts = costedAttempts(source, input.finalStatus || 'succeeded');
  const settledAttempts = input.settlement?.attempts || [];
  let finalRun = null;
  attempts.forEach((attempt, index) => {
    const ledger = settledAttempts[index] || {};
    const run = resultStore.recordModelRun({
      jobId: input.jobId,
      attempt: input.attempt,
      engine: attempt.engine || 'unknown',
      model: attempt.model || 'unknown',
      status: attempt.status,
      durationMs: attempt.durationMs ?? input.durationMs,
      usage: attempt.usage || {},
      cost: Number(ledger.charged_cost_micros || 0) / 1_000_000,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      error: attempt.ok === false ? (attempt.error || attempt.code || input.error) : undefined,
      requestId: attempt.requestId,
      traceId: attempt.traceId || input.traceId,
      finishReason: attempt.finishReason,
      originalCost: attempt.originalCost,
      originalCurrency: attempt.originalCurrency,
      pricingVersion: ledger.pricing_version,
      fxVersion: attempt.fxVersion,
    }, `${input.key}:engine:${index + 1}`);
    if (attempt.ok !== false && index === attempts.length - 1) finalRun = run;
  });
  return finalRun;
}

function buildStationContext(db, input, stationName, job, resultStore) {
  if (stationName === 'contact_readiness') {
    return buildContactReadinessContext(db, input.accessContext, job.customerId, {
      ...(input.contextOptions || {}),
      fitJobId: job.parentJobId || job.input.customerFitJobId,
      results: resultStore,
    });
  }
  if (stationName === 'manager_anomaly') {
    return buildManagerAnomalyContext(db, input.accessContext, job.input.anomalyId, {
      ...(input.contextOptions || {}),
      now: input.now ? input.now() : undefined,
    });
  }
  if (stationName === 'sales_coaching') {
    return buildSalesCoachingContext(db, input.accessContext, job.input.salesUserId, {
      ...(input.contextOptions || {}),
      now: input.now ? input.now() : undefined,
    });
  }
  return buildCustomerContext(db, input.accessContext, job.customerId, {
    ...(input.contextOptions || {}),
    station: stationName,
  });
}

function stationValidationContext(contextResult) {
  return {
    evidenceIds: contextResult.evidenceIds,
    ...(contextResult.contactIds ? { contactIds: contextResult.contactIds } : {}),
    ...(contextResult.anomalyIds ? {
      anomalyIds: contextResult.anomalyIds,
      anomalyCodes: contextResult.anomalyCodes,
      customerIds: contextResult.customerIds,
    } : {}),
    ...(contextResult.salesUserIds ? {
      salesUserIds: contextResult.salesUserIds,
      sampleSizes: contextResult.sampleSizes,
      sampleStatuses: contextResult.sampleStatuses,
    } : {}),
  };
}

async function executeStructuredStationJob(input = {}, stationName) {
  const db = input.db;
  if (!db || typeof db.prepare !== 'function') throw new Error('database is required');
  const jobStore = input.jobs || createAIJobStore(db);
  const resultStore = input.results || createAIResultStore(db);
  const budgetStore = input.budgets || createAIBudgetStore(db, input.budgetOptions);
  const jobId = String(input.jobId || '').trim();
  const workerId = String(input.workerId || '').trim();
  if (!jobId) throw new Error('jobId is required');
  if (!workerId) throw new Error('workerId is required');
  const job = jobStore.getJob(jobId);
  if (!job) throw new Error('AI job not found');
  if (job.station !== stationName || job.state !== 'running' || job.leaseOwner !== workerId) {
    throw new Error('AI job lease is not owned by this worker');
  }
  const actor = input.actor || {};
  if (typeof actor.id !== 'string' || !actor.id.trim() || typeof actor.role !== 'string' || !actor.role.trim()) {
    throw new Error('server actor is required');
  }

  const contextResult = buildStationContext(db, input, stationName, job, resultStore);
  if (contextResult.contextHash !== job.contextHash) {
    const stale = createStationError('AI job context hash is stale', 'AI_STATION_CONTEXT_STALE', 409);
    jobStore.fail(job.id, workerId, stale);
    throw stale;
  }
  if (String(job.crmAccountId || '') !== String(contextResult.context.crmAccountId || '')) {
    const mismatch = createStationError('AI job CRM account is stale', 'AI_STATION_ACCOUNT_STALE', 409);
    jobStore.fail(job.id, workerId, mismatch);
    throw mismatch;
  }

  const prompt = renderPrompt(stationName, {
    actor: {
      id: actor.id,
      role: actor.role,
      teamId: actor.teamId,
      permissions: actorPermissions(actor, input.accessContext),
    },
    trustedCrmContext: contextResult.context,
    evidence: contextResult.evidence,
    userContent: input.userContent ?? job.input.userContent ?? '',
    ...(contextResult.anomalyIds ? {
      anomalyIds: contextResult.anomalyIds,
      anomalyCodes: contextResult.anomalyCodes,
      customerIds: contextResult.customerIds,
    } : {}),
    ...(contextResult.salesUserIds ? {
      salesUserIds: contextResult.salesUserIds,
      sampleSizes: contextResult.sampleSizes,
      sampleStatuses: contextResult.sampleStatuses,
    } : {}),
  });
  const modelCall = input.modelCall || callAssistantModel;
  const startedAt = input.now ? input.now() : new Date();
  const validationContext = stationValidationContext(contextResult);
  const modelOptions = {
    ...(input.router ? { router: input.router } : {}),
    adapters: governedAdapters(jobStore, job.id, workerId, input.adapters || assistantAdapters()),
    scope: `ai_station:${stationName}`,
    externalAllowed: false,
    station: stationName,
    stationVersion: 'v1',
    timeoutMs: input.timeoutMs,
    engineModels: onlineModelPolicy(stationName, input.modelPolicy),
    validateResult(providerResponse) {
      const value = parseOutput(providerResponse?.answer);
      const validated = validateStationOutput(stationName, 'v1', value, validationContext);
      if (!validated.ok) {
        throw createStationError(
          `AI station output rejected: ${validated.errors.join('; ')}`,
          'AI_STATION_INVALID_OUTPUT',
          422,
        );
      }
      return validated.value;
    },
  };
  const modelRunKey = `ai-station:${job.id}:attempt:${job.attempts}`;
  let modelRunRecorded = false;
  let response;
  let budgetSettlement;
  const reservation = budgetStore.reserve({
    jobId: job.id,
    attempt: job.attempts,
    companyId: input.companyId,
    teamId: actor.teamId,
    actorId: actor.id,
    station: job.station,
    essential: Boolean(input.essential),
    maxEngineAttempts: Number.isInteger(input.maxEngineAttempts) ? input.maxEngineAttempts : 2,
    estimatedUsage: input.estimatedUsage,
    estimatedCost: input.estimatedCost,
  });

  try {
    response = await modelCall(stationMessages(prompt), modelOptions);
    const validated = response?.validatedValue
      ? { ok: true, value: response.validatedValue }
      : (() => {
        const value = parseOutput(response?.answer);
        return validateStationOutput(stationName, 'v1', value, validationContext);
      })();
    const finishedAt = input.now ? input.now() : new Date();
    const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
    if (!validated.ok) {
      const invalid = createStationError(`AI station output rejected: ${validated.errors.join('; ')}`, 'AI_STATION_INVALID_OUTPUT', 422);
      budgetSettlement = budgetStore.settle(reservation.id, costedAttempts(response, 'invalid_output'));
      recordAttemptRuns(resultStore, response, {
        key: modelRunKey, jobId: job.id, attempt: job.attempts, finalStatus: 'invalid_output',
        durationMs, startedAt: asIso(startedAt), finishedAt: asIso(finishedAt),
        settlement: budgetSettlement, error: invalid,
      });
      modelRunRecorded = true;
      jobStore.fail(job.id, workerId, invalid);
      throw invalid;
    }
    budgetSettlement = budgetStore.settle(reservation.id, costedAttempts(response));
    const modelRun = recordAttemptRuns(resultStore, response, {
      key: modelRunKey, jobId: job.id, attempt: job.attempts, durationMs,
      startedAt: asIso(startedAt), finishedAt: asIso(finishedAt), settlement: budgetSettlement,
    });
    modelRunRecorded = true;
    const result = resultStore.saveResult({
      jobId: job.id,
      workerId,
      contextHash: contextResult.contextHash,
      value: validated.value,
      evidenceIds: contextResult.evidenceIds,
      ...(contextResult.contactIds ? { contactIds: contextResult.contactIds } : {}),
      ...(contextResult.anomalyIds ? {
        anomalyIds: contextResult.anomalyIds,
        anomalyCodes: contextResult.anomalyCodes,
        customerIds: contextResult.customerIds,
      } : {}),
      ...(contextResult.salesUserIds ? {
        salesUserIds: contextResult.salesUserIds,
        sampleSizes: contextResult.sampleSizes,
        sampleStatuses: contextResult.sampleStatuses,
      } : {}),
      ...(stationName === 'contact_readiness'
        ? { afterSave: saved => applyContactReadinessRouting(db, job, saved) }
        : stationName === 'sales_pack'
          ? { afterSave: () => recordSalesPackNotification(db, job, 'ready', '请在客户详情中审核后再使用触达草稿。') }
          : stationName === 'manager_anomaly'
            ? { afterSave: saved => recordManagerAnomalyNotification(db, job, saved) }
            : stationName === 'sales_coaching'
              ? { afterSave: saved => recordSalesCoachingNotification(db, job, saved) }
            : {}),
      metadata: {
        engine: response?.engine || 'unknown',
        model: response?.model || 'unknown',
        promptVersion: 'v1',
        schemaVersion: 'v1',
        usage: response?.usage || {},
        cost: budgetSettlement.chargedCost,
      },
    }, `ai-result:${job.id}:attempt:${job.attempts}`);
    return Object.freeze({
      result,
      modelRun,
      budget: budgetSettlement,
      contextHash: contextResult.contextHash,
      engine: response?.engine || 'unknown',
    });
  } catch (error) {
    const finishedAt = input.now ? input.now() : new Date();
    const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
    const status = String(error?.code || '').startsWith('AI_STATION_INVALID_OUTPUT') ? 'invalid_output' : 'failed';
    if (!budgetSettlement) {
      try {
        const attempts = response
          ? costedAttempts(response, status)
          : costedAttempts(error, status);
        budgetSettlement = attempts.length
          ? budgetStore.settle(reservation.id, attempts)
          : budgetStore.release(reservation.id, summarizeError(error));
      } catch (_budgetError) {
        // Preserve the original execution failure. An unsettled reservation remains visible for recovery.
      }
    }
    try {
      if (!modelRunRecorded) {
        const errorSource = Array.isArray(error?.engineAttempts) && error.engineAttempts.length
          ? error
          : {
            engine: error?.engine || 'unknown',
            model: error?.model || 'unknown',
            usage: error?.usage || {},
            engineAttempts: [{
              engine: error?.engine || 'unknown',
              model: error?.model || 'unknown',
              ok: false,
              status,
              code: error?.code,
              error: summarizeError(error),
              usage: error?.usage || {},
              requestId: error?.requestId,
            }],
          };
        recordAttemptRuns(resultStore, errorSource, {
          key: `${modelRunKey}:error`, jobId: job.id, attempt: job.attempts, finalStatus: status,
          durationMs, startedAt: asIso(startedAt), finishedAt: asIso(finishedAt),
          settlement: budgetSettlement, error,
        });
      }
    } catch (_recordError) {
      // Preserve the original station failure; the job state is still the source of truth.
    }
    const current = jobStore.getJob(job.id);
    if (current?.state === 'running' && current.leaseOwner === workerId) jobStore.fail(job.id, workerId, error);
    throw error;
  }
}

function executeCustomerFitJob(input = {}) {
  return executeStructuredStationJob(input, 'customer_fit');
}

function executeContactReadinessJob(input = {}) {
  return executeStructuredStationJob(input, 'contact_readiness');
}

function executeSalesPackJob(input = {}) {
  return executeStructuredStationJob(input, 'sales_pack');
}

function executeActionProposalJob(input = {}) {
  return executeStructuredStationJob(input, 'action_proposal');
}

function executeNextActionJob(input = {}) {
  return executeStructuredStationJob(input, 'next_action');
}

function executeManagerAnomalyJob(input = {}) {
  return executeStructuredStationJob(input, 'manager_anomaly');
}

function executeSalesCoachingJob(input = {}) {
  return executeStructuredStationJob(input, 'sales_coaching');
}

module.exports = {
  costedAttempts,
  buildStationContext,
  recordAttemptRuns,
  stationValidationContext,
  executeActionProposalJob,
  executeNextActionJob,
  executeManagerAnomalyJob,
  executeSalesCoachingJob,
  executeContactReadinessJob,
  executeCustomerFitJob,
  executeSalesPackJob,
  executeStructuredStationJob,
  governedAdapters,
  parseOutput,
  stationMessages,
};
