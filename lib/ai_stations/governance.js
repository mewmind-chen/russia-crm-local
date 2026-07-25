'use strict';

const crypto = require('node:crypto');
const { installAIStationSchema } = require('./schema');
const { asIso, parseJson } = require('./audit');

const FEEDBACK_LABELS = Object.freeze({
  won: '成交',
  replied: '回复',
  returned: '退回',
  stalled: '停滞',
  human_rejected: '人工驳回',
});

function governanceError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function cleanText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function mapStrategy(row, evaluationCount = 0) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    strategyKey: row.strategy_key,
    version: row.version,
    station: row.station,
    model: row.model,
    promptVersion: row.prompt_version,
    ruleVersion: row.rule_version,
    config: parseJson(row.config_json, {}),
    status: row.status,
    supersedesId: row.supersedes_id || '',
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    approvalRole: row.approval_role,
    evaluationCount,
    createdAt: row.created_at,
    approvalRequestedAt: row.approval_requested_at,
    publishedAt: row.published_at,
    retiredAt: row.retired_at,
    updatedAt: row.updated_at,
  });
}

function createAIGovernanceStore(db, options = {}) {
  installAIStationSchema(db);
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || (prefix => `${prefix}-${crypto.randomUUID()}`);

  function timestamp() {
    return asIso(now());
  }

  function writeAudit(actor, action, entityType, entityId, detail = {}) {
    const exists = db.prepare(`SELECT 1 FROM sqlite_master
      WHERE type='table' AND name='crm_audit_log'`).get();
    if (!exists) return;
    db.prepare(`INSERT INTO crm_audit_log
      (id,user_id,action,entity_type,entity_id,detail_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      idFactory('AUD'),
      cleanText(actor?.id, 120),
      action,
      entityType,
      entityId,
      JSON.stringify(detail),
      timestamp(),
    );
  }

  function requireHumanApprover(actor) {
    if (!actor?.id || !['admin', 'manager'].includes(actor.role)) {
      throw governanceError('Only an administrator or manager can govern AI versions', 'AI_GOVERNANCE_FORBIDDEN', 403);
    }
  }

  function feedback(input = {}) {
    const jobId = cleanText(input.jobId, 160);
    const label = cleanText(input.label, 40);
    const key = cleanText(input.idempotencyKey, 240);
    if (!jobId || !key) throw governanceError('jobId and idempotencyKey are required', 'AI_FEEDBACK_INVALID');
    if (!FEEDBACK_LABELS[label]) throw governanceError('Unsupported AI outcome label', 'AI_FEEDBACK_LABEL_INVALID');
    const existing = db.prepare('SELECT * FROM crm_ai_feedback_labels WHERE idempotency_key=?').get(key);
    if (existing) return Object.freeze({ ...existing, labelName: FEEDBACK_LABELS[existing.label] });
    const row = db.prepare(`SELECT j.*,r.id result_id,r.model result_model,
      r.prompt_version result_prompt_version
      FROM crm_ai_jobs j LEFT JOIN crm_ai_station_results r ON r.job_id=j.id
      WHERE j.id=?`).get(jobId);
    if (!row) throw governanceError('AI job not found', 'AI_JOB_NOT_FOUND', 404);
    const latestRun = db.prepare(`SELECT model FROM crm_ai_model_runs
      WHERE job_id=? ORDER BY attempt DESC,finished_at DESC,id DESC LIMIT 1`).get(jobId);
    const payload = parseJson(row.input_json, {});
    const at = timestamp();
    const id = idFactory('AIFB');
    db.prepare(`INSERT INTO crm_ai_feedback_labels
      (id,job_id,result_id,customer_id,station,label,model,prompt_version,rule_version,
       actor_id,note,idempotency_key,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, row.id, row.result_id || null, row.customer_id, row.station, label,
      cleanText(row.result_model || latestRun?.model || 'deterministic', 160),
      cleanText(row.result_prompt_version || payload.promptVersion || 'v1', 80),
      cleanText(payload.ruleVersion || input.ruleVersion || 'v1', 80),
      cleanText(input.actor?.id, 120), cleanText(input.note, 500), key, at,
    );
    writeAudit(input.actor, 'ai_feedback_recorded', 'ai_job', row.id, { label, labelName: FEEDBACK_LABELS[label] });
    const saved = db.prepare('SELECT * FROM crm_ai_feedback_labels WHERE id=?').get(id);
    return Object.freeze({ ...saved, labelName: FEEDBACK_LABELS[saved.label] });
  }

  function metrics(input = {}) {
    const allowedCustomerIds = input.customerIds instanceof Set ? input.customerIds : null;
    const rows = db.prepare('SELECT * FROM crm_ai_feedback_labels ORDER BY created_at,id').all()
      .filter(row => !allowedCustomerIds || allowedCustomerIds.has(row.customer_id));
    const groups = new Map();
    for (const row of rows) {
      const key = [row.station, row.model, row.prompt_version, row.rule_version].join('\0');
      if (!groups.has(key)) {
        groups.set(key, {
          station: row.station,
          model: row.model,
          promptVersion: row.prompt_version,
          ruleVersion: row.rule_version,
          total: 0,
          labels: Object.fromEntries(Object.keys(FEEDBACK_LABELS).map(label => [label, 0])),
        });
      }
      const group = groups.get(key);
      group.total += 1;
      group.labels[row.label] += 1;
    }
    return [...groups.values()].map(group => Object.freeze({
      ...group,
      winRate: group.total ? group.labels.won / group.total : 0,
      replyRate: group.total ? group.labels.replied / group.total : 0,
      rejectionRate: group.total ? group.labels.human_rejected / group.total : 0,
    })).sort((left, right) => right.total - left.total
      || left.station.localeCompare(right.station)
      || left.model.localeCompare(right.model));
  }

  function strategy(id) {
    const row = db.prepare('SELECT * FROM crm_ai_strategy_versions WHERE id=?').get(cleanText(id, 160));
    if (!row) return null;
    const count = db.prepare(`SELECT COUNT(*) count FROM crm_ai_shadow_evaluations
      WHERE strategy_version_id=?`).get(row.id).count;
    return mapStrategy(row, Number(count));
  }

  function strategies() {
    return db.prepare('SELECT id FROM crm_ai_strategy_versions ORDER BY strategy_key,created_at DESC,id DESC')
      .all().map(row => strategy(row.id));
  }

  function createShadow(input = {}) {
    requireHumanApprover(input.actor);
    const strategyKey = cleanText(input.strategyKey, 120);
    const version = cleanText(input.version, 80);
    const station = cleanText(input.station, 120);
    const model = cleanText(input.model, 160);
    const promptVersion = cleanText(input.promptVersion, 80);
    const ruleVersion = cleanText(input.ruleVersion, 80);
    if (![strategyKey, version, station, model, promptVersion, ruleVersion].every(Boolean)) {
      throw governanceError('Strategy identity and all version fields are required', 'AI_STRATEGY_INVALID');
    }
    if (!input.config || typeof input.config !== 'object' || Array.isArray(input.config)) {
      throw governanceError('Strategy config must be an object', 'AI_STRATEGY_CONFIG_INVALID');
    }
    const at = timestamp();
    const id = idFactory('AISTR');
    try {
      db.prepare(`INSERT INTO crm_ai_strategy_versions
        (id,strategy_key,version,station,model,prompt_version,rule_version,config_json,status,
         created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'shadow',?,?,?)`).run(
        id, strategyKey, version, station, model, promptVersion, ruleVersion,
        JSON.stringify(input.config), input.actor.id, at, at,
      );
    } catch (error) {
      if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
        throw governanceError('Strategy version already exists', 'AI_STRATEGY_VERSION_EXISTS', 409);
      }
      throw error;
    }
    writeAudit(input.actor, 'ai_strategy_shadow_created', 'ai_strategy_version', id, {
      strategyKey, version, station, model, promptVersion, ruleVersion,
    });
    return strategy(id);
  }

  function recordShadowEvaluation(input = {}) {
    requireHumanApprover(input.actor);
    const selected = strategy(input.strategyVersionId);
    if (!selected) throw governanceError('Strategy version not found', 'AI_STRATEGY_NOT_FOUND', 404);
    if (selected.status !== 'shadow') {
      throw governanceError('Only a shadow strategy can receive evaluations', 'AI_STRATEGY_NOT_SHADOW', 409);
    }
    const outcome = cleanText(input.outcome, 40);
    if (!['better', 'same', 'worse', 'inconclusive'].includes(outcome)) {
      throw governanceError('Invalid shadow evaluation outcome', 'AI_SHADOW_OUTCOME_INVALID');
    }
    const baseline = db.prepare(`SELECT id FROM crm_ai_strategy_versions
      WHERE strategy_key=? AND status='published' ORDER BY published_at DESC,id DESC LIMIT 1`)
      .get(selected.strategyKey);
    const id = idFactory('AISE');
    db.prepare(`INSERT INTO crm_ai_shadow_evaluations
      (id,strategy_version_id,baseline_version_id,job_id,result_id,metrics_json,outcome,evaluated_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, selected.id, baseline?.id || null, input.jobId || null, input.resultId || null,
      JSON.stringify(input.metrics && typeof input.metrics === 'object' ? input.metrics : {}),
      outcome, input.actor.id, timestamp(),
    );
    writeAudit(input.actor, 'ai_strategy_shadow_evaluated', 'ai_strategy_version', selected.id, { outcome });
    return strategy(selected.id);
  }

  function requestPublish(input = {}) {
    requireHumanApprover(input.actor);
    const selected = strategy(input.strategyVersionId);
    if (!selected) throw governanceError('Strategy version not found', 'AI_STRATEGY_NOT_FOUND', 404);
    if (selected.status !== 'shadow') {
      throw governanceError('Only a shadow strategy can request publishing', 'AI_STRATEGY_NOT_SHADOW', 409);
    }
    if (selected.evaluationCount < 1) {
      throw governanceError('At least one shadow evaluation is required', 'AI_STRATEGY_SHADOW_REQUIRED', 409);
    }
    const at = timestamp();
    db.prepare(`UPDATE crm_ai_strategy_versions SET status='pending_approval',
      approval_requested_at=?,updated_at=? WHERE id=? AND status='shadow'`).run(at, at, selected.id);
    writeAudit(input.actor, 'ai_strategy_publish_requested', 'ai_strategy_version', selected.id);
    return strategy(selected.id);
  }

  function approve(input = {}) {
    requireHumanApprover(input.actor);
    const selected = strategy(input.strategyVersionId);
    if (!selected) throw governanceError('Strategy version not found', 'AI_STRATEGY_NOT_FOUND', 404);
    if (selected.status !== 'pending_approval') {
      throw governanceError('Strategy is not awaiting approval', 'AI_STRATEGY_NOT_PENDING', 409);
    }
    const at = timestamp();
    const publish = db.transaction(() => {
      const current = db.prepare(`SELECT id FROM crm_ai_strategy_versions
        WHERE strategy_key=? AND status='published' ORDER BY published_at DESC,id DESC LIMIT 1`)
        .get(selected.strategyKey);
      if (current) db.prepare(`UPDATE crm_ai_strategy_versions SET status='retired',
        retired_at=?,updated_at=? WHERE id=? AND status='published'`).run(at, at, current.id);
      const updated = db.prepare(`UPDATE crm_ai_strategy_versions SET status='published',
        supersedes_id=?,approved_by=?,approval_role=?,published_at=?,retired_at='',updated_at=?
        WHERE id=? AND status='pending_approval'`).run(
        current?.id || null, input.actor.id, input.actor.role, at, at, selected.id,
      );
      if (updated.changes !== 1) throw governanceError('Strategy state changed', 'AI_STRATEGY_STATE_CHANGED', 409);
      return current?.id || '';
    });
    const supersedesId = publish.immediate();
    writeAudit(input.actor, 'ai_strategy_published', 'ai_strategy_version', selected.id, { supersedesId });
    return strategy(selected.id);
  }

  function rollback(input = {}) {
    requireHumanApprover(input.actor);
    const target = strategy(input.strategyVersionId);
    if (!target) throw governanceError('Strategy version not found', 'AI_STRATEGY_NOT_FOUND', 404);
    if (target.status !== 'retired') {
      throw governanceError('Only a retained retired version can be restored', 'AI_STRATEGY_NOT_ROLLBACK_TARGET', 409);
    }
    const at = timestamp();
    const restore = db.transaction(() => {
      const current = db.prepare(`SELECT id FROM crm_ai_strategy_versions
        WHERE strategy_key=? AND status='published'`).get(target.strategyKey);
      if (current) db.prepare(`UPDATE crm_ai_strategy_versions SET status='retired',
        retired_at=?,updated_at=? WHERE id=?`).run(at, at, current.id);
      const updated = db.prepare(`UPDATE crm_ai_strategy_versions SET status='published',
        approved_by=?,approval_role=?,published_at=?,retired_at='',updated_at=?
        WHERE id=? AND status='retired'`).run(input.actor.id, input.actor.role, at, at, target.id);
      if (updated.changes !== 1) throw governanceError('Strategy state changed', 'AI_STRATEGY_STATE_CHANGED', 409);
      return current?.id || '';
    });
    const replacedId = restore.immediate();
    writeAudit(input.actor, 'ai_strategy_rolled_back', 'ai_strategy_version', target.id, { replacedId });
    return strategy(target.id);
  }

  return Object.freeze({
    feedback,
    metrics,
    strategies,
    strategy,
    createShadow,
    recordShadowEvaluation,
    requestPublish,
    approve,
    rollback,
  });
}

module.exports = { FEEDBACK_LABELS, createAIGovernanceStore };
