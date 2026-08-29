'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约：CSV 与洞察纯 helper 必须从 lib/domains 域模块 import，不得在 sales_crm.js 内联定义。
test('csv cell helper is imported from lib/domains/reporting/csv, not inlined', () => {
  assert.match(source, /const \{ csvCell, csvSerialize \} = require\('\.\/domains\/reporting\/csv'\);/);
  assert.doesNotMatch(source, /^function csvCell\(/m);
});

test('insight label sanitizer is imported from lib/domains/insights/labels, not inlined', () => {
  assert.match(source, /const \{ safeEvaluationLabel \} = require\('\.\/domains\/insights\/labels'\);/);
  assert.doesNotMatch(source, /^function safeEvaluationLabel\(/m);
});