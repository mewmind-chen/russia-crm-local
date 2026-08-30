'use strict';

// Commerce action-request idempotency lifecycle (quote/order reservations on
// crm_commerce_action_requests). Error construction and helpers are injected by
// call sites so the original sales_crm semantics stay unchanged.

const { commerceActionIdempotencyKey } = require('./rules');

function defaultConflictError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function defaultJson(value, fallback) {
  try { return JSON.parse(value || JSON.stringify(fallback || {})); }
  catch (_error) { return fallback || {}; }
}

function defaultNowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function reserveCommerceAction(value, user, action, payload, customerId, options = {}) {
  const conflictError = options.conflictError || defaultConflictError;
  const json = options.json || defaultJson;
  const nowText = options.nowText || defaultNowText;
  const key = commerceActionIdempotencyKey(user, action, payload, customerId);
  let existing = value.prepare('SELECT * FROM crm_commerce_action_requests WHERE idempotency_key=?').get(key);
  if (!existing) {
    const inserted = value.prepare(`INSERT OR IGNORE INTO crm_commerce_action_requests
      (idempotency_key,actor_id,action,customer_id,status,response_json,created_at,updated_at)
      VALUES (?,?,?,?, 'started','{}',?,?)`).run(key, user.id, action, customerId, nowText(), nowText());
    if (inserted.changes === 1) return { key, replay: null };
    existing = value.prepare('SELECT * FROM crm_commerce_action_requests WHERE idempotency_key=?').get(key);
  }
  if (existing.actor_id !== user.id || existing.action !== action || existing.customer_id !== customerId) {
    throw conflictError('幂等键已绑定其他报价或订单操作', 'COMMERCE_IDEMPOTENCY_CONFLICT');
  }
  if (existing.status === 'completed') {
    return { key, replay: { ...json(existing.response_json, {}), deduplicated: true } };
  }
  throw conflictError('相同报价或订单操作正在处理中', 'COMMERCE_ACTION_IN_PROGRESS');
}

function completeCommerceAction(value, key, response, options = {}) {
  const nowText = options.nowText || defaultNowText;
  value.prepare(`UPDATE crm_commerce_action_requests
    SET status='completed',response_json=?,updated_at=? WHERE idempotency_key=? AND status='started'`)
    .run(JSON.stringify(response), nowText(), key);
}

function clearCommerceActionReservation(value, key) {
  value.prepare("DELETE FROM crm_commerce_action_requests WHERE idempotency_key=? AND status='started'").run(key);
}

module.exports = Object.freeze({
  reserveCommerceAction,
  completeCommerceAction,
  clearCommerceActionReservation,
});
