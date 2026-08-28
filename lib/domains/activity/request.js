'use strict';

// Activity reaction request resolution. Interaction with the reaction-options
// table is injected via findReactionById/findReactionByKey so the domain stays
// free of direct SQL access.

const { normalizeActivityReactionName, activityReactionNameKey } = require('./present');

function defaultError(message) {
  return new Error(message);
}

function resolveActivityReaction(payload = {}, options = {}) {
  const badRequest = options.badRequest || defaultError;
  const conflictError = options.conflictError || defaultError;
  const findReactionById = options.findReactionById;
  const findReactionByKey = options.findReactionByKey;

  const reactionOptionId = String(payload.reactionOptionId || '').trim();
  const legacyOutcome = String(payload.outcome || '').trim();
  const customReaction = String(payload.reactionCustom || '').trim();
  if (customReaction) {
    if (reactionOptionId || legacyOutcome) throw badRequest('自定义客户反应不能与标准选项同时提交');
    return { id: '', name: normalizeActivityReactionName(customReaction, options) };
  }

  let reaction;
  if (reactionOptionId) {
    reaction = findReactionById(reactionOptionId);
    if (!reaction) {
      throw conflictError('客户反应选项已失效，请刷新后重试', 'ACTIVITY_REACTION_STALE');
    }
  }
  if (legacyOutcome) {
    const nameKey = activityReactionNameKey(legacyOutcome);
    const matched = findReactionByKey(nameKey);
    if (!matched) throw badRequest('请选择有效的客户反应');
    if (reaction && reaction.id !== matched.id) throw badRequest('客户反应选项与文字不一致');
    reaction = matched;
  }
  return reaction
    ? { id: reaction.id, name: reaction.name }
    : { id: '', name: '' };
}

module.exports = Object.freeze({
  resolveActivityReaction,
});