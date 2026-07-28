'use strict';

const crypto = require('crypto');
const {
  PERMISSION_DEFINITIONS,
  hasPermission,
} = require('./access_control');
const { effectivePermissionsFor } = require('./permission_groups');
const {
  FILTER_TYPES,
  FILTER_OPERATORS,
  DISPLAY_MODES,
  PAGE_REQUIRED_PERMISSIONS,
  FILTER_DEFINITIONS,
  FILTER_SOURCE_CATALOG,
} = require('./filter_catalog');

const MAX_TEXT_LENGTH = 120;
const MAX_MULTI_VALUES = 50;
const MAX_VALUE_LENGTH = 120;
const FILTER_SOURCES = new Map(FILTER_SOURCE_CATALOG.map(item => [item.key, item]));

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === undefined ? fallback : parsed;
  } catch (_error) {
    return fallback;
  }
}

function nowText(value) {
  return String(value || new Date().toISOString().slice(0, 19).replace('T', ' '));
}

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function configError(message) {
  return httpError(400, message, 'FILTER_CONFIG_INVALID');
}

function versionConflict() {
  return httpError(409, '筛选权限配置已被其他操作更新', 'FILTER_VERSION_CONFLICT');
}

function assertPermissionManager(actor) {
  if (actor?.role !== 'admin'
      || !hasPermission(actor, 'view_users')
      || !hasPermission(actor, 'manage_users')) {
    throw httpError(403, '只有管理员可以管理筛选权限', 'FILTER_ADMIN_REQUIRED');
  }
}

function normalizedStringArray(value, fieldName, allowed, options = {}) {
  if (!Array.isArray(value)) throw configError(`${fieldName}必须是数组`);
  const result = [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
  if (!result.length && options.allowEmpty !== true) throw configError(`${fieldName}不能为空`);
  for (const item of result) {
    if (allowed && !allowed.has(item)) throw configError(`${fieldName}包含不支持的值`);
  }
  return result;
}

function installFilterAuthorization(db, options = {}) {
  const now = nowText(options.now);
  const install = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS filter_definitions (
        filter_key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        field_type TEXT NOT NULL CHECK(field_type IN ('text','multi','date_range','tag_multi')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        sensitive INTEGER NOT NULL DEFAULT 0 CHECK(sensitive IN (0,1)),
        operators_json TEXT NOT NULL,
        display_mode TEXT NOT NULL CHECK(display_mode IN ('horizontal','more','date_range')),
        displayed INTEGER NOT NULL DEFAULT 1 CHECK(displayed IN (0,1)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        required_permissions_json TEXT NOT NULL DEFAULT '[]',
        pages_json TEXT NOT NULL DEFAULT '[]',
        tag_category TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS permission_group_filter_grants (
        group_id TEXT NOT NULL,
        filter_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(group_id,filter_key),
        FOREIGN KEY(group_id) REFERENCES permission_groups(id) ON DELETE CASCADE,
        FOREIGN KEY(filter_key) REFERENCES filter_definitions(filter_key) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_filter_extra_grants (
        user_id TEXT NOT NULL,
        filter_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id,filter_key),
        FOREIGN KEY(user_id) REFERENCES sales_users(id) ON DELETE CASCADE,
        FOREIGN KEY(filter_key) REFERENCES filter_definitions(filter_key) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS filter_permission_state (
        id INTEGER PRIMARY KEY CHECK(id=1),
        version INTEGER NOT NULL CHECK(version>=1),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS filter_permission_audit (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS filter_permission_audit_target_idx
        ON filter_permission_audit(target_type,target_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS filter_catalog_migrations (
        migration_key TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const definitionColumns = new Set(db.prepare(
      'PRAGMA table_info(filter_definitions)',
    ).all().map(column => column.name));
    if (!definitionColumns.has('displayed')) {
      db.exec(`ALTER TABLE filter_definitions
        ADD COLUMN displayed INTEGER NOT NULL DEFAULT 1 CHECK(displayed IN (0,1))`);
    }
    const existingState = db.prepare(
      'SELECT version FROM filter_permission_state WHERE id=1',
    ).get();
    const beforeKeys = db.prepare(
      'SELECT filter_key FROM filter_definitions ORDER BY sort_order,filter_key',
    ).all().map(row => row.filter_key);
    const businessMigrationKey = 'issue116-business-pages-v1';
    const businessCatalogUpgrade = Boolean(existingState && !db.prepare(
      'SELECT 1 FROM filter_catalog_migrations WHERE migration_key=?',
    ).get(businessMigrationKey));
    db.prepare(`INSERT OR IGNORE INTO filter_permission_state(id,version,updated_at)
      VALUES (1,1,?)`).run(now);
    const insert = db.prepare(`INSERT OR IGNORE INTO filter_definitions
      (filter_key,label,field_type,enabled,sensitive,operators_json,display_mode,displayed,sort_order,
       required_permissions_json,pages_json,tag_category,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let inserted = 0;
    for (const item of FILTER_DEFINITIONS) {
      inserted += insert.run(
        item.key,
        item.label,
        item.type,
        item.enabled ? 1 : 0,
        item.sensitive ? 1 : 0,
        JSON.stringify(item.operators),
        item.displayMode,
        1,
        item.sortOrder,
        JSON.stringify(item.requiredPermissions),
        JSON.stringify(item.pages),
        item.tagCategory,
        now,
        now,
      ).changes;
    }
    const safeSalesDefaults = new Set([
      'search', 'country', 'stage', 'customer_type', 'industry', 'priority',
      'source', 'last_action', 'next_step', 'created_at',
      'tag_customer_type', 'tag_business_product', 'tag_demand_product',
      'tag_industry', 'tag_focus_scenario', 'contact_level', 'department',
      'sales_ready', 'current_pool', 'score', 'updated_at',
      'status', 'source_batch', 'has_website', 'has_named_contact',
      'unassigned_only', 'urgency', 'due_status', 'due_at',
      'evaluation_status', 'recycle_kind', 'recycled_at',
    ]);
    const managerExtras = new Set([
      'owner', 'creator', 'evaluation_author', 'evaluation_updated_at', 'previous_owner',
    ]);
    const grantDefaults = definitions => {
      const grant = db.prepare(`INSERT OR IGNORE INTO permission_group_filter_grants
        (group_id,filter_key,created_at,updated_at) VALUES (?,?,?,?)`);
      const groups = db.prepare(
        'SELECT id,role_key,permissions_json FROM permission_groups',
      ).all();
      let changes = 0;
      for (const group of groups) {
        const permissions = parseJson(group.permissions_json, {});
        for (const definition of definitions) {
          const roleAllowed = group.role_key === 'admin'
            || safeSalesDefaults.has(definition.key)
            || (group.role_key === 'manager' && managerExtras.has(definition.key));
          const prerequisitesAllowedForGroup = definition.requiredPermissions
            .every(permission => Boolean(permissions[permission]));
          if (roleAllowed && prerequisitesAllowedForGroup) {
            changes += grant.run(group.id, definition.key, now, now).changes;
          }
        }
      }
      return changes;
    };
    if (!existingState) {
      grantDefaults(FILTER_DEFINITIONS);
      db.prepare(`INSERT OR IGNORE INTO filter_catalog_migrations
        (migration_key,applied_at) VALUES (?,?)`).run(businessMigrationKey, now);
    }
    let migratedPages = 0;
    let migratedGrants = 0;
    if (businessCatalogUpgrade) {
      const newPages = new Set([
        'intake', 'lead_flow', 'alerts', 'insights', 'recycle_bin', 'contacts', 'recon',
      ]);
      const updatePages = db.prepare(`UPDATE filter_definitions
        SET pages_json=?,updated_at=? WHERE filter_key=?`);
      for (const definition of FILTER_DEFINITIONS) {
        const row = db.prepare(
          'SELECT pages_json FROM filter_definitions WHERE filter_key=?',
        ).get(definition.key);
        if (!row) continue;
        const currentPages = parseJson(row.pages_json, []);
        const nextPages = [...new Set([
          ...currentPages,
          ...definition.pages.filter(page => newPages.has(page)),
        ])];
        if (!sameValues(currentPages, nextPages)) {
          migratedPages += updatePages.run(
            JSON.stringify(nextPages), now, definition.key,
          ).changes;
        }
      }
      migratedGrants = grantDefaults(FILTER_DEFINITIONS);
      db.prepare(`INSERT INTO filter_catalog_migrations
        (migration_key,applied_at) VALUES (?,?)`).run(businessMigrationKey, now);
    }
    if (existingState && (inserted || migratedPages || migratedGrants)) {
      const afterKeys = db.prepare(
        'SELECT filter_key FROM filter_definitions ORDER BY sort_order,filter_key',
      ).all().map(row => row.filter_key);
      const version = bumpVersion(db, now);
      auditChange(db, { id: 'system' }, {
        action: 'catalog_seeded',
        targetType: 'filter_catalog',
        targetId: 'global',
        before: beforeKeys,
        after: afterKeys,
        note: 'application catalog installation and page authorization migration',
        version,
        now,
      });
    }
  });
  install.immediate();
}

function getFilterPermissionVersion(db) {
  return Number(db.prepare('SELECT version FROM filter_permission_state WHERE id=1').get()?.version || 0);
}

function rowToDefinition(row) {
  return {
    key: row.filter_key,
    label: row.label,
    type: row.field_type,
    enabled: Boolean(row.enabled),
    sensitive: Boolean(row.sensitive),
    operators: parseJson(row.operators_json, []),
    displayMode: row.displayed === 0 ? 'hidden' : row.display_mode,
    sortOrder: Number(row.sort_order || 0),
    requiredPermissions: parseJson(row.required_permissions_json, []),
    pages: parseJson(row.pages_json, []),
    tagCategory: row.tag_category || '',
  };
}

function listFilterDefinitions(db) {
  return db.prepare(`SELECT * FROM filter_definitions
    ORDER BY sort_order,filter_key`).all().map(rowToDefinition);
}

function listAvailableFilterSources(db) {
  const registered = new Set(db.prepare(
    'SELECT filter_key FROM filter_definitions',
  ).all().map(row => row.filter_key));
  return FILTER_SOURCE_CATALOG
    .filter(source => !registered.has(source.key))
    .map(source => ({
      ...source,
      operators: [...source.operators],
      requiredPermissions: [...source.requiredPermissions],
      pages: [...source.pages],
    }));
}

function pageAllowed(user, page) {
  const required = PAGE_REQUIRED_PERMISSIONS[page];
  return Boolean(required && required.every(permission => hasPermission(user, permission)));
}

function prerequisitesAllowed(user, definition) {
  return definition.requiredPermissions.every(permission => hasPermission(user, permission));
}

function publicDefinition(definition) {
  return {
    key: definition.key,
    label: definition.label,
    type: definition.type,
    operators: [...definition.operators],
    displayMode: definition.displayMode,
    sortOrder: definition.sortOrder,
    sensitive: definition.sensitive,
    tagCategory: definition.tagCategory,
  };
}

function effectiveFilterSchemaFor(db, user, page) {
  const version = getFilterPermissionVersion(db);
  const cleanPage = String(page || '');
  if (!pageAllowed(user, cleanPage)) return { version, page: cleanPage, filters: [] };

  const groupGrants = new Set(db.prepare(
    'SELECT filter_key FROM permission_group_filter_grants WHERE group_id=?',
  ).all(String(user?.permission_group_id || '')).map(row => row.filter_key));
  const extras = new Set(db.prepare(
    'SELECT filter_key FROM user_filter_extra_grants WHERE user_id=?',
  ).all(String(user?.id || '')).map(row => row.filter_key));
  const admin = user?.role === 'admin';
  const filters = listFilterDefinitions(db)
    .filter(item => item.enabled)
    .filter(item => item.displayMode !== 'hidden')
    .filter(item => item.pages.includes(cleanPage))
    .filter(item => prerequisitesAllowed(user, item))
    .filter(item => admin || groupGrants.has(item.key) || extras.has(item.key))
    .map(publicDefinition);
  return { version, page: cleanPage, filters };
}

function checkExpectedVersion(db, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null) return;
  if (!Number.isInteger(expectedVersion)
      || expectedVersion !== getFilterPermissionVersion(db)) {
    throw versionConflict();
  }
}

function bumpVersion(db, now) {
  db.prepare(`UPDATE filter_permission_state
    SET version=version+1,updated_at=? WHERE id=1`).run(now);
  return getFilterPermissionVersion(db);
}

function auditChange(db, actor, {
  action,
  targetType,
  targetId,
  before,
  after,
  note,
  version,
  now,
}) {
  db.prepare(`INSERT INTO filter_permission_audit
    (id,actor_id,target_type,target_id,action,before_json,after_json,note,version,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    `FPA-${crypto.randomBytes(12).toString('hex')}`,
    String(actor?.id || ''),
    targetType,
    targetId,
    action,
    JSON.stringify(before),
    JSON.stringify(after),
    String(note || '').trim().slice(0, 500),
    version,
    now,
  );
}

function definitionMap(db) {
  return new Map(listFilterDefinitions(db).map(item => [item.key, item]));
}

function orderedKeys(db, values) {
  const selected = new Set(values);
  return listFilterDefinitions(db)
    .filter(item => selected.has(item.key))
    .map(item => item.key);
}

function strictKnownKeys(db, values) {
  if (!Array.isArray(values)) throw configError('筛选授权必须是数组');
  const definitions = definitionMap(db);
  const result = [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
  if (result.some(key => !definitions.has(key))) throw configError('筛选授权包含未知项目');
  return orderedKeys(db, result);
}

function currentGroupGrants(db, groupId) {
  return orderedKeys(db, db.prepare(
    'SELECT filter_key FROM permission_group_filter_grants WHERE group_id=?',
  ).all(groupId).map(row => row.filter_key));
}

function currentUserExtras(db, userId) {
  return orderedKeys(db, db.prepare(
    'SELECT filter_key FROM user_filter_extra_grants WHERE user_id=?',
  ).all(userId).map(row => row.filter_key));
}

function saveGroupFilterGrants(db, actor, groupId, filterKeys, options = {}) {
  assertPermissionManager(actor);
  const cleanGroupId = String(groupId || '').trim();
  const now = nowText(options.now);
  const transaction = db.transaction(() => {
    checkExpectedVersion(db, options.expectedVersion);
    if (!db.prepare('SELECT 1 FROM permission_groups WHERE id=?').get(cleanGroupId)) {
      throw httpError(404, '权限组不存在', 'FILTER_TARGET_NOT_FOUND');
    }
    const after = strictKnownKeys(db, filterKeys);
    const before = currentGroupGrants(db, cleanGroupId);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return { groupId: cleanGroupId, grants: after, version: getFilterPermissionVersion(db) };
    }
    db.prepare('DELETE FROM permission_group_filter_grants WHERE group_id=?').run(cleanGroupId);
    const insert = db.prepare(`INSERT INTO permission_group_filter_grants
      (group_id,filter_key,created_at,updated_at) VALUES (?,?,?,?)`);
    for (const key of after) insert.run(cleanGroupId, key, now, now);
    const version = bumpVersion(db, now);
    auditChange(db, actor, {
      action: 'group_grants_replaced',
      targetType: 'permission_group',
      targetId: cleanGroupId,
      before,
      after,
      note: options.note,
      version,
      now,
    });
    return { groupId: cleanGroupId, grants: after, version };
  });
  return transaction.immediate();
}

function targetPermissions(db, userId) {
  return effectivePermissionsFor(db, userId);
}

function saveUserExtraFilterGrants(db, actor, userId, filterKeys, options = {}) {
  assertPermissionManager(actor);
  const cleanUserId = String(userId || '').trim();
  const now = nowText(options.now);
  const transaction = db.transaction(() => {
    checkExpectedVersion(db, options.expectedVersion);
    const target = db.prepare(
      'SELECT id,permission_group_id FROM sales_users WHERE id=?',
    ).get(cleanUserId);
    if (!target) throw httpError(404, '用户不存在', 'FILTER_TARGET_NOT_FOUND');
    const definitions = definitionMap(db);
    const requested = strictKnownKeys(db, filterKeys);
    const groupGrants = new Set(currentGroupGrants(db, target.permission_group_id));
    const permissions = targetPermissions(db, cleanUserId);
    const extras = requested.filter(key => !groupGrants.has(key));
    for (const key of extras) {
      const item = definitions.get(key);
      if (!item.enabled || !prerequisitesAllowed({ permissions }, item)) {
        throw configError('成员额外授权不满足字段可见权限');
      }
    }
    const after = orderedKeys(db, extras);
    const before = currentUserExtras(db, cleanUserId);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return { userId: cleanUserId, grants: after, version: getFilterPermissionVersion(db) };
    }
    db.prepare('DELETE FROM user_filter_extra_grants WHERE user_id=?').run(cleanUserId);
    const insert = db.prepare(`INSERT INTO user_filter_extra_grants
      (user_id,filter_key,created_at,updated_at) VALUES (?,?,?,?)`);
    for (const key of after) insert.run(cleanUserId, key, now, now);
    const version = bumpVersion(db, now);
    auditChange(db, actor, {
      action: 'user_extras_replaced',
      targetType: 'user',
      targetId: cleanUserId,
      before,
      after,
      note: options.note,
      version,
      now,
    });
    return { userId: cleanUserId, grants: after, version };
  });
  return transaction.immediate();
}

function restoreUserExtraFilterGrants(db, actor, userId, options = {}) {
  assertPermissionManager(actor);
  const cleanUserId = String(userId || '').trim();
  const now = nowText(options.now);
  const transaction = db.transaction(() => {
    checkExpectedVersion(db, options.expectedVersion);
    if (!db.prepare('SELECT 1 FROM sales_users WHERE id=?').get(cleanUserId)) {
      throw httpError(404, '用户不存在', 'FILTER_TARGET_NOT_FOUND');
    }
    const before = currentUserExtras(db, cleanUserId);
    if (!before.length) {
      return { userId: cleanUserId, grants: [], version: getFilterPermissionVersion(db) };
    }
    db.prepare('DELETE FROM user_filter_extra_grants WHERE user_id=?').run(cleanUserId);
    const version = bumpVersion(db, now);
    auditChange(db, actor, {
      action: 'user_extras_restored',
      targetType: 'user',
      targetId: cleanUserId,
      before,
      after: [],
      note: options.note,
      version,
      now,
    });
    return { userId: cleanUserId, grants: [], version };
  });
  return transaction.immediate();
}

function sourceFor(filterKey) {
  const source = FILTER_SOURCES.get(String(filterKey || '').trim());
  if (!source) throw configError('筛选数据源无效');
  return source;
}

function sameValues(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function assertSourceConstraints(definition, source) {
  if (definition.type !== source.type
      || !sameValues(definition.operators, source.operators)) {
    throw configError('筛选类型或运算符不符合数据源约束');
  }
  if (source.sensitive && !definition.sensitive) {
    throw configError('敏感数据源不能取消敏感标记');
  }
  if (source.requiredPermissions.some(permission =>
    !definition.requiredPermissions.includes(permission))) {
    throw configError('字段权限不能低于数据源最低要求');
  }
  if (definition.pages.some(page => !source.pages.includes(page))) {
    throw configError('适用页面超出数据源支持范围');
  }
  if (definition.tagCategory !== source.tagCategory) {
    throw configError('标签分类不符合数据源约束');
  }
}

function validateDefinitionPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw configError('筛选配置必须是对象');
  }
  const allowedFields = new Set([
    'label',
    'type',
    'enabled',
    'sensitive',
    'operators',
    'displayMode',
    'sortOrder',
    'requiredPermissions',
    'pages',
  ]);
  for (const key of Object.keys(patch)) {
    if (!allowedFields.has(key)) throw configError('筛选配置包含不支持的字段');
  }
  const next = { ...current };
  if (patch.label !== undefined) {
    const label = String(patch.label || '').trim();
    if (!label || label.length > 80) throw configError('筛选名称无效');
    next.label = label;
  }
  if (patch.type !== undefined) {
    const type = String(patch.type || '');
    if (!FILTER_TYPES.includes(type)) throw configError('筛选类型无效');
    next.type = type;
    if (patch.operators === undefined) next.operators = [...FILTER_OPERATORS[type]];
  }
  for (const key of ['enabled', 'sensitive']) {
    if (patch[key] === undefined) continue;
    if (typeof patch[key] !== 'boolean') throw configError(`${key}必须是布尔值`);
    next[key] = patch[key];
  }
  if (patch.displayMode !== undefined) {
    const mode = String(patch.displayMode || '');
    if (!DISPLAY_MODES.includes(mode)) throw configError('展示方式无效');
    next.displayMode = mode;
  }
  if (patch.sortOrder !== undefined) {
    if (!Number.isInteger(patch.sortOrder)
        || patch.sortOrder < -100000
        || patch.sortOrder > 100000) {
      throw configError('筛选顺序无效');
    }
    next.sortOrder = patch.sortOrder;
  }
  if (patch.operators !== undefined) {
    next.operators = normalizedStringArray(
      patch.operators,
      '可用运算符',
      new Set(FILTER_OPERATORS[next.type] || []),
    );
  }
  if (patch.requiredPermissions !== undefined) {
    next.requiredPermissions = normalizedStringArray(
      patch.requiredPermissions,
      '字段权限',
      new Set(Object.keys(PERMISSION_DEFINITIONS)),
      { allowEmpty: true },
    );
  }
  if (patch.pages !== undefined) {
    next.pages = normalizedStringArray(
      patch.pages,
      '适用页面',
      new Set(Object.keys(PAGE_REQUIRED_PERMISSIONS)),
    );
  }
  if (!next.operators.every(operator => FILTER_OPERATORS[next.type].includes(operator))) {
    throw configError('运算符与筛选类型不匹配');
  }
  assertSourceConstraints(next, sourceFor(current.key));
  return next;
}

function storedDisplayMode(definition, fallback = 'horizontal') {
  return definition.displayMode === 'hidden' ? fallback : definition.displayMode;
}

function createFilterDefinition(db, actor, input, options = {}) {
  assertPermissionManager(actor);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw configError('筛选配置必须是对象');
  }
  const cleanKey = String(input.sourceKey || input.key || '').trim();
  const source = sourceFor(cleanKey);
  if (input.key !== undefined && String(input.key || '').trim() !== cleanKey) {
    throw configError('筛选项目必须与数据源一致');
  }
  const now = nowText(options.now);
  const transaction = db.transaction(() => {
    checkExpectedVersion(db, options.expectedVersion);
    if (db.prepare('SELECT 1 FROM filter_definitions WHERE filter_key=?').get(cleanKey)) {
      throw httpError(409, '筛选项目已存在', 'FILTER_DEFINITION_EXISTS');
    }
    const initial = {
      key: source.key,
      label: source.label,
      type: source.type,
      enabled: true,
      sensitive: source.sensitive,
      operators: [...source.operators],
      displayMode: source.displayMode,
      sortOrder: source.sortOrder,
      requiredPermissions: [...source.requiredPermissions],
      pages: [...source.pages],
      tagCategory: source.tagCategory,
    };
    const patch = Object.fromEntries(Object.entries(input)
      .filter(([key]) => !['key', 'sourceKey'].includes(key)));
    const after = validateDefinitionPatch(initial, patch);
    db.prepare(`INSERT INTO filter_definitions
      (filter_key,label,field_type,enabled,sensitive,operators_json,display_mode,displayed,
       sort_order,required_permissions_json,pages_json,tag_category,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      cleanKey,
      after.label,
      after.type,
      after.enabled ? 1 : 0,
      after.sensitive ? 1 : 0,
      JSON.stringify(after.operators),
      storedDisplayMode(after, source.displayMode),
      after.displayMode === 'hidden' ? 0 : 1,
      after.sortOrder,
      JSON.stringify(after.requiredPermissions),
      JSON.stringify(after.pages),
      after.tagCategory,
      now,
      now,
    );
    const version = bumpVersion(db, now);
    auditChange(db, actor, {
      action: 'definition_created',
      targetType: 'filter_definition',
      targetId: cleanKey,
      before: null,
      after,
      note: options.note,
      version,
      now,
    });
    return { filterKey: cleanKey, definition: after, version };
  });
  return transaction.immediate();
}

function updateFilterDefinition(db, actor, filterKey, patch, options = {}) {
  assertPermissionManager(actor);
  const cleanKey = String(filterKey || '').trim();
  const now = nowText(options.now);
  const transaction = db.transaction(() => {
    checkExpectedVersion(db, options.expectedVersion);
    const row = db.prepare('SELECT * FROM filter_definitions WHERE filter_key=?').get(cleanKey);
    if (!row) throw httpError(404, '筛选项目不存在', 'FILTER_TARGET_NOT_FOUND');
    const before = rowToDefinition(row);
    const after = validateDefinitionPatch(before, patch);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return { filterKey: cleanKey, definition: after, version: getFilterPermissionVersion(db) };
    }
    db.prepare(`UPDATE filter_definitions SET
      label=?,field_type=?,enabled=?,sensitive=?,operators_json=?,display_mode=?,displayed=?,sort_order=?,
      required_permissions_json=?,pages_json=?,updated_at=?
      WHERE filter_key=?`).run(
      after.label,
      after.type,
      after.enabled ? 1 : 0,
      after.sensitive ? 1 : 0,
      JSON.stringify(after.operators),
      storedDisplayMode(after, row.display_mode),
      after.displayMode === 'hidden' ? 0 : 1,
      after.sortOrder,
      JSON.stringify(after.requiredPermissions),
      JSON.stringify(after.pages),
      now,
      cleanKey,
    );
    const version = bumpVersion(db, now);
    auditChange(db, actor, {
      action: 'definition_updated',
      targetType: 'filter_definition',
      targetId: cleanKey,
      before,
      after,
      note: options.note,
      version,
      now,
    });
    return { filterKey: cleanKey, definition: after, version };
  });
  return transaction.immediate();
}

function unauthorizedFilter() {
  return httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
}

function invalidValue() {
  return httpError(400, '筛选值无效', 'FILTER_VALUE_INVALID');
}

function invalidOperator() {
  return httpError(400, '筛选运算符无效', 'FILTER_OPERATOR_INVALID');
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function validateFilterValue(definition, raw) {
  if (!isPlainObject(raw)) throw invalidValue();
  const operator = String(raw.operator || '');
  if (!definition.operators.includes(operator)) throw invalidOperator();
  if (definition.type === 'text') {
    if (operator !== 'contains' || typeof raw.value !== 'string') throw invalidValue();
    const value = raw.value.trim();
    if (!value || value.length > MAX_TEXT_LENGTH) throw invalidValue();
    if (Object.keys(raw).some(key => !['operator', 'value'].includes(key))) throw invalidValue();
    return { key: definition.key, operator, value };
  }
  if (definition.type === 'multi' || definition.type === 'tag_multi') {
    if (operator !== 'in' || !Array.isArray(raw.values)
        || !raw.values.length || raw.values.length > MAX_MULTI_VALUES) {
      throw invalidValue();
    }
    if (Object.keys(raw).some(key => !['operator', 'values'].includes(key))) throw invalidValue();
    const values = [...new Set(raw.values.map(item => {
      if (typeof item !== 'string') throw invalidValue();
      const value = item.trim();
      if (!value || value.length > MAX_VALUE_LENGTH) throw invalidValue();
      return value;
    }))];
    if (!values.length) throw invalidValue();
    return { key: definition.key, operator, values };
  }
  if (definition.type === 'date_range') {
    const from = String(raw.from || '');
    const to = String(raw.to || '');
    if (operator !== 'between' || !validDate(from) || !validDate(to) || from > to) {
      throw invalidValue();
    }
    if (Object.keys(raw).some(key => !['operator', 'from', 'to'].includes(key))) {
      throw invalidValue();
    }
    return { key: definition.key, operator, from, to };
  }
  throw invalidValue();
}

function validateFilterQuery(db, user, page, rawQuery) {
  if (!isPlainObject(rawQuery)) throw invalidValue();
  const schema = effectiveFilterSchemaFor(db, user, page);
  const allowed = new Map(schema.filters.map(item => [item.key, item]));
  const filters = [];
  for (const [key, raw] of Object.entries(rawQuery)) {
    const definition = allowed.get(key);
    if (!definition) throw unauthorizedFilter();
    filters.push(validateFilterValue(definition, raw));
  }
  return { version: schema.version, page: schema.page, filters };
}

module.exports = {
  installFilterAuthorization,
  getFilterPermissionVersion,
  listFilterDefinitions,
  listAvailableFilterSources,
  effectiveFilterSchemaFor,
  saveGroupFilterGrants,
  saveUserExtraFilterGrants,
  restoreUserExtraFilterGrants,
  createFilterDefinition,
  updateFilterDefinition,
  validateFilterQuery,
};
