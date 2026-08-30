'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');
const gate = fs.readFileSync(path.join(root, 'lib', 'domains', 'lifecycle', 'state_write.js'), 'utf8');

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
test('quote/order stage preconditions live in lifecycle assert*Transition guards, not inlined', () => {
  // sales_crm.js 的 addQuote/addOrder 不再内联 STAGE_PRECONDITION_VIOLATION 判定
  const quoteBody = functionSlice(source, 'addQuote', 'addOrder');
  const orderBody = functionSlice(source, 'addOrder', 'reserveCustomerCreate');
  assert.doesNotMatch(
    quoteBody,
    /STAGE_PRECONDITION_VIOLATION|STAGE_INDEX/,
    'addQuote must not inline the stage precondition',
  );
  assert.doesNotMatch(
    orderBody,
    /STAGE_PRECONDITION_VIOLATION|STAGE_INDEX/,
    'addOrder must not inline the stage precondition',
  );
  // 但调用点都经网关守卫
  assert.match(quoteBody, /assertQuoteTransition\(/);
  assert.match(orderBody, /assertFirstOrderTransition\(/);
  // 守卫实现在 state_write 网关且返回约定的冲突码
  assert.match(gate, /function assertQuoteTransition\(/);
  assert.match(gate, /function assertFirstOrderTransition\(/);
  assert.match(gate, /STAGE_PRECONDITION_VIOLATION/);
});