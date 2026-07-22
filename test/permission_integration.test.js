const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');

test('capabilities contain permissions but no business data', async t => {
  assert.equal(typeof fixtures.seededFixture, 'function');
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const cookie = await fx.login('wu@example.com', 'Password123!');
  const response = await fx.request('/api/session/capabilities', { cookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.permissions.view_contacts, false);
  assert.equal(body.modules.includes('contacts'), false);
  assert.equal(JSON.stringify(body).includes('RU-9001'), false);
  assert.equal(JSON.stringify(body).includes('person@secret.test'), false);
});

test('group and personal permission changes affect an existing session immediately', async t => {
  assert.equal(typeof fixtures.seededFixture, 'function');
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const cookie = await fx.login('wu@example.com', 'Password123!');
  assert.equal((await fx.request('/development-workbench', { cookie })).status, 200);
  const group = fx.db.prepare('SELECT permissions_json FROM permission_groups WHERE id=?')
    .get('PGRP-MANAGER-DEFAULT');
  fx.db.prepare('UPDATE permission_groups SET permissions_json=? WHERE id=?').run(
    JSON.stringify({ ...JSON.parse(group.permissions_json), view_development: false }),
    'PGRP-MANAGER-DEFAULT',
  );
  assert.equal((await fx.request('/development-workbench', { cookie })).status, 403);
  fx.setUserPermissions('U-WU', { view_development: true });
  assert.equal((await fx.request('/development-workbench', { cookie })).status, 200);
  fx.setUserPermissions('U-WU', { view_development: false });
  assert.equal((await fx.request('/development-workbench', { cookie })).status, 403);
});

test('Wu Wei cannot receive contact data through initial or direct contact routes', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const initial = await fx.request('/api/initial', { cookie: fx.cookie });
  assert.equal(initial.status, 200);
  const text = await initial.text();
  for (const secret of ['person@secret.test', '+7-secret', 'Verified Buyer']) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.equal(
    (await fx.request('/api/customers/RU-9001/people', { cookie: fx.cookie })).status,
    403,
  );
  assert.equal(
    (await fx.request('/api/contact-recon/state', { cookie: fx.cookie })).status,
    403,
  );
});

test('GET initial does not seed or auto-tag customer data', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO customer_pool
    (customer_id,company_name,industry,products)
    VALUES ('RU-9901','Read Only Fixture','工业控制','MCU 连接器')`).run();
  const before = {
    tags: fx.db.prepare('SELECT COUNT(*) count FROM tags').get().count,
    customerTags: fx.db.prepare('SELECT COUNT(*) count FROM customer_tags').get().count,
  };

  const response = await fx.request('/api/initial', { cookie: fx.cookie });
  assert.equal(response.status, 200);

  assert.deepEqual({
    tags: fx.db.prepare('SELECT COUNT(*) count FROM tags').get().count,
    customerTags: fx.db.prepare('SELECT COUNT(*) count FROM customer_tags').get().count,
  }, before);
});

test('each disabled legacy module permission denies its direct API', async () => {
  const cases = [
    ['view_pool', '/api/customers'],
    ['view_recon', '/api/recon/results/JOB-OWN'],
    ['view_intake', '/api/delivery/latest'],
  ];
  for (const [permission, route] of cases) {
    const fx = await fixtures.fixtureWithPermission(permission, false);
    try {
      const response = await fx.request(route, { cookie: fx.cookie });
      assert.equal(response.status, 403, `${permission}: ${route}`);
    } finally {
      await fx.close();
    }
  }
});

test('workbench bootstraps from capabilities without embedded business contacts', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const response = await fx.request('/development-workbench', { cookie: fx.cookie });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /\/api\/session\/capabilities/);
  assert.match(html, /MODULE_PERMISSION/);
  assert.equal(html.includes('sales@chipdip.ru'), false);
  assert.equal(html.includes('+7 (495) 544-00-08'), false);
  for (const secret of ['RU-9001', 'RU-9002', 'RU-9003', 'person@secret.test', '+7-secret']) {
    assert.equal(html.includes(secret), false, secret);
  }
});

test('CRM customer profile uses customer permission and returns only the scoped profile', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-WU', {
    view_customers: true,
    view_development: false,
    view_pool: false,
    view_recon: false,
    view_all_customers: false,
    edit_customer: true,
  });
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,evaluation_text,author_id,author_name,ai_status,ai_labels_json,created_at,updated_at)
    VALUES ('EVAL-PROFILE','CRM-WU','company','Priority account','U-MGR','Manager','completed',?, '2026-07-21 08:00:00','2026-07-21 08:00:00')`)
    .run(JSON.stringify([{ name: '重点推进' }, { name: '俄罗斯市场' }]));
  const cookie = await fx.login('wu@example.com', 'Password123!');

  assert.equal((await fx.request('/development-workbench', { cookie })).status, 403);
  assert.equal((await fx.request('/development-workbench?profile=1&customer=RU-9001', { cookie })).status, 200);

  const response = await fx.request('/api/sales-crm/profile/RU-9001', { cookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.deepEqual(body.customerPool.map(row => row.customerId), ['RU-9001']);
  assert.equal(body.customerPool[0].tags.some(tag => tag.readOnly && tag.name === '重点推进'), true);
  assert.deepEqual(body.reconResults, []);
  assert.equal(JSON.stringify(body).includes('RU-9002'), false);
  assert.equal(JSON.stringify(body).includes('RU-9003'), false);
  assert.equal((await fx.request('/api/sales-crm/profile/RU-9003', { cookie })).status, 403);
});

test('complete legacy deny matrix returns 403 before business handlers run', async () => {
  const cases = [
    ['view_development', 'GET', '/api/initial'],
    ['view_pool', 'GET', '/api/customers'],
    ['view_contacts', 'GET', '/api/customers/RU-9001/people'],
    ['view_contacts', 'GET', '/api/contact-recon/state'],
    ['view_recon', 'GET', '/api/recon/results/JOB-OWN'],
    ['view_recon', 'GET', '/api/report?job_id=JOB-OWN'],
    ['view_recon', 'GET', '/api/recon-monitor'],
    ['view_all_customers', 'GET', '/api/quality/issues'],
    ['view_intake', 'GET', '/api/delivery/latest'],
    ['view_intake', 'GET', '/api/delivery/file?name=missing.csv'],
    ['use_ai_assistant', 'POST', '/api/assistant/chat', { message: 'summary' }],
    ['use_prospect_agent', 'POST', '/api/prospect-agent', { action: 'createTask' }],
    ['edit_customer', 'POST', '/api/app', { action: 'updateCustomer', followId: 'FOLLOW-WU', payload: { status: '未分配' } }],
    ['run_recon', 'POST', '/api/app', { action: 'createReconJob', customerId: 'RU-9001' }],
  ];
  for (const [permission, method, route, body] of cases) {
    const fx = await fixtures.seededFixture({ permissions: { [permission]: false } });
    try {
      const response = await fx.request(route, { cookie: fx.cookie, method, body });
      assert.equal(response.status, 403, `${permission} ${method} ${route}`);
    } finally {
      await fx.close();
    }
  }
});

test('unknown legacy actions are denied by the default policy', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  for (const route of ['/api/app', '/api/prospect-agent']) {
    const response = await fx.request(route, {
      cookie: fx.cookie, method: 'POST', body: { action: 'unmappedAction' },
    });
    assert.equal(response.status, 403, route);
  }
});

test('promoting a prospect with Recon requires Recon permissions', async t => {
  const fx = await fixtures.seededFixture({
    permissions: { use_prospect_agent: true, edit_customer: true, run_recon: false, view_recon: false },
  });
  t.after(() => fx.close());
  const response = await fx.request('/api/prospect-agent', {
    cookie: fx.cookie,
    method: 'POST',
    body: { action: 'promoteCandidate', candidateId: 'CANDIDATE-UNKNOWN', createRecon: true },
  });
  assert.equal(response.status, 403);
});

test('scoped manager cannot list, read, report, or mutate another owner', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false });
  t.after(() => fx.close());
  const list = await fx.request('/api/customers', { cookie: fx.cookie });
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.deepEqual(listBody.rows.map(row => row.customer_id), ['RU-9002']);

  const deniedRoutes = [
    '/api/customers/RU-9003/people',
    '/api/recon/results/JOB-OTHER',
    '/api/report?job_id=JOB-OTHER',
  ];
  for (const route of deniedRoutes) {
    assert.equal((await fx.request(route, { cookie: fx.cookie })).status, 403, route);
  }

  const before = fx.db.prepare('SELECT status FROM customers WHERE follow_id=?').get('FOLLOW-OTHER').status;
  const write = await fx.request('/api/app', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      action: 'updateCustomer',
      followId: 'FOLLOW-OTHER',
      payload: { status: '已报价' },
    },
  });
  assert.equal(write.status, 403);
  const after = fx.db.prepare('SELECT status FROM customers WHERE follow_id=?').get('FOLLOW-OTHER').status;
  assert.equal(after, before);
});

test('scoped resource misses are non-enumerable while full-scope misses are 404', async t => {
  const scoped = await fixtures.seededFixture({ managerViewAll: false, permissions: { view_contacts: true } });
  t.after(() => scoped.close());
  scoped.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,evaluation_text,author_id,author_name,created_at,updated_at)
    VALUES ('EVAL-OTHER','CRM-OTHER','company','Scoped fixture','U-OTHER','Other',?,?)`)
    .run('2026-07-21 08:00:00', '2026-07-21 08:00:00');
  const scopedRequests = [
    ['/api/sales-crm/accounts/CRM-MISSING', { method: 'PATCH', body: { priority: 'A' } }],
    ['/api/sales-crm/evaluations/EVAL-MISSING/retry', { method: 'POST', body: {} }],
    ['/api/sales-crm/evaluations/EVAL-OTHER/retry', { method: 'POST', body: {} }],
    ['/api/recon/results/JOB-MISSING', {}],
    ['/api/report?job_id=JOB-MISSING', {}],
  ];
  for (const [route, options] of scopedRequests) {
    const response = await scoped.request(route, { cookie: scoped.cookie, ...options });
    assert.equal(response.status, 403, `scoped:${route}`);
  }

  const full = await fixtures.seededFixture({ permissions: { view_contacts: true } });
  t.after(() => full.close());
  const fullRequests = [
    ['/api/sales-crm/accounts/CRM-MISSING', { method: 'PATCH', body: { priority: 'A' } }],
    ['/api/sales-crm/evaluations/EVAL-MISSING/retry', { method: 'POST', body: {} }],
    ['/api/recon/results/JOB-MISSING', {}],
    ['/api/report?job_id=JOB-MISSING', {}],
  ];
  for (const [route, options] of fullRequests) {
    const response = await full.request(route, { cookie: full.cookie, ...options });
    assert.equal(response.status, 404, `full:${route}`);
  }
});

test('scoped manager monitor and contact state contain only owned customer rows', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false });
  t.after(() => fx.close());
  const monitor = await (await fx.request('/api/recon-monitor', { cookie: fx.cookie })).json();
  assert.deepEqual(monitor.jobs.map(row => row.job_id), ['JOB-OWN']);
  assert.equal(JSON.stringify(monitor).includes('JOB-OTHER'), false);
  assert.deepEqual(monitor.logTail, []);

  const contacts = await (await fx.request('/api/contact-recon/state', { cookie: fx.cookie })).json();
  assert.equal(JSON.stringify(contacts).includes('RU-9001'), false);
  assert.equal(JSON.stringify(contacts).includes('RU-9003'), false);
});

test('scoped manager cannot start or retry jobs for another owner', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false });
  t.after(() => fx.close());
  const actions = [
    { action: 'createReconJob', customerId: 'RU-9003', source: 'pool' },
    { action: 'createContactReconJob', customerId: 'RU-9003' },
    { action: 'retryReconJob', jobId: 'JOB-OTHER' },
    { action: 'setCustomerTags', customerId: 'RU-9003', tagIds: [] },
  ];
  for (const body of actions) {
    const response = await fx.request('/api/app', {
      cookie: fx.cookie, method: 'POST', body,
    });
    assert.equal(response.status, 403, body.action);
  }
});

test('denied high-risk writes are audited without target identifiers or payloads', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false });
  t.after(() => fx.close());
  const response = await fx.request('/api/app', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      action: 'updateCustomer',
      followId: 'FOLLOW-OTHER',
      payload: { status: '已报价', notes: 'sensitive payload' },
    },
  });
  assert.equal(response.status, 403);
  const audit = fx.db.prepare("SELECT * FROM crm_audit_log WHERE action='permission_denied' ORDER BY created_at DESC LIMIT 1").get();
  assert.ok(audit);
  assert.equal(audit.user_id, 'U-MGR');
  assert.equal(audit.entity_id, '');
  assert.equal(audit.detail_json.includes('FOLLOW-OTHER'), false);
  assert.equal(audit.detail_json.includes('sensitive payload'), false);
});

test('Sales bootstrap and research do not use view_development as a data permission', async t => {
  const fx = await fixtures.seededFixture({
    permissions: {
      view_development: true,
      view_customers: false,
      view_contacts: false,
      view_recon: false,
      view_intake: false,
    },
  });
  t.after(() => fx.close());
  const bootstrap = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  assert.equal(bootstrap.status, 200);
  const body = await bootstrap.json();
  assert.deepEqual(body.accounts, []);
  assert.deepEqual(body.intake.items, []);
  assert.equal(JSON.stringify(body).includes('INTAKE-OTHER'), false);
  assert.equal((await fx.request('/api/sales-crm/research/people', { cookie: fx.cookie })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/research/recon', { cookie: fx.cookie })).status, 403);
});

test('Sales account writes obey view_all_customers for managers', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts/CRM-OTHER', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { priority: 'A' },
  });
  assert.equal(response.status, 403);
  assert.equal(fx.db.prepare('SELECT priority FROM crm_accounts WHERE id=?').get('CRM-OTHER').priority, 'B');
});

test('manager without manage_intake cannot claim another user intake item', async t => {
  const fx = await fixtures.seededFixture({
    permissions: { view_intake: true, manage_intake: false },
  });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.cookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-OTHER' },
  });
  assert.equal(response.status, 403);
  assert.equal(fx.db.prepare('SELECT status FROM crm_intake_items WHERE id=?').get('INTAKE-OTHER').status, 'assigned');
});

test('non-sales users cannot use sales-only intake self actions', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: {
    view_intake: true, manage_intake: false,
  } });
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_intake_items SET assigned_owner_id='U-MGR' WHERE id='INTAKE-OTHER'").run();

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.cookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-OTHER' },
  });
  assert.equal(response.status, 403);
  assert.equal(fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='INTAKE-OTHER'").get().status, 'assigned');
});

test('intake assignment rejects owners who are not active sales users', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.cookie,
    method: 'POST',
    body: { action: 'reassign', itemId: 'INTAKE-OTHER', ownerId: 'U-WU' },
  });
  assert.equal(response.status, 400);
  assert.equal(fx.db.prepare("SELECT assigned_owner_id FROM crm_intake_items WHERE id='INTAKE-OTHER'").get().assigned_owner_id, 'U-OTHER');
});

test('explicit permissions are authoritative even when the account role is sales', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', {
    view_intake: true,
    manage_intake: true,
    view_contacts: true,
    edit_customer: true,
    manage_evaluations: true,
  });
  const cookie = await fx.login('other@example.com', 'Password123!');

  const scan = await fx.request('/api/sales-crm/intake/scan', {
    cookie, method: 'POST', body: { force: true },
  });
  assert.notEqual(scan.status, 403);

  const contact = await fx.request('/api/sales-crm/contacts', {
    cookie, method: 'POST', body: { customerId: 'CRM-OTHER', name: 'Authorized Contact' },
  });
  assert.notEqual(contact.status, 403);
});

test('sales-role create_customer honors an explicitly selected sales owner', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,
     languages_json,countries_json,channels_json,permission_group_id,created_at,updated_at)
    SELECT 'U-SALES2','sales2@example.com','Sales Two','sales',password_hash,password_salt,1,0,
      '[]','[]','[]','PGRP-SALES-DEFAULT',created_at,updated_at FROM sales_users WHERE id='U-OTHER'`).run();
  fx.setUserPermissions('U-OTHER', { create_customer: true });
  fx.db.prepare("INSERT INTO customer_pool(customer_id,company_name) VALUES ('RU-9010','Delegated Fixture')").run();
  const cookie = await fx.login('other@example.com', 'Password123!');

  const response = await fx.request('/api/sales-crm/accounts', {
    cookie,
    method: 'POST',
    body: { companyName: 'Delegated Fixture', externalCustomerId: 'RU-9010', ownerId: 'U-SALES2' },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(fx.db.prepare('SELECT owner_id FROM crm_accounts WHERE id=?').get(body.customerId).owner_id, 'U-SALES2');
});

test('manual CRM customer creation generates a canonical customer code', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true });
  const cookie = await fx.login('other@example.com', 'Password123!');

  const response = await fx.request('/api/sales-crm/accounts', {
    cookie,
    method: 'POST',
    body: { companyName: 'Automatic Code Fixture', country: '俄罗斯', ownerId: 'U-OTHER' },
  });
  const body = await response.json();

  assert.equal(response.status, 200, body.error);
  assert.match(body.externalCustomerId, /^RU-\d{4}$/);
  assert.deepEqual(
    fx.db.prepare('SELECT external_customer_id FROM crm_accounts WHERE id=?').get(body.customerId),
    { external_customer_id: body.externalCustomerId },
  );
  assert.equal(
    fx.db.prepare('SELECT company_name FROM customer_pool WHERE customer_id=?').get(body.externalCustomerId).company_name,
    'Automatic Code Fixture',
  );

  const secondResponse = await fx.request('/api/sales-crm/accounts', {
    cookie,
    method: 'POST',
    body: { companyName: 'Automatic UK Code Fixture', country: '英国', ownerId: 'U-OTHER' },
  });
  const secondBody = await secondResponse.json();
  assert.equal(secondResponse.status, 200, secondBody.error);
  assert.equal(body.externalCustomerId, 'RU-9004');
  assert.equal(secondBody.externalCustomerId, 'GB-9005');
});

test('sales-role edit_customer applies explicit owner and stage updates', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,
     languages_json,countries_json,channels_json,permission_group_id,created_at,updated_at)
    SELECT 'U-SALES2','sales2@example.com','Sales Two','sales',password_hash,password_salt,1,0,
      '[]','[]','[]','PGRP-SALES-DEFAULT',created_at,updated_at FROM sales_users WHERE id='U-OTHER'`).run();
  fx.setUserPermissions('U-OTHER', { edit_customer: true });
  const cookie = await fx.login('other@example.com', 'Password123!');

  const response = await fx.request('/api/sales-crm/accounts/CRM-OTHER', {
    cookie,
    method: 'PATCH',
    body: { ownerId: 'U-SALES2', stage: 'won' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    fx.db.prepare("SELECT owner_id,stage FROM crm_accounts WHERE id='CRM-OTHER'").get(),
    { owner_id: 'U-SALES2', stage: 'won' },
  );
});

test('Sales contact writes require both contact view and customer edit permissions', async t => {
  const fx = await fixtures.seededFixture({
    permissions: { view_contacts: false, edit_customer: true },
  });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/contacts', {
    cookie: fx.cookie,
    method: 'POST',
    body: { customerId: 'CRM-WU', name: 'Hidden Person' },
  });
  assert.equal(response.status, 403);
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM crm_account_contacts').get().n, 0);
});

test('Sales user management requires view_users as well as manage_users', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare('UPDATE sales_users SET role=?,permission_group_id=? WHERE id=?').run(
    'admin', 'PGRP-ADMIN-DEFAULT', 'U-WU',
  );
  fx.setUserPermissions('U-WU', { view_users: false, manage_users: true });
  const response = await fx.request('/api/sales-crm/users', {
    cookie: fx.cookie,
    method: 'POST',
    body: { email: 'blocked@example.com', password: 'Password123!', name: 'Blocked', role: 'sales' },
  });
  assert.equal(response.status, 403);
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM sales_users WHERE email=?').get('blocked@example.com').n, 0);
});

test('Sales user creation requires an explicit group and does not create personal overrides', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare('UPDATE sales_users SET role=?,permission_group_id=? WHERE id=?').run(
    'admin', 'PGRP-ADMIN-DEFAULT', 'U-WU',
  );
  const response = await fx.request('/api/sales-crm/users', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      email: 'created@example.com', password: 'Password123!', name: 'Created', role: 'sales',
      permissionGroupId: 'PGRP-SALES-DEFAULT',
    },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  const user = fx.db.prepare('SELECT permission_group_id,permissions_json FROM sales_users WHERE id=?').get(body.userId);
  assert.deepEqual(user, { permission_group_id: 'PGRP-SALES-DEFAULT', permissions_json: '{}' });
  assert.deepEqual(fx.db.prepare('SELECT permission_key,effect FROM user_permission_overrides WHERE user_id=?')
    .all(body.userId), []);
});

test('Sales user updates assign an explicit matching group before dedicated overrides', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare('UPDATE sales_users SET role=?,permission_group_id=? WHERE id=?').run(
    'admin', 'PGRP-ADMIN-DEFAULT', 'U-WU',
  );
  const response = await fx.request('/api/sales-crm/users/U-OTHER', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: {
      role: 'manager',
      permissionGroupId: 'PGRP-MANAGER-DEFAULT',
    },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  const overrides = await fx.request('/api/sales-crm/users/U-OTHER/permission-overrides', {
    cookie: fx.cookie,
    method: 'PUT',
    body: { view_all_customers: 'deny', use_ai_assistant: 'deny' },
  });
  assert.equal(overrides.status, 200);
  const user = fx.db.prepare('SELECT role,permission_group_id,permissions_json FROM sales_users WHERE id=?').get('U-OTHER');
  assert.deepEqual(user, { role: 'manager', permission_group_id: 'PGRP-MANAGER-DEFAULT', permissions_json: '{}' });
  assert.deepEqual(fx.db.prepare(`SELECT permission_key,effect FROM user_permission_overrides
    WHERE user_id=? ORDER BY permission_key`).all('U-OTHER'), [
    { permission_key: 'use_ai_assistant', effect: 'deny' },
    { permission_key: 'view_all_customers', effect: 'deny' },
  ]);
  const cookie = await fx.login('other@example.com', 'Password123!');
  const capabilities = await (await fx.request('/api/session/capabilities', { cookie })).json();
  assert.equal(capabilities.permissions.view_all_customers, false);
  assert.equal(capabilities.permissions.use_ai_assistant, false);
});

test('intake settings require view_intake as well as manage_intake', async t => {
  const fx = await fixtures.seededFixture({
    permissions: { view_intake: false, manage_intake: true },
  });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/intake/settings', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { enabled: false, approvalMode: 'manual' },
  });
  assert.equal(response.status, 403);
});

test('Sales UI clears forbidden state after a permission-changing 403', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  assert.match(source, /function clearForbiddenState/);
  assert.match(source, /error\.status\s*===\s*403/);
});

test('Sales UI uses explicit permissions instead of sales-role shortcuts', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  assert.doesNotMatch(source, /if \(state\.data\.user\.role === 'sales'\) return;/);
  assert.match(source, /function renderInsightsHub\(\) \{\s*if \(!can\('view_insights'\)\) return;/);
  assert.match(source, /function renderTeam\(\) \{\s*if \(!can\('view_team'\)\) return;/);
  assert.match(source, /function renderMarkets\(\) \{\s*if \(!can\('view_markets'\)\) return;/);
  assert.match(source, /item\.job_id && can\('view_recon'\) && can\('view_contacts'\)/);
});

test('Legacy UI revokes module data after a permission-changing 403', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
  assert.match(source, /function revokeModule/);
  assert.match(source, /function refreshCapabilitiesAfterForbidden/);
  assert.match(source, /r\.status===403/);
  assert.match(source, /localStorage\.removeItem\(assistantConversationKey\(\)\)/);
  assert.match(source, /async function loadData\(\).*await loadCapabilities\(\)/s);
});

test('Recon responses cannot bypass a disabled contact permission', async t => {
  const fx = await fixtures.seededFixture({ permissions: { view_recon: true, view_contacts: false } });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO recon_results
    (job_id,customer_id,company_name,email,phone,contacts_summary,result_json,
     opportunity_summary,outreach_angle,next_action,updated_at)
    VALUES ('JOB-WU','RU-9001','Wu Fixture','recon@secret.test','+7-recon','Secret Buyer',?,
      'Secret Buyer recon@secret.test','Call +7-recon','Ask Secret Buyer',?)`)
    .run(JSON.stringify({ contacts_summary: 'Secret Buyer', contactSignal: 'recon@secret.test' }), '2026-07-21 08:00:00');
  fx.db.prepare(`INSERT INTO recon_jobs(job_id,customer_id,company_name,status,requested_at,updated_at)
    VALUES ('JOB-WU','RU-9001','Wu Fixture','done',?,?)`).run('2026-07-21 08:00:00', '2026-07-21 08:00:00');
  fx.db.prepare("UPDATE recon_jobs SET error='recon@secret.test in worker output' WHERE job_id='JOB-WU'").run();
  fx.db.prepare(`INSERT INTO recon_evidence(job_id,customer_id,field_name,value,source_url)
    VALUES ('JOB-WU','RU-9001','contact_email','recon@secret.test','https://example.test')`).run();

  const result = await fx.request('/api/recon/results/JOB-WU', { cookie: fx.cookie });
  assert.equal(result.status, 200);
  const resultText = await result.text();
  for (const secret of ['recon@secret.test', '+7-recon', 'Secret Buyer', 'contact_email']) {
    assert.equal(resultText.includes(secret), false, secret);
  }
  const initialText = await (await fx.request('/api/initial', { cookie: fx.cookie })).text();
  for (const secret of ['recon@secret.test', '+7-recon', 'Secret Buyer', 'contact_email']) {
    assert.equal(initialText.includes(secret), false, `initial:${secret}`);
  }
  const monitorText = await (await fx.request('/api/recon-monitor', { cookie: fx.cookie })).text();
  for (const secret of ['recon@secret.test', '+7-recon', 'Secret Buyer']) {
    assert.equal(monitorText.includes(secret), false, secret);
  }
  assert.equal((await fx.request('/api/report?job_id=JOB-WU', { cookie: fx.cookie })).status, 403);
});

test('Pool and Sales research routes redact contacts when view_contacts is disabled', async t => {
  const fx = await fixtures.seededFixture({ permissions: {
    view_pool: true, view_recon: true, view_contacts: false,
  } });
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE customer_pool SET email='pool-secret@example.test',phone='+7-pool',notes='Ask Pool Buyer',
    source_file='source-file-contact-marker' WHERE customer_id='RU-9001'`).run();
  fx.db.prepare(`INSERT INTO recon_results
    (job_id,customer_id,company_name,email,phone,contacts_summary,opportunity_summary,outreach_angle,next_action,updated_at)
    VALUES ('JOB-RESEARCH','RU-9001','Wu Fixture','research-secret@example.test','+7-research','Research Buyer',
      'Research Buyer research-secret@example.test','Call +7-research','Ask Research Buyer',?)`)
    .run('2026-07-21 08:00:00');
  for (const route of ['/api/customers', '/api/sales-crm/research/pool', '/api/sales-crm/research/recon']) {
    const response = await fx.request(route, { cookie: fx.cookie });
    assert.equal(response.status, 200, route);
    const text = await response.text();
    assert.doesNotMatch(text, /pool-secret|research-secret|\+7-pool|\+7-research|Pool Buyer|Research Buyer|source-file-contact-marker/, route);
  }
});

test('Sales bootstrap cross-permissions hide contacts, alerts, and markets', async t => {
  const fx = await fixtures.seededFixture({ permissions: {
    view_dashboard: true, view_insights: true, view_contacts: false,
    view_alerts: false, view_markets: false,
  } });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_account_contacts
    (id,customer_id,name,title,phone,email,created_by,created_at,updated_at)
    VALUES ('LOCAL-SECRET','CRM-WU','Secret Buyer','Procurement','+7-local','local@secret.test','U-WU',?,?)`)
    .run('2026-07-21 08:00:00', '2026-07-21 08:00:00');
  fx.db.prepare(`UPDATE crm_intake_items SET
    contact_name='Bootstrap Intake Buyer',contact_title='Bootstrap Intake Title',
    contact_methods='bootstrap-intake@secret.test',evidence_urls='https://secret.test/intake-evidence',
    report_url='/secret-intake-report',decision_reason='Call Bootstrap Intake Buyer'
    WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`UPDATE customer_pool SET
    description='Bootstrap Pool Buyer bootstrap-pool@secret.test',
    deep_report='Bootstrap Deep Report +7-bootstrap-pool'
    WHERE customer_id='RU-9001'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET next_action='Call Bootstrap Account Buyer +7-bootstrap-account'
    WHERE id='CRM-WU'`).run();
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,occurred_at,created_at)
    VALUES ('ACT-BOOTSTRAP','CRM-WU','U-WU','note','email','Bootstrap Outcome Buyer',
      'bootstrap-activity@secret.test','Call +7-bootstrap-activity',?,?)`)
    .run('2026-07-21 08:00:00', '2026-07-21 08:00:00');
  fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,created_at)
    VALUES ('NOTE-BOOTSTRAP','U-WU','CRM-WU','TEST','info','Bootstrap notice',
      'Notify Bootstrap Buyer bootstrap-notify@secret.test','unread','bootstrap-contact-leak',?)`)
    .run('2026-07-21 08:00:00');
  const body = await (await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie })).json();
  assert.deepEqual(body.alerts, []);
  assert.deepEqual(body.countryReport, []);
  assert.deepEqual(body.cohortReport, []);
  assert.deepEqual(body.insights.contacts, []);
  assert.doesNotMatch(JSON.stringify(body.insights), /Secret Buyer|local@secret\.test|\+7-local/);
  assert.doesNotMatch(JSON.stringify(body), /Bootstrap (?:Intake|Pool|Deep|Account|Outcome)|bootstrap-(?:intake|pool|activity|notify)|\+7-bootstrap|secret-intake/);
});

test('scoped Sales bootstrap notifications stay within the account scope', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: { view_contacts: true } });
  t.after(() => fx.close());
  const now = '2026-07-21 08:00:00';
  const insert = fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,created_at)
    VALUES (?,?,?,?,? ,?,?,'unread',?,?)`);
  insert.run('NOTE-OWN','U-MGR','CRM-OWN','OWN','info','Owned notification','Owned detail','owned-notification',now);
  insert.run('NOTE-OTHER','U-OTHER','CRM-OTHER','OTHER','info','Other notification','Other detail','other-notification',now);
  insert.run('NOTE-STALE','U-MGR','CRM-OTHER','STALE','info','Stale notification','Stale detail','stale-notification',now);
  insert.run('NOTE-GLOBAL','U-MGR','','GLOBAL','info','Global notification','Global detail','global-notification',now);

  const body = await (await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie })).json();
  assert.deepEqual(body.notifications.map(row => row.id).sort(), ['NOTE-GLOBAL', 'NOTE-OWN']);
});

test('contact-restricted Sales bootstrap strips company evaluation narratives', async t => {
  const fx = await fixtures.seededFixture({ permissions: { view_insights: true, view_contacts: false } });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,subject_name,evaluation_text,author_id,author_name,
     ai_status,ai_summary,ai_labels_json,ai_order_keys_json,ai_risks_json,ai_strategy,ai_error,created_at,updated_at)
    VALUES ('EVAL-CONTACT-NARRATIVE','CRM-WU','company','Wu Fixture',?,'U-WU','Wu','done',?,?,?,?,?,?,?,?)`)
    .run(
      'evaluation-contact@secret.test',
      'summary-contact@secret.test',
      '["重点推进","labels-contact@secret.test"]',
      '["keys-contact@secret.test"]',
      '["risks-contact@secret.test"]',
      'strategy-contact@secret.test',
      'error-contact@secret.test',
      '2026-07-21 08:00:00',
      '2026-07-21 08:00:00',
    );

  const body = await (await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie })).json();
  assert.doesNotMatch(JSON.stringify(body.insights.evaluations), /(?:evaluation|summary|labels|keys|risks|strategy|error)-contact/);
  assert.deepEqual(body.customerEvaluationTags, [{ customerId: 'CRM-WU', labels: ['重点推进'] }]);
  assert.doesNotMatch(JSON.stringify(body.customerEvaluationTags), /secret\.test/);
});

test('scoped users can run isolated prospect tasks without global CRM access', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: {
    use_prospect_agent: true, view_contacts: false, view_pool: false, view_recon: false,
  } });
  t.after(() => fx.close());
  const response = await fx.request('/api/prospect-agent', {
    cookie: fx.cookie, method: 'POST', body: { action: 'createTask', query: 'Fixture' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.prospectState.tasks.length, 1);
  assert.deepEqual(body.prospectState.candidates, []);

  const otherCookie = await fx.login('other@example.com', 'Password123!');
  fx.setUserPermissions('U-OTHER', { use_prospect_agent: true });
  const crossUser = await fx.request('/api/prospect-agent', {
    cookie: otherCookie, method: 'POST', body: { action: 'rerunTask', taskId: body.task.taskId },
  });
  assert.equal(crossUser.status, 403);
});

test('contact-restricted initial data redacts stored prospect narratives and sources', async t => {
  const fx = await fixtures.seededFixture({ permissions: { use_prospect_agent: true, view_contacts: false } });
  t.after(() => fx.close());
  const now = '2026-07-21 08:00:00';
  fx.db.prepare(`INSERT INTO prospect_tasks
    (task_id,created_by,query,status,created_at,updated_at)
    VALUES ('TASK-REDACT-GET','U-WU','query-prospect@secret.test','done',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO prospect_candidates
    (candidate_id,task_id,company_name,description,products,need_signal,sell_signal,contact_signal,
     decision,source_summary,score,created_at,updated_at)
    VALUES ('CAND-REDACT-GET','TASK-REDACT-GET','Safe Prospect',?,?,?,?,?,?,?,70,?,?)`)
    .run(
      'description-prospect@secret.test', 'products-prospect@secret.test',
      'need-prospect@secret.test', 'sell-prospect@secret.test', 'contact-prospect@secret.test',
      'decision-prospect@secret.test', 'summary-prospect@secret.test', now, now,
    );
  fx.db.prepare(`INSERT INTO prospect_sources
    (candidate_id,task_id,source_type,title,url,snippet,confidence,fetched_at)
    VALUES ('CAND-REDACT-GET','TASK-REDACT-GET','web_search',?,?,?,'medium',?)`)
    .run('title-prospect@secret.test', 'https://secret.test/contact', 'snippet-prospect@secret.test', now);

  const response = await fx.request('/api/initial', { cookie: fx.cookie });
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /(?:query|description|products|need|sell|contact|decision|summary|title|snippet)-prospect|secret\.test\/contact/);
});

test('contact-restricted prospect mutation responses redact stored narratives and sources', async t => {
  const fx = await fixtures.seededFixture({ permissions: {
    use_prospect_agent: true, edit_customer: true, view_contacts: false,
  } });
  t.after(() => fx.close());
  const now = '2026-07-21 08:00:00';
  fx.db.prepare(`INSERT INTO prospect_tasks
    (task_id,created_by,query,status,created_at,updated_at)
    VALUES ('TASK-REDACT-POST','U-WU','query-post@secret.test','done',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO prospect_candidates
    (candidate_id,task_id,company_name,domain,website,description,need_signal,contact_signal,
     decision,source_summary,score,created_at,updated_at)
    VALUES ('CAND-REDACT-POST','TASK-REDACT-POST','Safe New Prospect','new-prospect.test',
      'https://new-prospect.test',?,?,?,?,?,75,?,?)`)
    .run(
      'description-post@secret.test', 'need-post@secret.test', 'contact-post@secret.test',
      'decision-post@secret.test', 'summary-post@secret.test', now, now,
    );
  fx.db.prepare(`INSERT INTO prospect_sources
    (candidate_id,task_id,source_type,title,url,snippet,confidence,fetched_at)
    VALUES ('CAND-REDACT-POST','TASK-REDACT-POST','web_search',?,?,?,'medium',?)`)
    .run('title-post@secret.test', 'https://secret.test/post-contact', 'snippet-post@secret.test', now);

  const response = await fx.request('/api/prospect-agent', {
    cookie: fx.cookie,
    method: 'POST',
    body: { action: 'promoteCandidate', candidateId: 'CAND-REDACT-POST', createRecon: false },
  });
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /(?:query|description|need|contact|decision|summary|title|snippet)-post|secret\.test\/post-contact/);
});

test('scoped users cannot promote prospects onto another owner customer', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: {
    use_prospect_agent: true, edit_customer: true, run_recon: true, view_recon: true,
  } });
  t.after(() => fx.close());
  const now = '2026-07-21 08:00:00';
  fx.db.prepare("UPDATE customer_pool SET domain='other-owner.test',website='https://other-owner.test' WHERE customer_id='RU-9003'").run();
  fx.db.prepare(`INSERT INTO prospect_tasks
    (task_id,created_by,query,status,created_at,updated_at)
    VALUES ('TASK-SCOPE','U-MGR','scope test','done',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO prospect_candidates
    (candidate_id,task_id,existing_customer_id,company_name,created_at,updated_at)
    VALUES ('CAND-ID','TASK-SCOPE','RU-9003','Other Fixture',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO prospect_candidates
    (candidate_id,task_id,company_name,domain,website,created_at,updated_at)
    VALUES ('CAND-DOMAIN','TASK-SCOPE','Other Domain','other-owner.test','https://other-owner.test',?,?)`).run(now, now);
  const beforeRecon = fx.db.prepare("SELECT COUNT(*) count FROM recon_jobs WHERE customer_id='RU-9003'").get().count;

  for (const [candidateId, createRecon] of [['CAND-ID', false], ['CAND-DOMAIN', true]]) {
    const response = await fx.request('/api/prospect-agent', {
      cookie: fx.cookie,
      method: 'POST',
      body: { action: 'promoteCandidate', candidateId, createRecon },
    });
    assert.equal(response.status, 403, candidateId);
  }

  const candidates = fx.db.prepare(`SELECT candidate_id,status,promoted_customer_id
    FROM prospect_candidates WHERE task_id='TASK-SCOPE' ORDER BY candidate_id`).all();
  assert.deepEqual(candidates, [
    { candidate_id: 'CAND-DOMAIN', status: 'candidate', promoted_customer_id: '' },
    { candidate_id: 'CAND-ID', status: 'candidate', promoted_customer_id: '' },
  ]);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM recon_jobs WHERE customer_id='RU-9003'").get().count, beforeRecon);
});

test('denied Sales writes are audited without target identifiers or payloads', async t => {
  const fx = await fixtures.seededFixture({ permissions: { edit_customer: false } });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.cookie, method: 'PATCH', body: { notes: 'sensitive sales payload' },
  });
  assert.equal(response.status, 403);
  const audit = fx.db.prepare("SELECT * FROM crm_audit_log WHERE action='permission_denied' ORDER BY created_at DESC LIMIT 1").get();
  assert.ok(audit);
  assert.equal(audit.entity_id, '');
  assert.doesNotMatch(audit.detail_json, /CRM-WU|sensitive sales payload/);
});

test('unknown Sales CRM routes are default-denied', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  assert.equal((await fx.request('/api/sales-crm/unmapped', { cookie: fx.cookie })).status, 403);
});
