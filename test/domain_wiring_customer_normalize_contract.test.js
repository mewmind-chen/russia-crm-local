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
  // normalize 系调用点必须注入 { badRequest }
  assert.match(source, /normalizeCustomerStarReason\(payload\.reason, \{ badRequest \}\)/);
  assert.match(source, /normalizeAccountNickname\(payload\?\.nickname, \{ badRequest \}\)/);
  assert.match(source, /normalizeAccountNickname\(payload\.nickname, \{ badRequest \}\)/);
  assert.match(source, /normalizeEstablishedYear\(customerInput\.establishedYear, \{ badRequest \}\)/);
  assert.match(source, /normalizeEstablishedYear\(payload\.establishedYear, \{ badRequest \}\)/);
  assert.match(source, /normalizeEstablishedYear\(next, \{ badRequest \}\)/);
});
