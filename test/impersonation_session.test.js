const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

test('admin inspection keeps the real user and resolves the active target', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const start = await fx.requestJson('/api/sales-crm/impersonation/start', {
    cookie: fx.adminCookie, method: 'POST', body: { targetUserId: 'U-OTHER' },
  });
  assert.equal(start.impersonation.targetUser.id, 'U-OTHER');
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.equal(bootstrap.realUser.id, 'USR-ADMIN');
  assert.equal(bootstrap.user.id, 'U-OTHER');
  assert.equal(bootstrap.impersonation.contextId, start.impersonation.contextId);
});

test('expired inspection aborts the request and never falls through as admin', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await fx.startImpersonation('U-OTHER');
  fx.expireCurrentImpersonation();
  const before = fx.db.prepare('SELECT COUNT(*) n FROM sales_users').get().n;
  const response = await fx.request('/api/sales-crm/users', {
    cookie: fx.adminCookie, method: 'POST', body: {
      email: 'must-not-exist@example.com', name: 'Blocked', role: 'sales',
      permissionGroupId: fx.salesGroupId, password: 'Password123!',
    },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'IMPERSONATION_ENDED');
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM sales_users').get().n, before);
});

test('stop restores the administrator identity and audits the lifecycle', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const start = await fx.startImpersonation('U-OTHER');
  const stop = await fx.request('/api/sales-crm/impersonation/stop', {
    cookie: fx.adminCookie, method: 'POST',
  });
  assert.equal(stop.status, 200);
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.equal(bootstrap.user.id, 'USR-ADMIN');
  assert.equal(bootstrap.impersonation, null);
  const rows = fx.db.prepare(`SELECT action,real_user_id,effective_user_id FROM crm_audit_log
    WHERE impersonation_context_id=? ORDER BY rowid`).all(start.impersonation.contextId);
  assert.deepEqual(rows.map(row => row.action), ['impersonation_start', 'impersonation_stop']);
  for (const row of rows) {
    assert.equal(row.real_user_id, 'USR-ADMIN');
    assert.equal(row.effective_user_id, 'U-OTHER');
  }
});

test('stop without an active inspection is rejected', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/impersonation/stop', {
    cookie: fx.adminCookie, method: 'POST',
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'IMPERSONATION_ENDED');
});

test('inspection start rejects invalid targets and non-admin callers', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  for (const targetUserId of ['USR-ADMIN', 'U-MISSING']) {
    const response = await fx.request('/api/sales-crm/impersonation/start', {
      cookie: fx.adminCookie, method: 'POST', body: { targetUserId },
    });
    assert.equal(response.status, 400, targetUserId);
  }
  fx.db.prepare('UPDATE sales_users SET active=0 WHERE id=?').run('U-MGR');
  const inactive = await fx.request('/api/sales-crm/impersonation/start', {
    cookie: fx.adminCookie, method: 'POST', body: { targetUserId: 'U-MGR' },
  });
  assert.equal(inactive.status, 400);
  fx.db.prepare('UPDATE sales_users SET active=1 WHERE id=?').run('U-MGR');
  for (const cookie of [fx.cookie, fx.otherCookie]) {
    const denied = await fx.request('/api/sales-crm/impersonation/start', {
      cookie, method: 'POST', body: { targetUserId: 'U-OTHER' },
    });
    assert.equal(denied.status, 403);
  }
});

test('nested inspection is rejected while a context exists', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await fx.startImpersonation('U-OTHER');
  const nested = await fx.request('/api/sales-crm/impersonation/start', {
    cookie: fx.adminCookie, method: 'POST', body: { targetUserId: 'U-MGR' },
  });
  assert.equal(nested.status, 403);
});

test('deactivating the target mid-inspection ends the context without admin fallthrough', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await fx.startImpersonation('U-OTHER');
  fx.db.prepare('UPDATE sales_users SET active=0 WHERE id=?').run('U-OTHER');
  const blocked = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, 'IMPERSONATION_ENDED');
  const restored = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.equal(restored.user.id, 'USR-ADMIN');
  assert.equal(restored.impersonation, null);
});
