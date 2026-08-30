'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const os = require('node:os');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');
const { insertRfqRow, insertQuoteRow, markRfqQuoted, insertOrderRow } = require('../lib/domains/commerce/write');

function buildSchema() {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-write-')), 'crm.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE crm_rfqs (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL DEFAULT '', user_id TEXT NOT NULL DEFAULT '',
      activity_id TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
      bom_lines INTEGER NOT NULL DEFAULT 0, expected_value REAL NOT NULL DEFAULT 0,
      product_category TEXT NOT NULL DEFAULT '', completeness INTEGER NOT NULL DEFAULT 0,
      received_at TEXT NOT NULL DEFAULT '', quoted_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_quotes (
      id TEXT PRIMARY KEY, rfq_id TEXT NOT NULL DEFAULT '', customer_id TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL DEFAULT '', activity_id TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD', gross_margin REAL NOT NULL DEFAULT 0,
      loss_leader INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'sent',
      sent_at TEXT NOT NULL DEFAULT '', next_follow_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_orders (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL DEFAULT '', quote_id TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL DEFAULT '', activity_id TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD', gross_margin REAL NOT NULL DEFAULT 0,
      is_repeat INTEGER NOT NULL DEFAULT 0, ordered_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

// 阶段 D：RFQ/quote/order 行级写入与 commit 服务必须来自 domains/commerce/write，
// 不得内联；commitQuote/commitOrder 封装完整编排后，sales_crm 不再直接导入器级
// insert/row 函数。
test('commerce row writes and commit services are wired from the domain module, not inlined', () => {
  assert.match(source, /const \{\s*insertRfqRow,\s*commitQuote,\s*commitOrder,\s*\} = require\('\.\/domains\/commerce\/write'\);/);
  assert.doesNotMatch(source, /^function insertRfqRow\(/m);
  assert.doesNotMatch(source, /^function insertQuoteRow\(/m);
  assert.doesNotMatch(source, /^function markRfqQuoted\(/m);
  assert.doesNotMatch(source, /^function insertOrderRow\(/m);
  assert.doesNotMatch(source, /^function commitQuote\(/m);
  assert.doesNotMatch(source, /^function commitOrder\(/m);
  // sales_crm no longer imports the raw insert/row functions directly
  assert.doesNotMatch(source, /insertQuoteRow,?\s*$/m);
  assert.doesNotMatch(source, /markRfqQuoted,?\s*$/m);
  assert.doesNotMatch(source, /insertOrderRow,?\s*$/m);
});

test('insertQuoteRow and markRfqQuoted persist a sent quote linked to the rfq', () => {
  const db = buildSchema();
  const rfqId = 'RFQ-W1', quoteId = 'Q-W1';
  db.prepare(`INSERT INTO crm_rfqs (id,status,received_at,created_at) VALUES (?,?,?,?)`)
    .run(rfqId, 'open', '2026-07-25 08:00:00', '2026-07-25 08:00:00');
  insertQuoteRow(db, {
    quoteId, rfqId, customerId: 'ACC-1', userId: 'U-1', activityId: 'ACT-1',
    amount: 12500, currency: 'USD', grossMargin: 8, lossLeader: 0, status: 'sent',
    sentAt: '2026-07-26 09:00:00', nextFollowAt: '2026-07-29 09:00:00', createdAt: '2026-07-26 09:00:00',
  });
  markRfqQuoted(db, { quotedAt: '2026-07-26 09:00:00', rfqId });

  const quote = db.prepare('SELECT * FROM crm_quotes WHERE id=?').get(quoteId);
  assert.equal(quote.rfq_id, rfqId);
  assert.equal(quote.customer_id, 'ACC-1');
  assert.equal(quote.amount, 12500);
  assert.equal(quote.currency, 'USD');
  assert.equal(quote.gross_margin, 8);
  assert.equal(quote.loss_leader, 0);
  assert.equal(quote.status, 'sent');
  assert.equal(quote.next_follow_at, '2026-07-29 09:00:00');
  const rfq = db.prepare('SELECT * FROM crm_rfqs WHERE id=?').get(rfqId);
  assert.equal(rfq.status, 'quoted');
  assert.equal(rfq.quoted_at, '2026-07-26 09:00:00');
  db.close();
});

test('insertOrderRow persists an order with repeat flag preserved', () => {
  const db = buildSchema();
  insertOrderRow(db, {
    orderId: 'ORD-W1', customerId: 'ACC-1', quoteId: 'Q-W1', userId: 'U-1', activityId: 'ACT-2',
    amount: 9800, currency: 'EUR', grossMargin: 12, isRepeat: 1,
    orderedAt: '2026-07-30 10:00:00', createdAt: '2026-07-30 10:00:00',
  });
  const order = db.prepare('SELECT * FROM crm_orders WHERE id=?').get('ORD-W1');
  assert.equal(order.customer_id, 'ACC-1');
  assert.equal(order.quote_id, 'Q-W1');
  assert.equal(order.amount, 9800);
  assert.equal(order.currency, 'EUR');
  assert.equal(order.gross_margin, 12);
  assert.equal(order.is_repeat, 1);
  assert.equal(order.ordered_at, '2026-07-30 10:00:00');
  db.close();
});

test('insertRfqRow persists an open rfq bound to its originating activity', () => {
  const db = buildSchema();
  insertRfqRow(db, {
    rfqId: 'RFQ-W2', customerId: 'ACC-1', userId: 'U-1', activityId: 'ACT-3',
    reference: 'RFQ-ABC', status: 'open', bomLines: 12, expectedValue: 18000,
    productCategory: 'MCU', completeness: 90, receivedAt: '2026-07-27 11:00:00',
    quotedAt: '', createdAt: '2026-07-27 11:00:00',
  });
  const rfq = db.prepare('SELECT * FROM crm_rfqs WHERE id=?').get('RFQ-W2');
  assert.equal(rfq.activity_id, 'ACT-3');
  assert.equal(rfq.reference, 'RFQ-ABC');
  assert.equal(rfq.status, 'open');
  assert.equal(rfq.bom_lines, 12);
  assert.equal(rfq.expected_value, 18000);
  assert.equal(rfq.product_category, 'MCU');
  assert.equal(rfq.completeness, 90);
  assert.equal(rfq.received_at, '2026-07-27 11:00:00');
  assert.equal(rfq.quoted_at, '');
  db.close();
});