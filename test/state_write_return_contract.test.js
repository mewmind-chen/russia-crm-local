'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.join(__dirname, '..');
const salesCrmSource = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

function functionSlice(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = nextFunctionName
    ? source.indexOf(`function ${nextFunctionName}(`, start + 1)
    : source.length;
  if (nextFunctionName) assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return source.slice(start, end);
}

// 阶段 B 契约：退回只走 assignment 网关，不直接写 lifecycle_status/stage/owner_id，
// 也不经裸 UPDATE 改写 assignment_status。
test('return routes the assignment write through the gateway and leaves lifecycle/stage alone', () => {
  const returnBody = functionSlice(salesCrmSource, 'applyCustomerReturn', 'returnCustomer');
  assert.doesNotMatch(
    returnBody,
    /UPDATE crm_accounts SET[^)]*(?:stage\s*=|lifecycle_status\s*=|assignment_status\s*=|(?<![a-z_])owner_id\s*=)/,
    'applyCustomerReturn: account state columns must be written through the gateway, never a bare UPDATE',
  );
  assert.match(returnBody, /applyAccountStatePatch\(/, 'applyCustomerReturn: must route the state write through the gateway');
});

test('returning a customer to the pool touches only assignment and keeps lifecycle active', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const before = fx.db.prepare('SELECT stage,lifecycle_status,assignment_status,owner_id FROM crm_accounts WHERE id=?')
    .get('CRM-WU');

  const res = await fx.request('/api/sales-crm/accounts/CRM-WU/return', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '网格内暂不适合开发' },
  });
  assert.equal(res.status, 200, await res.text());

  const row = fx.db.prepare(`SELECT stage,lifecycle_status,recycle_kind,recycle_reason,
    assignment_status,owner_id FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(row.assignment_status, 'returned');
  // §4.2 returned 不得保留 owner
  assert.equal(row.owner_id, null);
  // 退回可再分配：lifecycle 保持 active（不可回收），stage 不被改动
  assert.equal(row.lifecycle_status, 'active');
  assert.equal(row.recycle_kind, '');
  assert.equal(row.recycle_reason, '');
  assert.equal(row.stage, before.stage);

  const second = await fx.request('/api/sales-crm/accounts/CRM-WU/return', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '重复退回' },
  });
  assert.equal(second.status, 409);
});