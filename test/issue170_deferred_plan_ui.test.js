'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');

function block(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing ${end}`);
  return source.slice(startAt, endAt);
}

function occurrences(source, expression) {
  return [...source.matchAll(expression)].length;
}

function functionBlock(source, name) {
  const marker = `function ${name}(`;
  const startAt = source.indexOf(marker);
  assert.notEqual(startAt, -1, `missing ${marker}`);
  const next = /\n  (?:async )?function [A-Za-z0-9_$]+\(/g;
  next.lastIndex = startAt + marker.length;
  const match = next.exec(source);
  return source.slice(startAt, match?.index ?? source.length);
}

function submitListener() {
  return block(app, "document.addEventListener('submit'", "document.addEventListener('click'");
}

function formSubmitBranch(formId, nextFormId) {
  const listener = submitListener();
  return block(listener, `form.id === '${formId}'`, `form.id === '${nextFormId}'`);
}

test('manager workspaces and settings expose stable permission-governed mount points', () => {
  for (const view of ['managerTasks', 'managerMetrics']) {
    assert.match(html, new RegExp(`data-view="${view}"[^>]*data-permission="resolve_manager_tasks"`));
    assert.match(html, new RegExp(`id="${view}View"`));
  }
  for (const id of [
    'managerTaskSummary', 'managerTaskFilters', 'managerTaskResultCount', 'managerTaskList',
    'managerTaskPagination', 'managerTaskRefresh',
    'managerTaskExport', 'managerRiskFilters', 'managerRiskResultCount', 'managerRiskList',
    'managerMetricRange', 'managerMetricSummary', 'managerMetricFilters',
    'managerMetricResultCount', 'managerMetricList',
  ]) assert.match(html, new RegExp(`id="${id}"`), id);

  const settings = block(html, 'id="managerTaskSettingsPanel"', '</form>');
  assert.match(settings, /data-permission="manage_manager_task_settings"/);
  for (const id of [
    'managerTaskSettingsForm', 'managerTaskSettingsVersion', 'managerTaskSettingsUpdatedAt',
    'managerTaskSettingsRecipientList', 'managerTaskSettingsStatus', 'managerTaskSettingsSave',
  ]) assert.match(settings, new RegExp(`id="${id}"`), id);
});

test('missing-plan UI has two truthful paths backed by their real APIs', () => {
  const modal = functionBlock(app, 'openNextPlanTaskModal');
  for (const contract of [
    'id="planModeTabs"', 'data-plan-mode="explicit"', 'data-plan-mode="deferred"',
    'id="explicitPlanFields"', 'id="deferredPlanFields"',
    'name="nextAction"', 'name="nextActionAt"', 'name="reviewAt"', 'name="reason"',
  ]) assert.match(modal, new RegExp(contract), contract);
  assert.doesNotMatch(modal, /name="reviewAt"[^>]*required/);
  assert.match(modal, /name="reason"/);
  const mode = functionBlock(app, 'setNextPlanMode');
  assert.match(mode, /reviewAt\.required\s*=\s*mode\s*===\s*['"]deferred['"]/);
  assert.match(mode, /nextActionAt\.required\s*=\s*mode\s*===\s*['"]explicit['"]/);

  const submit = formSubmitBranch('todayTaskPlanForm', 'todayTaskManagerForm');
  assert.match(submit, /form\.dataset\.planMode/);
  assert.match(submit, /\/accounts\/\$\{encodeURIComponent\([^)]*customerId[^)]*\)\}\/deferred-plan/);
  assert.match(submit, /reviewAt:\s*apiTime\(payload\.reviewAt\)/);
  assert.match(submit, /reason:\s*String\(payload\.reason/);
  assert.match(submit, /\/api\/sales-crm\/today-tasks\/actions/);
  assert.match(submit, /actionType:\s*['"]add_next_plan['"]/);
  assert.match(submit, /nextAction:\s*String\(payload\.nextAction/);
  assert.match(submit, /nextActionAt:\s*apiTime\(payload\.nextActionAt\)/);
});

test('all seven future-time entry points use one min and validation contract', () => {
  const helpers = [
    functionBlock(app, 'setFutureDateTimeConstraint'),
    functionBlock(app, 'validateFutureDateTime'),
  ].join('\n');
  assert.match(helpers, /function setFutureDateTimeConstraint\(input,\s*now/);
  assert.match(helpers, /input\.min\s*=/);
  assert.match(helpers, /function validateFutureDateTime\(input/);
  assert.match(helpers, /setCustomValidity/);
  assert.match(helpers, /valueAsDate|new Date|Date\.parse/);

  // Today-task plan, activity, customer creation, quote, order and stage editing.
  const expectedFields = [
    ['todayTaskPlanForm', 'openNextPlanTaskModal', 'id="todayTaskPlanForm"'],
    ['activityForm', 'openActivityModal', 'id="activityForm"'],
    ['customerForm', 'openNewCustomerModal', 'id="customerForm"'],
    ['quoteForm', 'openQuoteModal', 'id="quoteForm"'],
    ['orderForm', 'openOrderModal', 'id="orderForm"'],
    ['customerProfileEditForm', 'openCustomerProfileEditModal', 'id="customerProfileEditForm"'],
  ];
  for (const [field, functionName, marker] of expectedFields) {
    const constructor = functionBlock(app, functionName);
    assert.match(constructor, new RegExp(marker), field);
    assert.match(constructor, /data-future-datetime/, `${field} future-time marker`);
    assert.match(constructor, /setFutureDateTimeConstraint\(|constrainFutureDateTimes\(/,
      `${field} min constraint`);
  }
  const aiSuggestion = functionBlock(app, 'renderNextActionSuggestion');
  assert.match(aiSuggestion, /id="nextActionSuggestionAt"[^>]*data-future-datetime/);
  assert.match(aiSuggestion, /setFutureDateTimeConstraint\([\s\S]*validateFutureDateTime\(/);
  assert.match(functionBlock(app, 'renderCustomerAI'),
    /setFutureDateTimeConstraint\(|constrainFutureDateTimes\(/);
  assert.match(functionBlock(app, 'constrainFutureDateTimes'),
    /querySelectorAll[\s\S]*data-future-datetime[\s\S]*setFutureDateTimeConstraint\(input\)/);
  const submit = submitListener();
  assert.match(submit, /querySelectorAll\('\[data-future-datetime\]'\)/);
  assert.match(submit, /find\(input => !validateFutureDateTime\(input\)\)/);
  assert.match(helpers, /下一步时间必须晚于当前时间/);
});

test('manager task detail presents evidence and submits only real domain actions', () => {
  const detail = functionBlock(app, 'openManagerTaskDetail');
  for (const field of [
    'managerTaskResolveForm', 'managerTaskAction', 'managerTaskActionFields',
    'managerResolveStatus', 'managerRiskDetail',
  ]) assert.match(detail, new RegExp(field), field);
  for (const value of [
    'task.evidence', 'task.dueAt', 'task.completionCondition',
    'plan_formed', 'terminal_stage', 'reassigned', 'manager_advice', 'escalate_owner',
  ]) assert.match(detail, new RegExp(value.replace('.', '\\.')), value);
  assert.match(detail, /difficulty/);
  assert.match(detail, /nextAction/);
  assert.match(detail, /nextActionAt/);
  assert.match(detail, /ownerId/);
  assert.match(detail, /can\('edit_customer'\)[\s\S]*?plan_formed[\s\S]*?terminal_stage/);
  assert.match(detail, /can\('manage_intake'\)[\s\S]*?reassigned/);
  assert.match(detail, /can\('edit_customer'\) && can\('record_activity'\)[\s\S]*?manager_advice/);
  assert.match(detail, /\['escalate_owner', '升级老板处理'\]/);
  assert.match(detail, /setManagerTaskAction\(managerTaskActions\[0\]\[0\]\)/);

  const submit = block(app, "document.addEventListener('submit'", "document.addEventListener('click'");
  assert.match(submit, /\/api\/sales-crm\/manager-tasks\/\$\{encodeURIComponent\([^)]*\)\}\/resolve/);
  assert.match(submit, /idempotencyKey/);
  assert.match(submit, /type:\s*payload\.(?:action|type)/);
  assert.match(submit, /escalate_owner[\s\S]*difficulty/);
  assert.doesNotMatch(submit, /actionType:\s*['"](?:dismiss|ignore|close_manager_task)['"]/);
});

test('admin settings round-trip N D G M K R, recipients, version and audit time', () => {
  const render = functionBlock(app, 'renderManagerTaskSettings');
  for (const property of [
    'consecutiveDeferred', 'firstContactSilence', 'plannedActionOverdue',
    'salesAnomaly', 'minActiveCustomers', 'minAnomalousCustomers', 'ratioPercent',
    'recipientIds', 'version', 'updatedAt',
  ]) assert.match(render, new RegExp(property), property);
  assert.match(render, /user\.role\s*!==\s*['"]admin['"]|user\.role\s*===\s*['"]admin['"]/);
  assert.match(render, /can\(['"]manage_manager_task_settings['"]\)/);

  const loadAndSave = [
    functionBlock(app, 'loadManagerTaskSettings'),
    functionBlock(app, 'saveManagerTaskSettings'),
  ].join('\n');
  assert.match(loadAndSave, /GET|\/api\/sales-crm\/manager-task-settings/);
  assert.match(loadAndSave, /method:\s*['"]PATCH['"]/);
  assert.match(loadAndSave, /expectedVersion/);
  assert.match(loadAndSave, /recipientIds/);
  assert.match(loadAndSave, /MANAGER_SETTINGS_VERSION_CONFLICT|版本/);
  assert.match(loadAndSave, /updatedAt/);
});

test('30 and 90 day metrics support authorized filtering and customer history drilldown', () => {
  assert.match(html, /data-manager-range="30"/);
  assert.match(html, /data-manager-range="90"/);
  const render = functionBlock(app, 'renderManagerMetrics');
  for (const property of [
    'sampleSize', 'deferredRecords', 'deferredCustomers', 'plannedAfterDeferredCustomers',
    'onTimeActionCustomers', 'firstTouchSilentCustomers',
    'unimprovedAfterInterventionCustomers', 'needsManagerReview',
  ]) assert.match(render, new RegExp(property), property);

  const detail = functionBlock(app, 'openManagerTaskDetail');
  for (const property of [
    'currentConsecutiveDeferredCount', 'cumulativeDeferredCount', 'unplannedDurationDays',
    'thresholdAt', 'history', 'actorId', 'ownerIdSnapshot', 'reviewAt', 'source',
  ]) assert.match(detail, new RegExp(property), property);

  for (const page of ['manager_tasks', 'manager_risks', 'manager_metrics']) {
    assert.match(app, new RegExp(`['"]${page}['"]`), page);
    assert.match(app, new RegExp(`loadAuthorizedBusinessPage\\(['"]${page}['"]`), `${page} list`);
    assert.match(app, new RegExp(`${page}:\\s*\\{[\\s\\S]{0,240}(?:root|endpoint):`), `${page} config`);
    assert.match(app, new RegExp(`initializeAuthorizedBusinessFilters\\(['"]${page}['"]`), `${page} schema`);
  }
  assert.match(app, /metric_window/);
});

test('AI-off mode hides AI-only material while manual plan workflow remains available', () => {
  const visibility = functionBlock(app, 'applyBusinessAIVisibility');
  assert.match(visibility, /customerAIEnabled\(\)/);
  assert.match(visibility, /\[data-ai-business\]/);

  const plan = functionBlock(app, 'openNextPlanTaskModal');
  assert.doesNotMatch(plan, /customerAIEnabled|AI 推荐|AI 建议|data-ai-business|suggested_owner|aiSuggestion/);
  assert.match(plan, /data-plan-mode="explicit"/);
  assert.match(plan, /data-plan-mode="deferred"/);

  const tasks = functionBlock(app, 'renderManagerTasks');
  assert.doesNotMatch(tasks, /candidate|ranked|assignmentReason|decision_reason|suggested_owner/);

  const insights = functionBlock(app, 'renderInsightsHub');
  assert.match(insights, /const showAI = customerAIEnabled\(\)/);
  assert.match(insights, /item\.evaluationText \|\| \(showAI \? item\.aiSummary : ''\)/);
  assert.match(insights, /showAI \? `<div class="ai-tag-row">/);
});

test('sales rendering cannot expose manager or assignment-decision fields', () => {
  const bootstrap = functionBlock(app, 'applyUser');
  assert.match(bootstrap, /\[data-permission\]/);
  assert.match(bootstrap, /!can\(el\.dataset\.permission\)/);
  assert.match(app, /managerTasks:\s*['"]resolve_manager_tasks['"]/);
  assert.match(app, /managerMetrics:\s*['"]resolve_manager_tasks['"]/);
  assert.match(html, /id="managerTaskSettingsPanel"[^>]*data-permission="manage_manager_task_settings"/);

  const managerUi = [
    functionBlock(app, 'renderManagerTasks'),
    functionBlock(app, 'renderManagerTaskSettings'),
  ].join('\n');
  assert.match(managerUi, /can\(['"]resolve_manager_tasks['"]\)/);
  assert.doesNotMatch(managerUi, /rankedCandidates|candidateSnapshot|decisionReason|assignmentReason/);

  const salesVisiblePlan = functionBlock(app, 'openNextPlanTaskModal');
  assert.doesNotMatch(salesVisiblePlan, /recipientIds|thresholdSnapshot|settingsVersion|candidate/);
});

test('400, 403 and 500 failures preserve mode, text and time instead of clearing the modal', () => {
  const planSubmit = formSubmitBranch('todayTaskPlanForm', 'todayTaskManagerForm');
  assert.match(planSubmit, /preserveOnForbidden:\s*true/);
  assert.match(planSubmit, /form\.dataset\.planMode/);
  assert.doesNotMatch(planSubmit, /form\.reset\(\)|closeModal\(\)|openNextPlanTaskModal\(/);

  const listener = submitListener();
  const catchAt = listener.lastIndexOf('} catch (error)');
  assert.notEqual(catchAt, -1);
  const failure = listener.slice(catchAt);
  assert.match(failure, /\[data-today-task-error\]/);
  assert.match(failure, /status\.textContent\s*=\s*error\.message/);
  assert.doesNotMatch(failure, /form\.reset\(\)|closeModal\(\)|openNextPlanTaskModal\(/);
});

test('deferred-plan, manager task and metric controls stay usable at 320 to 430px', () => {
  for (const selector of [
    '.plan-mode-tabs', '.deferred-plan-fields', '.manager-task-list', '.manager-task-card',
    '.manager-task-resolve-form', '.manager-metric-range', '.manager-metric-card',
    '.manager-risk-detail', '.manager-task-settings-grid',
  ]) assert.match(css, new RegExp(selector.replace('.', '\\.')), selector);
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /\.manager-task-card\{[^}]*min-width:0/);
  assert.match(css, /\.manager-task-resolve-form[^{]*\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.plan-mode-tabs[^}]*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.manager-task-actions[^}]*\.button[^}]*min-height:44px/);
  assert.match(css, /overflow-wrap:anywhere/);

  for (const width of [320, 375, 390, 430]) {
    assert.ok(width <= 430, `${width}px must use the narrow-layout contract`);
  }
});
