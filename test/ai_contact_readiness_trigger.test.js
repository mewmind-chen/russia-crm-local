'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { buildAccessContext } = require('../lib/access_control');
const { hydrateUserPermissions } = require('../lib/permission_groups');
const { submitReconResult } = require('../lib/db');
const { buildCustomerContext } = require('../lib/ai_stations/context');
const {
  buildContactReadinessContext,
  scheduleContactReadinessForCompletedFits,
} = require('../lib/ai_stations/contact_readiness');
const { executeContactReadinessJob } = require('../lib/ai_stations/executor');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createAIResultStore } = require('../lib/ai_stations/results');

const PERMISSIONS = Object.freeze({
  use_ai_assistant: true,
  view_customers: true,
  view_contacts: true,
  view_recon: true,
  edit_customer: true,
});

async function readinessFixture() {
  const fx = await fixtures.seededFixture({
    managerViewAll: true,
    permissions: PERMISSIONS,
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  const now = '2026-07-24 08:00:00';
  fx.db.prepare(`INSERT INTO person_candidates
    (person_id,customer_id,contact_recon_job_id,full_name,title,department,decision_role,
     employment_status,employment_confidence,contact_level,sales_ready,first_found_at,created_at,updated_at)
    VALUES ('PERSON-READY','RU-9002','','Ready Buyer','Procurement Director','Procurement',
      'decision_maker','verified_current',95,'L3',1,?,?,?)`).run(now, now, now);
  fx.db.prepare(`INSERT INTO contact_methods
    (contact_id,person_id,customer_id,method_type,value,normalized_value,status,
     verification_status,confidence,source_url,last_verified_at,verified_at)
    VALUES ('METHOD-READY','PERSON-READY','RU-9002','email','buyer@ready.example',
      'buyer@ready.example','verified','verified',95,'https://ready.example/team',?,?)`)
    .run(now, now);

  const actor = hydrateUserPermissions(
    fx.db,
    fx.db.prepare('SELECT * FROM sales_users WHERE id=?').get('U-MGR'),
  );
  const accessContext = buildAccessContext(fx.db, actor);
  const customerContext = buildCustomerContext(fx.db, accessContext, 'RU-9002');
  const jobs = createAIJobStore(fx.db);
  const results = createAIResultStore(fx.db);
  const fit = jobs.enqueue({
    trigger: { source: 'api', reason: 'test_fixture' },
    customerId: 'RU-9002',
    crmAccountId: 'CRM-OWN',
    station: 'customer_fit',
    contextHash: customerContext.contextHash,
    createdBy: actor.id,
    payload: { contextVersion: 'crm-v1' },
  }, 'contact-readiness:test:fit');
  jobs.claimById(fit.id, 'fit-worker');
  results.saveResult({
    jobId: fit.id,
    workerId: 'fit-worker',
    contextHash: customerContext.contextHash,
    value: {
      version: 'v1',
      confidence: 0.9,
      evidenceIds: customerContext.evidenceIds.slice(0, 2),
      reasonCodes: ['PRODUCT_MATCH'],
      fitScore: 82,
      grade: 'B',
      reviewRequired: false,
    },
    evidenceIds: customerContext.evidenceIds,
    metadata: {
      engine: 'fixture',
      model: 'fixture-fit-v1',
      promptVersion: 'v1',
      schemaVersion: 'v1',
    },
  }, 'contact-readiness:test:fit-result');
  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  return { fx, actor, accessContext, fit, jobs, results, managerCookie };
}

test('successful customer_fit schedules one contact_readiness successor with server contact IDs', async t => {
  const fixture = await readinessFixture();
  t.after(() => fixture.fx.close());

  const first = scheduleContactReadinessForCompletedFits(fixture.fx.db);
  const second = scheduleContactReadinessForCompletedFits(fixture.fx.db);
  assert.equal(first.jobs.filter(job => job.station === 'contact_readiness').length, 1);
  assert.equal(second.scheduled, 0);

  const readiness = first.jobs.find(job => job.station === 'contact_readiness');
  assert.equal(readiness.parentJobId, fixture.fit.id);
  assert.deepEqual(readiness.dependencyIds, [fixture.fit.id]);
  const context = buildContactReadinessContext(
    fixture.fx.db,
    fixture.accessContext,
    'RU-9002',
    { fitJobId: fixture.fit.id, results: fixture.results },
  );
  assert.ok(context.contactIds.includes('PERSON-READY'));
  assert.equal(context.contextHash, readiness.contextHash);
});

test('partial readiness writes a research action without assigning or changing the owner', async t => {
  const fixture = await readinessFixture();
  t.after(() => fixture.fx.close());
  const before = fixture.fx.db.prepare(`SELECT owner_id ownerId,assignment_status assignmentStatus
    FROM crm_accounts WHERE id='CRM-OWN'`).get();
  const intakeBefore = fixture.fx.db.prepare('SELECT COUNT(*) count FROM crm_intake_items').get().count;
  const scheduled = scheduleContactReadinessForCompletedFits(fixture.fx.db);
  const readiness = scheduled.jobs.find(job => job.station === 'contact_readiness');
  fixture.jobs.claimById(readiness.id, 'readiness-worker');
  let allowedContactIds = [];

  const execution = await executeContactReadinessJob({
    db: fixture.fx.db,
    jobs: fixture.jobs,
    results: fixture.results,
    jobId: readiness.id,
    workerId: 'readiness-worker',
    accessContext: fixture.accessContext,
    actor: fixture.actor,
    modelCall: async messages => {
      const prompt = JSON.parse(messages[1].content);
      allowedContactIds = prompt.trustedCrmContext.allowedContactIds;
      return {
        answer: JSON.stringify({
          version: 'v1',
          confidence: 0.72,
          evidenceIds: prompt.evidence.slice(0, 2).map(item => item.id),
          reasonCodes: ['CONTACT_VERIFICATION_INCOMPLETE'],
          readiness: 'partial',
          contactIds: [allowedContactIds[0]],
        }),
        engine: 'fixture',
        model: 'fixture-readiness-v1',
      };
    },
  });

  assert.equal(execution.result.value.readiness, 'partial');
  assert.deepEqual(execution.result.value.contactIds, [allowedContactIds[0]]);
  assert.match(fixture.fx.db.prepare(`SELECT contact_next_action action FROM customer_pool
    WHERE customer_id='RU-9002'`).get().action, /补充验证/);
  assert.deepEqual(fixture.fx.db.prepare(`SELECT owner_id ownerId,assignment_status assignmentStatus
    FROM crm_accounts WHERE id='CRM-OWN'`).get(), before);
  assert.equal(fixture.fx.db.prepare('SELECT COUNT(*) count FROM crm_intake_items').get().count, intakeBefore);
  assert.equal(fixture.fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_jobs
    WHERE station IN ('distribution_priority','sales_match')`).get().count, 0);
});

test('a new manual contact marks readiness stale and schedules the changed context once', async t => {
  const fixture = await readinessFixture();
  t.after(() => fixture.fx.close());
  const scheduled = scheduleContactReadinessForCompletedFits(fixture.fx.db);
  const readiness = scheduled.jobs.find(job => job.station === 'contact_readiness');
  fixture.jobs.claimById(readiness.id, 'readiness-worker');
  await executeContactReadinessJob({
    db: fixture.fx.db,
    jobs: fixture.jobs,
    results: fixture.results,
    jobId: readiness.id,
    workerId: 'readiness-worker',
    accessContext: fixture.accessContext,
    actor: fixture.actor,
    modelCall: async messages => {
      const prompt = JSON.parse(messages[1].content);
      return {
        answer: JSON.stringify({
          version: 'v1',
          confidence: 0.95,
          evidenceIds: prompt.evidence.slice(0, 2).map(item => item.id),
          reasonCodes: ['VERIFIED_BUYER_CONTACT'],
          readiness: 'ready',
          contactIds: [prompt.trustedCrmContext.allowedContactIds[0]],
        }),
        engine: 'fixture',
        model: 'fixture-readiness-v1',
      };
    },
  });

  const response = await fixture.fx.request('/api/sales-crm/contacts', {
    cookie: fixture.managerCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN',
      name: 'New Buyer',
      title: 'Purchasing Manager',
      email: 'new.buyer@ready.example',
    },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  const stale = fixture.results.getForJob(readiness.id);
  assert.equal(stale.stale, true);
  assert.equal(stale.staleReason, 'manual_contact_created');
  assert.match(fixture.fx.db.prepare(`SELECT contact_next_action action FROM customer_pool
    WHERE customer_id='RU-9002'`).get().action, /等待重新评估/);

  const replacement = scheduleContactReadinessForCompletedFits(fixture.fx.db);
  const replacementJob = replacement.jobs.find(job => job.station === 'contact_readiness');
  assert.ok(replacementJob);
  assert.notEqual(replacementJob.contextHash, readiness.contextHash);
  const changedContext = buildContactReadinessContext(
    fixture.fx.db,
    fixture.accessContext,
    'RU-9002',
    { fitJobId: fixture.fit.id, results: fixture.results },
  );
  assert.ok(changedContext.contactIds.includes(body.contactId));
  assert.equal(changedContext.contextHash, replacementJob.contextHash);
  assert.equal(scheduleContactReadinessForCompletedFits(fixture.fx.db).scheduled, 0);
});

test('Recon stales readiness only when its contact fields change', async t => {
  const fixture = await readinessFixture();
  t.after(() => fixture.fx.close());
  const scheduled = scheduleContactReadinessForCompletedFits(fixture.fx.db);
  const readiness = scheduled.jobs.find(job => job.station === 'contact_readiness');
  fixture.jobs.claimById(readiness.id, 'readiness-worker');
  await executeContactReadinessJob({
    db: fixture.fx.db,
    jobs: fixture.jobs,
    results: fixture.results,
    jobId: readiness.id,
    workerId: 'readiness-worker',
    accessContext: fixture.accessContext,
    actor: fixture.actor,
    modelCall: async messages => {
      const prompt = JSON.parse(messages[1].content);
      return {
        answer: JSON.stringify({
          version: 'v1',
          confidence: 0.95,
          evidenceIds: prompt.evidence.slice(0, 2).map(item => item.id),
          reasonCodes: ['VERIFIED_BUYER_CONTACT'],
          readiness: 'ready',
          contactIds: [prompt.trustedCrmContext.allowedContactIds[0]],
        }),
        engine: 'fixture',
        model: 'fixture-readiness-v1',
      };
    },
  });
  const evidence = [{
    field_name: 'industry',
    value: 'Industrial electronics',
    source_url: 'https://owned.example/about',
  }];

  submitReconResult({
    job_id: 'JOB-OWN',
    result: { company_name: 'Owned Fixture', industry: 'Industrial electronics' },
    evidence,
  }, { db: fixture.fx.db });
  assert.equal(fixture.results.getForJob(readiness.id).stale, false);

  submitReconResult({
    job_id: 'JOB-OWN',
    result: {
      company_name: 'Owned Fixture',
      industry: 'Industrial electronics',
      contact_name: 'New Recon Buyer',
    },
    evidence,
  }, { db: fixture.fx.db });
  const stale = fixture.results.getForJob(readiness.id);
  assert.equal(stale.stale, true);
  assert.equal(stale.staleReason, 'recon_contact_changed');
});
