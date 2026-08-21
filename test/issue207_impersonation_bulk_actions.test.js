'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

const MANAGER_PERMISSIONS = Object.freeze({
  view_customers: true,
  edit_customer: true,
  view_all_customers: true,
  view_intake: true,
  manage_intake: true,
  manage_customer_recycle: true,
});

async function responseBody(response) {
  return { status: response.status, body: await response.json() };
}

async function flushAudit() {
  await new Promise(resolve => setImmediate(resolve));
}

async function runAsManager(impersonated, seed, action) {
  const fx = await adminFixture();
  try {
    fx.setUserPermissions('U-MGR', MANAGER_PERMISSIONS);
    seed(fx);
    let cookie;
    let contextId = '';
    if (impersonated) {
      const started = await fx.startImpersonation('U-MGR');
      cookie = fx.adminCookie;
      contextId = started.impersonation.contextId;
    } else {
      cookie = await fx.login('manager@example.com', 'Password123!');
    }
    return await action({ fx, cookie, contextId, impersonated });
  } finally {
    await fx.close();
  }
}

function assertManagerAuditIdentity(row, context) {
  assert.ok(row, 'expected audit row');
  assert.equal(row.user_id, 'U-MGR');
  assert.equal(row.effective_user_id, 'U-MGR');
  assert.equal(row.real_user_id, context.impersonated ? 'USR-ADMIN' : 'U-MGR');
  assert.equal(row.impersonation_context_id, context.impersonated ? context.contextId : '');
}

function seedCrmBulkAccounts(fx) {
  const createdAt = '2026-08-03 01:00:00';
  const insertPool = fx.db.prepare(`INSERT INTO customer_pool
    (customer_id,company_name) VALUES (?,?)`);
  const insertAccount = fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,
     lifecycle_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const [accountId, externalId, companyName, ownerId, assignmentStatus] of [
    ['CRM-207-BULK-ASSIGN', 'RU-9201', 'Issue 207 Bulk Assign', 'U-MGR', 'claimed'],
    ['CRM-207-BULK-RETURN', 'RU-9202', 'Issue 207 Bulk Return', 'U-MGR', 'claimed'],
    ['CRM-207-OWNERLESS', 'RU-9203', 'Issue 207 Ownerless', null, 'unassigned'],
  ]) {
    insertPool.run(externalId, companyName);
    insertAccount.run(
      accountId,
      externalId,
      companyName,
      ownerId,
      'qualified',
      assignmentStatus,
      'active',
      createdAt,
      createdAt,
    );
  }
}

async function runCrmBulkScenario(impersonated) {
  return runAsManager(impersonated, seedCrmBulkAccounts, async context => {
    const { fx, cookie } = context;
    const ownerlessBefore = fx.db.prepare(`SELECT owner_id,assignment_status
      FROM crm_accounts WHERE id='CRM-207-OWNERLESS'`).get();
    assert.deepEqual(ownerlessBefore, { owner_id: null, assignment_status: 'unassigned' });

    const assigned = await responseBody(await fx.request('/api/sales-crm/accounts/bulk-assign', {
      cookie,
      method: 'POST',
      body: { customerIds: ['CRM-207-BULK-ASSIGN'], ownerId: 'U-OTHER' },
    }));
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));

    const returned = await responseBody(await fx.request('/api/sales-crm/accounts/bulk-return', {
      cookie,
      method: 'POST',
      body: {
        customerIds: ['CRM-207-BULK-RETURN', 'CRM-207-OWNERLESS'],
        reason: 'Issue 207 批量退回重新评估',
      },
    }));
    assert.equal(returned.status, 200, JSON.stringify(returned.body));
    await flushAudit();

    const assignmentAudit = fx.db.prepare(`SELECT * FROM crm_audit_log
      WHERE action='customer_bulk_assigned' AND entity_id='CRM-207-BULK-ASSIGN'
      ORDER BY rowid DESC LIMIT 1`).get();
    assertManagerAuditIdentity(assignmentAudit, context);
    const returnAudits = fx.db.prepare(`SELECT * FROM crm_audit_log
      WHERE action='customer_bulk_returned'
        AND entity_id IN ('CRM-207-BULK-RETURN','CRM-207-OWNERLESS')
      ORDER BY entity_id`).all();
    assert.equal(returnAudits.length, 2);
    for (const row of returnAudits) assertManagerAuditIdentity(row, context);

    const auditDetails = Object.fromEntries(returnAudits.map(row => [
      row.entity_id,
      JSON.parse(row.detail_json),
    ]));
    assert.equal(auditDetails['CRM-207-OWNERLESS'].previousOwnerId, '');
    for (const detail of Object.values(auditDetails)) {
      assert.ok(detail.intakeItemId);
      assert.equal(detail.intakeStatus, 'returned');
      detail.intakeItemId = '<generated>';
    }

    return {
      responses: {
        assign: assigned.body,
        return: returned.body,
      },
      accounts: fx.db.prepare(`SELECT id,owner_id,previous_owner_id,lifecycle_status,
        recycle_kind,assignment_status FROM crm_accounts WHERE id LIKE 'CRM-207-%'
        ORDER BY id`).all(),
      audits: {
        assignment: JSON.parse(assignmentAudit.detail_json),
        returns: auditDetails,
      },
    };
  });
}

test('Issue 207 keeps CRM bulk assignment and ownerless bulk return equivalent', async () => {
  const direct = await runCrmBulkScenario(false);
  const inspected = await runCrmBulkScenario(true);
  assert.deepEqual(inspected, direct);
  assert.deepEqual(direct.responses, {
    assign: { ok: true, updated: 1, ownerId: 'U-OTHER' },
    return: { ok: true, updated: 2, returnedToPool: true },
  });
  assert.equal(
    direct.accounts.find(row => row.id === 'CRM-207-BULK-ASSIGN').owner_id,
    'U-OTHER',
  );
  assert.deepEqual(
    direct.accounts.filter(row => row.id !== 'CRM-207-BULK-ASSIGN')
      .map(row => ({
        id: row.id,
        ownerId: row.owner_id,
        lifecycleStatus: row.lifecycle_status,
        recycleKind: row.recycle_kind,
        assignmentStatus: row.assignment_status,
      })),
    [
      {
        id: 'CRM-207-BULK-RETURN', ownerId: null, lifecycleStatus: 'active',
        recycleKind: '', assignmentStatus: 'returned',
      },
      {
        id: 'CRM-207-OWNERLESS', ownerId: null, lifecycleStatus: 'active',
        recycleKind: '', assignmentStatus: 'returned',
      },
    ],
  );
});

function seedManualAssignmentItems(fx) {
  const insert = fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,
     assigned_at,claim_due_at,claimed_at,duplicate_state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [itemId, externalId] of [
    ['I207-BULK-A', 'BR-207-BULK-A'],
    ['I207-BULK-B', 'BR-207-BULK-B'],
  ]) {
    insert.run(
      itemId,
      'BATCH-TEST',
      externalId,
      itemId,
      'pending',
      '',
      '',
      '',
      '',
      'cleared',
      '2026-08-03 01:00:00',
      '2026-08-03 01:00:00',
    );
  }
}

async function runManualAssignmentScenario(impersonated) {
  return runAsManager(impersonated, seedManualAssignmentItems, async context => {
    const { fx, cookie } = context;
    const itemIds = ['I207-BULK-A', 'I207-BULK-B'];
    const preview = await responseBody(await fx.request('/api/sales-crm/intake/action', {
      cookie,
      method: 'POST',
      body: { action: 'manual_assign_preview', itemIds },
    }));
    assert.equal(preview.status, 200, JSON.stringify(preview.body));

    const committed = await responseBody(await fx.request('/api/sales-crm/intake/action', {
      cookie,
      method: 'POST',
      body: {
        action: 'manual_assign',
        itemIds,
        ownerId: 'U-OTHER',
        amount: 2,
        idempotencyKey: 'issue207-manual-bulk-assignment',
        previewToken: preview.body.previewToken || '',
      },
    }));
    assert.equal(committed.status, 200, JSON.stringify(committed.body));
    await flushAudit();

    const routeAudits = fx.db.prepare(`SELECT * FROM crm_audit_log
      WHERE action='POST /api/sales-crm/intake/action' ORDER BY rowid`).all();
    assert.equal(routeAudits.length, 2);
    for (const row of routeAudits) assertManagerAuditIdentity(row, context);

    return {
      preview: {
        action: preview.body.action,
        scopeType: preview.body.scopeType,
        scopeTotal: preview.body.scopeTotal,
        eligibleCount: preview.body.eligibleCount,
        blockedCount: preview.body.blockedCount,
      },
      committed: committed.body,
      items: fx.db.prepare(`SELECT id,status,assigned_owner_id,
        CASE WHEN assigned_at!='' THEN 1 ELSE 0 END has_assigned_at,
        CASE WHEN claim_due_at!='' THEN 1 ELSE 0 END has_claim_due_at
        FROM crm_intake_items WHERE id IN ('I207-BULK-A','I207-BULK-B')
        ORDER BY id`).all(),
      decisions: fx.db.prepare(`SELECT intake_item_id,manual_decision_json
        FROM crm_intake_decisions WHERE intake_item_id IN ('I207-BULK-A','I207-BULK-B')
        ORDER BY intake_item_id`).all().map(row => ({
        itemId: row.intake_item_id,
        decision: JSON.parse(row.manual_decision_json),
      })),
    };
  });
}

test('Issue 207 keeps manual assignment preview and commit equivalent', async () => {
  const direct = await runManualAssignmentScenario(false);
  const inspected = await runManualAssignmentScenario(true);
  assert.deepEqual(inspected, direct);
  assert.deepEqual(direct.preview, {
    action: 'manual_assign_preview',
    scopeType: 'selection',
    scopeTotal: 2,
    eligibleCount: 2,
    blockedCount: 0,
  });
  assert.equal(direct.committed.assigned, 2);
  assert.deepEqual(direct.committed.assignedIds, ['I207-BULK-A', 'I207-BULK-B']);
  assert.equal(direct.items.every(row => row.status === 'assigned'), true);
  assert.equal(direct.items.every(row => row.assigned_owner_id === 'U-OTHER'), true);
  assert.equal(direct.items.every(row => row.has_assigned_at === 1), true);
  assert.equal(direct.items.every(row => row.has_claim_due_at === 1), true);
  assert.equal(direct.decisions.every(row => row.decision.action === 'manual_assign'), true);
});
