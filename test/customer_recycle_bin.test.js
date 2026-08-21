const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

test('sales can return an owned CRM customer and manager can reassign the same account', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { manage_customer_recycle: true });

  const returned = await fx.request('/api/sales-crm/accounts/CRM-OTHER/return', {
    cookie: fx.otherCookie, method: 'POST', body: { reason: '当前区域暂不匹配，需要重新评估' },
  });
  assert.equal(returned.status, 200);
  const returnedPayload = await returned.json();
  assert.ok(returnedPayload.intakeItemId);
  assert.deepEqual(
    fx.db.prepare("SELECT owner_id,lifecycle_status,recycle_kind,assignment_status FROM crm_accounts WHERE id='CRM-OTHER'").get(),
    { owner_id: null, lifecycle_status: 'active', recycle_kind: '', assignment_status: 'returned' },
  );

  const salesBootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  assert.equal(salesBootstrap.accounts.some(item => item.id === 'CRM-OTHER'), false);
  const bin = await fx.requestJson('/api/sales-crm/accounts/recycle-bin?kind=sales_return', { cookie: fx.adminCookie });
  assert.equal(bin.rows.some(item => item.customerId === 'CRM-OTHER'), false);

  // 回池客户不再走回收站重分配；通过线索池分配并领取恢复同一客户
  const recycledReassign = await fx.request('/api/sales-crm/accounts/CRM-OTHER/reassign', {
    cookie: fx.adminCookie, method: 'POST',
    body: { ownerId: 'U-OTHER', reason: '按区域和语言能力重新分配' },
  });
  assert.equal(recycledReassign.status, 404);
  const assigned = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'assign', itemId: returnedPayload.intakeItemId, ownerId: 'U-OTHER' },
  });
  assert.equal(assigned.status, 200);
  const claimed = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie, method: 'POST',
    body: { action: 'claim', itemId: returnedPayload.intakeItemId, idempotencyKey: 'recycle-bin-reclaim' },
  });
  assert.equal(claimed.status, 200);
  assert.deepEqual(
    fx.db.prepare("SELECT id,owner_id,lifecycle_status,recycle_kind,assignment_status FROM crm_accounts WHERE id='CRM-OTHER'").get(),
    { id: 'CRM-OTHER', owner_id: 'U-OTHER', lifecycle_status: 'active', recycle_kind: '', assignment_status: 'claimed' },
  );
});

test('bulk return is atomic and never uses empty owner assignment', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const before = fx.db.prepare("SELECT id,owner_id,lifecycle_status FROM crm_accounts WHERE id IN ('CRM-WU','CRM-OWN') ORDER BY id").all();
  const failed = await fx.request('/api/sales-crm/accounts/bulk-return', {
    cookie: fx.adminCookie, method: 'POST',
    body: { customerIds: ['CRM-WU', 'MISSING'], reason: '区域策略调整' },
  });
  assert.equal(failed.status, 404);
  assert.deepEqual(
    fx.db.prepare("SELECT id,owner_id,lifecycle_status FROM crm_accounts WHERE id IN ('CRM-WU','CRM-OWN') ORDER BY id").all(),
    before,
  );

  const unassigned = await fx.request('/api/sales-crm/accounts/bulk-assign', {
    cookie: fx.adminCookie, method: 'POST',
    body: { customerIds: ['CRM-WU'], ownerId: '' },
  });
  assert.equal(unassigned.status, 400);
});

test('admin can soft-delete and restore a manual customer while preserving its master record', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const created = await fx.requestJson('/api/sales-crm/accounts', {
    cookie: fx.adminCookie, method: 'POST',
    body: { companyName: 'Manual Recycle Fixture', country: '俄罗斯', ownerId: 'U-OTHER' },
  });
  const before = fx.db.prepare('SELECT company_name,source_file FROM customer_pool WHERE customer_id=?').get(created.externalCustomerId);
  assert.equal(before.source_file, 'CRM手工新增');

  const trashed = await fx.request(`/api/sales-crm/accounts/${created.customerId}/trash`, {
    cookie: fx.adminCookie, method: 'POST', body: { reason: '误创建的重复手工客户' },
  });
  assert.equal(trashed.status, 200);
  assert.equal(fx.db.prepare('SELECT lifecycle_status,recycle_kind,owner_id FROM crm_accounts WHERE id=?').get(created.customerId).lifecycle_status, 'recycled');
  assert.deepEqual(
    fx.db.prepare('SELECT company_name,source_file FROM customer_pool WHERE customer_id=?').get(created.externalCustomerId),
    before,
  );

  const restored = await fx.request(`/api/sales-crm/accounts/${created.customerId}/restore`, {
    cookie: fx.adminCookie, method: 'POST', body: {},
  });
  assert.equal(restored.status, 200);
  assert.deepEqual(
    fx.db.prepare('SELECT lifecycle_status,recycle_kind,owner_id FROM crm_accounts WHERE id=?').get(created.customerId),
    { lifecycle_status: 'active', recycle_kind: '', owner_id: 'U-OTHER' },
  );
  const audit = fx.db.prepare("SELECT action,entity_id FROM crm_audit_log WHERE entity_id=? ORDER BY created_at").all(created.customerId);
  assert.ok(audit.some(row => row.action === 'customer_trashed'));
  assert.ok(audit.some(row => row.action === 'customer_restored'));
});

test('manual recycle operations require a real administrator and correct customer kind', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const manager = await fx.request('/api/sales-crm/accounts/CRM-WU/trash', {
    cookie: fx.cookie, method: 'POST', body: { reason: '不应允许' },
  });
  assert.equal(manager.status, 403);

  await fx.startImpersonation('U-MGR');
  const blocked = await fx.request('/api/sales-crm/accounts/CRM-WU/trash', {
    cookie: fx.adminCookie, method: 'POST', body: { reason: '身份检查期间禁止' },
  });
  assert.equal(blocked.status, 403);
});
