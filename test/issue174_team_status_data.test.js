'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const Database = require('better-sqlite3');

const { ROLE_PERMISSIONS } = require('../lib/access_control');
const { buildTeamReport } = require('../lib/sales_crm');
const {
  FILTER_PAGES,
  normalizeAuthorizedTeamStatusFilters,
  teamStatusViewKey,
} = require('../lib/team_status_filters');
const {
  buildTeamStatus,
  correctCollaborationEvent,
  exportTeamStatus,
  installTeamStatusSchema,
  listCollaborationSupport,
  readTeamStatusSinceLastView,
  recordExternalAssistance,
  revokeCollaborationEvent,
  supplementCollaborationEvent,
} = require('../lib/team_status');

const NOW = '2026-08-02 12:00:00';
const ENABLED_ENV = Object.freeze({ CRM_TEAM_STATUS_WRITES_ENABLED: 'true' });
const DISABLED_ENV = Object.freeze({ CRM_TEAM_STATUS_WRITES_ENABLED: 'false' });

function actor(id, role, overrides = {}) {
  return {
    id,
    role,
    permissions: { ...ROLE_PERMISSIONS[role], ...overrides },
  };
}

const admin = () => actor('ADMIN', 'admin');
const manager = () => actor('MANAGER', 'manager');
const salesA = () => actor('SALES-A', 'sales', { view_team: true });

function createCoreSchema(db) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      archived_at TEXT NOT NULL DEFAULT '',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      languages_json TEXT NOT NULL DEFAULT '[]',
      countries_json TEXT NOT NULL DEFAULT '[]',
      channels_json TEXT NOT NULL DEFAULT '[]',
      permission_group_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      owner_id TEXT,
      stage TEXT NOT NULL DEFAULT 'new',
      priority TEXT NOT NULL DEFAULT 'B',
      assignment_status TEXT NOT NULL DEFAULT 'claimed',
      lifecycle_status TEXT NOT NULL DEFAULT 'active',
      is_test_data INTEGER NOT NULL DEFAULT 0,
      manager_required INTEGER NOT NULL DEFAULT 0,
      manager_status TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      next_action_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES sales_users(id)
    );
    CREATE TABLE crm_activities (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      next_action_at TEXT NOT NULL DEFAULT '',
      stage_before TEXT NOT NULL DEFAULT '',
      stage_after TEXT NOT NULL DEFAULT '',
      manager_required INTEGER NOT NULL DEFAULT 0,
      is_test_data INTEGER NOT NULL DEFAULT 0,
      superseded_at TEXT NOT NULL DEFAULT '',
      superseded_by TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE crm_rfqs (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '',
      activity_id TEXT NOT NULL DEFAULT '', completeness INTEGER NOT NULL DEFAULT 0,
      received_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE crm_quotes (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '',
      activity_id TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0,
      gross_margin REAL NOT NULL DEFAULT 0, sent_at TEXT NOT NULL,
      next_follow_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE crm_orders (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '',
      activity_id TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0,
      gross_margin REAL NOT NULL DEFAULT 0, is_repeat INTEGER NOT NULL DEFAULT 0,
      ordered_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE crm_deferred_plan_events (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      owner_id_snapshot TEXT NOT NULL DEFAULT '', review_at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
      source_event_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE crm_next_plan_events (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      owner_id_snapshot TEXT NOT NULL DEFAULT '', next_action TEXT NOT NULL,
      next_action_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',
      source_event_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE crm_manager_tasks (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      actor_id_snapshot TEXT NOT NULL DEFAULT '', owner_id_snapshot TEXT NOT NULL DEFAULT '',
      recipient_ids_json TEXT NOT NULL DEFAULT '[]', evidence_json TEXT NOT NULL DEFAULT '{}',
      completion_condition TEXT NOT NULL DEFAULT '', settings_version INTEGER NOT NULL DEFAULT 1,
      threshold_snapshot_json TEXT NOT NULL DEFAULT '{}', evaluated_at TEXT NOT NULL DEFAULT '',
      triggered_at TEXT NOT NULL, due_at TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '{}',
      resolved_by TEXT NOT NULL DEFAULT '', resolved_at TEXT NOT NULL DEFAULT '',
      escalated_by TEXT NOT NULL DEFAULT '', escalated_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE crm_manager_interventions (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL,
      actor_id TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT '', request_hash TEXT NOT NULL DEFAULT '',
      business_change_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TABLE crm_audit_log (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      real_user_id TEXT NOT NULL DEFAULT '', effective_user_id TEXT NOT NULL DEFAULT '',
      impersonation_context_id TEXT NOT NULL DEFAULT ''
    );
  `);
}

function seedBusinessFacts(db) {
  const addUser = db.prepare(`INSERT INTO sales_users
    (id,email,name,role,created_at) VALUES (?,?,?,?,?)`);
  addUser.run('ADMIN', 'admin@example.test', '老板', 'admin', '2026-01-01 00:00:00');
  addUser.run('MANAGER', 'manager@example.test', '主管', 'manager', '2026-01-01 00:00:00');
  addUser.run('SALES-A', 'a@example.test', '销售甲', 'sales', '2026-01-01 00:00:00');
  addUser.run('SALES-B', 'b@example.test', '销售乙', 'sales', '2026-01-01 00:00:00');
  const addAccount = db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,next_action,next_action_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  addAccount.run('ACC-A', 'EXT-A', '甲客户', 'SALES-A', 'replied', '继续跟进',
    '2026-08-05 12:00:00', '2026-01-01 00:00:00', NOW);
  addAccount.run('ACC-B', 'EXT-B', '乙客户', 'SALES-B', 'contacted', '', '',
    '2026-01-01 00:00:00', NOW);

  const addActivity = db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,summary,stage_before,stage_after,
     superseded_at,superseded_by,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  addActivity.run('ACT-7D', 'ACC-A', 'SALES-A', 'reply', 'email', '客户回复',
    'contacted', 'replied', '', '', '2026-07-28 12:00:00', '2026-07-28 12:00:00');
  addActivity.run('ACT-POST-PLAN', 'ACC-A', 'SALES-A', 'call', 'call', '按计划行动',
    'replied', 'replied', '', '', '2026-07-30 12:00:00', '2026-07-30 12:00:00');
  addActivity.run('ACT-30D', 'ACC-B', 'SALES-B', 'email', 'email', '开始联系',
    'new', 'contacted', '', '', '2026-07-20 12:00:00', '2026-07-20 12:00:00');
  addActivity.run('ACT-SUPERSEDED', 'ACC-A', 'SALES-A', 'meeting', 'video', '错误归属',
    'replied', 'meeting', '2026-08-01 12:00:00', 'ACT-REPLACEMENT-OUTSIDE-SCOPE',
    '2026-07-31 12:00:00', '2026-07-31 12:00:00');
  addActivity.run('ACT-OLD', 'ACC-A', 'SALES-A', 'email', 'email', '窗口外动作',
    'new', 'contacted', '', '', '2026-06-20 12:00:00', '2026-06-20 12:00:00');

  const addDeferred = db.prepare(`INSERT INTO crm_deferred_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,review_at,reason,source,source_event_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  addDeferred.run('DEF-1', 'EXT-A', 'SALES-A', 'SALES-A', '2026-07-27 12:00:00',
    '等待客户确认', 'activity', 'ACT-7D', '2026-07-26 12:00:00');
  addDeferred.run('DEF-2', 'EXT-A', 'SALES-A', 'SALES-A', '2026-07-28 12:00:00',
    '再次延期', 'today_task', '', '2026-07-27 12:00:00');
  db.prepare(`INSERT INTO crm_next_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,next_action,next_action_at,source,source_event_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    'PLAN-1', 'EXT-A', 'SALES-A', 'SALES-A', '电话确认', '2026-07-31 12:00:00',
    'today_task', '', '2026-07-29 12:00:00',
  );
  db.prepare(`INSERT INTO crm_manager_tasks
    (id,idempotency_key,customer_id,reason,status,owner_id_snapshot,recipient_ids_json,
     triggered_at,due_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    'TASK-1', 'TASK-KEY-1', 'EXT-A', 'consecutive_deferred', 'escalated', 'SALES-A',
    '["MANAGER"]', '2026-07-27 12:00:00', '2026-07-29 12:00:00',
    '2026-07-27 12:00:00', '2026-07-30 12:00:00',
  );
  db.prepare(`INSERT INTO crm_manager_interventions
    (id,idempotency_key,task_id,actor_id,action,note,business_change_json,result_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    'INT-1', 'INT-KEY-1', 'TASK-1', 'MANAGER', 'manager_advice', '建议电话确认',
    '{}', '{"status":"pending"}', '2026-07-29 10:00:00',
  );
}

function seededDb(filename = ':memory:') {
  const db = new Database(filename);
  createCoreSchema(db);
  installTeamStatusSchema(db, { now: NOW });
  seedBusinessFacts(db);
  return db;
}

function eventId(event) {
  return String(event?.eventId || event?.id || '');
}

function writePayload(overrides = {}) {
  return {
    salesUserId: 'SALES-A',
    customerId: 'EXT-A',
    problem: '客户迟迟不能确认采购计划',
    suggestion: '主管建议电话确认决策链',
    outcome: '',
    nextStep: '8 月 5 日前完成电话确认',
    status: 'unresolved',
    idempotencyKey: 'TEAM-EVENT-1',
    ...overrides,
  };
}

function progressViewKey(user, permissionVersion = 0) {
  const ast = normalizeAuthorizedTeamStatusFilters(user, {
    page: FILTER_PAGES.progress,
    filters: [],
  });
  return teamStatusViewKey(user, ast, { permissionVersion });
}

function auditToDb(db, payload) {
  db.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    `AUD-${payload.entityId}-${payload.action}`,
    payload.actorId,
    payload.action,
    payload.entityType,
    payload.entityId,
    JSON.stringify({ reason: payload.reason, before: payload.before, after: payload.after }),
    payload.createdAt,
  );
}

test('team status schema is additive, repeatable, and protects append-only facts', () => {
  const db = seededDb();
  try {
    installTeamStatusSchema(db, { now: '2026-08-02 13:00:00' });
    for (const table of ['crm_team_status_views', 'crm_collaboration_events']) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
    }
    const event = recordExternalAssistance(
      db, manager(), writePayload(), { env: ENABLED_ENV, now: NOW },
    );
    const id = eventId(event);
    assert.ok(id);
    assert.throws(
      () => db.prepare('UPDATE crm_collaboration_events SET problem=? WHERE id=?').run('篡改', id),
      /immutable|append|只读|不可修改/i,
    );
    assert.throws(
      () => db.prepare('DELETE FROM crm_collaboration_events WHERE id=?').run(id),
      /immutable|append|只读|不可删除/i,
    );
  } finally {
    db.close();
  }
});

test('7d and 30d progress use effective activity and retain counts, ratios, and sample bounds', () => {
  const db = seededDb();
  try {
    const seven = buildTeamStatus(db, admin(), { range: '7d' }, { now: NOW });
    const thirty = buildTeamStatus(db, admin(), { range: '30d' }, { now: NOW });
    assert.equal(seven.range, '7d');
    assert.equal(thirty.range, '30d');
    assert.equal(seven.progress.counts.progressedCustomers, 1);
    assert.equal(thirty.progress.counts.progressedCustomers, 2);
    assert.equal(seven.progress.counts.deferredRecords, 2);
    assert.equal(seven.progress.counts.repeatedDeferredCustomers, 1);
    assert.equal(seven.progress.counts.plansFormedCustomers, 1);
    assert.equal(seven.progress.counts.actionsAfterPlanCustomers, 1);
    assert.equal(
      seven.progress.counts.progressedCustomers < thirty.progress.counts.progressedCustomers,
      true,
    );
    assert.equal(Object.values(seven.progress.counts).every(Number.isFinite), true);
    assert.equal(Object.values(seven.progress.ratios).every(Number.isFinite), true);
    assert.equal(Number.isFinite(seven.progress.sample.size), true);
    assert.equal(seven.sample.toInclusive, NOW);
    assert.equal(thirty.sample.toInclusive, NOW);
    assert.equal(JSON.stringify(seven).includes('ACT-SUPERSEDED'), false);
    assert.equal(JSON.stringify(thirty).includes('ACT-OLD'), false);
  } finally {
    db.close();
  }
});

test('team status capability remains byte-for-byte compatible with buildTeamReport', () => {
  const db = seededDb();
  try {
    const users = db.prepare('SELECT * FROM sales_users ORDER BY role,name').all();
    const accounts = db.prepare('SELECT * FROM crm_accounts ORDER BY id').all();
    const activities = db.prepare(
      "SELECT * FROM crm_activities WHERE superseded_at='' ORDER BY occurred_at DESC",
    ).all();
    const rfqs = db.prepare('SELECT * FROM crm_rfqs').all();
    const quotes = db.prepare('SELECT * FROM crm_quotes').all();
    const orders = db.prepare('SELECT * FROM crm_orders').all();
    const expected = buildTeamReport(users, accounts, activities, rfqs, quotes, orders);
    const result = buildTeamStatus(db, admin(), { range: '30d' }, {
      now: NOW,
      buildTeamReport: () => expected,
    });
    assert.deepEqual(result.capability, expected);
  } finally {
    db.close();
  }
});

test('authorized owner filters narrow capability with the same account scope as progress', () => {
  const db = seededDb();
  try {
    let capabilityAccountIds = [];
    const result = buildTeamStatus(db, admin(), {
      range: '30d',
      filters: {
        page: FILTER_PAGES.progress,
        filters: [{ key: 'owner', operator: 'in', values: ['SALES-A'] }],
      },
    }, {
      now: NOW,
      buildCapability: input => {
        capabilityAccountIds = input.accounts.map(row => row.id);
        return [];
      },
    });
    assert.deepEqual(result.progress.sales.map(row => row.salesUserId), ['SALES-A']);
    assert.deepEqual(capabilityAccountIds, ['ACC-A']);
  } finally {
    db.close();
  }
});

test('capability response and export apply the same authorized progress filter AST', () => {
  const db = seededDb();
  try {
    const input = {
      range: '30d',
      filters: {
        page: FILTER_PAGES.progress,
        filters: [{ key: 'owner', operator: 'in', values: ['SALES-A'] }],
      },
    };
    const result = buildTeamStatus(db, admin(), input, { now: NOW });
    assert.deepEqual(result.progress.sales.map(row => row.salesUserId), ['SALES-A']);
    assert.deepEqual(result.capability.map(row => row.user.id), ['SALES-A']);

    const exported = exportTeamStatus(db, admin(), {
      ...input,
      section: 'capability',
      format: 'json',
    }, { now: NOW });
    assert.deepEqual(exported.rows.map(row => row.user.id), ['SALES-A']);
    assert.equal(exported.content.includes('SALES-B'), false);
  } finally {
    db.close();
  }
});

test('progress drill-down reuses the authorized accounts, tasks and effective timeline', () => {
  const db = seededDb();
  try {
    const result = buildTeamStatus(db, admin(), {
      range: '30d',
      filters: {
        page: FILTER_PAGES.progress,
        filters: [{ key: 'owner', operator: 'in', values: ['SALES-A'] }],
      },
    }, { now: NOW });
    assert.deepEqual(result.progress.drilldown.customers.map(row => row.customerId), ['EXT-A']);
    assert.deepEqual(result.progress.drilldown.tasks.map(row => row.taskId), ['TASK-1']);
    assert.deepEqual(
      [...new Set(result.progress.drilldown.timeline.map(row => row.kind))].sort(),
      ['activity', 'deferred_plan', 'manager_task', 'next_plan'],
    );
    assert.equal(JSON.stringify(result.progress.drilldown).includes('EXT-B'), false);
    assert.equal(JSON.stringify(result.progress.drilldown).includes('ACT-SUPERSEDED'), false);
  } finally {
    db.close();
  }
});

test('since-last-view uses a server cursor and rolls aggregation and cursor back together', () => {
  const db = seededDb();
  try {
    const viewKey = progressViewKey(admin());
    db.prepare(`INSERT INTO crm_team_status_views
      (user_id,view_key,last_viewed_at,version,updated_at) VALUES (?,?,?,?,?)`)
      .run('ADMIN', viewKey, '2026-07-25 12:00:00', 4, '2026-07-25 12:00:00');
    assert.throws(
      () => readTeamStatusSinceLastView(db, admin(), {
        fromExclusive: '2026-01-01 00:00:00',
      }, { now: NOW }),
      error => error.statusCode === 400 && /cursor|游标|服务端/i.test(`${error.code} ${error.message}`),
    );
    assert.throws(
      () => readTeamStatusSinceLastView(
        db, admin(), {}, { now: NOW, faultAt: 'afterAggregate' },
      ),
      /fault|故障|injected/i,
    );
    assert.deepEqual(
      db.prepare(`SELECT last_viewed_at lastViewedAt,version
        FROM crm_team_status_views WHERE user_id=? AND view_key=?`).get('ADMIN', viewKey),
      { lastViewedAt: '2026-07-25 12:00:00', version: 4 },
    );
    const result = readTeamStatusSinceLastView(db, admin(), {}, { now: NOW });
    assert.equal(result.fromExclusive, '2026-07-25 12:00:00');
    assert.equal(result.toInclusive, NOW);
    assert.deepEqual(result.cursor, {
      viewKey, lastViewedAt: NOW, version: 5,
    });
  } finally {
    db.close();
  }
});

function runCursorWorker(databasePath, modulePath) {
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require('better-sqlite3');
    const service = require(workerData.modulePath);
    const db = new Database(workerData.databasePath);
    db.pragma('busy_timeout = 5000');
    try {
      const result = service.readTeamStatusSinceLastView(
        db, workerData.user, {}, { now: workerData.now },
      );
      parentPort.postMessage({ ok: true, result });
    } catch (error) {
      parentPort.postMessage({ ok: false, code: error.code, message: error.message });
    } finally {
      db.close();
    }
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, {
      eval: true,
      workerData: { databasePath, modulePath, user: admin(), now: NOW },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`cursor worker exited with ${code}`));
    });
  });
}

test('two connections serialize since-last-view without overlapping or double-advancing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue174-cursor-'));
  const databasePath = path.join(tempDir, 'team-status.db');
  const modulePath = require.resolve('../lib/team_status');
  const db = seededDb(databasePath);
  const viewKey = progressViewKey(admin());
  db.prepare(`INSERT INTO crm_team_status_views
    (user_id,view_key,last_viewed_at,version,updated_at) VALUES (?,?,?,?,?)`)
    .run('ADMIN', viewKey, '2026-07-25 12:00:00', 1, '2026-07-25 12:00:00');
  db.close();
  try {
    const replies = await Promise.all([
      runCursorWorker(databasePath, modulePath),
      runCursorWorker(databasePath, modulePath),
    ]);
    assert.deepEqual(replies.map(reply => reply.ok), [true, true]);
    const windows = replies.map(reply => [
      reply.result.fromExclusive,
      reply.result.toInclusive,
      reply.result.cursor.version,
    ]).sort((left, right) => left[2] - right[2]);
    assert.deepEqual(windows, [
      ['2026-07-25 12:00:00', NOW, 2],
      [NOW, NOW, 3],
    ]);
    const verify = new Database(databasePath, { readonly: true });
    assert.deepEqual(
      verify.prepare(`SELECT last_viewed_at lastViewedAt,version
        FROM crm_team_status_views WHERE user_id=? AND view_key=?`).get('ADMIN', viewKey),
      { lastViewedAt: NOW, version: 3 },
    );
    verify.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('manual assistance correction, supplement, and revocation are append-only and idempotent', () => {
  const db = seededDb();
  try {
    const original = recordExternalAssistance(
      db, manager(), writePayload(), {
        env: ENABLED_ENV, now: '2026-08-02 12:01:00', audit: auditToDb,
      },
    );
    const replay = recordExternalAssistance(
      db, manager(), writePayload(), {
        env: ENABLED_ENV, now: '2026-08-02 12:02:00', audit: auditToDb,
      },
    );
    assert.equal(eventId(replay), eventId(original));
    assert.equal(replay.deduplicated, true);
    assert.throws(
      () => recordExternalAssistance(db, manager(), writePayload({ problem: '不同内容' }), {
        env: ENABLED_ENV, now: '2026-08-02 12:03:00', audit: auditToDb,
      }),
      error => error.statusCode === 409 && /IDEMPOTENCY/i.test(String(error.code || '')),
    );
    assert.throws(
      () => correctCollaborationEvent(db, manager(), eventId(original), {
        salesUserId: 'SALES-B', customerId: 'EXT-B', reason: '错误跨目标修正',
        idempotencyKey: 'TEAM-EVENT-CROSS-TARGET',
      }, { env: ENABLED_ENV, now: '2026-08-02 12:03:30', audit: auditToDb }),
      error => error.statusCode === 400 && error.code === 'TEAM_STATUS_TARGET_IMMUTABLE',
    );
    assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_collaboration_events').get().count, 1);

    const supplement = supplementCollaborationEvent(db, manager(), eventId(original), {
      outcome: '客户已确认会内部讨论',
      nextStep: '主管继续参加下一次会议',
      reason: '补充会后结果',
      idempotencyKey: 'TEAM-EVENT-SUPPLEMENT-1',
    }, { env: ENABLED_ENV, now: '2026-08-02 12:04:00', audit: auditToDb });
    const corrected = correctCollaborationEvent(db, manager(), eventId(original), {
      problem: '客户采购计划尚未内部确认',
      suggestion: '主管建议与采购负责人电话确认',
      outcome: '',
      nextStep: '8 月 5 日前完成电话确认',
      status: 'unresolved',
      reason: '修正问题描述',
      idempotencyKey: 'TEAM-EVENT-CORRECT-1',
    }, { env: ENABLED_ENV, now: '2026-08-02 12:05:00', audit: auditToDb });
    const revoked = revokeCollaborationEvent(db, manager(), eventId(corrected), {
      reason: '确认该补记关联了错误客户',
      idempotencyKey: 'TEAM-EVENT-REVOKE-1',
    }, { env: ENABLED_ENV, now: '2026-08-02 12:06:00', audit: auditToDb });

    assert.deepEqual(
      db.prepare(`SELECT relation_type relationType,supersedes_event_id supersedesEventId
        FROM crm_collaboration_events ORDER BY created_at,id`).all(),
      [
        { relationType: 'original', supersedesEventId: '' },
        { relationType: 'supplement', supersedesEventId: eventId(original) },
        { relationType: 'correction', supersedesEventId: eventId(original) },
        { relationType: 'revocation', supersedesEventId: eventId(corrected) },
      ],
    );
    assert.equal(eventId(supplement) !== eventId(original), true);
    assert.equal(eventId(corrected) !== eventId(original), true);
    assert.equal(eventId(revoked) !== eventId(corrected), true);
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
      WHERE entity_type='collaboration_event'`).get().count, 4);
  } finally {
    db.close();
  }
});

test('legacy cross-target revisions do not expose another target through before or after snapshots', () => {
  const db = seededDb();
  try {
    const original = recordExternalAssistance(
      db, manager(), writePayload({ problem: '销售甲的私密协作内容' }), {
        env: ENABLED_ENV, now: '2026-08-02 12:01:00', audit: auditToDb,
      },
    );
    const crossTargetAfter = {
      salesUserId: 'SALES-B', customerId: 'EXT-B', problem: '销售乙的协作内容',
      suggestion: '', outcome: '', nextStep: '', status: 'unresolved',
    };
    const originalRow = db.prepare(
      'SELECT after_json FROM crm_collaboration_events WHERE id=?',
    ).get(eventId(original));
    db.prepare(`INSERT INTO crm_collaboration_events
      (id,root_event_id,supersedes_event_id,relation_type,idempotency_key,request_hash,
       sales_user_id,customer_id,problem,suggestion,outcome,next_step,status,actor_id,
       reason,source,before_json,after_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'manual',?,?,?)`).run(
      'COLL-LEGACY-CROSS', eventId(original), eventId(original), 'correction',
      'LEGACY-CROSS-TARGET', 'legacy-request-hash', 'SALES-B', 'EXT-B',
      crossTargetAfter.problem, '', '', '', 'unresolved', 'MANAGER', '历史异常归属更正',
      originalRow.after_json, JSON.stringify(crossTargetAfter), '2026-08-02 12:02:00',
    );

    const listed = listCollaborationSupport(
      db, salesA(), {
        filters: { page: FILTER_PAGES.collaboration, filters: [] },
      }, { now: NOW },
    );
    assert.equal(JSON.stringify(listed).includes('销售乙的协作内容'), false);

    const salesB = actor('SALES-B', 'sales', { view_team: true });
    const visibleToB = listCollaborationSupport(
      db, salesB, {
        filters: { page: FILTER_PAGES.collaboration, filters: [] },
      }, { now: NOW },
    );
    assert.equal(visibleToB.rows.length, 1);
    assert.deepEqual(visibleToB.rows[0].before, {});
    assert.equal(JSON.stringify(visibleToB).includes('销售甲的私密协作内容'), false);
  } finally {
    db.close();
  }
});

test('write gate false rejects manual collaboration without event or audit side effects', () => {
  const db = seededDb();
  try {
    const before = {
      events: db.prepare('SELECT COUNT(*) count FROM crm_collaboration_events').get().count,
      audits: db.prepare('SELECT COUNT(*) count FROM crm_audit_log').get().count,
    };
    assert.throws(
      () => recordExternalAssistance(db, manager(), writePayload(), {
        env: DISABLED_ENV, now: NOW,
      }),
      error => error.statusCode === 503 && error.code === 'TEAM_STATUS_WRITES_DISABLED',
    );
    assert.deepEqual({
      events: db.prepare('SELECT COUNT(*) count FROM crm_collaboration_events').get().count,
      audits: db.prepare('SELECT COUNT(*) count FROM crm_audit_log').get().count,
    }, before);
  } finally {
    db.close();
  }
});
