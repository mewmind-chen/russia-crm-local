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

function memoryDb(options = {}) {
  const db = new Database(':memory:', options);
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
    CREATE TABLE crm_activities (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, activity_type TEXT NOT NULL
    );
    CREATE TABLE crm_rfqs (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, activity_id TEXT NOT NULL
    );
    CREATE TABLE crm_quotes (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, activity_id TEXT NOT NULL
    );
    CREATE TABLE crm_orders (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, activity_id TEXT NOT NULL
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

test('manager proposal rows expose only revalidated in-scope mapping resolution candidates', () => {
  const db = memoryDb();
  try {
    db.prepare(`INSERT INTO crm_activities(id,customer_id,activity_type)
      VALUES ('ACT-MAPPING','A-1','quote')`).run();
    db.prepare(`INSERT INTO crm_activity_correction_proposals
      (id,original_activity_id,source_customer_id,target_customer_id,
       source_external_customer_id,target_external_customer_id,requester_id,
       original_creator_id,reason,reason_code,status,created_at,mapping_evidence_json)
      VALUES ('PROP-MAPPING','ACT-MAPPING','A-1','A-2','EXT-A1','EXT-A2','SALES',
       'SALES','Ambiguous quote mapping','MAPPING_UNCERTAIN','pending','2026-08-04 09:00:00',?)`)
      .run(JSON.stringify({
        linkedCount: 99,
        rankedCandidates: 'AI_FILTER_SENTINEL',
        ownerId: 'OTHER',
        assignmentReason: 'ASSIGNMENT_FILTER_SENTINEL',
      }));
    db.prepare(`INSERT INTO crm_quotes(id,customer_id,activity_id) VALUES
      ('QUOTE-A1-1','A-1','ACT-MAPPING'),
      ('QUOTE-A1-2','A-1','ACT-MAPPING'),
      ('QUOTE-OUTSIDE','B-1','ACT-MAPPING')`).run();
    db.prepare(`INSERT INTO crm_rfqs(id,customer_id,activity_id)
      VALUES ('RFQ-WRONG-TYPE','A-1','ACT-MAPPING')`).run();

    const result = queryActivityCorrectionProposals(
      db,
      manager(),
      ast(FILTER_PAGES.proposals, [{
        key: 'search', operator: 'contains', value: 'PROP-MAPPING',
      }]),
    );
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0].mappingResolution, {
      required: true,
      available: true,
      evidence: { linkedCount: 3 },
      candidates: [
        { mode: 'activity_only' },
        { mode: 'commerce_entity', entityType: 'quote', entityId: 'QUOTE-A1-1' },
        { mode: 'commerce_entity', entityType: 'quote', entityId: 'QUOTE-A1-2' },
      ],
    });
    assert.doesNotMatch(JSON.stringify(result),
      /QUOTE-OUTSIDE|AI_FILTER_SENTINEL|ASSIGNMENT_FILTER_SENTINEL|ownerId|assignmentReason/);
    assert.deepEqual(
      Object.keys(result.rows[0].mappingResolution.candidates[1]).sort(),
      ['entityId', 'entityType', 'mode'],
    );
  } finally {
    db.close();
  }
});

test('commerce rows without IDs remain uncertain but never become submit candidates', () => {
  const db = memoryDb();
  try {
    db.exec(`
      DROP TABLE crm_quotes;
      CREATE TABLE crm_quotes (
        customer_id TEXT NOT NULL, activity_id TEXT NOT NULL
      );
      INSERT INTO crm_activities(id,customer_id,activity_type)
        VALUES ('ACT-NO-COMMERCE-ID','A-1','quote');
      INSERT INTO crm_quotes(customer_id,activity_id)
        VALUES ('A-1','ACT-NO-COMMERCE-ID');
      INSERT INTO crm_activity_correction_proposals
        (id,original_activity_id,source_customer_id,target_customer_id,
         source_external_customer_id,target_external_customer_id,requester_id,
         original_creator_id,reason,reason_code,status,created_at)
      VALUES ('PROP-NO-COMMERCE-ID','ACT-NO-COMMERCE-ID','A-1','A-2','EXT-A1','EXT-A2',
        'SALES','SALES','legacy commerce row has no id','MAPPING_UNCERTAIN','pending',
        '2026-08-05 08:30:00');
    `);

    const result = queryActivityCorrectionProposals(
      db, manager(), ast(FILTER_PAGES.proposals), { pageSize: 20 },
    );
    const proposal = result.rows.find(row => row.proposalId === 'PROP-NO-COMMERCE-ID');
    assert.deepEqual(proposal.mappingResolution, {
      required: true,
      available: true,
      evidence: { linkedCount: 1 },
      candidates: [{ mode: 'activity_only' }],
    });
  } finally {
    db.close();
  }
});

test('proposal mapping requirement follows the current links instead of the stored reason code', () => {
  const db = memoryDb();
  try {
    db.exec(`
      INSERT INTO crm_activities(id,customer_id,activity_type)
        VALUES ('ACT-NOW-STABLE','A-1','quote'),('ACT-NOW-UNCERTAIN','A-1','quote');
      INSERT INTO crm_quotes(id,customer_id,activity_id) VALUES
        ('QUOTE-STABLE','A-1','ACT-NOW-STABLE'),
        ('QUOTE-UNCERTAIN-1','A-1','ACT-NOW-UNCERTAIN'),
        ('QUOTE-UNCERTAIN-2','A-1','ACT-NOW-UNCERTAIN');
      INSERT INTO crm_activity_correction_proposals
        (id,original_activity_id,source_customer_id,target_customer_id,
         source_external_customer_id,target_external_customer_id,requester_id,
         original_creator_id,reason,reason_code,status,created_at)
      VALUES
        ('PROP-NOW-STABLE','ACT-NOW-STABLE','A-1','A-2','EXT-A1','EXT-A2',
         'SALES','SALES','mapping converged','MAPPING_UNCERTAIN','pending','2026-08-05 09:00:00'),
        ('PROP-NOW-UNCERTAIN','ACT-NOW-UNCERTAIN','A-1','A-2','EXT-A1','EXT-A2',
         'MANAGER','SALES','creator override plus mapping conflict','OTHER_CREATOR','pending',
         '2026-08-05 09:01:00');
    `);
    const result = queryActivityCorrectionProposals(
      db, manager(), ast(FILTER_PAGES.proposals), { pageSize: 20 },
    );
    const stable = result.rows.find(row => row.proposalId === 'PROP-NOW-STABLE');
    const uncertain = result.rows.find(row => row.proposalId === 'PROP-NOW-UNCERTAIN');
    assert.equal(stable.mappingResolution, undefined,
      'a currently stable link must not offer an unnecessary activity-only override');
    assert.deepEqual(uncertain.mappingResolution, {
      required: true,
      available: true,
      evidence: { linkedCount: 2 },
      candidates: [
        { mode: 'activity_only' },
        { mode: 'commerce_entity', entityType: 'quote', entityId: 'QUOTE-UNCERTAIN-1' },
        { mode: 'commerce_entity', entityType: 'quote', entityId: 'QUOTE-UNCERTAIN-2' },
      ],
    });
  } finally {
    db.close();
  }
});

test('pending mapping context tolerates missing schema and deleted activities without invalid candidates', () => {
  const db = memoryDb();
  try {
    db.exec(`
      DROP TABLE crm_rfqs;
      CREATE TABLE crm_rfqs (id TEXT PRIMARY KEY, activity_id TEXT NOT NULL);
      DROP TABLE crm_quotes;
      CREATE TABLE crm_quotes (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL);
      DROP TABLE crm_orders;
      INSERT INTO crm_activities(id,customer_id,activity_type)
        VALUES ('ACT-MISSING-COMMERCE','A-1','quote'),('ACT-LEGACY-LINK','A-1','note');
      INSERT INTO crm_rfqs(id,activity_id) VALUES ('RFQ-LEGACY-LINK','ACT-LEGACY-LINK');
      INSERT INTO crm_activity_correction_proposals
        (id,original_activity_id,source_customer_id,target_customer_id,
         source_external_customer_id,target_external_customer_id,requester_id,
         original_creator_id,reason,reason_code,status,created_at)
      VALUES
        ('PROP-MISSING-COMMERCE','ACT-MISSING-COMMERCE','A-1','A-2','EXT-A1','EXT-A2',
         'SALES','SALES','missing old commerce schema','MAPPING_UNCERTAIN','pending',
         '2026-08-05 10:00:00'),
        ('PROP-DELETED-ACTIVITY','ACT-DELETED','A-1','A-2','EXT-A1','EXT-A2',
         'SALES','SALES','deleted legacy activity','MAPPING_UNCERTAIN','pending',
         '2026-08-05 10:01:00'),
        ('PROP-LEGACY-LINK','ACT-LEGACY-LINK','A-1','A-2','EXT-A1','EXT-A2',
         'SALES','SALES','legacy link missing customer column','OTHER_CREATOR','pending',
         '2026-08-05 10:01:30'),
        ('PROP-ALREADY-DONE','ACT-DELETED','A-1','A-2','EXT-A1','EXT-A2',
         'SALES','SALES','processed history','MAPPING_UNCERTAIN','approved',
         '2026-08-05 10:02:00');
    `);
    const result = queryActivityCorrectionProposals(
      db, manager(), ast(FILTER_PAGES.proposals), { pageSize: 20 },
    );
    assert.deepEqual(result.rows.find(row => row.proposalId === 'PROP-MISSING-COMMERCE')
      .mappingResolution, {
      required: true,
      available: true,
      evidence: { linkedCount: 0 },
      candidates: [{ mode: 'activity_only' }],
    });
    assert.deepEqual(result.rows.find(row => row.proposalId === 'PROP-DELETED-ACTIVITY')
      .mappingResolution, {
      required: true,
      available: false,
      evidence: { linkedCount: 0 },
      candidates: [],
    });
    assert.deepEqual(result.rows.find(row => row.proposalId === 'PROP-LEGACY-LINK')
      .mappingResolution, {
      required: true,
      available: true,
      evidence: { linkedCount: 0 },
      candidates: [{ mode: 'activity_only' }],
    });
    assert.equal(result.rows.find(row => row.proposalId === 'PROP-ALREADY-DONE')
      .mappingResolution, undefined);
  } finally {
    db.close();
  }
});

test('a full pending proposal page batch-loads mapping context with constant query counts', () => {
  const statements = [];
  const db = memoryDb({ verbose: sql => statements.push(sql) });
  try {
    const insertActivity = db.prepare(
      'INSERT INTO crm_activities(id,customer_id,activity_type) VALUES (?,\'A-1\',\'quote\')',
    );
    const insertQuote = db.prepare(
      'INSERT INTO crm_quotes(id,customer_id,activity_id) VALUES (?,\'A-1\',?)',
    );
    const insertProposal = db.prepare(`INSERT INTO crm_activity_correction_proposals
      (id,original_activity_id,source_customer_id,target_customer_id,
       source_external_customer_id,target_external_customer_id,requester_id,
       original_creator_id,reason,reason_code,status,created_at)
      VALUES (?,?,'A-1','A-2','EXT-A1','EXT-A2','SALES','SALES',
       'full page mapping','MAPPING_UNCERTAIN','pending','2026-08-05 11:00:00')`);
    for (let index = 0; index < 100; index += 1) {
      const activityId = `ACT-FULL-${index}`;
      insertActivity.run(activityId);
      insertQuote.run(`QUOTE-FULL-${index}-A`, activityId);
      insertQuote.run(`QUOTE-FULL-${index}-B`, activityId);
      insertProposal.run(`PROP-FULL-${index}`, activityId);
    }
    statements.length = 0;
    const result = queryActivityCorrectionProposals(
      db, manager(), ast(FILTER_PAGES.proposals), { page: 1, pageSize: 100 },
    );
    assert.equal(result.rows.length, 100);
    assert.ok(result.rows.every(row => row.mappingResolution?.required));
    const schemaQueries = statements.filter(sql => /^PRAGMA table_info/i.test(sql.trim()));
    const activityQueries = statements.filter(sql => /FROM crm_activities/i.test(sql));
    const commerceQueries = statements.filter(sql => /FROM crm_(?:rfqs|quotes|orders)/i.test(sql));
    assert.ok(schemaQueries.length <= 4, `schema queries: ${schemaQueries.length}`);
    assert.equal(activityQueries.length, 1);
    assert.ok(commerceQueries.length <= 3, `commerce queries: ${commerceQueries.length}`);
    assert.ok(statements.length <= 12, `total queries: ${statements.length}`);
  } finally {
    db.close();
  }
});

test('sales role cannot read manager correction proposals even if the permission is misgranted', () => {
  const db = memoryDb();
  try {
    assert.throws(
      () => queryActivityCorrectionProposals(
        db,
        {
          id: 'SALES', role: 'sales',
          permissions: { view_customers: true, manage_activity_corrections: true },
        },
        ast(FILTER_PAGES.proposals),
      ),
      error => error.code === 'FILTER_NOT_AUTHORIZED' && error.statusCode === 403,
    );
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
