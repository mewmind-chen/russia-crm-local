'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fixtures = require('./helpers/permission_fixture');

async function fixture() {
  return fixtures.seededFixture({
    managerViewAll: false,
    permissions: {
      use_ai_assistant: true,
      record_activity: true,
      record_quote: true,
      record_order: true,
      view_customers: true,
    },
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
}

function insertRfq(fx) {
  const now = '2026-07-25 08:00:00';
  fx.db.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,reference,status,bom_lines,expected_value,product_category,completeness,received_at,quoted_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'RFQ-A3-05', 'CRM-OWN', 'U-MGR', 'RFQ-A3-05', 'open', 12, 18000,
    'MCU', 90, now, '', now,
  );
}

test('RFQ and commerce fields fail closed before any business write', async t => {
  const fx = await fixture();
  t.after(() => fx.close());
  insertRfq(fx);

  const invalidAmount = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.cookie, method: 'POST',
    body: { customerId: 'CRM-OWN', rfqId: 'RFQ-A3-05', amount: 0, currency: 'USD', grossMargin: 8 },
  });
  assert.equal(invalidAmount.status, 400);

  const invalidMargin = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.cookie, method: 'POST',
    body: { customerId: 'CRM-OWN', rfqId: 'RFQ-A3-05', amount: 1000, currency: 'USD', grossMargin: -2 },
  });
  assert.equal(invalidMargin.status, 400);

  const invalidOrder = await fx.request('/api/sales-crm/orders', {
    cookie: fx.cookie, method: 'POST',
    body: { customerId: 'CRM-OWN', amount: 1000, currency: 'USD', grossMargin: 5 },
  });
  assert.equal(invalidOrder.status, 400);
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM crm_quotes').get().n, 0);
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM crm_orders').get().n, 0);
});

test('quote and order writes are human-authorized and idempotent', async t => {
  const fx = await fixture();
  t.after(() => fx.close());
  insertRfq(fx);

  const quotePayload = {
    customerId: 'CRM-OWN',
    rfqId: 'RFQ-A3-05',
    amount: 12500,
    currency: 'USD',
    grossMargin: 8,
    nextFollowAt: '2026-07-30 09:00:00',
    idempotencyKey: 'a3-05-quote-1',
  };
  const firstQuoteResponse = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.cookie, method: 'POST', body: quotePayload,
  });
  assert.equal(firstQuoteResponse.status, 200);
  const firstQuote = await firstQuoteResponse.json();
  assert.match(firstQuote.quoteId, /^Q-/);

  const replayQuoteResponse = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.cookie, method: 'POST', body: quotePayload,
  });
  assert.equal(replayQuoteResponse.status, 200);
  assert.equal((await replayQuoteResponse.json()).deduplicated, true);
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM crm_quotes').get().n, 1);

  const orderPayload = {
    customerId: 'CRM-OWN',
    quoteId: firstQuote.quoteId,
    amount: 12500,
    currency: 'USD',
    grossMargin: 6,
    nextActionAt: '2026-08-08 09:00:00',
    idempotencyKey: 'a3-05-order-1',
  };
  const firstOrderResponse = await fx.request('/api/sales-crm/orders', {
    cookie: fx.cookie, method: 'POST', body: orderPayload,
  });
  assert.equal(firstOrderResponse.status, 200);
  const firstOrder = await firstOrderResponse.json();
  assert.match(firstOrder.orderId, /^ORD-/);

  const replayOrderResponse = await fx.request('/api/sales-crm/orders', {
    cookie: fx.cookie, method: 'POST', body: orderPayload,
  });
  assert.equal(replayOrderResponse.status, 200);
  assert.equal((await replayOrderResponse.json()).deduplicated, true);
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM crm_orders').get().n, 1);

  const requestRows = fx.db.prepare(`SELECT action,status FROM crm_commerce_action_requests
    WHERE idempotency_key LIKE 'a3-05-%' ORDER BY action`).all();
  assert.deepEqual(requestRows, [
    { action: 'order', status: 'completed' },
    { action: 'quote', status: 'completed' },
  ]);
});

test('order form requires an explicit quote and client idempotency key', () => {
  const source = fs.readFileSync('sales-assets/app.js', 'utf8');
  const orderModal = source.match(/function openOrderModal\(customerId\) \{[\s\S]*?^  \}/m)?.[0] || '';
  assert.match(orderModal, /name="quoteId" required/);
  assert.match(orderModal, /name="idempotencyKey"/);
});
