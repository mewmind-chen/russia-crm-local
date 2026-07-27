'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const projectRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'sales-crm.html'), 'utf8');
const js = fs.readFileSync(path.join(projectRoot, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(projectRoot, 'sales-assets', 'app.css'), 'utf8');

function ids(payload) {
  return payload.customers.map(row => row.id).sort();
}

test('customer export applies multi-keyword, multi-select, quick-view and sorting semantics', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const now = '2026-07-27 10:00:00';

  fx.db.prepare(`UPDATE crm_accounts SET country='俄罗斯',city='莫斯科',website='https://wu.example',
    company_name='ООО ТЕСТ Wu Fixture',
    industry='工业控制',product_focus='MCU 模块',customer_type='原厂',source='展会',
    priority='A',potential_value=9000,last_activity_at='2026-07-26 10:00:00',
    next_action='确认采购周期',next_action_at='2026-07-27 18:00:00',created_by='USR-ADMIN',
    created_at='2026-07-20 08:00:00' WHERE id='CRM-WU'`).run();
  fx.db.prepare(`UPDATE customer_pool SET company_name='ООО ТЕСТ Wu Fixture' WHERE customer_id='RU-9001'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET country='德国',city='柏林',website='https://owned.example',
    industry='汽车电子',product_focus='传感器',customer_type='终端制造商',source='官网',
    priority='B',potential_value=12000,last_activity_at='2026-06-01 10:00:00',
    next_action='',next_action_at='',created_by='U-WU',created_at='2026-06-01 08:00:00'
    WHERE id='CRM-OWN'`).run();
  fx.db.prepare(`INSERT INTO crm_account_contacts
    (id,customer_id,name,title,phone,email,created_by,created_at,updated_at)
    VALUES ('P-FILTER','CRM-WU','Иван Петров','采购经理','+7 900','ivan@wu.example','USR-ADMIN',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,evaluation_text,author_id,author_name,ai_labels_json,created_at,updated_at)
    VALUES ('E-FILTER','CRM-WU','company','重点俄罗斯客户','USR-ADMIN','Admin','["高匹配"]',?,?)`).run(now, now);

  const combined = await fx.requestJson(
    '/api/sales-crm/export?search=wu%20俄罗斯&countries=俄罗斯,德国&owners=U-WU,U-MGR'
      + '&stages=qualified&priorities=A,B&customerTypes=原厂,终端制造商'
      + '&industries=工业控制,汽车电子&sources=展会,官网&creators=USR-ADMIN,U-WU'
      + '&evaluationTags=高匹配&sort=potential_desc',
    { cookie: fx.adminCookie },
  );
  assert.deepEqual(ids(combined), ['CRM-WU']);

  const unicodeCase = await fx.requestJson('/api/sales-crm/export?search=ооо%20тест', {
    cookie: fx.adminCookie,
  });
  assert.deepEqual(ids(unicodeCase), ['CRM-WU']);

  const noNext = await fx.requestJson('/api/sales-crm/export?quickView=no_next', {
    cookie: fx.adminCookie,
  });
  assert.equal(noNext.customers.some(row => row.id === 'CRM-OWN'), true);

  const reached = await fx.requestJson('/api/sales-crm/export?stageReached=contacted', {
    cookie: fx.adminCookie,
  });
  assert.equal(reached.customers.every(row =>
    !['new', 'qualified', 'lost', 'disqualified'].includes(row.stage)), true);

  const csvResponse = await fx.request('/api/sales-crm/export?format=csv&countries=俄罗斯&owners=U-WU', {
    cookie: fx.adminCookie,
  });
  const csv = await csvResponse.text();
  const json = await fx.requestJson('/api/sales-crm/export?countries=俄罗斯&owners=U-WU', {
    cookie: fx.adminCookie,
  });
  assert.deepEqual(ids(json), ['CRM-WU']);
  assert.match(csv, /Wu Fixture/);
  assert.doesNotMatch(csv, /Owned Fixture/);
});

test('contact keyword matching follows contact permission and customer scope', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const now = '2026-07-27 10:00:00';
  fx.db.prepare(`INSERT INTO crm_account_contacts
    (id,customer_id,name,title,phone,email,created_by,created_at,updated_at)
    VALUES ('P-SECRET-FILTER','CRM-WU','Секретный Покупатель','采购经理','+7 777',
      'buyer-filter@example.test','USR-ADMIN',?,?)`).run(now, now);

  fx.setUserPermissions('U-WU', {
    export_data: true,
    view_customers: true,
    view_all_customers: true,
    manage_intake: true,
    view_contacts: false,
  });
  const cookie = await fx.login('wu@example.com', 'Password123!');
  const hidden = await fx.requestJson('/api/sales-crm/export?search=buyer-filter@example.test', { cookie });
  assert.deepEqual(hidden.customers, []);

  fx.setUserPermissions('U-WU', { view_contacts: true });
  const visible = await fx.requestJson('/api/sales-crm/export?search=buyer-filter@example.test', { cookie });
  assert.deepEqual(ids(visible), ['CRM-WU']);

  fx.setUserPermissions('U-WU', { view_all_customers: false });
  const scoped = await fx.requestJson('/api/sales-crm/export?search=Owned%20Fixture', { cookie });
  assert.deepEqual(scoped.customers, []);
});

test('single-file customer UI exposes the three filter layers and account-scoped persistence', () => {
  for (const contract of [
    'customerSearchClear',
    'customerQuickViews',
    'customerFilterToggle',
    'customerSort',
    'customerActiveFilters',
    'customerFilterPanel',
    'customerFilterReset',
    'customerFilterApply',
  ]) {
    assert.match(html, new RegExp(`id="${contract}"`), contract);
  }
  assert.match(html, /搜索公司、客户编号、国家、行业、产品、网站或评价标签/);
  assert.match(js, /tradepulse\.customerFilters\./);
  assert.match(js, /customerSearchTimer/);
  assert.match(js, /250/);
  assert.match(js, /split\(\/\\s\+\/\)/);
  assert.match(js, /selectedCustomerIds = new Set\(\[\.\.\.state\.selectedCustomerIds\]\.filter/);
  assert.match(css, /\.customer-quick-views/);
  assert.match(css, /\.customer-filter-panel/);
  assert.match(css, /@media\(max-width:780px\).*customer-filter-panel/s);
});
