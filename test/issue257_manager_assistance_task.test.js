'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const { installManagerTaskSchema } = require('../lib/manager_tasks');

function futureSql(days = 7) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
}

function legacyManagerTaskDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE crm_manager_task_settings (
      id TEXT PRIMARY KEY CHECK(id='default'), version INTEGER NOT NULL,
      consecutive_deferred_enabled INTEGER NOT NULL, consecutive_deferred_count INTEGER NOT NULL,
      first_contact_silence_enabled INTEGER NOT NULL, first_contact_silence_days INTEGER NOT NULL,
      planned_action_overdue_enabled INTEGER NOT NULL, planned_action_overdue_hours INTEGER NOT NULL,
      sales_anomaly_enabled INTEGER NOT NULL, min_active_customers INTEGER NOT NULL,
      min_anomalous_customers INTEGER NOT NULL, anomaly_ratio_percent REAL NOT NULL,
      recipient_ids_json TEXT NOT NULL DEFAULT '[]', updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    );
    INSERT INTO crm_manager_task_settings VALUES
      ('default',1,1,3,1,14,1,48,1,10,3,30,'[]','system','2026-08-05 00:00:00');
    CREATE TABLE crm_manager_tasks (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('consecutive_deferred','first_contact_silence','planned_action_overdue')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','overdue','escalated')),
      actor_id_snapshot TEXT NOT NULL DEFAULT '', owner_id_snapshot TEXT NOT NULL DEFAULT '',
      recipient_ids_json TEXT NOT NULL DEFAULT '[]', evidence_json TEXT NOT NULL DEFAULT '{}',
      completion_condition TEXT NOT NULL, settings_version INTEGER NOT NULL,
      threshold_snapshot_json TEXT NOT NULL, evaluated_at TEXT NOT NULL, triggered_at TEXT NOT NULL,
      due_at TEXT NOT NULL, result_json TEXT NOT NULL DEFAULT '{}', resolved_by TEXT NOT NULL DEFAULT '',
      resolved_at TEXT NOT NULL DEFAULT '', escalated_by TEXT NOT NULL DEFAULT '',
      escalated_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE crm_manager_interventions (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL,
      actor_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN (
        'plan_formed','terminal_stage','reassigned','manager_advice','escalate_owner','marked_overdue')),
      note TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT '', request_hash TEXT NOT NULL DEFAULT '',
      business_change_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, FOREIGN KEY(task_id) REFERENCES crm_manager_tasks(id) ON DELETE RESTRICT
    );
    INSERT INTO crm_manager_tasks
      (id,idempotency_key,customer_id,reason,status,completion_condition,settings_version,
       threshold_snapshot_json,evaluated_at,triggered_at,due_at,created_at,updated_at)
      VALUES ('MT-LEGACY','legacy-key','RU-LEGACY','planned_action_overdue','open','旧任务',1,'{}',
        '2026-08-04 00:00:00','2026-08-04 00:00:00','2026-08-07 00:00:00','2026-08-04 00:00:00','2026-08-04 00:00:00');
    INSERT INTO crm_manager_interventions
      (id,idempotency_key,task_id,actor_id,action,created_at)
      VALUES ('MTI-LEGACY','legacy-intervention','MT-LEGACY','U-MGR','manager_advice','2026-08-04 01:00:00');
  `);
  return db;
}

async function firstReaction(fx, cookie) {
  const response = await fx.request('/api/sales-crm/activity-reactions', { cookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  return body.reactions[0];
}

test('manager task schema migration preserves legacy tasks and interventions', () => {
  const db = legacyManagerTaskDb();
  try {
    installManagerTaskSchema(db);
    assert.equal(db.prepare('SELECT reason FROM crm_manager_tasks WHERE id=?').get('MT-LEGACY').reason,
      'planned_action_overdue');
    assert.equal(db.prepare('SELECT task_id FROM crm_manager_interventions WHERE id=?')
      .get('MTI-LEGACY').task_id, 'MT-LEGACY');
    db.prepare(`INSERT INTO crm_manager_tasks
      (id,idempotency_key,customer_id,reason,status,completion_condition,settings_version,
       threshold_snapshot_json,evaluated_at,triggered_at,due_at,created_at,updated_at)
      VALUES ('MT-ASSIST','assist-key','RU-ASSIST','manager_assistance','open','记录协助结果',1,'{}',
        '2026-08-05 00:00:00','2026-08-05 00:00:00','2026-08-08 00:00:00','2026-08-05 00:00:00','2026-08-05 00:00:00')`).run();
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('manager reply keeps the task open until the sales confirms a new plan', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const reaction = await firstReaction(fx, fx.otherCookie);
  const payload = {
    customerId: 'CRM-OTHER',
    progressType: 'email',
    reactionOptionId: reaction.id,
    summary: '请经理协助确认特殊价格',
    nextAction: '等待经理协助',
    nextActionAt: '2099-08-01 09:00:00',
    occurredAt: '2026-08-05 09:00:00',
    managerRequired: true,
    idempotencyKey: 'issue257-manager-assistance-activity',
  };
  const firstResponse = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie, method: 'POST', body: payload,
  });
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200, first.error);
  const task = fx.db.prepare(`SELECT * FROM crm_manager_tasks
    WHERE reason='manager_assistance' AND customer_id='RU-9003'`).get();
  assert.ok(task);
  assert.equal(task.status, 'open');
  assert.equal(task.actor_id_snapshot, 'U-OTHER');
  assert.equal(task.completion_condition, '销售确认回执并保存下一步计划');
  assert.equal(JSON.parse(task.evidence_json).activityId, first.activityId);

  const replayResponse = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie, method: 'POST', body: payload,
  });
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200, replay.error);
  assert.equal(replay.deduplicated, true);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_manager_tasks
    WHERE reason='manager_assistance' AND customer_id='RU-9003'`).get().count, 1);

  const replyResponse = await fx.request('/api/sales-crm/today-tasks/actions', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      actionType: 'complete_manager_assistance',
      customerId: 'CRM-OTHER',
      result: '核对旧联系人，再查采购负责人',
      idempotencyKey: 'issue257-manager-assistance-complete',
    },
  });
  const reply = await replyResponse.json();
  assert.equal(replyResponse.status, 200, reply.error);
  const afterReply = fx.db.prepare('SELECT * FROM crm_manager_tasks WHERE id=?').get(task.id);
  assert.equal(afterReply.status, 'open');
  assert.match(afterReply.result_json, /manager_replied/);
  const accountAfterReply = fx.db.prepare('SELECT * FROM crm_accounts WHERE id=?').get('CRM-OTHER');
  assert.equal(accountAfterReply.manager_status, '已回复');
  assert.equal(accountAfterReply.manager_required, 1);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_manager_interventions
    WHERE task_id=?`).get(task.id).count, 0);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_activities
    WHERE customer_id='CRM-OTHER' AND activity_type='manager_join'`).get().count, 1);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE action='today_task_manager_assistance_replied' AND entity_id='CRM-OTHER'`).get().count, 1);

  const confirmResponse = await fx.request('/api/sales-crm/today-tasks/actions', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      actionType: 'confirm_manager_assistance',
      customerId: 'CRM-OTHER',
      nextAction: '两天后电话联系采购负责人',
      nextActionAt: futureSql(),
      idempotencyKey: 'issue257-manager-assistance-confirm',
    },
  });
  const confirm = await confirmResponse.json();
  assert.equal(confirmResponse.status, 200, confirm.error);
  assert.equal(fx.db.prepare('SELECT status FROM crm_manager_tasks WHERE id=?').get(task.id).status, 'completed');
  const accountAfterConfirm = fx.db.prepare('SELECT * FROM crm_accounts WHERE id=?').get('CRM-OTHER');
  assert.equal(accountAfterConfirm.manager_status, '已完成');
  assert.equal(accountAfterConfirm.manager_required, 0);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE action='today_task_manager_assistance_confirmed' AND entity_id='CRM-OTHER'`).get().count, 1);
  const listedResponse = await fx.request('/api/sales-crm/manager-tasks?page=1&pageSize=50', {
    cookie: fx.adminCookie,
  });
  const listed = await listedResponse.json();
  assert.equal(listedResponse.status, 200, listed.error);
  assert.equal(listed.rows.some(row => row.id === task.id
    && row.reason === 'manager_assistance'
    && row.status === 'completed'), true);
});
