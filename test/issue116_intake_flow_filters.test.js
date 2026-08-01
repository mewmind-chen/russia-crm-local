'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  INTAKE_FLOW_PAGE_CONFIG,
  listIntakeFlowFilterDefinitions,
  buildIntakeFlowFilterScope,
  intakeFlowFilterOptions,
  queryIntakeFlowPage,
} = require('../lib/intake_flow_filters');

function user(id = 'U-ONE', permissions = {}, role = 'sales') {
  return {
    id,
    role,
    permissions: {
      view_intake: true,
      view_contacts: true,
      manage_intake: false,
      ...permissions,
    },
  };
}

function ast(page, filters = []) {
  return { page, filters };
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE crm_intake_batches (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_intake_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      external_customer_id TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '',
      product_focus TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      contact_title TEXT NOT NULL DEFAULT '',
      contact_methods TEXT NOT NULL DEFAULT '',
      contact_level TEXT NOT NULL DEFAULT 'L3',
      status TEXT NOT NULL DEFAULT 'pending',
      suggested_owner_id TEXT NOT NULL DEFAULT '',
      assigned_owner_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      is_preset INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE customer_tags (
      customer_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL
    );
    INSERT INTO crm_intake_batches(id,source,created_at) VALUES
      ('B-A','manual','2026-07-28 08:00:00'),
      ('B-B','screened','2026-07-27 08:00:00');
    INSERT INTO sales_users(id,name) VALUES
      ('U-ONE','One'),('U-TWO','Two');
    INSERT INTO customer_pool(customer_id,company_name,nickname) VALUES
      ('C-PENDING','Pending One',''),('C-APPROVED','Approved One',''),
      ('C-ASSIGNED-ONE','Assigned One',''),('C-CLAIMED-ONE','Claimed One',''),
      ('C-RETURNED-ONE','Returned One',''),('C-REJECTED-TWO','Rejected Two',''),
      ('C-DUPLICATE','Duplicate Hidden','');
  `);
  const insert = db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,country,website,industry,
     customer_type,product_focus,contact_name,contact_title,contact_methods,contact_level,
     status,assigned_owner_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run('I-PENDING', 'B-A', 'C-PENDING', 'Pending One', 'RU', '', 'Industrial',
    'Manufacturer', 'Controllers', '', '', '', 'L0', 'pending', '',
    '2026-07-28 08:00:00', '2026-07-28 08:00:00');
  insert.run('I-APPROVED', 'B-A', 'C-APPROVED', 'Approved One', 'RU', 'https://approved.test', 'Industrial',
    'Manufacturer', 'Sensors', 'Alice Secret', 'Buyer', 'alice@secret.test', 'L3', 'approved', '',
    '2026-07-28 09:00:00', '2026-07-28 09:00:00');
  insert.run('I-ASSIGNED-ONE', 'B-B', 'C-ASSIGNED-ONE', 'Assigned One', 'DE', 'https://one.test', 'Automation',
    'Integrator', 'PLCs', 'Buyer One', 'Procurement', 'one@secret.test', 'L3', 'assigned', 'U-ONE',
    '2026-07-27 10:00:00', '2026-07-28 10:00:00');
  insert.run('I-CLAIMED-ONE', 'B-B', 'C-CLAIMED-ONE', 'Claimed One', 'DE', '', 'Automation',
    'Integrator', 'Drives', 'Engineer One', 'Engineering', 'engineer@secret.test', 'L2', 'claimed', 'U-ONE',
    '2026-07-27 11:00:00', '2026-07-28 11:00:00');
  insert.run('I-RETURNED-ONE', 'B-B', 'C-RETURNED-ONE', 'Returned One', 'DE', '', 'Automation',
    'Integrator', 'Relays', '', '', '', 'L0', 'returned', 'U-ONE',
    '2026-07-27 12:00:00', '2026-07-28 12:00:00');
  insert.run('I-REJECTED-TWO', 'B-B', 'C-REJECTED-TWO', 'Rejected Two', 'FR', '', 'Medical',
    'Distributor', 'Connectors', 'Other Secret', 'Director', 'other@secret.test', 'L3', 'rejected', 'U-TWO',
    '2026-07-27 13:00:00', '2026-07-28 13:00:00');
  insert.run('I-DUPLICATE', 'B-A', 'C-DUPLICATE', 'Duplicate Hidden', 'US', '', 'Hidden',
    'Hidden', 'Hidden', 'Hidden Secret', '', '', 'L3', 'duplicate', 'U-ONE',
    '2026-07-27 14:00:00', '2026-07-28 14:00:00');

  const addTag = (name, category, customerIds) => {
    const id = db.prepare('INSERT INTO tags(name,category) VALUES (?,?)').run(name, category).lastInsertRowid;
    const link = db.prepare('INSERT INTO customer_tags(customer_id,tag_id) VALUES (?,?)');
    customerIds.forEach(customerId => link.run(customerId, id));
  };
  addTag('Manufacturer', '客户类型', ['C-PENDING', 'C-ASSIGNED-ONE', 'C-CLAIMED-ONE']);
  addTag('Distributor', '客户类型', ['C-APPROVED']);
  addTag('Automation', '应用行业', ['C-ASSIGNED-ONE', 'C-RETURNED-ONE']);
  addTag('Medical', '应用行业', ['C-CLAIMED-ONE']);
  addTag('Secret List', '名单标签', ['C-REJECTED-TWO']);
  return db;
}

function ids(db, scope) {
  return db.prepare(`SELECT i.id FROM crm_intake_items i${scope.where} ORDER BY i.id`)
    .all(...scope.params).map(row => row.id);
}

function assertDenied(action, hidden = '') {
  assert.throws(action, error => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, 'FILTER_NOT_AUTHORIZED');
    assert.equal(error.message, '筛选条件未获授权');
    if (hidden) assert.doesNotMatch(error.message, new RegExp(hidden));
    return true;
  });
}

test('intake and lead-flow expose fixed server-owned filter contracts', () => {
  assert.deepEqual(Object.keys(INTAKE_FLOW_PAGE_CONFIG), ['intake', 'lead_flow']);
  for (const pageKey of Object.keys(INTAKE_FLOW_PAGE_CONFIG)) {
    const definitions = listIntakeFlowFilterDefinitions(pageKey);
    assert.ok(definitions.some(item => item.key === 'search'));
    assert.ok(definitions.some(item => item.key === 'status'));
    assert.ok(definitions.some(item => item.key === 'tag_customer_type'));
    assert.ok(definitions.every(item => Object.isFrozen(item)));
  }
});

test('manager-wide and assigned-owner scopes preserve current intake visibility', () => {
  const db = createDb();
  const personal = buildIntakeFlowFilterScope(user(), 'intake', ast('intake'));
  assert.deepEqual(ids(db, personal), ['I-ASSIGNED-ONE', 'I-CLAIMED-ONE', 'I-RETURNED-ONE']);

  const manager = buildIntakeFlowFilterScope(
    user('U-MANAGER', { manage_intake: true }, 'manager'),
    'intake',
    ast('intake'),
  );
  assert.deepEqual(ids(db, manager), [
    'I-APPROVED', 'I-ASSIGNED-ONE', 'I-CLAIMED-ONE',
    'I-DUPLICATE', 'I-PENDING', 'I-REJECTED-TWO', 'I-RETURNED-ONE',
  ]);
  db.close();
});

test('lead-flow keeps actual assigned, claimed, returned, and rejected status semantics', () => {
  const db = createDb();
  const manager = user('U-MANAGER', { manage_intake: true }, 'manager');
  assert.deepEqual(ids(db, buildIntakeFlowFilterScope(manager, 'lead_flow', ast('lead_flow'))), [
    'I-ASSIGNED-ONE', 'I-CLAIMED-ONE', 'I-REJECTED-TWO', 'I-RETURNED-ONE',
  ]);
  const returned = buildIntakeFlowFilterScope(manager, 'lead_flow', ast('lead_flow', [
    { key: 'status', operator: 'in', values: ['returned'] },
  ]));
  assert.deepEqual(ids(db, returned), ['I-RETURNED-ONE']);
  db.close();
});

test('authorized AST compiles search, facets, date, booleans, owner, and source batch safely', () => {
  const db = createDb();
  const manager = user('U-MANAGER', { manage_intake: true }, 'manager');
  const scope = buildIntakeFlowFilterScope(manager, 'intake', ast('intake', [
    { key: 'search', operator: 'contains', value: 'Assigned' },
    { key: 'country', operator: 'in', values: ['DE'] },
    { key: 'owner', operator: 'in', values: ['U-ONE'] },
    { key: 'source_batch', operator: 'in', values: ['screened'] },
    { key: 'updated_at', operator: 'between', from: '2026-07-28', to: '2026-07-28' },
    { key: 'has_website', operator: 'eq', value: true },
  ]));
  assert.deepEqual(ids(db, scope), ['I-ASSIGNED-ONE']);
  assert.equal(scope.params.includes('Assigned'), false);
  assert.ok(scope.params.includes('%Assigned%'));

  const injection = buildIntakeFlowFilterScope(manager, 'intake', ast('intake', [
    { key: 'owner', operator: 'in', values: ["U-ONE' OR 1=1 --"] },
  ]));
  assert.deepEqual(ids(db, injection), []);
  db.close();
});

test('tag values are OR within one category and AND across categories', () => {
  const db = createDb();
  const manager = user('U-MANAGER', { manage_intake: true }, 'manager');
  const withinCategory = buildIntakeFlowFilterScope(manager, 'intake', ast('intake', [
    { key: 'tag_customer_type', operator: 'in', values: ['Manufacturer', 'Distributor'] },
  ]));
  assert.deepEqual(ids(db, withinCategory), [
    'I-APPROVED', 'I-ASSIGNED-ONE', 'I-CLAIMED-ONE', 'I-PENDING',
  ]);

  const acrossCategories = buildIntakeFlowFilterScope(manager, 'intake', ast('intake', [
    { key: 'tag_customer_type', operator: 'in', values: ['Manufacturer', 'Distributor'] },
    { key: 'tag_industry', operator: 'in', values: ['Automation'] },
  ]));
  assert.deepEqual(ids(db, acrossCategories), ['I-ASSIGNED-ONE']);
  db.close();
});

test('pagination is bounded and total remains the exact scoped count', () => {
  const db = createDb();
  const result = queryIntakeFlowPage(
    db,
    user('U-MANAGER', { manage_intake: true }, 'manager'),
    'intake',
    ast('intake'),
    { page: 2, pageSize: 2 },
  );
  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 20);
  assert.equal(result.total, 7);
  assert.equal(result.items.length, 0);
  assert.equal(result.hasMore, false);

  const first = queryIntakeFlowPage(
    db,
    user('U-MANAGER', { manage_intake: true }, 'manager'),
    'intake',
    ast('intake'),
    { page: 1, pageSize: 999 },
  );
  assert.equal(first.pageSize, 200);
  assert.equal(first.items.length, 7);
  db.close();
});

test('filter options expose only requested authorized fields and the same row scope', () => {
  const db = createDb();
  const options = intakeFlowFilterOptions(db, user(), 'intake', [
    'country', 'industry', 'contact_level', 'tag_customer_type',
  ]);
  assert.deepEqual(Object.keys(options), [
    'country', 'industry', 'contact_level', 'tag_customer_type',
  ]);
  assert.deepEqual(options.country, [{ value: 'DE', label: 'DE', count: 3 }]);
  assert.deepEqual(options.industry, [{ value: 'Automation', label: 'Automation', count: 3 }]);
  assert.deepEqual(options.contact_level, [
    { value: 'L0', label: 'L0', count: 1 },
    { value: 'L2', label: 'L2', count: 1 },
    { value: 'L3', label: 'L3', count: 1 },
  ]);
  assert.deepEqual(options.tag_customer_type, [
    { value: 'Manufacturer', label: 'Manufacturer', count: 2 },
  ]);
  assert.doesNotMatch(JSON.stringify(options), /RU|FR|Distributor|Secret List/);

  const managerStatus = intakeFlowFilterOptions(
    db,
    user('U-MANAGER', { manage_intake: true }, 'manager'),
    'intake',
    ['status'],
  ).status;
  assert.deepEqual(Object.fromEntries(
    managerStatus.map(option => [option.value, option.label]),
  ), {
    approved: '待分配',
    assigned: '待领取',
    claimed: '已领取',
    duplicate: '已在 CRM',
    pending: '待分配',
    rejected: '不对口',
    returned: '已退回',
  });
  db.close();
});

test('unknown fields, wrong pages, and contact-sensitive filters fail without disclosure', () => {
  const db = createDb();
  const restricted = user('U-ONE', { view_contacts: false });
  assertDenied(() => buildIntakeFlowFilterScope(restricted, 'intake', ast('intake', [
    { key: 'secret_margin', operator: 'in', values: ['secret-value'] },
  ])), 'secret_margin|secret-value');
  assertDenied(() => buildIntakeFlowFilterScope(restricted, 'intake', ast('lead_flow')), 'lead_flow|intake');
  assertDenied(() => buildIntakeFlowFilterScope(restricted, 'intake', ast('intake', [
    { key: 'contact_level', operator: 'in', values: ['L3'] },
  ])), 'contact_level|L3');
  assertDenied(() => buildIntakeFlowFilterScope(restricted, 'intake', ast('intake', [
    { key: 'has_named_contact', operator: 'eq', value: true },
  ])), 'has_named_contact');
  assertDenied(() => intakeFlowFilterOptions(db, restricted, 'intake', ['contact_level']), 'contact_level');
  assertDenied(() => intakeFlowFilterOptions(db, restricted, 'intake'), 'contact_level');

  const hiddenSearch = queryIntakeFlowPage(db, restricted, 'intake', ast('intake', [
    { key: 'search', operator: 'contains', value: 'one@secret.test' },
  ]));
  assert.equal(hiddenSearch.total, 0);
  const visible = queryIntakeFlowPage(db, restricted, 'intake', ast('intake'));
  assert.ok(visible.items.length);
  assert.doesNotMatch(JSON.stringify(visible.items), /Buyer One|one@secret\.test|Controllers|PLCs|Drives/);
  db.close();
});
