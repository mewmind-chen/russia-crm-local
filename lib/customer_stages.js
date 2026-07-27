'use strict';

const STAGES = Object.freeze([
  ['new', '客户入库'],
  ['qualified', '确认对口'],
  ['contacted', '首次触达'],
  ['replied', '获得回复'],
  ['connected', '建立联系'],
  ['meeting', '深度沟通'],
  ['manager', '管理者介入'],
  ['rfq', '收到询价'],
  ['quoted', '已报价'],
  ['negotiating', '商务谈判'],
  ['won', '首次下单'],
  ['repeat', '复购客户'],
  ['disqualified', '确认不对口'],
  ['lost', '暂停/流失'],
]);

const STAGE_INDEX = Object.freeze(Object.fromEntries(STAGES.map(([key], index) => [key, index])));
const STAGE_LABELS = Object.freeze(Object.fromEntries(STAGES));
const ALLOWED_STAGES = new Set(STAGES.map(([key]) => key));
const FOLLOW_UP_TERMINAL_STAGES = new Set(['won', 'repeat', 'lost', 'disqualified']);
const ACTIVE_PIPELINE_STAGES = new Set(
  STAGES.map(([key]) => key).filter(key => !FOLLOW_UP_TERMINAL_STAGES.has(key)),
);

function isValidStage(stage) {
  return ALLOWED_STAGES.has(String(stage || ''));
}

function isFollowUpTerminalStage(stage) {
  return FOLLOW_UP_TERMINAL_STAGES.has(String(stage || ''));
}

function isActivePipelineStage(stage) {
  return ACTIVE_PIPELINE_STAGES.has(String(stage || ''));
}

function hasReachedStage(current, target) {
  const currentStage = String(current || '');
  const targetStage = String(target || '');
  if (!isValidStage(currentStage) || !isValidStage(targetStage)) return false;
  if (['lost', 'disqualified'].includes(currentStage)) return false;
  if (['lost', 'disqualified'].includes(targetStage)) return currentStage === targetStage;
  return STAGE_INDEX[currentStage] >= STAGE_INDEX[targetStage];
}

module.exports = {
  STAGES,
  STAGE_INDEX,
  STAGE_LABELS,
  ALLOWED_STAGES,
  FOLLOW_UP_TERMINAL_STAGES,
  isValidStage,
  isFollowUpTerminalStage,
  isActivePipelineStage,
  hasReachedStage,
};
