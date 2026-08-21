'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

async function createManualCustomer(fx, cookie, companyName, ownerId = '__unassigned__') {
  return fx.requestJson('/api/sales-crm/accounts', {
    cookie,
    method: 'POST',
    body: {
      companyName,
      country: '俄罗斯',
      customerType: '终端制造商',
      source: '公司指派',
      ownerId,
      productFocus: '传感器',
    },
  });
}

test('manual customer creation attributes the real creator while impersonation controls ownership', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true, view_customers: true });

  const started = await fx.startImpersonation('U-OTHER');
  const created = await createManualCustomer(
    fx,
    fx.adminCookie,
    'Issue 329 Impersonated Manual Creator',
    'U-MGR',
  );
  const account = fx.db.prepare(`SELECT created_by,owner_id,first_claimed_by
    FROM crm_accounts WHERE id=?`).get(created.customerId);

  assert.equal(account.created_by, 'USR-ADMIN');
  assert.equal(account.owner_id, 'U-OTHER');
  assert.equal(account.first_claimed_by, '');

  await new Promise(resolve => setImmediate(resolve));
  const audit = fx.db.prepare(`SELECT user_id,real_user_id,effective_user_id,
      impersonation_context_id FROM crm_audit_log
    WHERE action='POST /api/sales-crm/accounts' ORDER BY rowid DESC LIMIT 1`).get();
  assert.deepEqual(audit, {
    user_id: 'U-OTHER',
    real_user_id: 'USR-ADMIN',
    effective_user_id: 'U-OTHER',
    impersonation_context_id: started.impersonation.contextId,
  });
});

test('return, administrator assignment and sales reclaim never rewrite the manual creator', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const created = await createManualCustomer(fx, fx.adminCookie, 'Issue 329 Creator Lifecycle');
  const original = fx.db.prepare('SELECT created_by FROM crm_accounts WHERE id=?')
    .get(created.customerId).created_by;
  assert.equal(original, 'USR-ADMIN');

  let response = await fx.request(`/api/sales-crm/accounts/${created.customerId}/return`, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '退回线索池重新分配' },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const returned = await response.json();
  assert.equal(
    fx.db.prepare('SELECT created_by FROM crm_accounts WHERE id=?').get(created.customerId).created_by,
    original,
  );

  response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'assign', itemId: returned.intakeItemId, ownerId: 'U-OTHER' },
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(
    fx.db.prepare('SELECT created_by FROM crm_accounts WHERE id=?').get(created.customerId).created_by,
    original,
  );

  response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      action: 'claim',
      itemId: returned.intakeItemId,
      idempotencyKey: 'issue-329-manual-reclaim',
    },
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(
    fx.db.prepare(`SELECT created_by,owner_id,first_claimed_by
      FROM crm_accounts WHERE id=?`).get(created.customerId),
    { created_by: original, owner_id: 'U-OTHER', first_claimed_by: 'U-OTHER' },
  );

  const history = await fx.requestJson(`/api/sales-crm/accounts/${created.customerId}/history`, {
    cookie: fx.adminCookie,
  });
  assert.equal(history.timeline.some(event => event.kind === 'manual_create'), true);
  assert.equal(history.timeline.some(event => event.kind === 'sales_return'), true);
  assert.equal(history.timeline.some(event => event.kind === 'reassign'), true);
  assert.equal(history.timeline.some(event => event.kind === 'claim'), true);
});
