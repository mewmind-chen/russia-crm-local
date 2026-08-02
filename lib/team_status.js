'use strict';

const crypto = require('node:crypto');
const {
  FILTER_PAGES,
  exportTeamStatusRows,
  filterTeamStatusRows,
  normalizeAuthorizedTeamStatusFilters,
  paginateTeamStatusRows,
  stableJson,
  teamStatusViewKey,
} = require('./team_status_filters');

const ENABLED_VALUES = new Set(['true', '1', 'on', 'yes']);
const DAY_MS = 86400000;
const INITIAL_CURSOR_DAYS = 30;
const EFFECTIVE_ACTIVITY_TYPES = new Set([
  'email', 'call', 'social', 'reply', 'meeting', 'manager_join',
  'rfq', 'quote', 'order', 'repeat_order',
]);
const EVENT_RELATIONS = new Set(['original', 'supplement', 'correction', 'revocation']);
const EVENT_STATUSES = new Set(['unresolved', 'resolved', 'escalated', 'revoked']);
const TEAM_RANGES = new Map([['7d', 7], ['30d', 30], [7, 7], [30, 30]]);

function teamStatusError(statusCode, message, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function teamStatusWritesEnabled(env = process.env) {
  return ENABLED_VALUES.has(String(env?.CRM_TEAM_STATUS_WRITES_ENABLED || '').trim().toLowerCase());
}

function assertWritesEnabled(options = {}) {
  if (!teamStatusWritesEnabled(options.env || process.env)) {
    throw teamStatusError(503, '团队协作补记功能尚未启用', 'TEAM_STATUS_WRITES_DISABLED');
  }
}

function requiredText(value, label, maxLength) {
  const result = String(value ?? '').trim();
  if (!result) throw teamStatusError(400, `${label}不能为空`, 'TEAM_STATUS_INPUT_REQUIRED');
  if (result.length > maxLength) {
    throw teamStatusError(400, `${label}过长`, 'TEAM_STATUS_INPUT_TOO_LONG');
  }
  return result;
}

function optionalText(value, maxLength) {
  const result = String(value ?? '').trim();
  if (result.length > maxLength) {
    throw teamStatusError(400, '输入内容过长', 'TEAM_STATUS_INPUT_TOO_LONG');
  }
  return result;
}

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed === undefined ? fallback : parsed;
  } catch (_error) {
    return fallback;
  }
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  const text = String(value || '').trim();
  if (!text) return Number.NaN;
  return Date.parse(/(?:z|[+-]\d{2}:?\d{2})$/i.test(text)
    ? text
    : `${text.replace(' ', 'T')}Z`);
}

function utcText(value) {
  const plain = String(value || '').trim();
  const plainMatch = plain.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/);
  if (plainMatch) return `${plainMatch[1]} ${plainMatch[2]}`;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw teamStatusError(400, '时间无效', 'TEAM_STATUS_TIME_INVALID');
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function databaseNow(db, options = {}) {
  if (options.now !== undefined) return utcText(options.now);
  return String(db.prepare(
    "SELECT strftime('%Y-%m-%d %H:%M:%S','now') value",
  ).get().value);
}

function runtimeOptions(input = {}, options = {}) {
  return {
    ...options,
    ...(options.now === undefined && input.now !== undefined ? { now: input.now } : {}),
    ...(options.faultAt === undefined && input.faultAt !== undefined ? { faultAt: input.faultAt } : {}),
    ...(options.permissionVersion === undefined && input.permissionVersion !== undefined
      ? { permissionVersion: input.permissionVersion }
      : {}),
  };
}

function hasTable(db, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table));
}

function tableColumns(db, table) {
  if (!hasTable(db, table)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function runImmediate(db, callback) {
  return db.transaction(callback).immediate();
}

function installTeamStatusSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_team_status_views (
      user_id TEXT NOT NULL CHECK(length(trim(user_id)) > 0),
      view_key TEXT NOT NULL CHECK(length(trim(view_key)) > 0),
      last_viewed_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,view_key)
    );
    CREATE INDEX IF NOT EXISTS crm_team_status_views_updated_idx
      ON crm_team_status_views(updated_at,user_id,view_key);

    CREATE TABLE IF NOT EXISTS crm_collaboration_events (
      id TEXT PRIMARY KEY,
      root_event_id TEXT NOT NULL CHECK(length(trim(root_event_id)) > 0),
      supersedes_event_id TEXT NOT NULL DEFAULT '',
      relation_type TEXT NOT NULL
        CHECK(relation_type IN ('original','supplement','correction','revocation')),
      idempotency_key TEXT NOT NULL UNIQUE CHECK(length(trim(idempotency_key)) > 0),
      request_hash TEXT NOT NULL CHECK(length(trim(request_hash)) > 0),
      sales_user_id TEXT NOT NULL CHECK(length(trim(sales_user_id)) > 0),
      customer_id TEXT NOT NULL DEFAULT '',
      problem TEXT NOT NULL DEFAULT '',
      suggestion TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      next_step TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'unresolved'
        CHECK(status IN ('unresolved','resolved','escalated','revoked')),
      actor_id TEXT NOT NULL CHECK(length(trim(actor_id)) > 0),
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source='manual'),
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_collaboration_events_scope_idx
      ON crm_collaboration_events(sales_user_id,customer_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS crm_collaboration_events_root_idx
      ON crm_collaboration_events(root_event_id,created_at,id);
    CREATE TRIGGER IF NOT EXISTS crm_collaboration_events_no_update
      BEFORE UPDATE ON crm_collaboration_events
      BEGIN SELECT RAISE(ABORT, 'crm_collaboration_events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS crm_collaboration_events_no_delete
      BEFORE DELETE ON crm_collaboration_events
      BEGIN SELECT RAISE(ABORT, 'crm_collaboration_events are immutable'); END;
  `);
}

function normalizeSet(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Set) return new Set([...value].map(item => String(item)));
  if (Array.isArray(value)) return new Set(value.map(item => String(item)));
  return null;
}

function fallbackScope(db, user) {
  const allAccounts = hasTable(db, 'crm_accounts') ? db.prepare('SELECT * FROM crm_accounts').all() : [];
  const full = String(user?.role || '') === 'admin'
    || Boolean(user?.permissions?.view_all_customers);
  const accounts = allAccounts.filter(row => full || String(row.owner_id || '') === String(user?.id || ''));
  let salesUserIds = new Set([String(user?.id || '')].filter(Boolean));
  if (full && hasTable(db, 'sales_users')) {
    salesUserIds = new Set(db.prepare(
      "SELECT id FROM sales_users WHERE role='sales' AND active=1 ORDER BY id",
    ).all().map(row => String(row.id)));
  } else if (String(user?.role || '') !== 'sales') {
    salesUserIds = new Set(accounts.map(row => String(row.owner_id || '')).filter(Boolean));
  }
  return {
    accounts,
    accountIds: new Set(accounts.map(row => String(row.id))),
    externalCustomerIds: new Set(accounts.map(row => String(row.external_customer_id || '')).filter(Boolean)),
    salesUserIds,
  };
}

function resolveScope(db, user, options = {}) {
  const callback = options.resolveScope || options.scopeForUser || options.scope;
  const injected = typeof callback === 'function' ? callback(db, user) : null;
  if (!injected) return fallbackScope(db, user);
  let accounts = Array.isArray(injected.accounts) ? injected.accounts : null;
  if (!accounts && hasTable(db, 'crm_accounts') && Array.isArray(injected.conditions)) {
    accounts = db.prepare(`SELECT * FROM crm_accounts a WHERE ${injected.conditions.join(' AND ')}`)
      .all(...(injected.params || []));
  }
  if (!accounts && hasTable(db, 'crm_accounts')) accounts = db.prepare('SELECT * FROM crm_accounts').all();
  accounts ||= [];
  const accountIds = normalizeSet(injected.accountIds)
    || new Set(accounts.map(row => String(row.id)));
  const externalCustomerIds = normalizeSet(injected.externalCustomerIds)
    || new Set(accounts.map(row => String(row.external_customer_id || '')).filter(Boolean));
  const salesUserIds = normalizeSet(injected.salesUserIds)
    || new Set(accounts.map(row => String(row.owner_id || '')).filter(Boolean));
  if (String(user?.role || '') === 'sales') {
    salesUserIds.clear();
    salesUserIds.add(String(user.id || ''));
  }
  return {
    ...injected,
    accounts: accounts.filter(row => accountIds.has(String(row.id))
      || externalCustomerIds.has(String(row.external_customer_id || ''))),
    accountIds,
    externalCustomerIds,
    salesUserIds,
  };
}

function customerInScope(scope, customerId) {
  const value = String(customerId || '');
  if (!value) return true;
  if (typeof scope.canAccessCustomer === 'function') return Boolean(scope.canAccessCustomer(value));
  return scope.accountIds.has(value) || scope.externalCustomerIds.has(value);
}

function salesUserInScope(scope, salesUserId) {
  if (typeof scope.canAccessSalesUser === 'function') {
    return Boolean(scope.canAccessSalesUser(String(salesUserId || '')));
  }
  return scope.salesUserIds.has(String(salesUserId || ''));
}

function canonicalCustomerId(scope, customerId) {
  const value = String(customerId || '').trim();
  if (!value) return '';
  const account = scope.accounts.find(row => String(row.id) === value
    || String(row.external_customer_id || '') === value);
  if (!account || !customerInScope(scope, value)) {
    throw teamStatusError(403, '无权访问协作记录或客户', 'TEAM_STATUS_FORBIDDEN');
  }
  return String(account.external_customer_id || account.id);
}

function assertTargetScope(db, user, target, options = {}) {
  const callback = options.assertScope || options.assertTargetScope;
  if (typeof callback === 'function') {
    callback(db, user, target);
    return;
  }
  const scope = resolveScope(db, user, options);
  if (!salesUserInScope(scope, target.salesUserId)
      || (target.customerId && !customerInScope(scope, target.customerId))) {
    throw teamStatusError(403, '无权访问协作记录或客户', 'TEAM_STATUS_FORBIDDEN');
  }
}

function assertWriter(user) {
  if (!['admin', 'manager'].includes(String(user?.role || ''))) {
    throw teamStatusError(403, '没有权限记录协作支持', 'TEAM_STATUS_FORBIDDEN');
  }
  if (user?.permissions
      && Object.prototype.hasOwnProperty.call(user.permissions, 'record_collaboration_support')
      && user.permissions.record_collaboration_support !== true) {
    throw teamStatusError(403, '没有权限记录协作支持', 'TEAM_STATUS_FORBIDDEN');
  }
}

function filterAst(user, input, page, options = {}) {
  const supplied = input?.filters;
  const ast = supplied && !Array.isArray(supplied) && Array.isArray(supplied.filters)
    ? supplied
    : { page, filters: Array.isArray(supplied) ? supplied : [] };
  return normalizeAuthorizedTeamStatusFilters(user, { ...ast, page }, {
    ...options,
    page,
  });
}

function rangeDays(range) {
  const normalized = typeof range === 'string' ? range.toLowerCase() : Number(range);
  const days = TEAM_RANGES.get(normalized);
  if (!days) throw teamStatusError(400, '统计周期只支持7天或30天', 'TEAM_STATUS_RANGE_INVALID');
  return days;
}

function effectiveActivityRows(db, scope, toMs) {
  if (!hasTable(db, 'crm_activities')) return [];
  const columns = tableColumns(db, 'crm_activities');
  const rows = db.prepare('SELECT * FROM crm_activities ORDER BY occurred_at,id').all();
  return rows.filter(row => scope.accountIds.has(String(row.customer_id || ''))
    && (!columns.has('superseded_at') || String(row.superseded_at || '') === '')
    && EFFECTIVE_ACTIVITY_TYPES.has(String(row.activity_type || '').toLowerCase()))
    .map(row => ({
      id: String(row.id),
      accountId: String(row.customer_id || ''),
      customerId: String(scope.accounts.find(account =>
        String(account.id) === String(row.customer_id || ''))?.external_customer_id || row.customer_id || ''),
      salesUserId: String(row.user_id || ''),
      occurredAt: String(row.occurred_at || row.created_at || ''),
      occurredMs: timestamp(row.occurred_at || row.created_at),
      kind: String(row.activity_type || ''),
    })).filter(row => Number.isFinite(row.occurredMs) && row.occurredMs <= toMs);
}

function planRows(db, table, type, scope, toMs) {
  if (!hasTable(db, table)) return [];
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY created_at,id`).all();
  return rows.filter(row => customerInScope(scope, row.customer_id))
    .map(row => ({
      id: String(row.id),
      customerId: String(row.customer_id || ''),
      salesUserId: String(row.actor_id || row.owner_id_snapshot || ''),
      occurredAt: String(row.created_at || ''),
      occurredMs: timestamp(row.created_at),
      nextActionAt: String(row.next_action_at || row.review_at || ''),
      kind: type,
    })).filter(row => Number.isFinite(row.occurredMs) && row.occurredMs <= toMs);
}

function managerTaskRows(db, scope, toMs) {
  if (!hasTable(db, 'crm_manager_tasks')) return [];
  return db.prepare('SELECT * FROM crm_manager_tasks ORDER BY triggered_at,id').all()
    .filter(row => customerInScope(scope, row.customer_id))
    .map(row => ({
      ...row,
      customerId: String(row.customer_id || ''),
      salesUserId: String(row.owner_id_snapshot || ''),
      taskStatus: String(row.status || ''),
      taskReason: String(row.reason || ''),
      kind: 'collaboration',
      occurredAt: String(row.triggered_at || row.created_at || ''),
      createdAt: String(row.triggered_at || row.created_at || ''),
      occurredMs: timestamp(row.triggered_at || row.created_at),
    })).filter(row => Number.isFinite(row.occurredMs) && row.occurredMs <= toMs);
}

function automaticCollaborationStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed' || normalized === 'resolved' || normalized === 'closed') {
    return 'resolved';
  }
  if (normalized === 'escalated') return 'escalated';
  return 'unresolved';
}

function percentage(numerator, denominator) {
  return denominator ? Math.round((Number(numerator) / Number(denominator)) * 10000) / 100 : 0;
}

function sampleInfo(size) {
  return {
    size: Number(size || 0),
    unavailable: size < 10 ? {
      code: 'INSUFFICIENT_SAMPLE', minimum: 10, actual: Number(size || 0),
    } : null,
  };
}

function progressCounts(accounts, activities, deferred, explicit, tasks, fromMs, toMs, includeFrom) {
  const inWindow = value => includeFrom ? value >= fromMs && value <= toMs : value > fromMs && value <= toMs;
  const active = accounts.filter(row => !['won', 'repeat', 'lost', 'disqualified']
    .includes(String(row.stage || '')));
  const activitiesWindow = activities.filter(row => inWindow(row.occurredMs));
  const deferredWindow = deferred.filter(row => inWindow(row.occurredMs));
  const explicitWindow = explicit.filter(row => inWindow(row.occurredMs));
  const activityCustomers = new Set(activitiesWindow.map(row => row.customerId));
  const deferredByCustomer = new Map();
  for (const row of deferredWindow) {
    deferredByCustomer.set(row.customerId, (deferredByCustomer.get(row.customerId) || 0) + 1);
  }
  const planCustomers = new Set(explicitWindow.map(row => row.customerId));
  const actionsAfterPlan = new Set();
  for (const plan of explicitWindow) {
    if (activities.some(row => row.customerId === plan.customerId
        && row.occurredMs > plan.occurredMs && row.occurredMs <= toMs)) {
      actionsAfterPlan.add(plan.customerId);
    }
  }
  const taskWindow = tasks.filter(row => inWindow(row.occurredMs));
  return {
    activeCustomers: active.length,
    progressedCustomers: activityCustomers.size,
    silentCustomers: active.filter(row => !activityCustomers.has(
      String(row.external_customer_id || row.id),
    )).length,
    deferredRecords: deferredWindow.length,
    deferredCustomers: deferredByCustomer.size,
    repeatedDeferredCustomers: [...deferredByCustomer.values()].filter(count => count > 1).length,
    plansFormedCustomers: planCustomers.size,
    actionsAfterPlanCustomers: actionsAfterPlan.size,
    openCollaborationItems: taskWindow.filter(row => ['open', 'overdue', 'escalated'].includes(row.status)).length,
    overdueManagerTasks: taskWindow.filter(row => row.status === 'overdue').length,
    escalatedManagerTasks: taskWindow.filter(row => row.status === 'escalated').length,
  };
}

function progressRatios(counts) {
  return {
    progressRate: percentage(counts.progressedCustomers, counts.activeCustomers),
    silenceRate: percentage(counts.silentCustomers, counts.activeCustomers),
    deferredRate: percentage(counts.deferredCustomers, counts.activeCustomers),
    planFormationRate: percentage(counts.plansFormedCustomers, counts.deferredCustomers),
    actionAfterPlanRate: percentage(counts.actionsAfterPlanCustomers, counts.plansFormedCustomers),
  };
}

function buildProgress(db, user, scope, window, normalizedFilters) {
  const fromMs = timestamp(window.fromExclusive);
  const toMs = timestamp(window.toInclusive);
  const activities = effectiveActivityRows(db, scope, toMs);
  const deferred = planRows(db, 'crm_deferred_plan_events', 'deferred', scope, toMs);
  const explicit = planRows(db, 'crm_next_plan_events', 'explicit', scope, toMs);
  const tasks = managerTaskRows(db, scope, toMs);
  const ownerFilters = normalizedFilters.filters.filter(filter => filter.key === 'owner')
    .flatMap(filter => filter.values || []);
  const accountFilters = normalizedFilters.filters.filter(filter => [
    'country', 'stage', 'customer_type', 'industry', 'priority',
  ].includes(filter.key));
  const searchFilters = normalizedFilters.filters.filter(filter => filter.key === 'search');
  const createdFilters = normalizedFilters.filters.filter(filter => filter.key === 'created_at');
  const taskFilters = normalizedFilters.filters.filter(filter => [
    'task_status', 'task_reason',
  ].includes(filter.key));
  const kindFilters = normalizedFilters.filters.filter(filter => filter.key === 'progress_kind');
  const inWindow = value => window.includeFrom === true
    ? value >= fromMs && value <= toMs
    : value > fromMs && value <= toMs;
  const filteredTasks = taskFilters.length
    ? filterTeamStatusRows(tasks, { filters: taskFilters })
    : tasks;
  const taskCustomers = new Set(filteredTasks.filter(row => inWindow(row.occurredMs))
    .map(row => row.customerId));
  const requestedKinds = new Set(kindFilters.flatMap(filter => filter.values || []));
  const activityCustomers = new Set(activities.filter(row => inWindow(row.occurredMs))
    .map(row => row.customerId));
  const deferredCustomers = new Set(deferred.filter(row => inWindow(row.occurredMs))
    .map(row => row.customerId));
  const plannedCustomers = new Set(explicit.filter(row => inWindow(row.occurredMs))
    .map(row => row.customerId));
  const actionAfterPlanCustomers = new Set(explicit.filter(plan => inWindow(plan.occurredMs)
    && activities.some(row => row.customerId === plan.customerId
      && row.occurredMs > plan.occurredMs && row.occurredMs <= toMs))
    .map(row => row.customerId));
  const matchesKind = account => {
    if (!requestedKinds.size) return true;
    const customerId = String(account.external_customer_id || account.id);
    const active = !['won', 'repeat', 'lost', 'disqualified'].includes(String(account.stage || ''));
    return (requestedKinds.has('progressed') && activityCustomers.has(customerId))
      || (requestedKinds.has('silent') && active && !activityCustomers.has(customerId))
      || (requestedKinds.has('deferred') && deferredCustomers.has(customerId))
      || (requestedKinds.has('planned') && plannedCustomers.has(customerId))
      || (requestedKinds.has('action_after_plan') && actionAfterPlanCustomers.has(customerId))
      || (requestedKinds.has('collaboration') && taskCustomers.has(customerId));
  };
  const accountAllowed = account => accountFilters.every(filter => {
    const property = {
      country: 'country', stage: 'stage', customer_type: 'customer_type',
      industry: 'industry', priority: 'priority',
    }[filter.key];
    return filter.operator === 'in' && filter.values.includes(String(account[property] || ''));
  }) && searchFilters.every(filter => [
    account.id, account.external_customer_id, account.company_name, account.website,
    account.country, account.stage, account.customer_type, account.industry,
    account.priority, account.owner_id,
  ].map(value => String(value || '').toLowerCase()).join('\n')
    .includes(String(filter.value || '').toLowerCase()))
    && createdFilters.every(filter => {
      const date = String(account.created_at || '').slice(0, 10);
      return date && date >= filter.from && date <= filter.to;
    })
    && (!taskFilters.length || taskCustomers.has(String(account.external_customer_id || account.id)))
    && matchesKind(account);
  const includeFrom = window.includeFrom === true;
  const salesIds = [...scope.salesUserIds].filter(id => !ownerFilters.length || ownerFilters.includes(id));
  const sales = salesIds.map(salesUserId => {
    const accounts = scope.accounts.filter(row => String(row.owner_id || '') === salesUserId
      && accountAllowed(row));
    const customerIds = new Set(accounts.map(row => String(row.external_customer_id || row.id)));
    const counts = progressCounts(
      accounts,
      activities.filter(row => customerIds.has(row.customerId)),
      deferred.filter(row => customerIds.has(row.customerId)),
      explicit.filter(row => customerIds.has(row.customerId)),
      filteredTasks.filter(row => customerIds.has(row.customerId)),
      fromMs,
      toMs,
      includeFrom,
    );
    return {
      salesUserId,
      counts,
      ratios: progressRatios(counts),
      sample: sampleInfo(counts.activeCustomers),
    };
  }).sort((left, right) => left.salesUserId.localeCompare(right.salesUserId));
  const accounts = scope.accounts.filter(row => !ownerFilters.length
    || ownerFilters.includes(String(row.owner_id || ''))).filter(accountAllowed);
  const allowedCustomers = new Set(accounts.map(row => String(row.external_customer_id || row.id)));
  const counts = progressCounts(
    accounts,
    activities.filter(row => allowedCustomers.has(row.customerId)),
    deferred.filter(row => allowedCustomers.has(row.customerId)),
    explicit.filter(row => allowedCustomers.has(row.customerId)),
    filteredTasks.filter(row => allowedCustomers.has(row.customerId)),
    fromMs,
    toMs,
    includeFrom,
  );
  const result = {
    counts,
    ratios: progressRatios(counts),
    sample: sampleInfo(counts.activeCustomers),
    sales,
    drilldown: {
      customers: accounts.map(account => {
        const customerId = String(account.external_customer_id || account.id);
        return {
          accountId: String(account.id || ''),
          customerId,
          companyName: String(account.company_name || ''),
          ownerId: String(account.owner_id || ''),
          country: String(account.country || ''),
          stage: String(account.stage || ''),
          progressed: activityCustomers.has(customerId),
          deferred: deferredCustomers.has(customerId),
          planned: plannedCustomers.has(customerId),
          actedAfterPlan: actionAfterPlanCustomers.has(customerId),
        };
      }),
      tasks: filteredTasks.filter(row => allowedCustomers.has(row.customerId) && inWindow(row.occurredMs))
        .map(row => ({
          taskId: String(row.id || ''),
          customerId: row.customerId,
          salesUserId: row.salesUserId,
          status: row.taskStatus,
          reason: row.taskReason,
          occurredAt: row.occurredAt,
        })),
      timeline: [
        ...activities.filter(row => allowedCustomers.has(row.customerId) && inWindow(row.occurredMs))
          .map(row => ({ eventId: row.id, customerId: row.customerId,
            salesUserId: row.salesUserId, kind: 'activity', detail: row.kind,
            occurredAt: row.occurredAt })),
        ...deferred.filter(row => allowedCustomers.has(row.customerId) && inWindow(row.occurredMs))
          .map(row => ({ eventId: row.id, customerId: row.customerId,
            salesUserId: row.salesUserId, kind: 'deferred_plan', detail: row.kind,
            occurredAt: row.occurredAt })),
        ...explicit.filter(row => allowedCustomers.has(row.customerId) && inWindow(row.occurredMs))
          .map(row => ({ eventId: row.id, customerId: row.customerId,
            salesUserId: row.salesUserId, kind: 'next_plan', detail: row.kind,
            occurredAt: row.occurredAt })),
        ...filteredTasks.filter(row => allowedCustomers.has(row.customerId) && inWindow(row.occurredMs))
          .map(row => ({ eventId: String(row.id || ''), customerId: row.customerId,
            salesUserId: row.salesUserId, kind: 'manager_task', detail: row.taskReason,
            status: row.taskStatus, occurredAt: row.occurredAt })),
      ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)
        || right.eventId.localeCompare(left.eventId)),
    },
  };
  Object.defineProperty(result, 'selectedAccounts', { value: accounts });
  return result;
}

function publicEventSnapshot(value, eventTarget) {
  const snapshot = parseJson(value, {});
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {};
  if (!Object.keys(snapshot).length) return {};
  if (String(snapshot.salesUserId || '') !== eventTarget.salesUserId
      || String(snapshot.customerId || '') !== eventTarget.customerId) return {};
  return Object.fromEntries([
    'salesUserId', 'customerId', 'problem', 'suggestion', 'outcome', 'nextStep', 'status',
  ].filter(key => Object.prototype.hasOwnProperty.call(snapshot, key))
    .map(key => [key, snapshot[key]]));
}

function publicManualEvent(row, deduplicated = false) {
  const eventTarget = {
    salesUserId: String(row.sales_user_id || ''),
    customerId: String(row.customer_id || ''),
  };
  return {
    eventId: String(row.id),
    rootEventId: String(row.root_event_id || row.id),
    supersedesEventId: String(row.supersedes_event_id || ''),
    relationType: String(row.relation_type || 'original'),
    ...eventTarget,
    problem: String(row.problem || ''),
    suggestion: String(row.suggestion || ''),
    outcome: String(row.outcome || ''),
    nextStep: String(row.next_step || ''),
    status: String(row.status || 'unresolved'),
    actorId: String(row.actor_id || ''),
    reason: String(row.reason || ''),
    source: 'manual',
    sourceType: 'manual_assistance',
    createdAt: String(row.created_at || ''),
    before: publicEventSnapshot(row.before_json, eventTarget),
    after: publicEventSnapshot(row.after_json, eventTarget),
    deduplicated,
  };
}

function effectiveManualEvents(rows) {
  const events = rows.map(row => publicManualEvent(row));
  const groups = new Map();
  for (const event of events) {
    if (!groups.has(event.rootEventId)) groups.set(event.rootEventId, []);
    groups.get(event.rootEventId).push(event);
  }
  return events.map(event => {
    const group = groups.get(event.rootEventId).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.eventId.localeCompare(right.eventId));
    const revisions = group.filter(item => ['original', 'correction', 'revocation'].includes(item.relationType));
    const current = revisions.at(-1);
    const replacement = group.find(item => item.supersedesEventId === event.eventId);
    return {
      ...event,
      effective: event.relationType === 'supplement'
        || (current?.eventId === event.eventId && event.relationType !== 'revocation'),
      supersededBy: replacement?.eventId || '',
      revoked: current?.relationType === 'revocation',
    };
  });
}

function automaticCollaborationRows(db, scope) {
  if (!hasTable(db, 'crm_manager_tasks')) return [];
  const tasks = db.prepare('SELECT * FROM crm_manager_tasks ORDER BY triggered_at,id').all()
    .filter(row => customerInScope(scope, row.customer_id)
      && salesUserInScope(scope, row.owner_id_snapshot || ''));
  const interventions = hasTable(db, 'crm_manager_interventions')
    ? db.prepare('SELECT * FROM crm_manager_interventions ORDER BY created_at,id').all()
    : [];
  const byTask = new Map();
  for (const row of interventions) {
    if (!byTask.has(String(row.task_id))) byTask.set(String(row.task_id), []);
    byTask.get(String(row.task_id)).push(row);
  }
  const result = [];
  for (const task of tasks) {
    const account = scope.accounts.find(row => String(row.external_customer_id || row.id)
      === String(task.customer_id || '')) || {};
    const accountFields = {
      country: String(account.country || ''),
      stage: String(account.stage || ''),
      customerType: String(account.customer_type || ''),
      industry: String(account.industry || ''),
      priority: String(account.priority || ''),
      taskStatus: String(task.status || ''),
      taskReason: String(task.reason || ''),
    };
    const rows = byTask.get(String(task.id)) || [];
    if (!rows.length) {
      result.push({
        eventId: `manager-task:${task.id}`,
        rootEventId: `manager-task:${task.id}`,
        supersedesEventId: '',
        relationType: 'system',
        salesUserId: String(task.owner_id_snapshot || ''),
        customerId: String(task.customer_id || ''),
        problem: String(task.reason || ''),
        suggestion: '', outcome: '', nextStep: '',
        status: automaticCollaborationStatus(task.status),
        actorId: String(task.actor_id_snapshot || 'system'),
        reason: '', source: 'system', sourceType: 'manager_task', sourceEventId: String(task.id),
        createdAt: String(task.triggered_at || task.created_at || ''), effective: true,
        ...accountFields,
      });
      continue;
    }
    for (const intervention of rows) {
      const resultJson = parseJson(intervention.result_json, {});
      result.push({
        eventId: `manager-intervention:${intervention.id}`,
        rootEventId: `manager-task:${task.id}`,
        supersedesEventId: '',
        relationType: 'system',
        salesUserId: String(task.owner_id_snapshot || ''),
        customerId: String(task.customer_id || ''),
        problem: String(task.reason || ''),
        suggestion: String(intervention.note || intervention.difficulty || intervention.action || ''),
        outcome: String(resultJson.outcome || (resultJson.completed ? 'completed' : '')),
        nextStep: String(resultJson.nextStep || ''),
        status: automaticCollaborationStatus(task.status),
        actorId: String(intervention.actor_id || 'system'),
        reason: '', source: 'system', sourceType: 'manager_intervention',
        sourceEventId: String(intervention.id),
        createdAt: String(intervention.created_at || ''), effective: true,
        ...accountFields,
      });
    }
  }
  return result;
}

function collaborationRows(db, user, input = {}, options = {}) {
  installTeamStatusSchema(db);
  const scope = resolveScope(db, user, options);
  const manual = effectiveManualEvents(db.prepare(
    'SELECT * FROM crm_collaboration_events ORDER BY created_at,id',
  ).all()).filter(row => salesUserInScope(scope, row.salesUserId)
    && customerInScope(scope, row.customerId)).map(row => {
    const account = scope.accounts.find(item => String(item.external_customer_id || item.id)
      === String(row.customerId || '')) || {};
    return {
      ...row,
      country: String(account.country || ''),
      stage: String(account.stage || ''),
      customerType: String(account.customer_type || ''),
      industry: String(account.industry || ''),
      priority: String(account.priority || ''),
      taskStatus: String(row.status || ''),
      taskReason: String(row.problem || ''),
    };
  });
  const automatic = automaticCollaborationRows(db, scope);
  const fromMs = input.from ? timestamp(input.from) : Number.NEGATIVE_INFINITY;
  const toMs = input.to ? timestamp(input.to) : Number.POSITIVE_INFINITY;
  const authorized = [...manual, ...automatic].filter(row => {
    const at = timestamp(row.createdAt);
    return Number.isFinite(at) && at > fromMs && at <= toMs;
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt)
    || right.eventId.localeCompare(left.eventId));
  const ast = filterAst(user, input, FILTER_PAGES.collaboration, options);
  return { authorized, filtered: filterTeamStatusRows(authorized, ast), ast };
}

function listCollaborationSupport(db, user, input = {}, options = {}) {
  const { authorized, filtered, ast } = collaborationRows(db, user, input, options);
  const result = paginateTeamStatusRows(filtered, input, authorized.length);
  return {
    ...result,
    filters: ast,
    writeEnabled: teamStatusWritesEnabled(options.env || process.env),
  };
}

function injectFault(options, point) {
  if (typeof options.faultAt === 'function') return options.faultAt(point);
  if (options.faultAt === point) {
    throw teamStatusError(500, `fault injected at ${point}`, 'TEAM_STATUS_FAULT_INJECTED');
  }
}

function buildWindowData(db, user, input, window, options = {}) {
  const scope = resolveScope(db, user, options);
  const ast = filterAst(user, input, FILTER_PAGES.progress, options);
  const progress = buildProgress(db, user, scope, window, ast);
  const capabilityAccounts = progress.selectedAccounts || [];
  const capabilityScope = {
    ...scope,
    accounts: capabilityAccounts,
    accountIds: new Set(capabilityAccounts.map(row => String(row.id || '')).filter(Boolean)),
    externalCustomerIds: new Set(capabilityAccounts
      .map(row => String(row.external_customer_id || '')).filter(Boolean)),
    salesUserIds: new Set(progress.sales.map(row => String(row.salesUserId || '')).filter(Boolean)),
  };
  const capability = buildCapability(
    db, user, capabilityScope, input, ast, window, options,
  );
  const collaboration = listCollaborationSupport(db, user, {
    filters: { page: FILTER_PAGES.collaboration, filters: [] },
    from: window.fromExclusive,
    to: window.toInclusive,
    page: 1,
    pageSize: 100,
  }, options);
  const sample = {
    size: progress.sample.size,
    status: progress.sample.unavailable ? 'insufficient' : 'available',
    fromExclusive: window.fromExclusive,
    toInclusive: window.toInclusive,
  };
  return {
    range: input.range || '30d',
    window,
    progress,
    capability,
    collaboration,
    sample,
    filters: ast,
    viewKey: teamStatusViewKey(user, ast, {
      permissionVersion: input.permissionVersion || options.permissionVersion,
    }),
    writeEnabled: teamStatusWritesEnabled(options.env || process.env),
  };
}

function capabilityInputs(db, scope) {
  const users = hasTable(db, 'sales_users')
    ? db.prepare("SELECT * FROM sales_users WHERE active=1 ORDER BY role,name,id").all()
      .filter(row => String(row.role || '') !== 'sales'
        || scope.salesUserIds.has(String(row.id || '')))
    : [];
  const accounts = scope.accounts;
  const accountIds = new Set(accounts.map(row => String(row.id)));
  const activities = hasTable(db, 'crm_activities')
    ? db.prepare('SELECT * FROM crm_activities ORDER BY occurred_at DESC,id').all()
      .filter(row => accountIds.has(String(row.customer_id || ''))
        && (!Object.prototype.hasOwnProperty.call(row, 'superseded_at')
          || String(row.superseded_at || '') === ''))
    : [];
  const tableRows = table => hasTable(db, table)
    ? db.prepare(`SELECT * FROM ${table}`).all()
      .filter(row => accountIds.has(String(row.customer_id || '')))
    : [];
  return {
    users,
    accounts,
    activities,
    rfqs: tableRows('crm_rfqs'),
    quotes: tableRows('crm_quotes'),
    orders: tableRows('crm_orders'),
  };
}

function buildCapability(db, user, scope, input, filters, window, options) {
  const values = capabilityInputs(db, scope);
  if (typeof options.buildTeamReport === 'function') {
    return options.buildTeamReport(
      values.users, values.accounts, values.activities, values.rfqs, values.quotes, values.orders,
    );
  }
  if (typeof options.buildCapability === 'function') {
    return options.buildCapability({ ...values, db, user, scope, range: input.range, filters, window });
  }
  // Lazy loading avoids a module cycle when sales_crm wires this service during startup.
  const existing = require('./sales_crm').buildTeamReport;
  return existing(
    values.users, values.accounts, values.activities, values.rfqs, values.quotes, values.orders,
  );
}

function buildTeamStatus(db, user, input = {}, options = {}) {
  const runtime = runtimeOptions(input, options);
  installTeamStatusSchema(db);
  const days = rangeDays(input.range || '30d');
  const toInclusive = databaseNow(db, runtime);
  const fromExclusive = utcText(timestamp(toInclusive) - days * DAY_MS);
  return buildWindowData(db, user, input, {
    fromExclusive, toInclusive, includeFrom: true,
  }, runtime);
}

function rejectClientCursor(input = {}) {
  const forbidden = [
    'fromExclusive', 'toInclusive', 'lastViewedAt', 'cursor', 'cursorTime',
  ];
  if (forbidden.some(key => Object.prototype.hasOwnProperty.call(input, key))) {
    throw teamStatusError(400, '游标由服务端管理', 'TEAM_STATUS_CURSOR_SERVER_MANAGED');
  }
}

function readTeamStatusSinceLastView(db, user, input = {}, options = {}) {
  rejectClientCursor(input);
  const runtime = runtimeOptions(input, options);
  installTeamStatusSchema(db);
  return runImmediate(db, () => {
    const toInclusive = databaseNow(db, runtime);
    const ast = filterAst(user, input, FILTER_PAGES.progress, runtime);
    const computedViewKey = teamStatusViewKey(user, ast, {
      permissionVersion: input.permissionVersion || runtime.permissionVersion,
    });
    const viewKey = input.viewKey === undefined
      ? computedViewKey
      : requiredText(input.viewKey, '视图标识', 240);
    const current = db.prepare(`SELECT * FROM crm_team_status_views
      WHERE user_id=? AND view_key=?`).get(String(user?.id || ''), viewKey);
    const initialFrom = utcText(timestamp(toInclusive) - INITIAL_CURSOR_DAYS * DAY_MS);
    const fromExclusive = current?.last_viewed_at || initialFrom;
    if (timestamp(fromExclusive) > timestamp(toInclusive)) {
      throw teamStatusError(409, '团队状态游标晚于统计上界', 'TEAM_STATUS_CURSOR_INVALID');
    }
    const data = buildWindowData(
      db, user, { ...input, range: 'since-last-view' },
      { fromExclusive, toInclusive }, runtime,
    );
    injectFault(runtime, 'afterAggregate');
    injectFault(runtime, 'beforeCursor');
    let version;
    if (!current) {
      db.prepare(`INSERT INTO crm_team_status_views
        (user_id,view_key,last_viewed_at,version,updated_at) VALUES (?,?,?,1,?)`)
        .run(String(user?.id || ''), viewKey, toInclusive, toInclusive);
      version = 1;
    } else {
      const changed = db.prepare(`UPDATE crm_team_status_views
        SET last_viewed_at=?,version=version+1,updated_at=?
        WHERE user_id=? AND view_key=? AND version=?`).run(
        toInclusive,
        toInclusive,
        String(user?.id || ''),
        viewKey,
        Number(current.version),
      );
      if (changed.changes !== 1) {
        throw teamStatusError(409, '团队状态游标已变化', 'TEAM_STATUS_CURSOR_CONFLICT');
      }
      version = Number(current.version) + 1;
    }
    return {
      fromExclusive,
      toInclusive,
      data,
      cursor: { viewKey, lastViewedAt: toInclusive, version },
      deduplicated: false,
    };
  });
}

function writeSpec(user, payload, relationType, base = null) {
  if (base && ((payload.salesUserId !== undefined
      && String(payload.salesUserId) !== String(base.salesUserId))
    || (payload.customerId !== undefined
      && String(payload.customerId) !== String(base.customerId)))) {
    throw teamStatusError(400, '协作记录归属不可修改', 'TEAM_STATUS_TARGET_IMMUTABLE');
  }
  const salesUserId = requiredText(payload.salesUserId ?? base?.salesUserId, '销售', 160);
  const problem = optionalText(payload.problem ?? base?.problem, 2000);
  const suggestion = optionalText(payload.suggestion ?? payload.advice ?? base?.suggestion, 2000);
  const outcome = optionalText(payload.outcome ?? payload.result ?? base?.outcome, 2000);
  const nextStep = optionalText(payload.nextStep ?? base?.nextStep, 2000);
  if (relationType === 'original' && !problem) {
    throw teamStatusError(400, '问题不能为空', 'TEAM_STATUS_INPUT_REQUIRED');
  }
  const status = String(payload.status ?? base?.status ?? 'unresolved').trim();
  if (!EVENT_STATUSES.has(status) || (relationType !== 'revocation' && status === 'revoked')) {
    throw teamStatusError(400, '协作状态无效', 'TEAM_STATUS_STATUS_INVALID');
  }
  const reason = relationType === 'original'
    ? optionalText(payload.reason, 2000)
    : requiredText(payload.reason, '操作原因', 2000);
  const idempotencyKey = requiredText(payload.idempotencyKey, '幂等键', 240);
  return {
    relationType,
    salesUserId,
    customerId: optionalText(payload.customerId ?? base?.customerId, 160),
    problem,
    suggestion,
    outcome,
    nextStep,
    status: relationType === 'revocation' ? 'revoked' : status,
    actorId: requiredText(user?.id, '操作人', 160),
    reason,
    idempotencyKey,
  };
}

function auditCallback(options = {}) {
  return options.audit || options.recordAudit || options.auditCallback;
}

function emitAudit(db, user, action, event, before, options = {}) {
  const callback = auditCallback(options);
  const auditDetail = {
    eventId: event.eventId,
    rootEventId: event.rootEventId,
    relationType: event.relationType,
    salesUserId: event.salesUserId,
    customerId: event.customerId,
    status: event.status,
    source: event.source,
    supersedesEventId: event.supersedesEventId,
  };
  const payload = {
    user,
    action,
    entityType: 'collaboration_event',
    entityId: event.eventId,
    actorId: String(user?.id || ''),
    reason: '',
    before: {},
    after: auditDetail,
    detail: auditDetail,
    createdAt: event.createdAt,
  };
  if (typeof callback === 'function') {
    if (callback.length <= 1) callback(payload);
    else if (callback.length === 2) callback(db, payload);
    else callback(db, user, payload);
    return;
  }
  if (!hasTable(db, 'crm_audit_log')) {
    throw teamStatusError(500, '审计表未安装', 'TEAM_STATUS_AUDIT_UNAVAILABLE');
  }
  const columns = tableColumns(db, 'crm_audit_log');
  const values = {
    id: `AUD-${crypto.randomUUID()}`,
    user_id: String(user?.id || ''),
    action,
    entity_type: 'collaboration_event',
    entity_id: event.eventId,
    detail_json: JSON.stringify(auditDetail),
    created_at: event.createdAt,
    real_user_id: String(options.auditIdentity?.realUserId || user?.id || ''),
    effective_user_id: String(options.auditIdentity?.effectiveUserId || user?.id || ''),
    impersonation_context_id: String(options.auditIdentity?.contextId || ''),
  };
  const selected = Object.keys(values).filter(column => columns.has(column));
  db.prepare(`INSERT INTO crm_audit_log (${selected.join(',')})
    VALUES (${selected.map(() => '?').join(',')})`).run(...selected.map(column => values[column]));
}

function eventReplay(db, spec, action) {
  const row = db.prepare('SELECT * FROM crm_collaboration_events WHERE idempotency_key=?')
    .get(spec.idempotencyKey);
  if (!row) return null;
  const requestHash = digest({ action, ...spec, idempotencyKey: undefined });
  if (String(row.actor_id) !== spec.actorId || String(row.request_hash) !== requestHash) {
    throw teamStatusError(409, '幂等键已绑定其他协作操作', 'TEAM_STATUS_IDEMPOTENCY_CONFLICT');
  }
  return publicManualEvent(row, true);
}

function insertEvent(db, user, spec, relation, action, before, options = {}) {
  const replay = eventReplay(db, spec, action);
  if (replay) return replay;
  const at = databaseNow(db, options);
  const id = `COLL-${crypto.randomUUID()}`;
  const rootEventId = relation.rootEventId || id;
  const after = {
    salesUserId: spec.salesUserId,
    customerId: spec.customerId,
    problem: spec.problem,
    suggestion: spec.suggestion,
    outcome: spec.outcome,
    nextStep: spec.nextStep,
    status: spec.status,
  };
  const requestHash = digest({ action, ...spec, idempotencyKey: undefined });
  db.prepare(`INSERT INTO crm_collaboration_events
    (id,root_event_id,supersedes_event_id,relation_type,idempotency_key,request_hash,
     sales_user_id,customer_id,problem,suggestion,outcome,next_step,status,actor_id,
     reason,source,before_json,after_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'manual',?,?,?)`).run(
    id,
    rootEventId,
    relation.supersedesEventId || '',
    spec.relationType,
    spec.idempotencyKey,
    requestHash,
    spec.salesUserId,
    spec.customerId,
    spec.problem,
    spec.suggestion,
    spec.outcome,
    spec.nextStep,
    spec.status,
    spec.actorId,
    spec.reason,
    JSON.stringify(before || {}),
    JSON.stringify(after),
    at,
  );
  const event = publicManualEvent(db.prepare(
    'SELECT * FROM crm_collaboration_events WHERE id=?',
  ).get(id), false);
  emitAudit(db, user, action, event, before, options);
  injectFault(options, 'afterAudit');
  return event;
}

function recordExternalAssistance(db, user, payload = {}, options = {}) {
  assertWritesEnabled(options);
  assertWriter(user);
  installTeamStatusSchema(db);
  return runImmediate(db, () => {
    const spec = writeSpec(user, payload, 'original');
    const scope = resolveScope(db, user, options);
    spec.customerId = canonicalCustomerId(scope, spec.customerId);
    assertTargetScope(db, user, spec, options);
    return insertEvent(db, user, spec, {}, 'collaboration_recorded', {}, options);
  });
}

function eventForAppend(db, user, eventId, options = {}) {
  const row = db.prepare('SELECT * FROM crm_collaboration_events WHERE id=?').get(String(eventId || ''));
  if (!row) throw teamStatusError(403, '无权访问协作记录或客户', 'TEAM_STATUS_FORBIDDEN');
  const event = publicManualEvent(row);
  assertTargetScope(db, user, event, options);
  const rootRows = db.prepare(`SELECT * FROM crm_collaboration_events
    WHERE root_event_id=? ORDER BY created_at,id`).all(event.rootEventId).map(item => publicManualEvent(item));
  const current = rootRows.filter(item => ['original', 'correction', 'revocation'].includes(item.relationType)).at(-1);
  if (current?.relationType === 'revocation') {
    throw teamStatusError(409, '协作记录已经撤销', 'TEAM_STATUS_EVENT_REVOKED');
  }
  return { selected: event, current: current || event };
}

function appendEvent(db, user, eventId, payload, relationType, action, options) {
  assertWritesEnabled(options);
  assertWriter(user);
  installTeamStatusSchema(db);
  return runImmediate(db, () => {
    const { selected, current } = eventForAppend(db, user, eventId, options);
    const spec = writeSpec(user, payload, relationType, current);
    const scope = resolveScope(db, user, options);
    spec.customerId = canonicalCustomerId(scope, spec.customerId);
    assertTargetScope(db, user, spec, options);
    if (relationType === 'supplement') {
      const changed = ['problem', 'suggestion', 'outcome', 'nextStep'].some(key =>
        Object.prototype.hasOwnProperty.call(payload, key)
        && String(spec[key] || '') !== String(current[key] || ''));
      if (!changed) {
        throw teamStatusError(400, '补充内容不能为空', 'TEAM_STATUS_SUPPLEMENT_REQUIRED');
      }
    }
    if (relationType === 'correction') {
      const changed = ['salesUserId', 'customerId', 'problem', 'suggestion', 'outcome', 'nextStep', 'status']
        .some(key => String(spec[key] || '') !== String(current[key] || ''));
      if (!changed) {
        throw teamStatusError(409, '更正内容没有变化', 'TEAM_STATUS_CORRECTION_UNCHANGED');
      }
    }
    return insertEvent(db, user, spec, {
      rootEventId: selected.rootEventId,
      supersedesEventId: relationType === 'supplement' ? selected.eventId : current.eventId,
    }, action, current, options);
  });
}

function supplementCollaborationEvent(db, user, eventId, payload = {}, options = {}) {
  return appendEvent(
    db, user, eventId, payload, 'supplement', 'collaboration_supplemented', options,
  );
}

function correctCollaborationEvent(db, user, eventId, payload = {}, options = {}) {
  return appendEvent(
    db, user, eventId, payload, 'correction', 'collaboration_corrected', options,
  );
}

function revokeCollaborationEvent(db, user, eventId, payload = {}, options = {}) {
  return appendEvent(
    db, user, eventId, payload, 'revocation', 'collaboration_revoked', options,
  );
}

function exportTeamStatus(db, user, input = {}, options = {}) {
  installTeamStatusSchema(db);
  const section = String(input.section || 'progress').toLowerCase();
  if (!['progress', 'capability', 'collaboration'].includes(section)) {
    throw teamStatusError(400, '导出栏目无效', 'TEAM_STATUS_EXPORT_SECTION_INVALID');
  }
  let rows;
  if (section === 'collaboration') {
    const { filtered } = collaborationRows(db, user, input, options);
    rows = filtered;
  } else {
    const data = buildTeamStatus(db, user, input, options);
    rows = section === 'capability'
      ? (Array.isArray(data.capability) ? data.capability : [data.capability])
      : [
          { scope: 'summary', ...data.progress.counts, ...data.progress.ratios,
            sampleSize: data.progress.sample.size,
            unavailable: data.progress.sample.unavailable },
          ...data.progress.sales.map(row => ({
            scope: 'sales', salesUserId: row.salesUserId,
            ...row.counts, ...row.ratios,
            sampleSize: row.sample.size, unavailable: row.sample.unavailable,
          })),
        ];
  }
  const exported = exportTeamStatusRows(rows, {
    format: input.format || 'json',
    includeAI: options.includeAI === true,
  });
  return {
    ...exported,
    section,
    filename: `crm-team-status-${section}.${exported.format}`,
  };
}

module.exports = {
  buildTeamStatus,
  correctCollaborationEvent,
  exportTeamStatus,
  installTeamStatusSchema,
  listCollaborationSupport,
  readTeamStatusSinceLastView,
  recordExternalAssistance,
  revokeCollaborationEvent,
  supplementCollaborationEvent,
  teamStatusWritesEnabled,
};
