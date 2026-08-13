'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');

function bodyBetween(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return app.slice(from, to);
}

test('sales navigation and customer actions use narrow mismatch permissions', () => {
  assert.match(html, /data-view="recycleBin" data-permission="view_own_mismatch_history"/);
  const canReject = bodyBetween('function canRejectCustomer', 'function canBulkAssignCustomers');
  assert.match(canReject, /reject_own_customer_mismatch/);

  const clickHandler = bodyBetween("const rejectCustomer = event.target.closest('[data-reject-customer]')", "const trashCustomer = event.target.closest('[data-trash-customer]')");
  assert.doesNotMatch(clickHandler, /state\.data\.accounts\.find/);
  assert.match(clickHandler, /openRecycleReasonModal/);
});

test('reject submission closes the drawer and reloads only initialized customer-derived lists', async () => {
  const helper = bodyBetween('async function rejectCustomerAsMismatch', 'function renderRecycleBin');
  const events = [];
  const state = {
    customerFilterController: {},
    customerList: { page: 3 },
    authorizedBusinessLists: {
      pipeline: { filterController: {}, page: 2 },
      alerts: { filterController: {}, page: 4 },
      insights: { filterController: null, page: 5 },
      recycle_bin: { filterController: {}, page: 6 },
      manager_tasks: { filterController: {}, page: 7 },
      manager_risks: { filterController: null, page: 8 },
      manager_metrics: { filterController: {}, page: 9 },
      notifications: { filterController: null, page: 10 },
    },
  };
  const rejectCustomerAsMismatch = Function(
    'api',
    'closeDrawer',
    'refresh',
    'state',
    'loadCustomerPage',
    'loadAuthorizedBusinessPage',
    'loadRecycleBin',
    'toast',
    `'use strict'; ${helper}; return rejectCustomerAsMismatch;`,
  )(
    async (url, options) => { events.push(['api', url, options]); },
    () => { events.push(['closeDrawer']); },
    async () => { events.push(['refresh']); },
    state,
    async options => { events.push(['customers', options]); },
    async (pageKey, options) => { events.push([pageKey, options]); },
    async () => { events.push(['legacyRecycleReload']); },
    message => { events.push(['toast', message]); },
  );

  await rejectCustomerAsMismatch('CRM / 273', '产品需求不匹配');

  assert.deepEqual(events, [
    ['api', '/api/sales-crm/accounts/CRM%20%2F%20273/reject', {
      method: 'POST', body: JSON.stringify({ reason: '产品需求不匹配' }),
    }],
    ['closeDrawer'],
    ['refresh'],
    ['customers', { reset: false, force: true, page: 3 }],
    ['pipeline', { reset: false, force: true, page: 2 }],
    ['alerts', { reset: false, force: true, page: 4 }],
    ['recycle_bin', { reset: false, force: true, page: 6 }],
    ['manager_tasks', { reset: false, force: true, page: 7 }],
    ['manager_metrics', { reset: false, force: true, page: 9 }],
    ['toast', '已移入不对口记录，可在“不对口记录”中查看'],
  ]);
});

test('forced lifecycle reload replaces an in-flight authorized request without stale writes', async () => {
  const helper = bodyBetween('async function loadAuthorizedBusinessPage', 'function notificationStatusFromApplied');
  let resolveOld;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  const requests = [];
  const renderedSnapshots = [];
  const navigationSnapshots = [];
  const meta = {
    rows: [{ id: 'initial' }],
    page: 4,
    pageSize: 50,
    total: 1,
    authorizedTotal: 1,
    hasMore: false,
    loading: false,
    loaded: true,
    error: '',
    summary: null,
    requestEpoch: 0,
    filterController: {
      serialize: () => ({ permissionVersion: 'v1', filters: [{ field: 'search', value: 'kept' }] }),
      updateSchema: () => {},
    },
    filterMount: { setResultMeta: () => {} },
  };
  const state = {
    alertSeverity: '',
    authorizedBusinessLists: { alerts: meta },
  };
  const authorizedBusinessConfig = {
    alerts: {
      render: () => renderedSnapshots.push({ rows: meta.rows.map(row => row.id), total: meta.total }),
    },
  };
  const loadAuthorizedBusinessPage = Function(
    'authorizedBusinessConfig',
    'state',
    'applyAuthorizedBusinessRows',
    'updateAuthorizedBusinessMeta',
    'componentPayloadToRaw',
    'api',
    'renderNavigationCounts',
    'toast',
    `'use strict'; ${helper}; return loadAuthorizedBusinessPage;`,
  )(
    authorizedBusinessConfig,
    state,
    () => {},
    () => {},
    payload => payload,
    async url => {
      requests.push(url);
      if (requests.length === 1) return oldResponse;
      return {
        rows: [{ id: 'replacement' }], page: 4, pageSize: 50, total: 1,
        authorizedTotal: 1, hasMore: false, summary: { current: 'replacement' },
      };
    },
    () => navigationSnapshots.push({ rows: meta.rows.map(row => row.id), total: meta.total }),
    () => {},
  );

  const oldLoad = loadAuthorizedBusinessPage('alerts', { reset: false, page: 4 });
  await Promise.resolve();
  const replacementLoad = loadAuthorizedBusinessPage('alerts', {
    reset: false, force: true, page: 4,
  });
  await replacementLoad;
  resolveOld({
    rows: [{ id: 'stale' }], page: 4, pageSize: 50, total: 99,
    authorizedTotal: 99, hasMore: true, summary: { current: 'stale' },
  });
  await oldLoad;

  assert.equal(requests.length, 2);
  assert.equal(requests.every(url => new URL(url, 'https://crm.test').searchParams.get('page') === '4'), true);
  assert.deepEqual(requests.map(url => JSON.parse(
    new URL(url, 'https://crm.test').searchParams.get('filters'),
  ).filters[0].value), ['kept', 'kept']);
  assert.deepEqual(meta.rows, [{ id: 'replacement' }]);
  assert.equal(meta.total, 1);
  assert.deepEqual(meta.summary, { current: 'replacement' });
  assert.deepEqual(navigationSnapshots, [{ rows: ['replacement'], total: 1 }]);
  assert.equal(renderedSnapshots.some(snapshot => snapshot.rows.includes('stale') || snapshot.total === 99), false);
});

test('recycle rows use opaque record keys and expose restore only from server actions', () => {
  const render = bodyBetween('function renderRecycleBin', 'async function openRecycleCustomer');
  assert.match(render, /row\.recordKey/);
  assert.match(render, /row\.actions\?\.includes\('restore'\)/);
  assert.match(render, /data-restore-mismatch/);
  assert.match(render, /仅查看记录/);
});
