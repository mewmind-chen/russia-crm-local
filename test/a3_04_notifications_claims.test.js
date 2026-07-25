'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  claimDelivery,
  createNotification,
  finishDelivery,
  installNotificationDeliverySchema,
} = require('../lib/crm_notifications');
const fixtures = require('./helpers/permission_fixture');

test('notification delivery keeps the web channel available when WeCom fails', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE crm_notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', customer_id TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unread',
    dedupe_key TEXT NOT NULL UNIQUE, wecom_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL, read_at TEXT NOT NULL DEFAULT ''
  )`);
  installNotificationDeliverySchema(db);
  const notification = createNotification(db, {
    userId: 'U-1', customerId: 'CRM-1', code: 'TEST', title: '测试通知', dedupeKey: 'a3-04:test',
  }, { wecomEnabled: true, at: '2026-07-25T05:00:00.000Z' });
  const delivery = claimDelivery(db, { channel: 'wecom', workerId: 'notify-1', at: '2026-07-25T05:00:01.000Z' });
  assert.equal(delivery.notification_id, notification.id);
  finishDelivery(db, {
    deliveryId: delivery.id, workerId: 'notify-1', error: 'HTTP 500', at: '2026-07-25T05:00:02.000Z',
  });
  assert.equal(db.prepare('SELECT status FROM crm_notifications WHERE id=?').get(notification.id).status, 'unread');
  assert.equal(db.prepare('SELECT wecom_status FROM crm_notifications WHERE id=?').get(notification.id).wecom_status, 'failed');
  assert.equal(db.prepare(`SELECT status FROM crm_notification_deliveries
    WHERE notification_id=? AND channel='web'`).get(notification.id).status, 'sent');
  assert.equal(claimDelivery(db, { channel: 'wecom', workerId: 'notify-2' }).status, 'sending');
  db.close();
});

test('claim is idempotent and repeated requests return the first result', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const cookie = await fx.login('other@example.com', 'Password123!');
  const body = { action: 'claim', itemId: 'INTAKE-OTHER', idempotencyKey: 'claim-a3-04-1' };
  const first = await fx.request('/api/sales-crm/intake/action', { cookie, method: 'POST', body });
  const second = await fx.request('/api/sales-crm/intake/action', { cookie, method: 'POST', body });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.equal(secondBody.deduplicated, true);
  assert.equal(secondBody.customerId, firstBody.customerId);
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_accounts WHERE external_customer_id='BR-9004'").get().n, 1);
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_intake_action_requests WHERE idempotency_key='claim-a3-04-1'").get().n, 1);
});

test('return and reject are idempotent after the first state transition', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-REJECT','BATCH-TEST','BR-9005','Reject Other','assigned','U-OTHER',?,?)`).run(
    '2026-07-25 05:00:00', '2026-07-25 05:00:00',
  );
  const cookie = await fx.login('other@example.com', 'Password123!');
  for (const [itemId, action, key, reason, expected] of [
    ['INTAKE-OTHER', 'return', 'return-a3-04-1', '暂时不匹配', 'returned'],
    ['INTAKE-REJECT', 'reject', 'reject-a3-04-1', '产品方向不对口', 'rejected'],
  ]) {
    const body = { action, itemId, reason, idempotencyKey: key };
    const first = await fx.request('/api/sales-crm/intake/action', { cookie, method: 'POST', body });
    const second = await fx.request('/api/sales-crm/intake/action', { cookie, method: 'POST', body });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).deduplicated, true);
    assert.equal(fx.db.prepare('SELECT status FROM crm_intake_items WHERE id=?').get(itemId).status, expected);
  }
});

test('notification read endpoint is idempotent and scoped', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,created_at)
    VALUES ('NOTE-A3-04','U-MGR','CRM-OWN','A3_04','info','Claimed','Claimed','unread','a3-04:read','2026-07-25 05:00:00')`).run();
  const cookie = await fx.login('manager@example.com', 'Password123!');
  const route = '/api/sales-crm/notifications/NOTE-A3-04/read';
  const first = await fx.request(route, { cookie, method: 'POST', body: {} });
  const second = await fx.request(route, { cookie, method: 'POST', body: {} });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).changed, true);
  assert.equal((await second.json()).changed, false);
  assert.equal(fx.db.prepare('SELECT status FROM crm_notifications WHERE id=?').get('NOTE-A3-04').status, 'read');

  fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,created_at)
    VALUES ('NOTE-A3-04-OTHER','U-OTHER','CRM-OTHER','A3_04','info','Other','Other','unread','a3-04:read:other','2026-07-25 05:00:00')`).run();
  const forbidden = await fx.request('/api/sales-crm/notifications/NOTE-A3-04-OTHER/read', {
    cookie, method: 'POST', body: {},
  });
  assert.equal(forbidden.status, 403);
  assert.equal(fx.db.prepare('SELECT status FROM crm_notifications WHERE id=?')
    .get('NOTE-A3-04-OTHER').status, 'unread');
});
