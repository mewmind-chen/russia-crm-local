const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeManagerEvaluation, extractJson } = require('../lib/sales_evaluation_ai');

test('manager evaluation AI JSON can be parsed from a fenced response', () => {
  const result = extractJson('```json\n{"summary":"重视质检","labels":[{"name":"质检严格"}]}\n```');
  assert.equal(result.summary, '重视质检');
  assert.equal(result.labels[0].name, '质检严格');
});

test('manager evaluation AI parser rejects non-structured output', () => {
  assert.throws(() => extractJson('无法分析'), /结构化标注/);
});

test('manager evaluation uses the unified model router with read-only options', async () => {
  const calls = [];
  const result = await analyzeManagerEvaluation({
    subjectType: 'company',
    subjectName: 'Fixture Industries',
    evaluation: '重视质量，等待报价。',
  }, {
    callAssistantModel: async (messages, options) => {
      calls.push({ messages, options });
      return {
        answer: JSON.stringify({ summary: '重视质量', labels: [], order_keys: [], risks: [], strategy: '先确认规格' }),
        model: 'DeepSeek',
        engine: 'deepseek',
      };
    },
  });
  assert.equal(result.model, 'DeepSeek');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, {
    scope: 'manager_evaluation:企业',
    externalAllowed: false,
  });
});
