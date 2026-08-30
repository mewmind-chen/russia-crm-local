'use strict';

// Commerce validation and idempotency helpers. Error construction is injected
// by call sites so the original badRequest semantics stay unchanged.

const crypto = require('crypto');
const { STAGE_INDEX } = require('../../customer_stages');

function defaultBadRequest(message) {
  return new Error(message);
}

const COMMERCE_CURRENCIES = new Set(['USD', 'EUR', 'CNY', 'RUB', 'GBP']);

function validateMoney(value, label, options = {}) {
  const badRequest = options.badRequest || defaultBadRequest;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
    throw badRequest(`${label}必须是大于0的有效金额`);
  }
  return Math.round(amount * 100) / 100;
}

function validateCurrency(value, options = {}) {
  const badRequest = options.badRequest || defaultBadRequest;
  const currency = String(value || 'USD').trim().toUpperCase();
  if (!COMMERCE_CURRENCIES.has(currency)) throw badRequest('不支持的报价或订单币种');
  return currency;
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

function advanceStage(current, proposed) {
  if (!proposed) return current;
  if (proposed === 'lost') return proposed;
  if (current === 'lost') return proposed;
  return (STAGE_INDEX[proposed] ?? -1) > (STAGE_INDEX[current] ?? -1) ? proposed : current;
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
  advanceStage,
  COMMERCE_CURRENCIES,
  validateMoney,
  validateCurrency,
  validateMargin,
  validateRfqPayload,
  commerceActionIdempotencyKey,
});