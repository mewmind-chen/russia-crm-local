'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const access = fs.readFileSync(path.join(ROOT, 'lib', 'access_control.js'), 'utf8');
const metrics = fs.readFileSync(path.join(ROOT, 'lib', 'manager_metrics.js'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'lib', 'sales_crm.js'), 'utf8')
  + fs.readFileSync(path.join(ROOT, 'lib', 'sales_crm_manager_routes.js'), 'utf8');

function block(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('dashboard metrics and cumulative funnel stages are semantic drill-down buttons', () => {
  const dashboard = block(app, 'function renderDashboard()', 'function percent(');
  assert.match(dashboard, /data-dashboard-drilldown=/);
  assert.match(dashboard, /<button[^>]+class="metric/);
  assert.match(dashboard, /<button[^>]+class="funnel-row[\s\S]*?data-stage-jump=/);

  const click = block(app, "document.addEventListener('click'", "document.addEventListener('input'");
  assert.match(click, /openDashboardDrilldown/);
  assert.match(click, /openCustomerStageDrilldown/);
  const stage = block(app, 'function openCustomerStageDrilldown', 'function renderDashboard');
  assert.match(stage, /state\.stageReached = stageKey/);
  assert.doesNotMatch(stage, /setDraft\('stage'/);
});

test('today task summary numbers drill down in-place and the route stays isolated', () => {
  const alerts = block(app, 'function renderAlerts()', 'const managerTaskReasonLabels');
  assert.match(alerts, /data-alert-drilldown=/);
  assert.match(alerts, /state\.alertSeverity/);
  assert.match(app, /data-alert-drilldown[\s\S]*renderAlerts\(\)/);
  assert.match(html, /data-view="alerts"[\s\S]*>今日待办</);
  assert.equal((html.match(/id="alertsView"/g) || []).length, 1);
});

test('manager review exposes per-metric drill-downs without internal reason codes', () => {
  const manager = block(app, 'function renderManagerMetrics()', 'function notificationAccount');
  assert.match(manager, /data-manager-metric-kind=/);
  assert.match(app, /data-manager-drilldown-page=/);
  assert.match(app, /state\.managerMetricDrilldown\.kind/);
  assert.match(manager, /managerMetricAvailabilityCopy/);
  assert.doesNotMatch(manager, /unavailable\.reasons\.join/);
  for (const code of [
    'active_sample_below_minimum',
    'anomaly_customers_below_minimum',
    'anomaly_ratio_below_threshold',
  ]) assert.doesNotMatch(manager, new RegExp(code));

  const managerMarkup = block(html, '<section id="managerMetricsView"', '<section id="insightsView"');
  assert.doesNotMatch(managerMarkup, /TEAM METRICS|CUSTOMER DRILLDOWN|计划跟进与协助统计 REVIEW|活跃客户样本/);
  assert.match(managerMarkup, /跟进计划与主管协助/);
  assert.match(managerMarkup, /需要处理的明细/);
});

test('manager metric detail endpoint is permission-gated and returns business rows', () => {
  assert.match(metrics, /function buildManagerMetricDrilldown/);
  assert.match(metrics, /accountScope\(user/);
  assert.match(metrics, /lastActivityAt/);
  assert.match(metrics, /nextAction/);
  assert.match(metrics, /reason/);
  assert.match(routes, /GET \/manager-metrics\/drilldown|manager-metrics\/drilldown/);
  assert.match(access, /GET \/manager-metrics\/drilldown/);
});

test('issue 325 production copy boundary remains intact', () => {
  const intake = block(app, 'function renderIntake()', 'function openCustomerProfile');
  assert.match(intake, /const sourceMeta = `<span>更新/);
  assert.doesNotMatch(intake, /暂无来源证据|批次 \$\{esc\(item\.batch_id/);
  assert.match(html, />Recon 情报<\/span>/);
});
