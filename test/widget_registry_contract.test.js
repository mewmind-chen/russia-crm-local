'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const registryPath = path.join(root, 'sales-assets', 'widget-registry.js');
const sourceTagsPath = path.join(root, 'sales-assets', 'source-tags-widget.js');
const factsWidgetPath = path.join(root, 'sales-assets', 'profile-facts-widget.js');
const drawerFactsPath = path.join(root, 'sales-assets', 'drawer-facts-widget.js');
const drawerAiPath = path.join(root, 'sales-assets', 'drawer-ai-widget.js');
const masterProfilePath = path.join(root, 'sales-assets', 'master-profile-widget.js');
const insightSectionPath = path.join(root, 'sales-assets', 'insight-section-widget.js');
const nextStepPath = path.join(root, 'sales-assets', 'next-step-widget.js');
const timelinePath = path.join(root, 'sales-assets', 'timeline-widget.js');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const sourceTagsSource = fs.readFileSync(sourceTagsPath, 'utf8');
const registry = require(registryPath);
const sourceTagsWidget = require(sourceTagsPath);
const factsWidget = require(factsWidgetPath);
const drawerFactsWidget = require(drawerFactsPath);
const drawerAiWidget = require(drawerAiPath);
const masterProfileWidget = require(masterProfilePath);
const insightSectionWidget = require(insightSectionPath);
const nextStepWidget = require(nextStepPath);
const timelineWidget = require(timelinePath);

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

test('source tags, registry, and facts widgets are loaded on the sales shell before app.js', () => {
  assert.match(html, /sales-assets\/widget-registry\.js/);
  assert.match(html, /sales-assets\/source-tags-widget\.js/);
  assert.match(html, /sales-assets\/profile-facts-widget\.js/);
  const sourceTagsIndex = html.indexOf('source-tags-widget.js');
  const factsIndex = html.indexOf('profile-facts-widget.js');
  const registryIndex = html.indexOf('widget-registry.js');
  const appIndex = html.indexOf('sales-assets/app.js');
  assert.ok(sourceTagsIndex > -1 && appIndex > -1 && sourceTagsIndex < appIndex,
    'source-tags-widget.js must be loaded before app.js');
  assert.ok(factsIndex > -1 && appIndex > -1 && factsIndex < appIndex,
    'profile-facts-widget.js and widget-registry.js must be loaded before app.js');
  assert.ok(registryIndex > -1 && registryIndex > factsIndex && registryIndex < appIndex,
    'widget-registry.js must load after dependencies and before app.js');
  assert.ok(sourceTagsIndex < registryIndex,
    'source-tags-widget.js must load before widget-registry.js');
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

test('source tags UMD exposes the pure projection and markup contract', () => {
  for (const name of [
    'escapeHtml', 'normalizeTagText', 'uniqueSourceTags',
    'accountSourceTags', 'renderSourceTagRowHtml',
  ]) {
    assert.equal(typeof sourceTagsWidget[name], 'function', `${name} must be exported`);
  }
});

test('source tags UMD browser branch attaches the global API', () => {
  const browserGlobal = {};
  vm.runInNewContext(sourceTagsSource, browserGlobal);
  assert.equal(typeof browserGlobal.TradePulseSourceTagsWidget, 'object');
  assert.equal(typeof browserGlobal.TradePulseSourceTagsWidget.renderSourceTagRowHtml, 'function');
});

test('app delegates source tag markup and list chips to the source tags widget wrappers', () => {
  const markupStart = app.indexOf('  function sourceTagMarkup(');
  const markupEnd = app.indexOf('  function hostLabel(', markupStart);
  const markupSource = app.slice(markupStart, markupEnd);
  assert.match(markupSource, /renderSourceTagRowHtml/);
  assert.doesNotMatch(markupSource, /source-tag-row/);

  const chipsStart = app.indexOf('  function listChipMarkup(');
  const chipsEnd = app.indexOf('  function rowActionCluster(', chipsStart);
  const chipsSource = app.slice(chipsStart, chipsEnd);
  assert.match(chipsSource, /accountSourceTags\(account\)/);
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
  assert.deepEqual(container.children.map(host => host.dataset.widgetId), ['first', 'boom', 'last']);
  assert.deepEqual(container.children.map(host => host.children), [['FIRST'], [], ['LAST']]);
  assert.deepEqual(result, [
    { id: 'first' },
    { id: 'boom', error: 'boom' },
    { id: 'last' },
  ]);
});

test('renderPage clears old hosts and keeps only widgets eligible for the current run', async () => {
  registry.clear();
  registry.register({
    id: 'gated', pages: ['page1'], order: 10,
    when: ctx => Boolean(ctx.enabled),
    render(container, ctx) {
      container.className = 'gated-widget';
      container.innerHTML = `gated:${ctx.run}`;
    },
  });
  registry.register({
    id: 'always', pages: ['page1'], order: 20,
    render(container, ctx) { container.innerHTML = `always:${ctx.run}`; },
  });

  const container = makeContainer();
  await registry.renderPage('page1', container, { enabled: true, run: 1 });
  const firstHosts = container.children.slice();
  assert.deepEqual(firstHosts.map(host => host.dataset.widgetId), ['gated', 'always']);
  assert.deepEqual(firstHosts.map(host => host.innerHTML), ['gated:1', 'always:1']);

  await registry.renderPage('page1', container, { enabled: false, run: 2 });
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].dataset.widgetId, 'always');
  assert.equal(container.children[0].innerHTML, 'always:2');
  assert.notEqual(container.children[0], firstHosts[1]);
});

test('renderPage isolates host creation failures and continues with later widgets', async () => {
  registry.clear();
  registry.register({ id: 'broken-host', pages: ['page1'], order: 10, render() {} });
  registry.register({
    id: 'healthy', pages: ['page1'], order: 20,
    render(container) { container.innerHTML = 'healthy'; },
  });
  const container = makeContainer();
  let creations = 0;
  container.ownerDocument = {
    createElement() {
      creations += 1;
      if (creations === 1) throw new Error('host failed');
      return {
        dataset: {},
        innerHTML: '',
        setAttribute(name, value) { if (name === 'data-widget-id') this.dataset.widgetId = value; },
      };
    },
  };

  const result = await registry.renderPage('page1', container, {});
  assert.deepEqual(result, [
    { id: 'broken-host', error: 'host failed' },
    { id: 'healthy' },
  ]);
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].dataset.widgetId, 'healthy');
  assert.equal(container.children[0].innerHTML, 'healthy');
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
  assert.match(source, /id: 'profile-master'/);
  assert.match(source, /order: 25/);
  assert.match(source, /id: 'profile-timeline'/);
  assert.match(source, /order: 27/);

  // 权限/开关门槛：contacts 以 contactsWidget 存在为 when，facts 以 factsWidget+schema 存在为 when
  assert.match(source, /when: ctx => Boolean\(ctx\.contactsWidget\)/);
  assert.match(source, /when: ctx => Boolean\(ctx\.factsWidget && ctx\.fieldWidget && ctx\.profileSchema\?\.fields\?\.length\)/);
  // profile-master 以 ctx.account 存在为 when（完整资料与 drawer 共用主档模板）
  assert.match(source, /when: ctx => Boolean\(ctx\.account\)/);
  assert.match(source, /render: renderProfileMasterWidget/);
  assert.match(source, /account,/);

  // AI 完整资料站登记为 widget：由现有 customerAIEnabled 开关决定挂载，委托既有 renderCustomerAI
  assert.match(source, /id: 'customer-ai-station'/);
  assert.match(source, /when: ctx => Boolean\(ctx\.customerAiEnabled\)/);
  assert.match(source, /render: renderCustomerAiStationWidget/);
  assert.match(source, /customerAiEnabled: customerAIEnabled\(\)/);

  // 装配委托注册表：renderPage 负责挂载，权限/开关从 ctx.permissions/ctx.features 注入
  assert.match(source, /registerProfilePageWidgets\(\)/);
  assert.match(source, /window\.TradePulseWidgetRegistry\.renderPage\(/);
  assert.match(source, /permissions: state\.data\?\.user\?\.permissions \|\| \{\}/);
  assert.match(source, /features: state\.data\?\.features \|\| \{\}/);

  // 布局顺序：facts 先于 contacts 先于 AI 站（order 10 < 20 < 30）
  assert.ok(source.indexOf('order: 10') < source.indexOf('order: 20'));
  assert.ok(source.indexOf('order: 20') < source.indexOf('order: 30'));
});

test('app.js customer-ai-station widget delegates to existing render gated by the switch', () => {
  const renderer = functionSource('renderCustomerAiStationWidget', 'renderCustomerAI');
  assert.match(renderer, /if \(!ctx\?\.customerAiEnabled\) return \[\]/);
  assert.match(renderer, /renderCustomerAI\(\)/);
  assert.match(renderer, /status: 'mounted'/);

  // 既有 renderCustomerAI 仍保持 AI 内部零改动：门槛与数据加载路径不因登记而变化
  const renderAI = functionSource('renderCustomerAI', 'scheduleCustomerAIPoll');
  assert.match(renderAI, /if \(!technicalAIPresentationAllowed\(\)\) return;/);
  assert.match(renderAI, /state\.customerAi\b/);
  const loadAI = functionSource('loadCustomerAI', 'retryCustomerEnrichment');
  assert.match(loadAI, /\/api\/sales-crm\/ai\/customers\//);
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

test('app.js drawerFactsFallbackHtml lets intake and recycle drawers share the drawer-facts widget', () => {
  const fallback = functionSource('drawerFactsFallbackHtml', 'drawerAiContext');
  assert.match(fallback, /TradePulseDrawerFactsWidget/);
  assert.match(fallback, /renderFactsHtml\(\{ fallback: rows \}\)/);
  assert.match(fallback, /rows\.map\(drawerFactMarkup\)/);

  const intake = functionSource('openIntakeProfile', 'closeDrawer');
  assert.match(intake, /drawerFactsFallbackHtml\(intakeFacts\)/);
  assert.match(intake, /'联系人等级', item\.contact_level/);
  assert.match(intake, /'成立年份', item\.established_year/);

  const recycle = functionSource('renderRecycleDrawer', 'correctionActivityId');
  assert.match(recycle, /drawerFactsFallbackHtml\(\[/);
  assert.match(recycle, /'原负责人', recycle\.previousOwnerName/);
  assert.match(recycle, /'回收原因', recycle\.reason/);
  assert.doesNotMatch(recycle, /\.map\(\(\[label, value\]\) => `<div class="fact">/);
});

test('drawer-ai widget is loaded on shell before app.js and exposes section markup helpers', () => {
  assert.match(html, /sales-assets\/drawer-ai-widget\.js/);
  const drawerAiIndex = html.indexOf('drawer-ai-widget.js');
  const registryIndex = html.indexOf('widget-registry.js');
  const appIndex = html.indexOf('sales-assets/app.js');
  assert.ok(drawerAiIndex > -1 && drawerAiIndex < appIndex && drawerAiIndex < registryIndex,
    'drawer-ai-widget.js must load before widget-registry.js and app.js');
  assert.equal(typeof drawerAiWidget.renderCustomerAiSectionHtml, 'function');
  assert.equal(typeof drawerAiWidget.render, 'function');
  assert.equal(typeof drawerAiWidget.escapeHtml, 'function');
});

test('drawer-ai widget renders AI Q&A section only when enabled + canUseAi, escaping company name', () => {
  const htmlEnabled = drawerAiWidget.renderCustomerAiSectionHtml({
    enabled: true, canUseAi: true, companyName: 'ACME',
  });
  assert.match(htmlEnabled, /class="customer-ai"/);
  assert.match(htmlEnabled, /id="drawerAiForm"/);
  assert.match(htmlEnabled, /ACME/);
  assert.match(htmlEnabled, /drawerAiAnswer|可以直接询问/);

  const htmlXss = drawerAiWidget.renderCustomerAiSectionHtml({
    enabled: true, canUseAi: true, companyName: '<b>ACME</b>',
  });
  assert.match(htmlXss, /&lt;b&gt;ACME&lt;\/b&gt;/);

  assert.equal(drawerAiWidget.renderCustomerAiSectionHtml({
    enabled: false, canUseAi: true, companyName: 'ACME',
  }), '');
  assert.equal(drawerAiWidget.renderCustomerAiSectionHtml({
    enabled: true, canUseAi: false, companyName: 'ACME',
  }), '');
  assert.equal(drawerAiWidget.renderCustomerAiSectionHtml({}), '');
});

test('app.js registers drawer-ai widget on crmDrawer page and customerAiSection delegates to it', () => {
  const register = functionSource('registerProfilePageWidgets', 'renderProfileFactsWidget');
  assert.match(register, /id: 'drawer-ai'/);
  assert.match(register, /pages: \['crmDrawer'\]/);
  assert.match(register, /when: ctx => Boolean\(ctx\.drawerAiWidget\)/);

  const ctxSource = functionSource('drawerAiContext', 'renderDrawerAiWidget');
  assert.match(ctxSource, /drawerAiWidget/);
  assert.match(ctxSource, /enabled: technicalAIPresentationAllowed\(\) && can\('use_ai_assistant'\)/);

  const renderer = functionSource('renderDrawerAiWidget', 'mountCustomerProfileWidgets');
  assert.match(renderer, /renderCustomerAiSectionHtml\(ctx\)/);

  const section = functionSource('customerAiSection', 'openIntakeProfile');
  assert.match(section, /drawerAiContext\(context\)/);
  assert.match(section, /renderCustomerAiSectionHtml\(drawerAi\)/);
  assert.doesNotMatch(section, /<section class="customer-ai">/);
});

test('master-profile widget is loaded on shell before app.js and exposes section helpers', () => {
  assert.match(html, /sales-assets\/master-profile-widget\.js/);
  const masterIndex = html.indexOf('master-profile-widget.js');
  const registryIndex = html.indexOf('widget-registry.js');
  const appIndex = html.indexOf('sales-assets/app.js');
  assert.ok(masterIndex > -1 && masterIndex < appIndex && masterIndex < registryIndex,
    'master-profile-widget.js must load before widget-registry.js and app.js');
  assert.equal(typeof masterProfileWidget.renderMasterSectionHtml, 'function');
  assert.equal(typeof masterProfileWidget.render, 'function');
  assert.equal(typeof masterProfileWidget.cardMarkup, 'function');
  assert.equal(typeof masterProfileWidget.escapeHtml, 'function');
});

test('master-profile widget renders section with escaped labels, safe value html and optional classes', () => {
  const htmlOut = masterProfileWidget.renderMasterSectionHtml({
    title: '<b>企业背景</b>',
    actions: '<button class="button secondary tiny" type="button">查看完整资料</button>',
    gridClass: 'drawer-master-grid',
    rows: [
      ['企业简介', '__intro__', 'drawer-master-card-wide'],
      ['产品与潜在需求', '__focus__'],
      ['背调与来源', '<a href="https://safe.example/x">证据</a>'],
    ],
  });
  assert.match(htmlOut, /<section class="master-profile">/);
  assert.match(htmlOut, /&lt;b&gt;企业背景&lt;\/b&gt;/);
  assert.match(htmlOut, /class="master-profile-grid drawer-master-grid"/);
  assert.match(htmlOut, /class="drawer-master-card-wide"/);
  assert.match(htmlOut, /<span>企业简介<\/span>/);
  assert.match(htmlOut, /<a href="https:\/\/safe\.example\/x">证据<\/a>/);
  assert.match(htmlOut, /<button class="button secondary tiny"/);

  const empty = masterProfileWidget.renderMasterSectionHtml({});
  assert.match(empty, /<section class="master-profile">/);
  assert.match(empty, /class="master-profile-grid"/);
  assert.doesNotMatch(empty, /class="master-profile-grid /);
  assert.doesNotMatch(empty, /<div class="tp-/);
});

test('app.js masterProfileSectionHtml delegates to widget and three drawer sources compose rows', () => {
  const helper = functionSource('masterProfileSectionHtml', 'mountCustomerProfileWidgets');
  assert.match(helper, /TradePulseMasterProfileWidget/);
  assert.match(helper, /renderMasterSectionHtml\(/);
  assert.match(helper, /<section class="master-profile">/);

  const renderDrawer = functionSource('renderDrawer', 'stopDrawerNextActionTimer');
  assert.match(renderDrawer, /masterProfileSectionHtml\(\{/);
  assert.match(renderDrawer, /gridClass: 'drawer-master-grid'/);
  assert.match(renderDrawer, /drawer-master-card-wide/);

  const intake = functionSource('openIntakeProfile', 'closeDrawer');
  assert.match(intake, /masterProfileSectionHtml\(\{/);
  assert.match(intake, /\['企业背景', esc\(item\.master_description/);
  assert.match(intake, /\['潜在需求', esc\(item\.product_focus/);

  const recycle = functionSource('renderRecycleDrawer', 'correctionActivityId');
  assert.match(recycle, /masterProfileSectionHtml\(\{/);
  assert.match(recycle, /\['行业与客户类型', esc\(\[master\.industry \|\| account\.industry/);
  assert.match(recycle, /title: '客户主档'/);
});

test('insight-section widget is loaded on shell before app.js and exposes section helpers', () => {
  assert.match(html, /sales-assets\/insight-section-widget\.js/);
  const insightIndex = html.indexOf('insight-section-widget.js');
  const registryIndex = html.indexOf('widget-registry.js');
  const appIndex = html.indexOf('sales-assets/app.js');
  assert.ok(insightIndex > -1 && insightIndex < appIndex && insightIndex < registryIndex,
    'insight-section-widget.js must load before widget-registry.js and app.js');
  assert.equal(typeof insightSectionWidget.renderSectionHtml, 'function');
  assert.equal(typeof insightSectionWidget.render, 'function');
  assert.equal(typeof insightSectionWidget.escapeHtml, 'function');
});

test('insight-section widget renders the shared shell with escaped eyebrow/title/note and safe body html', () => {
  const htmlOut = insightSectionWidget.renderSectionHtml({
    eyebrow: '<b>CONTACT HISTORY</b>',
    title: '联系人历史',
    note: '3 人',
    actionHtml: '<button class="text-button" data-open-timeline-modal>展开完整时间线</button>',
    bodyHtml: '<div class="empty">暂无记录</div>',
  });
  assert.match(htmlOut, /<section class="insight-section">/);
  assert.match(htmlOut, /&lt;b&gt;CONTACT HISTORY&lt;\/b&gt;/);
  assert.match(htmlOut, /<h3>联系人历史<\/h3>/);
  assert.match(htmlOut, /panel-note/);
  assert.match(htmlOut, /3 人/);
  assert.match(htmlOut, /data-open-timeline-modal/);
  assert.match(htmlOut, /class="insight-body"/);
  assert.match(htmlOut, /<div class="empty">暂无记录<\/div>/);

  const timeline = insightSectionWidget.renderSectionHtml({
    eyebrow: 'FULL TIMELINE',
    title: '完整客户时间线',
    note: '2 条',
    bodyClass: 'timeline',
    bodyHtml: '<div class="timeline-item"><h4>领取客户</h4></div>',
  });
  assert.match(timeline, /class="timeline"/);
  assert.match(timeline, /FULL TIMELINE/);

  const bare = insightSectionWidget.renderSectionHtml({ title: '客户审计历史' });
  assert.match(bare, /<section class="insight-section">/);
  assert.match(bare, /<h3>客户审计历史<\/h3>/);
  assert.doesNotMatch(bare, /panel-note/);
  assert.doesNotMatch(bare, /eyebrow/);
});

test('app.js insightSectionHtml delegates to widget and recycle drawer composes five sections', () => {
  const helper = functionSource('insightSectionHtml', 'mountCustomerProfileWidgets');
  assert.match(helper, /TradePulseInsightSectionWidget/);
  assert.match(helper, /renderSectionHtml\(/);
  assert.match(helper, /<section class="insight-section">/);

  const recycle = functionSource('renderRecycleDrawer', 'correctionActivityId');
  assert.match(recycle, /insightSectionHtml\(\{/);
  assert.match(recycle, /eyebrow: 'CONTACT HISTORY'/);
  assert.match(recycle, /eyebrow: 'MANAGER INSIGHT'/);
  assert.match(recycle, /eyebrow: 'FULL TIMELINE'/);
  assert.match(recycle, /eyebrow: 'AUDIT TRAIL'/);
  assert.match(recycle, /bodyClass: 'timeline'/);
  assert.doesNotMatch(recycle, /<section class="insight-section">/);
});

test('next-step widget is loaded on shell before app.js and exposes step markup helpers', () => {
  assert.match(html, /sales-assets\/next-step-widget\.js/);
  const nextStepIndex = html.indexOf('next-step-widget.js');
  const registryIndex = html.indexOf('widget-registry.js');
  const appIndex = html.indexOf('sales-assets/app.js');
  assert.ok(nextStepIndex > -1 && nextStepIndex < appIndex && nextStepIndex < registryIndex,
    'next-step-widget.js must load before widget-registry.js and app.js');
  assert.equal(typeof nextStepWidget.renderStepHtml, 'function');
  assert.equal(typeof nextStepWidget.render, 'function');
  assert.equal(typeof nextStepWidget.escapeHtml, 'function');
});

test('next-step widget renders the shared step shell with escaped eyebrow/text and safe action html', () => {
  const htmlOut = nextStepWidget.renderStepHtml({
    eyebrow: '<b>NEXT ACTION</b>',
    text: 'Follow up',
    actionHtml: '<span class="pill amber">待跟进</span>',
    className: 'bordered',
  });
  assert.match(htmlOut, /class="next-step bordered"/);
  assert.match(htmlOut, /&lt;b&gt;NEXT ACTION&lt;\/b&gt;/);
  assert.match(htmlOut, /<p>Follow up<\/p>/);
  assert.match(htmlOut, /<span class="pill amber">待跟进<\/span>/);

  const bare = nextStepWidget.renderStepHtml({ eyebrow: 'LEAD PROFILE', text: '' });
  assert.match(bare, /class="next-step"/);
  assert.doesNotMatch(bare, /class="next-step /);
  assert.match(bare, /LEAD PROFILE/);
  assert.doesNotMatch(bare, /<span class="pill/);
});

test('app.js nextStepHtml delegates to widget and three drawer sources compose steps', () => {
  const helper = functionSource('nextStepHtml', 'mountCustomerProfileWidgets');
  assert.match(helper, /TradePulseNextStepWidget/);
  assert.match(helper, /renderStepHtml\(/);
  assert.match(helper, /<div class="next-step/);

  const renderDrawer = functionSource('renderDrawer', 'stopDrawerNextActionTimer');
  assert.match(renderDrawer, /nextStepHtml\(\{/);
  assert.match(renderDrawer, /eyebrow: 'NEXT ACTION'/);
  assert.match(renderDrawer, /nextActionTimeMarkup\(account\)/);
  assert.doesNotMatch(renderDrawer, /<div class="next-step">/);

  const intake = functionSource('openIntakeProfile', 'closeDrawer');
  assert.match(intake, /nextStepHtml\(\{/);
  assert.match(intake, /eyebrow: 'LEAD PROFILE'/);

  const recycle = functionSource('renderRecycleDrawer', 'correctionActivityId');
  assert.match(recycle, /nextStepHtml\(\{/);
  assert.match(recycle, /eyebrow: 'RECYCLED CUSTOMER · READ ONLY'/);
  assert.doesNotMatch(recycle, /<div class="next-step">/);
});

test('next-step widget alert variants escape severity title/detail and keep pill tone', () => {
  const critical = nextStepWidget.renderAlertStepHtml({
    severity: 'critical', title: '<b>超期</b>', detail: '已超时', action: '立即处理',
  });
  assert.match(critical, /border-color:#e0a09c/);
  assert.match(critical, /pill red/);
  assert.match(critical, /&lt;b&gt;超期&lt;\/b&gt;/);
  assert.match(critical, /已超时/);
  assert.match(critical, /立即处理/);

  const warning = nextStepWidget.renderAlertStepHtml({
    severity: 'warning', title: '需关注', detail: '待介入', action: '处理',
  });
  assert.match(warning, /border-color:#e5c27c/);
  assert.match(warning, /pill amber/);

  const details = nextStepWidget.renderAlertDetailsHtml({
    rows: [{ title: '<i>超期</i>', detail: 'd', metaHtml: '<span>计划时间：x</span>' }],
  });
  assert.match(details, /alert-details/);
  assert.match(details, /alert-detail-row/);
  assert.match(details, /&lt;i&gt;超期&lt;\/i&gt;/);
  assert.match(details, /计划时间：x/);
});

test('app.js alertStepHtml/alertDetailsHtml delegate to widget with gated render', () => {
  const step = functionSource('alertStepHtml', 'alertDetailsHtml');
  assert.match(step, /hasMeaningfulAlertCopy\(alert\)/);
  assert.match(step, /TradePulseNextStepWidget/);
  assert.match(step, /renderAlertStepHtml\(/);
  assert.match(step, /alert\.severity === 'critical'/);

  const details = functionSource('alertDetailsHtml', 'mountCustomerProfileWidgets');
  assert.match(details, /alertReasons\(alert\);/);
  assert.match(details, /reasons\.length <= 1/);
  assert.match(details, /renderAlertDetailsHtml\(\{ rows \}\)/);
  assert.match(details, /overdueHours/);
  assert.match(details, /reason\.dueAt/);

  const renderDrawer = functionSource('renderDrawer', 'stopDrawerNextActionTimer');
  assert.match(renderDrawer, /alertStepHtml\(alert\)/);
  assert.match(renderDrawer, /alertDetailsHtml\(alert\)/);
  assert.doesNotMatch(renderDrawer, /<div class="alert-details">/);
  assert.doesNotMatch(renderDrawer, /<div class="next-step" style="border-color/);
});

test('timeline widget is loaded on shell before app.js and exposes item rendering helpers', () => {
  assert.match(html, /sales-assets\/timeline-widget\.js/);
  const timelineIndex = html.indexOf('timeline-widget.js');
  const registryIndex = html.indexOf('widget-registry.js');
  const appIndex = html.indexOf('sales-assets/app.js');
  assert.ok(timelineIndex > -1 && timelineIndex < appIndex && timelineIndex < registryIndex,
    'timeline-widget.js must load before widget-registry.js and app.js');
  assert.equal(typeof timelineWidget.renderItemsHtml, 'function');
  assert.equal(typeof timelineWidget.render, 'function');
  assert.equal(typeof timelineWidget.escapeHtml, 'function');
});

test('timeline widget renders items with escaped fields, optional next action and empty state', () => {
  const list = timelineWidget.renderItemsHtml([
    { title: '领取客户', summary: '领取了该线索', actor_name: 'Ada', occurred_at: '2026-08-04 08:00:00', next_action: '跟进' },
    { title: '<b>回复</b>', summary: '<script>alert(1)</script>', actor_name: 'Ada', occurred_at: '2026-08-05 09:00:00' },
  ], {
    titleOf: event => event.title,
    summaryOf: event => event.summary,
    actorOf: event => event.actor_name,
    dateOf: event => event.occurred_at,
    nextActionOf: event => event.next_action || '',
  });
  assert.match(list, /timeline-item/);
  assert.match(list, /<h4>领取客户<\/h4>/);
  assert.match(list, /&lt;b&gt;回复&lt;\/b&gt;/);
  assert.match(list, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(list, /下一步：<\/strong>跟进/);
  assert.match(list, /Ada · 2026-08-04/);

  assert.equal(timelineWidget.renderItemsHtml([], { emptyText: '暂无历史记录' }), '<div class="empty">暂无历史记录</div>');
});

test('app.js timelineItemsHtml delegates to widget and recycle plus intake drawers compose item lists', () => {
  const helper = functionSource('timelineItemsHtml', 'mountCustomerProfileWidgets');
  assert.match(helper, /TradePulseTimelineWidget/);
  assert.match(helper, /renderItemsHtml\(/);
  assert.match(helper, /timelineEventTitle/);
  assert.match(helper, /timelineEventSummary/);

  const recycle = functionSource('renderRecycleDrawer', 'correctionActivityId');
  assert.match(recycle, /timelineItemsHtml\(history, \{ emptyText: '暂无历史记录', nextAction: true \}\)/);
  assert.doesNotMatch(recycle, /history\.map\(event =>/);

  const intake = functionSource('openIntakeProfile', 'closeDrawer');
  assert.match(intake, /timelineItemsHtml\(developmentTimeline, \{ emptyText: '暂无开发历史' \}\)/);
  assert.doesNotMatch(intake, /developmentTimeline\.map\(event/);
});

test('app.js registers profile-master widget and delegates to masterProfileSectionHtml', () => {
  const register = functionSource('registerProfilePageWidgets', 'renderProfileFactsWidget');
  assert.match(register, /id: 'profile-master'/);
  assert.match(register, /pages: \['customerProfile'\]/);
  assert.match(register, /when: ctx => Boolean\(ctx\.account\)/);
  assert.match(register, /render: renderProfileMasterWidget/);

  const context = functionSource('profileWidgetContext', 'registerProfilePageWidgets');
  assert.match(context, /account,/);
  assert.match(context, /find\(item => item\.external_customer_id === externalCustomerId\)/);

  const renderer = functionSource('renderProfileMasterWidget', 'drawerFactsContext');
  assert.match(renderer, /masterProfileSectionHtml\(/);
  assert.match(renderer, /企业背景与开发依据/);
  assert.match(renderer, /isSalesRepresentative\(\)/);
  assert.match(renderer, /master_description/);
  assert.match(renderer, /背调与来源/);
});

test('app.js registers profile-timeline widget and delegates to the shared timeline templates', () => {
  const register = functionSource('registerProfilePageWidgets', 'renderProfileFactsWidget');
  assert.match(register, /id: 'profile-timeline'/);
  assert.match(register, /pages: \['customerProfile'\]/);
  assert.match(register, /when: ctx => Boolean\(ctx\.account\)/);
  assert.match(register, /render: renderProfileTimelineWidget/);

  const renderer = functionSource('renderProfileTimelineWidget', 'drawerFactsContext');
  assert.match(renderer, /state\.data\?\.timeline \|\| \[\]/);
  assert.match(renderer, /item\.customer_id === account\.id/);
  assert.match(renderer, /timelineSectionHtml\(\{/);
  assert.match(renderer, /timelineItemsHtml\(events/);
  assert.match(renderer, /data-customer-history/);
});

test('app.js registers profile-insight widget and delegates to the shared insight shell', () => {
  const register = functionSource('registerProfilePageWidgets', 'renderProfileFactsWidget');
  assert.match(register, /id: 'profile-insight'/);
  assert.match(register, /pages: \['customerProfile'\]/);
  assert.match(register, /when: ctx => Boolean\(ctx\.account\)/);
  assert.match(register, /render: renderProfileInsightWidget/);

  const renderer = functionSource('renderProfileInsightWidget', 'drawerFactsContext');
  assert.match(renderer, /state\.data\?\.insights\?\.evaluations \|\| \[\]/);
  assert.match(renderer, /item\.customerId === account\.id/);
  assert.match(renderer, /insightSectionHtml\(\{/);
  assert.match(renderer, /eyebrow: 'MANAGER INSIGHT'/);
  assert.match(renderer, /客户经营复盘历史/);
});

test('app.js registers profile-next-step widget and delegates to the shared next-step bar', () => {
  const register = functionSource('registerProfilePageWidgets', 'renderProfileFactsWidget');
  assert.match(register, /id: 'profile-next-step'/);
  assert.match(register, /pages: \['customerProfile'\]/);
  assert.match(register, /when: ctx => Boolean\(ctx\.account\)/);
  assert.match(register, /render: renderProfileNextStepWidget/);

  const renderer = functionSource('renderProfileNextStepWidget', 'drawerFactsContext');
  assert.match(renderer, /nextStepHtml\(\{/);
  assert.match(renderer, /eyebrow: 'NEXT ACTION'/);
  assert.match(renderer, /next_action \|\| '尚未填写下一步'/);
  assert.match(renderer, /nextActionTimeMarkup\(account\)/);
});

test('complete profile view defaults to the widget shell with a legacy iframe fallback', () => {
  const mode = functionSource('isProfileWidgetsMode', 'applyProfileViewMode');
  // 默认走 widget 集合（统一壳），profileView=legacy 显式回退旧 iframe
  assert.match(mode, /get\('profileView'\) !== 'legacy'/);
  assert.match(mode, /return true;/);

  const apply = functionSource('applyProfileViewMode', 'profileWidgetContext');
  assert.match(apply, /isProfileWidgetsMode\(\)/);
  assert.match(apply, /profile-widgets-only/);
  assert.match(apply, /frame\.classList\.toggle\('hidden', on\)/);
  assert.match(apply, /widgets\.classList\.remove\('hidden'\)/);
});
