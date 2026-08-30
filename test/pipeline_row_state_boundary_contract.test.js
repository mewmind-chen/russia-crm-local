'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');
const { listPipelineRows } = require('../lib/business_page_filters');

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

const body = functionSlice(source, 'publicPipelineActionRow', 'pipelineActionSummary');

// 阶段 B 边界收敛：pipeline 行与 accounts/bootstrap/profile 一致，不再附加
// state DTO（前端直读裸字段，已无任何 .state.* 消费方；唯一消费点是白名单 redact，
// 对缺 state 行优雅降级）。状态读取仍经投影（pipelineActionKeys 的 due_followup/
// manager_assistance 已在前序切片收敛）。
test('publicPipelineActionRow no longer attaches the state DTO', () => {
  assert.doesNotMatch(body, /projectAccountState/, 'pipeline rows must not spread the state DTO');
  assert.doesNotMatch(
    source,
    /projectAccountState.*projectNextAction|projectNextAction.*projectAccountState/,
    'state_projection import must not include projectAccountState',
  );
});

function user(id, permissions) {
  return { id, permissions, role: 'sales' };
}

// 行为契约：pipeline 行保留裸字段与动作键，但无 state DTO。
test('pipeline rows keep raw fields and action keys without the state DTO', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const sales = user('U-OTHER', { view_pipeline: true });
  const all = listPipelineRows(fx.db, sales, { page: 'pipeline', filters: [] }, {
    pageSize: 50,
  });
  const row = all.rows.find(item => item.id === 'CRM-OTHER');
  assert.ok(row, 'fixture account must be in the pipeline');
  assert.equal(row.state, undefined, 'pipeline rows must not carry the state DTO');
  assert.equal(row.stage, 'qualified', 'raw stage field must be preserved');
  assert.equal(row.assignment_status, 'claimed', 'raw assignment field must be preserved');
  assert.ok(Array.isArray(row.actionQueueKeys), 'action queue keys must still be computed');
  assert.equal(row.manager_required, row.manager_required === 1 ? 1 : row.manager_required,
    'raw manager field must be preserved');
});