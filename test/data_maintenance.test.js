const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { adminFixture } = require('./helpers/permission_fixture');

function seedMaintenanceData(fx) {
  const now = '2026-07-22 08:00:00';
  fx.db.prepare(`INSERT INTO crm_intake_batches
    (id,batch_date,status,assigned_count,created_at) VALUES ('BATCH-RESET','2026-07-22','done',2,?)`).run(now);
  const addItem = fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,crm_customer_id,company_name,status,assigned_owner_id,
     suggested_owner_id,decision_reason,assigned_at,claim_due_at,claimed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  addItem.run('INTAKE-RESET', 'BATCH-RESET', 'RU-9010', 'CRM-RESET', 'Reset Target', 'claimed',
    'U-OTHER', 'U-OTHER', 'rule', now, now, now, now, now);
  addItem.run('INTAKE-KEEP', 'BATCH-RESET', 'RU-9011', 'CRM-KEEP', 'Keep Target', 'claimed',
    'U-OTHER', 'U-OTHER', 'rule', now, now, now, now, now);
  const addAccount = fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,intake_item_id,assignment_status,
     assigned_at,claimed_at,created_at,updated_at) VALUES (?,?,?,'U-OTHER','qualified',?,'claimed',?,?,?,?)`);
  addAccount.run('CRM-RESET', 'RU-9010', 'Reset Target', 'INTAKE-RESET', now, now, now, now);
  addAccount.run('CRM-KEEP', 'RU-9011', 'Keep Target', 'INTAKE-KEEP', now, now, now, now);
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,occurred_at,created_at) VALUES ('ACT-RESET','CRM-RESET','U-OTHER','note',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,received_at,created_at) VALUES ('RFQ-RESET','CRM-RESET','U-OTHER',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO crm_quotes
    (id,rfq_id,customer_id,user_id,sent_at,created_at) VALUES ('QUOTE-RESET','RFQ-RESET','CRM-RESET','U-OTHER',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO crm_orders
    (id,customer_id,quote_id,user_id,ordered_at,created_at) VALUES ('ORDER-RESET','CRM-RESET','QUOTE-RESET','U-OTHER',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO crm_account_contacts
    (id,customer_id,external_customer_id,name,created_by,created_at,updated_at)
    VALUES ('CONTACT-RESET','CRM-RESET','RU-9010','Buyer','U-OTHER',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,evaluation_text,author_id,author_name,created_at,updated_at)
    VALUES ('EVAL-RESET','CRM-RESET','company','test','USR-ADMIN','Admin',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO crm_notifications
    (id,customer_id,code,title,dedupe_key,created_at) VALUES ('NOTICE-RESET','CRM-RESET','TEST','test','notice-reset',?)`).run(now);
  fx.db.prepare(`INSERT INTO crm_notifications
    (id,customer_id,code,title,dedupe_key,created_at)
    VALUES ('NOTICE-RESET-EXTERNAL','RU-9010','TEST','test external','notice-reset-external',?)`).run(now);
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name) VALUES ('RU-9010','Reset Target')`).run();
  fx.db.prepare(`INSERT INTO recon_jobs(job_id,customer_id,company_name,status,requested_at,updated_at)
    VALUES ('JOB-RESET','RU-9010','Reset Target','done',?,?)`).run(now, now);
}

test('data maintenance preview is scoped and execute backs up then resets assignments', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedMaintenanceData(fx);
  const previousBackupDir = process.env.CRM_BACKUP_DIR;
  process.env.CRM_BACKUP_DIR = path.join(fx.dir, 'maintenance-backups');
  t.after(() => {
    if (previousBackupDir === undefined) delete process.env.CRM_BACKUP_DIR;
    else process.env.CRM_BACKUP_DIR = previousBackupDir;
  });

  const previewResponse = await fx.request('/api/sales-crm/data-maintenance/preview', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { operation: 'reset_assignments', filters: { intakeItemIds: ['INTAKE-RESET'] } },
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.deepEqual(preview.counts, {
    intakeItems: 1, accounts: 1, activities: 1, rfqs: 1, quotes: 1, orders: 1,
    contacts: 1, evaluations: 1, notifications: 2, skippedByStatus: 0, conflicts: 0,
  });
  assert.equal(preview.confirmationText, '重置 1 条客户分配');

  const executeResponse = await fx.request('/api/sales-crm/data-maintenance/execute', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { previewId: preview.previewId, confirmationText: preview.confirmationText },
  });
  assert.equal(executeResponse.status, 200);
  const result = await executeResponse.json();
  const backupPath = path.join(process.env.CRM_BACKUP_DIR, result.backupFile);
  assert.equal(fs.existsSync(backupPath), true);
  const backup = new Database(backupPath, { readonly: true });
  assert.equal(backup.prepare("SELECT COUNT(*) n FROM crm_accounts WHERE id='CRM-RESET'").get().n, 1);
  backup.close();

  const item = fx.db.prepare("SELECT * FROM crm_intake_items WHERE id='INTAKE-RESET'").get();
  assert.equal(item.status, 'approved');
  for (const field of ['crm_customer_id', 'assigned_owner_id', 'suggested_owner_id', 'decision_reason',
    'return_reason', 'assigned_at', 'claim_due_at', 'claimed_at']) assert.equal(item[field], '', field);
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_accounts WHERE id='CRM-RESET'").get().n, 0);
  for (const [table, id] of [
    ['crm_activities', 'ACT-RESET'], ['crm_rfqs', 'RFQ-RESET'], ['crm_quotes', 'QUOTE-RESET'],
    ['crm_orders', 'ORDER-RESET'], ['crm_account_contacts', 'CONTACT-RESET'],
    ['crm_manager_evaluations', 'EVAL-RESET'], ['crm_notifications', 'NOTICE-RESET'],
    ['crm_notifications', 'NOTICE-RESET-EXTERNAL'],
  ]) assert.equal(fx.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE id=?`).get(id).n, 0, table);
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_accounts WHERE id='CRM-KEEP'").get().n, 1);
  assert.equal(fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='INTAKE-KEEP'").get().status, 'claimed');
  assert.equal(fx.db.prepare("SELECT assigned_count FROM crm_intake_batches WHERE id='BATCH-RESET'").get().assigned_count, 1);
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM customer_pool WHERE customer_id='RU-9010'").get().n, 1);
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM recon_jobs WHERE job_id='JOB-RESET'").get().n, 1);
  assert.equal(fx.db.prepare("SELECT status FROM crm_data_maintenance_runs WHERE id=?").get(result.runId).status, 'completed');

  const runs = await fx.requestJson('/api/sales-crm/data-maintenance/runs?limit=20', {
    cookie: fx.adminCookie,
  });
  assert.equal(runs.runs[0].id, result.runId);
  assert.equal(runs.runs[0].backupFile, result.backupFile);
  assert.equal(runs.runs[0].status, 'completed');
});

test('maintenance rejects empty scope, stale preview, non-admin and impersonation', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedMaintenanceData(fx);

  const empty = await fx.request('/api/sales-crm/data-maintenance/preview', {
    cookie: fx.adminCookie, method: 'POST', body: { operation: 'reset_assignments', filters: {} },
  });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, 'MAINTENANCE_SCOPE_REQUIRED');

  const denied = await fx.request('/api/sales-crm/data-maintenance/preview', {
    cookie: fx.otherCookie, method: 'POST',
    body: { operation: 'reset_assignments', filters: { allAssigned: true } },
  });
  assert.equal(denied.status, 403);

  const preview = await fx.requestJson('/api/sales-crm/data-maintenance/preview', {
    cookie: fx.adminCookie, method: 'POST',
    body: { operation: 'reset_assignments', filters: { intakeItemIds: ['INTAKE-RESET'] } },
  });
  fx.db.prepare("UPDATE crm_intake_items SET updated_at='2026-07-22 09:00:00' WHERE id='INTAKE-RESET'").run();
  const stale = await fx.request('/api/sales-crm/data-maintenance/execute', {
    cookie: fx.adminCookie, method: 'POST',
    body: { previewId: preview.previewId, confirmationText: preview.confirmationText },
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'MAINTENANCE_PREVIEW_STALE');
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_accounts WHERE id='CRM-RESET'").get().n, 1);

  await fx.startImpersonation('U-OTHER');
  const impersonated = await fx.request('/api/sales-crm/data-maintenance/preview', {
    cookie: fx.adminCookie, method: 'POST',
    body: { operation: 'reset_assignments', filters: { allAssigned: true } },
  });
  assert.equal(impersonated.status, 403);
});

function seedProtectedCustomerHistory(fx) {
  const now = '2026-07-22 08:00:00';
  fx.db.prepare(`INSERT INTO crm_manager_tasks
    (id,idempotency_key,customer_id,reason,status,completion_condition,settings_version,
     threshold_snapshot_json,evaluated_at,triggered_at,due_at,created_at,updated_at)
    VALUES ('MT-RESET','manager-reset','RU-9010','consecutive_deferred','open',
      '形成计划',1,'{}',?,?,?,?,?)`).run(now, now, '2026-07-25 08:00:00', now, now);
  fx.db.prepare(`INSERT INTO crm_manager_interventions
    (id,idempotency_key,task_id,actor_id,action,result_json,created_at)
    VALUES ('MTI-RESET','manager-intervention-reset','MT-RESET','U-WU',
      'marked_overdue','{}',?)`).run(now);
  fx.db.prepare(`INSERT INTO crm_deferred_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,review_at,reason,source,source_event_id,created_at)
    VALUES ('DPE-RESET','RU-9010','U-OTHER','U-OTHER','2026-07-25 08:00:00',
      '等待确认','manual_deferred','maintenance-reset',?)`).run(now);
  fx.db.prepare(`INSERT INTO crm_next_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,next_action,next_action_at,source,source_event_id,created_at)
    VALUES ('NPE-RESET','RU-9010','U-OTHER','U-OTHER','确认采购计划',
      '2026-07-25 08:00:00','manual','maintenance-reset-plan',?)`).run(now);
}

test('maintenance blocks protected manager and plan history during preview with stable details', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedMaintenanceData(fx);
  seedProtectedCustomerHistory(fx);

  const response = await fx.request('/api/sales-crm/data-maintenance/preview', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { operation: 'reset_assignments', filters: { intakeItemIds: ['INTAKE-RESET'] } },
  });
  const body = await response.json();
  assert.equal(response.status, 409, body.error);
  assert.equal(body.code, 'MAINTENANCE_PROTECTED_CUSTOMER_HISTORY');
  assert.deepEqual(body.details.conflicts, [{
    code: 'PROTECTED_CUSTOMER_HISTORY',
    accountId: 'CRM-RESET',
    externalCustomerId: 'RU-9010',
    dependencies: [
      { table: 'crm_manager_tasks', count: 1 },
      { table: 'crm_manager_interventions', count: 1 },
      { table: 'crm_deferred_plan_events', count: 1 },
      { table: 'crm_next_plan_events', count: 1 },
    ],
  }]);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_data_maintenance_runs
    WHERE operation='reset_assignments'`).get().count, 0);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_accounts WHERE id='CRM-RESET'").get().count, 1);
});

test('maintenance rechecks protected history added after preview before backup or deletion', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedMaintenanceData(fx);
  const previousBackupDir = process.env.CRM_BACKUP_DIR;
  process.env.CRM_BACKUP_DIR = path.join(fx.dir, 'maintenance-protected-backups');
  t.after(() => {
    if (previousBackupDir === undefined) delete process.env.CRM_BACKUP_DIR;
    else process.env.CRM_BACKUP_DIR = previousBackupDir;
  });

  const preview = await fx.requestJson('/api/sales-crm/data-maintenance/preview', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { operation: 'reset_assignments', filters: { intakeItemIds: ['INTAKE-RESET'] } },
  });
  fx.db.prepare(`INSERT INTO crm_deferred_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,review_at,reason,source,source_event_id,created_at)
    VALUES ('DPE-RACE','RU-9010','U-OTHER','U-OTHER','2026-07-25 08:00:00',
      '等待确认','manual_deferred','maintenance-race','2026-07-22 08:30:00')`).run();

  const response = await fx.request('/api/sales-crm/data-maintenance/execute', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { previewId: preview.previewId, confirmationText: preview.confirmationText },
  });
  const body = await response.json();
  assert.equal(response.status, 409, body.error);
  assert.equal(body.code, 'MAINTENANCE_PROTECTED_CUSTOMER_HISTORY');
  assert.deepEqual(body.details.conflicts[0].dependencies, [
    { table: 'crm_deferred_plan_events', count: 1 },
  ]);
  assert.equal(fs.existsSync(process.env.CRM_BACKUP_DIR), false);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_accounts WHERE id='CRM-RESET'").get().count, 1);
  assert.equal(fx.db.prepare('SELECT status FROM crm_data_maintenance_runs WHERE id=?')
    .get(preview.runId).status, 'failed');
  assert.equal(fx.db.prepare('SELECT error_code FROM crm_data_maintenance_runs WHERE id=?')
    .get(preview.runId).error_code, 'MAINTENANCE_PROTECTED_CUSTOMER_HISTORY');
});
