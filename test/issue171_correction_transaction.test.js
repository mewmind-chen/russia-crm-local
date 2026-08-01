'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const Database = require('better-sqlite3');
const {
  correctionWriteEnabled,
  correctActivity,
  installActivityCorrectionSchema,
  listActivityCorrectionProposals,
  listActivityCorrections,
  proposeActivityCorrection,
  reviewActivityCorrection,
  searchCorrectionTargets,
} = require('../lib/crm_activity_corrections');

const ENABLED = Object.freeze({ CRM_ACTIVITY_CORRECTIONS_ENABLED: 'true' });
const NOW = '2026-08-02T12:00:00.000Z';

function permissions(overrides = {}) {
  return {
    view_all_customers: false,
    manage_intake: false,
    correct_own_activity: true,
    manage_activity_corrections: false,
    ...overrides,
  };
}

function actor(id = 'SALES-1', overrides = {}) {
  return {
    id,
    role: 'sales',
    permissions: permissions(),
    ...overrides,
  };
}

function memoryDb() {
  const db = new Database(':memory:');
  createBaseSchema(db);
  seedBase(db);
  return db;
}

function createBaseSchema(db) {
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY, external_customer_id TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '', nickname TEXT NOT NULL DEFAULT '',
      owner_id TEXT, stage TEXT NOT NULL DEFAULT 'new',
      assignment_status TEXT NOT NULL DEFAULT 'claimed',
      lifecycle_status TEXT NOT NULL DEFAULT 'active', is_test_data INTEGER NOT NULL DEFAULT 0,
      manager_id TEXT NOT NULL DEFAULT '', manager_required INTEGER NOT NULL DEFAULT 0,
      manager_status TEXT NOT NULL DEFAULT '', last_activity_at TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '', next_action_at TEXT NOT NULL DEFAULT '',
      next_action_time_basis TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '', nickname TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_activities (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, user_id TEXT NOT NULL,
      activity_type TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '', next_action_at TEXT NOT NULL DEFAULT '',
      stage_before TEXT NOT NULL DEFAULT '', stage_after TEXT NOT NULL DEFAULT '',
      manager_required INTEGER NOT NULL DEFAULT 0, progress_key TEXT NOT NULL DEFAULT '',
      reaction_option_id TEXT NOT NULL DEFAULT '', reaction_label_snapshot TEXT NOT NULL DEFAULT '',
      is_test_data INTEGER NOT NULL DEFAULT 0, test_run_id TEXT NOT NULL DEFAULT '',
      superseded_at TEXT NOT NULL DEFAULT '', superseded_by TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES crm_accounts(id)
    );
    CREATE TABLE crm_rfqs (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '',
      activity_id TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open', bom_lines INTEGER NOT NULL DEFAULT 0,
      expected_value REAL NOT NULL DEFAULT 0, product_category TEXT NOT NULL DEFAULT '',
      completeness INTEGER NOT NULL DEFAULT 0, received_at TEXT NOT NULL,
      quoted_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE crm_quotes (
      id TEXT PRIMARY KEY, rfq_id TEXT NOT NULL DEFAULT '', customer_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '', activity_id TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
      gross_margin REAL NOT NULL DEFAULT 0, loss_leader INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'sent', sent_at TEXT NOT NULL,
      next_follow_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE crm_orders (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, quote_id TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL DEFAULT '', activity_id TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
      gross_margin REAL NOT NULL DEFAULT 0, is_repeat INTEGER NOT NULL DEFAULT 0,
      ordered_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE crm_deferred_plan_events (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      owner_id_snapshot TEXT NOT NULL DEFAULT '', review_at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
      source_event_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      UNIQUE(source,source_event_id)
    );
    CREATE TABLE crm_next_plan_events (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      owner_id_snapshot TEXT NOT NULL DEFAULT '', next_action TEXT NOT NULL,
      next_action_at TEXT NOT NULL, source TEXT NOT NULL,
      source_event_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      UNIQUE(source,source_event_id)
    );
    CREATE TABLE crm_audit_log (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      real_user_id TEXT NOT NULL DEFAULT '', effective_user_id TEXT NOT NULL DEFAULT '',
      impersonation_context_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE test_outbox (
      id TEXT PRIMARY KEY, correction_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
  `);
}

function seedBase(db) {
  const insert = db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,nickname,owner_id,stage,assignment_status,
     lifecycle_status,is_test_data,manager_id,manager_required,manager_status,last_activity_at,
     next_action,next_action_at,next_action_time_basis,created_at,updated_at)
    VALUES (?,?,?,?,?,'qualified','claimed','active',0,'',0,'','2026-08-01 09:00:00',
      '污染计划','2099-01-01 00:00:00','utc','2026-01-01 00:00:00','2026-01-01 00:00:00')`);
  insert.run('CRM-SOURCE', 'EXT-SOURCE', 'Wrong Company', 'Wrong', 'SALES-1');
  insert.run('CRM-TARGET', 'EXT-TARGET', 'Right Company', 'Right', 'SALES-1');
  insert.run('CRM-OTHER', 'EXT-OTHER', 'Other Company', 'Other', 'SALES-2');
  db.prepare('INSERT INTO customer_pool(customer_id,company_name,nickname) VALUES (?,?,?)')
    .run('EXT-SOURCE', 'Wrong Company', 'Wrong');
  db.prepare('INSERT INTO customer_pool(customer_id,company_name,nickname) VALUES (?,?,?)')
    .run('EXT-TARGET', 'Right Company', 'Right');
  db.prepare('INSERT INTO customer_pool(customer_id,company_name,nickname) VALUES (?,?,?)')
    .run('EXT-OTHER', 'Other Company', 'Other');
  insertActivity(db);
}

function insertActivity(db, overrides = {}) {
  db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,
     stage_before,stage_after,manager_required,progress_key,reaction_option_id,
     reaction_label_snapshot,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    overrides.id || 'ACT-ORIGINAL',
    overrides.customerId || 'CRM-SOURCE',
    overrides.userId || 'SALES-1',
    overrides.activityType || 'email',
    overrides.channel || 'email',
    overrides.outcome || '已回复',
    overrides.summary || '需要更正的原始内容',
    overrides.nextAction || '继续跟进',
    overrides.nextActionAt || '2026-08-05 09:00:00',
    Object.prototype.hasOwnProperty.call(overrides, 'stageBefore') ? overrides.stageBefore : 'new',
    overrides.stageAfter || 'qualified',
    overrides.managerRequired ? 1 : 0,
    overrides.progressKey || 'email',
    overrides.reactionOptionId || 'REACTION-1',
    overrides.reactionSnapshot || '已回复',
    overrides.occurredAt || '2026-08-01 09:00:00',
    overrides.createdAt || '2026-08-01 09:01:00',
  );
}

function options(overrides = {}) {
  return {
    env: ENABLED,
    now: NOW,
    enqueueNotifications(db, event) {
      const relationId = `${event.proposalId || event.correctionId}:${event.decision
        || (event.correctionId ? 'corrected' : 'proposed')}`;
      db.prepare('INSERT INTO test_outbox(id,correction_id,created_at) VALUES (?,?,?)')
        .run(`OUT-${relationId}-${event.decision || 'created'}`, relationId, event.at);
    },
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    originalActivityId: 'ACT-ORIGINAL',
    targetCustomerId: 'CRM-TARGET',
    reason: '最初选择了错误客户',
    idempotencyKey: 'correction-request-1',
    ...overrides,
  };
}

function businessSnapshot(db) {
  return {
    accounts: db.prepare(`SELECT id,stage,last_activity_at,next_action,next_action_at,
      next_action_time_basis,manager_required,manager_status,updated_at
      FROM crm_accounts ORDER BY id`).all(),
    activities: db.prepare('SELECT * FROM crm_activities ORDER BY id').all(),
    rfqs: db.prepare('SELECT * FROM crm_rfqs ORDER BY id').all(),
    plans: db.prepare('SELECT * FROM crm_next_plan_events ORDER BY id').all(),
    corrections: hasTable(db, 'crm_activity_corrections')
      ? db.prepare('SELECT * FROM crm_activity_corrections ORDER BY id').all() : [],
    audits: db.prepare('SELECT * FROM crm_audit_log ORDER BY id').all(),
    outbox: db.prepare('SELECT * FROM test_outbox ORDER BY id').all(),
  };
}

function hasTable(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function assertCode(code) {
  return error => {
    assert.equal(error.code, code);
    return true;
  };
}

test('correction write flag only accepts explicit true values', () => {
  for (const value of ['true', 'TRUE', ' 1 ', 'on', 'YES']) {
    assert.equal(correctionWriteEnabled({ CRM_ACTIVITY_CORRECTIONS_ENABLED: value }), true, value);
  }
  for (const value of ['', 'false', '0', 'enabled', 'y', undefined]) {
    assert.equal(correctionWriteEnabled({ CRM_ACTIVITY_CORRECTIONS_ENABLED: value }), false, String(value));
  }
});

test('direct correction atomically preserves the original and copies activity-sourced plans', () => {
  const db = memoryDb();
  try {
    db.prepare(`INSERT INTO crm_next_plan_events
      (id,customer_id,actor_id,owner_id_snapshot,next_action,next_action_at,source,source_event_id,created_at)
      VALUES ('NPE-OLD','EXT-SOURCE','SALES-1','SALES-1','继续跟进','2026-08-05 09:00:00',
        'activity','ACT-ORIGINAL','2026-08-01 09:02:00')`).run();
    const result = correctActivity(db, actor(), request(), options());
    const original = db.prepare("SELECT * FROM crm_activities WHERE id='ACT-ORIGINAL'").get();
    const replacement = db.prepare('SELECT * FROM crm_activities WHERE id=?')
      .get(result.replacementActivityId);
    const plans = db.prepare('SELECT * FROM crm_next_plan_events ORDER BY id').all();

    assert.equal(original.summary, '需要更正的原始内容');
    assert.equal(original.customer_id, 'CRM-SOURCE');
    assert.equal(original.superseded_by, replacement.id);
    assert.equal(replacement.customer_id, 'CRM-TARGET');
    assert.equal(replacement.user_id, 'SALES-1', 'replacement retains the original creator');
    assert.equal(replacement.summary, original.summary);
    assert.equal(replacement.created_at, original.created_at, 'business ordering is preserved');
    assert.equal(plans.length, 2);
    const oldPlan = plans.find(row => row.id === 'NPE-OLD');
    assert.equal(oldPlan.customer_id, 'EXT-SOURCE');
    const copiedPlan = plans.find(row => row.id !== oldPlan.id);
    assert.equal(copiedPlan.customer_id, 'EXT-TARGET');
    assert.equal(copiedPlan.source_event_id, replacement.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_activity_corrections').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_audit_log').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM test_outbox').get().n, 1);
    assert.equal(db.prepare("SELECT last_activity_at FROM crm_accounts WHERE id='CRM-SOURCE'").get().last_activity_at, '');
    assert.equal(db.prepare("SELECT last_activity_at FROM crm_accounts WHERE id='CRM-TARGET'").get().last_activity_at,
      '2026-08-01 09:00:00');

    const replay = correctActivity(db, actor(), request(), options());
    assert.equal(replay.correctionId, result.correctionId);
    assert.equal(replay.replacementActivityId, result.replacementActivityId);
    assert.equal(replay.deduplicated, true);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_activities').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM test_outbox').get().n, 1);
  } finally { db.close(); }
});

test('stable linked commerce is copied to the target while the source milestone remains immutable', () => {
  const db = memoryDb();
  try {
    db.prepare("UPDATE crm_activities SET activity_type='rfq',progress_key='rfq' WHERE id='ACT-ORIGINAL'").run();
    db.prepare(`INSERT INTO crm_rfqs
      (id,customer_id,user_id,activity_id,reference,status,bom_lines,expected_value,
       product_category,completeness,received_at,quoted_at,created_at)
      VALUES ('RFQ-OLD','CRM-SOURCE','SALES-1','ACT-ORIGINAL','ALPHA-1','open',3,1200,
       'IC',80,'2026-08-01 09:00:00','','2026-08-01 09:01:00')`).run();
    db.prepare(`INSERT INTO crm_next_plan_events
      (id,customer_id,actor_id,owner_id_snapshot,next_action,next_action_at,source,source_event_id,created_at)
      VALUES ('NPE-RFQ-OLD','EXT-SOURCE','SALES-1','SALES-1','准备报价','2026-08-06 09:00:00',
        'rfq','RFQ-OLD','2026-08-01 09:02:00')`).run();
    const result = correctActivity(db, actor(), request(), options());
    const rows = db.prepare('SELECT * FROM crm_rfqs ORDER BY id').all();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.find(row => row.id === 'RFQ-OLD'), {
      id: 'RFQ-OLD', customer_id: 'CRM-SOURCE', user_id: 'SALES-1', activity_id: 'ACT-ORIGINAL',
      reference: 'ALPHA-1', status: 'open', bom_lines: 3, expected_value: 1200,
      product_category: 'IC', completeness: 80, received_at: '2026-08-01 09:00:00',
      quoted_at: '', created_at: '2026-08-01 09:01:00',
    });
    const copied = rows.find(row => row.id !== 'RFQ-OLD');
    assert.equal(copied.customer_id, 'CRM-TARGET');
    assert.equal(copied.activity_id, result.replacementActivityId);
    assert.equal(copied.reference, 'ALPHA-1');
    assert.equal(result.milestoneType, 'rfq');
    assert.equal(result.milestoneSourceId, 'RFQ-OLD');
    assert.equal(result.milestoneTargetId, copied.id);
    const milestonePlans = db.prepare("SELECT * FROM crm_next_plan_events WHERE source='rfq' ORDER BY id").all();
    assert.equal(milestonePlans.length, 2);
    const copiedPlan = milestonePlans.find(row => row.id !== 'NPE-RFQ-OLD');
    assert.equal(copiedPlan.customer_id, 'EXT-TARGET');
    assert.equal(copiedPlan.source_event_id, copied.id);
  } finally { db.close(); }
});

test('stable quote and order links detach upstream references on the target clone', () => {
  for (const milestone of [
    { type: 'quote', table: 'crm_quotes', upstream: 'rfq_id', upstreamId: 'RFQ-UPSTREAM' },
    { type: 'order', table: 'crm_orders', upstream: 'quote_id', upstreamId: 'Q-UPSTREAM' },
  ]) {
    const db = memoryDb();
    try {
      db.prepare('UPDATE crm_activities SET activity_type=?,progress_key=? WHERE id=?')
        .run(milestone.type, milestone.type, 'ACT-ORIGINAL');
      if (milestone.type === 'quote') {
        db.prepare(`INSERT INTO crm_quotes
          (id,rfq_id,customer_id,user_id,activity_id,amount,currency,gross_margin,loss_leader,
           status,sent_at,next_follow_at,created_at)
          VALUES ('Q-OLD',?,'CRM-SOURCE','SALES-1','ACT-ORIGINAL',100,'USD',10,0,
            'sent','2026-08-01 09:00:00','','2026-08-01 09:01:00')`).run(milestone.upstreamId);
      } else {
        db.prepare(`INSERT INTO crm_orders
          (id,customer_id,quote_id,user_id,activity_id,amount,currency,gross_margin,is_repeat,ordered_at,created_at)
          VALUES ('ORD-OLD','CRM-SOURCE',?,'SALES-1','ACT-ORIGINAL',100,'USD',10,0,
            '2026-08-01 09:00:00','2026-08-01 09:01:00')`).run(milestone.upstreamId);
      }
      const sourceId = milestone.type === 'quote' ? 'Q-OLD' : 'ORD-OLD';
      db.prepare(`INSERT INTO crm_next_plan_events
        (id,customer_id,actor_id,owner_id_snapshot,next_action,next_action_at,source,source_event_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        `NPE-${milestone.type}-OLD`, 'EXT-SOURCE', 'SALES-1', 'SALES-1', '继续跟进',
        '2026-08-06 09:00:00', milestone.type, sourceId, '2026-08-01 09:02:00',
      );
      const result = correctActivity(db, actor(), request({
        idempotencyKey: `direct-${milestone.type}`,
      }), options());
      const rows = db.prepare(`SELECT * FROM ${milestone.table} ORDER BY id`).all();
      assert.equal(rows.length, 2);
      const source = rows.find(row => row.id === sourceId);
      const target = rows.find(row => row.id !== sourceId);
      assert.equal(source.customer_id, 'CRM-SOURCE');
      assert.equal(source.activity_id, 'ACT-ORIGINAL');
      assert.equal(source[milestone.upstream], milestone.upstreamId);
      assert.equal(target.customer_id, 'CRM-TARGET');
      assert.equal(target.activity_id, result.replacementActivityId);
      assert.equal(target[milestone.upstream], '');
      const plans = db.prepare('SELECT * FROM crm_next_plan_events WHERE source=? ORDER BY id')
        .all(milestone.type);
      assert.equal(plans.length, 2);
      const targetPlan = plans.find(row => row.id !== `NPE-${milestone.type}-OLD`);
      assert.equal(targetPlan.customer_id, 'EXT-TARGET');
      assert.equal(targetPlan.source_event_id, target.id);
      const correction = db.prepare('SELECT mapping_evidence_json FROM crm_activity_corrections')
        .get();
      const evidence = JSON.parse(correction.mapping_evidence_json);
      assert.equal(evidence.upstreamId, milestone.upstreamId);
      assert.equal(evidence.clonePolicy, 'detach_upstream');
      assert.equal(evidence.commerceCopy.clonePolicy, 'detach_upstream');
      const replay = correctActivity(db, actor(), request({
        idempotencyKey: `direct-${milestone.type}`,
      }), options());
      assert.equal(replay.correctionId, result.correctionId);
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${milestone.table}`).get().n, 2);
    } finally { db.close(); }
  }
});

test('manager approval closes a stable upstream milestone proposal', () => {
  const db = memoryDb();
  try {
    db.prepare("UPDATE crm_activities SET activity_type='quote',progress_key='quote',user_id='OTHER-1' WHERE id='ACT-ORIGINAL'").run();
    db.prepare(`INSERT INTO crm_quotes
      (id,rfq_id,customer_id,user_id,activity_id,amount,currency,gross_margin,loss_leader,
       status,sent_at,next_follow_at,created_at)
      VALUES ('Q-APPROVAL','RFQ-UPSTREAM','CRM-SOURCE','OTHER-1','ACT-ORIGINAL',100,'USD',10,0,
        'sent','2026-08-01 09:00:00','','2026-08-01 09:01:00')`).run();
    const proposal = proposeActivityCorrection(
      db, actor(), request({ idempotencyKey: 'proposal-upstream-quote' }), options(),
    );
    const manager = actor('MANAGER-1', {
      role: 'manager',
      permissions: permissions({
        view_all_customers: true,
        manage_intake: true,
        manage_activity_corrections: true,
      }),
    });
    const result = reviewActivityCorrection(db, manager, {
      proposalId: proposal.proposalId,
      decision: 'approved',
      expectedVersion: 1,
      idempotencyKey: 'approve-upstream-quote',
    }, options());
    assert.equal(result.status, 'approved');
    assert.ok(result.correctionId);
    const target = db.prepare("SELECT * FROM crm_quotes WHERE id!='Q-APPROVAL'").get();
    assert.equal(target.customer_id, 'CRM-TARGET');
    assert.equal(target.rfq_id, '');
    const decided = db.prepare('SELECT status,version,correction_id FROM crm_activity_correction_proposals WHERE id=?')
      .get(proposal.proposalId);
    assert.deepEqual(decided, {
      status: 'approved', version: 2, correction_id: result.correctionId,
    });
  } finally { db.close(); }
});

for (const faultAt of [
  'replacement', 'correction', 'supersede', 'sourceRebuild', 'targetRebuild', 'notification',
]) {
  test(`fault at ${faultAt} rolls back every business, audit, and outbox write`, () => {
    const db = memoryDb();
    try {
      installActivityCorrectionSchema(db);
      const before = businessSnapshot(db);
      assert.throws(
        () => correctActivity(db, actor(), request(), options({ faultAt })),
        assertCode('ACTIVITY_CORRECTION_FAULT_INJECTED'),
      );
      assert.deepEqual(businessSnapshot(db), before);
    } finally { db.close(); }
  });
}

test('same key with a different request conflicts and a second key cannot create an orphan replacement', () => {
  const db = memoryDb();
  try {
    correctActivity(db, actor(), request(), options());
    assert.throws(
      () => correctActivity(db, actor(), request({ reason: '另一个原因' }), options()),
      assertCode('ACTIVITY_CORRECTION_IDEMPOTENCY_CONFLICT'),
    );
    assert.throws(
      () => correctActivity(db, actor(), request({ idempotencyKey: 'another-key' }), options()),
      assertCode('ACTIVITY_ALREADY_CORRECTED'),
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_activities').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_activity_corrections').get().n, 1);
  } finally { db.close(); }
});

test('uncertain milestone mapping returns stable approval requirement without writes', () => {
  const db = memoryDb();
  try {
    db.prepare("UPDATE crm_activities SET activity_type='quote',progress_key='quote' WHERE id='ACT-ORIGINAL'").run();
    installActivityCorrectionSchema(db);
    const before = businessSnapshot(db);
    assert.throws(
      () => correctActivity(db, actor(), request(), options()),
      error => error.code === 'REQUIRES_APPROVAL'
        && error.statusCode === 409
        && error.details.reasonCode === 'MAPPING_UNCERTAIN',
    );
    assert.deepEqual(businessSnapshot(db), before);
  } finally { db.close(); }
});

test('explicit manager resolution closes a genuinely ambiguous milestone proposal', () => {
  const db = memoryDb();
  try {
    db.prepare("UPDATE crm_activities SET activity_type='quote',progress_key='quote' WHERE id='ACT-ORIGINAL'").run();
    const proposal = proposeActivityCorrection(
      db, actor(), request({ idempotencyKey: 'proposal-ambiguous' }), options(),
    );
    const manager = actor('MANAGER-1', {
      role: 'manager',
      permissions: permissions({
        view_all_customers: true,
        manage_intake: true,
        manage_activity_corrections: true,
      }),
    });
    const baseReview = {
      proposalId: proposal.proposalId,
      decision: 'approved',
      expectedVersion: 1,
    };
    assert.throws(
      () => reviewActivityCorrection(db, manager, baseReview, options()),
      error => error.code === 'REQUIRES_APPROVAL'
        && error.details.reasonCode === 'MAPPING_UNCERTAIN',
    );
    assert.equal(db.prepare('SELECT status FROM crm_activity_correction_proposals WHERE id=?')
      .get(proposal.proposalId).status, 'pending');
    const result = reviewActivityCorrection(db, manager, {
      ...baseReview,
      idempotencyKey: 'review-ambiguous-activity-only',
      resolution: { mode: 'activity_only' },
    }, options());
    assert.equal(result.status, 'approved');
    assert.ok(result.correctionId);
    const correction = db.prepare('SELECT mapping_evidence_json FROM crm_activity_corrections WHERE id=?')
      .get(result.correctionId);
    assert.deepEqual(JSON.parse(correction.mapping_evidence_json).resolution, {
      mode: 'activity_only',
    });
  } finally { db.close(); }
});

test('proposal approval can override creator ownership and remains idempotent', () => {
  const db = memoryDb();
  try {
    db.prepare("UPDATE crm_activities SET user_id='SALES-ARCHIVED' WHERE id='ACT-ORIGINAL'").run();
    const proposal = proposeActivityCorrection(db, actor(), request({ idempotencyKey: 'proposal-1' }), options());
    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.reasonCode, 'OTHER_CREATOR');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_activities').get().n, 1);

    const manager = actor('MANAGER-1', {
      role: 'manager',
      permissions: permissions({ view_all_customers: true, manage_intake: true,
        manage_activity_corrections: true }),
    });
    const reviewInput = {
      proposalId: proposal.proposalId,
      decision: 'approved',
      reason: '已核对原始记录',
      expectedVersion: 1,
      idempotencyKey: 'review-1',
    };
    const reviewed = reviewActivityCorrection(db, manager, reviewInput, options());
    assert.equal(reviewed.status, 'approved');
    assert.ok(reviewed.correctionId);
    const correction = db.prepare('SELECT * FROM crm_activity_corrections WHERE id=?')
      .get(reviewed.correctionId);
    assert.equal(correction.actor_id, 'SALES-1');
    assert.equal(correction.original_creator_id, 'SALES-ARCHIVED');
    assert.equal(correction.reviewer_id, 'MANAGER-1');
    const replay = reviewActivityCorrection(db, manager, reviewInput, options());
    assert.equal(replay.correctionId, reviewed.correctionId);
    assert.equal(replay.deduplicated, true);
  } finally { db.close(); }
});

test('approval with an unreliable source baseline leaves the proposal pending and writes no decision', () => {
  const db = memoryDb();
  try {
    db.prepare("UPDATE crm_activities SET user_id='SALES-ARCHIVED',stage_before='' WHERE id='ACT-ORIGINAL'").run();
    const proposal = proposeActivityCorrection(db, actor(), request({ idempotencyKey: 'proposal-baseline' }), options());
    const before = businessSnapshot(db);
    const manager = actor('MANAGER-1', {
      role: 'manager',
      permissions: permissions({ view_all_customers: true, manage_intake: true,
        manage_activity_corrections: true }),
    });
    assert.throws(() => reviewActivityCorrection(db, manager, {
      proposalId: proposal.proposalId,
      decision: 'approved',
      expectedVersion: 1,
      idempotencyKey: 'review-baseline',
    }, options()), error => error.code === 'REQUIRES_APPROVAL'
      && error.details.reasonCode === 'STAGE_BASELINE_UNCERTAIN');
    assert.deepEqual(businessSnapshot(db), before);
    assert.equal(db.prepare('SELECT status FROM crm_activity_correction_proposals WHERE id=?')
      .get(proposal.proposalId).status, 'pending');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_activity_correction_decisions').get().n, 0);
  } finally { db.close(); }
});

test('source and target scope are both enforced for writes, search, and history', () => {
  const db = memoryDb();
  try {
    assert.throws(
      () => correctActivity(db, actor(), request({ targetCustomerId: 'CRM-OTHER' }), options()),
      assertCode('ACTIVITY_CORRECTION_FORBIDDEN'),
    );
    assert.deepEqual(searchCorrectionTargets(db, actor(), { q: 'Other' }), []);
    const result = correctActivity(db, actor(), request(), options());
    assert.deepEqual(listActivityCorrections(db, actor()).map(row => row.correctionId), [result.correctionId]);
    db.prepare("UPDATE crm_accounts SET owner_id='SALES-2' WHERE id='CRM-TARGET'").run();
    assert.deepEqual(listActivityCorrections(db, actor()), [], 'history must not reveal a now-unscoped side');
  } finally { db.close(); }
});

test('proposal listing applies manager scope to both customers', () => {
  const db = memoryDb();
  try {
    db.prepare("UPDATE crm_activities SET user_id='SALES-ARCHIVED' WHERE id='ACT-ORIGINAL'").run();
    const proposal = proposeActivityCorrection(db, actor(), request({ idempotencyKey: 'proposal-list' }), options());
    const manager = actor('MANAGER-1', {
      role: 'manager',
      permissions: permissions({ view_all_customers: true, manage_intake: true,
        manage_activity_corrections: true }),
    });
    assert.deepEqual(listActivityCorrectionProposals(db, manager).map(row => row.proposalId),
      [proposal.proposalId]);
    db.prepare("UPDATE crm_accounts SET lifecycle_status='recycled' WHERE id='CRM-TARGET'").run();
    assert.deepEqual(listActivityCorrectionProposals(db, manager), []);
  } finally { db.close(); }
});

test('idempotency replay rechecks current scope for correction, proposal, and review', () => {
  {
    const db = memoryDb();
    try {
      correctActivity(db, actor(), request(), options());
      db.prepare("UPDATE crm_accounts SET owner_id='SALES-2' WHERE id='CRM-TARGET'").run();
      assert.throws(() => correctActivity(db, actor(), request(), options()),
        assertCode('ACTIVITY_CORRECTION_FORBIDDEN'));
    } finally { db.close(); }
  }
  {
    const db = memoryDb();
    try {
      db.prepare("UPDATE crm_activities SET user_id='SALES-ARCHIVED' WHERE id='ACT-ORIGINAL'").run();
      const proposalRequest = request({ idempotencyKey: 'proposal-replay-scope' });
      proposeActivityCorrection(db, actor(), proposalRequest, options());
      db.prepare("UPDATE crm_accounts SET owner_id='SALES-2' WHERE id='CRM-TARGET'").run();
      assert.throws(() => proposeActivityCorrection(db, actor(), proposalRequest, options()),
        assertCode('ACTIVITY_CORRECTION_FORBIDDEN'));
    } finally { db.close(); }
  }
  {
    const db = memoryDb();
    try {
      db.prepare("UPDATE crm_activities SET user_id='SALES-ARCHIVED' WHERE id='ACT-ORIGINAL'").run();
      const proposal = proposeActivityCorrection(
        db, actor(), request({ idempotencyKey: 'proposal-review-scope' }), options(),
      );
      const manager = actor('SALES-1', {
        role: 'manager',
        permissions: permissions({ manage_activity_corrections: true }),
      });
      const review = {
        proposalId: proposal.proposalId,
        decision: 'rejected',
        reason: '拒绝测试',
        expectedVersion: 1,
        idempotencyKey: 'review-replay-scope',
      };
      reviewActivityCorrection(db, manager, review, options());
      db.prepare("UPDATE crm_accounts SET owner_id='SALES-2' WHERE id='CRM-TARGET'").run();
      assert.throws(() => reviewActivityCorrection(db, manager, review, options()),
        assertCode('ACTIVITY_CORRECTION_FORBIDDEN'));
    } finally { db.close(); }
  }
});

test('proposal and review outbox failures roll back their owning transaction', () => {
  const db = memoryDb();
  try {
    db.prepare("UPDATE crm_activities SET user_id='SALES-ARCHIVED' WHERE id='ACT-ORIGINAL'").run();
    const failing = options({
      enqueueNotifications() { throw new Error('outbox unavailable'); },
    });
    assert.throws(() => proposeActivityCorrection(
      db, actor(), request({ idempotencyKey: 'proposal-outbox-fail' }), failing,
    ), /outbox unavailable/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_activity_correction_proposals').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_audit_log').get().n, 0);

    const proposal = proposeActivityCorrection(
      db, actor(), request({ idempotencyKey: 'proposal-outbox-ok' }), options(),
    );
    const manager = actor('MANAGER-1', {
      role: 'manager',
      permissions: permissions({ view_all_customers: true, manage_intake: true,
        manage_activity_corrections: true }),
    });
    assert.throws(() => reviewActivityCorrection(db, manager, {
      proposalId: proposal.proposalId,
      decision: 'rejected',
      reason: '审批通知失败测试',
      expectedVersion: 1,
    }, failing), /outbox unavailable/);
    const stored = db.prepare('SELECT status,version FROM crm_activity_correction_proposals WHERE id=?')
      .get(proposal.proposalId);
    assert.deepEqual(stored, { status: 'pending', version: 1 });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_activity_correction_decisions').get().n, 0);
  } finally { db.close(); }
});

test('a direct rebuild conflict can be persisted as a pending proposal with a stable override reason', () => {
  const db = memoryDb();
  try {
    db.prepare("UPDATE crm_activities SET stage_before='' WHERE id='ACT-ORIGINAL'").run();
    assert.throws(() => correctActivity(db, actor(), request(), options()), error =>
      error.code === 'REQUIRES_APPROVAL'
      && error.details.reasonCode === 'STAGE_BASELINE_UNCERTAIN');
    const proposal = proposeActivityCorrection(
      db,
      actor(),
      request({ idempotencyKey: 'baseline-proposal' }),
      options({ reasonCodeOverride: 'STAGE_BASELINE_UNCERTAIN' }),
    );
    assert.equal(proposal.status, 'pending');
    assert.equal(proposal.reasonCode, 'STAGE_BASELINE_UNCERTAIN');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_activities').get().n, 1);
  } finally { db.close(); }
});

test('two SQLite connections competing for one original produce one correction and no orphan', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-correction-race-'));
  const dbPath = path.join(dir, 'crm.db');
  const setup = new Database(dbPath);
  try {
    setup.pragma('journal_mode=WAL');
    createBaseSchema(setup);
    seedBase(setup);
    installActivityCorrectionSchema(setup);
  } finally { setup.close(); }

  const modulePath = path.resolve(__dirname, '../lib/crm_activity_corrections.js');
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require('better-sqlite3');
    const { correctActivity } = require(workerData.modulePath);
    const db = new Database(workerData.dbPath);
    db.pragma('busy_timeout=5000');
    try {
      const result = correctActivity(db, workerData.user, workerData.request, {
        env: { CRM_ACTIVITY_CORRECTIONS_ENABLED: 'true' }, now: '${NOW}'
      });
      parentPort.postMessage({ ok: true, result });
    } catch (error) {
      parentPort.postMessage({ ok: false, code: error.code, statusCode: error.statusCode, message: error.message });
    } finally { db.close(); }
  `;
  const run = key => new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: { dbPath, modulePath, user: actor(), request: request({ idempotencyKey: key }) },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  try {
    const results = await Promise.all([run('race-1'), run('race-2')]);
    assert.equal(results.filter(result => result.ok).length, 1, JSON.stringify(results));
    assert.equal(results.filter(result => result.code === 'ACTIVITY_ALREADY_CORRECTED').length, 1,
      JSON.stringify(results));
    const verify = new Database(dbPath);
    try {
      assert.equal(verify.prepare('SELECT COUNT(*) n FROM crm_activity_corrections').get().n, 1);
      assert.equal(verify.prepare('SELECT COUNT(*) n FROM crm_activities').get().n, 2);
      const replacementId = verify.prepare("SELECT superseded_by FROM crm_activities WHERE id='ACT-ORIGINAL'").get().superseded_by;
      assert.equal(verify.prepare('SELECT COUNT(*) n FROM crm_activities WHERE id=?').get(replacementId).n, 1);
    } finally { verify.close(); }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
