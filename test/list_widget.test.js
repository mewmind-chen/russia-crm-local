'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sales-assets', 'list-widget.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const widget = require(path.join(root, 'sales-assets', 'list-widget.js'));
const fieldCatalog = require(path.join(root, 'lib', 'field_catalog.js'));

const columns = [
  { key: 'company', label: '客户', required: true, className: 'col-company' },
  { key: 'owner', label: '负责人', className: 'col-owner', sortKey: 'owner_name' },
  { key: 'stage', label: '阶段', className: 'col-stage' },
  { key: 'actions', label: '操作', required: true, sortable: false, className: 'col-actions' },
];

test('list widget exposes a browser-safe UMD contract', () => {
  const browserGlobal = {};
  vm.runInNewContext(source, browserGlobal);
  assert.equal(typeof browserGlobal.TradePulseListWidget, 'object');
  for (const name of [
    'normalizeColumns', 'defaultPreferences', 'normalizePreferences', 'normalizeSort',
    'resolveColumns', 'loadPreferences', 'savePreferences', 'renderColumnSettingsHtml', 'renderTable',
  ]) assert.equal(typeof browserGlobal.TradePulseListWidget[name], 'function', `${name} must be exported`);
});

test('list preferences preserve required columns and sanitize unknown fields', () => {
  const prefs = widget.normalizePreferences({
    visibleColumns: ['stage', 'unknown'],
    columnOrder: ['stage', 'owner', 'unknown'],
    sort: [{ key: 'owner_name', direction: 'desc' }, { key: 'owner_name', direction: 'asc' }],
  }, columns);
  assert.deepEqual(prefs.visibleColumns, ['stage', 'company', 'actions']);
  assert.deepEqual(prefs.columnOrder, ['stage', 'owner', 'company', 'actions']);
  assert.deepEqual(prefs.sort, [{ key: 'owner', sortKey: 'owner_name', direction: 'desc' }]);
  assert.deepEqual(widget.resolveColumns(columns, prefs).map(column => column.key), ['stage', 'company', 'actions']);
});

test('list preference persistence is user-storage compatible and recovers malformed data', () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
  };
  const saved = widget.savePreferences('tradepulse.listLayout.customers.user-1', {
    visibleColumns: ['owner'], columnOrder: ['owner', 'company'], sortPreset: 'company',
  }, storage, columns);
  assert.equal(saved.sortPreset, 'company');
  assert.equal(widget.loadPreferences('tradepulse.listLayout.customers.user-1', storage, columns).sortPreset, 'company');
  values.set('broken', '{bad json');
  assert.deepEqual(widget.loadPreferences('broken', storage, columns).visibleColumns, ['company', 'owner', 'stage', 'actions']);
});

test('column settings markup exposes visibility, order, reset, and close controls', () => {
  const markup = widget.renderColumnSettingsHtml({ columns, preferences: { visibleColumns: ['company', 'owner'] } });
  assert.match(markup, /data-list-column-toggle="owner" checked/);
  assert.match(markup, /data-list-column-toggle="stage"/);
  assert.match(markup, /data-list-column-move="up"/);
  assert.match(markup, /data-list-layout-reset/);
  assert.match(markup, /data-list-layout-close/);
  assert.match(markup, /data-list-column-toggle="company" checked disabled/);
});

test('descriptor table renderer keeps raw cell actions and row attributes', () => {
  const markup = widget.renderTable({
    columns,
    preferences: { visibleColumns: ['company', 'actions'], columnOrder: ['company', 'actions'] },
    rows: [{ company: '<strong>Acme</strong>', actions: '<button>打开</button>', _attrs: 'data-customer="c1"' }],
  });
  assert.match(markup, /data-customer="c1"/);
  assert.match(markup, /<strong>Acme<\/strong>/);
  assert.match(markup, /<button>打开<\/button>/);
  assert.doesNotMatch(markup, /负责人/);
});

test('customer list is wired to the shared widget and user layout controls', () => {
  assert.match(html, /sales-assets\/list-widget\.js[^>]*><\/script>/);
  assert.ok(html.indexOf('list-widget.js') < html.indexOf('sales-assets/app.js'));
  assert.match(html, /id="customerColumnSettings"/);
  assert.match(html, /id="customerColumnSettingsPanel"/);
  assert.match(app, /const listWidget = window\.TradePulseListWidget/);
  assert.match(app, /customerListLayout/);
  assert.match(app, /listWidget\.renderTable\(\{ columns: renderColumns/);
  assert.match(app, /data-list-column-toggle/);
  assert.match(app, /sortPreset/);
});

test('customer list has a server field-schema catalog separate from local layout preferences', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'customers',
    user: { role: 'sales' },
    permissions: { view_customers: true },
    features: {},
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'company', 'country_industry', 'stage', 'owner', 'last_activity', 'next_action', 'priority', 'status',
  ]);
  assert.match(app, /state\.fieldSchemas\?\.customers\?\.fields/);
  assert.match(app, /state\.fieldSchemas = \{\};/);
});

test('research people list uses the shared widget with per-user layout and authorized columns', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'contacts',
    user: { role: 'sales' },
    permissions: { view_contacts: true },
    features: {},
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'company', 'contact', 'title_department', 'level', 'methods', 'status',
  ]);
  assert.match(html, /id="peopleSort"/);
  assert.match(html, /id="peopleColumnSettings"/);
  assert.match(html, /id="peopleColumnSettingsPanel"/);
  assert.match(app, /researchPeopleListLayout/);
  assert.match(app, /tradepulse\.listLayout\.contacts/);
  assert.match(app, /listWidget\?\.renderTable[\s\S]*data-list-page="contacts"/);
  assert.match(app, /params\.set\('sort', state\.researchPeopleListLayout\.sortPreset/);
});
