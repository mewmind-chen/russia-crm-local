'use strict';

const crypto = require('node:crypto');

const FEATURE_DEFINITIONS = Object.freeze({
  ai_stations: Object.freeze({
    label: 'AI 工作站',
    env: 'CRM_AI_STATIONS_ENABLED',
    defaultOutsideProduction: true,
  }),
  customer_enrichment: Object.freeze({
    label: '客户资料补全',
    env: 'CRM_AI_CUSTOMER_ENRICHMENT_ENABLED',
    defaultOutsideProduction: false,
    requires: Object.freeze(['ai_stations']),
  }),
  customer_enrichment_auto_trigger: Object.freeze({
    label: '客户补全自动触发',
    env: 'CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED',
    defaultOutsideProduction: false,
    requires: Object.freeze(['ai_stations', 'customer_enrichment']),
  }),
  sales_pack: Object.freeze({
    label: '销售资料包',
    env: 'CRM_AI_SALES_PACK_ENABLED',
    defaultOutsideProduction: false,
    requires: Object.freeze(['ai_stations']),
  }),
});

function explicitBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function resolveAIHardFlags(options = {}, env = process.env) {
  const environment = String(options.environment ?? env.NODE_ENV ?? 'development').toLowerCase();
  return Object.freeze(Object.fromEntries(Object.entries(FEATURE_DEFINITIONS).map(([key, definition]) => {
    const fallback = environment === 'production' ? false : definition.defaultOutsideProduction;
    const configured = options[key] ?? env[definition.env];
    return [key, explicitBoolean(configured, fallback)];
  })));
}

function installAIFeatureFlagSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_ai_feature_flags (
      feature_key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);
  const insert = db.prepare(`INSERT OR IGNORE INTO crm_ai_feature_flags
    (feature_key,enabled,updated_by,updated_at) VALUES (?,1,'','')`);
  for (const key of Object.keys(FEATURE_DEFINITIONS)) insert.run(key);
}

function featureState(db, hardFlags = resolveAIHardFlags()) {
  installAIFeatureFlagSchema(db);
  const rows = new Map(db.prepare('SELECT * FROM crm_ai_feature_flags').all()
    .map(row => [row.feature_key, row]));
  const state = {};
  for (const [key, definition] of Object.entries(FEATURE_DEFINITIONS)) {
    const row = rows.get(key) || {};
    const hardEnabled = Boolean(hardFlags[key]);
    const runtimeEnabled = Boolean(row.enabled);
    const dependenciesEnabled = (definition.requires || []).every(required => state[required]?.effectiveEnabled);
    state[key] = Object.freeze({
      key,
      label: definition.label,
      environmentVariable: definition.env,
      hardEnabled,
      runtimeEnabled,
      effectiveEnabled: hardEnabled && runtimeEnabled && dependenciesEnabled,
      updatedBy: row.updated_by || '',
      updatedAt: row.updated_at || '',
    });
  }
  return Object.freeze(state);
}

function writeFeatureAudit(db, actorId, key, enabled, at) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_audit_log'").get();
  if (!table) return;
  db.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    `AUD-${crypto.randomUUID()}`,
    actorId,
    'ai_feature_flag_updated',
    'ai_feature_flag',
    key,
    JSON.stringify({ enabled: Boolean(enabled) }),
    at,
  );
}

function setFeatureFlag(db, input = {}, hardFlags = resolveAIHardFlags()) {
  const key = String(input.key || '').trim();
  const definition = FEATURE_DEFINITIONS[key];
  if (!definition) {
    const error = new Error('Unknown AI feature flag');
    error.statusCode = 404;
    error.code = 'AI_FEATURE_NOT_FOUND';
    throw error;
  }
  if (typeof input.enabled !== 'boolean') {
    const error = new Error('enabled must be a boolean');
    error.statusCode = 400;
    error.code = 'AI_FEATURE_VALUE_INVALID';
    throw error;
  }
  if (input.enabled && !hardFlags[key]) {
    const error = new Error(`${definition.env} is disabled by the environment`);
    error.statusCode = 409;
    error.code = 'AI_FEATURE_HARD_DISABLED';
    throw error;
  }
  installAIFeatureFlagSchema(db);
  const actorId = String(input.actorId || '').trim();
  const at = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE crm_ai_feature_flags
      SET enabled=?,updated_by=?,updated_at=? WHERE feature_key=?`)
      .run(input.enabled ? 1 : 0, actorId, at, key);
    writeFeatureAudit(db, actorId, key, input.enabled, at);
  });
  transaction.immediate();
  return featureState(db, hardFlags)[key];
}

function isFeatureEnabled(db, key, hardFlags = resolveAIHardFlags()) {
  return Boolean(featureState(db, hardFlags)[key]?.effectiveEnabled);
}

module.exports = {
  FEATURE_DEFINITIONS,
  explicitBoolean,
  featureState,
  installAIFeatureFlagSchema,
  isFeatureEnabled,
  resolveAIHardFlags,
  setFeatureFlag,
};
