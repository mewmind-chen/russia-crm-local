'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const {
  auditProtectedCustomerIdentities,
} = require('../lib/customer_identity_registry');

function migrationFixture() {
  const db = new Database(':memory:');
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
    CREATE TABLE customer_nickname_audit (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL,
      old_nickname TEXT NOT NULL DEFAULT '',
      new_nickname TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE customer_nickname_migration_audit (
      external_customer_id TEXT PRIMARY KEY,
      candidates_json TEXT NOT NULL DEFAULT '[]'
    );

    INSERT INTO customer_pool(customer_id,company_name,nickname) VALUES
      ('RU-1001','ＡＣＭＥ Trading','Север Контроль'),
      ('BR-2002','Second Customer','');
    INSERT INTO crm_accounts(id,external_customer_id,company_name,nickname) VALUES
      ('CRM-RU','RU-1001','Acme Export LLC',' ACME   TRADING '),
      ('CRM-BR','BR-2002','Second Customer','');
    INSERT INTO customer_nickname_audit
      (id,external_customer_id,old_nickname,new_nickname,created_at) VALUES
      ('NICK-RU','RU-1001','North Star','Legacy Bridge','2026-07-01 00:00:00'),
      ('NICK-BR','BR-2002','acme trading',' legacy  bridge ','2026-07-02 00:00:00');
    INSERT INTO customer_nickname_migration_audit(external_customer_id,candidates_json) VALUES
      ('RU-1001','[{"accountId":"CRM-RU-OLD","nickname":"Preflight Legacy","updatedAt":"2026-01-02 00:00:00","createdAt":"2026-01-01 00:00:00"}]'),
      ('BR-2002','[{"accountId":"CRM-BR-OLD","nickname":" preflight  legacy ","updatedAt":"2026-01-04 00:00:00","createdAt":"2026-01-03 00:00:00"}]');
  `);
  return db;
}

function conflictByName(report, normalizedName) {
  return report.conflicts.find(item => item.normalizedName === normalizedName);
}

const SCRIPT = path.join(__dirname, '..', 'scripts', 'audit-protected-customer-identities.js');
const TEST_TEMP_ROOT = fs.realpathSync.native(os.tmpdir());

test('identity preflight reports every source and stable ID without guessing a winner', t => {
  const db = migrationFixture();
  t.after(() => db.close());
  const before = db.serialize();

  const report = auditProtectedCustomerIdentities(db, { apply: false });

  assert.equal(Array.isArray(report.aliases), true);
  assert.equal(Array.isArray(report.conflicts), true);
  assert.equal(report.schemaVersion, 'protected-customer-identity-preflight/v1');
  assert.match(report.reportVersion, /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.unresolved, 3);

  const acme = conflictByName(report, 'acme trading');
  assert.ok(acme);
  assert.deepEqual(acme.externalCustomerIds, ['BR-2002', 'RU-1001']);
  const acmeAliases = report.aliases.filter(item => item.normalizedName === 'acme trading');
  assert.deepEqual(
    [...new Set(acmeAliases.map(item => item.externalCustomerId))].sort(),
    ['BR-2002', 'RU-1001'],
  );
  assert.deepEqual(
    [...new Set(acmeAliases.map(item => item.source))].sort(),
    [
      'crm_accounts.nickname',
      'customer_nickname_audit.old_nickname',
      'customer_pool.company_name',
    ],
  );
  assert.deepEqual(
    acmeAliases.map(item => item.rawName).sort(),
    [' ACME   TRADING ', 'acme trading', 'ＡＣＭＥ Trading'].sort(),
  );

  const legacy = conflictByName(report, 'legacy bridge');
  assert.ok(legacy);
  assert.deepEqual(legacy.externalCustomerIds, ['BR-2002', 'RU-1001']);
  const migration = conflictByName(report, 'preflight legacy');
  assert.ok(migration);
  assert.deepEqual(migration.externalCustomerIds, ['BR-2002', 'RU-1001']);
  assert.deepEqual(
    migration.aliases.map(item => item.sourceCandidateId),
    ['CRM-BR-OLD', 'CRM-RU-OLD'],
  );
  for (const conflict of report.conflicts) {
    assert.match(conflict.conflictId, /^identity-conflict:[a-f0-9]{64}$/);
    assert.match(conflict.expectedVersion, /^sha256:[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(conflict, 'selectedExternalCustomerId'), false);
    assert.equal(Object.hasOwn(conflict, 'winnerExternalCustomerId'), false);
  }
  for (const alias of report.aliases) {
    assert.ok(alias.sourceRowId);
    assert.deepEqual(Object.keys(alias.sourcePrimaryKey), ['column', 'value']);
    assert.equal(alias.sourcePrimaryKey.value, alias.sourceRowId);
    assert.equal(alias.source, `${alias.sourceTable}.${alias.sourceColumn}`);
    assert.match(alias.sourceEvidenceHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.deepEqual(db.serialize(), before);
  assert.equal(
    db.prepare(`SELECT COUNT(*) count FROM sqlite_master
      WHERE name LIKE 'crm_customer_identity_%'`).get().count,
    0,
  );
});

test('identity preflight ordering and report content are stable across repeated scans', t => {
  const db = migrationFixture();
  t.after(() => db.close());

  const first = auditProtectedCustomerIdentities(db, { apply: false });
  const second = auditProtectedCustomerIdentities(db, { apply: false });

  assert.deepEqual(second, first);
  assert.deepEqual(
    first.conflicts.map(item => item.normalizedName),
    ['acme trading', 'legacy bridge', 'preflight legacy'],
  );
  assert.deepEqual(
    first.aliases,
    [...first.aliases].sort((left, right) =>
      left.normalizedName.localeCompare(right.normalizedName)
      || left.externalCustomerId.localeCompare(right.externalCustomerId)
      || left.source.localeCompare(right.source)
      || left.sourceRowId.localeCompare(right.sourceRowId)),
  );

  const firstAcme = conflictByName(first, 'acme trading');
  db.prepare(`UPDATE customer_nickname_audit SET old_nickname='ACME Trading'
    WHERE id='NICK-BR'`).run();
  const changed = auditProtectedCustomerIdentities(db, { apply: false });
  const changedAcme = conflictByName(changed, 'acme trading');
  assert.equal(changedAcme.conflictId, firstAcme.conflictId);
  assert.notEqual(changedAcme.expectedVersion, firstAcme.expectedVersion);
  assert.notEqual(changed.reportVersion, first.reportVersion);
});

test('identity preflight rejects malformed or incomplete legacy candidate evidence deterministically', t => {
  const db = migrationFixture();
  t.after(() => db.close());
  const invalidValues = [
    '{"broken"',
    '[{"accountId":"","nickname":"Alias","updatedAt":"","createdAt":""}]',
    '[{"accountId":"CRM-1","nickname":{},"updatedAt":"","createdAt":""}]',
    '[{"accountId":"CRM-1","nickname":"Alias","updatedAt":null,"createdAt":""}]',
    '[{"accountId":"CRM-1","nickname":"Alias","updatedAt":"","createdAt":42}]',
    '[{"accountId":"CRM-1","nickname":"Alias","updatedAt":""}]',
  ];
  for (const candidatesJson of invalidValues) {
    db.prepare(`UPDATE customer_nickname_migration_audit
      SET candidates_json=? WHERE external_customer_id='RU-1001'`).run(candidatesJson);
    assert.throws(() => auditProtectedCustomerIdentities(db), error => {
      assert.equal(error.code, 'CUSTOMER_IDENTITY_CANDIDATES_JSON_INVALID');
      assert.equal(error.statusCode, 422);
      assert.equal(error.message, 'Legacy customer nickname candidate evidence is invalid');
      assert.deepEqual(error.internalMetadata, {
        source: 'customer_nickname_migration_audit.candidates_json',
        sourceRowId: 'RU-1001',
      });
      return true;
    });
  }
});

test('identity preflight CLI requires an explicit absolute database and never applies changes', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-preflight-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'crm.db');
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO customer_pool(customer_id,company_name,nickname)
    VALUES ('RU-1001','Example Customer','Example Alias');
  `);
  db.close();
  const before = fs.readFileSync(databasePath);

  const result = spawnSync(process.execPath, [SCRIPT, '--db', databasePath, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.unresolved, 0);
  assert.deepEqual(report.aliases.map(item => item.normalizedName), [
    'example alias',
    'example customer',
  ]);
  assert.deepEqual(fs.readFileSync(databasePath), before);

  const relative = spawnSync(process.execPath, [SCRIPT, '--db', 'crm.db', '--json'], {
    encoding: 'utf8', cwd: dir,
  });
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /absolute/i);

  const apply = spawnSync(process.execPath, [SCRIPT, '--db', databasePath, '--apply'], {
    encoding: 'utf8',
  });
  assert.notEqual(apply.status, 0);
  assert.match(apply.stderr, /apply|read-only/i);
  assert.deepEqual(fs.readFileSync(databasePath), before);
});

function fileEvidence(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false };
  const stat = fs.statSync(filePath, { bigint: true });
  return {
    exists: true,
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

test('identity preflight CLI reads a standalone WAL-mode snapshot with zero directory writes', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-snapshot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'snapshot.db');
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE customer_pool (
    customer_id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL DEFAULT '',
    nickname TEXT NOT NULL DEFAULT ''
  ); INSERT INTO customer_pool VALUES ('RU-1001','Standalone Customer','Standalone Alias');`);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  fs.writeFileSync(`${databasePath}-wal`, Buffer.alloc(0));

  const before = directoryEvidence(dir, databasePath);
  const result = spawnSync(process.execPath, [SCRIPT, '--db', databasePath, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).aliases.length, 2);
  assert.deepEqual(directoryEvidence(dir, databasePath), before);
});

test('identity preflight CLI rejects a live WAL database without touching db/wal/shm', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-live-wal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'live.db');
  const db = new Database(databasePath);
  t.after(() => db.close());
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE customer_pool (
    customer_id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL DEFAULT '',
    nickname TEXT NOT NULL DEFAULT ''
  ); INSERT INTO customer_pool VALUES ('RU-1001','Live Customer','Live Alias');`);
  assert.ok(fs.statSync(`${databasePath}-wal`).size > 0);

  const before = directoryEvidence(dir, databasePath);
  const result = spawnSync(process.execPath, [SCRIPT, '--db', databasePath, '--json'], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), {
    ok: false,
    error: {
      code: 'CUSTOMER_IDENTITY_SNAPSHOT_NOT_STANDALONE',
      message: 'Database is not a completed standalone snapshot; create a SQLite online backup first',
    },
  });
  assert.deepEqual(directoryEvidence(dir, databasePath), before);
});

test('identity preflight CLI rejects DELETE, PERSIST, and TRUNCATE journal sidecars unchanged', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-journal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  for (const mode of ['DELETE', 'PERSIST', 'TRUNCATE']) {
    const modeDir = path.join(dir, mode.toLowerCase());
    fs.mkdirSync(modeDir);
    const databasePath = path.join(modeDir, 'live.db');
    const db = new Database(databasePath);
    db.pragma(`journal_mode = ${mode}`);
    db.exec(`CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );`);
    if (mode === 'DELETE') {
      db.exec(`BEGIN IMMEDIATE;
        INSERT INTO customer_pool VALUES ('RU-1001','Delete Live','Delete Alias');`);
    } else {
      db.exec(`INSERT INTO customer_pool VALUES ('RU-1001','${mode} Live','${mode} Alias');`);
    }
    assert.equal(fs.existsSync(`${databasePath}-journal`), true, mode);
    const before = directoryEvidence(modeDir, databasePath);
    const result = spawnSync(process.execPath, [SCRIPT, '--db', databasePath, '--json'], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, mode);
    assert.equal(result.stdout, '', mode);
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      error: {
        code: 'CUSTOMER_IDENTITY_SNAPSHOT_NOT_STANDALONE',
        message: 'Database is not a completed standalone snapshot; create a SQLite online backup first',
      },
    }, mode);
    assert.deepEqual(directoryEvidence(modeDir, databasePath), before, mode);
    if (mode === 'DELETE') db.exec('ROLLBACK');
    db.close();
  }
});

test('identity preflight CLI rejects symlink and hardlink aliases of a live WAL database', t => {
  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-linked-live-wal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'live.db');
  const db = new Database(databasePath);
  t.after(() => db.close());
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE customer_pool (
    customer_id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL DEFAULT '',
    nickname TEXT NOT NULL DEFAULT ''
  ); INSERT INTO customer_pool VALUES ('RU-1001','Linked Live Customer','Linked Live Alias');`);
  assert.ok(fs.statSync(`${databasePath}-wal`).size > 0);

  const symlinkPath = path.join(dir, 'symlink.db');
  fs.symlinkSync(databasePath, symlinkPath);
  const parentSymlinkPath = path.join(dir, 'linked-parent');
  fs.symlinkSync(dir, parentSymlinkPath, 'dir');
  const hardlinkPath = path.join(dir, 'hardlink.db');
  fs.linkSync(databasePath, hardlinkPath);
  const before = directoryEvidence(dir, databasePath);

  const symlink = spawnSync(process.execPath, [SCRIPT, '--db', symlinkPath, '--json'], {
    encoding: 'utf8',
  });
  assert.notEqual(symlink.status, 0);
  assert.equal(symlink.stdout, '');
  assert.deepEqual(JSON.parse(symlink.stderr), {
    ok: false,
    error: {
      code: 'CUSTOMER_IDENTITY_DB_PATH_NOT_CANONICAL',
      message: '--db must be a canonical path without symlinks',
    },
  });

  const parentSymlink = spawnSync(process.execPath, [
    SCRIPT, '--db', path.join(parentSymlinkPath, 'live.db'), '--json',
  ], { encoding: 'utf8' });
  assert.notEqual(parentSymlink.status, 0);
  assert.equal(parentSymlink.stdout, '');
  assert.deepEqual(JSON.parse(parentSymlink.stderr), {
    ok: false,
    error: {
      code: 'CUSTOMER_IDENTITY_DB_PATH_NOT_CANONICAL',
      message: '--db must be a canonical path without symlinks',
    },
  });

  const hardlink = spawnSync(process.execPath, [SCRIPT, '--db', hardlinkPath, '--json'], {
    encoding: 'utf8',
  });
  assert.notEqual(hardlink.status, 0);
  assert.equal(hardlink.stdout, '');
  assert.deepEqual(JSON.parse(hardlink.stderr), {
    ok: false,
    error: {
      code: 'CUSTOMER_IDENTITY_DB_HARDLINK_NOT_ALLOWED',
      message: '--db must be an independent snapshot file with one filesystem link',
    },
  });
  assert.deepEqual(directoryEvidence(dir, databasePath), before);
});

test('identity preflight CLI returns stable JSON errors when JSON mode is requested', t => {
  const relative = spawnSync(process.execPath, [SCRIPT, '--db', 'crm.db', '--json'], {
    encoding: 'utf8',
  });
  assert.notEqual(relative.status, 0);
  assert.equal(relative.stdout, '');
  assert.deepEqual(JSON.parse(relative.stderr), {
    ok: false,
    error: {
      code: 'CUSTOMER_IDENTITY_DB_PATH_NOT_ABSOLUTE',
      message: '--db must be an absolute path',
    },
  });

  const dir = fs.mkdtempSync(path.join(TEST_TEMP_ROOT, 'crm-identity-json-error-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'invalid-candidates.db');
  const db = new Database(databasePath);
  db.exec(`CREATE TABLE customer_nickname_migration_audit (
    external_customer_id TEXT PRIMARY KEY,
    candidates_json TEXT NOT NULL DEFAULT '[]'
  ); INSERT INTO customer_nickname_migration_audit VALUES ('RU-1001','{"broken"');`);
  db.close();
  const malformed = spawnSync(process.execPath, [SCRIPT, '--db', databasePath, '--json'], {
    encoding: 'utf8',
  });
  assert.notEqual(malformed.status, 0);
  assert.equal(malformed.stdout, '');
  assert.deepEqual(JSON.parse(malformed.stderr), {
    ok: false,
    error: {
      code: 'CUSTOMER_IDENTITY_CANDIDATES_JSON_INVALID',
      message: 'Legacy customer nickname candidate evidence is invalid',
    },
  });
});
