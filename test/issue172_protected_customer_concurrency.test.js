'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const {
  activateProtectedCustomer,
  commitProtectedBatch,
  previewProtectedBatch,
  rollbackProtectedBatch,
} = require('../lib/protected_customers');

const ADMIN = Object.freeze({
  id: 'USR-ADMIN',
  role: 'admin',
  permissions: { manage_protected_customers: true },
  isImpersonating: false,
});

async function concurrencyFixture(t) {
  const previousGate = process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'true';
  const fx = await fixtures.adminFixture();
  const second = new Database(fx.dbPath);
  second.pragma('foreign_keys = ON');
  second.pragma('busy_timeout = 1');
  t.after(async () => {
    second.close();
    await fx.close();
    if (previousGate === undefined) delete process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
    else process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = previousGate;
  });
  return { first: fx.db, second };
}

function assertBusy(callback) {
  assert.throws(callback, error => {
    assert.ok(
      ['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED'].includes(error.code),
      `expected SQLite lock contention, received ${error.code || error.message}`,
    );
    return true;
  });
}

function committedProtection(db, nickname, key) {
  const preview = previewProtectedBatch(db, ADMIN, [{
    alphaNickname: nickname,
    country: 'Russia',
    companyName: `${nickname} Official`,
  }], { idempotencyKey: `preview:${key}` });
  const committed = commitProtectedBatch(db, ADMIN, preview.batchId, {
    idempotencyKey: `commit:${key}`,
  });
  assert.equal(committed.imported, 1);
  return {
    batchId: preview.batchId,
    externalCustomerId: committed.rows[0].externalCustomerId,
  };
}

test('two connections committing the same normalized name produce one protected customer and one registry owner', async t => {
  const { first, second } = await concurrencyFixture(t);
  const left = previewProtectedBatch(first, ADMIN, [{
    alphaNickname: 'Concurrent Alpha',
    country: 'Russia',
  }], { idempotencyKey: 'preview:concurrent-alpha:left' });
  const right = previewProtectedBatch(second, ADMIN, [{
    alphaNickname: '  concurrent   alpha ',
    country: 'Brazil',
  }], { idempotencyKey: 'preview:concurrent-alpha:right' });
  assert.equal(left.rows[0].status, 'ready');
  assert.equal(right.rows[0].status, 'ready');

  first.exec('BEGIN IMMEDIATE');
  try {
    const winner = commitProtectedBatch(first, ADMIN, left.batchId, {
      idempotencyKey: 'commit:concurrent-alpha:left',
    });
    assert.equal(winner.imported, 1);
    assertBusy(() => commitProtectedBatch(second, ADMIN, right.batchId, {
      idempotencyKey: 'commit:concurrent-alpha:right',
    }));
    first.exec('COMMIT');
  } catch (error) {
    if (first.inTransaction) first.exec('ROLLBACK');
    throw error;
  }

  const loser = commitProtectedBatch(second, ADMIN, right.batchId, {
    idempotencyKey: 'commit:concurrent-alpha:right',
  });
  assert.equal(loser.imported, 0);
  assert.equal(loser.rejected, 1);
  assert.equal(loser.rows[0].errorCode, 'PROTECTED_CUSTOMER_IDENTITY_REVIEW_REQUIRED');

  assert.equal(first.prepare(`SELECT COUNT(*) count FROM crm_protected_customers
    WHERE normalized_name='concurrent alpha' AND status='protected'`).get().count, 1);
  assert.equal(first.prepare(`SELECT COUNT(*) count FROM crm_customer_identity_registry
    WHERE normalized_name='concurrent alpha'`).get().count, 1);
  assert.equal(first.prepare(`SELECT COUNT(DISTINCT external_customer_id) count
    FROM crm_customer_identity_registry WHERE normalized_name='concurrent alpha'`).get().count, 1);
  assert.equal(first.prepare(`SELECT COUNT(*) count FROM customer_pool pool
    JOIN crm_protected_customers protected
      ON protected.external_customer_id=pool.customer_id
    WHERE protected.normalized_name='concurrent alpha'`).get().count, 1);
});

test('two connections activating one protected customer converge on one CRM account', async t => {
  const { first, second } = await concurrencyFixture(t);
  const protectedCustomer = committedProtection(first, 'Concurrent Activation', 'activation');
  const payload = {
    ownerId: 'U-OTHER',
    companyName: 'Concurrent Activation Official',
  };

  let winner;
  first.exec('BEGIN IMMEDIATE');
  try {
    winner = activateProtectedCustomer(
      first,
      ADMIN,
      protectedCustomer.externalCustomerId,
      { ...payload, idempotencyKey: 'activate:concurrent:first' },
    );
    assertBusy(() => activateProtectedCustomer(
      second,
      ADMIN,
      protectedCustomer.externalCustomerId,
      { ...payload, idempotencyKey: 'activate:concurrent:second' },
    ));
    first.exec('COMMIT');
  } catch (error) {
    if (first.inTransaction) first.exec('ROLLBACK');
    throw error;
  }

  const retried = activateProtectedCustomer(
    second,
    ADMIN,
    protectedCustomer.externalCustomerId,
    { ...payload, idempotencyKey: 'activate:concurrent:second' },
  );
  assert.deepEqual(retried, winner);
  assert.equal(first.prepare(`SELECT COUNT(*) count FROM crm_accounts
    WHERE external_customer_id=?`).get(protectedCustomer.externalCustomerId).count, 1);
  const stored = first.prepare(`SELECT status,activated_account_id FROM crm_protected_customers
    WHERE external_customer_id=?`).get(protectedCustomer.externalCustomerId);
  assert.equal(stored.status, 'activated');
  assert.equal(stored.activated_account_id, winner.accountId);
  assert.equal(first.prepare(`SELECT COUNT(*) count FROM crm_protected_customer_audit
    WHERE action='protected_customer_activated' AND external_customer_id=?`)
    .get(protectedCustomer.externalCustomerId).count, 1);
});

test('activation racing rollback leaves one valid terminal state and never an orphan or duplicate account', async t => {
  const { first, second } = await concurrencyFixture(t);
  const protectedCustomer = committedProtection(first, 'Activation Rollback Race', 'activation-rollback');

  first.exec('BEGIN IMMEDIATE');
  try {
    const activated = activateProtectedCustomer(
      first,
      ADMIN,
      protectedCustomer.externalCustomerId,
      {
        ownerId: 'U-OTHER',
        companyName: 'Activation Rollback Official',
        idempotencyKey: 'activate:rollback-race',
      },
    );
    assert.match(activated.accountId, /^CRM-/);
    assertBusy(() => rollbackProtectedBatch(second, ADMIN, protectedCustomer.batchId, {
      reason: 'concurrent rollback attempt',
      idempotencyKey: 'rollback:activation-race',
    }));
    first.exec('COMMIT');
  } catch (error) {
    if (first.inTransaction) first.exec('ROLLBACK');
    throw error;
  }

  assert.throws(
    () => rollbackProtectedBatch(second, ADMIN, protectedCustomer.batchId, {
      reason: 'retry after activation',
      idempotencyKey: 'rollback:activation-race',
    }),
    error => error.code === 'PROTECTED_CUSTOMER_BATCH_NOT_ROLLBACKABLE'
      && error.statusCode === 409,
  );
  const state = first.prepare(`SELECT status,activated_account_id FROM crm_protected_customers
    WHERE external_customer_id=?`).get(protectedCustomer.externalCustomerId);
  assert.equal(state.status, 'activated');
  assert.ok(state.activated_account_id);
  assert.equal(first.prepare(`SELECT COUNT(*) count FROM crm_accounts
    WHERE external_customer_id=?`).get(protectedCustomer.externalCustomerId).count, 1);
  assert.equal(first.prepare(`SELECT COUNT(*) count FROM customer_pool
    WHERE customer_id=?`).get(protectedCustomer.externalCustomerId).count, 1);
});
