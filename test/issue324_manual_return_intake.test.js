'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');
const { installSalesCrm } = require('../lib/sales_crm');

async function createManualCustomer(fx, companyName, ownerId = 'U-OTHER') {
  return fx.requestJson('/api/sales-crm/accounts', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      companyName,
      country: '俄罗斯',
      customerType: '终端制造商',
      source: '公司指派',
      ownerId,
      productFocus: '传感器',
    },
  });
}

test('manual CRM customer return creates a searchable intake row and reclaims the same account', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { manage_customer_recycle: true });

  const created = await createManualCustomer(fx, 'Issue 324 Manual Return');
  assert.equal(
    fx.db.prepare('SELECT COUNT(*) count FROM crm_intake_items WHERE external_customer_id=?')
      .get(created.externalCustomerId).count,
    0,
  );

  const response = await fx.request(`/api/sales-crm/accounts/${created.customerId}/return`, {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { reason: '退回线索池重新分配' },
  });
  assert.equal(response.status, 200);
  const returned = await response.json();
  assert.ok(returned.intakeItemId);

  const intake = fx.db.prepare(`SELECT id,batch_id,external_customer_id,crm_customer_id,
      company_name,status,assigned_owner_id,previous_owner_id,return_reason
    FROM crm_intake_items WHERE id=?`).get(returned.intakeItemId);
  assert.deepEqual(intake, {
    id: returned.intakeItemId,
    batch_id: intake.batch_id,
    external_customer_id: created.externalCustomerId,
    crm_customer_id: created.customerId,
    company_name: 'Issue 324 Manual Return',
    status: 'returned',
    assigned_owner_id: '',
    previous_owner_id: 'U-OTHER',
    return_reason: '退回线索池重新分配',
  });
  assert.match(intake.batch_id, /^BATCH-MANUAL-RETURN-/);
  assert.deepEqual(
    fx.db.prepare(`SELECT intake_item_id,owner_id,previous_owner_id,assignment_status,
      lifecycle_status,recycle_kind FROM crm_accounts WHERE id=?`).get(created.customerId),
    {
      intake_item_id: returned.intakeItemId,
      owner_id: null,
      previous_owner_id: 'U-OTHER',
      assignment_status: 'returned',
      lifecycle_status: 'active',
      recycle_kind: '',
    },
  );

  const listed = await fx.requestJson(
    '/api/sales-crm/intake?status=returned&search=Issue%20324%20Manual%20Return',
    { cookie: fx.adminCookie },
  );
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].id, returned.intakeItemId);

  const assigned = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'assign', itemId: returned.intakeItemId, ownerId: 'U-OTHER' },
  });
  assert.equal(assigned.status, 200);
  const claimed = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { action: 'claim', itemId: returned.intakeItemId, idempotencyKey: 'issue-324-reclaim' },
  });
  assert.equal(claimed.status, 200);
  assert.deepEqual(
    fx.db.prepare(`SELECT id,intake_item_id,owner_id,assignment_status,lifecycle_status
      FROM crm_accounts WHERE id=?`).get(created.customerId),
    {
      id: created.customerId,
      intake_item_id: returned.intakeItemId,
      owner_id: 'U-OTHER',
      assignment_status: 'claimed',
      lifecycle_status: 'active',
    },
  );

  const audit = fx.db.prepare(`SELECT detail_json FROM crm_audit_log
    WHERE action='customer_returned' AND entity_id=? ORDER BY created_at DESC LIMIT 1`)
    .get(created.customerId);
  assert.equal(JSON.parse(audit.detail_json).intakeItemId, returned.intakeItemId);
});

test('bulk return creates intake rows for unassigned manual customers without mixing mismatch records', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const first = await createManualCustomer(fx, 'Issue 324 Bulk Alpha Sensors', '__unassigned__');
  const second = await createManualCustomer(fx, 'Issue 324 Bulk Beta Robotics', '__unassigned__');
  const response = await fx.request('/api/sales-crm/accounts/bulk-return', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { customerIds: [first.customerId, second.customerId], reason: '批量退回线索池' },
  });
  assert.equal(response.status, 200);

  const rows = fx.db.prepare(`SELECT external_customer_id,crm_customer_id,status,assigned_owner_id
    FROM crm_intake_items WHERE crm_customer_id IN (?,?) ORDER BY crm_customer_id`)
    .all(first.customerId, second.customerId);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.status === 'returned' && row.assigned_owner_id === ''));
  assert.equal(
    fx.db.prepare(`SELECT COUNT(*) count FROM crm_accounts
      WHERE id IN (?,?) AND lifecycle_status='recycled' AND recycle_kind='mismatch'`)
      .get(first.customerId, second.customerId).count,
    0,
  );
});

test('startup repair backfills historical returned manual customers exactly once', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const created = await createManualCustomer(fx, 'Issue 324 Historical Returned', 'U-OTHER');
  fx.db.prepare(`UPDATE crm_accounts SET owner_id=NULL,previous_owner_id='U-OTHER',
    assignment_status='returned',return_reason='历史退回原因',intake_item_id=''
    WHERE id=?`).run(created.customerId);

  installSalesCrm();
  installSalesCrm();

  const intake = fx.db.prepare(`SELECT id,status,crm_customer_id,previous_owner_id,return_reason
    FROM crm_intake_items WHERE crm_customer_id=?`).all(created.customerId);
  assert.equal(intake.length, 1);
  assert.equal(intake[0].status, 'returned');
  assert.equal(intake[0].previous_owner_id, 'U-OTHER');
  assert.equal(intake[0].return_reason, '历史退回原因');
  assert.equal(
    fx.db.prepare('SELECT intake_item_id FROM crm_accounts WHERE id=?').get(created.customerId)
      .intake_item_id,
    intake[0].id,
  );
  assert.equal(
    fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
      WHERE action='customer_return_intake_backfilled' AND entity_id=?`).get(created.customerId).count,
    1,
  );
});
