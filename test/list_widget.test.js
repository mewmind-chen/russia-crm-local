'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'sales-assets', 'list-widget.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const widget = require(path.join(root, 'sales-assets', 'list-widget.js'));
const fieldCatalog = require(path.join(root, 'lib', 'field_catalog.js'));

const columns = [
  { key: 'company', label: '客户', required: true, className: 'col-company' },
  { key: 'owner', label: '负责人', className: 'col-owner', sortKey: 'owner_name' },
  { key: 'stage', label: '阶段', className: 'col-stage' },
  { key: 'actions', label: '操作', required: true, sortable: false, className: 'col-actions' },
];

test('maintenance runs list uses shared widget with non-AI fields and per-user layout', () => {
  const schema = fieldCatalog.effectiveFieldSchema({ pageKey: 'maintenance_runs', user: { role: 'admin' }, permissions: { manage_data_maintenance: true }, features: {} });
  assert.deepEqual(schema.fields.map(field => field.key), ['created_at', 'operator', 'status', 'target', 'backup']);
  assert.match(html, /id="maintenanceRunsSort"/);
  assert.match(html, /id="maintenanceRunsColumnSettings"/);
  assert.match(app, /maintenanceRunsListLayout/);
  assert.match(app, /tradepulse\.listLayout\.maintenance_runs/);
  assert.match(app, /data-list-page="maintenance_runs"/);
  assert.match(app, /maintenanceRunsColumnSettingsPanel/);
  assert.match(app, /maintenanceRunsListStorageKey\(\)/);
  assert.match(app, /columnMove\.closest\('#maintenanceRunsColumnSettingsPanel'\)/);
  assert.match(app, /data-list-layout-reset/);
  assert.match(app, /maintenanceRunsSort/);
  assert.doesNotMatch(app, /maintenanceRunsColumns[\s\S]{0,1800}ai_/i);
});

test('correction history uses shared widget with manual fields and complete user layout controls', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'correction_history',
    user: { role: 'sales' },
    permissions: { correct_own_activity: true },
    features: { ai_stations: true },
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'source', 'target', 'milestone', 'reason', 'status', 'operator', 'created_at',
  ]);
  assert.equal(schema.fields.some(field => field.key.startsWith('ai_')), false);
  assert.match(html, /id="correctionHistorySort"/);
  assert.match(html, /id="correctionHistoryColumnSettings"[\s\S]*aria-controls="correctionHistoryColumnSettingsPanel"/);
  assert.match(html, /id="activityCorrectionHistoryList"[^>]*data-table/);
  assert.match(app, /correctionHistoryListLayout/);
  assert.match(app, /tradepulse\.listLayout\.correction_history/);
  assert.match(app, /data-list-page="correction_history"/);
  assert.match(app, /openCorrectionHistoryColumnSettings/);
  assert.match(app, /moveCorrectionHistoryListColumn/);
  assert.match(app, /resetCorrectionHistoryListLayout/);
  assert.match(app, /toggleCorrectionHistoryListColumn/);
  assert.match(app, /correctionHistoryColumns\(\)/);
  assert.doesNotMatch(app, /correctionHistoryColumns[\s\S]{0,3000}ai_/i);
});

test('list widget exposes a browser-safe UMD contract', () => {
  const browserGlobal = {};
  vm.runInNewContext(source, browserGlobal);
  assert.equal(typeof browserGlobal.TradePulseListWidget, 'object');
  for (const name of [
    'normalizeColumns', 'defaultPreferences', 'normalizePreferences', 'normalizeSort',
    'resolveColumns', 'loadPreferences', 'savePreferences', 'renderColumnSettingsHtml', 'renderTable',
  ]) assert.equal(typeof browserGlobal.TradePulseListWidget[name], 'function', `${name} must be exported`);
});

test('list preferences preserve required columns and sanitize unknown fields', () => {
  const prefs = widget.normalizePreferences({
    visibleColumns: ['stage', 'unknown'],
    columnOrder: ['stage', 'owner', 'unknown'],
    sort: [{ key: 'owner_name', direction: 'desc' }, { key: 'owner_name', direction: 'asc' }],
  }, columns);
  assert.deepEqual(prefs.visibleColumns, ['stage', 'company', 'actions']);
  assert.deepEqual(prefs.columnOrder, ['stage', 'owner', 'company', 'actions']);
  assert.deepEqual(prefs.sort, [{ key: 'owner', sortKey: 'owner_name', direction: 'desc' }]);
  assert.deepEqual(widget.resolveColumns(columns, prefs).map(column => column.key), ['stage', 'company', 'actions']);
});

test('list preference persistence is user-storage compatible and recovers malformed data', () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
  };
  const saved = widget.savePreferences('tradepulse.listLayout.customers.user-1', {
    visibleColumns: ['owner'], columnOrder: ['owner', 'company'], sortPreset: 'company',
  }, storage, columns);
  assert.equal(saved.sortPreset, 'company');
  assert.equal(widget.loadPreferences('tradepulse.listLayout.customers.user-1', storage, columns).sortPreset, 'company');
  values.set('broken', '{bad json');
  assert.deepEqual(widget.loadPreferences('broken', storage, columns).visibleColumns, ['company', 'owner', 'stage', 'actions']);
});

test('column settings markup exposes visibility, order, reset, and close controls', () => {
  const markup = widget.renderColumnSettingsHtml({ columns, preferences: { visibleColumns: ['company', 'owner'] } });
  assert.match(markup, /data-list-column-toggle="owner" checked/);
  assert.match(markup, /data-list-column-toggle="stage"/);
  assert.match(markup, /data-list-column-move="up"/);
  assert.match(markup, /data-list-layout-reset/);
  assert.match(markup, /data-list-layout-close/);
  assert.match(markup, /data-list-column-toggle="company" checked disabled/);
});

test('descriptor table renderer keeps raw cell actions and row attributes', () => {
  const markup = widget.renderTable({
    columns,
    preferences: { visibleColumns: ['company', 'actions'], columnOrder: ['company', 'actions'] },
    rows: [{ company: '<strong>Acme</strong>', actions: '<button>打开</button>', _attrs: 'data-customer="c1"' }],
  });
  assert.match(markup, /data-customer="c1"/);
  assert.match(markup, /<strong>Acme<\/strong>/);
  assert.match(markup, /<button>打开<\/button>/);
  assert.doesNotMatch(markup, /负责人/);
});

test('descriptor table renderer preserves an optional header row attribute', () => {
  const markup = widget.renderTable({
    columns,
    rows: [{ company: 'Acme', actions: '打开' }],
    headerAttrs: 'class="pipeline-list-head"',
  });
  assert.match(markup, /<tr class="pipeline-list-head">/);
});

test('customer list is wired to the shared widget and user layout controls', () => {
  assert.match(html, /sales-assets\/list-widget\.js[^>]*><\/script>/);
  assert.ok(html.indexOf('list-widget.js') < html.indexOf('sales-assets/app.js'));
  assert.match(html, /id="customerColumnSettings"/);
  assert.match(html, /id="customerColumnSettingsPanel"/);
  assert.match(app, /const listWidget = window\.TradePulseListWidget/);
  assert.match(app, /customerListLayout/);
  assert.match(app, /listWidget\.renderTable\(\{ columns: renderColumns/);
  assert.match(app, /data-list-column-toggle/);
  assert.match(app, /sortPreset/);
});

test('customer list has a server field-schema catalog separate from local layout preferences', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'customers',
    user: { role: 'sales' },
    permissions: { view_customers: true },
    features: {},
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'company', 'country_industry', 'stage', 'owner', 'last_activity', 'next_action', 'priority', 'status',
  ]);
  assert.match(app, /state\.fieldSchemas\?\.customers\?\.fields/);
  assert.match(app, /state\.fieldSchemas = \{\};/);
});

test('dashboard country snapshot uses the shared widget with per-user layout and local sorting', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'dashboard',
    user: { role: 'sales' },
    permissions: { view_dashboard: true },
    features: {},
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'country', 'accounts', 'reply_rate', 'rfq_rate', 'order_rate', 'value_per_account',
  ]);
  assert.match(html, /id="dashboardCountrySort"/);
  assert.match(html, /id="dashboardCountryColumnSettings"/);
  assert.match(html, /id="dashboardCountryColumnSettingsPanel"/);
  assert.match(app, /dashboardCountryListLayout/);
  assert.match(app, /tradepulse\.listLayout\.dashboard_country/);
  assert.match(app, /listWidget\.renderTable\([\s\S]*data-list-page="dashboard_country"/);
  assert.match(app, /event\.target\.id === 'dashboardCountrySort'/);
});

test('markets country and cohort reports use the shared widget with independent user layouts', () => {
  const country = fieldCatalog.effectiveFieldSchema({ pageKey: 'markets_country', user: { role: 'manager' }, permissions: { view_markets: true }, features: {} });
  const cohort = fieldCatalog.effectiveFieldSchema({ pageKey: 'markets_cohort', user: { role: 'manager' }, permissions: { view_markets: true }, features: {} });
  assert.deepEqual(country.fields.map(field => field.key), [
    'country', 'sample', 'contact_rate', 'reply_rate', 'meeting_rate', 'rfq_rate', 'order_rate', 'repeat_rate', 'revenue', 'value_per_account', 'judgement',
  ]);
  assert.deepEqual(cohort.fields.map(field => field.key), [
    'cohort', 'assigned', 'contact_rate', 'reply_rate', 'meeting_rate', 'rfq_rate', 'order_rate', 'revenue',
  ]);
  assert.match(html, /id="marketCountrySort"/);
  assert.match(html, /id="marketCountryColumnSettings"/);
  assert.match(html, /id="marketCohortSort"/);
  assert.match(html, /id="marketCohortColumnSettings"/);
  assert.match(app, /marketsCountryListLayout/);
  assert.match(app, /marketsCohortListLayout/);
  assert.match(app, /tradepulse\.listLayout\.markets_country/);
  assert.match(app, /tradepulse\.listLayout\.markets_cohort/);
  assert.match(app, /data-list-page="markets_country"/);
  assert.match(app, /data-list-page="markets_cohort"/);
});

test('manager tasks list uses shared widget with per-user layout and local sorting', () => {
  assert.match(html, /id="managerTaskSort"/);
  assert.match(html, /id="managerTaskColumnSettings"/);
  assert.match(html, /id="managerTaskColumnSettingsPanel"/);
  assert.match(app, /managerTasksListLayout/);
  assert.match(app, /tradepulse\.listLayout\.manager_tasks/);
  assert.match(app, /data-list-page="manager_tasks"/);
  assert.match(app, /managerTasksColumnDefinitions/);
  assert.match(app, /sortedManagerTaskRows/);
  assert.ok(fieldCatalog.listFieldPages().includes('manager_tasks'));
  assert.deepEqual(fieldCatalog.FIELDS_CATALOG.manager_tasks.map(field => field.key), [
    'company', 'customer_id', 'status', 'owner', 'reason', 'due_at', 'triggered_at',
  ]);
});

test('manager risks list uses shared widget with an independent user layout', () => {
  assert.match(html, /id="managerRiskSort"/);
  assert.match(html, /id="managerRiskColumnSettings"/);
  assert.match(html, /id="managerRiskColumnSettingsPanel"/);
  assert.match(app, /managerRisksListLayout/);
  assert.match(app, /tradepulse\.listLayout\.manager_risks/);
  assert.match(app, /data-list-page="manager_risks"/);
  assert.match(app, /managerRisksColumnDefinitions/);
  assert.match(app, /sortedManagerRiskRows/);
  assert.ok(fieldCatalog.listFieldPages().includes('manager_risks'));
  assert.deepEqual(fieldCatalog.FIELDS_CATALOG.manager_risks.map(field => field.key), [
    'company', 'customer_id', 'status', 'owner', 'reason', 'due_at', 'triggered_at',
  ]);
});

test('manager metrics list uses shared widget while preserving drilldown metric actions', () => {
  assert.match(html, /id="managerMetricSort"/);
  assert.match(html, /id="managerMetricColumnSettings"/);
  assert.match(html, /id="managerMetricColumnSettingsPanel"/);
  assert.match(app, /managerMetricsListLayout/);
  assert.match(app, /tradepulse\.listLayout\.manager_metrics/);
  assert.match(app, /data-list-page="manager_metrics"/);
  assert.match(app, /managerMetricsColumnDefinitions/);
  assert.match(app, /sortedManagerMetricRows/);
  assert.match(app, /data-manager-metric-kind=/);
  assert.ok(fieldCatalog.listFieldPages().includes('manager_metrics'));
  assert.deepEqual(fieldCatalog.FIELDS_CATALOG.manager_metrics.map(field => field.key), [
    'actor', 'range_days', 'active_customers', 'deferred_customers', 'threshold_customers',
    'planned_after_deferred', 'on_time_action', 'first_touch_silent',
    'unimproved_after_intervention', 'review_status',
  ]);
});

test('team business lists use independent per-user shared-widget layouts while AI stays out of scope', () => {
  for (const [sortId, settingsId, pageKey, layoutKey, definition, sortFn] of [
    ['teamProgressSalesSort', 'teamProgressSalesColumnSettings', 'team_progress_sales', 'teamProgressSalesListLayout', 'teamProgressSalesColumnDefinitions', 'sortedTeamProgressSalesRows'],
    ['teamProgressDrilldownSort', 'teamProgressDrilldownColumnSettings', 'team_progress_drilldown', 'teamProgressDrilldownListLayout', 'teamProgressDrilldownColumnDefinitions', 'sortedTeamProgressDrilldownRows'],
    ['teamCollaborationSort', 'teamCollaborationColumnSettings', 'team_collaboration', 'teamCollaborationListLayout', 'teamCollaborationColumnDefinitions', 'sortedTeamCollaborationRows'],
  ]) {
    assert.match(html, new RegExp(`id="${sortId}"`));
    assert.match(html, new RegExp(`id="${settingsId}"`));
    assert.match(html, new RegExp(`id="${settingsId}Panel"`));
    assert.match(app, new RegExp(layoutKey));
    assert.match(app, new RegExp(`data-list-page="${pageKey}"`));
    assert.match(app, new RegExp(definition));
    assert.match(app, new RegExp(sortFn));
  }
  assert.doesNotMatch(`${html}\n${app}`, /team_progress_sales[\s\S]{0,200}ai_/i);
});

test('team progress sales schema exposes only non-AI summary fields', () => {
  assert.ok(fieldCatalog.listFieldPages().includes('team_progress_sales'));
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'team_progress_sales',
    user: { role: 'manager' },
    permissions: { view_team: true },
    features: { ai_stations: true },
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'owner', 'sample', 'progress_rate', 'progressed_customers', 'silent_customers',
    'repeated_deferred_customers', 'plans_formed_customers', 'actions_after_plan_customers',
    'overdue_manager_tasks', 'escalated_manager_tasks',
  ]);
  assert.equal(schema.fields.some(field => field.key.startsWith('ai_')), false);
});

test('team progress drilldown schema shares read-only customer, task, and timeline fields', () => {
  assert.ok(fieldCatalog.listFieldPages().includes('team_progress_drilldown'));
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'team_progress_drilldown',
    user: { role: 'manager' },
    permissions: { view_team: true },
    features: {},
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'company', 'customer_id', 'owner', 'country', 'stage', 'facts', 'task_reason',
    'status', 'kind', 'detail', 'occurred_at',
  ]);
  assert.equal(schema.fields.some(field => field.key === 'actions'), false);
});

test('team collaboration schema exposes collaboration facts and the page action key without AI fields', () => {
  assert.ok(fieldCatalog.listFieldPages().includes('team_collaboration'));
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'team_collaboration',
    user: { role: 'manager' },
    permissions: { view_customers: true, record_collaboration_support: true },
    features: { ai_stations: true },
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'sales_user', 'customer', 'status', 'source', 'relation', 'problem', 'suggestion',
    'outcome', 'next_step', 'created_at', 'actions',
  ]);
  assert.equal(schema.fields.some(field => field.key.startsWith('ai_')), false);
});

test('insights schema exposes ordered manual evaluation fields without AI or action columns', () => {
  assert.ok(fieldCatalog.listFieldPages().includes('insights'));
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'insights',
    user: { role: 'manager' },
    permissions: { view_insights: true },
    features: { ai_stations: true },
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'company', 'stage', 'country', 'owner', 'evaluation_status', 'evaluation_text',
    'evaluation_count', 'evaluated_at',
  ]);
  assert.deepEqual(schema.fields.map(field => field.sortOrder), [10, 20, 30, 40, 50, 60, 70, 80]);
  assert.equal(schema.fields.some(field => field.key.startsWith('ai_')), false);
  assert.equal(schema.fields.some(field => field.key === 'actions'), false);
});

test('insights list uses the shared widget with per-user layout and server sorting', () => {
  assert.match(html, /id="insightsSort"/);
  assert.match(html, /id="insightsColumnSettings"/);
  assert.match(html, /id="insightsColumnSettingsPanel"/);
  assert.match(app, /insightsListLayout/);
  assert.match(app, /tradepulse\.listLayout\.insights/);
  assert.match(app, /listWidget\?\.renderTable[\s\S]*data-list-page="insights"/);
  assert.match(app, /params\.set\('sort', state\.insightsListLayout\?\.sortPreset/);
  assert.doesNotMatch(app, /insightsColumnDefinitions[\s\S]{0,2500}ai_/i);
});

test('protected customer directory exposes only manual fields and shared list controls', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'protected_customers',
    user: { role: 'admin' },
    permissions: { manage_protected_customers: true },
    features: { ai_stations: true },
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'external_customer_id', 'alpha_nickname', 'crm_nickname', 'company_name', 'country', 'city',
    'website', 'industry', 'customer_type', 'product_focus', 'status', 'batch_id', 'created_at',
    'activated_at', 'updated_at',
  ]);
  assert.equal(schema.fields.some(field => field.key.startsWith('ai_')), false);
  assert.equal(schema.fields.some(field => field.key === 'actions'), false);
  assert.match(html, /id="protectedSort"/);
  assert.match(html, /id="protectedColumnSettings"[\s\S]*aria-controls="protectedColumnSettingsPanel"/);
  assert.match(html, /id="protectedColumnSettingsPanel"[^>]*list-column-settings/);
  assert.match(app, /protectedCustomerColumns\(\)/);
  assert.match(app, /team_collaboration', 'insights', 'protected_customers', 'recycle_bin'/);
  assert.match(app, /tradepulse\.listLayout\.protected_customers/);
  assert.match(app, /listWidget\?\.renderTable[\s\S]*protected-list-table/);
  assert.match(app, /sort: model\.sort \|\| 'created_desc'/);
  assert.doesNotMatch(app, /protectedCustomerColumns[\s\S]{0,2400}ai_/i);
});

test('research people list uses the shared widget with per-user layout and authorized columns', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'contacts',
    user: { role: 'sales' },
    permissions: { view_contacts: true },
    features: {},
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'company', 'contact', 'title_department', 'level', 'methods', 'status',
  ]);
  assert.match(html, /id="peopleSort"/);
  assert.match(html, /id="peopleColumnSettings"/);
  assert.match(html, /id="peopleColumnSettingsPanel"/);
  assert.match(app, /researchPeopleListLayout/);
  assert.match(app, /tradepulse\.listLayout\.contacts/);
  assert.match(app, /listWidget\?\.renderTable[\s\S]*data-list-page="contacts"/);
  assert.match(app, /params\.set\('sort', state\.researchPeopleListLayout\??\.sortPreset/);
});

test('research recon list uses the shared widget with per-user layout and authorized columns', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'recon',
    user: { role: 'sales' },
    permissions: { view_recon: true, view_contacts: true },
    features: {},
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'company', 'score_group', 'profile', 'opportunity', 'contacts',
  ]);
  assert.match(html, /id="reconSort"/);
  assert.match(html, /id="reconColumnSettings"/);
  assert.match(html, /id="reconColumnSettingsPanel"/);
  assert.match(app, /state\.fieldSchemas\?\.recon\?\.fields/);
  assert.match(app, /reconListLayout/);
  assert.match(app, /tradepulse\.listLayout\.recon/);
  assert.match(app, /listWidget\?\.renderTable[\s\S]*data-list-page="recon"/);
  assert.match(app, /params\.set\('sort', state\.reconListLayout\?\.sortPreset/);
});

test('recycle list uses the shared widget with per-user layout and server sorting', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'recycle_bin',
    user: { role: 'sales' },
    permissions: { view_own_mismatch_history: true },
    features: {},
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'company', 'previous_owner', 'reason', 'recycled_at',
  ]);
  assert.match(html, /id="recycleSort"/);
  assert.match(html, /id="recycleColumnSettings"/);
  assert.match(html, /id="recycleColumnSettingsPanel"/);
  assert.match(app, /recycleBinListLayout/);
  assert.match(app, /tradepulse\.listLayout\.recycle_bin/);
  assert.match(app, /listWidget\?\.renderTable[\s\S]*data-list-page="recycle_bin"/);
  assert.match(app, /params\.set\('sort', state\.recycleBinListLayout\.sortPreset/);
});

test('pipeline list uses the shared widget with per-user layout and server sorting', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'pipeline',
    user: { role: 'sales' },
    permissions: { view_pipeline: true },
    features: {},
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'company', 'stage', 'next_action', 'owner',
  ]);
  assert.match(html, /id="pipelineSort"/);
  assert.match(html, /id="pipelineColumnSettings"/);
  assert.match(html, /id="pipelineColumnSettingsPanel"/);
  assert.match(app, /pipelineListLayout/);
  assert.match(app, /tradepulse\.listLayout\.pipeline/);
  assert.match(app, /listWidget\?\.renderTable[\s\S]*data-list-page="pipeline"/);
  assert.match(app, /params\.set\('sort', state\.pipelineListLayout\.sortPreset/);
});

test('intake list uses the shared widget with per-user layout and server sorting', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'intake',
    user: { role: 'manager' },
    permissions: { view_intake: true, manage_intake: true, view_contacts: true },
    features: {},
  });
  assert.ok(schema.fields.some(field => field.key === 'company_name'));
  assert.match(html, /id="intakeSort"/);
  assert.match(html, /id="intakeColumnSettings"/);
  assert.match(html, /id="intakeColumnSettingsPanel"/);
  assert.match(app, /intakeListLayout/);
  assert.match(app, /tradepulse\.listLayout\.intake/);
  assert.match(app, /listWidget\?\.renderTable[\s\S]*data-list-page="intake"/);
  assert.match(app, /params\.set\('sort', state\.intakeListLayout\.sortPreset/);
});

test('alerts list uses the shared widget with per-user layout and server sorting', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'alerts',
    user: { role: 'sales' },
    permissions: { view_alerts: true },
    features: {},
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'urgency', 'company', 'reasons', 'due_at', 'owner',
  ]);
  assert.match(html, /id="alertsSort"/);
  assert.match(html, /id="alertsColumnSettings"/);
  assert.match(html, /id="alertsColumnSettingsPanel"/);
  assert.match(app, /alertsListLayout/);
  assert.match(app, /tradepulse\.listLayout\.alerts/);
  assert.match(app, /listWidget\?\.renderTable[\s\S]*data-list-page="alerts"/);
  assert.match(app, /params\.set\('sort', state\.alertsListLayout\?\.sortPreset/);
});

test('notifications list uses the shared widget with per-user layout and server sorting', () => {
  const schema = fieldCatalog.effectiveFieldSchema({
    pageKey: 'notifications',
    user: { role: 'sales' },
    permissions: { view_notifications: true },
    features: {},
  });
  assert.deepEqual(schema.fields.map(field => field.key), [
    'status', 'title', 'customer', 'detail', 'created_at', 'delivery',
  ]);
  assert.match(html, /id="notificationsSort"/);
  assert.match(html, /id="notificationsColumnSettings"/);
  assert.match(html, /id="notificationsColumnSettingsPanel"/);
  assert.match(app, /notificationsListLayout/);
  assert.match(app, /tradepulse\.listLayout\.notifications/);
  assert.match(app, /listWidget\?\.renderTable[\s\S]*notification-grid/);
  assert.match(app, /params\.set\('sort', state\.notificationsListLayout\?\.sortPreset/);
});
