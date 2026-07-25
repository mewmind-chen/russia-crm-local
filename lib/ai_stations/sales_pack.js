'use strict';

const crypto = require('node:crypto');
const { buildCustomerContext } = require('./context');
const { createAIJobStore } = require('./jobs');
const { createNotification } = require('../crm_notifications');

function salesPackIdempotencyKey(customerId, contextHash, eventId = '') {
  const event = String(eventId || '').trim();
  return event
    ? `ai-station:sales_pack:v1:event:${event}`
    : `ai-station:sales_pack:v1:${customerId}:${contextHash}`;
}

function enqueueSalesPack(input = {}) {
  const context = buildCustomerContext(input.db, input.accessContext, input.customerId, {
    ...(input.contextOptions || {}),
    station: 'sales_pack',
  });
  const eventId = String(input.eventId || '').trim();
  return createAIJobStore(input.db).enqueue({
    customerId: input.customerId,
    crmAccountId: context.context.crmAccountId,
    station: 'sales_pack',
    contextHash: context.contextHash,
    payload: { contextVersion: 'crm-v1', stationVersion: 'v1', trigger: input.trigger || 'manual' },
    createdBy: input.actor?.id || '',
    priority: Number.isInteger(input.priority) ? input.priority : 20,
    ...(eventId ? { eventType: 'customer_claimed', eventId } : {}),
  }, salesPackIdempotencyKey(input.customerId, context.contextHash, eventId));
}

function recordSalesPackNotification(db, job, status, detail = '') {
  const ready = status === 'ready';
  const code = ready ? 'SALES_PACK_READY' : 'SALES_PACK_FAILED';
  const title = ready ? '销售资料包已生成' : '销售资料包生成失败';
  const dedupeKey = `sales-pack:${job.id}:${status}`;
  createNotification(db, {
    id: `NTF-${crypto.createHash('sha1').update(dedupeKey).digest('hex').slice(0, 16)}`,
    userId: job.createdBy,
    customerId: job.crmAccountId || job.customerId,
    code,
    severity: ready ? 'info' : 'warning',
    title,
    detail: String(detail || '').slice(0, 500),
    dedupeKey,
  }, { wecomEnabled: false });
}

module.exports = {
  enqueueSalesPack,
  recordSalesPackNotification,
  salesPackIdempotencyKey,
};
