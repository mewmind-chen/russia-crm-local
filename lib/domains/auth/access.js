'use strict';

// Access-aware not-found errors. A full-scope actor gets the real missing
// message with 404; scoped actors are told they have no access with 403 so
// row existence is not leaked.

const { hasPermission } = require('../identity');

function inaccessibleOrMissing(user, missingMessage) {
  const fullScope = hasPermission(user, 'view_all_customers') && hasPermission(user, 'manage_intake');
  const error = new Error(fullScope ? missingMessage : '无权访问该客户');
  error.statusCode = fullScope ? 404 : 403;
  return error;
}

module.exports = Object.freeze({
  inaccessibleOrMissing,
});