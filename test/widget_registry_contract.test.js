'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const registryPath = path.join(root, 'sales-assets', 'widget-registry.js');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const registry = require(registryPath);

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

test('registry script is loaded on the sales shell before app.js', () => {
  assert.match(html, /sales-assets\/widget-registry\.js/);
  const scriptIndex = html.indexOf('widget-registry.js');
  const appIndex = html.indexOf('sales-assets/app.js');
  assert.ok(scriptIndex > -1 && appIndex > -1 && scriptIndex < appIndex,
    'widget-registry.js must be loaded before app.js');
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

  // 权限/开关门槛：contacts 以 contactsWidget 存在为 when，facts 以 schema 存在为 when
  assert.match(source, /when: ctx => Boolean\(ctx\.contactsWidget\)/);
  assert.match(source, /when: ctx => Boolean\(ctx\.fieldWidget && ctx\.profileSchema\?\.fields\?\.length\)/);

  // 装配委托注册表：renderPage 负责挂载，权限/开关从 ctx.permissions/ctx.features 注入
  assert.match(source, /registerProfilePageWidgets\(\)/);
  assert.match(source, /window\.TradePulseWidgetRegistry\.renderPage\(/);
  assert.match(source, /permissions: state\.data\?\.user\?\.permissions \|\| \{\}/);
  assert.match(source, /features: state\.data\?\.features \|\| \{\}/);
});

test('app.js keeps the profile-widgets UMD contract as widget render source', () => {
  const source = functionSource('renderProfileFactsWidget', 'renderProfileContactsWidget');
  assert.match(source, /renderProfileFacts\(/);
  assert.match(source, /data-profile-section-toggle/);
  const contacts = functionSource('renderProfileContactsWidget', 'mountCustomerProfileWidgets');
  assert.match(contacts, /mountContacts\(/);
  assert.match(contacts, /customerId: ctx\.customerId/);
  assert.match(contacts, /intakeItemId: ctx\.intakeItemId/);
});
