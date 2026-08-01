'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  normalizeCustomerName,
  reserveCustomerIdentity,
} = require('../lib/customer_identity_registry');

function registryFixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE crm_customer_identity_registry (
    normalized_name TEXT PRIMARY KEY,
    external_customer_id TEXT NOT NULL,
    source TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  return db;
}

test('customer identity names normalize Unicode, whitespace, case, and empty aliases', () => {
  assert.equal(normalizeCustomerName('  ＡＣＭＥ\u3000Trading  '), 'acme trading');
  assert.equal(normalizeCustomerName('Cafe\u0301   INDUSTRIES'), 'café industries');
  assert.equal(normalizeCustomerName('\tАльфа   ЭЛЕКТРОНИКА\n'), 'альфа электроника');
  assert.equal(normalizeCustomerName('  北方　控制  '), '北方 控制');
  assert.equal(normalizeCustomerName(' \u3000\t\n '), '');
  assert.equal(normalizeCustomerName(null), '');
});

test('one normalized name accepts repeated roles only for the same stable customer', t => {
  const db = registryFixture();
  t.after(() => db.close());

  const official = reserveCustomerIdentity(db, {
    externalCustomerId: 'RU-1001',
    name: 'ＡＣＭＥ Trading',
    source: 'customer_pool.company_name',
    actorId: 'USR-ADMIN',
  });
  assert.equal(official.normalizedName, 'acme trading');
  assert.equal(official.created, true);

  const currentNickname = reserveCustomerIdentity(db, {
    externalCustomerId: 'RU-1001',
    name: '  acme   TRADING ',
    source: 'customer_pool.nickname',
    actorId: 'USR-ADMIN',
  });
  assert.equal(currentNickname.normalizedName, 'acme trading');
  assert.equal(currentNickname.created, false);
  assert.deepEqual(
    db.prepare(`SELECT normalized_name,external_customer_id FROM crm_customer_identity_registry`).all(),
    [{ normalized_name: 'acme trading', external_customer_id: 'RU-1001' }],
  );

  assert.throws(() => reserveCustomerIdentity(db, {
    externalCustomerId: 'BR-2002',
    name: 'Acme Trading',
    source: 'crm_accounts.nickname',
    actorId: 'USR-ADMIN',
  }));
  assert.equal(
    db.prepare(`SELECT external_customer_id FROM crm_customer_identity_registry
      WHERE normalized_name='acme trading'`).get().external_customer_id,
    'RU-1001',
  );

  const emptyNickname = reserveCustomerIdentity(db, {
    externalCustomerId: 'RU-1001',
    name: '  \u3000 ',
    source: 'customer_pool.nickname',
    actorId: 'USR-ADMIN',
  });
  assert.equal(emptyNickname.normalizedName, '');
  assert.equal(emptyNickname.created, false);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_customer_identity_registry').get().count, 1);
});
