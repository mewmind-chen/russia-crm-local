'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（insights/evaluation 批）：主管评价投影与 AI 字段剥离 helper
// 必须从 lib/domains/insights/evaluation import，不得内联。
test('insights evaluation helpers are wired from domain module, not inlined', () => {
  assert.match(source, /const \{\s*normalizeEvaluation,\s*withoutEvaluationAI,\s*withoutEvaluationAIRow,\s*aiFeatureDisabled,\s*\} = require\('\.\/domains\/insights\/evaluation'\);/);
  assert.doesNotMatch(source, /^function normalizeEvaluation\(/m);
  assert.doesNotMatch(source, /^function withoutEvaluationAI\(/m);
  assert.doesNotMatch(source, /^function withoutEvaluationAIRow\(/m);
  assert.doesNotMatch(source, /^function aiFeatureDisabled\(/m);
});
