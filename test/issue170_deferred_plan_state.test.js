'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const {
  getCurrentPlanState,
  installDeferredPlanSchema,
  listPlanEvents,
  recordDeferredPlan,
  recordExplicitPlan,
} = require('../lib/deferred_plan');

const NOW = '2026-08-01T04:00:00.000Z';
const ENV_ON = Object.freeze({ CRM_DEFERRED_PLAN_WRITES_ENABLED: 'true' });

function memoryDb() {
  const db = new Database(':memory:');
  installDeferredPlanSchema(db);
  return db;
}

function deferred(db, overrides = {}) {
  return recordDeferredPlan(db, {
    customerId: 'RU-1700', actorId: 'U-SALES-A', ownerIdSnapshot: 'U-SALES-A',
    reviewAt: '2026-08-02T12:00', reason: '等待客户内部确认', source: 'today_task',
    now: NOW, timezone: 'Asia/Shanghai', env: ENV_ON, ...overrides,
  });
}

function explicit(db, overrides = {}) {
  return recordExplicitPlan(db, {
    customerId: 'RU-1700', actorId: 'U-SALES-A', ownerIdSnapshot: 'U-SALES-A',
    nextAction: '确认 BOM 时间', nextAt: '2026-08-03T12:00', source: 'activity',
    now: NOW, timezone: 'Asia/Shanghai', env: ENV_ON, ...overrides,
  });
}

async function crmFixture(t, enabled = true) {
  const previous = process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
  process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = enabled ? 'true' : 'false';
  const fx = await fixtures.adminFixture();
  t.after(async () => {
    await fx.close();
    if (previous === undefined) delete process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED;
    else process.env.CRM_DEFERRED_PLAN_WRITES_ENABLED = previous;
  });
  return fx;
}

test('deferred plan schema is additive and idempotent', () => {
  const db = memoryDb();
  try {
    installDeferredPlanSchema(db);
    assert.deepEqual(db.prepare(`SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('crm_deferred_plan_events','crm_next_plan_events')
      ORDER BY name`).all(), [
      { name: 'crm_deferred_plan_events' },
      { name: 'crm_next_plan_events' },
    ]);
  } finally { db.close(); }
});

test('schema upgrade adds source event id to existing event tables', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE crm_deferred_plan_events (
        id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        owner_id_snapshot TEXT NOT NULL DEFAULT '', review_at TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE crm_next_plan_events (
        id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        owner_id_snapshot TEXT NOT NULL DEFAULT '', next_action TEXT NOT NULL,
        next_action_at TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
    installDeferredPlanSchema(db);
    installDeferredPlanSchema(db);
    for (const table of ['crm_deferred_plan_events', 'crm_next_plan_events']) {
      assert.ok(db.prepare(`PRAGMA table_info(${table})`).all()
        .some(column => column.name === 'source_event_id'));
    }
  } finally { db.close(); }
});

test('source event identity makes retries idempotent and rejects conflicting reuse', () => {
  const db = memoryDb();
  try {
    const first = explicit(db, {
      id: 'NPE-SOURCE-FIRST', source: 'activity', sourceEventId: 'ACT-170-1',
    });
    const replay = explicit(db, {
      id: 'NPE-SOURCE-RETRY', source: 'activity', sourceEventId: 'ACT-170-1',
    });
    assert.equal(replay.id, first.id);
    assert.equal(replay.sourceEventId, 'ACT-170-1');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_next_plan_events').get().count, 1);

    assert.throws(
      () => explicit(db, {
        source: 'activity', sourceEventId: 'ACT-170-1', nextAction: '冲突计划',
      }),
      error => error.statusCode === 409 && error.code === 'PLAN_EVENT_IDEMPOTENCY_CONFLICT',
    );
    assert.throws(
      () => deferred(db, {
        source: 'activity', sourceEventId: 'ACT-170-1',
      }),
      error => error.statusCode === 409 && error.code === 'PLAN_EVENT_IDEMPOTENCY_CONFLICT',
    );
  } finally { db.close(); }
});

test('event writers reuse an existing outer transaction', () => {
  const db = memoryDb();
  try {
    db.transaction(() => {
      deferred(db, { sourceEventId: 'TASK-OUTER-1' });
      explicit(db, {
        sourceEventId: 'ACT-OUTER-1', now: '2026-08-01T04:01:00.000Z',
      });
    }).immediate();
    assert.equal(listPlanEvents(db, 'RU-1700').length, 2);
    assert.equal(getCurrentPlanState(db, 'RU-1700').state, 'explicit');
  } finally { db.close(); }
});

test('deferred requires a future review time and does not masquerade as an explicit plan', () => {
  const db = memoryDb();
  try {
    assert.throws(
      () => deferred(db, { reviewAt: '' }),
      error => error.statusCode === 400 && error.code === 'NEXT_ACTION_AT_REQUIRED',
    );
    assert.throws(
      () => deferred(db, { reviewAt: '2026-08-01T12:00' }),
      error => error.statusCode === 400 && error.code === 'NEXT_ACTION_AT_MUST_BE_FUTURE',
    );
    const event = deferred(db);
    assert.equal(event.type, 'deferred');
    assert.equal(event.reviewAt, '2026-08-02 04:00:00');
    assert.equal(getCurrentPlanState(db, 'RU-1700').state, 'deferred');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_next_plan_events').get().count, 0);
  } finally { db.close(); }
});

test('explicit plan ends only the current deferred chain while preserving cumulative immutable history', () => {
  const db = memoryDb();
  try {
    deferred(db, { id: 'DPE-1', reviewAt: '2026-08-02T12:00' });
    deferred(db, {
      id: 'DPE-2', reviewAt: '2026-08-03T12:00', now: '2026-08-01T04:01:00.000Z',
    });
    let state = getCurrentPlanState(db, 'RU-1700');
    assert.deepEqual(
      { state: state.state, consecutive: state.consecutiveDeferredCount, total: state.deferredCount },
      { state: 'deferred', consecutive: 2, total: 2 },
    );

    explicit(db, { id: 'NPE-1', now: '2026-08-01T04:02:00.000Z' });
    state = getCurrentPlanState(db, 'RU-1700');
    assert.deepEqual(
      { state: state.state, consecutive: state.consecutiveDeferredCount, total: state.deferredCount },
      { state: 'explicit', consecutive: 0, total: 2 },
    );

    deferred(db, {
      id: 'DPE-3', reviewAt: '2026-08-04T12:00', now: '2026-08-01T04:03:00.000Z',
    });
    state = getCurrentPlanState(db, 'RU-1700');
    assert.deepEqual(
      { state: state.state, consecutive: state.consecutiveDeferredCount, total: state.deferredCount },
      { state: 'deferred', consecutive: 1, total: 3 },
    );
    assert.deepEqual(listPlanEvents(db, 'RU-1700').map(event => event.id), [
      'DPE-1', 'DPE-2', 'NPE-1', 'DPE-3',
    ]);
    assert.throws(
      () => db.prepare("UPDATE crm_deferred_plan_events SET reason='changed' WHERE id='DPE-1'").run(),
      /immutable/,
    );
    assert.throws(
      () => db.prepare("DELETE FROM crm_next_plan_events WHERE id='NPE-1'").run(),
      /immutable/,
    );
  } finally { db.close(); }
});

test('owner changes preserve customer history and actor attribution', () => {
  const db = memoryDb();
  try {
    deferred(db, { id: 'DPE-OLD-OWNER' });
    deferred(db, {
      id: 'DPE-NEW-OWNER', actorId: 'U-SALES-B', ownerIdSnapshot: 'U-SALES-B',
      reviewAt: '2026-08-04T12:00', now: '2026-08-01T04:01:00.000Z',
    });
    explicit(db, {
      id: 'NPE-MANAGER', actorId: 'U-MANAGER', ownerIdSnapshot: 'U-SALES-B',
      nextAt: '2026-08-05T12:00', source: 'manager_intervention',
      now: '2026-08-01T04:02:00.000Z',
    });
    assert.deepEqual(listPlanEvents(db, 'RU-1700').map(event => ({
      id: event.id, actorId: event.actorId, ownerIdSnapshot: event.ownerIdSnapshot,
    })), [
      { id: 'DPE-OLD-OWNER', actorId: 'U-SALES-A', ownerIdSnapshot: 'U-SALES-A' },
      { id: 'DPE-NEW-OWNER', actorId: 'U-SALES-B', ownerIdSnapshot: 'U-SALES-B' },
      { id: 'NPE-MANAGER', actorId: 'U-MANAGER', ownerIdSnapshot: 'U-SALES-B' },
    ]);
  } finally { db.close(); }
});

test('account reassignment preserves prior plan events and snapshots the owner at each write', async t => {
  const fx = await crmFixture(t, true);
  const first = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH',
    body: { nextAction: '原负责人计划', nextActionAt: '2099-08-08 09:00:00' },
  });
  assert.equal(first.status, 200, await first.text());

  const reassigned = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH', body: { ownerId: 'U-OTHER' },
  });
  assert.equal(reassigned.status, 200, await reassigned.text());
  const afterReassignment = fx.db.prepare(`SELECT actor_id,owner_id_snapshot
    FROM crm_next_plan_events WHERE customer_id='RU-9002' ORDER BY created_at,id`).all();
  assert.deepEqual(afterReassignment, [
    { actor_id: 'USR-ADMIN', owner_id_snapshot: 'U-MGR' },
  ]);

  const second = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH',
    body: { nextAction: '新负责人计划', nextActionAt: '2099-08-09 09:00:00' },
  });
  assert.equal(second.status, 200, await second.text());
  const snapshots = Object.fromEntries(fx.db.prepare(`SELECT actor_id,owner_id_snapshot,next_action
    FROM crm_next_plan_events WHERE customer_id='RU-9002'`).all()
    .map(row => [row.next_action, {
      actorId: row.actor_id, ownerIdSnapshot: row.owner_id_snapshot,
    }]));
  assert.deepEqual(snapshots, {
    '原负责人计划': { actorId: 'USR-ADMIN', ownerIdSnapshot: 'U-MGR' },
    '新负责人计划': { actorId: 'USR-ADMIN', ownerIdSnapshot: 'U-OTHER' },
  });
});

test('editing only the action converts a legacy local plan time to UTC and marks its basis', async t => {
  const fx = await crmFixture(t, true);
  fx.db.prepare(`UPDATE crm_accounts SET next_action='旧动作',next_action_at='2099-08-08 09:00:00',
    next_action_time_basis='' WHERE id='CRM-OWN'`).run();

  const response = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { nextAction: '更新动作' },
  });
  assert.equal(response.status, 200, await response.text());
  assert.deepEqual(fx.db.prepare(`SELECT next_action,next_action_at,next_action_time_basis
    FROM crm_accounts WHERE id='CRM-OWN'`).get(), {
    next_action: '更新动作',
    next_action_at: '2099-08-08 01:00:00',
    next_action_time_basis: 'utc',
  });
});

test('new terminal customers have no follow-up plan and invalid stages create nothing', async t => {
  const fx = await crmFixture(t, true);
  const beforeAccounts = fx.db.prepare('SELECT COUNT(*) count FROM crm_accounts').get().count;
  const beforeCustomers = fx.db.prepare('SELECT COUNT(*) count FROM customer_pool').get().count;

  for (const [stage, companyName] of [
    ['lost', 'Issue 170 Lost On Create'],
    ['disqualified', 'Issue 170 Disqualified On Create'],
  ]) {
    const response = await fx.request('/api/sales-crm/accounts', {
      cookie: fx.adminCookie,
      method: 'POST',
      body: {
        companyName,
        country: '俄罗斯',
        ownerId: '__unassigned__',
        stage,
        nextAction: '不应保留的默认计划',
        nextActionAt: '2099-08-08 09:00:00',
      },
    });
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    assert.deepEqual(fx.db.prepare(`SELECT stage,next_action,next_action_at,next_action_time_basis
      FROM crm_accounts WHERE id=?`).get(body.customerId), {
      stage,
      next_action: '',
      next_action_at: '',
      next_action_time_basis: '',
    });
    assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_next_plan_events
      WHERE customer_id=?`).get(body.externalCustomerId).count, 0);
  }

  const invalid = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      companyName: 'Issue 170 Invalid Stage',
      country: '俄罗斯',
      ownerId: '__unassigned__',
      stage: 'invented-stage',
    },
  });
  assert.equal(invalid.status, 400, await invalid.text());
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_accounts').get().count, beforeAccounts + 2);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM customer_pool').get().count, beforeCustomers + 2);
  assert.equal(fx.db.prepare(
    "SELECT COUNT(*) count FROM crm_accounts WHERE company_name='Issue 170 Invalid Stage'",
  ).get().count, 0);
});

test('disabled deferred-plan write gate blocks event services but preserves legacy snapshot writes', async t => {
  const db = memoryDb();
  try {
    assert.throws(
      () => deferred(db, { env: { CRM_DEFERRED_PLAN_WRITES_ENABLED: 'false' } }),
      error => error.statusCode === 409 && error.code === 'DEFERRED_PLAN_WRITES_DISABLED',
    );
    assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_deferred_plan_events').get().count, 0);
  } finally { db.close(); }

  const fx = await crmFixture(t, false);
  fx.db.prepare("UPDATE crm_accounts SET next_action='',next_action_at='' WHERE id='CRM-OTHER'").run();
  const response = await fx.request('/api/sales-crm/today-tasks/actions', {
    cookie: fx.adminCookie, method: 'POST',
    body: {
      actionType: 'add_next_plan', customerId: 'CRM-OTHER', nextAction: '稍后跟进',
      nextActionAt: '2099-08-08 09:00:00', idempotencyKey: 'issue170-disabled-write',
    },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.deepEqual(fx.db.prepare(
    "SELECT next_action,next_action_at FROM crm_accounts WHERE id='CRM-OTHER'",
  ).get(), { next_action: '稍后跟进', next_action_at: '2099-08-08 01:00:00' });
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_next_plan_events').get().count, 0);
});

test('terminal transition clears ordinary plan while preserving events; reactivation requires a real future plan', async t => {
  const fx = await crmFixture(t, true);
  const plan = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH',
    body: { nextAction: '终止前的真实计划', nextActionAt: '2099-08-08 09:00:00' },
  });
  assert.equal(plan.status, 200, await plan.text());
  const eventCount = fx.db.prepare(`SELECT COUNT(*) count FROM crm_next_plan_events
    WHERE customer_id='RU-9002'`).get().count;
  assert.equal(eventCount, 1);

  const terminal = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH', body: { stage: 'lost', lossReason: '客户项目暂停' },
  });
  assert.equal(terminal.status, 200, await terminal.text());
  assert.deepEqual(fx.db.prepare(
    "SELECT stage,next_action,next_action_at FROM crm_accounts WHERE id='CRM-OWN'",
  ).get(), { stage: 'lost', next_action: '', next_action_at: '' });
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_next_plan_events
    WHERE customer_id='RU-9002'`).get().count, eventCount);
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.equal((bootstrap.alerts || []).some(alert => alert.customerId === 'CRM-OWN'
    && ['NO_NEXT', 'OVERDUE'].includes(alert.code)), false);

  for (const body of [
    { stage: 'qualified' },
    { stage: 'qualified', nextAction: '重新联系' },
    { stage: 'qualified', nextAction: '重新联系', nextActionAt: '2000-01-01 00:00:00' },
  ]) {
    const rejected = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
      cookie: fx.adminCookie, method: 'PATCH', body,
    });
    assert.equal(rejected.status, 400, JSON.stringify(body));
    assert.equal(fx.db.prepare("SELECT stage FROM crm_accounts WHERE id='CRM-OWN'").get().stage, 'lost');
  }

  const reactivated = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH',
    body: { stage: 'qualified', nextAction: '重新联系', nextActionAt: '2099-09-01 09:00:00' },
  });
  assert.equal(reactivated.status, 200, await reactivated.text());
  assert.deepEqual(fx.db.prepare(
    "SELECT stage,next_action,next_action_at FROM crm_accounts WHERE id='CRM-OWN'",
  ).get(), { stage: 'qualified', next_action: '重新联系', next_action_at: '2099-09-01 01:00:00' });
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_next_plan_events
    WHERE customer_id='RU-9002'`).get().count, eventCount + 1);
});
