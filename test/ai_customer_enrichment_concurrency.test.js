'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fixtures = require('./helpers/permission_fixture');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');
const { createAIJobStore } = require('../lib/ai_stations/jobs');

const resources = Object.freeze({
  global: { maxConcurrency: 4, rateLimit: 0, rateWindowMs: 60_000 },
  'fixture-engine': { maxConcurrency: 2, rateLimit: 0, rateWindowMs: 60_000 },
});

function runChild(code, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', exitCode => {
      if (exitCode === 0) resolve();
      else reject(new Error(stderr || `enrichment worker exited ${exitCode}`));
    });
  });
}

async function competitionFixture() {
  const fx = await fixtures.seededFixture({
    managerViewAll: true,
    permissions: {
      view_customers: true,
      use_ai_assistant: true,
      run_recon: true,
      view_recon: true,
      view_contacts: true,
    },
  });
  fx.db.pragma('journal_mode = WAL');
  fx.db.exec(`
    CREATE TABLE enrichment_competition_events (
      job_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE enrichment_competition_metrics (
      id TEXT PRIMARY KEY,
      max_active INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO enrichment_competition_metrics(id,max_active)
    VALUES ('global',0),('fixture-engine',0);
  `);
  const insertPool = fx.db.prepare(`INSERT INTO customer_pool
    (customer_id,company_name,current_pool) VALUES (?,?,'')`);
  const insertAccount = fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,created_at,updated_at)
    VALUES (?,?,?,'U-MGR','qualified','claimed',?,?)`);
  const runs = createCustomerEnrichmentStore(fx.db);
  const names = [
    'Aquila', 'Borealis', 'Cygnus', 'Draco', 'Equinox', 'Fornax', 'Gemini', 'Helios',
    'Indus', 'Jovian', 'Kepler', 'Lyra', 'Meridian', 'Nereid', 'Orion', 'Phoenix',
    'Quasar', 'Rigel', 'Sirius', 'Triton',
  ];
  for (let index = 1; index <= 20; index += 1) {
    const suffix = String(index).padStart(4, '0');
    const customerId = `CN-${suffix}`;
    const accountId = `ACC-CN-${suffix}`;
    insertPool.run(customerId, names[index - 1]);
    insertAccount.run(accountId, customerId, names[index - 1],
      '2026-07-24 06:00:00', '2026-07-24 06:00:00');
    runs.createTrigger({
      customerId,
      crmAccountId: accountId,
      triggerSource: 'manual_create',
      triggeredBy: 'U-MGR',
      inputFingerprint: index.toString(16).padStart(64, '0'),
      pipelineVersion: 'concurrency-v1',
    });
  }
  return fx;
}

test('six Worker processes complete 20 cross-customer enrichment runs without duplicates or slot overflow', async t => {
  const fx = await competitionFixture();
  t.after(() => fx.close());
  const root = path.join(__dirname, '..');
  const childCode = String.raw`
    const Database = require('better-sqlite3');
    const { createAIStationWorker } = require('./lib/ai_stations/worker');
    const { executeCustomerFitJob } = require('./lib/ai_stations/executor');
    const { createEnrichmentExecutors } = require('./lib/ai_stations/enrichment/executors');
    const { dispatchPendingEnrichment } = require('./lib/ai_stations/enrichment/workflow');
    const { consumePendingEnrichmentEvent } = require('./lib/ai_stations/enrichment/events');
    const { submitReconResult, submitContactReconResult } = require('./lib/db');
    const resources = JSON.parse(process.env.AI_RESOURCES);
    const openDb = () => {
      const db = new Database(process.env.AI_DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 10000');
      db.pragma('foreign_keys = ON');
      return db;
    };
    const base = createEnrichmentExecutors();
    const metric = async (input, execute) => {
      const active = input.db.prepare("SELECT COUNT(*) count FROM crm_ai_resource_slots WHERE resource='global' AND lease_expires_at>?")
        .get(new Date().toISOString()).count;
      input.db.prepare("UPDATE enrichment_competition_metrics SET max_active=MAX(max_active,?) WHERE id='global'").run(active);
      input.db.prepare("INSERT OR IGNORE INTO enrichment_competition_events(job_id,customer_id,worker_id,started_at) VALUES (?,?,?,?)")
        .run(input.jobId, input.jobs.getJob(input.jobId).customerId, input.workerId, Date.now());
      await new Promise(resolve => setTimeout(resolve, 8));
      const result = await execute();
      input.db.prepare("UPDATE enrichment_competition_events SET finished_at=? WHERE job_id=?").run(Date.now(), input.jobId);
      return result;
    };
    const identityResolver = input => Promise.resolve({
      officialWebsite: 'https://' + input.customerId.toLowerCase() + '.example',
      country: 'RU',
      confidence: 0.95,
      risk: { blocked: false },
      sources: [{
        url: 'https://' + input.customerId.toLowerCase() + '.example/about',
        collectedAt: '2026-07-24T06:10:00.000Z',
        summary: 'official identity',
        content: 'official identity',
        confidence: 0.95,
      }],
    });
    const recon = async input => {
      const dispatched = await base.recon_dispatch(input);
      const website = 'https://' + input.jobs.getJob(input.jobId).customerId.toLowerCase() + '.example';
      submitReconResult({
        job_id: dispatched.legacyJobId,
        result: {
          company_name: input.jobs.getJob(input.jobId).customerId,
          website,
          industry: '工业电子',
          customer_type: '终端制造商',
          description: 'Concurrency fixture profile',
          recommended_products: 'MCU, power modules',
          opportunity_summary: 'Recurring component demand',
          compliance_status: 'clear',
        },
        evidence: [{
          field_name: 'recommended_products',
          value: 'MCU, power modules',
          source_url: website + '/products',
          checked_at: '2026-07-24T06:11:00.000Z',
          confidence: 'high',
        }],
      }, { db: input.db });
      return dispatched;
    };
    const contact = async input => {
      const dispatched = await base.contact_dispatch(input);
      const customerId = input.jobs.getJob(input.jobId).customerId;
      const website = 'https://' + customerId.toLowerCase() + '.example';
      submitContactReconResult({
        job_id: dispatched.legacyJobId,
        result: {
          schema_version: 'contact-recon-v1',
          job_id: dispatched.legacyJobId,
          customer_id: customerId,
          people: [{
            person_id: 'P1',
            full_name: 'Иванов Иван Иванович',
            role_category: 'procurement',
            decision_role: 'decision_maker',
            employment: { status: 'verified_current', confidence: 95 },
            methods: [{
              type: 'email',
              value: 'buyer@' + customerId.toLowerCase() + '.example',
              discovery_type: 'document_extracted',
              verification_status: 'verified',
              confidence: 0.95,
              is_direct: true,
              source_url: website + '/tender.pdf',
            }],
          }],
          evidence: [{
            evidence_id: 'E1',
            person_id: 'P1',
            source_url: website + '/tender.pdf',
            field_name: 'role',
            value: 'Procurement Director',
            checked_at: '2026-07-24T06:12:00.000Z',
            supports_current_employment: true,
            supports_decision_role: true,
          }],
        },
      }, { db: input.db });
      return dispatched;
    };
    const customerFit = async input => {
      let claim;
      for (let attempt = 0; attempt < 200 && !claim?.acquired; attempt += 1) {
        claim = input.jobs.acquireResource('fixture-engine', input.jobId, input.workerId);
        if (!claim.acquired) await new Promise(resolve => setTimeout(resolve, 3));
      }
      if (!claim?.acquired) throw new Error('fixture engine slot was never available');
      try {
        const active = input.db.prepare("SELECT COUNT(*) count FROM crm_ai_resource_slots WHERE resource='fixture-engine' AND lease_expires_at>?")
          .get(new Date().toISOString()).count;
        input.db.prepare("UPDATE enrichment_competition_metrics SET max_active=MAX(max_active,?) WHERE id='fixture-engine'").run(active);
        await new Promise(resolve => setTimeout(resolve, 15));
        return await executeCustomerFitJob({
          ...input,
          modelCall: messages => {
            const prompt = JSON.parse(messages[1].content);
            return Promise.resolve({
              answer: JSON.stringify({
                version: 'v1',
                confidence: 0.9,
                evidenceIds: prompt.evidence.slice(0, 3).map(item => item.id),
                reasonCodes: ['PRODUCT_MATCH'],
                fitScore: 86,
                grade: 'A',
                reviewRequired: false,
              }),
              engine: 'fixture-engine',
              model: 'fixture-model',
              usage: { input_tokens: 100, output_tokens: 30 },
              cost: 0.001,
            });
          },
        });
      } finally {
        if (claim.releaseRequired) input.jobs.releaseResource('fixture-engine', input.jobId, input.workerId);
      }
    };
    const wrapped = {};
    for (const [station, executor] of Object.entries(base)) {
      const selected = station === 'recon_dispatch' ? recon
        : station === 'contact_dispatch' ? contact
        : station === 'customer_fit' ? customerFit
        : executor;
      wrapped[station] = input => metric(input, () => selected(input));
    }
    wrapped.customer_fit = input => metric(input, () => customerFit(input));
    const worker = createAIStationWorker({
      workerId: process.env.AI_WORKER_ID,
      openDb,
      jobStoreOptions: { executionResources: resources },
      beforeClaim: async ({ db, workerId }) => {
        await dispatchPendingEnrichment(db, undefined, {
          dispatcherId: workerId + ':dispatch',
          jobStoreOptions: { executionResources: resources },
        });
        return consumePendingEnrichmentEvent(db, workerId + ':events', {
          jobStoreOptions: { executionResources: resources },
        });
      },
      executors: wrapped,
      executorOptions: { identityResolver },
    });
    (async () => {
      for (let attempt = 0; attempt < 2500; attempt += 1) {
        const check = openDb();
        const remaining = check.prepare("SELECT COUNT(*) count FROM crm_ai_enrichment_runs WHERE customer_id LIKE 'CN-%' AND state NOT IN ('succeeded','needs_review','cancelled','skipped')").get().count;
        check.close();
        if (remaining === 0) return;
        const outcome = await worker.runOnce();
        if (outcome.status === 'failed') throw outcome.error || new Error('worker failed');
        if (outcome.status === 'idle') await new Promise(resolve => setTimeout(resolve, 3));
      }
      throw new Error('worker loop exhausted before enrichment drained');
    })().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
  `;

  await Promise.all(Array.from({ length: 6 }, (_, index) => runChild(childCode, {
    AI_DB_PATH: fx.dbPath,
    AI_RESOURCES: JSON.stringify(resources),
    AI_WORKER_ID: `enrichment-process-${index + 1}`,
  }, root)));

  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_enrichment_runs
    WHERE customer_id LIKE 'CN-%' AND state IN ('succeeded','needs_review')`).get().count, 20);
  assert.equal(fx.db.prepare(`SELECT COUNT(DISTINCT workflow_id) count FROM crm_ai_enrichment_runs
    WHERE customer_id LIKE 'CN-%'`).get().count, 20);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_enrichment_node_links
    WHERE run_id IN (SELECT id FROM crm_ai_enrichment_runs WHERE customer_id LIKE 'CN-%')
      AND legacy_task_id!=''`).get().count, 40);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_enrichment_events
    WHERE run_id IN (SELECT id FROM crm_ai_enrichment_runs WHERE customer_id LIKE 'CN-%')`).get().count, 40);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_station_results
    WHERE customer_id LIKE 'CN-%' AND station='customer_fit'`).get().count, 20);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM (
    SELECT run_id,field_name,proposed_value_hash,COUNT(*) copies
    FROM crm_ai_field_proposals
    WHERE run_id IN (SELECT id FROM crm_ai_enrichment_runs WHERE customer_id LIKE 'CN-%')
    GROUP BY run_id,field_name,proposed_value_hash HAVING copies>1
  )`).get().count, 0);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM (
    SELECT job_id,COUNT(*) copies FROM crm_ai_station_results
    WHERE customer_id LIKE 'CN-%' GROUP BY job_id HAVING copies>1
  )`).get().count, 0);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM enrichment_competition_events
    WHERE finished_at=0`).get().count, 0);
  assert.ok(fx.db.prepare(`SELECT max_active FROM enrichment_competition_metrics
    WHERE id='global'`).get().max_active <= 4);
  assert.ok(fx.db.prepare(`SELECT max_active FROM enrichment_competition_metrics
    WHERE id='fixture-engine'`).get().max_active <= 2);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_resource_slots').get().count, 0);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_customer_locks').get().count, 0);
});

test('same-customer enrichment jobs remain serialized across database connections', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_customers: true, use_ai_assistant: true },
  });
  t.after(() => fx.close());
  const firstDb = new (require('better-sqlite3'))(fx.dbPath);
  const secondDb = new (require('better-sqlite3'))(fx.dbPath);
  t.after(() => { firstDb.close(); secondDb.close(); });
  const options = { executionResources: resources };
  const first = createAIJobStore(firstDb, options);
  const second = createAIJobStore(secondDb, options);
  const enqueue = (store, id, key) => store.enqueue({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    station: 'enrichment_finalize',
    executionResource: 'deterministic',
    contextHash: 'a'.repeat(64),
    createdBy: 'U-MGR',
  }, key);
  const one = enqueue(first, 'one', 'enrichment:serialize:one');
  const two = enqueue(second, 'two', 'enrichment:serialize:two');
  assert.equal(first.claimById(one.id, 'worker-one').id, one.id);
  assert.equal(second.claimById(two.id, 'worker-two'), null);
  const at = new Date().toISOString();
  firstDb.prepare(`UPDATE crm_ai_jobs SET state='succeeded',lease_owner='',lease_expires_at='',
    finished_at=?,updated_at=? WHERE id=?`).run(at, at, one.id);
  assert.equal(second.claimById(two.id, 'worker-two').id, two.id);
});
