const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

test('sales inspection uses target scope and audits both identities on writes', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { edit_customer: true });
  await fx.startImpersonation('U-OTHER');
  assert.equal((await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH', body: { priority: 'A' },
  })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie, method: 'POST', body: {
      customerId: 'CRM-OTHER', activityType: 'note', summary: 'Inspection write',
    },
  })).status, 200);
  await new Promise(resolve => setImmediate(resolve));
  const audit = fx.db.prepare("SELECT * FROM crm_audit_log WHERE action='POST /api/sales-crm/activities' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(audit.user_id, 'U-OTHER');
  assert.equal(audit.real_user_id, 'USR-ADMIN');
  assert.equal(audit.effective_user_id, 'U-OTHER');
  assert.ok(audit.impersonation_context_id);
  const denied = fx.db.prepare("SELECT * FROM crm_audit_log WHERE action='permission_denied' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(denied.user_id, 'U-OTHER');
  assert.equal(denied.real_user_id, 'USR-ADMIN');
  assert.equal(denied.effective_user_id, 'U-OTHER');
  assert.ok(denied.impersonation_context_id);
});

test('all Recon starts and security writes are blocked without creating work', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await fx.startImpersonation('U-MGR');
  const before = {
    recon: fx.db.prepare('SELECT COUNT(*) n FROM recon_jobs').get().n,
    contact: fx.db.prepare('SELECT COUNT(*) n FROM contact_recon_jobs').get().n,
  };
  const reconRequests = [
    { action: 'createReconJob', customerId: 'RU-9002' },
    { action: 'retryReconJob', jobId: 'JOB-OWN' },
    { action: 'createContactReconJob', customerId: 'RU-9002' },
  ];
  for (const body of reconRequests) {
    const response = await fx.request('/api/app', { cookie: fx.adminCookie, method: 'POST', body });
    assert.equal(response.status, 403, body.action);
    assert.equal((await response.json()).code, 'IMPERSONATION_ACTION_BLOCKED', body.action);
  }
  const securityRequests = [
    ['/api/sales-crm/users/U-OTHER/permission-overrides', { view_contacts: 'allow' }, 'PUT'],
    ['/api/sales-crm/users/U-OTHER/password-reset', { password: 'Blocked123!', passwordConfirm: 'Blocked123!' }],
  ];
  for (const [route, body, method = 'POST'] of securityRequests) {
    assert.equal((await fx.request(route, { cookie: fx.adminCookie, method, body })).status, 403, route);
  }
  assert.deepEqual({
    recon: fx.db.prepare('SELECT COUNT(*) n FROM recon_jobs').get().n,
    contact: fx.db.prepare('SELECT COUNT(*) n FROM contact_recon_jobs').get().n,
  }, before);
});

test('security routes are blocked even when the target holds management permissions', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-MGR', { view_users: true, manage_users: true });
  await fx.startImpersonation('U-MGR');
  const routes = [
    ['/api/sales-crm/users', 'POST', {
      email: 'blocked-create@example.com', name: 'Blocked', role: 'sales',
      permissionGroupId: fx.salesGroupId, password: 'Password123!',
    }],
    ['/api/sales-crm/users/U-OTHER', 'PATCH', { name: 'Blocked Rename' }],
    ['/api/sales-crm/users/U-OTHER/password-reset', 'POST', { password: 'Blocked123!', passwordConfirm: 'Blocked123!' }],
    ['/api/sales-crm/permission-groups', 'POST', { name: 'Blocked Group', role: 'sales', permissions: { view_recon: true } }],
    [`/api/sales-crm/permission-groups/${fx.salesGroupId}`, 'PATCH', { description: 'Blocked' }],
    ['/api/sales-crm/users/U-OTHER/permission-overrides', 'PUT', { view_contacts: 'allow' }],
    ['/api/sales-crm/migration-review/REV-BLOCKED', 'POST', { ownerId: 'U-OTHER' }],
    ['/api/sales-crm/password', 'POST', { oldPassword: 'Password123!', newPassword: 'Blocked123!' }],
    ['/api/sales-crm/impersonation/start', 'POST', { targetUserId: 'U-OTHER' }],
  ];
  for (const [route, method, body] of routes) {
    const response = await fx.request(route, { cookie: fx.adminCookie, method, body });
    assert.equal(response.status, 403, route);
    assert.equal((await response.json()).code, 'IMPERSONATION_ACTION_BLOCKED', route);
  }
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM sales_users WHERE email=?').get('blocked-create@example.com').n, 0);
  assert.equal(fx.db.prepare('SELECT name FROM sales_users WHERE id=?').get('U-OTHER').name, 'Other');
  const stop = await fx.request('/api/sales-crm/impersonation/stop', { cookie: fx.adminCookie, method: 'POST' });
  assert.equal(stop.status, 200);
});

test('ordinary customer and intake writes stay allowed during inspection', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await fx.startImpersonation('U-MGR');
  const activity = await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie, method: 'POST',
    body: { customerId: 'CRM-OWN', activityType: 'note', summary: 'Normal inspection write' },
  });
  assert.equal(activity.status, 200);
  const settings = await fx.request('/api/sales-crm/intake/settings', {
    cookie: fx.adminCookie, method: 'PATCH',
    body: { approvalMode: 'automatic', dailyPerSales: 6 },
  });
  assert.equal(settings.status, 200);
});

test('bootstrap audit rows expose names for both identities', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const start = await fx.startImpersonation('U-OTHER');
  await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie, method: 'POST',
    body: { customerId: 'CRM-OTHER', activityType: 'note', summary: 'Named audit write' },
  });
  await new Promise(resolve => setImmediate(resolve));
  await fx.request('/api/sales-crm/impersonation/stop', { cookie: fx.adminCookie, method: 'POST' });
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const row = bootstrap.auditLog.find(entry =>
    entry.impersonation_context_id === start.impersonation.contextId && entry.action === 'POST /api/sales-crm/activities');
  assert.ok(row, 'expected an audit row for the inspection write');
  assert.equal(row.user_name, 'Other');
  assert.equal(row.real_user_name, '系统管理员');
  assert.equal(row.effective_user_name, 'Other');
});
