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
    ['customers', { reset: false, page: 3 }],
    ['pipeline', { reset: false, page: 2 }],
    ['alerts', { reset: false, page: 4 }],
    ['recycle_bin', { reset: false, page: 6 }],
    ['manager_tasks', { reset: false, page: 7 }],
    ['manager_metrics', { reset: false, page: 9 }],
    ['toast', '已移入不对口记录，可在“不对口记录”中查看'],
  ]);
});

test('recycle rows use opaque record keys and expose restore only from server actions', () => {
  const render = bodyBetween('function renderRecycleBin', 'async function openRecycleCustomer');
  assert.match(render, /row\.recordKey/);
  assert.match(render, /row\.actions\?\.includes\('restore'\)/);
  assert.match(render, /data-restore-mismatch/);
  assert.match(render, /仅查看记录/);
});
