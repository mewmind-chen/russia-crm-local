'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { upsertManagerTask } = require('../lib/manager_tasks');

const TEAM_ROUTE = '/api/sales-crm/team-status';

async function json(response) {
  const body = await response.json();
  return { response, body };
}

function count(db, table, where = '1=1') {
  return db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${where}`).get().count;
}

test('sales action and plan persist once, refresh consistently, and remain owner scoped', async t => {
  const previous = process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
  process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = 'true';
  const fx = await fixtures.adminFixture();
  t.after(async () => {
    await fx.close();
    if (previous === undefined) delete process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
    else process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = previous;
  });
  fx.db.prepare(`UPDATE crm_accounts SET stage='qualified',next_action='',next_action_at='',
    last_activity_at='' WHERE id='CRM-OTHER'`).run();
  const beforeActivities = count(fx.db, 'crm_activities', "customer_id='CRM-OTHER'");
  const payload = {
    customerId: 'CRM-OTHER', activityType: 'call', channel: 'call',
    summary: '已确认采购型号和预计数量', outcome: '已完成',
    reactionOptionId: 'REACTION-COMPLETED',
    nextAction: '发送正式报价', nextActionAt: '2099-08-05 09:00:00',
    idempotencyKey: 'issue173-sales-action-1',
  };
  const saved = await json(await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie, method: 'POST', body: payload,
  }));
  assert.equal(saved.response.status, 200, saved.body.error);
  assert.equal(count(fx.db, 'crm_activities', "customer_id='CRM-OTHER'"), beforeActivities + 1);
  assert.deepEqual(fx.db.prepare(`SELECT stage,next_action,next_action_at,last_activity_at
    FROM crm_accounts WHERE id='CRM-OTHER'`).get(), {
    stage: 'contacted', next_action: payload.nextAction,
    next_action_at: '2099-08-05 01:00:00',
    last_activity_at: fx.db.prepare(`SELECT occurred_at FROM crm_activities
      WHERE customer_id='CRM-OTHER' ORDER BY occurred_at DESC,id DESC LIMIT 1`).get().occurred_at,
  });

  const replay = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie, method: 'POST', body: payload,
  });
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal(count(fx.db, 'crm_activities', "customer_id='CRM-OTHER'"), beforeActivities + 1);

  const forbidden = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie, method: 'POST',
    body: { ...payload, customerId: 'CRM-OWN', idempotencyKey: 'issue173-forbidden-action' },
  });
  assert.equal(forbidden.status, 403);
  const refreshed = (await fx.request('/api/sales-crm/bootstrap', { cookie: fx.otherCookie })).json();
  const bootstrap = await refreshed;
  const account = bootstrap.accounts.find(row => row.id === 'CRM-OTHER');
  assert.equal(account.stage, 'contacted');
  assert.equal(account.next_action, payload.nextAction);
  assert.equal(bootstrap.accounts.some(row => row.id === 'CRM-OWN'), false);
});

test('manager resolves one reason without erasing another and replay stays idempotent', async t => {
  const previous = process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
  process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = 'true';
  const fx = await fixtures.adminFixture();
  t.after(async () => {
    await fx.close();
    if (previous === undefined) delete process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
    else process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = previous;
  });
  const now = '2026-08-01 04:00:00';
  const first = upsertManagerTask(fx.db, {
    customerId: 'RU-9003', reason: 'consecutive_deferred', triggeredAt: now,
    dueAt: '2026-08-03 04:00:00', ownerIdSnapshot: 'U-OTHER', actorIdSnapshot: 'U-OTHER',
    recipientIds: ['U-MGR'], evidence: { deferredCount: 3 }, now,
  });
  const second = upsertManagerTask(fx.db, {
    customerId: 'RU-9003', reason: 'planned_action_overdue', triggeredAt: now,
    dueAt: '2026-08-03 04:00:00', ownerIdSnapshot: 'U-OTHER', actorIdSnapshot: 'U-OTHER',
    recipientIds: ['U-MGR'], evidence: { overdueHours: 72 }, now,
  });
  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  const request = {
    type: 'manager_advice', note: '已与销售复盘并形成下一步',
    nextAction: '联系客户确认交期', nextActionAt: '2099-08-06 10:00:00',
    idempotencyKey: 'issue173-manager-resolve-1',
  };
  const resolved = await json(await fx.request(`/api/sales-crm/manager-tasks/${first.id}/resolve`, {
    cookie: managerCookie, method: 'POST', body: request,
  }));
  assert.equal(resolved.response.status, 200, resolved.body.error);
  assert.equal(fx.db.prepare('SELECT status FROM crm_manager_tasks WHERE id=?').get(first.id).status, 'completed');
  assert.equal(fx.db.prepare('SELECT status FROM crm_manager_tasks WHERE id=?').get(second.id).status, 'open');
  assert.equal(count(fx.db, 'crm_manager_interventions', `task_id='${first.id}'`), 1);

  const replay = await json(await fx.request(`/api/sales-crm/manager-tasks/${first.id}/resolve`, {
    cookie: managerCookie, method: 'POST', body: request,
  }));
  assert.equal(replay.response.status, 200, replay.body.error);
  assert.equal(replay.body.deduplicated, true);
  assert.equal(count(fx.db, 'crm_manager_interventions', `task_id='${first.id}'`), 1);
  const activeFilters = encodeURIComponent(JSON.stringify([
    { key: 'task_status', operator: 'in', values: ['open', 'overdue', 'escalated'] },
  ]));
  const list = await json(await fx.request(
    `/api/sales-crm/manager-tasks?filters=${activeFilters}`,
    { cookie: managerCookie },
  ));
  assert.equal(list.response.status, 200, list.body.error);
  assert.equal(list.body.rows.some(row => row.id === first.id), false);
  assert.equal(list.body.rows.some(row => row.id === second.id), true);
});

test('owner sees all company ranges while sales is confined to personal collaboration', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  for (const range of ['7d', '30d']) {
    const result = await json(await fx.request(`${TEAM_ROUTE}?range=${range}`, {
      cookie: fx.adminCookie,
    }));
    assert.equal(result.response.status, 200, result.body.error);
    assert.equal(result.body.range, range);
    assert.ok(result.body.progress.counts);
    assert.ok(result.body.progress.drilldown);
  }
  const since = await json(await fx.request(`${TEAM_ROUTE}/since-last-view`, {
    cookie: fx.adminCookie, method: 'POST', body: {},
  }));
  assert.equal(since.response.status, 200, since.body.error);
  assert.equal(since.body.fromExclusive < since.body.toInclusive, true);

  const exportResponse = await fx.request(`${TEAM_ROUTE}/export?section=progress&range=30d&format=json`, {
    cookie: fx.adminCookie,
  });
  assert.equal(exportResponse.status, 200, await exportResponse.clone().text());
  assert.ok(Array.isArray(await exportResponse.json()));

  const salesTeam = await fx.request(TEAM_ROUTE, { cookie: fx.otherCookie });
  assert.equal(salesTeam.status, 403);
  const salesCollaboration = await json(await fx.request(
    '/api/sales-crm/collaboration-support', { cookie: fx.otherCookie },
  ));
  assert.equal(salesCollaboration.response.status, 200, salesCollaboration.body.error);
  assert.ok(salesCollaboration.body.rows.every(row => row.salesUserId === 'U-OTHER'));
  assert.equal(JSON.stringify(salesCollaboration.body).includes('RU-9002'), false);
  for (const sensitive of ['assignmentReason', 'candidateSales', 'exclusionReason', 'quota']) {
    assert.equal(JSON.stringify(salesCollaboration.body).includes(sensitive), false);
  }
});
