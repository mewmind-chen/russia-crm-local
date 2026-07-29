const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture, seededFixture } = require('./helpers/permission_fixture');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');

test('customer profile header separates CRM lifecycle from access scope', () => {
  assert.doesNotMatch(appSource, /未进入或无权访问 CRM/);
  assert.match(appSource, /尚未进入 CRM · 线索主档只读/);
  assert.match(appSource, /已进入 CRM · 当前范围只读/);
  assert.match(appSource, /lead\?\.profileAccess\?\.inCrm/);
  assert.match(appSource, /管理员主档全权限/);
  assert.match(appSource, /id="customerMasterForm"/);
  assert.match(appSource, /\/api\/sales-crm\/master\//);
});

test('intake profile reports not-in-CRM and outside-scope states explicitly', async t => {
  const fx = await seededFixture({ managerViewAll: true });
  t.after(() => fx.close());
  const now = '2026-07-29 11:00:00';

  fx.setUserPermissions('U-MGR', {
    view_intake: true,
    view_customers: true,
    view_all_customers: true,
    manage_intake: false,
  });
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name)
    VALUES ('BR-9012','Not In CRM'),('BR-9013','Unassigned CRM Account')`).run();
  fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,created_at,updated_at)
    VALUES ('CRM-UNASSIGNED','BR-9013','Unassigned CRM Account',NULL,'qualified','assigned',?,?)`)
    .run(now, now);
  const insertItem = fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  insertItem.run(
    'INTAKE-NOT-CRM', 'BATCH-TEST', 'BR-9012', 'Not In CRM', 'assigned', 'U-MGR', now, now,
  );
  insertItem.run(
    'INTAKE-OUTSIDE', 'BATCH-TEST', 'BR-9013', 'Unassigned CRM Account', 'assigned', 'U-MGR', now, now,
  );
  const cookie = await fx.login('manager@example.com', 'Password123!');

  let response = await fx.request('/api/sales-crm/intake/INTAKE-NOT-CRM/profile', { cookie });
  let body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.deepEqual(body.profileAccess, {
    readOnly: true,
    source: 'intake',
    intakeItemId: 'INTAKE-NOT-CRM',
    inCrm: false,
    crmAccessible: false,
    status: 'not_in_crm',
  });

  response = await fx.request('/api/sales-crm/intake/INTAKE-OUTSIDE/profile', { cookie });
  body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.deepEqual(body.profileAccess, {
    readOnly: true,
    source: 'intake',
    intakeItemId: 'INTAKE-OUTSIDE',
    inCrm: true,
    crmAccessible: false,
    status: 'outside_scope',
  });

  response = await fx.request('/api/sales-crm/intake?page=1&pageSize=100', { cookie });
  body = await response.json();
  assert.equal(response.status, 200, body.error);
  const inCrmById = Object.fromEntries(body.items.map(item => [item.id, Boolean(item.in_crm)]));
  assert.equal(inCrmById['INTAKE-NOT-CRM'], false);
  assert.equal(inCrmById['INTAKE-OUTSIDE'], true);
});

test('intake profile identifies CRM access when the linked account is in scope', async t => {
  const fx = await seededFixture({ managerViewAll: true });
  t.after(() => fx.close());
  const now = '2026-07-29 11:00:00';
  fx.setUserPermissions('U-MGR', {
    view_intake: true,
    view_customers: true,
    view_all_customers: true,
    manage_intake: false,
  });
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,crm_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-IN-SCOPE','BATCH-TEST','RU-9002','CRM-OWN','Owned Fixture','claimed','U-MGR',?,?)`)
    .run(now, now);
  const cookie = await fx.login('manager@example.com', 'Password123!');

  const response = await fx.request('/api/sales-crm/intake/INTAKE-IN-SCOPE/profile', { cookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.profileAccess.inCrm, true);
  assert.equal(body.profileAccess.crmAccessible, true);
  assert.equal(body.profileAccess.status, 'crm_accessible');
});

test('real administrators can edit a master before it enters CRM', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const now = '2026-07-29 11:00:00';
  fx.db.prepare(`INSERT INTO customer_pool
    (customer_id,company_name,country,customer_type,description,products)
    VALUES ('BR-9014','Admin Master','俄罗斯','制造商','Before','MCU')`).run();
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,created_at,updated_at)
    VALUES ('INTAKE-ADMIN','BATCH-TEST','BR-9014','Admin Master','approved',?,?)`)
    .run(now, now);

  let response = await fx.request('/api/sales-crm/intake/INTAKE-ADMIN/profile', {
    cookie: fx.adminCookie,
  });
  let body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.profileAccess.readOnly, false);
  assert.equal(body.profileAccess.source, 'master');
  assert.equal(body.profileAccess.status, 'admin_master');
  assert.equal(body.profileAccess.adminMasterAccess, true);
  assert.equal(body.customerPool[0].description, 'Before');

  response = await fx.request('/api/sales-crm/master/BR-9014', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: {
      companyName: 'Admin Master Updated',
      country: '巴西',
      customerType: '贸易公司',
      description: 'After',
      productFocus: '传感器',
    },
  });
  body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.changed, true);
  assert.deepEqual(
    fx.db.prepare(`SELECT company_name,country,customer_type,description,products
      FROM customer_pool WHERE customer_id='BR-9014'`).get(),
    {
      company_name: 'Admin Master Updated',
      country: '巴西',
      customer_type: '贸易公司',
      description: 'After',
      products: '传感器',
    },
  );
  assert.equal(
    fx.db.prepare(`SELECT COUNT(*) count FROM crm_accounts
      WHERE external_customer_id='BR-9014'`).get().count,
    0,
  );
  assert.equal(
    fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
      WHERE action='customer_master_updated' AND entity_id='BR-9014'`).get().count,
    1,
  );

  response = await fx.request('/api/sales-crm/master/BR-9014', {
    cookie: fx.otherCookie,
    method: 'PATCH',
    body: { country: '德国' },
  });
  assert.equal(response.status, 403);
});
