'use strict';

const crypto = require('node:crypto');
const { effectiveActivityWhereClause, effectivePlanWhereClause } = require('./crm_activity_effective');

const DEFAULT_MANAGER_TASK_SETTINGS = Object.freeze({
  consecutiveDeferredEnabled: true,
  consecutiveDeferredCount: 3,
  firstContactSilenceEnabled: true,
  firstContactSilenceDays: 14,
  plannedActionOverdueEnabled: true,
  plannedActionOverdueHours: 48,
  salesAnomalyEnabled: true,
  minActiveCustomers: 10,
  minAnomalousCustomers: 3,
  anomalyRatioPercent: 30,
  recipientIds: Object.freeze([]),
});

const ACTIVE_STATUSES = Object.freeze(['open', 'overdue', 'escalated']);
const TASK_STATUSES = new Set([...ACTIVE_STATUSES, 'completed']);
const TASK_REASONS = new Set([
  'consecutive_deferred',
  'first_contact_silence',
  'planned_action_overdue',
  'manager_assistance',
]);
const EFFECTIVE_CUSTOMER_ACTIVITY_TYPES = new Set([
  'email', 'call', 'social', 'reply', 'meeting', 'rfq', 'quote', 'order',
]);
const RESOLUTION_TYPES = new Set([
  'plan_formed',
  'terminal_stage',
  'reassigned',
  'manager_advice',
  'escalate_owner',
]);

const MANAGER_TASK_COLUMNS = [
  'id', 'idempotency_key', 'customer_id', 'reason', 'status', 'actor_id_snapshot',
  'owner_id_snapshot', 'recipient_ids_json', 'evidence_json', 'completion_condition',
  'settings_version', 'threshold_snapshot_json', 'evaluated_at', 'triggered_at', 'due_at',
  'result_json', 'resolved_by', 'resolved_at', 'escalated_by', 'escalated_at', 'created_at',
  'updated_at',
];

function managerTaskTableSql(tableName) {
  return `CREATE TABLE ${tableName} (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL CHECK(length(trim(customer_id)) > 0),
    reason TEXT NOT NULL CHECK(reason IN (
      'consecutive_deferred','first_contact_silence','planned_action_overdue','manager_assistance'
    )),
    status TEXT NOT NULL DEFAULT 'open'
      CHECK(status IN ('open','completed','overdue','escalated')),
    actor_id_snapshot TEXT NOT NULL DEFAULT '',
    owner_id_snapshot TEXT NOT NULL DEFAULT '',
    recipient_ids_json TEXT NOT NULL DEFAULT '[]',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    completion_condition TEXT NOT NULL,
    settings_version INTEGER NOT NULL CHECK(settings_version >= 1),
    threshold_snapshot_json TEXT NOT NULL,
    evaluated_at TEXT NOT NULL,
    triggered_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    result_json TEXT NOT NULL DEFAULT '{}',
    resolved_by TEXT NOT NULL DEFAULT '',
    resolved_at TEXT NOT NULL DEFAULT '',
    escalated_by TEXT NOT NULL DEFAULT '',
    escalated_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
}

function migrateManagerTaskSchema(db) {
  const taskSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='crm_manager_tasks'").get()?.sql || '';
  if (!taskSql || taskSql.includes('manager_assistance')) return;
  const foreignKeysEnabled = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(managerTaskTableSql('crm_manager_tasks_new'));
      db.exec(`INSERT INTO crm_manager_tasks_new (${MANAGER_TASK_COLUMNS.join(',')})
        SELECT ${MANAGER_TASK_COLUMNS.join(',')} FROM crm_manager_tasks`);
      db.exec('DROP TABLE crm_manager_tasks');
      db.exec('ALTER TABLE crm_manager_tasks_new RENAME TO crm_manager_tasks');
    })();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
  }
}

function managerTaskError(message, code, statusCode = 400, metadata = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.defineProperty(error, 'internalMetadata', {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ ...metadata }),
    writable: false,
  });
  return error;
}

function parsedDate(value, code = 'MANAGER_TASK_TIME_INVALID') {
  let date;
  if (value === undefined || value === null) {
    date = new Date();
  } else if (value instanceof Date) {
    date = new Date(value.getTime());
  } else {
    const text = String(value).trim();
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(text)
      ? `${text.replace(' ', 'T')}Z`
      : text;
    date = new Date(normalized);
  }
  if (!Number.isFinite(date.getTime())) {
    throw managerTaskError('时间格式无效', code);
  }
  return date;
}

function utcText(value) {
  return parsedDate(value).toISOString().slice(0, 19).replace('T', ' ');
}

function dbTime(value) {
  const text = String(value || '').trim();
  if (!text) return Number.NaN;
  return Date.parse(`${text.replace(' ', 'T')}Z`);
}

function addHours(value, hours) {
  return utcText(new Date(parsedDate(value).getTime() + Number(hours) * 3600000));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function json(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed === null ? fallback : parsed;
  } catch (_error) {
    return fallback;
  }
}

function requiredText(value, label, code, maxLength = 240) {
  const text = String(value ?? '').trim();
  if (!text) throw managerTaskError(`${label}不能为空`, code);
  if (text.length > maxLength) throw managerTaskError(`${label}过长`, `${code}_TOO_LONG`);
  return text;
}

function installManagerTaskSchema(db) {
  migrateManagerTaskSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_manager_task_settings (
      id TEXT PRIMARY KEY CHECK(id='default'),
      version INTEGER NOT NULL CHECK(version >= 1),
      consecutive_deferred_enabled INTEGER NOT NULL CHECK(consecutive_deferred_enabled IN (0,1)),
      consecutive_deferred_count INTEGER NOT NULL CHECK(consecutive_deferred_count >= 1),
      first_contact_silence_enabled INTEGER NOT NULL CHECK(first_contact_silence_enabled IN (0,1)),
      first_contact_silence_days INTEGER NOT NULL CHECK(first_contact_silence_days >= 1),
      planned_action_overdue_enabled INTEGER NOT NULL CHECK(planned_action_overdue_enabled IN (0,1)),
      planned_action_overdue_hours INTEGER NOT NULL CHECK(planned_action_overdue_hours >= 1),
      sales_anomaly_enabled INTEGER NOT NULL CHECK(sales_anomaly_enabled IN (0,1)),
      min_active_customers INTEGER NOT NULL CHECK(min_active_customers >= 1),
      min_anomalous_customers INTEGER NOT NULL CHECK(min_anomalous_customers >= 1),
      anomaly_ratio_percent REAL NOT NULL CHECK(anomaly_ratio_percent > 0 AND anomaly_ratio_percent <= 100),
      recipient_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crm_manager_task_settings_audit (
      id TEXT PRIMARY KEY,
      settings_version INTEGER NOT NULL UNIQUE,
      actor_id TEXT NOT NULL,
      previous_json TEXT NOT NULL,
      next_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crm_manager_tasks (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL CHECK(length(trim(customer_id)) > 0),
      reason TEXT NOT NULL CHECK(reason IN (
        'consecutive_deferred','first_contact_silence','planned_action_overdue','manager_assistance'
      )),
      status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open','completed','overdue','escalated')),
      actor_id_snapshot TEXT NOT NULL DEFAULT '',
      owner_id_snapshot TEXT NOT NULL DEFAULT '',
      recipient_ids_json TEXT NOT NULL DEFAULT '[]',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      completion_condition TEXT NOT NULL,
      settings_version INTEGER NOT NULL CHECK(settings_version >= 1),
      threshold_snapshot_json TEXT NOT NULL,
      evaluated_at TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      due_at TEXT NOT NULL,
      result_json TEXT NOT NULL DEFAULT '{}',
      resolved_by TEXT NOT NULL DEFAULT '',
      resolved_at TEXT NOT NULL DEFAULT '',
      escalated_by TEXT NOT NULL DEFAULT '',
      escalated_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crm_manager_tasks_active_reason_idx
      ON crm_manager_tasks(customer_id,reason)
      WHERE status IN ('open','overdue','escalated');
    CREATE INDEX IF NOT EXISTS crm_manager_tasks_status_due_idx
      ON crm_manager_tasks(status,due_at,triggered_at,id);
    CREATE INDEX IF NOT EXISTS crm_manager_tasks_customer_idx
      ON crm_manager_tasks(customer_id,triggered_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS crm_manager_interventions (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      task_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN (
        'plan_formed','terminal_stage','reassigned','manager_advice',
        'escalate_owner','marked_overdue'
      )),
      note TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT '',
      request_hash TEXT NOT NULL DEFAULT '',
      business_change_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES crm_manager_tasks(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_manager_interventions_task_idx
      ON crm_manager_interventions(task_id,created_at,id);
    CREATE TRIGGER IF NOT EXISTS crm_manager_task_settings_audit_no_update
      BEFORE UPDATE ON crm_manager_task_settings_audit
      BEGIN SELECT RAISE(ABORT, 'crm_manager_task_settings_audit is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS crm_manager_task_settings_audit_no_delete
      BEFORE DELETE ON crm_manager_task_settings_audit
      BEGIN SELECT RAISE(ABORT, 'crm_manager_task_settings_audit is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS crm_manager_interventions_no_update
      BEFORE UPDATE ON crm_manager_interventions
      BEGIN SELECT RAISE(ABORT, 'crm_manager_interventions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS crm_manager_interventions_no_delete
      BEFORE DELETE ON crm_manager_interventions
      BEGIN SELECT RAISE(ABORT, 'crm_manager_interventions are immutable'); END;
  `);
  const interventionColumns = new Set(
    db.prepare('PRAGMA table_info(crm_manager_interventions)').all().map(row => row.name),
  );
  if (!interventionColumns.has('request_hash')) {
    db.exec("ALTER TABLE crm_manager_interventions ADD COLUMN request_hash TEXT NOT NULL DEFAULT ''");
  }
  db.prepare(`INSERT OR IGNORE INTO crm_manager_task_settings
    (id,version,consecutive_deferred_enabled,consecutive_deferred_count,
     first_contact_silence_enabled,first_contact_silence_days,
     planned_action_overdue_enabled,planned_action_overdue_hours,
     sales_anomaly_enabled,min_active_customers,min_anomalous_customers,
     anomaly_ratio_percent,recipient_ids_json,updated_by,updated_at)
    VALUES ('default',1,?,?,?,?,?,?,?,?,?,?,'[]','system',?)`).run(
    DEFAULT_MANAGER_TASK_SETTINGS.consecutiveDeferredEnabled ? 1 : 0,
    DEFAULT_MANAGER_TASK_SETTINGS.consecutiveDeferredCount,
    DEFAULT_MANAGER_TASK_SETTINGS.firstContactSilenceEnabled ? 1 : 0,
    DEFAULT_MANAGER_TASK_SETTINGS.firstContactSilenceDays,
    DEFAULT_MANAGER_TASK_SETTINGS.plannedActionOverdueEnabled ? 1 : 0,
    DEFAULT_MANAGER_TASK_SETTINGS.plannedActionOverdueHours,
    DEFAULT_MANAGER_TASK_SETTINGS.salesAnomalyEnabled ? 1 : 0,
    DEFAULT_MANAGER_TASK_SETTINGS.minActiveCustomers,
    DEFAULT_MANAGER_TASK_SETTINGS.minAnomalousCustomers,
    DEFAULT_MANAGER_TASK_SETTINGS.anomalyRatioPercent,
    utcText(),
  );
}

function settingsView(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    version: row.version,
    rules: Object.freeze({
      consecutiveDeferred: Object.freeze({
        enabled: Boolean(row.consecutive_deferred_enabled),
        value: row.consecutive_deferred_count,
      }),
      firstContactSilence: Object.freeze({
        enabled: Boolean(row.first_contact_silence_enabled),
        value: row.first_contact_silence_days,
      }),
      plannedActionOverdue: Object.freeze({
        enabled: Boolean(row.planned_action_overdue_enabled),
        value: row.planned_action_overdue_hours,
      }),
      salesAnomaly: Object.freeze({
        enabled: Boolean(row.sales_anomaly_enabled),
        minActiveCustomers: row.min_active_customers,
        minAnomalousCustomers: row.min_anomalous_customers,
        ratioPercent: row.anomaly_ratio_percent,
      }),
    }),
    recipientIds: Object.freeze(json(row.recipient_ids_json, []).map(String)),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  });
}

function getManagerTaskSettings(db) {
  installManagerTaskSchema(db);
  return settingsView(db.prepare("SELECT * FROM crm_manager_task_settings WHERE id='default'").get());
}

function booleanValue(value, current) {
  if (value === undefined) return current;
  if (typeof value !== 'boolean') {
    throw managerTaskError('规则启停值无效', 'MANAGER_SETTINGS_INVALID');
  }
  return value;
}

function integerValue(value, current, min, max = 100000) {
  if (value === undefined) return current;
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < min || selected > max) {
    throw managerTaskError('主管提醒阈值无效', 'MANAGER_SETTINGS_INVALID');
  }
  return selected;
}

function ratioValue(value, current) {
  if (value === undefined) return current;
  const selected = Number(value);
  if (!Number.isFinite(selected) || selected <= 0 || selected > 100) {
    throw managerTaskError('主管提醒比例无效', 'MANAGER_SETTINGS_INVALID');
  }
  return selected;
}

function recipientIds(value, current) {
  if (value === undefined) return current;
  if (!Array.isArray(value)) {
    throw managerTaskError('提醒接收人格式无效', 'MANAGER_SETTINGS_INVALID');
  }
  const selected = [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].sort();
  if (selected.length > 100 || selected.some(item => item.length > 120)) {
    throw managerTaskError('提醒接收人格式无效', 'MANAGER_SETTINGS_INVALID');
  }
  return selected;
}

function normalizedSettingsPatch(current, patch = {}) {
  const deferred = patch.consecutiveDeferred || {};
  const silence = patch.firstContactSilence || {};
  const overdue = patch.plannedActionOverdue || {};
  const anomaly = patch.salesAnomaly || {};
  const next = {
    version: current.version + 1,
    consecutiveDeferredEnabled: booleanValue(
      deferred.enabled, current.rules.consecutiveDeferred.enabled,
    ),
    consecutiveDeferredCount: integerValue(
      deferred.value, current.rules.consecutiveDeferred.value, 1, 1000,
    ),
    firstContactSilenceEnabled: booleanValue(
      silence.enabled, current.rules.firstContactSilence.enabled,
    ),
    firstContactSilenceDays: integerValue(
      silence.value, current.rules.firstContactSilence.value, 1, 3650,
    ),
    plannedActionOverdueEnabled: booleanValue(
      overdue.enabled, current.rules.plannedActionOverdue.enabled,
    ),
    plannedActionOverdueHours: integerValue(
      overdue.value, current.rules.plannedActionOverdue.value, 1, 87600,
    ),
    salesAnomalyEnabled: booleanValue(anomaly.enabled, current.rules.salesAnomaly.enabled),
    minActiveCustomers: integerValue(
      anomaly.minActiveCustomers, current.rules.salesAnomaly.minActiveCustomers, 1, 100000,
    ),
    minAnomalousCustomers: integerValue(
      anomaly.minAnomalousCustomers, current.rules.salesAnomaly.minAnomalousCustomers, 1, 100000,
    ),
    anomalyRatioPercent: ratioValue(
      anomaly.ratioPercent, current.rules.salesAnomaly.ratioPercent,
    ),
    recipientIds: recipientIds(patch.recipientIds, current.recipientIds),
  };
  if (next.minAnomalousCustomers > next.minActiveCustomers) {
    throw managerTaskError('异常客户最低数量不能超过活跃客户样本', 'MANAGER_SETTINGS_INVALID');
  }
  return next;
}

function settingsSnapshot(settings) {
  return Object.freeze({
    consecutiveDeferredCount: settings.rules.consecutiveDeferred.value,
    firstContactSilenceDays: settings.rules.firstContactSilence.value,
    plannedActionOverdueHours: settings.rules.plannedActionOverdue.value,
    minActiveCustomers: settings.rules.salesAnomaly.minActiveCustomers,
    minAnomalousCustomers: settings.rules.salesAnomaly.minAnomalousCustomers,
    anomalyRatioPercent: settings.rules.salesAnomaly.ratioPercent,
  });
}

function runImmediate(db, operation) {
  return db.inTransaction ? operation() : db.transaction(operation).immediate();
}

function updateManagerTaskSettings(db, input = {}) {
  installManagerTaskSchema(db);
  const actorId = requiredText(input.actorId, '操作人', 'MANAGER_SETTINGS_ACTOR_REQUIRED', 120);
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw managerTaskError('设置版本无效', 'MANAGER_SETTINGS_VERSION_REQUIRED');
  }
  const at = utcText(input.now);
  return runImmediate(db, () => {
    const current = getManagerTaskSettings(db);
    if (current.version !== expectedVersion) {
      throw managerTaskError(
        '主管提醒设置已被其他管理员修改',
        'MANAGER_SETTINGS_VERSION_CONFLICT',
        409,
        { expectedVersion, actualVersion: current.version },
      );
    }
    const next = normalizedSettingsPatch(current, input.patch || {});
    const updated = db.prepare(`UPDATE crm_manager_task_settings SET
      version=?,consecutive_deferred_enabled=?,consecutive_deferred_count=?,
      first_contact_silence_enabled=?,first_contact_silence_days=?,
      planned_action_overdue_enabled=?,planned_action_overdue_hours=?,
      sales_anomaly_enabled=?,min_active_customers=?,min_anomalous_customers=?,
      anomaly_ratio_percent=?,recipient_ids_json=?,updated_by=?,updated_at=?
      WHERE id='default' AND version=?`).run(
      next.version,
      next.consecutiveDeferredEnabled ? 1 : 0,
      next.consecutiveDeferredCount,
      next.firstContactSilenceEnabled ? 1 : 0,
      next.firstContactSilenceDays,
      next.plannedActionOverdueEnabled ? 1 : 0,
      next.plannedActionOverdueHours,
      next.salesAnomalyEnabled ? 1 : 0,
      next.minActiveCustomers,
      next.minAnomalousCustomers,
      next.anomalyRatioPercent,
      JSON.stringify(next.recipientIds),
      actorId,
      at,
      current.version,
    );
    if (updated.changes !== 1) {
      throw managerTaskError('主管提醒设置已被其他管理员修改', 'MANAGER_SETTINGS_VERSION_CONFLICT', 409);
    }
    const result = getManagerTaskSettings(db);
    db.prepare(`INSERT INTO crm_manager_task_settings_audit
      (id,settings_version,actor_id,previous_json,next_json,created_at)
      VALUES (?,?,?,?,?,?)`).run(
      `MTSA-${crypto.randomUUID()}`,
      result.version,
      actorId,
      JSON.stringify(current),
      JSON.stringify(result),
      at,
    );
    return result;
  });
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

function accountForCustomer(db, customerId) {
  if (!hasTable(db, 'crm_accounts')) return null;
  const columns = tableColumns(db, 'crm_accounts');
  const select = ['id'];
  for (const column of ['external_customer_id', 'owner_id', 'stage', 'created_at']) {
    select.push(columns.has(column) ? column : `'' ${column}`);
  }
  if (columns.has('external_customer_id')) {
    return db.prepare(`SELECT ${select.join(',')} FROM crm_accounts
      WHERE external_customer_id=? OR id=?
      ORDER BY CASE WHEN external_customer_id=? THEN 0 ELSE 1 END LIMIT 1`)
      .get(customerId, customerId, customerId);
  }
  return db.prepare(`SELECT ${select.join(',')} FROM crm_accounts WHERE id=?`).get(customerId);
}

function latestPlanState(db, customerId) {
  if (!hasTable(db, 'crm_deferred_plan_events') || !hasTable(db, 'crm_next_plan_events')) {
    return { events: [], latest: null, consecutiveDeferred: 0 };
  }
  const events = db.prepare(`SELECT 'deferred' type,id,customer_id,actor_id,
      owner_id_snapshot,review_at event_at,'' next_action_at,created_at
    FROM crm_deferred_plan_events d WHERE customer_id=?
      AND ${effectivePlanWhereClause(db, 'crm_deferred_plan_events', 'd')}
    UNION ALL
    SELECT 'explicit' type,id,customer_id,actor_id,
      owner_id_snapshot,'' event_at,next_action_at,created_at
    FROM crm_next_plan_events e WHERE customer_id=?
      AND ${effectivePlanWhereClause(db, 'crm_next_plan_events', 'e')}
    ORDER BY created_at,id`).all(customerId, customerId);
  let consecutiveDeferred = 0;
  for (let index = events.length - 1;
    index >= 0 && events[index].type === 'deferred'; index -= 1) {
    consecutiveDeferred += 1;
  }
  return { events, latest: events.at(-1) || null, consecutiveDeferred };
}

function customerActivities(db, accountId) {
  if (!hasTable(db, 'crm_activities')) return [];
  const columns = tableColumns(db, 'crm_activities');
  if (!columns.has('customer_id')) return [];
  const selected = ['id'];
  for (const column of ['user_id', 'activity_type', 'occurred_at', 'created_at']) {
    selected.push(columns.has(column) ? column : `'' ${column}`);
  }
  return db.prepare(`SELECT ${selected.join(',')} FROM crm_activities x
    WHERE x.customer_id=? AND ${effectiveActivityWhereClause(db, 'x')}
    ORDER BY x.occurred_at,x.created_at,x.id`).all(accountId);
}

function effectiveCustomerActivities(activities) {
  return activities.filter(activity =>
    EFFECTIVE_CUSTOMER_ACTIVITY_TYPES.has(
      String(activity.activity_type || '').trim().toLowerCase(),
    ));
}

function triggerBase(settings, account, latest, now) {
  return {
    customerId: account.external_customer_id || account.id,
    actorIdSnapshot: latest?.actor_id || '',
    ownerIdSnapshot: account.owner_id || latest?.owner_id_snapshot || '',
    settingsVersion: settings.version,
    thresholdSnapshot: settingsSnapshot(settings),
    recipientIds: [...settings.recipientIds],
    evaluatedAt: utcText(now),
    triggeredAt: utcText(now),
    dueAt: addHours(now, 72),
  };
}

function evaluateManagerTriggers(db, customerId, now = new Date()) {
  installManagerTaskSchema(db);
  const selectedCustomerId = requiredText(customerId, '客户编号', 'MANAGER_TASK_CUSTOMER_REQUIRED', 120);
  const evaluatedAt = parsedDate(now);
  const account = accountForCustomer(db, selectedCustomerId);
  if (!account || ['lost', 'disqualified'].includes(String(account.stage || ''))) return [];
  const settings = getManagerTaskSettings(db);
  const plan = latestPlanState(db, account.external_customer_id || account.id);
  const activities = effectiveCustomerActivities(customerActivities(db, account.id));
  const base = triggerBase(settings, account, plan.latest, evaluatedAt);
  const reasons = [];

  if (settings.rules.consecutiveDeferred.enabled
      && plan.consecutiveDeferred >= settings.rules.consecutiveDeferred.value) {
    reasons.push(Object.freeze({
      ...base,
      reason: 'consecutive_deferred',
      evidence: Object.freeze({
        consecutiveDeferredCount: plan.consecutiveDeferred,
        threshold: settings.rules.consecutiveDeferred.value,
        latestDeferredEventId: plan.latest?.id || '',
      }),
    }));
  }

  if (settings.rules.firstContactSilence.enabled && activities.length === 1) {
    const firstAt = dbTime(activities[0].occurred_at || activities[0].created_at);
    const silentMs = settings.rules.firstContactSilence.value * 86400000;
    if (Number.isFinite(firstAt) && firstAt + silentMs <= evaluatedAt.getTime()) {
      reasons.push(Object.freeze({
        ...base,
        reason: 'first_contact_silence',
        evidence: Object.freeze({
          firstActivityId: activities[0].id,
          firstActivityAt: activities[0].occurred_at || activities[0].created_at,
          silenceDays: settings.rules.firstContactSilence.value,
        }),
      }));
    }
  }

  if (settings.rules.plannedActionOverdue.enabled && plan.latest?.type === 'explicit') {
    const plannedAt = dbTime(plan.latest.next_action_at);
    const planCreatedAt = dbTime(plan.latest.created_at);
    const graceMs = settings.rules.plannedActionOverdue.value * 3600000;
    const deadline = plannedAt + graceMs;
    const hasTimelyActivity = activities.some(activity => {
      const activityAt = dbTime(activity.occurred_at || activity.created_at);
      return activityAt > planCreatedAt && activityAt <= deadline;
    });
    if (Number.isFinite(plannedAt) && Number.isFinite(planCreatedAt)
        && deadline < evaluatedAt.getTime() && !hasTimelyActivity) {
      reasons.push(Object.freeze({
        ...base,
        reason: 'planned_action_overdue',
        evidence: Object.freeze({
          planEventId: plan.latest.id,
          nextActionAt: plan.latest.next_action_at,
          overdueHours: settings.rules.plannedActionOverdue.value,
        }),
      }));
    }
  }
  return reasons;
}

function completionCondition(reason) {
  return ({
    consecutive_deferred: '形成明确计划、正式终止、重新分配或记录主管建议并指定后续动作',
    first_contact_silence: '产生新的有效客户动作、正式终止、重新分配或记录主管建议并指定后续动作',
    planned_action_overdue: '产生计划对应的有效动作、重新制定计划、正式终止或记录主管建议',
    manager_assistance: '销售确认回执并保存下一步计划',
  })[reason] || '完成真实业务状态变化';
}

function taskView(row, deduplicated = false) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    reason: row.reason,
    status: row.status,
    actorIdSnapshot: row.actor_id_snapshot,
    ownerIdSnapshot: row.owner_id_snapshot,
    recipientIds: Object.freeze(json(row.recipient_ids_json, []).map(String)),
    evidence: Object.freeze(json(row.evidence_json, {})),
    completionCondition: row.completion_condition,
    settingsVersion: row.settings_version,
    thresholdSnapshot: Object.freeze(json(row.threshold_snapshot_json, {})),
    evaluatedAt: row.evaluated_at,
    triggeredAt: row.triggered_at,
    dueAt: row.due_at,
    result: Object.freeze(json(row.result_json, {})),
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    escalatedBy: row.escalated_by,
    escalatedAt: row.escalated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deduplicated,
  });
}

function taskInput(db, input) {
  const settings = getManagerTaskSettings(db);
  const customerId = requiredText(input.customerId, '客户编号', 'MANAGER_TASK_CUSTOMER_REQUIRED', 120);
  const reason = requiredText(input.reason, '触发原因', 'MANAGER_TASK_REASON_REQUIRED', 80);
  if (!TASK_REASONS.has(reason)) {
    throw managerTaskError('主管任务触发原因无效', 'MANAGER_TASK_REASON_INVALID');
  }
  const triggeredAt = utcText(input.triggeredAt);
  const evaluatedAt = utcText(input.evaluatedAt || input.triggeredAt);
  const dueAt = utcText(input.dueAt || addHours(triggeredAt, 72));
  const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : {};
  const thresholdSnapshot = input.thresholdSnapshot || settingsSnapshot(settings);
  const recipients = recipientIds(input.recipientIds, settings.recipientIds);
  const canonical = {
    customerId,
    reason,
    actorIdSnapshot: String(input.actorIdSnapshot || '').trim(),
    ownerIdSnapshot: String(input.ownerIdSnapshot || '').trim(),
    evidence,
    completionCondition: String(input.completionCondition || completionCondition(reason)).trim(),
    settingsVersion: Number(input.settingsVersion || settings.version),
    thresholdSnapshot,
    recipientIds: recipients,
    evaluatedAt,
    triggeredAt,
    dueAt,
  };
  const requestedKey = String(input.idempotencyKey || '').trim();
  return {
    ...canonical,
    idempotencyKey: requestedKey || `manager-task:${digest(canonical)}`,
  };
}

function sameTask(row, input) {
  return row.customer_id === input.customerId
    && row.reason === input.reason
    && row.actor_id_snapshot === input.actorIdSnapshot
    && row.owner_id_snapshot === input.ownerIdSnapshot
    && stableJson(json(row.evidence_json, {})) === stableJson(input.evidence)
    && row.completion_condition === input.completionCondition
    && row.settings_version === input.settingsVersion
    && stableJson(json(row.threshold_snapshot_json, {})) === stableJson(input.thresholdSnapshot)
    && stableJson(json(row.recipient_ids_json, [])) === stableJson(input.recipientIds)
    && row.evaluated_at === input.evaluatedAt
    && row.triggered_at === input.triggeredAt
    && row.due_at === input.dueAt;
}

function upsertManagerTask(db, input = {}) {
  installManagerTaskSchema(db);
  return runImmediate(db, () => {
    const normalized = taskInput(db, input);
    const byKey = db.prepare('SELECT * FROM crm_manager_tasks WHERE idempotency_key=?')
      .get(normalized.idempotencyKey);
    if (byKey) {
      if (!sameTask(byKey, normalized)) {
        throw managerTaskError('幂等键已绑定其他主管任务', 'MANAGER_TASK_IDEMPOTENCY_CONFLICT', 409);
      }
      return taskView(byKey, true);
    }
    const active = db.prepare(`SELECT * FROM crm_manager_tasks WHERE customer_id=? AND reason=?
      AND status IN ('open','overdue','escalated')`).get(normalized.customerId, normalized.reason);
    if (active) {
      return taskView(active, true);
    }
    const id = String(input.id || '').trim() || `MT-${crypto.randomUUID()}`;
    const at = utcText(input.createdAt || normalized.evaluatedAt);
    db.prepare(`INSERT INTO crm_manager_tasks
      (id,idempotency_key,customer_id,reason,status,actor_id_snapshot,owner_id_snapshot,
       recipient_ids_json,evidence_json,completion_condition,settings_version,
       threshold_snapshot_json,evaluated_at,triggered_at,due_at,created_at,updated_at)
      VALUES (?,?,?,?,'open',?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,
      normalized.idempotencyKey,
      normalized.customerId,
      normalized.reason,
      normalized.actorIdSnapshot,
      normalized.ownerIdSnapshot,
      JSON.stringify(normalized.recipientIds),
      stableJson(normalized.evidence),
      normalized.completionCondition,
      normalized.settingsVersion,
      stableJson(normalized.thresholdSnapshot),
      normalized.evaluatedAt,
      normalized.triggeredAt,
      normalized.dueAt,
      at,
      at,
    );
    return taskView(db.prepare('SELECT * FROM crm_manager_tasks WHERE id=?').get(id));
  });
}

function getManagerTask(db, taskId) {
  if (!hasTable(db, 'crm_manager_tasks')) return null;
  return taskView(db.prepare('SELECT * FROM crm_manager_tasks WHERE id=?')
    .get(String(taskId || '').trim()));
}

function listManagerTasks(db, options = {}) {
  if (!hasTable(db, 'crm_manager_tasks')) return [];
  const where = [];
  const params = [];
  if (options.customerId) {
    where.push('customer_id=?');
    params.push(String(options.customerId).trim());
  }
  if (options.reason) {
    if (!TASK_REASONS.has(String(options.reason))) {
      throw managerTaskError('主管任务触发原因无效', 'MANAGER_TASK_REASON_INVALID');
    }
    where.push('reason=?');
    params.push(String(options.reason));
  }
  const statuses = options.statuses === undefined ? [...ACTIVE_STATUSES] : options.statuses;
  if (!Array.isArray(statuses) || !statuses.length
      || statuses.some(status => !TASK_STATUSES.has(String(status)))) {
    throw managerTaskError('主管任务状态筛选无效', 'MANAGER_TASK_STATUS_INVALID');
  }
  where.push(`status IN (${statuses.map(() => '?').join(',')})`);
  params.push(...statuses.map(String));
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 500));
  return db.prepare(`SELECT * FROM crm_manager_tasks
    WHERE ${where.join(' AND ')} ORDER BY triggered_at DESC,id DESC LIMIT ?`)
    .all(...params, limit).map(row => taskView(row));
}

function assertResolver(actor) {
  const actorId = requiredText(actor?.id, '操作人', 'MANAGER_TASK_ACTOR_REQUIRED', 120);
  if (!['admin', 'manager'].includes(String(actor?.role || ''))) {
    throw managerTaskError('只有管理员或主管可以处理主管任务', 'MANAGER_TASK_RESOLVE_FORBIDDEN', 403);
  }
  return actorId;
}

function validBusinessChange(value) {
  if (!value || value.changed !== true) return false;
  const entityType = String(value.entityType || value.evidence?.entityType || '').trim();
  const entityId = String(value.entityId || value.evidence?.entityId || '').trim();
  const before = value.before ?? value.evidence?.before;
  const after = value.after ?? value.evidence?.after;
  return Boolean(entityType && entityId && before !== undefined && after !== undefined
    && stableJson(before) !== stableJson(after));
}

function interventionReplay(db, taskId, actorId, action, idempotencyKey, requestHash) {
  const row = db.prepare('SELECT * FROM crm_manager_interventions WHERE idempotency_key=?')
    .get(idempotencyKey);
  if (!row) return null;
  if (row.task_id !== taskId || row.actor_id !== actorId || row.action !== action
      || (row.request_hash && row.request_hash !== requestHash)) {
    throw managerTaskError('幂等键已绑定其他主管处理', 'MANAGER_INTERVENTION_IDEMPOTENCY_CONFLICT', 409);
  }
  return {
    task: getManagerTask(db, taskId),
    interventionId: row.id,
    deduplicated: true,
  };
}

function interventionRequestHash(action, type) {
  return digest({
    type,
    note: String(action.note || '').trim(),
    difficulty: String(action.difficulty || '').trim(),
    stage: String(action.stage || '').trim(),
    ownerId: String(action.ownerId || '').trim(),
    nextAction: String(action.nextAction || '').trim(),
    nextActionAt: String(action.nextActionAt || '').trim(),
    businessChange: action.businessChange || null,
  });
}

function resolveManagerTask(db, actor, taskId, action = {}) {
  installManagerTaskSchema(db);
  const actorId = assertResolver(actor);
  const cleanTaskId = requiredText(taskId, '主管任务', 'MANAGER_TASK_ID_REQUIRED', 160);
  const type = requiredText(action.type, '处理动作', 'MANAGER_TASK_ACTION_REQUIRED', 80);
  if (!RESOLUTION_TYPES.has(type)) {
    throw managerTaskError('主管任务处理动作无效', 'MANAGER_TASK_ACTION_INVALID');
  }
  const idempotencyKey = requiredText(
    action.idempotencyKey, '幂等键', 'MANAGER_INTERVENTION_IDEMPOTENCY_REQUIRED', 240,
  );
  const requestHash = interventionRequestHash(action, type);
  return runImmediate(db, () => {
    const replay = interventionReplay(
      db, cleanTaskId, actorId, type, idempotencyKey, requestHash,
    );
    if (replay) return replay;
    const row = db.prepare('SELECT * FROM crm_manager_tasks WHERE id=?').get(cleanTaskId);
    if (!row) throw managerTaskError('主管任务不存在', 'MANAGER_TASK_NOT_FOUND', 404);
    if (row.status === 'completed') {
      throw managerTaskError('主管任务已经完结', 'MANAGER_TASK_ALREADY_COMPLETED', 409);
    }
    const at = utcText(action.now);
    const note = String(action.note || '').trim();
    const difficulty = String(action.difficulty || '').trim();
    let businessChange = action.businessChange || null;
    let nextStatus = 'completed';
    if (type === 'escalate_owner') {
      if (!difficulty) {
        throw managerTaskError('升级老板必须说明当前难点', 'MANAGER_TASK_DIFFICULTY_REQUIRED');
      }
      if (row.status === 'escalated') {
        throw managerTaskError('主管任务已经升级老板', 'MANAGER_TASK_ALREADY_ESCALATED', 409);
      }
      nextStatus = 'escalated';
      businessChange = {};
    } else {
      if (typeof action.apply === 'function') {
        const applied = action.apply(db, taskView(row));
        businessChange = applied?.evidence
          ? { ...applied, ...applied.evidence, evidence: applied.evidence }
          : applied;
      }
      if (!validBusinessChange(businessChange)) {
        throw managerTaskError(
          '主管任务必须通过真实业务变化完结',
          'MANAGER_TASK_BUSINESS_CHANGE_REQUIRED',
          409,
        );
      }
    }
    const result = {
      action: type,
      note,
      difficulty,
      businessChange: businessChange || {},
      completed: nextStatus === 'completed',
      escalated: nextStatus === 'escalated',
    };
    const interventionId = `MTI-${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO crm_manager_interventions
      (id,idempotency_key,task_id,actor_id,action,note,difficulty,request_hash,
       business_change_json,result_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      interventionId,
      idempotencyKey,
      row.id,
      actorId,
      type,
      note,
      difficulty,
      requestHash,
      JSON.stringify(businessChange || {}),
      JSON.stringify(result),
      at,
    );
    if (nextStatus === 'escalated') {
      db.prepare(`UPDATE crm_manager_tasks SET status='escalated',result_json=?,
        escalated_by=?,escalated_at=?,updated_at=? WHERE id=?`).run(
        JSON.stringify(result), actorId, at, at, row.id,
      );
    } else {
      db.prepare(`UPDATE crm_manager_tasks SET status='completed',result_json=?,
        resolved_by=?,resolved_at=?,updated_at=? WHERE id=?`).run(
        JSON.stringify(result), actorId, at, at, row.id,
      );
    }
    return {
      task: getManagerTask(db, row.id),
      interventionId,
      deduplicated: false,
    };
  });
}

function markManagerTasksOverdue(db, now = new Date()) {
  installManagerTaskSchema(db);
  const at = utcText(now);
  return runImmediate(db, () => {
    const rows = db.prepare(`SELECT * FROM crm_manager_tasks
      WHERE status='open' AND due_at!='' AND due_at<? ORDER BY due_at,id`).all(at);
    for (const row of rows) {
      const interventionId = `MTI-${crypto.randomUUID()}`;
      const result = { action: 'marked_overdue', dueAt: row.due_at, markedAt: at };
      db.prepare(`INSERT OR IGNORE INTO crm_manager_interventions
        (id,idempotency_key,task_id,actor_id,action,result_json,created_at)
        VALUES (?,? ,?,'system','marked_overdue',?,?)`).run(
        interventionId, `manager-task-overdue:${row.id}`, row.id, JSON.stringify(result), at,
      );
      db.prepare(`UPDATE crm_manager_tasks SET status='overdue',result_json=?,updated_at=?
        WHERE id=? AND status='open'`).run(JSON.stringify(result), at, row.id);
    }
    return rows.length;
  });
}

module.exports = {
  ACTIVE_STATUSES,
  DEFAULT_MANAGER_TASK_SETTINGS,
  evaluateManagerTriggers,
  getManagerTask,
  getManagerTaskSettings,
  installManagerTaskSchema,
  listManagerTasks,
  markManagerTasksOverdue,
  resolveManagerTask,
  updateManagerTaskSettings,
  upsertManagerTask,
};
