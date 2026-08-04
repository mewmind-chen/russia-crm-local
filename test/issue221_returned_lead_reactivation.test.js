'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

const NOW = '2026-08-04 08:00:00';

function seedReturnedLeadHistory(fx) {
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,crm_customer_id,company_name,status,
     assigned_owner_id,duplicate_state,claimed_at,created_at,updated_at)
    VALUES ('INTAKE-221','BATCH-TEST','RU-9003','CRM-OTHER','Issue 221 Lifecycle',
      'claimed','U-OTHER','cleared',?,?,?)`).run(NOW, NOW, NOW);
  fx.db.prepare(`UPDATE crm_accounts SET company_name='Issue 221 Lifecycle',stage='contacted',
    intake_item_id='INTAKE-221',assignment_status='claimed',claimed_at=?,updated_at=?
    WHERE id='CRM-OTHER'`).run(NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,occurred_at,created_at)
    VALUES ('ACT-221','CRM-OTHER','U-OTHER','call','phone','connected',
      'Issue 221 retained activity',?,?)`).run(NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,reference,status,bom_lines,expected_value,product_category,
     completeness,received_at,created_at)
    VALUES ('RFQ-221','CRM-OTHER','U-OTHER','ISSUE-221-RFQ','open',2,1000,'MCU',80,?,?)`)
    .run(NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_quotes
    (id,rfq_id,customer_id,user_id,amount,currency,gross_margin,status,sent_at,created_at)
    VALUES ('QUOTE-221','RFQ-221','CRM-OTHER','U-OTHER',900,'USD',10,'sent',?,?)`)
    .run(NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_orders
    (id,customer_id,quote_id,user_id,amount,currency,gross_margin,is_repeat,ordered_at,created_at)
    VALUES ('ORDER-221','CRM-OTHER','QUOTE-221','U-OTHER',850,'USD',8,0,?,?)`)
    .run(NOW, NOW);
}

function seedSecondSales(fx) {
  fx.db.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,
     languages_json,countries_json,channels_json,permission_group_id,created_at,updated_at)
    SELECT 'U-SALES2','sales2@example.com','Sales Two','sales',password_hash,password_salt,1,0,
      '[]','[]','[]',permission_group_id,created_at,updated_at
    FROM sales_users WHERE id='U-OTHER'`).run();
}

function historyCounts(fx, accountId) {
  return Object.fromEntries(['activities', 'rfqs', 'quotes', 'orders'].map(name => [
    name,
    fx.db.prepare(`SELECT COUNT(*) count FROM crm_${name} WHERE customer_id=?`).get(accountId).count,
  ]));
}

test('Issue 221 return, reassign, and claim reactivates the same account with history intact', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { manage_customer_recycle: true });
  seedSecondSales(fx);
  seedReturnedLeadHistory(fx);
  const salesTwoCookie = await fx.login('sales2@example.com', 'Password123!');

  const before = await fx.requestJson('/api/sales-crm/intake?pageSize=50', {
    cookie: fx.adminCookie,
  });
  assert.equal(before.stats.contacted, 1);

  const returned = await fx.request('/api/sales-crm/accounts/CRM-OTHER/return', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { reason: '暂不匹配，退回线索池重新评估' },
  });
  assert.equal(returned.status, 200, await returned.clone().text());

  const returnedPool = await fx.requestJson('/api/sales-crm/intake?pageSize=50', {
    cookie: fx.adminCookie,
  });
  assert.equal(returnedPool.stats.contacted, 0);
  const returnedItem = returnedPool.items.find(item => item.id === 'INTAKE-221');
  assert.equal(returnedItem.status, 'returned');
  assert.deepEqual(returnedItem.developmentHistory, {
    accountId: 'CRM-OTHER',
    companyName: 'Issue 221 Lifecycle',
    stage: 'contacted',
    recycled: false,
    previousOwnerId: 'U-OTHER',
    activityCount: 1,
    rfqCount: 1,
    quoteCount: 1,
    orderCount: 1,
    lastActivityAt: NOW,
    lastActivityType: 'call',
    lastActivitySummary: 'Issue 221 retained activity',
  });

  const assigned = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'assign', itemId: 'INTAKE-221', ownerId: 'U-SALES2' },
  });
  assert.equal(assigned.status, 200, await assigned.clone().text());
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,assigned_owner_id
      FROM crm_intake_items WHERE id='INTAKE-221'`).get(),
    { status: 'assigned', crm_customer_id: 'CRM-OTHER', assigned_owner_id: 'U-SALES2' },
  );

  const claimed = await fx.request('/api/sales-crm/intake/action', {
    cookie: salesTwoCookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-221', idempotencyKey: 'issue221-claim' },
  });
  assert.equal(claimed.status, 200, await claimed.clone().text());
  assert.equal((await claimed.json()).customerId, 'CRM-OTHER');
  assert.deepEqual(
    fx.db.prepare(`SELECT lifecycle_status,recycle_kind,recycle_reason,recycled_by,recycled_at,
      previous_owner_id,owner_id,assignment_status,intake_item_id
      FROM crm_accounts WHERE id='CRM-OTHER'`).get(),
    {
      lifecycle_status: 'active',
      recycle_kind: '',
      recycle_reason: '',
      recycled_by: '',
      recycled_at: '',
      previous_owner_id: '',
      owner_id: 'U-SALES2',
      assignment_status: 'claimed',
      intake_item_id: 'INTAKE-221',
    },
  );
  assert.deepEqual(historyCounts(fx, 'CRM-OTHER'), {
    activities: 1, rfqs: 1, quotes: 1, orders: 1,
  });

  const salesBootstrap = await fx.requestJson('/api/sales-crm/bootstrap', {
    cookie: salesTwoCookie,
  });
  assert.equal(salesBootstrap.accounts.some(account => account.id === 'CRM-OTHER'), true);
});

test('Issue 221 claim never restores a manually deleted account', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='manual_delete',
    recycle_reason='管理员手工删除',owner_id=NULL,intake_item_id='INTAKE-OTHER',
    assignment_status='returned',updated_at=? WHERE id='CRM-WU'`).run(NOW);
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-9001',crm_customer_id='CRM-WU',
    company_name='Wu Fixture',status='assigned',assigned_owner_id='U-OTHER',
    duplicate_state='cleared',updated_at=? WHERE id='INTAKE-OTHER'`).run(NOW);

  const claimed = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-OTHER', idempotencyKey: 'issue221-manual-delete' },
  });
  assert.equal(claimed.status, 409, await claimed.clone().text());
  assert.equal((await claimed.json()).code, 'INTAKE_ACCOUNT_RESTORE_FORBIDDEN');
  assert.deepEqual(
    fx.db.prepare(`SELECT lifecycle_status,recycle_kind,owner_id,assignment_status
      FROM crm_accounts WHERE id='CRM-WU'`).get(),
    {
      lifecycle_status: 'recycled',
      recycle_kind: 'manual_delete',
      owner_id: null,
      assignment_status: 'returned',
    },
  );
});

test('Issue 221 intake return and reject cannot bypass the formal CRM recycle workflow', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { manage_customer_recycle: true });
  seedReturnedLeadHistory(fx);
  fx.db.prepare(`UPDATE crm_intake_items SET status='assigned',assigned_owner_id='U-OTHER',
    claimed_at='' WHERE id='INTAKE-221'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET assignment_status='assigned' WHERE id='CRM-OTHER'`).run();

  for (const [action, idempotencyKey] of [['return', 'issue221-return-guard'], ['reject', 'issue221-reject-guard']]) {
    const response = await fx.request('/api/sales-crm/intake/action', {
      cookie: fx.otherCookie,
      method: 'POST',
      body: { action, itemId: 'INTAKE-221', reason: '状态应由 CRM 正式流程处理', idempotencyKey },
    });
    assert.equal(response.status, 409, await response.clone().text());
    assert.equal((await response.json()).code, 'INTAKE_CLAIMED_REQUIRES_CRM_RETURN');
  }
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id FROM crm_intake_items WHERE id='INTAKE-221'`).get(),
    { status: 'assigned', crm_customer_id: 'CRM-OTHER' },
  );
  assert.deepEqual(
    fx.db.prepare(`SELECT lifecycle_status,assignment_status FROM crm_accounts WHERE id='CRM-OTHER'`).get(),
    { lifecycle_status: 'active', assignment_status: 'assigned' },
  );
});
