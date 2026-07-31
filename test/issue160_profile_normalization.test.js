'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');
const workbench = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets/app.css'), 'utf8');

function functionSource(name, nextName) {
  const match = workbench.match(new RegExp(
    `function ${name}\\([^)]*\\)\\{([\\s\\S]*?)\\n\\s*(?:async\\s+)?function ${nextName}\\(`,
  ));
  assert.ok(match, `${name} source should be present`);
  return match[0];
}

test('CRM profile presentation removes research-pool and duplicate identity fields', () => {
  const poolTags = functionSource('renderPoolTags', 'readableProductText');
  const poolDetails = functionSource('renderPoolDetails', 'renderTagEditor');
  const drawer = app.match(/function renderDrawer\(\)[\s\S]*?\n  function openActivityModal/)?.[0] || '';

  assert.doesNotMatch(poolTags, /c\.customerId|c\.currentPool/);
  assert.doesNotMatch(poolDetails, /客户ID|当前池子/);
  assert.doesNotMatch(drawer, /\['客户分组',\s*account\.current_pool\]/);
  assert.doesNotMatch(drawer, /\['客户编号',\s*account\.external_customer_id\]/);
});

test('product focus and source records each have one clear profile section', () => {
  const hero = functionSource('renderDetailHero', 'renderDetails');
  const details = functionSource('renderPoolDetails', 'renderTagEditor');

  assert.doesNotMatch(hero, /readableProductText\(c\.products\)/);
  assert.equal((details.match(/renderProductFocus\(c\.products\)/g) || []).length, 1);
  assert.match(details, /renderDetailSection\('产品关注'/);
  assert.match(details, /renderDetailSection\('来源与记录'/);
  assert.match(details, /\['创建人',c\.creatorName\]/);
  assert.match(details, /\['客户来源',c\.customerSource\|\|c\.sourceFile\]/);
  assert.match(workbench, /暂无产品信息/);
});

test('profile shell has exactly one vertical scrolling owner', () => {
  assert.match(workbench, /body\.profile-mode #modalBackdrop \{ overflow: hidden; \}/);
  assert.match(workbench, /body\.profile-mode #modalBackdrop \.modal \{[\s\S]*?overflow-x: hidden; overflow-y: auto;/);
  assert.match(css, /body\.customer-profile-active\{height:100dvh;overflow:hidden\}/);
  assert.match(css, /body\.customer-profile-active \.app-shell\{height:100dvh;min-height:0;overflow:hidden\}/);
});

test('profile API exposes creator only with the existing sensitive-field permission', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  fx.db.prepare(`UPDATE crm_accounts SET created_by='USR-ADMIN',source='CRM手工新增',
    created_at='2026-07-31 08:00:00',updated_at='2026-07-31 09:00:00'
    WHERE id='CRM-OTHER'`).run();

  const adminResponse = await fx.request('/api/sales-crm/profile/RU-9003', {
    cookie: fx.adminCookie,
  });
  assert.equal(adminResponse.status, 200);
  const adminProfile = (await adminResponse.json()).customerPool[0];
  assert.equal(adminProfile.creatorName, '系统管理员');
  assert.equal(adminProfile.customerSource, 'CRM手工新增');
  assert.equal(adminProfile.recordCreatedAt, '2026-07-31 08:00:00');
  assert.equal(adminProfile.recordUpdatedAt, '2026-07-31 09:00:00');

  const salesResponse = await fx.request('/api/sales-crm/profile/RU-9003', {
    cookie: fx.otherCookie,
  });
  assert.equal(salesResponse.status, 200);
  const salesProfile = (await salesResponse.json()).customerPool[0];
  assert.equal(Object.hasOwn(salesProfile, 'creatorName'), false);
  assert.equal(salesProfile.customerSource, 'CRM手工新增');
});
