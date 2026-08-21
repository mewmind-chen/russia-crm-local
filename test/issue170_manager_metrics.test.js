'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { installDeferredPlanSchema } = require('../lib/deferred_plan');
const {
  buildCustomerPlanRisk,
  buildManagerMetricDrilldown,
  buildManagerMetrics,
  isEffectiveCustomerAction,
} = require('../lib/manager_metrics');

const NOW = '2026-08-15T04:00:00.000Z';

function utcText(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

function ago({ days = 0, seconds = 0 } = {}) {
  return utcText(Date.parse(NOW) - days * 86400000 - seconds * 1000);
}

function memoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY, external_customer_id TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'qualified',
      assignment_status TEXT NOT NULL DEFAULT 'claimed',
      lifecycle_status TEXT NOT NULL DEFAULT 'active', is_test_data INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_activities (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '',
      activity_type TEXT NOT NULL DEFAULT '', occurred_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE crm_rfqs (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_quotes (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_orders (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, ordered_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_manager_tasks (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL, reason TEXT NOT NULL,
      owner_id_snapshot TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
      actor_id_snapshot TEXT NOT NULL DEFAULT '', recipient_ids_json TEXT NOT NULL DEFAULT '[]',
      evidence_json TEXT NOT NULL DEFAULT '{}', completion_condition TEXT NOT NULL DEFAULT '',
      settings_version INTEGER NOT NULL DEFAULT 1, threshold_snapshot_json TEXT NOT NULL DEFAULT '{}',
      evaluated_at TEXT NOT NULL DEFAULT '', triggered_at TEXT NOT NULL,
      due_at TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '{}',
      resolved_by TEXT NOT NULL DEFAULT '', resolved_at TEXT NOT NULL DEFAULT '',
      escalated_by TEXT NOT NULL DEFAULT '', escalated_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_manager_interventions (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, task_id TEXT NOT NULL,
      actor_id TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT '', business_change_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
  `);
  installDeferredPlanSchema(db);
  return db;
}

function user(id, role = 'sales', permissions = {}) {
  return { id, role, permissions };
}

const admin = () => user('ADMIN', 'admin', {
  view_all_customers: true,
  manage_intake: true,
  view_team: true,
});

function addSales(db, id) {
  db.prepare("INSERT INTO sales_users(id,role,active) VALUES (?,'sales',1)").run(id);
}

function addAccount(db, id, ownerId, overrides = {}) {
  const externalId = overrides.externalId || `EXT-${id}`;
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,owner_id,stage,assignment_status,lifecycle_status,is_test_data,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id,
    externalId,
    ownerId,
    overrides.stage || 'qualified',
    overrides.assignmentStatus || 'claimed',
    overrides.lifecycleStatus || 'active',
    overrides.isTestData ? 1 : 0,
    overrides.createdAt || ago({ days: 120 }),
    overrides.updatedAt || ago(),
  );
  return externalId;
}

function addDeferred(db, id, customerId, actorId, createdAt, overrides = {}) {
  db.prepare(`INSERT INTO crm_deferred_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,review_at,reason,source,source_event_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id,
    customerId,
    actorId,
    overrides.ownerIdSnapshot || actorId,
    overrides.reviewAt || utcText(Date.parse(`${createdAt.replace(' ', 'T')}Z`) + 86400000),
    overrides.reason || '等待客户确认',
    overrides.source || 'today_task',
    overrides.sourceEventId || `SRC-${id}`,
    createdAt,
  );
}

function addExplicit(db, id, customerId, actorId, createdAt, nextAt, overrides = {}) {
  db.prepare(`INSERT INTO crm_next_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,next_action,next_action_at,source,source_event_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, customerId, actorId, actorId, '确认后续需求', nextAt,
    overrides.source || 'activity', overrides.sourceEventId || `SRC-${id}`, createdAt,
  );
}

function addActivity(db, id, accountId, type, occurredAt, actorId = 'SALES-A') {
  db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,occurred_at,created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, accountId, actorId, type, occurredAt, occurredAt);
}

function addTask(db, id, customerId, ownerId, triggeredAt, overrides = {}) {
  db.prepare(`INSERT INTO crm_manager_tasks
    (id,idempotency_key,customer_id,reason,owner_id_snapshot,status,evaluated_at,
     triggered_at,due_at,resolved_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    `KEY-${id}`,
    customerId,
    overrides.reason || 'consecutive_deferred',
    ownerId,
    overrides.status || 'open',
    triggeredAt,
    triggeredAt,
    overrides.dueAt || utcText(Date.parse(`${triggeredAt.replace(' ', 'T')}Z`) + 72 * 3600000),
    overrides.resolvedAt || '',
    triggeredAt,
    triggeredAt,
  );
}

function metricFor(result, actorId) {
  const row = result.sales.find(item => item.actorId === actorId);
  assert.ok(row, `missing metrics for ${actorId}`);
  return row;
}

test('effective customer actions exclude internal notes and manager-only records', () => {
  for (const activityType of ['email', 'call', 'social', 'reply', 'meeting', 'rfq']) {
    assert.equal(isEffectiveCustomerAction({ activityType }), true, activityType);
  }
  for (const kind of ['rfq', 'quote', 'order']) {
    assert.equal(isEffectiveCustomerAction({ kind }), true, kind);
  }
  for (const activityType of ['note', 'manager_join', 'manager_advice', 'internal_note', '']) {
    assert.equal(isEffectiveCustomerAction({ activityType }), false, activityType);
  }
});

test('30 and 90 day windows are inclusive and deferred attribution follows actor, not current owner', () => {
  const db = memoryDb();
  try {
    addSales(db, 'SALES-A');
    addSales(db, 'SALES-B');
    for (let index = 0; index < 10; index += 1) addAccount(db, `A-${index}`, 'SALES-A');
    const moved = addAccount(db, 'MOVED', 'SALES-B');
    addDeferred(db, 'D-10', moved, 'SALES-A', ago({ days: 10 }), { ownerIdSnapshot: 'SALES-A' });
    addDeferred(db, 'D-30', 'EXT-A-0', 'SALES-A', ago({ days: 30 }));
    addDeferred(db, 'D-30-OLD', 'EXT-A-1', 'SALES-A', ago({ days: 30, seconds: 1 }));
    addDeferred(db, 'D-89', 'EXT-A-2', 'SALES-A', ago({ days: 89 }));
    addDeferred(db, 'D-91', 'EXT-A-3', 'SALES-A', ago({ days: 91 }));

    const thirty = metricFor(buildManagerMetrics(db, {
      user: admin(), rangeDays: 30, now: NOW,
    }), 'SALES-A');
    assert.equal(thirty.counts.deferredRecords, 2);
    assert.equal(thirty.counts.deferredCustomers, 2);
    assert.equal(thirty.sampleSize, 10);

    const ninety = metricFor(buildManagerMetrics(db, {
      user: admin(), rangeDays: 90, now: NOW,
    }), 'SALES-A');
    assert.equal(ninety.counts.deferredRecords, 4);
    assert.equal(ninety.counts.deferredCustomers, 4);
    assert.equal(ninety.sampleSize, 10);
  } finally { db.close(); }
});

test('M K and R must all pass before a sales summary needs manager review and never create tasks', () => {
  const db = memoryDb();
  try {
    const populations = { EXACT: 10, SMALL: 9, FEW: 10, RATE: 11 };
    for (const [actorId, population] of Object.entries(populations)) {
      addSales(db, actorId);
      for (let index = 0; index < population; index += 1) {
        const externalId = addAccount(db, `${actorId}-${index}`, actorId);
        const anomalous = actorId === 'FEW' ? index < 2 : index < 3;
        if (anomalous) addTask(db, `TASK-${actorId}-${index}`, externalId, actorId, ago({ days: 5 }));
      }
    }
    const before = db.prepare('SELECT COUNT(*) count FROM crm_manager_tasks').get().count;
    const result = buildManagerMetrics(db, {
      user: admin(),
      rangeDays: 30,
      now: NOW,
      settings: {
        salesAnomaly: {
          enabled: true,
          minActiveCustomers: 10,
          minAnomalousCustomers: 3,
          ratioPercent: 30,
        },
      },
    });
    assert.equal(metricFor(result, 'EXACT').needsManagerReview, true);
    assert.equal(metricFor(result, 'EXACT').unavailable, null);
    assert.deepEqual(metricFor(result, 'SMALL').unavailable.reasons, ['active_sample_below_minimum']);
    assert.deepEqual(metricFor(result, 'FEW').unavailable.reasons, [
      'anomaly_customers_below_minimum', 'anomaly_ratio_below_threshold',
    ]);
    assert.deepEqual(metricFor(result, 'RATE').unavailable.reasons, ['anomaly_ratio_below_threshold']);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_manager_tasks').get().count, before);

    const disabled = buildManagerMetrics(db, {
      user: admin(), rangeDays: 30, now: NOW,
      settings: { salesAnomaly: { enabled: false } },
    });
    assert.equal(metricFor(disabled, 'EXACT').needsManagerReview, false);
    assert.deepEqual(metricFor(disabled, 'EXACT').unavailable.reasons, ['sales_anomaly_rule_disabled']);
  } finally { db.close(); }
});

test('plan formation and on-time action rates use distinct customers and real post-plan actions', () => {
  const db = memoryDb();
  try {
    addSales(db, 'SALES-A');
    const customers = ['PLAN-OK', 'PLAN-LATE', 'NO-PLAN', 'PLAN-BEFORE'];
    for (const id of customers) addAccount(db, id, 'SALES-A');
    for (const id of customers) addDeferred(db, `D-${id}`, `EXT-${id}`, 'SALES-A', ago({ days: 10 }));

    addExplicit(db, 'P-OK', 'EXT-PLAN-OK', 'SALES-A', ago({ days: 9 }), ago({ days: 7 }));
    addActivity(db, 'ACT-OK', 'PLAN-OK', 'email', ago({ days: 7 }));

    addExplicit(db, 'P-LATE', 'EXT-PLAN-LATE', 'SALES-A', ago({ days: 9 }), ago({ days: 7 }));
    addActivity(db, 'ACT-INTERNAL', 'PLAN-LATE', 'manager_join', ago({ days: 8 }));
    addActivity(db, 'ACT-LATE', 'PLAN-LATE', 'reply', ago({ days: 6 }));

    addExplicit(db, 'P-BEFORE', 'EXT-PLAN-BEFORE', 'SALES-A', ago({ days: 11 }), ago({ days: 8 }));
    addActivity(db, 'ACT-BEFORE-ONLY', 'PLAN-BEFORE', 'call', ago({ days: 10, seconds: 1 }));

    const metrics = metricFor(buildManagerMetrics(db, {
      user: admin(), rangeDays: 30, now: NOW,
    }), 'SALES-A');
    assert.equal(metrics.counts.deferredCustomers, 4);
    assert.equal(metrics.counts.plannedAfterDeferredCustomers, 2);
    assert.equal(metrics.counts.onTimeActionCustomers, 1);
    assert.equal(metrics.ratios.planFormationRate, 50);
    assert.equal(metrics.ratios.onTimeActionRate, 50);
  } finally { db.close(); }
});

test('first-contact silence ignores internal notes and intervention improvement requires no same-reason recurrence', () => {
  const db = memoryDb();
  try {
    addSales(db, 'SALES-A');
    for (const id of ['SILENT', 'FOLLOWED', 'RECENT', 'RECUR', 'IMPROVED']) {
      addAccount(db, id, 'SALES-A');
    }
    addActivity(db, 'ACT-SILENT-1', 'SILENT', 'email', ago({ days: 20 }));
    addActivity(db, 'ACT-SILENT-NOTE', 'SILENT', 'note', ago({ days: 1 }));
    addActivity(db, 'ACT-FOLLOWED-1', 'FOLLOWED', 'email', ago({ days: 20 }));
    addActivity(db, 'ACT-FOLLOWED-2', 'FOLLOWED', 'call', ago({ days: 1 }));
    addActivity(db, 'ACT-RECENT-1', 'RECENT', 'email', ago({ days: 10 }));

    addTask(db, 'TASK-RECUR-1', 'EXT-RECUR', 'SALES-A', ago({ days: 20 }), {
      status: 'completed', resolvedAt: ago({ days: 15 }),
    });
    db.prepare(`INSERT INTO crm_manager_interventions
      (id,idempotency_key,task_id,actor_id,action,created_at) VALUES (?,?,?,?,?,?)`)
      .run('INT-RECUR', 'KEY-INT-RECUR', 'TASK-RECUR-1', 'MANAGER', 'manager_advice', ago({ days: 15 }));
    addTask(db, 'TASK-RECUR-2', 'EXT-RECUR', 'SALES-A', ago({ days: 5 }));

    addTask(db, 'TASK-IMPROVED-1', 'EXT-IMPROVED', 'SALES-A', ago({ days: 20 }), {
      status: 'completed', resolvedAt: ago({ days: 15 }),
    });
    db.prepare(`INSERT INTO crm_manager_interventions
      (id,idempotency_key,task_id,actor_id,action,created_at) VALUES (?,?,?,?,?,?)`)
      .run('INT-IMPROVED', 'KEY-INT-IMPROVED', 'TASK-IMPROVED-1', 'MANAGER', 'plan_formed', ago({ days: 15 }));

    const metrics = metricFor(buildManagerMetrics(db, {
      user: admin(), rangeDays: 30, now: NOW,
      settings: { firstContactSilence: { enabled: true, value: 14 } },
    }), 'SALES-A');
    assert.equal(metrics.counts.firstTouchSilentCustomers, 1);
    assert.equal(metrics.counts.unimprovedAfterInterventionCustomers, 1);
  } finally { db.close(); }
});

test('customer risk preserves cumulative history, current chain duration, snapshots and threshold time', () => {
  const db = memoryDb();
  try {
    addSales(db, 'SALES-A');
    addSales(db, 'SALES-B');
    const customerId = addAccount(db, 'RISK', 'SALES-B');
    addDeferred(db, 'D-RISK-1', customerId, 'SALES-A', ago({ days: 40 }), {
      ownerIdSnapshot: 'SALES-A', source: 'activity', reviewAt: ago({ days: 39 }),
    });
    addDeferred(db, 'D-RISK-2', customerId, 'SALES-A', ago({ days: 35 }), {
      ownerIdSnapshot: 'SALES-A', source: 'today_task', reviewAt: ago({ days: 34 }),
    });
    addExplicit(db, 'P-RISK', customerId, 'SALES-A', ago({ days: 30 }), ago({ days: 29 }));
    addDeferred(db, 'D-RISK-3', customerId, 'SALES-B', ago({ days: 20 }), {
      ownerIdSnapshot: 'SALES-B', source: 'today_task', reviewAt: ago({ days: 19 }),
    });
    addDeferred(db, 'D-RISK-4', customerId, 'MANAGER', ago({ days: 10 }), {
      ownerIdSnapshot: 'SALES-B', source: 'manager_intervention', reviewAt: ago({ days: 9 }),
    });
    addTask(db, 'TASK-RISK', customerId, 'SALES-B', ago({ days: 10 }), {
      reason: 'consecutive_deferred',
    });

    const risk = buildCustomerPlanRisk(db, {
      user: admin(), customerId, now: NOW,
    });
    assert.equal(risk.customerId, customerId);
    assert.equal(risk.currentOwnerId, 'SALES-B');
    assert.equal(risk.currentConsecutiveDeferredCount, 2);
    assert.equal(risk.cumulativeDeferredCount, 4);
    assert.equal(risk.unplannedDurationDays, 20);
    assert.equal(risk.thresholdAt, ago({ days: 10 }));
    assert.deepEqual(risk.history.map(item => ({
      id: item.id,
      actorId: item.actorId,
      ownerIdSnapshot: item.ownerIdSnapshot,
      reviewAt: item.reviewAt,
      source: item.source,
    })), [
      { id: 'D-RISK-1', actorId: 'SALES-A', ownerIdSnapshot: 'SALES-A', reviewAt: ago({ days: 39 }), source: 'activity' },
      { id: 'D-RISK-2', actorId: 'SALES-A', ownerIdSnapshot: 'SALES-A', reviewAt: ago({ days: 34 }), source: 'today_task' },
      { id: 'D-RISK-3', actorId: 'SALES-B', ownerIdSnapshot: 'SALES-B', reviewAt: ago({ days: 19 }), source: 'today_task' },
      { id: 'D-RISK-4', actorId: 'MANAGER', ownerIdSnapshot: 'SALES-B', reviewAt: ago({ days: 9 }), source: 'manager_intervention' },
    ]);

    assert.throws(
      () => buildCustomerPlanRisk(db, {
        user: user('SALES-A', 'sales', {}), customerId, now: NOW,
      }),
      error => error.statusCode === 404 && error.code === 'MANAGER_METRICS_CUSTOMER_NOT_FOUND',
    );
    assert.equal(buildCustomerPlanRisk(db, {
      user: user('SALES-B', 'sales', {}), customerId: 'RISK', now: NOW,
    }).customerId, customerId);
  } finally { db.close(); }
});

test('customer risk excludes superseded-source plans but retains marked immutable history', () => {
  const db = memoryDb();
  try {
    db.exec("ALTER TABLE crm_activities ADD COLUMN superseded_at TEXT NOT NULL DEFAULT ''");
    addSales(db, 'SALES-A');
    const customerId = addAccount(db, 'RISK-EFFECTIVE', 'SALES-A');
    addActivity(db, 'ACT-SUPERSEDED', 'RISK-EFFECTIVE', 'email', ago({ days: 21 }));
    db.prepare("UPDATE crm_activities SET superseded_at=? WHERE id='ACT-SUPERSEDED'")
      .run(ago({ days: 1 }));

    addDeferred(db, 'D-SUPERSEDED', customerId, 'SALES-A', ago({ days: 20 }), {
      source: 'activity', sourceEventId: 'ACT-SUPERSEDED',
    });
    addDeferred(db, 'D-EFFECTIVE', customerId, 'SALES-A', ago({ days: 10 }));
    addExplicit(db, 'P-SUPERSEDED', customerId, 'SALES-A', ago({ days: 5 }), ago({ days: 4 }), {
      sourceEventId: 'ACT-SUPERSEDED',
    });

    const risk = buildCustomerPlanRisk(db, {
      user: admin(), customerId, now: NOW,
    });
    assert.equal(risk.state, 'deferred');
    assert.equal(risk.currentConsecutiveDeferredCount, 1);
    assert.equal(risk.cumulativeDeferredCount, 1);
    assert.equal(risk.unplannedDurationDays, 10);
    assert.deepEqual(risk.history.map(item => ({ id: item.id, effective: item.effective })), [
      { id: 'D-SUPERSEDED', effective: false },
      { id: 'D-EFFECTIVE', effective: true },
    ]);
  } finally { db.close(); }
});

test('sales metrics are scoped before aggregation and expose no other salesperson totals', () => {
  const db = memoryDb();
  try {
    addSales(db, 'SALES-A');
    addSales(db, 'SALES-B');
    addSales(db, 'SALES-ZERO');
    const own = addAccount(db, 'OWN-A', 'SALES-A');
    const hidden = addAccount(db, 'HIDDEN-B', 'SALES-B');
    addDeferred(db, 'D-OWN', own, 'SALES-A', ago({ days: 5 }));
    addDeferred(db, 'D-HIDDEN-1', hidden, 'SALES-B', ago({ days: 5 }));
    addDeferred(db, 'D-HIDDEN-2', hidden, 'SALES-B', ago({ days: 4 }));

    const salesResult = buildManagerMetrics(db, {
      user: user('SALES-A', 'sales', {}), rangeDays: 30, now: NOW,
    });
    assert.deepEqual(salesResult.sales.map(item => item.actorId), ['SALES-A']);
    assert.equal(salesResult.summary.counts.deferredRecords, 1);
    assert.equal(JSON.stringify(salesResult).includes('SALES-B'), false);

    const adminResult = buildManagerMetrics(db, {
      user: admin(), rangeDays: 30, now: NOW,
    });
    assert.deepEqual(adminResult.sales.map(item => item.actorId).sort(), [
      'SALES-A', 'SALES-B', 'SALES-ZERO',
    ]);
    assert.equal(metricFor(adminResult, 'SALES-B').counts.deferredRecords, 2);
    assert.equal(metricFor(adminResult, 'SALES-ZERO').sampleSize, 0);
    assert.ok(metricFor(adminResult, 'SALES-ZERO').unavailable);
  } finally { db.close(); }
});

test('manager metric drill-down returns the exact permission-scoped customer cohort', () => {
  const db = memoryDb();
  try {
    addSales(db, 'SALES-A');
    addSales(db, 'SALES-B');
    const own = addAccount(db, 'OWN-A', 'SALES-A');
    const other = addAccount(db, 'OTHER-B', 'SALES-B');
    addDeferred(db, 'D-OWN', own, 'SALES-A', ago({ days: 5 }));
    addDeferred(db, 'D-OTHER', other, 'SALES-B', ago({ days: 5 }));

    const adminRows = buildManagerMetricDrilldown(db, {
      user: admin(), kind: 'deferredCustomers', actorId: 'SALES-A', rangeDays: 30, now: NOW,
    });
    assert.equal(adminRows.label, '延期客户');
    assert.equal(adminRows.total, 1);
    assert.deepEqual(adminRows.rows.map(row => row.customerId), [own]);
    assert.equal(adminRows.rows[0].ownerId, 'SALES-A');

    const salesRows = buildManagerMetricDrilldown(db, {
      user: user('SALES-A', 'sales', {}), kind: 'deferredCustomers', rangeDays: 30, now: NOW,
    });
    assert.deepEqual(salesRows.rows.map(row => row.customerId), [own]);
    assert.equal(JSON.stringify(salesRows).includes(other), false);
  } finally { db.close(); }
});
