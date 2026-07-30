'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

const NOW = '2026-07-28 12:23:00';

function recycleAccount(fx, accountId, {
  kind = 'sales_return',
  previousOwnerId = 'U-WU',
  recycledBy = 'USR-ADMIN',
  reason = '客户暂不符合当前开发条件',
} = {}) {
  fx.db.prepare(`UPDATE crm_accounts SET
    lifecycle_status='recycled',recycle_kind=?,recycle_reason=?,recycled_by=?,
    recycled_at=?,previous_owner_id=?,owner_id=NULL,assignment_status='returned',
    updated_at=? WHERE id=?`).run(
    kind, reason, recycledBy, NOW, previousOwnerId, NOW, accountId,
  );
}

function seedHistory(fx) {
  fx.db.prepare(`INSERT INTO crm_account_contacts
    (id,customer_id,name,title,department,phone,email,social,created_by,created_at,updated_at)
    VALUES ('CONTACT-137','CRM-WU','Ivan Buyer','Buyer','Procurement',
      '+7-issue137','issue137@example.test','Telegram','U-WU',?,?)`).run(NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,occurred_at,created_at)
    VALUES ('ACT-137','CRM-WU','U-WU','call','phone','connected',
      'Issue 137 follow-up history',?,?)`).run(NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,reference,status,bom_lines,expected_value,product_category,
      completeness,received_at,created_at)
    VALUES ('RFQ-137','CRM-WU','U-WU','ISSUE-137-RFQ','open',2,1000,'MCU',80,?,?)`)
    .run(NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_quotes
    (id,rfq_id,customer_id,user_id,amount,currency,gross_margin,status,sent_at,created_at)
    VALUES ('QUOTE-137','RFQ-137','CRM-WU','U-WU',900,'USD',10,'sent',?,?)`)
    .run(NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_orders
    (id,customer_id,quote_id,user_id,amount,currency,gross_margin,is_repeat,ordered_at,created_at)
    VALUES ('ORDER-137','CRM-WU','QUOTE-137','U-WU',850,'USD',8,0,?,?)`)
    .run(NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,evaluation_text,author_id,author_name,ai_status,
      created_at,updated_at)
    VALUES ('EVAL-137','CRM-WU','company','Issue 137 manager evaluation',
      'U-MGR','Manager','completed',?,?)`).run(NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at)
    VALUES ('AUD-137','U-WU','issue137_fixture','crm_account','CRM-WU',
      '{"note":"history"}',?)`).run(NOW);
}

function businessSnapshot(fx, accountId) {
  const account = fx.db.prepare(`SELECT lifecycle_status,recycle_kind,recycle_reason,
    recycled_by,recycled_at,previous_owner_id,owner_id,assignment_status,updated_at
    FROM crm_accounts WHERE id=?`).get(accountId);
  const counts = {};
  for (const table of [
    'crm_activities',
    'crm_rfqs',
    'crm_quotes',
    'crm_orders',
    'crm_manager_evaluations',
    'crm_audit_log',
  ]) {
    counts[table] = fx.db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
  }
  return { account, counts };
}

test('recycle profile returns complete read-only history and causes no business writes', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  recycleAccount(fx, 'CRM-WU');
  seedHistory(fx);
  const before = businessSnapshot(fx, 'CRM-WU');

  const response = await fx.request(
    '/api/sales-crm/accounts/CRM-WU/recycle-profile',
    { cookie: fx.adminCookie },
  );
  const body = await response.json();

  assert.equal(response.status, 200, body.error);
  assert.equal(body.ok, true);
  assert.equal(body.account.id, 'CRM-WU');
  assert.equal(body.account.lifecycle_status, 'recycled');
  assert.deepEqual(body.profileAccess, {
    readOnly: true,
    source: 'recycle',
    status: 'recycled',
    inCrm: true,
    crmAccessible: false,
    accountId: 'CRM-WU',
    canEditNickname: true,
  });
  assert.deepEqual(body.recycle, {
    kind: 'sales_return',
    reason: '客户暂不符合当前开发条件',
    previousOwnerId: 'U-WU',
    previousOwnerName: 'Wu',
    recycledBy: 'USR-ADMIN',
    recycledByName: '系统管理员',
    recycledAt: NOW,
  });
  assert.deepEqual(body.actions, ['reassign']);
  assert.equal(body.customerPool[0].customerId, 'RU-9001');
  assert.equal(body.activities.some(row => row.id === 'ACT-137'), true);
  assert.equal(body.rfqs.some(row => row.id === 'RFQ-137'), true);
  assert.equal(body.quotes.some(row => row.id === 'QUOTE-137'), true);
  assert.equal(body.orders.some(row => row.id === 'ORDER-137'), true);
  assert.equal(body.timeline.some(row => row.id === 'activity:ACT-137'), true);
  assert.equal(body.insights.contacts.some(row => row.rawId === 'CONTACT-137'), true);
  assert.equal(body.insights.evaluations.some(row => row.id === 'EVAL-137'), true);
  assert.equal(body.auditLog.some(row => row.id === 'AUD-137'), true);
  assert.deepEqual(businessSnapshot(fx, 'CRM-WU'), before);
});

test('recycle profile enforces module permission, recycle scope and live lifecycle state', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  recycleAccount(fx, 'CRM-WU', { previousOwnerId: 'U-WU', recycledBy: 'U-WU' });
  recycleAccount(fx, 'CRM-OTHER', { previousOwnerId: 'U-OTHER', recycledBy: 'U-OTHER' });

  fx.setUserPermissions('U-WU', {
    manage_customer_recycle: true,
    view_all_customers: false,
  });
  fx.db.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at)
    VALUES ('AUD-137-PRIVATE','U-WU','private_fixture','crm_account','CRM-WU',
      '{"email":"must-not-leak@example.test"}',?)`).run(NOW);
  const managerCookie = await fx.login('wu@example.com', 'Password123!');
  const scopedResponse = await fx.request('/api/sales-crm/accounts/CRM-WU/recycle-profile', {
    cookie: managerCookie,
  });
  assert.equal(scopedResponse.status, 200);
  const scopedBody = await scopedResponse.json();
  assert.equal(scopedBody.auditLog.some(row => row.id === 'AUD-137-PRIVATE'), true);
  assert.equal(JSON.stringify(scopedBody).includes('must-not-leak@example.test'), false);
  assert.equal(
    (await fx.request('/api/sales-crm/accounts/CRM-OTHER/recycle-profile', {
      cookie: managerCookie,
    })).status,
    403,
  );
  const forbiddenReassign = await fx.request('/api/sales-crm/accounts/CRM-OTHER/reassign', {
    cookie: managerCookie,
    method: 'POST',
    body: { ownerId: 'U-WU', reason: 'Issue 137 scope bypass attempt' },
  });
  assert.equal(forbiddenReassign.status, 403);
  assert.equal(
    fx.db.prepare("SELECT lifecycle_status FROM crm_accounts WHERE id='CRM-OTHER'").get().lifecycle_status,
    'recycled',
  );
  assert.equal(
    (await fx.request('/api/sales-crm/accounts/MISSING/recycle-profile', {
      cookie: managerCookie,
    })).status,
    403,
  );

  fx.setUserPermissions('U-WU', { manage_customer_recycle: false });
  assert.equal(
    (await fx.request('/api/sales-crm/accounts/CRM-WU/recycle-profile', {
      cookie: managerCookie,
    })).status,
    403,
  );

  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='active',
    recycle_kind='',recycle_reason='',recycled_by='',recycled_at=''
    WHERE id='CRM-WU'`).run();
  assert.equal(
    (await fx.request('/api/sales-crm/accounts/CRM-WU/recycle-profile', {
      cookie: fx.adminCookie,
    })).status,
    404,
  );
  assert.equal(
    (await fx.request('/api/sales-crm/accounts/MISSING/recycle-profile', {
      cookie: fx.adminCookie,
    })).status,
    404,
  );
  assert.equal(
    (await fx.request('/api/sales-crm/accounts/CRM-OTHER/recycle-profile')).status,
    401,
  );
});

test('manual-delete recycle profile only advertises restore to a real authorized admin', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  recycleAccount(fx, 'CRM-WU', { kind: 'manual_delete' });

  let response = await fx.request('/api/sales-crm/accounts/CRM-WU/recycle-profile', {
    cookie: fx.adminCookie,
  });
  assert.deepEqual((await response.json()).actions, ['restore']);

  await fx.startImpersonation('U-WU');
  fx.setUserPermissions('U-WU', {
    manage_customer_recycle: true,
    view_all_customers: true,
    manage_manual_customer_deletion: true,
  });
  response = await fx.request('/api/sales-crm/accounts/CRM-WU/recycle-profile', {
    cookie: fx.adminCookie,
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).actions, []);
  response = await fx.request('/api/sales-crm/accounts/recycle-bin?kind=manual_delete', {
    cookie: fx.adminCookie,
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rows[0].actions, []);
});

test('recycle managers receive only minimal active sales assignment candidates', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  const response = await fx.request('/api/sales-crm/bootstrap', { cookie: managerCookie });
  const body = await response.json();

  assert.equal(response.status, 200, body.error);
  assert.equal(body.users.length, 1);
  assert.equal(body.users[0].role, 'manager');
  assert.equal(body.assignmentCandidates.length > 0, true);
  assert.equal(body.assignmentCandidates.every(row => (
    typeof row.id === 'string'
      && typeof row.name === 'string'
      && Object.keys(row).sort().join(',') === 'id,name'
  )), true);
});
