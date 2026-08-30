'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  projectNextAction,
} = require('../lib/domains/lifecycle/state_projection');

// 阶段 B §4.3：next_action 有值时必配 next_action_time_basis（否则 degraded）。
// 投影必须同时检查"时间"与"time_basis"两个维度，缺任一即 degraded。
test('next action without a time basis is marked as degraded even when a time exists', () => {
  assert.deepEqual(
    projectNextAction({ next_action: '跟进报价', next_action_at: '2099-08-28 09:00:00' }),
    {
      text: '跟进报价',
      at: '2099-08-28 09:00:00',
      planned: false,
      degraded: true,
      overdue: false,
    },
  );
});

test('next action with both time and time basis is planned', () => {
  assert.deepEqual(
    projectNextAction({
      next_action: '跟进报价',
      next_action_at: '2099-08-28 09:00:00',
      next_action_time_basis: 'utc',
    }),
    {
      text: '跟进报价',
      at: '2099-08-28 09:00:00',
      planned: true,
      degraded: false,
      overdue: false,
    },
  );
});

test('empty next action stays not planned and not degraded', () => {
  assert.deepEqual(projectNextAction({ next_action: '', next_action_at: '' }), {
    text: '',
    at: '',
    planned: false,
    degraded: false,
    overdue: false,
  });
});