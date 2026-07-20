const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJson } = require('../lib/sales_evaluation_ai');

test('manager evaluation AI JSON can be parsed from a fenced response', () => {
  const result = extractJson('```json\n{"summary":"重视质检","labels":[{"name":"质检严格"}]}\n```');
  assert.equal(result.summary, '重视质检');
  assert.equal(result.labels[0].name, '质检严格');
});

test('manager evaluation AI parser rejects non-structured output', () => {
  assert.throws(() => extractJson('无法分析'), /结构化标注/);
});
