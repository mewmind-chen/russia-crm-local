'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { upsertManagerTask } = require('../lib/manager_tasks');

async function managerFixture(t, options = {}) {
  const previous = process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
  process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = options.writesEnabled === false ? 'false' : 'true';
  const fx = await fixtures.adminFixture();
  t.after(async () => {
    await fx.close();
    if (previous === undefined) delete process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
    else process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = previous;
  });
  return fx;
}

test('deferred-plan API clears the explicit snapshot without fabricating an activity and replays safely', async t => {
  const fx = await managerFixture(t);
  const activityCount = fx.db.prepare('SELECT COUNT(*) count FROM crm_activities').get().count;
  fx.db.prepare(`UPDATE crm_accounts SET next_action='确认BOM',
    next_action_at='2099-08-01 01:00:00',next_action_time_basis='utc'
    WHERE id='CRM-OTHER'`).run();
  const payload = {
    reviewAt: '2099-08-02 09:00:00',
    reason: '等待客户内部确认',
    idempotencyKey: 'issue170-deferred-api-1',
  };

  const first = await fx.request('/api/sales-crm/accounts/CRM-OTHER/deferred-plan', {
    cookie: fx.otherCookie, method: 'POST', body: payload,
  });
  const firstBody = await first.json();
  assert.equal(first.status, 200, firstBody.error);
  assert.equal(firstBody.deduplicated, false);
  assert.deepEqual(fx.db.prepare(`SELECT next_action,next_action_at,next_action_time_basis
    FROM crm_accounts WHERE id='CRM-OTHER'`).get(), {
    next_action: '', next_action_at: '', next_action_time_basis: '',
  });
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_activities').get().count, activityCount);
  assert.deepEqual(fx.db.prepare(`SELECT customer_id,actor_id,owner_id_snapshot,review_at,reason,source_event_id
    FROM crm_deferred_plan_events`).get(), {
    customer_id: 'RU-9003',
    actor_id: 'U-OTHER',
    owner_id_snapshot: 'U-OTHER',
    review_at: '2099-08-02 01:00:00',
    reason: payload.reason,
    source_event_id: payload.idempotencyKey,
  });

  fx.db.prepare(`UPDATE crm_accounts SET next_action='后来形成的计划',
    next_action_at='2099-08-04 01:00:00',next_action_time_basis='utc'
    WHERE id='CRM-OTHER'`).run();

  const replay = await fx.request('/api/sales-crm/accounts/CRM-OTHER/deferred-plan', {
    cookie: fx.otherCookie, method: 'POST', body: payload,
  });
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal((await replay.json()).deduplicated, true);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_deferred_plan_events').get().count, 1);
  assert.deepEqual(fx.db.prepare(`SELECT next_action,next_action_at,next_action_time_basis
    FROM crm_accounts WHERE id='CRM-OTHER'`).get(), {
    next_action: '后来形成的计划',
    next_action_at: '2099-08-04 01:00:00',
    next_action_time_basis: 'utc',
  });
});

test('deferred-plan API enforces row scope, future time, terminal state, and the rollout gate', async t => {
  const fx = await managerFixture(t);
  for (const candidate of [
    { route: '/api/sales-crm/accounts/CRM-OWN/deferred-plan', body: {
      reviewAt: '2099-08-02 09:00:00', idempotencyKey: 'out-of-scope',
    }, expected: 403 },
    { route: '/api/sales-crm/accounts/CRM-OTHER/deferred-plan', body: {
      reviewAt: '2000-01-01 09:00:00', idempotencyKey: 'past-review',
    }, expected: 400 },
  ]) {
    const response = await fx.request(candidate.route, {
      cookie: fx.otherCookie, method: 'POST', body: candidate.body,
    });
    assert.equal(response.status, candidate.expected, await response.text());
  }

  fx.db.prepare("UPDATE crm_accounts SET stage='lost' WHERE id='CRM-OTHER'").run();
  const terminal = await fx.request('/api/sales-crm/accounts/CRM-OTHER/deferred-plan', {
    cookie: fx.otherCookie, method: 'POST',
    body: { reviewAt: '2099-08-02 09:00:00', idempotencyKey: 'terminal-review' },
  });
  assert.equal(terminal.status, 409, await terminal.text());
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_deferred_plan_events').get().count, 0);

  process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = 'false';
  fx.db.prepare("UPDATE crm_accounts SET stage='qualified' WHERE id='CRM-OTHER'").run();
  const disabled = await fx.request('/api/sales-crm/accounts/CRM-OTHER/deferred-plan', {
    cookie: fx.otherCookie, method: 'POST',
    body: { reviewAt: '2099-08-02 09:00:00', idempotencyKey: 'disabled-review' },
  });
  assert.equal(disabled.status, 409, await disabled.text());
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_deferred_plan_events').get().count, 0);
});

test('expired deferred review becomes one actionable reason without deleting other alert reasons', async t => {
  const fx = await managerFixture(t);
  fx.db.prepare(`UPDATE crm_accounts SET next_action='',next_action_at='',next_action_time_basis='',
    last_activity_at='2026-07-01 00:00:00' WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_deferred_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,review_at,reason,source,source_event_id,created_at)
    VALUES ('DPE-EXPIRED','RU-9003','U-OTHER','U-OTHER','2026-07-31 00:00:00',
      '等待客户确认','manual_deferred','expired-review','2026-07-30 00:00:00')`).run();

  const bootstrap = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  const body = await bootstrap.json();
  assert.equal(bootstrap.status, 200, body.error);
  const task = body.alerts.find(item => item.customerId === 'CRM-OTHER');
  assert.ok(task);
  const reasonCodes = task.reasons.map(reason => reason.code);
  assert.ok(reasonCodes.includes('NO_NEXT_DEFERRED'));
  assert.ok(reasonCodes.some(code => code !== 'NO_NEXT_DEFERRED'));
  assert.equal(task.actionKind, 'add_next_plan');
});

test('manager settings API is admin-only and validates concrete privileged recipients', async t => {
  const fx = await managerFixture(t);
  const deniedManager = await fx.request('/api/sales-crm/manager-task-settings', {
    cookie: fx.cookie,
  });
  assert.equal(deniedManager.status, 403, await deniedManager.text());
  const deniedSales = await fx.request('/api/sales-crm/manager-task-settings', {
    cookie: fx.otherCookie,
  });
  assert.equal(deniedSales.status, 403, await deniedSales.text());

  fx.setUserPermissions('U-OTHER', {
    manage_manager_task_settings: true,
    resolve_manager_tasks: true,
  });
  const overrideDenied = await fx.request('/api/sales-crm/manager-task-settings', {
    cookie: fx.otherCookie,
  });
  assert.equal(overrideDenied.status, 403, await overrideDenied.text());
  const salesBootstrap = await fx.request('/api/sales-crm/bootstrap', {
    cookie: fx.otherCookie,
  });
  const salesBootstrapBody = await salesBootstrap.json();
  assert.equal(salesBootstrap.status, 200, salesBootstrapBody.error);
  assert.deepEqual(salesBootstrapBody.managerTasks, []);
  assert.equal(salesBootstrapBody.managerMetrics, null);
  assert.equal(salesBootstrapBody.managerTaskSettings, null);

  const settingsResponse = await fx.request('/api/sales-crm/manager-task-settings', {
    cookie: fx.adminCookie,
  });
  const settingsBody = await settingsResponse.json();
  assert.equal(settingsResponse.status, 200, settingsBody.error);
  assert.equal(settingsBody.settings.version, 1);

  const invalid = await fx.request('/api/sales-crm/manager-task-settings', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { expectedVersion: 1, patch: { recipientIds: ['U-OTHER'] } },
  });
  assert.equal(invalid.status, 400, await invalid.text());

  const updated = await fx.request('/api/sales-crm/manager-task-settings', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: {
      expectedVersion: 1,
      patch: {
        consecutiveDeferred: { enabled: true, value: 3 },
        salesAnomaly: {
          enabled: true,
          minActiveCustomers: 1,
          minAnomalousCustomers: 1,
          ratioPercent: 100,
        },
        recipientIds: ['U-WU'],
      },
    },
  });
  const updatedBody = await updated.json();
  assert.equal(updated.status, 200, updatedBody.error);
  assert.equal(updatedBody.settings.version, 2);
  assert.deepEqual(updatedBody.settings.recipientIds, ['U-WU']);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_manager_task_settings_audit').get().count, 1);

  upsertManagerTask(fx.db, {
    customerId: 'RU-9003',
    reason: 'consecutive_deferred',
    ownerIdSnapshot: 'U-OTHER',
    actorIdSnapshot: 'U-OTHER',
    triggeredAt: new Date(Date.now() - 60000).toISOString(),
  });
  const metrics = await fx.request('/api/sales-crm/manager-metrics', {
    cookie: fx.adminCookie,
  });
  const metricsBody = await metrics.json();
  assert.equal(metrics.status, 200, metricsBody.error);
  const other30 = metricsBody.rows.find(row =>
    row.actorId === 'U-OTHER' && row.rangeDays === 30);
  assert.ok(other30);
  assert.equal(other30.sampleSize, 1);
  assert.equal(other30.counts.thresholdCustomers, 1);
  assert.equal(other30.needsManagerReview, true);
});

test('manager task scan skips stale recipients while settings updates remain strict', async t => {
  const fx = await managerFixture(t);
  const updated = await fx.request('/api/sales-crm/manager-task-settings', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { expectedVersion: 1, patch: { recipientIds: ['U-WU'] } },
  });
  assert.equal(updated.status, 200, await updated.text());

  const insert = fx.db.prepare(`INSERT INTO crm_deferred_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,review_at,reason,source,source_event_id,created_at)
    VALUES (?, ?,?,?,?,'等待客户确认','manual_deferred',?,?)`);
  for (const customerId of ['RU-9001', 'RU-9002', 'RU-9003']) {
    for (let index = 0; index < 3; index += 1) {
      insert.run(
        `DPE-STALE-${customerId}-${index}`,
        customerId,
        customerId === 'RU-9001' ? 'U-WU' : customerId === 'RU-9002' ? 'U-MGR' : 'U-OTHER',
        customerId === 'RU-9001' ? 'U-WU' : customerId === 'RU-9002' ? 'U-MGR' : 'U-OTHER',
        '2099-08-01 01:00:00',
        `stale-${customerId}-${index}`,
        `2026-07-${27 + index} 01:00:00`,
      );
    }
  }

  fx.db.prepare("UPDATE sales_users SET active=0 WHERE id='U-WU'").run();
  const strict = await fx.request('/api/sales-crm/manager-task-settings', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { expectedVersion: 2, patch: { recipientIds: ['U-WU'] } },
  });
  assert.equal(strict.status, 400, await strict.text());
  let scan = await fx.request('/api/sales-crm/manager-tasks', {
    cookie: fx.adminCookie, method: 'POST', body: { customerId: 'RU-9003' },
  });
  assert.equal(scan.status, 200, await scan.text());

  fx.db.prepare("UPDATE sales_users SET active=1 WHERE id='U-WU'").run();
  fx.setUserPermissions('U-WU', { resolve_manager_tasks: false });
  scan = await fx.request('/api/sales-crm/manager-tasks', {
    cookie: fx.adminCookie, method: 'POST', body: { customerId: 'RU-9001' },
  });
  assert.equal(scan.status, 200, await scan.text());

  fx.setUserPermissions('U-WU', {
    resolve_manager_tasks: true,
    view_all_customers: false,
  });
  scan = await fx.request('/api/sales-crm/manager-tasks', {
    cookie: fx.adminCookie, method: 'POST', body: { customerId: 'RU-9002' },
  });
  assert.equal(scan.status, 200, await scan.text());
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_manager_tasks').get().count, 3);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_notifications
    WHERE code='MANAGER_TASK_CREATED' AND user_id='U-WU'`).get().count, 0);
});

test('manager task scan is idempotent and directed notifications never leak to another full-scope user', async t => {
  const fx = await managerFixture(t);
  fx.db.prepare(`UPDATE crm_manager_task_settings
    SET recipient_ids_json='["U-WU"]' WHERE id='default'`).run();
  const insert = fx.db.prepare(`INSERT INTO crm_deferred_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,review_at,reason,source,source_event_id,created_at)
    VALUES (?, 'RU-9003','U-OTHER','U-OTHER',?,'等待客户确认','manual_deferred',?,?)`);
  for (const [index, createdAt] of [
    '2026-07-27 01:00:00', '2026-07-28 01:00:00', '2026-07-29 01:00:00',
  ].entries()) {
    insert.run(`DPE-SCAN-${index}`, '2099-08-01 01:00:00', `scan-${index}`, createdAt);
  }

  const first = await fx.request('/api/sales-crm/manager-tasks', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { customerId: 'CRM-OTHER' },
  });
  const firstBody = await first.json();
  assert.equal(first.status, 200, firstBody.error);
  assert.deepEqual(firstBody.evaluatedReasons, ['consecutive_deferred']);
  assert.equal(firstBody.tasks.length, 1);
  const taskId = firstBody.tasks[0].id;

  const replay = await fx.request('/api/sales-crm/manager-tasks', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { customerId: 'RU-9003' },
  });
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal((await replay.json()).tasks[0].id, taskId);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_manager_tasks').get().count, 1);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_notifications
    WHERE code='MANAGER_TASK_CREATED' AND user_id='U-WU'`).get().count, 1);

  const adminBootstrap = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const adminBody = await adminBootstrap.json();
  assert.equal(adminBootstrap.status, 200, adminBody.error);
  assert.equal(adminBody.notifications.some(item => item.code === 'MANAGER_TASK_CREATED'), false);

  const managerBootstrap = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  const managerBody = await managerBootstrap.json();
  assert.equal(managerBootstrap.status, 200, managerBody.error);
  assert.equal(managerBody.notifications.some(item => item.code === 'MANAGER_TASK_CREATED'), true);
  assert.equal(managerBody.managerTasks.some(item => item.id === taskId), true);

  const salesList = await fx.request('/api/sales-crm/manager-tasks', { cookie: fx.otherCookie });
  assert.equal(salesList.status, 403, await salesList.text());
});

test('manager task resolution couples real account changes, interventions, and owner escalation atomically', async t => {
  const fx = await managerFixture(t);
  const planTask = upsertManagerTask(fx.db, {
    customerId: 'RU-9003',
    reason: 'consecutive_deferred',
    actorIdSnapshot: 'U-OTHER',
    ownerIdSnapshot: 'U-OTHER',
    triggeredAt: '2026-08-01 01:00:00',
  });
  const beforeActivityCount = fx.db.prepare('SELECT COUNT(*) count FROM crm_activities').get().count;
  const resolved = await fx.request(`/api/sales-crm/manager-tasks/${planTask.id}/resolve`, {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      type: 'manager_advice',
      note: '先确认采购窗口再推进',
      nextAction: '确认采购窗口',
      nextActionAt: '2099-08-03 09:00:00',
      idempotencyKey: 'manager-advice-api-1',
    },
  });
  const resolvedBody = await resolved.json();
  assert.equal(resolved.status, 200, resolvedBody.error);
  assert.equal(resolvedBody.task.status, 'completed');
  assert.deepEqual(fx.db.prepare(`SELECT next_action,next_action_at,next_action_time_basis
    FROM crm_accounts WHERE id='CRM-OTHER'`).get(), {
    next_action: '确认采购窗口',
    next_action_at: '2099-08-03 01:00:00',
    next_action_time_basis: 'utc',
  });
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_activities').get().count,
    beforeActivityCount + 1);
  assert.equal(fx.db.prepare(`SELECT activity_type FROM crm_activities
    ORDER BY created_at DESC,id DESC LIMIT 1`).get().activity_type, 'manager_advice');

  const replay = await fx.request(`/api/sales-crm/manager-tasks/${planTask.id}/resolve`, {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      type: 'manager_advice',
      note: '先确认采购窗口再推进',
      nextAction: '确认采购窗口',
      nextActionAt: '2099-08-03 09:00:00',
      idempotencyKey: 'manager-advice-api-1',
    },
  });
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal((await replay.json()).deduplicated, true);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_activities').get().count,
    beforeActivityCount + 1);

  const escalatedTask = upsertManagerTask(fx.db, {
    customerId: 'RU-9003',
    reason: 'planned_action_overdue',
    actorIdSnapshot: 'U-OTHER',
    ownerIdSnapshot: 'U-OTHER',
    triggeredAt: '2026-08-01 02:00:00',
  });
  const escalation = await fx.request(`/api/sales-crm/manager-tasks/${escalatedTask.id}/resolve`, {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      type: 'escalate_owner',
      difficulty: '需要老板批准特殊商务条件',
      idempotencyKey: 'manager-escalation-api-1',
    },
  });
  const escalationBody = await escalation.json();
  assert.equal(escalation.status, 200, escalationBody.error);
  assert.equal(escalationBody.task.status, 'escalated');
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_notifications
    WHERE code='MANAGER_TASK_ESCALATED' AND user_id='USR-ADMIN'`).get().count, 1);
});

test('disabled deferred writes roll back plan-forming manager resolutions atomically', async t => {
  const fx = await managerFixture(t, { writesEnabled: false });
  const tasks = [
    upsertManagerTask(fx.db, {
      customerId: 'RU-9003',
      reason: 'consecutive_deferred',
      actorIdSnapshot: 'U-OTHER',
      ownerIdSnapshot: 'U-OTHER',
      triggeredAt: '2026-08-01 01:00:00',
    }),
    upsertManagerTask(fx.db, {
      customerId: 'RU-9003',
      reason: 'planned_action_overdue',
      actorIdSnapshot: 'U-OTHER',
      ownerIdSnapshot: 'U-OTHER',
      triggeredAt: '2026-08-01 02:00:00',
    }),
  ];
  const beforeAccount = fx.db.prepare(`SELECT next_action,next_action_at,next_action_time_basis
    FROM crm_accounts WHERE id='CRM-OTHER'`).get();
  const beforeActivities = fx.db.prepare('SELECT COUNT(*) count FROM crm_activities').get().count;

  for (const [index, type] of ['plan_formed', 'manager_advice'].entries()) {
    const response = await fx.request(`/api/sales-crm/manager-tasks/${tasks[index].id}/resolve`, {
      cookie: fx.cookie,
      method: 'POST',
      body: {
        type,
        note: type === 'manager_advice' ? '主管建议内容' : '',
        nextAction: `写开关关闭计划-${index}`,
        nextActionAt: '2099-08-03 09:00:00',
        idempotencyKey: `manager-gate-off-${index}`,
      },
    });
    const body = await response.json();
    assert.equal(response.status, 409, body.error);
    assert.equal(body.code, 'DEFERRED_PLAN_WRITES_DISABLED');
  }

  assert.deepEqual(fx.db.prepare(`SELECT next_action,next_action_at,next_action_time_basis
    FROM crm_accounts WHERE id='CRM-OTHER'`).get(), beforeAccount);
  assert.deepEqual(fx.db.prepare('SELECT status FROM crm_manager_tasks ORDER BY triggered_at').all(), [
    { status: 'open' }, { status: 'open' },
  ]);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_manager_interventions').get().count, 0);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_next_plan_events').get().count, 0);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_activities').get().count,
    beforeActivities);
});
