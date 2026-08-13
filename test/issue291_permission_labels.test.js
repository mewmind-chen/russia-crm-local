'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

test('bootstrap exposes menu-aligned permission labels and notification permission', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const body = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const definitions = body.permissionDefinitions;
  assert.equal(definitions.view_notifications, '通知中心');
  assert.equal(definitions.view_intake, '线索池');
  assert.equal(definitions.view_contacts, '客户联系人线索');
  assert.equal(definitions.view_recon, 'Recon 情报');
  assert.equal(definitions.view_customers, 'CRM客户全景');
  assert.equal(definitions.view_own_mismatch_history, '不对口记录');
  assert.equal(definitions.resolve_manager_tasks, '主管介入任务');
  assert.equal(definitions.manage_protected_customers, '客户保护与查重');
  for (const key of ['view_dashboard', 'view_alerts', 'view_customers', 'resolve_manager_tasks']) {
    assert.ok(definitions[key]);
  }
  for (const role of ['admin', 'manager', 'sales']) {
    assert.equal(body.rolePermissions[role].view_notifications, true);
  }
});

test('existing permission groups gain view_notifications without touching other values', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const group = fx.db.prepare('SELECT permissions_json FROM permission_groups LIMIT 1').get();
  const permissions = JSON.parse(group.permissions_json);
  assert.equal(permissions.view_notifications, true);
});

test('notification gate is enforced server-side', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-WU', { view_notifications: false });
  const salesCookie = await fx.login('wu@example.com', 'Password123!');
  const body = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: salesCookie });
  assert.deepEqual(body.notifications, []);
  assert.equal(body.navigationCounts.notificationsUnread, 0);
});
