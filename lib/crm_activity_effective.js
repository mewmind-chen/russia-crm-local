'use strict';

const COMMERCE_ENTITIES = Object.freeze({
  rfq: 'crm_rfqs',
  quote: 'crm_quotes',
  order: 'crm_orders',
});

function assertDatabase(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('db must be a better-sqlite3 database');
  }
}

function requiredId(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function activityError(status, code, message) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code;
  return error;
}

function tableColumns(db, table) {
  assertDatabase(db);
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function normalizeAlias(alias) {
  const value = String(alias || '').trim();
  if (value && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new TypeError('activity table alias must be a SQL identifier');
  }
  return value;
}

function effectiveActivityCondition(alias = '') {
  const prefix = normalizeAlias(alias);
  return `${prefix ? `${prefix}.` : ''}superseded_at=''`;
}

function effectiveActivityWhereClause(db, alias = '') {
  return tableColumns(db, 'crm_activities').has('superseded_at')
    ? effectiveActivityCondition(alias)
    : '1=1';
}

function effectiveCommerceSql(db, entityType, aliases = {}) {
  assertDatabase(db);
  const table = COMMERCE_ENTITIES[String(entityType || '').trim().toLowerCase()];
  if (!table) throw new TypeError('entityType must be rfq, quote, or order');
  const commerceAlias = normalizeAlias(aliases.commerce || 'commerce');
  const activityAlias = normalizeAlias(aliases.activity || 'linked_activity');
  const commerceColumns = tableColumns(db, table);
  const activityColumns = tableColumns(db, 'crm_activities');
  if (!commerceColumns.has('activity_id') || !activityColumns.has('superseded_at')) {
    return Object.freeze({ join: '', condition: '1=1' });
  }
  return Object.freeze({
    join: `LEFT JOIN crm_activities ${activityAlias} ON ${activityAlias}.id=${commerceAlias}.activity_id`,
    condition: `(${commerceAlias}.activity_id='' OR ${activityAlias}.superseded_at='')`,
  });
}

function effectivePlanWhereClause(db, table, alias = '') {
  const allowedTables = new Set(['crm_deferred_plan_events', 'crm_next_plan_events']);
  if (!allowedTables.has(table)) throw new TypeError('unsupported plan event table');
  const prefix = normalizeAlias(alias);
  const columns = tableColumns(db, table);
  const activityColumns = tableColumns(db, 'crm_activities');
  if (!columns.has('source') || !columns.has('source_event_id')
      || !activityColumns.has('superseded_at')) return '1=1';
  const field = name => `${prefix ? `${prefix}.` : ''}${name}`;
  const gatedSources = ['activity'];
  const effectiveSources = [
    `(${field('source')}='activity' AND EXISTS (SELECT 1 FROM crm_activities source_activity `
      + `WHERE source_activity.id=${field('source_event_id')} AND source_activity.superseded_at=''))`,
  ];
  for (const [entityType, entityTable] of Object.entries(COMMERCE_ENTITIES)) {
    if (!tableColumns(db, entityTable).has('activity_id')) continue;
    gatedSources.push(entityType);
    effectiveSources.push(`(${field('source')}='${entityType}' AND EXISTS (`
      + `SELECT 1 FROM ${entityTable} source_entity `
      + 'LEFT JOIN crm_activities source_activity ON source_activity.id=source_entity.activity_id '
      + `WHERE source_entity.id=${field('source_event_id')} `
      + "AND (source_entity.activity_id='' OR source_activity.superseded_at='')))" );
  }
  return `(${field('source_event_id')}='' OR ${field('source')} NOT IN (`
    + `${gatedSources.map(source => `'${source}'`).join(',')}) OR ${effectiveSources.join(' OR ')})`;
}

function isEffectiveActivity(activity) {
  if (!activity || typeof activity !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(activity, 'superseded_at')) return true;
  return activity.superseded_at === '';
}

function compareActivity(left, right) {
  for (const field of ['occurred_at', 'created_at', 'id']) {
    const compared = String(left?.[field] || '').localeCompare(String(right?.[field] || ''));
    if (compared) return compared;
  }
  return 0;
}

function addActivityProvenance(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const byId = new Map(source
    .filter(row => row && String(row.id || ''))
    .map(row => [String(row.id), row]));
  const originalsByReplacement = new Map();

  for (const row of source) {
    const replacementId = String(row?.superseded_by || '');
    if (!replacementId) continue;
    const originals = originalsByReplacement.get(replacementId) || [];
    originals.push(row);
    originalsByReplacement.set(replacementId, originals);
  }
  for (const originals of originalsByReplacement.values()) originals.sort(compareActivity);

  return source.map(row => {
    const activityId = String(row?.id || '');
    const replacementId = String(row?.superseded_by || '');
    const originals = originalsByReplacement.get(activityId) || [];
    const original = originals[0] || null;
    const replacement = replacementId ? byId.get(replacementId) : null;
    let kind = 'standalone';
    if (replacementId) kind = 'superseded_original';
    else if (original) kind = 'replacement';

    return {
      ...row,
      provenance: {
        kind,
        originalActivityId: replacementId ? activityId : String(original?.id || activityId),
        replacementActivityId: replacementId ? replacementId : (original ? activityId : ''),
        originalCustomerId: replacementId
          ? String(row?.customer_id || '')
          : String(original?.customer_id || row?.customer_id || ''),
        replacementCustomerId: replacementId
          ? String(replacement?.customer_id || '')
          : String(row?.customer_id || ''),
        originalActivityIds: originals.length
          ? originals.map(item => String(item.id || ''))
          : (replacementId ? [activityId] : []),
      },
    };
  });
}

function relatedActivityRows(db, customerId, effectiveOnly) {
  assertDatabase(db);
  const selectedCustomerId = requiredId(customerId, 'customerId');
  const columns = tableColumns(db, 'crm_activities');
  if (!columns.has('id') || !columns.has('customer_id')) return [];
  const order = ['occurred_at', 'created_at', 'id']
    .map(column => columns.has(column) ? `COALESCE(a.${column},'')` : "''")
    .join(',');

  if (!columns.has('superseded_by')) {
    const condition = effectiveOnly ? effectiveActivityWhereClause(db, 'a') : '1=1';
    return db.prepare(`SELECT a.* FROM crm_activities a
      WHERE a.customer_id=? AND ${condition} ORDER BY ${order}`).all(selectedCustomerId);
  }

  const selectedCondition = effectiveOnly ? effectiveActivityWhereClause(db, 'selected') : '1=1';
  return db.prepare(`WITH selected AS (
      SELECT selected.id,selected.superseded_by FROM crm_activities selected
      WHERE selected.customer_id=? AND ${selectedCondition}
    )
    SELECT a.* FROM crm_activities a
    WHERE a.id IN (SELECT id FROM selected)
       OR a.id IN (SELECT superseded_by FROM selected WHERE superseded_by<>'')
       OR a.superseded_by IN (SELECT id FROM selected)
    ORDER BY ${order}`).all(selectedCustomerId);
}

function listEffectiveActivities(db, customerId) {
  const selectedCustomerId = requiredId(customerId, 'customerId');
  return addActivityProvenance(relatedActivityRows(db, selectedCustomerId, true))
    .filter(row => String(row.customer_id || '') === selectedCustomerId && isEffectiveActivity(row))
    .sort(compareActivity);
}

function listActivitiesWithProvenance(db, customerId) {
  const selectedCustomerId = requiredId(customerId, 'customerId');
  return addActivityProvenance(relatedActivityRows(db, selectedCustomerId, false))
    .filter(row => String(row.customer_id || '') === selectedCustomerId)
    .sort(compareActivity);
}

function linkCommerceActivity(db, input = {}) {
  assertDatabase(db);
  const activityId = requiredId(input.activityId, 'activityId');
  const entityType = String(input.entityType || '').trim().toLowerCase();
  const entityId = requiredId(input.entityId, 'entityId');
  const table = COMMERCE_ENTITIES[entityType];
  if (!table) {
    throw activityError(400, 'ACTIVITY_LINK_ENTITY_TYPE_INVALID', 'entityType must be rfq, quote, or order');
  }
  const activityColumns = tableColumns(db, 'crm_activities');
  const entityColumns = tableColumns(db, table);
  if (!activityColumns.has('id') || !activityColumns.has('customer_id')
      || !entityColumns.has('id') || !entityColumns.has('customer_id')
      || !entityColumns.has('activity_id')) {
    throw activityError(500, 'ACTIVITY_LINK_SCHEMA_MISSING', 'activity link schema is not installed');
  }

  const activity = db.prepare('SELECT id,customer_id FROM crm_activities WHERE id=?').get(activityId);
  if (!activity) throw activityError(404, 'ACTIVITY_LINK_ACTIVITY_NOT_FOUND', 'activity not found');
  const entity = db.prepare(`SELECT id,customer_id,activity_id FROM ${table} WHERE id=?`).get(entityId);
  if (!entity) throw activityError(404, 'ACTIVITY_LINK_ENTITY_NOT_FOUND', `${entityType} not found`);
  if (String(activity.customer_id || '') !== String(entity.customer_id || '')) {
    throw activityError(409, 'ACTIVITY_LINK_CUSTOMER_MISMATCH', 'activity and commerce entity belong to different customers');
  }

  const existingActivityId = String(entity.activity_id || '');
  if (existingActivityId && existingActivityId !== activityId) {
    throw activityError(409, 'ACTIVITY_LINK_CONFLICT', 'commerce entity is already linked to another activity');
  }
  let created = false;
  if (!existingActivityId) {
    const result = db.prepare(`UPDATE ${table} SET activity_id=? WHERE id=? AND activity_id=''`)
      .run(activityId, entityId);
    created = result.changes === 1;
    if (!created) {
      const current = db.prepare(`SELECT activity_id FROM ${table} WHERE id=?`).get(entityId);
      if (String(current?.activity_id || '') !== activityId) {
        throw activityError(409, 'ACTIVITY_LINK_CONFLICT', 'commerce entity is already linked to another activity');
      }
    }
  }

  return {
    activityId,
    entityType,
    entityId,
    customerId: String(activity.customer_id || ''),
    created,
  };
}

module.exports = {
  COMMERCE_ENTITIES,
  addActivityProvenance,
  effectiveActivityCondition,
  effectiveActivityWhereClause,
  effectiveCommerceSql,
  effectivePlanWhereClause,
  isEffectiveActivity,
  linkCommerceActivity,
  listActivitiesWithProvenance,
  listEffectiveActivities,
};
