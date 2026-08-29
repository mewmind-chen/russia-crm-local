'use strict';

// Activity domain helpers: reaction name normalization and public activity
// projection metadata. Error construction is injected by call sites.

function defaultBadRequest(message) {
  return new Error(message);
}

function normalizeActivityReactionName(input, options = {}) {
  const badRequest = options.badRequest || defaultBadRequest;
  const raw = String(input ?? '');
  const normalized = raw.normalize('NFKC');
  if (/[\p{Cc}\p{Cf}]/u.test(normalized)) throw badRequest('客户反应名称不能包含控制字符');
  const name = normalized.trim().replace(/\s+/g, ' ');
  if (!name) throw badRequest('客户反应名称不能为空');
  if (Array.from(name).length > 40) throw badRequest('客户反应名称最多40个字符');
  return name;
}

function activityReactionNameKey(input, options = {}) {
  return normalizeActivityReactionName(input, options).toLocaleLowerCase('zh-CN');
}

function legacyProgressKey(activityType, channel) {
  if (activityType !== 'social') return activityType;
  return {
    WhatsApp: 'whatsapp',
    Telegram: 'telegram',
    LinkedIn: 'linkedin',
  }[channel] || 'social';
}

const PIPELINE_ACTION_QUEUE_KEYS = new Set([
  '', 'due_followup', 'price_objection', 'inquiry_no_order', 'relationship_upgrade',
  'order_growth', 'pause_quote', 'manager_assistance',
]);

function normalizeActivityActionQueueKey(value, options = {}) {
  const badRequest = options.badRequest || defaultBadRequest;
  const key = String(value || '').trim();
  if (!PIPELINE_ACTION_QUEUE_KEYS.has(key)) throw badRequest('请选择有效的行动队列');
  return key;
}

function publicActivityReaction(row) {
  return {
    id: row.id,
    name: row.name,
    actionQueueKey: row.action_queue_key || '',
    sortOrder: Number(row.sort_order || 0),
    active: Boolean(row.active),
  };
}

function scopedActivityProvenance(row, visibleActivityIds) {
  const provenance = row.provenance ? { ...row.provenance } : null;
  if (!provenance) return null;
  if (provenance.kind === 'superseded_original') {
    const replacementId = String(provenance.replacementActivityId || row.superseded_by || '');
    if (replacementId && !visibleActivityIds.has(replacementId)) {
      provenance.replacementActivityId = '';
      provenance.replacementCustomerId = '';
    }
  }
  if (provenance.kind === 'replacement') {
    const originalId = String(provenance.originalActivityId || '');
    if (originalId && !visibleActivityIds.has(originalId)) {
      provenance.originalActivityId = '';
      provenance.originalCustomerId = '';
    }
  }
  return provenance;
}

module.exports = Object.freeze({
  normalizeActivityReactionName,
  activityReactionNameKey,
  legacyProgressKey,
  scopedActivityProvenance,
  normalizeActivityActionQueueKey,
  publicActivityReaction,
});