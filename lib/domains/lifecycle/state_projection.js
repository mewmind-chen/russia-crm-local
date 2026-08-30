'use strict';

const { isFollowUpTerminalStage } = require('../../customer_stages');

const DEFAULT_STAGE = 'new';
const DEFAULT_LIFECYCLE_STATUS = 'active';
const DEFAULT_ASSIGNMENT_STATUS = 'claimed';
const DEFAULT_MANAGER_STATUS = '';
const CURRENT_ASSIGNMENT_STATUSES = new Set(['assigned', 'claimed']);

function text(value, fallback = '') {
  return value == null ? fallback : String(value);
}

function booleanFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function projectCustomerState(account = {}) {
  const key = text(account.stage, DEFAULT_STAGE) || DEFAULT_STAGE;
  return {
    key,
    terminal: isFollowUpTerminalStage(key),
  };
}

function projectAssignmentState(account = {}, intakeItem = null) {
  const accountStatus = text(account.assignment_status);
  const intakeStatus = text(intakeItem?.status);
  const key = accountStatus || intakeStatus || DEFAULT_ASSIGNMENT_STATUS;
  const ownerId = text(account.owner_id || intakeItem?.assigned_owner_id);
  return {
    key,
    ownerId,
    current: CURRENT_ASSIGNMENT_STATUSES.has(key) && Boolean(ownerId),
  };
}

function projectManagerState(account = {}) {
  const required = booleanFlag(account.manager_required);
  const status = text(account.manager_status, DEFAULT_MANAGER_STATUS);
  return {
    required,
    status: required && !status ? '待介入' : status,
  };
}

function parseDate(value) {
  const raw = text(value).trim();
  if (!raw) return 0;
  const timestamp = new Date(raw.replace(' ', 'T') + 'Z').getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function projectNextAction(account = {}, now = Date.now()) {
  const textValue = text(account.next_action);
  const atValue = text(account.next_action_at);
  const basisValue = text(account.next_action_time_basis);
  const timestamp = parseDate(atValue);
  const complete = Boolean(textValue && atValue && basisValue);
  return {
    text: textValue,
    at: atValue,
    planned: complete,
    degraded: Boolean(textValue && !complete),
    overdue: Boolean(timestamp && timestamp < now),
  };
}

function projectAccountState(account = {}, intakeItem = null) {
  const stage = projectCustomerState(account);
  const lifecycleKey = text(account.lifecycle_status, DEFAULT_LIFECYCLE_STATUS) || DEFAULT_LIFECYCLE_STATUS;
  const assignment = projectAssignmentState(account, intakeItem);
  const manager = projectManagerState(account);
  const nextAction = projectNextAction(account);
  return {
    stage: account.stage == null ? DEFAULT_STAGE : text(account.stage) || DEFAULT_STAGE,
    lifecycleStatus: lifecycleKey,
    assignmentStatus: assignment.key,
    managerStatus: manager.status,
    nextAction: nextAction.text,
    nextActionAt: nextAction.at,
    state: {
      stage,
      lifecycle: {
        key: lifecycleKey,
        recycled: lifecycleKey === 'recycled',
      },
      assignment: {
        ...assignment,
      },
      manager,
      nextAction,
    },
  };
}

module.exports = Object.freeze({
  projectCustomerState,
  projectAssignmentState,
  projectManagerState,
  projectNextAction,
  projectAccountState,
});
