'use strict';

const { hasPermission, redactContactFields } = require('./access_control');
const { STAGE_LABELS } = require('./customer_stages');

const PAGE_CONFIG = Object.freeze({
  pipeline: Object.freeze({ permission: 'view_pipeline' }),
  alerts: Object.freeze({ permission: 'view_alerts' }),
  insights: Object.freeze({ permission: 'view_insights' }),
  recycle_bin: Object.freeze({ permission: 'manage_customer_recycle' }),
});

const ACCOUNT_FILTERS = new Set([
  'search', 'country', 'city', 'owner', 'stage', 'customer_type', 'industry',
  'priority', 'source', 'creator', 'last_action', 'next_step', 'created_at',
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
  if (!config || !hasPermission(user, config.permission)) throw filterNotAuthorized();
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
  const activities = ids.length ? db.prepare(`SELECT * FROM crm_activities WHERE customer_id IN (${placeholders})
    AND COALESCE(is_test_data,0)=0 ORDER BY occurred_at DESC`).all(...ids) : [];
  const rfqs = ids.length ? db.prepare(`SELECT * FROM crm_rfqs WHERE customer_id IN (${placeholders}) ORDER BY received_at DESC`).all(...ids) : [];
  const quotes = ids.length ? db.prepare(`SELECT * FROM crm_quotes WHERE customer_id IN (${placeholders}) ORDER BY sent_at DESC`).all(...ids) : [];
  const builders = options.buildAlerts && options.groupAlerts ? options : require('./sales_crm');
  const nowText = options.nowText || new Date().toISOString().slice(0, 19).replace('T', ' ');
  return builders.groupAlerts([
    ...buildIntakeAlerts(db, user, nowText),
    ...builders.buildAlerts(accounts, activities, rfqs, quotes),
  ]);
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
  let paged = rows.slice(pageInfo.offset, pageInfo.offset + pageInfo.pageSize);
  if (!hasPermission(user, 'view_contacts')) paged = redactContactFields(paged);
  return { rows: paged, ...pageInfo, total: rows.length, authorizedTotal: all.length, hasMore: pageInfo.offset + paged.length < rows.length };
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

function listManagerEvaluationCustomers(db, user, ast = { page: 'insights', filters: [] }, input = {}) {
  assertPage(user, 'insights');
  const filters = filtersFor(ast, 'insights', INSIGHT_FILTERS);
  const pageInfo = pagination(input);
  const scope = accountScope(user);
  const conditions = [...scope.conditions];
  const params = [...scope.params];
  for (const filter of filters) {
    if (filter.key === 'search') {
      const like = `%${escapeLike(textFor(filter))}%`;
      conditions.push(`(LOWER(COALESCE(a.company_name,'')) LIKE LOWER(?) ESCAPE '\\'
        OR LOWER(COALESCE(p.nickname,a.nickname,'')) LIKE LOWER(?) ESCAPE '\\'
        OR LOWER(COALESCE(latest.evaluation_text,'')) LIKE LOWER(?) ESCAPE '\\'
        OR LOWER(COALESCE(latest.ai_labels_json,'')) LIKE LOWER(?) ESCAPE '\\')`);
      params.push(like, like, like, like);
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
        : RECYCLE_FILTERS;
  if (keys.some(key => !allowed.has(key))) throw filterNotAuthorized();
  let rows;
  if (pageKey === 'pipeline') rows = collectPaged(input =>
    listPipelineRows(db, user, { page: pageKey, filters: [] }, input));
  else if (pageKey === 'alerts') rows = allTodayTasks(db, user, options);
  else if (pageKey === 'insights') rows = collectPaged(input =>
    listManagerEvaluationCustomers(db, user, { page: pageKey, filters: [] }, input));
  else rows = collectPaged(input =>
    listRecycleRows(db, user, { page: pageKey, filters: [] }, input));
  const property = {
    owner: pageKey === 'pipeline' ? 'owner_id' : 'ownerId',
    stage: 'stage',
    priority: pageKey === 'alerts' ? 'customerPriority' : 'priority',
    urgency: 'urgency', due_status: 'dueStatus', evaluation_status: 'evaluationStatus',
    evaluation_author: 'authorId', country: 'country', city: 'city', customer_type: 'customer_type', industry: 'industry',
    source: 'source', creator: 'created_by',
    recycle_kind: 'recycleKind', previous_owner: 'previousOwnerId',
  };
  const result = {};
  for (const key of keys) {
    if (['search', 'created_at', 'due_at', 'evaluation_updated_at', 'recycled_at'].includes(key)) {
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
      else value = row[property[key]];
      if (value === undefined || value === null || value === '') continue;
      counts.set(String(value), (counts.get(String(value)) || 0) + 1);
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
  businessFilterOptions,
};
