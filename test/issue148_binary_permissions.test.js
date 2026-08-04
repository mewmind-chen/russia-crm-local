const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');
const { ROLE_PERMISSIONS } = require('../lib/access_control');

test('personal permission API requires a complete boolean map and rejects forged fields', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const cases = [
    { body: { permissions: { view_recon: false } }, error: /缺少权限值/ },
    { body: { permissions: { ...ROLE_PERMISSIONS.sales, forged_permission: true } }, error: /未知权限/ },
    { body: { permissions: { ...ROLE_PERMISSIONS.sales, view_recon: 'deny' } }, error: /布尔值/ },
    { body: { permissions: { ...ROLE_PERMISSIONS.sales }, permissionGroupId: fx.salesGroupId }, error: /不支持/ },
  ];
  for (const item of cases) {
    const response = await fx.request('/api/sales-crm/users/U-OTHER/permission-overrides', {
      cookie: fx.adminCookie, method: 'PUT', body: item.body,
    });
    const payload = await response.json();
    assert.equal(response.status, 400, payload.error);
    assert.match(payload.error, item.error);
  }
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM user_permission_overrides WHERE user_id=?')
    .get('U-OTHER').n, 0);
});

test('new user permissions are shown as final values and stored only when different from the group', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const permissions = { ...ROLE_PERMISSIONS.sales, view_recon: false, create_customer: true };
  const response = await fx.request('/api/sales-crm/users', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      email: 'binary-new@example.com',
      password: 'Password123!',
      name: 'Binary New',
      role: 'sales',
      permissionGroupId: fx.salesGroupId,
      permissions,
    },
  });
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error);
  assert.deepEqual(fx.db.prepare(`SELECT permission_key,effect FROM user_permission_overrides
    WHERE user_id=? ORDER BY permission_key`).all(payload.userId), [
    { permission_key: 'create_customer', effect: 'allow' },
    { permission_key: 'view_recon', effect: 'deny' },
  ]);
  const cookie = await fx.login('binary-new@example.com', 'Password123!');
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie });
  assert.equal(bootstrap.user.permissions.view_recon, false);
  assert.equal(bootstrap.user.permissions.create_customer, true);
});

test('group edits propagate while personal differences remain effective', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const adjusted = await fx.request('/api/sales-crm/users/U-OTHER/permission-overrides', {
    cookie: fx.adminCookie,
    method: 'PUT',
    body: { permissions: { ...ROLE_PERMISSIONS.sales, view_contacts: false } },
  });
  assert.equal(adjusted.status, 200);
  const groupEdit = await fx.request(`/api/sales-crm/permission-groups/${fx.salesGroupId}`, {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { permissions: { ...ROLE_PERMISSIONS.sales, view_recon: false } },
  });
  assert.equal(groupEdit.status, 200);
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  assert.equal(bootstrap.user.permissions.view_recon, false);
  assert.equal(bootstrap.user.permissions.view_contacts, false);
  assert.deepEqual(bootstrap.user.permissionOverrides, { view_contacts: 'deny' });
});

test('changing groups clears personal adjustments atomically and records a dedicated audit', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await fx.request('/api/sales-crm/users/U-OTHER/permission-overrides', {
    cookie: fx.adminCookie,
    method: 'PUT',
    body: { permissions: { ...ROLE_PERMISSIONS.sales, view_contacts: false } },
  });
  const created = await fx.requestJson('/api/sales-crm/permission-groups', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      name: 'Issue 148 target',
      role: 'sales',
      permissions: { ...ROLE_PERMISSIONS.sales, view_recon: false },
    },
  });
  const changed = await fx.request('/api/sales-crm/users/U-OTHER', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { permissionGroupId: created.groupId },
  });
  assert.equal(changed.status, 200);
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM user_permission_overrides WHERE user_id=?')
    .get('U-OTHER').n, 0);
  const user = fx.db.prepare('SELECT permission_group_id FROM sales_users WHERE id=?').get('U-OTHER');
  assert.equal(user.permission_group_id, created.groupId);
  const audit = fx.db.prepare(`SELECT detail_json FROM crm_audit_log
    WHERE action='user_permission_group_changed' AND entity_id='U-OTHER'
    ORDER BY created_at DESC LIMIT 1`).get();
  assert.ok(audit);
  assert.deepEqual(JSON.parse(audit.detail_json), {
    previousPermissionGroupId: fx.salesGroupId,
    permissionGroupId: created.groupId,
    clearedPersonalPermissionCount: 1,
  });
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  assert.equal(bootstrap.user.permissions.view_recon, false);
  assert.equal(bootstrap.user.permissions.view_contacts, true);
});

test('failed last-admin group change rolls back both group and personal adjustments', async t => {
  const fx = await fixtures.adminFixture({ adminCount: 1 });
  t.after(() => fx.close());
  const adjusted = await fx.request('/api/sales-crm/users/USR-ADMIN/permission-overrides', {
    cookie: fx.adminCookie,
    method: 'PUT',
    body: { permissions: { ...ROLE_PERMISSIONS.admin, export_data: false } },
  });
  assert.equal(adjusted.status, 200);
  const created = await fx.requestJson('/api/sales-crm/permission-groups', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      name: 'Invalid sole admin',
      role: 'admin',
      permissions: { ...ROLE_PERMISSIONS.admin, manage_users: false },
    },
  });
  const auditCount = fx.db.prepare(`SELECT COUNT(*) n FROM crm_audit_log
    WHERE action='user_permission_group_changed' AND entity_id='USR-ADMIN'`).get().n;
  const changed = await fx.request('/api/sales-crm/users/USR-ADMIN', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { permissionGroupId: created.groupId },
  });
  const payload = await changed.json();
  assert.equal(changed.status, 409, payload.error);
  assert.equal(payload.code, 'LAST_ADMIN_REQUIRED');
  assert.equal(fx.db.prepare('SELECT permission_group_id FROM sales_users WHERE id=?')
    .get('USR-ADMIN').permission_group_id, fx.adminGroupId);
  assert.deepEqual(fx.db.prepare(`SELECT permission_key,effect FROM user_permission_overrides
    WHERE user_id='USR-ADMIN'`).all(), [{ permission_key: 'export_data', effect: 'deny' }]);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) n FROM crm_audit_log
    WHERE action='user_permission_group_changed' AND entity_id='USR-ADMIN'`).get().n, auditCount);
});

test('Issue 148 UI is binary, confirms group replacement, and never restores the more menu', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');
  const personalEditor = js.slice(
    js.indexOf('function personalPermissionFields'),
    js.indexOf('function openAdminPasswordResetModal'),
  );
  assert.match(personalEditor, /type="checkbox" role="switch" name="personalPermission__/);
  assert.match(personalEditor, /跟随权限组/);
  assert.match(personalEditor, /个人调整/);
  assert.doesNotMatch(personalEditor, /继承|个人开启|个人关闭/);
  assert.match(js, /更换后将清除该用户原有的个人权限调整，并采用新权限组设置。/);
  assert.match(js, /!window\.confirm/);
  assert.doesNotMatch(`${html}\n${js}`, /更多操作/);
  assert.doesNotMatch(`${js}\n${css}`, /user-action-menu/);
  assert.match(css, /flex-wrap:wrap/);
  assert.match(css, /focus-visible/);
  assert.match(js, /permissionSwitch.*Spacebar.*Enter/s);
});
