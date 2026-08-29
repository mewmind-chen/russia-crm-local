'use strict';

const assert = require('node:assert/strict');

// 阶段 B §1 完成门的结构化断言助手：业务函数体内 gated 列不得再被裸
// `UPDATE crm_accounts SET ...` 直写，且必须经对应 lifecycle 网关调用。

function functionSlice(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = nextFunctionName
    ? source.indexOf(`function ${nextFunctionName}(`, start + 1)
    : source.length;
  if (nextFunctionName) assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return source.slice(start, end);
}

const STATE_COLUMNS = /UPDATE crm_accounts SET[^)]*(?:stage\s*=|lifecycle_status\s*=|assignment_status\s*=|(?<![a-z_])owner_id\s*=|(?<![a-z_])updated_at\s*=)/;
const PLAN_COLUMNS = /UPDATE crm_accounts SET[^)]*(?:next_action\s*=|next_action_at\s*=|next_action_time_basis\s*=|(?<![a-z_])updated_at\s*=)/;
const MANAGER_COLUMNS = /UPDATE crm_accounts SET[^)]*(?:manager_required\s*=|manager_status\s*=|manager_id\s*=|(?<![a-z_])updated_at\s*=)/;

function assertNoColumns(body, columns, requiredCalls, label) {
  assert.doesNotMatch(
    body,
    columns,
    `${label}: gated columns must not be set by a bare UPDATE`,
  );
  for (const call of requiredCalls) {
    assert.match(body, call, `${label}: must route the write through ${call}`);
  }
}

module.exports = Object.freeze({
  functionSlice,
  STATE_COLUMNS,
  PLAN_COLUMNS,
  MANAGER_COLUMNS,
  assertNoColumns,
});