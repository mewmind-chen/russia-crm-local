'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  FILTER_DEFINITIONS,
  PAGE_REQUIRED_PERMISSIONS,
} = require('../lib/filter_catalog');
const {
  FILTER_PAGES,
  activityCorrectionFilterOptions,
  buildActivityCorrectionQuery,
  installActivityCorrectionFilterCatalog,
  queryActivityCorrectionProposals,
  queryActivityCorrections,
  queryCorrectionTargets,
} = require('../lib/crm_activity_correction_filters');

function user(id, permissions) {
  return { id, role: id === 'ADMIN' ? 'admin' : 'manager', permissions };
}

const sales = () => user('SALES', {
  view_customers: true,
  correct_own_activity: true,
});
const manager = (viewAll = true) => user('MANAGER', {
  view_customers: true,
  view_all_customers: viewAll,
  manage_intake: viewAll,
  correct_own_activity: true,
  manage_activity_corrections: true,
});

function ast(page, filters = []) {
  return { page, filters };
}

function memoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY, external_customer_id TEXT NOT NULL,
      company_name TEXT NOT NULL DEFAULT '', nickname TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT '',
      assignment_status TEXT NOT NULL DEFAULT 'claimed',
      lifecycle_status TEXT NOT NULL DEFAULT 'active',
      is_test_data INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_activity_corrections (
      id TEXT PRIMARY KEY, original_activity_id TEXT NOT NULL,
      replacement_activity_id TEXT NOT NULL, source_customer_id TEXT NOT NULL,
      target_customer_id TEXT NOT NULL, source_external_customer_id TEXT NOT NULL DEFAULT '',
      target_external_customer_id TEXT NOT NULL DEFAULT '', actor_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed', proposal_id TEXT NOT NULL DEFAULT '',
      milestone_type TEXT NOT NULL DEFAULT '', milestone_source_id TEXT NOT NULL DEFAULT '',
      milestone_target_id TEXT NOT NULL DEFAULT '',
      mapping_evidence_json TEXT NOT NULL DEFAULT '{"aiRecommendation":"AI_FILTER_SENTINEL"}',
      decision_reason TEXT NOT NULL DEFAULT 'ASSIGNMENT_FILTER_SENTINEL',
      created_at TEXT NOT NULL
    );
    CREATE TABLE crm_activity_correction_proposals (
      id TEXT PRIMARY KEY, original_activity_id TEXT NOT NULL,
      source_customer_id TEXT NOT NULL, target_customer_id TEXT NOT NULL,
      source_external_customer_id TEXT NOT NULL DEFAULT '',
      target_external_customer_id TEXT NOT NULL DEFAULT '', requester_id TEXT NOT NULL,
      original_creator_id TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL,
      reason_code TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      reviewer_id TEXT NOT NULL DEFAULT '', review_reason TEXT NOT NULL DEFAULT '',
      correction_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT '',
      mapping_evidence_json TEXT NOT NULL DEFAULT '{"rankedCandidates":"AI_FILTER_SENTINEL"}'
    );
  `);
  const insertAccount = db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,nickname,owner_id,stage)
    VALUES (?,?,?,?,?,?)`);
  insertAccount.run('A-1', 'EXT-A1', 'Alpha One', '', 'SALES', 'qualified');
  insertAccount.run('A-2', 'EXT-A2', 'Alpha Two', 'Second Alpha', 'SALES', 'contacted');
  insertAccount.run('B-1', 'EXT-B1', 'Beta One', '', 'OTHER', 'new');
  db.prepare('INSERT INTO customer_pool(customer_id,company_name,nickname) VALUES (?,?,?)')
    .run('EXT-A2', 'Alpha Two Pool', 'Second Alpha Pool');

  const insertCorrection = db.prepare(`INSERT INTO crm_activity_corrections
    (id,original_activity_id,replacement_activity_id,source_customer_id,target_customer_id,
     source_external_customer_id,target_external_customer_id,actor_id,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insertCorrection.run(
    'COR-1', 'ACT-1', 'ACT-R1', 'A-1', 'A-2', 'EXT-A1', 'EXT-A2',
    'SALES', 'Alpha correction', '2026-08-01 08:00:00',
  );
  insertCorrection.run(
    'COR-2', 'ACT-2', 'ACT-R2', 'A-1', 'B-1', 'EXT-A1', 'EXT-B1',
    'SALES', 'Beta correction', '2026-08-02 08:00:00',
  );
  insertCorrection.run(
    'COR-3', 'ACT-3', 'ACT-R3', 'A-1', 'A-2', 'EXT-A1', 'EXT-A2',
    'OTHER', 'Other actor correction', '2026-08-03 08:00:00',
  );

  const insertProposal = db.prepare(`INSERT INTO crm_activity_correction_proposals
    (id,original_activity_id,source_customer_id,target_customer_id,
     source_external_customer_id,target_external_customer_id,requester_id,
     original_creator_id,reason,reason_code,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertProposal.run(
    'PROP-1', 'ACT-P1', 'A-1', 'A-2', 'EXT-A1', 'EXT-A2', 'SALES', 'SALES',
    'Pending Alpha proposal', 'OTHER_CREATOR', 'pending', '2026-08-01 09:00:00',
  );
  insertProposal.run(
    'PROP-2', 'ACT-P2', 'A-1', 'B-1', 'EXT-A1', 'EXT-B1', 'SALES', 'SALES',
    'Approved Beta proposal', 'LOCKED', 'approved', '2026-08-02 09:00:00',
  );
  return db;
}

test('Issue 171 registers three authorized filter pages and their minimum fields', () => {
  assert.deepEqual(PAGE_REQUIRED_PERMISSIONS[FILTER_PAGES.targets], ['view_customers']);
  assert.deepEqual(PAGE_REQUIRED_PERMISSIONS[FILTER_PAGES.corrections], ['view_customers']);
  assert.deepEqual(
    PAGE_REQUIRED_PERMISSIONS[FILTER_PAGES.proposals],
    ['manage_activity_corrections'],
  );
  const byKey = new Map(FILTER_DEFINITIONS.map(definition => [definition.key, definition]));
  for (const page of Object.values(FILTER_PAGES)) assert.ok(byKey.get('search').pages.includes(page));
  assert.ok(byKey.get('stage').pages.includes(FILTER_PAGES.targets));
  assert.ok(byKey.get('created_at').pages.includes(FILTER_PAGES.corrections));
  assert.ok(byKey.get('created_at').pages.includes(FILTER_PAGES.proposals));
  assert.deepEqual(byKey.get('correction_status').pages, [FILTER_PAGES.proposals]);
});

test('target search applies authorized AST, row scope, exclusion, counts and pagination', () => {
  const db = memoryDb();
  try {
    const result = queryCorrectionTargets(db, sales(), ast(FILTER_PAGES.targets, [{
      key: 'search', operator: 'contains', value: 'alpha',
    }]), { excludeCustomerId: 'A-1', page: 1, pageSize: 1 });
    assert.deepEqual(result, {
      rows: [{
        id: 'A-2', externalCustomerId: 'EXT-A2', nickname: 'Second Alpha Pool',
        companyName: 'Alpha Two Pool', stage: 'contacted',
      }],
      page: 1,
      pageSize: 1,
      offset: 0,
      total: 1,
      authorizedTotal: 1,
      hasMore: false,
    });
    assert.equal(JSON.stringify(result).includes('B-1'), false);
  } finally {
    db.close();
  }
});

test('correction history uses identical scoped count and row predicates', () => {
  const db = memoryDb();
  try {
    const own = queryActivityCorrections(
      db,
      sales(),
      ast(FILTER_PAGES.corrections),
      { page: 1, pageSize: 1 },
    );
    assert.equal(own.total, 1);
    assert.equal(own.authorizedTotal, 1);
    assert.deepEqual(own.rows.map(row => row.correctionId), ['COR-1']);
    assert.equal(own.rows[0].sourceCompanyName, 'Alpha One');
    assert.equal(own.rows[0].targetCompanyName, 'Alpha Two Pool');
    assert.doesNotMatch(JSON.stringify(own), /AI_FILTER_SENTINEL|ASSIGNMENT_FILTER_SENTINEL/);

    const all = queryActivityCorrections(
      db,
      manager(),
      ast(FILTER_PAGES.corrections, [{
        key: 'created_at', operator: 'between', from: '2026-08-02', to: '2026-08-03',
      }]),
      { page: 1, pageSize: 1 },
    );
    assert.equal(all.total, 2);
    assert.equal(all.authorizedTotal, 3);
    assert.equal(all.rows.length, 1);
    assert.equal(all.hasMore, true);
    assert.equal(all.rows[0].correctionId, 'COR-3');
  } finally {
    db.close();
  }
});

test('proposal list filters status without leaking outside either customer scope', () => {
  const db = memoryDb();
  try {
    const restricted = user('SALES', {
      view_customers: true,
      manage_activity_corrections: true,
    });
    const result = queryActivityCorrectionProposals(
      db,
      restricted,
      ast(FILTER_PAGES.proposals, [{
        key: 'correction_status', operator: 'in', values: ['pending'],
      }]),
      { page: 1, pageSize: 20 },
    );
    assert.equal(result.total, 1);
    assert.equal(result.authorizedTotal, 1);
    assert.deepEqual(result.rows.map(row => row.proposalId), ['PROP-1']);
    assert.equal(JSON.stringify(result).includes('PROP-2'), false);
    assert.doesNotMatch(JSON.stringify(result), /AI_FILTER_SENTINEL|rankedCandidates/);

    const options = activityCorrectionFilterOptions(
      db,
      manager(),
      FILTER_PAGES.proposals,
      [{ key: 'correction_status' }],
    );
    assert.deepEqual(options.correction_status.map(option => [option.value, option.count]), [
      ['approved', 1],
      ['pending', 1],
    ]);
  } finally {
    db.close();
  }
});

test('query builders fail closed for unvalidated pages and fields', () => {
  assert.throws(
    () => buildActivityCorrectionQuery(
      sales(),
      ast(FILTER_PAGES.corrections, [{
        key: 'assignment_reason', operator: 'contains', value: 'secret',
      }]),
    ),
    error => error.code === 'FILTER_NOT_AUTHORIZED',
  );
  assert.throws(
    () => buildActivityCorrectionQuery(sales(), ast('customers')),
    error => error.code === 'FILTER_NOT_AUTHORIZED',
  );
});

test('catalog migration extends existing rows, grants manager status and is idempotent', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE filter_catalog_migrations (
        migration_key TEXT PRIMARY KEY, applied_at TEXT NOT NULL
      );
      CREATE TABLE filter_permission_state (
        id INTEGER PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE filter_definitions (
        filter_key TEXT PRIMARY KEY, pages_json TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE permission_groups (
        id TEXT PRIMARY KEY, role_key TEXT NOT NULL, permissions_json TEXT NOT NULL
      );
      CREATE TABLE permission_group_filter_grants (
        group_id TEXT NOT NULL, filter_key TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(group_id,filter_key)
      );
      CREATE TABLE filter_permission_audit (
        id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, target_type TEXT NOT NULL,
        target_id TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT NOT NULL,
        after_json TEXT NOT NULL, note TEXT NOT NULL, version INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO filter_permission_state VALUES (1,7,'2026-08-01 00:00:00');
      INSERT INTO filter_definitions VALUES ('search','["customers"]','2026-08-01 00:00:00');
      INSERT INTO filter_definitions VALUES ('stage','["customers"]','2026-08-01 00:00:00');
      INSERT INTO filter_definitions VALUES ('created_at','["customers"]','2026-08-01 00:00:00');
      INSERT INTO filter_definitions VALUES ('correction_status','[]','2026-08-01 00:00:00');
      INSERT INTO permission_groups VALUES
        ('PGRP-MANAGER','manager','{"manage_activity_corrections":true}'),
        ('PGRP-SALES','sales','{"manage_activity_corrections":false}');
    `);
    const version = installActivityCorrectionFilterCatalog(db, {
      now: '2026-08-02 08:00:00',
    });
    assert.equal(version, 8);
    for (const [key, pages] of Object.entries({
      search: Object.values(FILTER_PAGES),
      stage: [FILTER_PAGES.targets],
      created_at: [FILTER_PAGES.corrections, FILTER_PAGES.proposals],
      correction_status: [FILTER_PAGES.proposals],
    })) {
      const stored = JSON.parse(db.prepare(
        'SELECT pages_json FROM filter_definitions WHERE filter_key=?',
      ).get(key).pages_json);
      for (const page of pages) assert.ok(stored.includes(page), `${key}:${page}`);
    }
    assert.deepEqual(db.prepare(`SELECT group_id FROM permission_group_filter_grants
      WHERE filter_key='correction_status' ORDER BY group_id`).all(), [
      { group_id: 'PGRP-MANAGER' },
    ]);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM filter_permission_audit').get().count, 1);
    assert.equal(installActivityCorrectionFilterCatalog(db).toString(), '8');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM filter_permission_audit').get().count, 1);
  } finally {
    db.close();
  }
});
