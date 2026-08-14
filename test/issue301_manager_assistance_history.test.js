'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

function insertTask(fx, row) {
  fx.db.prepare(`INSERT INTO crm_manager_tasks
    (id, idempotency_key, customer_id, reason, status, actor_id_snapshot, owner_id_snapshot,
     recipient_ids_json, evidence_json, completion_condition, settings_version,
     threshold_snapshot_json, evaluated_at, triggered_at, due_at, resolved_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.id, row.idempotencyKey, row.customerId, 'manager_assistance', row.status,
    row.actorId || 'U-OTHER', row.ownerId || 'U-OTHER', '[]',
    JSON.stringify(row.evidence || {}), '必须形成真实业务变化', 1, '{}',
    row.evaluatedAt || row.triggeredAt, row.triggeredAt, row.dueAt,
    row.resolvedAt || '', row.createdAt || row.triggeredAt, row.updatedAt || row.triggeredAt,
  );
  if (row.result) {
    fx.db.prepare('UPDATE crm_manager_tasks SET result_json=? WHERE id=?').run(
      JSON.stringify(row.result), row.id,
    );
  }
}

test('manager task detail returns per-customer assistance history with business fields', async t => {
  const fx = await fixtures.adminFixture({ permissions: { resolve_manager_tasks: true } });
  t.after(() => fx.close());
  const managerCookie = await fx.login('wu@example.com', 'Password123!');

  insertTask(fx, {
    id: 'TASK-1', idempotencyKey: 'task-1', customerId: 'RU-9003', status: 'open',
    triggeredAt: '2026-08-10 08:00:00', dueAt: '2026-08-13 08:00:00',
    evidence: {
      requestedAt: '2026-08-10 07:50:00',
      requestReason: '第一次请求：已发邮件无回复',
      originalPlan: '计划A：电话跟进',
    },
    result: { action: 'manager_replied', result: '主管回复一：先查联系人', repliedAt: '2026-08-10 09:00:00' },
  });
  insertTask(fx, {
    id: 'TASK-2', idempotencyKey: 'task-2', customerId: 'RU-9003', status: 'completed',
    triggeredAt: '2026-08-12 08:00:00', dueAt: '2026-08-15 08:00:00',
    resolvedAt: '2026-08-13 10:00:00',
    evidence: { requestedAt: '2026-08-12 07:40:00', requestReason: '第二次请求：需决策' },
    result: { action: 'sales_plan_confirmed', nextAction: '下一步动作', confirmedAt: '2026-08-13 10:00:00' },
  });

  const response = await fx.request('/api/sales-crm/manager-tasks/TASK-2', {
    cookie: managerCookie,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  const history = body.customerAssistanceHistory || [];
  assert.equal(history.length, 2, 'two assistance tasks for the customer');
  assert.equal(history[0].taskId, 'TASK-2', 'newest first');
  assert.equal(history[0].status, 'completed');
  assert.equal(history[0].requestReason, '第二次请求：需决策');
  assert.equal(history[0].confirmed, true);
  assert.equal(history[1].taskId, 'TASK-1');
  assert.equal(history[1].requestReason, '第一次请求：已发邮件无回复');
  assert.equal(history[1].originalPlan, '计划A：电话跟进');
  assert.equal(history[1].replyText, '主管回复一：先查联系人');
  assert.equal(history[1].confirmed, false);
});

test('manager task detail history stays within authorized customer scope', async t => {
  const fx = await fixtures.adminFixture({ permissions: { resolve_manager_tasks: true } });
  t.after(() => fx.close());
  const managerCookie = await fx.login('wu@example.com', 'Password123!');
  fx.db.prepare(`INSERT INTO crm_accounts
    (id, external_customer_id, company_name, country, stage, owner_id, created_by, created_at, updated_at)
    VALUES ('CRM-OTHER2','RU-9004','Another Co','RU','contacted','U-OTHER','U-OTHER',
      '2026-08-01 08:00:00','2026-08-01 08:00:00')`).run();
  insertTask(fx, {
    id: 'TASK-X', idempotencyKey: 'task-x', customerId: 'RU-9004', status: 'open',
    triggeredAt: '2026-08-11 08:00:00', dueAt: '2026-08-14 08:00:00',
    evidence: { requestReason: '其他客户的请求' },
  });

  const response = await fx.request('/api/sales-crm/manager-tasks/TASK-X', {
    cookie: managerCookie,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  const history = body.customerAssistanceHistory || [];
  assert.equal(history.length, 1);
  assert.equal(history[0].taskId, 'TASK-X');
  assert.equal(history[0].requestReason, '其他客户的请求');
});
