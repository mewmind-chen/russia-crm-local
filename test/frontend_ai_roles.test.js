'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { createAIJobStore } = require('../lib/ai_stations/jobs');

function enqueue(db, id, customerId, crmAccountId, actorId) {
  createAIJobStore(db, { idFactory: () => id }).enqueue({
    trigger: { source: 'api', actorId, reason: 'role_boundary_test' },
    customerId,
    crmAccountId,
    station: 'customer_fit',
    contextHash: 'f'.repeat(64),
    createdBy: actorId,
  }, `role-boundary:${id}`);
}

test('sales is denied task audit while manager review remains row scoped and admin is global', async t => {
  const fx = await fixtures.adminFixture({
    managerViewAll: false,
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  t.after(() => fx.close());
  enqueue(fx.db, 'AIJ-ROLE-MANAGER', 'RU-9002', 'CRM-OWN', 'U-MGR');
  enqueue(fx.db, 'AIJ-ROLE-SALES', 'RU-9003', 'CRM-OTHER', 'U-OTHER');

  const salesList = await fx.request('/api/sales-crm/ai/tasks', { cookie: fx.otherCookie });
  const salesDetail = await fx.request('/api/sales-crm/ai/tasks/AIJ-ROLE-SALES', {
    cookie: fx.otherCookie,
  });
  assert.equal(salesList.status, 403);
  assert.equal(salesDetail.status, 403);

  const manager = await (await fx.request('/api/sales-crm/ai/tasks?type=customer_fit', {
    cookie: fx.cookie,
  })).json();
  assert.deepEqual(manager.items.map(item => item.taskId), ['AIJ-ROLE-MANAGER']);

  const admin = await (await fx.request('/api/sales-crm/ai/tasks?type=customer_fit', {
    cookie: fx.adminCookie,
  })).json();
  assert.deepEqual(new Set(admin.items.map(item => item.taskId)), new Set([
    'AIJ-ROLE-MANAGER', 'AIJ-ROLE-SALES',
  ]));

  fx.setUserPermissions('U-MGR', { review_ai_tasks: false });
  assert.equal((await fx.request('/api/sales-crm/ai/tasks', { cookie: fx.cookie })).status, 403);
});

test('manager cannot access governance, flags, budgets, or assistant runtime', async t => {
  const fx = await fixtures.adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  t.after(() => fx.close());
  for (const route of [
    '/api/sales-crm/ai/governance',
    '/api/sales-crm/ai/features',
    '/api/sales-crm/ai/budgets',
    '/api/assistant/runtime',
  ]) {
    assert.equal((await fx.request(route, { cookie: fx.cookie })).status, 403, route);
    assert.equal((await fx.request(route, { cookie: fx.adminCookie })).status, 200, route);
  }

  fx.setUserPermissions('U-MGR', {
    manage_users: true,
    view_users: true,
    manage_ai_budgets: true,
    manage_ai_governance: true,
  });
  for (const route of [
    '/api/sales-crm/ai/governance',
    '/api/sales-crm/ai/features',
    '/api/sales-crm/ai/budgets',
    '/api/assistant/runtime',
  ]) {
    assert.equal((await fx.request(route, { cookie: fx.cookie })).status, 403, route);
  }
});

test('identity inspection blocks administrator governance writes before mutation', async t => {
  const fx = await fixtures.adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  t.after(() => fx.close());
  fx.setUserPermissions('U-MGR', { manage_users: true, view_users: true });
  await fx.startImpersonation('U-MGR');
  const strategyCount = () => {
    const exists = fx.db.prepare(`SELECT COUNT(*) count FROM sqlite_master
      WHERE type='table' AND name='crm_ai_strategy_versions'`).get().count;
    return exists
      ? fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_strategy_versions').get().count
      : 0;
  };
  const before = strategyCount();
  const response = await fx.request('/api/sales-crm/ai/governance/strategies', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      strategyKey: 'blocked-inspection',
      version: 'v1',
      station: 'customer_fit',
      model: 'qwen',
      promptVersion: 'v1',
      ruleVersion: 'v1',
      config: {},
    },
  });
  assert.equal(response.status, 403);
  const denied = await response.json();
  assert.match(denied.error, /权限|身份/);
  assert.equal(strategyCount(), before);
});
