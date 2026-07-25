'use strict';

const crypto = require('node:crypto');
const { assertExternalCustomerAccess, redactContactFields } = require('../access_control');
const { asIso, parseJson, summarizeError } = require('./audit');
const { DEFAULT_PRICING, normalizeUsage } = require('./budgets');
const { buildCustomerContext } = require('./context');
const { buildManagerAnomalyContext } = require('./manager_anomaly');
const { buildSalesCoachingContext } = require('./sales_coaching');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');
const { installAIStationSchema } = require('./schema');

const SOURCE_PREFIXES = Object.freeze({
  recon: 'recon',
  contact_recon: 'contact',
  prospect: 'prospect',
  manager_evaluation: 'evaluation',
  assistant_chat: 'interaction',
});
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'dead_letter', 'cancelled']);

function exists(db, table) {
  return Boolean(db.prepare("SELECT 1 found FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function taskId(source, id) {
  return source === 'ai_station' ? id : `${SOURCE_PREFIXES[source] || source}:${id}`;
}

function durationMs(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return null;
  const value = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function queueWaitMs(createdAt, startedAt) {
  if (!createdAt || !startedAt) return null;
  const value = new Date(startedAt).getTime() - new Date(createdAt).getTime();
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function normalizeState(value) {
  const state = String(value || '').toLowerCase();
  const aliases = {
    complete: 'succeeded', completed: 'succeeded', done: 'succeeded', success: 'succeeded',
    error: 'failed', failure: 'failed', pending: 'queued', processing: 'running',
  };
  return aliases[state] || state || 'unknown';
}

function contentRestriction(item, accessContext) {
  const source = String(item?.source || '').toLowerCase();
  const type = String(item?.taskType || item?.station || '').toLowerCase();
  if (source.includes('contact') || type.includes('contact')) {
    return accessContext.permissions.view_contacts ? '' : 'contacts';
  }
  if ((source.includes('recon') || type.includes('recon')) && !accessContext.permissions.view_recon) {
    return 'recon';
  }
  return '';
}

function visibleSummary(value, accessContext, restriction = '') {
  if (!value || restriction) return '';
  let summary = summarizeError(value);
  if (!accessContext.permissions.view_contacts) {
    summary = summary
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
      .replace(/\+?\d[\d\s().-]{6,}\d/g, '[redacted-phone]');
  }
  if (!accessContext.permissions.view_recon) {
    summary = summary.replace(/https?:\/\/[^\s]+/gi, '[redacted-url]');
  }
  return summary;
}

function safeTask(item, accessContext) {
  const restriction = contentRestriction(item, accessContext);
  return {
    ...item,
    ...(item.taskType === 'sales_coaching'
      ? { customerId: '', crmAccountId: '', customerName: '' }
      : {}),
    errorSummary: visibleSummary(item.errorSummary, accessContext, restriction),
    contentRestricted: Boolean(restriction),
    restrictedContent: restriction,
  };
}

function canViewManagerAnomaly(actor, accessContext) {
  return ['admin', 'manager'].includes(actor?.role)
    && Boolean(accessContext?.permissions?.view_alerts)
    && Boolean(accessContext?.permissions?.view_team);
}

function canViewTeamAI(actor, accessContext) {
  return ['admin', 'manager'].includes(actor?.role)
    && Boolean(accessContext?.permissions?.view_team);
}

function publicAttempt(row) {
  return {
    attempt: row.attempt,
    engine: row.engine,
    model: row.model,
    status: row.status,
    durationMs: row.duration_ms,
    usage: parseJson(row.usage_json, {}),
    cost: row.cost,
    errorSummary: row.error_summary,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function createAITaskCenterStore(db, options = {}) {
  installAIStationSchema(db);
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || (prefix => `${prefix}-${crypto.randomUUID()}`);

  function aiStationTasks() {
    return db.prepare(`
      SELECT j.id source_id,j.customer_id,j.crm_account_id,j.station task_type,
        CASE WHEN j.control_state!='' THEN j.control_state ELSE j.state END state,
        j.priority,j.created_by actor_id,j.created_at,j.queued_at,
        (SELECT MIN(started_at) FROM crm_ai_model_runs m WHERE m.job_id=j.id) started_at,
        j.finished_at,j.updated_at,j.error_summary,
        COALESCE(r.engine,'') engine,COALESCE(r.model,'') model,COALESCE(r.cost,0) cost,
        COALESCE(a.company_name,'') customer_name
      FROM crm_ai_jobs j
      LEFT JOIN crm_ai_station_results r ON r.job_id=j.id
      LEFT JOIN crm_accounts a ON a.id=j.crm_account_id
    `).all().map(row => ({
      source: 'ai_station',
      taskId: taskId('ai_station', row.source_id),
      sourceId: row.source_id,
      taskType: row.task_type,
      customerId: row.customer_id,
      crmAccountId: row.crm_account_id || '',
      customerName: row.customer_name,
      actorId: row.actor_id,
      state: normalizeState(row.state),
      priority: row.priority,
      engine: row.engine,
      model: row.model,
      cost: row.cost,
      queueWaitMs: queueWaitMs(row.queued_at || row.created_at, row.started_at),
      durationMs: durationMs(row.started_at, row.finished_at),
      createdAt: row.created_at,
      startedAt: row.started_at || '',
      finishedAt: row.finished_at,
      updatedAt: row.updated_at,
      errorSummary: row.error_summary,
    }));
  }

  function interactionTasks() {
    return db.prepare(`
      SELECT i.*,COALESCE(a.company_name,'') customer_name
      FROM crm_ai_interaction_runs i LEFT JOIN crm_accounts a ON a.id=i.crm_account_id
    `).all().map(row => ({
      source: row.kind,
      taskId: taskId(row.kind, row.id),
      sourceId: row.id,
      taskType: row.kind,
      customerId: row.customer_id,
      crmAccountId: row.crm_account_id || '',
      customerName: row.customer_name,
      actorId: row.actor_id,
      state: normalizeState(row.state),
      priority: 0,
      engine: row.engine,
      model: row.model,
      cost: row.cost,
      queueWaitMs: 0,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
      startedAt: row.created_at,
      finishedAt: row.finished_at,
      updatedAt: row.finished_at,
      errorSummary: row.error_summary,
    }));
  }

  function legacyTasks() {
    const rows = [];
    if (exists(db, 'recon_jobs')) {
      rows.push(...db.prepare(`SELECT r.*,COALESCE(a.id,'') crm_account_id,
        COALESCE(a.company_name,r.company_name,'') customer_name
        FROM recon_jobs r LEFT JOIN crm_accounts a ON a.external_customer_id=r.customer_id`).all().map(row => ({
        source: 'recon', sourceId: row.job_id, taskType: 'company_recon',
        customerId: row.customer_id, crmAccountId: row.crm_account_id, customerName: row.customer_name,
        actorId: row.requested_by, state: normalizeState(row.status), priority: 0, engine: '', model: '', cost: 0,
        createdAt: row.requested_at, startedAt: row.started_at, finishedAt: row.finished_at,
        updatedAt: row.updated_at, errorSummary: row.error,
      })));
    }
    if (exists(db, 'contact_recon_jobs')) {
      rows.push(...db.prepare(`SELECT r.*,COALESCE(a.id,'') crm_account_id,
        COALESCE(a.company_name,r.company_name,'') customer_name
        FROM contact_recon_jobs r LEFT JOIN crm_accounts a ON a.external_customer_id=r.customer_id`).all().map(row => ({
        source: 'contact_recon', sourceId: row.job_id, taskType: 'contact_recon',
        customerId: row.customer_id, crmAccountId: row.crm_account_id, customerName: row.customer_name,
        actorId: '', state: normalizeState(row.status), priority: 0, engine: '', model: '', cost: 0,
        createdAt: row.created_at, startedAt: row.heartbeat_at, finishedAt: row.finished_at,
        updatedAt: row.updated_at, errorSummary: row.failure_reason || row.validation_error,
      })));
    }
    if (exists(db, 'prospect_tasks')) {
      rows.push(...db.prepare('SELECT * FROM prospect_tasks').all().map(row => ({
        source: 'prospect', sourceId: row.task_id, taskType: 'prospect_discovery',
        customerId: '', crmAccountId: '', customerName: '', actorId: row.created_by,
        state: normalizeState(row.status), priority: 0, engine: '', model: '', cost: 0,
        createdAt: row.created_at, startedAt: '', finishedAt: TERMINAL_STATES.has(normalizeState(row.status)) ? row.updated_at : '',
        updatedAt: row.updated_at, errorSummary: row.error,
      })));
    }
    if (exists(db, 'crm_manager_evaluations')) {
      rows.push(...db.prepare(`SELECT e.*,a.external_customer_id,a.company_name
        FROM crm_manager_evaluations e JOIN crm_accounts a ON a.id=e.customer_id`).all().map(row => ({
        source: 'manager_evaluation', sourceId: row.id, taskType: 'manager_evaluation',
        customerId: row.external_customer_id, crmAccountId: row.customer_id, customerName: row.company_name,
        actorId: row.author_id, state: normalizeState(row.ai_status), priority: 0, engine: '', model: row.ai_model, cost: 0,
        createdAt: row.created_at, startedAt: '', finishedAt: row.ai_generated_at,
        updatedAt: row.updated_at, errorSummary: row.ai_error,
      })));
    }
    return rows.map(row => ({
      ...row,
      taskId: taskId(row.source, row.sourceId),
      queueWaitMs: queueWaitMs(row.createdAt, row.startedAt),
      durationMs: durationMs(row.startedAt, row.finishedAt),
    }));
  }

  function visible(item, accessContext, actor) {
    if (item.taskType === 'manager_anomaly' && !canViewManagerAnomaly(actor, accessContext)) return false;
    if (item.taskType === 'sales_coaching' && !canViewTeamAI(actor, accessContext)) return false;
    const isAdmin = actor?.role === 'admin';
    if (item.customerId || item.crmAccountId) {
      return accessContext.externalCustomerIds.has(item.customerId)
        || accessContext.accountIds.has(item.crmAccountId);
    }
    return isAdmin || item.actorId === actor?.id;
  }

  function matches(item, query) {
    const states = String(query.state || '').split(',').map(value => value.trim()).filter(Boolean);
    const types = String(query.type || '').split(',').map(value => value.trim()).filter(Boolean);
    if (states.length && !states.includes(item.state)) return false;
    if (types.length && !types.includes(item.taskType) && !types.includes(item.source)) return false;
    if (query.customer && ![item.customerId, item.crmAccountId].includes(String(query.customer))) return false;
    if (query.owner && item.actorId !== String(query.owner)) return false;
    if (query.model && !String(item.model || '').toLowerCase().includes(String(query.model).toLowerCase())) return false;
    if (query.from && String(item.createdAt || '') < String(query.from)) return false;
    if (query.to && String(item.createdAt || '') > `${String(query.to).slice(0, 10)}T23:59:59.999Z`) return false;
    const search = String(query.search || '').trim().toLowerCase();
    return !search || [item.taskId, item.taskType, item.customerId, item.customerName, item.actorId, item.model]
      .some(value => String(value || '').toLowerCase().includes(search));
  }

  function list({ accessContext, actor, query = {} }) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize, 10) || 20));
    const items = [...aiStationTasks(), ...interactionTasks(), ...legacyTasks()]
      .filter(item => visible(item, accessContext, actor))
      .filter(item => matches(item, query))
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
        || right.taskId.localeCompare(left.taskId));
    return {
      items: items.slice((page - 1) * pageSize, page * pageSize)
        .map(item => safeTask(item, accessContext)),
      page,
      pageSize,
      total: items.length,
      overview: actor?.role === 'admin' ? overview() : null,
    };
  }

  function stationDetail(sourceId, accessContext, actor) {
    const jobs = createAIJobStore(db);
    const job = jobs.getJob(sourceId);
    if (!job) return null;
    if (job.station === 'manager_anomaly' && !canViewManagerAnomaly(actor, accessContext)) return null;
    if (job.station === 'sales_coaching' && !canViewTeamAI(actor, accessContext)) return null;
    assertExternalCustomerAccess(accessContext, job.customerId);
    const rawResult = createAIResultStore(db).getForJob(job.id);
    const restriction = contentRestriction({ source: 'ai_station', taskType: job.station }, accessContext);
    const result = rawResult ? {
      ...rawResult,
      ...(job.station === 'sales_coaching' ? { customerId: '', crmAccountId: null } : {}),
      value: restriction
        ? {}
        : (accessContext.permissions.view_contacts ? rawResult.value : redactContactFields(rawResult.value)),
    } : null;
    const attempts = db.prepare(`SELECT * FROM crm_ai_model_runs WHERE job_id=?
      ORDER BY attempt,id`).all(job.id).map(publicAttempt).map(item => ({
      ...item,
      errorSummary: visibleSummary(item.errorSummary, accessContext, restriction),
    }));
    const dependencies = db.prepare(`SELECT d.depends_on_job_id taskId,d.required_state requiredState,
      CASE WHEN j.control_state!='' THEN j.control_state ELSE j.state END state
      FROM crm_ai_job_dependencies d JOIN crm_ai_jobs j ON j.id=d.depends_on_job_id
      WHERE d.job_id=? ORDER BY d.depends_on_job_id`).all(job.id);
    const legacyTasks = db.prepare(`SELECT l.node_key nodeKey,l.legacy_task_type type,
      l.legacy_task_id sourceId,
      CASE
        WHEN l.legacy_task_type='recon' THEN (SELECT status FROM recon_jobs WHERE job_id=l.legacy_task_id)
        WHEN l.legacy_task_type='contact_recon' THEN
          (SELECT status FROM contact_recon_jobs WHERE job_id=l.legacy_task_id)
        ELSE NULL
      END state
      FROM crm_ai_enrichment_node_links l
      WHERE l.ai_job_id=? AND l.legacy_task_id!=''
      ORDER BY l.node_key,l.legacy_task_id`).all(job.id).map(item => ({
      nodeKey: item.nodeKey,
      type: item.type,
      taskId: taskId(item.type, item.sourceId),
      state: normalizeState(item.state),
    }));
    const enrichmentRun = db.prepare(`SELECT r.*,current.node_key current_node_key
      FROM crm_ai_enrichment_node_links current
      JOIN crm_ai_enrichment_runs r ON r.id=current.run_id
      WHERE current.ai_job_id=?
      ORDER BY r.created_at DESC,r.id DESC LIMIT 1`).get(job.id);
    const enrichment = enrichmentRun ? {
      runId: enrichmentRun.id,
      workflowId: enrichmentRun.workflow_id,
      state: enrichmentRun.state,
      routeState: enrichmentRun.route_state,
      completeness: Number(enrichmentRun.completeness || 0),
      missingItems: parseJson(enrichmentRun.missing_items_json, []),
      tags: parseJson(enrichmentRun.tags_json, []),
      currentNodeKey: enrichmentRun.current_node_key,
      nodes: db.prepare(`SELECT l.node_key nodeKey,l.ai_job_id aiJobId,
        l.legacy_task_type legacyTaskType,l.legacy_task_id legacyTaskId,l.adapter_state adapterState,
        j.state jobState,j.control_state controlState
        FROM crm_ai_enrichment_node_links l
        LEFT JOIN crm_ai_jobs j ON j.id=l.ai_job_id
        WHERE l.run_id=? ORDER BY l.created_at,l.node_key`).all(enrichmentRun.id).map(node => ({
        nodeKey: node.nodeKey,
        state: normalizeState(
          ['blocked', 'cancel_requested', 'cancelled'].includes(node.controlState)
            ? node.controlState : node.jobState || node.adapterState,
        ),
        taskId: node.aiJobId || null,
        legacyTask: node.legacyTaskId ? {
          type: node.legacyTaskType,
          taskId: taskId(node.legacyTaskType, node.legacyTaskId),
        } : null,
      })),
    } : null;
    const reviews = db.prepare(`SELECT decision,summary,reviewer_id reviewerId,created_at createdAt
      FROM crm_ai_task_reviews WHERE job_id=? ORDER BY created_at,id`).all(job.id).map(item => ({
      ...item,
      summary: accessContext.permissions.view_contacts
        ? visibleSummary(item.summary, accessContext, restriction)
        : '',
    }));
    let evidence = [];
    if (result) {
      try {
        const context = job.station === 'manager_anomaly'
          ? buildManagerAnomalyContext(db, accessContext, job.input.anomalyId)
          : job.station === 'sales_coaching'
            ? buildSalesCoachingContext(db, accessContext, job.input.salesUserId)
          : buildCustomerContext(db, accessContext, job.customerId);
        const allowed = new Map(context.evidence.map(item => [item.id, item]));
        evidence = (result.value?.evidenceIds || []).map(id => allowed.get(id)).filter(Boolean);
      } catch (_error) {
        evidence = [];
      }
    }
    const timeline = [
      { kind: 'queued', at: job.queuedAt || job.createdAt, state: 'queued' },
      ...attempts.flatMap(item => [
        { kind: 'attempt_started', at: item.startedAt, attempt: item.attempt, engine: item.engine, model: item.model },
        { kind: 'attempt_finished', at: item.finishedAt, attempt: item.attempt, state: item.status, durationMs: item.durationMs, errorSummary: item.errorSummary },
      ]),
      ...reviews.map(item => ({ kind: 'review', at: item.createdAt, state: item.decision, reviewerId: item.reviewerId, summary: item.summary })),
    ].filter(item => item.at).sort((a, b) => a.at.localeCompare(b.at));
    if (job.cancelRequestedAt) timeline.push({ kind: 'cancel_requested', at: job.cancelRequestedAt, state: 'cancel_requested' });
    if (job.cancelledAt) timeline.push({ kind: 'cancelled', at: job.cancelledAt, state: 'cancelled' });
    if (job.finishedAt && !attempts.some(item => item.finishedAt === job.finishedAt)) {
      timeline.push({ kind: 'finished', at: job.finishedAt, state: job.state });
    }
    return {
      taskId: job.id,
      source: 'ai_station',
      taskType: job.station,
      customerId: job.station === 'sales_coaching' ? '' : job.customerId,
      crmAccountId: job.station === 'sales_coaching' ? null : job.crmAccountId,
      state: job.state,
      priority: job.priority,
      workflowId: job.workflowId,
      parentJobId: job.parentJobId,
      dependencies,
      legacyTasks,
      enrichment,
      attempts,
      result,
      evidence,
      reviews,
      timeline: timeline.sort((a, b) => a.at.localeCompare(b.at)),
      errorSummary: visibleSummary(job.errorSummary, accessContext, restriction),
      contentRestricted: Boolean(restriction),
      restrictedContent: restriction,
      createdBy: job.createdBy,
      createdAt: job.createdAt,
      queuedAt: job.queuedAt,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt,
      queueWaitMs: queueWaitMs(job.queuedAt || job.createdAt, attempts[0]?.startedAt),
      durationMs: durationMs(attempts[0]?.startedAt, job.finishedAt),
      canCancel: Boolean(accessContext.permissions.cancel_ai_tasks)
        && (['queued', 'running', 'retry_wait'].includes(job.state)
          || legacyTasks.some(item => ['queued', 'running'].includes(item.state))),
      canRetry: Boolean(accessContext.permissions.use_ai_assistant)
        && ['dead_letter', 'blocked', 'cancelled', 'retry_wait'].includes(job.state),
      canReview: !['action_proposal', 'next_action'].includes(job.station)
        && Boolean(accessContext.permissions.review_ai_tasks) && job.state === 'needs_review',
    };
  }

  function genericDetail(source, sourceId, accessContext, actor) {
    const rawItem = [...interactionTasks(), ...legacyTasks()].find(row => row.source === source && row.sourceId === sourceId);
    if (!rawItem || !visible(rawItem, accessContext, actor)) return null;
    const item = safeTask(rawItem, accessContext);
    const restriction = item.restrictedContent;
    const timeline = [{ kind: 'queued', at: item.createdAt, state: 'queued' }];
    if (item.startedAt) timeline.push({ kind: 'started', at: item.startedAt, state: 'running' });
    if (item.finishedAt) timeline.push({ kind: 'finished', at: item.finishedAt, state: item.state });
    if (source === 'assistant_chat') {
      const row = db.prepare('SELECT * FROM crm_ai_interaction_runs WHERE id=?').get(sourceId);
      item.usage = parseJson(row.usage_json, {});
      item.attempts = parseJson(row.attempts_json, []).map(value => ({
        engine: value.engine || '', ok: Boolean(value.ok), durationMs: Number(value.durationMs) || 0,
        error: visibleSummary(value.error || value.code || '', accessContext, restriction),
      }));
      item.fallbackReason = visibleSummary(row.fallback_reason, accessContext, restriction);
    }
    return { ...item, timeline, canCancel: false, canRetry: false, canReview: false };
  }

  function detail({ taskId: selected, accessContext, actor }) {
    const raw = String(selected || '');
    if (!raw.includes(':')) return stationDetail(raw, accessContext, actor);
    const [prefix, ...rest] = raw.split(':');
    const source = Object.entries(SOURCE_PREFIXES).find(([, value]) => value === prefix)?.[0];
    return source ? genericDetail(source, rest.join(':'), accessContext, actor) : null;
  }

  function overview() {
    const at = now();
    const nowText = asIso(at);
    const dayStart = new Date(at.getTime() - 86_400_000).toISOString();
    const monthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
    const states = db.prepare(`SELECT CASE WHEN control_state!='' THEN control_state ELSE state END state,
      COUNT(*) count FROM crm_ai_jobs GROUP BY 1`).all();
    const slots = db.prepare(`SELECT resource,COUNT(*) active FROM crm_ai_resource_slots
      WHERE lease_expires_at>? GROUP BY resource ORDER BY resource`).all(nowText);
    const failures = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN status IN ('failed','invalid_output') THEN 1 ELSE 0 END) failed
      FROM crm_ai_model_runs WHERE finished_at>=?`).get(dayStart);
    const costs = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN accounted_at>=? THEN charged_cost_micros ELSE 0 END),0) dailyMicros,
      COALESCE(SUM(charged_cost_micros),0) monthlyMicros
      FROM crm_ai_usage_ledger WHERE accounted_at>=?`).get(dayStart, monthStart);
    const policies = db.prepare(`SELECT scope_type scopeType,scope_id scopeId,
      daily_limit_micros dailyLimitMicros,monthly_limit_micros monthlyLimitMicros,
      per_task_limit_micros perTaskLimitMicros,warning_ratio warningRatio
      FROM crm_ai_budget_policies WHERE enabled=1 ORDER BY scope_type,scope_id`).all()
      .map(policy => ({
        ...policy,
        dailyLimit: policy.dailyLimitMicros / 1_000_000,
        monthlyLimit: policy.monthlyLimitMicros / 1_000_000,
        perTaskLimit: policy.perTaskLimitMicros / 1_000_000,
      }));
    const alerts = db.prepare('SELECT COUNT(*) count FROM crm_ai_budget_alerts').get().count;
    return {
      queue: Object.fromEntries(states.map(row => [row.state, row.count])),
      activeSlots: slots,
      dailyCost: Number(costs.dailyMicros || 0) / 1_000_000,
      monthlyCost: Number(costs.monthlyMicros || 0) / 1_000_000,
      budget: { policies, alertCount: alerts },
      failureRate24h: failures.total ? Number(failures.failed || 0) / failures.total : 0,
    };
  }

  function recordInteraction(input = {}) {
    const createdAt = asIso(input.createdAt || now());
    const finishedAt = asIso(input.finishedAt || now());
    const usage = input.usage && typeof input.usage === 'object' ? input.usage : {};
    const normalized = normalizeUsage(usage, DEFAULT_PRICING);
    const cost = input.engine || input.model
      ? (normalized.inputTokens * DEFAULT_PRICING.inputPerMillion
        + normalized.outputTokens * DEFAULT_PRICING.outputPerMillion) / 1_000_000
      : 0;
    const id = idFactory('AII');
    db.prepare(`INSERT INTO crm_ai_interaction_runs
      (id,kind,scope,customer_id,crm_account_id,actor_id,state,engine,model,duration_ms,usage_json,cost,
       fallback_reason,attempts_json,error_summary,created_at,finished_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.kind || 'assistant_chat', String(input.scope || ''), String(input.customerId || ''),
      input.crmAccountId || null, String(input.actorId || ''), input.error ? 'failed' : 'succeeded',
      String(input.engine || ''), String(input.model || ''), Math.max(0, Math.floor(Number(input.durationMs) || 0)),
      JSON.stringify(usage), cost, String(input.fallbackReason || ''),
      JSON.stringify(Array.isArray(input.attempts) ? input.attempts : []),
      input.error ? summarizeError(input.error) : '', createdAt, finishedAt,
    );
    return id;
  }

  function review({ jobId, accessContext, actor, decision, summary = '' }) {
    const jobs = createAIJobStore(db);
    const job = jobs.getJob(jobId);
    if (!job) return null;
    if (job.station === 'manager_anomaly' && !canViewManagerAnomaly(actor, accessContext)) return null;
    assertExternalCustomerAccess(accessContext, job.customerId);
    if (['action_proposal', 'next_action'].includes(job.station)) {
      const error = new Error(job.station === 'action_proposal'
        ? '活动提案必须在记录跟进表单确认'
        : '下一步建议必须通过采纳流程确认');
      error.statusCode = 409;
      error.code = job.station === 'action_proposal'
        ? 'AI_ACTION_PROPOSAL_REQUIRES_ACTIVITY_CONFIRMATION'
        : 'AI_NEXT_ACTION_REQUIRES_ADOPTION';
      throw error;
    }
    if (job.state !== 'needs_review') {
      const error = new Error('AI job is not awaiting review');
      error.statusCode = 409;
      throw error;
    }
    if (!['approved', 'rejected'].includes(decision)) throw new Error('decision must be approved or rejected');
    const at = asIso(now());
    const cleanSummary = String(summary || '').trim().slice(0, 500);
    const transaction = db.transaction(() => {
      db.prepare(`INSERT INTO crm_ai_task_reviews(id,job_id,reviewer_id,decision,summary,created_at)
        VALUES (?,?,?,?,?,?)`).run(idFactory('AIRV'), job.id, actor.id, decision, cleanSummary, at);
      db.prepare(`UPDATE crm_ai_jobs SET state=?,error_summary=?,updated_at=?,finished_at=?
        WHERE id=? AND state='needs_review'`).run(
        decision === 'approved' ? 'succeeded' : 'dead_letter',
        decision === 'approved' ? '' : (cleanSummary || '复核退回'),
        at, at, job.id,
      );
    });
    transaction.immediate();
    return stationDetail(job.id, accessContext, actor);
  }

  return Object.freeze({ list, detail, overview, recordInteraction, review });
}

module.exports = { createAITaskCenterStore, normalizeState, taskId };
