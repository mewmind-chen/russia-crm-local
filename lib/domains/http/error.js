'use strict';

// HTTP error construction. Errors carry a statusCode and an optional stable
// code used by the API response handler and tests.

function httpError(statusCode, message, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

const badRequest = message => httpError(400, message);
const notFound = message => httpError(404, message);
const conflictError = (message, code = '') => httpError(409, message, code);

module.exports = Object.freeze({
  httpError,
  badRequest,
  notFound,
  conflictError,
});