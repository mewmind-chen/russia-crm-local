'use strict';

// Compatibility facade for the filter domain. Filter catalog and authorization
// remain the source of truth while call sites migrate one contract at a time.
const authorization = require('../../filter_authorization');
const catalog = require('../../filter_catalog');

module.exports = Object.freeze({
  FILTER_TYPES: catalog.FILTER_TYPES,
  FILTER_OPERATORS: catalog.FILTER_OPERATORS,
  PAGE_REQUIRED_PERMISSIONS: catalog.PAGE_REQUIRED_PERMISSIONS,
  FILTER_DEFINITIONS: catalog.FILTER_DEFINITIONS,
  FILTER_SOURCE_CATALOG: catalog.FILTER_SOURCE_CATALOG,
  installFilterAuthorization: authorization.installFilterAuthorization,
  getFilterPermissionVersion: authorization.getFilterPermissionVersion,
  listFilterDefinitions: authorization.listFilterDefinitions,
  listAvailableFilterSources: authorization.listAvailableFilterSources,
  effectiveFilterSchemaFor: authorization.effectiveFilterSchemaFor,
  saveGroupFilterGrants: authorization.saveGroupFilterGrants,
  saveUserExtraFilterGrants: authorization.saveUserExtraFilterGrants,
  restoreUserExtraFilterGrants: authorization.restoreUserExtraFilterGrants,
  updateFilterDefinition: authorization.updateFilterDefinition,
  createFilterDefinition: authorization.createFilterDefinition,
  validateFilterQuery: authorization.validateFilterQuery,
});
