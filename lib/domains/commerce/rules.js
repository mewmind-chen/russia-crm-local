'use strict';

// Commerce validation and idempotency helpers. Error construction is injected
// by call sites so the original badRequest semantics stay unchanged.

const crypto = require('crypto');

function defaultBadRequest(message) {
  return new Error(message);
}

function validateMargin(value, allowNegative, options = {}) {
  const badRequest = options.badRequest || defaultBadRequest;
  const margin = Number(value || 0);
  if (!Number.isFinite(margin) || margin < (allowNegative ? -100 : 0) || margin > 100) {
    throw badRequest('毛利率必须在有效范围内');
  }
  return Math.round(margin * 10) / 10;
}

function validateRfqPayload(payload = {}, options = {}) {
  const badRequest = options.badRequest || defaultBadRequest;
  const bomLines = Number(payload.bomLines || 0);
  const expectedValue = Number(payload.expectedValue || 0);
  const completeness = Number(payload.completeness || 0);
  if (!Number.isInteger(bomLines) || bomLines < 0 || bomLines > 100000) {
    throw badRequest('BOM 行数必须是有效整数');
  }
  if (!Number.isFinite(expectedValue) || expectedValue < 0 || expectedValue > 1e12) {
    throw badRequest('询价预估金额无效');
  }
  if (!Number.isInteger(completeness) || completeness < 0 || completeness > 100) {
    throw badRequest('询价资料完整度必须为0至100');
  }
}

function commerceActionIdempotencyKey(user, action, payload, customerId) {
  const requested = String(payload.idempotencyKey || payload.clientRequestId || '').trim();
  if (requested) return requested.slice(0, 240);
  const canonical = {
    actorId: user.id,
    action,
    customerId,
    rfqId: String(payload.rfqId || ''),
    quoteId: String(payload.quoteId || ''),
    amount: String(payload.amount || ''),
    currency: String(payload.currency || ''),
    grossMargin: String(payload.grossMargin || ''),
    lossLeader: Boolean(payload.lossLeader),
    isRepeat: Boolean(payload.isRepeat),
    nextFollowAt: String(payload.nextFollowAt || ''),
    nextActionAt: String(payload.nextActionAt || ''),
  };
  return `commerce:${crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

module.exports = Object.freeze({
  validateMargin,
  validateRfqPayload,
  commerceActionIdempotencyKey,
});