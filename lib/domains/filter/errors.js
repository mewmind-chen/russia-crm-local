'use strict';

// Filter-domain error constructors. HTTP error construction is injected by
// call sites so the original error semantics stay unchanged.

function defaultHttpError(_statusCode, message) {
  return new Error(message);
}

function filterVersionError(options = {}) {
  const httpError = options.httpError || defaultHttpError;
  return httpError(409, '筛选权限已更新，请重新加载筛选项', 'FILTER_VERSION_CONFLICT');
}

module.exports = Object.freeze({
  filterVersionError,
});