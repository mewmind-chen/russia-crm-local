const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ROLE_PERMISSIONS } = require('../lib/access_control');
const {
  installPermissionGroups,
  effectivePermissionsFor,
  hydrateUserPermissions,
} = require('../lib/permission_groups');

function legacyDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sales_users (
    id TEXT PRIMARY KEY, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    permissions_json TEXT NOT NULL DEFAULT '{}'
  )`);
  return db;
}

test('legacy migration preserves every effective permission and is idempotent', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO sales_users VALUES (?,?,1,?)')
    .run('U1', 'manager', JSON.stringify({ view_contacts: false, create_customer: false }));
  const before = { ...ROLE_PERMISSIONS.manager, view_contacts: false, create_customer: false };
  installPermissionGroups(db);
  assert.deepEqual(effectivePermissionsFor(db, 'U1'), before);
  installPermissionGroups(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM permission_groups WHERE system_key='manager-default'").get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_permission_overrides WHERE user_id=?').get('U1').n, 2);
  db.close();
});

test('hydrated permissions ignore later legacy permissions_json changes', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO sales_users VALUES (?,?,1,?)').run('U1', 'sales', '{}');
  installPermissionGroups(db);
  db.prepare('UPDATE sales_users SET permissions_json=? WHERE id=?')
    .run('{"view_all_customers":true}', 'U1');
  const user = hydrateUserPermissions(db, db.prepare('SELECT * FROM sales_users WHERE id=?').get('U1'));
  assert.equal(user.permissions.view_all_customers, false);
  db.close();
});

test('reinstall ignores legacy changes after a user has a valid permission group', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO sales_users VALUES (?,?,1,?)')
    .run('U1', 'manager', JSON.stringify({ view_contacts: false }));
  installPermissionGroups(db);
  const before = effectivePermissionsFor(db, 'U1');
  db.prepare('UPDATE sales_users SET permissions_json=? WHERE id=?')
    .run('{"view_contacts":true}', 'U1');

  assert.doesNotThrow(() => installPermissionGroups(db));
  assert.deepEqual(effectivePermissionsFor(db, 'U1'), before);
  db.close();
});

test('reinstall adds new permissions to system groups without replacing existing choices', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO sales_users VALUES (?,?,1,?)').run('ADMIN', 'admin', '{}');
  installPermissionGroups(db);
  for (const role of ['admin', 'manager']) {
    const group = db.prepare('SELECT id,permissions_json FROM permission_groups WHERE system_key=?').get(`${role}-default`);
    const permissions = JSON.parse(group.permissions_json);
    delete permissions.manage_data_maintenance;
    permissions.view_dashboard = false;
    db.prepare('UPDATE permission_groups SET permissions_json=? WHERE id=?').run(JSON.stringify(permissions), group.id);
  }

  installPermissionGroups(db);
  const admin = JSON.parse(db.prepare("SELECT permissions_json FROM permission_groups WHERE system_key='admin-default'").get().permissions_json);
  const manager = JSON.parse(db.prepare("SELECT permissions_json FROM permission_groups WHERE system_key='manager-default'").get().permissions_json);
  assert.equal(admin.manage_data_maintenance, true);
  assert.equal(manager.manage_data_maintenance, false);
  assert.equal(admin.view_dashboard, false);
  assert.equal(manager.view_dashboard, false);
  db.close();
});

test('sales default alert migration is recorded once and preserves personal deny', () => {
  const db = legacyDb();
  db.exec(`
    ALTER TABLE sales_users ADD COLUMN permission_group_id TEXT NOT NULL DEFAULT '';
    CREATE TABLE permission_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
      role_key TEXT NOT NULL, permissions_json TEXT NOT NULL, system_key TEXT UNIQUE,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE user_permission_overrides (
      user_id TEXT NOT NULL, permission_key TEXT NOT NULL, effect TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,permission_key)
    );
  `);
  const oldSalesPermissions = { ...ROLE_PERMISSIONS.sales, view_alerts: false };
  db.prepare(`INSERT INTO permission_groups
    (id,name,role_key,permissions_json,system_key,created_at,updated_at)
    VALUES ('PGRP-SALES-DEFAULT','sales default','sales',?,'sales-default','before','before')`)
    .run(JSON.stringify(oldSalesPermissions));
  db.prepare('INSERT INTO sales_users VALUES (?,?,1,?,?)')
    .run('INHERIT', 'sales', '{}', 'PGRP-SALES-DEFAULT');
  db.prepare('INSERT INTO sales_users VALUES (?,?,1,?,?)')
    .run('DENIED', 'sales', '{}', 'PGRP-SALES-DEFAULT');
  db.prepare(`INSERT INTO user_permission_overrides
    VALUES ('DENIED','view_alerts','deny','before','before')`).run();

  installPermissionGroups(db);
  assert.equal(effectivePermissionsFor(db, 'INHERIT').view_alerts, true);
  assert.equal(effectivePermissionsFor(db, 'DENIED').view_alerts, false);
  const migration = db.prepare(`SELECT group_id,before_json,after_json
    FROM permission_group_migrations WHERE migration_key=?`)
    .get('2026-07-27-sales-default-view-alerts');
  assert.equal(migration.group_id, 'PGRP-SALES-DEFAULT');
  assert.equal(JSON.parse(migration.before_json).view_alerts, false);
  assert.equal(JSON.parse(migration.after_json).view_alerts, true);

  const group = db.prepare("SELECT permissions_json FROM permission_groups WHERE system_key='sales-default'").get();
  const manuallyDisabled = { ...JSON.parse(group.permissions_json), view_alerts: false };
  db.prepare("UPDATE permission_groups SET permissions_json=? WHERE system_key='sales-default'")
    .run(JSON.stringify(manuallyDisabled));
  installPermissionGroups(db);
  assert.equal(JSON.parse(db.prepare("SELECT permissions_json FROM permission_groups WHERE system_key='sales-default'")
    .get().permissions_json).view_alerts, false);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM permission_group_migrations').get().count, 1);
  db.close();
});
