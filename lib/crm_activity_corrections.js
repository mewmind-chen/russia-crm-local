'use strict';

const crypto = require('node:crypto');
const { hasPermission } = require('./access_control');
const { accountScope } = require('./business_page_filters');
const { rebuildAccountDerivedState } = require('./crm_account_rebuild');

const ENABLED_VALUES = new Set(['true', '1', 'on', 'yes']);
const COMMERCE = Object.freeze({
  rfq: Object.freeze({ table: 'crm_rfqs', prefix: 'RFQ' }),
  quote: Object.freeze({ table: 'crm_quotes', prefix: 'Q' }),
  order: Object.freeze({ table: 'crm_orders', prefix: 'ORD' }),
  repeat_order: Object.freeze({ table: 'crm_orders', prefix: 'ORD' }),
});
const REVIEW_DECISIONS = new Set(['approved', 'rejected']);

function correctionError(statusCode, message, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function requiredText(value, label, maxLength) {
  const result = String(value ?? '').trim();
  if (!result) throw correctionError(400, `${label}不能为空`, 'ACTIVITY_CORRECTION_INPUT_REQUIRED');
  if (result.length > maxLength) {
    throw correctionError(400, `${label}过长`, 'ACTIVITY_CORRECTION_INPUT_TOO_LONG');
  }
  return result;
}

function nowText(value) {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw correctionError(400, '更正时间无效', 'ACTIVITY_CORRECTION_TIME_INVALID');
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function correctionWriteEnabled(env = process.env) {
  return ENABLED_VALUES.has(String(env?.CRM_ACTIVITY_CORRECTIONS_ENABLED || '').trim().toLowerCase());
}

function assertWritesEnabled(options = {}) {
  if (!correctionWriteEnabled(options.env || process.env)) {
    throw correctionError(503, '跟进记录更正功能尚未启用', 'ACTIVITY_CORRECTIONS_DISABLED');
  }
}

function hasTable(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function tableColumns(db, table) {
  if (!hasTable(db, table)) return [];
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}

function installActivityCorrectionSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_activity_corrections (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE CHECK(length(trim(idempotency_key)) > 0),
      request_hash TEXT NOT NULL CHECK(length(trim(request_hash)) > 0),
      original_activity_id TEXT NOT NULL UNIQUE,
      replacement_activity_id TEXT NOT NULL UNIQUE,
      source_customer_id TEXT NOT NULL,
      target_customer_id TEXT NOT NULL,
      source_external_customer_id TEXT NOT NULL DEFAULT '',
      target_external_customer_id TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL,
      original_creator_id TEXT NOT NULL DEFAULT '',
      reviewer_id TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status='completed'),
      proposal_id TEXT NOT NULL DEFAULT '',
      milestone_type TEXT NOT NULL DEFAULT '',
      milestone_source_id TEXT NOT NULL DEFAULT '',
      milestone_target_id TEXT NOT NULL DEFAULT '',
      mapping_evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT '',
      decision_reason TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS crm_activity_corrections_source_idx
      ON crm_activity_corrections(source_customer_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS crm_activity_corrections_target_idx
      ON crm_activity_corrections(target_customer_id,created_at DESC,id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_activity_corrections_proposal_idx
      ON crm_activity_corrections(proposal_id) WHERE proposal_id!='';

    CREATE TABLE IF NOT EXISTS crm_activity_correction_proposals (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE CHECK(length(trim(idempotency_key)) > 0),
      request_hash TEXT NOT NULL CHECK(length(trim(request_hash)) > 0),
      original_activity_id TEXT NOT NULL,
      source_customer_id TEXT NOT NULL,
      target_customer_id TEXT NOT NULL,
      source_external_customer_id TEXT NOT NULL DEFAULT '',
      target_external_customer_id TEXT NOT NULL DEFAULT '',
      requester_id TEXT NOT NULL,
      original_creator_id TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
      reason_code TEXT NOT NULL,
      mapping_evidence_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      reviewer_id TEXT NOT NULL DEFAULT '',
      review_reason TEXT NOT NULL DEFAULT '',
      correction_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_activity_correction_proposals_scope_idx
      ON crm_activity_correction_proposals(status,source_customer_id,target_customer_id,created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_activity_correction_proposals_pending_original_idx
      ON crm_activity_correction_proposals(original_activity_id) WHERE status='pending';

    CREATE TABLE IF NOT EXISTS crm_activity_correction_decisions (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE CHECK(length(trim(idempotency_key)) > 0),
      request_hash TEXT NOT NULL CHECK(length(trim(request_hash)) > 0),
      proposal_id TEXT NOT NULL UNIQUE,
      reviewer_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
      reason TEXT NOT NULL DEFAULT '',
      expected_version INTEGER NOT NULL,
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crm_activity_correction_locks (
      activity_id TEXT PRIMARY KEY,
      locked_by TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      locked_at TEXT NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS crm_activity_corrections_no_update
      BEFORE UPDATE ON crm_activity_corrections
      BEGIN SELECT RAISE(ABORT, 'crm_activity_corrections are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS crm_activity_corrections_no_delete
      BEFORE DELETE ON crm_activity_corrections
      BEGIN SELECT RAISE(ABORT, 'crm_activity_corrections are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS crm_activity_correction_decisions_no_update
      BEFORE UPDATE ON crm_activity_correction_decisions
      BEGIN SELECT RAISE(ABORT, 'crm_activity_correction_decisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS crm_activity_correction_decisions_no_delete
      BEFORE DELETE ON crm_activity_correction_decisions
      BEGIN SELECT RAISE(ABORT, 'crm_activity_correction_decisions are immutable'); END;
  `);
}

function assertPermission(user, permission) {
  if (!hasPermission(user, permission)) {
    throw correctionError(403, '没有权限执行跟进记录更正', 'ACTIVITY_CORRECTION_FORBIDDEN');
  }
}

function scopedAccount(db, user, accountId, alias = 'a') {
  const scope = accountScope(user, alias);
  return db.prepare(`SELECT ${alias}.* FROM crm_accounts ${alias}
    WHERE ${alias}.id=? AND ${scope.conditions.join(' AND ')} LIMIT 1`)
    .get(accountId, ...scope.params);
}

function scopedActivity(db, user, activityId) {
  const scope = accountScope(user, 'a');
  return db.prepare(`SELECT x.*,a.external_customer_id source_external_customer_id
    FROM crm_activities x JOIN crm_accounts a ON a.id=x.customer_id
    WHERE x.id=? AND ${scope.conditions.join(' AND ')} LIMIT 1`)
    .get(activityId, ...scope.params);
}

function inaccessible() {
  return correctionError(403, '无权访问该跟进记录或客户', 'ACTIVITY_CORRECTION_FORBIDDEN');
}

function requestSpec(input = {}) {
  return {
    originalActivityId: requiredText(input.originalActivityId, '原跟进记录', 160),
    targetCustomerId: requiredText(input.targetCustomerId, '正确客户', 160),
    reason: requiredText(input.reason, '更正原因', 2000),
    idempotencyKey: requiredText(input.idempotencyKey, '幂等键', 240),
  };
}

function reviewSpec(input = {}) {
  const decision = requiredText(input.decision, '审批结论', 20).toLowerCase();
  if (!REVIEW_DECISIONS.has(decision)) {
    throw correctionError(400, '审批结论无效', 'ACTIVITY_CORRECTION_DECISION_INVALID');
  }
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw correctionError(400, '审批版本无效', 'ACTIVITY_CORRECTION_VERSION_INVALID');
  }
  let resolution = null;
  if (input.resolution !== undefined && input.resolution !== null) {
    if (!input.resolution || typeof input.resolution !== 'object' || Array.isArray(input.resolution)) {
      throw correctionError(400, '审批处理方式无效', 'ACTIVITY_CORRECTION_RESOLUTION_INVALID');
    }
    const mode = requiredText(input.resolution.mode, '审批处理方式', 40);
    if (!['activity_only', 'commerce_entity'].includes(mode)) {
      throw correctionError(400, '审批处理方式无效', 'ACTIVITY_CORRECTION_RESOLUTION_INVALID');
    }
    resolution = mode === 'activity_only'
      ? { mode }
      : {
          mode,
          entityType: requiredText(input.resolution.entityType, '业务里程碑类型', 40),
          entityId: requiredText(input.resolution.entityId, '业务里程碑', 160),
        };
  }
  return {
    proposalId: requiredText(input.proposalId, '更正申请', 160),
    decision,
    reason: decision === 'rejected'
      ? requiredText(input.reason, '审批原因', 2000)
      : String(input.reason || '').trim().slice(0, 2000),
    expectedVersion,
    idempotencyKey: String(input.idempotencyKey || '').trim().slice(0, 240),
    resolution,
  };
}

function milestoneMapping(db, activity) {
  const linked = [];
  for (const [type, definition] of Object.entries(COMMERCE)) {
    if (type === 'repeat_order') continue;
    const columns = new Set(tableColumns(db, definition.table));
    if (!columns.has('activity_id')) continue;
    for (const row of db.prepare(`SELECT * FROM ${definition.table} WHERE activity_id=?`).all(activity.id)) {
      linked.push({ type, definition, row });
    }
  }
  const expected = COMMERCE[String(activity.activity_type || '')];
  if (!expected && linked.length === 0) return { certain: true, mapping: null };
  if (!expected || linked.length !== 1) {
    return { certain: false, mapping: null, evidence: { linkedCount: linked.length } };
  }
  const match = linked[0];
  const expectedType = String(activity.activity_type) === 'repeat_order' ? 'order' : String(activity.activity_type);
  if (!String(match.row.id || '')
      || match.type !== expectedType
      || String(match.row.customer_id || '') !== String(activity.customer_id || '')) {
    return {
      certain: false,
      mapping: null,
      evidence: { linkedCount: linked.length, linkedType: match.type, linkedCustomerId: match.row.customer_id || '' },
    };
  }
  const upstreamId = match.type === 'quote'
    ? String(match.row.rfq_id || '')
    : match.type === 'order'
      ? String(match.row.quote_id || '')
      : '';
  if (upstreamId) {
    return {
      certain: true,
      mapping: match,
      evidence: {
        strategy: 'stable_activity_link',
        entityType: match.type,
        entityId: match.row.id,
        upstreamField: match.type === 'quote' ? 'rfq_id' : 'quote_id',
        upstreamId,
        clonePolicy: 'detach_upstream',
      },
    };
  }
  return {
    certain: true,
    mapping: match,
    evidence: { strategy: 'stable_activity_link', entityType: match.type, entityId: match.row.id },
  };
}

function directAssessment(db, actor, activity) {
  const mapping = milestoneMapping(db, activity);
  if (String(activity.user_id || '') !== String(actor.id || '')) {
    return { direct: false, reasonCode: 'OTHER_CREATOR', mapping };
  }
  const lock = db.prepare('SELECT * FROM crm_activity_correction_locks WHERE activity_id=?').get(activity.id);
  if (lock) return { direct: false, reasonCode: 'ADMIN_LOCKED', mapping, lock };
  if (!mapping.certain) return { direct: false, reasonCode: 'MAPPING_UNCERTAIN', mapping };
  if (String(activity.activity_type || '') === 'manager_join' || Number(activity.manager_required || 0)) {
    return { direct: false, reasonCode: 'KEY_ACTIVITY', mapping };
  }
  return { direct: true, reasonCode: '', mapping };
}

function resolvedMilestoneMapping(db, activity, resolution, evidence = {}) {
  if (!resolution) return null;
  if (resolution.mode === 'activity_only') {
    return {
      certain: true,
      mapping: null,
      evidence: { ...evidence, resolution: { mode: 'activity_only' } },
    };
  }
  const entityType = String(resolution.entityType || '');
  const definition = COMMERCE[entityType];
  if (!definition || entityType === 'repeat_order') {
    throw correctionError(400, '业务里程碑类型无效', 'ACTIVITY_CORRECTION_RESOLUTION_INVALID');
  }
  const columns = new Set(tableColumns(db, definition.table));
  if (!columns.has('activity_id')) throw inaccessible();
  const row = db.prepare(`SELECT * FROM ${definition.table}
    WHERE id=? AND customer_id=? AND activity_id=? LIMIT 1`)
    .get(resolution.entityId, activity.customer_id, activity.id);
  const expectedType = String(activity.activity_type || '') === 'repeat_order'
    ? 'order'
    : String(activity.activity_type || '');
  if (!row || entityType !== expectedType) throw inaccessible();
  return {
    certain: true,
    mapping: { type: entityType, definition, row },
    evidence: {
      ...evidence,
      resolution: { mode: 'commerce_entity', entityType, entityId: row.id },
    },
  };
}

function replacementId() {
  return `ACT-CORR-${crypto.randomUUID()}`;
}

function cloneRow(db, table, row, overrides) {
  const columns = tableColumns(db, table);
  const values = columns.map(column => Object.prototype.hasOwnProperty.call(overrides, column)
    ? overrides[column]
    : row[column]);
  db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
    .run(...values);
}

function copyReplacementActivity(db, original, targetCustomerId, idValue) {
  cloneRow(db, 'crm_activities', original, {
    id: idValue,
    customer_id: targetCustomerId,
    superseded_at: '',
    superseded_by: '',
  });
}

function targetPlanCustomerId(sourcePlanCustomerId, source, target) {
  return String(sourcePlanCustomerId || '') === String(source.external_customer_id || '')
    ? String(target.external_customer_id || target.id)
    : String(target.id);
}

function copySourcePlans(db, sourceType, originalSourceId, newSourceId, source, target) {
  const copies = [];
  for (const [table, prefix] of [
    ['crm_deferred_plan_events', 'DPE'],
    ['crm_next_plan_events', 'NPE'],
  ]) {
    const columns = new Set(tableColumns(db, table));
    if (!columns.has('source') || !columns.has('source_event_id')) continue;
    const rows = db.prepare(`SELECT * FROM ${table} WHERE source=? AND source_event_id=?`)
      .all(sourceType, originalSourceId);
    for (const row of rows) {
      const idValue = `${prefix}-CORR-${crypto.randomUUID()}`;
      cloneRow(db, table, row, {
        id: idValue,
        customer_id: targetPlanCustomerId(row.customer_id, source, target),
        source_event_id: newSourceId,
      });
      copies.push({ table, sourceId: row.id, targetId: idValue });
    }
  }
  return copies;
}

function copyActivityPlans(db, originalActivityId, newActivityId, source, target) {
  return copySourcePlans(db, 'activity', originalActivityId, newActivityId, source, target);
}

function copyCommerceMilestone(db, mapping, targetCustomerId, newActivityId) {
  if (!mapping) return null;
  const targetId = `${mapping.definition.prefix}-CORR-${crypto.randomUUID()}`;
  const detachedUpstream = mapping.type === 'quote'
    ? { rfq_id: '' }
    : mapping.type === 'order'
      ? { quote_id: '' }
      : {};
  cloneRow(db, mapping.definition.table, mapping.row, {
    id: targetId,
    customer_id: targetCustomerId,
    activity_id: newActivityId,
    ...detachedUpstream,
  });
  return {
    type: mapping.type,
    sourceId: mapping.row.id,
    targetId,
    ...(Object.keys(detachedUpstream).length
      ? { clonePolicy: 'detach_upstream' }
      : {}),
  };
}

function auditIdentity(user, options = {}) {
  return {
    userId: String(options.auditIdentity?.effectiveUserId || user.id || ''),
    realUserId: String(options.auditIdentity?.realUserId || user.id || ''),
    effectiveUserId: String(options.auditIdentity?.effectiveUserId || user.id || ''),
    contextId: String(options.auditIdentity?.contextId || ''),
  };
}

function recordAudit(db, user, action, entityId, detail, options = {}) {
  if (!hasTable(db, 'crm_audit_log')) {
    throw correctionError(500, '审计表未安装', 'ACTIVITY_CORRECTION_AUDIT_UNAVAILABLE');
  }
  const identity = auditIdentity(user, options);
  const available = new Set(tableColumns(db, 'crm_audit_log'));
  const row = {
    id: `AUD-${crypto.randomUUID()}`,
    user_id: identity.userId,
    action,
    entity_type: 'activity_correction',
    entity_id: entityId,
    detail_json: JSON.stringify(detail),
    created_at: options.at,
    real_user_id: identity.realUserId,
    effective_user_id: identity.effectiveUserId,
    impersonation_context_id: identity.contextId,
  };
  const columns = Object.keys(row).filter(column => available.has(column));
  db.prepare(`INSERT INTO crm_audit_log (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
    .run(...columns.map(column => row[column]));
}

function injectFault(options, point) {
  const requested = options.faultAt;
  if (typeof requested === 'function') return requested(point);
  const aliases = {
    replacement: 'afterReplacement',
    correction: 'afterCorrection',
    supersede: 'afterSupersede',
    sourceRebuild: 'afterSourceRebuild',
    targetRebuild: 'afterTargetRebuild',
    notification: 'beforeNotification',
  };
  if (requested === point || aliases[requested] === point) {
    throw correctionError(500, `fault injected at ${point}`, 'ACTIVITY_CORRECTION_FAULT_INJECTED');
  }
}

function publicCorrection(row, deduplicated = false) {
  return {
    correctionId: row.id,
    originalActivityId: row.original_activity_id,
    replacementActivityId: row.replacement_activity_id,
    sourceCustomerId: row.source_customer_id,
    targetCustomerId: row.target_customer_id,
    proposalId: row.proposal_id || '',
    milestoneType: row.milestone_type || '',
    milestoneSourceId: row.milestone_source_id || '',
    milestoneTargetId: row.milestone_target_id || '',
    actorId: row.actor_id,
    reviewerId: row.reviewer_id || '',
    reason: row.reason,
    status: row.status || 'completed',
    createdAt: row.created_at,
    deduplicated,
  };
}

function existingCorrectionReplay(db, user, spec, actorId, requestHash) {
  const row = db.prepare('SELECT * FROM crm_activity_corrections WHERE idempotency_key=?')
    .get(spec.idempotencyKey);
  if (!row) return null;
  if (!scopedAccount(db, user, row.source_customer_id, 'source')
      || !scopedAccount(db, user, row.target_customer_id, 'target')) throw inaccessible();
  if (row.actor_id !== actorId || row.request_hash !== requestHash) {
    throw correctionError(409, '幂等键已绑定其他更正请求', 'ACTIVITY_CORRECTION_IDEMPOTENCY_CONFLICT');
  }
  return publicCorrection(row, true);
}

function requiresApproval(reasonCode, details = {}) {
  return correctionError(409, '该记录需要主管或管理员审批后更正', 'REQUIRES_APPROVAL', {
    reasonCode,
    ...details,
  });
}

function performCorrection(db, authorizingUser, spec, options = {}) {
  const actorId = String(options.correctionActorId || authorizingUser.id || '');
  const requestHash = digest({
    actorId,
    originalActivityId: spec.originalActivityId,
    targetCustomerId: spec.targetCustomerId,
    reason: spec.reason,
    proposalId: String(options.proposalId || ''),
  });
  const replay = existingCorrectionReplay(db, authorizingUser, spec, actorId, requestHash);
  if (replay) return replay;

  const original = scopedActivity(db, authorizingUser, spec.originalActivityId);
  if (!original) throw inaccessible();
  const source = scopedAccount(db, authorizingUser, original.customer_id, 'a');
  const target = scopedAccount(db, authorizingUser, spec.targetCustomerId, 'a');
  if (!source || !target) throw inaccessible();
  if (source.id === target.id) {
    throw correctionError(409, '正确客户不能与原客户相同', 'ACTIVITY_CORRECTION_SAME_CUSTOMER');
  }
  if (String(original.superseded_at || '') || String(original.superseded_by || '')) {
    throw correctionError(409, '该跟进记录已经更正', 'ACTIVITY_ALREADY_CORRECTED');
  }
  if (db.prepare('SELECT 1 FROM crm_activity_corrections WHERE original_activity_id=?').get(original.id)) {
    throw correctionError(409, '该跟进记录已经更正', 'ACTIVITY_ALREADY_CORRECTED');
  }

  let assessment = directAssessment(db, { id: actorId }, original);
  if (assessment.mapping.certain && options.reviewOverride && options.mappingResolution) {
    throw correctionError(
      409,
      '业务关联已变化，请刷新后重新审批',
      'ACTIVITY_CORRECTION_MAPPING_CHANGED',
    );
  }
  if (!assessment.mapping.certain && options.reviewOverride && options.mappingResolution) {
    assessment = {
      ...assessment,
      mapping: resolvedMilestoneMapping(
        db, original, options.mappingResolution, assessment.mapping.evidence || {},
      ),
    };
  }
  const allowedOverrides = new Set([
    'OTHER_CREATOR', 'ADMIN_LOCKED', 'KEY_ACTIVITY', 'MAPPING_UNCERTAIN',
  ]);
  if (!assessment.direct
      && !(options.reviewOverride && allowedOverrides.has(assessment.reasonCode))) {
    throw requiresApproval(assessment.reasonCode, assessment.mapping.evidence || {});
  }
  if (!assessment.mapping.certain) {
    throw requiresApproval('MAPPING_UNCERTAIN', assessment.mapping.evidence || {});
  }

  const correctionId = `CORR-${crypto.randomUUID()}`;
  const newActivityId = replacementId();
  const at = options.at;
  copyReplacementActivity(db, original, target.id, newActivityId);
  injectFault(options, 'afterReplacement');
  const planCopies = copyActivityPlans(db, original.id, newActivityId, source, target);
  const commerceCopy = copyCommerceMilestone(
    db, assessment.mapping.mapping, target.id, newActivityId,
  );
  const commercePlanCopies = commerceCopy
    ? copySourcePlans(
      db, commerceCopy.type, commerceCopy.sourceId, commerceCopy.targetId, source, target,
    )
    : [];
  const mappingEvidence = {
    ...(assessment.mapping.evidence || {}),
    copiedPlans: [...planCopies, ...commercePlanCopies],
    commerceCopy,
  };
  db.prepare(`INSERT INTO crm_activity_corrections
    (id,idempotency_key,request_hash,original_activity_id,replacement_activity_id,
     source_customer_id,target_customer_id,source_external_customer_id,target_external_customer_id,
     actor_id,original_creator_id,reviewer_id,reason,proposal_id,milestone_type,
     milestone_source_id,milestone_target_id,mapping_evidence_json,created_at,reviewed_at,decision_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    correctionId,
    spec.idempotencyKey,
    requestHash,
    original.id,
    newActivityId,
    source.id,
    target.id,
    source.external_customer_id || '',
    target.external_customer_id || '',
    actorId,
    original.user_id || '',
    options.reviewerId || '',
    spec.reason,
    options.proposalId || '',
    commerceCopy?.type || '',
    commerceCopy?.sourceId || '',
    commerceCopy?.targetId || '',
    JSON.stringify(mappingEvidence),
    at,
    options.reviewerId ? at : '',
    options.decisionReason || '',
  );
  injectFault(options, 'afterCorrection');
  const superseded = db.prepare(`UPDATE crm_activities SET superseded_at=?,superseded_by=?
    WHERE id=? AND superseded_at='' AND superseded_by=''`).run(at, newActivityId, original.id);
  if (superseded.changes !== 1) {
    throw correctionError(409, '该跟进记录已经更正', 'ACTIVITY_ALREADY_CORRECTED');
  }
  injectFault(options, 'afterSupersede');
  try {
    rebuildAccountDerivedState(db, source.id, { now: `${at.replace(' ', 'T')}Z` });
    injectFault(options, 'afterSourceRebuild');
    rebuildAccountDerivedState(db, target.id, { now: `${at.replace(' ', 'T')}Z` });
    injectFault(options, 'afterTargetRebuild');
  } catch (error) {
    if (error?.statusCode === 409 || error?.code === 'CRM_ACCOUNT_REBUILD_BASELINE_UNCERTAIN') {
      throw requiresApproval('STAGE_BASELINE_UNCERTAIN', { causeCode: error.code || '' });
    }
    throw error;
  }
  recordAudit(db, authorizingUser, options.reviewerId
    ? 'activity_correction_approved'
    : 'activity_correction_completed', correctionId, {
    correctionId,
    proposalId: options.proposalId || '',
    originalActivityId: original.id,
    replacementActivityId: newActivityId,
    sourceCustomerId: source.id,
    sourceExternalCustomerId: source.external_customer_id || '',
    targetCustomerId: target.id,
    targetExternalCustomerId: target.external_customer_id || '',
    actorId,
    originalCreatorId: original.user_id || '',
    reviewerId: options.reviewerId || '',
    reason: spec.reason,
    mappingEvidence,
  }, options);
  injectFault(options, 'beforeNotification');
  if (typeof options.enqueueNotifications === 'function') {
    options.enqueueNotifications(db, {
      correctionId,
      proposalId: options.proposalId || '',
      source,
      target,
      actorId,
      reviewerId: options.reviewerId || '',
      reason: spec.reason,
      at,
    });
  }
  return publicCorrection(db.prepare('SELECT * FROM crm_activity_corrections WHERE id=?').get(correctionId));
}

function correctActivity(db, user, input = {}, options = {}) {
  assertWritesEnabled(options);
  assertPermission(user, 'correct_own_activity');
  installActivityCorrectionSchema(db);
  const spec = requestSpec(input);
  const transactionOptions = { ...options, at: nowText(options.now) };
  return db.transaction(() => performCorrection(db, user, spec, transactionOptions)).immediate();
}

function proposalView(row, deduplicated = false) {
  return {
    proposalId: row.id,
    status: row.status,
    version: Number(row.version),
    originalActivityId: row.original_activity_id,
    sourceCustomerId: row.source_customer_id,
    targetCustomerId: row.target_customer_id,
    requesterId: row.requester_id,
    originalCreatorId: row.original_creator_id || '',
    reason: row.reason,
    reasonCode: row.reason_code,
    reviewerId: row.reviewer_id || '',
    reviewReason: row.review_reason || '',
    correctionId: row.correction_id || '',
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || '',
    deduplicated,
  };
}

function proposeActivityCorrection(db, user, input = {}, options = {}) {
  assertWritesEnabled(options);
  assertPermission(user, 'correct_own_activity');
  installActivityCorrectionSchema(db);
  const spec = requestSpec(input);
  const at = nowText(options.now);
  const requestHash = digest({ actorId: user.id, ...spec });
  return db.transaction(() => {
    const replay = db.prepare('SELECT * FROM crm_activity_correction_proposals WHERE idempotency_key=?')
      .get(spec.idempotencyKey);
    if (replay) {
      if (!scopedAccount(db, user, replay.source_customer_id, 'source')
          || !scopedAccount(db, user, replay.target_customer_id, 'target')) throw inaccessible();
      if (replay.requester_id !== user.id || replay.request_hash !== requestHash) {
        throw correctionError(409, '幂等键已绑定其他更正申请', 'ACTIVITY_CORRECTION_IDEMPOTENCY_CONFLICT');
      }
      return proposalView(replay, true);
    }
    const original = scopedActivity(db, user, spec.originalActivityId);
    if (!original) throw inaccessible();
    const source = scopedAccount(db, user, original.customer_id, 'a');
    const target = scopedAccount(db, user, spec.targetCustomerId, 'a');
    if (!source || !target) throw inaccessible();
    if (source.id === target.id) {
      throw correctionError(409, '正确客户不能与原客户相同', 'ACTIVITY_CORRECTION_SAME_CUSTOMER');
    }
    if (String(original.superseded_at || '') || String(original.superseded_by || '')) {
      throw correctionError(409, '该跟进记录已经更正', 'ACTIVITY_ALREADY_CORRECTED');
    }
    const existing = db.prepare(`SELECT * FROM crm_activity_correction_proposals
      WHERE original_activity_id=? AND status='pending'`).get(original.id);
    if (existing) {
      throw correctionError(409, '该跟进记录已有待审批申请', 'ACTIVITY_CORRECTION_PROPOSAL_PENDING');
    }
    const assessment = directAssessment(db, user, original);
    const reasonCodeOverride = String(options.reasonCodeOverride || '').trim();
    if (assessment.direct && !reasonCodeOverride) {
      throw correctionError(409, '该记录可以直接更正，无需提交审批', 'DIRECT_CORRECTION_AVAILABLE');
    }
    const reasonCode = reasonCodeOverride || assessment.reasonCode;
    const proposalId = `CORP-${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO crm_activity_correction_proposals
      (id,idempotency_key,request_hash,original_activity_id,source_customer_id,target_customer_id,
       source_external_customer_id,target_external_customer_id,requester_id,original_creator_id,
       reason,reason_code,mapping_evidence_json,status,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',1,?,?)`).run(
      proposalId,
      spec.idempotencyKey,
      requestHash,
      original.id,
      source.id,
      target.id,
      source.external_customer_id || '',
      target.external_customer_id || '',
      user.id,
      original.user_id || '',
      spec.reason,
      reasonCode,
      JSON.stringify(assessment.mapping.evidence || {}),
      at,
      at,
    );
    recordAudit(db, user, 'activity_correction_proposed', proposalId, {
      proposalId,
      originalActivityId: original.id,
      sourceCustomerId: source.id,
      targetCustomerId: target.id,
      requesterId: user.id,
      reason: spec.reason,
      reasonCode,
    }, { ...options, at });
    injectFault(options, 'beforeProposalNotification');
    if (typeof options.enqueueNotifications === 'function') {
      options.enqueueNotifications(db, {
        proposalId,
        source,
        target,
        actorId: user.id,
        reason: spec.reason,
        at,
      });
    }
    return proposalView(db.prepare('SELECT * FROM crm_activity_correction_proposals WHERE id=?').get(proposalId));
  }).immediate();
}

function reviewReplay(db, user, spec, requestHash) {
  const key = spec.idempotencyKey || `activity-correction-review:${spec.proposalId}:${spec.expectedVersion}:${spec.decision}`;
  const row = db.prepare(`SELECT d.*,p.source_customer_id,p.target_customer_id
    FROM crm_activity_correction_decisions d
    JOIN crm_activity_correction_proposals p ON p.id=d.proposal_id
    WHERE d.idempotency_key=?`).get(key);
  if (!row) return { key, result: null };
  if (!scopedAccount(db, user, row.source_customer_id, 'source')
      || !scopedAccount(db, user, row.target_customer_id, 'target')) throw inaccessible();
  if (row.reviewer_id !== user.id || row.request_hash !== requestHash) {
    throw correctionError(409, '幂等键已绑定其他审批请求', 'ACTIVITY_CORRECTION_IDEMPOTENCY_CONFLICT');
  }
  return { key, result: { ...JSON.parse(row.result_json), deduplicated: true } };
}

function reviewActivityCorrection(db, user, input = {}, options = {}) {
  assertWritesEnabled(options);
  assertPermission(user, 'manage_activity_corrections');
  if (!['admin', 'manager'].includes(String(user.role || ''))) throw inaccessible();
  installActivityCorrectionSchema(db);
  const spec = reviewSpec(input);
  const at = nowText(options.now);
  const requestHash = digest({ reviewerId: user.id, ...spec, idempotencyKey: undefined });
  return db.transaction(() => {
    const replay = reviewReplay(db, user, spec, requestHash);
    if (replay.result) return replay.result;
    const proposal = db.prepare('SELECT * FROM crm_activity_correction_proposals WHERE id=?')
      .get(spec.proposalId);
    if (!proposal) throw inaccessible();
    const source = scopedAccount(db, user, proposal.source_customer_id, 'source');
    const target = scopedAccount(db, user, proposal.target_customer_id, 'target');
    if (!source || !target) throw inaccessible();
    if (proposal.status !== 'pending') {
      throw correctionError(409, '更正申请已经处理', 'ACTIVITY_CORRECTION_PROPOSAL_DECIDED');
    }
    if (Number(proposal.version) !== spec.expectedVersion) {
      throw correctionError(409, '更正申请版本已变化', 'ACTIVITY_CORRECTION_VERSION_CONFLICT');
    }
    let correction = null;
    if (spec.decision === 'approved') {
      const correctionSpec = {
        originalActivityId: proposal.original_activity_id,
        targetCustomerId: proposal.target_customer_id,
        reason: proposal.reason,
        idempotencyKey: `activity-correction-proposal:${proposal.id}:approved`,
      };
      correction = performCorrection(db, user, correctionSpec, {
        ...options,
        at,
        reviewOverride: true,
        correctionActorId: proposal.requester_id,
        reviewerId: user.id,
        proposalId: proposal.id,
        decisionReason: spec.reason,
        mappingResolution: spec.resolution,
      });
    }
    const nextVersion = Number(proposal.version) + 1;
    const result = {
      proposalId: proposal.id,
      status: spec.decision,
      version: nextVersion,
      correctionId: correction?.correctionId || '',
      reviewerId: user.id,
      deduplicated: false,
    };
    db.prepare(`INSERT INTO crm_activity_correction_decisions
      (id,idempotency_key,request_hash,proposal_id,reviewer_id,decision,reason,
       expected_version,result_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      `CORD-${crypto.randomUUID()}`,
      replay.key,
      requestHash,
      proposal.id,
      user.id,
      spec.decision,
      spec.reason,
      spec.expectedVersion,
      JSON.stringify(result),
      at,
    );
    db.prepare(`UPDATE crm_activity_correction_proposals SET status=?,version=?,reviewer_id=?,
      review_reason=?,correction_id=?,reviewed_at=?,updated_at=? WHERE id=? AND status='pending' AND version=?`)
      .run(spec.decision, nextVersion, user.id, spec.reason, result.correctionId, at, at,
        proposal.id, spec.expectedVersion);
    recordAudit(db, user, `activity_correction_${spec.decision}`, proposal.id, result, {
      ...options,
      at,
    });
    injectFault(options, 'beforeReviewNotification');
    if (spec.decision === 'rejected' && typeof options.enqueueNotifications === 'function') {
      options.enqueueNotifications(db, {
        proposalId: proposal.id,
        correctionId: result.correctionId,
        decision: spec.decision,
        source,
        target,
        actorId: proposal.requester_id,
        requesterId: proposal.requester_id,
        reviewerId: user.id,
        reason: proposal.reason,
        reviewReason: spec.reason,
        at,
      });
    }
    return result;
  }).immediate();
}

function searchCorrectionTargets(db, user, query = {}) {
  if (!hasPermission(user, 'correct_own_activity')
      && !hasPermission(user, 'manage_activity_corrections')) assertPermission(user, 'correct_own_activity');
  const search = String(typeof query === 'string' ? query : query.q || '').trim();
  if (search.length > 120) {
    throw correctionError(400, '客户搜索内容最多120个字符', 'ACTIVITY_CORRECTION_SEARCH_TOO_LONG');
  }
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 20));
  const scope = accountScope(user, 'a');
  const conditions = [...scope.conditions];
  const params = [...scope.params];
  if (query.excludeCustomerId) {
    conditions.push('a.id!=?');
    params.push(String(query.excludeCustomerId));
  }
  for (const word of search.toLowerCase().split(/\s+/).filter(Boolean)) {
    conditions.push(`(lower(COALESCE(p.nickname,a.nickname,'')) LIKE ? ESCAPE '\\'
      OR lower(COALESCE(NULLIF(p.company_name,''),a.company_name)) LIKE ? ESCAPE '\\'
      OR lower(a.id) LIKE ? ESCAPE '\\' OR lower(a.external_customer_id) LIKE ? ESCAPE '\\')`);
    const like = `%${word.replace(/[\\%_]/g, '\\$&')}%`;
    params.push(like, like, like, like);
  }
  return db.prepare(`SELECT a.id,a.external_customer_id,
      COALESCE(p.nickname,a.nickname,'') nickname,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,a.stage
    FROM crm_accounts a LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY CASE WHEN trim(COALESCE(p.nickname,a.nickname,''))!='' THEN 0 ELSE 1 END,
      COALESCE(p.nickname,a.nickname,''),COALESCE(NULLIF(p.company_name,''),a.company_name),a.id
    LIMIT ?`).all(...params, limit).map(row => ({
    id: row.id,
    externalCustomerId: row.external_customer_id || '',
    nickname: row.nickname || '',
    companyName: row.company_name || '',
    stage: row.stage || '',
  }));
}

function listActivityCorrections(db, user, input = {}) {
  if (!hasPermission(user, 'correct_own_activity')
      && !hasPermission(user, 'manage_activity_corrections')) assertPermission(user, 'correct_own_activity');
  installActivityCorrectionSchema(db);
  const sourceScope = accountScope(user, 'source');
  const targetScope = accountScope(user, 'target');
  const conditions = [...sourceScope.conditions, ...targetScope.conditions];
  const params = [...sourceScope.params, ...targetScope.params];
  if (!hasPermission(user, 'manage_activity_corrections')) {
    conditions.push('c.actor_id=?');
    params.push(user.id);
  }
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
  const offset = Math.max(0, Number(input.offset) || 0);
  return db.prepare(`SELECT c.* FROM crm_activity_corrections c
    JOIN crm_accounts source ON source.id=c.source_customer_id
    JOIN crm_accounts target ON target.id=c.target_customer_id
    WHERE ${conditions.join(' AND ')} ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset).map(row => publicCorrection(row));
}

function listActivityCorrectionProposals(db, user, input = {}) {
  assertPermission(user, 'manage_activity_corrections');
  installActivityCorrectionSchema(db);
  const sourceScope = accountScope(user, 'source');
  const targetScope = accountScope(user, 'target');
  const conditions = [...sourceScope.conditions, ...targetScope.conditions];
  const params = [...sourceScope.params, ...targetScope.params];
  if (input.status) {
    const status = String(input.status);
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      throw correctionError(400, '更正申请状态无效', 'ACTIVITY_CORRECTION_STATUS_INVALID');
    }
    conditions.push('p.status=?');
    params.push(status);
  }
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
  const offset = Math.max(0, Number(input.offset) || 0);
  return db.prepare(`SELECT p.* FROM crm_activity_correction_proposals p
    JOIN crm_accounts source ON source.id=p.source_customer_id
    JOIN crm_accounts target ON target.id=p.target_customer_id
    WHERE ${conditions.join(' AND ')} ORDER BY p.created_at DESC,p.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset).map(row => proposalView(row));
}

module.exports = {
  correctionWriteEnabled,
  correctActivity,
  installActivityCorrectionSchema,
  listActivityCorrectionProposals,
  listActivityCorrections,
  proposeActivityCorrection,
  reviewActivityCorrection,
  searchCorrectionTargets,
};
