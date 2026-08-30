'use strict';

const { ALLOWED_STAGES: STAGES, STAGE_INDEX } = require('../../customer_stages');
const LIFECYCLE_STATUSES = new Set(['active', 'recycled']);
const ASSIGNMENT_STATUSES = new Set(['unassigned', 'assigned', 'claimed', 'returned']);
const DEFAULT_STAGE = 'new';
const DEFAULT_LIFECYCLE_STATUS = 'active';
const DEFAULT_ASSIGNMENT_STATUS = 'claimed';

function stringValue(value, fallback = '') {
  return value == null ? fallback : String(value);
}

function normalized(value, fallback = '') {
  return stringValue(value, fallback).trim();
}

function assertAllowed(value, allowed, field) {
  if (!allowed.has(value)) throw new Error(`无效的${field}状态：${value}`);
  return value;
}

// 阶段 B §4.1/§4.2 业务不变量守卫：校验一个"合并后的完整状态视图"
// 是否违反契约（recycled 不配 claimed/assigned、returned 不绑 owner）。
// 注意：buildAccountStatePatch 刻意保持 lifecycle/assignment 为独立维度
// （配对由返回/回收调用点负责），因此此守卫不在 shim 内强制调用，而是
// 作为可复用规则，供需要校验完整视图的调用点/解释器显式使用。
function assertAccountStateContract(state) {
  const lifecycle = normalized(state?.lifecycleStatus ?? state?.lifecycle_status);
  const assignment = normalized(state?.assignmentStatus ?? state?.assignment_status);
  const ownerId = state?.ownerId ?? state?.owner_id;
  if (lifecycle === 'recycled' && ['claimed', 'assigned'].includes(assignment)) {
    throw new Error('recycled 不允许配合已分配状态');
  }
  if (assignment === 'returned' && ownerId !== null && ownerId !== '' && ownerId != null) {
    throw new Error('已退回不允许绑定负责人');
  }
  return state;
}

const STAGE_PRECONDITION_VIOLATION = 'STAGE_PRECONDITION_VIOLATION';

function defaultConflictError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// 前置阶段守卫：报价/首单前必须已到达允许的 stage（含其前置阶段），否则返回
// 409 冲突码。error 构造由调用点注入，保持与业务侧 httpError 语义一致。
function assertQuoteTransition(account, options = {}) {
  const conflictError = options.conflictError || defaultConflictError;
  const current = String(account?.stage || '').trim();
  if (!STAGES.has(current) || STAGE_INDEX[current] > STAGE_INDEX.quoted) {
    throw conflictError('客户当前阶段不可记录报价', STAGE_PRECONDITION_VIOLATION);
  }
  return account;
}

function assertFirstOrderTransition(account, options = {}) {
  const conflictError = options.conflictError || defaultConflictError;
  const current = String(account?.stage || '').trim();
  if (!STAGES.has(current) || STAGE_INDEX[current] > STAGE_INDEX.won) {
    throw conflictError('客户当前阶段不可记录首单', STAGE_PRECONDITION_VIOLATION);
  }
  return account;
}

function buildAccountStatePatch(input = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(input, 'stage')) {
    patch.stage = assertAllowed(normalized(input.stage), STAGES, '客户阶段');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'lifecycleStatus')) {
    patch.lifecycle_status = assertAllowed(
      normalized(input.lifecycleStatus), LIFECYCLE_STATUSES, '生命周期',
    );
  }
  if (Object.prototype.hasOwnProperty.call(input, 'assignmentStatus')) {
    patch.assignment_status = assertAllowed(
      normalized(input.assignmentStatus), ASSIGNMENT_STATUSES, '分配',
    );
  }
  if (Object.prototype.hasOwnProperty.call(input, 'ownerId')) {
    patch.owner_id = input.ownerId == null || input.ownerId === '' ? null : normalized(input.ownerId);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'updatedAt')) {
    patch.updated_at = stringValue(input.updatedAt);
  }
  return Object.freeze(patch);
}

function buildAccountInsertState(input = {}) {
  const state = {
    stage: assertAllowed(normalized(input.stage, DEFAULT_STAGE), STAGES, '客户阶段'),
    lifecycle_status: assertAllowed(
      normalized(input.lifecycleStatus, DEFAULT_LIFECYCLE_STATUS),
      LIFECYCLE_STATUSES,
      '生命周期',
    ),
    assignment_status: assertAllowed(
      normalized(input.assignmentStatus, DEFAULT_ASSIGNMENT_STATUS),
      ASSIGNMENT_STATUSES,
      '分配',
    ),
    owner_id: input.ownerId == null || input.ownerId === '' ? null : normalized(input.ownerId),
  };
  return Object.freeze(state);
}

function applyAccountStatePatch(db, accountId, input = {}, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('需要数据库连接');
  const id = normalized(accountId);
  if (!id) throw new Error('缺少客户ID');
  const patch = buildAccountStatePatch(input);
  const fields = Object.keys(patch);
  if (!fields.length) return { changed: false, patch };
  const expected = options.expected && typeof options.expected === 'object' ? options.expected : {};
  const conditions = [];
  const conditionParams = [];
  for (const [field, value] of Object.entries(buildAccountStatePatch(expected))) {
    if (value === null) conditions.push(`${field} IS NULL`);
    else {
      conditions.push(`${field}=?`);
      conditionParams.push(value);
    }
  }
  const where = ['id=?', ...conditions].join(' AND ');
  const result = db.prepare(`UPDATE crm_accounts SET ${fields.map(field => `${field}=?`).join(',')} WHERE ${where}`)
    .run(...fields.map(field => patch[field]), id, ...conditionParams);
  return { changed: result.changes === 1, patch };
}

module.exports = Object.freeze({
  STAGES,
  LIFECYCLE_STATUSES,
  ASSIGNMENT_STATUSES,
  STAGE_PRECONDITION_VIOLATION,
  buildAccountStatePatch,
  buildAccountInsertState,
  applyAccountStatePatch,
  assertAccountStateContract,
  assertQuoteTransition,
  assertFirstOrderTransition,
});
