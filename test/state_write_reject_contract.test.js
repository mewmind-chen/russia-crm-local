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

// 阶段 B 契约：stage/lifecycle/assignment 的写必须经 lifecycle/state_write 网关，
// 不得再直接 `UPDATE crm_accounts SET stage=.../lifecycle_status=.../assignment_status=.../owner_id=...`。
test('reject routes stage/lifecycle/assignment writes through the lifecycle gateway', () => {
  const rejectBody = functionSlice(salesCrmSource, 'rejectCrmCustomer', 'restoreMismatchRecord');
  assert.doesNotMatch(
    rejectBody,
    /UPDATE crm_accounts SET[^)]*(?:stage\s*=|lifecycle_status\s*=|assignment_status\s*=|(?<![a-z_])owner_id\s*=)/,
    'rejectCrmCustomer: account state columns must be written through the gateway, never a bare UPDATE',
  );
  assert.match(rejectBody, /applyAccountStatePatch\(/, 'rejectCrmCustomer: must route the state write through the gateway');
});

test('marking a customer mismatch converges state and keeps the reject invariants', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const res = await fx.request('/api/sales-crm/accounts/CRM-WU/reject', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '产品线不对口' },
  });
  assert.equal(res.status, 200, await res.text());

  const row = fx.db.prepare(`SELECT stage,lifecycle_status,recycle_kind,assignment_status,owner_id
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(row.stage, 'lost');
  assert.equal(row.lifecycle_status, 'recycled');
  assert.equal(row.recycle_kind, 'mismatch');
  assert.equal(row.assignment_status, 'returned');
  assert.equal(row.owner_id, null);
  // §4.1 不允许 recycled + claimed/assigned 同时成立
  assert.notEqual(row.assignment_status, 'claimed');
  assert.notEqual(row.assignment_status, 'assigned');
  // §4.2 assignment=returned 不得保留 owner
  assert.equal(row.owner_id, null);

  // 已回收客户不再可标记（状态退出 active 作用域 → 非 2xx，行保持 recycled）
  const second = await fx.request('/api/sales-crm/accounts/CRM-WU/reject', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '再次标记' },
  });
  assert.ok(second.status >= 400 && second.status < 500, `second reject must fail, got ${second.status}`);
  assert.equal(
    fx.db.prepare("SELECT lifecycle_status FROM crm_accounts WHERE id='CRM-WU'").get().lifecycle_status,
    'recycled',
  );
});