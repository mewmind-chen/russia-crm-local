'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { rebuildAccountDerivedState } = require('../lib/crm_account_rebuild');

const NOW = '2026-08-02T12:00:00.000Z';

function memoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY, external_customer_id TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'new', manager_id TEXT NOT NULL DEFAULT '',
      manager_required INTEGER NOT NULL DEFAULT 0, manager_status TEXT NOT NULL DEFAULT '',
      last_activity_at TEXT NOT NULL DEFAULT '', next_action TEXT NOT NULL DEFAULT '',
      next_action_at TEXT NOT NULL DEFAULT '', next_action_time_basis TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_activities (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '',
      activity_type TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '', next_action_at TEXT NOT NULL DEFAULT '',
      stage_before TEXT NOT NULL DEFAULT '', stage_after TEXT NOT NULL DEFAULT '',
      manager_required INTEGER NOT NULL DEFAULT 0,
      occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
      superseded_at TEXT NOT NULL DEFAULT '', superseded_by TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_rfqs (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, received_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE crm_quotes (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, sent_at TEXT NOT NULL,
      next_follow_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE crm_orders (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, is_repeat INTEGER NOT NULL DEFAULT 0,
      ordered_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE crm_deferred_plan_events (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',
      source_event_id TEXT NOT NULL DEFAULT '', review_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE crm_next_plan_events (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',
      source_event_id TEXT NOT NULL DEFAULT '', next_action TEXT NOT NULL,
      next_action_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE crm_manager_tasks (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL
    );
    CREATE TABLE crm_manager_interventions (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, action TEXT NOT NULL,
      business_change_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
  `);
  return db;
}

function account(db, id = 'CRM-1', overrides = {}) {
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,stage,manager_id,manager_required,manager_status,
     last_activity_at,next_action,next_action_at,next_action_time_basis,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, overrides.externalId || `EXT-${id}`, overrides.stage || 'negotiating',
    overrides.managerId || 'MGR-1', overrides.managerRequired ? 1 : 0,
    overrides.managerStatus || '污染状态', overrides.lastActivityAt || '2099-01-01 00:00:00',
    overrides.nextAction || '污染计划', overrides.nextActionAt || '2099-01-02 00:00:00',
    'utc', '2026-01-01 00:00:00', '2026-01-01 00:00:00',
  );
}

function activity(db, id, occurredAt, overrides = {}) {
  db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,outcome,next_action,next_action_at,
     stage_before,stage_after,manager_required,occurred_at,created_at,superseded_at,superseded_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, overrides.customerId || 'CRM-1', overrides.userId || 'SALES-1',
    overrides.type || 'email', overrides.outcome || '', overrides.nextAction || '',
    overrides.nextActionAt || '', overrides.stageBefore || 'qualified',
    overrides.stageAfter || 'contacted', overrides.managerRequired ? 1 : 0,
    occurredAt, overrides.createdAt || occurredAt, overrides.supersededAt || '',
    overrides.supersededBy || '',
  );
}

function explicit(db, id, createdAt, nextAction, nextActionAt, overrides = {}) {
  db.prepare(`INSERT INTO crm_next_plan_events
    (id,customer_id,source,source_event_id,next_action,next_action_at,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    id, overrides.customerId || 'EXT-CRM-1', overrides.source || 'manual',
    overrides.sourceEventId || '', nextAction, nextActionAt, createdAt,
  );
}

test('replays effective history in occurred_at, created_at, id order and is idempotent', () => {
  const db = memoryDb();
  try {
    account(db);
    activity(db, 'ACT-REQUEST', '2026-08-01 09:00:00', {
      stageAfter: 'replied', managerRequired: true,
      nextAction: '被后续记录覆盖', nextActionAt: '2026-08-03 09:00:00',
    });
    activity(db, 'ACT-JOIN', '2026-08-01 10:00:00', {
      userId: 'MGR-2', type: 'manager_join', outcome: '已完成',
      stageBefore: 'replied', stageAfter: 'meeting',
    });
    activity(db, 'ACT-LATEST', '2026-08-01 11:00:00', {
      stageBefore: 'meeting', stageAfter: 'meeting', managerRequired: true,
      nextAction: '活动计划', nextActionAt: '2026-08-04 09:00:00',
    });
    activity(db, 'ACT-BACKDATED', '2026-07-31 09:00:00', {
      createdAt: '2026-08-02 09:00:00', stageAfter: 'contacted',
      nextAction: '回溯旧计划', nextActionAt: '2026-08-03 08:00:00',
    });
    db.prepare(`INSERT INTO crm_deferred_plan_events
      (id,customer_id,source,source_event_id,review_at,created_at)
      VALUES ('DEFER-1','EXT-CRM-1','manual_deferred','D-1','2026-08-05 09:00:00','2026-08-01 12:00:00')`).run();
    explicit(db, 'PLAN-1', '2026-08-01 13:00:00', '最终明确计划', '2026-08-06 09:00:00');

    const first = rebuildAccountDerivedState(db, 'CRM-1', { now: NOW });
    const stored = db.prepare(`SELECT stage,last_activity_at,next_action,next_action_at,
      next_action_time_basis,manager_required,manager_status,manager_id,updated_at
      FROM crm_accounts WHERE id='CRM-1'`).get();
    const second = rebuildAccountDerivedState(db, 'CRM-1', { now: NOW });

    assert.deepEqual(first, {
      stage: 'meeting',
      lastActivityAt: '2026-08-01 11:00:00',
      nextAction: '最终明确计划',
      nextActionAt: '2026-08-06 09:00:00',
      managerState: { required: true, status: '待介入', managerId: 'MGR-2' },
    });
    assert.deepEqual(second, first);
    assert.deepEqual(stored, {
      stage: 'meeting', last_activity_at: '2026-08-01 11:00:00',
      next_action: '最终明确计划', next_action_at: '2026-08-06 09:00:00',
      next_action_time_basis: 'utc', manager_required: 1, manager_status: '待介入',
      manager_id: 'MGR-2', updated_at: '2026-08-02 12:00:00',
    });
    assert.equal(db.prepare("SELECT updated_at FROM crm_accounts WHERE id='CRM-1'").get().updated_at,
      stored.updated_at, 'second rebuild must not rewrite an identical snapshot');
  } finally { db.close(); }
});

test('ignores superseded activity and its explicit plan source', () => {
  const db = memoryDb();
  try {
    account(db);
    activity(db, 'ACT-WRONG-EARLY', '2026-07-30 09:00:00', {
      stageBefore: 'meeting', stageAfter: 'lost',
      supersededAt: '2026-08-02 08:00:00', supersededBy: 'ACT-REPLACEMENT-EARLY',
    });
    activity(db, 'ACT-VALID', '2026-08-01 09:00:00', {
      stageAfter: 'replied', nextAction: '保留计划', nextActionAt: '2026-08-04 09:00:00',
    });
    activity(db, 'ACT-WRONG', '2026-08-01 10:00:00', {
      stageBefore: 'replied', stageAfter: 'meeting', managerRequired: true,
      supersededAt: '2026-08-02 08:00:00', supersededBy: 'ACT-REPLACEMENT',
    });
    explicit(db, 'PLAN-WRONG', '2026-08-01 10:00:01', '错误活动计划',
      '2026-08-05 09:00:00', { source: 'activity', sourceEventId: 'ACT-WRONG' });

    assert.deepEqual(rebuildAccountDerivedState(db, 'CRM-1', { now: NOW }), {
      stage: 'replied', lastActivityAt: '2026-08-01 09:00:00',
      nextAction: '保留计划', nextActionAt: '2026-08-04 09:00:00',
      managerState: { required: false, status: '', managerId: 'MGR-1' },
    });
  } finally { db.close(); }
});

test('terminal events clear plans and an explicit later activity can reactivate the account', () => {
  const db = memoryDb();
  try {
    account(db);
    activity(db, 'ACT-MEETING', '2026-08-01 09:00:00', {
      stageAfter: 'meeting', managerRequired: true,
      nextAction: '会后跟进', nextActionAt: '2026-08-03 09:00:00',
    });
    activity(db, 'ACT-LOST', '2026-08-01 10:00:00', {
      type: 'lost', stageBefore: 'meeting', stageAfter: 'lost',
    });
    explicit(db, 'PLAN-AFTER-LOST', '2026-08-01 11:00:00', '非法终止后计划',
      '2026-08-04 09:00:00');
    let state = rebuildAccountDerivedState(db, 'CRM-1', { now: NOW });
    assert.deepEqual(state, {
      stage: 'lost', lastActivityAt: '2026-08-01 10:00:00', nextAction: '', nextActionAt: '',
      managerState: { required: false, status: '', managerId: 'MGR-1' },
    });

    activity(db, 'ACT-REACTIVATE', '2026-08-02 09:00:00', {
      type: 'meeting', stageBefore: 'lost', stageAfter: 'meeting',
      nextAction: '重新激活计划', nextActionAt: '2026-08-05 09:00:00',
    });
    state = rebuildAccountDerivedState(db, 'CRM-1', { now: NOW });
    assert.equal(state.stage, 'meeting');
    assert.equal(state.lastActivityAt, '2026-08-02 09:00:00');
    assert.equal(state.nextAction, '重新激活计划');
  } finally { db.close(); }
});

test('commerce milestones and manager terminal interventions participate in deterministic replay', () => {
  const db = memoryDb();
  try {
    account(db);
    db.prepare(`INSERT INTO crm_rfqs VALUES
      ('RFQ-1','CRM-1','2026-08-01 08:00:00','2026-08-01 08:00:01')`).run();
    db.prepare(`INSERT INTO crm_quotes VALUES
      ('QUOTE-1','CRM-1','2026-08-01 09:00:00','2026-08-04 09:00:00','2026-08-01 09:00:01')`).run();
    db.prepare(`INSERT INTO crm_orders VALUES
      ('ORDER-1','CRM-1',1,'2026-08-01 10:00:00','2026-08-01 10:00:01')`).run();
    activity(db, 'ACT-ORDER', '2026-08-01 10:00:00', {
      createdAt: '2026-08-01 10:00:02', type: 'repeat_order',
      stageBefore: 'won', stageAfter: 'repeat',
      nextAction: '维护复购关系', nextActionAt: '2026-08-08 09:00:00',
    });
    let state = rebuildAccountDerivedState(db, 'CRM-1', { now: NOW });
    assert.equal(state.stage, 'repeat');
    assert.equal(state.lastActivityAt, '2026-08-01 10:00:00');
    assert.equal(state.nextAction, '维护复购关系');

    db.prepare("INSERT INTO crm_manager_tasks VALUES ('TASK-1','EXT-CRM-1')").run();
    db.prepare(`INSERT INTO crm_manager_interventions VALUES
      ('INT-1','TASK-1','terminal_stage',?, '2026-08-01 11:00:00')`).run(
      JSON.stringify({ changed: true, after: { stage: 'disqualified' } }),
    );
    state = rebuildAccountDerivedState(db, 'CRM-1', { now: NOW });
    assert.equal(state.stage, 'disqualified');
    assert.equal(state.lastActivityAt, '2026-08-01 10:00:00');
  } finally { db.close(); }
});

test('does not open a transaction and reports stable validation errors', () => {
  const db = memoryDb();
  try {
    account(db);
    assert.equal(db.inTransaction, false);
    const result = db.transaction(() => {
      assert.equal(db.inTransaction, true);
      return rebuildAccountDerivedState(db, 'CRM-1', { now: NOW });
    }).immediate();
    assert.equal(db.inTransaction, false);
    assert.equal(result.stage, 'negotiating');
    assert.throws(
      () => rebuildAccountDerivedState(db, 'MISSING', { now: NOW }),
      error => error.code === 'CRM_ACCOUNT_REBUILD_NOT_FOUND' && error.statusCode === 404,
    );
    assert.throws(
      () => rebuildAccountDerivedState(db, 'CRM-1', { now: 'not-a-date' }),
      error => error.code === 'CRM_ACCOUNT_REBUILD_NOW_INVALID' && error.statusCode === 400,
    );
  } finally { db.close(); }
});

test('returns 409 when superseded-only history has no trustworthy stage baseline', () => {
  const db = memoryDb();
  try {
    account(db, 'CRM-1', { stage: 'meeting' });
    activity(db, 'ACT-WRONG-ONLY', '2026-08-01 09:00:00', {
      stageBefore: 'unknown',
      stageAfter: 'meeting',
      supersededAt: '2026-08-02 08:00:00',
      supersededBy: 'ACT-REPLACEMENT',
    });

    assert.throws(
      () => rebuildAccountDerivedState(db, 'CRM-1', { now: NOW }),
      error => error.code === 'CRM_ACCOUNT_REBUILD_BASELINE_UNCERTAIN'
        && error.statusCode === 409
        && /主管或管理员确认/.test(error.message),
    );
  } finally { db.close(); }
});
