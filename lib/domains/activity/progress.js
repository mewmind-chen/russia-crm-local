'use strict';

// Activity progress stages, legacy type/channel validation, and request-spec
// resolution. Error construction is injected by call sites.

const { legacyProgressKey } = require('./present');

function defaultBadRequest(message) {
  return new Error(message);
}

const ACTIVITY_STAGE = {
  email: 'contacted',
  call: 'contacted',
  social: 'connected',
  reply: 'replied',
  meeting: 'meeting',
  manager_join: 'manager',
  rfq: 'rfq',
  quote: 'quoted',
  negotiation: 'negotiating',
  order: 'won',
  repeat_order: 'repeat',
  lost: 'lost',
};

const PROGRESS_TYPE_MAP = Object.freeze({
  email: Object.freeze({ activityType: 'email', channel: 'email', stage: 'contacted' }),
  call: Object.freeze({ activityType: 'call', channel: 'call', stage: 'contacted' }),
  whatsapp: Object.freeze({ activityType: 'social', channel: 'WhatsApp', stage: 'connected' }),
  telegram: Object.freeze({ activityType: 'social', channel: 'Telegram', stage: 'connected' }),
  linkedin: Object.freeze({ activityType: 'social', channel: 'LinkedIn', stage: 'connected' }),
  reply: Object.freeze({ activityType: 'reply', channel: 'other', stage: 'replied' }),
  meeting: Object.freeze({ activityType: 'meeting', channel: 'video', stage: 'meeting' }),
  rfq: Object.freeze({ activityType: 'rfq', channel: 'business', stage: 'rfq' }),
  negotiation: Object.freeze({ activityType: 'negotiation', channel: 'business', stage: 'negotiating' }),
  lost: Object.freeze({ activityType: 'lost', channel: 'other', stage: 'lost' }),
});

const LEGACY_ACTIVITY_TYPES = new Set([
  'email', 'call', 'social', 'reply', 'meeting', 'manager_join', 'rfq', 'negotiation', 'lost', 'note',
]);

const LEGACY_ACTIVITY_CHANNELS = new Set([
  '', 'email', 'call', 'WhatsApp', 'Telegram', 'LinkedIn', 'video', '展会', 'business', 'other',
]);

function resolveActivityRequestSpec(payload = {}, options = {}) {
  const badRequest = options.badRequest || defaultBadRequest;
  const requestedProgressType = String(payload.progressType || '').trim().toLowerCase();
  if (requestedProgressType) {
    const progress = PROGRESS_TYPE_MAP[requestedProgressType];
    if (!progress) throw badRequest('不支持的本次进展类型');
    return {
      progressKey: requestedProgressType,
      activityType: progress.activityType,
      channel: progress.channel,
      proposedStage: progress.stage,
      legacy: false,
    };
  }
  const activityType = String(payload.activityType || '').trim();
  if (!LEGACY_ACTIVITY_TYPES.has(activityType)) throw badRequest('请选择有效的本次进展');
  const channel = String(payload.channel || '').trim();
  if (!LEGACY_ACTIVITY_CHANNELS.has(channel)) throw badRequest('不支持的进展渠道');
  return {
    progressKey: legacyProgressKey(activityType, channel),
    activityType,
    channel,
    proposedStage: ACTIVITY_STAGE[activityType] || '',
    legacy: true,
  };
}

module.exports = Object.freeze({
  ACTIVITY_STAGE,
  PROGRESS_TYPE_MAP,
  LEGACY_ACTIVITY_TYPES,
  LEGACY_ACTIVITY_CHANNELS,
  resolveActivityRequestSpec,
});