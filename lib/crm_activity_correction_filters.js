'use strict';

const crypto = require('node:crypto');
const { hasPermission } = require('./access_control');
const { accountScope } = require('./business_page_filters');

const FILTER_PAGES = Object.freeze({
  targets: 'activity_correction_targets',
  corrections: 'activity_corrections',
  proposals: 'activity_correction_proposals',
});
const FILTER_MIGRATION_KEY = 'issue171-activity-correction-filters-v1';
const FILTER_PAGE_ADDITIONS = Object.freeze({
  search: Object.freeze(Object.values(FILTER_PAGES)),
  stage: Object.freeze([FILTER_PAGES.targets]),
  created_at: Object.freeze([FILTER_PAGES.corrections, FILTER_PAGES.proposals]),
  correction_status: Object.freeze([FILTER_PAGES.proposals]),
});
const PROPOSAL_STATUSES = new Set(['pending', 'approved', 'rejected']);
const COMMERCE_RESOLUTION_SOURCES = Object.freeze([
  Object.freeze({ entityType: 'rfq', table: 'crm_rfqs' }),
  Object.freeze({ entityType: 'quote', table: 'crm_quotes' }),
  Object.freeze({ entityType: 'order', table: 'crm_orders' }),
]);

function filterNotAuthorized() {
  const error = new Error('筛选条件未获授权');
  error.statusCode = 403;
  error.code = 'FILTER_NOT_AUTHORIZED';
  return error;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed === undefined ? fallback : parsed;
  } catch (_error) {
    return fallback;
  }
}

function nowText(value) {
  return String(value || new Date().toISOString().slice(0, 19).replace('T', ' '));
}

function installActivityCorrectionFilterCatalog(db, options = {}) {
  const at = nowText(options.now);
  return db.transaction(() => {
    const alreadyApplied = db.prepare(
      'SELECT 1 FROM filter_catalog_migrations WHERE migration_key=?',
    ).get(FILTER_MIGRATION_KEY);
    if (alreadyApplied) {
      return Number(db.prepare(
        'SELECT version FROM filter_permission_state WHERE id=1',
      ).get()?.version || 0);
    }

    const before = {
      pages: {},
      grants: db.prepare(`SELECT group_id FROM permission_group_filter_grants
        WHERE filter_key='correction_status' ORDER BY group_id`).all().map(row => row.group_id),
    };
    let changes = 0;
    for (const [filterKey, additions] of Object.entries(FILTER_PAGE_ADDITIONS)) {
      const row = db.prepare(
        'SELECT pages_json FROM filter_definitions WHERE filter_key=?',
      ).get(filterKey);
      if (!row) throw new Error(`missing activity correction filter definition: ${filterKey}`);
      const current = parseJson(row.pages_json, []);
      before.pages[filterKey] = current;
      const next = [...new Set([...current, ...additions])];
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        changes += db.prepare(`UPDATE filter_definitions
          SET pages_json=?,updated_at=? WHERE filter_key=?`)
          .run(JSON.stringify(next), at, filterKey).changes;
      }
    }

    const grant = db.prepare(`INSERT OR IGNORE INTO permission_group_filter_grants
      (group_id,filter_key,created_at,updated_at) VALUES (?,'correction_status',?,?)`);
    for (const group of db.prepare(`SELECT id,role_key,permissions_json FROM permission_groups
      WHERE role_key='manager' ORDER BY id`).all()) {
      if (!parseJson(group.permissions_json, {}).manage_activity_corrections) continue;
      changes += grant.run(group.id, at, at).changes;
    }

    db.prepare(`INSERT INTO filter_catalog_migrations(migration_key,applied_at)
      VALUES (?,?)`).run(FILTER_MIGRATION_KEY, at);
    if (!changes) {
      return Number(db.prepare(
        'SELECT version FROM filter_permission_state WHERE id=1',
      ).get()?.version || 0);
    }

    db.prepare(`UPDATE filter_permission_state
      SET version=version+1,updated_at=? WHERE id=1`).run(at);
    const version = Number(db.prepare(
      'SELECT version FROM filter_permission_state WHERE id=1',
    ).get()?.version || 0);
    const after = {
      pages: Object.fromEntries(Object.keys(FILTER_PAGE_ADDITIONS).map(filterKey => [
        filterKey,
        parseJson(db.prepare(
          'SELECT pages_json FROM filter_definitions WHERE filter_key=?',
        ).get(filterKey)?.pages_json, []),
      ])),
      grants: db.prepare(`SELECT group_id FROM permission_group_filter_grants
        WHERE filter_key='correction_status' ORDER BY group_id`).all().map(row => row.group_id),
    };
    db.prepare(`INSERT INTO filter_permission_audit
      (id,actor_id,target_type,target_id,action,before_json,after_json,note,version,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      `FPA-${crypto.randomUUID()}`,
      'system',
      'filter_catalog',
      'activity_corrections',
      'catalog_seeded',
      JSON.stringify(before),
      JSON.stringify(after),
      'Issue 171 activity correction filter page migration',
      version,
      at,
    );
    return version;
  }).immediate();
}

function pagination(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.max(
    1,
    Math.min(100, Number.parseInt(input.pageSize || input.page_size, 10) || 50),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function textFor(filter) {
  if (filter.operator !== 'contains' || typeof filter.value !== 'string') {
    throw filterNotAuthorized();
  }
  const value = filter.value.trim();
  if (!value || value.length > 120) throw filterNotAuthorized();
  return value;
}

function valuesFor(filter) {
  if (filter.operator !== 'in' || !Array.isArray(filter.values) || !filter.values.length) {
    throw filterNotAuthorized();
  }
  const values = [...new Set(filter.values.map(value => String(value).trim()).filter(Boolean))];
  if (!values.length || values.length > 50) throw filterNotAuthorized();
  return values;
}

function rangeFor(filter) {
  const from = String(filter.from || '');
  const to = String(filter.to || '');
  if (filter.operator !== 'between'
      || !/^\d{4}-\d{2}-\d{2}$/.test(from)
      || !/^\d{4}-\d{2}-\d{2}$/.test(to)
      || from > to) throw filterNotAuthorized();
  return { from: `${from} 00:00:00`, to: `${to} 23:59:59` };
}

function assertAst(ast, page, allowed) {
  if (!ast || ast.page !== page || !Array.isArray(ast.filters)) throw filterNotAuthorized();
  for (const filter of ast.filters) {
    if (!filter || typeof filter !== 'object' || !allowed.has(filter.key)) {
      throw filterNotAuthorized();
    }
  }
  return ast.filters;
}

function assertCorrectionReader(user) {
  if (!hasPermission(user, 'correct_own_activity')
      && !hasPermission(user, 'manage_activity_corrections')) throw filterNotAuthorized();
}

function assertCorrectionManager(user) {
  if (!['admin', 'manager'].includes(String(user?.role || ''))
      || !hasPermission(user, 'manage_activity_corrections')) throw filterNotAuthorized();
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function loadProposalMappingResolutions(db, rows) {
  const pending = rows.filter(row => String(row.status || '') === 'pending');
  if (!pending.length) return new Map();
  const columnsByTable = new Map([
    ['crm_activities', tableColumns(db, 'crm_activities')],
    ...COMMERCE_RESOLUTION_SOURCES.map(source => [source.table, tableColumns(db, source.table)]),
  ]);
  const activityColumns = columnsByTable.get('crm_activities');
  if (!['id', 'customer_id', 'activity_type'].every(column => activityColumns.has(column))) {
    return new Map(pending.map(row => [row.id, {
      required: true,
      available: false,
      evidence: { linkedCount: 0 },
      candidates: [],
    }]));
  }

  const activityIds = [...new Set(pending.map(row => String(row.original_activity_id || ''))
    .filter(Boolean))];
  const placeholders = activityIds.map(() => '?').join(',');
  const activities = activityIds.length
    ? db.prepare(`SELECT id,customer_id,activity_type FROM crm_activities
      WHERE id IN (${placeholders})`).all(...activityIds)
    : [];
  const activityById = new Map(activities.map(activity => [String(activity.id), activity]));
  const linkedByActivity = new Map();
  for (const source of COMMERCE_RESOLUTION_SOURCES) {
    const columns = columnsByTable.get(source.table);
    if (!activityIds.length || !columns.has('activity_id')) continue;
    const linkedRows = db.prepare(`SELECT
      ${columns.has('id') ? 'id' : "''"} id,
      ${columns.has('customer_id') ? 'customer_id' : "''"} customer_id,
      activity_id FROM ${source.table}
      WHERE activity_id IN (${placeholders}) ORDER BY activity_id,id`).all(...activityIds);
    for (const item of linkedRows) {
      const activityId = String(item.activity_id || '');
      const linked = linkedByActivity.get(activityId) || [];
      linked.push({
        entityType: source.entityType,
        entityId: String(item.id || ''),
        customerId: String(item.customer_id || ''),
      });
      linkedByActivity.set(activityId, linked);
    }
  }

  const supportedTypes = new Set(COMMERCE_RESOLUTION_SOURCES.map(source => source.entityType));
  const result = new Map();
  for (const proposal of pending) {
    const activityId = String(proposal.original_activity_id || '');
    const sourceCustomerId = String(proposal.source_customer_id || '');
    const activity = activityById.get(activityId);
    if (!activity || String(activity.customer_id || '') !== sourceCustomerId) {
      result.set(proposal.id, {
        required: true,
        available: false,
        evidence: { linkedCount: 0 },
        candidates: [],
      });
      continue;
    }
    const linked = linkedByActivity.get(activityId) || [];
    const expectedType = String(activity.activity_type || '') === 'repeat_order'
      ? 'order'
      : String(activity.activity_type || '');
    const mappingCertain = !supportedTypes.has(expectedType)
      ? linked.length === 0
      : linked.length === 1
        && linked[0].entityType === expectedType
        && Boolean(linked[0].entityId)
        && linked[0].customerId === sourceCustomerId;
    if (mappingCertain) continue;
    const scopedLinked = linked.filter(item => item.customerId === sourceCustomerId);
    result.set(proposal.id, {
      required: true,
      available: true,
      evidence: { linkedCount: scopedLinked.length },
      candidates: [
        { mode: 'activity_only' },
        ...scopedLinked.filter(item => item.entityType === expectedType && item.entityId).map(item => ({
          mode: 'commerce_entity',
          entityType: item.entityType,
          entityId: item.entityId,
        })),
      ],
    });
  }
  return result;
}

function addSearch(conditions, params, expressions, filter) {
  const like = `%${escapeLike(textFor(filter))}%`;
  conditions.push(`(${expressions.map(expression =>
    `LOWER(COALESCE(${expression},'')) LIKE LOWER(?) ESCAPE '\\'`).join(' OR ')})`);
  params.push(...expressions.map(() => like));
}

function addIn(conditions, params, expression, filter) {
  const values = valuesFor(filter);
  conditions.push(`${expression} IN (${values.map(() => '?').join(',')})`);
  params.push(...values);
}

function buildCorrectionTargetQuery(user, ast, input = {}) {
  assertCorrectionReader(user);
  const filters = assertAst(ast, FILTER_PAGES.targets, new Set(['search', 'stage']));
  const scope = accountScope(user, 'a');
  const conditions = [...scope.conditions];
  const params = [...scope.params];
  const excluded = String(input.excludeCustomerId || '').trim();
  if (excluded) {
    conditions.push('a.id!=?');
    params.push(excluded);
  }
  for (const filter of filters) {
    if (filter.key === 'search') {
      addSearch(conditions, params, [
        'a.id', 'a.external_customer_id', "COALESCE(p.nickname,a.nickname,'')",
        "COALESCE(NULLIF(p.company_name,''),a.company_name)",
      ], filter);
    } else if (filter.key === 'stage') {
      addIn(conditions, params, 'a.stage', filter);
    }
  }
  return {
    from: `FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id`,
    conditions,
    params,
    orderBy: `CASE WHEN TRIM(COALESCE(p.nickname,a.nickname,''))!='' THEN 0 ELSE 1 END,
      COALESCE(p.nickname,a.nickname,''),
      COALESCE(NULLIF(p.company_name,''),a.company_name),a.id`,
  };
}

function correctionFrom() {
  return `FROM crm_activity_corrections c
    JOIN crm_accounts source ON source.id=c.source_customer_id
    JOIN crm_accounts target ON target.id=c.target_customer_id
    LEFT JOIN customer_pool source_pool ON source_pool.customer_id=source.external_customer_id
    LEFT JOIN customer_pool target_pool ON target_pool.customer_id=target.external_customer_id`;
}

function buildActivityCorrectionQuery(user, ast) {
  assertCorrectionReader(user);
  const filters = assertAst(ast, FILTER_PAGES.corrections, new Set(['search', 'created_at']));
  const sourceScope = accountScope(user, 'source');
  const targetScope = accountScope(user, 'target');
  const conditions = [...sourceScope.conditions, ...targetScope.conditions];
  const params = [...sourceScope.params, ...targetScope.params];
  if (!hasPermission(user, 'manage_activity_corrections')) {
    conditions.push('c.actor_id=?');
    params.push(String(user?.id || ''));
  }
  for (const filter of filters) {
    if (filter.key === 'search') {
      addSearch(conditions, params, [
        'c.id', 'c.original_activity_id', 'c.replacement_activity_id', 'c.reason',
        'source.id', 'source.external_customer_id',
        "COALESCE(source_pool.nickname,source.nickname,'')",
        "COALESCE(NULLIF(source_pool.company_name,''),source.company_name)",
        'target.id', 'target.external_customer_id',
        "COALESCE(target_pool.nickname,target.nickname,'')",
        "COALESCE(NULLIF(target_pool.company_name,''),target.company_name)",
      ], filter);
    } else if (filter.key === 'created_at') {
      const range = rangeFor(filter);
      conditions.push('c.created_at BETWEEN ? AND ?');
      params.push(range.from, range.to);
    }
  }
  return { from: correctionFrom(), conditions, params, orderBy: 'c.created_at DESC,c.id DESC' };
}

function proposalFrom() {
  return `FROM crm_activity_correction_proposals p
    JOIN crm_accounts source ON source.id=p.source_customer_id
    JOIN crm_accounts target ON target.id=p.target_customer_id
    LEFT JOIN customer_pool source_pool ON source_pool.customer_id=source.external_customer_id
    LEFT JOIN customer_pool target_pool ON target_pool.customer_id=target.external_customer_id`;
}

function buildActivityCorrectionProposalQuery(user, ast) {
  assertCorrectionManager(user);
  const filters = assertAst(
    ast,
    FILTER_PAGES.proposals,
    new Set(['search', 'created_at', 'correction_status']),
  );
  const sourceScope = accountScope(user, 'source');
  const targetScope = accountScope(user, 'target');
  const conditions = [...sourceScope.conditions, ...targetScope.conditions];
  const params = [...sourceScope.params, ...targetScope.params];
  for (const filter of filters) {
    if (filter.key === 'search') {
      addSearch(conditions, params, [
        'p.id', 'p.original_activity_id', 'p.correction_id', 'p.reason',
        'source.id', 'source.external_customer_id',
        "COALESCE(source_pool.nickname,source.nickname,'')",
        "COALESCE(NULLIF(source_pool.company_name,''),source.company_name)",
        'target.id', 'target.external_customer_id',
        "COALESCE(target_pool.nickname,target.nickname,'')",
        "COALESCE(NULLIF(target_pool.company_name,''),target.company_name)",
      ], filter);
    } else if (filter.key === 'created_at') {
      const range = rangeFor(filter);
      conditions.push('p.created_at BETWEEN ? AND ?');
      params.push(range.from, range.to);
    } else if (filter.key === 'correction_status') {
      const values = valuesFor(filter);
      if (values.some(value => !PROPOSAL_STATUSES.has(value))) throw filterNotAuthorized();
      conditions.push(`p.status IN (${values.map(() => '?').join(',')})`);
      params.push(...values);
    }
  }
  return { from: proposalFrom(), conditions, params, orderBy: 'p.created_at DESC,p.id DESC' };
}

function countQuery(db, query) {
  return Number(db.prepare(`SELECT COUNT(*) total ${query.from}
    WHERE ${query.conditions.join(' AND ')}`).get(...query.params).total || 0);
}

function resultEnvelope(rows, pageInfo, total, authorizedTotal) {
  return {
    rows,
    ...pageInfo,
    total,
    authorizedTotal,
    hasMore: pageInfo.offset + rows.length < total,
  };
}

function queryCorrectionTargets(db, user, ast, input = {}) {
  const pageInfo = pagination(input);
  const query = buildCorrectionTargetQuery(user, ast, input);
  const unfiltered = buildCorrectionTargetQuery(
    user,
    { page: FILTER_PAGES.targets, filters: [] },
    input,
  );
  const total = countQuery(db, query);
  const authorizedTotal = countQuery(db, unfiltered);
  const rows = db.prepare(`SELECT a.id,a.external_customer_id,
      COALESCE(p.nickname,a.nickname,'') nickname,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,a.stage
    ${query.from} WHERE ${query.conditions.join(' AND ')}
    ORDER BY ${query.orderBy} LIMIT ? OFFSET ?`)
    .all(...query.params, pageInfo.pageSize, pageInfo.offset)
    .map(row => ({
      id: row.id,
      externalCustomerId: row.external_customer_id || '',
      nickname: row.nickname || '',
      companyName: row.company_name || '',
      stage: row.stage || '',
    }));
  return resultEnvelope(rows, pageInfo, total, authorizedTotal);
}

function correctionRow(row) {
  return {
    correctionId: row.id,
    originalActivityId: row.original_activity_id,
    replacementActivityId: row.replacement_activity_id,
    sourceCustomerId: row.source_customer_id,
    sourceExternalCustomerId: row.source_external_customer_id || '',
    sourceNickname: row.source_nickname || '',
    sourceCompanyName: row.source_company_name || '',
    targetCustomerId: row.target_customer_id,
    targetExternalCustomerId: row.target_external_customer_id || '',
    targetNickname: row.target_nickname || '',
    targetCompanyName: row.target_company_name || '',
    proposalId: row.proposal_id || '',
    milestoneType: row.milestone_type || '',
    milestoneSourceId: row.milestone_source_id || '',
    milestoneTargetId: row.milestone_target_id || '',
    actorId: row.actor_id,
    reviewerId: row.reviewer_id || '',
    reason: row.reason,
    status: row.status || 'completed',
    createdAt: row.created_at,
  };
}

function queryActivityCorrections(db, user, ast, input = {}) {
  const pageInfo = pagination(input);
  const query = buildActivityCorrectionQuery(user, ast);
  const unfiltered = buildActivityCorrectionQuery(
    user,
    { page: FILTER_PAGES.corrections, filters: [] },
  );
  const total = countQuery(db, query);
  const authorizedTotal = countQuery(db, unfiltered);
  const rows = db.prepare(`SELECT c.*,
      COALESCE(source_pool.nickname,source.nickname,'') source_nickname,
      COALESCE(NULLIF(source_pool.company_name,''),source.company_name) source_company_name,
      COALESCE(target_pool.nickname,target.nickname,'') target_nickname,
      COALESCE(NULLIF(target_pool.company_name,''),target.company_name) target_company_name
    ${query.from} WHERE ${query.conditions.join(' AND ')}
    ORDER BY ${query.orderBy} LIMIT ? OFFSET ?`)
    .all(...query.params, pageInfo.pageSize, pageInfo.offset).map(correctionRow);
  return resultEnvelope(rows, pageInfo, total, authorizedTotal);
}

function proposalRow(row, mappingResolution) {
  return {
    proposalId: row.id,
    status: row.status,
    version: Number(row.version),
    originalActivityId: row.original_activity_id,
    sourceCustomerId: row.source_customer_id,
    sourceExternalCustomerId: row.source_external_customer_id || '',
    sourceNickname: row.source_nickname || '',
    sourceCompanyName: row.source_company_name || '',
    targetCustomerId: row.target_customer_id,
    targetExternalCustomerId: row.target_external_customer_id || '',
    targetNickname: row.target_nickname || '',
    targetCompanyName: row.target_company_name || '',
    requesterId: row.requester_id,
    originalCreatorId: row.original_creator_id || '',
    reason: row.reason,
    reasonCode: row.reason_code,
    reviewerId: row.reviewer_id || '',
    reviewReason: row.review_reason || '',
    correctionId: row.correction_id || '',
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || '',
    ...(mappingResolution ? { mappingResolution } : {}),
  };
}

function queryActivityCorrectionProposals(db, user, ast, input = {}) {
  const pageInfo = pagination(input);
  const query = buildActivityCorrectionProposalQuery(user, ast);
  const unfiltered = buildActivityCorrectionProposalQuery(
    user,
    { page: FILTER_PAGES.proposals, filters: [] },
  );
  const total = countQuery(db, query);
  const authorizedTotal = countQuery(db, unfiltered);
  const rows = db.prepare(`SELECT p.*,
      COALESCE(source_pool.nickname,source.nickname,'') source_nickname,
      COALESCE(NULLIF(source_pool.company_name,''),source.company_name) source_company_name,
      COALESCE(target_pool.nickname,target.nickname,'') target_nickname,
      COALESCE(NULLIF(target_pool.company_name,''),target.company_name) target_company_name
    ${query.from} WHERE ${query.conditions.join(' AND ')}
    ORDER BY ${query.orderBy} LIMIT ? OFFSET ?`)
    .all(...query.params, pageInfo.pageSize, pageInfo.offset);
  const mappingResolutions = loadProposalMappingResolutions(db, rows);
  return resultEnvelope(rows.map(row => proposalRow(row, mappingResolutions.get(row.id))),
    pageInfo, total, authorizedTotal);
}

function activityCorrectionFilterOptions(db, user, page, authorizedFields, input = {}) {
  const keys = new Set((authorizedFields || []).map(field =>
    typeof field === 'string' ? field : field?.key).filter(Boolean));
  const options = Object.fromEntries([...keys].map(key => [key, []]));
  if (page === FILTER_PAGES.targets && keys.has('stage')) {
    const query = buildCorrectionTargetQuery(
      user,
      { page, filters: [] },
      input,
    );
    options.stage = db.prepare(`SELECT a.stage value,COUNT(*) count ${query.from}
      WHERE ${query.conditions.join(' AND ')} AND TRIM(COALESCE(a.stage,''))!=''
      GROUP BY a.stage ORDER BY a.stage`).all(...query.params).map(row => ({
      value: row.value,
      label: row.value,
      count: Number(row.count || 0),
    }));
  }
  if (page === FILTER_PAGES.proposals && keys.has('correction_status')) {
    const query = buildActivityCorrectionProposalQuery(user, { page, filters: [] });
    const labels = { pending: '待审批', approved: '已批准', rejected: '已拒绝' };
    options.correction_status = db.prepare(`SELECT p.status value,COUNT(*) count ${query.from}
      WHERE ${query.conditions.join(' AND ')} GROUP BY p.status ORDER BY p.status`)
      .all(...query.params).map(row => ({
        value: row.value,
        label: labels[row.value] || row.value,
        count: Number(row.count || 0),
      }));
  }
  return options;
}

module.exports = {
  FILTER_PAGES,
  activityCorrectionFilterOptions,
  buildActivityCorrectionProposalQuery,
  buildActivityCorrectionQuery,
  buildCorrectionTargetQuery,
  installActivityCorrectionFilterCatalog,
  queryActivityCorrectionProposals,
  queryActivityCorrections,
  queryCorrectionTargets,
};
