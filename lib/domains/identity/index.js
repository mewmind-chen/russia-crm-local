'use strict';

// Compatibility facade for the identity domain. The implementation remains in
// access_control.js until each call site has a contract test and migration point.
const accessControl = require('../../access_control');

module.exports = Object.freeze({
  permissionsFor: accessControl.permissionsFor,
  hasPermission: accessControl.hasPermission,
  assertPermission: accessControl.assertPermission,
  buildAccessContext: accessControl.buildAccessContext,
  assertAccountAccess: accessControl.assertAccountAccess,
  assertExternalCustomerAccess: accessControl.assertExternalCustomerAccess,
  policyForLegacyRequest: accessControl.policyForLegacyRequest,
  policyForSalesRequest: accessControl.policyForSalesRequest,
  assertPolicyAllowed: accessControl.assertPolicyAllowed,
  forbidden: accessControl.forbidden,
});
