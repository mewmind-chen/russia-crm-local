'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');

const ROOT = path.resolve(__dirname, '..');

test('bootstrap groups only the authorized customer and assigned lead scope', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_alerts: true, manage_intake: false, record_activity: true },
  });
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET priority='A',manager_required=1,manager_status='待介入',
    next_action='',next_action_at='',last_activity_at='2026-07-20 00:00:00' WHERE id='CRM-OWN'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET manager_required=1,next_action='',next_action_at=''
    WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,claim_due_at,created_at,updated_at)
    VALUES ('INTAKE-OWN','BATCH-TEST','RU-OWN-LEAD','Owned Lead','assigned','U-MGR',
      '2026-07-20 00:00:00','2026-07-20 00:00:00','2026-07-20 00:00:00')`).run();
  fx.db.prepare(`UPDATE crm_intake_items SET claim_due_at='2026-07-20 00:00:00'
    WHERE id='INTAKE-OTHER'`).run();

  const response = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  const customerTasks = body.alerts.filter(item => item.customerId);
  assert.equal(customerTasks.length, 1);
  assert.equal(customerTasks[0].customerId, 'CRM-OWN');
  assert.ok(customerTasks[0].reasonCount >= 2);
  assert.equal(customerTasks[0].reasons.some(reason => reason.code === 'MANAGER_NEEDED'), true);
  assert.deepEqual(body.alerts.filter(item => item.intakeItemId).map(item => item.intakeItemId), ['INTAKE-OWN']);
  assert.equal((await fx.request('/api/sales-crm/profile/CRM-OTHER', { cookie: fx.cookie })).status, 403);
});

test('a saved business action immediately removes the resolved task on the next bootstrap', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_alerts: true, record_activity: true, use_ai_assistant: false },
  });
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET next_action='',next_action_at='',
    last_activity_at='2026-07-27 11:00:00',manager_required=0 WHERE id='CRM-OWN'`).run();
  let body = await (await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie })).json();
  assert.equal(body.alerts.some(item => item.customerId === 'CRM-OWN'
    && item.reasons.some(reason => reason.code === 'NO_NEXT')), true);

  const saved = await fx.request('/api/sales-crm/activities', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN',
      activityType: 'note',
      summary: '已确认下一次真实跟进',
      nextAction: '发送样品清单',
      nextActionAt: '2099-07-28 09:00:00',
      occurredAt: '2026-07-27 12:00:00',
    },
  });
  assert.equal(saved.status, 200);
  body = await (await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie })).json();
  assert.equal(body.alerts.some(item => item.customerId === 'CRM-OWN'), false);
});

test('default sales permission exposes only owned customer and assigned lead tasks', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET manager_required=1,next_action='',next_action_at=''
    WHERE id IN ('CRM-OWN','CRM-OTHER')`).run();
  fx.db.prepare(`UPDATE crm_intake_items SET claim_due_at='2026-07-20 00:00:00'
    WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,claim_due_at,created_at,updated_at)
    VALUES ('INTAKE-MANAGER','BATCH-TEST','RU-MANAGER-LEAD','Manager Lead','assigned','U-MGR',
      '2026-07-20 00:00:00','2026-07-20 00:00:00','2026-07-20 00:00:00')`).run();
  const cookie = await fx.login('other@example.com', 'Password123!');

  const body = await (await fx.request('/api/sales-crm/bootstrap', { cookie })).json();
  assert.equal(body.user.permissions.view_alerts, true);
  assert.equal(body.accounts.every(item => item.owner_id === 'U-OTHER'), true);
  assert.equal(body.alerts.every(item => !item.customerId || item.customerId === 'CRM-OTHER'), true);
  assert.deepEqual(body.alerts.filter(item => item.intakeItemId).map(item => item.intakeItemId), ['INTAKE-OTHER']);
  assert.equal(body.intake.items.every(item => item.assigned_owner_id === 'U-OTHER'), true);
  assert.equal((await fx.request('/api/sales-crm/profile/CRM-OWN', { cookie })).status, 403);
});

test('explicit sales deny keeps today tasks hidden without changing intake scope', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { view_alerts: false });
  fx.db.prepare(`UPDATE crm_intake_items SET claim_due_at='2026-07-20 00:00:00'
    WHERE id='INTAKE-OTHER'`).run();
  const cookie = await fx.login('other@example.com', 'Password123!');

  const body = await (await fx.request('/api/sales-crm/bootstrap', { cookie })).json();
  assert.equal(body.user.permissions.view_alerts, false);
  assert.deepEqual(body.alerts, []);
  const intake = await fx.request('/api/sales-crm/intake', { cookie });
  assert.equal(intake.status, 200);
  assert.equal((await intake.json()).items.every(item => item.assigned_owner_id === 'U-OTHER'), true);
});

test('administrator today tasks retain the existing all-team scope', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_intake_items SET claim_due_at='2026-07-20 00:00:00'
    WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,claim_due_at,created_at,updated_at)
    VALUES ('INTAKE-MANAGER','BATCH-TEST','RU-MANAGER-LEAD','Manager Lead','assigned','U-MGR',
      '2026-07-20 00:00:00','2026-07-20 00:00:00','2026-07-20 00:00:00')`).run();

  const body = await (await fx.request('/api/sales-crm/bootstrap', { cookie: fx.adminCookie })).json();
  assert.equal(body.user.permissions.view_alerts, true);
  assert.deepEqual(body.alerts.filter(item => item.intakeItemId).map(item => item.intakeItemId).sort(),
    ['INTAKE-MANAGER', 'INTAKE-OTHER']);
});

test('today task UI exposes three levels, one action, reason tags, and cache-busted assets', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');
  assert.match(html, /data-severity="immediate">立即处理/);
  assert.match(html, /data-severity="today">今天完成/);
  assert.match(html, /data-severity="attention">需要关注/);
  assert.match(html, /app\.css\?v=[^"]+/);
  assert.match(html, /app\.js\?v=[^"]+/);
  assert.match(js, /同一对象只显示一行|reasonCount|otherReasons/);
  assert.match(js, /唯一建议动作/);
  assert.match(css, /\.alert-reasons/);
  assert.match(css, /\.data-table\{overflow:auto\}/);
});
