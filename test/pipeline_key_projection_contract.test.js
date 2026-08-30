'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'business_page_filters.js'), 'utf8');

function functionSlice(sourceText, functionName, nextFunctionName) {
  const start = sourceText.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = nextFunctionName
    ? sourceText.indexOf(`function ${nextFunctionName}(`, start + 1)
    : sourceText.length;
  if (nextFunctionName) assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return sourceText.slice(start, end);
}

const body = functionSlice(source, 'pipelineActionKeys', 'publicPipelineActionRow');

// 阶段 B §4.4：pipeline 行的动作键（due_followup / manager_assistance）必须消费
// state_projection（overdue / manager 投影），不得自行裸比较 next_action_at /
// manager_status（否则与 §4.3 time_basis 与主管状态归一语义发散）。
test('pipelineActionKeys consumes projection instead of comparing raw lifecycle columns', () => {
  assert.match(source, /projectNextAction/, 'must import projectNextAction');
  assert.match(source, /projectManagerState/, 'must import projectManagerState');
  assert.match(body, /projectNextAction\(/, 'due_followup must use the projection overdue');
  assert.match(body, /projectManagerState\(/, 'manager_assistance must use the manager projection');
  assert.doesNotMatch(body, /String\(row\.next_action_at\) <= nowText/, 'must not compare raw next_action_at');
  assert.doesNotMatch(body, /row\.manager_status !==/, 'must not compare raw manager_status');
});