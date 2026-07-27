'use strict';

const crypto = require('node:crypto');
const { buildCustomerContext } = require('./context');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');
const { isFollowUpTerminalStage } = require('../customer_stages');

function clean(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function nextActionError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function nextActionIdempotencyKey(eventType, eventId) {
  return `ai-station:next_action:v1:${clean(eventType, 120)}:${clean(eventId, 160)}`;
}

function enqueueNextAction(input = {}) {
  const eventType = clean(input.eventType, 120);
  const eventId = clean(input.eventId, 160);
  if (!eventType || !eventId) throw nextActionError('next action event is required', 'AI_NEXT_ACTION_EVENT_REQUIRED');
  const context = buildCustomerContext(input.db, input.accessContext, input.customerId, {
    station: 'next_action',
  });
  return createAIJobStore(input.db).enqueue({
    customerId: input.customerId,
    crmAccountId: context.context.crmAccountId,
    station: 'next_action',
    contextHash: context.contextHash,
    payload: {
      contextVersion: 'crm-v1',
      stationVersion: 'v1',
      trigger: eventType,
      eventId,
    },
    createdBy: input.actor?.id || '',
    eventType,
    eventId,
    triggerSource: input.triggerSource,
    triggerReason: input.triggerReason,
    priority: 30,
  }, nextActionIdempotencyKey(eventType, eventId));
}

function confirmedNextAction(input = {}) {
  return {
    nextAction: clean(input.nextAction, 1000),
    nextActionAt: clean(input.nextActionAt, 80),
    managerRequired: Boolean(input.managerRequired),
  };
}

function adoptNextAction(db, input = {}) {
  const jobId = clean(input.jobId, 160);
  const actorId = clean(input.actorId, 160);
  const existing = db.prepare('SELECT * FROM crm_ai_next_action_consumptions WHERE job_id=?').get(jobId);
  if (existing) {
    if (existing.confirmed_by !== actorId) {
      throw nextActionError('无权采纳该下一步建议', 'AI_NEXT_ACTION_FORBIDDEN', 403);
    }
    return Object.freeze({ jobId, customerId: existing.customer_id, deduplicated: true });
  }
  const job = createAIJobStore(db).getJob(jobId);
  if (!job || job.station !== 'next_action') {
    throw nextActionError('下一步建议不存在', 'AI_NEXT_ACTION_NOT_FOUND', 404);
  }
  if (job.createdBy !== actorId || job.crmAccountId !== input.crmAccountId) {
    throw nextActionError('无权采纳该下一步建议', 'AI_NEXT_ACTION_FORBIDDEN', 403);
  }
  if (job.state !== 'needs_review') {
    throw nextActionError('下一步建议尚未生成或已结束', 'AI_NEXT_ACTION_NOT_READY', 409);
  }
  const result = createAIResultStore(db).getForJob(jobId);
  if (!result) throw nextActionError('下一步建议结果不存在', 'AI_NEXT_ACTION_NOT_READY', 409);
  const confirmed = confirmedNextAction(input.confirmed);
  const missingFields = ['nextAction', 'nextActionAt'].filter(field => !confirmed[field]);
  if (missingFields.length) {
    const error = nextActionError('采纳前请补充下一步动作和计划时间', 'AI_NEXT_ACTION_INCOMPLETE');
    error.publicDetails = { missingFields };
    throw error;
  }
  const at = new Date().toISOString();
  db.transaction(() => {
    const account = db.prepare('SELECT stage FROM crm_accounts WHERE id=?').get(job.crmAccountId);
    if (!account) throw nextActionError('客户不存在', 'AI_NEXT_ACTION_CUSTOMER_NOT_FOUND', 404);
    if (isFollowUpTerminalStage(account.stage)) {
      throw nextActionError('该客户已处于无需跟进的终止阶段', 'AI_NEXT_ACTION_TERMINAL_STAGE', 409);
    }
    const updatedAccount = db.prepare(`UPDATE crm_accounts SET next_action=?,next_action_at=?,
      manager_required=CASE WHEN ?=1 THEN 1 ELSE manager_required END,
      manager_status=CASE WHEN ?=1 THEN '待介入' ELSE manager_status END,updated_at=? WHERE id=?`)
      .run(confirmed.nextAction, confirmed.nextActionAt, confirmed.managerRequired ? 1 : 0,
        confirmed.managerRequired ? 1 : 0, at, job.crmAccountId);
    if (updatedAccount.changes !== 1) {
      throw nextActionError('客户不存在', 'AI_NEXT_ACTION_CUSTOMER_NOT_FOUND', 404);
    }
    db.prepare(`INSERT INTO crm_ai_next_action_consumptions
      (job_id,customer_id,confirmed_by,proposal_json,confirmed_json,confirmed_at)
      VALUES (?,?,?,?,?,?)`).run(
      job.id, job.crmAccountId, actorId, JSON.stringify(result.value), JSON.stringify(confirmed), at,
    );
    db.prepare(`INSERT INTO crm_ai_task_reviews
      (id,job_id,reviewer_id,decision,summary,created_at) VALUES (?,?,?,?,?,?)`).run(
      `AIRV-${crypto.randomUUID()}`, job.id, actorId, 'approved', '已采纳下一步建议', at,
    );
    const updatedJob = db.prepare(`UPDATE crm_ai_jobs SET state='succeeded',error_summary='',
      updated_at=?,finished_at=? WHERE id=? AND state='needs_review'`).run(at, at, job.id);
    if (updatedJob.changes !== 1) {
      throw nextActionError('下一步建议状态已变化', 'AI_NEXT_ACTION_STATE_CHANGED', 409);
    }
  }).immediate();
  return Object.freeze({ jobId, customerId: job.crmAccountId, deduplicated: false });
}

module.exports = {
  adoptNextAction,
  confirmedNextAction,
  enqueueNextAction,
  nextActionIdempotencyKey,
};
