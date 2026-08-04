const crypto = require('crypto');
const {
  PERMISSION_DEFINITIONS,
  ROLE_PERMISSIONS,
  normalizePermissions,
  hasPermission,
  forbidden,
} = require('./access_control');

const EFFECTS = new Set(['allow', 'deny']);

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || JSON.stringify(fallback)); }
  catch (_error) { return fallback; }
}

function groupPermissions(row) {
  const parsed = normalizePermissions(parseJson(row?.permissions_json, {}));
  return Object.fromEntries(Object.keys(PERMISSION_DEFINITIONS).map(key => [key, Boolean(parsed[key])]));
}

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function httpError(statusCode, message, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function assertPermissionManager(actor) {
  if (!hasPermission(actor, 'view_users')) throw forbidden('没有权限：用户与权限');
  if (!hasPermission(actor, 'manage_users')) throw forbidden('没有权限：管理账号与权限');
  if (actor?.role !== 'admin') throw forbidden('只有管理员可以管理权限组');
}

function strictPermissionMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, '权限配置必须是对象');
  }
  const expected = Object.keys(PERMISSION_DEFINITIONS);
  const provided = Object.keys(value);
  const unknown = provided.filter(key => !PERMISSION_DEFINITIONS[key]);
  if (unknown.length) throw httpError(400, `未知权限：${unknown[0]}`);
  const missing = expected.filter(key => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) throw httpError(400, `缺少权限值：${missing[0]}`);
  const result = {};
  for (const [key, allowed] of Object.entries(value)) {
    if (typeof allowed !== 'boolean') throw httpError(400, `权限值必须为布尔值：${key}`);
    result[key] = allowed;
  }
  return result;
}

function legacyEffectivePermissions(user) {
  const defaults = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.sales;
  return { ...defaults, ...normalizePermissions(parseJson(user.permissions_json, {})) };
}

function installPermissionGroups(db) {
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS permission_groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
        role_key TEXT NOT NULL CHECK(role_key IN ('admin','manager','sales')),
        permissions_json TEXT NOT NULL, system_key TEXT UNIQUE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_permission_overrides (
        user_id TEXT NOT NULL, permission_key TEXT NOT NULL,
        effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, permission_key),
        FOREIGN KEY(user_id) REFERENCES sales_users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS permission_group_migrations (
        migration_key TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const columns = new Set(db.prepare('PRAGMA table_info(sales_users)').all().map(row => row.name));
    if (!columns.has('permission_group_id')) db.exec("ALTER TABLE sales_users ADD COLUMN permission_group_id TEXT NOT NULL DEFAULT ''");

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const defaultGroupIds = new Map();
    for (const role of ['admin', 'manager', 'sales']) {
      const groupId = `PGRP-${role.toUpperCase()}-DEFAULT`;
      defaultGroupIds.set(role, groupId);
      db.prepare(`INSERT OR IGNORE INTO permission_groups
        (id,name,description,role_key,permissions_json,system_key,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        groupId, `${role} default`, 'System role migration baseline', role,
        JSON.stringify(ROLE_PERMISSIONS[role]), `${role}-default`, now, now,
      );
      const current = db.prepare('SELECT permissions_json FROM permission_groups WHERE id=?').get(groupId);
      const permissions = parseJson(current?.permissions_json, {});
      let changed = false;
      for (const [key, allowed] of Object.entries(ROLE_PERMISSIONS[role])) {
        if (Object.prototype.hasOwnProperty.call(permissions, key)) continue;
        permissions[key] = Boolean(allowed);
        changed = true;
      }
      if (changed) db.prepare('UPDATE permission_groups SET permissions_json=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(permissions), now, groupId);
    }
    const alertMigrationKey = '2026-07-27-sales-default-view-alerts';
    if (!db.prepare('SELECT 1 FROM permission_group_migrations WHERE migration_key=?').get(alertMigrationKey)) {
      const groupId = defaultGroupIds.get('sales');
      const current = db.prepare('SELECT permissions_json FROM permission_groups WHERE id=?').get(groupId);
      const before = parseJson(current?.permissions_json, {});
      const after = { ...before, view_alerts: true };
      if (before.view_alerts !== true) {
        db.prepare('UPDATE permission_groups SET permissions_json=?,updated_at=? WHERE id=?')
          .run(JSON.stringify(after), now, groupId);
      }
      db.prepare(`INSERT INTO permission_group_migrations
        (migration_key,group_id,before_json,after_json,applied_at) VALUES (?,?,?,?,?)`)
        .run(alertMigrationKey, groupId, JSON.stringify(before), JSON.stringify(after), now);
    }
    const legacyUsers = db.prepare(`SELECT u.*,g.role_key group_role
      FROM sales_users u LEFT JOIN permission_groups g ON g.id=u.permission_group_id`).all()
      .filter(user => user.group_role !== user.role);
    const legacyPermissions = new Map(legacyUsers
      .map(user => [user.id, legacyEffectivePermissions(user)]));
    for (const user of legacyUsers) {
      db.prepare('UPDATE sales_users SET permission_group_id=? WHERE id=?')
        .run(defaultGroupIds.get(user.role), user.id);
      if (db.prepare('SELECT COUNT(*) n FROM user_permission_overrides WHERE user_id=?').get(user.id).n) continue;
      const legacy = normalizePermissions(parseJson(user.permissions_json, {}));
      const defaults = ROLE_PERMISSIONS[user.role] || ROLE_PERMISSIONS.sales;
      for (const [key, value] of Object.entries(legacy)) {
        if (Boolean(value) === Boolean(defaults[key])) continue;
        db.prepare(`INSERT INTO user_permission_overrides
          (user_id,permission_key,effect,created_at,updated_at) VALUES (?,?,?,?,?)`)
          .run(user.id, key, value ? 'allow' : 'deny', now, now);
      }
    }
    for (const [userId, before] of legacyPermissions) {
      const after = effectivePermissionsFor(db, userId);
      for (const key of Object.keys(PERMISSION_DEFINITIONS)) {
        if (before[key] !== after[key]) {
          throw new Error(`权限迁移校验失败：${userId} ${key}`);
        }
      }
    }
  });
  migrate();
}

function effectivePermissionsFor(db, userId) {
  const user = db.prepare(`SELECT u.*,g.permissions_json group_permissions_json,g.role_key group_role
    FROM sales_users u LEFT JOIN permission_groups g ON g.id=u.permission_group_id WHERE u.id=?`).get(userId);
  if (!user || user.group_role !== user.role) return Object.fromEntries(Object.keys(PERMISSION_DEFINITIONS).map(key => [key, false]));
  const permissions = groupPermissions({ permissions_json: user.group_permissions_json });
  for (const row of db.prepare('SELECT permission_key,effect FROM user_permission_overrides WHERE user_id=?').all(userId)) {
    if (PERMISSION_DEFINITIONS[row.permission_key] && EFFECTS.has(row.effect)) permissions[row.permission_key] = row.effect === 'allow';
  }
  return permissions;
}

function hydrateUserPermissions(db, row) {
  if (!row) return null;
  const group = db.prepare(`SELECT name FROM permission_groups WHERE id=?`).get(row.permission_group_id);
  const permissionOverrides = Object.fromEntries(db.prepare(`SELECT permission_key,effect
    FROM user_permission_overrides WHERE user_id=? ORDER BY permission_key`).all(row.id)
    .map(override => [override.permission_key, override.effect]));
  return {
    ...row,
    permission_group_name: group?.name || '',
    permissionOverrides,
    permissions: effectivePermissionsFor(db, row.id),
  };
}

function hydrateUsersPermissions(db, rows) {
  return rows.map(row => hydrateUserPermissions(db, row));
}

function normalizePersonalPermissionMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, '个人权限必须是对象');
  }
  const expected = Object.keys(PERMISSION_DEFINITIONS);
  const provided = Object.keys(value);
  const unknown = provided.filter(key => !PERMISSION_DEFINITIONS[key]);
  if (unknown.length) throw httpError(400, `未知权限：${unknown[0]}`);
  const missing = expected.filter(key => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) throw httpError(400, `缺少权限值：${missing[0]}`);
  const result = {};
  for (const key of expected) {
    if (typeof value[key] !== 'boolean') throw httpError(400, `权限值必须为布尔值：${key}`);
    result[key] = value[key];
  }
  return result;
}

function assertValidAdminRemains(db) {
  const admins = db.prepare("SELECT id FROM sales_users WHERE active=1 AND role='admin'").all();
  const valid = admins.some(user => {
    const permissions = effectivePermissionsFor(db, user.id);
    return permissions.view_users && permissions.manage_users;
  });
  if (!valid) throw httpError(409, '必须保留至少一个有效管理员', 'LAST_ADMIN_REQUIRED');
}

function listPermissionGroups(db) {
  return db.prepare(`SELECT g.*,COUNT(u.id) member_count FROM permission_groups g
    LEFT JOIN sales_users u ON u.permission_group_id=g.id
    GROUP BY g.id ORDER BY g.role_key,g.name`).all().map(group => ({
    id: group.id,
    name: group.name,
    description: group.description,
    role: group.role_key,
    permissions: groupPermissions(group),
    memberCount: Number(group.member_count || 0),
  }));
}

function createPermissionGroup(db, actor, payload = {}) {
  assertPermissionManager(actor);
  const allowed = new Set(['name', 'description', 'role', 'permissions']);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw httpError(400, `不支持的权限组字段：${key}`);
  }
  const name = String(payload.name || '').trim();
  const role = String(payload.role || '');
  if (!name) throw httpError(400, '权限组名称不能为空');
  if (!['admin', 'manager', 'sales'].includes(role)) throw httpError(400, '请选择有效角色');
  const permissions = strictPermissionMap(payload.permissions);
  const groupId = `PGRP-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const now = nowText();
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO permission_groups
        (id,name,description,role_key,permissions_json,system_key,created_at,updated_at)
        VALUES (?,?,?,?,?,NULL,?,?)`).run(
        groupId, name, String(payload.description || ''), role, JSON.stringify(permissions), now, now,
      );
      assertValidAdminRemains(db);
    })();
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw httpError(400, '权限组名称已存在');
    throw error;
  }
  return { groupId };
}

function updatePermissionGroup(db, actor, groupId, payload = {}) {
  assertPermissionManager(actor);
  const allowed = new Set(['name', 'description', 'permissions']);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw httpError(400, `不支持的权限组字段：${key}`);
  }
  const group = db.prepare('SELECT * FROM permission_groups WHERE id=?').get(groupId);
  if (!group) throw httpError(404, '权限组不存在');
  const fields = [], params = [];
  if (payload.name !== undefined) {
    const name = String(payload.name || '').trim();
    if (!name) throw httpError(400, '权限组名称不能为空');
    fields.push('name=?'); params.push(name);
  }
  if (payload.description !== undefined) {
    fields.push('description=?'); params.push(String(payload.description || ''));
  }
  if (payload.permissions !== undefined) {
    fields.push('permissions_json=?'); params.push(JSON.stringify(strictPermissionMap(payload.permissions)));
  }
  if (!fields.length) return { groupId };
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE permission_groups SET ${[...fields, 'updated_at=?'].join(',')} WHERE id=?`)
      .run(...params, nowText(), groupId);
    assertValidAdminRemains(db);
  });
  try {
    transaction();
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw httpError(400, '权限组名称已存在');
    throw error;
  }
  return { groupId };
}

function writeUserPermissionDifferences(db, userId, desiredPermissions) {
  const user = db.prepare(`SELECT u.id,u.role,u.permission_group_id,g.role_key,g.permissions_json
    FROM sales_users u LEFT JOIN permission_groups g ON g.id=u.permission_group_id
    WHERE u.id=?`).get(userId);
  if (!user) throw httpError(404, '用户不存在');
  if (!user.permission_group_id || user.role_key !== user.role) {
    throw httpError(400, '用户必须先选择与角色匹配的权限组');
  }
  const desired = normalizePersonalPermissionMap(desiredPermissions);
  const baseline = groupPermissions(user);
  db.prepare('DELETE FROM user_permission_overrides WHERE user_id=?').run(userId);
  const insert = db.prepare(`INSERT INTO user_permission_overrides
    (user_id,permission_key,effect,created_at,updated_at) VALUES (?,?,?,?,?)`);
  const now = nowText();
  for (const key of Object.keys(PERMISSION_DEFINITIONS)) {
    if (desired[key] === baseline[key]) continue;
    insert.run(userId, key, desired[key] ? 'allow' : 'deny', now, now);
  }
  return Number(db.prepare('SELECT COUNT(*) n FROM user_permission_overrides WHERE user_id=?').get(userId).n || 0);
}

function replaceUserPermissions(db, actor, userId, desiredPermissions) {
  assertPermissionManager(actor);
  const transaction = db.transaction(() => {
    const personalPermissionCount = writeUserPermissionDifferences(db, userId, desiredPermissions);
    assertValidAdminRemains(db);
    db.prepare(`INSERT INTO crm_audit_log
      (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      `AUD-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
      actor.id,
      'user_personal_permissions_updated',
      'sales_user',
      userId,
      JSON.stringify({ personalPermissionCount }),
      nowText(),
      actor.id,
      actor.id,
      '',
    );
  });
  transaction();
  return { userId };
}

function restoreUserPermissions(db, actor, userId) {
  assertPermissionManager(actor);
  return db.transaction(() => {
    db.prepare('DELETE FROM user_permission_overrides WHERE user_id=?').run(userId);
    assertValidAdminRemains(db);
    db.prepare(`INSERT INTO crm_audit_log
      (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      `AUD-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
      actor.id,
      'user_personal_permissions_updated',
      'sales_user',
      userId,
      JSON.stringify({ personalPermissionCount: 0 }),
      nowText(),
      actor.id,
      actor.id,
      '',
    );
    return { userId };
  })();
}

module.exports = {
  installPermissionGroups,
  effectivePermissionsFor,
  hydrateUserPermissions,
  hydrateUsersPermissions,
  normalizePersonalPermissionMap,
  writeUserPermissionDifferences,
  listPermissionGroups,
  createPermissionGroup,
  updatePermissionGroup,
  replaceUserPermissions,
  restoreUserPermissions,
  assertValidAdminRemains,
};
