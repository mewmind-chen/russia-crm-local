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
} = require('../lib/customer_rebuild');

const FIXTURE_DDL = path.join(
  __dirname,
  'fixtures/rebuild-schema.sql',
);
const APPROVED_PACKAGE = '/Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/approved/customer-rebuild-package.json';

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

test(
  'approved package partitions all source customers exactly once',
  { skip: !fs.existsSync(APPROVED_PACKAGE) },
  () => {
  const pkg = loadRebuildPackage(
    APPROVED_PACKAGE,
    fs.readFileSync(
      '/Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/approved/customer-rebuild-package.sha256',
      'utf8',
    ).trim(),
  );
  const ids = [
    ...pkg.customers.map((c) => c.customerId),
    ...pkg.excluded.map((c) => c.customerId),
  ];
  assert.equal(ids.length, 1901);
  assert.equal(new Set(ids).size, 1901);
  },
);

test('plan is read-only and classification is complete on real schema', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  seedOldData(db);
  const fingerprintBefore = schemaFingerprint(db);
  const pkg = samplePackage();
  const plan = planCustomerRebuild(db, pkg);
  assert.equal(plan.unclassifiedCustomerTables.length, 0);
  assert.ok(plan.clearedTables.includes('crm_activities'));
  assert.ok(plan.replacedTables.includes('customer_pool'));
  assert.ok(plan.preservedTables.includes('sales_users'));
  assert.equal(plan.beforeCounts.customer_pool, 1);
  assert.equal(schemaFingerprint(db), fingerprintBefore);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_pool').get().n, 1);
  db.close();
});

test('manifest gating aborts before writes', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  seedOldData(db);
  const pkg = samplePackage();
  const plan = planCustomerRebuild(db, pkg);
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
  const plan = planCustomerRebuild(db, pkg);
  const manifest = createRebuildManifest(plan);
  const report = applyCustomerRebuild(db, pkg, {
    packageSha256: sha256Text(JSON.stringify(pkg)),
    planManifest: manifest,
    actorId: 1,
    backupFile: '/tmp/rehearsal.db',
  });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_activities').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_notifications').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_ai_jobs').get().n, 0);
  assert.equal(report.checks.customerPool, 2);
  assert.equal(report.checks.intakeItems, 2);
  assert.equal(report.checks.approvedIntake, 1);
  assert.equal(report.checks.pendingIntake, 1);
  assert.equal(report.checks.duplicateCustomerIds, 0);
  assert.equal(report.checks.foreignKeyViolations, 0);
  assert.equal(report.checks.quickCheck, 'ok');
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
  const tagCounts = db
    .prepare("SELECT name, COUNT(*) n FROM tags WHERE name IN ('EMS', '制裁命中-机会') GROUP BY name")
    .all();
  for (const row of tagCounts) {
    assert.equal(row.n, 1);
  }
  db.close();
});

test('preserved system data hash must not change', () => {
  const db = openFixtureDb();
  seedSystemRows(db);
  const pkg = samplePackage();
  const plan = planCustomerRebuild(db, pkg);
  const manifest = createRebuildManifest(plan);
  db.prepare(
    "UPDATE sales_users SET name = 'Changed' WHERE email = 'admin@example.com'",
  ).run();
  const planAfterChange = planCustomerRebuild(db, pkg);
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
  assert.throws(() => planCustomerRebuild(db, samplePackage()), /unclassified customer tables/);
  db.close();
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
  const plan = planCustomerRebuild(db, pkg);
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
