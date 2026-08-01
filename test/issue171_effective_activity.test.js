'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const { installSalesCrm } = require('../lib/sales_crm');
const { buildAccessContext } = require('../lib/access_control');
const { hydrateUserPermissions } = require('../lib/permission_groups');
const { buildCustomerContext } = require('../lib/ai_stations/context');
const { loadManagerScope } = require('../lib/ai_stations/manager_anomaly');
const { loadSalesCoachingScope } = require('../lib/ai_stations/sales_coaching');
const { buildManagerMetrics } = require('../lib/manager_metrics');
const {
  addActivityProvenance,
  effectiveActivityCondition,
  effectiveActivityWhereClause,
  effectiveCommerceSql,
  effectivePlanWhereClause,
  isEffectiveActivity,
  linkCommerceActivity,
  listActivitiesWithProvenance,
  listEffectiveActivities,
} = require('../lib/crm_activity_effective');

function correctionDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE crm_activities (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      activity_type TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      superseded_at TEXT NOT NULL DEFAULT '',
      superseded_by TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_rfqs (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, activity_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_quotes (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, activity_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_orders (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, activity_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_deferred_plan_events (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',
      source_event_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE crm_next_plan_events (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT '',
      source_event_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,summary,occurred_at,created_at,superseded_at,superseded_by)
    VALUES (?,?, 'SALES-1','call',?,?,?,?,?)`);
  insert.run('ACT-ORIGINAL', 'CRM-WRONG', '原记录', '2026-07-01 09:00:00',
    '2026-07-01 09:01:00', '2026-08-02 01:00:00', 'ACT-REPLACEMENT');
  insert.run('ACT-SAME-TIME-B', 'CRM-WRONG', '同一时间 B', '2026-07-02 09:00:00',
    '2026-07-02 09:01:00', '', '');
  insert.run('ACT-SAME-TIME-A', 'CRM-WRONG', '同一时间 A', '2026-07-02 09:00:00',
    '2026-07-02 09:01:00', '', '');
  insert.run('ACT-REPLACEMENT', 'CRM-CORRECT', '替代记录', '2026-07-01 09:00:00',
    '2026-08-02 01:00:00', '', '');
  return db;
}

function assertCode(expectedCode) {
  return error => {
    assert.equal(error.code, expectedCode);
    assert.ok(Number.isInteger(error.statusCode));
    return true;
  };
}

test('effective SQL helpers are strict, alias-safe, and match row semantics', () => {
  const db = correctionDb();
  try {
    assert.equal(effectiveActivityCondition(), "superseded_at=''");
    assert.equal(effectiveActivityCondition('activity'), "activity.superseded_at=''");
    assert.equal(effectiveActivityWhereClause(db, 'a'), "a.superseded_at=''");
    assert.throws(() => effectiveActivityCondition('a; DROP TABLE crm_activities'), TypeError);
    assert.equal(isEffectiveActivity({ superseded_at: '' }), true);
    assert.equal(isEffectiveActivity({ superseded_at: '2026-08-02 01:00:00' }), false);
    assert.equal(isEffectiveActivity({ superseded_at: null }), false);
    assert.equal(isEffectiveActivity({}), true);
    assert.equal(isEffectiveActivity(null), false);
  } finally {
    db.close();
  }
});

test('business reader excludes superseded originals and uses deterministic ordering', () => {
  const db = correctionDb();
  try {
    const wrongCustomer = listEffectiveActivities(db, 'CRM-WRONG');
    assert.deepEqual(wrongCustomer.map(row => row.id), [
      'ACT-SAME-TIME-A',
      'ACT-SAME-TIME-B',
    ]);
    assert.equal(wrongCustomer.some(row => row.id === 'ACT-ORIGINAL'), false);

    const correctCustomer = listEffectiveActivities(db, 'CRM-CORRECT');
    assert.deepEqual(correctCustomer.map(row => row.id), ['ACT-REPLACEMENT']);
    assert.deepEqual(correctCustomer[0].provenance, {
      kind: 'replacement',
      originalActivityId: 'ACT-ORIGINAL',
      replacementActivityId: 'ACT-REPLACEMENT',
      originalCustomerId: 'CRM-WRONG',
      replacementCustomerId: 'CRM-CORRECT',
      originalActivityIds: ['ACT-ORIGINAL'],
    });
  } finally {
    db.close();
  }
});

test('history reader retains immutable original and replacement provenance across customers', () => {
  const db = correctionDb();
  try {
    const original = listActivitiesWithProvenance(db, 'CRM-WRONG')
      .find(row => row.id === 'ACT-ORIGINAL');
    assert.deepEqual(original.provenance, {
      kind: 'superseded_original',
      originalActivityId: 'ACT-ORIGINAL',
      replacementActivityId: 'ACT-REPLACEMENT',
      originalCustomerId: 'CRM-WRONG',
      replacementCustomerId: 'CRM-CORRECT',
      originalActivityIds: ['ACT-ORIGINAL'],
    });

    const replacement = listActivitiesWithProvenance(db, 'CRM-CORRECT')
      .find(row => row.id === 'ACT-REPLACEMENT');
    assert.equal(replacement.provenance.kind, 'replacement');
    assert.equal(replacement.provenance.originalActivityId, 'ACT-ORIGINAL');
    assert.equal(replacement.provenance.originalCustomerId, 'CRM-WRONG');
  } finally {
    db.close();
  }
});

test('batch provenance decoration is pure and decorates bootstrap rows without queries', () => {
  const rows = [
    { id: 'ORIGINAL', customer_id: 'C1', superseded_at: '2026-08-02', superseded_by: 'REPLACEMENT' },
    { id: 'REPLACEMENT', customer_id: 'C2', superseded_at: '', superseded_by: '' },
    { id: 'STANDALONE', customer_id: 'C3', superseded_at: '', superseded_by: '' },
  ];
  const decorated = addActivityProvenance(rows);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'provenance'), false);
  assert.equal(decorated[0].provenance.kind, 'superseded_original');
  assert.equal(decorated[1].provenance.kind, 'replacement');
  assert.equal(decorated[2].provenance.kind, 'standalone');
  assert.equal(decorated[0].provenance.replacementCustomerId, 'C2');
  assert.equal(decorated[1].provenance.originalCustomerId, 'C1');
});

test('legacy activity fixtures remain readable before additive columns are installed', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE crm_activities (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO crm_activities VALUES
      ('LEGACY-2','CRM-1','2026-07-02','2026-07-02'),
      ('LEGACY-1','CRM-1','2026-07-01','2026-07-01');`);
    assert.equal(effectiveActivityWhereClause(db, 'a'), '1=1');
    assert.deepEqual(listEffectiveActivities(db, 'CRM-1').map(row => row.id), [
      'LEGACY-1',
      'LEGACY-2',
    ]);
  } finally {
    db.close();
  }
});

test('commerce activity links support rfq, quote, and order and are idempotent', () => {
  const db = correctionDb();
  try {
    for (const [entityType, table, entityId] of [
      ['rfq', 'crm_rfqs', 'RFQ-1'],
      ['quote', 'crm_quotes', 'QUOTE-1'],
      ['order', 'crm_orders', 'ORDER-1'],
    ]) {
      db.prepare(`INSERT INTO ${table}(id,customer_id) VALUES (?,'CRM-CORRECT')`).run(entityId);
      const created = linkCommerceActivity(db, {
        activityId: 'ACT-REPLACEMENT', entityType, entityId,
      });
      assert.equal(created.created, true);
      assert.equal(created.customerId, 'CRM-CORRECT');
      assert.equal(db.prepare(`SELECT activity_id FROM ${table} WHERE id=?`).get(entityId).activity_id,
        'ACT-REPLACEMENT');
      assert.equal(linkCommerceActivity(db, {
        activityId: 'ACT-REPLACEMENT', entityType, entityId,
      }).created, false);
    }
  } finally {
    db.close();
  }
});

test('commerce links reject missing, cross-customer, unsupported, and conflicting targets', () => {
  const db = correctionDb();
  try {
    db.exec(`
      INSERT INTO crm_rfqs(id,customer_id) VALUES ('RFQ-WRONG','CRM-WRONG');
      INSERT INTO crm_quotes(id,customer_id,activity_id)
        VALUES ('QUOTE-LINKED','CRM-CORRECT','ACT-SAME-TIME-A');
    `);
    assert.throws(() => linkCommerceActivity(db, {
      activityId: 'ACT-REPLACEMENT', entityType: 'invoice', entityId: 'INV-1',
    }), assertCode('ACTIVITY_LINK_ENTITY_TYPE_INVALID'));
    assert.throws(() => linkCommerceActivity(db, {
      activityId: 'MISSING', entityType: 'rfq', entityId: 'RFQ-WRONG',
    }), assertCode('ACTIVITY_LINK_ACTIVITY_NOT_FOUND'));
    assert.throws(() => linkCommerceActivity(db, {
      activityId: 'ACT-REPLACEMENT', entityType: 'rfq', entityId: 'MISSING',
    }), assertCode('ACTIVITY_LINK_ENTITY_NOT_FOUND'));
    assert.throws(() => linkCommerceActivity(db, {
      activityId: 'ACT-REPLACEMENT', entityType: 'rfq', entityId: 'RFQ-WRONG',
    }), assertCode('ACTIVITY_LINK_CUSTOMER_MISMATCH'));
    assert.throws(() => linkCommerceActivity(db, {
      activityId: 'ACT-REPLACEMENT', entityType: 'quote', entityId: 'QUOTE-LINKED',
    }), assertCode('ACTIVITY_LINK_CONFLICT'));
  } finally {
    db.close();
  }
});

test('effective commerce and plan SQL exclude records linked to superseded activity', () => {
  const db = correctionDb();
  try {
    db.exec(`
      INSERT INTO crm_rfqs(id,customer_id,activity_id) VALUES
        ('RFQ-OLD','CRM-WRONG','ACT-ORIGINAL'),
        ('RFQ-LEGACY','CRM-WRONG','');
      INSERT INTO crm_next_plan_events VALUES
        ('PLAN-OLD','CRM-WRONG','activity','ACT-ORIGINAL','2026-08-02'),
        ('PLAN-VALID','CRM-WRONG','manual','','2026-08-02');
    `);
    const commerceSql = effectiveCommerceSql(db, 'rfq', {
      commerce: 'r', activity: 'linked',
    });
    assert.deepEqual(db.prepare(`SELECT r.id FROM crm_rfqs r ${commerceSql.join}
      WHERE ${commerceSql.condition} ORDER BY r.id`).all().map(row => row.id), ['RFQ-LEGACY']);
    assert.deepEqual(db.prepare(`SELECT p.id FROM crm_next_plan_events p
      WHERE ${effectivePlanWhereClause(db, 'crm_next_plan_events', 'p')}
      ORDER BY p.id`).all().map(row => row.id), ['PLAN-VALID']);
  } finally {
    db.close();
  }
});

test('RFQ, quote, and order APIs persist exact stable activity links', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: {
      record_activity: true,
      record_quote: true,
      record_order: true,
      view_customers: true,
    },
  });
  t.after(() => fx.close());

  installSalesCrm();
  installSalesCrm();
  assert.ok(['superseded_at', 'superseded_by'].every(column =>
    fx.db.prepare('PRAGMA table_info(crm_activities)').all().some(row => row.name === column)));
  for (const table of ['crm_rfqs', 'crm_quotes', 'crm_orders']) {
    assert.ok(fx.db.prepare(`PRAGMA table_info(${table})`).all()
      .some(row => row.name === 'activity_id'));
    assert.ok(fx.db.prepare(`PRAGMA index_list(${table})`).all()
      .some(row => row.name === `${table}_activity_idx`));
  }

  const rfqResponse = await fx.request('/api/sales-crm/activities', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN',
      progressType: 'rfq',
      reactionOptionId: 'REACTION-FOLLOW-UP',
      summary: '收到稳定链接测试询价',
      nextAction: '准备报价',
      nextActionAt: '2099-08-05 09:00:00',
      reference: 'RFQ-171-LINK',
      bomLines: 2,
      expectedValue: 1000,
      completeness: 90,
    },
  });
  assert.equal(rfqResponse.status, 200);
  const rfqBody = await rfqResponse.json();
  const rfq = fx.db.prepare(`SELECT * FROM crm_rfqs
    WHERE reference='RFQ-171-LINK'`).get();
  assert.equal(rfq.activity_id, rfqBody.activityId);

  const quotePayload = {
    customerId: 'CRM-OWN',
    rfqId: rfq.id,
    amount: 1000,
    currency: 'USD',
    grossMargin: 8,
    nextFollowAt: '2099-08-06 09:00:00',
    idempotencyKey: 'issue171-link-quote',
  };
  const quoteResponse = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.cookie, method: 'POST', body: quotePayload,
  });
  assert.equal(quoteResponse.status, 200);
  const quoteBody = await quoteResponse.json();
  const quote = fx.db.prepare('SELECT * FROM crm_quotes WHERE id=?').get(quoteBody.quoteId);
  assert.equal(quote.activity_id, quoteBody.activityId);

  const orderPayload = {
    customerId: 'CRM-OWN',
    quoteId: quote.id,
    amount: 1000,
    currency: 'USD',
    grossMargin: 7,
    nextActionAt: '2099-08-10 09:00:00',
    idempotencyKey: 'issue171-link-order',
  };
  const orderResponse = await fx.request('/api/sales-crm/orders', {
    cookie: fx.cookie, method: 'POST', body: orderPayload,
  });
  assert.equal(orderResponse.status, 200);
  const orderBody = await orderResponse.json();
  const order = fx.db.prepare('SELECT * FROM crm_orders WHERE id=?').get(orderBody.orderId);
  assert.equal(order.activity_id, orderBody.activityId);

  const replayQuote = await fx.request('/api/sales-crm/quotes', {
    cookie: fx.cookie, method: 'POST', body: quotePayload,
  });
  const replayOrder = await fx.request('/api/sales-crm/orders', {
    cookie: fx.cookie, method: 'POST', body: orderPayload,
  });
  assert.equal((await replayQuote.json()).deduplicated, true);
  assert.equal((await replayOrder.json()).deduplicated, true);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_quotes WHERE customer_id='CRM-OWN'").get().count, 1);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_orders WHERE customer_id='CRM-OWN'").get().count, 1);
});

test('operational readers ignore superseded activity, commerce, and sourced plans', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: {
      view_customers: true,
      view_contacts: true,
      view_alerts: true,
      view_team: true,
      view_markets: true,
      resolve_manager_tasks: true,
    },
  });
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET stage='qualified',manager_required=0,
    manager_status='',last_activity_at='',next_action='',next_action_at=''
    WHERE id='CRM-OWN'`).run();
  const insertActivity = fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,
     stage_before,stage_after,manager_required,occurred_at,created_at,superseded_at,superseded_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertActivity.run(
    'ACT-171-OLD', 'CRM-OWN', 'U-MGR', 'meeting', 'video', '已完成', '错误客户活动', '', '',
    'qualified', 'meeting', 1, '2026-07-20 08:00:00', '2026-07-20 08:00:01',
    '2026-08-01 08:00:00', 'ACT-171-NEW',
  );
  insertActivity.run(
    'ACT-171-NEW', 'CRM-OWN', 'U-MGR', 'call', 'phone', '已联系', '替代活动', '', '',
    'qualified', 'contacted', 0, '2026-07-20 08:00:00', '2026-08-01 08:00:00', '', '',
  );
  fx.db.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,activity_id,reference,status,bom_lines,expected_value,
     product_category,completeness,received_at,quoted_at,created_at)
    VALUES ('RFQ-171-OLD','CRM-OWN','U-MGR','ACT-171-OLD','OLD','open',1,1000,'',80,
      '2026-07-20 08:00:00','','2026-07-20 08:00:01')`).run();
  fx.db.prepare(`INSERT INTO crm_deferred_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,review_at,reason,source,source_event_id,created_at)
    VALUES
      ('DEFER-171-OLD','RU-9002','U-OTHER','U-MGR','2099-08-10 09:00:00','错误延期',
       'activity','ACT-171-OLD','2026-07-22 08:00:00'),
      ('DEFER-171-VALID','RU-9002','U-OTHER','U-MGR','2026-07-30 09:00:00','人工延期',
       'manual_deferred','MANUAL-171','2026-07-23 08:00:00')`).run();
  fx.db.prepare(`INSERT INTO crm_next_plan_events
    (id,customer_id,actor_id,owner_id_snapshot,next_action,next_action_at,source,source_event_id,created_at)
    VALUES ('PLAN-171-OLD','RU-9002','U-OTHER','U-MGR','错误计划','2099-08-12 09:00:00',
      'activity','ACT-171-OLD','2026-07-24 08:00:00')`).run();

  const bootstrapResponse = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  assert.equal(bootstrapResponse.status, 200);
  const bootstrap = await bootstrapResponse.json();
  assert.deepEqual(bootstrap.activities.filter(row => row.customer_id === 'CRM-OWN')
    .map(row => [row.id, row.effective]).sort(), [
    ['ACT-171-NEW', true],
    ['ACT-171-OLD', false],
  ]);
  assert.equal(bootstrap.timeline.some(row => row.id === 'activity:ACT-171-OLD'
    && row.superseded === true), true);
  const reasons = bootstrap.alerts.find(row => row.customerId === 'CRM-OWN')?.reasons || [];
  assert.equal(reasons.some(row => row.code === 'RFQ_UNQUOTED'), false);
  assert.equal(reasons.some(row => row.code === 'NO_NEXT_DEFERRED'), true);

  const accessContext = { accountIds: new Set(['CRM-OWN']), canViewAllCustomers: false };
  assert.deepEqual(loadManagerScope(fx.db, accessContext).activities.map(row => row.id), ['ACT-171-NEW']);
  assert.deepEqual(loadManagerScope(fx.db, accessContext).rfqs, []);
  assert.deepEqual(loadSalesCoachingScope(fx.db, accessContext).activities.map(row => row.activity_type), ['call']);
  assert.deepEqual(loadSalesCoachingScope(fx.db, accessContext).rfqs, []);

  const user = hydrateUserPermissions(
    fx.db, fx.db.prepare("SELECT * FROM sales_users WHERE id='U-MGR'").get(),
  );
  const customerContext = buildCustomerContext(
    fx.db, buildAccessContext(fx.db, user), 'RU-9002', { station: 'next_action' },
  );
  assert.deepEqual(customerContext.context.activities.map(row => row.id), ['ACT-171-NEW']);
  const metrics = buildManagerMetrics(fx.db, {
    user,
    rangeDays: 30,
    now: '2026-08-02T12:00:00.000Z',
  });
  const managerMetrics = metrics.sales.find(row => row.actorId === 'U-OTHER');
  assert.equal(managerMetrics.counts.deferredCustomers, 1);
  assert.equal(managerMetrics.counts.plannedAfterDeferredCustomers, 0);
});
