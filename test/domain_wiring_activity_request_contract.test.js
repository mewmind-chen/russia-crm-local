'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（activity/request 批）：客户反应请求解析必须从
// lib/domains/activity/request import，不得内联。域版以注入式
// findReactionById/findReactionByKey 隔离 SQL，调用点必须注入闭包
// （含 badRequest/conflictError）以保持与原内联版相同的行为。
test('resolveActivityReaction is wired from domain module, not inlined', () => {
  assert.match(source, /const \{ resolveActivityReaction \} = require\('\.\/domains\/activity\/request'\);/);
  assert.doesNotMatch(source, /^function resolveActivityReaction\(/m);
  assert.match(source, /resolveActivityReaction\(payload, \{/);
  assert.match(source, /findReactionById:/);
  assert.match(source, /findReactionByKey:/);
});
