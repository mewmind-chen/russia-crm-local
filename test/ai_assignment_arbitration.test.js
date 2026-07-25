'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  arbitrateIntakeOwner,
  authorizedSalesUsers,
  loadSalesMatchRecommendation,
} = require('../lib/ai_stations/assignment_arbitration');
const { createCandidateSnapshot } = require('../lib/ai_stations/candidate_snapshots');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const permissionFixtures = require('./helpers/permission_fixture');

function match(userId = 'S-RU') {
  return { userId, score: 95, reason: '国家、语言、渠道与负荷规则匹配' };
}

function recommendation(userId = 'S-RU', overrides = {}) {
  return {
    available: true,
    confidence: 0.9,
    reviewRequired: false,
    rankedCandidates: [{ userId, score: 96, reasons: ['fit'] }],
    ...overrides,
  };
}

test('AI agreement can confirm but cannot replace the deterministic assignment', () => {
  const decision = arbitrateIntakeOwner({
    candidate: { match_score: 80 },
    users: [{ id: 'S-RU' }, { id: 'S-BR' }],
    deterministicMatch: match(),
    recommendation: recommendation(),
  });

  assert.equal(decision.assignable, true);
  assert.equal(decision.userId, 'S-RU');
  assert.equal(decision.source, 'ai_confirmed');
  assert.equal(decision.reasonCode, 'ai_rule_agreement');
});

test('AI absence falls back while conflicts and ineligible candidates require review', () => {
  const fallback = arbitrateIntakeOwner({
    candidate: { match_score: 80 },
    users: [{ id: 'S-RU' }],
    deterministicMatch: match(),
    recommendation: { available: false, reasonCode: 'ai_snapshot_invalid', rankedCandidates: [] },
  });
  assert.equal(fallback.assignable, true);
  assert.equal(fallback.userId, 'S-RU');
  assert.equal(fallback.source, 'deterministic_fallback');

  const conflict = arbitrateIntakeOwner({
    candidate: { match_score: 80 },
    users: [{ id: 'S-RU' }, { id: 'S-BR' }],
    deterministicMatch: match(),
    recommendation: recommendation('S-BR'),
  });
  assert.equal(conflict.managerReview, true);
  assert.equal(conflict.reasonCode, 'ranking_rule_conflict');

  const ineligible = arbitrateIntakeOwner({
    candidate: { match_score: 80 },
    users: [{ id: 'S-RU' }],
    deterministicMatch: match(),
    recommendation: recommendation('S-OFF'),
  });
  assert.equal(ineligible.managerReview, true);
  assert.equal(ineligible.reasonCode, 'ai_candidate_ineligible');
});

test('low confidence, high value, risk, cross-team, duplicate and empty quota stay rule-owned', () => {
  const base = {
    candidate: { match_score: 80 },
    users: [{ id: 'S-RU' }],
    deterministicMatch: match(),
    recommendation: recommendation(),
  };
  assert.equal(arbitrateIntakeOwner({
    ...base,
    recommendation: recommendation('S-RU', { confidence: 0.5 }),
  }).reasonCode, 'low_confidence_review');
  assert.equal(arbitrateIntakeOwner({
    ...base,
    candidate: { match_score: 95 },
  }).reasonCode, 'high_value_review');
  assert.equal(arbitrateIntakeOwner({
    ...base,
    candidate: { risk_level: 'blocked' },
  }).reasonCode, 'risk_blocked');
  assert.equal(arbitrateIntakeOwner({ ...base, crossTeam: true }).reasonCode, 'cross_team_review');
  assert.equal(arbitrateIntakeOwner({ ...base, duplicate: true }).reasonCode, 'duplicate_customer');
  assert.equal(arbitrateIntakeOwner({ ...base, deterministicMatch: null }).reasonCode, 'no_eligible_sales');
});

function databaseFixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, permissions_json TEXT NOT NULL DEFAULT '{}',
      languages_json TEXT NOT NULL DEFAULT '[]', countries_json TEXT NOT NULL DEFAULT '[]',
      channels_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE customer_pool (customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '');
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY, external_customer_id TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'qualified', owner_id TEXT NOT NULL DEFAULT '',
      assignment_status TEXT NOT NULL DEFAULT 'claimed'
    );
    CREATE TABLE crm_intake_settings (id TEXT PRIMARY KEY, daily_per_sales INTEGER NOT NULL DEFAULT 5);
    CREATE TABLE crm_intake_items (
      id TEXT PRIMARY KEY, assigned_owner_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', assigned_at TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare("INSERT INTO customer_pool(customer_id,company_name) VALUES ('C-1','Fixture')").run();
  db.prepare("INSERT INTO crm_intake_settings(id,daily_per_sales) VALUES ('default',5)").run();
  const insert = db.prepare(`INSERT INTO sales_users
    (id,email,name,role,active,permissions_json,languages_json,countries_json,channels_json)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  insert.run('S-RU', 'ru@example.test', 'Russia', 'sales', 1, '{"view_intake":true}',
    '["俄语"]', '["俄罗斯"]', '["Telegram"]');
  insert.run('S-BR', 'br@example.test', 'Brazil', 'sales', 1, '{"view_intake":true}',
    '["葡萄牙语"]', '["巴西"]', '["WhatsApp"]');
  insert.run('S-DENY', 'deny@example.test', 'Denied', 'sales', 1, '{"view_intake":false}',
    '[]', '[]', '[]');
  return db;
}

test('database recommendation resolves only server snapshot tokens and rechecks sales state', t => {
  const db = databaseFixture();
  t.after(() => db.close());
  assert.deepEqual(authorizedSalesUsers(db).map(user => user.id), ['S-BR', 'S-RU']);

  const jobs = createAIJobStore(db, { idFactory: () => 'AIJ-MATCH' });
  const job = jobs.enqueue({
    customerId: 'C-1',
    station: 'sales_match',
    contextHash: 'a'.repeat(64),
    createdBy: 'U-MGR',
  }, 'sales-match:C-1');
  const snapshot = createCandidateSnapshot(db, {
    jobId: job.id,
    customerId: 'C-1',
    contextHash: job.contextHash,
    context: { country: '俄罗斯' },
    idFactory: () => 'SNAP-MATCH',
    now: '2026-07-24T10:00:00.000Z',
  });
  db.prepare(`INSERT INTO crm_ai_station_results
    (id,job_id,customer_id,station,context_hash,value_json,confidence,review_required,
     engine,model,prompt_version,schema_version,idempotency_key,generated_at,created_at)
    VALUES (?,?,?,?,?,?,?,0,'fixture','fixture','v1','v1',?,?,?)`).run(
    'AIR-MATCH',
    job.id,
    'C-1',
    'sales_match',
    job.contextHash,
    JSON.stringify({
      version: 'v1',
      confidence: 0.9,
      evidenceIds: [],
      reasonCodes: ['COUNTRY_MATCH'],
      rankedCandidates: [
        { employeeId: 2, score: 95, reasons: ['AI prefers Brazil'] },
        { employeeId: 1, score: 90, reasons: ['AI ranks Russia second'] },
      ],
    }),
    0.9,
    'result:C-1',
    '2026-07-24T10:00:01.000Z',
    '2026-07-24T10:00:01.000Z',
  );

  const loaded = loadSalesMatchRecommendation(db, 'C-1', {
    now: '2026-07-24T10:00:02.000Z',
  });
  assert.equal(loaded.available, true);
  assert.equal(loaded.snapshotId, snapshot.snapshotId);
  assert.deepEqual(loaded.rankedCandidates.map(candidate => candidate.userId), ['S-BR', 'S-RU']);

  db.prepare("UPDATE sales_users SET active=0 WHERE id='S-BR'").run();
  const stale = loadSalesMatchRecommendation(db, 'C-1', {
    now: '2026-07-24T10:00:03.000Z',
  });
  assert.equal(stale.available, false);
  assert.equal(stale.reasonCode, 'ai_snapshot_invalid');
});

function insertScreenedCustomer(db, customerId, score, riskLevel = 'low') {
  db.prepare(`INSERT INTO customer_pool
    (customer_id,company_name,country,products) VALUES (?,?,?,?)`)
    .run(customerId, `Arbitration ${customerId}`, '俄罗斯', 'MCU');
  db.prepare(`INSERT INTO company_screening
    (customer_id,match_score,match_group,risk_level,checked_at,created_at,updated_at)
    VALUES (?,?,'A',?,'2026-07-24 10:00:00','2026-07-24 10:00:00','2026-07-24 10:00:00')`)
    .run(customerId, score, riskLevel);
}

test('automatic intake assigns fallback candidates but leaves value, risk and AI conflicts pending', async t => {
  const fx = await permissionFixtures.seededFixture({ managerViewAll: true });
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_intake_settings
    SET enabled=1,approval_mode='automatic',daily_per_sales=10,countries_json='[]',match_groups_json='["A"]'
    WHERE id='default'`).run();
  insertScreenedCustomer(fx.db, 'RU-9101', 80);
  insertScreenedCustomer(fx.db, 'RU-9102', 82);
  insertScreenedCustomer(fx.db, 'RU-9103', 85, 'blocked');
  insertScreenedCustomer(fx.db, 'RU-9104', 95);

  const jobs = createAIJobStore(fx.db, { idFactory: () => 'AIJ-ARB-CONFLICT' });
  const job = jobs.enqueue({
    customerId: 'RU-9102',
    station: 'sales_match',
    contextHash: 'b'.repeat(64),
    createdBy: 'U-MGR',
  }, 'sales-match:RU-9102');
  const snapshot = createCandidateSnapshot(fx.db, {
    jobId: job.id,
    customerId: 'RU-9102',
    contextHash: job.contextHash,
    context: { country: '俄罗斯' },
    idFactory: () => 'SNAP-ARB-CONFLICT',
  });
  assert.ok(snapshot.candidateEmployeeIds.length >= 2);
  const rankedTokens = [
    snapshot.candidateEmployeeIds[1],
    snapshot.candidateEmployeeIds[0],
    ...snapshot.candidateEmployeeIds.slice(2),
  ];
  fx.db.prepare(`INSERT INTO crm_ai_station_results
    (id,job_id,customer_id,station,context_hash,value_json,confidence,review_required,
     engine,model,prompt_version,schema_version,idempotency_key,generated_at,created_at)
    VALUES (?,?,?,?,?,?,0.9,0,'fixture','fixture','v1','v1',?,
      '2026-07-24T10:00:01.000Z','2026-07-24T10:00:01.000Z')`).run(
    'AIR-ARB-CONFLICT',
    job.id,
    'RU-9102',
    'sales_match',
    job.contextHash,
    JSON.stringify({
      version: 'v1',
      confidence: 0.9,
      evidenceIds: [],
      reasonCodes: ['COUNTRY_MATCH'],
      rankedCandidates: rankedTokens.map((employeeId, index) => ({
        employeeId,
        score: 100 - index,
        reasons: ['fixture ranking'],
      })),
    }),
    'result:RU-9102',
  );

  const response = await fx.request('/api/sales-crm/intake/scan', {
    cookie: fx.cookie,
    method: 'POST',
    body: { force: true },
  });
  assert.equal(response.status, 200);

  const rows = fx.db.prepare(`SELECT external_customer_id,status,assigned_owner_id,decision_reason
    FROM crm_intake_items WHERE external_customer_id IN ('RU-9101','RU-9102','RU-9103','RU-9104')
    ORDER BY external_customer_id`).all();
  const byCustomer = new Map(rows.map(row => [row.external_customer_id, row]));
  assert.equal(byCustomer.get('RU-9101').status, 'assigned');
  assert.notEqual(byCustomer.get('RU-9101').assigned_owner_id, '');
  assert.equal(byCustomer.get('RU-9104').status, 'pending');
  assert.match(byCustomer.get('RU-9104').decision_reason, /高价值/);
  assert.equal(byCustomer.get('RU-9103').status, 'pending');
  assert.match(byCustomer.get('RU-9103').decision_reason, /风险规则/);
  assert.equal(byCustomer.get('RU-9102').status, 'pending');
  assert.match(byCustomer.get('RU-9102').decision_reason, /冲突/);
  assert.equal(byCustomer.get('RU-9102').assigned_owner_id, '');
});
