'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

function envelope(filters = {}) {
  return encodeURIComponent(JSON.stringify(filters));
}

function utcStamp(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function utcDay() {
  return utcStamp().slice(0, 10);
}

function seedIntakeItems(fx) {
  const insert = fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,
     assigned_at,claim_due_at,claimed_at,return_reason,decision_reason,
     duplicate_state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const yesterday = new Date(Date.now() - 86400000);
  const now = utcStamp();
  const today = utcDay();
  const pastDue = '2000-01-01 00:00:00';
  insert.run('I212-PENDING', 'BATCH-TEST', 'BR-2121', 'Issue212 Pending', 'pending', '',
    '', '', '', '', '', 'cleared', `${today} 08:00:00`, now);
  insert.run('I212-ASSIGNED', 'BATCH-TEST', 'BR-2122', 'Issue212 Assigned', 'assigned', 'U-OTHER',
    now, pastDue, '', '', '待领取', 'cleared', `${today} 09:00:00`, now);
  insert.run('I212-ASSIGNED-FRESH', 'BATCH-TEST', 'BR-2123', 'Issue212 Assigned Fresh', 'assigned', 'U-OTHER',
    now, '2099-01-01 00:00:00', '', '', '待领取', 'cleared', `${yesterday.toISOString().slice(0, 10)} 09:00:00`, now);
  insert.run('I212-CLAIMED', 'BATCH-TEST', 'BR-2124', 'Issue212 Claimed', 'claimed', 'U-OTHER',
    now, now, now, '', '', 'cleared', `${today} 10:00:00`, now);
  fx.db.prepare(`UPDATE crm_intake_items SET crm_customer_id='CRM-212-CLAIMED'
    WHERE id='I212-CLAIMED'`).run();
  insert.run('I212-RETURNED', 'BATCH-TEST', 'BR-2125', 'Issue212 Returned', 'returned', 'U-OTHER',
    now, '', '', '测试退回', '退回', 'cleared', `${today} 11:00:00`, now);
  insert.run('I212-REJECTED', 'BATCH-TEST', 'BR-2126', 'Issue212 Rejected', 'rejected', 'U-OTHER',
    now, '', '', '不对口', '不对口', 'cleared', `${today} 12:00:00`, now);
  insert.run('I212-DUPLICATE', 'BATCH-TEST', 'BR-2127', 'Issue212 Duplicate', 'duplicate', '',
    '', '', '', '', '客户已在CRM', 'exact', `${today} 13:00:00`, now);
}

function seedSecondSales(fx) {
  fx.db.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,
     languages_json,countries_json,channels_json,permission_group_id,created_at,updated_at)
    SELECT 'U-SALES2','sales2@example.com','Sales Two','sales',password_hash,password_salt,1,0,
     '[]','[]','[]',permission_group_id,created_at,updated_at
    FROM sales_users WHERE id='U-OTHER'`).run();
}

function seedIntakeFlowAccounts(fx) {
  const insert = fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,
     intake_item_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const now = utcStamp();
  insert.run('CRM-212-CLAIMED', 'BR-2124', 'Issue212 Claimed Account', 'U-OTHER',
    'contacted', 'claimed', 'I212-CLAIMED', now, now);
  insert.run('CRM-212-CONTACTED', 'BR-2128', 'Issue212 Contacted Account', 'U-OTHER',
    'won', 'claimed', 'I212-CONTACTED', now, now);
  insert.run('CRM-212-ASSIGNED', 'BR-2129', 'Issue212 Assigned Account', 'U-OTHER',
    'qualified', 'assigned', 'I212-ASSIGNED-FRESH', now, now);
  const insertPool = fx.db.prepare('INSERT INTO customer_pool(customer_id,company_name) VALUES (?,?)');
  insertPool.run('BR-2124', 'Issue212 Claimed Account');
  insertPool.run('BR-2128', 'Issue212 Contacted Account');
  insertPool.run('BR-2129', 'Issue212 Assigned Account');
}

async function intakeSchema(fx) {
  return fx.requestJson('/api/sales-crm/filter-schema/intake', { cookie: fx.adminCookie });
}

test('Issue 212 unifies the lead list scope to actionable statuses', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);

  const result = await fx.requestJson(`/api/sales-crm/lists/intake?filters=${envelope({
    search: { operator: 'contains', value: 'Issue212' },
  })}`, { cookie: fx.adminCookie });
  const statuses = [...new Set(result.rows.map(row => row.status))].sort();
  assert.deepEqual(statuses, ['assigned', 'pending', 'returned']);

  const schema = await intakeSchema(fx);
  const keys = schema.schema.fields.map(field => field.key);
  assert.ok(keys.includes('created_today'));
  assert.ok(keys.includes('claim_overdue'));
  const statusField = schema.schema.fields.find(field => field.key === 'status');
  assert.deepEqual(
    Object.fromEntries(statusField.options.map(option => [option.value, option.label])),
    {
      approved: '待分配', assigned: '待领取', pending: '待分配', returned: '已退回',
    },
  );
});

test('Issue 212 today-sync and overdue-claim filters are SQL-backed', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);

  const today = await fx.requestJson(`/api/sales-crm/lists/intake?filters=${envelope({
    search: { operator: 'contains', value: 'Issue212' },
    created_today: { operator: 'in', values: ['true'] },
  })}`, { cookie: fx.adminCookie });
  assert.equal(today.rows.some(row => row.id === 'I212-PENDING'), true);
  assert.equal(today.rows.some(row => row.id === 'I212-ASSIGNED-FRESH'), false);

  const overdue = await fx.requestJson(`/api/sales-crm/lists/intake?filters=${envelope({
    search: { operator: 'contains', value: 'Issue212' },
    status: { operator: 'in', values: ['assigned'] },
    claim_overdue: { operator: 'in', values: ['true'] },
  })}`, { cookie: fx.adminCookie });
  assert.deepEqual(overdue.rows.map(row => row.id), ['I212-ASSIGNED']);

  const notToday = await fx.requestJson(`/api/sales-crm/lists/intake?filters=${envelope({
    search: { operator: 'contains', value: 'Issue212' },
    created_today: { operator: 'in', values: ['false'] },
  })}`, { cookie: fx.adminCookie });
  assert.deepEqual(notToday.rows.map(row => row.id), ['I212-ASSIGNED-FRESH']);

  const notOverdue = await fx.requestJson(`/api/sales-crm/lists/intake?filters=${envelope({
    search: { operator: 'contains', value: 'Issue212' },
    status: { operator: 'in', values: ['assigned'] },
    claim_overdue: { operator: 'in', values: ['false'] },
  })}`, { cookie: fx.adminCookie });
  assert.deepEqual(notOverdue.rows.map(row => row.id), ['I212-ASSIGNED-FRESH']);
});

test('Issue 212 unassign restores pending state, clears owner and SLA, and audits the change', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'unassign', itemId: 'I212-ASSIGNED' },
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), {
    ok: true, action: 'unassign', itemId: 'I212-ASSIGNED', previousOwnerId: 'U-OTHER',
  });
  const row = fx.db.prepare("SELECT * FROM crm_intake_items WHERE id='I212-ASSIGNED'").get();
  assert.equal(row.status, 'pending');
  assert.equal(row.assigned_owner_id, '');
  assert.equal(row.assigned_at, '');
  assert.equal(row.claim_due_at, '');
  assert.equal(row.decision_reason, '管理员取消分配');
  const decision = fx.db.prepare(`SELECT * FROM crm_intake_decisions
    WHERE intake_item_id='I212-ASSIGNED' ORDER BY created_at DESC,id DESC LIMIT 1`).get();
  assert.equal(decision.decision_type, 'manual');
  assert.deepEqual(JSON.parse(decision.manual_decision_json), {
    action: 'unassign', status: 'pending', ownerId: '', previousOwnerId: 'U-OTHER',
    reason: '管理员取消分配',
  });

  const stats = await fx.requestJson('/api/sales-crm/intake?page=1&pageSize=20', {
    cookie: fx.adminCookie,
  });
  assert.equal(stats.stats.pending, 2);
  assert.equal(stats.stats.assigned, 2);
});

test('Issue 212 unassign is blocked for claimed, pending, sales, and unprivileged managers', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);

  const claimed = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'unassign', itemId: 'I212-CLAIMED' },
  });
  assert.equal(claimed.status, 409);
  assert.equal((await claimed.json()).code, 'INTAKE_CLAIMED_REQUIRES_CRM_RETURN');

  const pending = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'unassign', itemId: 'I212-PENDING' },
  });
  assert.equal(pending.status, 409);
  assert.equal((await pending.json()).code, 'INTAKE_UNASSIGN_INVALID_STATE');

  const sales = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie, method: 'POST',
    body: { action: 'unassign', itemId: 'I212-ASSIGNED' },
  });
  assert.equal(sales.status, 403);

  fx.setUserPermissions('U-MGR', { manage_intake: false });
  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  const unprivileged = await fx.request('/api/sales-crm/intake/action', {
    cookie: managerCookie, method: 'POST',
    body: { action: 'unassign', itemId: 'I212-ASSIGNED' },
  });
  assert.equal(unprivileged.status, 403);
  assert.equal(
    fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='I212-ASSIGNED'").get().status,
    'assigned',
  );
});

test('Issue 212 assign and reassign generate system audit labels without handwritten notes', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);
  seedSecondSales(fx);

  const first = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'assign', itemId: 'I212-PENDING', ownerId: 'U-OTHER' },
  });
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal((await first.json()).reason, '管理员指定分配');

  const reassign = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'assign', itemId: 'I212-PENDING', ownerId: 'U-SALES2' },
  });
  assert.equal(reassign.status, 200, await reassign.clone().text());
  assert.equal((await reassign.json()).reason, '管理员重新分配');
  assert.equal(
    fx.db.prepare("SELECT assigned_owner_id FROM crm_intake_items WHERE id='I212-PENDING'").get().assigned_owner_id,
    'U-SALES2',
  );

  const decisions = fx.db.prepare(`SELECT manual_decision_json FROM crm_intake_decisions
    WHERE intake_item_id='I212-PENDING' ORDER BY created_at,id`).all();
  assert.deepEqual(
    decisions.map(row => JSON.parse(row.manual_decision_json).reason),
    ['管理员指定分配', '管理员重新分配'],
  );
  assert.deepEqual(
    decisions.map(row => JSON.parse(row.manual_decision_json).previousOwnerId),
    ['', 'U-OTHER'],
  );

  const returned = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'assign', itemId: 'I212-RETURNED', ownerId: 'U-SALES2' },
  });
  assert.equal(returned.status, 200, await returned.clone().text());
  assert.equal((await returned.json()).reason, '管理员重新分配');
  const returnedDecision = fx.db.prepare(`SELECT manual_decision_json FROM crm_intake_decisions
    WHERE intake_item_id='I212-RETURNED' ORDER BY created_at DESC,id DESC LIMIT 1`).get();
  assert.deepEqual(JSON.parse(returnedDecision.manual_decision_json), {
    action: 'reassign', status: 'assigned', ownerId: 'U-SALES2', previousOwnerId: 'U-OTHER',
    reason: '管理员重新分配',
  });
});

test('Issue 212 filtered assignment requires the explicit all-filtered flag for an empty filter scope', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);
  const schema = await intakeSchema(fx);

  const rejected = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      action: 'manual_assign_preview',
      filterScope: { permissionVersion: schema.schema.permissionVersion, filters: {} },
    },
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, 'ASSIGNMENT_SCOPE_REQUIRED');

  const preview = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      action: 'manual_assign_preview',
      filterScope: { permissionVersion: schema.schema.permissionVersion, filters: {} },
      allFiltered: true,
    },
  });
  assert.equal(preview.status, 200, await preview.clone().text());
  const previewBody = await preview.json();
  assert.equal(previewBody.scopeTotal > 0, true);
  assert.equal(previewBody.eligibleCount > 0, true);

  const assignedBefore = fx.db.prepare("SELECT COUNT(*) count FROM crm_intake_items WHERE status='assigned'").get().count;
  const missingToken = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      action: 'manual_assign',
      filterScope: { permissionVersion: schema.schema.permissionVersion, filters: {} },
      allFiltered: true,
      ownerId: 'U-OTHER',
      amount: 1,
      idempotencyKey: 'issue212-all-filtered-missing-token',
    },
  });
  assert.equal(missingToken.status, 409);
  assert.equal((await missingToken.json()).code, 'ASSIGNMENT_PREVIEW_REQUIRED');
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_intake_items WHERE status='assigned'").get().count,
    assignedBefore,
  );

  const assigned = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      action: 'manual_assign',
      filterScope: { permissionVersion: schema.schema.permissionVersion, filters: {} },
      allFiltered: true,
      ownerId: 'U-OTHER',
      amount: 1,
      previewToken: previewBody.previewToken,
      idempotencyKey: 'issue212-all-filtered-assign',
    },
  });
  assert.equal(assigned.status, 200, await assigned.clone().text());
  assert.equal((await assigned.json()).assigned, 1);
});

test('Issue 212 batch assignment reports partial failures per item', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);
  seedSecondSales(fx);

  const preview = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      action: 'manual_assign_preview',
      itemIds: ['I212-PENDING', 'I212-CLAIMED'],
    },
  });
  assert.equal(preview.status, 200, await preview.clone().text());
  const previewBody = await preview.json();
  assert.equal(previewBody.eligibleCount, 1);
  assert.equal(previewBody.blockedCount, 1);
  assert.equal(previewBody.blockedReasons['状态不可分配'], 1);

  const assigned = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      action: 'manual_assign',
      itemIds: ['I212-PENDING', 'I212-CLAIMED'],
      ownerId: 'U-OTHER',
      amount: 2,
      idempotencyKey: 'issue212-partial-failures',
    },
  });
  assert.equal(assigned.status, 200, await assigned.clone().text());
  const body = await assigned.json();
  assert.equal(body.assigned, 1);
  assert.equal(body.blocked, 1);
  assert.equal(body.failed, 1);
  assert.deepEqual(body.results, [
    { itemId: 'I212-CLAIMED', reason: '状态不可分配', ok: false },
    { itemId: 'I212-PENDING', ok: true, reason: '' },
  ]);
});

test('Issue 212 empty filter previews cannot acquire rows that appear later', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);
  const schema = await intakeSchema(fx);
  const filterScope = {
    permissionVersion: schema.schema.permissionVersion,
    filters: { search: { operator: 'contains', value: 'Issue212 Appeared Later' } },
  };
  const preview = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'manual_assign_preview', filterScope, allFiltered: true },
  });
  assert.equal(preview.status, 200, await preview.clone().text());
  const previewBody = await preview.json();
  assert.equal(previewBody.scopeTotal, 0);
  assert.equal(Boolean(previewBody.previewToken), true);

  fx.db.prepare("UPDATE crm_intake_items SET company_name='Issue212 Appeared Later' WHERE id='I212-PENDING'").run();
  const assigned = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      action: 'manual_assign', filterScope, allFiltered: true,
      ownerId: 'U-OTHER', amount: 1, previewToken: previewBody.previewToken,
      idempotencyKey: 'issue212-empty-preview',
    },
  });
  assert.equal(assigned.status, 400);
  assert.equal((await assigned.json()).code, 'ASSIGNMENT_AMOUNT_EXCEEDS_SCOPE');
  assert.equal(fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='I212-PENDING'").get().status, 'pending');
});

test('Issue 212 all-filtered assignment keeps partial success after previewed rows change state', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);
  fx.db.prepare("UPDATE crm_intake_items SET company_name='Issue212 Race A' WHERE id='I212-PENDING'").run();
  fx.db.prepare(`UPDATE crm_intake_items SET company_name='Issue212 Race B',status='pending',
    assigned_owner_id='' WHERE id='I212-RETURNED'`).run();
  const schema = await intakeSchema(fx);
  const filterScope = {
    permissionVersion: schema.schema.permissionVersion,
    filters: {
      search: { operator: 'contains', value: 'Issue212 Race' },
      status: { operator: 'in', values: ['pending'] },
    },
  };

  const preview = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'manual_assign_preview', filterScope, allFiltered: true },
  });
  assert.equal(preview.status, 200, await preview.clone().text());
  const previewBody = await preview.json();
  assert.equal(previewBody.eligibleCount, 2);
  assert.equal(Boolean(previewBody.previewToken), true);

  fx.db.prepare("UPDATE crm_intake_items SET status='assigned' WHERE id='I212-RETURNED'").run();
  const assigned = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      action: 'manual_assign', filterScope, allFiltered: true,
      ownerId: 'U-OTHER', amount: 2, previewToken: previewBody.previewToken,
      idempotencyKey: 'issue212-filter-race',
    },
  });
  assert.equal(assigned.status, 200, await assigned.clone().text());
  const body = await assigned.json();
  assert.equal(body.assigned, 1);
  assert.equal(body.failed, 1);
  assert.equal(body.unprocessed, 0);
  assert.equal(body.assigned + body.failed + body.unprocessed, body.considered);
  assert.deepEqual(body.results, [
    { itemId: 'I212-RETURNED', reason: '状态不可分配', ok: false },
    { itemId: 'I212-PENDING', ok: true, reason: '' },
  ]);
});

test('Issue 212 runtime assignment failures are counted once', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);
  fx.db.prepare(`UPDATE crm_intake_items SET company_name='Other Fixture',duplicate_state=''
    WHERE id='I212-RETURNED'`).run();

  const assigned = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      action: 'manual_assign', itemIds: ['I212-PENDING', 'I212-RETURNED'],
      ownerId: 'U-OTHER', amount: 2, idempotencyKey: 'issue212-runtime-failure',
    },
  });
  assert.equal(assigned.status, 200, await assigned.clone().text());
  const body = await assigned.json();
  assert.equal(body.assigned, 1);
  assert.equal(body.failed, 1);
  assert.equal(body.unprocessed, 0);
  assert.equal(body.assigned + body.failed + body.unprocessed, body.considered);
  assert.equal(body.results.some(result => result.reason === '客户已在CRM' && !result.ok), true);
});

test('Issue 212 blocks same-owner and claimed reassignments without changing SLA or audit', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);
  seedSecondSales(fx);

  const before = fx.db.prepare("SELECT assigned_at,claim_due_at FROM crm_intake_items WHERE id='I212-ASSIGNED'").get();
  const auditBefore = fx.db.prepare("SELECT COUNT(*) count FROM crm_intake_decisions WHERE intake_item_id='I212-ASSIGNED'").get().count;
  const sameOwner = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'assign', itemId: 'I212-ASSIGNED', ownerId: 'U-OTHER' },
  });
  assert.equal(sameOwner.status, 409);
  assert.equal((await sameOwner.json()).code, 'INTAKE_ASSIGNMENT_UNCHANGED');
  assert.deepEqual(
    fx.db.prepare("SELECT assigned_at,claim_due_at FROM crm_intake_items WHERE id='I212-ASSIGNED'").get(),
    before,
  );
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_intake_decisions WHERE intake_item_id='I212-ASSIGNED'").get().count,
    auditBefore,
  );

  const claimed = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'assign', itemId: 'I212-CLAIMED', ownerId: 'U-SALES2' },
  });
  assert.equal(claimed.status, 409);
  assert.equal((await claimed.json()).code, 'INTAKE_CLAIMED_REQUIRES_CRM_WORKFLOW');
  assert.equal(
    fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='I212-CLAIMED'").get().status,
    'claimed',
  );

  fx.db.prepare(`UPDATE crm_intake_items SET status='duplicate',crm_customer_id='CRM-OTHER'
    WHERE id='I212-DUPLICATE'`).run();
  const linkedDuplicate = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'assign', itemId: 'I212-DUPLICATE', ownerId: 'U-SALES2' },
  });
  assert.equal(linkedDuplicate.status, 409);
  assert.equal((await linkedDuplicate.json()).code, 'INTAKE_CLAIMED_REQUIRES_CRM_WORKFLOW');
  assert.deepEqual(
    fx.db.prepare("SELECT status,crm_customer_id FROM crm_intake_items WHERE id='I212-DUPLICATE'").get(),
    { status: 'duplicate', crm_customer_id: 'CRM-OTHER' },
  );
});

test('Issue 212 single assignment rolls back when its audit cannot be recorded', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);
  fx.db.exec(`CREATE TRIGGER issue212_abort_assignment_audit
    BEFORE INSERT ON crm_intake_decisions
    WHEN NEW.intake_item_id='I212-PENDING'
    BEGIN SELECT RAISE(ABORT,'issue212 audit failure'); END`);

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'assign', itemId: 'I212-PENDING', ownerId: 'U-OTHER' },
  });
  assert.notEqual(response.status, 200);
  assert.deepEqual(
    fx.db.prepare(`SELECT status,assigned_owner_id,assigned_at,claim_due_at
      FROM crm_intake_items WHERE id='I212-PENDING'`).get(),
    { status: 'pending', assigned_owner_id: '', assigned_at: '', claim_due_at: '' },
  );
});

test('Issue 212 authorized managers can preview, assign, and unassign intake leads', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);
  const managerCookie = await fx.login('manager@example.com', 'Password123!');

  const preview = await fx.request('/api/sales-crm/intake/action', {
    cookie: managerCookie, method: 'POST',
    body: { action: 'manual_assign_preview', itemIds: ['I212-PENDING'] },
  });
  assert.equal(preview.status, 200, await preview.clone().text());
  assert.equal((await preview.json()).eligibleCount, 1);

  const assigned = await fx.request('/api/sales-crm/intake/action', {
    cookie: managerCookie, method: 'POST',
    body: { action: 'assign', itemId: 'I212-PENDING', ownerId: 'U-OTHER' },
  });
  assert.equal(assigned.status, 200, await assigned.clone().text());
  const unassigned = await fx.request('/api/sales-crm/intake/action', {
    cookie: managerCookie, method: 'POST',
    body: { action: 'unassign', itemId: 'I212-PENDING' },
  });
  assert.equal(unassigned.status, 200, await unassigned.clone().text());
  assert.equal(
    fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='I212-PENDING'").get().status,
    'pending',
  );
});

test('Issue 212 CRM jump filters are authorized and scoped to intake lifecycle', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeFlowAccounts(fx);

  const claimed = await fx.requestJson(`/api/sales-crm/accounts?filters=${envelope({
    intake_flow: { operator: 'in', values: ['claimed'] },
  })}`, { cookie: fx.adminCookie });
  assert.deepEqual(
    claimed.rows.map(row => row.id).sort(),
    ['CRM-212-CLAIMED', 'CRM-212-CONTACTED'],
  );

  const contacted = await fx.requestJson(`/api/sales-crm/accounts?filters=${envelope({
    intake_flow: { operator: 'in', values: ['contacted'] },
  })}`, { cookie: fx.adminCookie });
  assert.deepEqual(
    contacted.rows.map(row => row.id).sort(),
    ['CRM-212-CLAIMED', 'CRM-212-CONTACTED'],
  );

  const both = await fx.requestJson(`/api/sales-crm/accounts?filters=${envelope({
    intake_flow: { operator: 'in', values: ['claimed', 'contacted'] },
  })}`, { cookie: fx.adminCookie });
  assert.deepEqual(both.rows.map(row => row.id).sort(), ['CRM-212-CLAIMED', 'CRM-212-CONTACTED']);

  const forged = await fx.request(`/api/sales-crm/accounts?filters=${envelope({
    intake_flow: { operator: 'in', values: ['delete_all'] },
  })}`, { cookie: fx.adminCookie });
  assert.equal(forged.status, 403);

  const schema = await fx.requestJson('/api/sales-crm/filter-schema/customers', {
    cookie: fx.adminCookie,
  });
  const flowField = schema.schema.fields.find(field => field.key === 'intake_flow');
  assert.deepEqual(flowField.options, [
    { value: 'claimed', label: '销售已领取 / CRM' },
    { value: 'contacted', label: '当前触达' },
  ]);
});

test('Issue 212 sales scope still limits the unified list and management actions', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);

  const list = await fx.requestJson(`/api/sales-crm/lists/intake?filters=${envelope({
    search: { operator: 'contains', value: 'Issue212' },
  })}`, { cookie: fx.otherCookie });
  assert.equal(list.rows.length > 0, true);
  assert.equal(list.rows.every(row => row.assigned_owner_id === 'U-OTHER'), true);
  assert.equal(list.rows.some(row => row.status === 'duplicate'), false);
});
