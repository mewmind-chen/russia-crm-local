'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

const ACTION_ROUTE = '/api/sales-crm/today-tasks/actions';
const FIXED_RETURN_REASON = '超过24小时未领取';

async function responseJson(response) {
  return { response, body: await response.json() };
}

async function act(fx, cookie, body) {
  return responseJson(await fx.request(ACTION_ROUTE, {
    cookie,
    method: 'POST',
    body,
  }));
}

async function bootstrap(fx, cookie) {
  return responseJson(await fx.request('/api/sales-crm/bootstrap', { cookie }));
}

function taskFor(payload, { customerId = '', intakeItemId = '' }) {
  return (payload.alerts || []).find(item => (
    customerId ? item.customerId === customerId : item.intakeItemId === intakeItemId
  ));
}

function reasonCodes(task) {
  return (task?.reasons || []).map(reason => reason.code);
}

function auditFor(fx, action, entityId) {
  return fx.db.prepare(`SELECT * FROM crm_audit_log
    WHERE action=? AND entity_id=? ORDER BY rowid DESC LIMIT 1`).get(action, entityId);
}

function detail(row) {
  return JSON.parse(row?.detail_json || '{}');
}

function installSecondSalesUser(fx) {
  fx.db.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,
     languages_json,countries_json,channels_json,permission_group_id,created_at,updated_at)
    SELECT 'U-NEW','new-sales@example.com','New Sales','sales',password_hash,password_salt,1,0,
      '[]','[]','[]',permission_group_id,created_at,updated_at
    FROM sales_users WHERE id='U-OTHER'`).run();
}

function seedOverdueLead(fx, {
  itemId = 'INTAKE-OTHER',
  customerId = 'CRM-OTHER',
  ownerId = 'U-OTHER',
  linked = true,
} = {}) {
  fx.db.prepare(`UPDATE crm_intake_items SET
    external_customer_id='RU-9003',company_name='Overdue Lead',status='assigned',
    assigned_owner_id=?,suggested_owner_id=?,assigned_at='2026-07-20 08:00:00',
    claim_due_at='2026-07-21 08:00:00',claimed_at='',return_reason='',
    crm_customer_id=?,updated_at='2026-07-21 08:00:00' WHERE id=?`).run(
    ownerId,
    ownerId,
    linked ? customerId : '',
    itemId,
  );
  if (linked) {
    fx.db.prepare(`UPDATE crm_accounts SET intake_item_id=?,owner_id=?,
      assignment_status='assigned',assigned_at='2026-07-20 08:00:00',
      claim_due_at='2026-07-21 08:00:00',claimed_at='',return_reason='',
      next_action='完成首次触达',next_action_at='2099-08-01 09:00:00',
      last_activity_at='2099-07-31 08:00:00',updated_at='2026-07-21 08:00:00'
      WHERE id=?`).run(itemId, ownerId, customerId);
  }
}

function seedNoNextPlan(fx, customerId = 'CRM-OTHER', {
  stale = false,
  managerRequired = false,
} = {}) {
  fx.db.prepare(`UPDATE crm_accounts SET next_action='',next_action_at='',
    manager_required=?,manager_status=?,last_activity_at=?,updated_at=?
    WHERE id=?`).run(
    managerRequired ? 1 : 0,
    managerRequired ? '待介入' : '',
    stale ? '2026-07-01 08:00:00' : '2099-07-31 08:00:00',
    stale ? '2026-07-01 08:00:00' : '2099-07-31 08:00:00',
    customerId,
  );
}

function seedManagerAssistance(fx, customerId = 'CRM-OTHER') {
  fx.db.prepare(`UPDATE crm_accounts SET stage='qualified',manager_required=1,
    manager_status='待介入',manager_id='',next_action='等待经理协助',
    next_action_at='2099-08-01 09:00:00',last_activity_at='2099-07-31 08:00:00',
    updated_at='2026-07-30 11:00:00' WHERE id=?`).run(customerId);
  const insert = fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,
     next_action_at,stage_after,manager_required,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run(
    'ACT-157-MANAGER-OLD', customerId, 'U-OTHER', 'reply', 'other', '需要跟进',
    '较早的协助请求', '等待经理协助', '2099-08-01 09:00:00', 'qualified', 1,
    '2026-07-30 09:00:00', '2026-07-30 09:00:00',
  );
  insert.run(
    'ACT-157-MANAGER-LATEST', customerId, 'U-OTHER', 'reply', 'other', '需要跟进',
    '最新协助原因：请确认特殊价格和账期', '等待经理协助', '2099-08-01 09:00:00',
    'qualified', 1, '2026-07-30 10:00:00', '2026-07-30 10:00:00',
  );
  insert.run(
    'ACT-157-UNRELATED', customerId, 'U-OTHER', 'email', 'email', '暂无回复',
    '更晚但与协助申请无关的普通记录', '等待经理协助', '2099-08-01 09:00:00',
    'qualified', 0, '2026-07-30 11:00:00', '2026-07-30 11:00:00',
  );
}

test('overdue lead reassignment is atomic, renews the 24-hour claim window, preserves history, and invalidates the old owner', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  installSecondSalesUser(fx);
  seedOverdueLead(fx);

  const before = await bootstrap(fx, fx.adminCookie);
  assert.equal(before.response.status, 200);
  assert.ok(reasonCodes(taskFor(before.body, { intakeItemId: 'INTAKE-OTHER' })).includes('UNCLAIMED_LEAD'));

  const request = {
    actionType: 'resolve_overdue_lead',
    intakeItemId: 'INTAKE-OTHER',
    resolution: 'reassign',
    ownerId: 'U-NEW',
    idempotencyKey: 'issue157-overdue-reassign-once',
  };
  const first = await act(fx, fx.adminCookie, request);
  assert.equal(first.response.status, 200, first.body.error);
  assert.equal(first.body.actionType, request.actionType);
  assert.equal(first.body.resolution, 'reassign');
  assert.equal(first.body.previousOwnerId, 'U-OTHER');
  assert.equal(first.body.ownerId, 'U-NEW');

  const intake = fx.db.prepare(`SELECT status,assigned_owner_id,suggested_owner_id,
    assigned_at,claim_due_at,claimed_at,return_reason FROM crm_intake_items
    WHERE id='INTAKE-OTHER'`).get();
  assert.equal(intake.status, 'assigned');
  assert.equal(intake.assigned_owner_id, 'U-NEW');
  assert.equal(intake.suggested_owner_id, 'U-NEW');
  assert.equal(intake.claimed_at, '');
  assert.equal(intake.return_reason, '');
  assert.equal(
    new Date(intake.claim_due_at.replace(' ', 'T') + 'Z').getTime()
      - new Date(intake.assigned_at.replace(' ', 'T') + 'Z').getTime(),
    24 * 60 * 60 * 1000,
  );
  assert.deepEqual(
    fx.db.prepare(`SELECT owner_id,assignment_status,assigned_at,claim_due_at,claimed_at
      FROM crm_accounts WHERE id='CRM-OTHER'`).get(),
    {
      owner_id: 'U-NEW',
      assignment_status: 'assigned',
      assigned_at: intake.assigned_at,
      claim_due_at: intake.claim_due_at,
      claimed_at: '',
    },
  );

  const decision = fx.db.prepare(`SELECT actor_id,manual_decision_json FROM crm_intake_decisions
    WHERE intake_item_id='INTAKE-OTHER' ORDER BY rowid DESC LIMIT 1`).get();
  assert.equal(decision.actor_id, 'USR-ADMIN');
  assert.deepEqual(
    {
      method: JSON.parse(decision.manual_decision_json).method,
      previousOwnerId: JSON.parse(decision.manual_decision_json).previousOwnerId,
      ownerId: JSON.parse(decision.manual_decision_json).ownerId,
    },
    { method: 'reassign', previousOwnerId: 'U-OTHER', ownerId: 'U-NEW' },
  );
  const audit = auditFor(fx, 'today_task_overdue_lead_resolved', 'INTAKE-OTHER');
  assert.ok(audit);
  assert.equal(audit.entity_type, 'crm_intake_item');
  assert.deepEqual(
    {
      resolution: detail(audit).resolution,
      previousOwnerId: detail(audit).previousOwnerId,
      ownerId: detail(audit).ownerId,
      claimDueAt: detail(audit).claimDueAt,
    },
    {
      resolution: 'reassign',
      previousOwnerId: 'U-OTHER',
      ownerId: 'U-NEW',
      claimDueAt: intake.claim_due_at,
    },
  );

  const replay = await act(fx, fx.adminCookie, request);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.deduplicated, true);
  assert.equal(
    fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
      WHERE action='today_task_overdue_lead_resolved' AND entity_id='INTAKE-OTHER'`).get().count,
    1,
  );

  const after = await bootstrap(fx, fx.adminCookie);
  assert.equal(taskFor(after.body, { intakeItemId: 'INTAKE-OTHER' }), undefined);
  const oldOwnerClaim = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-OTHER', idempotencyKey: 'issue157-old-owner-claim' },
  });
  assert.equal(oldOwnerClaim.status, 403);
  const newCookie = await fx.login('new-sales@example.com', 'Password123!');
  const newOwnerClaim = await fx.request('/api/sales-crm/intake/action', {
    cookie: newCookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-OTHER', idempotencyKey: 'issue157-new-owner-claim' },
  });
  assert.equal(newOwnerClaim.status, 200);
});

test('overdue lead return clears assignment with the fixed reason and can only be recorded once', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  seedOverdueLead(fx);
  const request = {
    actionType: 'resolve_overdue_lead',
    intakeItemId: 'INTAKE-OTHER',
    resolution: 'return_to_pool',
    idempotencyKey: 'issue157-overdue-return-once',
  };
  const first = await act(fx, fx.adminCookie, request);
  assert.equal(first.response.status, 200, first.body.error);
  const intake = fx.db.prepare(`SELECT status,assigned_owner_id,suggested_owner_id,
    assigned_at,claim_due_at,claimed_at,return_reason FROM crm_intake_items
    WHERE id='INTAKE-OTHER'`).get();
  assert.deepEqual(intake, {
    status: 'returned',
    assigned_owner_id: '',
    suggested_owner_id: '',
    assigned_at: '',
    claim_due_at: '',
    claimed_at: '',
    return_reason: FIXED_RETURN_REASON,
  });
  const account = fx.db.prepare(`SELECT owner_id,assignment_status,claim_due_at,
    claimed_at,return_reason FROM crm_accounts WHERE id='CRM-OTHER'`).get();
  assert.equal(account.owner_id, null);
  assert.equal(account.assignment_status, 'returned');
  assert.equal(account.claim_due_at, '');
  assert.equal(account.claimed_at, '');
  assert.equal(account.return_reason, FIXED_RETURN_REASON);
  const audit = auditFor(fx, 'today_task_overdue_lead_resolved', 'INTAKE-OTHER');
  assert.equal(detail(audit).resolution, 'return_to_pool');
  assert.equal(detail(audit).reason, FIXED_RETURN_REASON);
  const manual = JSON.parse(fx.db.prepare(`SELECT manual_decision_json FROM crm_intake_decisions
    WHERE intake_item_id='INTAKE-OTHER' ORDER BY rowid DESC LIMIT 1`).get().manual_decision_json);
  assert.equal(manual.method, 'return_to_pool');
  assert.equal(manual.reason, FIXED_RETURN_REASON);
  assert.equal(taskFor((await bootstrap(fx, fx.adminCookie)).body, { intakeItemId: 'INTAKE-OTHER' }), undefined);

  const replay = await act(fx, fx.adminCookie, request);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.deduplicated, true);
  const stale = await act(fx, fx.adminCookie, {
    ...request,
    idempotencyKey: 'issue157-overdue-return-second-key',
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.code, 'TODAY_TASK_STALE');
});

test('adding a next plan writes no fake activity, audits delegated work, and promotes the next remaining reason', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  seedNoNextPlan(fx, 'CRM-OTHER', { stale: true });
  const before = await bootstrap(fx, fx.adminCookie);
  const beforeTask = taskFor(before.body, { customerId: 'CRM-OTHER' });
  assert.equal(beforeTask.code, 'NO_NEXT');
  assert.ok(reasonCodes(beforeTask).includes('STALE'));
  const activityCount = fx.db.prepare(
    "SELECT COUNT(*) count FROM crm_activities WHERE customer_id='CRM-OTHER'",
  ).get().count;

  const request = {
    actionType: 'add_next_plan',
    customerId: 'CRM-OTHER',
    nextAction: '确认下一轮报价和交期',
    nextActionAt: '2099-08-02 09:30:00',
    idempotencyKey: 'issue157-next-plan-once',
  };
  const first = await act(fx, fx.adminCookie, request);
  assert.equal(first.response.status, 200, first.body.error);
  assert.equal(first.body.delegated, true);
  assert.deepEqual(
    fx.db.prepare(`SELECT next_action,next_action_at FROM crm_accounts
      WHERE id='CRM-OTHER'`).get(),
    { next_action: request.nextAction, next_action_at: '2099-08-02 01:30:00' },
  );
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_activities WHERE customer_id='CRM-OTHER'").get().count,
    activityCount,
  );
  const audit = auditFor(fx, 'today_task_next_plan_added', 'CRM-OTHER');
  assert.equal(audit.entity_type, 'crm_account');
  assert.deepEqual(
    {
      ownerId: detail(audit).ownerId,
      actorId: detail(audit).actorId,
      delegated: detail(audit).delegated,
      nextAction: detail(audit).nextAction,
      nextActionAt: detail(audit).nextActionAt,
    },
    {
      ownerId: 'U-OTHER',
      actorId: 'USR-ADMIN',
      delegated: true,
      nextAction: request.nextAction,
      nextActionAt: '2099-08-02 01:30:00',
    },
  );
  const afterTask = taskFor((await bootstrap(fx, fx.adminCookie)).body, { customerId: 'CRM-OTHER' });
  assert.ok(afterTask, 'the secondary stale reason should remain');
  assert.equal(afterTask.code, 'STALE');
  assert.equal(reasonCodes(afterTask).includes('NO_NEXT'), false);

  const replay = await act(fx, fx.adminCookie, request);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.deduplicated, true);
  assert.equal(
    fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
      WHERE action='today_task_next_plan_added' AND entity_id='CRM-OTHER'`).get().count,
    1,
  );
  const conflict = await act(fx, fx.adminCookie, {
    ...request,
    nextAction: '同一幂等键不能覆盖原计划',
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.code, 'TODAY_TASK_IDEMPOTENCY_CONFLICT');
  const stale = await act(fx, fx.adminCookie, {
    ...request,
    idempotencyKey: 'issue157-next-plan-second-key',
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.code, 'TODAY_TASK_STALE');
  assert.equal(
    fx.db.prepare("SELECT next_action FROM crm_accounts WHERE id='CRM-OTHER'").get().next_action,
    request.nextAction,
  );
});

test('sales can add a plan only to their own customer and the action is not delegated', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  seedNoNextPlan(fx, 'CRM-OTHER');
  seedNoNextPlan(fx, 'CRM-OWN');

  const own = await act(fx, fx.otherCookie, {
    actionType: 'add_next_plan',
    customerId: 'CRM-OTHER',
    nextAction: '销售本人安排下一次跟进',
    nextActionAt: '2099-08-03 10:00:00',
    idempotencyKey: 'issue157-sales-own-plan',
  });
  assert.equal(own.response.status, 200, own.body.error);
  assert.equal(own.body.delegated, false);
  assert.equal(detail(auditFor(fx, 'today_task_next_plan_added', 'CRM-OTHER')).delegated, false);

  const other = await act(fx, fx.otherCookie, {
    actionType: 'add_next_plan',
    customerId: 'CRM-OWN',
    nextAction: '越权计划',
    nextActionAt: '2099-08-03 10:00:00',
    idempotencyKey: 'issue157-sales-other-plan',
  });
  assert.equal(other.response.status, 403);
  assert.equal(
    fx.db.prepare("SELECT next_action FROM crm_accounts WHERE id='CRM-OWN'").get().next_action,
    '',
  );
});

test('manager assistance uses the latest manager-required request and creates one real timeline event', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  seedManagerAssistance(fx);
  const request = {
    actionType: 'complete_manager_assistance',
    customerId: 'CRM-OTHER',
    result: '已批准特殊价格，并要求销售在两日内确认账期。',
    idempotencyKey: 'issue157-manager-assistance-once',
  };
  const first = await act(fx, fx.adminCookie, request);
  assert.equal(first.response.status, 200, first.body.error);
  assert.match(first.body.activityId, /^ACT-/);
  assert.ok(first.body.repliedAt);
  assert.deepEqual(
    fx.db.prepare(`SELECT manager_required,manager_status,manager_id,last_activity_at
      FROM crm_accounts WHERE id='CRM-OTHER'`).get(),
    {
      manager_required: 1,
      manager_status: '已回复',
      manager_id: 'USR-ADMIN',
      last_activity_at: first.body.repliedAt,
    },
  );
  const activity = fx.db.prepare(`SELECT activity_type,progress_key,channel,outcome,summary,user_id,
    manager_required,stage_before,stage_after,occurred_at FROM crm_activities WHERE id=?`)
    .get(first.body.activityId);
  assert.deepEqual(activity, {
    activity_type: 'manager_join',
    progress_key: 'manager_join',
    channel: '',
    outcome: '已回复',
    summary: request.result,
    user_id: 'USR-ADMIN',
    manager_required: 0,
    stage_before: 'qualified',
    stage_after: 'qualified',
    occurred_at: first.body.repliedAt,
  });
  const audit = auditFor(fx, 'today_task_manager_assistance_replied', 'CRM-OTHER');
  assert.deepEqual(
    {
      requesterId: detail(audit).requesterId,
      requestedAt: detail(audit).requestedAt,
      requestReason: detail(audit).requestReason,
      handlerId: detail(audit).handlerId,
      result: detail(audit).result,
      repliedAt: detail(audit).repliedAt,
    },
    {
      requesterId: 'U-OTHER',
      requestedAt: '2026-07-30 10:00:00',
      requestReason: '最新协助原因：请确认特殊价格和账期',
      handlerId: 'USR-ADMIN',
      result: request.result,
      repliedAt: first.body.repliedAt,
    },
  );
  const ownerPayload = await bootstrap(fx, fx.otherCookie);
  const timelineEvent = ownerPayload.body.timeline.find(item => item.id === `activity:${first.body.activityId}`);
  assert.ok(timelineEvent);
  assert.equal(timelineEvent.event_type, 'manager_join');
  assert.equal(timelineEvent.summary, request.result);
  assert.equal(timelineEvent.actor_name, '系统管理员');

  const replay = await act(fx, fx.adminCookie, request);
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.deduplicated, true);
  assert.equal(replay.body.activityId, first.body.activityId);
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_activities WHERE id=?").get(first.body.activityId).count,
    1,
  );
});

test('role, management permission, and customer scope failures return 403 without resolving tasks', async t => {
  const salesFx = await fixtures.adminFixture();
  t.after(() => salesFx.close());
  seedOverdueLead(salesFx);
  seedManagerAssistance(salesFx);
  let result = await act(salesFx, salesFx.otherCookie, {
    actionType: 'resolve_overdue_lead',
    intakeItemId: 'INTAKE-OTHER',
    resolution: 'return_to_pool',
    idempotencyKey: 'issue157-sales-timeout-forbidden',
  });
  assert.equal(result.response.status, 403);
  result = await act(salesFx, salesFx.otherCookie, {
    actionType: 'complete_manager_assistance',
    customerId: 'CRM-OTHER',
    result: '销售不可自行完成经理协助',
    idempotencyKey: 'issue157-sales-manager-forbidden',
  });
  assert.equal(result.response.status, 403);
  assert.equal(
    fxValue(salesFx, "SELECT status FROM crm_intake_items WHERE id='INTAKE-OTHER'", 'status'),
    'assigned',
  );
  assert.equal(
    fxValue(salesFx, "SELECT manager_required FROM crm_accounts WHERE id='CRM-OTHER'", 'manager_required'),
    1,
  );

  const managerFx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_alerts: true, view_team: true, manage_intake: false },
  });
  t.after(() => managerFx.close());
  seedOverdueLead(managerFx);
  seedNoNextPlan(managerFx, 'CRM-OTHER');
  seedManagerAssistance(managerFx, 'CRM-OTHER');
  result = await act(managerFx, managerFx.cookie, {
    actionType: 'resolve_overdue_lead',
    intakeItemId: 'INTAKE-OTHER',
    resolution: 'reassign',
    ownerId: 'U-OTHER',
    idempotencyKey: 'issue157-manager-without-intake',
  });
  assert.equal(result.response.status, 403);
  result = await act(managerFx, managerFx.cookie, {
    actionType: 'add_next_plan',
    customerId: 'CRM-OTHER',
    nextAction: '越权代填',
    nextActionAt: '2099-08-04 09:00:00',
    idempotencyKey: 'issue157-manager-out-of-scope-plan',
  });
  assert.equal(result.response.status, 403);
  result = await act(managerFx, managerFx.cookie, {
    actionType: 'complete_manager_assistance',
    customerId: 'CRM-OTHER',
    result: '越权完成',
    idempotencyKey: 'issue157-manager-out-of-scope-assist',
  });
  assert.equal(result.response.status, 403);

  const missingPermissionFx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_alerts: true, view_team: false },
  });
  t.after(() => missingPermissionFx.close());
  seedManagerAssistance(missingPermissionFx, 'CRM-OWN');
  result = await act(missingPermissionFx, missingPermissionFx.cookie, {
    actionType: 'complete_manager_assistance',
    customerId: 'CRM-OWN',
    result: '缺少管理权限',
    idempotencyKey: 'issue157-manager-without-team',
  });
  assert.equal(result.response.status, 403);
  assert.equal(
    fxValue(missingPermissionFx, "SELECT manager_required FROM crm_accounts WHERE id='CRM-OWN'", 'manager_required'),
    1,
  );
});

function fxValue(fx, sql, key) {
  return fx.db.prepare(sql).get()[key];
}

test('required fields are validated with 400 and stale business state returns 409', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  seedOverdueLead(fx);
  seedNoNextPlan(fx);
  seedManagerAssistance(fx, 'CRM-OWN');

  const invalid = [
    {
      actionType: 'resolve_overdue_lead', intakeItemId: 'INTAKE-OTHER',
      resolution: 'reassign', ownerId: '', idempotencyKey: 'issue157-invalid-owner',
    },
    {
      actionType: 'add_next_plan', customerId: 'CRM-OTHER',
      nextAction: '   ', nextActionAt: '2099-08-01 09:00:00',
      idempotencyKey: 'issue157-invalid-plan',
    },
    {
      actionType: 'add_next_plan', customerId: 'CRM-OTHER',
      nextAction: '有效计划', nextActionAt: 'not-a-date',
      idempotencyKey: 'issue157-invalid-date',
    },
    {
      actionType: 'complete_manager_assistance', customerId: 'CRM-OWN',
      result: '   ', idempotencyKey: 'issue157-invalid-result',
    },
  ];
  for (const payload of invalid) {
    const result = await act(fx, fx.adminCookie, payload);
    assert.equal(result.response.status, 400, JSON.stringify(payload));
    assert.equal(
      result.body.code,
      payload.nextActionAt === 'not-a-date' ? 'NEXT_ACTION_AT_INVALID' : 'TODAY_TASK_INVALID',
    );
  }
  assert.equal(fxValue(fx, "SELECT status FROM crm_intake_items WHERE id='INTAKE-OTHER'", 'status'), 'assigned');
  assert.equal(fxValue(fx, "SELECT next_action FROM crm_accounts WHERE id='CRM-OTHER'", 'next_action'), '');
  assert.equal(fxValue(fx, "SELECT manager_required FROM crm_accounts WHERE id='CRM-OWN'", 'manager_required'), 1);

  fx.db.prepare("UPDATE crm_intake_items SET claim_due_at='2099-08-01 09:00:00' WHERE id='INTAKE-OTHER'").run();
  let stale = await act(fx, fx.adminCookie, {
    actionType: 'resolve_overdue_lead',
    intakeItemId: 'INTAKE-OTHER',
    resolution: 'return_to_pool',
    idempotencyKey: 'issue157-stale-lead',
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.code, 'TODAY_TASK_STALE');
  fx.db.prepare(`UPDATE crm_accounts SET next_action='已经存在',next_action_at='2099-08-01 09:00:00'
    WHERE id='CRM-OTHER'`).run();
  stale = await act(fx, fx.adminCookie, {
    actionType: 'add_next_plan',
    customerId: 'CRM-OTHER',
    nextAction: '不可覆盖',
    nextActionAt: '2099-08-02 09:00:00',
    idempotencyKey: 'issue157-stale-plan',
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.code, 'TODAY_TASK_STALE');
  fx.db.prepare("UPDATE crm_accounts SET manager_required=0,manager_status='已完成' WHERE id='CRM-OWN'").run();
  stale = await act(fx, fx.adminCookie, {
    actionType: 'complete_manager_assistance',
    customerId: 'CRM-OWN',
    result: '不可重复完成',
    idempotencyKey: 'issue157-stale-manager',
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.code, 'TODAY_TASK_STALE');
});

test('transaction failure preserves the manager task and permits a clean retry with the same key', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  seedManagerAssistance(fx);
  const activityCount = fx.db.prepare(
    "SELECT COUNT(*) count FROM crm_activities WHERE customer_id='CRM-OTHER'",
  ).get().count;
  fx.db.exec(`CREATE TRIGGER issue157_fail_manager_audit
    BEFORE INSERT ON crm_audit_log
    WHEN NEW.action='today_task_manager_assistance_replied'
    BEGIN SELECT RAISE(ABORT,'issue157 forced audit failure'); END`);
  const request = {
    actionType: 'complete_manager_assistance',
    customerId: 'CRM-OTHER',
    result: '本次写入应整体回滚',
    idempotencyKey: 'issue157-manager-rollback',
  };
  const failed = await act(fx, fx.adminCookie, request);
  assert.ok(failed.response.status >= 400 && failed.response.status < 600);
  assert.deepEqual(
    fx.db.prepare(`SELECT manager_required,manager_status,manager_id
      FROM crm_accounts WHERE id='CRM-OTHER'`).get(),
    { manager_required: 1, manager_status: '待介入', manager_id: '' },
  );
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_activities WHERE customer_id='CRM-OTHER'").get().count,
    activityCount,
  );
  assert.ok(reasonCodes(
    taskFor((await bootstrap(fx, fx.adminCookie)).body, { customerId: 'CRM-OTHER' }),
  ).includes('MANAGER_NEEDED'));

  fx.db.exec('DROP TRIGGER issue157_fail_manager_audit');
  const retried = await act(fx, fx.adminCookie, request);
  assert.equal(retried.response.status, 200, retried.body.error);
  assert.equal(retried.body.deduplicated, false);
});
