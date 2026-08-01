'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const Database = require('better-sqlite3');
const { installDeferredPlanSchema, recordDeferredPlan, recordExplicitPlan } = require('../lib/deferred_plan');
const {
  DEFAULT_MANAGER_TASK_SETTINGS,
  evaluateManagerTriggers,
  getManagerTask,
  getManagerTaskSettings,
  installManagerTaskSchema,
  listManagerTasks,
  markManagerTasksOverdue,
  resolveManagerTask,
  updateManagerTaskSettings,
  upsertManagerTask,
} = require('../lib/manager_tasks');

const ENV_ON = Object.freeze({ CRM_DEFERRED_PLAN_WRITES_ENABLED: 'true' });
const NOW = '2026-08-15T04:00:00.000Z';

function memoryDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL,
      owner_id TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'qualified',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_activities (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      activity_type TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO crm_accounts
      (id,external_customer_id,owner_id,stage,created_at)
      VALUES ('CRM-1','RU-1','U-SALES','qualified','2026-07-01 00:00:00');
  `);
  installDeferredPlanSchema(db);
  installManagerTaskSchema(db);
  return db;
}

function deferred(db, id, at, reviewAt) {
  return recordDeferredPlan(db, {
    id,
    customerId: 'RU-1',
    actorId: 'U-SALES',
    ownerIdSnapshot: 'U-SALES',
    reviewAt,
    reason: '等待客户确认',
    source: 'today_task',
    sourceEventId: `SRC-${id}`,
    now: at,
    timezone: 'Asia/Shanghai',
    env: ENV_ON,
  });
}

function explicit(db, id, at, nextAt) {
  return recordExplicitPlan(db, {
    id,
    customerId: 'RU-1',
    actorId: 'U-SALES',
    ownerIdSnapshot: 'U-SALES',
    nextAction: '确认采购计划',
    nextAt,
    source: 'activity',
    sourceEventId: `SRC-${id}`,
    now: at,
    timezone: 'Asia/Shanghai',
    env: ENV_ON,
  });
}

function activity(db, id, type, at) {
  db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,occurred_at,created_at)
    VALUES (?,'CRM-1','U-SALES',?,?,?)`).run(id, type, at, at);
}

function trigger(overrides = {}) {
  return {
    customerId: 'RU-1',
    reason: 'consecutive_deferred',
    triggeredAt: '2026-08-10 04:00:00',
    dueAt: '2026-08-12 04:00:00',
    actorIdSnapshot: 'U-SALES',
    ownerIdSnapshot: 'U-SALES',
    evidence: { deferredCount: 3 },
    ...overrides,
  };
}

test('schema is additive, idempotent, read-only with deferred writes disabled, and seeds N/D/G/M/K/R', () => {
  const previous = process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
  process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = 'false';
  const db = new Database(':memory:');
  try {
    installManagerTaskSchema(db);
    installManagerTaskSchema(db);
    assert.deepEqual(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
      AND name LIKE 'crm_manager_%' ORDER BY name`).all().map(row => row.name), [
      'crm_manager_interventions',
      'crm_manager_task_settings',
      'crm_manager_task_settings_audit',
      'crm_manager_tasks',
    ]);
    const settings = getManagerTaskSettings(db);
    assert.deepEqual({
      version: settings.version,
      deferred: [settings.rules.consecutiveDeferred.enabled, settings.rules.consecutiveDeferred.value],
      silence: [settings.rules.firstContactSilence.enabled, settings.rules.firstContactSilence.value],
      overdue: [settings.rules.plannedActionOverdue.enabled, settings.rules.plannedActionOverdue.value],
      sample: [settings.rules.salesAnomaly.enabled, settings.rules.salesAnomaly.minActiveCustomers,
        settings.rules.salesAnomaly.minAnomalousCustomers, settings.rules.salesAnomaly.ratioPercent],
      recipients: settings.recipientIds,
    }, {
      version: 1,
      deferred: [true, 3],
      silence: [true, 14],
      overdue: [true, 48],
      sample: [true, 10, 3, 30],
      recipients: [],
    });
    assert.equal(DEFAULT_MANAGER_TASK_SETTINGS.consecutiveDeferredCount, 3);
  } finally {
    db.close();
    if (previous === undefined) delete process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
    else process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = previous;
  }
});

test('settings updates use optimistic versions, validate thresholds, and retain immutable audit', () => {
  const db = memoryDb();
  try {
    const updated = updateManagerTaskSettings(db, {
      actorId: 'USR-ADMIN',
      expectedVersion: 1,
      patch: {
        consecutiveDeferred: { enabled: false, value: 4 },
        firstContactSilence: { enabled: true, value: 21 },
        plannedActionOverdue: { enabled: true, value: 72 },
        salesAnomaly: {
          enabled: true, minActiveCustomers: 12, minAnomalousCustomers: 4, ratioPercent: 35,
        },
        recipientIds: ['U-MGR-2', 'U-MGR-1', 'U-MGR-2'],
      },
      now: '2026-08-01T04:00:00Z',
    });
    assert.equal(updated.version, 2);
    assert.deepEqual(updated.recipientIds, ['U-MGR-1', 'U-MGR-2']);
    assert.equal(updated.rules.consecutiveDeferred.enabled, false);
    const audit = db.prepare('SELECT * FROM crm_manager_task_settings_audit').get();
    assert.equal(audit.settings_version, 2);
    assert.equal(audit.actor_id, 'USR-ADMIN');
    assert.equal(JSON.parse(audit.previous_json).version, 1);
    assert.equal(JSON.parse(audit.next_json).version, 2);
    assert.throws(
      () => updateManagerTaskSettings(db, {
        actorId: 'USR-ADMIN', expectedVersion: 1, patch: { recipientIds: [] },
      }),
      error => error.statusCode === 409 && error.code === 'MANAGER_SETTINGS_VERSION_CONFLICT',
    );
    assert.throws(
      () => updateManagerTaskSettings(db, {
        actorId: 'USR-ADMIN', expectedVersion: 2,
        patch: { salesAnomaly: { ratioPercent: 101 } },
      }),
      error => error.statusCode === 400 && error.code === 'MANAGER_SETTINGS_INVALID',
    );
    assert.throws(
      () => db.prepare('UPDATE crm_manager_task_settings_audit SET actor_id=?').run('x'),
      /immutable/,
    );
  } finally { db.close(); }
});

test('trigger evaluation uses current settings for deferred, silent-first-contact, and overdue-plan reasons', () => {
  const db = memoryDb();
  try {
    deferred(db, 'D-1', '2026-08-01T04:00:00Z', '2026-08-02T12:00:00');
    deferred(db, 'D-2', '2026-08-02T04:00:00Z', '2026-08-03T12:00:00');
    deferred(db, 'D-3', '2026-08-03T04:00:00Z', '2026-08-04T12:00:00');
    db.prepare(`INSERT INTO crm_activities
      (id,customer_id,user_id,activity_type,occurred_at,created_at)
      VALUES ('ACT-FIRST','CRM-1','U-SALES','email','2026-07-20 04:00:00','2026-07-20 04:00:00')`).run();
    let reasons = evaluateManagerTriggers(db, 'RU-1', NOW);
    assert.deepEqual(reasons.map(item => item.reason).sort(), [
      'consecutive_deferred', 'first_contact_silence',
    ]);
    assert.equal(reasons[0].settingsVersion, 1);

    explicit(db, 'P-1', '2026-08-04T04:00:00Z', '2026-08-05T12:00:00');
    reasons = evaluateManagerTriggers(db, 'RU-1', NOW);
    assert.deepEqual(reasons.map(item => item.reason).sort(), [
      'first_contact_silence', 'planned_action_overdue',
    ]);
    db.prepare("UPDATE crm_accounts SET stage='lost' WHERE external_customer_id='RU-1'").run();
    assert.deepEqual(evaluateManagerTriggers(db, 'RU-1', NOW), []);
  } finally { db.close(); }
});

test('first-contact silence ignores internal notes but a second customer action clears the trigger', () => {
  const db = memoryDb();
  try {
    activity(db, 'ACT-FIRST', 'email', '2026-07-20 04:00:00');
    activity(db, 'ACT-NOTE', 'note', '2026-08-01 04:00:00');
    activity(db, 'ACT-ADVICE', 'manager_advice', '2026-08-02 04:00:00');
    activity(db, 'ACT-MANAGER', 'manager_join', '2026-08-03 04:00:00');
    activity(db, 'ACT-EMPTY', '', '2026-08-04 04:00:00');
    activity(db, 'ACT-UNKNOWN', 'custom_internal', '2026-08-05 04:00:00');
    assert.equal(evaluateManagerTriggers(db, 'RU-1', NOW)
      .some(item => item.reason === 'first_contact_silence'), true);

    activity(db, 'ACT-SECOND', 'reply', '2026-08-06 04:00:00');
    assert.equal(evaluateManagerTriggers(db, 'RU-1', NOW)
      .some(item => item.reason === 'first_contact_silence'), false);
  } finally { db.close(); }
});

test('planned-action overdue is strict at G and only timely customer action clears it', () => {
  const db = memoryDb();
  try {
    explicit(db, 'P-BOUNDARY', '2026-08-01T00:00:00Z', '2026-08-05T12:00:00Z');
    const plan = db.prepare("SELECT * FROM crm_next_plan_events WHERE id='P-BOUNDARY'").get();
    const deadlineMs = Date.parse(`${plan.next_action_at.replace(' ', 'T')}Z`) + 48 * 3600000;
    const deadline = new Date(deadlineMs);
    assert.equal(evaluateManagerTriggers(db, 'RU-1', deadline)
      .some(item => item.reason === 'planned_action_overdue'), false);
    assert.equal(evaluateManagerTriggers(db, 'RU-1', new Date(deadlineMs + 1000))
      .some(item => item.reason === 'planned_action_overdue'), true);

    activity(db, 'ACT-INTERNAL', 'note', new Date(deadlineMs - 1000).toISOString()
      .slice(0, 19).replace('T', ' '));
    activity(db, 'ACT-MANAGER', 'manager_join', new Date(deadlineMs - 2000).toISOString()
      .slice(0, 19).replace('T', ' '));
    activity(db, 'ACT-EMPTY', '', new Date(deadlineMs - 3000).toISOString()
      .slice(0, 19).replace('T', ' '));
    activity(db, 'ACT-LATE', 'reply', new Date(deadlineMs + 1000).toISOString()
      .slice(0, 19).replace('T', ' '));
    assert.equal(evaluateManagerTriggers(db, 'RU-1', new Date(deadlineMs + 2000))
      .some(item => item.reason === 'planned_action_overdue'), true);

    activity(db, 'ACT-TIMELY', 'meeting', new Date(deadlineMs).toISOString()
      .slice(0, 19).replace('T', ' '));
    assert.equal(evaluateManagerTriggers(db, 'RU-1', new Date(deadlineMs + 2000))
      .some(item => item.reason === 'planned_action_overdue'), false);
  } finally { db.close(); }
});

test('customer manager tasks exclude sales anomaly and default to a 72-hour due time', () => {
  const db = memoryDb();
  try {
    assert.throws(
      () => upsertManagerTask(db, trigger({ reason: 'sales_anomaly' })),
      error => error.statusCode === 400 && error.code === 'MANAGER_TASK_REASON_INVALID',
    );
    const task = upsertManagerTask(db, trigger({ dueAt: undefined }));
    assert.equal(task.dueAt, '2026-08-13 04:00:00');
    assert.throws(
      () => db.prepare(`INSERT INTO crm_manager_tasks
        (id,idempotency_key,customer_id,reason,completion_condition,settings_version,
         threshold_snapshot_json,evaluated_at,triggered_at,due_at,created_at,updated_at)
        VALUES ('MT-INVALID','invalid-key','RU-2','sales_anomaly','invalid',1,'{}',
          '2026-08-10 04:00:00','2026-08-10 04:00:00','2026-08-13 04:00:00',
          '2026-08-10 04:00:00','2026-08-10 04:00:00')`).run(),
      /CHECK constraint failed/,
    );
  } finally { db.close(); }
});

test('upsert retries reuse one active task and preserve its original settings snapshot', () => {
  const db = memoryDb();
  try {
    const first = upsertManagerTask(db, trigger({ evidence: {
      deferredCount: 3, latestDeferredEventId: 'D-3',
    } }));
    const replay = upsertManagerTask(db, trigger({
      idempotencyKey: 'different-retry-key',
      evidence: { latestDeferredEventId: 'D-3', deferredCount: 3 },
    }));
    assert.equal(replay.id, first.id);
    assert.equal(replay.deduplicated, true);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_manager_tasks').get().count, 1);
    updateManagerTaskSettings(db, {
      actorId: 'USR-ADMIN', expectedVersion: 1,
      patch: { consecutiveDeferred: { enabled: true, value: 5 } },
    });
    const existing = getManagerTask(db, first.id);
    assert.equal(existing.settingsVersion, 1);
    assert.equal(existing.thresholdSnapshot.consecutiveDeferredCount, 3);
    assert.deepEqual(existing.recipientIds, []);
    const laterScan = upsertManagerTask(db, trigger({
      evidence: { deferredCount: 99 },
      evaluatedAt: '2026-08-12 04:00:00',
      triggeredAt: '2026-08-12 04:00:00',
      dueAt: '2026-08-15 04:00:00',
    }));
    assert.equal(laterScan.id, first.id);
    assert.equal(laterScan.deduplicated, true);
    assert.equal(laterScan.triggeredAt, first.triggeredAt);
    assert.equal(laterScan.dueAt, first.dueAt);
    assert.deepEqual(laterScan.evidence, first.evidence);
  } finally { db.close(); }
});

test('two database connections racing the same customer and reason create one task', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-task-race-'));
  const dbPath = path.join(dir, 'crm.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  installManagerTaskSchema(db);
  db.close();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const modulePath = path.resolve(__dirname, '../lib/manager_tasks.js');
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require('better-sqlite3');
    const { upsertManagerTask } = require(workerData.modulePath);
    const db = new Database(workerData.dbPath);
    db.pragma('busy_timeout = 5000');
    try {
      const task = upsertManagerTask(db, workerData.input);
      parentPort.postMessage({ ok: true, id: task.id });
    } catch (error) {
      parentPort.postMessage({ ok: false, code: error.code, message: error.message });
    } finally { db.close(); }
  `;
  const input = trigger({ idempotencyKey: 'race-key' });
  const run = () => new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: { dbPath, modulePath, input },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  const results = await Promise.all([run(), run()]);
  assert.equal(results.every(result => result.ok), true, JSON.stringify(results));
  assert.equal(new Set(results.map(result => result.id)).size, 1);
  const verify = new Database(dbPath, { readonly: true });
  assert.equal(verify.prepare('SELECT COUNT(*) count FROM crm_manager_tasks').get().count, 1);
  verify.close();
});

test('resolution requires real business change evidence or a callback and commits atomically', () => {
  const db = memoryDb();
  try {
    db.exec("CREATE TABLE business_state (id TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO business_state VALUES ('B-1','before')");
    const task = upsertManagerTask(db, trigger());
    const actor = { id: 'U-MGR', role: 'manager' };
    assert.throws(
      () => resolveManagerTask(db, actor, task.id, {
        type: 'plan_formed', idempotencyKey: 'resolution-empty',
      }),
      error => error.statusCode === 409 && error.code === 'MANAGER_TASK_BUSINESS_CHANGE_REQUIRED',
    );
    assert.throws(
      () => resolveManagerTask(db, actor, task.id, {
        type: 'plan_formed', idempotencyKey: 'resolution-false',
        apply: tx => {
          tx.prepare("UPDATE business_state SET value='should-rollback' WHERE id='B-1'").run();
          return { changed: false };
        },
      }),
      error => error.code === 'MANAGER_TASK_BUSINESS_CHANGE_REQUIRED',
    );
    assert.equal(db.prepare("SELECT value FROM business_state WHERE id='B-1'").get().value, 'before');

    const result = resolveManagerTask(db, actor, task.id, {
      type: 'plan_formed', idempotencyKey: 'resolution-real', note: '已共同制定计划',
      apply: tx => {
        tx.prepare("UPDATE business_state SET value='after' WHERE id='B-1'").run();
        return {
          changed: true,
          evidence: { entityType: 'business_state', entityId: 'B-1', before: 'before', after: 'after' },
        };
      },
    });
    assert.equal(result.task.status, 'completed');
    assert.equal(db.prepare("SELECT value FROM business_state WHERE id='B-1'").get().value, 'after');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_manager_interventions').get().count, 1);
    const replay = resolveManagerTask(db, actor, task.id, {
      type: 'plan_formed', idempotencyKey: 'resolution-real', note: '已共同制定计划',
    });
    assert.equal(replay.deduplicated, true);
  } finally { db.close(); }
});

test('owner escalation requires a difficulty, stays active, and can later complete', () => {
  const db = memoryDb();
  try {
    const task = upsertManagerTask(db, trigger());
    const actor = { id: 'U-MGR', role: 'manager' };
    assert.throws(
      () => resolveManagerTask(db, actor, task.id, {
        type: 'escalate_owner', idempotencyKey: 'ESC-EMPTY', difficulty: ' ',
      }),
      error => error.statusCode === 400 && error.code === 'MANAGER_TASK_DIFFICULTY_REQUIRED',
    );
    const escalation = resolveManagerTask(db, actor, task.id, {
      type: 'escalate_owner', idempotencyKey: 'ESC-1', difficulty: '需要老板确认特殊价格',
    });
    assert.equal(escalation.task.status, 'escalated');
    assert.equal(listManagerTasks(db, { statuses: ['open', 'overdue', 'escalated'] }).length, 1);
    assert.equal(resolveManagerTask(db, actor, task.id, {
      type: 'escalate_owner', idempotencyKey: 'ESC-1', difficulty: '需要老板确认特殊价格',
    }).deduplicated, true);
    assert.throws(
      () => resolveManagerTask(db, actor, task.id, {
        type: 'escalate_owner', idempotencyKey: 'ESC-1', difficulty: '改成其他商务条件',
      }),
      error => error.statusCode === 409
        && error.code === 'MANAGER_INTERVENTION_IDEMPOTENCY_CONFLICT',
    );

    const completed = resolveManagerTask(db, { id: 'USR-ADMIN', role: 'admin' }, task.id, {
      type: 'terminal_stage', idempotencyKey: 'OWNER-COMPLETE',
      businessChange: {
        changed: true,
        entityType: 'crm_account',
        entityId: 'CRM-1',
        before: { stage: 'qualified' },
        after: { stage: 'lost' },
      },
    });
    assert.equal(completed.task.status, 'completed');
    assert.equal(listManagerTasks(db, { statuses: ['open', 'overdue', 'escalated'] }).length, 0);
  } finally { db.close(); }
});

test('overdue transition is explicit, audited, and list/get expose stable views', () => {
  const db = memoryDb();
  try {
    const task = upsertManagerTask(db, trigger());
    assert.equal(markManagerTasksOverdue(db, '2026-08-13T04:00:00Z'), 1);
    assert.equal(getManagerTask(db, task.id).status, 'overdue');
    assert.equal(markManagerTasksOverdue(db, '2026-08-14T04:00:00Z'), 0);
    assert.deepEqual(listManagerTasks(db, {
      customerId: 'RU-1', statuses: ['overdue'], limit: 10,
    }).map(item => item.id), [task.id]);
    assert.ok(db.prepare(`SELECT 1 FROM crm_manager_interventions
      WHERE task_id=? AND action='marked_overdue'`).get(task.id));
  } finally { db.close(); }
});
