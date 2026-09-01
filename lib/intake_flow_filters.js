'use strict';

const { hasPermission, contactSafeIntakeRecord } = require('./access_control');
const { astWithoutField, overlayOptionCounts } = require('./filter_option_linkage');

const BUSINESS_STATUSES = Object.freeze([
  'pending', 'approved', 'assigned', 'claimed', 'returned', 'rejected', 'duplicate',
]);
const INTAKE_ACTIONABLE_STATUSES = Object.freeze([
  'pending', 'approved', 'assigned', 'returned',
]);
const FLOW_STATUSES = Object.freeze(['assigned', 'claimed', 'returned', 'rejected']);
const INTAKE_STATUS_LABELS = Object.freeze({
  pending: '待分配',
  approved: '待分配',
  assigned: '待领取',
  claimed: '已领取',
  returned: '已退回',
  rejected: '不对口',
  duplicate: '已在 CRM',
});
const INTAKE_SORT_VALUES = Object.freeze([
  'status_priority', 'recent_update', 'company_asc', 'claim_due_asc',
]);
const INTAKE_SORT_ORDER = Object.freeze({
  status_priority: `CASE i.status
      WHEN 'assigned' THEN 0 WHEN 'claimed' THEN 1 WHEN 'returned' THEN 2
      WHEN 'pending' THEN 3 WHEN 'approved' THEN 4 ELSE 5 END,
      i.created_at DESC,i.id ASC`,
  recent_update: 'i.updated_at DESC,i.created_at DESC,i.id ASC',
  company_asc: 'company_name COLLATE NOCASE ASC,i.id ASC',
  claim_due_asc: `CASE WHEN TRIM(COALESCE(i.claim_due_at,''))='' THEN 1 ELSE 0 END,
      i.claim_due_at ASC,i.id ASC`,
});

const TAG_FILTERS = Object.freeze([
  ['tag_customer_type', '客户类型', []],
  ['tag_business_product', '客户经营产品', ['view_contacts']],
  ['tag_demand_product', '需求/采购产品', ['view_contacts']],
  ['tag_industry', '应用行业', []],
  ['tag_focus_scenario', '重点场景', []],
  ['tag_needs_confirmation', '需确认属性', []],
  ['tag_list', '名单标签', []],
]);

function freezeDefinition(definition) {
  return Object.freeze({
    ...definition,
    operators: Object.freeze([...definition.operators]),
    requiredPermissions: Object.freeze([...(definition.requiredPermissions || [])]),
    pages: Object.freeze([...(definition.pages || [])]),
  });
}

function definition(key, type, options = {}) {
  const operators = {
    text: ['contains'],
    multi: ['in'],
    date_range: ['between'],
    boolean: ['eq'],
    tag_multi: ['in'],
  }[type];
  return freezeDefinition({
    key,
    type,
    operators,
    requiredPermissions: options.requiredPermissions || [],
    pages: ['intake', 'lead_flow'],
    tagCategory: options.tagCategory || '',
  });
}

const INTAKE_FLOW_FILTER_DEFINITIONS = Object.freeze([
  definition('search', 'text'),
  definition('country', 'multi'),
  definition('industry', 'multi'),
  definition('customer_type', 'multi'),
  definition('contact_level', 'multi', { requiredPermissions: ['view_contacts'] }),
  definition('owner', 'multi', { requiredPermissions: ['manage_intake'] }),
  definition('status', 'multi'),
  definition('source_batch', 'multi'),
  definition('updated_at', 'date_range'),
  definition('has_website', 'boolean'),
  definition('has_named_contact', 'boolean', { requiredPermissions: ['view_contacts'] }),
  definition('unassigned_only', 'boolean'),
  definition('created_today', 'boolean'),
  definition('claim_overdue', 'boolean'),
  ...TAG_FILTERS.map(([key, tagCategory, requiredPermissions]) => definition(
    key,
    'tag_multi',
    { tagCategory, requiredPermissions },
  )),
]);

const DEFINITIONS_BY_KEY = new Map(INTAKE_FLOW_FILTER_DEFINITIONS.map(item => [item.key, item]));

const INTAKE_FLOW_PAGE_CONFIG = Object.freeze({
  intake: Object.freeze({
    pageKey: 'intake',
    requiredPermission: 'view_intake',
    statuses: INTAKE_ACTIONABLE_STATUSES,
  }),
  lead_flow: Object.freeze({
    pageKey: 'lead_flow',
    requiredPermission: 'view_intake',
    statuses: FLOW_STATUSES,
  }),
});

const MULTI_COLUMNS = Object.freeze({
  country: 'i.country',
  industry: 'i.industry',
  customer_type: 'i.customer_type',
  contact_level: 'i.contact_level',
  owner: 'i.assigned_owner_id',
  status: 'i.status',
});

function filterNotAuthorized() {
  const error = new Error('筛选条件未获授权');
  error.statusCode = 403;
  error.code = 'FILTER_NOT_AUTHORIZED';
  return error;
}

function pageNotFound() {
  const error = new Error('未知数据列表');
  error.statusCode = 404;
  error.code = 'INTAKE_FLOW_PAGE_NOT_FOUND';
  return error;
}

function pageConfig(pageKey) {
  const config = INTAKE_FLOW_PAGE_CONFIG[String(pageKey || '')];
  if (!config) throw pageNotFound();
  return config;
}

function assertPageAccess(user, config) {
  if (!hasPermission(user, config.requiredPermission)) throw filterNotAuthorized();
}

function definitionAllowed(user, item) {
  if (user?.role === 'sales' && item.requiredPermissions.includes('manage_intake')) return false;
  return item.requiredPermissions.every(permission => hasPermission(user, permission));
}

function listIntakeFlowFilterDefinitions(pageKey) {
  const config = pageConfig(pageKey);
  return INTAKE_FLOW_FILTER_DEFINITIONS.filter(item => item.pages.includes(config.pageKey));
}

function normalizedFilters(ast, pageKey) {
  if (!ast || typeof ast !== 'object' || Array.isArray(ast)) throw filterNotAuthorized();
  if (String(ast.page || '') !== pageKey || !Array.isArray(ast.filters)) {
    throw filterNotAuthorized();
  }
  const seen = new Set();
  for (const item of ast.filters) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw filterNotAuthorized();
    const key = String(item.key || '');
    if (!key || seen.has(key)) throw filterNotAuthorized();
    seen.add(key);
  }
  return ast.filters;
}

function multiValues(filter) {
  if (filter.operator !== 'in' || !Array.isArray(filter.values)) throw filterNotAuthorized();
  const values = [...new Set(filter.values.map(value => String(value).trim()).filter(Boolean))];
  if (!values.length || values.length > 50 || values.some(value => value.length > 120)) {
    throw filterNotAuthorized();
  }
  return values;
}

function addSearch(user, filter, conditions, params) {
  if (filter.operator !== 'contains' || typeof filter.value !== 'string') {
    throw filterNotAuthorized();
  }
  const value = filter.value.trim();
  if (!value || value.length > 120) throw filterNotAuthorized();
  const columns = [
    `(SELECT p.nickname FROM customer_pool p
      WHERE p.customer_id=i.external_customer_id LIMIT 1)`,
    `(SELECT p.company_name FROM customer_pool p
      WHERE p.customer_id=i.external_customer_id LIMIT 1)`,
    'i.company_name', 'i.external_customer_id', 'i.website', 'i.industry',
  ];
  if (hasPermission(user, 'view_contacts')) {
    columns.push('i.product_focus', 'i.contact_name', 'i.contact_title', 'i.contact_methods');
  }
  conditions.push(`(${columns.map(column => `${column} LIKE ?`).join(' OR ')})`);
  params.push(...columns.map(() => `%${value}%`));
}

function addDateRange(filter, conditions, params) {
  const from = String(filter.from || '');
  const to = String(filter.to || '');
  if (filter.operator !== 'between'
      || !/^\d{4}-\d{2}-\d{2}$/.test(from)
      || !/^\d{4}-\d{2}-\d{2}$/.test(to)
      || from > to) {
    throw filterNotAuthorized();
  }
  conditions.push('i.updated_at>=? AND i.updated_at<=?');
  params.push(`${from} 00:00:00`, `${to} 23:59:59`);
}

function addBoolean(filter, expression, conditions) {
  let desired;
  if (filter.operator === 'eq' && typeof filter.value === 'boolean') {
    desired = filter.value;
  } else if (filter.operator === 'in' && Array.isArray(filter.values)) {
    const values = [...new Set(filter.values.map(value => String(value).trim()))];
    if (values.length !== 1 || !['true', 'false'].includes(values[0])) {
      throw filterNotAuthorized();
    }
    desired = values[0] === 'true';
  } else {
    throw filterNotAuthorized();
  }
  if (desired) conditions.push(expression);
  else conditions.push(`NOT (${expression})`);
}

function booleanDesired(filter) {
  let desired;
  if (filter.operator === 'eq' && typeof filter.value === 'boolean') {
    desired = filter.value;
  } else if (filter.operator === 'in' && Array.isArray(filter.values)) {
    const values = [...new Set(filter.values.map(value => String(value).trim()))];
    if (values.length !== 1 || !['true', 'false'].includes(values[0])) {
      throw filterNotAuthorized();
    }
    desired = values[0] === 'true';
  } else {
    throw filterNotAuthorized();
  }
  return desired;
}

function utcTimestamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function utcDayStart() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return utcTimestamp(date);
}

function addSourceBatch(filter, conditions, params) {
  const values = multiValues(filter);
  const placeholders = values.map(() => '?').join(',');
  conditions.push(`EXISTS (
    SELECT 1 FROM crm_intake_batches scoped_batch
    WHERE scoped_batch.id=i.batch_id
      AND (scoped_batch.id IN (${placeholders}) OR scoped_batch.source IN (${placeholders}))
  )`);
  params.push(...values, ...values);
}

function addTagFilter(definitionValue, filter, conditions, params) {
  const values = multiValues(filter);
  const placeholders = values.map(() => '?').join(',');
  conditions.push(`EXISTS (
    SELECT 1 FROM customer_tags scoped_tag_link
    JOIN tags scoped_tag ON scoped_tag.id=scoped_tag_link.tag_id
    WHERE scoped_tag_link.customer_id=i.external_customer_id
      AND scoped_tag.category=?
      AND (CAST(scoped_tag.id AS TEXT) IN (${placeholders})
        OR scoped_tag.name IN (${placeholders}))
  )`);
  params.push(definitionValue.tagCategory, ...values, ...values);
}

function buildIntakeFlowFilterScope(user, pageKey, ast = { page: pageKey, filters: [] }) {
  const config = pageConfig(pageKey);
  assertPageAccess(user, config);
  const conditions = [
    `i.status IN (${config.statuses.map(() => '?').join(',')})`,
  ];
  const params = [...config.statuses];
  if (user?.role === 'sales' || !hasPermission(user, 'manage_intake')) {
    conditions.push("i.status='assigned'");
    conditions.push('i.assigned_owner_id=?');
    params.push(String(user?.id || ''));
  }

  for (const filter of normalizedFilters(ast, config.pageKey)) {
    const item = DEFINITIONS_BY_KEY.get(String(filter.key || ''));
    if (!item || !definitionAllowed(user, item)) throw filterNotAuthorized();
    if (item.key === 'search') {
      addSearch(user, filter, conditions, params);
    } else if (item.key === 'updated_at') {
      addDateRange(filter, conditions, params);
    } else if (item.key === 'source_batch') {
      addSourceBatch(filter, conditions, params);
    } else if (item.key === 'has_website') {
      addBoolean(filter, `TRIM(i.website)!=''`, conditions);
    } else if (item.key === 'has_named_contact') {
      addBoolean(filter, `TRIM(i.contact_name)!=''`, conditions);
    } else if (item.key === 'unassigned_only') {
      addBoolean(filter, `TRIM(i.assigned_owner_id)=''`, conditions);
    } else if (item.key === 'created_today') {
      conditions.push(booleanDesired(filter) ? 'i.created_at>=?' : 'i.created_at<?');
      params.push(utcDayStart());
    } else if (item.key === 'claim_overdue') {
      const expression = "i.status='assigned' AND i.claim_due_at!='' AND i.claim_due_at<?";
      conditions.push(booleanDesired(filter) ? expression : `NOT (${expression})`);
      params.push(utcTimestamp());
    } else if (item.type === 'tag_multi') {
      addTagFilter(item, filter, conditions, params);
    } else {
      const values = multiValues(filter);
      const column = MULTI_COLUMNS[item.key];
      if (!column) throw filterNotAuthorized();
      conditions.push(`${column} IN (${values.map(() => '?').join(',')})`);
      params.push(...values);
    }
  }

  return {
    pageKey: config.pageKey,
    alias: 'i',
    from: 'crm_intake_items i',
    conditions,
    params,
    where: ` WHERE ${conditions.join(' AND ')}`,
  };
}

function authorizedFieldKeys(user, pageKey, authorizedFields) {
  pageConfig(pageKey);
  if (!Array.isArray(authorizedFields)) throw filterNotAuthorized();
  return [...new Set(authorizedFields.map(value => {
    if (typeof value === 'string') return value;
    return String(value?.key || '');
  }).filter(Boolean))].map(key => {
    const item = DEFINITIONS_BY_KEY.get(key);
    if (!item || !item.pages.includes(pageKey) || !definitionAllowed(user, item)) {
      throw filterNotAuthorized();
    }
    return item;
  });
}

function simpleOptions(db, scope, expression, labels = {}) {
  return db.prepare(`SELECT CAST(${expression} AS TEXT) value,COUNT(*) count
    FROM ${scope.from}${scope.where}
      AND TRIM(COALESCE(CAST(${expression} AS TEXT),''))!=''
    GROUP BY ${expression}
    ORDER BY value COLLATE NOCASE`).all(...scope.params).map(row => ({
    value: String(row.value),
    label: String(labels[row.value] || row.value),
    count: Number(row.count || 0),
  }));
}

function tagOptions(db, scope, item) {
  return db.prepare(`SELECT t.name value,t.name label,COUNT(DISTINCT i.id) count
    FROM ${scope.from}
    JOIN customer_tags ct ON ct.customer_id=i.external_customer_id
    JOIN tags t ON t.id=ct.tag_id
    ${scope.where} AND t.category=?
    GROUP BY t.id,t.name
    ORDER BY t.name COLLATE NOCASE`).all(...scope.params, item.tagCategory).map(row => ({
    value: String(row.value),
    label: String(row.label),
    count: Number(row.count || 0),
  }));
}

function intakeFlowFilterOptions(db, user, pageKey, authorizedFields, ast = { page: pageKey, filters: [] }) {
  const config = pageConfig(pageKey);
  assertPageAccess(user, config);
  const catalogScope = buildIntakeFlowFilterScope(user, pageKey, { page: pageKey, filters: [] });
  const linkageAst = ast && typeof ast === 'object' ? ast : { page: pageKey, filters: [] };

  function withLinkage(item, optionsForScope) {
    const catalog = optionsForScope(catalogScope);
    if (item.type === 'boolean') return catalog;
    const remaining = astWithoutField(linkageAst, item.key);
    if (!remaining.filters?.length) return catalog;
    return overlayOptionCounts(
      catalog,
      optionsForScope(buildIntakeFlowFilterScope(user, pageKey, remaining)),
    );
  }

  const result = {};
  for (const item of authorizedFieldKeys(user, pageKey, authorizedFields)) {
    if (item.type === 'text' || item.type === 'date_range') {
      result[item.key] = [];
    } else if (item.type === 'boolean') {
      result[item.key] = [
        { value: 'true', label: '是' },
        { value: 'false', label: '否' },
      ];
    } else if (item.type === 'tag_multi') {
      result[item.key] = withLinkage(item, scope => tagOptions(db, scope, item));
    } else if (item.key === 'source_batch') {
      result[item.key] = withLinkage(item, scope => db.prepare(`SELECT b.id value,
          CASE WHEN TRIM(b.source)='' THEN b.id ELSE b.source END label,COUNT(*) count
        FROM ${scope.from}
        JOIN crm_intake_batches b ON b.id=i.batch_id
        ${scope.where}
        GROUP BY b.id,b.source ORDER BY label COLLATE NOCASE,b.id`).all(...scope.params).map(row => ({
        value: String(row.value), label: String(row.label), count: Number(row.count || 0),
      })));
    } else if (item.key === 'owner') {
      result[item.key] = withLinkage(item, scope => db.prepare(`SELECT i.assigned_owner_id value,
          COALESCE(NULLIF(u.name,''),i.assigned_owner_id) label,COUNT(*) count
        FROM ${scope.from}
        LEFT JOIN sales_users u ON u.id=i.assigned_owner_id
        ${scope.where} AND TRIM(i.assigned_owner_id)!=''
        GROUP BY i.assigned_owner_id,u.name ORDER BY label COLLATE NOCASE`).all(...scope.params).map(row => ({
        value: String(row.value), label: String(row.label), count: Number(row.count || 0),
      })));
    } else if (item.key === 'status') {
      result[item.key] = withLinkage(item, scope => {
        const counts = Object.fromEntries(
          simpleOptions(db, scope, MULTI_COLUMNS[item.key], {}).map(option => [option.value, option.count]),
        );
        const salesOnlyAssigned = user?.role === 'sales' || !hasPermission(user, 'manage_intake');
        return Object.entries(INTAKE_STATUS_LABELS)
          .filter(([status]) => {
            if (!INTAKE_ACTIONABLE_STATUSES.includes(status)) return false;
            if (salesOnlyAssigned && status !== 'assigned') return false;
            return true;
          })
          .map(([status, label]) => ({
            value: status,
            label,
            ...(counts[status] ? { count: counts[status] } : {}),
          }));
      });
    } else {
      const expression = MULTI_COLUMNS[item.key];
      if (!expression) throw filterNotAuthorized();
      result[item.key] = withLinkage(item, scope => simpleOptions(db, scope, expression));
    }
  }
  return result;
}

function normalizePagination(pagination = {}) {
  const page = Math.max(1, Number.parseInt(pagination.page, 10) || 1);
  const pageSize = Math.max(20, Math.min(200, Number.parseInt(
    pagination.pageSize || pagination.page_size, 10,
  ) || 100));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function queryIntakeFlowPage(db, user, pageKey, ast, pagination = {}) {
  const scope = buildIntakeFlowFilterScope(user, pageKey, ast);
  const { page, pageSize, offset } = normalizePagination(pagination);
  const requestedSort = String(pagination.sort || '').trim();
  const orderBy = INTAKE_SORT_ORDER[requestedSort] || INTAKE_SORT_ORDER.status_priority;
  const total = Number(db.prepare(`SELECT COUNT(*) total
    FROM ${scope.from}${scope.where}`).get(...scope.params).total || 0);
  let items = db.prepare(`SELECT i.*,
      COALESCE((SELECT p.nickname FROM customer_pool p
        WHERE p.customer_id=i.external_customer_id LIMIT 1),'') nickname,
      COALESCE(NULLIF((SELECT p.company_name FROM customer_pool p
        WHERE p.customer_id=i.external_customer_id LIMIT 1),''),i.company_name) company_name,
      suggested.name suggested_owner_name,assigned.name assigned_owner_name
    FROM ${scope.from}
    LEFT JOIN sales_users suggested ON suggested.id=i.suggested_owner_id
    LEFT JOIN sales_users assigned ON assigned.id=i.assigned_owner_id
    ${scope.where}
    ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...scope.params, pageSize, offset);
  if (user?.role === 'sales') {
    items = items.map(item => {
      const safe = { ...item };
      delete safe.suggested_owner_id;
      delete safe.suggested_owner_name;
      delete safe.decision_reason;
      return safe;
    });
  }
  if (!hasPermission(user, 'view_contacts')) items = contactSafeIntakeRecord(items);
  return {
    items,
    page,
    pageSize,
    total,
    hasMore: offset + items.length < total,
  };
}

module.exports = {
  BUSINESS_STATUSES,
  INTAKE_ACTIONABLE_STATUSES,
  FLOW_STATUSES,
  INTAKE_STATUS_LABELS,
  INTAKE_SORT_VALUES,
  INTAKE_FLOW_PAGE_CONFIG,
  INTAKE_FLOW_FILTER_DEFINITIONS,
  listIntakeFlowFilterDefinitions,
  buildIntakeFlowFilterScope,
  intakeFlowFilterOptions,
  queryIntakeFlowPage,
};
