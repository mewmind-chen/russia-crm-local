'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（customer/normalize 批）：客户资料规范化 helper 必须从
// lib/domains/customer/normalize import，不得内联。注入式错误构造函数
// （normalizeEstablishedYear/normalizeAccountNickname/normalizeCustomerStarReason）
// 的调用点必须注入 { badRequest } 以保持与原内联版相同的 HttpError 语义。
test('customer normalize helpers are wired from domain module, not inlined', () => {
  assert.match(source, /const \{\s*normalizeCountry,\s*normalizeEstablishedYear,\s*normalizeAccountNickname,\s*normalizeCustomerStarReason,\s*\} = require\('\.\/domains\/customer\/normalize'\);/);
  assert.doesNotMatch(source, /^function normalizeCountry\(/m);
  assert.doesNotMatch(source, /^function normalizeEstablishedYear\(/m);
  assert.doesNotMatch(source, /^function normalizeAccountNickname\(/m);
  assert.doesNotMatch(source, /^function normalizeCustomerStarReason\(/m);
  // 注入点：normalizeEstablishedYear 3 + normalizeAccountNickname 2 + normalizeCustomerStarReason 1 = 6
  // （activity_present 批已有 10 处，合计下限 16）
  const injections = (source.match(/\{ badRequest \}/g) || []).length;
  assert.ok(injections >= 16, `expected >=16 injected call sites, got ${injections}`);
});
