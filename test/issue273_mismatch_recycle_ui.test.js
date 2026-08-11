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

test('reject submission refreshes the server-owned mismatch history', () => {
  const helper = bodyBetween('async function rejectCustomerAsMismatch', 'function renderRecycleBin');
  assert.match(helper, /\/api\/sales-crm\/accounts\/\$\{encodeURIComponent\(customerId\)\}\/reject/);
  assert.match(helper, /await loadRecycleBin/);
  assert.match(helper, /已移入不对口记录/);
});

test('recycle rows use opaque record keys and expose restore only from server actions', () => {
  const render = bodyBetween('function renderRecycleBin', 'async function openRecycleCustomer');
  assert.match(render, /row\.recordKey/);
  assert.match(render, /row\.actions\?\.includes\('restore'\)/);
  assert.match(render, /data-restore-mismatch/);
  assert.match(render, /仅查看记录/);
});
