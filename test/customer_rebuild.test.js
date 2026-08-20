'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  loadRebuildPackage,
  planCustomerRebuild,
  classifyRebuildTables,
  createRebuildManifest,
  applyCustomerRebuild,
  schemaFingerprint,
  hashFile,
  sha256Text,
  tableHash,
} = require('../lib/customer_rebuild');

const FIXTURE_DDL = path.join(
  __dirname,
  'fixtures/rebuild-schema.sql',
);
const RERUN_PACKAGE = '/Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/approved/customer-rebuild-package.json';
const RERUN_PACKAGE_SHA = '/Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/approved/customer-rebuild-package.sha256';

function openFixtureDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(FIXTURE_DDL, 'utf8'));
  return db;
}

function insertMinimal(db, table, values) {
  const columns = db
    .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
    .all();
  const row = {};
  for (const column of columns) {
    if (Object.prototype.hasOwnProperty.call(values, column.name)) {
      row[column.name] = values[column.name];
    } else if (column.notnull && column.dflt_value === null) {
      row[column.name] = /INT/i.test(column.type)
        ? 0
        : /JSON/i.test(column.type)
          ? '[]'
          : '';
    }
  }
  const names = Object.keys(row);
  db.prepare(
    `INSERT INTO ${JSON.stringify(table)} (${names
      .map((name) => JSON.stringify(name))
      .join(',')}) VALUES (${names.map(() => '?').join(',')})`,
  ).run(...names.map((name) => row[name]));
}

function seedSystemRows(db) {
  insertMinimal(db, 'sales_users', { id: 1, email: 'admin@example.com', name: 'Admin', role: 'admin', password_hash: 'hash', password_salt: 'salt' });
  insertMinimal(db, 'permission_groups', { id: 1, name: 'admins', role_key: 'admin' });
  insertMinimal(db, 'filter_definitions', {
    filter_key: 'country',
    label: 'Country',
    field_type: 'text',
    enabled: 1,
    displayed: 1,
    operators_json: '[]',
    display_mode: 'horizontal',
  });
  insertMinimal(db, 'crm_intake_settings', { id: 1, enabled: 1 });
  insertMinimal(db, 'crm_manager_task_settings', {
    id: 'default',
    version: 1,
    consecutive_deferred_enabled: 0,
    consecutive_deferred_count: 1,
    first_contact_silence_enabled: 0,
    first_contact_silence_days: 1,
    planned_action_overdue_enabled: 0,
    planned_action_overdue_hours: 1,
    sales_anomaly_enabled: 0,
    min_active_customers: 1,
    min_anomalous_customers: 1,
    anomaly_ratio_percent: 10.0,
    recipient_ids_json: '[]',
  });
  insertMinimal(db, 'crm_ai_feature_flags', { feature_key: 'recon', enabled: 1 });
  insertMinimal(db, 'sales_sessions', {
    token_hash: 'session-1',
    user_id: '1.0',
    expires_at: '2026-12-31T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
  });
  insertMinimal(db, 'tags', {
    id: 1,
    name: 'EMS',
    category: 'industry',
    created_at: '2026-01-01T00:00:00Z',
  });
  insertMinimal(db, 'tags', {
    id: 2,
    name: '制裁命中-机会',
    category: 'risk',
    created_at: '2026-01-01T00:00:00Z',
  });
}

function seedOldData(db) {
  insertMinimal(db, 'customer_pool', { customer_id: 'RU-OLD', company_name: 'Old Co' });
  insertMinimal(db, 'crm_intake_batches', { id: 1, batch_date: '2026-01-01', source: 'old', status: 'completed' });
  insertMinimal(db, 'crm_intake_items', { id: 1, batch_id: 1, external_customer_id: 'RU-OLD', status: 'claimed' });
  insertMinimal(db, 'crm_accounts', { id: 1, external_customer_id: 'RU-OLD', company_name: 'Old Co' });
  insertMinimal(db, 'crm_activities', { id: 1, customer_id: 1, user_id: 1, summary: 'old activity' });
  insertMinimal(db, 'crm_notifications', { id: 1, customer_id: 1, message: 'old notification' });
  insertMinimal(db, 'crm_ai_jobs', {
    id: 1,
    customer_id: 'RU-OLD',
    station: 'test',
    state: 'succeeded',
    idempotency_key: 'job-1',
    context_hash: 'ctx',
    next_run_at: '2026-01-01T00:00:00Z',
    trigger_source: 'manual',
    triggered_by: '1',
    input_fingerprint: 'fp',
    pipeline_version: '1',
  });
  insertMinimal(db, 'crm_plan_only_action_requests', {
    idempotency_key: 'plan-only-old',
    actor_id: '1',
    customer_id: 'RU-OLD',
    request_hash: 'request-old',
    status: 'completed',
    response_json: '{}',
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:00:00Z',
  });
}

function samplePackage() {
  return {
    version: 1,
    draft: false,
    customers: [
      {
        customerId: 'RU-1001',
        companyName: 'Alpha',
        standardName: 'Alpha',
        country: '俄罗斯',
        countryCode: 'RU',
        domain: 'alpha.ru',
        website: 'https://alpha.ru',
        industry: 'electronics',
        customerType: 'EMS',
        products: 'SMT, PCB',
        email: 'a@alpha.ru',
        phone: '+7',
        foundedYear: '2005',
        inn: '7700000000',
        dataStatus: 'READY',
        reviewReasons: [],
        sanctionsStatus: 'clear',
        websiteVerified: true,
      },
      {
        customerId: 'RU-1002',
        companyName: 'Beta',
        standardName: 'Beta',
        country: '俄罗斯',
        countryCode: 'RU',
        website: '',
        dataStatus: 'REVIEW',
        reviewReasons: ['website_missing'],
        sanctionsStatus: 'hit',
        websiteVerified: false,
      },
    ],
    excluded: [
      {
        customerId: 'RU-1003',
        companyName: 'Excluded Co',
        dataStatus: 'EXCLUDED',
        reviewReasons: ['baseline_not_importable'],
      },
    ],
    contacts: [
      {
        customerId: 'RU-1001',
        联系人姓名: 'Ivan',
        职位: 'CEO',
        邮箱: 'a@alpha.ru',
        数据状态: '可导入',
      },
    ],
    tags: [
      { customerId: 'RU-1001', 标签: 'EMS', 标签分类: 'industry' },
      { customerId: 'RU-1002', 标签: '制裁命中-机会' },
    ],
    screening: [
      { customerId: 'RU-1001', riskLevel: 'preliminary_clear' },
      { customerId: 'RU-1002', riskLevel: 'opportunity' },
    ],
    evidence: [
      {
        customerId: 'RU-1001',
        step: 'sanctions',
        url: 'https://opensanctions.org',
        title: 'sanctions check',
        confidence: 0.9,
      },
    ],
    reviewQueue: [],
  };
}

function verifiedPackageSha(pkg) {
  return sha256Text(JSON.stringify(pkg));
}

function completeFixtureState(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  const tableHashes = {};
  for (const table of tables) {
    const columns = db
      .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
      .all()
      .map((row) => row.name);
    const rows = db
      .prepare(
        `SELECT * FROM ${JSON.stringify(table)} ORDER BY ${columns
          .map((column) => JSON.stringify(column))
          .join(', ')}`,
      )
      .all();
    tableHashes[table] = sha256Text(JSON.stringify(rows));
  }
  return { schemaFingerprint: schemaFingerprint(db), tableHashes };
}

test('rejects package when file hash differs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-pkg-'));
  const pkgPath = path.join(dir, 'pkg.json');
  fs.writeFileSync(pkgPath, JSON.stringify(samplePackage()));
  assert.throws(
    () => loadRebuildPackage(pkgPath, '0'.repeat(64)),
    /package sha256 mismatch/,
  );
});

test('rejects empty or malformed packages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-pkg-'));
  const write = (pkg) => {
    const p = path.join(dir, `pkg-${Math.random()}.json`);
    fs.writeFileSync(p, JSON.stringify(pkg));
    return p;
  };
  const emptyPath = write({ customers: [], excluded: [] });
  assert.throws(
    () => loadRebuildPackage(emptyPath, hashFile(emptyPath)),
    /no importable customers/,
  );
  const badFormat = samplePackage();
  badFormat.customers[0].customerId = 'RU-1';
  const badFormatPath = write(badFormat);
  assert.throws(
    () => loadRebuildPackage(badFormatPath, hashFile(badFormatPath)),
    /invalid customerId format/,
  );
  const badNumeric = samplePackage();
  badNumeric.customers[1].customerId = 'BR-1001';
  const badNumericPath = write(badNumeric);
  assert.throws(
    () => loadRebuildPackage(badNumericPath, hashFile(badNumericPath)),
    /duplicate customerId numeric part/,
  );
});

test('rejects every imported child collection owned by an excluded customer before writes', () => {
  for (const collection of ['contacts', 'tags', 'screening', 'evidence', 'reviewQueue']) {
    const db = openFixtureDb();
    seedSystemRows(db);
    seedOldData(db);
    const pkg = samplePackage();
    pkg[collection] = [{ customerId: 'RU-1003' }];

    assert.throws(
      () => planCustomerRebuild(db, pkg, verifiedPackageSha(pkg)),
      new RegExp(`orphan ${collection} row for RU-1003`),
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_pool').get().n, 1);
    db.close();
  }
});

test('manifest is bound to the verified package SHA even when plan shape is otherwise identical', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  const pkg = samplePackage();
  const firstSha = 'a'.repeat(64);
  const secondSha = 'b'.repeat(64);
  const firstPlan = planCustomerRebuild(db, pkg, firstSha);
  const secondPlan = planCustomerRebuild(db, pkg, secondSha);

  assert.equal(firstPlan.packageSha256, firstSha);
  assert.equal(secondPlan.packageSha256, secondSha);
  assert.notEqual(createRebuildManifest(firstPlan), createRebuildManifest(secondPlan));
  db.close();
});

test(
  'rerun package partitions source customers and has no excluded-owned child rows',
  { skip: !fs.existsSync(RERUN_PACKAGE) },
  () => {
  const pkg = loadRebuildPackage(
    RERUN_PACKAGE,
    fs.readFileSync(RERUN_PACKAGE_SHA, 'utf8').trim(),
  );
  const ids = [
    ...pkg.customers.map((c) => c.customerId),
    ...pkg.excluded.map((c) => c.customerId),
  ];
  assert.equal(ids.length, 1901);
  assert.equal(new Set(ids).size, 1901);
  assert.equal(pkg.customers.length, 1895);
  assert.equal(pkg.excluded.length, 6);
  assert.equal(pkg.contacts.length, 419);
  assert.equal(pkg.tags.length, 11566);
  assert.equal(pkg.evidence.length, 9408);
  assert.equal(pkg.unresolvedDuplicateGroups, 0);
  const excludedIds = new Set(pkg.excluded.map((customer) => customer.customerId));
  for (const collection of ['contacts', 'tags', 'screening', 'evidence', 'reviewQueue']) {
    assert.equal(
      pkg[collection].filter((item) => excludedIds.has(item.customerId)).length,
      0,
    );
  }
  },
);

test('plan is read-only and classification is complete on real schema', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  seedOldData(db);
  const fingerprintBefore = schemaFingerprint(db);
  const pkg = samplePackage();
  const plan = planCustomerRebuild(db, pkg, verifiedPackageSha(pkg));
  assert.equal(plan.unclassifiedCustomerTables.length, 0);
  assert.ok(plan.clearedTables.includes('crm_activities'));
  assert.ok(plan.clearedTables.includes('crm_plan_only_action_requests'));
  assert.ok(plan.replacedTables.includes('customer_pool'));
  assert.ok(plan.preservedTables.includes('sales_users'));
  assert.equal(plan.preservedTables.length, 40);
  assert.equal(plan.clearedTables.length, 86);
  assert.equal(plan.replacedTables.length, 10);
  assert.equal(plan.beforeCounts.customer_pool, 1);
  assert.equal(plan.beforeCounts.crm_plan_only_action_requests, 1);
  assert.equal(
    Object.keys(plan.sourceTableHashes).length,
    plan.preservedTables.length + plan.clearedTables.length + plan.replacedTables.length,
  );
  assert.deepEqual(
    Object.keys(plan.preservedHashes).sort(),
    [...plan.preservedTables].sort(),
  );
  assert.deepEqual(
    Object.keys(plan.expectedAfterCounts).sort(),
    [...plan.clearedTables, ...plan.replacedTables].sort(),
  );
  assert.equal(schemaFingerprint(db), fingerprintBefore);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_pool').get().n, 1);
  db.close();
});

test('plan and apply reject connection-local temporary schema objects', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  db.exec('CREATE TEMP TABLE rebuild_temp_probe (id INTEGER)');
  assert.throws(
    () => planCustomerRebuild(db, samplePackage(), verifiedPackageSha(samplePackage())),
    /temporary schema objects are not allowed.*rebuild_temp_probe/,
  );
  db.close();
});

test('schema fingerprint binds complete table DDL, indexes, views, and triggers', () => {
  const fingerprintFor = (statements) => {
    const db = new Database(':memory:');
    db.exec(statements.join(';'));
    const fingerprint = schemaFingerprint(db);
    db.close();
    return fingerprint;
  };
  const baseTable = 'CREATE TABLE schema_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL DEFAULT \'a\' CHECK(length(value) > 0), UNIQUE(value))';
  const cases = [
    [
      baseTable,
      'CREATE TABLE schema_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL DEFAULT \'b\' CHECK(length(value) > 0), UNIQUE(value))',
    ],
    [
      baseTable,
      'CREATE TABLE schema_probe (id INTEGER PRIMARY KEY, value BLOB NOT NULL DEFAULT \'a\' CHECK(length(value) > 0), UNIQUE(value))',
    ],
    [
      baseTable,
      'CREATE TABLE schema_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL DEFAULT \'a\' CHECK(length(value) >= 0), UNIQUE(value))',
    ],
    [
      baseTable,
      'CREATE TABLE schema_probe (id TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT \'a\' CHECK(length(value) > 0), UNIQUE(value))',
    ],
    [
      baseTable,
      'CREATE TABLE schema_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL DEFAULT \'a\' CHECK(length(value) > 0))',
    ],
    [
      `${baseTable}; CREATE INDEX schema_probe_idx ON schema_probe(value)`,
      `${baseTable}; CREATE INDEX schema_probe_idx ON schema_probe(value DESC)`,
    ],
    [
      `${baseTable}; CREATE VIEW schema_probe_view AS SELECT value FROM schema_probe`,
      `${baseTable}; CREATE VIEW schema_probe_view AS SELECT upper(value) AS value FROM schema_probe`,
    ],
    [
      `${baseTable}; CREATE TRIGGER schema_probe_trigger AFTER INSERT ON schema_probe BEGIN UPDATE schema_probe SET value = NEW.value WHERE id = NEW.id; END`,
      `${baseTable}; CREATE TRIGGER schema_probe_trigger AFTER INSERT ON schema_probe BEGIN UPDATE schema_probe SET value = lower(NEW.value) WHERE id = NEW.id; END`,
    ],
  ];
  for (const [left, right] of cases) {
    assert.notEqual(
      fingerprintFor([left]),
      fingerprintFor([right]),
      right,
    );
  }

  const firstOrder = fingerprintFor([
    'CREATE TABLE schema_a (id INTEGER PRIMARY KEY, value TEXT)',
    'CREATE TABLE schema_b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES schema_a(id))',
    'CREATE INDEX schema_b_a_idx ON schema_b(a_id)',
    'CREATE VIEW schema_b_view AS SELECT a_id FROM schema_b',
    'CREATE TRIGGER schema_b_trigger AFTER INSERT ON schema_b BEGIN UPDATE schema_b SET a_id = NEW.a_id WHERE id = NEW.id; END',
  ]);
  const secondOrder = fingerprintFor([
    'CREATE TABLE schema_b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES schema_a(id))',
    'CREATE TABLE schema_a (id INTEGER PRIMARY KEY, value TEXT)',
    'CREATE TRIGGER schema_b_trigger AFTER INSERT ON schema_b BEGIN UPDATE schema_b SET a_id = NEW.a_id WHERE id = NEW.id; END',
    'CREATE VIEW schema_b_view AS SELECT a_id FROM schema_b',
    'CREATE INDEX schema_b_a_idx ON schema_b(a_id)',
  ]);
  assert.equal(firstOrder, secondOrder);
});

test('plan manifest changes when preserved table default DDL changes', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  const pkg = samplePackage();
  const sha = verifiedPackageSha(pkg);
  const beforeFingerprint = schemaFingerprint(db);
  const beforeManifest = createRebuildManifest(planCustomerRebuild(db, pkg, sha));
  const templateSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'templates'")
    .get().sql;
  db.exec('DROP TABLE templates');
  db.exec(templateSql.replace("scenario TEXT NOT NULL DEFAULT ''", "scenario TEXT NOT NULL DEFAULT 'changed'"));

  assert.notEqual(schemaFingerprint(db), beforeFingerprint);
  assert.notEqual(
    createRebuildManifest(planCustomerRebuild(db, pkg, sha)),
    beforeManifest,
  );
  db.close();
});

test('table hashes are deterministic when first-column values repeat', () => {
  const first = new Database(':memory:');
  const second = new Database(':memory:');
  for (const db of [first, second]) {
    db.exec('CREATE TABLE hash_probe (group_key TEXT COLLATE NOCASE NOT NULL, value TEXT COLLATE NOCASE NOT NULL)');
  }
  first.exec("INSERT INTO hash_probe VALUES ('same', 'A'), ('same', 'a')");
  second.exec("INSERT INTO hash_probe VALUES ('same', 'a'), ('same', 'A')");
  assert.equal(tableHash(first, 'hash_probe'), tableHash(second, 'hash_probe'));
  second.prepare("UPDATE hash_probe SET value = 'c' WHERE value = 'A'").run();
  assert.notEqual(tableHash(first, 'hash_probe'), tableHash(second, 'hash_probe'));
  first.close();
  second.close();
});

test('table hashes preserve every SQLite storage class and exact value byte', () => {
  const oneRowHash = (ddl, insertSql, params = []) => {
    const db = new Database(':memory:');
    db.exec(ddl);
    db.prepare(insertSql).run(...params);
    const hash = tableHash(db, 'hash_probe');
    db.close();
    return hash;
  };

  const adjacentUnsafe = [
    oneRowHash(
      'CREATE TABLE hash_probe (value INTEGER)',
      'INSERT INTO hash_probe VALUES (9007199254740992)',
    ),
    oneRowHash(
      'CREATE TABLE hash_probe (value INTEGER)',
      'INSERT INTO hash_probe VALUES (9007199254740993)',
    ),
    oneRowHash(
      'CREATE TABLE hash_probe (value INTEGER)',
      'INSERT INTO hash_probe VALUES (9223372036854775806)',
    ),
    oneRowHash(
      'CREATE TABLE hash_probe (value INTEGER)',
      'INSERT INTO hash_probe VALUES (9223372036854775807)',
    ),
  ];
  assert.equal(new Set(adjacentUnsafe).size, adjacentUnsafe.length);

  const nullHash = oneRowHash(
    'CREATE TABLE hash_probe (value)',
    'INSERT INTO hash_probe VALUES (NULL)',
  );
  const positiveInfinityHash = oneRowHash(
    'CREATE TABLE hash_probe (value)',
    'INSERT INTO hash_probe VALUES (?)',
    [Infinity],
  );
  const negativeInfinityHash = oneRowHash(
    'CREATE TABLE hash_probe (value)',
    'INSERT INTO hash_probe VALUES (?)',
    [-Infinity],
  );
  assert.equal(
    new Set([nullHash, positiveInfinityHash, negativeInfinityHash]).size,
    3,
  );

  const integerHash = oneRowHash(
    'CREATE TABLE hash_probe (value)',
    'INSERT INTO hash_probe VALUES (1)',
  );
  const realHash = oneRowHash(
    'CREATE TABLE hash_probe (value)',
    'INSERT INTO hash_probe VALUES (CAST(1 AS REAL))',
  );
  const textHash = oneRowHash(
    'CREATE TABLE hash_probe (value)',
    'INSERT INTO hash_probe VALUES (?)',
    ['a'],
  );
  const blobHash = oneRowHash(
    'CREATE TABLE hash_probe (value)',
    "INSERT INTO hash_probe VALUES (X'61')",
  );
  assert.notEqual(integerHash, realHash);
  assert.notEqual(textHash, blobHash);

  const singleDuplicate = oneRowHash(
    'CREATE TABLE hash_probe (value TEXT)',
    "INSERT INTO hash_probe VALUES ('same')",
  );
  const duplicateDb = new Database(':memory:');
  duplicateDb.exec(
    "CREATE TABLE hash_probe (value TEXT); INSERT INTO hash_probe VALUES ('same'), ('same')",
  );
  assert.notEqual(singleDuplicate, tableHash(duplicateDb, 'hash_probe'));
  duplicateDb.close();
});

test('table hashes are physical-order independent for NUL text, collations, blobs, and duplicates', () => {
  const first = new Database(':memory:');
  const second = new Database(':memory:');
  for (const db of [first, second]) {
    db.exec(`
      CREATE TABLE hash_probe (
        group_key TEXT COLLATE NOCASE,
        text_value TEXT COLLATE NOCASE,
        blob_value BLOB
      )
    `);
  }
  const rows = [
    ['same', 'a\u0000b', Buffer.from([0, 255])],
    ['SAME', 'a\u0000c', Buffer.from([0, 0])],
    ['same', 'a\u0000b', Buffer.from([0, 255])],
  ];
  const insert = (db, row) => db
    .prepare('INSERT INTO hash_probe VALUES (?, ?, ?)')
    .run(...row);
  for (const row of rows) insert(first, row);
  for (const row of [...rows].reverse()) insert(second, row);
  assert.equal(tableHash(first, 'hash_probe'), tableHash(second, 'hash_probe'));
  second
    .prepare('UPDATE hash_probe SET text_value = ? WHERE text_value = ?')
    .run('a\u0000d', 'a\u0000c');
  assert.notEqual(tableHash(first, 'hash_probe'), tableHash(second, 'hash_probe'));
  first.close();
  second.close();
});

test('manifest rejects same-count changes in cleared, replaced, and every preserved table class', () => {
  const mutations = [
    ['cleared', "UPDATE crm_activities SET summary = 'changed'"],
    ['replaced', "UPDATE customer_pool SET company_name = 'changed'"],
    ['formerly-unhashed preserved', "UPDATE sales_sessions SET expires_at = '2027-01-01T00:00:00Z'"],
  ];
  for (const [label, sql] of mutations) {
    const db = openFixtureDb();
    seedSystemRows(db);
    seedOldData(db);
    const pkg = samplePackage();
    const sha = verifiedPackageSha(pkg);
    const manifest = createRebuildManifest(planCustomerRebuild(db, pkg, sha));
    db.prepare(sql).run();
    const changedManifest = createRebuildManifest(planCustomerRebuild(db, pkg, sha));
    assert.notEqual(changedManifest, manifest, label);
    assert.throws(
      () => applyCustomerRebuild(db, pkg, { packageSha256: sha, planManifest: manifest }),
      /plan manifest mismatch/,
      label,
    );
    db.close();
  }
});

test('authoritative manifest observes a separate-connection mutation before apply', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-transaction-race-'));
  const dbPath = path.join(dir, 'fixture.db');
  const setup = new Database(dbPath);
  setup.pragma('foreign_keys = ON');
  setup.exec(fs.readFileSync(FIXTURE_DDL, 'utf8'));
  seedSystemRows(setup);
  seedOldData(setup);
  const pkg = samplePackage();
  const sha = verifiedPackageSha(pkg);
  const manifest = createRebuildManifest(planCustomerRebuild(setup, pkg, sha));
  setup.close();

  const concurrent = new Database(dbPath);
  concurrent
    .prepare("UPDATE crm_activities SET summary = 'concurrent same-count mutation'")
    .run();
  concurrent.close();

  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  assert.throws(
    () => applyCustomerRebuild(db, pkg, {
      packageSha256: sha,
      planManifest: manifest,
    }),
    /plan manifest mismatch/,
  );
  assert.equal(
    db.prepare('SELECT summary FROM crm_activities').get().summary,
    'concurrent same-count mutation',
  );
  assert.equal(db.prepare('SELECT company_name FROM customer_pool').get().company_name, 'Old Co');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_data_maintenance_runs').get().n, 0);
  db.close();
});

test('apply rejects caller-owned deferred and immediate transactions before mutation', () => {
  for (const mode of ['DEFERRED', 'IMMEDIATE']) {
    const db = openFixtureDb();
    seedSystemRows(db);
    seedOldData(db);
    const pkg = samplePackage();
    const sha = verifiedPackageSha(pkg);
    const manifest = createRebuildManifest(planCustomerRebuild(db, pkg, sha));
    const before = completeFixtureState(db);
    db.exec(`BEGIN ${mode}`);
    try {
      assert.throws(
        () => applyCustomerRebuild(db, pkg, {
          packageSha256: sha,
          planManifest: manifest,
        }),
        /apply requires transaction ownership/,
        mode,
      );
      assert.equal(db.inTransaction, true, mode);
      assert.deepEqual(completeFixtureState(db), before, mode);
    } finally {
      if (db.inTransaction) db.exec('ROLLBACK');
      db.close();
    }
  }
});

test('required tag definitions must preexist and tags remain preserved', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  seedOldData(db);
  const pkg = samplePackage();
  db.prepare("DELETE FROM tags WHERE name = '制裁命中-机会'").run();
  assert.throws(
    () => planCustomerRebuild(db, pkg, verifiedPackageSha(pkg)),
    /required tag definitions missing.*制裁命中-机会/,
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_pool').get().n, 1);
  db.close();
});

test('manifest gating aborts before writes', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  seedOldData(db);
  const pkg = samplePackage();
  const plan = planCustomerRebuild(db, pkg, verifiedPackageSha(pkg));
  const manifest = createRebuildManifest(plan);
  assert.throws(
    () =>
      applyCustomerRebuild(db, pkg, {
        packageSha256: sha256Text(JSON.stringify(pkg)),
        planManifest: '0'.repeat(64),
      }),
    /plan manifest mismatch/,
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_pool').get().n, 1);
  db.close();
});

test('apply rebuilds master and intake in one transaction with reconciliation', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  seedOldData(db);
  const pkg = samplePackage();
  const plan = planCustomerRebuild(db, pkg, verifiedPackageSha(pkg));
  const manifest = createRebuildManifest(plan);
  const report = applyCustomerRebuild(db, pkg, {
    packageSha256: sha256Text(JSON.stringify(pkg)),
    planManifest: manifest,
    actorId: 1,
    backupFile: '/tmp/rehearsal.db',
    backupEvidence: {
      path: '/tmp/rehearsal.db',
      sha256: 'b'.repeat(64),
      size: 123,
      mtimeMs: 456,
      mtime: '1970-01-01T00:00:00.456Z',
      quickCheck: 'ok',
      integrityCheck: 'ok',
    },
  });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_activities').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_notifications').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_ai_jobs').get().n, 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM crm_plan_only_action_requests').get().n,
    0,
  );
  assert.equal(report.checks.customerPool, 2);
  assert.equal(report.checks.intakeItems, 2);
  assert.equal(report.checks.approvedIntake, 1);
  assert.equal(report.checks.pendingIntake, 1);
  assert.equal(report.checks.duplicateCustomerIds, 0);
  assert.equal(report.checks.foreignKeyViolations, 0);
  assert.equal(report.checks.quickCheck, 'ok');
  assert.equal(report.checks.integrityCheck, 'ok');
  assert.equal(report.checks.passed, true);
  assert.deepEqual(report.checks.tableCountMismatches, {});
  assert.equal(Object.keys(report.checks.tableCounts).length, 96);
  assert.equal(report.checks.tableCounts.crm_intake_batches, 1);
  assert.equal(report.checks.tableCounts.crm_intake_items, 2);
  assert.equal(report.checks.tableCounts.crm_accounts, 0);
  assert.equal(report.checks.tableCounts.company_identifiers, 1);
  assert.equal(report.checks.tableCounts.company_screening, 2);
  assert.equal(report.checks.tableCounts.contacts, 1);
  assert.equal(report.checks.tableCounts.contact_methods, 1);
  assert.equal(report.checks.tableCounts.company_entry_points, 0);
  assert.equal(report.checks.tableCounts.website_checks, 1);
  assert.equal(report.checks.tableCounts.sanction_checks, 2);
  assert.equal(report.checks.tableCounts.recon_evidence, 1);
  assert.equal(report.checks.tableCounts.customer_tags, 2);
  assert.ok(Object.values(report.checks.ownershipOrphans).every((count) => count === 0));
  assert.equal(report.checks.maintenanceAppend.countDelta, 1);
  assert.equal(report.checks.maintenanceAppend.exactRecord, true);
  assert.deepEqual(
    Object.keys(report.preservedHashes).sort(),
    plan.preservedTables
      .filter((table) => table !== 'crm_data_maintenance_runs')
      .sort(),
  );
  for (const table of Object.keys(report.preservedHashes)) {
    assert.equal(report.preservedHashes[table], plan.preservedHashes[table], table);
  }
  const pool = db
    .prepare("SELECT company_name, established_year FROM customer_pool WHERE customer_id = 'RU-1001'")
    .get();
  assert.equal(pool.company_name, 'Alpha');
  assert.equal(String(pool.established_year), '2005');
  const intake = db
    .prepare("SELECT status, decision_reason FROM crm_intake_items WHERE external_customer_id = 'RU-1002'")
    .get();
  assert.equal(intake.status, 'pending');
  assert.equal(intake.decision_reason, '数据待核实');
  const audit = db
    .prepare("SELECT operation, status, filters_json, backup_file FROM crm_data_maintenance_runs ORDER BY id DESC LIMIT 1")
    .get();
  assert.equal(audit.operation, 'rebuild_customer_master');
  assert.equal(audit.status, 'completed');
  const auditFilters = JSON.parse(audit.filters_json);
  assert.equal(
    auditFilters.packageSha256,
    sha256Text(JSON.stringify(pkg)),
  );
  assert.equal(audit.backup_file, '/tmp/rehearsal.db');
  assert.deepEqual(auditFilters.backup, {
    path: '/tmp/rehearsal.db',
    sha256: 'b'.repeat(64),
    size: 123,
    mtimeMs: 456,
    mtime: '1970-01-01T00:00:00.456Z',
    quickCheck: 'ok',
    integrityCheck: 'ok',
  });
  const tagCounts = db
    .prepare("SELECT name, COUNT(*) n FROM tags WHERE name IN ('EMS', '制裁命中-机会') GROUP BY name")
    .all();
  for (const row of tagCounts) {
    assert.equal(row.n, 1);
  }
  db.close();
});

test('a failed postcondition rolls back the complete fixture and maintenance append', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  seedOldData(db);
  db.exec(`
    CREATE TRIGGER inject_failed_reconciliation
    AFTER INSERT ON crm_data_maintenance_runs
    WHEN NEW.operation = 'rebuild_customer_master'
    BEGIN
      INSERT INTO crm_accounts (
        id, external_customer_id, company_name, created_at, updated_at
      ) VALUES (
        'postcondition-contamination', 'RU-1001', 'must roll back',
        '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z'
      );
    END;
  `);
  const pkg = samplePackage();
  const sha = verifiedPackageSha(pkg);
  const plan = planCustomerRebuild(db, pkg, sha);
  const manifest = createRebuildManifest(plan);
  const before = completeFixtureState(db);

  assert.throws(
    () => applyCustomerRebuild(db, pkg, { packageSha256: sha, planManifest: manifest }),
    /reconciliation failed.*crm_accounts/,
  );
  assert.deepEqual(completeFixtureState(db), before);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM crm_data_maintenance_runs WHERE operation = 'rebuild_customer_master'").get().n,
    0,
  );
  db.close();
});

test('preserved system data hash must not change', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  const pkg = samplePackage();
  const plan = planCustomerRebuild(db, pkg, verifiedPackageSha(pkg));
  const manifest = createRebuildManifest(plan);
  db.prepare(
    "UPDATE sales_users SET name = 'Changed' WHERE email = 'admin@example.com'",
  ).run();
  const planAfterChange = planCustomerRebuild(db, pkg, verifiedPackageSha(pkg));
  assert.notEqual(createRebuildManifest(planAfterChange), manifest);
  assert.throws(
    () =>
      applyCustomerRebuild(db, pkg, {
        packageSha256: sha256Text(JSON.stringify(pkg)),
        planManifest: manifest,
      }),
    /preserved table hash changed|plan manifest mismatch/,
  );
  db.close();
});

test('classify rejects unknown customer-linked tables', () => {
  const db = openFixtureDb();
  db.exec('CREATE TABLE ghost_customer_data (id INTEGER PRIMARY KEY, customer_id TEXT)');
  const classification = classifyRebuildTables(db);
  assert.ok(classification.unclassifiedCustomerTables.includes('ghost_customer_data'));
  const pkg = samplePackage();
  assert.throws(
    () => planCustomerRebuild(db, pkg, verifiedPackageSha(pkg)),
    /unclassified customer tables/,
  );
  db.close();
});

test('classification rejects a missing expected preserved, cleared, or replaced table', () => {
  const cases = [
    ['preserved', 'sales_sessions'],
    ['cleared', 'crm_smoke_runs'],
    ['replaced', 'company_entry_points'],
  ];
  for (const [kind, table] of cases) {
    const db = openFixtureDb();
    db.exec(`DROP TABLE ${JSON.stringify(table)}`);
    const pkg = samplePackage();
    assert.throws(
      () => planCustomerRebuild(db, pkg, verifiedPackageSha(pkg)),
      new RegExp(`missing expected ${kind} tables: ${table}`),
    );
    db.close();
  }
});

test('immutable triggers on cleared tables are lifted and restored', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  seedOldData(db);
  db.exec(
    "CREATE TRIGGER trg_next_plan_immutable BEFORE DELETE ON crm_next_plan_events BEGIN SELECT RAISE(ABORT, 'crm_next_plan_events are immutable'); END",
  );
  insertMinimal(db, 'crm_next_plan_events', {
    id: '1',
    customer_id: 'RU-OLD',
    event_type: 'next',
    actor_id: '1',
    next_action: 'follow up',
    next_action_at: '2026-01-02T00:00:00Z',
    source: 'manual',
    created_at: '2026-01-01T00:00:00Z',
  });
  const pkg = samplePackage();
  const plan = planCustomerRebuild(db, pkg, verifiedPackageSha(pkg));
  const manifest = createRebuildManifest(plan);
  const report = applyCustomerRebuild(db, pkg, {
    packageSha256: sha256Text(JSON.stringify(pkg)),
    planManifest: manifest,
  });
  assert.equal(report.checks.foreignKeyViolations, 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM crm_next_plan_events').get().n,
    0,
  );
  const trigger = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_next_plan_immutable'")
    .get();
  assert.ok(trigger);
  insertMinimal(db, 'crm_next_plan_events', {
    id: '2',
    customer_id: 'RU-1001',
    event_type: 'next',
    actor_id: '1',
    next_action: 'follow up',
    next_action_at: '2026-01-02T00:00:00Z',
    source: 'manual',
    created_at: '2026-01-01T00:00:00Z',
  });
  assert.throws(
    () =>
      db
        .prepare(
          "DELETE FROM crm_next_plan_events WHERE customer_id = 'RU-1001'",
        )
        .run(),
    /immutable/,
  );
  db.close();
});

test('business projection mismatch rolls back a stable mapping trigger mutation', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  seedOldData(db);
  db.exec(`
    CREATE TRIGGER customer_pool_mapping_regression
    AFTER INSERT ON customer_pool
    BEGIN
      UPDATE customer_pool SET company_name = 'wrong mapping' WHERE customer_id = NEW.customer_id;
    END
  `);
  const pkg = samplePackage();
  const manifest = createRebuildManifest(
    planCustomerRebuild(db, pkg, verifiedPackageSha(pkg)),
  );
  assert.throws(
    () => applyCustomerRebuild(db, pkg, {
      packageSha256: verifiedPackageSha(pkg),
      planManifest: manifest,
    }),
    /businessProjectionMismatches|reconciliation failed/,
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_pool').get().n, 1);
  assert.equal(db.prepare('SELECT company_name FROM customer_pool').get().company_name, 'Old Co');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_data_maintenance_runs').get().n, 0);
  db.close();
});
