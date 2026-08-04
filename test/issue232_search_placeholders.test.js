'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');
const tradelead = fs.readFileSync(path.join(root, 'tradelead-v2.html'), 'utf8');

function searchPlaceholder(source, id) {
  return source.match(new RegExp(`id="${id}"[^>]*placeholder="([^"]+)"`))?.[1]
    || source.match(new RegExp(`placeholder="([^"]+)"[^>]*id="${id}"`))?.[1]
    || '';
}

test('Issue 232 backend schema places 客户昵称 first on every customer search field', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  for (const page of ['customers', 'intake', 'recycle_bin', 'pipeline', 'contacts', 'recon']) {
    const response = await fx.request(`/api/sales-crm/filter-schema/${page}`, {
      cookie: fx.adminCookie,
    });
    assert.equal(response.status, 200, `${page} schema`);
    const body = await response.json();
    const search = (body.schema?.fields || []).find(field => field.key === 'search');
    assert.ok(search, `${page} search field missing`);
    assert.match(search.placeholder, /^搜索客户昵称、/, `${page}: ${search.placeholder}`);
  }
});

test('Issue 232 static and dynamic customer search placeholders start with 客户昵称', () => {
  for (const id of ['intakeSearch', 'recycleSearch', 'insightSearch', 'protectedSearch']) {
    const placeholder = searchPlaceholder(html, id);
    assert.ok(placeholder, `missing placeholder for ${id}`);
    assert.equal(placeholder.startsWith('搜索客户昵称、'), true, `${id}: ${placeholder}`);
  }
  assert.doesNotMatch(`${html}\n${app}`, /placeholder="搜索企业、网站、行业"/);
  assert.match(app, /activityCustomerSearch[\s\S]*?placeholder="搜索客户昵称、/);
  assert.match(app, /data-duplicate-candidate-search[\s\S]*?placeholder="搜索客户昵称、/);
  const tradeleadPlaceholder = searchPlaceholder(tradelead, 'searchInput');
  assert.equal(tradeleadPlaceholder.startsWith('搜索客户昵称、'), true, tradeleadPlaceholder);
});

test('Issue 232 nickname search stays scoped for sales users', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE customer_pool SET nickname='北方重点客户' WHERE customer_id='RU-9002'").run();
  fx.db.prepare("UPDATE customer_pool SET nickname='越权隐藏昵称' WHERE customer_id='RU-9003'").run();

  const own = await fx.requestJson('/api/sales-crm/activity-customers?q=%E8%B6%8A%E6%9D%83%E9%9A%90%E8%97%8F%E6%98%B5%E7%A7%B0', {
    cookie: fx.otherCookie,
  });
  assert.deepEqual(own.customers.map(item => item.id), ['CRM-OTHER']);

  const outside = await fx.requestJson('/api/sales-crm/activity-customers?q=%E5%8C%97%E6%96%B9%E9%87%8D%E7%82%B9%E5%AE%A2%E6%88%B7', {
    cookie: fx.otherCookie,
  });
  assert.deepEqual(outside.customers, []);
});
