const { PERMISSION_DEFINITIONS, ROLE_PERMISSIONS, normalizePermissions } = require('./access_control');

const EFFECTS = new Set(['allow', 'deny']);

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || JSON.stringify(fallback)); }
  catch (_error) { return fallback; }
}

function groupPermissions(row) {
  const parsed = normalizePermissions(parseJson(row?.permissions_json, {}));
  return Object.fromEntries(Object.keys(PERMISSION_DEFINITIONS).map(key => [key, Boolean(parsed[key])]));
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
  return row ? { ...row, permissions: effectivePermissionsFor(db, row.id) } : null;
}

function hydrateUsersPermissions(db, rows) {
  return rows.map(row => hydrateUserPermissions(db, row));
}

function normalizeOverrideMap(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [key, effect] of Object.entries(source)) {
    if (!PERMISSION_DEFINITIONS[key]) {
      const error = new Error(`未知权限：${key}`); error.statusCode = 400; throw error;
    }
    if (!['inherit', 'allow', 'deny'].includes(effect)) {
      const error = new Error(`无效权限状态：${key}`); error.statusCode = 400; throw error;
    }
    result[key] = effect;
  }
  return result;
}

module.exports = {
  installPermissionGroups,
  effectivePermissionsFor,
  hydrateUserPermissions,
  hydrateUsersPermissions,
  normalizeOverrideMap,
};
