'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');
const { upsertManagerTask } = require('../lib/manager_tasks');

const ACTORS = {
  'U-MGR': ['manager@example.com', 'Password123!'],
  'U-OTHER': ['other@example.com', 'Password123!'],
};

async function flushAudit() {
  await new Promise(resolve => setImmediate(resolve));
}

async function responseBody(response) {
  return { status: response.status, body: await response.json() };
}

async function runAs({ targetId, impersonated, permissions = {}, seed }, action) {
  const fx = await adminFixture();
  try {
    if (Object.keys(permissions).length) fx.setUserPermissions(targetId, permissions);
    if (seed) seed(fx);
    let cookie;
    let contextId = '';
    if (impersonated) {
      const started = await fx.startImpersonation(targetId);
      cookie = fx.adminCookie;
      contextId = started.impersonation.contextId;
    } else {
      const credentials = ACTORS[targetId];
      assert.ok(credentials, `missing direct-login credentials for ${targetId}`);
      cookie = await fx.login(...credentials);
    }
    return await action({ fx, cookie, contextId, targetId, impersonated });
  } finally {
    await fx.close();
  }
}

function latestAudit(fx, action, entityId = null) {
  return entityId === null
    ? fx.db.prepare(`SELECT * FROM crm_audit_log WHERE action=?
      ORDER BY rowid DESC LIMIT 1`).get(action)
    : fx.db.prepare(`SELECT * FROM crm_audit_log WHERE action=? AND entity_id=?
      ORDER BY rowid DESC LIMIT 1`).get(action, entityId);
}

function assertIdentity(row, { targetId, impersonated, contextId }) {
  assert.ok(row, 'expected audit row');
  assert.equal(row.user_id, targetId);
  assert.equal(row.effective_user_id, targetId);
  assert.equal(row.real_user_id, impersonated ? 'USR-ADMIN' : targetId);
  assert.equal(row.impersonation_context_id, impersonated ? contextId : '');
}

function installSecondSales(fx) {
  fx.db.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,
     languages_json,countries_json,channels_json,permission_group_id,created_at,updated_at)
    SELECT 'U-207-NEW','issue207-new@example.com','Issue 207 New','sales',
      password_hash,password_salt,1,0,'[]','[]','[]',permission_group_id,created_at,updated_at
    FROM sales_users WHERE id='U-OTHER'`).run();
}

function seedTodayTasks(fx) {
  installSecondSales(fx);
  const insert = fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,
     suggested_owner_id,assigned_at,claim_due_at,claimed_at,crm_customer_id,
     duplicate_state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [id, externalId, accountId] of [
    ['I207-REASSIGN', 'BR-2071', 'CRM-OTHER'],
    ['I207-RETURN', 'BR-2072', ''],
  ]) {
    insert.run(
      id, 'BATCH-TEST', externalId, id, 'assigned', 'U-OTHER', 'U-OTHER',
      '2026-07-20 08:00:00', '2000-01-01 00:00:00', '', accountId,
      'cleared', '2026-07-20 08:00:00', '2026-07-20 08:00:00',
    );
  }
  fx.db.prepare(`UPDATE crm_accounts SET intake_item_id='I207-REASSIGN',
    owner_id='U-OTHER',assignment_status='assigned',assigned_at='2026-07-20 08:00:00',
    claim_due_at='2000-01-01 00:00:00',claimed_at='',next_action='',next_action_at=''
    WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET manager_required=1,manager_status='待介入',
    manager_id='',next_action='等待经理协助',next_action_at='2099-08-01 01:00:00'
    WHERE id='CRM-OWN'`).run();
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,summary,manager_required,occurred_at,created_at)
    VALUES ('ACT-207-REQUEST','CRM-OWN','U-OTHER','reply',
      '请主管确认价格与账期',1,'2026-07-30 10:00:00','2026-07-30 10:00:00')`).run();
}

async function runTodayTaskScenario(impersonated) {
  return runAs({ targetId: 'U-MGR', impersonated, seed: seedTodayTasks }, async context => {
    const { fx, cookie } = context;
    const requests = [
      {
        actionType: 'resolve_overdue_lead', intakeItemId: 'I207-REASSIGN',
        resolution: 'reassign', ownerId: 'U-207-NEW',
        idempotencyKey: 'issue207-overdue-reassign',
      },
      {
        actionType: 'resolve_overdue_lead', intakeItemId: 'I207-RETURN',
        resolution: 'return_to_pool', idempotencyKey: 'issue207-overdue-return',
      },
      {
        actionType: 'add_next_plan', customerId: 'CRM-OTHER',
        nextAction: '确认下一轮报价和交期', nextActionAt: '2099-08-03 10:00:00',
        idempotencyKey: 'issue207-next-plan',
      },
      {
        actionType: 'complete_manager_assistance', customerId: 'CRM-OWN',
        result: '已批准特殊价格，并要求销售确认账期',
        idempotencyKey: 'issue207-manager-assistance',
      },
    ];
    const results = [];
    for (const body of requests) {
      const result = await responseBody(await fx.request('/api/sales-crm/today-tasks/actions', {
        cookie, method: 'POST', body,
      }));
      assert.equal(result.status, 200, JSON.stringify(result.body));
      results.push({
        actionType: result.body.actionType,
        resolution: result.body.resolution || '',
        previousOwnerId: result.body.previousOwnerId || '',
        ownerId: result.body.ownerId || '',
        delegated: Boolean(result.body.delegated),
        customerId: result.body.customerId || '',
        intakeItemId: result.body.intakeItemId || '',
      });
    }
    await flushAudit();
    for (const [action, entityId] of [
      ['today_task_overdue_lead_resolved', 'I207-REASSIGN'],
      ['today_task_overdue_lead_resolved', 'I207-RETURN'],
      ['today_task_next_plan_added', 'CRM-OTHER'],
      ['today_task_manager_assistance_replied', 'CRM-OWN'],
    ]) assertIdentity(latestAudit(fx, action, entityId), context);
    return {
      results,
      intake: fx.db.prepare(`SELECT id,status,assigned_owner_id,return_reason
        FROM crm_intake_items WHERE id LIKE 'I207-%' ORDER BY id`).all(),
      accounts: fx.db.prepare(`SELECT id,owner_id,assignment_status,next_action,
        manager_required,manager_status,manager_id FROM crm_accounts
        WHERE id IN ('CRM-OTHER','CRM-OWN') ORDER BY id`).all(),
      managerActivity: fx.db.prepare(`SELECT customer_id,user_id,activity_type,summary
        FROM crm_activities WHERE activity_type='manager_join' ORDER BY rowid DESC LIMIT 1`).get(),
    };
  });
}

test('Issue 207 makes direct and inspected today-task business results equivalent', async () => {
  const direct = await runTodayTaskScenario(false);
  const inspected = await runTodayTaskScenario(true);
  assert.deepEqual(inspected, direct);
});

async function runManagerTaskScenario(impersonated) {
  const previous = process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
  process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = 'true';
  try {
    return await runAs({ targetId: 'U-MGR', impersonated }, async context => {
      const { fx, cookie } = context;
      const task = upsertManagerTask(fx.db, {
        customerId: 'RU-9003',
        reason: 'consecutive_deferred',
        actorIdSnapshot: 'U-OTHER',
        ownerIdSnapshot: 'U-OTHER',
        triggeredAt: '2026-08-01 01:00:00',
      });
      const result = await responseBody(await fx.request(
        `/api/sales-crm/manager-tasks/${task.id}/resolve`,
        {
          cookie, method: 'POST', body: {
            type: 'manager_advice', note: '先确认采购窗口再推进',
            nextAction: '确认采购窗口', nextActionAt: '2099-08-03 09:00:00',
            idempotencyKey: 'issue207-manager-resolve',
          },
        },
      ));
      assert.equal(result.status, 200, JSON.stringify(result.body));
      await flushAudit();
      assertIdentity(latestAudit(fx, 'manager_task_resolved', task.id), context);
      return {
        task: fx.db.prepare('SELECT status,resolved_by FROM crm_manager_tasks WHERE id=?').get(task.id),
        account: fx.db.prepare(`SELECT next_action,next_action_at,next_action_time_basis
          FROM crm_accounts WHERE id='CRM-OTHER'`).get(),
        intervention: fx.db.prepare(`SELECT actor_id,action,note
          FROM crm_manager_interventions WHERE task_id=?`).get(task.id),
        activity: fx.db.prepare(`SELECT customer_id,user_id,activity_type,summary
          FROM crm_activities WHERE activity_type='manager_advice' ORDER BY rowid DESC LIMIT 1`).get(),
      };
    });
  } finally {
    if (previous === undefined) delete process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
    else process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = previous;
  }
}

test('Issue 207 makes direct and inspected manager-task resolution equivalent', async () => {
  assert.deepEqual(await runManagerTaskScenario(true), await runManagerTaskScenario(false));
});

async function runDeferredPlanScenario(impersonated) {
  const previous = process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
  process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = 'true';
  try {
    return await runAs({ targetId: 'U-OTHER', impersonated }, async context => {
      const { fx, cookie } = context;
      fx.db.prepare(`UPDATE crm_accounts SET next_action='确认BOM',
        next_action_at='2099-08-01 01:00:00',next_action_time_basis='utc'
        WHERE id='CRM-OTHER'`).run();
      const result = await responseBody(await fx.request(
        '/api/sales-crm/accounts/CRM-OTHER/deferred-plan',
        {
          cookie,
          method: 'POST',
          body: {
            reviewAt: '2099-08-02 09:00:00',
            reason: '等待客户内部确认',
            idempotencyKey: 'issue207-deferred-plan',
          },
        },
      ));
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.deduplicated, false);
      await flushAudit();
      const audit = latestAudit(fx, 'customer_plan_deferred', 'CRM-OTHER');
      assertIdentity(audit, context);
      const auditDetail = JSON.parse(audit.detail_json);
      return {
        response: {
          customerId: result.body.customerId,
          reviewAt: result.body.reviewAt,
          deduplicated: result.body.deduplicated,
        },
        account: fx.db.prepare(`SELECT next_action,next_action_at,next_action_time_basis
          FROM crm_accounts WHERE id='CRM-OTHER'`).get(),
        event: fx.db.prepare(`SELECT customer_id,actor_id,owner_id_snapshot,review_at,
          reason,source,source_event_id FROM crm_deferred_plan_events
          WHERE source_event_id='issue207-deferred-plan'`).get(),
        audit: {
          reviewAt: auditDetail.reviewAt,
          source: auditDetail.source,
        },
      };
    });
  } finally {
    if (previous === undefined) delete process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
    else process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = previous;
  }
}

test('Issue 207 makes direct and inspected deferred-plan writes equivalent', async () => {
  assert.deepEqual(await runDeferredPlanScenario(true), await runDeferredPlanScenario(false));
});

function seedRecycleAccounts(fx) {
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-9003',crm_customer_id='CRM-OTHER',
    status='claimed',assigned_owner_id='U-OTHER',duplicate_state='cleared'
    WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET external_customer_id='RU-9003',intake_item_id='INTAKE-OTHER',
    assignment_status='claimed' WHERE id='CRM-OTHER'`).run();
}

async function runRecycleScenario(impersonated) {
  return runAs({ targetId: 'U-MGR', impersonated, seed: seedRecycleAccounts }, async context => {
    const { fx, cookie } = context;
    const returned = await responseBody(await fx.request('/api/sales-crm/accounts/CRM-OTHER/return', {
      cookie, method: 'POST', body: { reason: '区域暂不匹配，退回重新评估' },
    }));
    assert.equal(returned.status, 200, JSON.stringify(returned.body));
    const assigned = await responseBody(await fx.request('/api/sales-crm/intake/action', {
      cookie, method: 'POST', body: { action: 'assign', itemId: 'INTAKE-OTHER', ownerId: 'U-OTHER' },
    }));
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    await flushAudit();
    assertIdentity(latestAudit(fx, 'customer_returned', 'CRM-OTHER'), context);
    return fx.db.prepare(`SELECT owner_id,previous_owner_id,lifecycle_status,recycle_kind,
      assignment_status FROM crm_accounts WHERE id='CRM-OTHER'`).get();
  });
}

test('Issue 207 makes CRM return and lead-pool reassignment equivalent', async () => {
  assert.deepEqual(await runRecycleScenario(true), await runRecycleScenario(false));
});

function seedIntakeActions(fx) {
  installSecondSales(fx);
  const insert = fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,
     assigned_at,claim_due_at,claimed_at,duplicate_state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run('I207-PENDING', 'BATCH-TEST', 'BR-2073', 'Issue 207 Pending', 'pending', '',
    '', '', '', 'cleared', '2026-08-01 01:00:00', '2026-08-01 01:00:00');
  insert.run('I207-ASSIGNED', 'BATCH-TEST', 'BR-2074', 'Issue 207 Assigned', 'assigned',
    'U-OTHER', '2026-08-01 01:00:00', '2099-08-02 01:00:00', '', 'cleared',
    '2026-08-01 01:00:00', '2026-08-01 01:00:00');
  insert.run('I207-REASSIGN', 'BATCH-TEST', 'BR-2075', 'Issue 207 Reassign', 'assigned',
    'U-OTHER', '2026-08-01 01:00:00', '2099-08-02 01:00:00', '', 'cleared',
    '2026-08-01 01:00:00', '2026-08-01 01:00:00');
}

async function runIntakeScenario(impersonated) {
  return runAs({ targetId: 'U-MGR', impersonated, seed: seedIntakeActions }, async context => {
    const { fx, cookie } = context;
    const responses = [];
    for (const body of [
      { action: 'assign', itemId: 'I207-PENDING', ownerId: 'U-OTHER' },
      { action: 'unassign', itemId: 'I207-ASSIGNED' },
      { action: 'assign', itemId: 'I207-REASSIGN', ownerId: 'U-207-NEW' },
    ]) {
      const result = await responseBody(await fx.request('/api/sales-crm/intake/action', {
        cookie, method: 'POST', body,
      }));
      assert.equal(result.status, 200, JSON.stringify(result.body));
      responses.push(result.body);
    }
    await flushAudit();
    const audits = fx.db.prepare(`SELECT * FROM crm_audit_log
      WHERE action='POST /api/sales-crm/intake/action' ORDER BY rowid DESC LIMIT 3`).all();
    assert.equal(audits.length, 3);
    for (const row of audits) assertIdentity(row, context);
    const reassignDecision = fx.db.prepare(`SELECT manual_decision_json FROM crm_intake_decisions
      WHERE intake_item_id='I207-REASSIGN' ORDER BY rowid DESC LIMIT 1`).get();
    return {
      responses,
      items: fx.db.prepare(`SELECT id,status,assigned_owner_id,assigned_at,claim_due_at
        FROM crm_intake_items WHERE id LIKE 'I207-%' ORDER BY id`).all()
        .map(row => ({
          ...row,
          assigned_at: Boolean(row.assigned_at),
          claim_due_at: Boolean(row.claim_due_at),
        })),
      reassignDecision: JSON.parse(reassignDecision.manual_decision_json),
    };
  });
}

test('Issue 207 makes intake assignment, unassignment, and reassignment equivalent', async () => {
  const direct = await runIntakeScenario(false);
  const inspected = await runIntakeScenario(true);
  assert.deepEqual(inspected, direct);
  assert.deepEqual(direct.responses[2], {
    ok: true,
    action: 'assign',
    itemId: 'I207-REASSIGN',
    ownerId: 'U-207-NEW',
    reason: '管理员重新分配',
  });
  assert.equal(
    direct.items.find(row => row.id === 'I207-REASSIGN').assigned_owner_id,
    'U-207-NEW',
  );
  assert.deepEqual(direct.reassignDecision, {
    action: 'assign',
    status: 'assigned',
    ownerId: 'U-207-NEW',
    previousOwnerId: 'U-OTHER',
    reason: '管理员重新分配',
  });
});

async function runActivityScenario(impersonated) {
  return runAs({ targetId: 'U-OTHER', impersonated }, async context => {
    const { fx, cookie } = context;
    const reactions = await responseBody(await fx.request('/api/sales-crm/activity-reactions', {
      cookie,
    }));
    assert.equal(reactions.status, 200, JSON.stringify(reactions.body));
    assert.ok(reactions.body.reactions.length > 0, 'expected an active reaction option');
    const allowed = await responseBody(await fx.request('/api/sales-crm/activities', {
      cookie, method: 'POST', body: {
        customerId: 'CRM-OTHER', progressType: 'email',
        reactionOptionId: reactions.body.reactions[0].id,
        summary: 'Issue 207 首次触达', nextAction: '继续跟进',
        nextActionAt: '2099-08-01 09:00:00', occurredAt: '2026-07-31 09:00:00',
        managerRequired: false,
      },
    }));
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    const beforeDenied = fx.db.prepare(`SELECT COUNT(*) count FROM crm_activities
      WHERE customer_id='CRM-OWN'`).get().count;
    const denied = await responseBody(await fx.request('/api/sales-crm/activities', {
      cookie, method: 'POST', body: {
        customerId: 'CRM-OWN', progressType: 'email',
        reactionOptionId: reactions.body.reactions[0].id,
        summary: '越权触达不应写入', nextAction: '越权计划',
        nextActionAt: '2099-08-01 09:00:00', occurredAt: '2026-07-31 09:00:00',
        managerRequired: false,
      },
    }));
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_activities
      WHERE customer_id='CRM-OWN'`).get().count, beforeDenied);
    await flushAudit();
    assertIdentity(latestAudit(fx, 'POST /api/sales-crm/activities'), context);
    assertIdentity(latestAudit(fx, 'permission_denied'), context);
    return {
      allowed: fx.db.prepare(`SELECT customer_id,user_id,activity_type,channel,outcome,summary
        FROM crm_activities WHERE summary='Issue 207 首次触达'`).get(),
      deniedStatus: denied.status,
    };
  });
}

test('Issue 207 keeps direct and inspected activity scope and first-contact writes equivalent', async () => {
  assert.deepEqual(await runActivityScenario(true), await runActivityScenario(false));
});

test('Issue 207 returns 403 and audits the target for an out-of-scope recycle request', async () => {
  await runAs({
    targetId: 'U-OTHER',
    impersonated: true,
    permissions: { manage_customer_recycle: true },
  }, async context => {
    const { fx, cookie } = context;
    const before = fx.db.prepare(`SELECT lifecycle_status,assignment_status,owner_id
      FROM crm_accounts WHERE id='CRM-OWN'`).get();
    const denied = await responseBody(await fx.request('/api/sales-crm/accounts/CRM-OWN/return', {
      cookie,
      method: 'POST',
      body: { reason: '超出被检查账号数据范围' },
    }));
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(denied.body.code, 'CUSTOMER_RECYCLE_FORBIDDEN');
    assert.deepEqual(fx.db.prepare(`SELECT lifecycle_status,assignment_status,owner_id
      FROM crm_accounts WHERE id='CRM-OWN'`).get(), before);

    await flushAudit();
    const audit = latestAudit(fx, 'permission_denied', 'CRM-OWN');
    assertIdentity(audit, context);
    assert.deepEqual(JSON.parse(audit.detail_json), {
      route: 'POST /accounts/:customerId/return',
      result: 'rejected',
      statusCode: 403,
      code: 'CUSTOMER_RECYCLE_FORBIDDEN',
      permission: 'target_scope',
    });
  });
});

test('Issue 207 audit handling rejects non-scalar target IDs without crashing the request', async () => {
  await runAs({ targetId: 'U-OTHER', impersonated: true }, async context => {
    const { fx, cookie } = context;
    const denied = await responseBody(await fx.request('/api/sales-crm/activities', {
      cookie,
      method: 'POST',
      body: { customerId: {}, progressType: 'email' },
    }));
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    await flushAudit();
    const audit = latestAudit(fx, 'permission_denied');
    assertIdentity(audit, context);
    assert.equal(audit.entity_id, '');
    assert.equal(JSON.parse(audit.detail_json).result, 'rejected');
  });
});

test('Issue 207 blocks security operations with an exact safety error and dual identity', async () => {
  await runAs({
    targetId: 'U-MGR',
    impersonated: true,
    permissions: {
      view_users: true,
      manage_users: true,
      manage_data_maintenance: true,
      resolve_duplicate_reviews: true,
      run_recon: true,
      view_recon: true,
      view_contacts: true,
    },
  }, async context => {
    const { fx, cookie } = context;
    const before = {
      users: fx.db.prepare('SELECT COUNT(*) count FROM sales_users').get().count,
      reconJobs: fx.db.prepare('SELECT COUNT(*) count FROM recon_jobs').get().count,
      contactReconJobs: fx.db.prepare('SELECT COUNT(*) count FROM contact_recon_jobs').get().count,
      intakeBatches: fx.db.prepare('SELECT COUNT(*) count FROM crm_intake_batches').get().count,
      settings: fx.db.prepare(`SELECT enabled,claim_sla_hours,contact_sla_hours
        FROM crm_intake_settings WHERE id='default'`).get(),
    };
    const cases = [
      ['/api/sales-crm/password', 'POST', {
        oldPassword: 'Password123!', newPassword: 'Blocked123!',
      }],
      ['/api/sales-crm/users', 'POST', {
        email: 'blocked-207@example.com', name: 'Blocked', role: 'sales',
        permissionGroupId: fx.salesGroupId, password: 'Password123!',
      }],
      ['/api/sales-crm/users/U-OTHER/permission-overrides', 'PUT', {
        view_contacts: 'allow',
      }],
      ['/api/sales-crm/permission-groups', 'POST', {
        name: 'Blocked Group', role: 'sales', permissions: { view_contacts: true },
      }],
      ['/api/sales-crm/data-maintenance/preview', 'POST', {}],
      ['/api/sales-crm/impersonation/start', 'POST', { targetUserId: 'U-OTHER' }],
      ['/api/sales-crm/duplicate-reviews/ISSUE-207-BLOCKED/resolve', 'POST', {
        resolution: 'confirmed_distinct',
      }],
      ['/api/app', 'POST', {
        action: 'createReconJob', customerId: 'RU-9002',
      }],
      ['/api/app', 'POST', {
        action: 'retryReconJob', jobId: 'JOB-OWN',
      }],
      ['/api/app', 'POST', {
        action: 'createContactReconJob', customerId: 'RU-9002',
      }],
      ['/api/assistant/runtime', 'PATCH', { mode: 'auto' }],
      ['/api/assistant/runtime/recheck', 'POST', {}],
      ['/api/sales-crm/intake/scan', 'POST', {}],
      ['/api/sales-crm/intake/settings', 'PATCH', {
        enabled: false, claimSlaHours: 2, contactSlaHours: 2,
      }],
    ];
    for (const [route, method, body] of cases) {
      const result = await responseBody(await fx.request(route, { cookie, method, body }));
      assert.equal(result.status, 403, route);
      assert.deepEqual(result.body, {
        ok: false,
        error: '身份检查期间禁止此安全操作',
        code: 'IMPERSONATION_ACTION_BLOCKED',
      }, route);
    }
    await flushAudit();
    const denied = fx.db.prepare(`SELECT * FROM crm_audit_log
      WHERE action='permission_denied' ORDER BY rowid DESC LIMIT ?`).all(cases.length);
    assert.equal(denied.length, cases.length);
    for (const row of denied) assertIdentity(row, context);
    assert.deepEqual({
      users: fx.db.prepare('SELECT COUNT(*) count FROM sales_users').get().count,
      reconJobs: fx.db.prepare('SELECT COUNT(*) count FROM recon_jobs').get().count,
      contactReconJobs: fx.db.prepare('SELECT COUNT(*) count FROM contact_recon_jobs').get().count,
      intakeBatches: fx.db.prepare('SELECT COUNT(*) count FROM crm_intake_batches').get().count,
      settings: fx.db.prepare(`SELECT enabled,claim_sla_hours,contact_sla_hours
        FROM crm_intake_settings WHERE id='default'`).get(),
    }, before);
  });
});
