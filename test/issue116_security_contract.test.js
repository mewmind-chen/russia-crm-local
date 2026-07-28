'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const crmHtml = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const crmJs = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const salesCrmSource = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

function literalOccurrences(source, literal) {
  return source.split(literal).length - 1;
}

function viewSlice(source, viewId, nextViewId) {
  const start = source.indexOf(`id="${viewId}"`);
  const end = source.indexOf(`id="${nextViewId}"`, start + 1);
  assert.notEqual(start, -1, `missing ${viewId}`);
  assert.notEqual(end, -1, `missing ${nextViewId}`);
  return source.slice(start, end);
}

function functionSlice(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  const end = source.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return source.slice(start, end);
}

test('filter-permission administration has one entry and it is confined to Users & Permissions', () => {
  const usersView = viewSlice(crmHtml, 'usersView', 'maintenanceView');
  for (const marker of [
    'id="filterPermissionAdmin"',
    'data-filter-permission-entry',
    'id="filterIdentityPreview"',
  ]) {
    assert.equal(literalOccurrences(crmHtml, marker), 1, `${marker} must be unique`);
    assert.match(usersView, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const outsideUsers = crmHtml.slice(0, crmHtml.indexOf('id="usersView"'))
    + crmHtml.slice(crmHtml.indexOf('id="maintenanceView"'));
  assert.doesNotMatch(
    outsideUsers,
    /data-filter-permission-entry|filterPermissionAdmin|filterIdentityPreview/,
    'business views must not expose filter administration or identity preview controls',
  );
});

test('the production catalog contains exactly the approved seven tag categories', () => {
  const { FILTER_DEFINITIONS } = require('../lib/filter_catalog');
  assert.ok(Array.isArray(FILTER_DEFINITIONS));
  const categories = [...new Set(
    FILTER_DEFINITIONS.map(definition => definition.tagCategory).filter(Boolean),
  )].sort();
  assert.deepEqual(categories, [
    '名单标签',
    '客户经营产品',
    '客户类型',
    '应用行业',
    '重点场景',
    '需确认属性',
    '需求/采购产品',
  ].sort());
  assert.equal(
    FILTER_DEFINITIONS.filter(definition => definition.type === 'tag_multi').length,
    7,
  );
});

test('business filters load an authorized server schema into the shared component', () => {
  assert.match(
    crmJs,
    /\/filter-schema\/\$\{[^}]+\}/,
    'the active page must request its authorized schema from the server',
  );
  assert.match(
    crmJs,
    /TradePulseFilterComponent|TradePulseFilters/,
    'the CRM shell must mount the shared filter component',
  );
  assert.match(
    crmHtml,
    /filter-component\.js\?v=/,
    'the shared component asset must be loaded by the CRM page',
  );
  assert.match(
    salesCrmSource,
    /app\.get\('\/api\/sales-crm\/filter-schema\/:pageKey'/,
  );
  assert.match(salesCrmSource, /effectiveFilterSchemaFor\(/);
});

test('customer results are fetched through the server-side paginated accounts API', () => {
  assert.match(
    crmJs,
    /api\(\s*[`']\/accounts(?:\?|[`'])/,
    'the customer list must call GET /accounts instead of filtering the bootstrap snapshot',
  );
  assert.match(
    salesCrmSource,
    /app\.get\('\/api\/sales-crm\/accounts'/,
    'the paginated server endpoint must exist',
  );
  assert.match(
    salesCrmSource,
    /pageSize|page_size/,
    'the server implementation must expose bounded pagination',
  );
});

test('management routes are explicit and export reuses the authorized filter validator', () => {
  for (const route of [
    "app.get('/api/sales-crm/filter-permissions'",
    "app.put('/api/sales-crm/filter-permissions/groups/:groupId'",
    "app.put('/api/sales-crm/filter-permissions/users/:userId'",
    "app.patch('/api/sales-crm/filter-permissions/definitions/:filterKey'",
  ]) {
    assert.match(
      salesCrmSource,
      new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `missing management route ${route}`,
    );
  }

  assert.match(
    salesCrmSource,
    /require\('\.\/filter_authorization'\)/,
    'the HTTP layer must use the authorization kernel',
  );
  const exportSource = functionSlice(salesCrmSource, 'exportCrmData', 'exportCrmCsv');
  assert.match(
    exportSource,
    /validateFilterQuery\(/,
    'export must validate the same authorized filter AST as the list',
  );
});

test('sensitive customer search and filter fields are not queried without their data permission', () => {
  const customerFiltersSource = fs.readFileSync(
    path.join(root, 'lib', 'customer_filters.js'),
    'utf8',
  );
  assert.match(customerFiltersSource, /canViewContacts/);
  assert.match(customerFiltersSource, /canViewInsights/);
  assert.match(customerFiltersSource, /if \(!canViewInsights\) throw unauthorizedFilter\(\)/);
  assert.match(customerFiltersSource, /FILTER_NOT_AUTHORIZED/);
  assert.match(salesCrmSource, /if \(!hasPermission\(user, 'view_contacts'\)\)/);
});
