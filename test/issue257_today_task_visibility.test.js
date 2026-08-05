'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seededFixture } = require('./helpers/permission_fixture');

async function listAlerts(fx, cookie) {
  const response = await fx.request('/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D', {
    cookie,
  });
  return response.json();
}

async function requestJson(fx, route, options) {
  const response = await fx.request(route, options);
  return response.json();
}

test('manager-only assistance reasons are absent from sales bootstrap and list responses', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET manager_required=1,manager_status='待介入',
    next_action='',next_action_at='',last_activity_at='2026-07-20 00:00:00'
    WHERE id='CRM-OTHER'`).run();
  const salesCookie = await fx.login('other@example.com', 'Password123!');

  const salesBootstrap = await requestJson(fx, '/api/sales-crm/bootstrap', { cookie: salesCookie });
  const salesCustomer = salesBootstrap.alerts.find(row => row.customerId === 'CRM-OTHER');
  assert.ok(salesCustomer);
  assert.equal(salesCustomer.reasons.some(reason => reason.code === 'MANAGER_NEEDED'), false);
  assert.equal(salesCustomer.reasonCount, salesCustomer.reasons.length);

  const salesList = await listAlerts(fx, salesCookie);
  const listedCustomer = salesList.rows.find(row => row.customerId === 'CRM-OTHER');
  assert.ok(listedCustomer);
  assert.equal(listedCustomer.reasons.some(reason => reason.code === 'MANAGER_NEEDED'), false);
  assert.equal(salesList.rows.some(row => row.code === 'MANAGER_NEEDED'), false);
});

test('manager sees assistance reason and sales sees only the remaining customer reasons', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET manager_required=1,manager_status='待介入',
    next_action='',next_action_at='',last_activity_at='2026-07-20 00:00:00'
    WHERE id='CRM-OTHER'`).run();
  const salesCookie = await fx.login('other@example.com', 'Password123!');

  const managerBootstrap = await requestJson(fx, '/api/sales-crm/bootstrap', { cookie: fx.cookie });
  const managerCustomer = managerBootstrap.alerts.find(row => row.customerId === 'CRM-OTHER');
  assert.ok(managerCustomer);
  assert.equal(managerCustomer.reasons.some(reason => reason.code === 'MANAGER_NEEDED'), true);

  const managerList = await listAlerts(fx, fx.cookie);
  assert.equal(managerList.rows.some(row => row.customerId === 'CRM-OTHER'
    && row.reasons.some(reason => reason.code === 'MANAGER_NEEDED')), true);

  const salesBootstrap = await requestJson(fx, '/api/sales-crm/bootstrap', { cookie: salesCookie });
  const salesCustomer = salesBootstrap.alerts.find(row => row.customerId === 'CRM-OTHER');
  assert.ok(salesCustomer);
  assert.equal(salesCustomer.reasonCount, salesCustomer.reasons.length);
  assert.equal(salesCustomer.reasons.some(reason => reason.code === 'MANAGER_NEEDED'), false);
  assert.notEqual(salesCustomer.urgency, undefined);
});
