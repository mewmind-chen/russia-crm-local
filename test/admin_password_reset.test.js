const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

test('new users and administrator resets use permanent passwords and revoke old sessions', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  const created = await fx.requestJson('/api/sales-crm/users', {
    cookie: fx.adminCookie, method: 'POST', body: {
      email: 'new@example.com', name: 'New User', role: 'sales',
      permissionGroupId: fx.salesGroupId, password: 'Permanent123!',
    },
  });
  assert.ok(created.userId, created.error);
  assert.equal(fx.db.prepare('SELECT must_change_password value FROM sales_users WHERE id=?')
    .get(created.userId).value, 0);

  const oldCookie = await fx.login('other@example.com', 'Password123!');
  const reset = await fx.request('/api/sales-crm/users/U-OTHER/password-reset', {
    cookie: fx.adminCookie, method: 'POST',
    body: { password: 'Replacement123!', passwordConfirm: 'Replacement123!' },
  });
  assert.equal(reset.status, 200);
  assert.deepEqual(await reset.json(), { ok: true, userId: 'U-OTHER', changed: true });
  assert.equal((await fx.request('/api/sales-crm/bootstrap', { cookie: oldCookie })).status, 401);
  assert.equal(await fx.loginStatus('other@example.com', 'Password123!'), 401);
  assert.equal(await fx.loginStatus('other@example.com', 'Replacement123!'), 200);

  await new Promise(resolve => setImmediate(resolve));
  const audit = fx.db.prepare("SELECT detail_json FROM crm_audit_log WHERE entity_id=? AND action LIKE ? ORDER BY created_at DESC LIMIT 1")
    .get('U-OTHER', '%/password-reset');
  assert.ok(audit);
  for (const forbidden of ['Replacement123!', 'password_hash', 'password_salt', oldCookie]) {
    assert.equal(audit.detail_json.includes(forbidden), false, forbidden);
  }
});

test('password reset validates confirmation and prevents administrators from resetting themselves', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  const mismatch = await fx.request('/api/sales-crm/users/U-OTHER/password-reset', {
    cookie: fx.adminCookie, method: 'POST',
    body: { password: 'Replacement123!', passwordConfirm: 'Different123!' },
  });
  assert.equal(mismatch.status, 400);

  const self = await fx.request('/api/sales-crm/users/USR-ADMIN/password-reset', {
    cookie: fx.adminCookie, method: 'POST',
    body: { password: 'Replacement123!', passwordConfirm: 'Replacement123!' },
  });
  assert.equal(self.status, 400);
});

test('new users require a role-matching permission group and reject legacy personal permissions', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  const missingGroup = await fx.request('/api/sales-crm/users', {
    cookie: fx.adminCookie, method: 'POST',
    body: { email: 'missing-group@example.com', name: 'Missing Group', role: 'sales', password: 'Permanent123!' },
  });
  assert.equal(missingGroup.status, 400);

  const mismatchedGroup = await fx.request('/api/sales-crm/users', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      email: 'mismatched-group@example.com', name: 'Mismatched Group', role: 'sales',
      permissionGroupId: fx.managerGroupId, password: 'Permanent123!',
    },
  });
  assert.equal(mismatchedGroup.status, 400);

  const legacyPermissions = await fx.request('/api/sales-crm/users', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      email: 'legacy-permissions@example.com', name: 'Legacy Permissions', role: 'sales',
      permissionGroupId: fx.salesGroupId, password: 'Permanent123!', permissions: { view_recon: false },
    },
  });
  assert.equal(legacyPermissions.status, 400);
});

test('only administrators may reset another user password', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  for (const cookie of [managerCookie, fx.otherCookie]) {
    const response = await fx.request('/api/sales-crm/users/U-OTHER/password-reset', {
      cookie, method: 'POST',
      body: { password: 'Replacement123!', passwordConfirm: 'Replacement123!' },
    });
    assert.equal(response.status, 403);
  }
});
