'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

function futureSql(days = 7) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

function progressPayload(overrides = {}) {
  return {
    customerId: 'CRM-OTHER',
    progressType: 'email',
    reactionOptionId: '',
    summary: '客户暂无回复，需要主管协助梳理联系人',
    occurredAt: '2026-08-13 13:50:00',
    managerRequired: true,
    nextAction: '希望主管协助查询联系人',
    nextActionAt: futureSql(),
    ...overrides,
  };
}

test('manager assistance requires a reason and snapshots original plan, contacts and deadline', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_account_contacts
    (id,customer_id,external_customer_id,name,title,department,phone,email,social,match_status,
     created_by,archived_at,created_at,updated_at)
    VALUES ('CT-1','CRM-OTHER','RU-9003','Ivan','Procurement','技术部','','','','mismatch',
      'U-OTHER','',?,?)`).run(
    '2026-08-10 08:00:00', '2026-08-10 08:00:00');

  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: progressPayload(),
  });
  assert.equal(response.status, 200, await response.clone().text());

  const task = fx.db.prepare(
    "SELECT * FROM crm_manager_tasks WHERE reason='manager_assistance'",
  ).get();
  assert.ok(task);
  const evidence = JSON.parse(task.evidence_json);
  assert.equal(evidence.requestReason, '客户暂无回复，需要主管协助梳理联系人');
  assert.equal(evidence.originalPlan, '希望主管协助查询联系人');
  assert.deepEqual(evidence.contacts, [
    { name: 'Ivan', title: 'Procurement', department: '技术部', matchStatus: 'mismatch' },
  ]);
  assert.match(evidence.dueAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('manager assistance without a reason is rejected before any write', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: progressPayload({ summary: '' }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, '请求主管协助必须填写申请原因');
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) n FROM crm_manager_tasks WHERE reason='manager_assistance'").get().n,
    0,
  );
});

test('sales alert exposes MANAGER_REPLIED only to the owner and hides it from managers', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const request = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: progressPayload({ customerId: 'CRM-OTHER', managerRequired: true }),
  });
  assert.equal(request.status, 200, await request.clone().text());
  fx.db.prepare("UPDATE crm_accounts SET manager_status='已回复' WHERE id='CRM-OTHER'").run();
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,outcome,summary,stage_before,stage_after,
     manager_required,progress_key,reaction_label_snapshot,occurred_at,created_at)
    VALUES ('ACT-REPLY','CRM-OTHER','U-MGR','manager_join','已回复','核对旧联系人，再查采购负责人',
      'qualified','qualified',0,'manager_join','已回复',?,?)`).run(
    '2026-08-13 14:10:00', '2026-08-13 14:10:00');

  const salesList = await (await fx.request('/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D', {
    cookie: fx.otherCookie,
  })).json();
  assert.ok(salesList.rows.some(row =>
    row.customerId === 'CRM-OTHER' && row.code === 'MANAGER_REPLIED'));

  const managerList = await (await fx.request('/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D', {
    cookie: fx.adminCookie,
  })).json();
  assert.ok(!managerList.rows.some(row =>
    row.customerId === 'CRM-OTHER' && ['MANAGER_REPLIED', 'MANAGER_NEEDED'].includes(row.code)));
});

test('confirming the receipt without a plan is rejected and keeps the loop open', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET manager_required=1,manager_status='已回复' WHERE id='CRM-OTHER'").run();
  fx.db.prepare(`INSERT INTO crm_manager_tasks
    (id,idempotency_key,customer_id,reason,status,actor_id_snapshot,owner_id_snapshot,
     recipient_ids_json,evidence_json,completion_condition,settings_version,
     threshold_snapshot_json,evaluated_at,triggered_at,due_at,result_json,created_at,updated_at)
    VALUES ('MT-1','k-1','RU-9003','manager_assistance','open','U-OTHER','U-OTHER','[]',
      '{"requestReason":"无思路"}','销售确认回执并保存下一步计划',1,'{}',?,?,?, '{}',?,?)`).run(
    '2026-08-13 13:50:00', '2026-08-13 13:50:00', '2026-08-16 13:50:00',
    '2026-08-13 13:50:00', '2026-08-13 13:50:00');
  const response = await fx.request('/api/sales-crm/today-tasks/actions', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'confirm-no-plan', actionType: 'confirm_manager_assistance',
      customerId: 'CRM-OTHER', nextAction: '', nextActionAt: '',
    },
  });
  assert.equal(response.status, 400);
  const task = fx.db.prepare("SELECT * FROM crm_manager_tasks WHERE id='MT-1'").get();
  assert.equal(task.status, 'open');
});

test('manager assistance alert carries original plan, contacts and deadline into managerRequest', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_account_contacts
    (id,customer_id,external_customer_id,name,title,department,phone,email,social,match_status,
     created_by,archived_at,created_at,updated_at)
    VALUES ('CT-2','CRM-OTHER','RU-9003','Ivan','Procurement','技术部','','','','mismatch',
      'U-OTHER','',?,?)`).run(
    '2026-08-10 08:00:00', '2026-08-10 08:00:00');
  const created = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie, method: 'POST', body: progressPayload({ customerId: 'CRM-OTHER' }),
  });
  assert.equal(created.status, 200, await created.clone().text());

  const body = await (await fx.request('/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D', {
    cookie: fx.adminCookie,
  })).json();
  const alert = body.rows.find(row =>
    row.customerId === 'CRM-OTHER' && row.code === 'MANAGER_NEEDED');
  assert.ok(alert);
  assert.equal(alert.managerRequest.originalPlan, '希望主管协助查询联系人');
  assert.equal(alert.managerRequest.contacts[0].name, 'Ivan');
  assert.match(alert.managerRequest.dueAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('manager can open an assistance task backed only by an intake customer', async t => {
  const fx = await fixtures.adminFixture({ permissions: { resolve_manager_tasks: true } });
  t.after(() => fx.close());
  const batch = fx.db.prepare('SELECT id FROM crm_intake_batches ORDER BY created_at LIMIT 1').get();
  const at = '2026-08-13 13:50:00';
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-291',?,'RU-0436','JSC 机电产品工厂','assigned','U-OTHER',?,?)`)
    .run(batch.id, at, at);
  fx.db.prepare(`INSERT INTO crm_manager_tasks
    (id,idempotency_key,customer_id,reason,status,actor_id_snapshot,owner_id_snapshot,
     recipient_ids_json,evidence_json,completion_condition,settings_version,
     threshold_snapshot_json,evaluated_at,triggered_at,due_at,result_json,created_at,updated_at)
    VALUES ('MT-291','issue291-intake-task','RU-0436','manager_assistance','open',
      'U-OTHER','U-OTHER','["U-ADMIN"]','{"requestReason":"需要协助"}',
      '销售确认回执并保存下一步计划',1,'{}',?,?,?,'{}',?,?)`)
    .run(at, at, '2026-08-16 13:50:00', at, at);

  const response = await fx.request('/api/sales-crm/manager-tasks/MT-291', {
    cookie: fx.adminCookie,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.account.externalCustomerId, 'RU-0436');
  assert.equal(body.account.companyName, 'JSC 机电产品工厂');
  assert.equal(body.account.sourceType, 'intake');
  assert.deepEqual(body.risk.history, []);
});
