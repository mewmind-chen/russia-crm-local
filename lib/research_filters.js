'use strict';

const { hasPermission } = require('./access_control');
const { FILTER_DEFINITIONS } = require('./filter_catalog');
const { astWithoutField, overlayOptionCounts } = require('./filter_option_linkage');

const RESEARCH_PAGE_CONFIG = Object.freeze({
  contacts: Object.freeze({
    pageKey: 'contacts',
    kind: 'people',
    requiredPermission: 'view_contacts',
    from: 'person_candidates pc',
    alias: 'pc',
  }),
  recon: Object.freeze({
    pageKey: 'recon',
    kind: 'recon',
    requiredPermission: 'view_recon',
    from: 'recon_results r',
    alias: 'r',
  }),
});

const RESEARCH_FILTER_DEFINITIONS = Object.freeze(FILTER_DEFINITIONS.filter(definition =>
  definition.pages.some(page => Object.hasOwn(RESEARCH_PAGE_CONFIG, page))));

const DEFINITIONS_BY_PAGE = new Map(
  Object.keys(RESEARCH_PAGE_CONFIG).map(pageKey => [
    pageKey,
    new Map(RESEARCH_FILTER_DEFINITIONS
      .filter(definition => definition.pages.includes(pageKey))
      .map(definition => [definition.key, definition])),
  ]),
);

const FILTER_COLUMNS = Object.freeze({
  contacts: Object.freeze({
    contact_level: 'pc.contact_level',
    department: 'pc.department',
    sales_ready: 'CAST(pc.sales_ready AS TEXT)',
    updated_at: 'pc.updated_at',
  }),
  recon: Object.freeze({
    industry: 'r.industry',
    customer_type: 'r.customer_type',
    current_pool: "COALESCE(NULLIF(r.current_pool,''),'未分池')",
    score: 'r.score',
    updated_at: 'r.updated_at',
  }),
});

function filterNotAuthorized() {
  const error = new Error('筛选条件未获授权');
  error.statusCode = 403;
  error.code = 'FILTER_NOT_AUTHORIZED';
  return error;
}

function researchPageNotFound() {
  const error = new Error('未知数据列表');
  error.statusCode = 404;
  error.code = 'RESEARCH_PAGE_NOT_FOUND';
  return error;
}

function pageConfig(pageKey) {
  const config = RESEARCH_PAGE_CONFIG[String(pageKey || '')];
  if (!config) throw researchPageNotFound();
  return config;
}

function assertPageAccess(user, config) {
  if (!hasPermission(user, config.requiredPermission)) throw filterNotAuthorized();
}

function definitionAllowed(user, definition) {
  return definition.requiredPermissions.every(permission => hasPermission(user, permission));
}

function listResearchFilterDefinitions(pageKey) {
  const config = pageConfig(pageKey);
  return [...DEFINITIONS_BY_PAGE.get(config.pageKey).values()];
}

function researchOwnerCondition(user, alias, params) {
  if (hasPermission(user, 'view_all_customers')) {
    const assignedCondition = hasPermission(user, 'manage_intake')
      ? ''
      : 'AND scoped_account.owner_id IS NOT NULL';
    return `EXISTS(SELECT 1 FROM crm_accounts scoped_account
      WHERE scoped_account.external_customer_id=${alias}.customer_id
        ${assignedCondition}
        AND COALESCE(scoped_account.lifecycle_status,'active')='active'
        AND COALESCE(scoped_account.is_test_data,0)=0)`;
  }
  params.push(String(user?.id || ''));
  return `EXISTS(SELECT 1 FROM crm_accounts scoped_account
    WHERE scoped_account.external_customer_id=${alias}.customer_id
      AND scoped_account.owner_id=?
      AND COALESCE(scoped_account.lifecycle_status,'active')='active'
      AND COALESCE(scoped_account.is_test_data,0)=0
      AND COALESCE(scoped_account.assignment_status,'claimed')!='returned')`;
}

function normalizedAstFilters(ast, pageKey) {
  if (!ast || typeof ast !== 'object' || Array.isArray(ast)) throw filterNotAuthorized();
  if (ast.page && String(ast.page) !== pageKey) throw filterNotAuthorized();
  if (!Array.isArray(ast.filters)) throw filterNotAuthorized();
  return ast.filters;
}

function normalizedValues(filter) {
  if (filter.operator !== 'in' || !Array.isArray(filter.values)) throw filterNotAuthorized();
  const values = [...new Set(filter.values.map(value => String(value).trim()).filter(Boolean))];
  if (!values.length) throw filterNotAuthorized();
  return values;
}

function addSearchCondition(user, pageKey, filter, conditions, params) {
  if (filter.operator !== 'contains') throw filterNotAuthorized();
  const value = String(filter.value || '').trim().slice(0, 120);
  if (!value) throw filterNotAuthorized();
  const like = `%${value}%`;
  if (pageKey === 'contacts') {
    conditions.push(`(pc.customer_id LIKE ? OR pc.full_name LIKE ? OR pc.full_name_local LIKE ?
      OR pc.title LIKE ? OR pc.department LIKE ?
      OR EXISTS(SELECT 1 FROM customer_pool searched_pool
        WHERE searched_pool.customer_id=pc.customer_id AND searched_pool.company_name LIKE ?)
      OR EXISTS(SELECT 1 FROM contact_methods searched_method
        WHERE searched_method.person_id=pc.person_id AND searched_method.value LIKE ?))`);
    params.push(like, like, like, like, like, like, like);
    return;
  }
  const columns = ['r.customer_id', 'r.company_name', 'r.industry', 'r.customer_type'];
  if (hasPermission(user, 'view_contacts')) {
    columns.push('r.opportunity_summary', 'r.contacts_summary');
  }
  conditions.push(`(${columns.map(column => `${column} LIKE ?`).join(' OR ')})`);
  params.push(...columns.map(() => like));
}

function addDateRangeCondition(column, filter, conditions, params) {
  if (filter.operator !== 'between') throw filterNotAuthorized();
  const from = String(filter.from || '').trim();
  const to = String(filter.to || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw filterNotAuthorized();
  }
  conditions.push(`${column}>=? AND ${column}<=?`);
  params.push(`${from} 00:00:00`, `${to} 23:59:59`);
}

function addMultiCondition(column, filter, conditions, params) {
  const values = normalizedValues(filter);
  conditions.push(`${column} IN (${values.map(() => '?').join(',')})`);
  params.push(...values);
}

function buildResearchFilterScope(user, pageKey, ast = { filters: [] }) {
  const config = pageConfig(pageKey);
  assertPageAccess(user, config);
  const definitions = DEFINITIONS_BY_PAGE.get(config.pageKey);
  const conditions = [];
  const params = [];
  for (const filter of normalizedAstFilters(ast, config.pageKey)) {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw filterNotAuthorized();
    const definition = definitions.get(String(filter.key || ''));
    if (!definition || !definitionAllowed(user, definition)) throw filterNotAuthorized();
    if (definition.key === 'search') {
      addSearchCondition(user, config.pageKey, filter, conditions, params);
    } else if (definition.type === 'date_range') {
      addDateRangeCondition(
        FILTER_COLUMNS[config.pageKey][definition.key],
        filter,
        conditions,
        params,
      );
    } else {
      addMultiCondition(
        FILTER_COLUMNS[config.pageKey][definition.key],
        filter,
        conditions,
        params,
      );
    }
  }
  const ownerCondition = researchOwnerCondition(user, config.alias, params);
  if (ownerCondition) conditions.push(ownerCondition);
  return {
    pageKey: config.pageKey,
    kind: config.kind,
    from: config.from,
    alias: config.alias,
    conditions,
    params,
    where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '',
  };
}

function normalizeAuthorizedFieldKeys(authorizedFields) {
  if (!Array.isArray(authorizedFields)) throw filterNotAuthorized();
  return [...new Set(authorizedFields.map(fieldValue => {
    if (typeof fieldValue === 'string') return fieldValue;
    return String(fieldValue?.key || '');
  }).filter(Boolean))];
}

function optionLabel(pageKey, fieldKey, value) {
  if (pageKey === 'contacts' && fieldKey === 'sales_ready') {
    return value === '1' ? '可交付销售' : '仍需验证';
  }
  if (pageKey === 'contacts' && fieldKey === 'contact_level') {
    return value || 'L0';
  }
  return value;
}

function researchFieldOptions(db, user, config, fieldKey, ast) {
  const expression = FILTER_COLUMNS[config.pageKey][fieldKey];
  const grouped = scope => {
    const where = scope.where
      ? `${scope.where} AND TRIM(COALESCE(CAST(${expression} AS TEXT),''))!=''`
      : ` WHERE TRIM(COALESCE(CAST(${expression} AS TEXT),''))!=''`;
    return db.prepare(`SELECT CAST(${expression} AS TEXT) value,COUNT(*) count
      FROM ${scope.from}${where}
      GROUP BY ${expression}
      ORDER BY value COLLATE NOCASE`).all(...scope.params).map(row => ({
      value: String(row.value),
      label: optionLabel(config.pageKey, fieldKey, String(row.value)),
      count: Number(row.count || 0),
    }));
  };
  const catalog = grouped(buildResearchFilterScope(user, config.pageKey, {
    page: config.pageKey,
    filters: [],
  }));
  const remaining = astWithoutField(ast, fieldKey);
  if (!remaining.filters?.length) return catalog;
  return overlayOptionCounts(
    catalog,
    grouped(buildResearchFilterScope(user, config.pageKey, remaining)),
  );
}

function researchFilterOptions(db, user, pageKey, authorizedFields, ast = { page: pageKey, filters: [] }) {
  const config = pageConfig(pageKey);
  assertPageAccess(user, config);
  const definitions = DEFINITIONS_BY_PAGE.get(config.pageKey);
  const linkageAst = ast && typeof ast === 'object' ? ast : { page: pageKey, filters: [] };
  const result = {};
  for (const fieldKey of normalizeAuthorizedFieldKeys(authorizedFields)) {
    const definition = definitions.get(fieldKey);
    if (!definition || !definitionAllowed(user, definition)) throw filterNotAuthorized();
    if (definition.type === 'text' || definition.type === 'date_range') {
      result[fieldKey] = [];
      continue;
    }
    result[fieldKey] = researchFieldOptions(db, user, config, fieldKey, linkageAst);
  }
  return result;
}

module.exports = {
  RESEARCH_PAGE_CONFIG,
  RESEARCH_FILTER_DEFINITIONS,
  listResearchFilterDefinitions,
  researchOwnerCondition,
  buildResearchFilterScope,
  researchFilterOptions,
};
