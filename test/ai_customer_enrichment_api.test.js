'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');
const { createEnrichmentEvidenceStore } = require('../lib/ai_stations/enrichment/evidence');
const { createEnrichmentProposalStore } = require('../lib/ai_stations/enrichment/proposals');

const FULL_START = {
  view_customers: true,
  use_ai_assistant: true,
  run_recon: true,
  view_recon: true,
  view_contacts: true,
};

function enabledApp() {
  return {
    salesCrm: {
      aiStationsEnabled: true,
      customerEnrichmentEnabled: true,
      customerEnrichmentAutoTriggerEnabled: false,
    },
  };
}

test('enrichment read/start endpoints enforce login, full permissions, feature flag, and customer scope', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: FULL_START,
    appOptions: enabledApp(),
  });
  t.after(() => fx.close());

  assert.equal((await fx.request('/api/sales-crm/ai/customers/RU-9002/enrichment')).status, 401);
  assert.equal((await fx.request('/api/sales-crm/ai/customers/RU-9003/enrichment', {
    cookie: fx.cookie,
  })).status, 403);

  const first = await fx.request('/api/sales-crm/ai/customers/RU-9002/enrichment/run', {
    cookie: fx.cookie,
    method: 'POST',
  });
  assert.equal(first.status, 202);
  const firstBody = await first.json();
  assert.equal(firstBody.run.customerId, 'RU-9002');
  assert.equal(firstBody.run.state, 'pending_dispatch');
  const replay = await fx.request('/api/sales-crm/ai/customers/RU-9002/enrichment/run', {
    cookie: fx.cookie,
    method: 'POST',
  });
  assert.equal((await replay.json()).run.id, firstBody.run.id);

  fx.setUserPermissions('U-MGR', { run_recon: false });
  assert.equal((await fx.request('/api/sales-crm/ai/customers/RU-9002/enrichment/run', {
    cookie: fx.cookie,
    method: 'POST',
  })).status, 403);
});

test('manual enrichment start honors the feature flag and impersonation write block', async t => {
  const disabled = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: FULL_START,
    appOptions: {
      salesCrm: {
        aiStationsEnabled: true,
        customerEnrichmentEnabled: false,
      },
    },
  });
  t.after(() => disabled.close());
  const unavailable = await disabled.request('/api/sales-crm/ai/customers/RU-9002/enrichment/run', {
    cookie: disabled.cookie,
    method: 'POST',
  });
  assert.equal(unavailable.status, 409);
  assert.equal((await unavailable.json()).code, 'AI_ENRICHMENT_DISABLED');

  const impersonated = await fixtures.adminFixture({
    managerViewAll: false,
    permissions: FULL_START,
    appOptions: enabledApp(),
  });
  t.after(() => impersonated.close());
  await impersonated.startImpersonation('U-MGR');
  const blocked = await impersonated.request('/api/sales-crm/ai/customers/RU-9002/enrichment/run', {
    cookie: impersonated.adminCookie,
    method: 'POST',
  });
  assert.equal(blocked.status, 403);
});

test('enrichment detail redacts contact evidence and keeps anonymous audit routes', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { ...FULL_START, view_contacts: false },
    appOptions: enabledApp(),
  });
  t.after(() => fx.close());
  const store = createCustomerEnrichmentStore(fx.db, { idFactory: prefix => `${prefix}-API` });
  const run = store.createTrigger({
    customerId: 'RU-9002', crmAccountId: 'CRM-OWN', triggerSource: 'manual_rerun',
    triggeredBy: 'U-MGR', inputFingerprint: 'e'.repeat(64), pipelineVersion: 'manual-v1',
  });
  createEnrichmentEvidenceStore(fx.db).recordEvidence({
    customerId: 'RU-9002', runId: run.id, nodeKey: 'contact_collect',
    sourceUrl: 'https://owned.example/contact', sourceType: 'legacy_contact_recon',
    collectedAt: '2026-07-24T05:00:00.000Z',
    summary: 'Buyer buyer@owned.example +7 999 123 4567',
    content: 'private contact',
    confidence: 0.9,
    collector: 'test',
    collectorVersion: 'v1',
    contactSensitive: true,
  });

  const response = await fx.request('/api/sales-crm/ai/customers/RU-9002/enrichment', {
    cookie: fx.cookie,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.run.id, run.id);
  assert.equal(body.restricted.contacts, true);
  assert.doesNotMatch(JSON.stringify(body), /buyer@owned|999 123/);

  await new Promise(resolve => setImmediate(resolve));
  const audit = fx.db.prepare(`SELECT action,entity_id,detail_json FROM crm_audit_log
    WHERE entity_type='ai_station' ORDER BY rowid DESC LIMIT 1`).get();
  assert.equal(audit.action, 'GET /ai/customers/:customerId/enrichment');
  assert.equal(audit.entity_id, '');
  assert.doesNotMatch(audit.detail_json, /RU-9002|AER-API/);
});

test('proposal review requires edit_customer and run cancellation requires cancel_ai_tasks', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { ...FULL_START, edit_customer: false, cancel_ai_tasks: false },
    appOptions: enabledApp(),
  });
  t.after(() => fx.close());
  const runs = createCustomerEnrichmentStore(fx.db, { idFactory: prefix => `${prefix}-MUTATE` });
  const run = runs.createTrigger({
    customerId: 'RU-9002', crmAccountId: 'CRM-OWN', triggerSource: 'manual_rerun',
    triggeredBy: 'U-MGR', inputFingerprint: 'f'.repeat(64), pipelineVersion: 'manual-v1',
  });
  const evidence = createEnrichmentEvidenceStore(fx.db).recordEvidence({
    customerId: 'RU-9002', runId: run.id, nodeKey: 'recon_collect',
    sourceUrl: 'https://owned.example/about', sourceType: 'official_website',
    collectedAt: '2026-07-24T05:00:00.000Z', summary: 'profile', content: 'profile',
    confidence: 0.9, collector: 'test', collectorVersion: 'v1',
  });
  fx.db.prepare("UPDATE customer_pool SET industry='existing' WHERE customer_id='RU-9002'").run();
  const proposal = createEnrichmentProposalStore(fx.db).propose({
    runId: run.id, fieldName: 'industry', proposedValue: '工业电子',
    evidenceIds: [evidence.id], confidence: 0.9,
  });
  const detail = await fx.request('/api/sales-crm/ai/customers/RU-9002/enrichment', {
    cookie: fx.cookie,
  });
  assert.equal((await detail.json()).proposals[0].currentValue, 'existing');

  assert.equal((await fx.request(`/api/sales-crm/ai/proposals/${proposal.id}/review`, {
    cookie: fx.cookie, method: 'POST', body: { decision: 'accepted' },
  })).status, 403);
  assert.equal((await fx.request(`/api/sales-crm/ai/enrichment/${run.id}/cancel`, {
    cookie: fx.cookie, method: 'POST',
  })).status, 403);

  fx.setUserPermissions('U-MGR', { edit_customer: true, cancel_ai_tasks: true });
  const review = await fx.request(`/api/sales-crm/ai/proposals/${proposal.id}/review`, {
    cookie: fx.cookie, method: 'POST', body: { decision: 'accepted' },
  });
  assert.equal(review.status, 200);
  assert.equal((await review.json()).proposal.state, 'accepted');
  const cancel = await fx.request(`/api/sales-crm/ai/enrichment/${run.id}/cancel`, {
    cookie: fx.cookie, method: 'POST',
  });
  assert.equal(cancel.status, 200);
  assert.equal((await cancel.json()).run.state, 'cancelled');
});
