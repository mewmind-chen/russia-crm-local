'use strict';

// Customer recycle-domain helpers. HTTP error construction is injected by
// call sites so the original httpError semantics stay unchanged.

function defaultHttpError(_statusCode, message) {
  return new Error(message);
}

function validateRecycleReason(value, options = {}) {
  const httpError = options.httpError || defaultHttpError;
  const reason = String(value || '').trim();
  if (reason.length < 2 || reason.length > 500) {
    throw httpError(400, '退回或删除原因必须为2至500个字符', 'INVALID_RECYCLE_REASON');
  }
  return reason;
}

module.exports = Object.freeze({
  validateRecycleReason,
});
