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

// 阶段 B §1 完成门：next_action/next_action_at/next_action_time_basis/updated_at 属于
// collaboration_write 计划网关，不得在裸 crm_accounts UPDATE 中直写。last_activity_at 是活动时间戳，不在网关列。
// 编排下沉后，addQuote/addOrder 为薄委托，计划网关调用改在 write.js commit 服务内。
function assertNoPlanColumns(body, label) {
  assert.doesNotMatch(
    body,
    /UPDATE crm_accounts SET[^)]*(?:next_action\s*=|next_action_at\s*=|next_action_time_basis\s*=|(?<![a-z_])updated_at\s*=)/,
    `${label}: plan columns must be written through the collaboration_write gateway`,
  );
  assert.doesNotMatch(body, /applyAccountPlanPatch\(/, `${label}: must not contain plan gateway call (now in write.js commit service)`);
}

test('addQuote routes its next-action write through the plan gateway', () => {
  assertNoPlanColumns(
    functionSlice(salesCrmSource, 'addQuote', 'addOrder'),
    'addQuote',
  );
});

test('addOrder routes its next-action write through the plan gateway', () => {
  assertNoPlanColumns(
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

test('quote write keeps next-action plan fields after the plan-gateway convergence', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='rfq' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-PLAN-Q', 'CRM-WU');

  const res = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', rfqId: 'RFQ-PLAN-Q', amount: 1000, currency: 'USD', grossMargin: 5,
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

test('order write keeps next-action plan fields after the plan-gateway convergence', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='quoted' WHERE id='CRM-WU'").run();
  insertRfq(fx, 'RFQ-PLAN-ORD', 'CRM-WU');
  insertQuoteForRfq(fx, 'QUOTE-PLAN-ORD', 'RFQ-PLAN-ORD', 'CRM-WU');

  const res = await fx.request('/api/sales-crm/orders', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', quoteId: 'QUOTE-PLAN-ORD', amount: 1000, currency: 'USD',
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