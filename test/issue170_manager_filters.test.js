'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { installManagerTaskSchema } = require('../lib/manager_tasks');
const {
  listManagerTaskRows,
  listManagerRiskRows,
  listManagerMetricRows,
  listNotificationRows,
  businessFilterOptions,
} = require('../lib/business_page_filters');

function actor(id, role, permissions = {}) {
  return { id, role, permissions };
}

function ast(page, filters = []) {
  return { version: 1, page, filters };
}

function insertTask(db, patch = {}) {
  const row = {
    id: 'TASK-1',
    customerId: 'RU-9003',
    reason: 'consecutive_deferred',
    status: 'open',
    ownerId: 'U-OTHER',
    recipients: ['U-MGR'],
    triggeredAt: '2026-07-28 08:00:00',
    dueAt: '2026-07-31 08:00:00',
    resolvedAt: '',
    ...patch,
  };
  db.prepare(`INSERT INTO crm_manager_tasks
    (id,idempotency_key,customer_id,reason,status,actor_id_snapshot,owner_id_snapshot,
     recipient_ids_json,evidence_json,completion_condition,settings_version,
     threshold_snapshot_json,evaluated_at,triggered_at,due_at,result_json,
     resolved_by,resolved_at,escalated_by,escalated_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'U-OTHER',?,?,'{}','effective_action',1,'{}',?,?,?,'{}',
      '',?,'','','2026-07-28 08:00:00','2026-07-28 08:00:00')`).run(
    row.id,
    `dedupe-${row.id}`,
    row.customerId,
    row.reason,
    row.status,
    row.ownerId,
    JSON.stringify(row.recipients),
    row.triggeredAt,
    row.triggeredAt,
    row.dueAt,
    row.resolvedAt,
  );
}

test('manager task and risk adapters share scope, filters, totals, and pagination', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  installManagerTaskSchema(fx.db);
  insertTask(fx.db);
  insertTask(fx.db, {
    id: 'TASK-2', customerId: 'RU-9002', reason: 'planned_action_overdue',
    status: 'completed', ownerId: 'U-MGR', recipients: ['U-WU'],
    resolvedAt: '2026-07-30 09:00:00',
  });
  insertTask(fx.db, {
    id: 'TASK-3', customerId: 'RU-9001', reason: 'first_contact_silence',
    status: 'overdue', ownerId: 'U-WU', recipients: ['U-MGR'],
  });
  const manager = actor('U-MGR', 'manager', {
    resolve_manager_tasks: true,
    view_all_customers: true,
  });

  const filtered = listManagerTaskRows(fx.db, manager, ast('manager_tasks', [
    { key: 'task_status', operator: 'in', values: ['open', 'overdue'] },
    { key: 'recipient', operator: 'in', values: ['U-MGR'] },
  ]), { page: 1, pageSize: 1 });
  assert.equal(filtered.authorizedTotal, 3);
  assert.equal(filtered.total, 2);
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.hasMore, true);
  assert.ok(['TASK-1', 'TASK-3'].includes(filtered.rows[0].id));

  const secondPage = listManagerTaskRows(fx.db, manager, ast('manager_tasks', [
    { key: 'task_status', operator: 'in', values: ['open', 'overdue'] },
    { key: 'recipient', operator: 'in', values: ['U-MGR'] },
  ]), { page: 2, pageSize: 1 });
  assert.equal(secondPage.total, filtered.total);
  assert.equal(secondPage.authorizedTotal, filtered.authorizedTotal);
  assert.equal(secondPage.hasMore, false);
  assert.notEqual(secondPage.rows[0].id, filtered.rows[0].id);

  const risks = listManagerRiskRows(fx.db, manager, ast('manager_risks'));
  assert.equal(risks.authorizedTotal, 2);
  assert.equal(risks.total, 2);
  assert.deepEqual(new Set(risks.rows.map(row => row.status)), new Set(['open', 'overdue']));

  const scoped = actor('U-OTHER', 'manager', { resolve_manager_tasks: true });
  assert.deepEqual(
    listManagerTaskRows(fx.db, scoped, ast('manager_tasks')).rows.map(row => row.id),
    ['TASK-1'],
  );
  const options = businessFilterOptions(
    fx.db, manager, 'manager_tasks', ['task_status', 'task_reason', 'recipient'],
  );
  assert.deepEqual(
    new Set(options.task_status.map(option => option.value)),
    new Set(['open', 'overdue', 'completed']),
  );
  assert.deepEqual(new Set(options.recipient.map(option => option.value)), new Set(['U-MGR', 'U-WU']));
});

test('manager metric adapter applies authorized owner selection before stable pagination', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  installManagerTaskSchema(fx.db);
  insertTask(fx.db);
  const manager = actor('U-MGR', 'manager', {
    resolve_manager_tasks: true,
    view_all_customers: true,
  });
  const filtered = listManagerMetricRows(fx.db, manager, ast('manager_metrics', [
    { key: 'metric_window', operator: 'in', values: ['30', '90'] },
    { key: 'owner', operator: 'in', values: ['U-OTHER'] },
  ]), { page: 1, pageSize: 1 }, { now: '2026-08-01 12:00:00' });
  assert.ok(filtered.authorizedTotal >= filtered.total);
  assert.equal(filtered.total, 2);
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.hasMore, true);
  assert.equal(filtered.rows[0].actorId, 'U-OTHER');
  assert.ok([30, 90].includes(filtered.rows[0].rangeDays));

  const only90 = listManagerMetricRows(fx.db, manager, ast('manager_metrics', [
    { key: 'metric_window', operator: 'in', values: ['90'] },
  ]), {}, { now: '2026-08-01 12:00:00' });
  assert.ok(only90.total > 0);
  assert.equal(only90.rows.every(row => row.rangeDays === 90), true);
});

test('notification adapter isolates recipients and uses one predicate for count and rows', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const insert = fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,wecom_status,created_at,read_at)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',?,'')`);
  insert.run('NOTE-MGR-1', 'U-MGR', 'CRM-OTHER', 'MANAGER_TASK', 'warning',
    '主管任务', 'manager-only-detail', 'unread', 'manager-task-1', '2026-08-01 08:00:00');
  insert.run('NOTE-MGR-2', 'U-MGR', 'CRM-OTHER', 'MANAGER_TASK', 'info',
    '已完成任务', 'completed', 'read', 'manager-task-2', '2026-07-31 08:00:00');
  insert.run('NOTE-OTHER', 'U-WU', 'CRM-WU', 'MANAGER_TASK', 'warning',
    '其他主管任务', 'must-not-leak', 'unread', 'manager-task-3', '2026-08-01 09:00:00');
  const manager = actor('U-MGR', 'manager', {
    view_customers: true,
    view_all_customers: true,
    resolve_manager_tasks: true,
    view_contacts: true,
  });
  const rows = listNotificationRows(fx.db, manager, ast('notifications', [
    { key: 'notification_status', operator: 'in', values: ['unread'] },
  ]), { pageSize: 1 });
  assert.equal(rows.authorizedTotal, 2);
  assert.equal(rows.total, 1);
  assert.deepEqual(rows.rows.map(row => row.id), ['NOTE-MGR-1']);
  assert.equal(JSON.stringify(rows).includes('must-not-leak'), false);

  const options = businessFilterOptions(
    fx.db, manager, 'notifications', ['recipient', 'notification_status', 'notification_severity'],
  );
  assert.deepEqual(options.recipient.map(option => option.value), ['U-MGR']);
  assert.deepEqual(new Set(options.notification_status.map(option => option.value)), new Set(['unread', 'read']));
});

test('notification adapter removes out-of-scope customer rows and facet counts after manager scope revocation', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false });
  t.after(() => fx.close());
  fx.setUserPermissions('U-MGR', {
    view_all_customers: false,
    resolve_manager_tasks: true,
    view_customers: true,
  });
  const insert = fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,wecom_status,created_at,read_at)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',?,'')`);
  insert.run('NOTE-SCOPE-OWN', 'U-MGR', 'CRM-OWN', 'SELF_VISIBLE', 'info',
    '本人客户通知', 'own-scope-detail', 'unread', 'scope-own', '2026-08-01 10:00:00');
  insert.run('NOTE-SCOPE-FOREIGN-ID', 'U-MGR', 'CRM-OTHER', 'SECRET_ACCOUNT_ID', 'critical',
    '越权客户通知', 'secret-account-id-detail', 'read', 'scope-foreign-id', '2026-08-01 09:00:00');
  insert.run('NOTE-SCOPE-FOREIGN-EXTERNAL', 'U-MGR', 'RU-9003', 'SECRET_EXTERNAL_ID', 'warning',
    '越权客户通知', 'secret-external-id-detail', 'read', 'scope-foreign-external', '2026-08-01 08:00:00');

  const manager = actor('U-MGR', 'manager', {
    resolve_manager_tasks: true,
    view_customers: true,
  });
  const result = listNotificationRows(fx.db, manager, ast('notifications'));
  assert.equal(result.authorizedTotal, 1);
  assert.equal(result.total, 1);
  assert.deepEqual(result.rows.map(row => row.id), ['NOTE-SCOPE-OWN']);
  const serialized = JSON.stringify(result);
  for (const secret of [
    'NOTE-SCOPE-FOREIGN-ID', 'NOTE-SCOPE-FOREIGN-EXTERNAL',
    'CRM-OTHER', 'RU-9003', 'secret-account-id-detail', 'secret-external-id-detail',
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }

  const options = businessFilterOptions(fx.db, manager, 'notifications', [
    'recipient', 'notification_status', 'notification_code', 'notification_severity',
  ]);
  assert.deepEqual(options.recipient, [{ value: 'U-MGR', label: 'U-MGR', count: 1 }]);
  assert.deepEqual(options.notification_status, [{ value: 'unread', label: 'unread', count: 1 }]);
  assert.deepEqual(options.notification_code, [{ value: 'SELF_VISIBLE', label: 'SELF_VISIBLE', count: 1 }]);
  assert.deepEqual(options.notification_severity, [{ value: 'info', label: 'info', count: 1 }]);
  assert.equal(JSON.stringify(options).includes('SECRET_'), false);
});

test('notification adapter excludes intake-only rows and facets without intake permission', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const insert = fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,wecom_status,created_at,read_at)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',?,'')`);
  insert.run('NOTE-ACCOUNT-VISIBLE', 'U-OTHER', 'CRM-OTHER', 'ACCOUNT_VISIBLE', 'info',
    '本人客户通知', 'account-visible-detail', 'unread', 'account-visible', '2026-08-01 10:00:00');
  insert.run('NOTE-INTAKE-HIDDEN', 'U-OTHER', 'BR-9004', 'INTAKE_HIDDEN', 'critical',
    '线索通知', 'intake-hidden-detail', 'read', 'intake-hidden', '2026-08-01 09:00:00');

  const sales = actor('U-OTHER', 'sales', {
    view_customers: true,
    view_contacts: true,
    view_intake: false,
  });
  const result = listNotificationRows(fx.db, sales, ast('notifications'));
  assert.equal(result.authorizedTotal, 1);
  assert.equal(result.total, 1);
  assert.deepEqual(result.rows.map(row => row.id), ['NOTE-ACCOUNT-VISIBLE']);
  const serialized = JSON.stringify(result);
  for (const secret of ['NOTE-INTAKE-HIDDEN', 'BR-9004', 'INTAKE_HIDDEN', 'intake-hidden-detail']) {
    assert.equal(serialized.includes(secret), false, secret);
  }

  const options = businessFilterOptions(fx.db, sales, 'notifications', [
    'recipient', 'notification_status', 'notification_code', 'notification_severity',
  ]);
  assert.deepEqual(options.recipient, [{ value: 'U-OTHER', label: 'U-OTHER', count: 1 }]);
  assert.deepEqual(options.notification_status, [{ value: 'unread', label: 'unread', count: 1 }]);
  assert.deepEqual(options.notification_code, [{ value: 'ACCOUNT_VISIBLE', label: 'ACCOUNT_VISIBLE', count: 1 }]);
  assert.deepEqual(options.notification_severity, [{ value: 'info', label: 'info', count: 1 }]);
  assert.equal(JSON.stringify(options).includes('INTAKE_'), false);
});

test('new adapters reject wrong pages, permissions, and unknown fields opaquely', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  installManagerTaskSchema(fx.db);
  const manager = actor('U-MGR', 'manager', { resolve_manager_tasks: true });
  for (const run of [
    () => listManagerTaskRows(fx.db, manager, ast('manager_tasks', [
      { key: 'secret_score', operator: 'in', values: ['x'] },
    ])),
    () => listManagerRiskRows(fx.db, actor('U-OTHER', 'sales', {}), ast('manager_risks')),
    () => listNotificationRows(fx.db, actor('U-OTHER', 'sales', {}), ast('notifications')),
  ]) {
    assert.throws(run, error => {
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, 'FILTER_NOT_AUTHORIZED');
      assert.equal(error.message, '筛选条件未获授权');
      assert.equal(error.message.includes('secret_score'), false);
      return true;
    });
  }
});
