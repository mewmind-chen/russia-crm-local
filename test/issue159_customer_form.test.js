'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

test('established year is stored independently and unassigned creation stays in active CRM', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const created = await fx.requestJson('/api/sales-crm/accounts', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      companyName: 'Year Fixture',
      country: '巴西',
      establishedYear: '2008',
      ownerId: '__unassigned__',
      potentialValue: 7123,
    },
  });
  const account = fx.db.prepare(`SELECT owner_id,assignment_status,established_year,potential_value,lifecycle_status
    FROM crm_accounts WHERE id=?`).get(created.customerId);
  const master = fx.db.prepare('SELECT established_year FROM customer_pool WHERE customer_id=?')
    .get(created.externalCustomerId);
  assert.deepEqual(account, {
    owner_id: null,
    assignment_status: 'unassigned',
    established_year: 2008,
    potential_value: 7123,
    lifecycle_status: 'active',
  });
  assert.equal(master.established_year, 2008);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM sales_users WHERE name='暂不分配'").get().count, 0);
});

test('established year rejects non-four-digit and future values', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  for (const establishedYear of ['999', 'abcd', String(new Date().getFullYear() + 1)]) {
    const response = await fx.request('/api/sales-crm/accounts', {
      cookie: fx.adminCookie,
      method: 'POST',
      body: { companyName: `Invalid ${establishedYear}`, establishedYear, ownerId: '__unassigned__' },
    });
    assert.equal(response.status, 400);
  }
});

test('sales users cannot leave customers unassigned', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true, view_customers: true });

  const created = await fx.requestJson('/api/sales-crm/accounts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { companyName: 'Sales Owned Year', establishedYear: 2019, ownerId: '__unassigned__' },
  });
  const account = fx.db.prepare('SELECT owner_id,assignment_status FROM crm_accounts WHERE id=?')
    .get(created.customerId);
  assert.equal(account.owner_id, 'U-OTHER');
  assert.equal(account.assignment_status, 'claimed');
});

test('moving an existing customer to CRM unassigned requires confirmation and audited reason', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const rejected = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { ownerId: '__unassigned__' },
  });
  assert.equal(rejected.status, 400);

  const updated = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: {
      ownerId: '__unassigned__',
      unassignConfirmed: true,
      unassignReason: '等待管理员重新分配',
      establishedYear: 1998,
    },
  });
  assert.equal(updated.status, 200);
  const account = fx.db.prepare(`SELECT owner_id,assignment_status,established_year,lifecycle_status
    FROM crm_accounts WHERE id='CRM-OWN'`).get();
  assert.deepEqual(account, {
    owner_id: null,
    assignment_status: 'unassigned',
    established_year: 1998,
    lifecycle_status: 'active',
  });
  const audit = fx.db.prepare(`SELECT detail_json FROM crm_audit_log
    WHERE entity_id='CRM-OWN' AND action='customer_unassigned' ORDER BY created_at DESC LIMIT 1`).get();
  assert.deepEqual(JSON.parse(audit.detail_json), {
    previousOwnerId: 'U-MGR',
    reason: '等待管理员重新分配',
  });
});

test('established year is available in authorized filtering, JSON/CSV export and profile data', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET established_year=2003,potential_value=4567 WHERE id='CRM-OWN'").run();
  fx.db.prepare("UPDATE customer_pool SET established_year=2003 WHERE customer_id='RU-9002'").run();

  const schema = await fx.requestJson('/api/sales-crm/filter-schema/customers', { cookie: fx.adminCookie });
  assert.equal(schema.schema.fields.some(item => item.key === 'established_year'), true);
  const filters = encodeURIComponent(JSON.stringify({
    established_year: { operator: 'in', values: ['2003'] },
  }));
  const exported = await fx.requestJson(`/api/sales-crm/export?filters=${filters}`, { cookie: fx.adminCookie });
  assert.deepEqual(exported.customers.map(item => item.id), ['CRM-OWN']);
  assert.equal(exported.customers[0].established_year, 2003);
  assert.equal(exported.customers[0].potential_value, 4567);

  const csv = await (await fx.request(`/api/sales-crm/export?format=csv&filters=${filters}`, {
    cookie: fx.adminCookie,
  })).text();
  assert.match(csv, /成立年份/);
  assert.match(csv, /2003/);

  const profile = await fx.requestJson('/api/sales-crm/profile/RU-9002', { cookie: fx.adminCookie });
  assert.equal(profile.customerPool[0].establishedYear, 2003);
});

test('new customer UI uses explicit grouped unassigned operation and compact year field', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');
  assert.match(js, /<optgroup label="操作"><option value="__unassigned__">暂不分配<\/option><\/optgroup>/);
  assert.match(js, /<optgroup label="销售人员">/);
  assert.match(js, /成立年份（选填）/);
  assert.match(js, /unassignConfirmed/);
  assert.match(js, /unassignReason/);
  assert.match(css, /\.customer-intake-modal/);
});
