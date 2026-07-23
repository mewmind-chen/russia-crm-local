'use strict';

const crypto = require('node:crypto');
const { assertExternalCustomerAccess } = require('../access_control');
const { buildCustomerContext } = require('./context');
const { executeCustomerFitJob } = require('./executor');
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
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    errorSummary: job.errorSummary,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
  };
}

function idempotencyKey(customerId, contextHash) {
  return `ai-station:customer_fit:v1:${customerId}:${contextHash}`;
}

function createAIStationService(options = {}) {
  const execute = options.executeCustomerFitJob || executeCustomerFitJob;

  async function executeClaimed({ db, jobs, results, job, accessContext, actor }) {
    const workerId = `ai-http-${crypto.randomUUID()}`;
    const claimed = jobs.claimById(job.id, workerId);
    if (!claimed) return { job: publicJob(jobs.getJob(job.id)), result: null };
    try {
      const execution = await execute({
        db, jobs, results, jobId: claimed.id, workerId, accessContext,
        actor: { id: actor.id, role: actor.role, teamId: actor.team_id || actor.teamId },
      });
      return { job: publicJob(jobs.getJob(claimed.id)), result: execution.result };
    } catch (_error) {
      return { job: publicJob(jobs.getJob(claimed.id)), result: null };
    }
  }

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

  async function runCustomerFit({ db, accessContext, actor, customerId }) {
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
    if (!['queued', 'retry_wait'].includes(job.state)) {
      return { job: publicJob(job), result: results.latestForCustomer(customerId, 'customer_fit') };
    }
    return executeClaimed({ db, jobs, results, job, accessContext, actor });
  }

  async function retryJob({ db, accessContext, actor, jobId }) {
    const jobs = createAIJobStore(db);
    const results = createAIResultStore(db);
    const current = jobs.getJob(jobId);
    if (!current) throw routeError('AI job not found', 404, 'AI_JOB_NOT_FOUND');
    if (current.station !== 'customer_fit') throw routeError('AI station is not supported', 400, 'AI_STATION_NOT_SUPPORTED');
    assertExternalCustomerAccess(accessContext, current.customerId);
    const job = jobs.retry(jobId);
    return executeClaimed({ db, jobs, results, job, accessContext, actor });
  }

  return Object.freeze({ getCustomerResults, runCustomerFit, retryJob });
}

function registerAIStationRoutes(app, options = {}) {
  const openDb = options.openDb;
  if (typeof openDb !== 'function') throw new Error('openDb is required');
  const service = createAIStationService(options);

  function handle(operation) {
    return async (req, res) => {
      const db = openDb();
      try {
        const payload = await operation(service, db, req);
        const pending = payload?.job && ['queued', 'running', 'retry_wait'].includes(payload.job.state);
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
}

module.exports = { createAIStationService, registerAIStationRoutes, publicJob };
