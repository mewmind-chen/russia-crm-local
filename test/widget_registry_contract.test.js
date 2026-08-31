'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const registryPath = path.join(root, 'sales-assets', 'widget-registry.js');
const factsWidgetPath = path.join(root, 'sales-assets', 'profile-facts-widget.js');
const drawerFactsPath = path.join(root, 'sales-assets', 'drawer-facts-widget.js');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const registry = require(registryPath);
const factsWidget = require(factsWidgetPath);
const drawerFactsWidget = require(drawerFactsPath);

function functionSource(name, nextName) {
  const start = Math.max(
    app.indexOf(`  function ${name}(`),
    app.indexOf(`  async function ${name}(`),
  );
  const end = Math.max(
    app.indexOf(`  async function ${nextName}(`, start + 1),
    app.indexOf(`  function ${nextName}(`, start + 1),
  );
  assert.notEqual(start, -1, `${name} must be declared`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return app.slice(start, end);
}

function makeContainer() {
  const children = [];
  return {
    children,
    appendChild(node) { children.push(node); },
    replaceChildren(...nodes) {
      children.length = 0;
      if (nodes.length) children.push(...nodes);
    },
    innerHTML: '',
  };
}

test('registry script and facts widget are loaded on the sales shell before app.js', () => {
  assert.match(html, /sales-assets\/widget-registry\.js/);
  assert.match(html, /sales-assets\/profile-facts-widget\.js/);
  const factsIndex = html.indexOf('profile-facts-widget.js');
  const registryIndex = html.indexOf('widget-registry.js');
  const appIndex = html.indexOf('sales-assets/app.js');
  assert.ok(factsIndex > -1 && appIndex > -1 && factsIndex < appIndex,
    'profile-facts-widget.js and widget-registry.js must be loaded before app.js');
  assert.ok(registryIndex > -1 && registryIndex > factsIndex,
    'widget-registry.js must load before app.js');
});

test('registry UMD exposes register/unregister/has/list/clear/widgetsForPage/renderPage', () => {
  assert.equal(typeof registry.register, 'function');
  assert.equal(typeof registry.unregister, 'function');
  assert.equal(typeof registry.has, 'function');
  assert.equal(typeof registry.list, 'function');
  assert.equal(typeof registry.clear, 'function');
  assert.equal(typeof registry.widgetsForPage, 'function');
  assert.equal(typeof registry.renderPage, 'function');
});

test('register validates id/pages/render and rejects incomplete specs', () => {
  assert.throws(() => registry.register({}), /widget\.id 必填/);
  assert.throws(() => registry.register({ id: 'x' }), /未声明 pages/);
  assert.throws(() => registry.register({ id: 'x', pages: ['p'] }), /未实现 render/);
});

test('widgetsForPage filters by page, applies order, and honors permission/feature/when gates', () => {
  registry.clear();
  registry.register({
    id: 'a', pages: ['page1'], order: 20,
    render() {},
  });
  registry.register({
    id: 'b', pages: ['page1'], order: 10,
    permission: 'view_b', feature: 'aiStations',
    render() {},
  });
  registry.register({
    id: 'c', pages: ['page2'], order: 1,
    render() {},
  });
  registry.register({
    id: 'd', pages: ['page1'], order: 15,
    when: ctx => Boolean(ctx.extra),
    render() {},
  });

  const eligible = registry.widgetsForPage('page1', {
    permissions: { view_b: true },
    features: { aiStations: true },
    extra: true,
  });
  assert.deepEqual(eligible.map(item => item.id), ['b', 'd', 'a']);

  // 权限门槛：缺 view_b 时 b 缺席
  const noPermission = registry.widgetsForPage('page1', {
    permissions: {}, features: { aiStations: true }, extra: true,
  });
  assert.deepEqual(noPermission.map(item => item.id), ['d', 'a']);

  // 开关门槛：aiStations 关闭时 b 缺席
  const featureOff = registry.widgetsForPage('page1', {
    permissions: { view_b: true }, features: { aiStations: false }, extra: true,
  });
  assert.deepEqual(featureOff.map(item => item.id), ['d', 'a']);

  // when 谓词：extra 缺失时 d 缺席
  const noExtra = registry.widgetsForPage('page1', {
    permissions: { view_b: true }, features: { aiStations: true },
  });
  assert.deepEqual(noExtra.map(item => item.id), ['b', 'a']);

  // 页面隔离：page2 只挂 c
  const page2 = registry.widgetsForPage('page2', {});
  assert.deepEqual(page2.map(item => item.id), ['c']);
});

test('renderPage mounts eligible widgets in order and isolates per-widget errors', async () => {
  registry.clear();
  const calls = [];
  registry.register({
    id: 'first', pages: ['page1'], order: 10,
    render(container) { calls.push('first'); container.appendChild('FIRST'); },
  });
  registry.register({
    id: 'boom', pages: ['page1'], order: 20,
    render() { throw new Error('boom'); },
  });
  registry.register({
    id: 'last', pages: ['page1'], order: 30,
    async render(container) {
      await Promise.resolve();
      calls.push('last');
      container.appendChild('LAST');
    },
  });

  const container = makeContainer();
  const result = await registry.renderPage('page1', container, {});
  assert.deepEqual(calls, ['first', 'last']);
  assert.deepEqual(container.children, ['FIRST', 'LAST']);
  assert.deepEqual(result, [
    { id: 'first' },
    { id: 'boom', error: 'boom' },
    { id: 'last' },
  ]);
});

test('renderPage with no container returns empty and unregister/clear work', async () => {
  registry.clear();
  registry.register({ id: 'w', pages: ['p'], render() {} });
  assert.equal(registry.has('w'), true);
  assert.equal((await registry.renderPage('p', null, {})).length, 0);

  registry.unregister('w');
  assert.equal(registry.has('w'), false);
  assert.equal(registry.widgetsForPage('p', {}).length, 0);

  registry.register({ id: 'w', pages: ['p'], render() {} });
  registry.clear();
  assert.equal(registry.list().length, 0);
});

test('app.js registers profile-facts and profile-contacts widgets for customerProfile', () => {
  const source = functionSource('profileWidgetContext', 'registerProfilePageWidgets')
    + functionSource('registerProfilePageWidgets', 'renderProfileFactsWidget')
    + functionSource('renderProfileFactsWidget', 'renderProfileContactsWidget')
    + functionSource('renderProfileContactsWidget', 'mountCustomerProfileWidgets')
    + functionSource('mountCustomerProfileWidgets', 'profileFactsData');

  assert.match(source, /id: 'profile-facts'/);
  assert.match(source, /pages: \['customerProfile'\]/);
  assert.match(source, /order: 10/);
  assert.match(source, /id: 'profile-contacts'/);
  assert.match(source, /order: 20/);

  // 权限/开关门槛：contacts 以 contactsWidget 存在为 when，facts 以 factsWidget+schema 存在为 when
  assert.match(source, /when: ctx => Boolean\(ctx\.contactsWidget\)/);
  assert.match(source, /when: ctx => Boolean\(ctx\.factsWidget && ctx\.fieldWidget && ctx\.profileSchema\?\.fields\?\.length\)/);

  // 装配委托注册表：renderPage 负责挂载，权限/开关从 ctx.permissions/ctx.features 注入
  assert.match(source, /registerProfilePageWidgets\(\)/);
  assert.match(source, /window\.TradePulseWidgetRegistry\.renderPage\(/);
  assert.match(source, /permissions: state\.data\?\.user\?\.permissions \|\| \{\}/);
  assert.match(source, /features: state\.data\?\.features \|\| \{\}/);

  // 布局顺序：facts 先于 contacts（order 10 < 20），facts 事件响应后整页重挂载
  assert.ok(source.indexOf('order: 10') < source.indexOf('order: 20'));
});

test('app.js profile-facts widget delegates rendering and event to the facts widget', () => {
  const source = functionSource('renderProfileFactsWidget', 'renderProfileContactsWidget');
  // 模板/状态/事件下沉到 profile-facts-widget，app.js 只注入 ctx
  assert.match(source, /ctx\.factsWidget\.render\(container/);
  assert.match(source, /getAccount: \(\) => state\.data\?\.accounts\?\.find/);
  assert.match(source, /fetchProfile: async \(\) =>/);
  assert.match(source, /api\/sales-crm\/profile/);
  assert.match(source, /fallbackPool: \(\) =>/);
  assert.match(source, /buildFactsData: \(account, poolRecord\) => profileFactsData\(account, poolRecord\)/);
  assert.match(source, /formatters: \(\) => profileFactsFormatters\(\)/);
  assert.match(source, /onSectionsChanged/);
  assert.match(source, /storageKey: ctx\.preferencesKey/);
  assert.doesNotMatch(source, /data-profile-section-toggle/);
  assert.doesNotMatch(source, /renderProfileFacts\(/);
});

test('app.js profile-contacts widget delegates contacts mounting to the contacts widget', () => {
  const source = functionSource('renderProfileContactsWidget', 'mountCustomerProfileWidgets');
  assert.match(source, /mountContacts\(/);
  assert.match(source, /customerId: ctx\.customerId/);
  assert.match(source, /intakeItemId: ctx\.intakeItemId/);
});

test('profile-facts widget owns preference state (load/save/toggle) with a storage shim', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  assert.deepEqual(factsWidget.defaultPreferences(), { hiddenSections: [] });
  assert.deepEqual(factsWidget.loadPreferences('k', storage), { hiddenSections: [] });
  const next = factsWidget.toggleSection('k', 'business_profile', storage);
  assert.deepEqual(next, { hiddenSections: ['business_profile'] });
  assert.deepEqual(factsWidget.loadPreferences('k', storage), { hiddenSections: ['business_profile'] });
  const back = factsWidget.toggleSection('k', 'business_profile', storage);
  assert.deepEqual(back, { hiddenSections: [] });
  assert.deepEqual(factsWidget.loadPreferences('k', storage), { hiddenSections: [] });
});

test('profile-facts widget renders facts html and preference bar honoring hidden sections', () => {
  const schema = {
    fields: [
      { key: 'customerId', label: '客户ID', section: 'identity_region', sourceKey: 'customerId', kind: 'text' },
      { key: 'companyName', label: '公司名称', section: 'identity_region', sourceKey: 'companyName', kind: 'text' },
      { key: 'email', label: '邮箱', section: 'contact_channels', sourceKey: 'email', kind: 'text' },
    ],
  };
  const bareFieldWidget = {
    renderProfileFacts: opts => {
      const hidden = new Set(opts.preferences?.hiddenSections || []);
      const visible = (opts.schema.fields || []).filter(f => !hidden.has(f.section || 'other'));
      return `<facts>${visible.map(f => f.label).join('|')}</facts>`;
    },
    profileSections: (schema, preferences) => (schema.fields || [])
      .reduce((acc, f) => {
        const section = f.section || 'other';
        if (preferences?.hiddenSections?.includes(section)) return acc;
        if (!acc.find(g => g.section === section)) acc.push({ section, label: section, fields: [] });
        acc.find(g => g.section === section).fields.push(f);
        return acc;
      }, []),
  };
  const preferences = { hiddenSections: ['contact_channels'] };
  const factsHtml = factsWidget.renderFactsHtml({
    fieldWidget: bareFieldWidget, schema, data: {}, preferences,
  });
  assert.equal(factsHtml, '<facts>客户ID|公司名称</facts>');

  const barHtml = factsWidget.renderPreferenceBarHtml({
    fieldWidget: bareFieldWidget, schema, preferences,
  });
  assert.match(barHtml, /identity_region/);
  assert.match(barHtml, /隐藏 identity_region/);
  assert.doesNotMatch(barHtml, /contact_channels/);
});

test('profile-facts widget render mounts facts + bar into a container and binds toggle re-render', async () => {
  const schema = {
    fields: [
      { key: 'name', label: '名称', section: 'identity_region', sourceKey: 'name', kind: 'text' },
    ],
  };
  const bareFieldWidget = {
    renderProfileFacts: opts => opts.preferences?.hiddenSections?.length ? '' : '<facts></facts>',
    profileSections: opts => opts.preferences?.hiddenSections?.length ? [] : [{ section: 'identity_region', label: '身份与地区', fields: [] }],
  };
  let remountCalls = 0;
  const container = makeContainer();
  // document/document.createElement 由 node 环境找不到：用最小 DOM 垫片
  const documentShim = {
    createElement() {
      return { className: '', innerHTML: '', children: [], addEventListener() {} };
    },
  };
  const originalDocument = globalThis.document;
  globalThis.document = documentShim;
  try {
    await factsWidget.render(container, {
      fieldWidget: bareFieldWidget,
      schema,
      storageKey: 'k',
      getAccount: () => null,
      fetchProfile: null,
      fallbackPool: () => null,
      buildFactsData: () => ({}),
      formatters: () => ({}),
      onSectionsChanged: () => { remountCalls += 1; },
    });
  } finally {
    if (originalDocument) globalThis.document = originalDocument; else delete globalThis.document;
  }
  assert.equal(remountCalls, 0);
  assert.ok(container.children.length >= 1);
});

test('drawer-facts widget is loaded on shell and exposes fact markup/render helpers', () => {
  assert.match(html, /sales-assets\/drawer-facts-widget\.js/);
  const drawerFactsIndex = html.indexOf('drawer-facts-widget.js');
  const uiFormatIndex = html.indexOf('ui-format.js');
  const registryIndex = html.indexOf('widget-registry.js');
  const appIndex = html.indexOf('sales-assets/app.js');
  assert.ok(uiFormatIndex > -1 && uiFormatIndex < drawerFactsIndex,
    'ui-format.js must load before drawer-facts-widget.js (website markup dependency)');
  assert.ok(drawerFactsIndex > -1 && drawerFactsIndex < appIndex && drawerFactsIndex < registryIndex,
    'drawer-facts-widget.js must load before widget-registry.js and app.js');
  assert.equal(typeof drawerFactsWidget.renderFactsHtml, 'function');
  assert.equal(typeof drawerFactsWidget.factMarkup, 'function');
  assert.equal(typeof drawerFactsWidget.websiteMarkup, 'function');
  assert.equal(typeof drawerFactsWidget.render, 'function');
});

test('drawer-facts widget renders schema facts when fieldWidget+schema present, else fallback rows', () => {
  const schema = { fields: [{
    key: 'companyName', label: '公司名称', sourceKey: 'company_name', kind: 'text',
  }] };
  const account = { company_name: 'ACME', website: 'smc.com', best_contact_level: 'A' };
  const fieldWidget = {
    renderFacts: opts => `<div class="fact"><span>${opts.schema.fields[0].label}</span><strong>${opts.data.company_name}</strong></div>`,
  };
  const htmlSchema = drawerFactsWidget.renderFactsHtml({
    fieldWidget, schema, data: account, formatters: {}, fallback: [],
  });
  assert.match(htmlSchema, /公司名称/);
  assert.match(htmlSchema, /ACME/);

  const htmlFallback = drawerFactsWidget.renderFactsHtml({
    fieldWidget: null, schema: null, data: {}, formatters: {},
    fallback: [['官网', 'smc.com', 'website'], ['负责人', null]],
  });
  assert.match(htmlFallback, /官网/);
  assert.match(htmlFallback, /href="https:\/\/smc\.com\/?"/);
  assert.match(htmlFallback, /负责人/);
  assert.doesNotMatch(htmlFallback, /公司名称/);
});

test('drawer-facts widget website markup blocks script/credential URLs', () => {
  assert.match(drawerFactsWidget.websiteMarkup('smc.com'), /href="https:\/\/smc\.com\/?"/);
  assert.match(drawerFactsWidget.websiteMarkup('javascript:alert(1)'), /暂无官网/);
  assert.match(drawerFactsWidget.websiteMarkup('https://x@evil.com/'), /暂无官网/);
  assert.match(drawerFactsWidget.factMarkup(['<b>', '<i>']), /&lt;b&gt;/);
});

test('app.js registers drawer-facts widget on crmDrawer page and delegates through registry', () => {
  const register = functionSource('registerProfilePageWidgets', 'renderProfileFactsWidget');
  assert.match(register, /id: 'drawer-facts'/);
  assert.match(register, /pages: \['crmDrawer'\]/);
  assert.match(register, /when: ctx => Boolean\(ctx\.drawerFactsWidget\)/);
  assert.match(register, /render: renderDrawerFactsWidget/);

  const ctxSource = functionSource('drawerFactsContext', 'renderDrawerFactsWidget');
  assert.match(ctxSource, /drawerFactsWidget/);
  assert.match(ctxSource, /showTechnicalSources/);
  assert.match(ctxSource, /\['官网', account\.website, 'website'\]/);

  const renderer = functionSource('renderDrawerFactsWidget', 'mountCustomerProfileWidgets');
  assert.match(renderer, /renderFactsHtml\(ctx\)/);
});