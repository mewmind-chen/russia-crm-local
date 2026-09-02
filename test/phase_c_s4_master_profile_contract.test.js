'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture, seededFixture } = require('./helpers/permission_fixture');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const dbSource = read('lib/db.js');
const salesCrmSource = read('lib/sales_crm.js');
const accessSource = read('lib/access_control.js');

function functionSlice(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing ${nextFunctionName}`);
  return source.slice(start, end);
}

function routeSlice(source, route, nextRoute) {
  const start = source.indexOf(route);
  assert.notEqual(start, -1, `missing ${route}`);
  const end = source.indexOf(nextRoute, start + route.length);
  assert.notEqual(end, -1, `missing ${nextRoute}`);
  return source.slice(start, end);
}

const profile = functionSlice(dbSource, 'getCustomerProfileData', 'updateCustomer');
const recycle = functionSlice(salesCrmSource, 'buildRecycleAccountProfile', 'loadRecycleProfile');
const profileRoute = routeSlice(
  salesCrmSource,
  "app.get('/api/sales-crm/profile/:customerId'",
  "app.get('/api/sales-crm/intake/:itemId/profile'",
);
const intakeProfileRoute = routeSlice(
  salesCrmSource,
  "app.get('/api/sales-crm/intake/:itemId/profile'",
  "app.get('/api/sales-crm/profile/:customerId/tag-history'",
);

function insertReconFixture(fx, now = '2026-09-02 12:00:00') {
  fx.db.prepare(`INSERT INTO recon_results
    (job_id,customer_id,company_name,email,phone,contact_name,contact_classification,missing_steps,
     evidence_url,artifacts_json,opportunity_summary,updated_at)
    VALUES ('JOB-S4-PROFILE','RU-9001','Wu Fixture','recon-profile@example.test','+7-profile',
      'Recon Profile Buyer','buyer','email','https://profile.example/contact',
      '{"email":"recon-json-profile@example.test"}','opportunity-profile@example.test',?)`).run(now);
  fx.db.prepare(`INSERT INTO recon_jobs
    (job_id,customer_id,company_name,status,error,updated_at)
    VALUES ('JOB-S4-PROFILE','RU-9001','Wu Fixture','failed','job-profile@example.test',?)`).run(now);
}

function insertEvaluationFixture(fx, now = '2026-09-02 12:00:00') {
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,subject_name,evaluation_text,author_id,author_name,ai_status,
     ai_summary,ai_labels_json,ai_order_keys_json,ai_risks_json,ai_strategy,ai_error,created_at,updated_at)
    VALUES ('EV-S4-PROFILE','CRM-WU','company','Wu Fixture','evaluation-profile@example.test',
      'U-WU','Wu','done','summary-profile@example.test','["label-profile@example.test"]',
      '["key-profile@example.test"]','["risk-profile@example.test"]',
      'strategy-profile@example.test','error-profile@example.test',?,?)`).run(now, now);
}

test('S4/P4 profile and intake routes re-apply contact redaction after appending route-owned shapes', () => {
  for (const source of [profileRoute, intakeProfileRoute]) {
    assert.match(source, /res\.json\(redactProfileResponse\(value, req\.salesUser, payload\)\)/);
  }
  assert.match(salesCrmSource, /function redactProfileResponse\(value, user, payload\)/);
  assert.match(salesCrmSource, /const tagged = redactUnauthorizedProfileTags\(value, user, payload\)/);
  assert.match(salesCrmSource, /hasPermission\(user, 'view_contacts'\) \? tagged : redactContactFields\(tagged\)/);
  assert.match(profile, /return permissions\.view_contacts \? payload : redactContactFields\(payload\);/);
  assert.match(recycle, /return hasPermission\(user, 'view_contacts'\) \? payload : redactContactFields\(payload\);/);
  assert.match(accessSource, /function redactContactFields\(/);
});

test('S4/P4 restricted master profile gates people/contact jobs and strips appended evaluation narratives', async t => {
  const fx = await seededFixture({ permissions: {
    view_contacts: false,
    view_insights: true,
    view_recon: true,
  } });
  t.after(() => fx.close());
  insertReconFixture(fx);
  insertEvaluationFixture(fx);
  fx.db.prepare(`UPDATE customer_pool SET established_year=1998,email='pool-profile@example.test',
    phone='+7-pool-profile',best_person_id='PERSON-WU' WHERE customer_id='RU-9001'`).run();

  const response = await fx.request('/api/sales-crm/profile/RU-9001', { cookie: fx.cookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.profileAccess.source, 'crm');
  assert.equal(body.contactAccess.canView, false);
  assert.deepEqual(body.people, []);
  assert.deepEqual(body.contactReconJobs, []);
  assert.equal(body.customerPool[0].establishedYear, 1998);
  assert.equal(body.customerPool[0].email, undefined);
  assert.equal(body.reconResults.find(row => row.job_id === 'JOB-S4-PROFILE').email, undefined);
  assert.equal(body.reconResults.find(row => row.job_id === 'JOB-S4-PROFILE').artifacts_json, undefined);
  assert.equal(body.reconJobs.find(row => row.job_id === 'JOB-S4-PROFILE').error, undefined);
  const evaluation = body.insights.evaluations.find(row => row.id === 'EV-S4-PROFILE');
  assert.ok(evaluation);
  for (const key of ['evaluationText', 'aiSummary', 'aiLabels', 'aiOrderKeys', 'aiRisks', 'aiStrategy', 'aiError']) {
    assert.equal(Object.hasOwn(evaluation, key), false, `evaluation:${key}`);
  }
  assert.doesNotMatch(JSON.stringify(body), /[\w-]+-profile@example\.test|\+7-profile/);

  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,crm_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-S4-PROFILE','BATCH-TEST','RU-9001','CRM-WU','Wu Fixture','assigned','U-WU',?,?)`)
    .run('2026-09-02 12:00:00', '2026-09-02 12:00:00');
  const intakeResponse = await fx.request('/api/sales-crm/intake/INTAKE-S4-PROFILE/profile', {
    cookie: fx.cookie,
  });
  const intakeBody = await intakeResponse.json();
  assert.equal(intakeResponse.status, 200, intakeBody.error);
  assert.equal(intakeBody.profileAccess.source, 'intake');
  assert.deepEqual(intakeBody.people, []);
  assert.deepEqual(intakeBody.contactReconJobs, []);
  assert.equal(intakeBody.customerPool[0].email, undefined);
  assert.equal(intakeBody.reconResults.find(row => row.job_id === 'JOB-S4-PROFILE').email, undefined);
  assert.doesNotMatch(JSON.stringify(intakeBody), /[\w-]+-profile@example\.test|\+7-profile/);
});

test('S4/P4 authorized master profile preserves people and raw recon shape', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  insertReconFixture(fx);
  insertEvaluationFixture(fx);

  const response = await fx.request('/api/sales-crm/profile/RU-9001', { cookie: fx.adminCookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.contactAccess.canView, true);
  assert.ok(body.people.length > 0);
  assert.ok(body.contactReconJobs.length > 0);
  const recon = body.reconResults.find(row => row.job_id === 'JOB-S4-PROFILE');
  assert.equal(recon.email, 'recon-profile@example.test');
  assert.equal(recon.artifacts_json, '{"email":"recon-json-profile@example.test"}');
  assert.equal(body.insights.evaluations.find(row => row.id === 'EV-S4-PROFILE').evaluationText, 'evaluation-profile@example.test');
});

test('S4/P4 recycle composite reuses the same restricted master-profile gates', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const now = '2026-09-02 12:00:00';
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='mismatch',
    recycle_reason='recycle-profile@example.test',recycled_by='U-WU',recycled_at=?,
    previous_owner_id='U-WU',owner_id=NULL,assignment_status='returned' WHERE id='CRM-WU'`).run(now);
  insertReconFixture(fx, now);
  insertEvaluationFixture(fx, now);
  fx.setUserPermissions('U-WU', {
    manage_customer_recycle: true,
    view_contacts: false,
    view_insights: true,
    view_recon: true,
  });
  const restrictedCookie = await fx.login('wu@example.com', 'Password123!');

  const response = await fx.request('/api/sales-crm/accounts/CRM-WU/recycle-profile', {
    cookie: restrictedCookie,
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.profileAccess.readOnly, true);
  assert.equal(body.profileAccess.source, 'recycle');
  assert.deepEqual(body.people, []);
  assert.deepEqual(body.contactReconJobs, []);
  assert.equal(body.reconResults.find(row => row.job_id === 'JOB-S4-PROFILE').email, undefined);
  assert.equal(body.insights.evaluations.find(row => row.id === 'EV-S4-PROFILE').evaluationText, undefined);
  assert.equal(body.account.recycle_reason, undefined);
  assert.equal(body.recycle.reason, undefined);
  assert.doesNotMatch(JSON.stringify(body), /[\w-]+-profile@example\.test|\+7-profile/);
});
