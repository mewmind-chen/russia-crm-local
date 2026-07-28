'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');

function seedFilterOptions(fx) {
  const now = '2026-07-28 09:00:00';
  fx.db.prepare(`UPDATE crm_intake_items SET
    country='俄罗斯',industry='电子制造',customer_type='制造商'
    WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,country,industry,customer_type,
     status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-107-WU','BATCH-TEST','LEAD-107-WU','Wu Industrial','德国',
      '工业自动化','系统集成商','assigned','U-WU',?,?)`).run(now, now);
  const insertTag = fx.db.prepare(`INSERT INTO tags(name,category,color,is_preset,created_at)
    VALUES (?,?,'#2563eb',0,?)`);
  const otherTag = insertTag.run('重点客户','customer',now).lastInsertRowid;
  const wuTag = insertTag.run('展会线索','customer',now).lastInsertRowid;
  const addTag = fx.db.prepare(`INSERT INTO customer_tags(customer_id,tag_id,created_at)
    VALUES (?,?,?)`);
  addTag.run('BR-9004', otherTag, now);
  addTag.run('LEAD-107-WU', wuTag, now);
}

test('Issue #107 uses selects for categorical lead-pool filters', () => {
  for (const [id, emptyLabel] of [
    ['intakeCustomerTagFilter', '全部客户标签'],
    ['intakeCountryFilter', '全部国家 / 地区'],
    ['intakeIndustryFilter', '全部行业'],
    ['intakeCustomerTypeFilter', '全部客户类型'],
  ]) {
    assert.match(html, new RegExp(`<select id="${id}">[\\s\\S]*?${emptyLabel}[\\s\\S]*?</select>`));
    assert.doesNotMatch(html, new RegExp(`<input id="${id}"`));
  }
  assert.match(js, /populateIntakeFilterOptions\(result\.filterOptions\)/);
  assert.match(js, /customerTags: \{ id: 'intakeCustomerTagFilter'/);
  assert.match(html, /app\.js\?v=[^"]+/);
});

test('Issue #107 returns filter options within the current intake permission scope', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedFilterOptions(fx);

  const admin = await fx.requestJson('/api/sales-crm/intake?pageSize=50', {
    cookie: fx.adminCookie,
  });
  assert.deepEqual(admin.filterOptions.countries, ['俄罗斯', '德国']);
  assert.deepEqual(admin.filterOptions.industries, ['工业自动化', '电子制造']);
  assert.deepEqual(admin.filterOptions.customerTypes, ['制造商', '系统集成商']);
  assert.deepEqual(
    admin.filterOptions.customerTags.map(tag => tag.name),
    ['展会线索', '重点客户'],
  );

  const sales = await fx.requestJson('/api/sales-crm/intake?pageSize=50', {
    cookie: fx.otherCookie,
  });
  assert.deepEqual(sales.filterOptions.countries, ['俄罗斯']);
  assert.deepEqual(sales.filterOptions.industries, ['电子制造']);
  assert.deepEqual(sales.filterOptions.customerTypes, ['制造商']);
  assert.deepEqual(sales.filterOptions.customerTags.map(tag => tag.name), ['重点客户']);
});

test('Issue #107 keeps option discovery stable while applying the same-field filter', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedFilterOptions(fx);

  const filtered = await fx.requestJson(
    '/api/sales-crm/intake?country=%E5%BE%B7%E5%9B%BD&pageSize=50',
    { cookie: fx.adminCookie },
  );
  assert.equal(filtered.total, 1);
  assert.deepEqual(filtered.filterOptions.countries, ['俄罗斯', '德国']);
});
