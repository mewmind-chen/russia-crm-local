'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');
const accountRoutesSource = fs.readFileSync(
  path.join(root, 'lib', 'sales_crm_account_routes.js'),
  'utf8',
);
const assembledSource = `${source}\n${accountRoutesSource}`;

// 阶段 A 接线契约（B 组注入式批）：customer/recycle 的注入式错误构造函数
// 必须从域模块 import（不内联），且所有调用点必须注入 { httpError: recycleError }
// 以保持与内联版相同的 HttpError 语义（statusCode + code）。
test('customer/recycle injected-error helpers are wired with httpError injection, not inlined', () => {
  // import 已接线（含 manualReturnBatchId 合并进同一 require）
  assert.match(source, /const \{\s*validateRecycleReason,\s*mismatchRecordNotFound,\s*parseMismatchRecordKey,\s*assertCustomerReturnEligible,\s*manualReturnBatchId,\s*\} = require\('\.\/domains\/customer\/recycle'\);/);
  // 不再内联
  assert.doesNotMatch(source, /^function validateRecycleReason\(/m);
  assert.doesNotMatch(source, /^function mismatchRecordNotFound\(/m);
  assert.doesNotMatch(source, /^function parseMismatchRecordKey\(/m);
  assert.doesNotMatch(source, /^function assertCustomerReturnEligible\(/m);
  // 全部调用点注入 httpError（validateRecycleReason 5 + assertEligible 3 + parseKey 1 + notFound 3 = 12）
  const injections = (assembledSource.match(/\{ httpError: recycleError \}/g) || []).length;
  assert.ok(injections >= 12, `expected >=12 injected call sites, got ${injections}`);
});
