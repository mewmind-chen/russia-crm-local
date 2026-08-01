'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
  `);
  return db;
}

function conflictByName(report, normalizedName) {
  return report.conflicts.find(item => item.normalizedName === normalizedName);
}

test('identity preflight reports every source and stable ID without guessing a winner', t => {
  const db = migrationFixture();
  t.after(() => db.close());
  const before = db.serialize();

  const report = auditProtectedCustomerIdentities(db, { apply: false });

  assert.equal(Array.isArray(report.aliases), true);
  assert.equal(Array.isArray(report.conflicts), true);
  assert.equal(report.unresolved, 2);

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
  for (const conflict of report.conflicts) {
    assert.equal(Object.hasOwn(conflict, 'selectedExternalCustomerId'), false);
    assert.equal(Object.hasOwn(conflict, 'winnerExternalCustomerId'), false);
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
    ['acme trading', 'legacy bridge'],
  );
  assert.deepEqual(
    first.aliases,
    [...first.aliases].sort((left, right) =>
      left.normalizedName.localeCompare(right.normalizedName)
      || left.externalCustomerId.localeCompare(right.externalCustomerId)
      || left.source.localeCompare(right.source)),
  );
});
