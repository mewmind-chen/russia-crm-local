'use strict';

const crypto = require('node:crypto');

const FILTER_PAGES = Object.freeze({
  progress: 'team_status_progress',
  collaboration: 'team_status_collaboration',
});

const ALLOWED_FILTERS = Object.freeze({
  [FILTER_PAGES.progress]: new Set([
    'search', 'country', 'owner', 'stage', 'customer_type', 'industry', 'priority',
    'created_at', 'task_status', 'task_reason', 'progress_kind',
  ]),
  [FILTER_PAGES.collaboration]: new Set([
    'search', 'country', 'owner', 'stage', 'created_at', 'task_status', 'task_reason',
    'collaboration_status', 'collaboration_source', 'collaboration_relation',
  ]),
});

const FILTER_MIGRATION_KEY = 'issue174-team-status-filters-v1';
const FILTER_PAGE_ADDITIONS = Object.freeze({
  search: Object.freeze(Object.values(FILTER_PAGES)),
  country: Object.freeze(Object.values(FILTER_PAGES)),
  owner: Object.freeze(Object.values(FILTER_PAGES)),
  stage: Object.freeze(Object.values(FILTER_PAGES)),
  customer_type: Object.freeze([FILTER_PAGES.progress]),
  industry: Object.freeze([FILTER_PAGES.progress]),
  priority: Object.freeze([FILTER_PAGES.progress]),
  created_at: Object.freeze(Object.values(FILTER_PAGES)),
  task_status: Object.freeze(Object.values(FILTER_PAGES)),
  task_reason: Object.freeze(Object.values(FILTER_PAGES)),
  progress_kind: Object.freeze([FILTER_PAGES.progress]),
  collaboration_status: Object.freeze([FILTER_PAGES.collaboration]),
  collaboration_source: Object.freeze([FILTER_PAGES.collaboration]),
  collaboration_relation: Object.freeze([FILTER_PAGES.collaboration]),
});

const TEAM_STATUS_FILTER_OPTIONS = Object.freeze({
  progress_kind: Object.freeze([
    Object.freeze({ value: 'progressed', label: '已推进' }),
    Object.freeze({ value: 'silent', label: '未推进' }),
    Object.freeze({ value: 'deferred', label: '延后跟进' }),
    Object.freeze({ value: 'planned', label: '已形成计划' }),
    Object.freeze({ value: 'action_after_plan', label: '计划后已行动' }),
    Object.freeze({ value: 'collaboration', label: '主管协作' }),
  ]),
  collaboration_status: Object.freeze([
    Object.freeze({ value: 'unresolved', label: '未解决' }),
    Object.freeze({ value: 'resolved', label: '已解决' }),
    Object.freeze({ value: 'escalated', label: '已升级' }),
  ]),
  collaboration_source: Object.freeze([
    Object.freeze({ value: 'manual', label: '手工补记' }),
    Object.freeze({ value: 'system', label: '系统事实' }),
  ]),
  collaboration_relation: Object.freeze([
    Object.freeze({ value: 'original', label: '原始记录' }),
    Object.freeze({ value: 'supplement', label: '补充记录' }),
    Object.freeze({ value: 'correction', label: '更正记录' }),
    Object.freeze({ value: 'revocation', label: '撤销记录' }),
    Object.freeze({ value: 'system', label: '系统事实' }),
  ]),
});

const FORBIDDEN_KEYS = new Set([
  'ai', 'aicontext', 'airecommendation', 'aiscore', 'candidate', 'candidates',
  'candidatesnapshot', 'rankedcandidates', 'suggestedowner', 'suggestedownerid',
  'assignmentreason', 'distributionreason', 'exclusionreason', 'quota',
  'workload', 'ownername',
]);

function filterError(message = '筛选条件未获授权') {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = 'FILTER_NOT_AUTHORIZED';
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function parseJson(value, fallback) {
  try {
    const result = JSON.parse(String(value || ''));
    return result === undefined ? fallback : result;
  } catch (_error) {
    return fallback;
  }
}

function installTeamStatusFilterCatalog(db, options = {}) {
  const requiredTables = [
    'filter_definitions', 'filter_catalog_migrations', 'filter_permission_state',
  ];
  if (requiredTables.some(table => !db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table))) {
    throw new Error('filter authorization schema must be installed before team status filters');
  }
  const at = String(options.now || new Date().toISOString().slice(0, 19).replace('T', ' '));
  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM filter_catalog_migrations WHERE migration_key=?')
      .get(FILTER_MIGRATION_KEY)) {
      return Number(db.prepare('SELECT version FROM filter_permission_state WHERE id=1')
        .get()?.version || 0);
    }
    let changes = 0;
    const update = db.prepare(
      'UPDATE filter_definitions SET pages_json=?,updated_at=? WHERE filter_key=?',
    );
    for (const [filterKey, pages] of Object.entries(FILTER_PAGE_ADDITIONS)) {
      const row = db.prepare('SELECT pages_json FROM filter_definitions WHERE filter_key=?')
        .get(filterKey);
      if (!row) throw new Error(`missing team status filter definition: ${filterKey}`);
      const current = parseJson(row.pages_json, []);
      const next = [...new Set([...current, ...pages])];
      if (JSON.stringify(current) !== JSON.stringify(next)) {
        changes += update.run(JSON.stringify(next), at, filterKey).changes;
      }
    }
    db.prepare('INSERT INTO filter_catalog_migrations(migration_key,applied_at) VALUES (?,?)')
      .run(FILTER_MIGRATION_KEY, at);
    if (changes) {
      db.prepare(`UPDATE filter_permission_state
        SET version=version+1,updated_at=? WHERE id=1`).run(at);
    }
    return Number(db.prepare('SELECT version FROM filter_permission_state WHERE id=1')
      .get()?.version || 0);
  }).immediate();
}

function cleanText(value, maxLength = 120) {
  const result = String(value || '').trim();
  if (!result || result.length > maxLength) throw filterError();
  return result;
}

function cleanValues(values) {
  if (!Array.isArray(values)) throw filterError();
  const result = [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  if (!result.length || result.length > 100) throw filterError();
  return result;
}

function normalizeFilter(filter) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw filterError();
  const key = String(filter.key || '').trim();
  if (!key) throw filterError();
  if (filter.operator === 'contains') {
    return Object.freeze({ key, operator: 'contains', value: cleanText(filter.value) });
  }
  if (filter.operator === 'in') {
    return Object.freeze({ key, operator: 'in', values: Object.freeze(cleanValues(filter.values)) });
  }
  if (filter.operator === 'between') {
    const from = String(filter.from || '').trim();
    const to = String(filter.to || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)
        || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw filterError();
    return Object.freeze({ key, operator: 'between', from, to });
  }
  throw filterError();
}

function normalizeAuthorizedTeamStatusFilters(user, input = {}, options = {}) {
  const requestedPage = String(input?.page || options.page || FILTER_PAGES.progress);
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_FILTERS, requestedPage)) throw filterError();
  let ast = input;
  const authorize = options.authorizeFilters || options.authorizeFilterAst;
  if (typeof authorize === 'function') {
    ast = authorize(user, input, { page: requestedPage }) || input;
  }
  const page = String(ast?.page || requestedPage);
  if (page !== requestedPage || !Array.isArray(ast?.filters)) throw filterError();
  const allowed = ALLOWED_FILTERS[page];
  const filters = ast.filters.map(normalizeFilter);
  if (filters.some(filter => !allowed.has(filter.key))) throw filterError();
  if (String(user?.role || '') === 'sales') {
    for (const filter of filters.filter(filter => filter.key === 'owner')) {
      if (filter.operator !== 'in'
          || filter.values.some(value => value !== String(user?.id || ''))) throw filterError();
    }
  }
  filters.sort((left, right) => left.key.localeCompare(right.key)
    || stableJson(left).localeCompare(stableJson(right)));
  return Object.freeze({ page, filters: Object.freeze(filters) });
}

function teamStatusViewKey(user, normalizedFilters, options = {}) {
  const ast = normalizeAuthorizedTeamStatusFilters(user, normalizedFilters, {
    ...options,
    page: normalizedFilters?.page || options.page,
    authorizeFilters: null,
    authorizeFilterAst: null,
  });
  const permissionVersion = Number(options.permissionVersion || normalizedFilters?.permissionVersion || 0);
  const fingerprint = stableJson({
    userId: String(user?.id || ''),
    page: ast.page,
    permissionVersion,
    filters: ast.filters,
  });
  return `team-status:${crypto.createHash('sha256').update(fingerprint).digest('hex')}`;
}

function teamStatusFilterOptions(_db, _user, page, definitions = []) {
  const allowed = ALLOWED_FILTERS[String(page || '')];
  if (!allowed) return {};
  const source = Array.isArray(definitions)
    ? definitions
    : definitions?.definitions || definitions?.filters || [];
  const advertised = new Set(source.map(item => String(item?.key || item)));
  return Object.fromEntries(Object.entries(TEAM_STATUS_FILTER_OPTIONS)
    .filter(([key]) => allowed.has(key) && (!advertised.size || advertised.has(key)))
    .map(([key, values]) => [key, values.map(item => ({ ...item }))]));
}

function valueAt(row, key) {
  const values = {
    owner: row.salesUserId || row.ownerId || row.actorId || '',
    country: row.country || '',
    stage: row.stage || '',
    customer_type: row.customerType || row.customer_type || '',
    industry: row.industry || '',
    priority: row.priority || '',
    task_status: row.taskStatus || row.status || '',
    task_reason: row.taskReason || row.problem || '',
    progress_kind: row.kind || row.progressKind || '',
    collaboration_status: row.status || '',
    collaboration_source: row.source || '',
    collaboration_relation: row.relationType || '',
  };
  return values[key];
}

function rowDate(row) {
  return String(row.occurredAt || row.createdAt || row.triggeredAt || row.updatedAt || '');
}

function searchable(row) {
  return [
    row.id, row.eventId, row.customerId, row.salesUserId, row.actorId,
    row.problem, row.suggestion, row.advice, row.outcome, row.nextStep,
    row.reason, row.status, row.source, row.sourceType, row.kind,
  ].map(value => String(value || '').toLowerCase()).join('\n');
}

function filterTeamStatusRows(rows, normalizedFilters) {
  const filters = normalizedFilters?.filters || [];
  return (rows || []).filter(row => filters.every(filter => {
    if (filter.operator === 'contains') {
      const target = filter.key === 'search'
        ? searchable(row)
        : String(valueAt(row, filter.key) || '').toLowerCase();
      return target.includes(String(filter.value).toLowerCase());
    }
    if (filter.operator === 'in') {
      return filter.values.includes(String(valueAt(row, filter.key) || ''));
    }
    if (filter.operator === 'between') {
      const date = rowDate(row).slice(0, 10);
      return date && date >= filter.from && date <= filter.to;
    }
    return false;
  }));
}

function pagination(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(
    input.pageSize || input.page_size, 10,
  ) || 50));
  return Object.freeze({ page, pageSize, offset: (page - 1) * pageSize });
}

function paginateTeamStatusRows(rows, input = {}, authorizedTotal = rows.length) {
  const pageInfo = pagination(input);
  const total = rows.length;
  const selected = rows.slice(pageInfo.offset, pageInfo.offset + pageInfo.pageSize);
  return {
    rows: selected,
    page: pageInfo.page,
    pageSize: pageInfo.pageSize,
    total,
    authorizedTotal: Number(authorizedTotal),
    hasMore: pageInfo.offset + selected.length < total,
  };
}

function normalizedKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function redactTeamStatusValue(value, options = {}) {
  if (Array.isArray(value)) return value.map(item => redactTeamStatusValue(item, options));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const normalized = normalizedKey(key);
    const aiField = normalized === 'ai' || normalized.startsWith('ai')
      || normalized.includes('recommendation') || normalized.includes('modeloutput');
    const sensitive = FORBIDDEN_KEYS.has(normalized)
      || normalized.startsWith('candidate') || normalized.startsWith('ranked')
      || normalized.startsWith('suggestedowner') || normalized.includes('assignmentreason')
      || normalized.includes('exclusionreason') || normalized.includes('distributionreason')
      || normalized.includes('quota') || normalized.includes('workload');
    if (sensitive || (options.includeAI !== true && aiField)) return [];
    return [[key, redactTeamStatusValue(item, options)]];
  }));
}

function csvCell(value) {
  let text = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  if (/^[\p{Cc}\p{Cf}\p{Z}]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  const safeRows = (rows || []).map(row => redactTeamStatusValue(row));
  const headers = [...new Set(safeRows.flatMap(row => Object.keys(row)))];
  if (!headers.length) return '\uFEFF';
  return `\uFEFF${[
    headers,
    ...safeRows.map(row => headers.map(header => row[header] ?? '')),
  ].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function exportTeamStatusRows(rows, input = {}) {
  const format = String(input.format || 'json').toLowerCase();
  if (!['json', 'csv'].includes(format)) {
    const error = new Error('导出格式无效');
    error.statusCode = 400;
    error.code = 'TEAM_STATUS_EXPORT_FORMAT_INVALID';
    throw error;
  }
  const safeRows = redactTeamStatusValue(rows || [], { includeAI: input.includeAI === true });
  const content = format === 'csv' ? toCsv(safeRows) : JSON.stringify(safeRows);
  return {
    format,
    rows: safeRows,
    content,
    body: content,
    contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
  };
}

module.exports = {
  FILTER_PAGES,
  exportTeamStatusRows,
  filterTeamStatusRows,
  installTeamStatusFilterCatalog,
  normalizeAuthorizedTeamStatusFilters,
  paginateTeamStatusRows,
  redactTeamStatusValue,
  stableJson,
  teamStatusFilterOptions,
  teamStatusViewKey,
  toCsv,
};
