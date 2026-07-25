'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');

function importCore(name) {
  return import(pathToFileURL(path.join(root, 'sales-assets', 'core', name)).href);
}

function permissions(...allowed) {
  return Object.fromEntries(allowed.map(key => [key, true]));
}

class FakeWindow extends EventTarget {
  constructor(href = 'http://crm.local/sales-crm') {
    super();
    this.entries = [href];
    this.index = 0;
    this.location = new URL(href);
    this.history = {
      pushState: (_state, _title, next) => this.#write(next, false),
      replaceState: (_state, _title, next) => this.#write(next, true),
      back: () => this.#move(-1),
      forward: () => this.#move(1),
    };
  }

  #write(next, replace) {
    const href = new URL(next, this.location.href).href;
    if (replace) this.entries[this.index] = href;
    else {
      this.entries.splice(this.index + 1);
      this.entries.push(href);
      this.index += 1;
    }
    this.location = new URL(href);
  }

  #move(offset) {
    const nextIndex = this.index + offset;
    if (nextIndex < 0 || nextIndex >= this.entries.length) return;
    this.index = nextIndex;
    this.location = new URL(this.entries[this.index]);
    this.dispatchEvent(new Event('popstate'));
    this.dispatchEvent(new Event('hashchange'));
  }
}

test('registry entries expose the fixed page contract and role navigation', async () => {
  const { PAGE_REGISTRY, visiblePages, defaultPageId } = await importCore('registry.js');
  for (const item of PAGE_REGISTRY) {
    for (const field of ['id', 'routes', 'roles', 'permissions', 'featureFlags', 'nav', 'module']) {
      assert.ok(Object.hasOwn(item, field), `${item.id} missing ${field}`);
    }
  }

  const sales = visiblePages({
    role: 'sales',
    permissions: permissions('view_dashboard', 'view_customers', 'view_intake', 'use_ai_assistant'),
  });
  assert.deepEqual(sales.map(item => item.id), ['my-today', 'customers', 'intake', 'assistant']);

  const manager = visiblePages({
    role: 'manager',
    permissions: permissions(
      'view_dashboard', 'view_alerts', 'view_customers', 'view_intake',
      'view_team', 'view_insights', 'view_markets', 'view_pool', 'view_contacts', 'view_recon',
    ),
  });
  assert.deepEqual(
    new Set(manager.map(item => item.id)),
    new Set(['team-dashboard', 'team-tasks', 'intake', 'customers', 'team-insights', 'intelligence']),
  );
  assert.equal(defaultPageId('sales'), 'my-today');
  assert.equal(defaultPageId('manager'), 'team-dashboard');
  assert.equal(defaultPageId('admin'), 'team-dashboard');
});

test('access requires every permission and feature flag and blocks sensitive impersonation pages', async () => {
  const { canAccessPage } = await importCore('access.js');
  const target = {
    roles: ['admin'],
    permissions: ['view_users', 'manage_users'],
    featureFlags: ['administrationEnabled'],
    blockedWhileImpersonating: true,
  };

  assert.equal(canAccessPage(target, {
    role: 'admin',
    permissions: permissions('view_users'),
    featureFlags: { administrationEnabled: true },
  }), false);
  assert.equal(canAccessPage(target, {
    role: 'admin',
    permissions: permissions('view_users', 'manage_users'),
    featureFlags: { administrationEnabled: true },
  }), true);
  assert.equal(canAccessPage(target, {
    role: 'admin',
    permissions: permissions('view_users', 'manage_users'),
    featureFlags: { administrationEnabled: true },
    impersonating: true,
  }), false);
});

test('legacy routes resolve to canonical pages while retaining route and customer context', async () => {
  const { LEGACY_ROUTE_ALIASES } = await importCore('registry.js');
  const { resolveRoute } = await importCore('router.js');
  for (const route of [
    'pending', 'claimed', 'pipeline', 'team', 'insights', 'markets',
    'pool', 'contacts', 'recon', 'customerProfile',
  ]) {
    assert.ok(LEGACY_ROUTE_ALIASES[route], `missing legacy route ${route}`);
    const result = resolveRoute(`http://crm.local/sales-crm#${route}`);
    assert.equal(result.found, true);
    assert.equal(result.requestedRoute, route);
    assert.equal(result.isLegacy, true);
  }

  const detail = resolveRoute('http://crm.local/sales-crm?customer=RU-001%2FA#customerProfile');
  assert.equal(detail.pageId, 'customer-detail');
  assert.equal(detail.shellView, 'customerProfile');
  assert.equal(detail.customerId, 'RU-001/A');
});

test('router owns history events, handles refresh/back/forward once, and preserves deep links', async () => {
  const { createRouter } = await importCore('router.js');
  const browser = new FakeWindow('http://crm.local/sales-crm?customer=RU-1#customerProfile');
  const routed = [];
  const router = createRouter({
    window: browser,
    getAccessContext: () => ({
      role: 'sales',
      permissions: permissions('view_dashboard', 'view_customers', 'view_intake'),
    }),
    onRoute: route => routed.push(`${route.requestedRoute}:${route.customerId}`),
  });

  router.start();
  assert.deepEqual(routed, ['customer-detail:RU-1']);
  assert.equal(browser.location.hash, '#customer-detail');
  router.navigate('customers');
  router.navigate('pending');
  assert.equal(browser.location.hash, '#pending');
  assert.equal(browser.location.search, '');
  browser.history.back();
  browser.history.forward();
  assert.deepEqual(routed, [
    'customer-detail:RU-1',
    'customers:',
    'pending:',
    'customers:',
    'pending:',
  ]);

  router.dispose();
  browser.history.back();
  assert.equal(routed.length, 5);
});

test('unknown and unauthorized routes replace the URL with an accessible role default', async () => {
  const { createRouter } = await importCore('router.js');
  const browser = new FakeWindow('http://crm.local/sales-crm#does-not-exist');
  const routed = [];
  const denied = [];
  const unknown = [];
  const router = createRouter({
    window: browser,
    getAccessContext: () => ({
      role: 'sales',
      permissions: permissions('view_dashboard', 'view_customers', 'view_intake'),
    }),
    onRoute: route => routed.push(route),
    onForbidden: route => denied.push(route.requestedRoute),
    onUnknown: route => unknown.push(route.requestedRoute),
  });

  router.start();
  assert.deepEqual(unknown, ['does-not-exist']);
  assert.equal(browser.location.hash, '#my-today');
  assert.equal(routed.at(-1).reason, 'unknown');

  router.navigate('users');
  assert.deepEqual(denied, ['users']);
  assert.equal(browser.location.hash, '#my-today');
  assert.equal(routed.at(-1).reason, 'forbidden');
});

test('legacy app delegates hash and popstate ownership to the router', () => {
  const source = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
  assert.match(source, /import \{ createRouter \} from '\.\/core\/router\.js'/);
  assert.match(source, /router\.start\(\{ refresh: false \}\)/);
  assert.doesNotMatch(source, /lifecycle\.listen\(window, 'hashchange'/);
  assert.doesNotMatch(source, /lifecycle\.listen\(window, 'popstate'/);
});
