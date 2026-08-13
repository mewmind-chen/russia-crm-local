'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const nextActionTime = require('../sales-assets/next-action-time');

const nowMs = Date.parse('2026-08-13T00:00:00Z');

function atOffset(milliseconds) {
  return new Date(nowMs + milliseconds).toISOString();
}

test('describes restrained next-action countdown states against a fixed clock', () => {
  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;
  const matrix = [
    [49 * HOUR, 'normal', '还有 2 天'],
    [36 * HOUR, 'normal', '还有 1 天 12 小时'],
    [12 * HOUR, 'approaching', '还有 12 小时'],
    [5 * HOUR, 'dueSoon', '还有 5 小时'],
    [59 * MINUTE, 'dueSoon', '还有 59 分钟'],
    [0, 'dueSoon', '已到计划时间'],
    [-MINUTE, 'overdue', '已超时 1 分钟'],
    [-26 * HOUR, 'overdue', '已超时 1 天 2 小时'],
  ];

  matrix.forEach(([offset, state, label]) => {
    assert.deepEqual(
      nextActionTime.describeNextActionTime(atOffset(offset), 'utc', nowMs),
      { state, label, ariaLabel: label },
    );
  });
});

test('does not infer relative time for legacy, empty, or invalid plan timestamps', () => {
  const unavailable = { state: 'unavailable', label: '', ariaLabel: '' };
  assert.deepEqual(nextActionTime.describeNextActionTime(atOffset(60_000), '', nowMs), unavailable);
  assert.deepEqual(nextActionTime.describeNextActionTime('', 'utc', nowMs), unavailable);
  assert.deepEqual(nextActionTime.describeNextActionTime('not-a-date', 'utc', nowMs), unavailable);
  assert.deepEqual(nextActionTime.describeNextActionTime(atOffset(60_000), 'utc', NaN), unavailable);
});
