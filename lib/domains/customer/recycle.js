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

function mismatchRecordNotFound(options = {}) {
  const httpError = options.httpError || defaultHttpError;
  return httpError(404, '不对口记录不存在', 'MISMATCH_RECORD_NOT_FOUND');
}

function parseMismatchRecordKey(recordKey, options = {}) {
  const decoded = String(recordKey || '').trim();
  const parts = decoded.split(':');
  if (parts.length !== 2 || !['account', 'intake'].includes(parts[0]) || !parts[1]) {
    throw mismatchRecordNotFound(options);
  }
  return { sourceType: parts[0], sourceId: parts[1], recordKey: decoded };
}

function assertCustomerReturnEligible(account, options = {}) {
  const httpError = options.httpError || defaultHttpError;
  const assignmentStatus = String(account?.assignment_status || '');
  if (assignmentStatus === 'returned'
      || String(account?.lifecycle_status || 'active') !== 'active') {
    throw httpError(
      409,
      '客户当前状态不可退回',
      'CUSTOMER_RETURN_STATE_INVALID',
    );
  }
  return account;
}

function manualReturnBatchId(at) {
  return `BATCH-MANUAL-RETURN-${at.slice(0, 10).replaceAll('-', '')}`;
}

module.exports = Object.freeze({
  validateRecycleReason,
  mismatchRecordNotFound,
  parseMismatchRecordKey,
  assertCustomerReturnEligible,
  manualReturnBatchId,
});
