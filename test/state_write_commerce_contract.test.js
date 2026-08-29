'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.join(__dirname, '..');
const salesCrmSource = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');
const NOW = '2026-08-29 09:00:00';

function functionSlice(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = nextFunctionName
    ? source.indexOf(`function ${nextFunctionName}(`, start + 1)
    : source.length;
  if (nextFunctionName) assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return source.slice(start, end);
}

// 阶段 B §1 完成门：stage/updated_at 属于 state_write 网关，不得在裸 crm_accounts UPDATE 中直写。
// next_action*/last_activity_at 属计划/活动字段，本切片暂不在收敛范围。
function assertNoStateColumns(body, label) {
  assert.doesNotMatch(
    body,
    /UPDATE crm_accounts SET[^)]*(?:stage\s*=|lifecycle_status\s*=|assignment_status\s*=|(?<![a-z_])owner_id\s*=|(?<![a-z_])updated_at\s*=)/,
    `${label}: stage/lifecycle/assignment/owner/updated_at must be written through the state_write gateway`,
  );
  assert.match(body, /applyAccountStatePatch\(/, `${label}: must route the account-state write through the gateway`);
}

test('addQuote routes its stage write through the lifecycle gateway', () => {
  assertNoStateColumns(
    functionSlice(salesCrmSource, 'addQuote', 'addOrder'),
    'addQuote',
  );
});

test('addOrder routes its stage write through the lifecycle gateway', () => {
  assertNoStateColumns(
    functionSlice(salesCrmSource, 'addOrder', 'reserveCustomerCreate'),
    'addOrder',
  );
});

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

test('quote write keeps the full account row: stage advanced plus plan/last-activity fields', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='rfq' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-COMMERCE-Q', 'CRM-WU');

  const res = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', rfqId: 'RFQ-COMMERCE-Q', amount: 1000, currency: 'USD', grossMargin: 5,
      sentAt: '2026-08-28 14:00:00', nextFollowAt: '2099-08-01 09:00:00',
    },
  });
  assert.equal(res.status, 200, await res.text());

  const row = fx.db.prepare(`SELECT stage,last_activity_at,next_action,next_action_at,next_action_time_basis,updated_at
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(row.stage, 'quoted');
  assert.equal(row.last_activity_at, '2026-08-28 14:00:00');
  assert.equal(row.next_action, '报价后跟进');
  assert.ok(row.next_action_at, 'next_action_at must be preserved');
  assert.equal(row.next_action_time_basis, 'utc');
  assert.ok(row.updated_at);
});

test('first order write keeps the full account row: stage to won plus plan fields', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='quoted' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-COMMERCE-ORD', 'CRM-WU');
  insertQuoteForRfq(fx, 'QUOTE-COMMERCE-ORD', 'RFQ-COMMERCE-ORD', 'CRM-WU');

  const res = await fx.request('/api/sales-crm/orders', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', quoteId: 'QUOTE-COMMERCE-ORD', amount: 1000, currency: 'USD',
      grossMargin: 5, orderedAt: '2026-08-28 15:00:00', nextActionAt: '2099-08-08 09:00:00',
    },
  });
  assert.equal(res.status, 200, await res.text());

  const row = fx.db.prepare(`SELECT stage,last_activity_at,next_action,next_action_at,next_action_time_basis,updated_at
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(row.stage, 'won');
  assert.equal(row.last_activity_at, '2026-08-28 15:00:00');
  assert.equal(row.next_action, '首单交付与复购培育');
  assert.ok(row.next_action_at, 'next_action_at must be preserved');
  assert.equal(row.next_action_time_basis, 'utc');
  assert.ok(row.updated_at);
});

test('repeat order write keeps the full account row: stage to repeat plus plan fields', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='won' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-COMMERCE-REP', 'CRM-WU');
  insertQuoteForRfq(fx, 'QUOTE-COMMERCE-REP', 'RFQ-COMMERCE-REP', 'CRM-WU');

  const res = await fx.request('/api/sales-crm/orders', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', quoteId: 'QUOTE-COMMERCE-REP', amount: 1000, currency: 'USD',
      grossMargin: 5, isRepeat: true, orderedAt: '2026-08-28 16:00:00', nextActionAt: '2099-08-09 09:00:00',
    },
  });
  assert.equal(res.status, 200, await res.text());

  const row = fx.db.prepare(`SELECT stage,last_activity_at,next_action,next_action_at,next_action_time_basis,updated_at
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(row.stage, 'repeat');
  assert.equal(row.last_activity_at, '2026-08-28 16:00:00');
  assert.equal(row.next_action, '维护复购关系');
  assert.ok(row.next_action_at, 'next_action_at must be preserved');
  assert.equal(row.next_action_time_basis, 'utc');
  assert.ok(row.updated_at);
});