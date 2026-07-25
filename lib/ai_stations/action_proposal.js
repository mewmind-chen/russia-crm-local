'use strict';

const crypto = require('node:crypto');
const { buildCustomerContext } = require('./context');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');

const CONFIRMED_FIELDS = Object.freeze([
  'activityType', 'channel', 'outcome', 'summary', 'nextAction', 'nextActionAt',
]);

function clean(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function proposalError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function enqueueActionProposal(input = {}) {
  const userContent = clean(input.userContent, 4000);
  if (userContent.length < 3) {
    throw proposalError('请至少输入3个字符的触达结果', 'AI_ACTION_INPUT_REQUIRED');
  }
  const clientRequestId = clean(input.clientRequestId, 120);
  if (!clientRequestId) {
    throw proposalError('clientRequestId is required', 'AI_ACTION_REQUEST_ID_REQUIRED');
  }
  const actorId = clean(input.actor?.id, 160);
  if (!actorId) throw proposalError('actor is required', 'AI_ACTION_ACTOR_REQUIRED');
  const context = buildCustomerContext(input.db, input.accessContext, input.customerId, {
    station: 'action_proposal',
  });
  const keyHash = crypto.createHash('sha256')
    .update(`${actorId}\n${clientRequestId}`).digest('hex');
  return createAIJobStore(input.db).enqueue({
    customerId: input.customerId,
    crmAccountId: context.context.crmAccountId,
    station: 'action_proposal',
    contextHash: context.contextHash,
    payload: {
      contextVersion: 'crm-v1',
      stationVersion: 'v1',
      userContent,
      clientRequestId,
      source: 'activity_form',
    },
    createdBy: actorId,
    trigger: { source: 'manual', actorId, reason: 'activity_proposal_requested' },
    priority: 40,
  }, `ai-action-proposal:v1:${keyHash}`);
}

function confirmedActivity(input = {}) {
  return {
    activityType: clean(input.activityType, 80),
    channel: clean(input.channel, 80),
    outcome: clean(input.outcome, 200),
    summary: clean(input.summary, 4000),
    nextAction: clean(input.nextAction, 1000),
    nextActionAt: clean(input.nextActionAt, 80),
  };
}

function prepareActionProposalConfirmation(db, input = {}) {
  const jobId = clean(input.jobId, 160);
  if (!jobId) return null;
  const existing = db.prepare(`SELECT * FROM crm_ai_action_proposal_consumptions
    WHERE job_id=?`).get(jobId);
  if (existing) {
    if (existing.confirmed_by !== input.actorId || existing.customer_id !== input.crmAccountId) {
      throw proposalError('无权使用该活动提案', 'AI_ACTION_PROPOSAL_FORBIDDEN', 403);
    }
    return Object.freeze({ existing: true, activityId: existing.activity_id });
  }
  const job = createAIJobStore(db).getJob(jobId);
  if (!job || job.station !== 'action_proposal') {
    throw proposalError('活动提案不存在', 'AI_ACTION_PROPOSAL_NOT_FOUND', 404);
  }
  if (job.createdBy !== input.actorId || job.crmAccountId !== input.crmAccountId) {
    throw proposalError('无权使用该活动提案', 'AI_ACTION_PROPOSAL_FORBIDDEN', 403);
  }
  if (job.state !== 'needs_review') {
    throw proposalError('活动提案尚未生成或已结束', 'AI_ACTION_PROPOSAL_NOT_READY', 409);
  }
  const result = createAIResultStore(db).getForJob(jobId);
  if (!result) throw proposalError('活动提案结果不存在', 'AI_ACTION_PROPOSAL_NOT_READY', 409);
  const confirmed = confirmedActivity(input.confirmed);
  const missing = CONFIRMED_FIELDS.filter(field => !confirmed[field]);
  if (missing.length) {
    const error = proposalError(
      `确认前请补充：${missing.join(', ')}`,
      'AI_ACTION_PROPOSAL_INCOMPLETE',
    );
    error.publicDetails = { missingFields: missing };
    throw error;
  }
  return Object.freeze({ existing: false, job, result, confirmed });
}

function confirmActionProposal(db, prepared, input = {}) {
  if (!prepared || prepared.existing) return prepared;
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO crm_ai_action_proposal_consumptions
    (job_id,activity_id,customer_id,confirmed_by,proposal_json,confirmed_json,confirmed_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    prepared.job.id,
    input.activityId,
    prepared.job.crmAccountId,
    input.actorId,
    JSON.stringify(prepared.result.value),
    JSON.stringify(prepared.confirmed),
    at,
  );
  db.prepare(`INSERT INTO crm_ai_task_reviews
    (id,job_id,reviewer_id,decision,summary,created_at) VALUES (?,?,?,?,?,?)`).run(
    `AIRV-${crypto.randomUUID()}`,
    prepared.job.id,
    input.actorId,
    'approved',
    `已确认并记录活动 ${input.activityId}`,
    at,
  );
  const updated = db.prepare(`UPDATE crm_ai_jobs SET state='succeeded',error_summary='',
    updated_at=?,finished_at=? WHERE id=? AND state='needs_review'`)
    .run(at, at, prepared.job.id);
  if (updated.changes !== 1) {
    throw proposalError('活动提案状态已变化', 'AI_ACTION_PROPOSAL_STATE_CHANGED', 409);
  }
  return Object.freeze({ existing: false, activityId: input.activityId });
}

module.exports = {
  CONFIRMED_FIELDS,
  confirmActionProposal,
  confirmedActivity,
  enqueueActionProposal,
  prepareActionProposalConfirmation,
};
