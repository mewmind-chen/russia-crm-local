'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const CLI = path.join(
  __dirname,
  '..',
  'scripts/rebuild-customer-data.js',
);
const FIXTURE_DDL = path.join(
  __dirname,
  'fixtures/rebuild-schema.sql',
);
const { sha256Text } = require('../lib/customer_rebuild');
const { cmdApply } = require('../scripts/rebuild-customer-data');
const RUNBOOK = path.join(__dirname, '..', 'docs/customer-data-rebuild.md');

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd || path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function createFixtureDb(filePath) {
  const db = new Database(filePath);
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(FIXTURE_DDL, 'utf8'));
  const insertMinimal = (table, values) => {
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
  };
  insertMinimal('sales_users', {
    id: 1,
    email: 'admin@example.com',
    name: 'Admin',
    role: 'admin',
    password_hash: 'h',
    password_salt: 's',
  });
  insertMinimal('permission_groups', { id: 1, name: 'admins', role_key: 'admin' });
  insertMinimal('filter_definitions', {
    filter_key: 'country',
    label: 'Country',
    field_type: 'text',
    enabled: 1,
    displayed: 1,
    operators_json: '[]',
    display_mode: 'horizontal',
  });
  insertMinimal('crm_intake_settings', { id: 1, enabled: 1 });
  insertMinimal('crm_manager_task_settings', {
    id: 'default',
    version: 1,
    consecutive_deferred_count: 1,
    first_contact_silence_days: 1,
    planned_action_overdue_hours: 1,
    min_active_customers: 1,
    min_anomalous_customers: 1,
    anomaly_ratio_percent: 10.0,
  });
  insertMinimal('crm_ai_feature_flags', { feature_key: 'recon', enabled: 1 });
  insertMinimal('customer_pool', { customer_id: 'RU-OLD', company_name: 'Old' });
  insertMinimal('crm_intake_batches', {
    id: 1,
    batch_date: '2026-01-01',
    source: 'old',
    status: 'completed',
  });
  insertMinimal('crm_intake_items', {
    id: 1,
    batch_id: 1,
    external_customer_id: 'RU-OLD',
    status: 'claimed',
  });
  insertMinimal('crm_accounts', {
    id: 1,
    external_customer_id: 'RU-OLD',
    company_name: 'Old',
  });
  insertMinimal('crm_activities', {
    id: 1,
    customer_id: 1,
    user_id: 1,
    summary: 'old',
  });
  db.close();
}

function writePackage(dir, pkg) {
  const packagePath = path.join(dir, 'package.json');
  const shaPath = path.join(dir, 'package.sha256');
  fs.writeFileSync(packagePath, JSON.stringify(pkg));
  fs.writeFileSync(shaPath, sha256Text(JSON.stringify(pkg)));
  return { packagePath, shaPath };
}

function samplePackage() {
  return {
    customers: [
      {
        customerId: 'RU-1001',
        companyName: 'Alpha',
        standardName: 'Alpha',
        country: '俄罗斯',
        countryCode: 'RU',
        website: 'https://alpha.ru',
        industry: 'electronics',
        customerType: 'EMS',
        products: 'SMT',
        dataStatus: 'READY',
        reviewReasons: [],
        sanctionsStatus: 'clear',
        websiteVerified: true,
      },
    ],
    excluded: [],
    contacts: [],
    tags: [],
    screening: [],
    evidence: [],
    reviewQueue: [],
  };
}

function exactContractPackage() {
  const customers = Array.from({ length: 1895 }, (_, index) => ({
    customerId: `RU-${String(index + 1).padStart(4, '0')}`,
    companyName: `Customer ${index + 1}`,
    standardName: `Customer ${index + 1}`,
    country: '俄罗斯',
    countryCode: 'RU',
    website: '',
    dataStatus: index < 1334 ? 'READY' : 'REVIEW',
    reviewReasons: index < 1334 ? [] : ['review'],
    sanctionsStatus: 'clear',
    websiteVerified: false,
  }));
  return {
    customers,
    excluded: Array.from({ length: 6 }, (_, index) => ({
      customerId: `RU-${String(1896 + index).padStart(4, '0')}`,
      companyName: `Excluded ${index + 1}`,
      dataStatus: 'EXCLUDED',
      reviewReasons: ['excluded'],
    })),
    contacts: [],
    tags: [],
    screening: [],
    evidence: [],
    reviewQueue: customers
      .filter((customer) => customer.dataStatus === 'REVIEW')
      .map((customer) => ({ customerId: customer.customerId })),
    unresolvedDuplicateGroups: 0,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('plan against missing database exits non-zero without creating files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-cli-plan-'));
  const output = path.join(dir, 'out');
  const pkg = writePackage(dir, exactContractPackage());
  const result = runCli([
    'plan',
    '--database',
    path.join(dir, 'missing.db'),
    '--package',
    pkg.packagePath,
    '--package-sha256-file',
    pkg.shaPath,
    '--output',
    output,
  ]);
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(output), false);
});

test('plan is read-only on existing database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-cli-plan-'));
  const dbPath = path.join(dir, 'fixture.db');
  createFixtureDb(dbPath);
  const before = fs.readFileSync(dbPath);
  const beforeStat = fs.statSync(dbPath);
  const pkg = writePackage(dir, exactContractPackage());
  const result = runCli([
    'plan',
    '--database',
    dbPath,
    '--package',
    pkg.packagePath,
    '--package-sha256-file',
    pkg.shaPath,
    '--output',
    path.join(dir, 'out'),
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'out', 'plan.json')));
  assert.ok(fs.existsSync(path.join(dir, 'out', 'manifest.txt')));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, 'out', 'plan.json'), 'utf8')).packageSha256,
    fs.readFileSync(pkg.shaPath, 'utf8'),
  );
  assert.deepEqual(fs.readFileSync(dbPath), before);
  assert.equal(fs.statSync(dbPath).mtimeMs, beforeStat.mtimeMs);
});

test('every exact rerun contract mismatch rejects in all modes before output or backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-cli-contract-'));
  const dbPath = path.join(dir, 'fixture.db');
  createFixtureDb(dbPath);
  const mutations = {
    importable_count: (pkg) => pkg.customers.shift(),
    excluded_count: (pkg) => pkg.excluded.pop(),
    ready_review_partition: (pkg) => { pkg.customers[0].dataStatus = 'REVIEW'; },
    excluded_status: (pkg) => { pkg.excluded[0].dataStatus = 'READY'; },
    review_queue_missing: (pkg) => pkg.reviewQueue.pop(),
    review_queue_duplicate: (pkg) => pkg.reviewQueue.push({ ...pkg.reviewQueue[0] }),
    review_queue_non_review: (pkg) => { pkg.reviewQueue[0] = { customerId: pkg.customers[0].customerId }; },
    unresolved_duplicates_missing: (pkg) => { delete pkg.unresolvedDuplicateGroups; },
    unresolved_duplicates_null: (pkg) => { pkg.unresolvedDuplicateGroups = null; },
    unresolved_duplicates_false: (pkg) => { pkg.unresolvedDuplicateGroups = false; },
    unresolved_duplicates_empty: (pkg) => { pkg.unresolvedDuplicateGroups = ''; },
    unresolved_duplicates_string: (pkg) => { pkg.unresolvedDuplicateGroups = '0'; },
    unresolved_duplicates_array: (pkg) => { pkg.unresolvedDuplicateGroups = []; },
    unresolved_duplicates_nonzero: (pkg) => { pkg.unresolvedDuplicateGroups = 1; },
  };

  for (const [name, mutate] of Object.entries(mutations)) {
    const pkgValue = clone(exactContractPackage());
    mutate(pkgValue);
    const caseDir = path.join(dir, name);
    fs.mkdirSync(caseDir);
    const pkg = writePackage(caseDir, pkgValue);
    const manifestPath = path.join(caseDir, 'manifest.txt');
    fs.writeFileSync(manifestPath, '0'.repeat(64));
    const cases = [
      {
        mode: 'plan',
        path: path.join(caseDir, 'plan'),
        args: ['--output', path.join(caseDir, 'plan')],
      },
      {
        mode: 'rehearse',
        path: path.join(caseDir, 'rehearsal'),
        args: ['--output', path.join(caseDir, 'rehearsal')],
      },
      {
        mode: 'apply',
        path: path.join(caseDir, 'backups'),
        args: [
          '--manifest', manifestPath,
          '--backup-dir', path.join(caseDir, 'backups'),
          '--actor', '1',
          '--apply',
        ],
      },
    ];
    for (const cliCase of cases) {
      const result = runCli([
        cliCase.mode,
        '--database', dbPath,
        '--package', pkg.packagePath,
        '--package-sha256-file', pkg.shaPath,
        ...cliCase.args,
      ]);
      assert.notEqual(result.status, 0, `${name}/${cliCase.mode}`);
      assert.match(
        result.stderr,
        /exact rerun package contract/,
        `${name}/${cliCase.mode}`,
      );
      assert.equal(fs.existsSync(cliCase.path), false, `${name}/${cliCase.mode}`);
    }
  }
});

test('apply requires all gate arguments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-cli-apply-'));
  const dbPath = path.join(dir, 'fixture.db');
  createFixtureDb(dbPath);
  const pkg = writePackage(dir, samplePackage());
  const result = runCli([
    'apply',
    '--database',
    dbPath,
    '--package',
    pkg.packagePath,
    '--package-sha256-file',
    pkg.shaPath,
    '--actor',
    '1',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--apply/);
});

test('apply refuses when package and database are the same inode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-cli-inode-'));
  const dbPath = path.join(dir, 'same.db');
  fs.writeFileSync(dbPath, '{}');
  const shaPath = path.join(dir, 'same.sha256');
  fs.writeFileSync(shaPath, '0'.repeat(64));
  const result = runCli([
    'apply',
    '--database',
    dbPath,
    '--package',
    dbPath,
    '--package-sha256-file',
    shaPath,
    '--manifest',
    shaPath,
    '--actor',
    '1',
    '--apply',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /same file/);
});

test('rehearse creates backup copy and applies on it without touching source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-cli-rehearse-'));
  const dbPath = path.join(dir, 'fixture.db');
  createFixtureDb(dbPath);
  const before = fs.readFileSync(dbPath);
  const pkg = writePackage(dir, exactContractPackage());
  const output = path.join(dir, 'rehearsal');
  const result = runCli([
    'rehearse',
    '--database',
    dbPath,
    '--package',
    pkg.packagePath,
    '--package-sha256-file',
    pkg.shaPath,
    '--output',
    output,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(dbPath), before);
  assert.ok(fs.existsSync(path.join(output, 'rehearsed.db')));
  assert.ok(fs.existsSync(path.join(output, 'plan.json')));
  assert.ok(fs.existsSync(path.join(output, 'manifest.txt')));
  assert.ok(fs.existsSync(path.join(output, 'before.json')));
  assert.ok(fs.existsSync(path.join(output, 'after.json')));
  assert.ok(fs.existsSync(path.join(output, 'reconciliation.json')));
  const reconciliation = JSON.parse(
    fs.readFileSync(path.join(output, 'reconciliation.json'), 'utf8'),
  );
  assert.equal(reconciliation.sourceUnchanged, true);
  assert.equal(reconciliation.integrityOk, true);
  const rehearsed = new Database(path.join(output, 'rehearsed.db'), {
    readonly: true,
  });
  assert.equal(
    rehearsed.prepare('SELECT COUNT(*) n FROM customer_pool').get().n,
    1895,
  );
  assert.equal(
    rehearsed
      .prepare("SELECT COUNT(*) n FROM crm_intake_items WHERE status = 'approved'")
      .get().n,
    1334,
  );
  assert.equal(
    rehearsed.prepare('SELECT COUNT(*) n FROM crm_activities').get().n,
    0,
  );
  rehearsed.close();
});

test('apply surfaces validated backup identity and records it in maintenance evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-cli-apply-backup-'));
  const dbPath = path.join(dir, 'fixture.db');
  createFixtureDb(dbPath);
  const pkg = writePackage(dir, exactContractPackage());
  const planOutput = path.join(dir, 'plan');
  const plan = runCli([
    'plan', '--database', dbPath, '--package', pkg.packagePath,
    '--package-sha256-file', pkg.shaPath, '--output', planOutput,
  ]);
  assert.equal(plan.status, 0, plan.stderr);
  const backupDir = path.join(dir, 'backups');
  const apply = runCli([
    'apply', '--database', dbPath, '--package', pkg.packagePath,
    '--package-sha256-file', pkg.shaPath,
    '--manifest', path.join(planOutput, 'manifest.txt'),
    '--backup-dir', backupDir, '--actor', '1', '--apply',
  ]);
  assert.equal(apply.status, 0, apply.stderr);
  const output = JSON.parse(apply.stdout);
  assert.equal(output.backup.path, output.backupFile);
  assert.match(output.backup.sha256, /^[a-f0-9]{64}$/);
  assert.ok(output.backup.size > 0);
  assert.ok(output.backup.mtimeMs > 0);
  assert.equal(output.backup.quickCheck, 'ok');
  assert.equal(output.backup.integrityCheck, 'ok');
  assert.deepEqual(output.backup.mainFileRestore, {
    sha256: output.backup.sha256,
    quickCheck: 'ok',
    integrityCheck: 'ok',
    planManifest: output.backup.planManifest,
  });

  const db = new Database(dbPath, { readonly: true });
  const audit = db
    .prepare("SELECT filters_json FROM crm_data_maintenance_runs WHERE operation = 'rebuild_customer_master' ORDER BY created_at DESC LIMIT 1")
    .get();
  assert.deepEqual(JSON.parse(audit.filters_json).backup, output.backup);
  db.close();
});

test('apply rejects a corrupt new backup before source mutation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-cli-corrupt-backup-'));
  const dbPath = path.join(dir, 'fixture.db');
  createFixtureDb(dbPath);
  const sourceBefore = fs.readFileSync(dbPath);
  const pkg = writePackage(dir, exactContractPackage());
  const planOutput = path.join(dir, 'plan');
  const plan = runCli([
    'plan', '--database', dbPath, '--package', pkg.packagePath,
    '--package-sha256-file', pkg.shaPath, '--output', planOutput,
  ]);
  assert.equal(plan.status, 0, plan.stderr);

  await assert.rejects(
    () => cmdApply(
      {
        apply: true,
        database: dbPath,
        package: pkg.packagePath,
        'package-sha256-file': pkg.shaPath,
        manifest: path.join(planOutput, 'manifest.txt'),
        'backup-dir': path.join(dir, 'backups'),
        actor: '1',
      },
      {
        onlineBackup: async (_source, destination) => {
          fs.writeFileSync(destination, 'not a sqlite database');
        },
      },
    ),
    /rollback backup validation failed/,
  );
  assert.deepEqual(fs.readFileSync(dbPath), sourceBefore);
  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_data_maintenance_runs').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_pool').get().n, 1);
  db.close();
});

async function assertBackupProvenanceRejects(setupBackup, expectedError) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-cli-backup-provenance-'));
  const dbPath = path.join(dir, 'fixture.db');
  createFixtureDb(dbPath);
  const sourceBefore = fs.readFileSync(dbPath);
  const pkg = writePackage(dir, exactContractPackage());
  const planOutput = path.join(dir, 'plan');
  const plan = runCli([
    'plan', '--database', dbPath, '--package', pkg.packagePath,
    '--package-sha256-file', pkg.shaPath, '--output', planOutput,
  ]);
  assert.equal(plan.status, 0, plan.stderr);

  await assert.rejects(
    () => cmdApply(
      {
        apply: true,
        database: dbPath,
        package: pkg.packagePath,
        'package-sha256-file': pkg.shaPath,
        manifest: path.join(planOutput, 'manifest.txt'),
        'backup-dir': path.join(dir, 'backups'),
        actor: '1',
      },
      {
        onlineBackup: async (source, destination) => {
          await setupBackup({ source, destination, dir });
        },
      },
    ),
    expectedError,
  );
  assert.deepEqual(fs.readFileSync(dbPath), sourceBefore);
  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_data_maintenance_runs').get().n, 0);
  assert.equal(db.prepare('SELECT company_name FROM customer_pool').get().company_name, 'Old');
  db.close();
}

test('apply rejects a zero-byte SQLite backup before source read-write', async () => {
  await assertBackupProvenanceRejects(
    async ({ destination }) => fs.writeFileSync(destination, Buffer.alloc(0)),
    /rollback backup validation failed: backup is empty/,
  );
});

test('apply rejects a valid but unrelated SQLite backup before source read-write', async () => {
  await assertBackupProvenanceRejects(
    async ({ destination, dir }) => {
      const unrelated = path.join(dir, 'unrelated.db');
      createFixtureDb(unrelated);
      const db = new Database(unrelated);
      db.prepare("UPDATE customer_pool SET company_name = 'Unrelated'").run();
      db.close();
      fs.copyFileSync(unrelated, destination);
    },
    /rollback backup validation failed: manifest provenance mismatch/,
  );
});

test('apply rejects a backup symlink to the source before source read-write', async () => {
  await assertBackupProvenanceRejects(
    async ({ source, destination }) => fs.symlinkSync(source, destination),
    /rollback backup validation failed: backup must be a distinct regular file/,
  );
});

test('apply rejects a hard-linked correct backup before source read-write', async () => {
  await assertBackupProvenanceRejects(
    async ({ source, destination, dir }) => {
      const correctCopy = path.join(dir, 'correct-copy.db');
      fs.copyFileSync(source, correctCopy);
      fs.linkSync(correctCopy, destination);
    },
    /rollback backup validation failed: backup link count must equal one/,
  );
});

test('apply rejects a WAL-overlay backup whose main file is unrelated', async () => {
  let overlayDb;
  let mainOnlyCopy;
  try {
    await assertBackupProvenanceRejects(
      async ({ source, destination, dir }) => {
        fs.copyFileSync(source, destination);
        overlayDb = new Database(destination);
        overlayDb.pragma('journal_mode = WAL');
        overlayDb
          .prepare("UPDATE customer_pool SET company_name = 'Unrelated'")
          .run();
        overlayDb.pragma('wal_checkpoint(TRUNCATE)');
        overlayDb
          .prepare("UPDATE customer_pool SET company_name = 'Old'")
          .run();
        assert.ok(fs.statSync(`${destination}-wal`).size > 0);
        mainOnlyCopy = path.join(dir, 'main-only-restored.db');
        fs.copyFileSync(destination, mainOnlyCopy);
      },
      /rollback backup validation failed: manifest provenance mismatch/,
    );

    const restored = new Database(mainOnlyCopy, {
      readonly: true,
      fileMustExist: true,
    });
    assert.equal(restored.pragma('quick_check', { simple: true }), 'ok');
    assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(
      restored.prepare('SELECT company_name FROM customer_pool').get().company_name,
      'Unrelated',
    );
    restored.close();
  } finally {
    if (overlayDb && overlayDb.open) overlayDb.close();
  }
});

test('rehearsal gate assertion fails closed after writing negative evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-cli-gates-'));
  const gates = [
    'sourceUnchanged',
    'sourceHashUnchanged',
    'schemaFingerprintStable',
    'preservedHashesStable',
    'reconciliationOk',
    'quickCheckOk',
    'integrityCheckOk',
  ];
  for (const failedGate of gates) {
    const evidencePath = path.join(dir, `${failedGate}.json`);
    const script = `
      const cli = require(${JSON.stringify(CLI)});
      const evidence = {
        sourceUnchanged: true,
        sourceHashUnchanged: true,
        schemaFingerprintStable: true,
        preservedHashesStable: true,
        reconciliationOk: true,
        quickCheckOk: true,
        integrityCheckOk: true
      };
      evidence[${JSON.stringify(failedGate)}] = false;
      cli.writeAndAssertRehearsalEvidence(${JSON.stringify(evidencePath)}, evidence);
    `;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, failedGate);
    assert.match(
      result.stderr,
      new RegExp(`rehearsal gates failed.*${failedGate}`),
      failedGate,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(evidencePath, 'utf8'))[failedGate],
      false,
      failedGate,
    );
  }
});

test('runbook uses only Issue #320 absolute rerun and final-preflight paths', () => {
  const runbook = fs.readFileSync(RUNBOOK, 'utf8');
  assert.match(runbook, /Issue #320/);
  assert.doesNotMatch(runbook, /#271|outputs\/lead-rebuild\/rehearsal/);
  assert.match(runbook, /--output \/Users\/ylf\/Desktop\/projects\/tradepulse-ai-crm\/outputs\/lead-rebuild\/2026-08-20-rerun\/plan/);
  assert.match(runbook, /--output \/Users\/ylf\/Desktop\/projects\/tradepulse-ai-crm\/outputs\/lead-rebuild\/2026-08-20-rerun\/rehearsal/);
  assert.match(runbook, /--manifest \/Users\/ylf\/Desktop\/projects\/tradepulse-ai-crm\/outputs\/lead-rebuild\/2026-08-20-rerun\/final-preflight\/manifest\.txt/);
  assert.match(runbook, /--backup-dir \/Users\/ylf\/Desktop\/projects\/tradepulse-production\/shared\/backups\/customer-rebuild\/2026-08-20-rerun/);
  assert.match(runbook, /preflight.*before.*write|preflight.*写入前/is);
  assert.match(runbook, /postcondition.*transaction.*rollback|postcondition.*事务.*回滚/is);
  assert.match(runbook, /beforeCounts.*source.*current|beforeCounts.*源库.*当前/is);
  assert.match(runbook, /packageCounts.*expectedAfterCounts.*projection|packageCounts.*expectedAfterCounts.*投影/is);
  assert.match(runbook, /link count.*1|single[- ]link|单一硬链接/is);
  assert.match(runbook, /main[- ]file[- ]only.*restore|仅主文件.*恢复/is);
  assert.match(runbook, /sqlite_master.*table.*index.*view.*trigger/is);
  assert.match(runbook, /owned.*BEGIN IMMEDIATE|自有.*IMMEDIATE.*事务/is);
});
