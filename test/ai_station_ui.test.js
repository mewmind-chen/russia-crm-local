'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');

test('customer profile contains the real customer fit station surface', () => {
  assert.match(html, /id="customerAiStation" class="customer-ai-station hidden"/);
  assert.match(html, /id="customerAiStationBody"/);
  assert.match(html, /id="customerAiStationActions"/);
  assert.match(html, /app\.css\?v=[^"]+/);
  assert.match(html, /app\.js\?v=[^"]+/);
});

test('sales pack UI exposes evidence-backed drafts without any send action', () => {
  assert.match(app, /stations\/sales_pack\/run/);
  for (const field of ['summary', 'entryPoints', 'risks', 'draft', 'salesPack']) {
    assert.match(app, new RegExp(field));
  }
  assert.match(app, /仅供人工审核，不会自动发送/);
  assert.doesNotMatch(app, /data-send-sales-pack|sendSalesPack|autoSendSalesPack/);
});

test('administrator AI feature switches expose hard and runtime state', () => {
  assert.match(html, /id="aiFeatureRows"/);
  assert.match(app, /\/api\/sales-crm\/ai\/features/);
  assert.match(app, /hardEnabled/);
  assert.match(app, /runtimeEnabled/);
  assert.match(app, /effectiveEnabled/);
});

test('AI governance UI exposes outcome labels, shadow approval and rollback controls', () => {
  for (const id of [
    'aiGovernancePanel', 'aiGovernanceMetrics', 'aiGovernanceStrategies',
    'aiStrategyCreate', 'aiGovernanceRefresh',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  for (const label of ['成交', '回复', '退回', '停滞', '人工驳回']) assert.match(app, new RegExp(label));
  assert.match(app, /\/api\/sales-crm\/ai\/governance/);
  assert.match(app, /data-strategy-evaluate/);
  assert.match(app, /request-publish/);
  assert.match(app, /data-strategy-action="approve"/);
  assert.match(app, /data-strategy-action="rollback"/);
  assert.match(css, /\.ai-governance-grid/);
});

test('customer fit UI reads, runs and retries only through Sales CRM APIs', () => {
  assert.match(app, /\/api\/sales-crm\/ai\/customers\/\$\{encodeURIComponent\(customerId\)\}\/results/);
  assert.match(app, /\/api\/sales-crm\/ai\/customers\/\$\{encodeURIComponent\(customerId\)\}\/stations\/customer_fit\/run/);
  assert.match(app, /\/api\/sales-crm\/ai\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/retry/);
  assert.doesNotMatch(app, /fetch\(['"`]https?:\/\//);
});

test('customer fit UI exposes result metadata, evidence and every job state', () => {
  for (const field of ['fitScore', 'grade', 'confidence', 'reasonCodes', 'promptVersion', 'schemaVersion', 'generatedAt', 'evidence']) {
    assert.match(app, new RegExp(field), `missing field: ${field}`);
  }
  for (const state of [
    'queued', 'running', 'retry_wait', 'needs_review', 'succeeded', 'dead_letter',
    'blocked', 'cancel_requested', 'cancelled', 'stale',
  ]) {
    assert.match(app, new RegExp(state), `missing state: ${state}`);
  }
});

test('customer fit actions respect AI permission and identity inspection', () => {
  assert.match(app, /state\.data\?\.features\?\.aiStations/);
  assert.match(app, /station\?\.classList\.toggle\('hidden', !customerAIEnabled\(\)\)/);
  assert.match(app, /const canRun = can\('use_ai_assistant'\) && !state\.data\?\.impersonation/);
  assert.match(app, /data-run-customer-fit/);
  assert.match(app, /data-retry-ai-job/);
});

test('customer fit surface has bounded responsive layout and preserves the profile frame', () => {
  assert.match(css, /\.customer-profile-view\.active\{[^}]*grid-template-rows:auto auto minmax\(0,1fr\)/);
  assert.match(css, /\.customer-ai-station\{[^}]*max-height:270px[^}]*overflow:auto/);
  assert.match(css, /@media\(max-width:780px\)\{\.customer-ai-station/);
  assert.match(html, /id="customerProfileFrame"/);
});

test('AI task center has permission-scoped filters, pagination, details and operations', () => {
  assert.match(html, /data-view="aiTasks" data-permission="view_customers" data-ai-business/);
  assert.match(html, /id="aiTasksView"/);
  for (const id of [
    'aiTaskStateFilter', 'aiTaskTypeFilter', 'aiTaskCustomerFilter', 'aiTaskOwnerFilter',
    'aiTaskModelFilter', 'aiTaskFromFilter', 'aiTaskToFilter', 'aiTaskPrev', 'aiTaskNext',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /\/api\/sales-crm\/ai\/tasks\?\$\{params\}/);
  assert.match(app, /\/api\/sales-crm\/ai\/tasks\/\$\{encodeURIComponent\(taskId\)\}/);
  assert.match(app, /data-ai-task-action="retry"/);
  assert.match(app, /data-ai-task-action="cancel"/);
  assert.match(app, /data-ai-task-action="approved"/);
  assert.match(app, /can\('cancel_ai_tasks'\)/);
  assert.match(app, /can\('review_ai_tasks'\)/);
  assert.match(html, /id="aiTaskDegraded"/);
  assert.match(app, /保留上次成功加载的历史任务/);
  assert.match(css, /\.ai-task-filters/);
  assert.match(css, /\.ai-task-degraded/);
});

test('AI task detail exposes decision versions and evidence trace without prompt content', () => {
  for (const label of [
    '决策版本与证据', '工作站版本', '模型', 'Prompt 版本', 'Schema 版本',
    '规则版本', '策略版本', '上下文指纹', '证据 ID', '有效状态',
  ]) assert.match(app, new RegExp(label));
  assert.match(app, /task\.decisionTrace/);
  assert.match(css, /\.ai-task-trace-values/);
  assert.doesNotMatch(app, /trace\.promptContent|trace\.systemPolicy|trace\.strategyConfig/);
});

test('notification center exposes unread counts, scoped read actions and customer navigation', () => {
  assert.match(html, /data-view="notifications" data-permission="view_customers"/);
  for (const id of [
    'notificationsView', 'notificationButton', 'navNotificationCount', 'topNotificationCount',
    'notificationSummary', 'notificationTabs', 'notificationList', 'notificationRefresh',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /function renderNotifications\(\)/);
  assert.match(app, /\/api\/sales-crm\/notifications\/\$\{encodeURIComponent\(notificationId\)\}\/read/);
  assert.match(app, /data-notification-customer/);
  assert.match(app, /只能标记|notification\.user_id === state\.data\.user\.id/);
  assert.match(css, /\.notification-item/);
  assert.match(css, /@media\(max-width:780px\)\{\.notification-button/);
});
