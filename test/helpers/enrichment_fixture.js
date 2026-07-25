'use strict';

const fixtures = require('./permission_fixture');
const { submitReconResult, submitContactReconResult } = require('../../lib/db');
const { createAIStationWorker } = require('../../lib/ai_stations/worker');
const { createEnrichmentExecutors } = require('../../lib/ai_stations/enrichment/executors');
const { dispatchPendingEnrichment } = require('../../lib/ai_stations/enrichment/workflow');
const { consumePendingEnrichmentEvent } = require('../../lib/ai_stations/enrichment/events');
const {
  scheduleContactReadinessForCompletedFits,
} = require('../../lib/ai_stations/contact_readiness');

const FULL_ENRICHMENT_PERMISSIONS = Object.freeze({
  view_customers: true,
  create_customer: true,
  use_ai_assistant: true,
  run_recon: true,
  view_recon: true,
  view_contacts: true,
  cancel_ai_tasks: true,
  edit_customer: true,
});

function appOptions() {
  return {
    salesCrm: {
      aiStationsEnabled: true,
      customerEnrichmentEnabled: true,
      customerEnrichmentAutoTriggerEnabled: true,
    },
  };
}

function modelCall(messages) {
  const prompt = JSON.parse(messages[1].content);
  const evidenceIds = (prompt.evidence || []).slice(0, 4).map(item => item.id);
  if (prompt.trustedCrmContext?.station === 'contact_readiness') {
    return Promise.resolve({
      answer: JSON.stringify({
        version: 'v1',
        confidence: 0.93,
        evidenceIds,
        reasonCodes: ['VERIFIED_BUYER_CONTACT'],
        readiness: 'ready',
        contactIds: prompt.trustedCrmContext.allowedContactIds.slice(0, 1),
      }),
      engine: 'fixture-engine',
      model: 'fixture-model-v1',
      usage: { input_tokens: 80, output_tokens: 30, total_tokens: 110 },
      cost: 0.001,
      engineAttempts: [{
        engine: 'fixture-engine',
        model: 'fixture-model-v1',
        ok: true,
        usage: { input_tokens: 80, output_tokens: 30, total_tokens: 110 },
        cost: 0.001,
      }],
    });
  }
  return Promise.resolve({
    answer: JSON.stringify({
      version: 'v1',
      confidence: 0.91,
      evidenceIds,
      reasonCodes: ['PRODUCT_MATCH', 'CONTACT_READY'],
      fitScore: 88,
      grade: 'A',
      reviewRequired: false,
    }),
    engine: 'fixture-engine',
    model: 'fixture-model-v1',
    usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 },
    cost: 0.002,
    engineAttempts: [{
      engine: 'fixture-engine',
      model: 'fixture-model-v1',
      ok: true,
      usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 },
      cost: 0.002,
    }],
  });
}

function identityResolver(input) {
  const website = input.website || `https://${String(input.companyName || 'fixture')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example`;
  return Promise.resolve({
    officialWebsite: website,
    country: input.country || 'RU',
    confidence: 0.94,
    risk: { blocked: false },
    sources: [{
      url: `${website.replace(/\/$/, '')}/about`,
      type: 'official_website',
      collectedAt: '2026-07-24T06:00:00.000Z',
      summary: 'Official company identity page',
      content: 'Fixture company identity and registered location',
      confidence: 0.94,
    }],
  });
}

function reconPayload(jobId, companyName, website) {
  return {
    job_id: jobId,
    result: {
      company_name: companyName,
      website,
      country: 'RU',
      industry: '工业电子',
      customer_type: '终端制造商',
      description: 'Industrial electronics manufacturer serving automation projects.',
      recommended_products: 'MCU, 电源模块, 连接器',
      opportunity_summary: 'Demand for MCU and power modules in recurring automation builds.',
      rating: 'A',
      current_pool: 'A',
      compliance_status: 'clear',
      sanctioned: false,
      verified: 'true',
    },
    evidence: [
      {
        field_name: 'website',
        value: website,
        source_url: `${website.replace(/\/$/, '')}/about`,
        source_title: 'Official profile',
        checked_at: '2026-07-24T06:01:00.000Z',
        confidence: 'high',
      },
      {
        field_name: 'recommended_products',
        value: 'MCU, 电源模块, 连接器',
        source_url: `${website.replace(/\/$/, '')}/products`,
        source_title: 'Products',
        checked_at: '2026-07-24T06:01:00.000Z',
        confidence: 'high',
      },
    ],
  };
}

function contactPayload(jobId, customerId, website) {
  return {
    job_id: jobId,
    result: {
      schema_version: 'contact-recon-v1',
      job_id: jobId,
      customer_id: customerId,
      people: [{
        person_id: 'P1',
        full_name: 'Иванов Иван Иванович',
        department: 'Procurement',
        title: 'Procurement Director',
        role_category: 'procurement',
        decision_role: 'decision_maker',
        employment: { status: 'verified_current', confidence: 95 },
        methods: [{
          type: 'email',
          value: 'ivan.ivanov@fixture.example',
          discovery_type: 'document_extracted',
          verification_status: 'verified',
          confidence: 0.95,
          is_direct: true,
          source_url: `${website.replace(/\/$/, '')}/tender.pdf`,
        }],
      }],
      evidence: [{
        evidence_id: 'E1',
        person_id: 'P1',
        evidence_type: 'official_document',
        field_name: 'employment_and_role',
        value: 'Procurement Director',
        source_url: `${website.replace(/\/$/, '')}/tender.pdf`,
        source_title: 'Official tender document',
        checked_at: '2026-07-24T06:02:00.000Z',
        confidence: 'high',
        supports_current_employment: true,
        supports_decision_role: true,
      }],
      company_entry_points: [],
    },
  };
}

async function createEnrichmentFixture() {
  const fx = await fixtures.seededFixture({
    managerViewAll: true,
    permissions: FULL_ENRICHMENT_PERMISSIONS,
    appOptions: appOptions(),
  });
  let sequence = 0;
  const worker = createAIStationWorker({
    workerId: 'enrichment-e2e-worker',
    openDb: () => {
      const Database = require('better-sqlite3');
      const db = new Database(fx.dbPath);
      db.pragma('foreign_keys = ON');
      return db;
    },
    beforeClaim: async ({ db, workerId }) => {
      scheduleContactReadinessForCompletedFits(db);
      await dispatchPendingEnrichment(db, undefined, {
        dispatcherId: `${workerId}:dispatcher`,
        jobIdFactory: () => `AIJ-E2E-${++sequence}`,
      });
      return consumePendingEnrichmentEvent(db, `${workerId}:events`);
    },
    executors: createEnrichmentExecutors(),
    executorOptions: {
      identityResolver,
      modelCall,
    },
  });

  async function advanceUntil(predicate, label) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (predicate()) return;
      const outcome = await worker.runOnce();
      if (outcome.status === 'failed' || outcome.status === 'blocked') {
        throw outcome.error || new Error(`${label} worker ${outcome.status}`);
      }
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  async function startScenario(input) {
    let customerId;
    let crmAccountId;
    let runId;
    if (input.existingCustomerId) {
      customerId = input.existingCustomerId;
      const account = fx.db.prepare(`SELECT id FROM crm_accounts
        WHERE external_customer_id=?`).get(customerId);
      crmAccountId = account.id;
      const response = await fx.request(`/api/sales-crm/ai/customers/${encodeURIComponent(customerId)}/enrichment/run`, {
        cookie: fx.cookie,
        method: 'POST',
      });
      if (response.status !== 202) throw new Error(`enrichment start returned ${response.status}`);
      runId = (await response.json()).run.id;
    } else {
      const response = await fx.request('/api/sales-crm/accounts', {
        cookie: fx.cookie,
        method: 'POST',
        body: {
          companyName: input.companyName || '',
          website: input.website || '',
          country: input.country || '',
          ownerId: 'U-OTHER',
        },
      });
      if (response.status !== 200) throw new Error(`customer creation returned ${response.status}`);
      const body = await response.json();
      customerId = body.externalCustomerId;
      crmAccountId = body.customerId;
      runId = body.enrichment.runId;
    }
    fx.db.prepare(`UPDATE customer_pool SET current_pool='',rating=''
      WHERE customer_id=?`).run(customerId);
    const ownerBefore = fx.db.prepare('SELECT owner_id ownerId FROM crm_accounts WHERE id=?')
      .get(crmAccountId).ownerId;

    await advanceUntil(() => Boolean(fx.db.prepare(`SELECT legacy_task_id taskId
      FROM crm_ai_enrichment_node_links WHERE run_id=? AND node_key='recon_dispatch'
        AND legacy_task_id!=''`).get(runId)), 'Recon dispatch');
    const reconJob = fx.db.prepare(`SELECT l.legacy_task_id taskId,a.company_name companyName,
      a.website website FROM crm_ai_enrichment_node_links l
      JOIN crm_ai_enrichment_runs r ON r.id=l.run_id
      JOIN crm_accounts a ON a.id=r.crm_account_id
      WHERE l.run_id=? AND l.node_key='recon_dispatch'`).get(runId);
    submitReconResult(reconPayload(
      reconJob.taskId,
      reconJob.companyName,
      reconJob.website || `https://${customerId.toLowerCase()}.example`,
    ), { db: fx.db });

    await advanceUntil(() => Boolean(fx.db.prepare(`SELECT legacy_task_id taskId
      FROM crm_ai_enrichment_node_links WHERE run_id=? AND node_key='contact_dispatch'
        AND legacy_task_id!=''`).get(runId)), 'Contact dispatch');
    const contactJob = fx.db.prepare(`SELECT l.legacy_task_id taskId,a.website website
      FROM crm_ai_enrichment_node_links l
      JOIN crm_ai_enrichment_runs r ON r.id=l.run_id
      JOIN crm_accounts a ON a.id=r.crm_account_id
      WHERE l.run_id=? AND l.node_key='contact_dispatch'`).get(runId);
    submitContactReconResult(
      contactPayload(contactJob.taskId, customerId, contactJob.website),
      { db: fx.db },
    );

    await advanceUntil(() => {
      const run = fx.db.prepare('SELECT state FROM crm_ai_enrichment_runs WHERE id=?').get(runId);
      return ['succeeded', 'needs_review'].includes(run?.state);
    }, 'enrichment finalization');

    const result = snapshot({ customerId, crmAccountId, runId, ownerBefore });
    const taskResponse = await fx.request(`/api/sales-crm/ai/tasks?customer=${encodeURIComponent(customerId)}&pageSize=50`, {
      cookie: fx.cookie,
    });
    if (taskResponse.status !== 200) throw new Error(`task center returned ${taskResponse.status}`);
    result.taskCenter = (await taskResponse.json()).items;
    return result;
  }

  function snapshot({ customerId, crmAccountId, runId, ownerBefore }) {
    const run = fx.db.prepare('SELECT * FROM crm_ai_enrichment_runs WHERE id=?').get(runId);
    const account = fx.db.prepare('SELECT * FROM crm_accounts WHERE id=?').get(crmAccountId);
    const profile = fx.db.prepare('SELECT * FROM customer_pool WHERE customer_id=?').get(customerId);
    const fit = fx.db.prepare(`SELECT r.* FROM crm_ai_station_results r
      JOIN crm_ai_jobs j ON j.id=r.job_id
      WHERE j.workflow_id=? AND r.station='customer_fit'`).get(run.workflow_id);
    const readiness = fx.db.prepare(`SELECT r.* FROM crm_ai_station_results r
      JOIN crm_ai_jobs j ON j.id=r.job_id
      WHERE j.workflow_id=? AND r.station='contact_readiness'`).get(run.workflow_id);
    return {
      customerId,
      crmAccountId,
      runId,
      ownerBefore,
      ownerAfter: account.owner_id,
      profile,
      account,
      run: {
        state: run.state,
        routeState: run.route_state,
        completeness: run.completeness,
        tags: JSON.parse(run.tags_json || '[]'),
        missingItems: JSON.parse(run.missing_items_json || '[]'),
      },
      people: fx.db.prepare('SELECT * FROM person_candidates WHERE customer_id=?').all(customerId),
      evidence: fx.db.prepare('SELECT * FROM crm_ai_enrichment_evidence WHERE run_id=?').all(runId),
      proposals: fx.db.prepare('SELECT * FROM crm_ai_field_proposals WHERE run_id=?').all(runId),
      fit: fit ? { value: JSON.parse(fit.value_json), cost: fit.cost, engine: fit.engine, model: fit.model } : null,
      readiness: readiness
        ? { value: JSON.parse(readiness.value_json), cost: readiness.cost, engine: readiness.engine, model: readiness.model }
        : null,
      tasks: fx.db.prepare(`SELECT id,station,state FROM crm_ai_jobs
        WHERE workflow_id=? ORDER BY created_at,id`).all(run.workflow_id),
      legacyTasks: fx.db.prepare(`SELECT legacy_task_type type,legacy_task_id taskId
        FROM crm_ai_enrichment_node_links WHERE run_id=? AND legacy_task_id!=''
        ORDER BY node_key`).all(runId),
      usage: fx.db.prepare(`SELECT station,status,charged_cost_micros costMicros,cost_source costSource
        FROM crm_ai_usage_ledger WHERE job_id IN (
          SELECT id FROM crm_ai_jobs WHERE workflow_id=?
        ) ORDER BY id`).all(run.workflow_id),
    };
  }

  return {
    fx,
    startScenario,
    close: () => fx.close(),
  };
}

module.exports = {
  FULL_ENRICHMENT_PERMISSIONS,
  createEnrichmentFixture,
};
