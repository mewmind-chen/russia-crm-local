'use strict';

const crypto = require('node:crypto');

const REPORT_SCHEMA_VERSION = 'protected-customer-identity-preflight/v1';
const SOURCE_SPECS = Object.freeze([
  {
    table: 'customer_pool',
    primaryKey: 'customer_id',
    externalCustomerId: 'customer_id',
    names: ['company_name', 'nickname'],
  },
  {
    table: 'crm_accounts',
    primaryKey: 'id',
    externalCustomerId: 'external_customer_id',
    names: ['company_name', 'nickname'],
  },
  {
    table: 'customer_nickname_audit',
    primaryKey: 'id',
    externalCustomerId: 'external_customer_id',
    names: ['old_nickname', 'new_nickname'],
  },
]);
const MIGRATION_CANDIDATE_SOURCE = Object.freeze({
  table: 'customer_nickname_migration_audit',
  primaryKey: 'external_customer_id',
  externalCustomerId: 'external_customer_id',
  column: 'candidates_json',
});

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function hasTable(db, table) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
}

function tableColumns(db, table) {
  if (!hasTable(db, table)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function normalizeCustomerName(input) {
  return String(input ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('und');
}

function explicitBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function protectedCustomerWritesEnabled(env = process.env) {
  return explicitBoolean(env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED);
}

function internalError(message, code, statusCode, metadata = {}) {
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

function assertProtectedCustomerWritesEnabled(env = process.env) {
  if (protectedCustomerWritesEnabled(env)) return true;
  throw internalError(
    'Protected customer writes are disabled',
    'PROTECTED_CUSTOMER_WRITES_DISABLED',
    409,
  );
}

function installCustomerIdentityRegistry(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_customer_identity_registry (
      normalized_name TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL,
      source TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crm_customer_identity_migration_reports (
      id TEXT PRIMARY KEY,
      scanned_at TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      conflicts_json TEXT NOT NULL DEFAULT '[]',
      unresolved INTEGER NOT NULL DEFAULT 0 CHECK(unresolved >= 0)
    );
    CREATE TABLE IF NOT EXISTS crm_customer_identity_audit (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      normalized_name TEXT NOT NULL DEFAULT '',
      external_customer_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
}

function identityConflict(normalizedName) {
  return internalError(
    '客户身份名称已被其他稳定客户占用',
    'CUSTOMER_IDENTITY_CONFLICT',
    409,
    { normalizedName },
  );
}

function identityNameTombstoned(normalizedName) {
  return internalError(
    '客户身份名称正在等待管理员重新确认',
    'CUSTOMER_IDENTITY_NAME_TOMBSTONED',
    409,
    { normalizedName },
  );
}

function reserveCustomerIdentity(db, payload = {}) {
  const normalizedName = normalizeCustomerName(payload.name);
  if (!normalizedName) return { normalizedName: '', created: false };
  assertProtectedCustomerWritesEnabled(process.env);

  const externalCustomerId = String(payload.externalCustomerId || '').trim();
  const source = String(payload.source || '').trim();
  const actorId = String(payload.actorId || '').trim();
  if (!externalCustomerId) throw new Error('externalCustomerId is required');
  if (!source) throw new Error('source is required');

  const reserve = db.transaction(() => {
    if (hasTable(db, 'crm_customer_identity_name_tombstones')) {
      const tombstone = db.prepare(`SELECT 1 FROM crm_customer_identity_name_tombstones
        WHERE normalized_name=? AND released_at=''`).get(normalizedName);
      if (tombstone) throw identityNameTombstoned(normalizedName);
    }
    const existing = db.prepare(`SELECT external_customer_id
      FROM crm_customer_identity_registry WHERE normalized_name=?`).get(normalizedName);
    if (existing && existing.external_customer_id !== externalCustomerId) {
      throw identityConflict(normalizedName);
    }

    const timestamp = nowText();
    let created = false;
    if (!existing) {
      db.prepare(`INSERT INTO crm_customer_identity_registry
        (normalized_name,external_customer_id,source,first_seen_at,updated_at)
        VALUES (?,?,?,?,?)`).run(
        normalizedName, externalCustomerId, source, timestamp, timestamp,
      );
      created = true;
    } else {
      db.prepare(`UPDATE crm_customer_identity_registry SET updated_at=?
        WHERE normalized_name=?`).run(timestamp, normalizedName);
    }

    if (hasTable(db, 'crm_customer_identity_audit')) {
      db.prepare(`INSERT INTO crm_customer_identity_audit
        (id,action,normalized_name,external_customer_id,source,actor_id,detail_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        crypto.randomUUID(),
        created ? 'identity_reserved' : 'identity_reobserved',
        normalizedName,
        externalCustomerId,
        source,
        actorId,
        JSON.stringify({ created }),
        timestamp,
      );
    }
    return { normalizedName, created };
  });

  return reserve.immediate();
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function aliasCompare(left, right) {
  return compareText(left.normalizedName, right.normalizedName)
    || compareText(left.externalCustomerId, right.externalCustomerId)
    || compareText(left.source, right.source)
    || compareText(left.sourceRowId, right.sourceRowId)
    || compareText(left.sourceCandidateId, right.sourceCandidateId)
    || compareText(left.rawName, right.rawName);
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function addAlias(aliases, seen, input) {
  const externalCustomerId = String(input.externalCustomerId || '').trim();
  const rawName = String(input.rawName || '');
  const normalizedName = normalizeCustomerName(rawName);
  const sourceRowId = String(input.sourceRowId || '').trim();
  if (!externalCustomerId || !normalizedName || !sourceRowId) return;
  const sourceCandidateId = String(input.sourceCandidateId || '');
  const sourceEvidence = input.sourceEvidence || {
    externalCustomerId,
    rawName,
    sourceColumn: input.sourceColumn,
    sourceRowId,
    sourceTable: input.sourceTable,
  };
  const alias = {
    normalizedName,
    externalCustomerId,
    source: `${input.sourceTable}.${input.sourceColumn}`,
    sourceTable: input.sourceTable,
    sourceColumn: input.sourceColumn,
    sourceRowId,
    sourcePrimaryKey: {
      column: input.primaryKey,
      value: sourceRowId,
    },
    sourceCandidateId,
    sourceEvidenceHash: `sha256:${digest(sourceEvidence)}`,
    rawName,
  };
  const key = JSON.stringify(alias);
  if (seen.has(key)) return;
  seen.add(key);
  aliases.push(alias);
}

function invalidMigrationCandidates(sourceRowId) {
  return internalError(
    'Legacy customer nickname candidate evidence is invalid',
    'CUSTOMER_IDENTITY_CANDIDATES_JSON_INVALID',
    422,
    {
      source: `${MIGRATION_CANDIDATE_SOURCE.table}.${MIGRATION_CANDIDATE_SOURCE.column}`,
      sourceRowId,
    },
  );
}

function collectMigrationCandidateAliases(db, aliases, seen) {
  const spec = MIGRATION_CANDIDATE_SOURCE;
  const columns = tableColumns(db, spec.table);
  if (![spec.primaryKey, spec.externalCustomerId, spec.column]
    .every(column => columns.has(column))) return;
  const rows = db.prepare(`SELECT ${spec.primaryKey} source_row_id,
    ${spec.externalCustomerId} external_customer_id, ${spec.column} candidates_json
    FROM ${spec.table} ORDER BY ${spec.primaryKey}`).all();
  for (const row of rows) {
    const sourceRowId = String(row.source_row_id || '').trim();
    let candidates;
    try {
      candidates = JSON.parse(String(row.candidates_json || ''));
    } catch {
      throw invalidMigrationCandidates(sourceRowId);
    }
    if (!Array.isArray(candidates)) {
      throw invalidMigrationCandidates(sourceRowId);
    }
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
        || ['accountId', 'nickname', 'updatedAt', 'createdAt']
          .some(key => typeof candidate[key] !== 'string')
        || !candidate.accountId.trim()) {
        throw invalidMigrationCandidates(sourceRowId);
      }
      const sourceEvidence = {
        accountId: candidate.accountId.trim(),
        nickname: candidate.nickname,
        updatedAt: candidate.updatedAt.trim(),
        createdAt: candidate.createdAt.trim(),
      };
      addAlias(aliases, seen, {
        externalCustomerId: row.external_customer_id,
        rawName: candidate.nickname,
        sourceTable: spec.table,
        sourceColumn: spec.column,
        primaryKey: spec.primaryKey,
        sourceRowId,
        sourceCandidateId: sourceEvidence.accountId,
        sourceEvidence,
      });
    }
  }
}

function collectAliases(db) {
  const aliases = [];
  const seen = new Set();
  for (const spec of SOURCE_SPECS) {
    const columns = tableColumns(db, spec.table);
    if (!columns.has(spec.primaryKey) || !columns.has(spec.externalCustomerId)) continue;
    for (const nameColumn of spec.names) {
      if (!columns.has(nameColumn)) continue;
      const rows = db.prepare(`SELECT ${spec.primaryKey} source_row_id,
        ${spec.externalCustomerId} external_customer_id, ${nameColumn} raw_name
        FROM ${spec.table}`).all();
      for (const row of rows) {
        addAlias(aliases, seen, {
          externalCustomerId: row.external_customer_id,
          rawName: row.raw_name,
          sourceTable: spec.table,
          sourceColumn: nameColumn,
          primaryKey: spec.primaryKey,
          sourceRowId: row.source_row_id,
        });
      }
    }
  }
  collectMigrationCandidateAliases(db, aliases, seen);
  return aliases.sort(aliasCompare);
}

function identitySourceSnapshot(rows, normalizedName) {
  const externalCustomerIds = [...new Set(rows.map(row => row.externalCustomerId))]
    .sort(compareText);
  const evidence = rows.map(row => ({
    externalCustomerId: row.externalCustomerId,
    source: row.source,
    sourceTable: row.sourceTable,
    sourceColumn: row.sourceColumn,
    sourceRowId: row.sourceRowId,
    sourcePrimaryKey: row.sourcePrimaryKey,
    sourceCandidateId: row.sourceCandidateId,
    sourceEvidenceHash: row.sourceEvidenceHash,
    rawName: row.rawName,
  }));
  const versionEvidence = { normalizedName, externalCustomerIds, aliases: evidence };
  return {
    conflictId: `identity-conflict:${digest(normalizedName)}`,
    expectedVersion: `sha256:${digest(versionEvidence)}`,
    normalizedName,
    externalCustomerIds,
    aliases: evidence,
  };
}

function effectiveConflictResolutions(db, conflicts) {
  if (!hasTable(db, 'crm_customer_identity_conflicts')
      || !hasTable(db, 'crm_customer_identity_registry')
      || !hasTable(db, 'crm_customer_identity_conflict_audit')) return [];
  const columns = tableColumns(db, 'crm_customer_identity_conflicts');
  if (!['conflict_id', 'status', 'decision', 'resolved_source_version', 'target_external_customer_id']
    .every(column => columns.has(column))) return [];
  const currentConflicts = new Map(conflicts.map(conflict => [conflict.conflictId, conflict]));
  return db.prepare(`SELECT conflict_id,decision,resolved_source_version,
        target_external_customer_id
      FROM crm_customer_identity_conflicts
      WHERE status='resolved' AND decision IN ('link_existing','confirm_new')
      ORDER BY conflict_id`).all()
    .filter(row => {
      const conflict = currentConflicts.get(row.conflict_id);
      if (!conflict || conflict.expectedVersion !== row.resolved_source_version) return false;
      if (activeNameTombstone(db, conflict.normalizedName)) return false;
      const owner = db.prepare(`SELECT external_customer_id
        FROM crm_customer_identity_registry WHERE normalized_name=?`)
        .get(conflict.normalizedName);
      if (!owner || owner.external_customer_id !== row.target_external_customer_id) return false;
      return Boolean(db.prepare(`SELECT 1 FROM crm_customer_identity_conflict_audit
        WHERE conflict_id=? AND decision=? AND target_external_customer_id=?
          AND source_version=? LIMIT 1`).get(
        row.conflict_id,
        row.decision,
        row.target_external_customer_id,
        row.resolved_source_version,
      ));
    })
    .map(row => ({
      conflictId: row.conflict_id,
      decision: row.decision,
      resolvedSourceVersion: row.resolved_source_version,
    }));
}

function activeNameTombstone(db, normalizedName) {
  if (!hasTable(db, 'crm_customer_identity_name_tombstones')) return null;
  const columns = tableColumns(db, 'crm_customer_identity_name_tombstones');
  if (!['normalized_name', 'origin_conflict_id', 'origin_source_version',
    'origin_audit_id', 'anchor_external_customer_id', 'resolution_audit_id',
    'version', 'released_at']
    .every(column => columns.has(column))) return null;
  return db.prepare(`SELECT normalized_name,origin_conflict_id,origin_source_version,
      origin_audit_id,anchor_external_customer_id,resolution_audit_id,version
    FROM crm_customer_identity_name_tombstones
    WHERE normalized_name=? AND released_at=''`).get(normalizedName) || null;
}

function tombstoneIntegrityError(db, row, tombstone) {
  if (row.decision !== 'confirm_new'
      || tombstone.origin_conflict_id !== row.conflict_id
      || tombstone.anchor_external_customer_id !== row.target_external_customer_id) {
    return { conflictId: row.conflict_id, reason: 'name_tombstone_mismatch' };
  }
  const audit = db.prepare(`SELECT conflict_id,decision,target_external_customer_id,
      source_version FROM crm_customer_identity_conflict_audit WHERE id=?`).get(
    tombstone.resolution_audit_id,
  );
  if (!audit
      || audit.conflict_id !== row.conflict_id
      || audit.decision !== 'confirm_new'
      || audit.target_external_customer_id !== row.target_external_customer_id
      || audit.source_version !== row.resolved_source_version) {
    return { conflictId: row.conflict_id, reason: 'name_tombstone_audit_invalid' };
  }
  const originAudit = db.prepare(`SELECT conflict_id,decision,target_external_customer_id,
      source_version,evidence_json FROM crm_customer_identity_conflict_audit WHERE id=?`).get(
    tombstone.origin_audit_id,
  );
  let originEvidence = {};
  try { originEvidence = JSON.parse(originAudit?.evidence_json || '{}'); }
  catch { originEvidence = {}; }
  if (!originAudit
      || originAudit.conflict_id !== row.conflict_id
      || originAudit.decision !== 'supplement_and_retry'
      || originAudit.target_external_customer_id
      || originAudit.source_version !== tombstone.origin_source_version
      || originEvidence.expectedVersion !== tombstone.origin_source_version
      || !Array.isArray(originEvidence.externalCustomerIds)
      || !originEvidence.externalCustomerIds.includes(row.target_external_customer_id)) {
    return { conflictId: row.conflict_id, reason: 'name_tombstone_origin_invalid' };
  }
  const owner = db.prepare(`SELECT 1 FROM crm_customer_identity_registry
    WHERE normalized_name=?`).get(row.normalized_name);
  if (owner) return { conflictId: row.conflict_id, reason: 'name_tombstone_owner_present' };
  return null;
}

function invalidResolvedMappings(db, conflicts, aliases) {
  if (!hasTable(db, 'crm_customer_identity_conflicts')
      || !hasTable(db, 'crm_customer_identity_registry')
      || !hasTable(db, 'crm_customer_identity_conflict_audit')) return [];
  const columns = tableColumns(db, 'crm_customer_identity_conflicts');
  if (!['conflict_id', 'normalized_name', 'status', 'decision', 'resolved_source_version',
    'target_external_customer_id'].every(column => columns.has(column))) return [];
  const liveIds = new Set(conflicts.map(conflict => conflict.conflictId));
  const currentIdsByName = new Map();
  for (const alias of aliases) {
    if (!currentIdsByName.has(alias.normalizedName)) currentIdsByName.set(alias.normalizedName, []);
    currentIdsByName.get(alias.normalizedName).push(alias.externalCustomerId);
  }
  return db.prepare(`SELECT conflict_id,normalized_name,decision,resolved_source_version,
      target_external_customer_id
    FROM crm_customer_identity_conflicts
    WHERE status='resolved' AND decision IN ('link_existing','confirm_new')
    ORDER BY conflict_id`).all()
    .filter(row => !liveIds.has(row.conflict_id))
    .map(row => {
      const tombstone = activeNameTombstone(db, row.normalized_name);
      if (tombstone) return tombstoneIntegrityError(db, row, tombstone);
      const owner = db.prepare(`SELECT external_customer_id
        FROM crm_customer_identity_registry WHERE normalized_name=?`).get(row.normalized_name);
      if (!owner || owner.external_customer_id !== row.target_external_customer_id) {
        return { conflictId: row.conflict_id, reason: 'registry_owner_mismatch' };
      }
      const audit = db.prepare(`SELECT 1 FROM crm_customer_identity_conflict_audit
        WHERE conflict_id=? AND decision=? AND target_external_customer_id=?
          AND source_version=? LIMIT 1`).get(
        row.conflict_id,
        row.decision,
        row.target_external_customer_id,
        row.resolved_source_version,
      );
      if (!audit) return { conflictId: row.conflict_id, reason: 'resolution_audit_missing' };
      const currentIds = [...new Set(currentIdsByName.get(row.normalized_name) || [])]
        .sort(compareText);
      if (currentIds.length !== 1 || currentIds[0] !== row.target_external_customer_id) {
        return { conflictId: row.conflict_id, reason: 'current_source_owner_mismatch' };
      }
      const sourceSnapshot = identitySourceSnapshot(
        aliases.filter(alias => alias.normalizedName === row.normalized_name),
        row.normalized_name,
      );
      if (sourceSnapshot.expectedVersion !== row.resolved_source_version) {
        return { conflictId: row.conflict_id, reason: 'current_source_version_mismatch' };
      }
      return null;
    })
    .filter(Boolean);
}

function reopenedNameTombstones(db, aliases) {
  if (!hasTable(db, 'crm_customer_identity_name_tombstones')) return [];
  const columns = tableColumns(db, 'crm_customer_identity_name_tombstones');
  if (!['normalized_name', 'origin_conflict_id', 'released_at']
    .every(column => columns.has(column))) return [];
  const aliasesByName = new Map();
  for (const alias of aliases) {
    if (!aliasesByName.has(alias.normalizedName)) aliasesByName.set(alias.normalizedName, []);
    aliasesByName.get(alias.normalizedName).push(alias.externalCustomerId);
  }
  return db.prepare(`SELECT normalized_name,origin_conflict_id
    FROM crm_customer_identity_name_tombstones
    WHERE released_at='' ORDER BY normalized_name`).all()
    .map(row => ({
      conflictId: row.origin_conflict_id,
      normalizedName: row.normalized_name,
      externalCustomerIds: [...new Set(aliasesByName.get(row.normalized_name) || [])]
        .sort(compareText),
    }))
    .filter(row => row.externalCustomerIds.length > 0);
}

function nameTombstoneEvidence(db) {
  if (!hasTable(db, 'crm_customer_identity_name_tombstones')) return [];
  const columns = tableColumns(db, 'crm_customer_identity_name_tombstones');
  if (!['normalized_name', 'origin_conflict_id', 'origin_source_version',
    'origin_audit_id', 'anchor_external_customer_id', 'resolution_audit_id',
    'version', 'released_at']
    .every(column => columns.has(column))) return [];
  return db.prepare(`SELECT normalized_name normalizedName,
      origin_conflict_id originConflictId,origin_source_version originSourceVersion,
      origin_audit_id originAuditId,anchor_external_customer_id anchorExternalCustomerId,
      resolution_audit_id resolutionAuditId,version,released_at releasedAt
    FROM crm_customer_identity_name_tombstones ORDER BY normalized_name`).all();
}

function storedUnresolvedConflicts(db, conflicts) {
  if (!hasTable(db, 'crm_customer_identity_conflicts')) return [];
  const columns = tableColumns(db, 'crm_customer_identity_conflicts');
  if (!['conflict_id', 'status'].every(column => columns.has(column))) return [];
  const liveIds = new Set(conflicts.map(conflict => conflict.conflictId));
  return db.prepare(`SELECT conflict_id,status FROM crm_customer_identity_conflicts
    WHERE status IN ('pending','retry') ORDER BY conflict_id`).all()
    .filter(row => !liveIds.has(row.conflict_id))
    .map(row => ({ conflictId: row.conflict_id, status: row.status }));
}

function auditProtectedCustomerIdentities(db, options = {}) {
  if (options.apply) {
    throw new Error('Identity preflight is read-only; apply is not supported');
  }
  const aliases = collectAliases(db);
  const grouped = new Map();
  for (const alias of aliases) {
    const values = grouped.get(alias.normalizedName) || [];
    values.push(alias);
    grouped.set(alias.normalizedName, values);
  }
  const conflicts = [];
  for (const [normalizedName, rows] of grouped) {
    const snapshot = identitySourceSnapshot(rows, normalizedName);
    if (snapshot.externalCustomerIds.length < 2) continue;
    conflicts.push(snapshot);
  }
  conflicts.sort((left, right) => compareText(left.normalizedName, right.normalizedName));
  const effectiveResolutions = effectiveConflictResolutions(db, conflicts);
  const invalidResolutions = invalidResolvedMappings(db, conflicts, aliases);
  const storedUnresolved = storedUnresolvedConflicts(db, conflicts);
  const reopenedTombstones = reopenedNameTombstones(db, aliases);
  const tombstones = nameTombstoneEvidence(db);
  const liveConflictIds = new Set(conflicts.map(conflict => conflict.conflictId));
  const invalidIds = new Set(invalidResolutions.map(item => item.conflictId));
  const reopenedOnly = reopenedTombstones.filter(item =>
    !liveConflictIds.has(item.conflictId) && !invalidIds.has(item.conflictId));
  const reportEvidence = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    aliases,
    conflicts,
  };
  if (effectiveResolutions.length) reportEvidence.effectiveResolutions = effectiveResolutions;
  if (invalidResolutions.length) reportEvidence.invalidResolutions = invalidResolutions;
  if (storedUnresolved.length) reportEvidence.storedUnresolved = storedUnresolved;
  if (reopenedTombstones.length) reportEvidence.reopenedTombstones = reopenedTombstones;
  if (tombstones.length) reportEvidence.nameTombstones = tombstones;
  const reportVersion = `sha256:${digest(reportEvidence)}`;
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportVersion,
    aliases,
    conflicts,
    invalidResolutions,
    reopenedTombstones,
    storedUnresolved,
    unresolved: conflicts.length - effectiveResolutions.length
      + invalidResolutions.length + storedUnresolved.length + reopenedOnly.length,
  };
}

module.exports = {
  assertProtectedCustomerWritesEnabled,
  auditProtectedCustomerIdentities,
  identitySourceSnapshot,
  installCustomerIdentityRegistry,
  normalizeCustomerName,
  protectedCustomerWritesEnabled,
  reserveCustomerIdentity,
};
