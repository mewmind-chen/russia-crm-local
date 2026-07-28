'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  RESEARCH_PAGE_CONFIG,
  RESEARCH_FILTER_DEFINITIONS,
  listResearchFilterDefinitions,
  researchOwnerCondition,
  buildResearchFilterScope,
  researchFilterOptions,
} = require('../lib/research_filters');

function user(id = 'U-ONE', permissions = {}) {
  return {
    id,
    role: 'sales',
    permissions: {
      view_contacts: true,
      view_recon: true,
      view_all_customers: false,
      manage_intake: false,
      ...permissions,
    },
  };
}

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL,
      owner_id TEXT,
      lifecycle_status TEXT NOT NULL DEFAULT 'active',
      assignment_status TEXT NOT NULL DEFAULT 'claimed',
      is_test_data INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE person_candidates (
      person_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      full_name_local TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      contact_level TEXT NOT NULL DEFAULT 'L0',
      sales_ready INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE contact_methods (
      person_id TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE recon_results (
      job_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      company_name TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '',
      current_pool TEXT NOT NULL DEFAULT '',
      score TEXT NOT NULL DEFAULT '',
      opportunity_summary TEXT NOT NULL DEFAULT '',
      contacts_summary TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  const account = db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,owner_id,lifecycle_status,assignment_status)
    VALUES (?,?,?,'active',?)`);
  account.run('CRM-OWN', 'RU-OWN', 'U-ONE', 'claimed');
  account.run('CRM-OTHER', 'RU-OTHER', 'U-TWO', 'claimed');
  account.run('CRM-UNASSIGNED', 'RU-UNASSIGNED', null, 'claimed');
  account.run('CRM-RETURNED', 'RU-RETURNED', 'U-ONE', 'returned');
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,owner_id,lifecycle_status,assignment_status,is_test_data)
    VALUES ('CRM-TEST','RU-TEST','U-ONE','active','claimed',1),
      ('CRM-ARCHIVED','RU-ARCHIVED','U-ONE','archived','claimed',0)`).run();

  const pool = db.prepare('INSERT INTO customer_pool(customer_id,company_name) VALUES (?,?)');
  pool.run('RU-OWN', 'Owned Manufacturer');
  pool.run('RU-OTHER', 'Other Manufacturer');
  pool.run('RU-UNASSIGNED', 'Unassigned Manufacturer');
  pool.run('RU-RETURNED', 'Returned Manufacturer');
  pool.run('RU-TEST', 'Test Manufacturer');
  pool.run('RU-ARCHIVED', 'Archived Manufacturer');
  pool.run('RU-ORPHAN', 'Orphan Manufacturer');

  const person = db.prepare(`INSERT INTO person_candidates
    (person_id,customer_id,full_name,title,department,contact_level,sales_ready,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  person.run('P-OWN', 'RU-OWN', 'Owned Buyer', 'Procurement Manager', 'Procurement', 'L3', 1, '2026-07-28 10:00:00');
  person.run('P-OTHER', 'RU-OTHER', 'Other Buyer', 'Engineer', 'Engineering', 'L2', 0, '2026-07-27 10:00:00');
  person.run('P-UNASSIGNED', 'RU-UNASSIGNED', 'Unassigned Buyer', 'Director', 'Management', 'L1', 0, '2026-07-26 10:00:00');
  person.run('P-RETURNED', 'RU-RETURNED', 'Returned Buyer', 'Buyer', 'Procurement', 'L3', 1, '2026-07-25 10:00:00');
  db.prepare('INSERT INTO contact_methods(person_id,value) VALUES (?,?)')
    .run('P-OWN', 'owned-secret@example.test');
  db.prepare('INSERT INTO contact_methods(person_id,value) VALUES (?,?)')
    .run('P-OTHER', 'other-secret@example.test');

  const recon = db.prepare(`INSERT INTO recon_results
    (job_id,customer_id,company_name,industry,customer_type,current_pool,score,
     opportunity_summary,contacts_summary,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  recon.run(
    'R-OWN', 'RU-OWN', 'Owned Manufacturer', 'Industrial', 'Manufacturer', 'A', '91',
    'Needs controllers from Owned Buyer', 'owned-secret@example.test', '2026-07-28 11:00:00',
  );
  recon.run(
    'R-OTHER', 'RU-OTHER', 'Other Manufacturer', 'Automotive', 'Distributor', 'B', '72',
    'Other confidential opportunity', 'other-secret@example.test', '2026-07-27 11:00:00',
  );
  recon.run(
    'R-UNASSIGNED', 'RU-UNASSIGNED', 'Unassigned Manufacturer', 'Medical', 'Manufacturer', '', '66',
    'Unassigned confidential opportunity', 'unassigned-secret@example.test', '2026-07-26 11:00:00',
  );
  recon.run(
    'R-RETURNED', 'RU-RETURNED', 'Returned Manufacturer', 'Industrial', 'Manufacturer', 'C', '40',
    'Returned confidential opportunity', 'returned-secret@example.test', '2026-07-25 11:00:00',
  );
  recon.run(
    'R-TEST', 'RU-TEST', 'Test Manufacturer', 'Industrial', 'Manufacturer', 'C', '40',
    'Test confidential opportunity', 'test-secret@example.test', '2026-07-25 11:00:00',
  );
  recon.run(
    'R-ARCHIVED', 'RU-ARCHIVED', 'Archived Manufacturer', 'Industrial', 'Manufacturer', 'C', '40',
    'Archived confidential opportunity', 'archived-secret@example.test', '2026-07-25 11:00:00',
  );
  recon.run(
    'R-ORPHAN', 'RU-ORPHAN', 'Orphan Manufacturer', 'Industrial', 'Manufacturer', 'C', '40',
    'Orphan confidential opportunity', 'orphan-secret@example.test', '2026-07-25 11:00:00',
  );
  return db;
}

function ast(page, filters = []) {
  return { page, filters };
}

function scopedCustomerIds(db, scope) {
  return db.prepare(`SELECT ${scope.alias}.customer_id FROM ${scope.from}${scope.where}
    ORDER BY ${scope.alias}.customer_id`).all(...scope.params).map(row => row.customer_id);
}

function assertFilterDenied(action, hiddenText = '') {
  assert.throws(action, error => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, 'FILTER_NOT_AUTHORIZED');
    assert.equal(error.message, '筛选条件未获授权');
    if (hiddenText) assert.doesNotMatch(error.message, new RegExp(hiddenText));
    return true;
  });
}

test('research pages pre-register catalog-compatible contacts and recon metadata', () => {
  assert.deepEqual(Object.keys(RESEARCH_PAGE_CONFIG), ['contacts', 'recon']);
  assert.equal(RESEARCH_PAGE_CONFIG.contacts.kind, 'people');
  assert.equal(RESEARCH_PAGE_CONFIG.recon.kind, 'recon');
  assert.deepEqual(
    listResearchFilterDefinitions('contacts').map(item => item.key),
    ['search', 'contact_level', 'department', 'sales_ready', 'updated_at'],
  );
  assert.deepEqual(
    listResearchFilterDefinitions('recon').map(item => item.key),
    ['search', 'customer_type', 'industry', 'current_pool', 'score', 'updated_at'],
  );
  assert.ok(RESEARCH_FILTER_DEFINITIONS.every(item =>
    Object.isFrozen(item)
    && Object.isFrozen(item.operators)
    && Object.isFrozen(item.requiredPermissions)
    && Object.isFrozen(item.pages)));
});

test('research owner scope preserves personal, manager, and intake-manager semantics', () => {
  const db = createDb();
  const personal = buildResearchFilterScope(user(), 'recon', ast('recon'));
  assert.deepEqual(scopedCustomerIds(db, personal), ['RU-OWN']);

  const team = buildResearchFilterScope(
    user('U-ONE', { view_all_customers: true }),
    'recon',
    ast('recon'),
  );
  assert.deepEqual(
    scopedCustomerIds(db, team),
    ['RU-OTHER', 'RU-OWN', 'RU-RETURNED'],
  );

  const intakeManager = buildResearchFilterScope(
    user('U-ONE', { view_all_customers: true, manage_intake: true }),
    'recon',
    ast('recon'),
  );
  assert.deepEqual(
    scopedCustomerIds(db, intakeManager),
    ['RU-OTHER', 'RU-OWN', 'RU-RETURNED', 'RU-UNASSIGNED'],
  );
  db.close();
});

test('contacts AST builds parameterized search, facets, date range, and owner scope', () => {
  const db = createDb();
  const scope = buildResearchFilterScope(user(), 'contacts', ast('contacts', [
    { key: 'search', operator: 'contains', value: 'owned-secret@example.test' },
    { key: 'contact_level', operator: 'in', values: ['L3'] },
    { key: 'sales_ready', operator: 'in', values: ['1'] },
    { key: 'updated_at', operator: 'between', from: '2026-07-28', to: '2026-07-28' },
  ]));
  assert.deepEqual(scopedCustomerIds(db, scope), ['RU-OWN']);
  assert.equal(scope.params.includes('owned-secret@example.test'), false);
  assert.ok(scope.params.includes('%owned-secret@example.test%'));

  const injection = buildResearchFilterScope(user(), 'contacts', ast('contacts', [
    { key: 'contact_level', operator: 'in', values: ["L3' OR 1=1 --"] },
  ]));
  assert.deepEqual(scopedCustomerIds(db, injection), []);
  db.close();
});

test('Recon search cannot infer contact-derived narratives without view_contacts', () => {
  const db = createDb();
  const restricted = user('U-ONE', { view_contacts: false });
  const hidden = buildResearchFilterScope(restricted, 'recon', ast('recon', [
    { key: 'search', operator: 'contains', value: 'owned-secret@example.test' },
  ]));
  assert.deepEqual(scopedCustomerIds(db, hidden), []);

  const safe = buildResearchFilterScope(restricted, 'recon', ast('recon', [
    { key: 'search', operator: 'contains', value: 'Owned Manufacturer' },
  ]));
  assert.deepEqual(scopedCustomerIds(db, safe), ['RU-OWN']);

  const permitted = buildResearchFilterScope(user(), 'recon', ast('recon', [
    { key: 'search', operator: 'contains', value: 'owned-secret@example.test' },
  ]));
  assert.deepEqual(scopedCustomerIds(db, permitted), ['RU-OWN']);
  db.close();
});

test('page-specific option providers expose only explicit authorized fields and scoped values', () => {
  const db = createDb();
  const reconOptions = researchFilterOptions(db, user(), 'recon', [
    { key: 'search' },
    { key: 'industry' },
    { key: 'customer_type' },
  ]);
  assert.deepEqual(Object.keys(reconOptions), ['search', 'industry', 'customer_type']);
  assert.deepEqual(reconOptions.search, []);
  assert.deepEqual(reconOptions.industry, [
    { value: 'Industrial', label: 'Industrial', count: 1 },
  ]);
  assert.deepEqual(reconOptions.customer_type, [
    { value: 'Manufacturer', label: 'Manufacturer', count: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(reconOptions), /Automotive|Distributor|Medical/);

  const contactOptions = researchFilterOptions(db, user(), 'contacts', [
    'contact_level', 'department', 'sales_ready',
  ]);
  assert.deepEqual(contactOptions.contact_level, [
    { value: 'L3', label: 'L3', count: 1 },
  ]);
  assert.deepEqual(contactOptions.department, [
    { value: 'Procurement', label: 'Procurement', count: 1 },
  ]);
  assert.deepEqual(contactOptions.sales_ready, [
    { value: '1', label: '可交付销售', count: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(contactOptions), /Engineering|Management|L2|L1/);
  db.close();
});

test('forged filters and option requests fail uniformly without field or value disclosure', () => {
  const db = createDb();
  const unknown = () => buildResearchFilterScope(user(), 'recon', ast('recon', [
    { key: 'secret_field', operator: 'in', values: ['secret-value'] },
  ]));
  const wrongPage = () => buildResearchFilterScope(user(), 'recon', ast('contacts'));
  const deniedContacts = () => buildResearchFilterScope(
    user('U-ONE', { view_contacts: false }),
    'contacts',
    ast('contacts'),
  );
  const unknownOption = () => researchFilterOptions(db, user(), 'recon', ['secret_field']);
  const implicitOptions = () => researchFilterOptions(db, user(), 'recon');

  assertFilterDenied(unknown, 'secret_field|secret-value');
  assertFilterDenied(wrongPage, 'contacts|recon');
  assertFilterDenied(deniedContacts, 'view_contacts');
  assertFilterDenied(unknownOption, 'secret_field');
  assertFilterDenied(implicitOptions);
  db.close();
});

test('researchOwnerCondition appends only parameterized user identity', () => {
  const params = ['existing'];
  const sql = researchOwnerCondition(user("U' OR 1=1 --"), 'r', params);
  assert.match(sql, /owner_id=\?/);
  assert.doesNotMatch(sql, /OR 1=1/);
  assert.deepEqual(params, ['existing', "U' OR 1=1 --"]);
});
