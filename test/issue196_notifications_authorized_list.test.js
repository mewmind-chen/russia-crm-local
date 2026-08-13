'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixtures = require('./helpers/permission_fixture');
const {
  listNotificationRows,
  businessFilterOptions,
} = require('../lib/business_page_filters');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

const AI_NOTIFICATION_CODES = [
  'SALES_PACK_READY',
  'SALES_PACK_FAILED',
  'MANAGER_ANOMALY_READY',
  'SALES_COACHING_READY',
  'AI_TASK_READY',
  'AI_TASK_FAILED',
];

function actor(id, role, permissions = {}) {
  return { id, role, permissions };
}

function ast(filters = []) {
  return { version: 1, page: 'notifications', filters };
}

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function insertNotification(db, row) {
  db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,
     wecom_status,created_at,read_at)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',?,'')`).run(
    row.id,
    row.userId,
    row.customerId || '',
    row.code,
    row.severity || 'info',
    row.title || row.code,
    row.detail || '',
    row.status || 'unread',
    `issue196:${row.id}`,
    row.createdAt || '2026-08-01 10:00:00',
  );
}

test('notification center mounts the #116 authorized filter, result count, and pagination controls', () => {
  assert.match(html, /id="notificationsAuthorizedFilters"[^>]*aria-live="polite"/);
  assert.match(html, /id="notificationResultCount"[^>]*class="toolbar-count"/);
  assert.match(html, /id="notificationsAuthorizedPagination"[^>]*data-pagination="notifications"/);
});

test('notification page registers, initializes, loads, and renders one authorized list contract', () => {
  assert.match(app, /'manager_tasks', 'manager_risks', 'manager_metrics', 'notifications'/);
  assert.match(app, /notifications:\s*\{\s*root:\s*'#notificationsAuthorizedFilters'/);
  assert.match(app, /pagination:\s*'#notificationsAuthorizedPagination'/);
  assert.match(app, /count:\s*'#notificationResultCount'/);
  assert.match(app, /render:\s*renderNotifications/);

  const switchView = functionBlock(app, 'switchView');
  assert.match(switchView, /notifications:\s*'notifications'/);
  assert.match(switchView, /initializeAuthorizedBusinessFilters\(businessPageKey, \{ force: viewChanged \}\)/);

  const applyRows = functionBlock(app, 'applyAuthorizedBusinessRows');
  assert.match(applyRows, /pageKey === 'notifications'/);
  assert.match(applyRows, /state\.data\.notifications\s*=\s*meta\.rows/);

  const render = functionBlock(app, 'renderNotifications');
  assert.match(render, /state\.authorizedBusinessLists\.notifications/);
  assert.match(render, /meta\.loaded\s*\?\s*meta\.rows/);
  assert.match(render, /meta\.total/);
  assert.match(render, /item\.recipientId/);
  assert.match(render, /item\.customerId/);
  assert.match(render, /item\.createdAt/);
  assert.doesNotMatch(render, /state\.data\.notifications\s*\|\|/);
  assert.doesNotMatch(render, /\.filter\(item => item\.user_id ===/);
});

test('notification UI uses authorized aggregate counts and reconciles AI and quick-filter state', () => {
  const navigationCounts = functionBlock(app, 'renderNavigationCounts');
  assert.match(navigationCounts, /notificationMeta\.summary\.unread/);

  const render = functionBlock(app, 'renderNotifications');
  assert.match(render, /meta\.summary/);
  assert.match(render, /summary\.unread/);
  assert.match(render, /summary\.failed/);
  assert.match(render, /field\.key === 'notification_status'/);
  assert.match(render, /tabs\.classList\.toggle\('hidden'/);

  const stripAI = functionBlock(app, 'stripDisabledAINotificationState');
  assert.match(stripAI, /notificationRowsAllowedByAIGate\(meta\.rows\)/);
  assert.match(stripAI, /field\.key === 'notification_code'/);
  assert.match(stripAI, /filterMount\.updateSchema\(schema\)/);

  const allowedByGate = functionBlock(app, 'notificationRowsAllowedByAIGate');
  assert.match(allowedByGate, /const packEnabled = salesPackEnabled\(\)/);
  assert.match(allowedByGate, /!salesPackNotificationCodes\.has\(code\)/);

  const setFeature = functionBlock(app, 'setAIFeature');
  assert.match(setFeature, /previousAIEnabled !== customerAIEnabled\(\)/);
  assert.match(setFeature, /previousSalesPackEnabled !== salesPackEnabled\(\)/);
  assert.match(setFeature, /initializeAuthorizedBusinessFilters\('notifications', \{ force: true \}\)/);

  const initialize = functionBlock(app, 'initializeAuthorizedBusinessFilters');
  assert.match(initialize, /onApply: payload =>/);
  assert.match(initialize, /state\.notificationStatus = notificationStatusFromApplied\(payload\)/);
  assert.match(initialize, /syncNotificationStatusFromController\(controller\)/);

  assert.match(app, /if \(!controller \|\| !statusAuthorized\)[\s\S]{0,180}state\.notificationStatus = ''/);
  assert.match(app, /if \(controller\.setDraft\('notification_status', \[requestedStatus\]\)\) controller\.apply\(\)/);
});

test('notification adapter applies hard and runtime AI gates before count, pagination, and facets', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const manager = actor('U-MGR', 'manager', {
    view_customers: true,
    view_notifications: true,
    view_all_customers: true,
    view_contacts: true,
  });

  insertNotification(fx.db, {
    id: 'NOTE-BUSINESS-1', userId: 'U-MGR', customerId: 'CRM-OWN',
    code: 'ACCOUNT_ASSIGNED', createdAt: '2026-08-01 12:00:00',
  });
  insertNotification(fx.db, {
    id: 'NOTE-BUSINESS-2', userId: 'U-MGR', customerId: 'CRM-OWN',
    code: 'PLAN_DUE', status: 'read', createdAt: '2026-08-01 11:00:00',
  });
  fx.db.prepare("UPDATE crm_notifications SET wecom_status='failed' WHERE id='NOTE-BUSINESS-2'").run();
  AI_NOTIFICATION_CODES.forEach((code, index) => insertNotification(fx.db, {
    id: `NOTE-AI-${index}`, userId: 'U-MGR', customerId: 'CRM-OWN', code,
    severity: 'warning', createdAt: `2026-08-01 10:0${index}:00`,
  }));

  const hardDisabled = listNotificationRows(
    fx.db,
    manager,
    ast(),
    { page: 1, pageSize: 1 },
    { hardFlags: { ai_stations: false } },
  );
  assert.equal(hardDisabled.authorizedTotal, 2);
  assert.equal(hardDisabled.total, 2);
  assert.equal(hardDisabled.rows.length, 1);
  assert.equal(hardDisabled.hasMore, true);
  assert.deepEqual(hardDisabled.summary, { total: 2, unread: 1, failed: 1 });
  assert.equal(AI_NOTIFICATION_CODES.includes(hardDisabled.rows[0].code), false);

  const unreadOnly = listNotificationRows(
    fx.db,
    manager,
    ast([{ key: 'notification_status', operator: 'in', values: ['unread'] }]),
    { page: 1, pageSize: 1 },
    { hardFlags: { ai_stations: false } },
  );
  assert.equal(unreadOnly.total, 1);
  assert.deepEqual(unreadOnly.summary, { total: 2, unread: 1, failed: 1 });

  const hardDisabledFacets = businessFilterOptions(
    fx.db,
    manager,
    'notifications',
    ['notification_code', 'notification_severity'],
    { hardFlags: { ai_stations: false } },
  );
  assert.deepEqual(
    new Set(hardDisabledFacets.notification_code.map(option => option.value)),
    new Set(['ACCOUNT_ASSIGNED', 'PLAN_DUE']),
  );
  assert.equal(hardDisabledFacets.notification_severity.some(option => option.value === 'warning'), false);

  fx.db.prepare("UPDATE crm_ai_feature_flags SET enabled=0 WHERE feature_key='ai_stations'").run();
  const runtimeDisabled = listNotificationRows(
    fx.db,
    manager,
    ast(),
    { page: 1, pageSize: 20 },
    { hardFlags: { ai_stations: true } },
  );
  assert.equal(runtimeDisabled.authorizedTotal, 2);
  assert.equal(runtimeDisabled.total, 2);
  assert.deepEqual(runtimeDisabled.summary, { total: 2, unread: 1, failed: 1 });
  assert.deepEqual(
    new Set(runtimeDisabled.rows.map(row => row.code)),
    new Set(['ACCOUNT_ASSIGNED', 'PLAN_DUE']),
  );
});

test('authorized notification API removes sales-pack rows, aggregates, and facets when only its effective gate is off', async t => {
  const fx = await fixtures.adminFixture({
    appOptions: {
      salesCrm: {
        aiStationsEnabled: true,
        customerEnrichmentEnabled: true,
        customerEnrichmentAutoTriggerEnabled: true,
        salesPackEnabled: true,
      },
    },
  });
  t.after(() => fx.close());

  insertNotification(fx.db, {
    id: 'NOTE-API-BUSINESS', userId: 'U-WU', customerId: 'CRM-WU',
    code: 'ACCOUNT_ASSIGNED', createdAt: '2026-08-01 12:00:00',
  });
  insertNotification(fx.db, {
    id: 'NOTE-API-MANAGER-AI', userId: 'U-WU', customerId: 'CRM-WU',
    code: 'MANAGER_ANOMALY_READY', status: 'read', createdAt: '2026-08-01 11:00:00',
  });
  for (const [index, code] of ['SALES_PACK_READY', 'SALES_PACK_FAILED'].entries()) {
    insertNotification(fx.db, {
      id: `NOTE-API-PACK-${index}`, userId: 'U-WU', customerId: 'CRM-WU',
      code, createdAt: `2026-08-01 10:0${index}:00`,
    });
  }

  const disabled = await fx.request('/api/sales-crm/ai/features/sales_pack', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  const disabledBody = await disabled.json();
  assert.equal(disabledBody.feature.effectiveEnabled, false);
  assert.equal(disabledBody.features.ai_stations.effectiveEnabled, true);

  const response = await fx.request(
    '/api/sales-crm/lists/notifications?page=1&pageSize=50',
    { cookie: fx.cookie },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 2);
  assert.equal(body.authorizedTotal, 2);
  assert.equal(body.rows.length, 2);
  assert.equal(body.hasMore, false);
  assert.deepEqual(body.summary, { total: 2, unread: 1, failed: 0 });
  assert.equal(body.rows[0].id, 'NOTE-API-BUSINESS');
  assert.doesNotMatch(JSON.stringify(body), /NOTE-API-PACK|SALES_PACK_READY|SALES_PACK_FAILED/);
  assert.match(JSON.stringify(body), /MANAGER_ANOMALY_READY/);

  const schemaResponse = await fx.request('/api/sales-crm/filter-schema/notifications', {
    cookie: fx.cookie,
  });
  assert.equal(schemaResponse.status, 200);
  const schema = (await schemaResponse.json()).schema;
  const codeOptions = schema.fields.find(field => field.key === 'notification_code').options;
  assert.equal(codeOptions.some(option => option.value === 'SALES_PACK_READY'), false);
  assert.equal(codeOptions.some(option => option.value === 'SALES_PACK_FAILED'), false);
  assert.equal(codeOptions.some(option => option.value === 'MANAGER_ANOMALY_READY'), true);

  const bootstrapResponse = await fx.request('/api/sales-crm/bootstrap', {
    cookie: fx.cookie,
  });
  assert.equal(bootstrapResponse.status, 200);
  const bootstrap = await bootstrapResponse.json();
  assert.equal(bootstrap.notifications.some(row => row.code === 'SALES_PACK_READY'), false);
  assert.equal(bootstrap.notifications.some(row => row.code === 'SALES_PACK_FAILED'), false);
  assert.equal(bootstrap.notifications.some(row => row.code === 'MANAGER_ANOMALY_READY'), true);

  for (const notificationId of ['NOTE-API-PACK-0', 'NOTE-API-PACK-1']) {
    const read = await fx.request(`/api/sales-crm/notifications/${notificationId}/read`, {
      cookie: fx.cookie,
      method: 'POST',
      body: {},
    });
    assert.equal(read.status, 404, notificationId);
    assert.equal(
      fx.db.prepare('SELECT status FROM crm_notifications WHERE id=?').get(notificationId).status,
      'unread',
      notificationId,
    );
  }

  const otherAIRead = await fx.request(
    '/api/sales-crm/notifications/NOTE-API-MANAGER-AI/read',
    { cookie: fx.cookie, method: 'POST', body: {} },
  );
  assert.equal(otherAIRead.status, 200);
});

test('sales notification rows omit sensitive recipient and contact-detail fields', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const sales = actor('U-OTHER', 'sales', {
    view_customers: true,
    view_notifications: true,
    view_contacts: false,
  });
  insertNotification(fx.db, {
    id: 'NOTE-SALES-SAFE', userId: 'U-OTHER', customerId: 'CRM-OTHER',
    code: 'ACCOUNT_ASSIGNED', title: '客户有新的业务提醒',
    detail: 'secret-buyer@example.test / +7-900-000-00-00',
  });

  const result = listNotificationRows(
    fx.db,
    sales,
    ast(),
    { page: 1, pageSize: 20 },
    { hardFlags: { ai_stations: false } },
  );
  assert.equal(result.rows.length, 1);
  assert.equal(Object.hasOwn(result.rows[0], 'recipientId'), false);
  assert.equal(Object.hasOwn(result.rows[0], 'recipientName'), false);
  assert.equal(Object.hasOwn(result.rows[0], 'detail'), false);
  assert.doesNotMatch(JSON.stringify(result), /secret-buyer@example\.test|\+7-900-000-00-00/);

  const options = businessFilterOptions(
    fx.db,
    sales,
    'notifications',
    ['notification_status', 'notification_code', 'notification_severity'],
    { hardFlags: { ai_stations: false } },
  );
  assert.equal(Object.hasOwn(options, 'recipient'), false);
});
