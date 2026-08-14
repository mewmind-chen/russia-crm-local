'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('manager task detail uses unified assistance terminology', () => {
  const detail = section(app, 'async function openManagerTaskDetail', 'function setManagerTaskAction');
  assert.match(detail, /主管协助事项详情/);
  assert.match(detail, /主管协助 · /);
  assert.match(detail, /过往主管协助记录/);
  assert.match(detail, /该客户暂无历史主管协助记录/);
  assert.match(detail, /回复销售并完成协助/);
  assert.doesNotMatch(detail, /主管任务详情/);
  assert.doesNotMatch(detail, /主管介入记录/);
  assert.doesNotMatch(detail, /暂无介入记录/);
  assert.doesNotMatch(detail, /请在今日待办中处理该经理协助请求/);
});

test('manager evidence renders business labels only, never raw keys', () => {
  const detail = section(app, 'async function openManagerTaskDetail', 'function setManagerTaskAction');
  const renderer = section(app, 'function managerEvidencePresentation', 'function setManagerTaskAction');
  assert.match(renderer, /activityId: '关联跟进记录'/);
  assert.match(renderer, /nextActionAt: '原计划时间'/);
  assert.match(renderer, /progressType: '原跟进方式'/);
  assert.match(renderer, /requestReason: '请求协助原因'/);
  assert.match(detail, /managerEvidencePresentation\(key\)/);
  assert.match(detail, /managerEvidenceDisplayValue\(key, value\)/);
  assert.doesNotMatch(detail, /esc\(typeof value === 'object' \? JSON\.stringify\(value\) : value\)/);
  assert.doesNotMatch(detail, /<span>\$\{esc\(key\)\}<\/span>/);
});

test('manager assistance tasks render a direct reply form from the board', () => {
  const detail = section(app, 'async function openManagerTaskDetail', 'function setManagerTaskAction');
  assert.match(detail, /managerAssistanceReplyForm/);
  assert.match(detail, /assistanceCanReply/);
  assert.match(detail, /can\('view_team'\)/);
  assert.match(detail, /name="result" rows="3"/);
  assert.match(detail, /该任务已完成，仅保留历史查看。/);
});

test('board reply submits the same action as the today-task entry', () => {
  const submit = section(app, "form.id === 'managerAssistanceReplyForm'", "form.id === 'activityForm'");
  assert.match(submit, /submitTodayTaskAction\(form, \{/);
  assert.match(submit, /actionType: 'complete_manager_assistance'/);
  assert.match(submit, /customerId: payload\.customerId/);
  assert.match(submit, /closeModal\(\)/);
});

test('manager task modal uses two-column layout with local history scroll', () => {
  assert.match(css, /\.manager-task-layout\{[^}]*grid-template-columns:minmax\(0,1\.15fr\) minmax\(0,1fr\)/);
  assert.match(css, /\.manager-task-modal\{[^}]*overflow:hidden/);
  assert.match(css, /\.manager-task-main \.manager-task-resolve-form \.form-actions\{[^}]*position:sticky/);
  assert.match(css, /\.manager-assistance-history \.manager-history-list\{[^}]*max-height:320px/);
  assert.match(css, /@media\(max-width:1099px\)[\s\S]*manager-task-layout\{grid-template-columns:1fr/);
});
