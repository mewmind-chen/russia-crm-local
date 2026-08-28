'use strict';

// Compatibility facade for the identity domain. The implementation remains in
// access_control.js until each call site has a contract test and migration point.
const accessControl = require('../../access_control');

module.exports = Object.freeze({
  PERMISSION_DEFINITIONS: accessControl.PERMISSION_DEFINITIONS,
  PERMISSION_DESCRIPTIONS: accessControl.PERMISSION_DESCRIPTIONS,
  ROLE_PERMISSIONS: accessControl.ROLE_PERMISSIONS,
  permissionsFor: accessControl.permissionsFor,
  hasPermission: accessControl.hasPermission,
  assertPermission: accessControl.assertPermission,
  buildAccessContext: accessControl.buildAccessContext,
  assertAccountAccess: accessControl.assertAccountAccess,
  assertExternalCustomerAccess: accessControl.assertExternalCustomerAccess,
  redactContactFields: accessControl.redactContactFields,
  contactSafePoolRecord: accessControl.contactSafePoolRecord,
  contactSafeReconRecord: accessControl.contactSafeReconRecord,
  contactSafeAccountRecord: accessControl.contactSafeAccountRecord,
  contactSafePipelineRecord: accessControl.contactSafePipelineRecord,
  contactSafeInsightsRecord: accessControl.contactSafeInsightsRecord,
  policyForLegacyRequest: accessControl.policyForLegacyRequest,
  policyForSalesRequest: accessControl.policyForSalesRequest,
  assertPolicyAllowed: accessControl.assertPolicyAllowed,
  forbidden: accessControl.forbidden,
});
