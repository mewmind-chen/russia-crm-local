const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');
const {
  CUSTOMER_TYPE_OPTIONS,
  CUSTOMER_SOURCE_OPTIONS,
} = require('../lib/taxonomy');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');

test('customer profile and stage-rating actions have separate permission-scoped entry points', () => {
  assert.doesNotMatch(`${html}\n${app}`, /调整客户信息/);
  assert.match(html, /id="customerProfileStageEdit"[\s\S]*?>调整阶段和评级</);
  assert.match(html, /id="customerProfileDataEdit"[\s\S]*?>编辑客户资料</);
  assert.match(app, /can\('edit_customer'\) \? '<button class="button secondary" data-edit-stage-rating>调整阶段和评级<\/button><button class="button secondary" data-edit-customer-profile>编辑客户资料<\/button>' : ''/);
  assert.match(app, /#customerProfileStageEdit'\)\.classList\.toggle\('hidden', readOnly \|\| !account \|\| !can\('edit_customer'\)\)/);
  assert.match(app, /#customerProfileDataEdit'\)\.classList\.toggle\('hidden', readOnly \|\| !can\('edit_customer'\)\)/);
});

test('stage and profile forms write disjoint responsibilities and refresh the embedded profile', () => {
  const stageForm = app.match(/openModal\('调整阶段和评级', 'STAGE & RATING', `([\s\S]*?)<\/form>`/)?.[1] || '';
  assert.match(stageForm, /id="stageRatingForm"/);
  for (const name of ['stage', 'ownerId', 'priority', 'potentialValue', 'nextAction', 'nextActionAt']) {
    assert.match(stageForm, new RegExp(`name="${name}"`), name);
  }
  for (const name of ['country', 'city', 'website', 'industry', 'customerType', 'source', 'productFocus']) {
    assert.doesNotMatch(stageForm, new RegExp(`name="${name}"`), name);
  }

  const profileForm = app.match(/openModal\('编辑客户资料', 'CUSTOMER PROFILE', `([\s\S]*?)<\/form>`/)?.[1] || '';
  assert.match(profileForm, /id="customerProfileForm"/);
  for (const name of ['country', 'city', 'website', 'industry', 'customerType', 'source', 'productFocus']) {
    assert.match(profileForm, new RegExp(`name="${name}"`), name);
  }
  for (const name of ['stage', 'ownerId', 'priority', 'potentialValue', 'nextAction', 'nextActionAt']) {
    assert.doesNotMatch(profileForm, new RegExp(`name="${name}"`), name);
  }
  assert.match(app, /form\.id === 'stageRatingForm'[\s\S]*?reloadCustomerProfileFrame\(\)/);
  assert.match(app, /form\.id === 'customerProfileForm'[\s\S]*?reloadCustomerProfileFrame\(\)/);
});

test('customer profile edits update CRM and master data using standard dropdown values', async t => {
  const fx = await fixtures.seededFixture({ permissions: { edit_customer: true } });
  t.after(() => fx.close());

  const response = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: {
      country: '巴西',
      city: '圣保罗',
      website: 'https://fixture.example',
      industry: '工业控制',
      customerType: CUSTOMER_TYPE_OPTIONS[0],
      source: CUSTOMER_SOURCE_OPTIONS[1],
      productFocus: 'MCU / 连接器',
    },
  });
  assert.equal(response.status, 200, await response.text());

  assert.deepEqual(
    fx.db.prepare(`SELECT country,city,website,industry,customer_type,source,product_focus
      FROM crm_accounts WHERE id='CRM-WU'`).get(),
    {
      country: '巴西',
      city: '圣保罗',
      website: 'https://fixture.example',
      industry: '工业控制',
      customer_type: CUSTOMER_TYPE_OPTIONS[0],
      source: CUSTOMER_SOURCE_OPTIONS[1],
      product_focus: 'MCU / 连接器',
    },
  );
  assert.deepEqual(
    fx.db.prepare(`SELECT country,city,website,industry,customer_type,products
      FROM customer_pool WHERE customer_id='RU-9001'`).get(),
    {
      country: '巴西',
      city: '圣保罗',
      website: 'https://fixture.example',
      industry: '工业控制',
      customer_type: CUSTOMER_TYPE_OPTIONS[0],
      products: 'MCU / 连接器',
    },
  );

  const bootstrap = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  assert.equal(bootstrap.status, 200);
  const payload = await bootstrap.json();
  const account = payload.accounts.find(item => item.id === 'CRM-WU');
  assert.equal(account.city, '圣保罗');
  assert.equal(account.customer_type, CUSTOMER_TYPE_OPTIONS[0]);
  assert.deepEqual(payload.customerOptions.customerTypes, CUSTOMER_TYPE_OPTIONS);
  assert.deepEqual(payload.customerOptions.sources, CUSTOMER_SOURCE_OPTIONS);
});

test('profile edit API still requires edit_customer and preserves the existing row scope', async t => {
  const fx = await fixtures.seededFixture({ permissions: { edit_customer: false } });
  t.after(() => fx.close());

  const own = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { city: 'Blocked City' },
  });
  assert.equal(own.status, 403);
  assert.equal(fx.db.prepare("SELECT city FROM crm_accounts WHERE id='CRM-WU'").get().city, '');

  fx.setUserPermissions('U-WU', { edit_customer: true, view_all_customers: false });
  const outsideScope = await fx.request('/api/sales-crm/accounts/CRM-OTHER', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { city: 'Out of Scope' },
  });
  assert.equal(outsideScope.status, 403);
  assert.equal(fx.db.prepare("SELECT city FROM crm_accounts WHERE id='CRM-OTHER'").get().city, '');
});
