'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');
const dedupeModule = fs.readFileSync(path.join(root, 'lib', 'domains', 'customer', 'dedupe.js'), 'utf8');

// 阶段 A 接线契约（customer/dedupe 批）：重复客户指纹/候选审查 helper 必须
// 从 lib/domains/customer/dedupe import，不得内联。接线后 canonicalDomain/
// canonicalHostname 不再被 sales_crm.js 直接使用（指纹域内自洽），应从
// ai_stations/enrichment/dedupe 的 import 中移除（AI 模块本身零改动）。
test('customer dedupe helpers are wired from domain module, not inlined', () => {
  assert.match(source, /const \{\s*duplicateFingerprint,\s*hydrateDuplicateCandidate,\s*reviewCandidateRows,\s*reviewHasProtectedExact,\s*\} = require\('\.\/domains\/customer\/dedupe'\);/);
  assert.doesNotMatch(source, /^function duplicateFingerprint\(/m);
  assert.doesNotMatch(source, /^function hydrateDuplicateCandidate\(/m);
  assert.doesNotMatch(source, /^function reviewCandidateRows\(/m);
  assert.doesNotMatch(source, /^function reviewHasProtectedExact\(/m);
  // canonicalDomain/canonicalHostname 孤儿 import 已移除；DUPLICATE_RULE_VERSION 等仍在使用
  assert.doesNotMatch(source, /canonicalDomain|canonicalHostname/);
  assert.match(source, /DUPLICATE_RULE_VERSION/);
});

test('customer dedupe module is the single new isolation point for the AI dedupe helpers', () => {
  // 隔离点本身自 ai_stations/enrichment/dedupe 引入指纹工具（既有耦合迁移）；该耦合
  // 由 check-ai-boundary 白名单显式声明。sales_crm.js 仍消费 DUPLICATE_RULE_VERSION /
  // finder 等业务 helper，但不再直接 import canonicalDomain/canonicalHostname——
  // 这部分指纹工具收敛到 domain 隔离点。
  assert.match(dedupeModule, /require\('\.\.\/\.\.\/ai_stations\/enrichment\/dedupe'\)/);
  assert.doesNotMatch(source, /canonicalDomain|canonicalHostname/);
});
