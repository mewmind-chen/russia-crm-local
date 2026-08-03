'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  ROLE_PERMISSIONS,
  SALES_ROUTE_POLICIES,
  assertPolicyAllowed,
  policyForSalesRequest,
} = require('../lib/access_control');
const {
  FILTER_DEFINITIONS,
  PAGE_REQUIRED_PERMISSIONS,
} = require('../lib/filter_catalog');
const {
  effectiveFilterSchemaFor,
  getFilterPermissionVersion,
  installFilterAuthorization,
  listFilterDefinitions,
  validateFilterQuery,
} = require('../lib/filter_authorization');

const NOW = '2026-08-01 12:00:00';

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE permission_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role_key TEXT NOT NULL,
      permissions_json TEXT NOT NULL
    );
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      permission_group_id TEXT NOT NULL,
      permissions_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE user_permission_overrides (
      user_id TEXT NOT NULL,
      permission_key TEXT NOT NULL,
      effect TEXT NOT NULL,
      PRIMARY KEY(user_id, permission_key)
    );
  `);
  const insertGroup = db.prepare(
    'INSERT INTO permission_groups(id,name,role_key,permissions_json) VALUES (?,?,?,?)',
  );
  const insertUser = db.prepare(
    'INSERT INTO sales_users(id,role,permission_group_id) VALUES (?,?,?)',
  );
  for (const role of ['admin', 'manager', 'sales']) {
    const groupId = `PGRP-${role.toUpperCase()}`;
    insertGroup.run(groupId, role, role, JSON.stringify(ROLE_PERMISSIONS[role]));
    insertUser.run(role.toUpperCase(), role, groupId);
  }
  installFilterAuthorization(db, { now: NOW });
  return db;
}

function user(role, patch = {}) {
  return {
    id: role.toUpperCase(),
    role,
    permission_group_id: `PGRP-${role.toUpperCase()}`,
    permissions: { ...ROLE_PERMISSIONS[role], ...patch },
  };
}

function schemaKeys(db, actor, page) {
  return effectiveFilterSchemaFor(db, actor, page).filters.map(item => item.key);
}

test('manager task permissions have explicit least-privilege role defaults', () => {
  assert.equal(ROLE_PERMISSIONS.admin.manage_manager_task_settings, true);
  assert.equal(ROLE_PERMISSIONS.manager.manage_manager_task_settings, false);
  assert.equal(ROLE_PERMISSIONS.sales.manage_manager_task_settings, false);
  assert.equal(ROLE_PERMISSIONS.admin.resolve_manager_tasks, true);
  assert.equal(ROLE_PERMISSIONS.manager.resolve_manager_tasks, true);
  assert.equal(ROLE_PERMISSIONS.sales.resolve_manager_tasks, false);
});

test('manager routes normalize to explicit policies and separate business from safety writes', () => {
  const expected = new Map([
    ['POST /accounts/CRM-1/deferred-plan', 'POST /accounts/:customerId/deferred-plan'],
    ['GET /manager-task-settings', 'GET /manager-task-settings'],
    ['PATCH /manager-task-settings', 'PATCH /manager-task-settings'],
    ['GET /manager-tasks', 'GET /manager-tasks'],
    ['POST /manager-tasks', 'POST /manager-tasks'],
    ['GET /manager-tasks/MT-1', 'GET /manager-tasks/:taskId'],
    ['POST /manager-tasks/MT-1/resolve', 'POST /manager-tasks/:taskId/resolve'],
    ['GET /manager-metrics', 'GET /manager-metrics'],
    ['GET /manager-risks', 'GET /manager-risks'],
    ['GET /manager-tasks/export', 'GET /manager-tasks/export'],
  ]);
  for (const [request, key] of expected) {
    const separator = request.indexOf(' ');
    const method = request.slice(0, separator);
    const path = request.slice(separator + 1);
    assert.deepEqual(policyForSalesRequest(method, path), SALES_ROUTE_POLICIES[key], key);
  }

  assert.deepEqual(SALES_ROUTE_POLICIES['POST /accounts/:customerId/deferred-plan'], {
    permissions: ['record_activity'],
  });
  assert.deepEqual(SALES_ROUTE_POLICIES['GET /manager-task-settings'], {
    permissions: ['manage_manager_task_settings'],
  });
  assert.deepEqual(SALES_ROUTE_POLICIES['GET /manager-tasks/export'], {
    permissions: ['resolve_manager_tasks', 'export_data'],
  });

  for (const key of [
    'PATCH /manager-task-settings',
    'POST /manager-tasks',
  ]) {
    assert.throws(
      () => assertPolicyAllowed(SALES_ROUTE_POLICIES[key], { isImpersonating: true }),
      error => error.code === 'IMPERSONATION_ACTION_BLOCKED',
      key,
    );
  }
  for (const key of [
    'POST /accounts/:customerId/deferred-plan',
    'POST /manager-tasks/:taskId/resolve',
    'GET /manager-task-settings', 'GET /manager-tasks', 'GET /manager-tasks/:taskId',
    'GET /manager-metrics', 'GET /manager-risks', 'GET /manager-tasks/export',
  ]) {
    assert.doesNotThrow(
      () => assertPolicyAllowed(SALES_ROUTE_POLICIES[key], { isImpersonating: true }),
      key,
    );
  }
});

test('manager pages expose authorized safe fields while sales cannot see their schema', () => {
  const db = createDb();
  assert.deepEqual(PAGE_REQUIRED_PERMISSIONS.manager_tasks, ['resolve_manager_tasks']);
  assert.deepEqual(PAGE_REQUIRED_PERMISSIONS.manager_risks, ['resolve_manager_tasks']);
  assert.deepEqual(PAGE_REQUIRED_PERMISSIONS.manager_metrics, ['resolve_manager_tasks']);
  assert.deepEqual(PAGE_REQUIRED_PERMISSIONS.notifications, ['view_customers']);

  const definitions = new Map(FILTER_DEFINITIONS.map(item => [item.key, item]));
  for (const key of ['task_status', 'task_reason', 'task_due_at', 'task_resolved_at']) {
    assert.equal(definitions.get(key).sensitive, false, key);
  }
  for (const key of ['owner', 'recipient']) {
    assert.equal(definitions.get(key).sensitive, true, key);
  }

  const managerTaskKeys = schemaKeys(db, user('manager'), 'manager_tasks');
  for (const key of [
    'search', 'owner', 'stage', 'created_at', 'task_status', 'task_reason',
    'recipient', 'task_due_at', 'task_resolved_at',
  ]) {
    assert.ok(managerTaskKeys.includes(key), key);
  }
  assert.deepEqual(schemaKeys(db, user('sales'), 'manager_tasks'), []);
  assert.deepEqual(schemaKeys(db, user('sales'), 'manager_risks'), []);
  assert.deepEqual(schemaKeys(db, user('sales'), 'manager_metrics'), []);
  assert.ok(schemaKeys(db, user('manager'), 'manager_metrics').includes('recipient'));

  const salesNotificationKeys = schemaKeys(db, user('sales'), 'notifications');
  for (const key of [
    'search', 'created_at', 'notification_status', 'notification_code',
    'notification_severity',
  ]) {
    assert.ok(salesNotificationKeys.includes(key), key);
  }
  assert.equal(salesNotificationKeys.includes('recipient'), false);
  db.close();
});

test('admin bypasses filter grants but unknown fields fail opaquely for every role', () => {
  const db = createDb();
  db.prepare("DELETE FROM permission_group_filter_grants WHERE group_id='PGRP-ADMIN'").run();
  const adminKeys = schemaKeys(db, user('admin'), 'manager_tasks');
  assert.ok(adminKeys.includes('task_status'));
  assert.ok(adminKeys.includes('recipient'));

  for (const [actor, page, query] of [
    [user('admin'), 'manager_tasks', { unreleased_internal_score: { operator: 'in', values: ['x'] } }],
    [user('manager'), 'manager_tasks', { secret_assignment_reason: { operator: 'in', values: ['x'] } }],
    [user('sales'), 'manager_tasks', { task_status: { operator: 'in', values: ['open'] } }],
  ]) {
    assert.throws(
      () => validateFilterQuery(db, actor, page, query),
      error => error.statusCode === 403
        && error.code === 'FILTER_NOT_AUTHORIZED'
        && error.message === '筛选条件未获授权'
        && !error.message.includes(Object.keys(query)[0]),
    );
  }
  db.close();
});

test('manager page catalog migration upgrades old page mappings once', () => {
  const db = createDb();
  db.prepare("DELETE FROM filter_catalog_migrations WHERE migration_key='issue170-manager-pages-v1'").run();
  for (const key of ['search', 'owner', 'stage', 'created_at']) {
    const row = db.prepare('SELECT pages_json FROM filter_definitions WHERE filter_key=?').get(key);
    const pages = JSON.parse(row.pages_json).filter(page =>
      !['manager_tasks', 'manager_risks', 'manager_metrics', 'notifications'].includes(page));
    db.prepare('UPDATE filter_definitions SET pages_json=? WHERE filter_key=?')
      .run(JSON.stringify(pages), key);
  }
  const beforeVersion = getFilterPermissionVersion(db);
  installFilterAuthorization(db, { now: '2026-08-01 13:00:00' });
  assert.equal(getFilterPermissionVersion(db), beforeVersion + 1);
  const definitions = new Map(listFilterDefinitions(db).map(item => [item.key, item]));
  assert.ok(definitions.get('search').pages.includes('notifications'));
  assert.ok(definitions.get('owner').pages.includes('manager_tasks'));
  assert.ok(definitions.get('stage').pages.includes('manager_risks'));
  assert.ok(definitions.get('created_at').pages.includes('manager_metrics'));
  assert.ok(db.prepare(`SELECT 1 FROM filter_catalog_migrations
    WHERE migration_key='issue170-manager-pages-v1'`).get());

  const migratedVersion = getFilterPermissionVersion(db);
  installFilterAuthorization(db, { now: '2026-08-01 14:00:00' });
  assert.equal(getFilterPermissionVersion(db), migratedVersion);
  db.close();
});

test('manager metric recipient catalog migration upgrades existing catalogs once', () => {
  const db = createDb();
  const migrationKey = 'issue196-manager-metric-recipient-v1';
  db.prepare('DELETE FROM filter_catalog_migrations WHERE migration_key=?').run(migrationKey);
  const row = db.prepare(
    "SELECT pages_json FROM filter_definitions WHERE filter_key='recipient'",
  ).get();
  const legacyPages = JSON.parse(row.pages_json).filter(page => page !== 'manager_metrics');
  db.prepare("UPDATE filter_definitions SET pages_json=? WHERE filter_key='recipient'")
    .run(JSON.stringify(legacyPages));

  const beforeVersion = getFilterPermissionVersion(db);
  installFilterAuthorization(db, { now: '2026-08-01 15:00:00' });
  assert.equal(getFilterPermissionVersion(db), beforeVersion + 1);
  const recipient = listFilterDefinitions(db).find(item => item.key === 'recipient');
  assert.ok(recipient.pages.includes('manager_metrics'));
  assert.ok(db.prepare(
    'SELECT 1 FROM filter_catalog_migrations WHERE migration_key=?',
  ).get(migrationKey));

  const migratedVersion = getFilterPermissionVersion(db);
  installFilterAuthorization(db, { now: '2026-08-01 16:00:00' });
  assert.equal(getFilterPermissionVersion(db), migratedVersion);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM filter_catalog_migrations
    WHERE migration_key=?`).get(migrationKey).count, 1);
  db.close();
});
