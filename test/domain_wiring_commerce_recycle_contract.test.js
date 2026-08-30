'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（B 组函数级一致批）与被阶段 D 扩展：
// commerce/rules 的 advanceStage/commerceActionIdempotencyKey/validateMoney/
// validateCurrency/validateMargin 与 customer/recycle 的 manualReturnBatchId
// 必须从域模块 import，不得内联；validateMoney/validateCurrency/validateMargin
// 使用注入式错误构造，调用点注入 badRequest 保持原语义。
test('commerce idempotency and recycle batch id helpers are wired from domain modules, not inlined', () => {
  assert.match(source, /const \{\s*advanceStage,\s*validateMoney,\s*validateCurrency,\s*validateMargin,\s*commerceActionIdempotencyKey,\s*\} = require\('\.\/domains\/commerce\/rules'\);/);
  assert.match(source, /const \{\s*validateRecycleReason,\s*mismatchRecordNotFound,\s*parseMismatchRecordKey,\s*assertCustomerReturnEligible,\s*manualReturnBatchId,\s*\} = require\('\.\/domains\/customer\/recycle'\);/);
  assert.doesNotMatch(source, /^function advanceStage\(/m);
  assert.doesNotMatch(source, /^function commerceActionIdempotencyKey\(/m);
  assert.doesNotMatch(source, /^function validateMoney\(/m);
  assert.doesNotMatch(source, /^function validateCurrency\(/m);
  assert.doesNotMatch(source, /^function validateMargin\(/m);
  assert.doesNotMatch(source, /^function manualReturnBatchId\(/m);
  assert.match(source, /validateMoney\(payload\.amount, '报价金额', \{ badRequest \}\)/);
  assert.match(source, /validateCurrency\(payload\.currency, \{ badRequest \}\)/);
  assert.match(source, /validateMargin\(payload\.grossMargin, Boolean\(payload\.lossLeader\), \{ badRequest \}\)/);
  assert.match(source, /validateMargin\(payload\.grossMargin, true, \{ badRequest \}\)/);
});

// 注入式行为契约：validateMoney/validateCurrency/validateMargin 使用注入的
// badRequest 构造错误且返回归一后数值，与内联版语义一致。
test('quote/order validation uses injected badRequest and normalized values', () => {
  const { validateMoney, validateCurrency, validateMargin } = require('../lib/domains/commerce/rules');
  const thrown = [];
  const badRequest = message => { const error = new Error(message); thrown.push(message); return error; };
  const options = { badRequest };

  assert.equal(validateMoney('12500.234', '报价金额', options), 12500.23);
  assert.throws(() => validateMoney('0', '报价金额', options), /大于0的有效金额/);
  assert.equal(thrown.at(-1) === '报价金额必须是大于0的有效金额', true);

  assert.equal(validateCurrency('usd', options), 'USD');
  assert.equal(validateCurrency('', options), 'USD');
  assert.throws(() => validateCurrency('CNY-CNY', options), /不支持的报价或订单币种/);

  assert.equal(validateMargin('8', false, options), 8);
  assert.equal(validateMargin('-2.35', true, options), -2.3);
  assert.throws(() => validateMargin('-2', false, options), /毛利率必须在有效范围内/);
  assert.throws(() => validateMargin('120', true, options), /毛利率必须在有效范围内/);
});
