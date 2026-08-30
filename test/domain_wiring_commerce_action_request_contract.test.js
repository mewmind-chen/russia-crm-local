'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');
const {
  reserveCommerceAction,
  completeCommerceAction,
  clearCommerceActionReservation,
} = require('../lib/domains/commerce/action_request');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 D 接线契约（commerce 第一片）：quote/order 的幂等保留生命周期
// （crm_commerce_action_requests）必须来自 domains/commerce/action_request，
// 不得在 sales_crm.js 内联。
test('commerce action-request reservation lifecycle is wired from the domain module, not inlined', () => {
  assert.match(source, /reserveCommerceAction,?\s*$[\s\S]*completeCommerceAction,?\s*$[\s\S]*clearCommerceActionReservation,?\s*$\s*\} = require\('\.\/domains\/commerce\/action_request'\);/m);
  assert.doesNotMatch(source, /^function reserveCommerceAction\(/m);
  assert.doesNotMatch(source, /^function completeCommerceAction\(/m);
  assert.doesNotMatch(source, /^function clearCommerceActionReservation\(/m);
});

test('reserve creates a started request; clear removes an in-progress one', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const user = { id: 'USR-ADMIN' };
  const payload = { amount: '1000', currency: 'USD', grossMargin: '5' };

  const first = reserveCommerceAction(fx.db, user, 'quote', payload, 'CRM-WU', {
    conflictError: (message, code) => { const e = new Error(message); e.code = code; return e; },
    nowText: () => '2026-08-30 09:00:00',
  });
  assert.deepEqual(first, { key: first.key, replay: null });
  assert.ok(first.key.startsWith('commerce:'));

  const row = fx.db.prepare("SELECT * FROM crm_commerce_action_requests WHERE idempotency_key=?")
    .get(first.key);
  assert.equal(row.status, 'started');
  assert.equal(row.actor_id, 'USR-ADMIN');
  assert.equal(row.action, 'quote');
  assert.equal(row.customer_id, 'CRM-WU');

  clearCommerceActionReservation(fx.db, first.key);
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM crm_commerce_action_requests').get().n, 0);
});

test('an in-flight reservation rejects the same action while a different binding conflicts', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const user = { id: 'USR-ADMIN' };
  const payload = { idempotencyKey: 'contract-binding-key', amount: '1000', currency: 'USD', grossMargin: '5' };
  const options = { nowText: () => '2026-08-30 09:00:00' };

  const { key } = reserveCommerceAction(fx.db, user, 'quote', payload, 'CRM-WU', options);
  const same = () => reserveCommerceAction(fx.db, user, 'quote', payload, 'CRM-WU', options);
  assert.throws(same, error => error.code === 'COMMERCE_ACTION_IN_PROGRESS');

  const boundElsewhere = () => reserveCommerceAction(fx.db, { id: 'U-OTHER' }, 'quote', payload, 'CRM-WU', options);
  assert.throws(boundElsewhere, error => error.code === 'COMMERCE_IDEMPOTENCY_CONFLICT');

  const wrongAction = () => reserveCommerceAction(fx.db, user, 'order', payload, 'CRM-WU', options);
  assert.throws(wrongAction, error => error.code === 'COMMERCE_IDEMPOTENCY_CONFLICT');

  const wrongCustomer = () => reserveCommerceAction(fx.db, user, 'quote', payload, 'CRM-OWN', options);
  assert.throws(wrongCustomer, error => error.code === 'COMMERCE_IDEMPOTENCY_CONFLICT');

  clearCommerceActionReservation(fx.db, key);
});

test('a completed reservation replays the stored response with deduplicated flag', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const user = { id: 'USR-ADMIN' };
  const payload = { amount: '1000', currency: 'USD', grossMargin: '5' };
  const options = { nowText: () => '2026-08-30 09:00:00' };

  const { key } = reserveCommerceAction(fx.db, user, 'quote', payload, 'CRM-WU', options);
  completeCommerceAction(fx.db, key, { quoteId: 'Q-123', activityId: 'ACT-123' }, options);

  const replayed = reserveCommerceAction(fx.db, user, 'quote', payload, 'CRM-WU', options);
  assert.equal(replayed.key, key);
  assert.deepEqual(replayed.replay, { quoteId: 'Q-123', activityId: 'ACT-123', deduplicated: true });

  const row = fx.db.prepare("SELECT status FROM crm_commerce_action_requests WHERE idempotency_key=?")
    .get(key);
  assert.equal(row.status, 'completed');
});
