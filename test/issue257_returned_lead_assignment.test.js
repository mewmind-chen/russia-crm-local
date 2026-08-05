'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');

function linkReturnedCustomer(fx) {
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-9003',
    crm_customer_id='CRM-OTHER',status='claimed',assigned_owner_id='U-OTHER',
    duplicate_state='cleared' WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET intake_item_id='INTAKE-OTHER',
    assignment_status='claimed',owner_id='U-OTHER' WHERE id='CRM-OTHER'`).run();
}

test('returned linked leads are assignable while active duplicates and review rows stay blocked', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  linkReturnedCustomer(fx);
  const returned = await fx.request('/api/sales-crm/accounts/CRM-OTHER/return', {
    cookie: fx.adminCookie, method: 'POST', body: { reason: '重新进入线索池分配' },
  });
  assert.equal(returned.status, 200, await returned.clone().text());
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,duplicate_state,created_at,updated_at)
    VALUES ('INTAKE-ACTIVE-DUP','BATCH-TEST','RU-9002','Active duplicate','pending','cleared',?,?),
           ('INTAKE-REVIEW','BATCH-TEST','RU-REVIEW','Review row','pending','review',?,?)`).run(
    '2026-08-05 08:00:00', '2026-08-05 08:00:00',
    '2026-08-05 08:00:00', '2026-08-05 08:00:00',
  );

  const response = await fx.request('/api/sales-crm/intake?pageSize=50', { cookie: fx.adminCookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  const byId = new Map(body.items.map(item => [item.id, item]));
  assert.equal(byId.get('INTAKE-OTHER').status, 'returned');
  assert.equal(byId.get('INTAKE-OTHER').assignable, true);
  assert.equal(byId.get('INTAKE-OTHER').assignmentBlockReason, '');
  assert.equal(byId.get('INTAKE-ACTIVE-DUP').assignable, false);
  assert.equal(byId.get('INTAKE-ACTIVE-DUP').assignmentBlockReason, '客户已在 CRM');
  assert.equal(byId.get('INTAKE-REVIEW').assignable, false);
  assert.equal(byId.get('INTAKE-REVIEW').assignmentBlockReason, '待管理层查重核验');
});

test('pre-claim return clears all assignment state', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_intake_items SET status='assigned',crm_customer_id='',
    assigned_owner_id='U-OTHER',suggested_owner_id='U-OTHER',assigned_at='2026-08-05 08:00:00',
    claim_due_at='2026-08-06 08:00:00',claimed_at='2026-08-05 08:30:00'
    WHERE id='INTAKE-OTHER'`).run();
  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      action: 'return', itemId: 'INTAKE-OTHER', reason: '退回待重新分配',
      idempotencyKey: 'issue257-preclaim-return',
    },
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(fx.db.prepare(`SELECT status,assigned_owner_id,suggested_owner_id,
    assigned_at,claim_due_at,claimed_at FROM crm_intake_items WHERE id='INTAKE-OTHER'`).get(), {
    status: 'returned',
    assigned_owner_id: '',
    suggested_owner_id: '',
    assigned_at: '',
    claim_due_at: '',
    claimed_at: '',
  });
});

test('recycle bin defaults to mismatch while explicit legacy sales returns remain readable', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='sales_return',
    recycle_reason='历史退回',previous_owner_id='U-WU',recycled_by='USR-ADMIN',
    recycled_at='2026-08-04 08:00:00' WHERE id='CRM-WU'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='mismatch',
    recycle_reason='不对口',previous_owner_id='U-MGR',recycled_by='USR-ADMIN',
    recycled_at='2026-08-05 08:00:00' WHERE id='CRM-OWN'`).run();

  const defaultResponse = await fx.request('/api/sales-crm/accounts/recycle-bin', {
    cookie: fx.adminCookie,
  });
  const defaultBody = await defaultResponse.json();
  assert.equal(defaultResponse.status, 200, defaultBody.error);
  assert.equal(defaultBody.kind, 'mismatch');
  assert.deepEqual(defaultBody.rows.map(row => row.customerId), ['CRM-OWN']);

  const legacyResponse = await fx.request('/api/sales-crm/accounts/recycle-bin?kind=sales_return', {
    cookie: fx.adminCookie,
  });
  const legacyBody = await legacyResponse.json();
  assert.equal(legacyResponse.status, 200, legacyBody.error);
  assert.equal(legacyBody.kind, 'sales_return');
  assert.deepEqual(legacyBody.rows.map(row => row.customerId), ['CRM-WU']);
});

test('frontend consumes backend assignability and opens recycle bin on mismatch', () => {
  const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
  assert.match(app, /typeof item\?\.assignable === 'boolean'/);
  assert.match(app, /assignmentBlockReason/);
  assert.match(app, /recycleKind:\s*'mismatch'/);
  assert.match(app, /canonicalView === 'recycleBin'\) state\.recycleKind = 'mismatch'/);
  assert.match(html, /class="active" data-recycle-kind="mismatch"/);
});
