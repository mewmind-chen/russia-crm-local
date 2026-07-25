'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');
const {
  dispatchLegacyRecon,
  dispatchLegacyContactRecon,
} = require('../lib/ai_stations/enrichment/adapters');

function setupRun(db) {
  let sequence = 0;
  const runs = createCustomerEnrichmentStore(db, {
    idFactory: prefix => `${prefix}-${++sequence}`,
  });
  const run = runs.createTrigger({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    triggerSource: 'manual_create',
    triggeredBy: 'U-MGR',
    inputFingerprint: 'd'.repeat(64),
    pipelineVersion: 'v1',
  });
  return { runs, run };
}

function enqueueClaimed(db, station, id) {
  const jobs = createAIJobStore(db, { idFactory: () => id });
  const job = jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    station,
    contextHash: 'd'.repeat(64),
    createdBy: 'U-MGR',
    payload: { enrichmentRunId: 'AER-1' },
  }, `test:${station}:${id}`);
  return { jobs, job: jobs.claimById(job.id, 'worker-a') };
}

function budgetSpy() {
  const calls = [];
  return {
    calls,
    reserve(input) {
      calls.push(['reserve', input]);
      return { id: 'RES-1' };
    },
    settle(id, attempts) {
      calls.push(['settle', { id, attempts }]);
      return {
        id,
        attempts: [{ usage_source: 'estimated_missing', cost_source: 'estimated_missing' }],
      };
    },
    release(id, reason) {
      calls.push(['release', { id, reason }]);
      return { id };
    },
    recordNonBillable(input) {
      calls.push(['deduplicated', input]);
      return input;
    },
  };
}

test('Recon adapter creates once, links the legacy job, and reuses the active queue', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const { run } = setupRun(fx.db);
  const { jobs, job } = enqueueClaimed(fx.db, 'recon_dispatch', 'AIJ-RECON-1');
  const budgets = budgetSpy();

  const first = dispatchLegacyRecon({
    db: fx.db, jobs, budgets, job, workerId: 'worker-a',
    actor: { id: 'U-MGR', teamId: '' },
  });

  assert.equal(first.created, true);
  assert.equal(first.job.state, 'succeeded');
  assert.equal(budgets.calls[0][0], 'reserve');
  assert.equal(budgets.calls[1][0], 'settle');
  assert.equal(budgets.calls[1][1].attempts[0].usage, undefined);
  assert.deepEqual(fx.db.prepare(`SELECT run_id,node_key,ai_job_id,legacy_task_type,legacy_task_id
    FROM crm_ai_enrichment_node_links WHERE ai_job_id='AIJ-RECON-1'`).get(), {
    run_id: run.id,
    node_key: 'recon_dispatch',
    ai_job_id: 'AIJ-RECON-1',
    legacy_task_type: 'recon',
    legacy_task_id: first.legacyJobId,
  });

  const active = fx.db.prepare("SELECT job_id FROM recon_jobs WHERE customer_id='RU-9002' AND status='queued'").all();
  assert.equal(active.length, 1);
});

test('Contact adapter creates or reuses one active legacy task with conservative attribution', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  setupRun(fx.db);
  const { jobs, job } = enqueueClaimed(fx.db, 'contact_dispatch', 'AIJ-CONTACT-1');
  const budgets = budgetSpy();

  const first = dispatchLegacyContactRecon({
    db: fx.db, jobs, budgets, job, workerId: 'worker-a',
    actor: { id: 'U-MGR', teamId: '' },
  });

  assert.equal(first.created, true);
  assert.equal(first.job.state, 'succeeded');
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM contact_recon_jobs
    WHERE customer_id='RU-9002' AND status='queued'`).get().count, 1);
  assert.equal(budgets.calls.some(call => call[0] === 'settle'
    && call[1].attempts[0].engine === 'legacy-contact-recon'), true);
});

test('budget denial happens before an external legacy task is created', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  setupRun(fx.db);
  const { jobs, job } = enqueueClaimed(fx.db, 'recon_dispatch', 'AIJ-RECON-BLOCK');
  const budgets = {
    reserve() {
      const error = new Error('budget exhausted');
      error.code = 'AI_BUDGET_EXHAUSTED';
      throw error;
    },
  };

  assert.throws(() => dispatchLegacyRecon({
    db: fx.db, jobs, budgets, job, workerId: 'worker-a',
    actor: { id: 'U-MGR', teamId: '' },
  }), /budget exhausted/);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM recon_jobs
    WHERE customer_id='RU-9002' AND requested_by='ai-enrichment'`).get().count, 0);
});
