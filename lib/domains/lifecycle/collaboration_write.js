'use strict';

// Collaboration and plan fields stay independent from the customer master state
// (stage/lifecycle/assignment). These writers only touch next_action* and
// manager_* columns so the master-state shim can never couple plan semantics
// into account lifecycle transitions.

const PLAN_TIME_BASIS = 'utc';

function text(value, fallback = '') {
  return value == null ? fallback : String(value);
}

function buildPlanPatch(input = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(input, 'nextAction')) {
    patch.next_action = text(input.nextAction);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'nextActionAt')) {
    patch.next_action_at = text(input.nextActionAt);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'timeBasis')) {
    patch.next_action_time_basis = text(input.timeBasis);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'updatedAt')) {
    patch.updated_at = text(input.updatedAt);
  }
  return Object.freeze(patch);
}

function buildManagerPatch(input = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(input, 'required')) {
    patch.manager_required = input.required ? 1 : 0;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'status')) {
    patch.manager_status = text(input.status);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'managerId')) {
    patch.manager_id = input.managerId == null || input.managerId === ''
      ? ''
      : text(input.managerId);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'updatedAt')) {
    patch.updated_at = text(input.updatedAt);
  }
  return Object.freeze(patch);
}

function applyAccountPlanPatch(db, accountId, input = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('需要数据库连接');
  const id = text(accountId).trim();
  if (!id) throw new Error('缺少客户ID');
  const patch = buildPlanPatch(input);
  const fields = Object.keys(patch);
  if (!fields.length) return { changed: false, patch };
  const result = db.prepare(
    `UPDATE crm_accounts SET ${fields.map(field => `${field}=?`).join(',')} WHERE id=?`,
  ).run(...fields.map(field => patch[field]), id);
  return { changed: result.changes === 1, patch };
}

function applyManagerStatusPatch(db, accountId, input = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('需要数据库连接');
  const id = text(accountId).trim();
  if (!id) throw new Error('缺少客户ID');
  const patch = buildManagerPatch(input);
  const fields = Object.keys(patch);
  if (!fields.length) return { changed: false, patch };
  const result = db.prepare(
    `UPDATE crm_accounts SET ${fields.map(field => `${field}=?`).join(',')} WHERE id=?`,
  ).run(...fields.map(field => patch[field]), id);
  return { changed: result.changes === 1, patch };
}

module.exports = Object.freeze({
  PLAN_TIME_BASIS,
  buildPlanPatch,
  buildManagerPatch,
  applyAccountPlanPatch,
  applyManagerStatusPatch,
});
