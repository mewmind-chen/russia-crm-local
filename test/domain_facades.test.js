'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const identity = require('../lib/domains/identity');
const accessControl = require('../lib/access_control');
const filter = require('../lib/domains/filter');
const filterAuthorization = require('../lib/filter_authorization');
const filterCatalog = require('../lib/filter_catalog');

test('identity facade delegates to the existing access-control source of truth', () => {
  for (const name of [
    'permissionsFor', 'hasPermission', 'assertPermission', 'buildAccessContext',
    'assertAccountAccess', 'assertExternalCustomerAccess', 'policyForSalesRequest',
    'assertPolicyAllowed', 'forbidden',
  ]) {
    assert.equal(identity[name], accessControl[name], `${name} must remain an exact delegate`);
  }
});

test('identity facade preserves permission outputs and denial status', () => {
  const user = { id: 'U-1', role: 'sales', permissions: { view_customers: true } };
  assert.deepEqual(identity.permissionsFor(user), accessControl.permissionsFor(user));
  assert.equal(identity.hasPermission(user, 'view_customers'), accessControl.hasPermission(user, 'view_customers'));
  assert.throws(() => identity.assertPermission(user, 'view_contacts'), error => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.message, '没有权限：客户联系人线索');
    return true;
  });
});

test('filter facade delegates catalog and authorization without changing identity', () => {
  for (const name of [
    'installFilterAuthorization', 'getFilterPermissionVersion', 'listFilterDefinitions',
    'listAvailableFilterSources', 'effectiveFilterSchemaFor', 'saveGroupFilterGrants',
    'saveUserExtraFilterGrants', 'restoreUserExtraFilterGrants', 'updateFilterDefinition',
    'createFilterDefinition', 'validateFilterQuery',
  ]) {
    assert.equal(filter[name], filterAuthorization[name], `${name} must remain an exact delegate`);
  }
  assert.equal(filter.FILTER_DEFINITIONS, filterCatalog.FILTER_DEFINITIONS);
  assert.equal(filter.FILTER_SOURCE_CATALOG, filterCatalog.FILTER_SOURCE_CATALOG);
});

test('filter facade exposes stable page requirements and operators', () => {
  assert.deepEqual(filter.PAGE_REQUIRED_PERMISSIONS.customers, ['view_customers']);
  assert.deepEqual(filter.FILTER_OPERATORS.text, ['contains']);
  assert.ok(filter.FILTER_DEFINITIONS.some(item => item.key === 'customer_type'));
});
