'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');
const { createEnrichmentEvidenceStore } = require('../lib/ai_stations/enrichment/evidence');
const { createEnrichmentProposalStore } = require('../lib/ai_stations/enrichment/proposals');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createAIResultStore } = require('../lib/ai_stations/results');

function setup(db, suffix = 'P') {
  let sequence = 0;
  const runs = createCustomerEnrichmentStore(db, {
    idFactory: prefix => `${prefix}-${suffix}-${++sequence}`,
  });
  const run = runs.createTrigger({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    triggerSource: 'manual_create',
    triggeredBy: 'U-MGR',
    inputFingerprint: suffix.padEnd(64, '1').slice(0, 64),
    pipelineVersion: 'v1',
  });
  const evidence = createEnrichmentEvidenceStore(db).recordEvidence({
    customerId: 'RU-9002',
    runId: run.id,
    nodeKey: 'recon_collect',
    sourceUrl: `https://${suffix.toLowerCase()}.example/source`,
    sourceType: 'official_website',
    collectedAt: '2026-07-24T05:00:00.000Z',
    summary: 'Official source',
    content: `official-${suffix}`,
    confidence: 0.9,
    collector: 'test',
    collectorVersion: 'v1',
  });
  return {
    run,
    evidence,
    proposals: createEnrichmentProposalStore(db, {
      idFactory: prefix => `${prefix}-${suffix}-${++sequence}`,
    }),
  };
}

test('proposal normalization is audited and an evidence-backed empty field auto-applies provisionally', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const { run, evidence, proposals } = setup(fx.db, 'AUTO');

  const proposal = proposals.propose({
    runId: run.id,
    fieldName: 'website',
    proposedValue: '  owned.example/path  ',
    evidenceIds: [evidence.id],
    confidence: 0.9,
  });

  assert.equal(proposal.state, 'auto_applied');
  assert.equal(proposal.proposedValue, 'https://owned.example/path');
  assert.deepEqual(proposal.normalization, {
    input: '  owned.example/path  ',
    output: 'https://owned.example/path',
    rule: 'canonical_http_url',
  });
  assert.equal(fx.db.prepare("SELECT website FROM customer_pool WHERE customer_id='RU-9002'").get().website,
    'https://owned.example/path');
  assert.equal(fx.db.prepare(`SELECT source_state FROM crm_ai_field_provenance
    WHERE target_type='crm_account' AND target_id='CRM-OWN' AND field_name='website'`).get().source_state,
  'ai_provisional');
});

test('employee-confirmed fields are protected and reliable conflicting proposals require review', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const { run, evidence, proposals } = setup(fx.db, 'CONFLICT');
  fx.db.prepare("UPDATE crm_accounts SET country='RU' WHERE id='CRM-OWN'").run();
  createEnrichmentEvidenceStore(fx.db).setFieldProvenance({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    targetType: 'crm_account',
    targetId: 'CRM-OWN',
    fieldName: 'country',
    value: 'RU',
    sourceState: 'employee_confirmed',
    confirmedBy: 'U-MGR',
  });

  const protectedProposal = proposals.propose({
    runId: run.id,
    fieldName: 'country',
    proposedValue: 'Russia',
    evidenceIds: [evidence.id],
    confidence: 0.95,
  });
  assert.equal(protectedProposal.state, 'needs_review');
  assert.equal(protectedProposal.reasonCode, 'employee_confirmed_protected');
  assert.equal(fx.db.prepare("SELECT country FROM crm_accounts WHERE id='CRM-OWN'").get().country, 'RU');

  const first = proposals.propose({
    runId: run.id,
    fieldName: 'industry',
    proposedValue: '工业电子',
    evidenceIds: [evidence.id],
    confidence: 0.9,
  });
  const secondEvidence = createEnrichmentEvidenceStore(fx.db).recordEvidence({
    customerId: 'RU-9002', runId: run.id, nodeKey: 'recon_collect',
    sourceUrl: 'https://conflict.example/other', sourceType: 'registry',
    collectedAt: '2026-07-24T05:01:00.000Z', summary: 'Other source',
    content: 'different', confidence: 0.9, collector: 'test', collectorVersion: 'v1',
  });
  const second = proposals.propose({
    runId: run.id,
    fieldName: 'industry',
    proposedValue: '汽车电子',
    evidenceIds: [secondEvidence.id],
    confidence: 0.9,
  });
  assert.equal(first.state, 'auto_applied');
  assert.equal(second.state, 'needs_review');
  assert.equal(second.reasonCode, 'reliable_source_conflict');
});

test('review accept/reject is transactional and context changes supersede stale proposals', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const { run, evidence, proposals } = setup(fx.db, 'REVIEW');
  fx.db.prepare("UPDATE crm_accounts SET industry='existing',product_focus='existing' WHERE id='CRM-OWN'").run();
  fx.db.prepare(`UPDATE customer_pool SET industry='existing',description='existing',products='existing'
    WHERE customer_id='RU-9002'`).run();
  const accepted = proposals.propose({
    runId: run.id,
    fieldName: 'industry',
    proposedValue: '工业电子',
    evidenceIds: [evidence.id],
    confidence: 0.8,
  });
  assert.equal(accepted.state, 'needs_review');
  assert.equal(proposals.review(accepted.id, {
    decision: 'accepted',
    reviewerId: 'U-MGR',
  }).state, 'accepted');
  assert.equal(fx.db.prepare("SELECT industry FROM customer_pool WHERE customer_id='RU-9002'").get().industry,
    '工业电子');

  const rejected = proposals.propose({
    runId: run.id,
    fieldName: 'description',
    proposedValue: 'Evidence-backed profile',
    evidenceIds: [evidence.id],
    confidence: 0.8,
  });
  assert.equal(proposals.review(rejected.id, {
    decision: 'rejected',
    reviewerId: 'U-MGR',
  }).state, 'rejected');
  assert.equal(fx.db.prepare("SELECT description FROM customer_pool WHERE customer_id='RU-9002'").get().description, 'existing');

  const stale = proposals.propose({
    runId: run.id,
    fieldName: 'products',
    proposedValue: 'MCU',
    evidenceIds: [evidence.id],
    confidence: 0.8,
  });
  fx.db.prepare("UPDATE customer_pool SET products='employee edit' WHERE customer_id='RU-9002'").run();
  fx.db.prepare("UPDATE crm_accounts SET product_focus='employee edit' WHERE id='CRM-OWN'").run();
  assert.equal(proposals.review(stale.id, {
    decision: 'accepted',
    reviewerId: 'U-MGR',
  }).state, 'superseded');
  assert.equal(fx.db.prepare("SELECT products FROM customer_pool WHERE customer_id='RU-9002'").get().products,
    'employee edit');
});

test('finalization persists completeness, tags, missing items, and only allowed route states', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const { run, proposals } = setup(fx.db, 'FINAL');

  const missing = proposals.finalize(run.id);
  assert.equal(missing.routeState, 'missing_info');
  assert.ok(missing.missingItems.includes('website'));
  assert.ok(missing.completeness < 100);

  fx.db.prepare(`UPDATE customer_pool SET website='https://owned.example',country='RU',
    industry='工业电子',customer_type='终端制造商',products='MCU',description='Factory',
    best_contact_level='L3' WHERE customer_id='RU-9002'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET website='https://owned.example',country='RU',
    industry='工业电子',customer_type='终端制造商',product_focus='MCU'
    WHERE id='CRM-OWN'`).run();
  const ready = proposals.finalize(run.id);
  assert.equal(ready.routeState, 'pending_assignment');
  assert.equal(ready.completeness, 100);
  assert.deepEqual(ready.missingItems, []);
  assert.ok(Array.isArray(ready.tags));
  assert.equal(fx.db.prepare('SELECT route_state,completeness FROM crm_ai_enrichment_runs WHERE id=?')
    .get(run.id).route_state, 'pending_assignment');
});

test('partial contact readiness keeps missing_info ahead of pending field reviews', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const { run, evidence, proposals } = setup(fx.db, 'READINESS');
  fx.db.prepare(`UPDATE customer_pool SET website='https://owned.example',country='RU',
    industry='工业电子',customer_type='终端制造商',products='MCU',description='Factory',
    best_contact_level='L3' WHERE customer_id='RU-9002'`).run();
  fx.db.prepare("UPDATE customer_pool SET industry='existing' WHERE customer_id='RU-9002'").run();
  proposals.propose({
    runId: run.id,
    fieldName: 'industry',
    proposedValue: '待审核行业',
    evidenceIds: [evidence.id],
    confidence: 0.8,
  });

  const jobs = createAIJobStore(fx.db);
  const readiness = jobs.enqueue({
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    station: 'contact_readiness',
    contextHash: 'c'.repeat(64),
    createdBy: 'U-MGR',
  }, 'proposal:test:contact-readiness');
  jobs.claimById(readiness.id, 'proposal-worker');
  createAIResultStore(fx.db).saveResult({
    jobId: readiness.id,
    workerId: 'proposal-worker',
    contextHash: readiness.contextHash,
    value: {
      version: 'v1',
      confidence: 0.7,
      evidenceIds: ['EV-1'],
      reasonCodes: ['CONTACT_VERIFICATION_INCOMPLETE'],
      readiness: 'partial',
      contactIds: ['PERSON-1'],
    },
    evidenceIds: ['EV-1'],
    contactIds: ['PERSON-1'],
    metadata: {
      engine: 'fixture',
      model: 'fixture-readiness-v1',
      promptVersion: 'v1',
      schemaVersion: 'v1',
    },
  }, 'proposal:test:contact-readiness-result');
  createCustomerEnrichmentStore(fx.db).linkNode({
    runId: run.id,
    nodeKey: 'contact_readiness',
    aiJobId: readiness.id,
  });

  const finalized = proposals.finalize(run.id);
  const saved = fx.db.prepare(`SELECT route_state routeState,reason_code reasonCode
    FROM crm_ai_enrichment_runs WHERE id=?`).get(run.id);
  assert.equal(finalized.routeState, 'missing_info');
  assert.ok(finalized.missingItems.includes('contact_readiness'));
  assert.deepEqual(saved, {
    routeState: 'missing_info',
    reasonCode: 'contact_readiness_partial',
  });
});
