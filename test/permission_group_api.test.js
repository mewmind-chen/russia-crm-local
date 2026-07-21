const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { ROLE_PERMISSIONS } = require('../lib/access_control');

test('group edits and allow/deny overrides affect members without relogin', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const created = await fx.requestJson('/api/sales-crm/permission-groups', {
    cookie: fx.adminCookie, method: 'POST', body: {
      name: 'Restricted sales', role: 'sales', description: 'No Recon',
      permissions: { ...ROLE_PERMISSIONS.sales, view_recon: false },
    },
  });
  assert.ok(created.groupId, created.error);
  const account = await fx.request('/api/sales-crm/users/U-OTHER', {
    cookie: fx.adminCookie, method: 'PATCH', body: { role: 'sales', permissionGroupId: created.groupId },
  });
  assert.equal(account.status, 200);
  const overrides = await fx.request('/api/sales-crm/users/U-OTHER/permission-overrides', {
    cookie: fx.adminCookie, method: 'PUT', body: { view_recon: 'allow', view_contacts: 'deny' },
  });
  assert.equal(overrides.status, 200);
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  assert.equal(bootstrap.user.permissions.view_recon, true);
  assert.equal(bootstrap.user.permissions.view_contacts, false);
  assert.equal(bootstrap.user.permissionGroupId, created.groupId);
  assert.deepEqual(bootstrap.user.permissionOverrides, { view_contacts: 'deny', view_recon: 'allow' });
});

test('group metadata is available only to users who can view users', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const admin = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.ok(admin.permissionGroups.some(group => group.id === fx.adminGroupId));
  assert.ok(admin.permissionGroups.every(group =>
    typeof group.memberCount === 'number' && !Object.hasOwn(group, 'permissions_json')));
  const other = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  assert.equal(Object.hasOwn(other, 'permissionGroups'), false);
});

test('group APIs validate permissions and deny non-administrators', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const denied = await fx.request('/api/sales-crm/permission-groups', {
    cookie: fx.otherCookie,
  });
  assert.equal(denied.status, 403);
  const invalid = await fx.request('/api/sales-crm/permission-groups', {
    cookie: fx.adminCookie, method: 'POST', body: {
      name: 'Invalid', role: 'sales', permissions: { missing_permission: true },
    },
  });
  assert.equal(invalid.status, 400);
});

test('inherit removes an existing override and restores the current group default', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const denied = await fx.request('/api/sales-crm/users/U-OTHER/permission-overrides', {
    cookie: fx.adminCookie, method: 'PUT', body: { view_recon: 'deny' },
  });
  assert.equal(denied.status, 200);
  const overridden = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  assert.equal(overridden.user.permissions.view_recon, false);
  assert.equal(overridden.user.permissionOverrides.view_recon, 'deny');

  const inherited = await fx.request('/api/sales-crm/users/U-OTHER/permission-overrides', {
    cookie: fx.adminCookie, method: 'PUT', body: { view_recon: 'inherit' },
  });
  assert.equal(inherited.status, 200);
  const restored = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  assert.equal(restored.user.permissions.view_recon, true);
  assert.equal(Object.hasOwn(restored.user.permissionOverrides, 'view_recon'), false);
});

test('the sole valid admin cannot be assigned to a restricted admin-role group', async t => {
  const fx = await fixtures.adminFixture({ adminCount: 1 });
  t.after(() => fx.close());
  for (const permission of ['view_users', 'manage_users']) {
    const created = await fx.requestJson('/api/sales-crm/permission-groups', {
      cookie: fx.adminCookie, method: 'POST', body: {
        name: `Restricted admin ${permission}`,
        role: 'admin',
        permissions: { ...ROLE_PERMISSIONS.admin, [permission]: false },
      },
    });
    assert.ok(created.groupId, created.error);
    const assigned = await fx.request('/api/sales-crm/users/USR-ADMIN', {
      cookie: fx.adminCookie, method: 'PATCH', body: { permissionGroupId: created.groupId },
    });
    const payload = await assigned.json();
    assert.equal(assigned.status, 409, payload.error);
    assert.equal(payload.code, 'LAST_ADMIN_REQUIRED');
    const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
    assert.equal(bootstrap.user.role, 'admin');
    assert.equal(bootstrap.user.permissionGroupId, fx.adminGroupId);
    assert.equal(bootstrap.user.permissions.view_users, true);
    assert.equal(bootstrap.user.permissions.manage_users, true);
  }
});

test('role status group and override changes cannot remove the last valid administrator', async t => {
  const fx = await fixtures.adminFixture({ adminCount: 1 });
  t.after(() => fx.close());
  const cases = [
    ['/api/sales-crm/users/USR-ADMIN', 'PATCH', { role: 'manager', permissionGroupId: fx.managerGroupId }],
    ['/api/sales-crm/users/USR-ADMIN', 'PATCH', { active: false }],
    ['/api/sales-crm/users/USR-ADMIN/permission-overrides', 'PUT', { manage_users: 'deny' }],
    [`/api/sales-crm/permission-groups/${fx.adminGroupId}`, 'PATCH', { permissions: { ...ROLE_PERMISSIONS.admin, view_users: false } }],
  ];
  for (const [route, method, body] of cases) {
    const response = await fx.request(route, { cookie: fx.adminCookie, method, body });
    const payload = await response.json();
    assert.equal(response.status, 409, `${route}: ${payload.error}`);
    assert.equal(payload.code, 'LAST_ADMIN_REQUIRED');
  }
});

test('account edits reject legacy personal permission fields and require a matching group for role changes', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const legacy = await fx.request('/api/sales-crm/users/U-OTHER', {
    cookie: fx.adminCookie, method: 'PATCH', body: { permissions: { view_recon: false } },
  });
  assert.equal(legacy.status, 400);
  const missingGroup = await fx.request('/api/sales-crm/users/U-OTHER', {
    cookie: fx.adminCookie, method: 'PATCH', body: { role: 'manager' },
  });
  assert.equal(missingGroup.status, 400);
  const mismatch = await fx.request('/api/sales-crm/users/U-OTHER', {
    cookie: fx.adminCookie, method: 'PATCH', body: { role: 'manager', permissionGroupId: fx.salesGroupId },
  });
  assert.equal(mismatch.status, 400);
});
