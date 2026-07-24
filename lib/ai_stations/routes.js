'use strict';

const { assertExternalCustomerAccess } = require('../access_control');
const { createAIBudgetStore } = require('./budgets');
const { buildCustomerContext } = require('./context');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');
const { createAITaskCenterStore } = require('./task_center');
const { propagateLegacyCancellation } = require('./enrichment/adapters');

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

function publicBudgetPolicy(row) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    dailyLimit: Number(row.daily_limit_micros || 0) / 1_000_000,
    monthlyLimit: Number(row.monthly_limit_micros || 0) / 1_000_000,
    perTaskLimit: Number(row.per_task_limit_micros || 0) / 1_000_000,
    warningRatio: Number(row.warning_ratio),
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at,
  };
}

function jobIds(body) {
  if (!Array.isArray(body?.jobIds)) throw routeError('jobIds must be an array', 400, 'AI_JOB_IDS_INVALID');
  const values = [...new Set(body.jobIds.map(value => String(value || '').trim()).filter(Boolean))];
  if (!values.length || values.length > 50) {
    throw routeError('jobIds must contain between 1 and 50 unique values', 400, 'AI_JOB_IDS_INVALID');
  }
  return values;
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
    const key = idempotencyKey(customerId, context.contextHash);
    const existing = jobs.findByIdempotencyKey(key);
    const job = jobs.enqueue({
      customerId,
      crmAccountId: context.context.crmAccountId,
      station: 'customer_fit',
      contextHash: context.contextHash,
      payload: { contextVersion: 'crm-v1', stationVersion: 'v1' },
      createdBy: actor.id,
    }, key);
    const result = results.latestForCustomer(customerId, 'customer_fit');
    if (existing) {
      const status = result ? 'cache_hit' : 'deduplicated';
      createAIBudgetStore(db, options.budgetOptions).recordNonBillable({
        jobId: job.id,
        eventKey: `ai-station:${status}:${job.id}:${actor.id}`,
        companyId: options.companyId,
        teamId: actor.team_id || actor.teamId,
        actorId: actor.id,
        station: job.station,
        status,
      });
    }
    return { job: publicJob(job), result };
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
    const legacy = propagateLegacyCancellation(db, jobId);
    if (legacy && ['cancelled', 'cancel_requested'].includes(legacy.state)
        && ['succeeded', 'needs_review'].includes(current.state)) {
      const at = new Date().toISOString();
      db.prepare(`UPDATE crm_ai_jobs SET control_state='cancelled',cancel_requested_at=?,
        cancelled_at=?,finished_at=?,updated_at=? WHERE id=? AND control_state=''`)
        .run(at, at, at, at, jobId);
      return { job: publicJob(jobs.getJob(jobId)), result: null };
    }
    return { job: publicJob(jobs.requestCancel(jobId)), result: null };
  }

  function listTasks({ db, accessContext, actor, query }) {
    return createAITaskCenterStore(db).list({ accessContext, actor, query });
  }

  function getTask({ db, accessContext, actor, taskId }) {
    const task = createAITaskCenterStore(db).detail({ accessContext, actor, taskId });
    if (!task) throw routeError('AI task not found', 404, 'AI_TASK_NOT_FOUND');
    return { task };
  }

  function reviewJob({ db, accessContext, actor, jobId, body }) {
    const task = createAITaskCenterStore(db).review({
      jobId,
      accessContext,
      actor,
      decision: String(body?.decision || ''),
      summary: body?.summary,
    });
    if (!task) throw routeError('AI job not found', 404, 'AI_JOB_NOT_FOUND');
    return { task };
  }

  function bulkJobs({ db, accessContext, body, action }) {
    const jobs = createAIJobStore(db);
    const selected = jobIds(body).map(jobId => {
      const job = jobs.getJob(jobId);
      if (!job) throw routeError('One or more AI jobs were not found', 404, 'AI_JOB_NOT_FOUND');
      assertExternalCustomerAccess(accessContext, job.customerId);
      if (action === 'retry' && job.station !== 'customer_fit') {
        throw routeError('One or more AI stations are not supported', 400, 'AI_STATION_NOT_SUPPORTED');
      }
      return job;
    });
    const mutate = db.transaction(() => selected.map(job => {
      if (action === 'retry') return publicJob(jobs.retry(job.id));
      const legacy = propagateLegacyCancellation(db, job.id);
      if (legacy && ['cancelled', 'cancel_requested'].includes(legacy.state)
          && ['succeeded', 'needs_review'].includes(job.state)) {
        const at = new Date().toISOString();
        db.prepare(`UPDATE crm_ai_jobs SET control_state='cancelled',cancel_requested_at=?,
          cancelled_at=?,finished_at=?,updated_at=? WHERE id=? AND control_state=''`)
          .run(at, at, at, at, job.id);
        return publicJob(jobs.getJob(job.id));
      }
      return publicJob(jobs.requestCancel(job.id));
    }));
    return { jobs: mutate.immediate() };
  }

  function listBudgets({ db }) {
    return { policies: createAIBudgetStore(db, options.budgetOptions).listPolicies().map(publicBudgetPolicy) };
  }

  function setBudget({ db, scopeType, scopeId, body }) {
    const allowed = new Set(['dailyLimit', 'monthlyLimit', 'perTaskLimit', 'warningRatio', 'enabled']);
    const unknown = Object.keys(body || {}).find(key => !allowed.has(key));
    if (unknown) throw routeError(`Unsupported AI budget field: ${unknown}`, 400, 'AI_BUDGET_FIELD_INVALID');
    const policy = createAIBudgetStore(db, options.budgetOptions).setPolicy({
      scopeType,
      scopeId,
      dailyLimit: body?.dailyLimit,
      monthlyLimit: body?.monthlyLimit,
      perTaskLimit: body?.perTaskLimit,
      warningRatio: body?.warningRatio,
      enabled: body?.enabled,
    });
    return { policy: publicBudgetPolicy(policy) };
  }

  return Object.freeze({
    getCustomerResults, runCustomerFit, retryJob, cancelJob, listTasks, getTask, reviewJob,
    bulkJobs, listBudgets, setBudget,
  });
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
        const jobs = payload?.jobs || (payload?.job ? [payload.job] : []);
        const pending = jobs.some(job =>
          ['queued', 'running', 'retry_wait', 'cancel_requested'].includes(job.state));
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
  app.get('/api/sales-crm/ai/tasks', handle((api, db, req) =>
    api.listTasks({ db, accessContext: req.accessContext, actor: req.salesUser, query: req.query })));
  app.get('/api/sales-crm/ai/tasks/:taskId', handle((api, db, req) =>
    api.getTask({ db, accessContext: req.accessContext, actor: req.salesUser, taskId: req.params.taskId })));
  app.post('/api/sales-crm/ai/customers/:customerId/stations/customer_fit/run', handle((api, db, req) =>
    api.runCustomerFit({ db, accessContext: req.accessContext, actor: req.salesUser, customerId: req.params.customerId })));
  app.post('/api/sales-crm/ai/jobs/:jobId/retry', handle((api, db, req) =>
    api.retryJob({ db, accessContext: req.accessContext, actor: req.salesUser, jobId: req.params.jobId })));
  app.post('/api/sales-crm/ai/jobs/:jobId/cancel', handle((api, db, req) =>
    api.cancelJob({ db, accessContext: req.accessContext, actor: req.salesUser, jobId: req.params.jobId })));
  app.post('/api/sales-crm/ai/jobs/:jobId/review', handle((api, db, req) =>
    api.reviewJob({
      db, accessContext: req.accessContext, actor: req.salesUser, jobId: req.params.jobId, body: req.body,
    })));
  app.post('/api/sales-crm/ai/bulk/retry', handle((api, db, req) =>
    api.bulkJobs({ db, accessContext: req.accessContext, body: req.body, action: 'retry' })));
  app.post('/api/sales-crm/ai/bulk/cancel', handle((api, db, req) =>
    api.bulkJobs({ db, accessContext: req.accessContext, body: req.body, action: 'cancel' })));
  app.get('/api/sales-crm/ai/budgets', handle((api, db) => api.listBudgets({ db })));
  app.put('/api/sales-crm/ai/budgets/:scopeType/:scopeId', handle((api, db, req) =>
    api.setBudget({
      db,
      scopeType: req.params.scopeType,
      scopeId: req.params.scopeId,
      body: req.body,
    })));
  return true;
}

module.exports = { createAIStationService, registerAIStationRoutes, resolveAIStationsEnabled, publicJob };
