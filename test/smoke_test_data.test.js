'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { buildAccessContext } = require('../lib/access_control');
const {
  LEGACY_A303_NEXT_ACTION,
  LEGACY_A303_RUN_ID,
  LEGACY_A303_SUMMARY,
  SMOKE_ACCOUNT_ID,
  SMOKE_EXTERNAL_CUSTOMER_ID,
  cleanupLegacyA303Smoke,
  cleanupNextActionSmoke,
  prepareNextActionSmoke,
} = require('../lib/smoke_test_data');

const NOW = '2026-07-27T12:00:00.000Z';

test('dedicated production smoke account is marked, hidden from business bootstrap, and cleans idempotently', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const runId = 'smoke-next-action-normal-001';
  const beforeBootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const prepared = prepareNextActionSmoke(fx.db, {
    runId,
    actorId: 'USR-ADMIN',
    now: () => NOW,
  });
  assert.equal(prepared.status, 'queued');
  assert.ok(prepared.aiJobId);
  assert.deepEqual(fx.db.prepare(`SELECT trigger_source,trigger_reason FROM crm_ai_jobs
    WHERE id=?`).get(prepared.aiJobId), {
    trigger_source: 'release_validation',
    trigger_reason: `production-smoke:${runId}`,
  });
  const account = fx.db.prepare('SELECT * FROM crm_accounts WHERE id=?').get(SMOKE_ACCOUNT_ID);
  assert.equal(account.is_test_data, 1);
  assert.equal(account.test_run_id, runId);
  const pool = fx.db.prepare('SELECT is_test_data,test_run_id FROM customer_pool WHERE customer_id=?')
    .get(SMOKE_EXTERNAL_CUSTOMER_ID);
  assert.deepEqual(pool, { is_test_data: 1, test_run_id: runId });
  assert.equal(fx.db.prepare('SELECT is_test_data,test_run_id FROM crm_activities WHERE id=?')
    .get(prepared.activityId).test_run_id, runId);
  const admin = fx.db.prepare("SELECT * FROM sales_users WHERE id='USR-ADMIN'").get();
  assert.equal(buildAccessContext(fx.db, admin).accountIds.has(SMOKE_ACCOUNT_ID), false);
  assert.equal(buildAccessContext(fx.db, admin, { includeTestData: true }).accountIds.has(SMOKE_ACCOUNT_ID), true);

  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.equal(bootstrap.accounts.some(row => row.id === SMOKE_ACCOUNT_ID), false);
  assert.equal(bootstrap.activities.some(row => row.customer_id === SMOKE_ACCOUNT_ID), false);
  assert.equal(bootstrap.alerts.some(row => row.customerId === SMOKE_ACCOUNT_ID), false);
  assert.equal(bootstrap.researchTotals.pool, beforeBootstrap.researchTotals.pool);
  const research = await fx.requestJson('/api/sales-crm/research/pool', { cookie: fx.adminCookie });
  assert.equal(research.rows.some(row => row.customer_id === SMOKE_EXTERNAL_CUSTOMER_ID), false);

  assert.equal(cleanupNextActionSmoke(fx.db, { runId, actorId: 'USR-ADMIN', now: () => NOW }).status, 'cleaned');
  assert.deepEqual(cleanupNextActionSmoke(fx.db, { runId, actorId: 'USR-ADMIN' }), {
    runId, status: 'cleaned', deduplicated: true,
  });
  const cleaned = fx.db.prepare('SELECT next_action,next_action_at,test_run_id,is_test_data FROM crm_accounts WHERE id=?')
    .get(SMOKE_ACCOUNT_ID);
  assert.deepEqual(cleaned, { next_action: '', next_action_at: '', test_run_id: '', is_test_data: 1 });
  assert.equal(fx.db.prepare('SELECT test_run_id FROM customer_pool WHERE customer_id=?')
    .get(SMOKE_EXTERNAL_CUSTOMER_ID).test_run_id, '');

  fx.db.prepare("UPDATE crm_accounts SET external_customer_id='SMOKE-NEXT-ACTION' WHERE id=?")
    .run(SMOKE_ACCOUNT_ID);
  const secondRunId = 'smoke-next-action-normal-002';
  const secondPrepared = prepareNextActionSmoke(fx.db, {
    runId: secondRunId,
    actorId: 'USR-ADMIN',
    now: () => NOW,
  });
  assert.equal(secondPrepared.status, 'queued');
  assert.equal(fx.db.prepare('SELECT external_customer_id FROM crm_accounts WHERE id=?')
    .get(SMOKE_ACCOUNT_ID).external_customer_id, SMOKE_EXTERNAL_CUSTOMER_ID);
  assert.equal(cleanupNextActionSmoke(fx.db, {
    runId: secondRunId,
    actorId: 'USR-ADMIN',
    now: () => NOW,
  }).status, 'cleaned');
});

test('interrupted smoke remains recoverable by the same cleanup command', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const runId = 'smoke-next-action-interrupted-001';
  assert.throws(() => prepareNextActionSmoke(fx.db, {
    runId,
    actorId: 'USR-ADMIN',
    now: () => NOW,
    enqueue: () => { throw new Error('simulated interruption'); },
  }), /simulated interruption/);
  assert.equal(fx.db.prepare('SELECT status FROM crm_smoke_runs WHERE run_id=?').get(runId).status, 'failed');
  assert.equal(cleanupNextActionSmoke(fx.db, { runId, actorId: 'USR-ADMIN', now: () => NOW }).status, 'cleaned');
});

test('cleanup refuses to overwrite newer values even on the dedicated smoke account', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const runId = 'smoke-next-action-preserve-001';
  prepareNextActionSmoke(fx.db, {
    runId,
    actorId: 'USR-ADMIN',
    now: () => NOW,
    enqueue: () => ({ id: '' }),
  });
  fx.db.prepare(`UPDATE crm_accounts SET next_action='newer operator note',
    next_action_at='2026-07-30 09:00:00',test_run_id='' WHERE id=?`).run(SMOKE_ACCOUNT_ID);
  assert.equal(cleanupNextActionSmoke(fx.db, { runId, actorId: 'USR-ADMIN' }).status, 'preserved');
  assert.equal(fx.db.prepare('SELECT next_action FROM crm_accounts WHERE id=?').get(SMOKE_ACCOUNT_ID).next_action,
    'newer operator note');
});

test('legacy A3-03 cleanup clears only exact master fields and marks retained evidence as test data', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const accountId = 'CRM-OWN';
  const activityId = 'ACT-A3-03-LEGACY';
  const expectedUpdatedAt = '2026-07-25 04:04:20';
  fx.db.prepare(`UPDATE crm_accounts SET next_action=?,next_action_at='2026-07-27 04:03:00',
    updated_at=? WHERE id=?`).run(LEGACY_A303_NEXT_ACTION, expectedUpdatedAt, accountId);
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,summary,next_action,next_action_at,occurred_at,created_at)
    VALUES (?,?,?,'email',?,?,'2026-07-27 04:03:00',?,?)`).run(
    activityId, accountId, 'USR-ADMIN', LEGACY_A303_SUMMARY, LEGACY_A303_NEXT_ACTION,
    expectedUpdatedAt, expectedUpdatedAt,
  );
  const beforeOwner = fx.db.prepare('SELECT owner_id,stage FROM crm_accounts WHERE id=?').get(accountId);
  const result = cleanupLegacyA303Smoke(fx.db, {
    accountId,
    expectedUpdatedAt,
    actorId: 'USR-ADMIN',
    now: () => NOW,
  });
  assert.equal(result.status, 'cleaned');
  assert.equal(result.deduplicated, false);
  assert.deepEqual(fx.db.prepare('SELECT owner_id,stage FROM crm_accounts WHERE id=?').get(accountId), beforeOwner);
  assert.deepEqual(fx.db.prepare('SELECT next_action,next_action_at FROM crm_accounts WHERE id=?').get(accountId),
    { next_action: '', next_action_at: '' });
  assert.deepEqual(fx.db.prepare('SELECT is_test_data,test_run_id FROM crm_activities WHERE id=?').get(activityId),
    { is_test_data: 1, test_run_id: LEGACY_A303_RUN_ID });
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE action='cleanup_production_smoke_residue' AND entity_id=?`).get(accountId).count, 1);
  assert.equal(cleanupLegacyA303Smoke(fx.db, {
    accountId,
    expectedUpdatedAt,
    actorId: 'USR-ADMIN',
  }).deduplicated, true);
});

test('legacy cleanup preserves an account when a newer business value exists', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const accountId = 'CRM-OWN';
  fx.db.prepare(`UPDATE crm_accounts SET next_action='real follow-up',updated_at='2026-07-27 11:00:00'
    WHERE id=?`).run(accountId);
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,summary,next_action,occurred_at,created_at)
    VALUES ('ACT-A3-03-PRESERVE',?,?,'email',?,?,?,?)`).run(
    accountId, 'USR-ADMIN', LEGACY_A303_SUMMARY, LEGACY_A303_NEXT_ACTION,
    '2026-07-25 04:04:20', '2026-07-25 04:04:20',
  );
  const result = cleanupLegacyA303Smoke(fx.db, {
    accountId,
    expectedUpdatedAt: '2026-07-25 04:04:20',
    actorId: 'USR-ADMIN',
  });
  assert.equal(result.status, 'preserved');
  assert.equal(fx.db.prepare('SELECT next_action FROM crm_accounts WHERE id=?').get(accountId).next_action,
    'real follow-up');
  assert.equal(fx.db.prepare('SELECT is_test_data FROM crm_activities WHERE id=?')
    .get('ACT-A3-03-PRESERVE').is_test_data, 0);
});
