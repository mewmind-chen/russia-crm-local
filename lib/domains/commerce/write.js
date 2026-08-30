'use strict';

// Commerce row-level writes (crm_rfqs / crm_quotes / crm_orders). These are
// pure SQL inserts/updates with no error construction, so they are drop-in
// interchangeable with the inlined statements they replace. All timestamp and
// id values are supplied by call sites so behavior is byte-for-byte identical.

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

module.exports = Object.freeze({
  insertRfqRow,
  insertQuoteRow,
  markRfqQuoted,
  insertOrderRow,
});