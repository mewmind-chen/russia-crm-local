'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

async function json(response) {
  return { response, body: await response.json() };
}

async function rejectIntake(fx) {
  return fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      action: 'reject', itemId: 'INTAKE-OTHER', reason: '原厂，不对口',
      idempotencyKey: 'issue273-backend-intake',
    },
  });
}

async function rejectAccount(fx, cookie, customerId, reason = '客户类型不符') {
  return fx.request(`/api/sales-crm/accounts/${customerId}/reject`, {
    cookie, method: 'POST', body: { reason },
  });
}

async function recycleList(fx, cookie) {
  return json(await fx.request(
    '/api/sales-crm/lists/recycle_bin?page=1&pageSize=50&filters=%7B%7D',
    { cookie },
  ));
}

test('mismatch recycle list unifies pre-claim and CRM records with three-role scope', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  assert.equal((await rejectIntake(fx)).status, 200);
  assert.equal((await rejectAccount(fx, fx.otherCookie, 'CRM-OTHER')).status, 200);
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='mismatch',
    recycle_reason='Manager mismatch',recycled_by='U-WU',recycled_at='2026-08-11 09:00:00',
    previous_owner_id='U-WU',owner_id=NULL,assignment_status='returned'
    WHERE id='CRM-WU'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='manual_delete',
    recycle_reason='Manual delete',recycled_by='U-OTHER',recycled_at='2026-08-11 08:00:00',
    previous_owner_id='U-OTHER',owner_id=NULL,assignment_status='returned'
    WHERE id='CRM-OWN'`).run();

  const sales = await recycleList(fx, fx.otherCookie);
  assert.equal(sales.response.status, 200, sales.body.error);
  assert.deepEqual(
    sales.body.rows.map(row => row.recordKey).sort(),
    ['account:CRM-OTHER', 'intake:INTAKE-OTHER'],
  );
  assert.equal(sales.body.rows.every(row => row.actions.length === 0), true);
  assert.equal(sales.body.rows.some(row => row.recordKey === 'account:CRM-OWN'), false);

  const manager = await recycleList(fx, fx.cookie);
  assert.equal(manager.response.status, 200, manager.body.error);
  assert.equal(manager.body.rows.some(row => row.recordKey === 'account:CRM-WU'), true);
  assert.deepEqual(
    manager.body.rows.find(row => row.recordKey === 'account:CRM-WU').actions,
    ['reassign'],
  );
  assert.equal(manager.body.rows.some(row => row.recordKey === 'intake:INTAKE-OTHER'), true);

  const admin = await recycleList(fx, fx.adminCookie);
  assert.equal(admin.response.status, 200, admin.body.error);
  assert.equal(admin.body.rows.length, 4);
});

test('sales can reject only an owned CRM customer', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  assert.equal((await rejectAccount(fx, fx.otherCookie, 'CRM-OTHER')).status, 200);
  const foreign = await rejectAccount(fx, fx.otherCookie, 'CRM-WU');
  assert.equal(foreign.status, 403, await foreign.clone().text());
});

test('only recycle managers can restore a mismatch record', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  assert.equal((await rejectIntake(fx)).status, 200);

  const route = '/api/sales-crm/mismatch-recycle/intake%3AINTAKE-OTHER/restore';
  const forbidden = await fx.request(route, {
    cookie: fx.otherCookie, method: 'POST', body: { reason: '误判恢复' },
  });
  assert.equal(forbidden.status, 403);

  const restored = await fx.request(route, {
    cookie: fx.cookie, method: 'POST', body: { reason: '误判恢复' },
  });
  assert.equal(restored.status, 200, await restored.clone().text());
  assert.deepEqual(
    fx.db.prepare(`SELECT status,assigned_owner_id,previous_owner_id,rejected_by,rejected_at,
      return_reason FROM crm_intake_items WHERE id='INTAKE-OTHER'`).get(),
    {
      status: 'approved', assigned_owner_id: '', previous_owner_id: '', rejected_by: '',
      rejected_at: '', return_reason: '',
    },
  );
});
