'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（B 组函数级一致批）：
// commerce/rules 的 advanceStage/commerceActionIdempotencyKey 与
// customer/recycle 的 manualReturnBatchId 必须从域模块 import，不得内联。
// 其余函数（validateMargin/validateRfqPayload/validateRecycleReason/
// assertCustomerReturnEligible 等）使用注入式错误构造，与内联版行为不同，保持内联。
test('commerce idempotency and recycle batch id helpers are wired from domain modules, not inlined', () => {
  assert.match(source, /const \{ advanceStage, commerceActionIdempotencyKey \} = require\('\.\/domains\/commerce\/rules'\);/);
  assert.match(source, /const \{ manualReturnBatchId \} = require\('\.\/domains\/customer\/recycle'\);/);
  assert.doesNotMatch(source, /^function advanceStage\(/m);
  assert.doesNotMatch(source, /^function commerceActionIdempotencyKey\(/m);
  assert.doesNotMatch(source, /^function manualReturnBatchId\(/m);
});
