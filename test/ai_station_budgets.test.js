'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createAIBudgetStore, normalizeUsage } = require('../lib/ai_stations/budgets');
const { createAIJobStore } = require('../lib/ai_stations/jobs');

const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function fixture(dbPath = ':memory:') {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_pool (customer_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS crm_accounts (id TEXT PRIMARY KEY);
  `);
  let sequence = 0;
  const jobs = createAIJobStore(db, { idFactory: () => `AIJ-BUDGET-${++sequence}` });
  function job(key, customerId = `CUST-${sequence + 1}`) {
    db.prepare('INSERT OR IGNORE INTO customer_pool(customer_id) VALUES (?)').run(customerId);
    return jobs.enqueue({
      customerId,
      station: 'customer_fit',
      contextHash: hash,
      createdBy: 'U1',
    }, key);
  }
  return { db, jobs, job };
}

test('usage normalization accepts provider aliases and conservatively marks missing usage', () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 12, completion_tokens: 7 }), {
    inputTokens: 12,
    outputTokens: 7,
    totalTokens: 19,
    source: 'provider',
  });
  assert.deepEqual(normalizeUsage({}, {
    reserveInputTokens: 100,
    reserveOutputTokens: 40,
  }), {
    inputTokens: 100,
    outputTokens: 40,
    totalTokens: 140,
    source: 'estimated_missing',
  });
  assert.deepEqual(normalizeUsage({ total_tokens: 25 }), {
    inputTokens: 0,
    outputTokens: 25,
    totalTokens: 25,
    source: 'provider',
  });
});

test('budget reservation settles every fallback attempt and releases unused capacity', () => {
  const fx = fixture();
  const job = fx.job('budget:fallback');
  fx.jobs.claimNext('worker-budget');
  let id = 0;
  const budgets = createAIBudgetStore(fx.db, {
    idFactory: prefix => `${prefix}-${++id}`,
    pricing: {
      version: 'test-pricing-v1',
      default: {
        defaultAttemptCost: 0.05,
        inputPerMillion: 1,
        outputPerMillion: 4,
        reserveInputTokens: 100,
        reserveOutputTokens: 50,
      },
    },
  });

  const reservation = budgets.reserve({
    jobId: job.id,
    attempt: 1,
    actorId: 'U1',
    teamId: 'TEAM-1',
    station: 'customer_fit',
    maxEngineAttempts: 2,
  });
  assert.equal(reservation.reservedCost, 0.1);

  const settled = budgets.settle(reservation.id, [
    { engine: 'kimi-cli', model: 'kimi', ok: false, code: 'KIMI_TIMEOUT' },
    { engine: 'hermes', model: 'hermes', ok: true, usage: { input: 10, output: 5 }, cost: 0.02 },
  ]);
  assert.equal(settled.chargedCost, 0.07);
  assert.equal(settled.releasedCost, 0.03);
  assert.equal(settled.state, 'settled');

  const ledger = budgets.ledgerForJob(job.id);
  assert.equal(ledger.length, 2);
  assert.deepEqual(ledger.map(row => row.status), ['failed', 'succeeded']);
  assert.deepEqual(ledger.map(row => row.cost_source), ['estimated_missing', 'provider']);
  assert.equal(ledger[0].usage_source, 'estimated_missing');
  assert.equal(ledger[1].input_tokens, 10);
  assert.equal(ledger[1].output_tokens, 5);
  assert.equal(ledger[1].fallback_from, 'kimi-cli');
  assert.equal(ledger[1].pricing_version, 'test-pricing-v1');
  fx.db.close();
});

test('80 percent creates one warning and 100 percent blocks new nonessential reservations', () => {
  const fx = fixture();
  const first = fx.job('budget:warning:first');
  const blocked = fx.job('budget:warning:blocked');
  const essential = fx.job('budget:warning:essential');
  const budgets = createAIBudgetStore(fx.db);
  budgets.setPolicy({ scopeType: 'company', scopeId: 'default', dailyLimit: 0.1 });

  const reservation = budgets.reserve({
    jobId: first.id,
    attempt: 1,
    actorId: 'U1',
    station: 'customer_fit',
    estimatedCost: 0.081,
  });
  assert.equal(reservation.state, 'reserved');
  assert.deepEqual(budgets.listAlerts().map(row => row.threshold_ratio), [0.8]);

  assert.throws(() => budgets.reserve({
    jobId: blocked.id,
    attempt: 1,
    actorId: 'U2',
    station: 'customer_fit',
    estimatedCost: 0.019,
  }), error => error.code === 'AI_BUDGET_EXHAUSTED' && error.statusCode === 429);
  assert.deepEqual(budgets.listAlerts().map(row => row.threshold_ratio).sort(), [0.8, 1]);

  const allowed = budgets.reserve({
    jobId: essential.id,
    attempt: 1,
    actorId: 'U3',
    station: 'customer_fit',
    estimatedCost: 0.019,
    essential: true,
  });
  assert.equal(allowed.essential, 1);
  fx.db.close();
});

for (const scope of [
  { scopeType: 'company', scopeId: 'ACME', input: { companyId: 'ACME' } },
  { scopeType: 'team', scopeId: 'TEAM-RED', input: { teamId: 'TEAM-RED' } },
  { scopeType: 'user', scopeId: 'U-LIMITED', input: { actorId: 'U-LIMITED' } },
  { scopeType: 'station', scopeId: 'customer_fit', input: { station: 'customer_fit' } },
]) {
  test(`${scope.scopeType} daily/monthly/per-task policy participates in pre-call enforcement`, () => {
    const fx = fixture();
    const job = fx.job(`budget:scope:${scope.scopeType}`);
    const budgets = createAIBudgetStore(fx.db);
    budgets.setPolicy({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      dailyLimit: 1,
      monthlyLimit: 1,
      perTaskLimit: 0.05,
    });
    assert.throws(() => budgets.reserve({
      jobId: job.id,
      attempt: 1,
      companyId: 'OTHER',
      teamId: 'TEAM-OTHER',
      actorId: 'U-OTHER',
      station: 'other_station',
      ...scope.input,
      estimatedCost: 0.05,
    }), error => error.code === 'AI_BUDGET_EXHAUSTED' && error.budget.periodKind === 'task');
    fx.db.close();
  });
}

test('two database connections cannot overbook the same persistent company budget', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-ai-budget-race-'));
  const dbPath = path.join(dir, 'crm.db');
  try {
    const first = fixture(dbPath);
    const jobOne = first.job('budget:race:one', 'CUST-1');
    const jobTwo = first.job('budget:race:two', 'CUST-2');
    const secondDb = new Database(dbPath);
    secondDb.pragma('foreign_keys = ON');
    secondDb.pragma('busy_timeout = 5000');
    const firstBudgets = createAIBudgetStore(first.db);
    const secondBudgets = createAIBudgetStore(secondDb);
    firstBudgets.setPolicy({ scopeType: 'company', scopeId: 'default', dailyLimit: 0.1 });

    const reserved = firstBudgets.reserve({
      jobId: jobOne.id,
      attempt: 1,
      actorId: 'U1',
      station: 'customer_fit',
      estimatedCost: 0.06,
    });
    assert.equal(reserved.state, 'reserved');
    assert.throws(() => secondBudgets.reserve({
      jobId: jobTwo.id,
      attempt: 1,
      actorId: 'U2',
      station: 'customer_fit',
      estimatedCost: 0.06,
    }), error => error.code === 'AI_BUDGET_EXHAUSTED');
    assert.equal(first.db.prepare(`SELECT COUNT(*) count FROM crm_ai_budget_reservations
      WHERE state='reserved'`).get().count, 1);
    secondDb.close();
    first.db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('orphaned reservations are released after the job lease is recovered', () => {
  const fx = fixture();
  const job = fx.job('budget:orphan');
  fx.jobs.claimNext('worker-orphan');
  const budgets = createAIBudgetStore(fx.db);
  const reservation = budgets.reserve({
    jobId: job.id,
    attempt: 1,
    actorId: 'U1',
    station: 'customer_fit',
    estimatedCost: 0.04,
  });
  fx.db.prepare(`UPDATE crm_ai_jobs SET state='retry_wait',lease_owner='',lease_expires_at=''
    WHERE id=?`).run(job.id);

  assert.equal(budgets.releaseOrphanedReservations(), 1);
  const released = budgets.getReservation(reservation.id);
  assert.equal(released.state, 'released');
  assert.equal(released.released_micros, released.reserved_micros);
  assert.match(released.release_reason, /no longer running/);
  fx.db.close();
});

test('429 and timeout attempts use conservative missing-usage charges', () => {
  const fx = fixture();
  const budgets = createAIBudgetStore(fx.db);
  for (const [index, code] of ['DEEPSEEK_HTTP_ERROR', 'DEEPSEEK_TIMEOUT'].entries()) {
    const job = fx.job(`budget:failure:${code}`, `CUST-FAIL-${index}`);
    const reservation = budgets.reserve({
      jobId: job.id,
      attempt: 1,
      actorId: 'U1',
      station: 'customer_fit',
      estimatedCost: 0.05,
    });
    budgets.settle(reservation.id, [{ engine: 'deepseek', ok: false, code }]);
  }
  const rows = fx.db.prepare(`SELECT error_code,usage_source,cost_source,charged_cost_micros
    FROM crm_ai_usage_ledger ORDER BY error_code`).all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.usage_source === 'estimated_missing'));
  assert.ok(rows.every(row => row.cost_source === 'estimated_missing'));
  assert.ok(rows.every(row => row.charged_cost_micros === 50_000));
  fx.db.close();
});

test('cache hits and deduplicated requests share the ledger without a charge', () => {
  const fx = fixture();
  const job = fx.job('budget:nonbillable');
  const budgets = createAIBudgetStore(fx.db);
  for (const status of ['cache_hit', 'deduplicated']) {
    budgets.recordNonBillable({
      jobId: job.id,
      eventKey: `budget:nonbillable:${status}`,
      actorId: 'U1',
      station: 'customer_fit',
      status,
    });
  }
  const ledger = budgets.ledgerForJob(job.id);
  assert.deepEqual(ledger.map(row => row.status).sort(), ['cache_hit', 'deduplicated']);
  assert.ok(ledger.every(row => row.charged_cost_micros === 0 && row.cost_source === 'not_billable'));
  fx.db.close();
});
