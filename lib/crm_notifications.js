'use strict';

const crypto = require('node:crypto');

const DELIVERY_CHANNELS = Object.freeze(['web', 'wecom']);
const DELIVERY_STATES = Object.freeze(['pending', 'sending', 'sent', 'failed', 'disabled']);

function text(value, fallback = '') {
  const clean = String(value ?? '').trim();
  return clean || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function notificationId(dedupeKey) {
  return `NTF-${crypto.createHash('sha1').update(String(dedupeKey)).digest('hex').slice(0, 16)}`;
}

function deliveryId(notification, channel) {
  return `NTFD-${crypto.createHash('sha1').update(`${notification}:${channel}`).digest('hex').slice(0, 20)}`;
}

function correctionRelationId(dedupeKey) {
  return `NTFR-${crypto.createHash('sha1').update(String(dedupeKey)).digest('hex').slice(0, 20)}`;
}

function installActivityCorrectionNotificationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_activity_correction_notification_relations (
      id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL UNIQUE,
      correction_id TEXT NOT NULL DEFAULT '',
      proposal_id TEXT NOT NULL DEFAULT '',
      recipient_id TEXT NOT NULL CHECK (length(trim(recipient_id)) > 0),
      notification_type TEXT NOT NULL CHECK (length(trim(notification_type)) > 0),
      source_customer_id TEXT NOT NULL CHECK (length(trim(source_customer_id)) > 0),
      target_customer_id TEXT NOT NULL CHECK (length(trim(target_customer_id)) > 0),
      created_at TEXT NOT NULL,
      CHECK (
        (correction_id <> '' AND proposal_id = '')
        OR (correction_id = '' AND proposal_id <> '')
      ),
      UNIQUE (correction_id, proposal_id, recipient_id, notification_type),
      FOREIGN KEY (notification_id) REFERENCES crm_notifications(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS crm_activity_correction_notification_recipient_idx
      ON crm_activity_correction_notification_relations(recipient_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS crm_activity_correction_notification_customers_idx
      ON crm_activity_correction_notification_relations(source_customer_id,target_customer_id);
  `);
}

function installNotificationDeliverySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_notification_deliveries (
      id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('web','wecom')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','sending','sent','failed','disabled')),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      lease_owner TEXT NOT NULL DEFAULT '',
      lease_expires_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      delivered_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (notification_id, channel),
      FOREIGN KEY (notification_id) REFERENCES crm_notifications(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS crm_notification_deliveries_ready_idx
      ON crm_notification_deliveries(channel,status,lease_expires_at,created_at);
    CREATE INDEX IF NOT EXISTS crm_notification_deliveries_notification_idx
      ON crm_notification_deliveries(notification_id,channel);
  `);
  installActivityCorrectionNotificationSchema(db);
}

function ensureNotificationDeliveries(db, notificationIdValue, options = {}) {
  installNotificationDeliverySchema(db);
  const notification = db.prepare('SELECT * FROM crm_notifications WHERE id=?').get(notificationIdValue);
  if (!notification) return null;
  const at = options.at || nowIso();
  const wecomEnabled = options.wecomEnabled === undefined
    ? Boolean(String(process.env.WECOM_WEBHOOK_URL || '').trim())
    : Boolean(options.wecomEnabled);
  const insert = db.prepare(`INSERT OR IGNORE INTO crm_notification_deliveries
    (id,notification_id,channel,status,idempotency_key,created_at,updated_at)
    VALUES (?,?,?,'pending',?,?,?)`);
  insert.run(
    deliveryId(notification.id, 'web'), notification.id, 'web',
    `crm-notification:${notification.id}:web`, at, at,
  );
  insert.run(
    deliveryId(notification.id, 'wecom'), notification.id, 'wecom',
    `crm-notification:${notification.id}:wecom`, at, at,
  );
  db.prepare(`UPDATE crm_notification_deliveries
    SET status='sent',delivered_at=?,updated_at=?
    WHERE notification_id=? AND channel='web' AND status IN ('pending','sending')`)
    .run(at, at, notification.id);
  db.prepare(`UPDATE crm_notification_deliveries
    SET status=?,updated_at=?
    WHERE notification_id=? AND channel='wecom' AND status IN ('pending','failed')`)
    .run(wecomEnabled ? 'pending' : 'disabled', at, notification.id);
  db.prepare(`UPDATE crm_notifications SET wecom_status=?
    WHERE id=? AND wecom_status NOT IN ('sent','failed')`)
    .run(wecomEnabled ? 'pending' : 'disabled', notification.id);
  return db.prepare('SELECT * FROM crm_notification_deliveries WHERE notification_id=? ORDER BY channel')
    .all(notification.id);
}

function createNotification(db, input = {}, options = {}) {
  const dedupeKey = text(input.dedupeKey);
  if (!dedupeKey) throw new Error('notification dedupeKey is required');
  const at = options.at || nowIso();
  const id = text(input.id, notificationId(dedupeKey));
  db.prepare(`INSERT OR IGNORE INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,wecom_status,created_at)
    VALUES (?,?,?,?,?,?,?,'unread',?,'pending',?)`).run(
    id,
    text(input.userId),
    text(input.customerId),
    text(input.code, 'CRM_NOTICE'),
    text(input.severity, 'info'),
    text(input.title, 'CRM 通知'),
    text(input.detail).slice(0, 2000),
    dedupeKey,
    at,
  );
  const notification = db.prepare('SELECT * FROM crm_notifications WHERE dedupe_key=?').get(dedupeKey);
  ensureNotificationDeliveries(db, notification.id, options);
  return notification;
}

function createActivityCorrectionNotification(db, input = {}, options = {}) {
  const correctionId = text(input.correctionId);
  const proposalId = text(input.proposalId);
  const recipientId = text(input.recipientId);
  const notificationType = text(input.notificationType);
  const sourceCustomerId = text(input.sourceCustomerId);
  const targetCustomerId = text(input.targetCustomerId);
  if (Boolean(correctionId) === Boolean(proposalId)) {
    throw new Error('exactly one correctionId or proposalId is required');
  }
  if (!recipientId) throw new Error('activity correction notification recipientId is required');
  if (!notificationType) throw new Error('activity correction notification type is required');
  if (!sourceCustomerId || !targetCustomerId) {
    throw new Error('activity correction notification source and target customers are required');
  }

  installActivityCorrectionNotificationSchema(db);
  const relationKind = correctionId ? 'correction' : 'proposal';
  const relationValue = correctionId || proposalId;
  const dedupeKey = `activity-correction:${relationKind}:${relationValue}:${recipientId}:${notificationType}`;
  const at = options.at || nowIso();
  const notification = createNotification(db, {
    userId: recipientId,
    customerId: targetCustomerId,
    code: text(input.code, 'ACTIVITY_CORRECTION'),
    severity: text(input.severity, 'info'),
    title: text(input.title, correctionId ? '跟进记录更正通知' : '跟进记录更正待审批'),
    detail: text(input.detail),
    dedupeKey,
  }, { ...options, at });
  db.prepare(`INSERT OR IGNORE INTO crm_activity_correction_notification_relations
    (id,notification_id,correction_id,proposal_id,recipient_id,notification_type,
      source_customer_id,target_customer_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    correctionRelationId(dedupeKey),
    notification.id,
    correctionId,
    proposalId,
    recipientId,
    notificationType,
    sourceCustomerId,
    targetCustomerId,
    at,
  );
  const relation = db.prepare(`SELECT * FROM crm_activity_correction_notification_relations
    WHERE correction_id=? AND proposal_id=? AND recipient_id=? AND notification_type=?`)
    .get(correctionId, proposalId, recipientId, notificationType);
  return Object.freeze({ notification, relation });
}

function claimDelivery(db, input = {}) {
  const channel = text(input.channel);
  const workerId = text(input.workerId);
  if (!DELIVERY_CHANNELS.includes(channel)) throw new Error('notification channel is invalid');
  if (!workerId) throw new Error('notification delivery workerId is required');
  const at = input.at || nowIso();
  const leaseMs = Number.isInteger(input.leaseMs) && input.leaseMs > 0 ? input.leaseMs : 60_000;
  const expiry = new Date(new Date(at).getTime() + leaseMs).toISOString();
  const row = db.prepare(`SELECT * FROM crm_notification_deliveries
    WHERE channel=? AND (
      status IN ('pending','failed')
      OR (status='sending' AND lease_expires_at<=?)
    )
    ORDER BY created_at,id LIMIT 1`).get(channel, at);
  if (!row) return null;
  const changed = db.prepare(`UPDATE crm_notification_deliveries
    SET status='sending',attempts=attempts+1,lease_owner=?,lease_expires_at=?,updated_at=?
    WHERE id=? AND (
      status IN ('pending','failed')
      OR (status='sending' AND lease_expires_at<=?)
    )`).run(workerId, expiry, at, row.id, at);
  return changed.changes === 1
    ? db.prepare('SELECT * FROM crm_notification_deliveries WHERE id=?').get(row.id)
    : null;
}

function finishDelivery(db, input = {}) {
  const deliveryIdValue = text(input.deliveryId);
  const workerId = text(input.workerId);
  const success = input.success === true;
  const at = input.at || nowIso();
  const row = db.prepare('SELECT * FROM crm_notification_deliveries WHERE id=?').get(deliveryIdValue);
  if (!row) throw new Error('notification delivery not found');
  if (row.status !== 'sending' || row.lease_owner !== workerId) {
    throw new Error('notification delivery lease is not owned by this worker');
  }
  const status = success ? 'sent' : 'failed';
  const error = success ? '' : text(input.error, 'notification delivery failed').slice(0, 500);
  const changed = db.prepare(`UPDATE crm_notification_deliveries
    SET status=?,last_error=?,delivered_at=?,lease_owner='',lease_expires_at='',updated_at=?
    WHERE id=? AND status='sending' AND lease_owner=?`).run(
    status, error, success ? at : '', at, row.id, workerId,
  );
  if (changed.changes !== 1) throw new Error('notification delivery state changed');
  if (row.channel === 'wecom') {
    db.prepare('UPDATE crm_notifications SET wecom_status=? WHERE id=?')
      .run(success ? 'sent' : 'failed', row.notification_id);
  }
  return db.prepare('SELECT * FROM crm_notification_deliveries WHERE id=?').get(row.id);
}

function markNotificationRead(db, input = {}) {
  const notificationIdValue = text(input.notificationId);
  const userId = text(input.userId);
  if (!notificationIdValue || !userId) throw new Error('notification and user are required');
  const changed = db.prepare(`UPDATE crm_notifications SET status='read',read_at=?
    WHERE id=? AND status='unread' AND (user_id='' OR user_id=?)`).run(
    input.at || nowIso(), notificationIdValue, userId,
  );
  return Object.freeze({ notificationId: notificationIdValue, changed: changed.changes === 1 });
}

module.exports = {
  DELIVERY_CHANNELS,
  DELIVERY_STATES,
  claimDelivery,
  createActivityCorrectionNotification,
  createNotification,
  ensureNotificationDeliveries,
  finishDelivery,
  installActivityCorrectionNotificationSchema,
  installNotificationDeliverySchema,
  markNotificationRead,
};
