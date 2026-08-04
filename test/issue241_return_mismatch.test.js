'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');

function linkFixtureIntake(fx) {
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-9003',crm_customer_id='CRM-OTHER',
    status='claimed',assigned_owner_id='U-OTHER',duplicate_state='cleared'
    WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET external_customer_id='RU-9003',intake_item_id='INTAKE-OTHER',
    assignment_status='claimed' WHERE id='CRM-OTHER'`).run();
}

test('Issue 241 return goes back to the lead pool, not the recycle bin', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  linkFixtureIntake(fx);

  const res = await fx.request('/api/sales-crm/accounts/CRM-OTHER/return', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '测试退回' },
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json()).returnedToPool, true);

  const account = fx.db.prepare(`SELECT lifecycle_status,recycle_kind,assignment_status,owner_id
    FROM crm_accounts WHERE id='CRM-OTHER'`).get();
  assert.equal(account.lifecycle_status, 'active');
  assert.equal(account.recycle_kind, '');
  assert.equal(account.assignment_status, 'returned');
  assert.equal(account.owner_id, null);
  const intake = fx.db.prepare(`SELECT status,assigned_owner_id FROM crm_intake_items
    WHERE id='INTAKE-OTHER'`).get();
  assert.equal(intake.status, 'returned');
  assert.equal(intake.assigned_owner_id, '');

  const bin = await fx.requestJson('/api/sales-crm/accounts/recycle-bin?kind=sales_return', {
    cookie: fx.adminCookie,
  });
  assert.equal(bin.rows.some(row => row.customerId === 'CRM-OTHER'), false);

  // 从线索池重新分配 → 领取恢复同一 CRM 客户 ID
  const assign = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'assign', itemId: 'INTAKE-OTHER', ownerId: 'U-OTHER' },
  });
  assert.equal(assign.status, 200, await assign.clone().text());
  const claim = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-OTHER', idempotencyKey: 'issue241-reclaim' },
  });
  assert.equal(claim.status, 200, await claim.clone().text());
  const after = fx.db.prepare(`SELECT id,lifecycle_status,assignment_status
    FROM crm_accounts WHERE external_customer_id='RU-9003'`).all();
  assert.equal(after.length, 1);
  assert.equal(after[0].id, 'CRM-OTHER');
  assert.equal(after[0].lifecycle_status, 'active');
});

test('Issue 241 mismatch enters the recycle bin and can be reassigned', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  linkFixtureIntake(fx);

  const res = await fx.request('/api/sales-crm/accounts/CRM-OTHER/reject', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '行业不对口' },
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json()).recycleKind, 'mismatch');

  const account = fx.db.prepare(`SELECT lifecycle_status,recycle_kind,stage
    FROM crm_accounts WHERE id='CRM-OTHER'`).get();
  assert.equal(account.lifecycle_status, 'recycled');
  assert.equal(account.recycle_kind, 'mismatch');
  assert.equal(account.stage, 'lost');
  assert.equal(
    fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='INTAKE-OTHER'").get().status,
    'rejected',
  );

  const bin = await fx.requestJson('/api/sales-crm/accounts/recycle-bin?kind=mismatch', {
    cookie: fx.adminCookie,
  });
  assert.equal(bin.rows.some(row => row.customerId === 'CRM-OTHER'), true);
  const schema = await fx.requestJson('/api/sales-crm/filter-schema/recycle_bin', {
    cookie: fx.adminCookie,
  });
  const kind = schema.schema.fields.find(field => field.key === 'recycle_kind');
  assert.equal(kind.options.find(option => option.value === 'mismatch')?.label, '不对口');

  const reassign = await fx.request('/api/sales-crm/accounts/CRM-OTHER/reassign', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { ownerId: 'U-OTHER', reason: '重新分配' },
  });
  assert.equal(reassign.status, 200, await reassign.clone().text());
  const restored = fx.db.prepare(`SELECT lifecycle_status,recycle_kind,assignment_status
    FROM crm_accounts WHERE id='CRM-OTHER'`).get();
  assert.equal(restored.lifecycle_status, 'active');
  assert.equal(restored.recycle_kind, '');
  assert.equal(restored.assignment_status, 'assigned');
});

test('Issue 241 reject requires recycle permission', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const denied = await fx.request('/api/sales-crm/accounts/CRM-OTHER/reject', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { reason: '越权' },
  });
  assert.equal(denied.status, 403);
});

test('Issue 241 frontend adds reject entry, mismatch tab and pool jump', () => {
  assert.match(app, /data-reject-customer/);
  assert.match(app, /canRejectCustomer\(account\)/);
  assert.match(app, /标记不对口/);
  assert.match(app, /\['sales_return', 'mismatch'\]\.includes\(detail\.recycle\.kind\)/);
  assert.match(app, /if \(action === 'bulk'\) switchView\('pool'\)/);
  assert.doesNotMatch(app, /if \(action === 'bulk'\) switchView\('recycleBin'\)/);
  assert.match(html, /data-recycle-kind="mismatch">不对口<\/button>/);
});
