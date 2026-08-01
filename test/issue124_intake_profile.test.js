const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { seededFixture } = require('./helpers/permission_fixture');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');

test('every intake row exposes a master profile entry independent of CRM and report state', () => {
  const renderIntake = appSource.match(/function renderIntake\(\)[\s\S]*?\n  function customerProfileFrameUrl/)?.[0] || '';
  const intakeProfile = appSource.match(/function openIntakeProfile\(itemId\)[\s\S]*?\n  function closeDrawer/)?.[0] || '';

  assert.match(renderIntake, /row\._attrs = `data-intake-profile="\$\{esc\(item\.id\)\}"`/);
  assert.match(intakeProfile, /data-open-intake-master="\$\{esc\(item\.id\)\}"/);
  assert.match(intakeProfile, /查看完整资料/);
  assert.match(intakeProfile, /item\.report_url[\s\S]*?查看背调报告/);
});

test('visible unclaimed intake master is readable but CRM operations remain unavailable', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());
  const now = '2026-07-28 10:00:00';
  fx.db.prepare(`INSERT INTO customer_pool
    (customer_id,company_name,country,website,industry,customer_type,description,products,
     email,phone,sales_ready_contact_count,contact_last_checked_at)
    VALUES ('BR-9010','Read Only Master','俄罗斯','https://readonly.example','工业控制','制造商',
      'Master description','MCU','hidden@readonly.example','+7-hidden',7,'2026-07-28 09:00:00')`).run();
  fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,created_at,updated_at)
    VALUES ('CRM-READONLY','BR-9010','Read Only Master','U-WU','qualified','claimed',?,?)`)
    .run(now, now);
  // Account-first insertion simulates historical dirty data without firing the forward sync trigger.
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,report_url,created_at,updated_at)
    VALUES ('INTAKE-MASTER','BATCH-TEST','BR-9010','Read Only Master','assigned','U-OTHER','/reports/read-only',?,?)`)
    .run(now, now);
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,evaluation_text,author_id,author_name,ai_status,ai_labels_json,created_at,updated_at)
    VALUES ('E-READONLY','CRM-READONLY','company','CRM-only evaluation','U-WU','Wu','completed',
      '["CRM_SECRET_LABEL"]',?,?)`).run(now, now);
  fx.setUserPermissions('U-OTHER', {
    view_intake: true,
    view_customers: false,
    view_contacts: false,
    edit_customer: true,
  });
  const cookie = await fx.login('other@example.com', 'Password123!');

  const page = await fx.request('/development-workbench?profile=1&intake=INTAKE-MASTER&customer=BR-9010', { cookie });
  assert.equal(page.status, 200);
  assert.equal((await fx.request('/development-workbench?profile=1&customer=BR-9010', { cookie })).status, 403);

  const response = await fx.request('/api/sales-crm/intake/INTAKE-MASTER/profile', { cookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.profileAccess.readOnly, true);
  assert.equal(body.profileAccess.source, 'intake');
  assert.deepEqual(body.customerPool.map(row => row.customerId), ['BR-9010']);
  assert.deepEqual(body.customers, []);
  assert.equal(JSON.stringify(body).includes('RU-9001'), false);
  assert.equal(JSON.stringify(body).includes('person@secret.test'), false);
  assert.equal(JSON.stringify(body).includes('+7-secret'), false);
  assert.equal(JSON.stringify(body).includes('hidden@readonly.example'), false);
  assert.equal(JSON.stringify(body).includes('+7-hidden'), false);
  assert.equal(body.customerPool[0].salesReadyContactCount, undefined);
  assert.equal(body.customerPool[0].contactLastCheckedAt, undefined);
  assert.equal(JSON.stringify(body).includes('CRM_SECRET_LABEL'), false);
  assert.equal(body.tagCategories.includes('AI评价标签'), false);
});

test('intake master endpoint enforces item ownership and view_intake', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name)
    VALUES ('BR-9011','Other Owner Master')`).run();
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-FOREIGN','BATCH-TEST','BR-9011','Other Owner Master','assigned','U-WU',?,?)`)
    .run('2026-07-28 10:00:00', '2026-07-28 10:00:00');

  const otherCookie = await fx.login('other@example.com', 'Password123!');
  assert.equal((await fx.request('/api/sales-crm/intake/INTAKE-FOREIGN/profile', { cookie: otherCookie })).status, 403);

  fx.setUserPermissions('U-OTHER', { view_intake: false });
  assert.equal((await fx.request('/api/sales-crm/intake/INTAKE-OTHER/profile', { cookie: otherCookie })).status, 403);
});

test('an accessible claimed CRM customer keeps the full profile contract', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,crm_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-CRM','BATCH-TEST','RU-9001','CRM-WU','Wu Fixture','claimed','U-WU',?,?)`)
    .run('2026-07-28 10:00:00', '2026-07-28 10:00:00');

  const response = await fx.request('/api/sales-crm/profile/RU-9001', { cookie: fx.cookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.notEqual(body.profileAccess?.readOnly, true);
});
