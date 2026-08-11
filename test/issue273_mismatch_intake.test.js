'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

function reject(fx, cookie, itemId, suffix) {
  return fx.request('/api/sales-crm/intake/action', {
    cookie,
    method: 'POST',
    body: {
      action: 'reject',
      itemId,
      reason: '原厂，不对口',
      idempotencyKey: `issue273-${suffix}`,
    },
  });
}

test('sales rejection preserves owner metadata and writes an identity-aware audit row', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  const response = await reject(fx, fx.otherCookie, 'INTAKE-OTHER', 'own');
  assert.equal(response.status, 200, await response.clone().text());
  const row = fx.db.prepare(`SELECT status,assigned_owner_id,previous_owner_id,rejected_by,
    rejected_at,return_reason FROM crm_intake_items WHERE id='INTAKE-OTHER'`).get();
  assert.equal(row.status, 'rejected');
  assert.equal(row.assigned_owner_id, '');
  assert.equal(row.previous_owner_id, 'U-OTHER');
  assert.equal(row.rejected_by, 'U-OTHER');
  assert.notEqual(row.rejected_at, '');
  assert.equal(row.return_reason, '原厂，不对口');

  const audit = fx.db.prepare(`SELECT action,entity_type,entity_id,user_id,real_user_id,
    effective_user_id FROM crm_audit_log WHERE entity_id='INTAKE-OTHER'
    AND action='intake_mismatch_rejected'
    ORDER BY created_at DESC,id DESC LIMIT 1`).get();
  assert.deepEqual(audit, {
    action: 'intake_mismatch_rejected',
    entity_type: 'crm_intake_item',
    entity_id: 'INTAKE-OTHER',
    user_id: 'U-OTHER',
    real_user_id: 'U-OTHER',
    effective_user_id: 'U-OTHER',
  });
});

test('manager can reject an assigned team lead while sales cannot reject a foreign lead', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-FOREIGN','BATCH-TEST','RU-273-FOREIGN','Foreign Lead','assigned','U-MGR',
      '2026-08-11 08:00:00','2026-08-11 08:00:00'),
      ('INTAKE-MANAGER','BATCH-TEST','RU-273-MGR','Manager Lead','assigned','U-OTHER',
      '2026-08-11 08:00:00','2026-08-11 08:00:00')`).run();

  const foreign = await reject(fx, fx.otherCookie, 'INTAKE-FOREIGN', 'foreign');
  assert.equal(foreign.status, 403);

  const manager = await reject(fx, fx.cookie, 'INTAKE-MANAGER', 'manager');
  assert.equal(manager.status, 200, await manager.clone().text());
  assert.deepEqual(
    fx.db.prepare(`SELECT status,previous_owner_id,rejected_by
      FROM crm_intake_items WHERE id='INTAKE-MANAGER'`).get(),
    { status: 'rejected', previous_owner_id: 'U-OTHER', rejected_by: 'U-WU' },
  );
});

test('repeated rejection with a new request is rejected as a state conflict', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  assert.equal((await reject(fx, fx.otherCookie, 'INTAKE-OTHER', 'first')).status, 200);
  const repeated = await reject(fx, fx.otherCookie, 'INTAKE-OTHER', 'second');
  assert.equal(repeated.status, 409, await repeated.clone().text());
  assert.equal((await repeated.json()).code, 'INTAKE_REJECT_STATE_INVALID');
});
