'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const accessControl = fs.readFileSync(path.join(root, 'lib', 'access_control.js'), 'utf8');

test('Issue 209 lets an authorized admin return an active ownerless CRM customer', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  fx.db.prepare(`UPDATE crm_accounts SET owner_id=NULL,assignment_status='unassigned',
    lifecycle_status='active',nickname='共享昵称',created_by='U-WU' WHERE id='CRM-OWN'`).run();
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,summary,occurred_at,created_at)
    VALUES ('ACT-209','CRM-OWN','U-MGR','email','历史跟进保留',?,?)`)
    .run('2026-08-03 09:00:00', '2026-08-03 09:00:00');

  const response = await fx.request('/api/sales-crm/accounts/CRM-OWN/return', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '管理员将未分配 CRM 客户退回线索池' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    fx.db.prepare(`SELECT external_customer_id,nickname,created_by,owner_id,previous_owner_id,
      lifecycle_status,recycle_kind,assignment_status FROM crm_accounts WHERE id='CRM-OWN'`).get(),
    {
      external_customer_id: 'RU-9002',
      nickname: '共享昵称',
      created_by: 'U-WU',
      owner_id: null,
      previous_owner_id: '',
      lifecycle_status: 'recycled',
      recycle_kind: 'sales_return',
      assignment_status: 'returned',
    },
  );
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_activities WHERE id='ACT-209'").get().count, 1);
  const audit = fx.db.prepare(`SELECT action,detail_json FROM crm_audit_log
    WHERE entity_id='CRM-OWN' AND action='customer_returned'`).get();
  assert.equal(Boolean(audit), true);
  assert.equal(JSON.parse(audit.detail_json).previousOwnerId, '');
});

test('Issue 209 bulk return applies the same rule to owned and ownerless customers', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  fx.db.prepare(`UPDATE crm_accounts SET owner_id=NULL,assignment_status='unassigned',
    lifecycle_status='active' WHERE id='CRM-OWN'`).run();
  const response = await fx.request('/api/sales-crm/accounts/bulk-return', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { customerIds: ['CRM-WU', 'CRM-OWN'], reason: '统一执行 CRM 生命周期退回' },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).updated, 2);
  assert.deepEqual(
    fx.db.prepare(`SELECT id,owner_id,previous_owner_id,lifecycle_status,assignment_status
      FROM crm_accounts WHERE id IN ('CRM-WU','CRM-OWN') ORDER BY id`).all(),
    [
      { id: 'CRM-OWN', owner_id: null, previous_owner_id: '', lifecycle_status: 'recycled', assignment_status: 'returned' },
      { id: 'CRM-WU', owner_id: null, previous_owner_id: 'U-WU', lifecycle_status: 'recycled', assignment_status: 'returned' },
    ],
  );
});

test('Issue 209 requires recycle permission for both single and bulk return APIs', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const single = await fx.request('/api/sales-crm/accounts/CRM-OTHER/return', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { reason: '无权限销售不应成功' },
  });
  assert.equal(single.status, 403);
  const bulk = await fx.request('/api/sales-crm/accounts/bulk-return', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { customerIds: ['CRM-OTHER'], reason: '无权限销售不应成功' },
  });
  assert.equal(bulk.status, 403);
  assert.match(
    accessControl,
    /'POST \/accounts\/:customerId\/return': \{ permissions: \['manage_customer_recycle'\] \}/,
  );
});

test('Issue 209 applies the same owner-independent rule to an explicitly authorized sales user', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  fx.setUserPermissions('U-OTHER', {
    manage_customer_recycle: true,
    view_all_customers: true,
  });
  fx.db.prepare(`UPDATE crm_accounts SET owner_id=NULL,assignment_status='unassigned',
    lifecycle_status='active' WHERE id IN ('CRM-WU','CRM-OWN')`).run();
  const single = await fx.request('/api/sales-crm/accounts/CRM-OWN/return', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { reason: '显式授权销售执行单条退回' },
  });
  assert.equal(single.status, 200);
  const bulk = await fx.request('/api/sales-crm/accounts/bulk-return', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { customerIds: ['CRM-WU'], reason: '显式授权销售执行批量退回' },
  });
  assert.equal(bulk.status, 200);
  assert.deepEqual(
    fx.db.prepare(`SELECT id,lifecycle_status,assignment_status FROM crm_accounts
      WHERE id IN ('CRM-WU','CRM-OWN') ORDER BY id`).all(),
    [
      { id: 'CRM-OWN', lifecycle_status: 'recycled', assignment_status: 'returned' },
      { id: 'CRM-WU', lifecycle_status: 'recycled', assignment_status: 'returned' },
    ],
  );
});

test('Issue 209 frontend uses lifecycle and permission instead of owner presence', () => {
  const eligibility = appJs.match(/function canReturnCustomer\(account\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(eligibility, /lifecycle_status/);
  assert.match(eligibility, /assignment_status/);
  assert.match(eligibility, /can\('manage_customer_recycle'\)/);
  assert.doesNotMatch(eligibility, /!account\.owner_id/);
  assert.doesNotMatch(eligibility, /account\.owner_id === state\.data\.user\.id/);
  assert.doesNotMatch(appJs, /负责人明确且状态为已分配或已领取的客户可退回/);
  assert.doesNotMatch(appJs, /包含未分配、已退回或状态不允许退回的客户/);
  assert.match(appJs, /account\.owner_name \|\| '未分配'/);
});
