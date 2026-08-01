'use strict';

const crypto = require('node:crypto');
const { hasPermission } = require('./access_control');
const {
  assertProtectedCustomerWritesEnabled,
  auditProtectedCustomerIdentities,
  identitySourceSnapshot,
  installCustomerIdentityRegistry,
} = require('./customer_identity_registry');

const PAGE_SIZE = 20;
const DECISIONS = new Set([
  'link_existing',
  'confirm_new',
  'supplement_and_retry',
]);
const STATUSES = new Set(['all', 'unresolved', 'pending', 'retry', 'resolved']);

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function privateError(message, code, statusCode, metadata = {}) {
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

function assertConflictManager(user) {
  if (!user || user.role !== 'admin' || user.isImpersonating || user.impersonation
      || !hasPermission(user, 'manage_protected_customers')) {
    throw privateError(
      '没有权限处理受保护客户身份冲突',
      'PROTECTED_IDENTITY_CONFLICT_FORBIDDEN',
      403,
    );
  }
}

function installProtectedCustomerConflicts(db) {
  installCustomerIdentityRegistry(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_customer_identity_conflicts (
      conflict_id TEXT PRIMARY KEY,
      normalized_name TEXT NOT NULL,
      source_expected_version TEXT NOT NULL,
      latest_source_version TEXT NOT NULL,
      expected_version TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      latest_evidence_json TEXT NOT NULL,
      external_customer_ids_json TEXT NOT NULL,
      latest_external_customer_ids_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','retry','resolved')),
      decision TEXT NOT NULL DEFAULT '',
      target_external_customer_id TEXT NOT NULL DEFAULT '',
      details_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      resolved_source_version TEXT NOT NULL DEFAULT '',
      resolved_by TEXT NOT NULL DEFAULT '',
      resolved_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crm_customer_identity_conflict_audit (
      id TEXT PRIMARY KEY,
      conflict_id TEXT NOT NULL,
      request_hash TEXT NOT NULL UNIQUE,
      actor_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      target_external_customer_id TEXT NOT NULL DEFAULT '',
      expected_version TEXT NOT NULL,
      source_version TEXT NOT NULL,
      details_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conflict_id) REFERENCES crm_customer_identity_conflicts(conflict_id)
    );
    CREATE INDEX IF NOT EXISTS idx_identity_conflicts_status
      ON crm_customer_identity_conflicts(status, updated_at, conflict_id);
    CREATE INDEX IF NOT EXISTS idx_identity_conflict_audit_conflict
      ON crm_customer_identity_conflict_audit(conflict_id, created_at, id);
  `);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function snapshotEvidence(conflict) {
  return stableJson({
    conflictId: conflict.conflictId,
    normalizedName: conflict.normalizedName,
    expectedVersion: conflict.expectedVersion,
    externalCustomerIds: conflict.externalCustomerIds,
    aliases: conflict.aliases,
  });
}

function initialStateVersion(conflict) {
  // The first API version deliberately equals the read-only preflight version.
  return conflict.expectedVersion;
}

function refreshedStateVersion(row, conflict, version) {
  return `sha256:${digest({
    conflictId: conflict.conflictId,
    sourceExpectedVersion: conflict.expectedVersion,
    previousExpectedVersion: row.expected_version,
    version,
    kind: 'source_refresh',
  })}`;
}

function nextStateVersion(
  row,
  decision,
  targetExternalCustomerId,
  details,
  version,
  sourceExpectedVersion = row.latest_source_version,
) {
  return `sha256:${digest({
    conflictId: row.conflict_id,
    sourceExpectedVersion,
    previousExpectedVersion: row.expected_version,
    decision,
    targetExternalCustomerId,
    details,
    version,
  })}`;
}

function currentConflicts(db) {
  return auditProtectedCustomerIdentities(db, { apply: false }).conflicts;
}

function insertNewConflict(db, conflict, timestamp) {
  const evidenceJson = snapshotEvidence(conflict);
  const idsJson = stableJson(conflict.externalCustomerIds);
  db.prepare(`INSERT OR IGNORE INTO crm_customer_identity_conflicts
    (conflict_id,normalized_name,source_expected_version,latest_source_version,
     expected_version,evidence_json,latest_evidence_json,external_customer_ids_json,
     latest_external_customer_ids_json,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(
    conflict.conflictId,
    conflict.normalizedName,
    conflict.expectedVersion,
    conflict.expectedVersion,
    initialStateVersion(conflict),
    evidenceJson,
    evidenceJson,
    idsJson,
    idsJson,
    timestamp,
    timestamp,
  );
}

function syncCurrentConflictsInTransaction(db) {
  const conflicts = currentConflicts(db);
  const timestamp = nowText();
  for (const conflict of conflicts) {
    insertNewConflict(db, conflict, timestamp);
    const row = db.prepare(`SELECT status,latest_source_version,expected_version,version
      FROM crm_customer_identity_conflicts WHERE conflict_id=?`).get(conflict.conflictId);
    if (!row || row.latest_source_version === conflict.expectedVersion) {
      continue;
    }
    const evidenceJson = snapshotEvidence(conflict);
    const idsJson = stableJson(conflict.externalCustomerIds);
    const version = row.version + 1;
    const expectedVersion = refreshedStateVersion(row, conflict, version);
    const reopened = row.status === 'resolved';
    db.prepare(`UPDATE crm_customer_identity_conflicts
      SET latest_source_version=?,expected_version=?,latest_evidence_json=?,
          latest_external_customer_ids_json=?,version=?,updated_at=?,
          status=CASE WHEN ? THEN 'pending' ELSE status END,
          decision=CASE WHEN ? THEN '' ELSE decision END,
          target_external_customer_id=CASE WHEN ? THEN '' ELSE target_external_customer_id END,
          details_json=CASE WHEN ? THEN '{}' ELSE details_json END,
          resolved_source_version=CASE WHEN ? THEN '' ELSE resolved_source_version END,
          resolved_by=CASE WHEN ? THEN '' ELSE resolved_by END,
          resolved_at=CASE WHEN ? THEN '' ELSE resolved_at END
      WHERE conflict_id=?`).run(
      conflict.expectedVersion,
      expectedVersion,
      evidenceJson,
      idsJson,
      version,
      timestamp,
      reopened ? 1 : 0,
      reopened ? 1 : 0,
      reopened ? 1 : 0,
      reopened ? 1 : 0,
      reopened ? 1 : 0,
      reopened ? 1 : 0,
      reopened ? 1 : 0,
      conflict.conflictId,
    );
  }
  return conflicts;
}

function detailsValue(input) {
  let details;
  if (typeof input === 'string') details = { reason: input.trim() };
  else if (input && typeof input === 'object' && !Array.isArray(input)) {
    details = stableValue(input);
    if (typeof details.reason === 'string') details.reason = details.reason.trim();
  } else details = {};
  if (typeof details.reason !== 'string' || !details.reason.trim()) {
    throw privateError(
      '必须填写人工裁决理由',
      'PROTECTED_IDENTITY_CONFLICT_DETAILS_REQUIRED',
      422,
    );
  }
  details.reason = details.reason.trim();
  if (details.reason.length > 2000) {
    throw privateError(
      '人工裁决理由过长',
      'PROTECTED_IDENTITY_CONFLICT_DETAILS_TOO_LONG',
      422,
    );
  }
  return details;
}

function publicRow(row) {
  const latestEvidence = parseJson(row.latest_evidence_json, {});
  return {
    conflictId: row.conflict_id,
    normalizedName: row.normalized_name,
    externalCustomerIds: parseJson(row.latest_external_customer_ids_json, []),
    aliases: Array.isArray(latestEvidence.aliases) ? latestEvidence.aliases : [],
    sourceExpectedVersion: row.latest_source_version,
    expectedVersion: row.expected_version,
    status: row.status,
    decision: row.decision,
    targetExternalCustomerId: row.target_external_customer_id,
    details: parseJson(row.details_json, {}),
    version: row.version,
    resolvedBy: row.resolved_by,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

function resolutionIntegrityValid(
  db,
  row,
  currentSourceVersion = '',
  currentExternalCustomerIds = null,
) {
  if (row.status !== 'resolved'
      || !['link_existing', 'confirm_new'].includes(row.decision)
      || !row.target_external_customer_id
      || !row.resolved_source_version
      || (currentSourceVersion && row.resolved_source_version !== currentSourceVersion)) return false;
  const owner = db.prepare(`SELECT external_customer_id
    FROM crm_customer_identity_registry WHERE normalized_name=?`).get(row.normalized_name);
  if (!owner || owner.external_customer_id !== row.target_external_customer_id) return false;
  if (Array.isArray(currentExternalCustomerIds)) {
    const currentIds = [...new Set(currentExternalCustomerIds)].sort();
    if (currentIds.length !== 1 || currentIds[0] !== row.target_external_customer_id) return false;
  }
  return Boolean(db.prepare(`SELECT 1 FROM crm_customer_identity_conflict_audit
    WHERE conflict_id=? AND decision=? AND target_external_customer_id=?
      AND source_version=? LIMIT 1`).get(
    row.conflict_id,
    row.decision,
    row.target_external_customer_id,
    row.resolved_source_version,
  ));
}

function retryIntegrityValid(row, auditRow) {
  if (row.status !== 'retry'
      || row.decision !== 'supplement_and_retry'
      || row.target_external_customer_id
      || auditRow.decision !== row.decision
      || auditRow.target_external_customer_id
      || auditRow.source_version !== row.latest_source_version) return false;
  const after = parseJson(auditRow.after_json, {});
  return stableJson(after) === stableJson(stateSnapshot(row));
}

function publicAuditHistory(row) {
  return {
    actorId: row.actor_id,
    decision: row.decision,
    targetExternalCustomerId: row.target_external_customer_id,
    expectedVersion: row.expected_version,
    sourceVersion: row.source_version,
    details: parseJson(row.details_json, {}),
    evidence: parseJson(row.evidence_json, {}),
    before: parseJson(row.before_json, {}),
    after: parseJson(row.after_json, {}),
    createdAt: row.created_at,
  };
}

function pendingPublicRow(row) {
  return {
    ...row,
    status: 'pending',
    decision: '',
    targetExternalCustomerId: '',
    details: {},
    resolvedAt: '',
  };
}

function liveConflictRow(conflict, storedRow) {
  if (!storedRow) {
    return {
      conflictId: conflict.conflictId,
      normalizedName: conflict.normalizedName,
      externalCustomerIds: conflict.externalCustomerIds,
      aliases: conflict.aliases,
      sourceExpectedVersion: conflict.expectedVersion,
      expectedVersion: initialStateVersion(conflict),
      status: 'pending',
      decision: '',
      targetExternalCustomerId: '',
      details: {},
      version: 1,
      updatedAt: '',
      resolvedAt: '',
    };
  }
  if (storedRow.latest_source_version === conflict.expectedVersion) return publicRow(storedRow);
  const version = storedRow.version + 1;
  return {
    conflictId: conflict.conflictId,
    normalizedName: conflict.normalizedName,
    externalCustomerIds: conflict.externalCustomerIds,
    aliases: conflict.aliases,
    sourceExpectedVersion: conflict.expectedVersion,
    expectedVersion: refreshedStateVersion(storedRow, conflict, version),
    status: storedRow.status === 'resolved' ? 'pending' : storedRow.status,
    decision: storedRow.status === 'resolved' ? '' : storedRow.decision,
    targetExternalCustomerId: storedRow.status === 'resolved'
      ? '' : storedRow.target_external_customer_id,
    details: storedRow.status === 'resolved' ? {} : parseJson(storedRow.details_json, {}),
    version,
    updatedAt: storedRow.updated_at,
    resolvedAt: '',
  };
}

function listProtectedIdentityConflicts(db, user, options = {}) {
  assertConflictManager(user);

  const status = String(options.status || 'unresolved').trim().toLowerCase();
  if (!STATUSES.has(status)) {
    throw privateError(
      '冲突状态筛选无效',
      'PROTECTED_IDENTITY_CONFLICT_STATUS_INVALID',
      400,
    );
  }
  const requestedPage = Number(options.page ?? 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const query = String(options.query || '').trim().toLocaleLowerCase('und');
  const storedRows = db.prepare(`SELECT * FROM crm_customer_identity_conflicts
    ORDER BY updated_at DESC, conflict_id`).all();
  const storedById = new Map(storedRows.map(row => [row.conflict_id, row]));
  const liveReport = auditProtectedCustomerIdentities(db, { apply: false });
  const liveIds = new Set(liveReport.conflicts.map(conflict => conflict.conflictId));
  const currentAliasesByName = new Map();
  for (const alias of liveReport.aliases) {
    if (!currentAliasesByName.has(alias.normalizedName)) {
      currentAliasesByName.set(alias.normalizedName, []);
    }
    currentAliasesByName.get(alias.normalizedName).push(alias);
  }
  const rows = [
    ...liveReport.conflicts.map(conflict => {
      const storedRow = storedById.get(conflict.conflictId);
      const item = liveConflictRow(conflict, storedRow);
      return storedRow?.status === 'resolved'
        && !resolutionIntegrityValid(db, storedRow, conflict.expectedVersion)
        ? pendingPublicRow(item)
        : item;
    }),
    ...storedRows.filter(row => !liveIds.has(row.conflict_id)).map(row => {
      const sourceSnapshot = identitySourceSnapshot(
        currentAliasesByName.get(row.normalized_name) || [],
        row.normalized_name,
      );
      const item = {
        ...publicRow(row),
        externalCustomerIds: sourceSnapshot.externalCustomerIds,
        aliases: sourceSnapshot.aliases,
        sourceExpectedVersion: sourceSnapshot.expectedVersion,
      };
      return row.status === 'resolved' && !resolutionIntegrityValid(
        db,
        row,
        sourceSnapshot.expectedVersion,
        sourceSnapshot.externalCustomerIds,
      )
        ? pendingPublicRow(item)
        : item;
    }),
  ].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))
    || left.conflictId.localeCompare(right.conflictId));
  const unresolved = rows.filter(row => row.status !== 'resolved').length;
  const filtered = rows.filter(row => {
    if (status === 'unresolved' && row.status === 'resolved') return false;
    if (!['all', 'unresolved'].includes(status) && row.status !== status) return false;
    if (!query) return true;
    const searchable = [
      row.normalizedName,
      ...row.externalCustomerIds,
      ...row.aliases.flatMap(alias => [alias.rawName, alias.source, alias.sourceRowId]),
    ].join('\n').toLocaleLowerCase('und');
    return searchable.includes(query);
  });
  const start = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);
  const historyByConflict = new Map();
  if (pageRows.length) {
    for (const audit of db.prepare(`SELECT conflict_id,actor_id,decision,
      target_external_customer_id,expected_version,source_version,details_json,
      evidence_json,before_json,after_json,created_at
      FROM crm_customer_identity_conflict_audit
      ORDER BY created_at DESC,rowid DESC`).all()) {
      if (!historyByConflict.has(audit.conflict_id)) historyByConflict.set(audit.conflict_id, []);
      historyByConflict.get(audit.conflict_id).push(publicAuditHistory(audit));
    }
  }
  return {
    items: pageRows.map(row => ({
      ...row,
      history: historyByConflict.get(row.conflictId) || [],
    })),
    page,
    pageSize: PAGE_SIZE,
    total: filtered.length,
    totalPages: Math.ceil(filtered.length / PAGE_SIZE),
    hasMore: start + PAGE_SIZE < filtered.length,
    unresolved,
  };
}

function validateDecision(input) {
  const decision = String(input || '').trim();
  if (!DECISIONS.has(decision)) {
    throw privateError(
      '裁决类型无效',
      'PROTECTED_IDENTITY_CONFLICT_DECISION_INVALID',
      422,
    );
  }
  return decision;
}

function conflictNotFound(conflictId) {
  return privateError(
    '身份冲突不存在或已不可用',
    'PROTECTED_IDENTITY_CONFLICT_NOT_FOUND',
    404,
    { conflictId },
  );
}

function stateSnapshot(row) {
  return {
    status: row.status,
    decision: row.decision,
    targetExternalCustomerId: row.target_external_customer_id,
    expectedVersion: row.expected_version,
    sourceExpectedVersion: row.latest_source_version,
    version: row.version,
  };
}

function ensureRegistryOwner(db, row, targetExternalCustomerId, timestamp) {
  const existing = db.prepare(`SELECT external_customer_id
    FROM crm_customer_identity_registry WHERE normalized_name=?`).get(row.normalized_name);
  if (existing && existing.external_customer_id !== targetExternalCustomerId) {
    throw privateError(
      '该身份已有其他稳定客户归属',
      'PROTECTED_IDENTITY_CONFLICT_OWNER_EXISTS',
      409,
      { conflictId: row.conflict_id },
    );
  }
  if (!existing) {
    db.prepare(`INSERT INTO crm_customer_identity_registry
      (normalized_name,external_customer_id,source,first_seen_at,updated_at)
      VALUES (?,?,?,?,?)`).run(
      row.normalized_name,
      targetExternalCustomerId,
      'identity_conflict_resolution',
      timestamp,
      timestamp,
    );
  }
}

function validateTarget(row, decision, targetExternalCustomerId, liveConflict, liveReport) {
  if (decision === 'supplement_and_retry') {
    if (targetExternalCustomerId) {
      throw privateError(
        '补充资料决策不能指定客户归属',
        'PROTECTED_IDENTITY_CONFLICT_TARGET_INVALID',
        422,
      );
    }
    return '';
  }
  if (!targetExternalCustomerId) {
    throw privateError(
      '必须明确选择稳定客户编号',
      'PROTECTED_IDENTITY_CONFLICT_TARGET_REQUIRED',
      422,
    );
  }
  if (decision === 'link_existing') {
    const latestCandidates = parseJson(row.latest_external_customer_ids_json, []);
    if (!latestCandidates.includes(targetExternalCustomerId)) {
      throw privateError(
        '所选稳定客户编号不属于该冲突',
        'PROTECTED_IDENTITY_CONFLICT_TARGET_INVALID',
        422,
      );
    }
    if (!liveConflict || !liveConflict.externalCustomerIds.includes(targetExternalCustomerId)) {
      throw privateError(
        '冲突证据已经变化，请重新载入',
        'PROTECTED_IDENTITY_CONFLICT_VERSION_STALE',
        409,
      );
    }
    return targetExternalCustomerId;
  }

  if (liveConflict) {
    throw privateError(
      '当前标准身份仍存在冲突',
      'PROTECTED_IDENTITY_CONFLICT_STILL_PRESENT',
      409,
    );
  }
  const liveIds = [...new Set(liveReport.aliases
    .filter(alias => alias.normalizedName === row.normalized_name)
    .map(alias => alias.externalCustomerId))];
  if (liveIds.length !== 1 || liveIds[0] !== targetExternalCustomerId) {
    throw privateError(
      '补充后的身份资料尚不能确认唯一客户',
      'PROTECTED_IDENTITY_CONFLICT_CONFIRMATION_INVALID',
      409,
    );
  }
  return targetExternalCustomerId;
}

function resolveProtectedIdentityConflict(db, user, payload = {}) {
  assertConflictManager(user);
  assertProtectedCustomerWritesEnabled(process.env);
  const conflictId = String(payload.conflictId || '').trim();
  const decision = validateDecision(payload.decision);
  const details = detailsValue(payload.details);
  const expectedVersion = String(payload.expectedVersion || '').trim();
  const requestedTarget = String(payload.targetExternalCustomerId || '').trim();
  if (!conflictId) throw conflictNotFound('');
  if (!expectedVersion) {
    throw privateError(
      '缺少冲突版本',
      'PROTECTED_IDENTITY_CONFLICT_VERSION_REQUIRED',
      422,
    );
  }
  const requestHash = `sha256:${digest({
    conflictId,
    decision,
    targetExternalCustomerId: requestedTarget,
    details,
    expectedVersion,
  })}`;

  return db.transaction(() => {
    installProtectedCustomerConflicts(db);
    const liveReport = auditProtectedCustomerIdentities(db, { apply: false });
    const timestamp = nowText();
    for (const current of liveReport.conflicts) insertNewConflict(db, current, timestamp);
    syncCurrentConflictsInTransaction(db);

    const row = db.prepare(`SELECT * FROM crm_customer_identity_conflicts
      WHERE conflict_id=?`).get(conflictId);
    if (!row) throw conflictNotFound(conflictId);
    const previousAudit = db.prepare(`SELECT decision,target_external_customer_id,
      source_version,after_json,result_json
      FROM crm_customer_identity_conflict_audit WHERE request_hash=?`).get(requestHash);
    if (previousAudit) {
      const previousResult = parseJson(previousAudit.result_json, {});
      if (row.expected_version === previousResult.expectedVersion
          && row.status === previousResult.status) {
        const liveConflict = liveReport.conflicts.find(item => item.conflictId === conflictId);
        const currentSource = liveConflict || identitySourceSnapshot(
          liveReport.aliases.filter(alias => alias.normalizedName === row.normalized_name),
          row.normalized_name,
        );
        const integrityValid = row.status === 'retry'
          ? retryIntegrityValid(row, previousAudit)
          : resolutionIntegrityValid(
            db,
            row,
            currentSource.expectedVersion,
            liveConflict ? null : currentSource.externalCustomerIds,
          );
        if (!integrityValid) {
          throw privateError(
            '身份冲突裁决完整性校验失败',
            'PROTECTED_IDENTITY_CONFLICT_INTEGRITY_INVALID',
            409,
            { conflictId },
          );
        }
        return { ...previousResult, idempotent: true };
      }
    }
    if (row.expected_version !== expectedVersion) {
      throw privateError(
        '冲突版本已变化，请重新载入',
        'PROTECTED_IDENTITY_CONFLICT_VERSION_STALE',
        409,
        { conflictId },
      );
    }
    const liveConflict = liveReport.conflicts.find(item => item.conflictId === conflictId);
    const currentSource = liveConflict || identitySourceSnapshot(
      liveReport.aliases.filter(alias => alias.normalizedName === row.normalized_name),
      row.normalized_name,
    );
    const decisionRow = {
      ...row,
      latest_source_version: currentSource.expectedVersion,
      latest_evidence_json: snapshotEvidence(currentSource),
      latest_external_customer_ids_json: stableJson(currentSource.externalCustomerIds),
    };
    const targetExternalCustomerId = validateTarget(
      decisionRow,
      decision,
      requestedTarget,
      liveConflict,
      liveReport,
    );
    const before = stateSnapshot(decisionRow);
    const version = row.version + 1;
    const status = decision === 'supplement_and_retry' ? 'retry' : 'resolved';
    const nextExpectedVersion = nextStateVersion(
      decisionRow,
      decision,
      targetExternalCustomerId,
      details,
      version,
      currentSource.expectedVersion,
    );
    if (status === 'resolved') {
      ensureRegistryOwner(db, decisionRow, targetExternalCustomerId, timestamp);
    }
    const resolvedAt = status === 'resolved' ? timestamp : '';
    const resolvedSourceVersion = status === 'resolved'
      ? currentSource.expectedVersion
      : '';
    db.prepare(`UPDATE crm_customer_identity_conflicts
      SET latest_source_version=?,latest_evidence_json=?,latest_external_customer_ids_json=?,
          status=?,decision=?,target_external_customer_id=?,details_json=?,version=?,
          expected_version=?,resolved_source_version=?,resolved_by=?,resolved_at=?,updated_at=?
      WHERE conflict_id=?`).run(
      currentSource.expectedVersion,
      decisionRow.latest_evidence_json,
      decisionRow.latest_external_customer_ids_json,
      status,
      decision,
      targetExternalCustomerId,
      stableJson(details),
      version,
      nextExpectedVersion,
      resolvedSourceVersion,
      String(user.id || ''),
      resolvedAt,
      timestamp,
      conflictId,
    );
    const updated = db.prepare(`SELECT * FROM crm_customer_identity_conflicts
      WHERE conflict_id=?`).get(conflictId);
    const after = stateSnapshot(updated);
    const result = {
      conflictId,
      status,
      decision,
      targetExternalCustomerId,
      expectedVersion: nextExpectedVersion,
      version,
      idempotent: false,
      resolvedAt,
    };
    db.prepare(`INSERT INTO crm_customer_identity_conflict_audit
      (id,conflict_id,request_hash,actor_id,decision,target_external_customer_id,
       expected_version,source_version,details_json,evidence_json,before_json,
       after_json,result_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(),
      conflictId,
      requestHash,
      String(user.id || ''),
      decision,
      targetExternalCustomerId,
      expectedVersion,
      currentSource.expectedVersion,
      stableJson(details),
      decisionRow.latest_evidence_json,
      stableJson(before),
      stableJson(after),
      stableJson(result),
      timestamp,
    );
    return result;
  }).immediate();
}

module.exports = {
  installProtectedCustomerConflicts,
  listProtectedIdentityConflicts,
  resolveProtectedIdentityConflict,
};
