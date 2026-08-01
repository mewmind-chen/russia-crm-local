'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');

function appOptions() {
  return {
    salesCrm: {
      aiStationsEnabled: true,
      customerEnrichmentEnabled: true,
      customerEnrichmentAutoTriggerEnabled: true,
      salesPackEnabled: true,
    },
  };
}

async function disableFeature(fx, key) {
  const response = await fx.request(`/api/sales-crm/ai/features/${key}`, {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { enabled: false },
  });
  assert.equal(response.status, 200, `disable ${key}`);
  assert.equal((await response.json()).feature.effectiveEnabled, false, key);
}

test('disabled sales-pack gate removes cached result/task and rejects retry cancel and review', async t => {
  const fx = await adminFixture({ appOptions: appOptions() });
  t.after(() => fx.close());

  const jobs = createAIJobStore(fx.db, { idFactory: () => 'AIJ-ISSUE196-PACK' });
  const job = jobs.enqueue({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    station: 'sales_pack',
    contextHash: 'a'.repeat(64),
    payload: { stationVersion: 'v1' },
    createdBy: 'U-MGR',
  }, 'issue196:sales-pack');
  const cachedValue = {
      summary: 'SENSITIVE_CACHED_SALES_PACK',
      entryPoints: ['SENSITIVE_ENTRY_POINT'],
      risks: [],
      draft: { channel: 'email', subject: '', body: '' },
      evidenceIds: [],
      confidence: 0.9,
      reviewRequired: false,
    };
  fx.db.prepare(`INSERT INTO crm_ai_station_results
    (id,job_id,customer_id,crm_account_id,station,context_hash,value_json,confidence,
     review_required,engine,model,prompt_version,schema_version,usage_json,cost,idempotency_key,
     generated_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'AIR-ISSUE196-PACK', job.id, 'RU-9002', 'CRM-OWN', 'sales_pack', 'a'.repeat(64),
    JSON.stringify(cachedValue), 0.9, 0, 'test', 'fixture', 'v1', 'v1', '{}', 0,
    'issue196:sales-pack:result', '2026-08-01T01:00:00.000Z', '2026-08-01T01:00:00.000Z',
  );

  await disableFeature(fx, 'sales_pack');

  const results = await fx.request('/api/sales-crm/ai/customers/RU-9002/results', {
    cookie: fx.cookie,
  });
  assert.equal(results.status, 200);
  const resultBody = await results.json();
  assert.equal(resultBody.salesPack, null);
  assert.doesNotMatch(JSON.stringify(resultBody), /SENSITIVE_CACHED_SALES_PACK|SENSITIVE_ENTRY_POINT/);

  const list = await fx.request('/api/sales-crm/ai/tasks?page=1&pageSize=100', {
    cookie: fx.cookie,
  });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).items.some(item => item.taskId === job.id), false);
  const adminList = await fx.request('/api/sales-crm/ai/tasks?page=1&pageSize=100', {
    cookie: fx.adminCookie,
  });
  assert.equal(adminList.status, 200);
  const adminBody = await adminList.json();
  assert.equal(adminBody.items.some(item => item.taskId === job.id), false);
  assert.equal(Number(adminBody.overview.queue.queued || 0), 0);
  assert.equal((await fx.request(`/api/sales-crm/ai/tasks/${job.id}`, {
    cookie: fx.cookie,
  })).status, 404);

  for (const [suffix, body] of [
    ['retry', undefined],
    ['cancel', undefined],
    ['review', { decision: 'approved', summary: 'must stay blocked' }],
  ]) {
    const response = await fx.request(`/api/sales-crm/ai/jobs/${job.id}/${suffix}`, {
      cookie: fx.cookie,
      method: 'POST',
      body,
    });
    assert.equal(response.status, 409, suffix);
    assert.equal((await response.json()).code, 'AI_FEATURE_DISABLED', suffix);
  }
  for (const action of ['retry', 'cancel']) {
    const response = await fx.request(`/api/sales-crm/ai/bulk/${action}`, {
      cookie: fx.cookie,
      method: 'POST',
      body: { jobIds: [job.id] },
    });
    assert.equal(response.status, 409, `bulk ${action}`);
    assert.equal((await response.json()).code, 'AI_FEATURE_DISABLED', `bulk ${action}`);
  }

  const blockedFeedback = await fx.request(`/api/sales-crm/ai/jobs/${job.id}/feedback`, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      label: 'replied',
      idempotencyKey: 'issue196:feedback:sales-pack-disabled',
    },
  });
  assert.equal(blockedFeedback.status, 409);
  assert.equal((await blockedFeedback.json()).code, 'AI_FEATURE_DISABLED');
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_feedback_labels
    WHERE idempotency_key=?`).get('issue196:feedback:sales-pack-disabled').count, 0);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE action='ai_feedback_recorded' AND entity_id=?`).get(job.id).count, 0);

  const enabledJob = createAIJobStore(fx.db, {
    idFactory: () => 'AIJ-ISSUE196-ENABLED-FEEDBACK',
  }).enqueue({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    station: 'customer_fit',
    contextHash: 'd'.repeat(64),
    payload: { stationVersion: 'v1' },
    createdBy: 'U-MGR',
  }, 'issue196:enabled-feedback');
  const enabledFeedback = await fx.request(
    `/api/sales-crm/ai/jobs/${enabledJob.id}/feedback`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: {
        label: 'replied',
        idempotencyKey: 'issue196:feedback:enabled-job',
      },
    },
  );
  assert.equal(enabledFeedback.status, 200);
  assert.equal((await enabledFeedback.json()).feedback.label, 'replied');
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_feedback_labels
    WHERE idempotency_key=?`).get('issue196:feedback:enabled-job').count, 1);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE action='ai_feedback_recorded' AND entity_id=?`).get(enabledJob.id).count, 1);
});

test('disabled enrichment gate rejects cached reads, starts, cancellation and proposal review', async t => {
  const fx = await adminFixture({ appOptions: appOptions() });
  t.after(() => fx.close());
  await disableFeature(fx, 'customer_enrichment');

  for (const [route, method, body] of [
    ['/api/sales-crm/ai/customers/RU-9002/enrichment', 'GET'],
    ['/api/sales-crm/ai/customers/RU-9002/enrichment/run', 'POST'],
    ['/api/sales-crm/ai/enrichment/ENRICHMENT-CACHED/cancel', 'POST'],
    ['/api/sales-crm/ai/proposals/PROPOSAL-CACHED/review', 'POST', { decision: 'accepted' }],
  ]) {
    const response = await fx.request(route, { cookie: fx.adminCookie, method, body });
    assert.equal(response.status, 409, route);
    assert.equal((await response.json()).code, 'AI_FEATURE_DISABLED', route);
  }

  const bootstrap = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  const features = (await bootstrap.json()).features;
  assert.equal(features.aiStations, true);
  assert.equal(features.customerEnrichment, false);
  assert.equal(features.customerEnrichmentAutoTrigger, false);
});

test('disabled enrichment gate rejects linked jobs through single and bulk mutation routes', async t => {
  const fx = await adminFixture({ appOptions: appOptions() });
  t.after(() => fx.close());

  const enrichment = createCustomerEnrichmentStore(fx.db, {
    idFactory: () => 'ENR-ISSUE196-LINKED',
  });
  const run = enrichment.createTrigger({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    triggerSource: 'manual_rerun',
    triggeredBy: 'U-MGR',
    inputFingerprint: 'b'.repeat(64),
    pipelineVersion: 'manual-v1',
  });
  const jobs = createAIJobStore(fx.db, { idFactory: () => 'AIJ-ISSUE196-LINKED' });
  const job = jobs.enqueue({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    station: 'customer_fit',
    contextHash: 'c'.repeat(64),
    payload: { enrichmentRunId: run.id },
    createdBy: 'U-MGR',
  }, 'issue196:linked-enrichment');
  enrichment.linkNode({ runId: run.id, nodeKey: 'customer_fit', aiJobId: job.id });
  await disableFeature(fx, 'customer_enrichment');

  for (const [suffix, body] of [
    ['retry', undefined],
    ['cancel', undefined],
    ['review', { decision: 'approved', summary: 'must stay blocked' }],
  ]) {
    const response = await fx.request(`/api/sales-crm/ai/jobs/${job.id}/${suffix}`, {
      cookie: fx.cookie,
      method: 'POST',
      body,
    });
    assert.equal(response.status, 409, suffix);
    assert.equal((await response.json()).code, 'AI_FEATURE_DISABLED', suffix);
  }

  for (const action of ['retry', 'cancel']) {
    const response = await fx.request(`/api/sales-crm/ai/bulk/${action}`, {
      cookie: fx.cookie,
      method: 'POST',
      body: { jobIds: [job.id] },
    });
    assert.equal(response.status, 409, `bulk ${action}`);
    assert.equal((await response.json()).code, 'AI_FEATURE_DISABLED', `bulk ${action}`);
  }

  const blockedFeedback = await fx.request(`/api/sales-crm/ai/jobs/${job.id}/feedback`, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      label: 'replied',
      idempotencyKey: 'issue196:feedback:enrichment-disabled',
    },
  });
  assert.equal(blockedFeedback.status, 409);
  assert.equal((await blockedFeedback.json()).code, 'AI_FEATURE_DISABLED');
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_feedback_labels
    WHERE idempotency_key=?`).get('issue196:feedback:enrichment-disabled').count, 0);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE action='ai_feedback_recorded' AND entity_id=?`).get(job.id).count, 0);

  const list = await fx.request('/api/sales-crm/ai/tasks?page=1&pageSize=100', {
    cookie: fx.cookie,
  });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).items.some(item => item.taskId === job.id), false);
  const adminList = await fx.request('/api/sales-crm/ai/tasks?page=1&pageSize=100', {
    cookie: fx.adminCookie,
  });
  const adminBody = await adminList.json();
  assert.equal(adminBody.items.some(item => item.taskId === job.id), false);
  assert.equal(Number(adminBody.overview.queue.queued || 0), 0);
  assert.equal((await fx.request(`/api/sales-crm/ai/tasks/${job.id}`, {
    cookie: fx.cookie,
  })).status, 404);
});

test('disabled global AI gate removes historical AI evaluation fields and search matches', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: false } },
  });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,evaluation_text,author_id,author_name,
     ai_status,ai_summary,ai_labels_json,ai_risks_json,ai_strategy,created_at,updated_at)
    VALUES ('EVAL-ISSUE196-AI-OFF','CRM-OWN','company','Manual evaluation','U-MGR','Manager',
      'completed','SENSITIVE_AI_SUMMARY','["SENSITIVE_AI_LABEL"]',
      '["SENSITIVE_AI_RISK"]','SENSITIVE_AI_STRATEGY',?,?)`).run(
    '2026-08-01 08:00:00', '2026-08-01 08:00:00',
  );

  const list = await fx.request('/api/sales-crm/lists/insights?filters=%7B%7D', {
    cookie: fx.cookie,
  });
  assert.equal(list.status, 200);
  const body = await list.json();
  const row = body.rows.find(item => item.latestEvaluationId === 'EVAL-ISSUE196-AI-OFF');
  assert.ok(row);
  for (const key of [
    'aiStatus', 'aiSummary', 'aiLabelsJson', 'aiRisksJson',
    'aiStrategy', 'aiLabels', 'aiRisks',
  ]) assert.equal(Object.hasOwn(row, key), false, key);
  assert.doesNotMatch(JSON.stringify(body), /SENSITIVE_AI_/);

  const search = encodeURIComponent(JSON.stringify({
    search: { operator: 'contains', value: 'SENSITIVE_AI_LABEL' },
  }));
  const hidden = await fx.request(`/api/sales-crm/lists/insights?filters=${search}`, {
    cookie: fx.cookie,
  });
  assert.equal(hidden.status, 200);
  assert.equal((await hidden.json()).total, 0);
});
