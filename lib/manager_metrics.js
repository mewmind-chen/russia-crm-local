'use strict';

const { accountScope } = require('./business_page_filters');
const { isActivePipelineStage } = require('./customer_stages');

const EFFECTIVE_ACTIVITY_TYPES = new Set([
  'email', 'call', 'social', 'reply', 'meeting', 'rfq', 'quote', 'order',
]);
const EFFECTIVE_ENTITY_KINDS = new Set(['rfq', 'quote', 'order']);
const CUSTOMER_TRIGGER_REASONS = new Set([
  'consecutive_deferred', 'first_contact_silence', 'planned_action_overdue',
]);
const SUBSTANTIVE_INTERVENTIONS = new Set([
  'plan_formed', 'terminal_stage', 'reassigned', 'manager_advice', 'escalate_owner',
]);

function metricError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function isEffectiveCustomerAction(row = {}) {
  const kind = String(row.kind || row.entityKind || row.entity_type || '').trim().toLowerCase();
  if (EFFECTIVE_ENTITY_KINDS.has(kind)) return true;
  const activityType = String(row.activityType || row.activity_type || '').trim().toLowerCase();
  return EFFECTIVE_ACTIVITY_TYPES.has(activityType);
}

function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  const text = String(value || '').trim();
  if (!text) return Number.NaN;
  const explicit = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text);
  return Date.parse(explicit ? text : `${text.replace(' ', 'T')}Z`);
}

function requiredNow(value) {
  const result = timestamp(value === undefined ? new Date() : value);
  if (!Number.isFinite(result)) {
    throw metricError('统计当前时间无效', 'MANAGER_METRICS_NOW_INVALID', 500);
  }
  return result;
}

function utcText(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

function hasTable(db, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table));
}

function scopedAccounts(db, user) {
  const scope = accountScope(user, 'a');
  return db.prepare(`SELECT a.* FROM crm_accounts a
    WHERE ${scope.conditions.join(' AND ')}`).all(...scope.params);
}

function accountMaps(accounts) {
  return {
    byId: new Map(accounts.map(row => [String(row.id), row])),
    byExternalId: new Map(accounts.map(row => [String(row.external_customer_id), row])),
  };
}

function scopedPlanEvents(db, user, table, type, nowMs) {
  if (!hasTable(db, table)) return [];
  const scope = accountScope(user, 'a');
  const rows = db.prepare(`SELECT e.*,a.id account_id,a.owner_id current_owner_id
    FROM ${table} e
    JOIN crm_accounts a ON a.external_customer_id=e.customer_id
    WHERE ${scope.conditions.join(' AND ')}`).all(...scope.params);
  return rows.map(row => ({
    ...row,
    type,
    createdMs: timestamp(row.created_at),
    nextAtMs: type === 'explicit' ? timestamp(row.next_action_at) : Number.NaN,
  })).filter(row => Number.isFinite(row.createdMs) && row.createdMs <= nowMs);
}

function scopedTasks(db, user, nowMs) {
  if (!hasTable(db, 'crm_manager_tasks')) return [];
  const scope = accountScope(user, 'a');
  return db.prepare(`SELECT t.*,a.id account_id,a.owner_id current_owner_id
    FROM crm_manager_tasks t
    JOIN crm_accounts a ON a.external_customer_id=t.customer_id
    WHERE ${scope.conditions.join(' AND ')}`).all(...scope.params)
    .map(row => ({ ...row, triggeredMs: timestamp(row.triggered_at) }))
    .filter(row => Number.isFinite(row.triggeredMs) && row.triggeredMs <= nowMs);
}

function scopedInterventions(db, user, nowMs) {
  if (!hasTable(db, 'crm_manager_interventions') || !hasTable(db, 'crm_manager_tasks')) return [];
  const scope = accountScope(user, 'a');
  return db.prepare(`SELECT i.*,t.customer_id,t.reason,t.owner_id_snapshot,
      a.id account_id,a.owner_id current_owner_id
    FROM crm_manager_interventions i
    JOIN crm_manager_tasks t ON t.id=i.task_id
    JOIN crm_accounts a ON a.external_customer_id=t.customer_id
    WHERE ${scope.conditions.join(' AND ')}`).all(...scope.params)
    .map(row => ({ ...row, createdMs: timestamp(row.created_at) }))
    .filter(row => Number.isFinite(row.createdMs) && row.createdMs <= nowMs);
}

function scopedActions(db, user, nowMs) {
  const scope = accountScope(user, 'a');
  const sources = [];
  if (hasTable(db, 'crm_activities')) {
    sources.push(...db.prepare(`SELECT x.*,a.external_customer_id
      FROM crm_activities x JOIN crm_accounts a ON a.id=x.customer_id
      WHERE ${scope.conditions.join(' AND ')}`).all(...scope.params).map(row => ({
      kind: 'activity',
      activityType: row.activity_type,
      accountId: row.customer_id,
      customerId: row.external_customer_id,
      occurredAt: row.occurred_at,
      occurredMs: timestamp(row.occurred_at),
    })));
  }
  for (const [table, kind, dateColumn] of [
    ['crm_rfqs', 'rfq', 'received_at'],
    ['crm_quotes', 'quote', 'sent_at'],
    ['crm_orders', 'order', 'ordered_at'],
  ]) {
    if (!hasTable(db, table)) continue;
    sources.push(...db.prepare(`SELECT x.*,a.external_customer_id
      FROM ${table} x JOIN crm_accounts a ON a.id=x.customer_id
      WHERE ${scope.conditions.join(' AND ')}`).all(...scope.params).map(row => {
      const occurredAt = row[dateColumn] || row.created_at;
      return {
        kind,
        accountId: row.customer_id,
        customerId: row.external_customer_id,
        occurredAt,
        occurredMs: timestamp(occurredAt),
      };
    }));
  }
  return sources.filter(row => isEffectiveCustomerAction(row)
    && Number.isFinite(row.occurredMs) && row.occurredMs <= nowMs);
}

function asPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizedSettings(settings = {}) {
  const rules = settings.rules || {};
  const salesAnomaly = settings.salesAnomaly || rules.salesAnomaly || {};
  const firstContactSilence = settings.firstContactSilence || rules.firstContactSilence || {};
  return {
    salesAnomaly: {
      enabled: salesAnomaly.enabled !== false,
      minActiveCustomers: asPositiveNumber(salesAnomaly.minActiveCustomers, 10),
      minAnomalousCustomers: asPositiveNumber(salesAnomaly.minAnomalousCustomers, 3),
      ratioPercent: asPositiveNumber(salesAnomaly.ratioPercent, 30),
    },
    firstContactSilence: {
      enabled: firstContactSilence.enabled !== false,
      value: asPositiveNumber(firstContactSilence.value, 14),
    },
  };
}

function percentage(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator) / Number(denominator)) * 10000) / 100;
}

function groupedBy(rows, keyFor) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(keyFor(row) || '');
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function salesUserIds(db, user, accounts, deferredEvents, tasks) {
  if (String(user?.role || '') === 'sales') return [String(user.id || '')].filter(Boolean);
  const visible = new Set([
    ...accounts.map(row => String(row.owner_id || '')),
    ...deferredEvents.map(row => String(row.actor_id || '')),
    ...tasks.map(row => String(row.owner_id_snapshot || row.current_owner_id || '')),
  ].filter(Boolean));
  if (!hasTable(db, 'sales_users')) return [...visible].sort();
  const activeSales = db.prepare(
    "SELECT id FROM sales_users WHERE role='sales' AND active=1 ORDER BY id",
  ).all().map(row => String(row.id));
  if (user?.permissions?.view_all_customers) return activeSales;
  return activeSales.filter(id => visible.has(id));
}

function planOutcomeSets(actorId, deferredWindow, explicitEvents, actions) {
  const cohorts = groupedBy(
    deferredWindow.filter(row => row.actor_id === actorId),
    row => row.customer_id,
  );
  const explicitByCustomer = groupedBy(explicitEvents, row => row.customer_id);
  const actionsByCustomer = groupedBy(actions, row => row.customerId);
  const planned = new Set();
  const actedOnTime = new Set();
  for (const [customerId, deferred] of cohorts) {
    const latestDeferredMs = Math.max(...deferred.map(row => row.createdMs));
    const plan = (explicitByCustomer.get(customerId) || [])
      .filter(row => row.createdMs > latestDeferredMs)
      .sort((left, right) => left.createdMs - right.createdMs)[0];
    if (!plan) continue;
    planned.add(customerId);
    const completed = (actionsByCustomer.get(customerId) || []).some(action => (
      action.occurredMs >= plan.createdMs && action.occurredMs <= plan.nextAtMs
    ));
    if (completed) actedOnTime.add(customerId);
  }
  return { cohorts: new Set(cohorts.keys()), planned, actedOnTime };
}

function firstTouchSilentByOwner(accounts, actions, startMs, nowMs, settings) {
  const result = new Map();
  if (!settings.firstContactSilence.enabled) return result;
  const byCustomer = groupedBy(actions, row => row.customerId);
  const thresholdMs = settings.firstContactSilence.value * 86400000;
  for (const account of accounts.filter(row => isActivePipelineStage(row.stage))) {
    const timeline = (byCustomer.get(String(account.external_customer_id)) || [])
      .sort((left, right) => left.occurredMs - right.occurredMs);
    if (timeline.length !== 1) continue;
    const first = timeline[0].occurredMs;
    if (first < startMs || first > nowMs || nowMs - first < thresholdMs) continue;
    const ownerId = String(account.owner_id || '');
    if (!result.has(ownerId)) result.set(ownerId, new Set());
    result.get(ownerId).add(String(account.external_customer_id));
  }
  return result;
}

function unimprovedByOwner(tasks, interventions, startMs, nowMs) {
  const result = new Map();
  const tasksByCustomerReason = groupedBy(tasks, row => `${row.customer_id}\u0000${row.reason}`);
  for (const intervention of interventions) {
    if (intervention.createdMs < startMs || intervention.createdMs > nowMs
        || !SUBSTANTIVE_INTERVENTIONS.has(String(intervention.action || ''))) continue;
    const recurred = (tasksByCustomerReason.get(`${intervention.customer_id}\u0000${intervention.reason}`) || [])
      .some(task => task.triggeredMs > intervention.createdMs);
    if (!recurred) continue;
    const ownerId = String(intervention.owner_id_snapshot || intervention.current_owner_id || '');
    if (!result.has(ownerId)) result.set(ownerId, new Set());
    result.get(ownerId).add(String(intervention.customer_id));
  }
  return result;
}

function unavailableFor(sampleSize, anomalyCustomers, anomalyRate, rule) {
  if (!rule.enabled) {
    return { code: 'MANAGER_REVIEW_THRESHOLDS_NOT_MET', reasons: ['sales_anomaly_rule_disabled'] };
  }
  const reasons = [];
  if (sampleSize < rule.minActiveCustomers) reasons.push('active_sample_below_minimum');
  if (anomalyCustomers < rule.minAnomalousCustomers) reasons.push('anomaly_customers_below_minimum');
  if (anomalyRate < rule.ratioPercent) reasons.push('anomaly_ratio_below_threshold');
  return reasons.length ? { code: 'MANAGER_REVIEW_THRESHOLDS_NOT_MET', reasons } : null;
}

function sumCounts(rows) {
  const result = {
    activeCustomers: 0,
    deferredRecords: 0,
    deferredCustomers: 0,
    thresholdCustomers: 0,
    plannedAfterDeferredCustomers: 0,
    onTimeActionCustomers: 0,
    firstTouchSilentCustomers: 0,
    unimprovedAfterInterventionCustomers: 0,
  };
  for (const row of rows) {
    for (const key of Object.keys(result)) result[key] += Number(row.counts[key] || 0);
  }
  return result;
}

function optionalIdSet(options, key) {
  if (!Object.hasOwn(options, key)) return null;
  return new Set((Array.isArray(options[key]) ? options[key] : [])
    .map(value => String(value || '').trim()).filter(Boolean));
}

function actorNames(db, actorIds) {
  if (!actorIds.length || !hasTable(db, 'sales_users')) return new Map();
  const placeholders = actorIds.map(() => '?').join(',');
  const hasName = db.prepare("PRAGMA table_info('sales_users')").all()
    .some(column => column.name === 'name');
  return new Map(db.prepare(`SELECT id,${hasName ? 'name' : 'id'} name
      FROM sales_users WHERE id IN (${placeholders})`)
    .all(...actorIds).map(row => [String(row.id), String(row.name || row.id)]));
}

function buildManagerMetrics(db, options = {}) {
  const rangeDays = Number(options.rangeDays);
  if (![30, 90].includes(rangeDays)) {
    throw metricError('统计周期只支持30天或90天', 'MANAGER_METRICS_RANGE_INVALID');
  }
  const user = options.user || {};
  const nowMs = requiredNow(options.now);
  const startMs = nowMs - rangeDays * 86400000;
  const settings = normalizedSettings(options.settings);
  const customerIds = optionalIdSet(options, 'customerIds');
  const taskIds = optionalIdSet(options, 'taskIds');
  const allowedActorIds = optionalIdSet(options, 'actorIds');
  const customerAllowed = row => customerIds === null
    || customerIds.has(String(row.external_customer_id || row.customer_id || row.customerId || ''));
  const accounts = scopedAccounts(db, user).filter(customerAllowed);
  const deferredEvents = scopedPlanEvents(
    db, user, 'crm_deferred_plan_events', 'deferred', nowMs,
  ).filter(customerAllowed);
  const explicitEvents = scopedPlanEvents(
    db, user, 'crm_next_plan_events', 'explicit', nowMs,
  ).filter(customerAllowed);
  const tasks = scopedTasks(db, user, nowMs).filter(row => customerAllowed(row)
    && (taskIds === null || taskIds.has(String(row.id || ''))));
  const interventions = scopedInterventions(db, user, nowMs).filter(row => customerAllowed(row)
    && (taskIds === null || taskIds.has(String(row.task_id || ''))));
  const actions = scopedActions(db, user, nowMs).filter(customerAllowed);
  const deferredWindow = deferredEvents.filter(row => row.createdMs >= startMs);
  const taskWindow = tasks.filter(row => row.triggeredMs >= startMs
    && CUSTOMER_TRIGGER_REASONS.has(String(row.reason || '')));
  const silentByOwner = firstTouchSilentByOwner(accounts, actions, startMs, nowMs, settings);
  const unimproved = unimprovedByOwner(tasks, interventions, startMs, nowMs);
  const actorIds = salesUserIds(db, user, accounts, deferredWindow, taskWindow)
    .filter(actorId => allowedActorIds === null || allowedActorIds.has(actorId));
  const names = actorNames(db, actorIds);

  const sales = actorIds.map(actorId => {
    const activeCustomers = new Set(accounts.filter(row => row.owner_id === actorId
      && isActivePipelineStage(row.stage)).map(row => String(row.external_customer_id)));
    const actorDeferred = deferredWindow.filter(row => row.actor_id === actorId);
    const deferredCustomers = new Set(actorDeferred.map(row => String(row.customer_id)));
    const thresholdCustomers = new Set(taskWindow.filter(row => (
      String(row.owner_id_snapshot || row.current_owner_id || '') === actorId
    )).map(row => String(row.customer_id)));
    const outcomes = planOutcomeSets(actorId, deferredWindow, explicitEvents, actions);
    const counts = {
      activeCustomers: activeCustomers.size,
      deferredRecords: actorDeferred.length,
      deferredCustomers: deferredCustomers.size,
      thresholdCustomers: thresholdCustomers.size,
      plannedAfterDeferredCustomers: outcomes.planned.size,
      onTimeActionCustomers: outcomes.actedOnTime.size,
      firstTouchSilentCustomers: silentByOwner.get(actorId)?.size || 0,
      unimprovedAfterInterventionCustomers: unimproved.get(actorId)?.size || 0,
    };
    const ratios = {
      deferredCustomerRate: percentage(counts.deferredCustomers, counts.activeCustomers),
      planFormationRate: percentage(
        counts.plannedAfterDeferredCustomers, counts.deferredCustomers,
      ),
      onTimeActionRate: percentage(
        counts.onTimeActionCustomers, counts.plannedAfterDeferredCustomers,
      ),
      anomalyCustomerRate: percentage(counts.thresholdCustomers, counts.activeCustomers),
    };
    const unavailable = unavailableFor(
      counts.activeCustomers,
      counts.thresholdCustomers,
      ratios.anomalyCustomerRate,
      settings.salesAnomaly,
    );
    return Object.freeze({
      actorId,
      actorName: names.get(actorId) || actorId,
      sampleSize: counts.activeCustomers,
      counts: Object.freeze(counts),
      ratios: Object.freeze(ratios),
      needsManagerReview: unavailable === null,
      unavailable,
    });
  }).sort((left, right) => left.actorId.localeCompare(right.actorId));

  const summaryCounts = sumCounts(sales);
  return Object.freeze({
    rangeDays,
    window: Object.freeze({ from: utcText(startMs), to: utcText(nowMs) }),
    summary: Object.freeze({
      sampleSize: summaryCounts.activeCustomers,
      counts: Object.freeze(summaryCounts),
      ratios: Object.freeze({
        deferredCustomerRate: percentage(
          summaryCounts.deferredCustomers, summaryCounts.activeCustomers,
        ),
        planFormationRate: percentage(
          summaryCounts.plannedAfterDeferredCustomers, summaryCounts.deferredCustomers,
        ),
        onTimeActionRate: percentage(
          summaryCounts.onTimeActionCustomers, summaryCounts.plannedAfterDeferredCustomers,
        ),
        anomalyCustomerRate: percentage(
          summaryCounts.thresholdCustomers, summaryCounts.activeCustomers,
        ),
      }),
      needsManagerReview: sales.some(row => row.needsManagerReview),
    }),
    sales: Object.freeze(sales),
  });
}

function buildCustomerPlanRisk(db, options = {}) {
  const user = options.user || {};
  const nowMs = requiredNow(options.now);
  const cleanCustomerId = String(options.customerId || '').trim();
  const scope = accountScope(user, 'a');
  const account = db.prepare(`SELECT a.* FROM crm_accounts a
    WHERE (a.id=? OR a.external_customer_id=?) AND ${scope.conditions.join(' AND ')}
    ORDER BY CASE WHEN a.external_customer_id=? THEN 0 ELSE 1 END LIMIT 1`)
    .get(cleanCustomerId, cleanCustomerId, ...scope.params, cleanCustomerId);
  if (!account) {
    throw metricError('客户不存在或无权访问', 'MANAGER_METRICS_CUSTOMER_NOT_FOUND', 404);
  }
  const stableId = String(account.external_customer_id || account.id);
  const deferred = hasTable(db, 'crm_deferred_plan_events')
    ? db.prepare(`SELECT * FROM crm_deferred_plan_events
      WHERE customer_id=? ORDER BY created_at,id`).all(stableId)
    : [];
  const explicit = hasTable(db, 'crm_next_plan_events')
    ? db.prepare(`SELECT * FROM crm_next_plan_events
      WHERE customer_id=? ORDER BY created_at,id`).all(stableId)
    : [];
  const events = [
    ...deferred.map(row => ({ ...row, type: 'deferred', createdMs: timestamp(row.created_at) })),
    ...explicit.map(row => ({ ...row, type: 'explicit', createdMs: timestamp(row.created_at) })),
  ].filter(row => Number.isFinite(row.createdMs) && row.createdMs <= nowMs)
    .sort((left, right) => left.createdMs - right.createdMs || left.id.localeCompare(right.id));
  let consecutive = 0;
  for (let index = events.length - 1; index >= 0 && events[index].type === 'deferred'; index -= 1) {
    consecutive += 1;
  }
  const chainStartMs = consecutive ? events[events.length - consecutive].createdMs : Number.NaN;
  let thresholdAt = '';
  if (consecutive && hasTable(db, 'crm_manager_tasks')) {
    const rows = db.prepare(`SELECT triggered_at FROM crm_manager_tasks
      WHERE customer_id=? AND reason='consecutive_deferred'
      ORDER BY triggered_at,id`).all(stableId);
    thresholdAt = rows.map(row => ({ value: row.triggered_at, at: timestamp(row.triggered_at) }))
      .find(row => Number.isFinite(row.at) && row.at >= chainStartMs && row.at <= nowMs)?.value || '';
  }
  return Object.freeze({
    customerId: stableId,
    accountId: String(account.id),
    currentOwnerId: String(account.owner_id || ''),
    state: events.at(-1)?.type || 'none',
    currentConsecutiveDeferredCount: consecutive,
    cumulativeDeferredCount: events.filter(row => row.type === 'deferred').length,
    unplannedDurationDays: consecutive
      ? Math.max(0, Math.floor((nowMs - chainStartMs) / 86400000))
      : 0,
    thresholdAt,
    history: Object.freeze(deferred.filter(row => timestamp(row.created_at) <= nowMs).map(row => Object.freeze({
      id: row.id,
      actorId: row.actor_id,
      ownerIdSnapshot: row.owner_id_snapshot,
      createdAt: row.created_at,
      reviewAt: row.review_at,
      reason: row.reason,
      source: row.source,
    }))),
  });
}

module.exports = {
  buildCustomerPlanRisk,
  buildManagerMetrics,
  isEffectiveCustomerAction,
};
