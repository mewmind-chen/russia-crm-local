'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertAccountStateContract, buildAccountStatePatch } = require('../lib/domains/lifecycle/state_write');

// 阶段 B §4.1/§4.2 业务不变量守卫：assertAccountStateContract 校验
// 完整状态视图的契约（recycled 不配 claimed/assigned、returned 不绑 owner）。
// 注意 buildAccountStatePatch 刻意保持 lifecycle/assignment 为独立维度
// （pairing 由返回/回收调用点负责），因此守卫不在此处强制校验，而是可复用规则。
test('recycled must not pair with claimed or assigned in the state contract guard', () => {
  for (const assignmentStatus of ['claimed', 'assigned']) {
    assert.throws(
      () => assertAccountStateContract({ lifecycleStatus: 'recycled', assignmentStatus, ownerId: 'U-1' }),
      /recycled 不允许配合已分配状态/,
      `recycled + ${assignmentStatus} must be rejected`,
    );
  }
});

test('recycled may pair with returned or unassigned in the state contract guard', () => {
  assert.doesNotThrow(() => assertAccountStateContract({
    lifecycleStatus: 'recycled', assignmentStatus: 'returned', ownerId: null,
  }));
  assert.doesNotThrow(() => assertAccountStateContract({
    lifecycleStatus: 'recycled', assignmentStatus: 'unassigned', ownerId: null,
  }));
});

test('returned assignment status must not carry a non-null owner in the state contract guard', () => {
  assert.throws(
    () => assertAccountStateContract({ assignmentStatus: 'returned', ownerId: 'USR-1' }),
    /已退回不允许绑定负责人/,
  );
});

test('write shim keeps lifecycle and assignment as independent dimensions', () => {
  // 契约明确：shim 不做组合校验，recycled+claimed 是合法中间态（调用点负责配对）。
  assert.deepEqual(
    buildAccountStatePatch({ lifecycleStatus: 'recycled', assignmentStatus: 'claimed', ownerId: 'U-1' }),
    { lifecycle_status: 'recycled', assignment_status: 'claimed', owner_id: 'U-1' },
  );
});