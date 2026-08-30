'use strict';

// Commerce writes and the place-level commit services for the RFQ→quote→order
// business loop. Row-level writes (crm_rfqs / crm_quotes / crm_orders) are pure
// SQL with no error construction; the commit services orchestrate the whole
// addQuote/addOrder flow (permission → validation → reservation → transition
// guard → transaction → next_action enqueue → completion) so sales_crm has no
// inline commerce commit logic.

const { validateMoney, validateCurrency, validateMargin } = require('./rules');
const { reserveCommerceAction, completeCommerceAction, clearCommerceActionReservation } = require('./action_request');

function insertRfqRow(value, input) {
  value.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,activity_id,reference,status,bom_lines,expected_value,product_category,completeness,received_at,quoted_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.rfqId, input.customerId, input.userId, input.activityId, input.reference,
    input.status, input.bomLines, input.expectedValue, input.productCategory,
    input.completeness, input.receivedAt, input.quotedAt, input.createdAt,
  );
}

function insertQuoteRow(value, input) {
  value.prepare(`INSERT INTO crm_quotes
    (id,rfq_id,customer_id,user_id,activity_id,amount,currency,gross_margin,loss_leader,status,sent_at,next_follow_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.quoteId, input.rfqId, input.customerId, input.userId, input.activityId,
    input.amount, input.currency, input.grossMargin, input.lossLeader ? 1 : 0,
    input.status, input.sentAt, input.nextFollowAt, input.createdAt,
  );
}

function markRfqQuoted(value, input) {
  value.prepare("UPDATE crm_rfqs SET status='quoted',quoted_at=? WHERE id=?")
    .run(input.quotedAt, input.rfqId);
}

function insertOrderRow(value, input) {
  value.prepare(`INSERT INTO crm_orders
    (id,customer_id,quote_id,user_id,activity_id,amount,currency,gross_margin,is_repeat,ordered_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    input.orderId, input.customerId, input.quoteId, input.userId, input.activityId,
    input.amount, input.currency, input.grossMargin, input.isRepeat ? 1 : 0,
    input.orderedAt, input.createdAt,
  );
}

// Place-level commit service for the quote step. Orphans the whole
// addQuote flow so sales_crm only opens the db and injects dependencies.
function commitQuote(value, user, payload = {}, deps = {}, options = {}) {
  const {
    assertPermission, badRequest, conflictError, json, nowText, id, parseBusinessDateTime,
    getAccountForUser, assertQuoteTransition, applyAccountStatePatch, applyAccountPlanPatch,
    PLAN_TIME_BASIS, linkCommerceActivity, recordExplicitPlanIfEnabled, enqueueNextActionForEvent,
  } = deps;
  assertPermission(user, 'record_quote');
  let reservation;
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const amount = validateMoney(payload.amount, '报价金额', { badRequest });
    const currency = validateCurrency(payload.currency, { badRequest });
    const grossMargin = validateMargin(payload.grossMargin, Boolean(payload.lossLeader), { badRequest });
    const nextFollowAt = parseBusinessDateTime(payload.nextFollowAt);
    const sentAt = String(payload.sentAt || nowText());
    const rfq = payload.rfqId ? value.prepare('SELECT * FROM crm_rfqs WHERE id=? AND customer_id=?').get(payload.rfqId, account.id)
      : value.prepare('SELECT * FROM crm_rfqs WHERE customer_id=? ORDER BY received_at DESC LIMIT 1').get(account.id);
    if (!rfq) throw new Error('请先记录客户询价');
    reservation = reserveCommerceAction(value, user, 'quote', payload, account.id, {
      conflictError,
      json,
      nowText,
    });
    if (reservation.replay) return reservation.replay;
    assertQuoteTransition(account, { conflictError });
    const quoteId = id('Q');
    const activityId = id('ACT');
    const transaction = value.transaction(() => {
      insertQuoteRow(value, {
        quoteId,
        rfqId: rfq.id,
        customerId: account.id,
        userId: user.id,
        activityId,
        amount,
        currency,
        grossMargin,
        lossLeader: payload.lossLeader,
        status: 'sent',
        sentAt,
        nextFollowAt,
        createdAt: nowText(),
      });
      markRfqQuoted(value, { quotedAt: sentAt, rfqId: rfq.id });
      const updatedAt = nowText();
      applyAccountStatePatch(value, account.id, { stage: 'quoted', updatedAt });
      applyAccountPlanPatch(value, account.id, {
        nextAction: '报价后跟进',
        nextActionAt: nextFollowAt,
        timeBasis: PLAN_TIME_BASIS,
        updatedAt,
      });
      value.prepare(`UPDATE crm_accounts SET last_activity_at=? WHERE id=?`)
        .run(sentAt, account.id);
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        activityId, account.id, user.id, 'quote', 'email', '已发送',
        `报价 ${Number(payload.amount || 0).toLocaleString()} ${String(payload.currency || 'USD')}${payload.lossLeader ? ' · 首单引流价' : ''}`,
        '报价后跟进', nextFollowAt, 'quoted', 0, sentAt, nowText(),
      );
      linkCommerceActivity(value, { activityId, entityType: 'quote', entityId: quoteId });
      recordExplicitPlanIfEnabled(
        value, account, user.id, '报价后跟进', nextFollowAt, 'quote', quoteId,
      );
    });
    transaction();
    const currentAccount = value.prepare('SELECT * FROM crm_accounts WHERE id=?').get(account.id);
    const nextActionJobId = enqueueNextActionForEvent(
      value, user, currentAccount, 'quote_sent', quoteId, options,
    );
    const response = { quoteId, activityId, nextActionJobId };
    completeCommerceAction(value, reservation.key, response, { nowText });
    return response;
  } catch (error) {
    if (reservation?.key) clearCommerceActionReservation(value, reservation.key);
    throw error;
  }
}

// Place-level commit service for the order step. Orphans the whole addOrder
// flow so sales_crm only opens the db and injects dependencies.
function commitOrder(value, user, payload = {}, deps = {}) {
  const {
    assertPermission, badRequest, conflictError, json, nowText, id, parseBusinessDateTime,
    getAccountForUser, assertFirstOrderTransition, applyAccountStatePatch, applyAccountPlanPatch,
    PLAN_TIME_BASIS, linkCommerceActivity, recordExplicitPlanIfEnabled,
  } = deps;
  assertPermission(user, 'record_order');
  let reservation;
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const amount = validateMoney(payload.amount, '订单金额', { badRequest });
    const currency = validateCurrency(payload.currency, { badRequest });
    const grossMargin = validateMargin(payload.grossMargin, true, { badRequest });
    const nextActionAt = parseBusinessDateTime(payload.nextActionAt);
    const quoteId = String(payload.quoteId || '').trim();
    if (!quoteId) throw new Error('订单必须关联已有报价');
    const quote = value.prepare('SELECT * FROM crm_quotes WHERE id=? AND customer_id=?').get(quoteId, account.id);
    if (!quote) throw new Error('订单关联的报价不存在或不属于该客户');
    reservation = reserveCommerceAction(value, user, 'order', payload, account.id, {
      conflictError,
      json,
      nowText,
    });
    if (reservation.replay) return reservation.replay;
    const repeat = Boolean(payload.isRepeat);
    if (!repeat) {
      assertFirstOrderTransition(account, { conflictError });
    }
    const orderedAt = String(payload.orderedAt || nowText());
    const orderId = id('ORD');
    const activityId = id('ACT');
    const transaction = value.transaction(() => {
      insertOrderRow(value, {
        orderId,
        customerId: account.id,
        quoteId,
        userId: user.id,
        activityId,
        amount,
        currency,
        grossMargin,
        isRepeat: repeat,
        orderedAt,
        createdAt: nowText(),
      });
      const updatedAt = nowText();
      applyAccountStatePatch(value, account.id, { stage: repeat ? 'repeat' : 'won', updatedAt });
      applyAccountPlanPatch(value, account.id, {
        nextAction: repeat ? '维护复购关系' : '首单交付与复购培育',
        nextActionAt,
        timeBasis: PLAN_TIME_BASIS,
        updatedAt,
      });
      value.prepare(`UPDATE crm_accounts SET last_activity_at=? WHERE id=?`)
        .run(orderedAt, account.id);
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        activityId, account.id, user.id, repeat ? 'repeat_order' : 'order', 'business', repeat ? '复购' : '首单',
        `订单 ${Number(payload.amount || 0).toLocaleString()} ${String(payload.currency || 'USD')}`,
        repeat ? '维护复购关系' : '首单交付与复购培育', nextActionAt, repeat ? 'repeat' : 'won', 0, orderedAt, nowText(),
      );
      linkCommerceActivity(value, { activityId, entityType: 'order', entityId: orderId });
      recordExplicitPlanIfEnabled(
        value,
        account,
        user.id,
        repeat ? '维护复购关系' : '首单交付与复购培育',
        nextActionAt,
        'order',
        orderId,
      );
    });
    transaction();
    const response = { orderId, activityId };
    completeCommerceAction(value, reservation.key, response, { nowText });
    return response;
  } catch (error) {
    if (reservation?.key) clearCommerceActionReservation(value, reservation.key);
    throw error;
  }
}

module.exports = Object.freeze({
  insertRfqRow,
  insertQuoteRow,
  markRfqQuoted,
  insertOrderRow,
  commitQuote,
  commitOrder,
});