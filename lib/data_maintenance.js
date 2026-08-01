const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { runtimePaths } = require('./runtime_paths');

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const RESETTABLE_STATUSES = ['assigned', 'claimed', 'returned'];
const PROTECTED_CUSTOMER_HISTORY_TABLES = Object.freeze([
  'crm_manager_tasks',
  'crm_manager_interventions',
  'crm_deferred_plan_events',
  'crm_next_plan_events',
]);
const previews = new Map();
let executionActive = false;

function nowText(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function httpError(statusCode, message, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function installDataMaintenance(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_data_maintenance_runs (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      target_fingerprint TEXT NOT NULL DEFAULT '',
      preview_counts_json TEXT NOT NULL DEFAULT '{}',
      result_counts_json TEXT NOT NULL DEFAULT '{}',
      backup_file TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      real_user_id TEXT NOT NULL DEFAULT '',
      session_hash_prefix TEXT NOT NULL DEFAULT '',
      preview_token_hash TEXT NOT NULL DEFAULT '',
      preview_expires_at TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_data_maintenance_runs_created_idx
      ON crm_data_maintenance_runs(created_at DESC);
  `);
}

function recoverInterruptedMaintenanceRuns(db) {
  installDataMaintenance(db);
  return db.prepare(`UPDATE crm_data_maintenance_runs
    SET status='failed',error_code='MAINTENANCE_INTERRUPTED',
        error_message='服务重启时检测到未完成的数据维护操作',finished_at=?
    WHERE status='running'`).run(nowText()).changes;
}

function normalizeStringList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw httpError(400, `${field} 必须是数组`, 'INVALID_MAINTENANCE_FILTER');
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 500);
}

function normalizeDate(value, field) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text.includes('T') ? text : text.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) throw httpError(400, `${field} 不是有效日期`, 'INVALID_MAINTENANCE_FILTER');
  return nowText(date);
}

function normalizeMaintenanceFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(400, 'filters 必须是对象', 'INVALID_MAINTENANCE_FILTER');
  }
  const allowed = new Set(['batchIds', 'ownerIds', 'intakeItemIds', 'assignedFrom', 'assignedTo', 'allAssigned']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw httpError(400, `不支持的数据维护筛选字段：${key}`, 'INVALID_MAINTENANCE_FILTER');
  }
  const filters = {
    batchIds: normalizeStringList(input.batchIds, 'batchIds'),
    ownerIds: normalizeStringList(input.ownerIds, 'ownerIds'),
    intakeItemIds: normalizeStringList(input.intakeItemIds, 'intakeItemIds'),
    assignedFrom: normalizeDate(input.assignedFrom, 'assignedFrom'),
    assignedTo: normalizeDate(input.assignedTo, 'assignedTo'),
    allAssigned: input.allAssigned === true,
  };
  if (!filters.allAssigned && !filters.batchIds.length && !filters.ownerIds.length
    && !filters.intakeItemIds.length && !filters.assignedFrom && !filters.assignedTo) {
    throw httpError(400, '必须明确选择批次、负责人、线索、时间范围或全部已分配客户', 'MAINTENANCE_SCOPE_REQUIRED');
  }
  if (filters.assignedFrom && filters.assignedTo && filters.assignedFrom > filters.assignedTo) {
    throw httpError(400, '分配开始时间不能晚于结束时间', 'INVALID_MAINTENANCE_FILTER');
  }
  return filters;
}

const placeholders = values => values.map(() => '?').join(',');

function tableExists(db, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table));
}

function groupedCustomerCounts(db, table, customerIds) {
  if (!customerIds.length || !tableExists(db, table)) return new Map();
  return new Map(db.prepare(`SELECT customer_id,COUNT(*) count FROM ${table}
    WHERE customer_id IN (${placeholders(customerIds)}) GROUP BY customer_id`)
    .all(...customerIds).map(row => [String(row.customer_id), Number(row.count || 0)]));
}

function groupedInterventionCounts(db, customerIds) {
  if (!customerIds.length || !tableExists(db, 'crm_manager_tasks')
      || !tableExists(db, 'crm_manager_interventions')) return new Map();
  return new Map(db.prepare(`SELECT t.customer_id,COUNT(*) count
    FROM crm_manager_interventions i JOIN crm_manager_tasks t ON t.id=i.task_id
    WHERE t.customer_id IN (${placeholders(customerIds)}) GROUP BY t.customer_id`)
    .all(...customerIds).map(row => [String(row.customer_id), Number(row.count || 0)]));
}

function protectedCustomerHistory(db, accounts) {
  const customerIds = [...new Set(accounts.flatMap(account => [
    String(account.id || '').trim(),
    String(account.external_customer_id || '').trim(),
  ]).filter(Boolean))];
  if (!customerIds.length) return [];
  const countsByTable = new Map([
    ['crm_manager_tasks', groupedCustomerCounts(db, 'crm_manager_tasks', customerIds)],
    ['crm_manager_interventions', groupedInterventionCounts(db, customerIds)],
    ['crm_deferred_plan_events', groupedCustomerCounts(db, 'crm_deferred_plan_events', customerIds)],
    ['crm_next_plan_events', groupedCustomerCounts(db, 'crm_next_plan_events', customerIds)],
  ]);
  return accounts.flatMap(account => {
    const identifiers = [...new Set([
      String(account.id || '').trim(),
      String(account.external_customer_id || '').trim(),
    ].filter(Boolean))];
    const dependencies = PROTECTED_CUSTOMER_HISTORY_TABLES.map(table => ({
      table,
      count: identifiers.reduce((total, customerId) =>
        total + Number(countsByTable.get(table)?.get(customerId) || 0), 0),
    })).filter(dependency => dependency.count > 0);
    return dependencies.length ? [{
      code: 'PROTECTED_CUSTOMER_HISTORY',
      accountId: account.id,
      externalCustomerId: account.external_customer_id || '',
      dependencies,
    }] : [];
  });
}

function protectedCustomerHistoryError(conflicts) {
  const error = httpError(
    409,
    '目标客户存在主管任务或计划历史，不能重置分配',
    'MAINTENANCE_PROTECTED_CUSTOMER_HISTORY',
  );
  error.publicDetails = { details: { conflicts } };
  return error;
}

function resolveResetAssignmentTargets(db, filtersInput) {
  const filters = normalizeMaintenanceFilters(filtersInput);
  const conditions = [`i.status IN (${placeholders(RESETTABLE_STATUSES)})`];
  const params = [...RESETTABLE_STATUSES];
  const addList = (column, values) => {
    if (!values.length) return;
    conditions.push(`${column} IN (${placeholders(values)})`);
    params.push(...values);
  };
  addList('i.batch_id', filters.batchIds);
  addList('i.assigned_owner_id', filters.ownerIds);
  addList('i.id', filters.intakeItemIds);
  if (filters.assignedFrom) { conditions.push('i.assigned_at>=?'); params.push(filters.assignedFrom); }
  if (filters.assignedTo) { conditions.push('i.assigned_at<=?'); params.push(filters.assignedTo); }
  const items = db.prepare(`SELECT i.* FROM crm_intake_items i
    WHERE ${conditions.join(' AND ')} ORDER BY i.id`).all(...params);
  const requested = filters.intakeItemIds.length
    ? db.prepare(`SELECT id,status FROM crm_intake_items WHERE id IN (${placeholders(filters.intakeItemIds)}) ORDER BY id`)
      .all(...filters.intakeItemIds)
    : [];
  const skippedByStatus = requested.filter(row => !RESETTABLE_STATUSES.includes(row.status));
  const itemIds = items.map(row => row.id);
  const crmIds = items.map(row => row.crm_customer_id).filter(Boolean);
  let accounts = [];
  if (itemIds.length || crmIds.length) {
    const parts = [], accountParams = [];
    if (itemIds.length) { parts.push(`intake_item_id IN (${placeholders(itemIds)})`); accountParams.push(...itemIds); }
    if (crmIds.length) { parts.push(`id IN (${placeholders(crmIds)})`); accountParams.push(...crmIds); }
    accounts = db.prepare(`SELECT * FROM crm_accounts WHERE ${parts.join(' OR ')} ORDER BY id`).all(...accountParams);
  }
  const accountsById = new Map(accounts.map(row => [row.id, row]));
  const accountsByItem = new Map();
  const conflicts = [];
  for (const account of accounts) {
    if (!account.intake_item_id) {
      conflicts.push({ code: 'UNTRACEABLE_ACCOUNT', accountId: account.id });
      continue;
    }
    if (accountsByItem.has(account.intake_item_id)) conflicts.push({ code: 'MULTIPLE_ACCOUNTS', intakeItemId: account.intake_item_id });
    else accountsByItem.set(account.intake_item_id, account);
  }
  for (const item of items) {
    const byItem = accountsByItem.get(item.id);
    const byId = item.crm_customer_id ? accountsById.get(item.crm_customer_id) : null;
    if (item.crm_customer_id && !byId) conflicts.push({ code: 'MISSING_ACCOUNT', intakeItemId: item.id, accountId: item.crm_customer_id });
    if (byItem && item.crm_customer_id && byItem.id !== item.crm_customer_id) conflicts.push({ code: 'ACCOUNT_LINK_MISMATCH', intakeItemId: item.id, accountId: item.crm_customer_id });
    if (byId && byId.intake_item_id !== item.id) conflicts.push({ code: 'INTAKE_LINK_MISMATCH', intakeItemId: item.id, accountId: byId.id });
  }
  const accountIds = [...new Set(accounts.map(row => row.id))];
  const externalCustomerIds = [...new Set(accounts
    .map(row => String(row.external_customer_id || '').trim()).filter(Boolean))];
  const notificationCustomerIds = [...new Set([...accountIds, ...externalCustomerIds])];
  const countByCustomer = table => accountIds.length
    ? Number(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE customer_id IN (${placeholders(accountIds)})`).get(...accountIds).n)
    : 0;
  const notificationCount = notificationCustomerIds.length
    ? Number(db.prepare(`SELECT COUNT(*) n FROM crm_notifications
      WHERE customer_id IN (${placeholders(notificationCustomerIds)})`)
      .get(...notificationCustomerIds).n)
    : 0;
  const protectedHistoryConflicts = protectedCustomerHistory(db, accounts);
  const counts = {
    intakeItems: items.length,
    accounts: accountIds.length,
    activities: countByCustomer('crm_activities'),
    rfqs: countByCustomer('crm_rfqs'),
    quotes: countByCustomer('crm_quotes'),
    orders: countByCustomer('crm_orders'),
    contacts: countByCustomer('crm_account_contacts'),
    evaluations: countByCustomer('crm_manager_evaluations'),
    notifications: notificationCount,
    skippedByStatus: skippedByStatus.length,
    conflicts: conflicts.length,
  };
  const fingerprintPayload = {
    items: items.map(row => [row.id, row.status, row.crm_customer_id, row.assigned_owner_id, row.updated_at]),
    accounts: accounts.map(row => [row.id, row.intake_item_id, row.updated_at]),
    counts,
    protectedHistoryConflicts,
  };
  const targetFingerprint = crypto.createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex');
  return {
    filters,
    items,
    accounts,
    accountIds,
    externalCustomerIds,
    notificationCustomerIds,
    counts,
    skippedByStatus,
    conflicts,
    protectedHistoryConflicts,
    targetFingerprint,
  };
}

function previewDataMaintenance(db, identity, sessionHash, request = {}) {
  installDataMaintenance(db);
  const allowed = new Set(['operation', 'filters']);
  for (const key of Object.keys(request || {})) {
    if (!allowed.has(key)) throw httpError(400, `不支持的预览字段：${key}`, 'INVALID_MAINTENANCE_REQUEST');
  }
  if (String(request.operation || '') !== 'reset_assignments') {
    throw httpError(400, '第一版只支持重置客户分配', 'UNSUPPORTED_MAINTENANCE_OPERATION');
  }
  const target = resolveResetAssignmentTargets(db, request.filters || {});
  if (target.protectedHistoryConflicts.length) {
    throw protectedCustomerHistoryError(target.protectedHistoryConflicts);
  }
  const previewId = crypto.randomBytes(24).toString('base64url');
  const runId = `DM-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PREVIEW_TTL_MS);
  const confirmationText = `重置 ${target.counts.intakeItems} 条客户分配`;
  const realUserId = String(identity?.id || '');
  const cleanSessionHash = String(sessionHash || '');
  const preview = {
    previewId, runId, operation: 'reset_assignments', filters: target.filters,
    targetFingerprint: target.targetFingerprint, counts: target.counts,
    conflicts: target.conflicts, skippedByStatus: target.skippedByStatus,
    confirmationText, expiresAt: expiresAt.toISOString(), realUserId, sessionHash: cleanSessionHash,
  };
  previews.set(previewId, preview);
  db.prepare(`INSERT INTO crm_data_maintenance_runs
    (id,operation,status,filters_json,target_fingerprint,preview_counts_json,real_user_id,
     session_hash_prefix,preview_token_hash,preview_expires_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    runId, 'reset_assignments', 'previewed', JSON.stringify(target.filters), target.targetFingerprint,
    JSON.stringify(target.counts), realUserId, cleanSessionHash.slice(0, 12),
    crypto.createHash('sha256').update(previewId).digest('hex'), nowText(expiresAt), nowText(createdAt),
  );
  return {
    previewId, runId, operation: preview.operation, filters: target.filters, counts: target.counts,
    conflicts: target.conflicts, skippedByStatus: target.skippedByStatus,
    targetFingerprint: target.targetFingerprint, confirmationText, expiresAt: preview.expiresAt,
  };
}

function backupDirectory() {
  return runtimePaths().backupDir;
}

function maintenanceCapabilities() {
  const directory = backupDirectory();
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.accessSync(directory, fs.constants.W_OK);
    return { backupReady: true, busy: executionActive };
  } catch (_error) {
    return { backupReady: false, busy: executionActive, error: '备份目录不可写' };
  }
}

async function executeDataMaintenance(db, identity, sessionHash, request = {}) {
  installDataMaintenance(db);
  const allowed = new Set(['previewId', 'confirmationText']);
  for (const key of Object.keys(request || {})) {
    if (!allowed.has(key)) throw httpError(400, `执行请求不支持字段：${key}`, 'INVALID_MAINTENANCE_REQUEST');
  }
  const previewId = String(request.previewId || '');
  const preview = previews.get(previewId);
  if (!preview) throw httpError(409, '预览不存在、已过期或服务已重启，请重新预览', 'MAINTENANCE_PREVIEW_EXPIRED');
  if (preview.realUserId !== String(identity?.id || '') || preview.sessionHash !== String(sessionHash || '')) {
    throw httpError(403, '该预览不属于当前管理员会话', 'MAINTENANCE_PREVIEW_OWNER_MISMATCH');
  }
  if (Date.parse(preview.expiresAt) <= Date.now()) {
    previews.delete(previewId);
    db.prepare("UPDATE crm_data_maintenance_runs SET status='stale',finished_at=? WHERE id=?").run(nowText(), preview.runId);
    throw httpError(409, '预览已过期，请重新预览', 'MAINTENANCE_PREVIEW_EXPIRED');
  }
  if (String(request.confirmationText || '') !== preview.confirmationText) {
    throw httpError(400, '确认文字不匹配', 'MAINTENANCE_CONFIRMATION_MISMATCH');
  }
  if (executionActive) throw httpError(409, '已有数据维护操作正在执行', 'MAINTENANCE_BUSY');
  executionActive = true;
  let backupFile = '';
  try {
    const target = resolveResetAssignmentTargets(db, preview.filters);
    if (!target.items.length) throw httpError(409, '当前范围没有可重置的客户分配', 'MAINTENANCE_NO_TARGETS');
    if (target.protectedHistoryConflicts.length) {
      throw protectedCustomerHistoryError(target.protectedHistoryConflicts);
    }
    if (target.targetFingerprint !== preview.targetFingerprint) {
      throw httpError(409, '数据已发生变化，请重新预览', 'MAINTENANCE_PREVIEW_STALE');
    }
    if (target.conflicts.length) throw httpError(409, '目标数据存在关系冲突，未执行重置', 'MAINTENANCE_CONFLICT');
    const directory = backupDirectory();
    fs.mkdirSync(directory, { recursive: true });
    backupFile = `crm-before-reset-assignments-${new Date().toISOString().replace(/[:.]/g, '-')}-${preview.runId}.db`;
    db.prepare("UPDATE crm_data_maintenance_runs SET status='running',started_at=? WHERE id=?").run(nowText(), preview.runId);
    await db.backup(path.join(directory, backupFile));
    const itemIds = target.items.map(row => row.id);
    const batchIds = [...new Set(target.items.map(row => row.batch_id))];
    const tx = db.transaction(() => {
      const lockedTarget = resolveResetAssignmentTargets(db, preview.filters);
      if (lockedTarget.protectedHistoryConflicts.length) {
        throw protectedCustomerHistoryError(lockedTarget.protectedHistoryConflicts);
      }
      if (lockedTarget.targetFingerprint !== preview.targetFingerprint) {
        throw httpError(409, '备份期间数据已发生变化，请重新预览', 'MAINTENANCE_PREVIEW_STALE');
      }
      if (target.accountIds.length) {
        if (target.notificationCustomerIds.length) {
          db.prepare(`DELETE FROM crm_notifications
            WHERE customer_id IN (${placeholders(target.notificationCustomerIds)})`)
            .run(...target.notificationCustomerIds);
        }
        db.prepare(`DELETE FROM crm_accounts WHERE id IN (${placeholders(target.accountIds)})`).run(...target.accountIds);
      }
      if (itemIds.length) {
        db.prepare(`UPDATE crm_intake_items SET status='approved',crm_customer_id='',suggested_owner_id='',
          assigned_owner_id='',decision_reason='',return_reason='',assigned_at='',claim_due_at='',claimed_at='',updated_at=?
          WHERE id IN (${placeholders(itemIds)})`).run(nowText(), ...itemIds);
      }
      for (const batchId of batchIds) {
        db.prepare(`UPDATE crm_intake_batches SET assigned_count=(SELECT COUNT(*) FROM crm_intake_items
          WHERE batch_id=? AND status IN ('assigned','claimed')) WHERE id=?`).run(batchId, batchId);
      }
      const resultCounts = { ...target.counts, resetIntakeItems: itemIds.length, deletedAccounts: target.accountIds.length };
      db.prepare(`UPDATE crm_data_maintenance_runs SET status='completed',result_counts_json=?,backup_file=?,finished_at=?
        WHERE id=?`).run(JSON.stringify(resultCounts), backupFile, nowText(), preview.runId);
    });
    tx.immediate();
    previews.delete(previewId);
    return {
      runId: preview.runId, operation: preview.operation, backupFile,
      counts: { ...target.counts, resetIntakeItems: itemIds.length, deletedAccounts: target.accountIds.length },
    };
  } catch (error) {
    if (error.code === 'MAINTENANCE_PREVIEW_STALE') {
      db.prepare("UPDATE crm_data_maintenance_runs SET status='stale',backup_file=?,error_code=?,error_message=?,finished_at=? WHERE id=?")
        .run(backupFile, error.code, String(error.message || error).slice(0, 500), nowText(), preview.runId);
    } else {
      db.prepare(`UPDATE crm_data_maintenance_runs SET status='failed',backup_file=?,error_code=?,error_message=?,finished_at=?
        WHERE id=? AND status!='completed'`).run(
        backupFile, String(error.code || 'MAINTENANCE_FAILED'), String(error.message || error).slice(0, 500), nowText(), preview.runId,
      );
    }
    throw error;
  } finally {
    executionActive = false;
  }
}

function listMaintenanceRuns(db, limit = 20) {
  installDataMaintenance(db);
  const cleanLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  return db.prepare(`SELECT id,operation,status,filters_json,preview_counts_json,result_counts_json,
    backup_file,error_code,error_message,real_user_id,preview_expires_at,started_at,finished_at,created_at
    FROM crm_data_maintenance_runs ORDER BY created_at DESC LIMIT ?`).all(cleanLimit).map(row => ({
    id: row.id, operation: row.operation, status: row.status,
    filters: JSON.parse(row.filters_json || '{}'),
    previewCounts: JSON.parse(row.preview_counts_json || '{}'),
    resultCounts: JSON.parse(row.result_counts_json || '{}'),
    backupFile: row.backup_file, errorCode: row.error_code, errorMessage: row.error_message,
    realUserId: row.real_user_id, previewExpiresAt: row.preview_expires_at,
    startedAt: row.started_at, finishedAt: row.finished_at, createdAt: row.created_at,
  }));
}

module.exports = {
  RESETTABLE_STATUSES,
  installDataMaintenance,
  recoverInterruptedMaintenanceRuns,
  normalizeMaintenanceFilters,
  resolveResetAssignmentTargets,
  previewDataMaintenance,
  executeDataMaintenance,
  listMaintenanceRuns,
  maintenanceCapabilities,
};
