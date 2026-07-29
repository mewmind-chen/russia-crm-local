const crypto = require('node:crypto');

const RULE_STRATEGIES = Object.freeze(['balanced', 'round_robin', 'fixed_priority']);
const RULE_TARGET_MODES = Object.freeze(['selected', 'all_authorized']);
const RULE_CONDITION_KEYS = Object.freeze([
  'countries',
  'industries',
  'products',
  'customerTypes',
  'tagIds',
  'matchGroups',
]);
const MATCH_GROUPS = new Set(['A', 'B', 'C', 'D']);
const SYSTEM_DEFAULT_RULE_ID = 'RULE-SYSTEM-DEFAULT';
const LEGACY_INITIAL_RULE_ID = 'RULE-LEGACY-INITIAL';
const STATE_ID = 'default';

function ruleError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function badRequest(message, code = 'INVALID_ASSIGNMENT_RULE') {
  return ruleError(400, message, code);
}

function forbidden(message, code = 'ASSIGNMENT_RULE_FORBIDDEN') {
  return ruleError(403, message, code);
}

function notFound(message) {
  return ruleError(404, message, 'ASSIGNMENT_RULE_NOT_FOUND');
}

function conflict(message, code = 'ASSIGNMENT_RULE_CONFLICT') {
  return ruleError(409, message, code);
}

function nowText(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid assignment rule clock value');
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (_error) {
    return fallback;
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertNoUnknownKeys(value, allowed, label) {
  if (!plainObject(value)) throw badRequest(`${label}必须是对象`);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw badRequest(`${label}包含不支持的字段：${unknown.join('、')}`);
}

function cleanRequiredText(value, label, maxLength) {
  const result = String(value ?? '').trim();
  if (!result) throw badRequest(`${label}不能为空`);
  if (result.length > maxLength) throw badRequest(`${label}最多${maxLength}个字符`);
  if (/[\u0000-\u001f\u007f]/.test(result)) throw badRequest(`${label}不能包含控制字符`);
  return result;
}

function cleanStringList(value, label, options = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest(`${label}必须是数组`);
  if (value.length > (options.maxItems || 100)) {
    throw badRequest(`${label}最多选择${options.maxItems || 100}项`);
  }
  const seen = new Set();
  const result = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw badRequest(`${label}只能包含文本值`);
    const item = raw.trim();
    if (!item) throw badRequest(`${label}不能包含空值`);
    if (item.length > (options.maxLength || 120)) {
      throw badRequest(`${label}中的单项最多${options.maxLength || 120}个字符`);
    }
    if (/[\u0000-\u001f\u007f]/.test(item)) throw badRequest(`${label}不能包含控制字符`);
    if (options.allowed && !options.allowed.has(item)) throw badRequest(`${label}包含无效值：${item}`);
    const key = item.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function normalizeConditions(input = {}) {
  assertNoUnknownKeys(input, RULE_CONDITION_KEYS, '规则条件');
  return {
    countries: cleanStringList(input.countries, '国家或地区'),
    industries: cleanStringList(input.industries, '行业'),
    products: cleanStringList(input.products, '重点产品'),
    customerTypes: cleanStringList(input.customerTypes, '客户类型'),
    tagIds: cleanStringList(input.tagIds, '客户标签', { maxLength: 80 }),
    matchGroups: cleanStringList(input.matchGroups, '匹配等级', {
      maxItems: 4,
      maxLength: 1,
      allowed: MATCH_GROUPS,
    }),
  };
}

function emptyConditions() {
  return Object.fromEntries(RULE_CONDITION_KEYS.map(key => [key, []]));
}

function normalizeDailyQuota(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 1000) {
    throw badRequest('每日额度必须是1到1000之间的整数，或留空使用系统默认额度');
  }
  return number;
}

function normalizeAssignmentRule(input, options = {}) {
  const allowed = [
    'id',
    'name',
    'enabled',
    'position',
    'conditions',
    'targetMode',
    'salesUserIds',
    'strategy',
    'dailyQuota',
    'isSystemDefault',
  ];
  assertNoUnknownKeys(input, allowed, '分配规则');
  const targetMode = String(input.targetMode || 'all_authorized').trim();
  if (!RULE_TARGET_MODES.includes(targetMode)) throw badRequest('请选择有效的候选销售范围');
  const strategy = String(input.strategy || 'balanced').trim();
  if (!RULE_STRATEGIES.includes(strategy)) throw badRequest('请选择有效的分配方式');
  const salesUserIds = cleanStringList(input.salesUserIds, '候选销售', {
    maxItems: 200,
    maxLength: 80,
  });
  if (targetMode === 'selected' && salesUserIds.length === 0) {
    throw badRequest('指定销售规则至少需要选择一名销售');
  }
  if (targetMode === 'all_authorized' && salesUserIds.length) {
    throw badRequest('全部授权销售规则不能同时提交指定销售名单');
  }
  const isSystemDefault = Boolean(options.forceSystemDefault || input.isSystemDefault);
  const rule = {
    id: cleanRequiredText(input.id || makeId('RULE'), '规则编号', 100),
    name: cleanRequiredText(input.name, '规则名称', 80),
    enabled: input.enabled !== false,
    position: Number.isInteger(Number(input.position)) && Number(input.position) >= 0
      ? Number(input.position)
      : 0,
    conditions: normalizeConditions(input.conditions || {}),
    targetMode,
    salesUserIds,
    strategy,
    dailyQuota: normalizeDailyQuota(input.dailyQuota),
    isSystemDefault,
  };
  if (isSystemDefault) {
    const hasConditions = RULE_CONDITION_KEYS.some(key => rule.conditions[key].length);
    if (!rule.enabled || hasConditions || rule.targetMode !== 'all_authorized'
      || rule.salesUserIds.length || rule.strategy !== 'balanced' || rule.dailyQuota !== null) {
      throw badRequest('系统默认规则必须保持启用、无条件、全部授权销售和负荷均衡');
    }
  }
  return rule;
}

function installIntakeAssignmentRules(db, options = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_intake_assignment_rule_state (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 1,
      draft_revision INTEGER NOT NULL DEFAULT 0,
      published_version_id TEXT NOT NULL DEFAULT '',
      next_version_number INTEGER NOT NULL DEFAULT 1,
      migrated_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crm_intake_assignment_rule_drafts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL,
      conditions_json TEXT NOT NULL,
      target_mode TEXT NOT NULL CHECK(target_mode IN ('selected','all_authorized')),
      sales_user_ids_json TEXT NOT NULL DEFAULT '[]',
      strategy TEXT NOT NULL CHECK(strategy IN ('balanced','round_robin','fixed_priority')),
      daily_quota INTEGER,
      is_system_default INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crm_intake_assignment_rule_default_idx
      ON crm_intake_assignment_rule_drafts(is_system_default) WHERE is_system_default=1;
    CREATE INDEX IF NOT EXISTS crm_intake_assignment_rule_order_idx
      ON crm_intake_assignment_rule_drafts(position,id);
    CREATE TABLE IF NOT EXISTS crm_intake_assignment_rule_versions (
      id TEXT PRIMARY KEY,
      version_number INTEGER NOT NULL UNIQUE,
      rules_json TEXT NOT NULL,
      change_summary_json TEXT NOT NULL DEFAULT '{}',
      published_by TEXT NOT NULL,
      published_at TEXT NOT NULL,
      restored_from_version_id TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS crm_intake_assignment_rule_versions_time_idx
      ON crm_intake_assignment_rule_versions(published_at DESC,version_number DESC);
    CREATE TABLE IF NOT EXISTS crm_intake_assignment_rule_usage (
      rule_id TEXT NOT NULL,
      rule_version_id TEXT NOT NULL,
      sales_user_id TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      assigned_count INTEGER NOT NULL DEFAULT 0 CHECK(assigned_count>=0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(rule_id,rule_version_id,sales_user_id,usage_date)
    );
    CREATE INDEX IF NOT EXISTS crm_intake_assignment_rule_usage_date_idx
      ON crm_intake_assignment_rule_usage(usage_date,rule_version_id,rule_id);
    CREATE TABLE IF NOT EXISTS crm_intake_assignment_rule_rotation (
      rule_id TEXT NOT NULL,
      rule_version_id TEXT NOT NULL,
      cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor>=0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(rule_id,rule_version_id)
    );
  `);
  const timestamp = nowText(options.now ? options.now() : new Date());
  db.prepare(`INSERT OR IGNORE INTO crm_intake_assignment_rule_state
    (id,schema_version,draft_revision,published_version_id,next_version_number,migrated_at,updated_at)
    VALUES (?,1,0,'',1,'',?)`).run(STATE_ID, timestamp);
  migrateLegacySettings(db, { ...options, timestamp });
}

function legacySettings(db) {
  if (!tableExists(db, 'crm_intake_settings')) {
    return { countries: [], matchGroups: ['A', 'B', 'C', 'D'] };
  }
  const row = db.prepare("SELECT countries_json,match_groups_json FROM crm_intake_settings WHERE id='default'").get();
  return {
    countries: cleanStringList(parseJson(row?.countries_json || '[]', []), '国家或地区'),
    matchGroups: cleanStringList(parseJson(row?.match_groups_json || '[]', []), '匹配等级', {
      maxItems: 4,
      maxLength: 1,
      allowed: MATCH_GROUPS,
    }),
  };
}

function insertDraftRow(db, rule, actorId, timestamp) {
  db.prepare(`INSERT INTO crm_intake_assignment_rule_drafts
    (id,name,enabled,position,conditions_json,target_mode,sales_user_ids_json,strategy,daily_quota,
     is_system_default,revision,created_by,created_at,updated_by,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).run(
    rule.id,
    rule.name,
    rule.enabled ? 1 : 0,
    rule.position,
    JSON.stringify(rule.conditions),
    rule.targetMode,
    JSON.stringify(rule.salesUserIds),
    rule.strategy,
    rule.dailyQuota,
    rule.isSystemDefault ? 1 : 0,
    actorId,
    timestamp,
    actorId,
    timestamp,
  );
}

function migrateLegacySettings(db, options = {}) {
  const existing = db.prepare('SELECT COUNT(*) count FROM crm_intake_assignment_rule_drafts').get().count;
  const versions = db.prepare('SELECT COUNT(*) count FROM crm_intake_assignment_rule_versions').get().count;
  const state = db.prepare('SELECT * FROM crm_intake_assignment_rule_state WHERE id=?').get(STATE_ID);
  if (existing || versions || state.migrated_at) return false;
  const timestamp = options.timestamp || nowText(options.now ? options.now() : new Date());
  const ids = typeof options.idFactory === 'function'
    ? options.idFactory
    : prefix => makeId(prefix);
  const old = legacySettings(db);
  const migratedRule = normalizeAssignmentRule({
    id: LEGACY_INITIAL_RULE_ID,
    name: '现有国家与匹配等级规则',
    enabled: true,
    position: 0,
    conditions: { ...emptyConditions(), countries: old.countries, matchGroups: old.matchGroups },
    targetMode: 'all_authorized',
    salesUserIds: [],
    strategy: 'balanced',
    dailyQuota: null,
  });
  const defaultRule = normalizeAssignmentRule({
    id: SYSTEM_DEFAULT_RULE_ID,
    name: '默认均衡分配',
    enabled: true,
    position: 1,
    conditions: emptyConditions(),
    targetMode: 'all_authorized',
    salesUserIds: [],
    strategy: 'balanced',
    dailyQuota: null,
    isSystemDefault: true,
  }, { forceSystemDefault: true });
  const transaction = db.transaction(() => {
    insertDraftRow(db, migratedRule, 'system:migration', timestamp);
    insertDraftRow(db, defaultRule, 'system:migration', timestamp);
    const rules = listDraftRules(db);
    const versionId = ids('RULEVER');
    db.prepare(`INSERT INTO crm_intake_assignment_rule_versions
      (id,version_number,rules_json,change_summary_json,published_by,published_at,restored_from_version_id)
      VALUES (?,1,?,?,?,?, '')`).run(
      versionId,
      JSON.stringify(rules),
      JSON.stringify({
        added: rules.map(rule => ({ id: rule.id, name: rule.name })),
        removed: [],
        changed: [],
        reordered: false,
        migratedFromLegacySettings: true,
      }),
      'system:migration',
      timestamp,
    );
    db.prepare(`UPDATE crm_intake_assignment_rule_state
      SET draft_revision=1,published_version_id=?,next_version_number=2,migrated_at=?,updated_at=?
      WHERE id=?`).run(versionId, timestamp, timestamp, STATE_ID);
  });
  transaction();
  return true;
}

function draftRowToRule(row) {
  return {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    position: Number(row.position),
    conditions: normalizeConditions(parseJson(row.conditions_json, {})),
    targetMode: row.target_mode,
    salesUserIds: cleanStringList(parseJson(row.sales_user_ids_json, []), '候选销售', {
      maxItems: 200,
      maxLength: 80,
    }),
    strategy: row.strategy,
    dailyQuota: row.daily_quota === null ? null : Number(row.daily_quota),
    isSystemDefault: Boolean(row.is_system_default),
    revision: Number(row.revision),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function listDraftRules(db) {
  return db.prepare(`SELECT * FROM crm_intake_assignment_rule_drafts
    ORDER BY position,id`).all().map(draftRowToRule);
}

function assignmentRuleState(db) {
  const row = db.prepare(`SELECT s.*,v.version_number,v.published_by,v.published_at
    FROM crm_intake_assignment_rule_state s
    LEFT JOIN crm_intake_assignment_rule_versions v ON v.id=s.published_version_id
    WHERE s.id=?`).get(STATE_ID);
  if (!row) throw new Error('Assignment rules are not installed');
  return {
    draftRevision: Number(row.draft_revision),
    publishedVersionId: row.published_version_id,
    publishedVersionNumber: row.version_number === null ? null : Number(row.version_number),
    publishedBy: row.published_by || '',
    publishedAt: row.published_at || '',
    migratedAt: row.migrated_at || '',
    updatedAt: row.updated_at,
  };
}

function versionRowToRecord(row, includeRules = true) {
  const record = {
    id: row.id,
    versionNumber: Number(row.version_number),
    changeSummary: parseJson(row.change_summary_json, {}),
    publishedBy: row.published_by,
    publishedAt: row.published_at,
    restoredFromVersionId: row.restored_from_version_id || '',
  };
  if (includeRules) record.rules = parseAndValidateRulesSnapshot(row.rules_json);
  return record;
}

function parseAndValidateRulesSnapshot(value) {
  const parsed = typeof value === 'string' ? parseJson(value, null) : value;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Invalid assignment rule version snapshot');
  }
  const rules = parsed.map((rule, index) => {
    const normalized = normalizeAssignmentRule({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      position: index,
      conditions: rule.conditions,
      targetMode: rule.targetMode,
      salesUserIds: rule.salesUserIds,
      strategy: rule.strategy,
      dailyQuota: rule.dailyQuota,
      isSystemDefault: rule.isSystemDefault,
    }, { forceSystemDefault: rule.id === SYSTEM_DEFAULT_RULE_ID || rule.isSystemDefault });
    return {
      ...normalized,
      revision: Number(rule.revision || 1),
      createdBy: String(rule.createdBy || ''),
      createdAt: String(rule.createdAt || ''),
      updatedBy: String(rule.updatedBy || ''),
      updatedAt: String(rule.updatedAt || ''),
    };
  });
  assertRuleCollection(rules);
  return rules;
}

function getPublishedRules(db) {
  const state = assignmentRuleState(db);
  if (!state.publishedVersionId) return { ...state, rules: [] };
  const row = db.prepare('SELECT * FROM crm_intake_assignment_rule_versions WHERE id=?')
    .get(state.publishedVersionId);
  if (!row) throw new Error(`Published assignment rule version not found: ${state.publishedVersionId}`);
  return {
    ...state,
    rules: parseAndValidateRulesSnapshot(row.rules_json).map(rule => ({
      ...rule,
      ruleVersionId: row.id,
      ruleVersionNumber: Number(row.version_number),
    })),
  };
}

function assertRuleCollection(rules) {
  if (!Array.isArray(rules) || rules.length === 0) throw badRequest('至少需要保留一条分配规则');
  if (rules.length > 200) throw badRequest('分配规则最多200条');
  const ids = new Set();
  let defaults = 0;
  for (const rule of rules) {
    if (ids.has(rule.id)) throw badRequest(`分配规则编号重复：${rule.id}`);
    ids.add(rule.id);
    if (rule.isSystemDefault) {
      defaults += 1;
      if (rule.id !== SYSTEM_DEFAULT_RULE_ID) throw badRequest('系统默认规则编号无效');
    }
  }
  if (defaults !== 1) throw badRequest('必须且只能保留一条系统默认规则');
  const last = rules[rules.length - 1];
  if (!last.isSystemDefault || !last.enabled) throw badRequest('系统默认规则必须启用并排在最后');
}

function assertExpectedRevision(db, expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null || expectedRevision === '') return;
  const expected = Number(expectedRevision);
  if (!Number.isInteger(expected) || expected < 0) throw badRequest('草稿版本号无效');
  const actual = assignmentRuleState(db).draftRevision;
  if (actual !== expected) {
    throw conflict('分配规则已被其他管理员修改，请刷新后重试', 'ASSIGNMENT_RULE_REVISION_CONFLICT');
  }
}

function validateSelectedSalesUsers(db, rules) {
  if (!tableExists(db, 'sales_users')) return;
  const ids = [...new Set(rules.flatMap(rule =>
    rule.targetMode === 'selected' ? rule.salesUserIds : []))];
  if (!ids.length) return;
  const rows = db.prepare(`SELECT id,role FROM sales_users WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);
  const roleById = new Map(rows.map(row => [row.id, row.role]));
  const invalid = ids.filter(id => roleById.get(id) !== 'sales');
  if (invalid.length) {
    throw badRequest(`候选销售不存在或不是销售账号：${invalid.join('、')}`, 'INVALID_RULE_SALES_USERS');
  }
}

function actorId(actor) {
  return cleanRequiredText(actor?.id, '操作人', 100);
}

function hasRulesPermissions(actor) {
  if (actor?.role === 'admin') return true;
  const permissions = plainObject(actor?.permissions) ? actor.permissions : {};
  return Boolean(permissions.view_intake && permissions.manage_intake);
}

function assertAssignmentRuleRead(actor) {
  if (!actor || !['admin', 'manager'].includes(actor.role) || !hasRulesPermissions(actor)) {
    throw forbidden('没有权限查看分配规则');
  }
}

function assertAssignmentRuleWrite(actor) {
  assertAssignmentRuleRead(actor);
  if (actor.role !== 'admin') throw forbidden('只有真实管理员可以修改分配规则');
  if (actor.isImpersonating) {
    throw forbidden('身份检查期间不能修改或发布分配规则', 'IMPERSONATION_ACTION_BLOCKED');
  }
}

function assertAssignmentRuleSimulation(actor) {
  assertAssignmentRuleRead(actor);
}

function touchDraftState(db, timestamp) {
  db.prepare(`UPDATE crm_intake_assignment_rule_state
    SET draft_revision=draft_revision+1,updated_at=? WHERE id=?`).run(timestamp, STATE_ID);
}

function createDraftRule(db, payload, actor, options = {}) {
  assertAssignmentRuleWrite(actor);
  assertNoUnknownKeys(payload, [
    'expectedRevision',
    'name',
    'enabled',
    'conditions',
    'targetMode',
    'salesUserIds',
    'strategy',
    'dailyQuota',
  ], '新建规则请求');
  const timestamp = nowText(options.now ? options.now() : new Date());
  const { expectedRevision, ...rulePayload } = payload;
  const rule = normalizeAssignmentRule({
    ...rulePayload,
    id: typeof options.idFactory === 'function' ? options.idFactory('RULE') : makeId('RULE'),
  });
  validateSelectedSalesUsers(db, [rule]);
  const transaction = db.transaction(() => {
    assertExpectedRevision(db, expectedRevision);
    const fallback = db.prepare(`SELECT position FROM crm_intake_assignment_rule_drafts
      WHERE is_system_default=1`).get();
    const position = fallback ? Number(fallback.position) : listDraftRules(db).length;
    db.prepare(`UPDATE crm_intake_assignment_rule_drafts SET position=position+1
      WHERE position>=?`).run(position);
    insertDraftRow(db, { ...rule, position }, actorId(actor), timestamp);
    touchDraftState(db, timestamp);
  });
  transaction();
  return {
    rule: listDraftRules(db).find(item => item.id === rule.id),
    state: assignmentRuleState(db),
  };
}

function updateDraftRule(db, ruleId, payload, actor, options = {}) {
  assertAssignmentRuleWrite(actor);
  assertNoUnknownKeys(payload, [
    'expectedRevision',
    'name',
    'enabled',
    'conditions',
    'targetMode',
    'salesUserIds',
    'strategy',
    'dailyQuota',
  ], '修改规则请求');
  const cleanId = cleanRequiredText(ruleId, '规则编号', 100);
  const existing = listDraftRules(db).find(rule => rule.id === cleanId);
  if (!existing) throw notFound('分配规则不存在');
  const complete = normalizeAssignmentRule({
    id: existing.id,
    name: payload.name === undefined ? existing.name : payload.name,
    enabled: payload.enabled === undefined ? existing.enabled : payload.enabled,
    position: existing.position,
    conditions: payload.conditions === undefined ? existing.conditions : payload.conditions,
    targetMode: payload.targetMode === undefined ? existing.targetMode : payload.targetMode,
    salesUserIds: payload.salesUserIds === undefined ? existing.salesUserIds : payload.salesUserIds,
    strategy: payload.strategy === undefined ? existing.strategy : payload.strategy,
    dailyQuota: payload.dailyQuota === undefined ? existing.dailyQuota : payload.dailyQuota,
    isSystemDefault: existing.isSystemDefault,
  }, { forceSystemDefault: existing.isSystemDefault });
  validateSelectedSalesUsers(db, [complete]);
  const timestamp = nowText(options.now ? options.now() : new Date());
  const transaction = db.transaction(() => {
    assertExpectedRevision(db, payload.expectedRevision);
    const result = db.prepare(`UPDATE crm_intake_assignment_rule_drafts
      SET name=?,enabled=?,conditions_json=?,target_mode=?,sales_user_ids_json=?,strategy=?,daily_quota=?,
        revision=revision+1,updated_by=?,updated_at=?
      WHERE id=?`).run(
      complete.name,
      complete.enabled ? 1 : 0,
      JSON.stringify(complete.conditions),
      complete.targetMode,
      JSON.stringify(complete.salesUserIds),
      complete.strategy,
      complete.dailyQuota,
      actorId(actor),
      timestamp,
      cleanId,
    );
    if (!result.changes) throw notFound('分配规则不存在');
    touchDraftState(db, timestamp);
  });
  transaction();
  return {
    rule: listDraftRules(db).find(item => item.id === cleanId),
    state: assignmentRuleState(db),
  };
}

function reorderDraftRules(db, orderedRuleIds, expectedRevision, actor, options = {}) {
  assertAssignmentRuleWrite(actor);
  const ids = cleanStringList(orderedRuleIds, '规则顺序', { maxItems: 200, maxLength: 100 });
  const current = listDraftRules(db);
  if (ids.length !== current.length || new Set(ids).size !== ids.length
    || current.some(rule => !ids.includes(rule.id))) {
    throw badRequest('规则顺序必须包含当前全部规则且不能重复');
  }
  if (ids[ids.length - 1] !== SYSTEM_DEFAULT_RULE_ID) throw badRequest('系统默认规则必须排在最后');
  const timestamp = nowText(options.now ? options.now() : new Date());
  const transaction = db.transaction(() => {
    assertExpectedRevision(db, expectedRevision);
    const update = db.prepare(`UPDATE crm_intake_assignment_rule_drafts
      SET position=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=?`);
    ids.forEach((id, position) => update.run(position, actorId(actor), timestamp, id));
    touchDraftState(db, timestamp);
  });
  transaction();
  return { rules: listDraftRules(db), state: assignmentRuleState(db) };
}

function comparableRule(rule) {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    position: rule.position,
    conditions: rule.conditions,
    targetMode: rule.targetMode,
    salesUserIds: rule.salesUserIds,
    strategy: rule.strategy,
    dailyQuota: rule.dailyQuota,
    isSystemDefault: rule.isSystemDefault,
  };
}

function summarizeRuleChanges(previousRules, nextRules) {
  const before = new Map(previousRules.map(rule => [rule.id, rule]));
  const after = new Map(nextRules.map(rule => [rule.id, rule]));
  const added = nextRules.filter(rule => !before.has(rule.id))
    .map(rule => ({ id: rule.id, name: rule.name }));
  const removed = previousRules.filter(rule => !after.has(rule.id))
    .map(rule => ({ id: rule.id, name: rule.name }));
  const changed = nextRules.filter(rule => {
    const old = before.get(rule.id);
    return old && JSON.stringify(comparableRule(old)) !== JSON.stringify(comparableRule(rule));
  }).map(rule => ({ id: rule.id, name: rule.name }));
  const sharedBeforeOrder = previousRules.filter(rule => after.has(rule.id)).map(rule => rule.id);
  const sharedAfterOrder = nextRules.filter(rule => before.has(rule.id)).map(rule => rule.id);
  return {
    added,
    removed,
    changed,
    reordered: JSON.stringify(sharedBeforeOrder) !== JSON.stringify(sharedAfterOrder),
    migratedFromLegacySettings: false,
  };
}

function publishDraftRules(db, payload, actor, options = {}) {
  assertAssignmentRuleWrite(actor);
  assertNoUnknownKeys(payload || {}, ['expectedRevision'], '发布规则请求');
  const timestamp = nowText(options.now ? options.now() : new Date());
  const ids = typeof options.idFactory === 'function'
    ? options.idFactory
    : prefix => makeId(prefix);
  let published;
  const transaction = db.transaction(() => {
    assertExpectedRevision(db, payload?.expectedRevision);
    const state = assignmentRuleState(db);
    const rules = listDraftRules(db).map((rule, position) => ({ ...rule, position }));
    assertRuleCollection(rules);
    validateSelectedSalesUsers(db, rules);
    const previous = getPublishedRules(db).rules;
    const summary = summarizeRuleChanges(previous, rules);
    if (!summary.added.length && !summary.removed.length && !summary.changed.length && !summary.reordered) {
      throw conflict('草稿与当前发布版本一致，无需重复发布', 'NO_ASSIGNMENT_RULE_CHANGES');
    }
    const versionId = ids('RULEVER');
    const versionNumber = Number(db.prepare(`SELECT next_version_number
      FROM crm_intake_assignment_rule_state WHERE id=?`).get(STATE_ID).next_version_number);
    db.prepare(`INSERT INTO crm_intake_assignment_rule_versions
      (id,version_number,rules_json,change_summary_json,published_by,published_at,restored_from_version_id)
      VALUES (?,?,?,?,?,?, '')`).run(
      versionId,
      versionNumber,
      JSON.stringify(rules),
      JSON.stringify(summary),
      actorId(actor),
      timestamp,
    );
    db.prepare(`UPDATE crm_intake_assignment_rule_state
      SET published_version_id=?,next_version_number=?,updated_at=? WHERE id=?`)
      .run(versionId, versionNumber + 1, timestamp, STATE_ID);
    published = versionRowToRecord(db.prepare(
      'SELECT * FROM crm_intake_assignment_rule_versions WHERE id=?',
    ).get(versionId));
  });
  transaction();
  return { version: published, state: assignmentRuleState(db) };
}

function listAssignmentRuleVersions(db, actor) {
  assertAssignmentRuleRead(actor);
  const includeRules = actor.role === 'admin';
  return db.prepare(`SELECT * FROM crm_intake_assignment_rule_versions
    ORDER BY version_number DESC`).all().map(row => versionRowToRecord(row, includeRules));
}

function restoreAssignmentRuleVersion(db, versionId, payload, actor, options = {}) {
  assertAssignmentRuleWrite(actor);
  assertNoUnknownKeys(payload || {}, ['expectedRevision'], '恢复规则请求');
  const cleanVersionId = cleanRequiredText(versionId, '版本编号', 120);
  const sourceRow = db.prepare('SELECT * FROM crm_intake_assignment_rule_versions WHERE id=?')
    .get(cleanVersionId);
  if (!sourceRow) throw notFound('分配规则版本不存在');
  const sourceRules = parseAndValidateRulesSnapshot(sourceRow.rules_json);
  const timestamp = nowText(options.now ? options.now() : new Date());
  const ids = typeof options.idFactory === 'function'
    ? options.idFactory
    : prefix => makeId(prefix);
  let restored;
  const transaction = db.transaction(() => {
    assertExpectedRevision(db, payload?.expectedRevision);
    const currentPublished = getPublishedRules(db).rules;
    db.prepare('DELETE FROM crm_intake_assignment_rule_drafts').run();
    sourceRules.forEach((rule, position) => insertDraftRow(
      db,
      { ...rule, position },
      actorId(actor),
      timestamp,
    ));
    touchDraftState(db, timestamp);
    const state = assignmentRuleState(db);
    const versionIdNew = ids('RULEVER');
    const summary = {
      ...summarizeRuleChanges(currentPublished, sourceRules),
      restoredFromVersionId: cleanVersionId,
      restoredFromVersionNumber: Number(sourceRow.version_number),
    };
    const restoredRules = listDraftRules(db);
    db.prepare(`INSERT INTO crm_intake_assignment_rule_versions
      (id,version_number,rules_json,change_summary_json,published_by,published_at,restored_from_version_id)
      VALUES (?,?,?,?,?,?,?)`).run(
      versionIdNew,
      state.publishedVersionNumber === null
        ? 1
        : Number(db.prepare(`SELECT next_version_number FROM crm_intake_assignment_rule_state
            WHERE id=?`).get(STATE_ID).next_version_number),
      JSON.stringify(restoredRules),
      JSON.stringify(summary),
      actorId(actor),
      timestamp,
      cleanVersionId,
    );
    const newRow = db.prepare('SELECT * FROM crm_intake_assignment_rule_versions WHERE id=?')
      .get(versionIdNew);
    db.prepare(`UPDATE crm_intake_assignment_rule_state
      SET published_version_id=?,next_version_number=?,updated_at=? WHERE id=?`).run(
      versionIdNew,
      Number(newRow.version_number) + 1,
      timestamp,
      STATE_ID,
    );
    restored = versionRowToRecord(newRow);
  });
  transaction();
  return {
    version: restored,
    rules: listDraftRules(db),
    state: assignmentRuleState(db),
  };
}

function redactRuleForManager(rule) {
  const { salesUserIds, dailyQuota, ...visible } = rule;
  return {
    ...visible,
    candidateCount: salesUserIds.length,
    hasRuleQuota: dailyQuota !== null,
  };
}

function assignmentDecisionForActor(decision, actor) {
  assertAssignmentRuleSimulation(actor);
  if (actor.role === 'admin') return decision;
  const source = plainObject(decision) ? decision : {};
  const excludedReasonCounts = {};
  for (const excluded of Array.isArray(source.excludedCandidates) ? source.excludedCandidates : []) {
    const reasonCode = String(excluded?.reasonCode || 'unavailable');
    excludedReasonCounts[reasonCode] = Number(excludedReasonCounts[reasonCode] || 0) + 1;
  }
  const matchedRule = plainObject(source.matchedRule)
    ? {
      id: source.matchedRule.id,
      name: source.matchedRule.name,
      versionId: source.matchedRule.versionId,
      versionNumber: source.matchedRule.versionNumber,
      strategy: source.matchedRule.strategy,
      targetMode: source.matchedRule.targetMode,
      isSystemDefault: Boolean(source.matchedRule.isSystemDefault),
      match: source.matchedRule.match,
    }
    : null;
  return {
    disposition: source.disposition || '',
    assignable: Boolean(source.assignable),
    managerReview: Boolean(source.managerReview),
    selectedUserId: source.selectedUserId || source.userId || '',
    userId: source.userId || source.selectedUserId || '',
    reasonCode: source.reasonCode || '',
    reason: source.reason || '',
    matchedRule,
    ruleId: source.ruleId || matchedRule?.id || '',
    ruleName: source.ruleName || matchedRule?.name || '',
    ruleVersionId: source.ruleVersionId || matchedRule?.versionId || '',
    strategy: source.strategy || matchedRule?.strategy || '',
    candidateCount: Array.isArray(source.candidateUserIds) ? source.candidateUserIds.length : 0,
    eligibleCandidateCount: Array.isArray(source.eligibleUserIds) ? source.eligibleUserIds.length : 0,
    excludedReasonCounts,
  };
}

function normalizeUsageDate(value) {
  const result = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw badRequest('规则用量日期格式无效');
  return result;
}

function loadAssignmentRuleRuntimeState(db, options = {}) {
  const versionId = cleanRequiredText(options.versionId, '发布版本编号', 120);
  const usageDate = normalizeUsageDate(options.usageDate);
  const dailyByRule = {};
  for (const row of db.prepare(`SELECT rule_id,sales_user_id,SUM(assigned_count) assigned_count
    FROM crm_intake_assignment_rule_usage
    WHERE usage_date=?
    GROUP BY rule_id,sales_user_id`).all(usageDate)) {
    if (!dailyByRule[row.rule_id]) dailyByRule[row.rule_id] = {};
    dailyByRule[row.rule_id][row.sales_user_id] = Number(row.assigned_count);
  }
  const roundRobinState = {};
  for (const row of db.prepare(`SELECT rule_id,cursor
    FROM crm_intake_assignment_rule_rotation
    ORDER BY updated_at DESC,rowid DESC`).all()) {
    if (roundRobinState[row.rule_id]) continue;
    roundRobinState[row.rule_id] = { cursor: Number(row.cursor) };
  }
  return { versionId, usageDate, dailyByRule, roundRobinState };
}

function reserveAssignmentRuleRuntime(db, input, options = {}) {
  assertNoUnknownKeys(input, [
    'ruleId',
    'versionId',
    'salesUserId',
    'usageDate',
    'dailyQuota',
    'expectedRoundRobinCursor',
    'nextRoundRobinCursor',
  ], '规则用量预留请求');
  const ruleId = cleanRequiredText(input.ruleId, '规则编号', 100);
  const versionId = cleanRequiredText(input.versionId, '发布版本编号', 120);
  const salesUserId = cleanRequiredText(input.salesUserId, '销售编号', 100);
  const usageDate = normalizeUsageDate(input.usageDate);
  const quota = normalizeDailyQuota(input.dailyQuota);
  const hasRotation = input.nextRoundRobinCursor !== undefined
    && input.nextRoundRobinCursor !== null;
  const expectedCursor = input.expectedRoundRobinCursor === undefined
    || input.expectedRoundRobinCursor === null
    ? 0
    : Number(input.expectedRoundRobinCursor);
  const nextCursor = hasRotation ? Number(input.nextRoundRobinCursor) : null;
  if (hasRotation && (!Number.isInteger(expectedCursor) || expectedCursor < 0
    || !Number.isInteger(nextCursor) || nextCursor < 0)) {
    throw badRequest('轮询游标无效');
  }
  const timestamp = nowText(options.now ? options.now() : new Date());
  let result;
  const transaction = db.transaction(() => {
    if (hasRotation) {
      const current = db.prepare(`SELECT cursor FROM crm_intake_assignment_rule_rotation
        WHERE rule_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 1`).get(ruleId);
      const actualCursor = Number(current?.cursor || 0);
      if (actualCursor !== expectedCursor) {
        throw conflict('轮询状态已变化，请重新计算分配结果', 'ASSIGNMENT_RULE_ROTATION_CONFLICT');
      }
      db.prepare(`UPDATE crm_intake_assignment_rule_rotation
        SET cursor=?,updated_at=? WHERE rule_id=?`).run(nextCursor, timestamp, ruleId);
      db.prepare(`INSERT OR IGNORE INTO crm_intake_assignment_rule_rotation
        (rule_id,rule_version_id,cursor,updated_at) VALUES (?,?,?,?)`).run(
        ruleId,
        versionId,
        nextCursor,
        timestamp,
      );
    }
    const currentUsage = Number(db.prepare(`SELECT COALESCE(SUM(assigned_count),0) assigned_count
      FROM crm_intake_assignment_rule_usage
      WHERE rule_id=? AND sales_user_id=? AND usage_date=?`)
      .get(ruleId, salesUserId, usageDate).assigned_count);
    if (quota !== null && currentUsage >= quota) {
      throw conflict('该销售已达到当前规则的每日额度', 'ASSIGNMENT_RULE_DAILY_QUOTA_REACHED');
    }
    db.prepare(`INSERT INTO crm_intake_assignment_rule_usage
      (rule_id,rule_version_id,sales_user_id,usage_date,assigned_count,updated_at)
      VALUES (?,?,?,?,1,?)
      ON CONFLICT(rule_id,rule_version_id,sales_user_id,usage_date) DO UPDATE SET
        assigned_count=crm_intake_assignment_rule_usage.assigned_count+1,
        updated_at=excluded.updated_at`).run(
      ruleId,
      versionId,
      salesUserId,
      usageDate,
      timestamp,
    );
    result = {
      ruleId,
      versionId,
      salesUserId,
      usageDate,
      assignedCount: currentUsage + 1,
      ...(hasRotation ? { roundRobinCursor: nextCursor } : {}),
    };
  });
  transaction.immediate();
  return result;
}

function assignmentRulesForActor(db, actor) {
  assertAssignmentRuleRead(actor);
  const state = assignmentRuleState(db);
  const rules = listDraftRules(db);
  const admin = actor.role === 'admin';
  return {
    state,
    rules: admin ? rules : rules.map(redactRuleForManager),
    capabilities: {
      canEdit: admin && !actor.isImpersonating,
      canPublish: admin && !actor.isImpersonating,
      canRestore: admin && !actor.isImpersonating,
      canSimulate: true,
    },
  };
}

function createIntakeAssignmentRuleStore(db, options = {}) {
  installIntakeAssignmentRules(db, options);
  return {
    getConfig: actor => assignmentRulesForActor(db, actor),
    getState: () => assignmentRuleState(db),
    getDraftRules: () => listDraftRules(db),
    getPublishedRules: () => getPublishedRules(db),
    createDraft: (payload, actor) => createDraftRule(db, payload, actor, options),
    updateDraft: (ruleId, payload, actor) => updateDraftRule(db, ruleId, payload, actor, options),
    reorderDraft: (orderedRuleIds, expectedRevision, actor) =>
      reorderDraftRules(db, orderedRuleIds, expectedRevision, actor, options),
    publish: (payload, actor) => publishDraftRules(db, payload, actor, options),
    listVersions: actor => listAssignmentRuleVersions(db, actor),
    restore: (versionId, payload, actor) =>
      restoreAssignmentRuleVersion(db, versionId, payload, actor, options),
    loadRuntimeState: runtimeOptions => loadAssignmentRuleRuntimeState(db, runtimeOptions),
    reserveRuntime: input => reserveAssignmentRuleRuntime(db, input, options),
  };
}

module.exports = {
  RULE_STRATEGIES,
  RULE_TARGET_MODES,
  RULE_CONDITION_KEYS,
  SYSTEM_DEFAULT_RULE_ID,
  LEGACY_INITIAL_RULE_ID,
  normalizeAssignmentRule,
  installIntakeAssignmentRules,
  migrateLegacySettings,
  createIntakeAssignmentRuleStore,
  assignmentRulesForActor,
  assignmentRuleState,
  listDraftRules,
  getPublishedRules,
  createDraftRule,
  updateDraftRule,
  reorderDraftRules,
  publishDraftRules,
  listAssignmentRuleVersions,
  restoreAssignmentRuleVersion,
  assertAssignmentRuleRead,
  assertAssignmentRuleWrite,
  assertAssignmentRuleSimulation,
  assignmentDecisionForActor,
  summarizeRuleChanges,
  loadAssignmentRuleRuntimeState,
  reserveAssignmentRuleRuntime,
};
