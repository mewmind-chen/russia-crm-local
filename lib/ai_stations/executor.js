'use strict';

const { callAssistantModel, assistantAdapters } = require('../assistant');
const { validateStationOutput } = require('./contracts');
const { buildCustomerContext } = require('./context');
const { renderPrompt } = require('./prompt_registry');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');
const { asIso, summarizeError } = require('./audit');

function parseOutput(answer) {
  const raw = String(answer || '').trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate = (fenced || raw).trim();
  if (!candidate) throw createStationError('AI station returned an empty answer', 'AI_STATION_INVALID_OUTPUT', 422);
  let value;
  try {
    value = JSON.parse(candidate);
  } catch (_error) {
    throw createStationError('AI station returned invalid JSON', 'AI_STATION_INVALID_OUTPUT', 422);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createStationError('AI station output must be a JSON object', 'AI_STATION_INVALID_OUTPUT', 422);
  }
  return value;
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
      } finally {
        if (claim.releaseRequired) jobStore.releaseResource(engine, jobId, workerId);
      }
    },
  ]));
}

async function executeCustomerFitJob(input = {}) {
  const db = input.db;
  if (!db || typeof db.prepare !== 'function') throw new Error('database is required');
  const jobStore = input.jobs || createAIJobStore(db);
  const resultStore = input.results || createAIResultStore(db);
  const jobId = String(input.jobId || '').trim();
  const workerId = String(input.workerId || '').trim();
  if (!jobId) throw new Error('jobId is required');
  if (!workerId) throw new Error('workerId is required');
  const job = jobStore.getJob(jobId);
  if (!job) throw new Error('AI job not found');
  if (job.station !== 'customer_fit' || job.state !== 'running' || job.leaseOwner !== workerId) {
    throw new Error('AI job lease is not owned by this worker');
  }
  const actor = input.actor || {};
  if (typeof actor.id !== 'string' || !actor.id.trim() || typeof actor.role !== 'string' || !actor.role.trim()) {
    throw new Error('server actor is required');
  }

  const contextResult = buildCustomerContext(db, input.accessContext, job.customerId, input.contextOptions);
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

  const prompt = renderPrompt('customer_fit', {
    actor: {
      id: actor.id,
      role: actor.role,
      teamId: actor.teamId,
      permissions: actorPermissions(actor, input.accessContext),
    },
    trustedCrmContext: contextResult.context,
    evidence: contextResult.evidence,
    userContent: input.userContent || '',
  });
  const modelCall = input.modelCall || callAssistantModel;
  const startedAt = input.now ? input.now() : new Date();
  const modelOptions = {
    ...(input.router ? { router: input.router } : {}),
    adapters: governedAdapters(jobStore, job.id, workerId, input.adapters || assistantAdapters()),
    scope: 'ai_station:customer_fit',
    externalAllowed: false,
    station: 'customer_fit',
    stationVersion: 'v1',
    timeoutMs: input.timeoutMs,
  };
  const modelRunKey = `ai-station:${job.id}:attempt:${job.attempts}`;
  let modelRunRecorded = false;

  try {
    const response = await modelCall(stationMessages(prompt), modelOptions);
    const value = parseOutput(response?.answer);
    const validated = validateStationOutput('customer_fit', 'v1', value, { evidenceIds: contextResult.evidenceIds });
    const finishedAt = input.now ? input.now() : new Date();
    const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
    if (!validated.ok) {
      const invalid = createStationError(`AI station output rejected: ${validated.errors.join('; ')}`, 'AI_STATION_INVALID_OUTPUT', 422);
      resultStore.recordModelRun({
        jobId: job.id, attempt: job.attempts, engine: response?.engine || 'unknown', model: response?.model || 'unknown',
        status: 'invalid_output', durationMs, usage: response?.usage || {}, startedAt: asIso(startedAt), finishedAt: asIso(finishedAt), error: invalid,
      }, modelRunKey);
      modelRunRecorded = true;
      jobStore.fail(job.id, workerId, invalid);
      throw invalid;
    }
    const modelRun = resultStore.recordModelRun({
      jobId: job.id, attempt: job.attempts, engine: response?.engine || 'unknown', model: response?.model || 'unknown',
      status: 'succeeded', durationMs, usage: response?.usage || {}, cost: response?.cost, startedAt: asIso(startedAt), finishedAt: asIso(finishedAt),
    }, modelRunKey);
    modelRunRecorded = true;
    const result = resultStore.saveResult({
      jobId: job.id,
      workerId,
      contextHash: contextResult.contextHash,
      value: validated.value,
      evidenceIds: contextResult.evidenceIds,
      metadata: {
        engine: response?.engine || 'unknown',
        model: response?.model || 'unknown',
        promptVersion: 'v1',
        schemaVersion: 'v1',
        usage: response?.usage || {},
        cost: response?.cost,
      },
    }, `ai-result:${job.id}:attempt:${job.attempts}`);
    return Object.freeze({ result, modelRun, contextHash: contextResult.contextHash, engine: response?.engine || 'unknown' });
  } catch (error) {
    const finishedAt = input.now ? input.now() : new Date();
    const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
    const status = String(error?.code || '').startsWith('AI_STATION_INVALID_OUTPUT') ? 'invalid_output' : 'failed';
    try {
      if (!modelRunRecorded) {
        resultStore.recordModelRun({
          jobId: job.id, attempt: job.attempts, engine: error?.engine || 'unknown', model: error?.model || 'unknown',
          status, durationMs, usage: {}, startedAt: asIso(startedAt), finishedAt: asIso(finishedAt), error: summarizeError(error),
        }, `${modelRunKey}:error`);
      }
    } catch (_recordError) {
      // Preserve the original station failure; the job state is still the source of truth.
    }
    const current = jobStore.getJob(job.id);
    if (current?.state === 'running' && current.leaseOwner === workerId) jobStore.fail(job.id, workerId, error);
    throw error;
  }
}

module.exports = { executeCustomerFitJob, parseOutput, stationMessages, governedAdapters };
