'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

const NOW = '2026-08-29 09:00:00';

function insertRfq(fx, id, customerId) {
  fx.db.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,reference,status,bom_lines,expected_value,product_category,completeness,received_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, customerId, 'USR-ADMIN', id, 'open', 1, 1000, 'MCU', 80, NOW, NOW);
  return id;
}

function insertQuoteForRfq(fx, quoteId, rfqId, customerId) {
  fx.db.prepare(`INSERT INTO crm_quotes
    (id,rfq_id,customer_id,user_id,amount,currency,gross_margin,status,sent_at,created_at)
    VALUES (?,?,?,?,?,?,?,'sent',?,?)`).run(
    quoteId, rfqId, customerId, 'USR-ADMIN', 1000, 'USD', 5, NOW, NOW,
  );
  return quoteId;
}

test('quoting is blocked when the account is already beyond the quoted stage', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='won' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-STAGE-Q', 'CRM-WU');

  const res = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', rfqId: 'RFQ-STAGE-Q', amount: 1000, currency: 'USD', grossMargin: 5,
      nextFollowAt: '2099-08-01 09:00:00',
    },
  });
  const body = await res.json();
  assert.equal(res.status, 409, JSON.stringify(body));
  assert.equal(body.code, 'STAGE_PRECONDITION_VIOLATION');
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM crm_quotes').get().n, 0);
  assert.equal(fx.db.prepare("SELECT stage FROM crm_accounts WHERE id='CRM-WU'").get().stage, 'won');
});

test('quoting succeeds from the quoted stage and advances the account', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='rfq' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-STAGE-OK', 'CRM-WU');

  const res = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', rfqId: 'RFQ-STAGE-OK', amount: 1000, currency: 'USD', grossMargin: 5,
      nextFollowAt: '2099-08-01 09:00:00',
    },
  });
  assert.equal(res.status, 200, await res.text());
  assert.equal(fx.db.prepare("SELECT stage FROM crm_accounts WHERE id='CRM-WU'").get().stage, 'quoted');
});

test('a first order is blocked when the account is beyond the won stage', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='repeat' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-STAGE-FORDER', 'CRM-WU');
  insertQuoteForRfq(fx, 'QUOTE-STAGE-FORDER', 'RFQ-STAGE-FORDER', 'CRM-WU');

  const res = await fx.request('/api/sales-crm/orders', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', quoteId: 'QUOTE-STAGE-FORDER', amount: 1000, currency: 'USD',
      grossMargin: 5, nextActionAt: '2099-08-08 09:00:00',
    },
  });
  const body = await res.json();
  assert.equal(res.status, 409, JSON.stringify(body));
  assert.equal(body.code, 'STAGE_PRECONDITION_VIOLATION');
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM crm_orders').get().n, 0);
  assert.equal(fx.db.prepare("SELECT stage FROM crm_accounts WHERE id='CRM-WU'").get().stage, 'repeat');
});

test('a repeat order is allowed from any stage (contract: 复购单前 stage 任意) and advances to repeat', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='lost' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-STAGE-REPEAT', 'CRM-WU');
  insertQuoteForRfq(fx, 'QUOTE-STAGE-REPEAT', 'RFQ-STAGE-REPEAT', 'CRM-WU');

  const res = await fx.request('/api/sales-crm/orders', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', quoteId: 'QUOTE-STAGE-REPEAT', amount: 1000, currency: 'USD',
      grossMargin: 5, isRepeat: true, nextActionAt: '2099-08-08 09:00:00',
    },
  });
  assert.equal(res.status, 200, await res.text());
  assert.equal(fx.db.prepare("SELECT stage FROM crm_accounts WHERE id='CRM-WU'").get().stage, 'repeat');
});