'use strict';

const { ALLOWED_STAGES: STAGES } = require('../../customer_stages');
const LIFECYCLE_STATUSES = new Set(['active', 'recycled']);
const ASSIGNMENT_STATUSES = new Set(['unassigned', 'assigned', 'claimed', 'returned']);

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
  buildAccountStatePatch,
  applyAccountStatePatch,
});
