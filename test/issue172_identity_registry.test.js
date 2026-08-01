'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  assertProtectedCustomerWritesEnabled,
  installCustomerIdentityRegistry,
  normalizeCustomerName,
  protectedCustomerWritesEnabled,
  reserveCustomerIdentity,
} = require('../lib/customer_identity_registry');
const { ROLE_PERMISSIONS } = require('../lib/access_control');

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
  const previousGate = process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'true';
  t.after(() => {
    if (previousGate === undefined) delete process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
    else process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = previousGate;
  });

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
  }), error => {
    assert.equal(error.code, 'CUSTOMER_IDENTITY_CONFLICT');
    assert.equal(error.statusCode, 409);
    assert.doesNotMatch(error.message, /acme trading/i);
    assert.equal(error.internalMetadata.normalizedName, 'acme trading');
    assert.equal(Object.keys(error).includes('internalMetadata'), false);
    return true;
  });
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

test('identity preflight installs additive empty schema without enforcing legacy aliases', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());

  installCustomerIdentityRegistry(db);
  installCustomerIdentityRegistry(db);

  assert.deepEqual(
    db.prepare(`SELECT name FROM sqlite_master
      WHERE type='table' AND name LIKE 'crm_customer_identity_%'
      ORDER BY name`).all().map(row => row.name),
    [
      'crm_customer_identity_audit',
      'crm_customer_identity_migration_reports',
      'crm_customer_identity_registry',
    ],
  );
  assert.deepEqual(
    db.prepare('SELECT normalized_name,external_customer_id FROM crm_customer_identity_registry').all(),
    [],
  );
  assert.deepEqual(
    db.prepare(`SELECT name FROM sqlite_master
      WHERE type='index' AND sql IS NOT NULL
        AND name LIKE 'crm_customer_identity_%' ORDER BY name`).all(),
    [],
  );
});

test('protected customer management is an independent admin-only default permission', () => {
  assert.equal(ROLE_PERMISSIONS.admin.manage_protected_customers, true);
  assert.equal(ROLE_PERMISSIONS.manager.manage_protected_customers, false);
  assert.equal(ROLE_PERMISSIONS.sales.manage_protected_customers, false);
  assert.equal(ROLE_PERMISSIONS.manager.view_all_customers, true);
});

test('protected customer writes have a testable default-off environment hard gate', t => {
  assert.equal(protectedCustomerWritesEnabled({}), false);
  assert.equal(protectedCustomerWritesEnabled({ CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED: '' }), false);
  assert.equal(protectedCustomerWritesEnabled({ CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED: 'false' }), false);
  assert.equal(protectedCustomerWritesEnabled({ CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED: 'true' }), true);
  assert.equal(protectedCustomerWritesEnabled({ CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED: '1' }), true);

  assert.throws(() => assertProtectedCustomerWritesEnabled({}), error =>
    error.code === 'PROTECTED_CUSTOMER_WRITES_DISABLED'
      && error.statusCode === 409
      && !/CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED/.test(error.message));
  assert.doesNotThrow(() => assertProtectedCustomerWritesEnabled({
    CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED: 'true',
  }));

  const previousGate = process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
  delete process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
  t.after(() => {
    if (previousGate === undefined) delete process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
    else process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = previousGate;
  });
  const db = registryFixture();
  t.after(() => db.close());
  assert.throws(() => reserveCustomerIdentity(db, {
    externalCustomerId: 'RU-1001',
    name: 'Blocked Customer',
    source: 'customer_pool.company_name',
    env: { CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED: 'true' },
  }), error => error.code === 'PROTECTED_CUSTOMER_WRITES_DISABLED');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_customer_identity_registry').get().count, 0);
  assert.deepEqual(reserveCustomerIdentity(db, {
    externalCustomerId: 'RU-1001',
    name: '  ',
    source: 'customer_pool.nickname',
  }), { normalizedName: '', created: false });
});
