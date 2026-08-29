'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');
const {
  functionSlice,
  STATE_COLUMNS,
  assertNoColumns,
} = require('./helpers/lifecycle_gate_contract');

const root = path.join(__dirname, '..');
const salesCrmSource = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

const STATE = [/applyAccountStatePatch\(/];

test('reclaiming a returned account routes lifecycle and assignment through the state gateway', () => {
  assertNoColumns(
    functionSlice(salesCrmSource, 'createClaimedAccount', 'scanDailyIntake'),
    STATE_COLUMNS,
    STATE,
    'createClaimedAccount restore branch',
  );
});

test('trashing a manual customer routes lifecycle and assignment through the state gateway', () => {
  assertNoColumns(
    functionSlice(salesCrmSource, 'trashManualCustomer', 'assertExternalCustomerIdentitiesAvailable'),
    STATE_COLUMNS,
    STATE,
    'trashManualCustomer',
  );
});

test('restoring a manual customer routes lifecycle and assignment through the state gateway', () => {
  assertNoColumns(
    functionSlice(salesCrmSource, 'restoreManualCustomer', 'reassignReturnedCustomer'),
    STATE_COLUMNS,
    STATE,
    'restoreManualCustomer',
  );
});

test('trashing and restoring a manual customer keeps the recycle state contract', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('USR-ADMIN', { manage_manual_customer_deletion: true });
  fx.db.prepare("UPDATE customer_pool SET source_file='CRM手工新增' WHERE customer_id='RU-9001'").run();

  const trashed = await fx.request('/api/sales-crm/accounts/CRM-WU/trash', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '误建测试客户' },
  });
  assert.equal(trashed.status, 200, await trashed.text());

  const recycled = fx.db.prepare(`SELECT lifecycle_status,recycle_kind,assignment_status,owner_id
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(recycled.lifecycle_status, 'recycled');
  assert.equal(recycled.recycle_kind, 'manual_delete');
  assert.equal(recycled.assignment_status, 'returned');
  assert.equal(recycled.owner_id, null);

  const restored = await fx.request('/api/sales-crm/accounts/CRM-WU/restore', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {},
  });
  assert.equal(restored.status, 200, await restored.text());

  const row = fx.db.prepare(`SELECT lifecycle_status,recycle_kind,assignment_status,owner_id
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  assert.equal(row.lifecycle_status, 'active');
  assert.equal(row.recycle_kind, '');
  // U-WU 是 manager 而非 sales，恢复后无有效负责人可领 → unassigned 且无 owner
  assert.equal(row.assignment_status, 'unassigned');
  assert.equal(row.owner_id, null);
});