'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('progress modal exposes four truthful modes and the plan-only fields', () => {
  const modal = section(app, 'function openActivityModal', 'function openNewCustomerModal');
  for (const copy of [
    '记录新进展',
    '只更新下一步计划',
    '暂无计划',
    '请求主管协助',
    'data-activity-mode="plan"',
    'data-activity-mode="noPlan"',
    'data-activity-mode="manager"',
    '本次说明（选填）',
    '不会生成“发送邮件”等虚假进展',
  ]) assert.match(modal, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(app, /保存计划/);
});

test('NO_NEXT and manager receipt tasks open the modal in plan mode', () => {
  const routing = section(app, 'function openTodayTaskAction', 'async function loadActivityReactions');
  assert.match(routing, /openActivityModal\(item\.customerId, 'plan'/);
  const aliases = section(app, 'function todayTaskActionKind', 'function todayTaskDueText');
  assert.match(aliases, /confirm_manager_assistance: 'manager-receipt'/);
});

test('plan mode routes to plan-only or the receipt today task action and never to /activities', () => {
  const submit = section(app, "form.id === 'activityForm'", "form.id === 'customerForm'");
  assert.match(submit, /\/api\/sales-crm\/activities\/plan-only/);
  assert.match(submit, /confirm_manager_assistance/);
  assert.match(submit, /未生成客户进展事件/);
});

test('timeline titles route request, reply and no-plan states through Chinese labels', () => {
  const titleFn = section(app, 'function timelineEventTitle', 'function timelineEventSummary');
  assert.match(titleFn, /暂无计划/);
  assert.match(titleFn, /主管回复/);
  assert.match(titleFn, /请求主管协助/);
});
