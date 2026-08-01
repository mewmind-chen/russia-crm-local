'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  createActivityCorrectionNotification,
  installActivityCorrectionNotificationSchema,
} = require('../lib/crm_notifications');
const { dispatchPendingWecom } = require('../scripts/dispatch-crm-notifications');

function notificationDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE crm_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '',
    customer_id TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'unread',
    dedupe_key TEXT NOT NULL UNIQUE,
    wecom_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    read_at TEXT NOT NULL DEFAULT ''
  )`);
  return db;
}

const correctionInput = Object.freeze({
  correctionId: 'CORR-171-1',
  recipientId: 'U-MANAGER',
  notificationType: 'approved',
  sourceCustomerId: 'CRM-SOURCE',
  targetCustomerId: 'CRM-TARGET',
  title: '跟进记录已更正',
  detail: '记录已移动到正确客户。',
});

test('activity correction notification relation is additive and idempotent', t => {
  const db = notificationDb();
  t.after(() => db.close());
  installActivityCorrectionNotificationSchema(db);
  installActivityCorrectionNotificationSchema(db);

  const first = createActivityCorrectionNotification(db, correctionInput, {
    wecomEnabled: true,
    at: '2026-08-02T02:00:00.000Z',
  });
  const replay = createActivityCorrectionNotification(db, correctionInput, {
    wecomEnabled: true,
    at: '2026-08-02T02:01:00.000Z',
  });

  assert.equal(replay.notification.id, first.notification.id);
  assert.equal(replay.relation.id, first.relation.id);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_notifications').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_activity_correction_notification_relations').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_notification_deliveries').get().count, 2);
  assert.deepEqual(
    db.prepare(`SELECT correction_id,proposal_id,recipient_id,notification_type,
      source_customer_id,target_customer_id
      FROM crm_activity_correction_notification_relations`).get(),
    {
      correction_id: 'CORR-171-1',
      proposal_id: '',
      recipient_id: 'U-MANAGER',
      notification_type: 'approved',
      source_customer_id: 'CRM-SOURCE',
      target_customer_id: 'CRM-TARGET',
    },
  );

  createActivityCorrectionNotification(db, {
    proposalId: 'PROP-171-1',
    recipientId: 'U-MANAGER',
    notificationType: 'review_requested',
    sourceCustomerId: 'CRM-SOURCE',
    targetCustomerId: 'CRM-TARGET',
  }, { wecomEnabled: false, at: '2026-08-02T02:02:00.000Z' });
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_activity_correction_notification_relations').get().count, 2);
  assert.throws(
    () => createActivityCorrectionNotification(db, {
      ...correctionInput,
      proposalId: 'PROP-INVALID',
    }),
    /exactly one correctionId or proposalId/,
  );
});

test('failed correction delivery retries the same outbox row and is not sent after success', async t => {
  const db = notificationDb();
  t.after(() => db.close());
  createActivityCorrectionNotification(db, correctionInput, {
    wecomEnabled: true,
    at: '2026-08-02T03:00:00.000Z',
  });
  const requests = [];
  const fetchImpl = async (_url, request) => {
    requests.push(JSON.parse(request.body));
    return { ok: requests.length > 1, status: requests.length > 1 ? 200 : 503 };
  };

  await assert.rejects(
    dispatchPendingWecom(db, {
      webhook: 'https://wecom.invalid/hook',
      workerId: 'notify-171-a',
      fetchImpl,
      at: '2026-08-02T03:00:01.000Z',
      finishAt: '2026-08-02T03:00:02.000Z',
    }),
    /企业微信通知失败：503/,
  );
  let delivery = db.prepare("SELECT * FROM crm_notification_deliveries WHERE channel='wecom'").get();
  assert.equal(delivery.status, 'failed');
  assert.equal(delivery.attempts, 1);

  const retried = await dispatchPendingWecom(db, {
    webhook: 'https://wecom.invalid/hook',
    workerId: 'notify-171-b',
    fetchImpl,
    at: '2026-08-02T03:01:00.000Z',
    finishAt: '2026-08-02T03:01:01.000Z',
  });
  assert.deepEqual(retried, { disabled: false, claimed: 1, sent: 1 });
  delivery = db.prepare("SELECT * FROM crm_notification_deliveries WHERE channel='wecom'").get();
  assert.equal(delivery.status, 'sent');
  assert.equal(delivery.attempts, 2);

  const afterSuccess = await dispatchPendingWecom(db, {
    webhook: 'https://wecom.invalid/hook',
    workerId: 'notify-171-c',
    fetchImpl,
    at: '2026-08-02T03:02:00.000Z',
  });
  assert.deepEqual(afterSuccess, { disabled: false, claimed: 0, sent: 0 });
  assert.equal(requests.length, 2);
  assert.match(requests[0].text.content, /跟进记录已更正/);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_notifications').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_activity_correction_notification_relations').get().count, 1);
});
