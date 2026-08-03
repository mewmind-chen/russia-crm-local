'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const businessFilters = fs.readFileSync(path.join(ROOT, 'lib', 'business_page_filters.js'), 'utf8');
const salesCrm = fs.readFileSync(path.join(ROOT, 'lib', 'sales_crm.js'), 'utf8');

function block(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing ${end}`);
  return source.slice(startAt, endAt);
}

test('every today-task reason routes to a real targeted handler instead of a generic detail jump', () => {
  const router = block(app, 'function todayTaskActionKind(item)', 'function todayTaskActionMarkup(item)');
  const expectedCodes = [
    'UNCLAIMED_LEAD',
    'UNCLAIMED',
    'NO_NEXT',
    'MANAGER_NEEDED',
    'RFQ_UNQUOTED',
    'INTAKE_IDLE',
    'OVERDUE',
    'REPLY_IDLE',
    'POST_MANAGER_IDLE',
    'MEETING_NO_RFQ',
    'QUOTE_IDLE',
    'STALE',
  ];
  for (const code of expectedCodes) assert.match(router, new RegExp(`['"]${code}['"]`), code);
  assert.match(router, /\['UNCLAIMED', 'UNCLAIMED_LEAD'\][\s\S]*return 'overdue-lead'/);
  assert.match(router, /code === 'NO_NEXT'[\s\S]*return 'next-plan'/);
  assert.match(router, /code === 'MANAGER_NEEDED'[\s\S]*return 'manager-assistance'/);
  assert.match(router, /code === 'RFQ_UNQUOTED'[\s\S]*return 'quote'/);
  assert.match(router, /'INTAKE_IDLE'[\s\S]*'STALE'[\s\S]*return 'activity'/);

  const markup = block(app, 'function todayTaskActionMarkup(item)', 'function renderAlerts()');
  assert.match(markup, /data-today-task-action=/);
  assert.match(markup, /data-today-task-id=/);
  assert.match(markup, /处理超时线索/);
  assert.match(markup, /立即补计划/);
  assert.match(markup, /处理协助请求/);
  assert.doesNotMatch(markup, /data-open-customer|data-intake-profile/);

  const opener = block(app, 'async function openTodayTaskAction(item)', 'async function loadActivityReactions');
  assert.match(opener, /openOverdueLeadTaskModal\(item\)/);
  assert.match(opener, /openNextPlanTaskModal\(item\)/);
  assert.match(opener, /openManagerAssistanceTaskModal\(item\)/);
  assert.match(opener, /openQuoteModal\(item\.customerId,\s*\{\s*fromTodayTask:\s*true\s*\}\)/);
  assert.match(opener, /openActivityModal\.todayTaskContext/);
  assert.match(opener, /openActivityModal\(item\.customerId\)/);

  const clickHandler = block(app, "document.addEventListener('click'", "document.addEventListener('input'");
  assert.match(clickHandler, /closest\('\[data-today-task-action\]'\)/);
  assert.match(clickHandler, /openTodayTaskAction\(todayTaskById\(todayTaskAction\.dataset\.todayTaskId\)\)/);
});

test('the three compact action modals contain only the context and fields required to finish the task', () => {
  const overdue = block(app, 'function openOverdueLeadTaskModal(item)', 'function openNextPlanTaskModal(item)');
  for (const copy of [
    '处理超时线索',
    '当前负责人',
    '分配时间',
    '超时时长',
    '搜索启用中的销售人员',
    '新负责人',
    '确认退回',
    '确认重新分配',
  ]) assert.match(overdue, new RegExp(copy));
  assert.match(overdue, /id="todayTaskOverdueForm"/);
  assert.match(overdue, /name="intakeItemId"/);
  assert.match(overdue, /name="idempotencyKey"/);
  assert.match(overdue, /data-resolution="return_to_pool"/);
  assert.match(overdue, /data-resolution="reassign"/);
  assert.match(overdue, /renderTodayTaskCandidateOptions\(\)/);

  const plan = block(app, 'function openNextPlanTaskModal(item)', 'function managerRequestValue');
  for (const copy of [
    '补充下一步计划',
    '只补计划，不虚构客户新进展',
    '客户',
    '当前负责人',
    '当前阶段',
    '下一步计划',
    '计划执行时间',
    '保存并完成待办',
  ]) assert.match(plan, new RegExp(copy));
  assert.match(plan, /id="todayTaskPlanForm"/);
  assert.match(plan, /name="customerId"/);
  assert.match(plan, /name="nextAction"[^>]*required/);
  assert.match(plan, /name="nextActionAt"[^>]*type="datetime-local"[^>]*required/);
  assert.match(plan, /name="idempotencyKey"/);

  const manager = block(app, 'function openManagerAssistanceTaskModal(item)', 'async function openTodayTaskAction');
  for (const copy of [
    '处理协助请求',
    '申请人',
    '申请时间',
    '申请协助时的进展或原因',
    '处理意见或协助结果',
    '完成协助',
  ]) assert.match(manager, new RegExp(copy));
  assert.match(manager, /id="todayTaskManagerForm"/);
  assert.match(manager, /name="customerId"/);
  assert.match(manager, /name="result"[^>]*required/);
  assert.match(manager, /name="idempotencyKey"/);
  assert.match(manager, /item\.managerRequest/);

  for (const formId of ['todayTaskOverdueForm', 'todayTaskPlanForm', 'todayTaskManagerForm']) {
    assert.match(app, new RegExp(`id="${formId}"[\\s\\S]{0,100}data-today-task-form`));
  }
});

test('task submission keeps a stable key, blocks double clicks, preserves failures, and never optimistically deletes a row', () => {
  const submit = block(app, 'async function submitTodayTaskAction(form, body, message)', 'function formPayload(form)');
  assert.match(submit, /form\.dataset\.submitting === 'true'/);
  assert.match(submit, /form\.dataset\.submitting = 'true'/);
  assert.match(submit, /buttons\.forEach\(button => \{ button\.disabled = true; \}\)/);
  assert.match(submit, /\/api\/sales-crm\/today-tasks\/actions/);
  assert.match(submit, /preserveOnForbidden:\s*true/);
  assert.match(submit, /catch \(error\)[\s\S]*errorEl\.textContent = error\.message[\s\S]*throw error/);
  assert.match(submit, /finally[\s\S]*form\.dataset\.submitting = 'false'/);
  assert.doesNotMatch(submit, /alerts\.(?:splice|filter)|meta\.rows\.(?:splice|filter)|closeModal\(\)/);

  const forms = block(app, "document.addEventListener('submit'", "document.addEventListener('click'");
  for (const actionType of [
    'resolve_overdue_lead',
    'add_next_plan',
    'complete_manager_assistance',
  ]) assert.match(forms, new RegExp(`actionType:\\s*'${actionType}'`));
  assert.match(forms, /idempotencyKey:\s*payload\.idempotencyKey/g);
  assert.doesNotMatch(forms, /idempotencyKey:\s*proposalRequestId\(\)/);
  assert.match(forms, /if \(resolution === 'reassign' && !payload\.ownerId\)/);
  assert.match(forms, /if \(!String\(payload\.nextAction \|\| ''\)\.trim\(\)\)/);
  assert.match(forms, /if \(!String\(payload\.result \|\| ''\)\.trim\(\)\)/);
});

test('successful actions refresh bootstrap and the authorized alert page while retaining the active severity tab', () => {
  const refresh = block(app, 'async function refreshTodayTasksAfterAction(message)', 'async function submitTodayTaskAction');
  assert.match(refresh, /await refresh\(\)/);
  assert.match(refresh, /await loadAuthorizedBusinessPage\('alerts',\s*\{\s*reset:\s*true\s*\}\)/);
  assert.match(refresh, /button\.dataset\.severity === state\.alertSeverity/);
  assert.match(refresh, /toast\(message\)/);

  const loader = block(app, 'async function loadAuthorizedBusinessPage(pageKey', 'async function initializeAuthorizedBusinessFilters');
  assert.match(loader, /summary:\s*null/);
  assert.match(loader, /summary:\s*result\.summary \|\| result\.meta\?\.summary/);

  const render = block(app, 'function renderAlerts()', 'function notificationAccount');
  assert.match(render, /const summary = meta\.summary \|\| \{\}/);
  assert.match(render, /summary\.objects \?\? summary\.objectCount \?\? summary\.total \?\? meta\.total/);
  assert.match(render, /summary\.reasons \?\? summary\.reasonCount \?\? summary\.totalReasons/);
  assert.match(render, /summary\.immediate \?\? summary\.immediateCount/);
  assert.match(render, /summary\.today \?\? summary\.todayCount/);
  assert.match(render, /summary\.attention \?\? summary\.attentionCount/);
  for (const label of ['待处理对象', '立即处理', '今天完成', '需要关注']) {
    assert.match(render, new RegExp(label));
  }

  assert.match(businessFilters, /const summary = \{/);
  for (const field of ['objects', 'reasons', 'total', 'immediate', 'today', 'attention']) {
    assert.match(businessFilters, new RegExp(`\\b${field}:`));
  }
  assert.match(businessFilters, /return \{[\s\S]*summary,[\s\S]*hasMore:/);
});

test('capability tokens and backend action contracts govern visibility without weakening 403 handling', () => {
  const permissions = block(app, 'function todayTaskActionAllowed(item, accepted, fallback)', 'function todayTaskActionKind(item)');
  assert.match(permissions, /item\?\.allowedActions/);
  assert.match(permissions, /accepted\.some/);

  const markup = block(app, 'function todayTaskActionMarkup(item)', 'function renderAlerts()');
  assert.match(markup, /\['admin', 'manager'\]\.includes\(role\) && can\('manage_intake'\)/);
  assert.match(markup, /can\('record_activity'\)/);
  assert.match(markup, /\['admin', 'manager'\]\.includes\(role\) && can\('view_team'\)/);
  assert.doesNotMatch(markup, /impersonation/);
  assert.match(markup, /当前账号无权处理/);

  assert.match(businessFilters, /actionKind:\s*'resolve_overdue_lead'/);
  assert.match(businessFilters, /allowedActions:\s*\['reassign', 'return_to_pool'\]/);
  assert.match(salesCrm, /actionKind:\s*'add_next_plan'/);
  assert.match(salesCrm, /actionKind:\s*'complete_manager_assistance'/);
});

test('today-task modals and actions have narrow-screen layout and cache-busted assets', () => {
  for (const selector of [
    '.today-task-modal',
    '.today-task-form',
    '.today-task-facts',
    '.today-task-owner-picker',
    '.today-task-request',
    '.today-task-form-error',
    '.today-task-actions',
    '.today-task-context',
  ]) assert.match(css, new RegExp(selector.replace('.', '\\.')));
  assert.match(css, /@media\(max-width:600px\)\{/);
  assert.match(css, /\.today-task-modal\{[^}]*width:calc\(100vw - 20px\)/);
  assert.match(css, /\.today-task-facts,\.today-task-owner-picker\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.today-task-actions \.button,\.today-task-form \.form-actions \.button\{min-height:44px\}/);
  assert.match(html, /app\.css\?v=[^"]+/);
  assert.match(html, /app\.js\?v=[^"]+/);
});
