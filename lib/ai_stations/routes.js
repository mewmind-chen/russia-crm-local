'use strict';

const { assertExternalCustomerAccess } = require('../access_control');
const { buildCustomerContext } = require('./context');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');

function routeError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    customerId: job.customerId,
    station: job.station,
    state: job.state,
    workflowId: job.workflowId,
    parentJobId: job.parentJobId,
    dependencyIds: job.dependencyIds,
    eventType: job.eventType,
    eventId: job.eventId,
    priority: job.priority,
    nextRunAt: job.nextRunAt,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    errorSummary: job.errorSummary,
    blockedKind: job.blockedKind,
    blockedReason: job.blockedReason,
    cancelRequestedAt: job.cancelRequestedAt,
    cancelledAt: job.cancelledAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
  };
}

function idempotencyKey(customerId, contextHash) {
  return `ai-station:customer_fit:v1:${customerId}:${contextHash}`;
}

function resolveAIStationsEnabled(options = {}) {
  if (typeof options.enabled === 'boolean') return options.enabled;
  const configured = String(options.configured ?? process.env.CRM_AI_STATIONS_ENABLED ?? '').trim().toLowerCase();
  if (configured) return ['1', 'true', 'yes', 'on'].includes(configured);
  return String(options.environment ?? process.env.NODE_ENV ?? 'development').toLowerCase() !== 'production';
}

function createAIStationService(options = {}) {
  function getCustomerResults({ db, accessContext, customerId }) {
    const context = buildCustomerContext(db, accessContext, customerId);
    const jobs = createAIJobStore(db);
    const results = createAIResultStore(db);
    const result = results.latestForCustomer(customerId, 'customer_fit');
    const allowedEvidence = new Map(context.evidence.map(item => [item.id, item]));
    const evidence = (result?.value?.evidenceIds || []).map(id => allowedEvidence.get(id)).filter(Boolean);
    return {
      customerId,
      station: 'customer_fit',
      job: publicJob(jobs.latestForCustomer(customerId, 'customer_fit')),
      result,
      evidence,
      stale: Boolean(result && result.contextHash !== context.contextHash),
    };
  }

  function runCustomerFit({ db, accessContext, actor, customerId }) {
    const context = buildCustomerContext(db, accessContext, customerId);
    const jobs = createAIJobStore(db);
    const results = createAIResultStore(db);
    const job = jobs.enqueue({
      customerId,
      crmAccountId: context.context.crmAccountId,
      station: 'customer_fit',
      contextHash: context.contextHash,
      payload: { contextVersion: 'crm-v1', stationVersion: 'v1' },
      createdBy: actor.id,
    }, idempotencyKey(customerId, context.contextHash));
    return { job: publicJob(job), result: results.latestForCustomer(customerId, 'customer_fit') };
  }

  function retryJob({ db, accessContext, jobId }) {
    const jobs = createAIJobStore(db);
    const current = jobs.getJob(jobId);
    if (!current) throw routeError('AI job not found', 404, 'AI_JOB_NOT_FOUND');
    if (current.station !== 'customer_fit') throw routeError('AI station is not supported', 400, 'AI_STATION_NOT_SUPPORTED');
    assertExternalCustomerAccess(accessContext, current.customerId);
    const job = jobs.retry(jobId);
    return { job: publicJob(job), result: null };
  }

  function cancelJob({ db, accessContext, jobId }) {
    const jobs = createAIJobStore(db);
    const current = jobs.getJob(jobId);
    if (!current) throw routeError('AI job not found', 404, 'AI_JOB_NOT_FOUND');
    assertExternalCustomerAccess(accessContext, current.customerId);
    return { job: publicJob(jobs.requestCancel(jobId)), result: null };
  }

  return Object.freeze({ getCustomerResults, runCustomerFit, retryJob, cancelJob });
}

function registerAIStationRoutes(app, options = {}) {
  if (!resolveAIStationsEnabled(options)) return false;
  const openDb = options.openDb;
  if (typeof openDb !== 'function') throw new Error('openDb is required');
  const service = createAIStationService(options);

  function handle(operation) {
    return async (req, res) => {
      const db = openDb();
      try {
        const payload = await operation(service, db, req);
        const pending = payload?.job && ['queued', 'running', 'retry_wait', 'cancel_requested'].includes(payload.job.state);
        res.status(pending ? 202 : 200).json({ ok: true, ...payload });
      } catch (error) {
        const response = { ok: false, error: error.message };
        if (error.code) response.code = error.code;
        res.status(error.statusCode || 400).json(response);
      } finally {
        db.close();
      }
    };
  }

  app.get('/api/sales-crm/ai/customers/:customerId/results', handle((api, db, req) =>
    api.getCustomerResults({ db, accessContext: req.accessContext, customerId: req.params.customerId })));
  app.post('/api/sales-crm/ai/customers/:customerId/stations/customer_fit/run', handle((api, db, req) =>
    api.runCustomerFit({ db, accessContext: req.accessContext, actor: req.salesUser, customerId: req.params.customerId })));
  app.post('/api/sales-crm/ai/jobs/:jobId/retry', handle((api, db, req) =>
    api.retryJob({ db, accessContext: req.accessContext, actor: req.salesUser, jobId: req.params.jobId })));
  app.post('/api/sales-crm/ai/jobs/:jobId/cancel', handle((api, db, req) =>
    api.cancelJob({ db, accessContext: req.accessContext, actor: req.salesUser, jobId: req.params.jobId })));
  return true;
}

module.exports = { createAIStationService, registerAIStationRoutes, resolveAIStationsEnabled, publicJob };
