'use strict';

const { hasPermission, redactContactFields } = require('./access_control');
const { STAGE_LABELS } = require('./customer_stages');
const { featureState, resolveAIHardFlags } = require('./ai_stations/feature_flags');

const PAGE_CONFIG = Object.freeze({
  pipeline: Object.freeze({ permission: 'view_pipeline' }),
  alerts: Object.freeze({ permission: 'view_alerts' }),
  insights: Object.freeze({ permission: 'view_insights' }),
  recycle_bin: Object.freeze({ permission: 'manage_customer_recycle' }),
  manager_tasks: Object.freeze({ permission: 'resolve_manager_tasks', roles: ['admin', 'manager'] }),
  manager_risks: Object.freeze({ permission: 'resolve_manager_tasks', roles: ['admin', 'manager'] }),
  manager_metrics: Object.freeze({ permission: 'resolve_manager_tasks', roles: ['admin', 'manager'] }),
  notifications: Object.freeze({ permission: 'view_customers' }),
});

const ACCOUNT_FILTERS = new Set([
  'search', 'country', 'city', 'owner', 'stage', 'customer_type', 'industry',
  'priority', 'source', 'creator', 'last_action', 'next_step', 'created_at',
  'established_year',
  'tag_customer_type', 'tag_business_product', 'tag_demand_product',
  'tag_industry', 'tag_focus_scenario', 'tag_needs_confirmation', 'tag_list',
]);
const ALERT_FILTERS = new Set(['search', 'owner', 'stage', 'priority', 'urgency', 'due_status', 'due_at']);
const INSIGHT_FILTERS = new Set([
  'search', 'country', 'city', 'owner', 'stage', 'priority',
  'evaluation_status', 'evaluation_author', 'evaluation_updated_at',
]);
const RECYCLE_FILTERS = new Set([
  'search', 'country', 'recycle_kind', 'previous_owner', 'recycled_at',
]);
const MANAGER_TASK_FILTERS = new Set([
  'search', 'owner', 'stage', 'created_at', 'task_status', 'task_reason',
  'recipient', 'task_due_at', 'task_resolved_at',
]);
const MANAGER_RISK_FILTERS = new Set([
  'search', 'owner', 'stage', 'created_at', 'task_status', 'task_reason',
  'recipient', 'task_due_at',
]);
const MANAGER_METRIC_FILTERS = new Set([
  'search', 'owner', 'stage', 'created_at', 'task_status', 'task_reason',
  'recipient', 'task_resolved_at', 'metric_window',
]);
const NOTIFICATION_FILTERS = new Set([
  'search', 'created_at', 'recipient', 'notification_status',
  'notification_code', 'notification_severity',
]);
const AI_NOTIFICATION_CODES = Object.freeze([
  'SALES_PACK_READY', 'SALES_PACK_FAILED', 'MANAGER_ANOMALY_READY',
  'SALES_COACHING_READY', 'AI_TASK_READY', 'AI_TASK_FAILED',
]);
const SALES_PACK_NOTIFICATION_CODES = Object.freeze([
  'SALES_PACK_READY', 'SALES_PACK_FAILED',
]);

const TAG_CATEGORIES = Object.freeze({
  tag_customer_type: '客户类型',
  tag_business_product: '客户经营产品',
  tag_demand_product: '需求/采购产品',
  tag_industry: '应用行业',
  tag_focus_scenario: '重点场景',
  tag_needs_confirmation: '需确认属性',
  tag_list: '名单标签',
});

function filterNotAuthorized() {
  const error = new Error('筛选条件未获授权');
  error.statusCode = 403;
  error.code = 'FILTER_NOT_AUTHORIZED';
  return error;
}

function assertPage(user, pageKey) {
  const config = PAGE_CONFIG[String(pageKey || '')];
  if (!config || !hasPermission(user, config.permission)
      || (config.roles && !config.roles.includes(String(user?.role || '')))) {
    throw filterNotAuthorized();
  }
  return config;
}

function filtersFor(ast, pageKey, allowed) {
  if (!ast || typeof ast !== 'object' || Array.isArray(ast)
      || (ast.page && ast.page !== pageKey) || !Array.isArray(ast.filters)) {
    throw filterNotAuthorized();
  }
  for (const filter of ast.filters) {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter) || !allowed.has(filter.key)) {
      throw filterNotAuthorized();
    }
  }
  return ast.filters;
}

function valuesFor(filter) {
  if (filter.operator !== 'in' || !Array.isArray(filter.values)) throw filterNotAuthorized();
  const values = [...new Set(filter.values.map(value => String(value).trim()).filter(Boolean))];
  if (!values.length) throw filterNotAuthorized();
  return values;
}

function textFor(filter) {
  if (filter.operator !== 'contains' || typeof filter.value !== 'string') throw filterNotAuthorized();
  const value = filter.value.trim();
  if (!value) throw filterNotAuthorized();
  return value;
}

function rangeFor(filter) {
  if (filter.operator !== 'between') throw filterNotAuthorized();
  const from = String(filter.from || '');
  const to = String(filter.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw filterNotAuthorized();
  }
  return { from: `${from} 00:00:00`, to: `${to} 23:59:59` };
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function jsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function pagination(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(input.pageSize || input.page_size, 10) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function accountScope(user, alias = 'a') {
  const common = [`COALESCE(${alias}.lifecycle_status,'active')='active'`, `COALESCE(${alias}.is_test_data,0)=0`];
  if (hasPermission(user, 'view_all_customers')) {
    if (!hasPermission(user, 'manage_intake')) common.push(`${alias}.owner_id IS NOT NULL`);
    return { conditions: common, params: [] };
  }
  return {
    conditions: [
      ...common,
      `${alias}.owner_id=?`,
      `COALESCE(${alias}.assignment_status,'claimed')!='returned'`,
    ],
    params: [String(user?.id || '')],
  };
}

function recycleScope(user, alias = 'a') {
  const conditions = [`COALESCE(${alias}.lifecycle_status,'active')='recycled'`];
  const params = [];
  if (!hasPermission(user, 'view_all_customers')) {
    conditions.push(`(${alias}.previous_owner_id=? OR ${alias}.recycled_by=?)`);
    params.push(String(user?.id || ''), String(user?.id || ''));
  }
  return { conditions, params };
}

function addIn(conditions, params, expression, filter) {
  const values = valuesFor(filter);
  conditions.push(`${expression} IN (${values.map(() => '?').join(',')})`);
  params.push(...values);
}

function addAccountFilter(conditions, params, filter, options = {}) {
  const columns = {
    country: "COALESCE(NULLIF(p.country,''),a.country)",
    city: "COALESCE(NULLIF(p.city,''),a.city)",
    owner: 'a.owner_id',
    stage: 'a.stage',
    customer_type: "COALESCE(NULLIF(p.customer_type,''),a.customer_type)",
    industry: "COALESCE(NULLIF(p.industry,''),a.industry)",
    priority: 'a.priority',
    source: 'a.source',
    creator: 'a.created_by',
    established_year: 'CAST(COALESCE(a.established_year,p.established_year) AS TEXT)',
  };
  if (filter.key === 'search') {
    const like = `%${escapeLike(textFor(filter))}%`;
    const searchable = [
      'a.id', 'a.external_customer_id', "COALESCE(p.nickname,a.nickname,'')",
      "COALESCE(NULLIF(p.company_name,''),a.company_name)",
      "COALESCE(NULLIF(p.country,''),a.country)",
      "COALESCE(NULLIF(p.city,''),a.city)",
      "COALESCE(NULLIF(p.website,''),a.website)",
      "COALESCE(NULLIF(p.industry,''),a.industry)",
    ];
    conditions.push(`(${searchable.map(column => `LOWER(COALESCE(${column},'')) LIKE LOWER(?) ESCAPE '\\'`).join(' OR ')})`);
    params.push(...searchable.map(() => like));
    return;
  }
  if (columns[filter.key]) {
    addIn(conditions, params, columns[filter.key], filter);
    return;
  }
  if (filter.key === 'created_at') {
    const range = rangeFor(filter);
    conditions.push('a.created_at BETWEEN ? AND ?');
    params.push(range.from, range.to);
    return;
  }
  if (filter.key === 'last_action' || filter.key === 'next_step') {
    const selected = valuesFor(filter);
    const now = options.nowText || new Date().toISOString().slice(0, 19).replace('T', ' ');
    const column = filter.key === 'last_action' ? 'a.last_activity_at' : 'a.next_action_at';
    const clauses = [];
    for (const value of selected) {
      if (value === 'none') clauses.push(`COALESCE(${column},'')=''`);
      else if (filter.key === 'last_action' && value === 'today') { clauses.push(`${column}>=date(?)`); params.push(now); }
      else if (filter.key === 'last_action' && value === '7d') { clauses.push(`${column}>=datetime(?,'-7 days')`); params.push(now); }
      else if (filter.key === 'last_action' && value === '30d') { clauses.push(`${column}>=datetime(?,'-30 days')`); params.push(now); }
      else if (filter.key === 'last_action' && value === 'older') { clauses.push(`${column}!='' AND ${column}<datetime(?,'-30 days')`); params.push(now); }
      else if (filter.key === 'next_step' && value === 'overdue') { clauses.push(`${column}!='' AND ${column}<?`); params.push(now); }
      else if (filter.key === 'next_step' && value === 'today') { clauses.push(`date(${column})=date(?)`); params.push(now); }
      else if (filter.key === 'next_step' && value === '7d') { clauses.push(`${column}>date(?) AND ${column}<datetime(?,'+7 days')`); params.push(now, now); }
      else if (filter.key === 'next_step' && value === 'later') { clauses.push(`${column}>=datetime(?,'+7 days')`); params.push(now); }
      else throw filterNotAuthorized();
    }
    conditions.push(`(${clauses.join(' OR ')})`);
    return;
  }
  const category = TAG_CATEGORIES[filter.key];
  if (category) {
    if (['tag_business_product', 'tag_demand_product'].includes(filter.key)
        && !hasPermission(options.user, 'view_contacts')) throw filterNotAuthorized();
    const values = valuesFor(filter);
    conditions.push(`EXISTS (SELECT 1 FROM customer_tags filtered_link
      JOIN tags filtered_tag ON filtered_tag.id=filtered_link.tag_id
      WHERE filtered_link.customer_id=a.external_customer_id AND filtered_tag.category=?
        AND (CAST(filtered_tag.id AS TEXT) IN (${values.map(() => '?').join(',')})
          OR filtered_tag.name IN (${values.map(() => '?').join(',')})))`);
    params.push(category, ...values, ...values);
    return;
  }
  throw filterNotAuthorized();
}

function accountFrom() {
  return `FROM crm_accounts a
    LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
    LEFT JOIN sales_users owner ON owner.id=a.owner_id
    LEFT JOIN sales_users creator ON creator.id=a.created_by`;
}

function listPipelineRows(db, user, ast = { page: 'pipeline', filters: [] }, input = {}) {
  assertPage(user, 'pipeline');
  const filters = filtersFor(ast, 'pipeline', ACCOUNT_FILTERS);
  const pageInfo = pagination(input);
  const scope = accountScope(user);
  const conditions = [...scope.conditions, "a.stage!='new'"];
  const params = [...scope.params];
  filters.forEach(filter => addAccountFilter(conditions, params, filter, { user, nowText: input.nowText }));
  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = Number(db.prepare(`SELECT COUNT(DISTINCT a.id) total ${accountFrom()} ${where}`).get(...params).total || 0);
  const authorizedTotal = Number(db.prepare(`SELECT COUNT(*) total FROM crm_accounts a WHERE ${[...scope.conditions, "a.stage!='new'"].join(' AND ')}`).get(...scope.params).total || 0);
  let rows = db.prepare(`SELECT DISTINCT a.*,
    COALESCE(p.nickname,a.nickname,'') nickname,
    COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
    COALESCE(NULLIF(p.country,''),a.country) country,
    COALESCE(NULLIF(p.city,''),a.city) city,
    COALESCE(NULLIF(p.industry,''),a.industry) industry,
    COALESCE(NULLIF(p.customer_type,''),a.customer_type) customer_type,
    owner.name owner_name,creator.name creator_name
    ${accountFrom()} ${where}
    ORDER BY a.stage,a.priority,a.updated_at DESC,a.id LIMIT ? OFFSET ?`).all(...params, pageInfo.pageSize, pageInfo.offset)
    .map(row => ({ ...row, stageLabel: STAGE_LABELS[row.stage] || row.stage }));
  if (!hasPermission(user, 'view_contacts')) rows = redactContactFields(rows);
  return { rows, ...pageInfo, total, authorizedTotal, hasMore: pageInfo.offset + rows.length < total };
}

function scopedAccounts(db, user) {
  const scope = accountScope(user);
  return db.prepare(`SELECT a.*,owner.name owner_name FROM crm_accounts a
    LEFT JOIN sales_users owner ON owner.id=a.owner_id WHERE ${scope.conditions.join(' AND ')}`).all(...scope.params);
}

function buildIntakeAlerts(db, user, nowText) {
  const conditions = ["i.status='assigned'", "i.claim_due_at!=''", 'i.claim_due_at<?'];
  const params = [nowText];
  if (!hasPermission(user, 'manage_intake')) { conditions.push('i.assigned_owner_id=?'); params.push(user.id); }
  const nowMs = new Date(nowText.replace(' ', 'T') + 'Z').getTime();
  return db.prepare(`SELECT i.*,u.name owner_name FROM crm_intake_items i
    LEFT JOIN sales_users u ON u.id=i.assigned_owner_id
    WHERE ${conditions.join(' AND ')} ORDER BY i.claim_due_at`).all(...params).map(item => ({
    id: `UNCLAIMED-LEAD-${item.id}`, severity: 'critical', code: 'UNCLAIMED_LEAD',
    title: '未开发线索超过24小时未领取',
    detail: `已分配给 ${item.owner_name || '销售'}，仍未确认领取`, action: '进入分配中心处理',
    customerId: '', companyName: item.company_name, ownerId: item.assigned_owner_id, dueAt: item.claim_due_at,
    ownerName: item.owner_name || '', assignedAt: item.assigned_at || '',
    actionKind: 'resolve_overdue_lead', allowedActions: ['reassign', 'return_to_pool'],
    managerRequest: null,
    stage: 'lead-assigned', intakeItemId: item.id, externalCustomerId: item.external_customer_id,
    country: item.country || '', customerPriority: item.match_group || 'C',
    overdueHours: Math.max(0, Math.floor((nowMs - new Date(String(item.claim_due_at).replace(' ', 'T') + 'Z').getTime()) / 3600000)),
    updatedAt: item.updated_at || item.assigned_at || item.created_at || '',
  }));
}

function allTodayTasks(db, user, options = {}) {
  const accounts = scopedAccounts(db, user);
  const ids = accounts.map(row => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const activities = ids.length ? db.prepare(`SELECT x.*,u.name user_name
    FROM crm_activities x LEFT JOIN sales_users u ON u.id=x.user_id
    WHERE x.customer_id IN (${placeholders})
    AND COALESCE(x.is_test_data,0)=0 ORDER BY x.occurred_at DESC`).all(...ids) : [];
  const rfqs = ids.length ? db.prepare(`SELECT * FROM crm_rfqs WHERE customer_id IN (${placeholders}) ORDER BY received_at DESC`).all(...ids) : [];
  const quotes = ids.length ? db.prepare(`SELECT * FROM crm_quotes WHERE customer_id IN (${placeholders}) ORDER BY sent_at DESC`).all(...ids) : [];
  const builders = options.buildAlerts && options.groupAlerts ? options : require('./sales_crm');
  const nowText = options.nowText || new Date().toISOString().slice(0, 19).replace('T', ' ');
  const alerts = builders.groupAlerts([
    ...buildIntakeAlerts(db, user, nowText),
    ...builders.buildAlerts(accounts, activities, rfqs, quotes),
  ]);
  const canUse = actionKind => {
    if (actionKind === 'resolve_overdue_lead') {
      return ['admin', 'manager'].includes(String(user?.role || ''))
        && hasPermission(user, 'manage_intake');
    }
    if (actionKind === 'add_next_plan') return hasPermission(user, 'record_activity');
    if (actionKind === 'record_activity') return hasPermission(user, 'record_activity');
    if (actionKind === 'record_quote') return hasPermission(user, 'record_quote');
    if (actionKind === 'complete_manager_assistance') {
      return ['admin', 'manager'].includes(String(user?.role || ''))
        && hasPermission(user, 'view_team')
        && hasPermission(user, 'view_alerts');
    }
    return false;
  };
  return alerts.map(alert => ({
    ...alert,
    allowedActions: canUse(alert.actionKind) ? alert.allowedActions : [],
    reasons: (alert.reasons || []).map(reason => ({
      ...reason,
      allowedActions: canUse(reason.actionKind) ? reason.allowedActions : [],
    })),
  }));
}

function alertMatches(user, item, filter) {
  if (filter.key === 'search') {
    const needle = textFor(filter).toLocaleLowerCase();
    const searchable = [item.companyName, item.officialCompanyName, item.title];
    if (hasPermission(user, 'view_contacts')) {
      searchable.push(item.detail, item.action,
        ...(item.reasons || []).flatMap(reason => [reason.title, reason.detail, reason.action]));
    }
    return searchable
      .some(value => String(value || '').toLocaleLowerCase().includes(needle));
  }
  if (['owner', 'stage', 'priority', 'urgency'].includes(filter.key)) {
    const key = { owner: 'ownerId', stage: 'stage', priority: 'customerPriority', urgency: 'urgency' }[filter.key];
    return valuesFor(filter).includes(String(item[key] || ''));
  }
  if (filter.key === 'due_status') {
    const selected = valuesFor(filter);
    const status = !item.dueAt ? 'unscheduled' : Number(item.maxOverdueHours || item.overdueHours || 0) > 0 ? 'overdue' : 'scheduled';
    return selected.includes(status);
  }
  if (filter.key === 'due_at') {
    const { from, to } = rangeFor(filter);
    return Boolean(item.dueAt) && String(item.dueAt) >= from && String(item.dueAt) <= to;
  }
  throw filterNotAuthorized();
}

function listTodayTasks(db, user, ast = { page: 'alerts', filters: [] }, input = {}, options = {}) {
  assertPage(user, 'alerts');
  const filters = filtersFor(ast, 'alerts', ALERT_FILTERS);
  const pageInfo = pagination(input);
  const all = allTodayTasks(db, user, options);
  const rows = all.filter(item => filters.every(filter => alertMatches(user, item, filter)));
  const summary = {
    objects: rows.length,
    reasons: rows.reduce((sum, item) => sum + Number(item.reasonCount || 0), 0),
    total: rows.length,
    immediate: rows.filter(item => item.urgency === 'immediate').length,
    today: rows.filter(item => item.urgency === 'today').length,
    attention: rows.filter(item => item.urgency === 'attention').length,
  };
  let paged = rows.slice(pageInfo.offset, pageInfo.offset + pageInfo.pageSize);
  if (!hasPermission(user, 'view_contacts')) paged = redactContactFields(paged);
  return {
    rows: paged,
    ...pageInfo,
    total: rows.length,
    authorizedTotal: all.length,
    summary,
    hasMore: pageInfo.offset + paged.length < rows.length,
  };
}

function insightCte(user) {
  const visible = hasPermission(user, 'view_contacts') ? '' : "WHERE subject_type='company'";
  return `WITH visible_evaluations AS (SELECT * FROM crm_manager_evaluations ${visible}),
    ranked_evaluations AS (SELECT e.*,ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at DESC,id DESC) rank
      FROM visible_evaluations e),
    evaluation_rollup AS (SELECT customer_id,COUNT(*) evaluation_count,MAX(created_at) latest_evaluation_at
      FROM visible_evaluations GROUP BY customer_id)`;
}

function addInsightFilter(conditions, params, filter) {
  if (filter.key === 'evaluation_status') {
    const values = valuesFor(filter);
    const clauses = [];
    if (values.includes('evaluated')) clauses.push('COALESCE(er.evaluation_count,0)>0');
    if (values.includes('not_evaluated')) clauses.push('COALESCE(er.evaluation_count,0)=0');
    if (!clauses.length || values.some(value => !['evaluated', 'not_evaluated'].includes(value))) throw filterNotAuthorized();
    conditions.push(`(${clauses.join(' OR ')})`);
    return;
  }
  if (filter.key === 'evaluation_author') return addIn(conditions, params, 'latest.author_id', filter);
  if (filter.key === 'evaluation_updated_at') {
    const range = rangeFor(filter);
    conditions.push('latest.updated_at BETWEEN ? AND ?');
    params.push(range.from, range.to);
    return;
  }
  addAccountFilter(conditions, params, filter, {});
}

function listManagerEvaluationCustomers(db, user, ast = { page: 'insights', filters: [] }, input = {}, options = {}) {
  assertPage(user, 'insights');
  const aiEnabled = options.aiEnabled !== false;
  const filters = filtersFor(ast, 'insights', INSIGHT_FILTERS);
  const pageInfo = pagination(input);
  const scope = accountScope(user);
  const conditions = [...scope.conditions];
  const params = [...scope.params];
  for (const filter of filters) {
    if (filter.key === 'search') {
      const like = `%${escapeLike(textFor(filter))}%`;
      const searchable = [
        "COALESCE(a.company_name,'')",
        "COALESCE(p.nickname,a.nickname,'')",
        "COALESCE(latest.evaluation_text,'')",
        ...(aiEnabled ? ["COALESCE(latest.ai_labels_json,'')"] : []),
      ];
      conditions.push(`(${searchable.map(column =>
        `LOWER(${column}) LIKE LOWER(?) ESCAPE '\\'`).join(' OR ')})`);
      params.push(...searchable.map(() => like));
    } else addInsightFilter(conditions, params, filter);
  }
  const joins = `${accountFrom()}
    LEFT JOIN evaluation_rollup er ON er.customer_id=a.id
    LEFT JOIN ranked_evaluations latest ON latest.customer_id=a.id AND latest.rank=1`;
  const where = `WHERE ${conditions.join(' AND ')}`;
  const cte = insightCte(user);
  const total = Number(db.prepare(`${cte} SELECT COUNT(DISTINCT a.id) total ${joins} ${where}`).get(...params).total || 0);
  const authorizedTotal = Number(db.prepare(`${cte} SELECT COUNT(*) total FROM crm_accounts a WHERE ${scope.conditions.join(' AND ')}`).get(...scope.params).total || 0);
  let rows = db.prepare(`${cte} SELECT DISTINCT a.id customerId,a.external_customer_id externalCustomerId,
    COALESCE(NULLIF(p.company_name,''),a.company_name) companyName,
    COALESCE(p.nickname,a.nickname,'') nickname,a.country,a.city,a.stage,a.priority,
    a.owner_id ownerId,owner.name ownerName,COALESCE(er.evaluation_count,0) evaluationCount,
    CASE WHEN COALESCE(er.evaluation_count,0)>0 THEN 'evaluated' ELSE 'not_evaluated' END evaluationStatus,
    latest.id latestEvaluationId,latest.subject_type subjectType,latest.subject_id subjectId,
    latest.subject_name subjectName,latest.subject_title subjectTitle,latest.evaluation_text evaluationText,
    latest.author_id authorId,latest.author_name authorName,latest.ai_status aiStatus,latest.ai_summary aiSummary,
    latest.ai_labels_json aiLabelsJson,latest.ai_risks_json aiRisksJson,latest.ai_strategy aiStrategy,
    latest.created_at evaluatedAt,latest.updated_at evaluationUpdatedAt
    ${joins} ${where}
    ORDER BY CASE WHEN latest.created_at IS NULL THEN 1 ELSE 0 END,latest.created_at DESC,a.id
    LIMIT ? OFFSET ?`).all(...params, pageInfo.pageSize, pageInfo.offset).map(row => ({
      ...row,
      evaluationCount: Number(row.evaluationCount || 0),
      aiLabels: JSON.parse(row.aiLabelsJson || '[]'),
      aiRisks: JSON.parse(row.aiRisksJson || '[]'),
    }));
  if (!aiEnabled) {
    rows = rows.map(row => {
      const safe = { ...row };
      delete safe.aiStatus;
      delete safe.aiSummary;
      delete safe.aiLabelsJson;
      delete safe.aiRisksJson;
      delete safe.aiStrategy;
      delete safe.aiLabels;
      delete safe.aiRisks;
      return safe;
    });
  }
  if (!hasPermission(user, 'view_contacts')) rows = redactContactFields(rows);
  return { rows, ...pageInfo, total, authorizedTotal, hasMore: pageInfo.offset + rows.length < total };
}

function listRecycleRows(db, user, ast = { page: 'recycle_bin', filters: [] }, input = {}) {
  assertPage(user, 'recycle_bin');
  const filters = filtersFor(ast, 'recycle_bin', RECYCLE_FILTERS);
  const pageInfo = pagination(input);
  const scope = recycleScope(user);
  const conditions = [...scope.conditions];
  const params = [...scope.params];
  for (const filter of filters) {
    if (filter.key === 'search') {
      const like = `%${escapeLike(textFor(filter))}%`;
      const searchable = [
        'a.id', 'a.external_customer_id', "COALESCE(p.nickname,a.nickname,'')",
        "COALESCE(NULLIF(p.company_name,''),a.company_name)", 'a.country',
      ];
      conditions.push(`(${searchable.map(column =>
        `LOWER(COALESCE(${column},'')) LIKE LOWER(?) ESCAPE '\\'`).join(' OR ')})`);
      params.push(...searchable.map(() => like));
    } else if (filter.key === 'country') {
      addIn(conditions, params, 'a.country', filter);
    } else if (filter.key === 'recycle_kind') {
      const values = valuesFor(filter);
      if (values.some(value => !['sales_return', 'manual_delete'].includes(value))) {
        throw filterNotAuthorized();
      }
      conditions.push(`a.recycle_kind IN (${values.map(() => '?').join(',')})`);
      params.push(...values);
    } else if (filter.key === 'previous_owner') {
      addIn(conditions, params, 'a.previous_owner_id', filter);
    } else if (filter.key === 'recycled_at') {
      const range = rangeFor(filter);
      conditions.push('a.recycled_at BETWEEN ? AND ?');
      params.push(range.from, range.to);
    } else {
      throw filterNotAuthorized();
    }
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = Number(db.prepare(`SELECT COUNT(*) total FROM crm_accounts a
    LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id ${where}`)
    .get(...params).total || 0);
  const authorizedTotal = Number(db.prepare(`SELECT COUNT(*) total FROM crm_accounts a
    WHERE ${scope.conditions.join(' AND ')}`).get(...scope.params).total || 0);
  const canReassign = !input.isImpersonating;
  const canRestore = user.role === 'admin'
    && hasPermission(user, 'manage_manual_customer_deletion')
    && !input.isImpersonating;
  const rows = db.prepare(`SELECT a.id,a.external_customer_id,
      COALESCE(p.nickname,a.nickname,'') nickname,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,a.country,a.stage,
      a.previous_owner_id,a.recycle_kind,a.recycle_reason,a.recycled_by,a.recycled_at,
      owner.name previous_owner_name,actor.name recycled_by_name
    FROM crm_accounts a
    LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
    LEFT JOIN sales_users owner ON owner.id=a.previous_owner_id
    LEFT JOIN sales_users actor ON actor.id=a.recycled_by
    ${where} ORDER BY a.recycled_at DESC,a.id LIMIT ? OFFSET ?`)
    .all(...params, pageInfo.pageSize, pageInfo.offset)
    .map(row => ({
      customerId: row.id,
      externalCustomerId: row.external_customer_id,
      nickname: row.nickname || '',
      companyName: row.company_name,
      country: row.country,
      stage: row.stage,
      previousOwnerId: row.previous_owner_id || '',
      previousOwnerName: row.previous_owner_name || '未分配',
      recycleKind: row.recycle_kind,
      reason: row.recycle_reason,
      recycledBy: row.recycled_by,
      recycledByName: row.recycled_by_name || row.recycled_by,
      recycledAt: row.recycled_at,
      actions: row.recycle_kind === 'sales_return'
        ? (canReassign ? ['reassign'] : [])
        : (canRestore ? ['restore'] : []),
    }));
  return {
    rows,
    ...pageInfo,
    total,
    authorizedTotal,
    hasMore: pageInfo.offset + rows.length < total,
  };
}

function managerTaskScope(user, pageKey, ast, options = {}) {
  assertPage(user, pageKey);
  const allowed = pageKey === 'manager_tasks'
    ? MANAGER_TASK_FILTERS
    : pageKey === 'manager_risks'
      ? MANAGER_RISK_FILTERS
      : MANAGER_METRIC_FILTERS;
  const filters = filtersFor(ast, pageKey, allowed);
  const accountAlias = options.accountAlias || 'a';
  const taskAlias = options.taskAlias || 't';
  const scope = accountScope(user, accountAlias);
  const conditions = [...scope.conditions];
  const params = [...scope.params];
  for (const filter of filters) {
    if (filter.key === 'metric_window') continue;
    if (filter.key === 'search') {
      const like = `%${escapeLike(textFor(filter))}%`;
      const searchable = [
        `${taskAlias}.id`, `${taskAlias}.customer_id`,
        `COALESCE(${accountAlias}.company_name,'')`,
        `COALESCE(${accountAlias}.nickname,'')`,
      ];
      conditions.push(`(${searchable.map(column =>
        `LOWER(COALESCE(${column},'')) LIKE LOWER(?) ESCAPE '\\'`).join(' OR ')})`);
      params.push(...searchable.map(() => like));
    } else if (filter.key === 'owner') {
      addIn(conditions, params,
        `COALESCE(NULLIF(${taskAlias}.owner_id_snapshot,''),${accountAlias}.owner_id)`, filter);
    } else if (filter.key === 'stage') {
      addIn(conditions, params, `${accountAlias}.stage`, filter);
    } else if (filter.key === 'task_status') {
      addIn(conditions, params, `${taskAlias}.status`, filter);
    } else if (filter.key === 'task_reason') {
      addIn(conditions, params, `${taskAlias}.reason`, filter);
    } else if (filter.key === 'recipient') {
      const values = valuesFor(filter);
      conditions.push(`EXISTS (SELECT 1 FROM json_each(${taskAlias}.recipient_ids_json) recipient_filter
        WHERE CAST(recipient_filter.value AS TEXT) IN (${values.map(() => '?').join(',')}))`);
      params.push(...values);
    } else if (['created_at', 'task_due_at', 'task_resolved_at'].includes(filter.key)) {
      const range = rangeFor(filter);
      const column = {
        created_at: `${taskAlias}.created_at`,
        task_due_at: `${taskAlias}.due_at`,
        task_resolved_at: `${taskAlias}.resolved_at`,
      }[filter.key];
      conditions.push(`${column} BETWEEN ? AND ?`);
      params.push(range.from, range.to);
    } else {
      throw filterNotAuthorized();
    }
  }
  return { conditions, params, filters };
}

function managerTaskFrom() {
  return `FROM crm_manager_tasks t
    JOIN crm_accounts a ON a.external_customer_id=t.customer_id
    LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
    LEFT JOIN sales_users owner ON owner.id=COALESCE(NULLIF(t.owner_id_snapshot,''),a.owner_id)`;
}

function managerTaskRow(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    accountId: row.account_id,
    companyName: row.company_name || '',
    nickname: row.nickname || '',
    ownerId: row.owner_id || '',
    ownerName: row.owner_name || '',
    stage: row.stage || '',
    status: row.status,
    reason: row.reason,
    recipientIds: jsonArray(row.recipient_ids_json).map(String),
    dueAt: row.due_at,
    triggeredAt: row.triggered_at,
    resolvedAt: row.resolved_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listManagerTaskRows(db, user, ast = { page: 'manager_tasks', filters: [] }, input = {}) {
  const pageKey = String(ast?.page || 'manager_tasks');
  if (!['manager_tasks', 'manager_risks'].includes(pageKey)) throw filterNotAuthorized();
  const pageInfo = pagination(input);
  const base = managerTaskScope(user, pageKey, { ...ast, page: pageKey });
  const unfiltered = managerTaskScope(user, pageKey, { page: pageKey, filters: [] });
  if (pageKey === 'manager_risks') {
    base.conditions.push("t.status IN ('open','overdue','escalated')");
    unfiltered.conditions.push("t.status IN ('open','overdue','escalated')");
  }
  const where = `WHERE ${base.conditions.join(' AND ')}`;
  const summaryRow = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN t.status='open' THEN 1 ELSE 0 END) open,
      SUM(CASE WHEN t.status='overdue' THEN 1 ELSE 0 END) overdue,
      SUM(CASE WHEN t.status='escalated' THEN 1 ELSE 0 END) escalated,
      SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) completed
    ${managerTaskFrom()} ${where}`).get(...base.params);
  const total = Number(summaryRow.total || 0);
  const authorizedTotal = Number(db.prepare(`SELECT COUNT(*) total ${managerTaskFrom()}
    WHERE ${unfiltered.conditions.join(' AND ')}`).get(...unfiltered.params).total || 0);
  const rows = db.prepare(`SELECT t.*,a.id account_id,a.stage,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
      COALESCE(p.nickname,a.nickname,'') nickname,
      COALESCE(NULLIF(t.owner_id_snapshot,''),a.owner_id) owner_id,owner.name owner_name
    ${managerTaskFrom()} ${where}
    ORDER BY CASE t.status WHEN 'escalated' THEN 0 WHEN 'overdue' THEN 1 WHEN 'open' THEN 2 ELSE 3 END,
      t.due_at,t.triggered_at DESC,t.id LIMIT ? OFFSET ?`)
    .all(...base.params, pageInfo.pageSize, pageInfo.offset).map(managerTaskRow);
  return {
    rows,
    ...pageInfo,
    total,
    authorizedTotal,
    summary: {
      total,
      open: Number(summaryRow.open || 0),
      overdue: Number(summaryRow.overdue || 0),
      escalated: Number(summaryRow.escalated || 0),
      completed: Number(summaryRow.completed || 0),
    },
    hasMore: pageInfo.offset + rows.length < total,
  };
}

function listManagerRiskRows(db, user, ast = { page: 'manager_risks', filters: [] }, input = {}) {
  if (ast?.page && ast.page !== 'manager_risks') throw filterNotAuthorized();
  return listManagerTaskRows(db, user, { ...ast, page: 'manager_risks' }, input);
}

function metricWindows(filters) {
  const filter = filters.find(item => item.key === 'metric_window');
  if (!filter) return [30, 90];
  const values = valuesFor(filter);
  if (values.some(value => !['30', '90'].includes(value))) throw filterNotAuthorized();
  return values.map(Number);
}

const MANAGER_METRIC_COUNT_KEYS = Object.freeze([
  'activeCustomers', 'deferredRecords', 'deferredCustomers', 'thresholdCustomers',
  'plannedAfterDeferredCustomers', 'onTimeActionCustomers',
  'firstTouchSilentCustomers', 'unimprovedAfterInterventionCustomers',
]);

function metricPercentage(value, total) {
  return total ? Math.round(Number(value || 0) / Number(total) * 10000) / 100 : 0;
}

function managerMetricSummary(rows, rangeDays) {
  const counts = Object.fromEntries(MANAGER_METRIC_COUNT_KEYS.map(key => [key, 0]));
  for (const row of rows) {
    for (const key of MANAGER_METRIC_COUNT_KEYS) counts[key] += Number(row.counts?.[key] || 0);
  }
  return {
    rangeDays,
    salesCount: rows.length,
    sampleSize: counts.activeCustomers,
    counts,
    ratios: {
      deferredCustomerRate: metricPercentage(counts.deferredCustomers, counts.activeCustomers),
      planFormationRate: metricPercentage(
        counts.plannedAfterDeferredCustomers, counts.deferredCustomers,
      ),
      onTimeActionRate: metricPercentage(
        counts.onTimeActionCustomers, counts.plannedAfterDeferredCustomers,
      ),
      anomalyCustomerRate: metricPercentage(counts.thresholdCustomers, counts.activeCustomers),
    },
    needsManagerReview: rows.some(row => row.needsManagerReview),
  };
}

function listManagerMetricRows(db, user, ast = { page: 'manager_metrics', filters: [] }, input = {}, options = {}) {
  assertPage(user, 'manager_metrics');
  const filters = filtersFor(ast, 'manager_metrics', MANAGER_METRIC_FILTERS);
  const windows = metricWindows(filters);
  const ownerFilters = filters.filter(filter => filter.key === 'owner');
  const rowScopeFilters = filters.filter(filter =>
    !['metric_window', 'owner'].includes(filter.key));
  const actorIds = ownerFilters.length
    ? [...new Set(ownerFilters.flatMap(valuesFor))]
    : null;
  const scope = rowScopeFilters.length ? managerTaskScope(user, 'manager_metrics', {
    page: 'manager_metrics', filters: rowScopeFilters,
  }) : null;
  const matches = scope ? db.prepare(`SELECT DISTINCT t.id task_id,t.customer_id,
      COALESCE(NULLIF(t.owner_id_snapshot,''),a.owner_id) owner_id
    ${managerTaskFrom()} WHERE ${scope.conditions.join(' AND ')}`)
    .all(...scope.params) : [];
  const scopedActorIds = actorIds === null && scope
    ? [...new Set(matches.map(row => String(row.owner_id || '')).filter(Boolean))]
    : actorIds;
  const metricScope = {
    ...(scopedActorIds === null ? {} : { actorIds: scopedActorIds }),
    ...(scope ? {
      customerIds: [...new Set(matches.map(row => String(row.customer_id || '')).filter(Boolean))],
      taskIds: [...new Set(matches.map(row => String(row.task_id || '')).filter(Boolean))],
    } : {}),
  };
  const hasMetricScope = scopedActorIds !== null || Boolean(scope);
  const { buildManagerMetrics } = require('./manager_metrics');
  const build = (rangeDays, scoped = false) => buildManagerMetrics(db, {
    user,
    rangeDays,
    now: options.now,
    settings: options.settings,
    ...(scoped ? metricScope : {}),
  }).sales.map(row => ({ ...row, rangeDays }));
  const authorized = windows.flatMap(rangeDays => build(rangeDays));
  const filtered = hasMetricScope
    ? windows.flatMap(rangeDays => build(rangeDays, true))
    : authorized;
  const summaries = Object.fromEntries(windows.map(rangeDays => {
    const rangeRows = filtered.filter(row => Number(row.rangeDays) === rangeDays);
    return [String(rangeDays), managerMetricSummary(rangeRows, rangeDays)];
  }));
  const pageInfo = pagination(input);
  const rows = filtered.slice(pageInfo.offset, pageInfo.offset + pageInfo.pageSize);
  return {
    rows,
    ...pageInfo,
    total: filtered.length,
    authorizedTotal: authorized.length,
    summary: { ranges: summaries },
    hasMore: pageInfo.offset + rows.length < filtered.length,
  };
}

function notificationScope(user, ast, options = {}) {
  assertPage(user, 'notifications');
  const filters = filtersFor(ast, 'notifications', NOTIFICATION_FILTERS);
  const account = accountScope(user, 'a');
  const customerConditions = [
    "n.customer_id=''",
    `EXISTS (
      SELECT 1 FROM crm_accounts a
      WHERE (a.id=n.customer_id OR a.external_customer_id=n.customer_id)
        AND ${account.conditions.join(' AND ')}
    )`,
  ];
  if (hasPermission(user, 'view_intake')) {
    customerConditions.push(`EXISTS (
      SELECT 1 FROM crm_intake_items i
      WHERE i.external_customer_id=n.customer_id AND i.assigned_owner_id=?
    )`);
  }
  const conditions = [
    'n.user_id=?',
    `(${customerConditions.join(' OR ')})`,
  ];
  const params = [String(user?.id || ''), ...account.params];
  if (hasPermission(user, 'view_intake')) params.push(String(user?.id || ''));
  const needsFeatureState = typeof options.aiEnabled !== 'boolean'
    || typeof options.salesPackEnabled !== 'boolean';
  const features = needsFeatureState
    ? featureState(dbForNotificationScope(options), options.hardFlags || resolveAIHardFlags())
    : null;
  const aiEnabled = typeof options.aiEnabled === 'boolean'
    ? options.aiEnabled
    : features.ai_stations.effectiveEnabled;
  const salesPackEnabled = aiEnabled && (typeof options.salesPackEnabled === 'boolean'
    ? options.salesPackEnabled
    : features.sales_pack.effectiveEnabled);
  if (!aiEnabled) {
    conditions.push(`n.code NOT IN (${AI_NOTIFICATION_CODES.map(() => '?').join(',')})`);
    params.push(...AI_NOTIFICATION_CODES);
  } else if (!salesPackEnabled) {
    conditions.push(`n.code NOT IN (${SALES_PACK_NOTIFICATION_CODES.map(() => '?').join(',')})`);
    params.push(...SALES_PACK_NOTIFICATION_CODES);
  }
  for (const filter of filters) {
    if (filter.key === 'search') {
      const like = `%${escapeLike(textFor(filter))}%`;
      const searchable = ['n.id', 'n.code', 'n.title'];
      if (hasPermission(user, 'view_contacts')) searchable.push('n.detail');
      conditions.push(`(${searchable.map(column =>
        `LOWER(COALESCE(${column},'')) LIKE LOWER(?) ESCAPE '\\'`).join(' OR ')})`);
      params.push(...searchable.map(() => like));
    } else if (filter.key === 'recipient') {
      addIn(conditions, params, 'n.user_id', filter);
    } else if (filter.key === 'notification_status') {
      addIn(conditions, params, 'n.status', filter);
    } else if (filter.key === 'notification_code') {
      addIn(conditions, params, 'n.code', filter);
    } else if (filter.key === 'notification_severity') {
      addIn(conditions, params, 'n.severity', filter);
    } else if (filter.key === 'created_at') {
      const range = rangeFor(filter);
      conditions.push('n.created_at BETWEEN ? AND ?');
      params.push(range.from, range.to);
    } else {
      throw filterNotAuthorized();
    }
  }
  return { conditions, params };
}

function dbForNotificationScope(options) {
  if (!options.db) throw new Error('notification database is required');
  return options.db;
}

function listNotificationRows(
  db,
  user,
  ast = { page: 'notifications', filters: [] },
  input = {},
  options = {},
) {
  const pageInfo = pagination(input);
  const runtimeOptions = { ...options, db };
  const scope = notificationScope(user, ast, runtimeOptions);
  const unfiltered = notificationScope(user, { page: 'notifications', filters: [] }, runtimeOptions);
  const where = `WHERE ${scope.conditions.join(' AND ')}`;
  const total = Number(db.prepare(`SELECT COUNT(*) total FROM crm_notifications n ${where}`)
    .get(...scope.params).total || 0);
  const summaryRow = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN n.status='unread' THEN 1 ELSE 0 END) unread,
      SUM(CASE WHEN n.wecom_status='failed' OR EXISTS (
        SELECT 1 FROM crm_notification_deliveries summary_delivery
        WHERE summary_delivery.notification_id=n.id
          AND summary_delivery.channel='wecom' AND summary_delivery.status='failed'
      ) THEN 1 ELSE 0 END) failed
    FROM crm_notifications n WHERE ${unfiltered.conditions.join(' AND ')}`)
    .get(...unfiltered.params);
  const authorizedTotal = Number(summaryRow.total || 0);
  let rows = db.prepare(`SELECT n.*,recipient.name recipient_name,
    (SELECT status FROM crm_notification_deliveries d
      WHERE d.notification_id=n.id AND d.channel='web') web_delivery_status,
    (SELECT status FROM crm_notification_deliveries d
      WHERE d.notification_id=n.id AND d.channel='wecom') wecom_delivery_status
    FROM crm_notifications n
    LEFT JOIN sales_users recipient ON recipient.id=n.user_id ${where}
    ORDER BY CASE n.status WHEN 'unread' THEN 0 ELSE 1 END,n.created_at DESC,n.id
    LIMIT ? OFFSET ?`).all(...scope.params, pageInfo.pageSize, pageInfo.offset).map(row => ({
      id: row.id,
      recipientId: row.user_id,
      recipientName: row.recipient_name || '',
      customerId: row.customer_id || '',
      code: row.code,
      severity: row.severity,
      title: row.title,
      detail: row.detail,
      status: row.status,
      createdAt: row.created_at,
      readAt: row.read_at || '',
      webDeliveryStatus: row.web_delivery_status || '',
      wecomDeliveryStatus: row.wecom_delivery_status || '',
      wecomStatus: row.wecom_status || '',
    }));
  if (!hasPermission(user, 'view_contacts')) {
    rows = redactContactFields(rows);
    if (user?.role === 'sales') {
      rows = rows.map(({ recipientId, recipientName, ...row }) => row);
    }
  }
  return {
    rows,
    ...pageInfo,
    total,
    authorizedTotal,
    summary: {
      total: authorizedTotal,
      unread: Number(summaryRow.unread || 0),
      failed: Number(summaryRow.failed || 0),
    },
    hasMore: pageInfo.offset + rows.length < total,
  };
}

function businessFilterOptions(db, user, pageKey, authorizedFields, options = {}) {
  assertPage(user, pageKey);
  if (!Array.isArray(authorizedFields)) throw filterNotAuthorized();
  const keys = authorizedFields.map(field => typeof field === 'string' ? field : field?.key);
  const allowed = pageKey === 'pipeline'
    ? ACCOUNT_FILTERS
    : pageKey === 'alerts'
      ? ALERT_FILTERS
      : pageKey === 'insights'
        ? INSIGHT_FILTERS
        : pageKey === 'recycle_bin'
          ? RECYCLE_FILTERS
          : pageKey === 'manager_tasks'
            ? MANAGER_TASK_FILTERS
            : pageKey === 'manager_risks'
              ? MANAGER_RISK_FILTERS
              : pageKey === 'manager_metrics'
                ? MANAGER_METRIC_FILTERS
                : NOTIFICATION_FILTERS;
  if (keys.some(key => !allowed.has(key))) throw filterNotAuthorized();
  let rows;
  if (pageKey === 'pipeline') rows = collectPaged(input =>
    listPipelineRows(db, user, { page: pageKey, filters: [] }, input));
  else if (pageKey === 'alerts') rows = allTodayTasks(db, user, options);
  else if (pageKey === 'insights') rows = collectPaged(input =>
    listManagerEvaluationCustomers(db, user, { page: pageKey, filters: [] }, input));
  else if (pageKey === 'recycle_bin') rows = collectPaged(input =>
    listRecycleRows(db, user, { page: pageKey, filters: [] }, input));
  else if (pageKey === 'manager_tasks') rows = collectPaged(input =>
    listManagerTaskRows(db, user, { page: pageKey, filters: [] }, input));
  else if (pageKey === 'manager_risks') rows = collectPaged(input =>
    listManagerRiskRows(db, user, { page: pageKey, filters: [] }, input));
  else if (pageKey === 'manager_metrics') rows = collectPaged(input =>
    listManagerMetricRows(db, user, { page: pageKey, filters: [] }, input, options));
  else rows = collectPaged(input =>
    listNotificationRows(db, user, { page: pageKey, filters: [] }, input, options));
  const property = {
    owner: pageKey === 'pipeline' ? 'owner_id' : 'ownerId',
    stage: 'stage',
    priority: pageKey === 'alerts' ? 'customerPriority' : 'priority',
    urgency: 'urgency', due_status: 'dueStatus', evaluation_status: 'evaluationStatus',
    evaluation_author: 'authorId', country: 'country', city: 'city', customer_type: 'customer_type', industry: 'industry',
    source: 'source', creator: 'created_by', established_year: 'established_year',
    recycle_kind: 'recycleKind', previous_owner: 'previousOwnerId',
    task_status: 'status', task_reason: 'reason', recipient: 'recipientId',
    metric_window: 'rangeDays', notification_status: 'status',
    notification_code: 'code', notification_severity: 'severity',
  };
  const result = {};
  for (const key of keys) {
    if (['search', 'created_at', 'due_at', 'evaluation_updated_at', 'recycled_at',
      'task_due_at', 'task_resolved_at'].includes(key)) {
      result[key] = [];
      continue;
    }
    if (key === 'last_action') { result[key] = ['today', '7d', '30d', 'older', 'none'].map(value => ({ value, label: value })); continue; }
    if (key === 'next_step') { result[key] = ['overdue', 'today', '7d', 'later', 'none'].map(value => ({ value, label: value })); continue; }
    if (TAG_CATEGORIES[key]) {
      result[key] = tagOptions(db, user, TAG_CATEGORIES[key]);
      continue;
    }
    const counts = new Map();
    for (const row of rows) {
      let value;
      if (key === 'due_status') value = !row.dueAt ? 'unscheduled' : Number(row.maxOverdueHours || row.overdueHours || 0) > 0 ? 'overdue' : 'scheduled';
      else if (key === 'recipient' && Array.isArray(row.recipientIds)) value = row.recipientIds;
      else value = row[property[key]];
      if (value === undefined || value === null || value === '') continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item === undefined || item === null || item === '') continue;
        counts.set(String(item), (counts.get(String(item)) || 0) + 1);
      }
    }
    result[key] = [...counts].map(([value, count]) => ({ value, label: key === 'stage' ? STAGE_LABELS[value] || value : value, count }));
  }
  return result;
}

function tagOptions(db, user, category) {
  const scope = accountScope(user);
  return db.prepare(`SELECT CAST(t.id AS TEXT) value,t.name label,COUNT(DISTINCT a.id) count
    FROM crm_accounts a
    JOIN customer_tags ct ON ct.customer_id=a.external_customer_id
    JOIN tags t ON t.id=ct.tag_id
    WHERE ${scope.conditions.join(' AND ')} AND t.category=?
    GROUP BY t.id,t.name ORDER BY t.name COLLATE NOCASE`).all(...scope.params, category).map(row => ({
    value: String(row.value),
    label: String(row.label || row.value),
    count: Number(row.count || 0),
  }));
}

function collectPaged(loadPage) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const result = loadPage({ page, pageSize: 100 });
    rows.push(...result.rows);
    if (!result.hasMore) return rows;
  }
}

module.exports = {
  PAGE_CONFIG,
  accountScope,
  listPipelineRows,
  listTodayTasks,
  listManagerEvaluationCustomers,
  listRecycleRows,
  managerTaskScope,
  listManagerTaskRows,
  listManagerRiskRows,
  listManagerMetricRows,
  listNotificationRows,
  businessFilterOptions,
};
