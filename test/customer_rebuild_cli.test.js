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

test('plan against missing database exits non-zero without creating files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-cli-plan-'));
  const output = path.join(dir, 'out');
  const pkg = writePackage(dir, samplePackage());
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
  const pkg = writePackage(dir, samplePackage());
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
  assert.deepEqual(fs.readFileSync(dbPath), before);
  assert.equal(fs.statSync(dbPath).mtimeMs, beforeStat.mtimeMs);
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
  const pkg = writePackage(dir, samplePackage());
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
    1,
  );
  assert.equal(
    rehearsed
      .prepare("SELECT COUNT(*) n FROM crm_intake_items WHERE status = 'approved'")
      .get().n,
    1,
  );
  assert.equal(
    rehearsed.prepare('SELECT COUNT(*) n FROM crm_activities').get().n,
    0,
  );
  rehearsed.close();
});
