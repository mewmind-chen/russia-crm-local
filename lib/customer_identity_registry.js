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
    const externalCustomerIds = [...new Set(rows.map(row => row.externalCustomerId))].sort(compareText);
    if (externalCustomerIds.length < 2) continue;
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
    conflicts.push({
      conflictId: `identity-conflict:${digest(normalizedName)}`,
      expectedVersion: `sha256:${digest(versionEvidence)}`,
      normalizedName,
      externalCustomerIds,
      aliases: evidence,
    });
  }
  conflicts.sort((left, right) => compareText(left.normalizedName, right.normalizedName));
  const reportVersion = `sha256:${digest({
    schemaVersion: REPORT_SCHEMA_VERSION,
    aliases,
    conflicts,
  })}`;
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportVersion,
    aliases,
    conflicts,
    unresolved: conflicts.length,
  };
}

module.exports = {
  assertProtectedCustomerWritesEnabled,
  auditProtectedCustomerIdentities,
  installCustomerIdentityRegistry,
  normalizeCustomerName,
  protectedCustomerWritesEnabled,
  reserveCustomerIdentity,
};
