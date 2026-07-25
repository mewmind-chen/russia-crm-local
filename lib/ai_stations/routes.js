'use strict';

const { assertExternalCustomerAccess } = require('../access_control');
const { createAIBudgetStore } = require('./budgets');
const { buildCustomerContext } = require('./context');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');
const { createAIGovernanceStore, FEEDBACK_LABELS } = require('./governance');
const { createAITaskCenterStore } = require('./task_center');
const { propagateLegacyCancellation } = require('./enrichment/adapters');
const { createCustomerEnrichmentRouteService } = require('./enrichment/routes');
const {
  featureState,
  isFeatureEnabled,
  resolveAIHardFlags,
  setFeatureFlag,
} = require('./feature_flags');
const { enqueueSalesPack } = require('./sales_pack');
const { enqueueActionProposal } = require('./action_proposal');
const { adoptNextAction } = require('./next_action');
const { presentAIResult } = require('./presentation');
const { isEmployeeFacingChinese } = require('./contracts');
const {
  buildManagerAnomalyContext,
  enqueueManagerAnomalies,
  listManagerAnomalies,
} = require('./manager_anomaly');
const {
  buildSalesCoachingContext,
  enqueueSalesCoaching,
  listSalesCoaching,
} = require('./sales_coaching');

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
    trigger: job.trigger,
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

function assertFeatureEnabled(db, key, hardFlags) {
  if (isFeatureEnabled(db, key, hardFlags)) return;
  throw routeError('AI feature is disabled', 409, 'AI_FEATURE_DISABLED');
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

function assertManagerAnomalyAccess(actor, accessContext) {
  if (!['admin', 'manager'].includes(actor?.role)
      || !accessContext?.permissions?.view_alerts
      || !accessContext?.permissions?.view_team) {
    throw routeError('只有授权经理可以查看团队异常', 403, 'AI_MANAGER_ANOMALY_FORBIDDEN');
  }
}

function assertSalesCoachingAccess(actor, accessContext) {
  if (!['admin', 'manager'].includes(actor?.role)
      || !accessContext?.permissions?.view_team) {
    throw routeError('只有授权经理可以查看团队辅导建议', 403, 'AI_SALES_COACHING_FORBIDDEN');
  }
}

function assertTaskAuditAccess(actor, accessContext) {
  const managerReviewer = actor?.role === 'manager'
    && accessContext?.permissions?.review_ai_tasks;
  if (actor?.role !== 'admin' && !managerReviewer) {
    throw routeError('无权查看 AI 运行记录', 403, 'AI_TASK_AUDIT_FORBIDDEN');
  }
}

function assertAdminAccess(actor, code = 'AI_GOVERNANCE_FORBIDDEN') {
  if (actor?.role !== 'admin') {
    throw routeError('只有管理员可以管理 AI 运行与治理', 403, code);
  }
}

function publicManagerAnomaly(item) {
  const { ai, ...anomaly } = item;
  return {
    ...anomaly,
    ai: ai ? {
      job: publicJob(ai.job),
      result: ai.result,
      stale: ai.stale,
    } : null,
  };
}

function publicSalesCoachingJob(job) {
  const value = publicJob(job);
  return value ? { ...value, customerId: '' } : null;
}

function publicSalesCoachingResult(result) {
  return result ? { ...result, customerId: '', crmAccountId: null } : null;
}

function customerCoverage(context, options = {}) {
  const pool = context.context?.customerPool || {};
  const fields = [
    ['企业名称', pool.companyName],
    ['国家地区', pool.country],
    ['行业', pool.industry],
    ['产品需求', pool.products],
    ['官网', pool.website],
    ['风险状态', pool.riskStatus],
  ];
  const coveredFields = fields.filter(([, value]) => String(value || '').trim()).map(([label]) => label);
  const missingFields = fields.filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
  const restrictedFields = [
    ...(!options.permissions?.view_contacts ? ['联系人依据'] : []),
    ...(!options.permissions?.view_recon ? ['Recon 依据'] : []),
  ];
  return {
    state: options.stale ? 'stale' : coveredFields.length
      ? (missingFields.length ? 'partial' : 'covered')
      : 'none',
    coveredFields,
    missingFields,
    restrictedFields,
    analyzed: coveredFields.length,
    total: fields.length,
  };
}

function presentation(input) {
  if (!input.result) return null;
  return presentAIResult(input);
}

function resolveAIStationsEnabled(options = {}) {
  if (typeof options.enabled === 'boolean') return options.enabled;
  const configured = String(options.configured ?? process.env.CRM_AI_STATIONS_ENABLED ?? '').trim().toLowerCase();
  if (configured) return ['1', 'true', 'yes', 'on'].includes(configured);
  return String(options.environment ?? process.env.NODE_ENV ?? 'development').toLowerCase() !== 'production';
}

function createAIStationService(options = {}) {
  const hardFlags = options.hardFlags || resolveAIHardFlags();

  function getCustomerResults({ db, accessContext, customerId }) {
    const context = buildCustomerContext(db, accessContext, customerId);
    const salesPackContext = buildCustomerContext(db, accessContext, customerId, { station: 'sales_pack' });
    const jobs = createAIJobStore(db);
    const results = createAIResultStore(db);
    const result = results.latestForCustomer(customerId, 'customer_fit');
    const salesPackResult = results.latestForCustomer(customerId, 'sales_pack');
    const nextActionResult = results.latestForCustomer(customerId, 'next_action');
    const allowedEvidence = new Map(context.evidence.map(item => [item.id, item]));
    const salesPackEvidence = new Map(salesPackContext.evidence.map(item => [item.id, item]));
    const evidence = (result?.value?.evidenceIds || []).map(id => allowedEvidence.get(id)).filter(Boolean);
    const fitJob = jobs.latestForCustomer(customerId, 'customer_fit');
    const salesPackJob = jobs.latestForCustomer(customerId, 'sales_pack');
    const nextActionJob = jobs.latestForCustomer(customerId, 'next_action');
    const fitStale = Boolean(result && result.contextHash !== context.contextHash);
    const salesPackStale = Boolean(salesPackResult && (
      salesPackResult.contextHash !== salesPackContext.contextHash
      || !isEmployeeFacingChinese('sales_pack', salesPackResult.value)
    ));
    const nextActionEvidence = (nextActionResult?.value?.evidenceIds || [])
      .map(id => allowedEvidence.get(id)).filter(Boolean);
    return {
      customerId,
      customerName: context.context.customerPool?.companyName || '',
      station: 'customer_fit',
      job: publicJob(fitJob),
      result,
      evidence,
      stale: fitStale,
      presentation: presentation({
        job: fitJob,
        result: result ? { ...result, stale: fitStale } : null,
        evidence,
        coverage: customerCoverage(context, {
          stale: fitStale,
          permissions: accessContext.permissions,
        }),
        permissions: accessContext.permissions,
      }),
      salesPack: {
        job: publicJob(salesPackJob),
        result: salesPackResult,
        evidence: (salesPackResult?.value?.evidenceIds || []).map(id => salesPackEvidence.get(id)).filter(Boolean),
        stale: salesPackStale,
        presentation: presentation({
          job: salesPackJob,
          result: salesPackResult ? { ...salesPackResult, stale: salesPackStale } : null,
          evidence: (salesPackResult?.value?.evidenceIds || [])
            .map(id => salesPackEvidence.get(id)).filter(Boolean),
          coverage: customerCoverage(salesPackContext, {
            stale: salesPackStale,
            permissions: accessContext.permissions,
          }),
          permissions: accessContext.permissions,
        }),
      },
      nextAction: {
        job: publicJob(nextActionJob),
        result: accessContext.permissions.view_contacts ? nextActionResult : null,
        presentation: accessContext.permissions.view_contacts ? presentation({
          job: nextActionJob,
          result: nextActionResult,
          evidence: nextActionEvidence,
          coverage: customerCoverage(context, { permissions: accessContext.permissions }),
          permissions: accessContext.permissions,
        }) : null,
      },
    };
  }

  function runCustomerFit({ db, accessContext, actor, customerId }) {
    assertFeatureEnabled(db, 'ai_stations', hardFlags);
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
      trigger: { source: 'manual', actorId: actor.id, reason: 'customer_fit_requested' },
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

  function runSalesPack({ db, accessContext, actor, customerId }) {
    assertFeatureEnabled(db, 'sales_pack', hardFlags);
    const jobs = createAIJobStore(db);
    const results = createAIResultStore(db);
    const job = enqueueSalesPack({
      db, accessContext, actor, customerId, trigger: 'manual',
    });
    return {
      job: publicJob(job),
      result: results.latestForCustomer(customerId, 'sales_pack'),
    };
  }

  function runActionProposal({ db, accessContext, actor, customerId, body }) {
    assertFeatureEnabled(db, 'ai_stations', hardFlags);
    const job = enqueueActionProposal({
      db,
      accessContext,
      actor,
      customerId,
      userContent: body?.input,
      clientRequestId: body?.clientRequestId,
    });
    return {
      job: publicJob(job),
      result: createAIResultStore(db).getForJob(job.id),
    };
  }

  function getManagerAnomalies({ db, accessContext, actor }) {
    assertManagerAnomalyAccess(actor, accessContext);
    return {
      anomalies: listManagerAnomalies(db, accessContext, actor).map(item => {
        const anomaly = publicManagerAnomaly(item);
        if (!item.ai?.result) return anomaly;
        const context = buildManagerAnomalyContext(db, accessContext, item.id);
        const allowed = new Map(context.evidence.map(row => [row.id, row]));
        const evidence = (item.ai.result.value?.evidenceIds || [])
          .map(evidenceId => allowed.get(evidenceId)).filter(Boolean);
        anomaly.ai.presentation = presentation({
          job: item.ai.job,
          result: { ...item.ai.result, stale: item.ai.stale },
          evidence,
          coverage: {
            state: item.ai.stale ? 'stale' : evidence.length ? 'covered' : 'none',
            analyzed: evidence.length,
            total: context.evidence.length,
            rules: ['异常由确定性业务规则发现，AI 只负责解释和建议'],
          },
          permissions: accessContext.permissions,
        });
        return anomaly;
      }),
    };
  }

  function runManagerAnomalies({ db, accessContext, actor }) {
    assertManagerAnomalyAccess(actor, accessContext);
    assertFeatureEnabled(db, 'ai_stations', hardFlags);
    const scan = enqueueManagerAnomalies(db, accessContext, actor);
    return {
      anomalyCount: scan.anomalies.length,
      jobs: scan.jobs.map(publicJob),
    };
  }

  function getSalesCoaching({ db, accessContext, actor }) {
    assertSalesCoachingAccess(actor, accessContext);
    return {
      items: listSalesCoaching(db, accessContext, actor).map(item => {
        const ai = item.ai ? {
          job: publicSalesCoachingJob(item.ai.job),
          result: publicSalesCoachingResult(item.ai.result),
          stale: item.ai.stale,
        } : null;
        if (ai?.result) {
          const context = buildSalesCoachingContext(db, accessContext, item.salesUserId, {
            allowInsufficient: true,
          });
          const allowed = new Map(context.evidence.map(row => [row.id, row]));
          const evidence = (item.ai.result.value?.evidenceIds || [])
            .map(evidenceId => allowed.get(evidenceId)).filter(Boolean);
          ai.presentation = presentation({
            job: item.ai.job,
            result: { ...item.ai.result, stale: item.ai.stale },
            evidence,
            coverage: {
              state: item.ai.stale ? 'stale' : item.snapshot.sampleStatus,
              sampleSize: item.snapshot.sampleSize,
              minimumSample: 10,
              analyzed: item.snapshot.sampleSize,
              total: item.snapshot.sampleSize,
              rules: ['少于 10 个已观察客户时不调用模型'],
            },
            permissions: accessContext.permissions,
          });
        }
        return { ...item, ai };
      }),
    };
  }

  function runSalesCoaching({ db, accessContext, actor, salesUserId }) {
    assertSalesCoachingAccess(actor, accessContext);
    assertFeatureEnabled(db, 'ai_stations', hardFlags);
    const outcome = enqueueSalesCoaching(db, accessContext, actor, salesUserId);
    return {
      snapshot: outcome.snapshot,
      job: publicSalesCoachingJob(outcome.job),
      result: publicSalesCoachingResult(createAIResultStore(db).getForJob(outcome.job.id)),
    };
  }

  function retryJob({ db, accessContext, actor, jobId }) {
    const jobs = createAIJobStore(db);
    const current = jobs.getJob(jobId);
    if (!current) throw routeError('AI job not found', 404, 'AI_JOB_NOT_FOUND');
    if (!['customer_fit', 'sales_pack', 'action_proposal', 'next_action', 'manager_anomaly', 'sales_coaching'].includes(current.station)) {
      throw routeError('AI station is not supported', 400, 'AI_STATION_NOT_SUPPORTED');
    }
    if (current.station === 'manager_anomaly') assertManagerAnomalyAccess(actor, accessContext);
    if (current.station === 'sales_coaching') assertSalesCoachingAccess(actor, accessContext);
    assertExternalCustomerAccess(accessContext, current.customerId);
    assertFeatureEnabled(db, current.station === 'sales_pack' ? 'sales_pack' : 'ai_stations', hardFlags);
    const job = jobs.retry(jobId);
    return { job: publicJob(job), result: null };
  }

  function cancelJob({ db, accessContext, actor, jobId }) {
    const jobs = createAIJobStore(db);
    const current = jobs.getJob(jobId);
    if (!current) throw routeError('AI job not found', 404, 'AI_JOB_NOT_FOUND');
    if (current.station === 'manager_anomaly') assertManagerAnomalyAccess(actor, accessContext);
    if (current.station === 'sales_coaching') assertSalesCoachingAccess(actor, accessContext);
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
    assertTaskAuditAccess(actor, accessContext);
    return createAITaskCenterStore(db).list({ accessContext, actor, query });
  }

  function getTask({ db, accessContext, actor, taskId }) {
    assertTaskAuditAccess(actor, accessContext);
    const task = createAITaskCenterStore(db).detail({ accessContext, actor, taskId });
    if (!task) throw routeError('AI task not found', 404, 'AI_TASK_NOT_FOUND');
    return { task };
  }

  function adoptNextActionProposal({ db, accessContext, actor, jobId, body }) {
    assertFeatureEnabled(db, 'ai_stations', hardFlags);
    if (!accessContext.permissions.view_contacts) {
      throw routeError('无权查看或采纳下一步建议', 403, 'AI_NEXT_ACTION_FORBIDDEN');
    }
    const job = createAIJobStore(db).getJob(jobId);
    if (!job) throw routeError('AI job not found', 404, 'AI_JOB_NOT_FOUND');
    assertExternalCustomerAccess(accessContext, job.customerId);
    const result = adoptNextAction(db, {
      jobId,
      actorId: actor.id,
      crmAccountId: job.crmAccountId,
      confirmed: body,
    });
    return { ...result, job: publicJob(createAIJobStore(db).getJob(jobId)) };
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

  function bulkJobs({ db, accessContext, actor, body, action }) {
    const jobs = createAIJobStore(db);
    const selected = jobIds(body).map(jobId => {
      const job = jobs.getJob(jobId);
      if (!job) throw routeError('One or more AI jobs were not found', 404, 'AI_JOB_NOT_FOUND');
      if (job.station === 'manager_anomaly') assertManagerAnomalyAccess(actor, accessContext);
      if (job.station === 'sales_coaching') assertSalesCoachingAccess(actor, accessContext);
      assertExternalCustomerAccess(accessContext, job.customerId);
      if (action === 'retry' && job.station !== 'customer_fit') {
        throw routeError('One or more AI stations are not supported', 400, 'AI_STATION_NOT_SUPPORTED');
      }
      if (action === 'retry') assertFeatureEnabled(db, 'ai_stations', hardFlags);
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

  function listBudgets({ db, actor }) {
    assertAdminAccess(actor, 'AI_BUDGET_FORBIDDEN');
    return { policies: createAIBudgetStore(db, options.budgetOptions).listPolicies().map(publicBudgetPolicy) };
  }

  function setBudget({ db, actor, scopeType, scopeId, body }) {
    assertAdminAccess(actor, 'AI_BUDGET_FORBIDDEN');
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

  function getFeatures({ db, actor }) {
    assertAdminAccess(actor, 'AI_FEATURE_FORBIDDEN');
    return { features: featureState(db, hardFlags) };
  }

  function setFeature({ db, actor, key, body }) {
    assertAdminAccess(actor, 'AI_FEATURE_FORBIDDEN');
    return {
      feature: setFeatureFlag(db, {
        key,
        enabled: body?.enabled,
        actorId: actor.id,
      }, hardFlags),
      features: featureState(db, hardFlags),
    };
  }

  function getGovernance({ db, accessContext, actor }) {
    assertAdminAccess(actor);
    const governance = createAIGovernanceStore(db);
    return {
      feedbackLabels: FEEDBACK_LABELS,
      metrics: governance.metrics({ customerIds: accessContext.externalCustomerIds }),
      strategies: governance.strategies(),
    };
  }

  function recordFeedback({ db, accessContext, actor, jobId, body }) {
    assertAdminAccess(actor);
    const job = createAIJobStore(db).getJob(jobId);
    if (!job) throw routeError('AI job not found', 404, 'AI_JOB_NOT_FOUND');
    assertExternalCustomerAccess(accessContext, job.customerId);
    return {
      feedback: createAIGovernanceStore(db).feedback({
        jobId,
        label: body?.label,
        note: body?.note,
        ruleVersion: body?.ruleVersion,
        idempotencyKey: body?.idempotencyKey,
        actor,
      }),
    };
  }

  function createShadowStrategy({ db, accessContext, actor, body }) {
    assertAdminAccess(actor);
    return { strategy: createAIGovernanceStore(db).createShadow({ ...body, actor }) };
  }

  function evaluateShadowStrategy({ db, accessContext, actor, strategyId, body }) {
    assertAdminAccess(actor);
    return {
      strategy: createAIGovernanceStore(db).recordShadowEvaluation({
        ...body, strategyVersionId: strategyId, actor,
      }),
    };
  }

  function requestStrategyPublish({ db, accessContext, actor, strategyId }) {
    assertAdminAccess(actor);
    return {
      strategy: createAIGovernanceStore(db).requestPublish({
        strategyVersionId: strategyId, actor,
      }),
    };
  }

  function approveStrategy({ db, accessContext, actor, strategyId }) {
    assertAdminAccess(actor);
    return {
      strategy: createAIGovernanceStore(db).approve({
        strategyVersionId: strategyId, actor,
      }),
    };
  }

  function rollbackStrategy({ db, accessContext, actor, strategyId }) {
    assertAdminAccess(actor);
    return {
      strategy: createAIGovernanceStore(db).rollback({
        strategyVersionId: strategyId, actor,
      }),
    };
  }

  return Object.freeze({
    getCustomerResults, runCustomerFit, runSalesPack, runActionProposal,
    getManagerAnomalies, runManagerAnomalies,
    getSalesCoaching, runSalesCoaching,
    retryJob, cancelJob, listTasks, getTask, reviewJob, adoptNextActionProposal,
    bulkJobs, listBudgets, setBudget, getFeatures, setFeature,
    getGovernance, recordFeedback, createShadowStrategy, evaluateShadowStrategy,
    requestStrategyPublish, approveStrategy, rollbackStrategy,
  });
}

function registerAIStationRoutes(app, options = {}) {
  const openDb = options.openDb;
  if (typeof openDb !== 'function') throw new Error('openDb is required');
  const service = createAIStationService(options);
  const enrichment = createCustomerEnrichmentRouteService({
    flags: options.enrichmentFlags,
  });

  function handle(operation) {
    return async (req, res) => {
      const db = openDb();
      try {
        const payload = await operation(service, db, req);
        const jobs = payload?.jobs || (payload?.job ? [payload.job] : []);
        const pending = jobs.some(job =>
          ['queued', 'running', 'retry_wait', 'cancel_requested'].includes(job.state))
          || payload?.accepted === true;
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

  app.get('/api/sales-crm/ai/features', handle((api, db, req) =>
    api.getFeatures({ db, actor: req.salesUser })));
  app.patch('/api/sales-crm/ai/features/:featureKey', handle((api, db, req) =>
    api.setFeature({
      db, actor: req.salesUser, key: req.params.featureKey, body: req.body,
    })));
  app.get('/api/sales-crm/ai/governance', handle((api, db, req) =>
    api.getGovernance({ db, accessContext: req.accessContext, actor: req.salesUser })));
  app.post('/api/sales-crm/ai/jobs/:jobId/feedback', handle((api, db, req) =>
    api.recordFeedback({
      db, accessContext: req.accessContext, actor: req.salesUser,
      jobId: req.params.jobId, body: req.body,
    })));
  app.post('/api/sales-crm/ai/governance/strategies', handle((api, db, req) =>
    api.createShadowStrategy({
      db, accessContext: req.accessContext, actor: req.salesUser, body: req.body,
    })));
  app.post('/api/sales-crm/ai/governance/strategies/:strategyId/evaluations', handle((api, db, req) =>
    api.evaluateShadowStrategy({
      db, accessContext: req.accessContext, actor: req.salesUser,
      strategyId: req.params.strategyId, body: req.body,
    })));
  app.post('/api/sales-crm/ai/governance/strategies/:strategyId/request-publish', handle((api, db, req) =>
    api.requestStrategyPublish({
      db, accessContext: req.accessContext, actor: req.salesUser, strategyId: req.params.strategyId,
    })));
  app.post('/api/sales-crm/ai/governance/strategies/:strategyId/approve', handle((api, db, req) =>
    api.approveStrategy({
      db, accessContext: req.accessContext, actor: req.salesUser, strategyId: req.params.strategyId,
    })));
  app.post('/api/sales-crm/ai/governance/strategies/:strategyId/rollback', handle((api, db, req) =>
    api.rollbackStrategy({
      db, accessContext: req.accessContext, actor: req.salesUser, strategyId: req.params.strategyId,
    })));
  if (!resolveAIStationsEnabled(options)) return false;

  app.get('/api/sales-crm/ai/customers/:customerId/results', handle((api, db, req) =>
    api.getCustomerResults({ db, accessContext: req.accessContext, customerId: req.params.customerId })));
  app.get('/api/sales-crm/ai/customers/:customerId/enrichment', handle((_api, db, req) =>
    enrichment.getEnrichment({
      db, accessContext: req.accessContext, customerId: req.params.customerId,
    })));
  app.get('/api/sales-crm/ai/tasks', handle((api, db, req) =>
    api.listTasks({ db, accessContext: req.accessContext, actor: req.salesUser, query: req.query })));
  app.get('/api/sales-crm/ai/tasks/:taskId', handle((api, db, req) =>
    api.getTask({ db, accessContext: req.accessContext, actor: req.salesUser, taskId: req.params.taskId })));
  app.get('/api/sales-crm/ai/manager-anomalies', handle((api, db, req) =>
    api.getManagerAnomalies({ db, accessContext: req.accessContext, actor: req.salesUser })));
  app.post('/api/sales-crm/ai/manager-anomalies/run', handle((api, db, req) =>
    api.runManagerAnomalies({ db, accessContext: req.accessContext, actor: req.salesUser })));
  app.get('/api/sales-crm/ai/sales-coaching', handle((api, db, req) =>
    api.getSalesCoaching({ db, accessContext: req.accessContext, actor: req.salesUser })));
  app.post('/api/sales-crm/ai/sales-coaching/:salesUserId/run', handle((api, db, req) =>
    api.runSalesCoaching({
      db,
      accessContext: req.accessContext,
      actor: req.salesUser,
      salesUserId: req.params.salesUserId,
    })));
  app.post('/api/sales-crm/ai/customers/:customerId/stations/customer_fit/run', handle((api, db, req) =>
    api.runCustomerFit({ db, accessContext: req.accessContext, actor: req.salesUser, customerId: req.params.customerId })));
  app.post('/api/sales-crm/ai/customers/:customerId/stations/sales_pack/run', handle((api, db, req) =>
    api.runSalesPack({ db, accessContext: req.accessContext, actor: req.salesUser, customerId: req.params.customerId })));
  app.post('/api/sales-crm/ai/customers/:customerId/action-proposals', handle((api, db, req) =>
    api.runActionProposal({
      db,
      accessContext: req.accessContext,
      actor: req.salesUser,
      customerId: req.params.customerId,
      body: req.body,
    })));
  app.post('/api/sales-crm/ai/customers/:customerId/enrichment/run', handle((_api, db, req) => {
    assertFeatureEnabled(db, 'customer_enrichment', options.hardFlags || resolveAIHardFlags());
    return enrichment.start({
      db, accessContext: req.accessContext, actor: req.salesUser, customerId: req.params.customerId,
    });
  }));
  app.post('/api/sales-crm/ai/enrichment/:runId/cancel', handle((_api, db, req) =>
    enrichment.cancel({
      db, accessContext: req.accessContext, runId: req.params.runId,
    })));
  app.post('/api/sales-crm/ai/proposals/:proposalId/review', handle((_api, db, req) =>
    enrichment.review({
      db, accessContext: req.accessContext, actor: req.salesUser,
      proposalId: req.params.proposalId, body: req.body,
    })));
  app.post('/api/sales-crm/ai/jobs/:jobId/retry', handle((api, db, req) =>
    api.retryJob({ db, accessContext: req.accessContext, actor: req.salesUser, jobId: req.params.jobId })));
  app.post('/api/sales-crm/ai/jobs/:jobId/cancel', handle((api, db, req) =>
    api.cancelJob({ db, accessContext: req.accessContext, actor: req.salesUser, jobId: req.params.jobId })));
  app.post('/api/sales-crm/ai/jobs/:jobId/review', handle((api, db, req) =>
    api.reviewJob({
      db, accessContext: req.accessContext, actor: req.salesUser, jobId: req.params.jobId, body: req.body,
    })));
  app.post('/api/sales-crm/ai/jobs/:jobId/next-action/adopt', handle((api, db, req) =>
    api.adoptNextActionProposal({
      db, accessContext: req.accessContext, actor: req.salesUser,
      jobId: req.params.jobId, body: req.body,
    })));
  app.post('/api/sales-crm/ai/bulk/retry', handle((api, db, req) =>
    api.bulkJobs({ db, accessContext: req.accessContext, actor: req.salesUser, body: req.body, action: 'retry' })));
  app.post('/api/sales-crm/ai/bulk/cancel', handle((api, db, req) =>
    api.bulkJobs({ db, accessContext: req.accessContext, actor: req.salesUser, body: req.body, action: 'cancel' })));
  app.get('/api/sales-crm/ai/budgets', handle((api, db, req) =>
    api.listBudgets({ db, actor: req.salesUser })));
  app.put('/api/sales-crm/ai/budgets/:scopeType/:scopeId', handle((api, db, req) =>
    api.setBudget({
      db,
      actor: req.salesUser,
      scopeType: req.params.scopeType,
      scopeId: req.params.scopeId,
      body: req.body,
    })));
  return true;
}

module.exports = { createAIStationService, registerAIStationRoutes, resolveAIStationsEnabled, publicJob };
