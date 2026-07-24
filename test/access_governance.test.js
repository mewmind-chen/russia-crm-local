const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');
const { ROLE_PERMISSIONS } = require('../lib/access_control');

test('export permission defaults to administrators only', () => {
  assert.equal(ROLE_PERMISSIONS.admin.export_data, true);
  assert.equal(ROLE_PERMISSIONS.manager.export_data, false);
  assert.equal(ROLE_PERMISSIONS.sales.export_data, false);
});

test('archiving revokes sessions, preserves references, supports restore, and deletes only unreferenced users', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const archived = await fx.request('/api/sales-crm/users/U-OTHER/archive', {
    cookie: fx.adminCookie, method: 'POST', body: {},
  });
  assert.equal(archived.status, 200);
  assert.equal(fx.db.prepare("SELECT active FROM sales_users WHERE id='U-OTHER'").get().active, 0);
  assert.equal((await fx.request('/api/sales-crm/bootstrap', { cookie: fx.otherCookie })).status, 401);

  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.equal(bootstrap.users.some(user => user.id === 'U-OTHER'), false);
  assert.equal(bootstrap.archivedUsers.some(user => user.id === 'U-OTHER'), true);

  const blockedDelete = await fx.request('/api/sales-crm/users/U-OTHER', {
    cookie: fx.adminCookie, method: 'DELETE',
  });
  const blockedBody = await blockedDelete.json();
  assert.equal(blockedDelete.status, 409);
  assert.equal(blockedBody.code, 'USER_REFERENCED');
  assert.ok(blockedBody.references.some(item => item.label === '负责客户'));

  const restored = await fx.request('/api/sales-crm/users/U-OTHER/restore', {
    cookie: fx.adminCookie, method: 'POST', body: {},
  });
  assert.equal(restored.status, 200);

  const managerReference = await fx.requestJson('/api/sales-crm/users', {
    cookie: fx.adminCookie, method: 'POST', body: {
      email: 'historical-manager@example.com', name: 'Historical Manager', role: 'sales',
      permissionGroupId: fx.salesGroupId, password: 'Password123!',
    },
  });
  fx.db.prepare("UPDATE crm_accounts SET manager_id=? WHERE id='CRM-WU'").run(managerReference.userId);
  await fx.request(`/api/sales-crm/users/${managerReference.userId}/archive`, {
    cookie: fx.adminCookie, method: 'POST', body: {},
  });
  const blockedManagerDelete = await fx.request(`/api/sales-crm/users/${managerReference.userId}`, {
    cookie: fx.adminCookie, method: 'DELETE',
  });
  const blockedManagerBody = await blockedManagerDelete.json();
  assert.equal(blockedManagerDelete.status, 409);
  assert.ok(blockedManagerBody.references.some(item => item.label === '管理客户'));

  const created = await fx.requestJson('/api/sales-crm/users', {
    cookie: fx.adminCookie, method: 'POST', body: {
      email: 'unused@example.com', name: 'Unused', role: 'sales',
      permissionGroupId: fx.salesGroupId, password: 'Password123!',
    },
  });
  await fx.request(`/api/sales-crm/users/${created.userId}/archive`, {
    cookie: fx.adminCookie, method: 'POST', body: {},
  });
  const deleted = await fx.request(`/api/sales-crm/users/${created.userId}`, {
    cookie: fx.adminCookie, method: 'DELETE',
  });
  assert.equal(deleted.status, 200);
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM sales_users WHERE id=?').get(created.userId).n, 0);
});

test('unassigned customers require management scope and sales cannot forge owners', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true, view_customers: true });

  const created = await fx.requestJson('/api/sales-crm/accounts', {
    cookie: fx.adminCookie, method: 'POST',
    body: { companyName: 'Unassigned One', country: '俄罗斯', ownerId: '' },
  });
  const account = fx.db.prepare('SELECT owner_id,created_by FROM crm_accounts WHERE id=?').get(created.customerId);
  assert.equal(account.owner_id, null);
  assert.equal(account.created_by, 'USR-ADMIN');

  fx.setUserPermissions('U-WU', { view_all_customers: true, manage_intake: false, edit_customer: true });
  const managerCookie = await fx.login('wu@example.com', 'Password123!');
  const managerBootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: managerCookie });
  assert.equal(managerBootstrap.accounts.some(item => item.id === created.customerId), false);
  const direct = await fx.request(`/api/sales-crm/accounts/${created.customerId}`, {
    cookie: managerCookie, method: 'PATCH', body: { priority: 'A' },
  });
  assert.equal(direct.status, 403);

  const salesCreated = await fx.requestJson('/api/sales-crm/accounts', {
    cookie: fx.otherCookie, method: 'POST',
    body: { companyName: 'Sales Owned', country: '俄罗斯', ownerId: 'U-MGR' },
  });
  assert.equal(fx.db.prepare('SELECT owner_id FROM crm_accounts WHERE id=?').get(salesCreated.customerId).owner_id, 'U-OTHER');
});

test('bulk assignment validates the whole batch before an atomic update', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const before = fx.db.prepare("SELECT id,owner_id FROM crm_accounts WHERE id IN ('CRM-WU','CRM-OWN') ORDER BY id").all();
  const failed = await fx.request('/api/sales-crm/accounts/bulk-assign', {
    cookie: fx.adminCookie, method: 'POST',
    body: { customerIds: ['CRM-WU', 'MISSING'], ownerId: 'U-OTHER' },
  });
  assert.equal(failed.status, 404);
  assert.deepEqual(
    fx.db.prepare("SELECT id,owner_id FROM crm_accounts WHERE id IN ('CRM-WU','CRM-OWN') ORDER BY id").all(),
    before,
  );

  const assigned = await fx.requestJson('/api/sales-crm/accounts/bulk-assign', {
    cookie: fx.adminCookie, method: 'POST',
    body: { customerIds: ['CRM-WU', 'CRM-OWN'], ownerId: 'U-OTHER' },
  });
  assert.equal(assigned.updated, 2);
  assert.deepEqual(
    fx.db.prepare("SELECT DISTINCT owner_id FROM crm_accounts WHERE id IN ('CRM-WU','CRM-OWN')").all(),
    [{ owner_id: 'U-OTHER' }],
  );

  const unassigned = await fx.requestJson('/api/sales-crm/accounts/bulk-assign', {
    cookie: fx.adminCookie, method: 'POST',
    body: { customerIds: ['CRM-WU', 'CRM-OWN'], ownerId: '' },
  });
  assert.equal(unassigned.updated, 2);
  assert.deepEqual(
    fx.db.prepare("SELECT DISTINCT owner_id FROM crm_accounts WHERE id IN ('CRM-WU','CRM-OWN')").all(),
    [{ owner_id: null }],
  );

  const tooMany = await fx.request('/api/sales-crm/accounts/bulk-assign', {
    cookie: fx.adminCookie, method: 'POST',
    body: { customerIds: Array.from({ length: 501 }, (_, index) => `CRM-${index}`), ownerId: '' },
  });
  assert.equal(tooMany.status, 400);
});

test('JSON export follows scope and contact permission without leaking credentials', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-WU', {
    export_data: true, view_customers: true, view_all_customers: true,
    manage_intake: true, view_contacts: false,
  });
  const managerCookie = await fx.login('wu@example.com', 'Password123!');
  const response = await fx.request('/api/sales-crm/export', { cookie: managerCookie });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="crm-data-\d{4}-\d{2}-\d{2}\.json"$/);
  const text = await response.text();
  const payload = JSON.parse(text);
  assert.ok(payload.customers.length > 0);
  assert.deepEqual(payload.contacts, []);
  assert.equal(payload.evaluations.some(item => item.subject_type === 'contact'), false);
  for (const forbidden of ['password_hash', 'password_salt', 'token_hash', 'sales_sessions', 'cookie', 'api_key', 'secret']) {
    assert.equal(text.toLowerCase().includes(forbidden), false, forbidden);
  }
  assert.ok(payload.customers.every(item => Object.hasOwn(item, 'ownerId') && Object.hasOwn(item, 'createdByName')));
});

test('an export with no visible customers returns empty customer-related arrays', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const created = await fx.requestJson('/api/sales-crm/users', {
    cookie: fx.adminCookie, method: 'POST', body: {
      email: 'empty-export@example.com', name: 'Empty Export', role: 'sales',
      permissionGroupId: fx.salesGroupId, password: 'Password123!',
    },
  });
  fx.setUserPermissions(created.userId, { export_data: true, view_customers: true });
  const cookie = await fx.login('empty-export@example.com', 'Password123!');
  const response = await fx.request('/api/sales-crm/export', { cookie });
  assert.equal(response.status, 200);
  const payload = await response.json();
  for (const key of ['customers', 'contacts', 'activities', 'rfqs', 'quotes', 'orders', 'evaluations']) {
    assert.deepEqual(payload[key], [], key);
  }
});
