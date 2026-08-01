#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const {
  claimDelivery,
  createNotification,
  ensureNotificationDeliveries,
  finishDelivery,
  installNotificationDeliverySchema,
} = require('../lib/crm_notifications');
const { FOLLOW_UP_TERMINAL_STAGES } = require('../lib/customer_stages');

function generateNotifications(db, options = {}) {
  const now = options.now || new Date();
  const nowText = now.toISOString().slice(0, 19).replace('T', ' ');
  const day = nowText.slice(0, 10);
  const terminalStages = [...FOLLOW_UP_TERMINAL_STAGES];
  const rows = db.prepare(`SELECT a.id customer_id,a.company_name,a.owner_id,a.stage,a.assignment_status,
    a.claim_due_at,a.claimed_at,a.last_activity_at,a.next_action,a.next_action_at
    FROM crm_accounts a WHERE a.stage NOT IN (${terminalStages.map(() => '?').join(',')})`).all(...terminalStages);
  const hours = value => value ? (now - new Date(String(value).replace(' ', 'T') + 'Z')) / 3600000 : Infinity;
  const candidates = [];
  for (const row of rows) {
    if (!row.next_action)
      candidates.push([row, 'NO_NEXT_ACTION', 'critical', '活跃客户缺少下一步动作与完成时间']);
    if (row.assignment_status === 'assigned' && row.claim_due_at && row.claim_due_at < nowText)
      candidates.push([row, 'UNCLAIMED', 'critical', '新客户超过24小时未领取']);
    if (row.assignment_status === 'claimed' && row.stage === 'qualified' && hours(row.claimed_at) > 48)
      candidates.push([row, 'NO_FIRST_CONTACT', 'critical', '领取后48小时仍未首次触达']);
    if (row.next_action_at && row.next_action_at < nowText)
      candidates.push([row, 'OVERDUE', 'critical', `跟进任务已超期：${row.next_action || '未说明动作'}`]);
    if (row.stage === 'replied' && hours(row.last_activity_at) > 24)
      candidates.push([row, 'REPLY_IDLE', 'critical', '客户回复后超过24小时未推进']);
    if (['meeting','manager'].includes(row.stage) && hours(row.last_activity_at) > 168)
      candidates.push([row, 'MEETING_NO_RFQ', 'warning', '会议后7天仍未收到询价']);
  }
  const overdueLeads = db.prepare(`SELECT external_customer_id customer_id,company_name,assigned_owner_id owner_id
    FROM crm_intake_items WHERE status='assigned' AND claim_due_at!='' AND claim_due_at<?`).all(nowText);
  for (const row of overdueLeads) {
    candidates.push([row, 'UNCLAIMED_LEAD', 'critical', '未开发线索超过24小时未领取']);
  }
  for (const [row, code, severity, title] of candidates) {
    createNotification(db, {
      userId: row.owner_id,
      customerId: row.customer_id,
      code,
      severity,
      title,
      detail: row.company_name,
      dedupeKey: `${day}:${code}:${row.customer_id}`,
    }, { wecomEnabled: options.wecomEnabled, at: nowText });
  }
  return candidates.length;
}

function notificationRowsForDeliveries(db, deliveries) {
  if (!deliveries.length) return [];
  const ids = deliveries.map(delivery => delivery.notification_id);
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM crm_notifications WHERE id IN (${placeholders}) ORDER BY created_at,id`)
    .all(...ids);
}

async function dispatchPendingWecom(db, options = {}) {
  const webhook = String(options.webhook ?? process.env.WECOM_WEBHOOK_URL ?? '').trim();
  const workerId = String(options.workerId || `notify-${process.pid}`);
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 30;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  installNotificationDeliverySchema(db);
  for (const notification of db.prepare('SELECT id FROM crm_notifications').all()) {
    ensureNotificationDeliveries(db, notification.id, { wecomEnabled: Boolean(webhook) });
  }
  if (!webhook) {
    db.prepare(`UPDATE crm_notification_deliveries SET status='disabled',updated_at=?
      WHERE channel='wecom' AND status IN ('pending','failed')`).run(new Date().toISOString());
    db.prepare("UPDATE crm_notifications SET wecom_status='disabled' WHERE wecom_status='pending'").run();
    return Object.freeze({ disabled: true, claimed: 0, sent: 0 });
  }
  if (typeof fetchImpl !== 'function') throw new Error('notification fetch implementation is unavailable');
  const deliveries = [];
  while (deliveries.length < limit) {
    const delivery = claimDelivery(db, { channel: 'wecom', workerId, at: options.at });
    if (!delivery) break;
    deliveries.push(delivery);
  }
  if (!deliveries.length) return Object.freeze({ disabled: false, claimed: 0, sent: 0 });
  const notifications = notificationRowsForDeliveries(db, deliveries);
  const content = ['TradePulse 客户跟进提醒', ...notifications.map(row => `- ${row.title}｜${row.detail}`)].join('\n');
  try {
    const response = await fetchImpl(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content } }) });
    if (!response.ok) throw new Error(`企业微信通知失败：${response.status}`);
    for (const delivery of deliveries) {
      finishDelivery(db, { deliveryId: delivery.id, workerId, success: true, at: options.finishAt });
    }
    return Object.freeze({ disabled: false, claimed: deliveries.length, sent: deliveries.length });
  } catch (error) {
    for (const delivery of deliveries) {
      try {
        finishDelivery(db, { deliveryId: delivery.id, workerId, error: error.message, at: options.finishAt });
      } catch (_finishError) { /* An expired lease remains available for recovery. */ }
    }
    throw error;
  }
}

async function main() {
  const db = new Database(path.join(__dirname, '..', 'data', 'crm.db'));
  db.pragma('journal_mode = WAL');
  try {
    installNotificationDeliverySchema(db);
    const webhook = String(process.env.WECOM_WEBHOOK_URL || '').trim();
    generateNotifications(db, { wecomEnabled: Boolean(webhook) });
    await dispatchPendingWecom(db, { webhook });
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {
  dispatchPendingWecom,
  generateNotifications,
};
