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

test('permission changes affect the existing session on the next request', async t => {
  assert.equal(typeof fixtures.seededFixture, 'function');
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const cookie = await fx.login('wu@example.com', 'Password123!');
  assert.equal((await fx.request('/development-workbench', { cookie })).status, 200);
  fx.db.prepare('UPDATE sales_users SET permissions_json=? WHERE email=?')
    .run('{"view_development":false}', 'wu@example.com');
  const response = await fx.request('/development-workbench', { cookie });
  assert.equal(response.status, 403);
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

test('explicit permissions are authoritative even when the account role is sales', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare('UPDATE sales_users SET permissions_json=? WHERE id=?').run(JSON.stringify({
    view_intake: true,
    manage_intake: true,
    view_contacts: true,
    edit_customer: true,
    manage_evaluations: true,
  }), 'U-OTHER');
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
  fx.db.prepare('UPDATE sales_users SET role=?,permissions_json=? WHERE id=?').run(
    'admin', '{"view_users":false,"manage_users":true}', 'U-WU',
  );
  const response = await fx.request('/api/sales-crm/users', {
    cookie: fx.cookie,
    method: 'POST',
    body: { email: 'blocked@example.com', password: 'Password123!', name: 'Blocked', role: 'sales' },
  });
  assert.equal(response.status, 403);
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM sales_users WHERE email=?').get('blocked@example.com').n, 0);
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

test('Legacy UI revokes module data after a permission-changing 403', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
  assert.match(source, /function revokeModule/);
  assert.match(source, /function refreshCapabilitiesAfterForbidden/);
  assert.match(source, /r\.status===403/);
  assert.match(source, /localStorage\.removeItem\(assistantConversationKey\(\)\)/);
});

test('Recon responses cannot bypass a disabled contact permission', async t => {
  const fx = await fixtures.seededFixture({ permissions: { view_recon: true, view_contacts: false } });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO recon_results
    (job_id,customer_id,company_name,email,phone,contacts_summary,result_json,updated_at)
    VALUES ('JOB-WU','RU-9001','Wu Fixture','recon@secret.test','+7-recon','Secret Buyer',?,?)`)
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
  const body = await (await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie })).json();
  assert.deepEqual(body.alerts, []);
  assert.deepEqual(body.countryReport, []);
  assert.deepEqual(body.cohortReport, []);
  assert.deepEqual(body.insights.contacts, []);
  assert.doesNotMatch(JSON.stringify(body.insights), /Secret Buyer|local@secret\.test|\+7-local/);
});

test('scoped users cannot use the global prospect-agent store', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: {
    use_prospect_agent: true, view_contacts: true,
  } });
  t.after(() => fx.close());
  const response = await fx.request('/api/prospect-agent', {
    cookie: fx.cookie, method: 'POST', body: { action: 'createTask', query: 'Fixture' },
  });
  assert.equal(response.status, 403);
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
