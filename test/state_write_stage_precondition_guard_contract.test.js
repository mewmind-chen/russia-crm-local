'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');
const gate = fs.readFileSync(path.join(root, 'lib', 'domains', 'lifecycle', 'state_write.js'), 'utf8');
const commerceWrite = fs.readFileSync(path.join(root, 'lib', 'domains', 'commerce', 'write.js'), 'utf8');

function functionSlice(sourceText, functionName, nextFunctionName) {
  const start = sourceText.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = nextFunctionName
    ? sourceText.indexOf(`function ${nextFunctionName}(`, start + 1)
    : sourceText.length;
  if (nextFunctionName) assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return sourceText.slice(start, end);
}

// 阶段 B §4 强化：报价/首单的 stage 前置校验必须收敛到 lifecycle 网关的
// assert*Transition 守卫，不在 sales_crm.js 内联拼 STAGE_INDEX + 错误。
// 编排下沉后，守卫调用点在 write.js 的 commitQuote/commitOrder 服务内。
test('quote/order stage preconditions live in lifecycle assert*Transition guards, not inlined', () => {
  // sales_crm.js 的 addQuote/addOrder 不再内联 STAGE_PRECONDITION_VIOLATION 判定
  // 也不再直接调用守卫（已下沉）
  const quoteBody = functionSlice(source, 'addQuote', 'addOrder');
  const orderBody = functionSlice(source, 'addOrder', 'reserveCustomerCreate');
  for (const [label, body] of [['addQuote', quoteBody], ['addOrder', orderBody]]) {
    assert.doesNotMatch(
      body,
      /STAGE_PRECONDITION_VIOLATION|STAGE_INDEX/,
      `${label} must not inline the stage precondition`,
    );
    assert.doesNotMatch(body, /assertQuoteTransition\(|assertFirstOrderTransition\(/,
      `${label} must not call the transition guards directly (now in write.js commit service)`);
  }
  // 守卫经 write.js commit 服务调用，且实现在 state_write 网关返回约定冲突码
  assert.match(commerceWrite, /assertQuoteTransition\(account, \{ conflictError \}\)/);
  assert.match(commerceWrite, /assertFirstOrderTransition\(account, \{ conflictError \}\)/);
  assert.match(gate, /function assertQuoteTransition\(/);
  assert.match(gate, /function assertFirstOrderTransition\(/);
  assert.match(gate, /STAGE_PRECONDITION_VIOLATION/);
});