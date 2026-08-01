'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const {
  auditProtectedCustomerIdentities,
} = require('../lib/customer_identity_registry');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'resolve-protected-customer-identities.js');
const TEST_TEMP_ROOT = fs.realpathSync.native(os.tmpdir());

function createConflictDatabase(databasePath) {
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO customer_pool(customer_id,company_name,nickname) VALUES
      ('RU-1001','First Company','Shared Alias'),
      ('RU-2002','Second Company','');
    INSERT INTO crm_accounts(id,external_customer_id,company_name,nickname) VALUES
      ('CRM-1','RU-1001','First Company',''),
      ('CRM-2','RU-2002','Second Company',' shared  alias ');
  `);
  const conflict = auditProtectedCustomerIdentities(db).conflicts[0];
  db.close();
  return conflict;
}

function addSecondConflict(databasePath) {
  const db = new Database(databasePath);
  db.exec(`
    INSERT INTO customer_pool(customer_id,company_name,nickname) VALUES
      ('RU-3003','Third Company','Second Shared Alias');
    INSERT INTO crm_accounts(id,external_customer_id,company_name,nickname) VALUES
      ('CRM-3','RU-4004','Fourth Company',' second shared alias ');
  `);
  const conflict = auditProtectedCustomerIdentities(db).conflicts
    .find(item => item.normalizedName === 'second shared alias');
  db.close();
  return conflict;
}

function resolutionArgs(databasePath, conflict, extras = []) {
  return [
    SCRIPT,
    '--db', databasePath,
    '--conflict-id', conflict.conflictId,
    '--decision', 'link_existing',
    '--target-external-customer-id', 'RU-1001',
    '--expected-version', conflict.expectedVersion,
    '--details', '管理员已核对原始客户档案',
    '--json',
    ...extras,
  ];
}

function run(args, options = {}) {
  const { env = {}, ...spawnOptions } = options;
  return spawnSync(process.execPath, args, {
    encoding: 'utf8',
    ...spawnOptions,
    env: {
      ...process.env,
      CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED: 'false',
      ...env,
    },
  });
}

function fileEvidence(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false };
  const stat = fs.statSync(filePath, { bigint: true });
  return {
    exists: true,
    inode: stat.ino.toString(),
    links: stat.nlink.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
  };
}

function directoryEvidence(dir, databasePath) {
  return {
    entries: fs.readdirSync(dir).sort(),
    database: fileEvidence(databasePath),
    wal: fileEvidence(`${databasePath}-wal`),
    shm: fileEvidence(`${databasePath}-shm`),
    journal: fileEvidence(`${databasePath}-journal`),
  };
}

test('conflict resolution CLI previews a decision in memory and leaves the snapshot byte-for-byte unchanged', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-resolution-preview-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'snapshot.db');
  const conflict = createConflictDatabase(databasePath);
  const before = directoryEvidence(dir, databasePath);

  const result = run(resolutionArgs(databasePath, conflict));

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.mode, 'preview');
  assert.equal(output.applied, false);
  assert.equal(output.resolution.decision, 'link_existing');
  assert.equal(output.resolution.targetExternalCustomerId, 'RU-1001');
  assert.equal(output.gate.unresolved, 0);
  assert.equal(output.gate.canEnter172B, true);
  assert.equal(output.gate.rawConflicts, 1);
  assert.equal(output.gate.auditUnresolved, 0);
  assert.match(output.gate.reportVersion, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(directoryEvidence(dir, databasePath), before);

  const db = new Database(databasePath, { readonly: true });
  t.after(() => db.close());
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM sqlite_master
    WHERE name LIKE 'crm_customer_identity_conflict_%'`).get().count, 0);
});

test('conflict resolution CLI writes only with --apply and repeats the same decision idempotently', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-resolution-apply-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'snapshot.db');
  const conflict = createConflictDatabase(databasePath);

  const first = run(resolutionArgs(databasePath, conflict, ['--apply']));
  assert.equal(first.status, 0, first.stderr);
  const firstOutput = JSON.parse(first.stdout);
  assert.equal(firstOutput.mode, 'apply');
  assert.equal(firstOutput.applied, true);
  assert.equal(firstOutput.resolution.idempotent, false);
  assert.equal(firstOutput.gate.unresolved, 0);
  assert.equal(firstOutput.gate.canEnter172B, true);

  const second = run(resolutionArgs(databasePath, conflict, ['--apply']));
  assert.equal(second.status, 0, second.stderr);
  const secondOutput = JSON.parse(second.stdout);
  assert.equal(secondOutput.resolution.idempotent, true);
  assert.equal(secondOutput.gate.unresolved, 0);

  const db = new Database(databasePath, { readonly: true });
  t.after(() => db.close());
  assert.equal(db.prepare(`SELECT status FROM crm_customer_identity_conflicts
    WHERE conflict_id=?`).get(conflict.conflictId).status, 'resolved');
  assert.equal(db.prepare(`SELECT COUNT(*) count
    FROM crm_customer_identity_conflict_audit WHERE conflict_id=?`)
    .get(conflict.conflictId).count, 1);
});

test('supplement_and_retry remains unresolved and explicitly blocks the #172-B gate', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-resolution-retry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'snapshot.db');
  const conflict = createConflictDatabase(databasePath);
  const args = resolutionArgs(databasePath, conflict, ['--apply']);
  args[args.indexOf('link_existing')] = 'supplement_and_retry';
  args.splice(args.indexOf('--target-external-customer-id'), 2);

  const result = run(args);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.resolution.status, 'retry');
  assert.equal(output.gate.unresolved, 1);
  assert.equal(output.gate.canEnter172B, false);
});

test('CLI keeps #172-B blocked when an earlier resolution loses integrity', t => {
  const mutations = [
    db => db.prepare('DELETE FROM crm_customer_identity_conflict_audit').run(),
    db => db.prepare(`UPDATE crm_customer_identity_registry
      SET external_customer_id='RU-2002' WHERE normalized_name='shared alias'`).run(),
  ];

  for (const mutate of mutations) {
    const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-resolution-integrity-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const databasePath = path.join(dir, 'snapshot.db');
    const firstConflict = createConflictDatabase(databasePath);
    const secondConflict = addSecondConflict(databasePath);

    const first = run(resolutionArgs(databasePath, firstConflict, ['--apply']));
    assert.equal(first.status, 0, first.stderr);
    const db = new Database(databasePath);
    mutate(db);
    db.close();

    const secondArgs = resolutionArgs(databasePath, secondConflict, ['--apply']);
    secondArgs[secondArgs.indexOf('RU-1001')] = 'RU-3003';
    const second = run(secondArgs);
    assert.equal(second.status, 0, second.stderr);
    const output = JSON.parse(second.stdout);
    assert.equal(output.gate.unresolved, 1);
    assert.equal(output.gate.canEnter172B, false);
    assert.equal(output.gate.auditUnresolved, 1);
  }
});

test('conflict resolution CLI requires every decision input and validates target semantics', () => {
  const required = run([SCRIPT, '--json']);
  assert.notEqual(required.status, 0);
  assert.deepEqual(JSON.parse(required.stderr), {
    ok: false,
    error: {
      code: 'CUSTOMER_IDENTITY_RESOLUTION_ARGUMENT_REQUIRED',
      message: '--db is required',
    },
  });

  const relative = run([
    SCRIPT, '--db', 'crm.db', '--conflict-id', 'identity-conflict:x',
    '--decision', 'supplement_and_retry', '--expected-version', 'sha256:x',
    '--details', 'reviewed', '--json',
  ]);
  assert.notEqual(relative.status, 0);
  assert.equal(JSON.parse(relative.stderr).error.code, 'CUSTOMER_IDENTITY_DB_PATH_NOT_ABSOLUTE');

  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-resolution-input-'));
  try {
    const databasePath = path.join(dir, 'snapshot.db');
    const conflict = createConflictDatabase(databasePath);
    const missingTarget = resolutionArgs(databasePath, conflict);
    missingTarget.splice(missingTarget.indexOf('--target-external-customer-id'), 2);
    const result = run(missingTarget);
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(result.stderr).error.code, 'CUSTOMER_IDENTITY_RESOLUTION_TARGET_REQUIRED');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('conflict resolution CLI refuses the production live database without reading or writing it', t => {
  const root = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-resolution-production-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'shared', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const databasePath = path.join(dataDir, 'crm.db');
  const conflict = createConflictDatabase(databasePath);
  const before = directoryEvidence(dataDir, databasePath);

  const result = run(resolutionArgs(databasePath, conflict, ['--apply']), {
    env: { ...process.env, CRM_PRODUCTION_ROOT: root },
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), {
    ok: false,
    error: {
      code: 'CUSTOMER_IDENTITY_PRODUCTION_DB_NOT_ALLOWED',
      message: 'The production live database cannot be used by the conflict resolution CLI; create an independent SQLite backup first',
    },
  });
  assert.deepEqual(directoryEvidence(dataDir, databasePath), before);
});

test('conflict resolution CLI rejects symlinks, hardlinks, and invalid SQLite images', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-resolution-links-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'snapshot.db');
  const conflict = createConflictDatabase(databasePath);
  const symlinkPath = path.join(dir, 'symlink.db');
  const hardlinkPath = path.join(dir, 'hardlink.db');
  fs.symlinkSync(databasePath, symlinkPath);
  fs.linkSync(databasePath, hardlinkPath);

  const symlink = run(resolutionArgs(symlinkPath, conflict));
  assert.notEqual(symlink.status, 0);
  assert.equal(JSON.parse(symlink.stderr).error.code, 'CUSTOMER_IDENTITY_DB_PATH_NOT_CANONICAL');

  const hardlink = run(resolutionArgs(hardlinkPath, conflict));
  assert.notEqual(hardlink.status, 0);
  assert.equal(JSON.parse(hardlink.stderr).error.code, 'CUSTOMER_IDENTITY_DB_HARDLINK_NOT_ALLOWED');

  fs.unlinkSync(hardlinkPath);
  const invalidPath = path.join(dir, 'invalid.db');
  fs.writeFileSync(invalidPath, 'not sqlite');
  const invalid = run(resolutionArgs(invalidPath, conflict));
  assert.notEqual(invalid.status, 0);
  assert.equal(JSON.parse(invalid.stderr).error.code, 'CUSTOMER_IDENTITY_DB_INVALID');
});

test('conflict resolution CLI rejects WAL, SHM, and journal sidecars without changing evidence', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-resolution-sidecars-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  for (const sidecar of ['-wal', '-shm', '-journal']) {
    const caseDir = path.join(dir, sidecar.slice(1));
    fs.mkdirSync(caseDir);
    const databasePath = path.join(caseDir, 'snapshot.db');
    const conflict = createConflictDatabase(databasePath);
    fs.writeFileSync(`${databasePath}${sidecar}`, sidecar === '-wal' ? Buffer.alloc(0) : 'present');
    const before = directoryEvidence(caseDir, databasePath);

    const result = run(resolutionArgs(databasePath, conflict, ['--apply']));

    assert.notEqual(result.status, 0, sidecar);
    assert.equal(result.stdout, '', sidecar);
    assert.equal(
      JSON.parse(result.stderr).error.code,
      'CUSTOMER_IDENTITY_SNAPSHOT_NOT_STANDALONE',
      sidecar,
    );
    assert.deepEqual(directoryEvidence(caseDir, databasePath), before, sidecar);
  }

  const danglingDir = path.join(dir, 'dangling');
  fs.mkdirSync(danglingDir);
  const danglingDatabase = path.join(danglingDir, 'snapshot.db');
  const danglingConflict = createConflictDatabase(danglingDatabase);
  fs.symlinkSync(
    path.join(danglingDir, 'missing-journal-target'),
    `${danglingDatabase}-journal`,
  );
  const danglingBefore = directoryEvidence(danglingDir, danglingDatabase);
  const dangling = run(resolutionArgs(danglingDatabase, danglingConflict, ['--apply']));
  assert.notEqual(dangling.status, 0);
  assert.equal(
    JSON.parse(dangling.stderr).error.code,
    'CUSTOMER_IDENTITY_SNAPSHOT_NOT_STANDALONE',
  );
  assert.deepEqual(directoryEvidence(danglingDir, danglingDatabase), danglingBefore);
});

test('conflict resolution CLI apply rejects a group-writable snapshot directory', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-resolution-untrusted-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'snapshot.db');
  const conflict = createConflictDatabase(databasePath);
  fs.chmodSync(dir, 0o770);

  const result = run(resolutionArgs(databasePath, conflict, ['--apply']));

  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stderr).error.code, 'CUSTOMER_IDENTITY_DB_PATH_UNTRUSTED');
});

test('conflict resolution CLI previews a standalone WAL-header snapshot but refuses to apply it', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-resolution-wal-header-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'snapshot.db');
  const conflict = createConflictDatabase(databasePath);
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(`${databasePath}${suffix}`)) fs.unlinkSync(`${databasePath}${suffix}`);
  }
  const before = directoryEvidence(dir, databasePath);

  const preview = run(resolutionArgs(databasePath, conflict));
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).mode, 'preview');
  assert.deepEqual(directoryEvidence(dir, databasePath), before);

  const result = run(resolutionArgs(databasePath, conflict, ['--apply']));

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(
    JSON.parse(result.stderr).error.code,
    'CUSTOMER_IDENTITY_SNAPSHOT_NOT_STANDALONE',
  );
  assert.deepEqual(directoryEvidence(dir, databasePath), before);
});
