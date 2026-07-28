'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  FILTER_DEFINITIONS,
  FILTER_SOURCE_CATALOG,
  PAGE_REQUIRED_PERMISSIONS,
} = require('../lib/filter_catalog');
const {
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
} = require('../lib/filter_authorization');

const NOW = '2026-07-28 10:00:00';

function permissionMap(patch = {}) {
  return {
    view_customers: true,
    view_pipeline: true,
    view_all_customers: false,
    view_contacts: false,
    view_insights: false,
    view_users: false,
    manage_users: false,
    ...patch,
  };
}

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
  insertGroup.run('PGRP-ADMIN', 'Admin', 'admin', JSON.stringify(permissionMap({
    view_all_customers: true,
    view_contacts: true,
    view_insights: true,
    view_users: true,
    manage_users: true,
  })));
  insertGroup.run('PGRP-SALES', 'Sales', 'sales', JSON.stringify(permissionMap()));
  const insertUser = db.prepare(
    'INSERT INTO sales_users(id,role,permission_group_id) VALUES (?,?,?)',
  );
  insertUser.run('ADMIN', 'admin', 'PGRP-ADMIN');
  insertUser.run('SALES', 'sales', 'PGRP-SALES');
  installFilterAuthorization(db, { now: NOW });
  return db;
}

function actor(patch = {}) {
  return {
    id: 'ADMIN',
    role: 'admin',
    permissions: permissionMap({
      view_all_customers: true,
      view_users: true,
      manage_users: true,
      ...patch,
    }),
  };
}

function sales(patch = {}) {
  return {
    id: 'SALES',
    role: 'sales',
    permission_group_id: 'PGRP-SALES',
    permissions: permissionMap(patch),
  };
}

function keys(schema) {
  return schema.filters.map(item => item.key);
}

test('install creates an idempotent versioned catalog with supported pages and seven tag categories', () => {
  const db = createDb();
  assert.doesNotThrow(() => installFilterAuthorization(db, { now: NOW }));
  assert.equal(getFilterPermissionVersion(db), 1);
  assert.equal(
    db.prepare('SELECT COUNT(*) count FROM filter_definitions').get().count,
    FILTER_DEFINITIONS.length,
  );
  for (const table of [
    'filter_definitions',
    'permission_group_filter_grants',
    'user_filter_extra_grants',
    'filter_permission_state',
    'filter_permission_audit',
  ]) {
    assert.ok(db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
    ).get(table), table);
  }
  assert.deepEqual(PAGE_REQUIRED_PERMISSIONS, {
    customers: ['view_customers'],
    intake: ['view_intake'],
    lead_flow: ['view_intake'],
    pipeline: ['view_pipeline'],
    alerts: ['view_alerts'],
    insights: ['view_insights'],
    recycle_bin: ['manage_customer_recycle'],
    contacts: ['view_contacts'],
    recon: ['view_recon'],
  });
  assert.ok(FILTER_SOURCE_CATALOG.some(item => item.key === 'city'));
  const definitions = listFilterDefinitions(db);
  assert.equal(definitions.some(item => item.key === 'city'), false);
  assert.deepEqual(listAvailableFilterSources(db).map(item => item.key), ['city']);
  assert.equal(definitions.filter(item => item.type === 'tag_multi').length, 7);
  for (const key of [
    'search', 'country', 'owner', 'stage', 'customer_type', 'industry',
    'priority', 'source', 'creator', 'last_action', 'next_step', 'created_at',
    'tag_customer_type', 'tag_business_product', 'tag_demand_product',
    'tag_industry', 'tag_focus_scenario', 'tag_needs_confirmation', 'tag_list',
  ]) {
    assert.ok(definitions.some(item => item.key === key), key);
  }
  db.prepare("DELETE FROM filter_definitions WHERE filter_key='tag_list'").run();
  installFilterAuthorization(db, { now: '2026-07-28 11:00:00' });
  assert.equal(getFilterPermissionVersion(db), 2);
  assert.ok(listFilterDefinitions(db).some(item => item.key === 'tag_list'));
  db.close();
});

test('install upgrades the legacy definition table with a displayed column', () => {
  const db = createDb();
  db.exec('ALTER TABLE filter_definitions DROP COLUMN displayed');
  assert.equal(
    db.prepare('PRAGMA table_info(filter_definitions)').all()
      .some(column => column.name === 'displayed'),
    false,
  );
  installFilterAuthorization(db, { now: '2026-07-28 11:00:00' });
  assert.equal(
    db.prepare('PRAGMA table_info(filter_definitions)').all()
      .some(column => column.name === 'displayed'),
    true,
  );
  assert.equal(
    db.prepare("SELECT displayed FROM filter_definitions WHERE filter_key='country'").get().displayed,
    1,
  );
  assert.equal(getFilterPermissionVersion(db), 1);
  db.close();
});

test('install migrates legacy page coverage and default grants once, including partial catalogs', () => {
  const db = createDb();
  const beforeVersion = getFilterPermissionVersion(db);
  db.prepare("DELETE FROM filter_catalog_migrations WHERE migration_key='issue116-business-pages-v1'").run();
  db.prepare("UPDATE filter_definitions SET pages_json='[\"customers\"]' WHERE filter_key='search'").run();
  db.prepare("DELETE FROM permission_group_filter_grants WHERE group_id='PGRP-SALES' AND filter_key='status'").run();
  assert.ok(db.prepare(
    "SELECT 1 FROM filter_definitions WHERE filter_key='updated_at'",
  ).get(), 'partial catalog already contains a previous research field');

  installFilterAuthorization(db, { now: '2026-07-28 11:30:00' });
  assert.equal(getFilterPermissionVersion(db), beforeVersion + 1);
  const searchPages = JSON.parse(db.prepare(
    "SELECT pages_json FROM filter_definitions WHERE filter_key='search'",
  ).get().pages_json);
  for (const page of ['customers', 'intake', 'lead_flow', 'alerts', 'insights',
    'recycle_bin', 'contacts', 'recon']) {
    assert.ok(searchPages.includes(page), page);
  }
  assert.ok(db.prepare(`SELECT 1 FROM permission_group_filter_grants
    WHERE group_id='PGRP-SALES' AND filter_key='status'`).get());

  installFilterAuthorization(db, { now: '2026-07-28 12:00:00' });
  assert.equal(getFilterPermissionVersion(db), beforeVersion + 1);
  db.close();
});

test('effective schema applies page, global, data permission, group, extra and admin precedence', () => {
  const db = createDb();
  saveGroupFilterGrants(db, actor(), 'PGRP-SALES', ['search', 'country', 'owner'], {
    note: 'sales baseline',
    now: NOW,
  });
  saveUserExtraFilterGrants(db, actor(), 'SALES', ['priority'], {
    note: 'priority exception',
    now: NOW,
  });

  const restricted = effectiveFilterSchemaFor(db, sales(), 'customers');
  assert.deepEqual(keys(restricted), ['search', 'country', 'priority']);
  assert.equal(restricted.page, 'customers');
  assert.equal(restricted.version, getFilterPermissionVersion(db));
  assert.equal(restricted.filters[0].requiredPermissions, undefined);

  const expanded = effectiveFilterSchemaFor(
    db,
    sales({ view_all_customers: true }),
    'customers',
  );
  assert.deepEqual(keys(expanded), ['search', 'country', 'owner', 'priority']);

  updateFilterDefinition(db, actor(), 'country', { enabled: false }, {
    note: 'temporarily hidden',
    now: NOW,
  });
  assert.deepEqual(
    keys(effectiveFilterSchemaFor(db, sales({ view_all_customers: true }), 'customers')),
    ['search', 'owner', 'priority'],
  );

  const adminWithoutOwnerVisibility = effectiveFilterSchemaFor(
    db,
    actor({ view_all_customers: false }),
    'pipeline',
  );
  assert.equal(keys(adminWithoutOwnerVisibility).includes('owner'), false);
  assert.equal(keys(adminWithoutOwnerVisibility).includes('stage'), true);
  assert.deepEqual(
    effectiveFilterSchemaFor(db, sales({ view_customers: false }), 'customers').filters,
    [],
  );
  assert.deepEqual(effectiveFilterSchemaFor(db, sales(), 'unknown').filters, []);
  db.close();
});

test('group grants replace atomically, increment version and audit before and after', () => {
  const db = createDb();
  const first = saveGroupFilterGrants(
    db,
    actor(),
    'PGRP-SALES',
    ['country', 'search', 'country'],
    { note: 'baseline', now: NOW, expectedVersion: 1 },
  );
  assert.equal(first.version, 2);
  assert.deepEqual(first.grants, ['search', 'country']);

  const second = saveGroupFilterGrants(
    db,
    actor(),
    'PGRP-SALES',
    ['stage'],
    { note: 'replace', now: NOW, expectedVersion: 2 },
  );
  assert.equal(second.version, 3);
  assert.deepEqual(second.grants, ['stage']);
  assert.deepEqual(
    db.prepare(
      'SELECT filter_key FROM permission_group_filter_grants WHERE group_id=? ORDER BY filter_key',
    ).all('PGRP-SALES').map(row => row.filter_key),
    ['stage'],
  );
  const audits = db.prepare(
    `SELECT action,target_type,target_id,before_json,after_json,note,version
     FROM filter_permission_audit ORDER BY rowid`,
  ).all();
  assert.equal(audits.length, 2);
  assert.deepEqual(JSON.parse(audits[1].before_json), ['search', 'country']);
  assert.deepEqual(JSON.parse(audits[1].after_json), ['stage']);
  assert.deepEqual(
    { action: audits[1].action, targetType: audits[1].target_type, targetId: audits[1].target_id },
    { action: 'group_grants_replaced', targetType: 'permission_group', targetId: 'PGRP-SALES' },
  );
  assert.equal(audits[1].note, 'replace');
  assert.equal(audits[1].version, 3);

  assert.throws(
    () => saveGroupFilterGrants(db, actor(), 'PGRP-SALES', ['search'], {
      expectedVersion: 2,
      now: NOW,
    }),
    error => error.statusCode === 409 && error.code === 'FILTER_VERSION_CONFLICT',
  );
  assert.equal(getFilterPermissionVersion(db), 3);
  db.close();
});

test('member grants are additive only and restore removes extras without changing the group', () => {
  const db = createDb();
  saveGroupFilterGrants(db, actor(), 'PGRP-SALES', ['country'], { now: NOW });
  db.prepare(`INSERT INTO user_permission_overrides(user_id,permission_key,effect)
    VALUES ('SALES','view_all_customers','allow')`).run();
  const saved = saveUserExtraFilterGrants(
    db,
    actor(),
    'SALES',
    ['country', 'owner', 'priority'],
    {
      note: 'approved exception',
      now: NOW,
    },
  );
  assert.deepEqual(saved.grants, ['owner', 'priority']);
  assert.deepEqual(
    keys(effectiveFilterSchemaFor(
      db,
      sales({ view_all_customers: true }),
      'customers',
    )),
    ['country', 'owner', 'priority'],
  );

  const restored = restoreUserExtraFilterGrants(db, actor(), 'SALES', {
    note: 'restore default',
    now: NOW,
  });
  assert.deepEqual(restored.grants, []);
  assert.deepEqual(
    db.prepare(
      'SELECT filter_key FROM permission_group_filter_grants WHERE group_id=?',
    ).all('PGRP-SALES').map(row => row.filter_key),
    ['country'],
  );
  assert.deepEqual(
    keys(effectiveFilterSchemaFor(
      db,
      sales({ view_all_customers: true }),
      'customers',
    )),
    ['country'],
  );
  const audit = db.prepare(
    "SELECT * FROM filter_permission_audit WHERE action='user_extras_restored'",
  ).get();
  assert.ok(audit);
  assert.deepEqual(JSON.parse(audit.before_json), ['owner', 'priority']);
  assert.deepEqual(JSON.parse(audit.after_json), []);
  db.close();
});

test('a failed audit insert rolls back grants and the permission version', () => {
  const db = createDb();
  saveGroupFilterGrants(db, actor(), 'PGRP-SALES', ['search'], { now: NOW });
  const beforeVersion = getFilterPermissionVersion(db);
  db.exec(`CREATE TRIGGER reject_filter_permission_audit
    BEFORE INSERT ON filter_permission_audit
    BEGIN
      SELECT RAISE(ABORT, 'audit unavailable');
    END`);
  assert.throws(
    () => saveGroupFilterGrants(db, actor(), 'PGRP-SALES', ['country'], {
      now: '2026-07-28 12:00:00',
    }),
    /audit unavailable/,
  );
  assert.equal(getFilterPermissionVersion(db), beforeVersion);
  assert.deepEqual(
    db.prepare(
      'SELECT filter_key FROM permission_group_filter_grants WHERE group_id=?',
    ).all('PGRP-SALES').map(row => row.filter_key),
    ['search'],
  );
  db.close();
});

test('definition updates validate configurable fields and audit the committed snapshot', () => {
  const db = createDb();
  const before = listFilterDefinitions(db).find(item => item.key === 'industry');
  const result = updateFilterDefinition(db, actor(), 'industry', {
    label: '所属行业',
    displayMode: 'more',
    sortOrder: 77,
    operators: ['in'],
    sensitive: true,
    requiredPermissions: ['view_customers'],
    pages: ['customers'],
  }, { note: 'security review', now: NOW });
  assert.equal(result.version, 2);
  const after = listFilterDefinitions(db).find(item => item.key === 'industry');
  assert.equal(after.label, '所属行业');
  assert.equal(after.displayMode, 'more');
  assert.equal(after.sortOrder, 77);
  assert.equal(after.sensitive, true);
  assert.deepEqual(after.requiredPermissions, ['view_customers']);
  assert.deepEqual(after.pages, ['customers']);
  const audit = db.prepare(
    "SELECT * FROM filter_permission_audit WHERE action='definition_updated'",
  ).get();
  assert.equal(JSON.parse(audit.before_json).label, before.label);
  assert.equal(JSON.parse(audit.after_json).label, '所属行业');
  assert.equal(audit.note, 'security review');

  assert.throws(
    () => updateFilterDefinition(db, actor(), 'industry', { operators: ['between'] }),
    error => error.statusCode === 400 && error.code === 'FILTER_CONFIG_INVALID',
  );
  assert.throws(
    () => updateFilterDefinition(db, actor(), 'owner', { requiredPermissions: [] }),
    error => error.statusCode === 400 && error.code === 'FILTER_CONFIG_INVALID',
  );
  assert.throws(
    () => updateFilterDefinition(db, actor(), 'created_at', { type: 'multi', operators: ['in'] }),
    error => error.statusCode === 400 && error.code === 'FILTER_CONFIG_INVALID',
  );
  assert.throws(
    () => updateFilterDefinition(db, actor(), 'tag_business_product', { sensitive: false }),
    error => error.statusCode === 400 && error.code === 'FILTER_CONFIG_INVALID',
  );
  assert.throws(
    () => updateFilterDefinition(db, sales(), 'industry', { enabled: false }),
    error => error.statusCode === 403,
  );
  db.close();
});

test('hidden display mode is persisted compatibly and excluded from schemas and AST authorization', () => {
  const db = createDb();
  saveGroupFilterGrants(db, actor(), 'PGRP-SALES', ['country'], { now: NOW });
  updateFilterDefinition(db, actor(), 'country', { displayMode: 'hidden' }, { now: NOW });
  const stored = db.prepare(`SELECT display_mode,displayed FROM filter_definitions
    WHERE filter_key='country'`).get();
  assert.deepEqual(stored, { display_mode: 'horizontal', displayed: 0 });
  assert.equal(listFilterDefinitions(db).find(item => item.key === 'country').displayMode, 'hidden');
  assert.deepEqual(keys(effectiveFilterSchemaFor(db, sales(), 'customers')), []);
  assert.equal(keys(effectiveFilterSchemaFor(db, actor(), 'customers')).includes('country'), false);
  assert.throws(
    () => validateFilterQuery(db, sales(), 'customers', {
      country: { operator: 'in', values: ['俄罗斯'] },
    }),
    error => error.statusCode === 403 && error.code === 'FILTER_NOT_AUTHORIZED',
  );
  installFilterAuthorization(db, { now: '2026-07-28 11:00:00' });
  assert.equal(listFilterDefinitions(db).find(item => item.key === 'country').displayMode, 'hidden');
  updateFilterDefinition(db, actor(), 'country', { displayMode: 'more' }, { now: NOW });
  assert.deepEqual(
    db.prepare(`SELECT display_mode,displayed FROM filter_definitions
      WHERE filter_key='country'`).get(),
    { display_mode: 'more', displayed: 1 },
  );
  db.close();
});

test('create accepts registered sources, does not grant groups, and audits the versioned definition', () => {
  const db = createDb();
  const result = createFilterDefinition(db, actor(), {
    sourceKey: 'city',
    label: '所在城市',
    displayMode: 'more',
    requiredPermissions: ['view_customers'],
    pages: ['customers'],
  }, { expectedVersion: 1, note: 'enable city source', now: NOW });
  assert.equal(result.version, 2);
  assert.deepEqual(result.definition, {
    key: 'city',
    label: '所在城市',
    type: 'multi',
    enabled: true,
    sensitive: false,
    operators: ['in'],
    displayMode: 'more',
    sortOrder: 25,
    requiredPermissions: ['view_customers'],
    pages: ['customers'],
    tagCategory: '',
  });
  assert.equal(
    db.prepare(`SELECT COUNT(*) count FROM permission_group_filter_grants
      WHERE filter_key='city'`).get().count,
    0,
  );
  assert.deepEqual(listAvailableFilterSources(db), []);
  const audit = db.prepare(
    "SELECT * FROM filter_permission_audit WHERE action='definition_created'",
  ).get();
  assert.equal(audit.target_id, 'city');
  assert.equal(audit.before_json, 'null');
  assert.equal(JSON.parse(audit.after_json).label, '所在城市');
  assert.equal(audit.note, 'enable city source');
  db.close();
});

test('create rejects duplicate, unknown, stale and unsafe source definitions', () => {
  const db = createDb();
  assert.throws(
    () => createFilterDefinition(db, actor(), { sourceKey: 'country' }, { now: NOW }),
    error => error.statusCode === 409 && error.code === 'FILTER_DEFINITION_EXISTS',
  );
  assert.throws(
    () => createFilterDefinition(db, actor(), { sourceKey: 'arbitrary_sql' }, { now: NOW }),
    error => error.statusCode === 400 && error.code === 'FILTER_CONFIG_INVALID',
  );
  assert.throws(
    () => createFilterDefinition(db, actor(), {
      sourceKey: 'city', type: 'text', operators: ['contains'],
    }, { now: NOW }),
    error => error.statusCode === 400 && error.code === 'FILTER_CONFIG_INVALID',
  );
  assert.throws(
    () => createFilterDefinition(db, actor(), {
      sourceKey: 'city', pages: ['pipeline'],
    }, { now: NOW }),
    error => error.statusCode === 400 && error.code === 'FILTER_CONFIG_INVALID',
  );
  assert.throws(
    () => createFilterDefinition(db, actor(), { sourceKey: 'city' }, {
      expectedVersion: 0, now: NOW,
    }),
    error => error.statusCode === 409 && error.code === 'FILTER_VERSION_CONFLICT',
  );
  assert.equal(listFilterDefinitions(db).some(item => item.key === 'city'), false);
  db.close();
});

test('a failed create audit rolls back the definition and permission version', () => {
  const db = createDb();
  db.exec(`CREATE TRIGGER reject_filter_definition_audit
    BEFORE INSERT ON filter_permission_audit
    WHEN NEW.action='definition_created'
    BEGIN
      SELECT RAISE(ABORT, 'definition audit unavailable');
    END`);
  assert.throws(
    () => createFilterDefinition(db, actor(), { sourceKey: 'city' }, { now: NOW }),
    /definition audit unavailable/,
  );
  assert.equal(getFilterPermissionVersion(db), 1);
  assert.equal(listFilterDefinitions(db).some(item => item.key === 'city'), false);
  assert.deepEqual(listAvailableFilterSources(db).map(item => item.key), ['city']);
  db.close();
});

test('query validation returns a fixed typed AST and enforces configured limits', () => {
  const db = createDb();
  saveGroupFilterGrants(
    db,
    actor(),
    'PGRP-SALES',
    ['search', 'country', 'created_at'],
    { now: NOW },
  );
  const result = validateFilterQuery(db, sales(), 'customers', {
    search: { operator: 'contains', value: '  Acme  ' },
    country: { operator: 'in', values: ['俄罗斯', '德国', '俄罗斯'] },
    created_at: { operator: 'between', from: '2026-07-01', to: '2026-07-28' },
  });
  assert.deepEqual(result, {
    version: getFilterPermissionVersion(db),
    page: 'customers',
    filters: [
      { key: 'search', operator: 'contains', value: 'Acme' },
      { key: 'country', operator: 'in', values: ['俄罗斯', '德国'] },
      { key: 'created_at', operator: 'between', from: '2026-07-01', to: '2026-07-28' },
    ],
  });

  assert.throws(
    () => validateFilterQuery(db, sales(), 'customers', {
      search: { operator: 'contains', value: 'x'.repeat(121) },
    }),
    error => error.statusCode === 400 && error.code === 'FILTER_VALUE_INVALID',
  );
  assert.throws(
    () => validateFilterQuery(db, sales(), 'customers', {
      country: { operator: 'in', values: Array.from({ length: 51 }, (_, index) => `C${index}`) },
    }),
    error => error.statusCode === 400 && error.code === 'FILTER_VALUE_INVALID',
  );
  assert.throws(
    () => validateFilterQuery(db, sales(), 'customers', {
      created_at: { operator: 'between', from: '2026-07-30', to: '2026-07-01' },
    }),
    error => error.statusCode === 400 && error.code === 'FILTER_VALUE_INVALID',
  );
  assert.throws(
    () => validateFilterQuery(db, sales(), 'customers', {
      country: { operator: 'contains', value: '俄罗斯' },
    }),
    error => error.statusCode === 400 && error.code === 'FILTER_OPERATOR_INVALID',
  );
  db.close();
});

test('unknown and known-but-unauthorized filters fail identically without echoing a key', () => {
  const db = createDb();
  saveGroupFilterGrants(db, actor(), 'PGRP-SALES', ['search'], { now: NOW });
  const capture = input => {
    try {
      validateFilterQuery(db, sales(), 'customers', input);
      assert.fail('expected a permission error');
    } catch (error) {
      return {
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
      };
    }
  };
  const unknown = capture({ secret_field: { operator: 'in', values: ['x'] } });
  const unauthorized = capture({ owner: { operator: 'in', values: ['ADMIN'] } });
  assert.deepEqual(unknown, unauthorized);
  assert.deepEqual(unknown, {
    statusCode: 403,
    code: 'FILTER_NOT_AUTHORIZED',
    message: '筛选条件未获授权',
  });
  assert.doesNotMatch(JSON.stringify(unknown), /secret_field|owner/);
  db.close();
});
