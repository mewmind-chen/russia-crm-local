'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const moduleUrl = pathToFileURL(path.join(root, 'sales-assets/core/preferences.js')).href;
const permissions = (...names) => Object.fromEntries(names.map(name => [name, true]));

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: key => values.get(key),
  };
}

test('preferences retain only visible pages and append omitted capabilities', async () => {
  const { sanitizeLayoutPreference } = await import(moduleUrl);
  const result = sanitizeLayoutPreference({
    defaultPageId: 'administration',
    pageOrder: ['administration', 'customers', 'my-today'],
    collapsedGroups: ['administration', 'customers', 'unknown'],
    hiddenPages: ['intake'],
  }, {
    role: 'sales',
    permissions: permissions('view_dashboard', 'view_customers', 'view_intake'),
  });
  assert.equal(result.defaultPageId, 'customers');
  assert.deepEqual(result.pageOrder, ['customers', 'my-today', 'intake']);
  assert.deepEqual(result.collapsedGroups, ['customers']);
  assert.equal(Object.hasOwn(result, 'hiddenPages'), false);
});

test('feature flags and permissions cannot be restored from saved layout', async () => {
  const { sanitizeLayoutPreference } = await import(moduleUrl);
  const result = sanitizeLayoutPreference({
    defaultPageId: 'ai-control',
    pageOrder: ['ai-control', 'team-dashboard', 'team-tasks'],
  }, {
    role: 'manager',
    permissions: permissions('view_dashboard', 'view_alerts', 'view_customers'),
    featureFlags: { aiStations: false },
  });
  assert.deepEqual(result.pageOrder, ['team-dashboard', 'team-tasks', 'customers']);
  assert.equal(result.defaultPageId, 'team-dashboard');
});

test('layout storage uses the user key and sanitizes on both read and write', async () => {
  const { loadLayoutPreference, saveLayoutPreference } = await import(moduleUrl);
  const storage = memoryStorage({
    'tradepulse:layout:U-1': JSON.stringify({
      defaultPageId: 'administration',
      pageOrder: ['administration', 'intake'],
    }),
  });
  const context = {
    role: 'sales',
    permissions: permissions('view_dashboard', 'view_customers', 'view_intake'),
  };
  const loaded = loadLayoutPreference('U-1', context, storage);
  assert.deepEqual(loaded.pageOrder, ['intake', 'my-today', 'customers']);
  const saved = saveLayoutPreference('U-1', {
    defaultPageId: 'customers',
    pageOrder: ['customers'],
    collapsedGroups: ['customers'],
  }, context, storage);
  assert.deepEqual(JSON.parse(storage.value('tradepulse:layout:U-1')), saved);
  assert.deepEqual(saved.pageOrder, ['customers', 'my-today', 'intake']);
});

test('modular shell applies sanitized default, order, and collapsed groups', () => {
  const app = fs.readFileSync(path.join(root, 'sales-assets/modular-app.js'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'sales-assets/components/shell.js'), 'utf8');
  assert.match(app, /loadLayoutPreference\(session\.user\?\.id, accessContext\(\)\)/);
  assert.match(app, /layoutPreference\?\.defaultPageId/);
  assert.match(app, /saveLayoutPreference/);
  assert.match(shell, /preference\.pageOrder/);
  assert.match(shell, /preference\.collapsedGroups/);
  assert.match(shell, /data-action="toggle-nav-group"/);
});
