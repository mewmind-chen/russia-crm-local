'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { seededFixture } = require('./helpers/permission_fixture');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const widgetSource = fs.readFileSync(path.join(root, 'sales-assets', 'profile-widgets.js'), 'utf8');
const legacyContacts = fs.readFileSync(path.join(root, 'profile-contacts.js'), 'utf8');
const legacyInsights = fs.readFileSync(path.join(root, 'profile-insights.js'), 'utf8');

function functionSource(name, nextName) {
  const start = app.indexOf(`  function ${name}(`);
  const end = Math.max(
    app.indexOf(`  async function ${nextName}(`, start + 1),
    app.indexOf(`  function ${nextName}(`, start + 1),
  );
  assert.notEqual(start, -1, `${name} must be declared`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return app.slice(start, end);
}

function asyncFunctionSource(name, nextName) {
  const start = app.indexOf(`  async function ${name}(`);
  const end = app.indexOf(`  function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} must be declared`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return app.slice(start, end);
}

test('profile page keeps the legacy iframe as the detail layer', () => {
  assert.match(html, /id="customerProfileFrame"/);
  assert.match(html, /class="customer-profile-frame"/);
});

test('profile widgets host renders before the iframe and mounts the contacts widget', () => {
  const view = html.match(/<section id="customerProfileView"[\s\S]*?<\/section>\s*<\/section>/)?.[0] || '';
  assert.match(view, /id="customerProfileWidgets"/);
  assert.match(view, /id="profileWidgetRoot"/);
  const frameIndex = view.indexOf('customerProfileFrame');
  const widgetIndex = view.indexOf('profileWidgetRoot');
  assert.ok(frameIndex > -1 && widgetIndex > -1 && widgetIndex < frameIndex,
    'widget host must precede the iframe');
});

test('profile widgets script is loaded on the sales shell', () => {
  assert.match(html, /profile-widgets\.js/);
});

test('widget mount is wired into both customer profile entry points', () => {
  const openCustomer = functionSource('openCustomerProfile', 'openIntakeMasterProfile');
  assert.match(openCustomer, /mountCustomerProfileWidgets\(externalCustomerId\)/);
  const openIntake = asyncFunctionSource('openIntakeMasterProfile', 'renderCustomerProfileHeader');
  assert.match(openIntake, /mountCustomerProfileWidgets\(externalCustomerId, state\.customerProfileIntakeItemId\)/);
});

test('default widget profile mode does not load the legacy iframe', () => {
  const openCustomer = functionSource('openCustomerProfile', 'openIntakeMasterProfile');
  assert.match(openCustomer, /if \(!isProfileWidgetsMode\(\)\)[\s\S]*frame\.src = customerProfileFrameUrl/);
  assert.doesNotMatch(openCustomer, /mountCustomerProfileWidgets\([^\n]+\);\s*const frame = \$\('#customerProfileFrame'\);\s*frame\.src/);

  const openIntake = asyncFunctionSource('openIntakeMasterProfile', 'renderCustomerProfileHeader');
  assert.match(openIntake, /if \(!isProfileWidgetsMode\(\)\)[\s\S]*frame\.src = customerProfileFrameUrl/);

  const reload = functionSource('reloadCustomerProfileFrame', 'openCustomerProfile');
  assert.match(reload, /isProfileWidgetsMode\(\)/);
  assert.match(reload, /return;/);
});

test('theme changes refresh the profile iframe only in explicit legacy mode', () => {
  assert.match(html, /profileView === 'legacy' && frame && frame\.getAttribute\('src'\)/);
});
test('widget reuses the same profile endpoint contract as the legacy slices', () => {
  // 新旧实现必须指向同一端点，保证数据契约一致
  assert.match(widgetSource, /\/api\/sales-crm\/profile\/\$\{encodeURIComponent\(customerId\)\}/);
  assert.match(widgetSource, /\/api\/sales-crm\/intake\/\$\{encodeURIComponent\(intakeItemId\)\}\/profile/);
  assert.match(legacyContacts, /\/api\/sales-crm\/profile\/\$\{encodeURIComponent\(customerId\)\}/);
  assert.match(legacyInsights, /\/api\/sales-crm\/intake\/\$\{encodeURIComponent\(intakeItemId\)\}\/profile/);
});

test('widget reads the same accountContacts and contactAccess fields', () => {
  assert.match(widgetSource, /profile\.accountContacts/);
  assert.match(widgetSource, /profile\.contactAccess/);
  assert.match(widgetSource, /canMaintain/);
  assert.match(legacyContacts, /profile\.accountContacts/);
  assert.match(legacyContacts, /profile\.contactAccess/);
});

test('widget writes contacts through the same contact endpoints', () => {
  assert.match(widgetSource, /\/api\/sales-crm\/contacts\//);
  assert.match(widgetSource, /method: contactId \? 'PATCH' : 'POST'/);
  assert.match(widgetSource, /\/archive/);
});

test('widget UMD exposes mountContacts and profileEndpoint', () => {
  const exports = require('../sales-assets/profile-widgets');
  assert.ok(exports.mountContacts);
  assert.ok(exports.loadProfile);
  assert.ok(exports.renderContacts);
  assert.equal(exports.profileEndpoint('EXT-1'), '/api/sales-crm/profile/EXT-1');
  assert.equal(
    exports.profileEndpoint('EXT-1', 'INT-9'),
    '/api/sales-crm/intake/INT-9/profile',
  );
});

test('renderContacts escapes contact values', () => {
  const { renderContacts } = require('../sales-assets/profile-widgets');
  const root = { innerHTML: '', className: '' };
  const payload = {
    accountContacts: [{
      id: 'CT-1', name: '<script>alert(1)</script>', title: '采购 & 总监',
      email: 'a@b.com', source: 'manual', sourceLabel: '人工录入',
    }],
    customerPool: [{ email: 'm@x.com', phone: '+7' }],
    contactAccess: { canView: true, canMaintain: true },
  };
  renderContacts({ root, profile: payload, customerId: 'EXT-1' });
  assert.doesNotMatch(root.innerHTML, /<script>/);
  assert.match(root.innerHTML, /&lt;script&gt;/);
  assert.match(root.innerHTML, /采购 &amp; 总监/);
  assert.match(root.innerHTML, /a@b\.com/);
});

test('profile widget renders live customer contacts from the profile endpoint', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());
  const cookie = await fx.login('wu@example.com', 'Password123!');
  const response = await fx.request('/api/sales-crm/profile/RU-9001', { cookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);

  const { renderContacts } = require('../sales-assets/profile-widgets');
  const root = { innerHTML: '', className: '' };
  renderContacts({ root, profile: body, customerId: 'RU-9001' });
  assert.match(root.innerHTML, /联系人资产/);
  const contacts = Array.isArray(body.accountContacts) ? body.accountContacts : [];
  if (contacts.length) {
    assert.match(root.innerHTML, /profile-widget-contact-card/);
    assert.match(root.innerHTML, /profile-widget-master-channels/);
  }
  // contactAccess 契约必须与 widget 渲染开关一致
  if (body.contactAccess?.canMaintain) {
    assert.match(root.innerHTML, /data-profile-widget-contact-add/);
  } else {
    assert.doesNotMatch(root.innerHTML, /data-profile-widget-contact-add/);
  }
});

test('mountContacts loads the live profile and renders into the host element', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());
  const cookie = await fx.login('wu@example.com', 'Password123!');
  const { mountContacts } = require('../sales-assets/profile-widgets');

  // 最小 DOM 桩：模拟 #profileWidgetRoot（事件监听器由真实 addEventListener 提供）
  const listeners = {};
  const root = {
    innerHTML: '',
    className: '',
    addEventListener(type, handler) { listeners[type] = handler; },
    querySelector() { return null; },
    replaceChildren() {},
  };
  const endpoint = `/api/sales-crm/profile/RU-9001`;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const request = await originalFetch(`http://127.0.0.1:${fx.baseUrl.split(':').pop()}${endpoint}`, {
      headers: { cookie },
    });
    return request;
  };
  try {
    mountContacts(root, { customerId: 'RU-9001' });
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.ok(root.innerHTML.includes('联系人资产') || root.innerHTML.includes('无权查看'),
      `widget must render profile result, got: ${root.innerHTML.slice(0, 120)}`);
    assert.ok(typeof listeners.click === 'function');
    assert.ok(typeof listeners.submit === 'function');
  } finally {
    global.fetch = originalFetch;
  }
});

test('profile widget respects hiddenSections preferences when rendering facts', () => {
  const { renderProfileFacts, profileSections, normalizeProfilePreferences } = require('../sales-assets/field-widget');
  const schema = {
    fields: [
      { key: 'customerId', label: '客户ID', section: 'identity_region', sourceKey: 'customerId', kind: 'text' },
      { key: 'companyName', label: '公司名称', section: 'identity_region', sourceKey: 'companyName', kind: 'text' },
      { key: 'email', label: '邮箱', section: 'contact_channels', sourceKey: 'email', kind: 'text' },
      { key: 'phone', label: '电话', section: 'contact_channels', sourceKey: 'phone', kind: 'text' },
      { key: 'deepReport', label: '深度报告', section: 'source_record', sourceKey: 'deepReport', kind: 'text' },
    ],
  };
  const preferences = normalizeProfilePreferences({ hiddenSections: ['contact_channels'] });
  const sections = profileSections(schema, preferences);
  assert.equal(sections.some(section => section.section === 'contact_channels'), false);
  assert.equal(sections.length, 2);
  const html = renderProfileFacts({ schema, data: { customerId: 'RU-9001', companyName: 'ACME', email: 'a@b.c', phone: '+7', deepReport: 'r1' }, preferences });
  assert.doesNotMatch(html, /邮箱/);
  assert.doesNotMatch(html, /a@b\.c/);
  assert.match(html, /客户ID/);
  assert.match(html, /深度报告/);
});
