'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');
const { functionSlice } = require('./helpers/lifecycle_gate_contract');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 B §4 剩余：assertAccountStateContract 必须在回收/恢复写点对
// "合并后的完整目标视图"显式校验（防未来编辑产生 recycled+claimed 等非法组合）。
test('sales_crm imports the state contract guard', () => {
  assert.match(
    source,
    /const \{ [^}]*assertAccountStateContract[^}]*\} = require\('\.\/domains\/lifecycle\/state_write'\)/,
    'sales_crm must import assertAccountStateContract',
  );
});

test('rejectCrmCustomer validates the merged recycled+returned view before writing', () => {
  const body = functionSlice(source, 'rejectCrmCustomer', 'restoreMismatchRecord');
  assert.match(body, /assertAccountStateContract\(/, 'reject must call the state contract guard');
  assert.match(body, /lifecycle_status:\s*'recycled'/, 'reject must target recycled lifecycle');
  assert.match(body, /assignment_status:\s*'returned'/, 'reject must target returned assignment');
  assert.match(body, /owner_id:\s*null/, 'reject must target null owner');
});

test('trashManualCustomer validates the merged recycled+returned view before writing', () => {
  const body = functionSlice(source, 'trashManualCustomer', 'assertExternalCustomerIdentitiesAvailable');
  assert.match(body, /assertAccountStateContract\(/, 'trash must call the state contract guard');
  assert.match(body, /lifecycle_status:\s*'recycled'/, 'trash must target recycled lifecycle');
  assert.match(body, /assignment_status:\s*'returned'/, 'trash must target returned assignment');
  assert.match(body, /owner_id:\s*null/, 'trash must target null owner');
});

test('restoreManualCustomer validates the merged active view before writing', () => {
  const body = functionSlice(source, 'restoreManualCustomer', 'reassignReturnedCustomer');
  assert.match(body, /assertAccountStateContract\(/, 'restore must call the state contract guard');
  assert.match(body, /lifecycle_status:\s*'active'/, 'restore must target active lifecycle');
  assert.match(body, /assignment_status:\s*ownerId \? 'claimed' : 'unassigned'/, 'restore must pair owner with claimed');
});

// 行为契约：守卫在正确路径上不误报（trash→restore 全周期仍绿）。
test('trash and restore still complete with the invariant guard wired', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('USR-ADMIN', { manage_manual_customer_deletion: true });
  fx.db.prepare("UPDATE customer_pool SET source_file='CRM手工新增' WHERE customer_id='RU-9001'").run();

  const trashed = await fx.request('/api/sales-crm/accounts/CRM-WU/trash', {
    cookie: fx.adminCookie, method: 'POST', body: { reason: '误建测试客户' },
  });
  assert.equal(trashed.status, 200, await trashed.text());

  const recycled = fx.db.prepare(
    `SELECT lifecycle_status,assignment_status,owner_id FROM crm_accounts WHERE id='CRM-WU'`,
  ).get();
  assert.equal(recycled.lifecycle_status, 'recycled');
  assert.equal(recycled.assignment_status, 'returned');
  assert.equal(recycled.owner_id, null);

  const restored = await fx.request('/api/sales-crm/accounts/CRM-WU/restore', {
    cookie: fx.adminCookie, method: 'POST',
  });
  assert.equal(restored.status, 200, await restored.text());
  const active = fx.db.prepare(
    `SELECT lifecycle_status,assignment_status,owner_id FROM crm_accounts WHERE id='CRM-WU'`,
  ).get();
  assert.equal(active.lifecycle_status, 'active');
  // U-WU 是 manager 而非 sales，恢复后无有效负责人可领 → unassigned 且无 owner
  assert.equal(active.assignment_status, 'unassigned');
  assert.equal(active.owner_id, null);
});