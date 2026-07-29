const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { seededFixture } = require('./helpers/permission_fixture');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');

test('customer profile header separates CRM lifecycle from access scope', () => {
  assert.doesNotMatch(appSource, /未进入或无权访问 CRM/);
  assert.match(appSource, /尚未进入 CRM · 线索主档只读/);
  assert.match(appSource, /已进入 CRM · 当前范围只读/);
  assert.match(appSource, /lead\?\.profileAccess\?\.inCrm/);
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
