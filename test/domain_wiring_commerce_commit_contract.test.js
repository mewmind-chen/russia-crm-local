'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');
const writeSource = fs.readFileSync(path.join(root, 'lib', 'domains', 'commerce', 'write.js'), 'utf8');
const { commitQuote, commitOrder } = require('../lib/domains/commerce/write');
const NOW = '2026-08-29 09:00:00';

function functionSlice(body, functionName, nextFunctionName) {
  const start = body.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = nextFunctionName
    ? body.indexOf(`function ${nextFunctionName}(`, start + 1)
    : body.length;
  if (nextFunctionName) assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return body.slice(start, end);
}

// 阶段 D 商业闭环第四片：addQuote/addOrder 的完整编排（权限/校验/幂等保留/事务/
// 活动计划链接/next_action 入队/完成清理）下沉为 write.js 的 place 级 commit 服务。
test('commitQuote/commitOrder are exported by the commerce write domain module', () => {
  assert.equal(typeof commitQuote, 'function');
  assert.equal(typeof commitOrder, 'function');
  // write.js 内部 require 同域 rules 与 action_request
  assert.match(writeSource, /const \{ validateMoney, validateCurrency, validateMargin \} = require\('\.\/rules'\);/);
  assert.match(writeSource, /const \{ reserveCommerceAction, completeCommerceAction, clearCommerceActionReservation \} = require\('\.\/action_request'\);/);
});

test('addQuote/addOrder are thin delegates that route through commitQuote/commitOrder', () => {
  const quoteBody = functionSlice(source, 'addQuote', 'addOrder');
  const orderBody = functionSlice(source, 'addOrder', 'reserveCustomerCreate');
  // 薄委托：打开 db → 调用 commit 服务（注入依赖）→ 关闭 db
  assert.match(quoteBody, /return commitQuote\(value, user, payload, \{/);
  assert.match(quoteBody, /enqueueNextActionForEvent,/);
  assert.match(orderBody, /return commitOrder\(value, user, payload, \{/);
  assert.doesNotMatch(orderBody, /enqueueNextActionForEvent/);
  // 事务体与裸 SQL 已不在 sales_crm 的 quote/order 函数内
  for (const body of [quoteBody, orderBody]) {
    assert.doesNotMatch(body, /value\.transaction\(/);
    assert.doesNotMatch(body, /INSERT INTO crm_activities/);
    assert.doesNotMatch(body, /UPDATE crm_accounts SET last_activity_at/);
    assert.doesNotMatch(body, /SELECT \* FROM crm_rfqs/);
    assert.doesNotMatch(body, /SELECT \* FROM crm_quotes/);
    assert.doesNotMatch(body, /assertQuoteTransition\(/);
    assert.doesNotMatch(body, /assertFirstOrderTransition\(/);
    assert.doesNotMatch(body, /reserveCommerceAction\(/);
    assert.doesNotMatch(body, /completeCommerceAction\(/);
  }
  // 而 commit 服务确实持有事务体与活动/链接逻辑
  assert.match(writeSource, /value\.transaction\(/);
  assert.match(writeSource, /INSERT INTO crm_activities/);
  assert.match(writeSource, /linkCommerceActivity\(/);
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

test('commitQuote end-to-end: response shape, activity link, and completed reservation', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='rfq' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-COMMIT-Q', 'CRM-WU');

  const res = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', rfqId: 'RFQ-COMMIT-Q', amount: 2500, currency: 'USD', grossMargin: 8,
      sentAt: '2026-08-28 14:00:00', nextFollowAt: '2099-08-01 09:00:00',
    },
  });
  if (res.status !== 200) assert.fail(`quote request failed: ${await res.text()}`);
  const json = await res.json();
  assert.ok(json.quoteId);
  assert.ok(json.activityId);

  const quote = fx.db.prepare('SELECT * FROM crm_quotes WHERE id=?').get(json.quoteId);
  assert.equal(quote.customer_id, 'CRM-WU');
  assert.equal(quote.rfq_id, 'RFQ-COMMIT-Q');
  assert.equal(quote.activity_id, json.activityId);
  assert.equal(quote.amount, 2500);
  const activity = fx.db.prepare('SELECT * FROM crm_activities WHERE id=?').get(json.activityId);
  assert.equal(activity.activity_type, 'quote');
  assert.equal(activity.customer_id, 'CRM-WU');
  const request = fx.db.prepare('SELECT * FROM crm_commerce_action_requests').all();
  assert.equal(request.length, 1);
  assert.equal(request[0].status, 'completed');
  assert.deepEqual(JSON.parse(request[0].response_json), {
    quoteId: json.quoteId,
    activityId: json.activityId,
    nextActionJobId: json.nextActionJobId,
  });
});

test('commitOrder end-to-end: won stage and reservation completion', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='quoted' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-COMMIT-ORD', 'CRM-WU');
  insertQuoteForRfq(fx, 'QUOTE-COMMIT-ORD', 'RFQ-COMMIT-ORD', 'CRM-WU');

  const res = await fx.request('/api/sales-crm/orders', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', quoteId: 'QUOTE-COMMIT-ORD', amount: 2500, currency: 'USD',
      grossMargin: 8, orderedAt: '2026-08-28 15:00:00', nextActionAt: '2099-08-08 09:00:00',
    },
  });
  if (res.status !== 200) assert.fail(`order request failed: ${await res.text()}`);
  const json = await res.json();
  assert.ok(json.orderId);
  assert.ok(json.activityId);

  const order = fx.db.prepare('SELECT * FROM crm_orders WHERE id=?').get(json.orderId);
  assert.equal(order.customer_id, 'CRM-WU');
  assert.equal(order.quote_id, 'QUOTE-COMMIT-ORD');
  assert.equal(order.activity_id, json.activityId);
  const account = fx.db.prepare("SELECT stage FROM crm_accounts WHERE id='CRM-WU'").get();
  assert.equal(account.stage, 'won');
  const request = fx.db.prepare('SELECT * FROM crm_commerce_action_requests').all();
  assert.equal(request.length, 1);
  assert.equal(request[0].status, 'completed');
});

test('commitQuote idempotency key replays the same response without a second write', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='rfq' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-COMMIT-REPLAY', 'CRM-WU');

  const body = {
    idempotencyKey: 'commit-quote-replay-1',
    customerId: 'CRM-WU', rfqId: 'RFQ-COMMIT-REPLAY', amount: 1200, currency: 'USD', grossMargin: 6,
    sentAt: '2026-08-28 16:00:00', nextFollowAt: '2099-08-03 09:00:00',
  };
  const first = await fx.request('/api/sales-crm/quotes', { cookie: fx.adminCookie, method: 'POST', body });
  if (first.status !== 200) assert.fail(`quote request failed: ${await first.text()}`);
  const firstJson = await first.json();

  const second = await fx.request('/api/sales-crm/quotes', { cookie: fx.adminCookie, method: 'POST', body });
  if (second.status !== 200) assert.fail(`quote request failed: ${await second.text()}`);
  const secondJson = await second.json();
  assert.equal(secondJson.quoteId, firstJson.quoteId);
  assert.equal(secondJson.deduplicated, true);

  const quoteCount = fx.db.prepare('SELECT COUNT(*) n FROM crm_quotes').get().n;
  assert.equal(quoteCount, 1);
  const activityCount = fx.db.prepare('SELECT COUNT(*) n FROM crm_activities').get().n;
  assert.equal(activityCount, 1);
});
