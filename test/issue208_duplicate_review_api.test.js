'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { adminFixture } = require('./helpers/permission_fixture');
const { findFuzzyDuplicateCandidates } = require('../lib/ai_stations/enrichment/dedupe');

function seedReview(fx, {
  id, intakeId, companyName, website, candidateId = 'RU-9002', candidateAccountId = 'CRM-OWN',
}) {
  const at = '2026-08-04 08:00:00';
  fx.db.prepare(`INSERT INTO crm_duplicate_reviews
    (id,target_type,target_id,fingerprint,submitted_by,input_json,candidates_json,status,created_at,updated_at)
    VALUES (?,?,?,'fingerprint','U-OTHER',?,?,'pending',?,?)`).run(
    id, 'intake_item', intakeId,
    JSON.stringify({ companyName, website, country: 'Brazil', city: '', industry: 'Industrial electronics' }),
    JSON.stringify([{
      customerId: candidateId, crmAccountId: candidateAccountId, companyName: 'DBTEC',
      matchedBy: 'fuzzy_domain', score: 0.75,
    }]), at, at,
  );
  fx.db.prepare(`UPDATE crm_intake_items SET company_name=?,website=?,country='Brazil',
      industry='Industrial electronics',status='pending',assigned_owner_id='',duplicate_state='review',
      duplicate_review_id=?,decision_reason='资料已提交管理层核验',updated_at=? WHERE id=?`)
    .run(companyName, website, id, at, intakeId);
}

test('legacy distinct approvals retain the original hostname fingerprint contract', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true });
  fx.db.prepare(`UPDATE customer_pool SET country='Germany',city='Dresden',industry='Precision motion control'
    WHERE customer_id='RU-9002'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET country='Germany',city='Dresden',industry='Precision motion control'
    WHERE id='CRM-OWN'`).run();
  const input = {
    companyName: 'Owned Fixturex',
    website: 'https://shop.legacy-approved.co.uk/path',
    country: 'Germany', city: 'Dresden', industry: 'Precision motion control',
  };
  assert.equal(findFuzzyDuplicateCandidates(fx.db, input, { crmOnly: true, threshold: 0.72 })[0].customerId, 'RU-9002');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    companyName: 'owned fixturex',
    domain: 'shop.legacy-approved.co.uk',
    country: '德国',
  })).digest('hex');
  const at = '2026-08-04 08:00:00';
  fx.db.prepare(`INSERT INTO crm_duplicate_reviews
    (id,target_type,target_id,fingerprint,submitted_by,input_json,candidates_json,status,
     created_rule_version,evaluated_rule_version,reviewed_by,reviewed_at,created_at,updated_at)
    VALUES ('DUPREV-208-LEGACY-FP','manual_customer','',?,'U-OTHER',?,'[]','confirmed_distinct',
      'legacy-v1','legacy-v1','USR-ADMIN',?,?,?)`).run(fingerprint, JSON.stringify(input), at, at, at);

  const response = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.otherCookie, method: 'POST', body: {
      ...input, duplicateReviewId: 'DUPREV-208-LEGACY-FP', idempotencyKey: 'legacy-subdomain-approved',
    },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.deepEqual(fx.db.prepare(`SELECT created_account_id,created_external_customer_id
    FROM crm_duplicate_reviews WHERE id='DUPREV-208-LEGACY-FP'`).get(), {
    created_account_id: body.customerId,
    created_external_customer_id: body.externalCustomerId,
  });
});

test('duplicate review APIs hydrate, search, replace and require an explicit same candidate', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE customer_pool SET nickname='Owned Alpha',website='https://owned.example',
    country='Germany',city='Dresden',industry='Precision motion control' WHERE customer_id='RU-9002'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET nickname='Owned Alpha',website='https://owned.example',
    country='Germany',city='Dresden',industry='Precision motion control' WHERE id='CRM-OWN'`).run();
  seedReview(fx, {
    id: 'DUPREV-208-A', intakeId: 'INTAKE-OTHER', companyName: 'WTECK', website: 'https://wteck.com.br',
  });

  const listed = await fx.request('/api/sales-crm/duplicate-reviews', { cookie: fx.adminCookie });
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  assert.equal(listedBody.total, 1);
  assert.equal(listedBody.reviews[0].input.website, 'https://wteck.com.br');
  assert.equal(listedBody.reviews[0].selectedCandidate.website, 'https://owned.example');
  assert.equal(listedBody.reviews[0].selectedCandidate.ownerName, 'Manager');

  for (const query of ['Owned Fixture', 'Owned Alpha', 'owned.example', 'RU-9002']) {
    const response = await fx.request(`/api/sales-crm/duplicate-reviews/DUPREV-208-A/candidates?q=${encodeURIComponent(query)}`, {
      cookie: fx.adminCookie,
    });
    assert.equal(response.status, 200, query);
    assert.equal((await response.json()).candidates[0].customerId, 'RU-9002', query);
  }

  const changed = await fx.request('/api/sales-crm/duplicate-reviews/DUPREV-208-A/candidate', {
    cookie: fx.adminCookie, method: 'PATCH', body: { customerId: 'RU-9003' },
  });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).review.selectedCandidate.customerId, 'RU-9003');
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE action='duplicate_review_candidate_changed' AND entity_id='DUPREV-208-A'`).get().count, 1);

  const recalculated = await fx.request('/api/sales-crm/duplicate-reviews/recalculate', {
    cookie: fx.adminCookie, method: 'POST', body: { reviewIds: ['DUPREV-208-A'] },
  });
  assert.equal(recalculated.status, 200);
  assert.deepEqual(await recalculated.json().then(body => ({
    releasedCount: body.releasedCount, retainedCount: body.retainedCount,
  })), { releasedCount: 0, retainedCount: 1 });
  const afterRecalculation = await fx.request('/api/sales-crm/duplicate-reviews', { cookie: fx.adminCookie });
  assert.equal((await afterRecalculation.json()).reviews[0].selectedCandidate.customerId, 'RU-9003');

  const missingCandidate = await fx.request('/api/sales-crm/duplicate-reviews/DUPREV-208-A/resolve', {
    cookie: fx.adminCookie, method: 'POST', body: { resolution: 'confirmed_same' },
  });
  assert.equal(missingCandidate.status, 400);
  assert.equal(fx.db.prepare("SELECT status FROM crm_duplicate_reviews WHERE id='DUPREV-208-A'").get().status, 'pending');

  const staleCandidate = await fx.request('/api/sales-crm/duplicate-reviews/DUPREV-208-A/resolve', {
    cookie: fx.adminCookie, method: 'POST',
    body: { resolution: 'confirmed_same', candidateCustomerId: 'RU-9002' },
  });
  assert.equal(staleCandidate.status, 409);
  assert.equal((await staleCandidate.json()).code, 'DUPLICATE_CANDIDATE_CHANGED');

  const resolved = await fx.request('/api/sales-crm/duplicate-reviews/DUPREV-208-A/resolve', {
    cookie: fx.adminCookie, method: 'POST',
    body: { resolution: 'confirmed_same', candidateCustomerId: 'RU-9003' },
  });
  assert.equal(resolved.status, 200);
  assert.deepEqual(fx.db.prepare(`SELECT status,crm_customer_id,duplicate_state FROM crm_intake_items
    WHERE id='INTAKE-OTHER'`).get(), {
    status: 'duplicate', crm_customer_id: 'CRM-OTHER', duplicate_state: 'exact',
  });
});

test('bulk distinct is the only bulk decision and releases all rows transactionally', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const at = '2026-08-04 08:00:00';
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-208-B','BATCH-TEST','BR-208-B','Jawa-tec','pending','',?,?)`).run(at, at);
  seedReview(fx, {
    id: 'DUPREV-208-A', intakeId: 'INTAKE-OTHER', companyName: 'WTECK', website: 'https://wteck.com.br',
  });
  seedReview(fx, {
    id: 'DUPREV-208-B', intakeId: 'INTAKE-208-B', companyName: 'Jawa-tec', website: 'https://jawa-tec.com.br',
  });

  const rejectedSame = await fx.request('/api/sales-crm/duplicate-reviews/bulk-distinct', {
    cookie: fx.adminCookie, method: 'POST',
    body: { reviewIds: ['DUPREV-208-A', 'DUPREV-208-B'], resolution: 'confirmed_same' },
  });
  assert.equal(rejectedSame.status, 400);

  const response = await fx.request('/api/sales-crm/duplicate-reviews/bulk-distinct', {
    cookie: fx.adminCookie, method: 'POST',
    body: { reviewIds: ['DUPREV-208-A', 'DUPREV-208-B'] },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).resolvedCount, 2);
  assert.deepEqual(fx.db.prepare(`SELECT id,status,duplicate_state FROM crm_intake_items
    WHERE id IN ('INTAKE-OTHER','INTAKE-208-B') ORDER BY id`).all(), [
    { id: 'INTAKE-208-B', status: 'approved', duplicate_state: 'cleared' },
    { id: 'INTAKE-OTHER', status: 'approved', duplicate_state: 'cleared' },
  ]);
});

test('bulk distinct rolls back every review and audit when one target is stale', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const at = '2026-08-04 08:00:00';
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-208-ROLLBACK','BATCH-TEST','BR-208-ROLLBACK','Rollback Two','pending','',?,?)`).run(at, at);
  seedReview(fx, {
    id: 'DUPREV-208-ROLLBACK-A', intakeId: 'INTAKE-OTHER', companyName: 'Rollback One', website: '',
  });
  seedReview(fx, {
    id: 'DUPREV-208-ROLLBACK-B', intakeId: 'INTAKE-208-ROLLBACK', companyName: 'Rollback Two', website: '',
  });
  fx.db.prepare("UPDATE crm_intake_items SET duplicate_state='cleared' WHERE id='INTAKE-208-ROLLBACK'").run();
  const auditBefore = fx.db.prepare('SELECT COUNT(*) count FROM crm_audit_log').get().count;

  const response = await fx.request('/api/sales-crm/duplicate-reviews/bulk-distinct', {
    cookie: fx.adminCookie, method: 'POST',
    body: { reviewIds: ['DUPREV-208-ROLLBACK-A', 'DUPREV-208-ROLLBACK-B'] },
  });
  assert.equal(response.status, 409);
  assert.deepEqual(fx.db.prepare(`SELECT id,status FROM crm_duplicate_reviews
    WHERE id LIKE 'DUPREV-208-ROLLBACK-%' ORDER BY id`).all(), [
    { id: 'DUPREV-208-ROLLBACK-A', status: 'pending' },
    { id: 'DUPREV-208-ROLLBACK-B', status: 'pending' },
  ]);
  assert.equal(fx.db.prepare("SELECT duplicate_state FROM crm_intake_items WHERE id='INTAKE-OTHER'").get().duplicate_state, 'review');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_audit_log').get().count, auditBefore);
});

test('rule recalculation releases legacy domain false positives without changing customer masters', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE customer_pool SET company_name='DBTEC',website='https://dbtec.com.br',
    country='Brazil',industry='Industrial electronics' WHERE customer_id='RU-9002'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET company_name='DBTEC',website='https://dbtec.com.br',
    country='Brazil',industry='Industrial electronics' WHERE id='CRM-OWN'`).run();
  const falsePositives = [
    ['WTECK', 'https://wteck.com.br'],
    ['Jawa-tec', 'https://jawa-tec.com.br'],
    ['Kalatec', 'https://kalatec.com.br'],
    ['Pyrotec', 'https://pyrotec.com.br'],
    ['Unitek', 'https://unitek.com.br'],
    ['Vaportec', 'https://vaportec.com.br'],
    ['ECNC', 'https://ecnc.com.br'],
  ];
  const at = '2026-08-04 08:00:00';
  falsePositives.forEach(([companyName, website], index) => {
    const intakeId = index === 0 ? 'INTAKE-OTHER' : `INTAKE-208-LEGACY-${index}`;
    if (index > 0) fx.db.prepare(`INSERT INTO crm_intake_items
      (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
      VALUES (?,'BATCH-TEST',?,?,'pending','',?,?)`)
      .run(intakeId, `BR-208-${index}`, companyName, at, at);
    seedReview(fx, {
      id: `DUPREV-208-LEGACY-${index}`, intakeId, companyName, website,
    });
  });
  const beforePool = fx.db.prepare('SELECT * FROM customer_pool ORDER BY customer_id').all();
  const beforeAccounts = fx.db.prepare('SELECT * FROM crm_accounts ORDER BY id').all();

  const response = await fx.request('/api/sales-crm/duplicate-reviews/recalculate', {
    cookie: fx.adminCookie, method: 'POST', body: {},
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.releasedCount, 7);
  assert.equal(body.retainedCount, 0);
  assert.match(body.runId, /^DUPRECALC-/);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_duplicate_reviews
    WHERE id LIKE 'DUPREV-208-LEGACY-%' AND status='confirmed_distinct'
      AND evaluated_rule_version='duplicate-v2' AND resolution_source='rule_recalculation'`).get().count, 7);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_intake_items
    WHERE (id='INTAKE-OTHER' OR id LIKE 'INTAKE-208-LEGACY-%')
      AND status='approved' AND duplicate_state='cleared'`).get().count, 7);
  assert.deepEqual(fx.db.prepare('SELECT * FROM customer_pool ORDER BY customer_id').all(), beforePool);
  assert.deepEqual(fx.db.prepare('SELECT * FROM crm_accounts ORDER BY id').all(), beforeAccounts);
});

test('rule recalculation retains protected exact matches without leaking or permitting release', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const at = '2026-08-04 08:00:00';
  fx.db.prepare("INSERT INTO customer_pool(customer_id,company_name,website) VALUES ('BR-9208','Protected Official','https://protected-208.example')").run();
  fx.db.prepare(`INSERT INTO crm_protected_customer_batches
    (batch_id,idempotency_key,input_hash,status,created_by,created_at,committed_at)
    VALUES ('PCB-208','issue-208-protected','hash-208','committed','USR-ADMIN',?,?)`).run(at, at);
  fx.db.prepare(`INSERT INTO crm_protected_customers
    (external_customer_id,normalized_name,alpha_nickname,batch_id,status,created_by,created_at,updated_at)
    VALUES ('BR-9208','protected official','ALPHA-208-SECRET','PCB-208','protected','USR-ADMIN',?,?)`).run(at, at);
  seedReview(fx, {
    id: 'DUPREV-208-PROTECTED', intakeId: 'INTAKE-OTHER',
    companyName: 'Submitted Protected Match', website: 'https://www.protected-208.example/contact',
  });
  fx.db.prepare(`UPDATE crm_duplicate_reviews
    SET selected_by='USR-ADMIN',selected_customer_id='RU-9002',selected_candidate_json=?
    WHERE id='DUPREV-208-PROTECTED'`).run(JSON.stringify({
    customerId: 'RU-9002', crmAccountId: 'CRM-OWN', companyName: 'DBTEC', matchedBy: 'manual',
  }));

  const response = await fx.request('/api/sales-crm/duplicate-reviews/recalculate', {
    cookie: fx.adminCookie, method: 'POST', body: { reviewIds: ['DUPREV-208-PROTECTED'] },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json().then(body => ({
    examinedCount: body.examinedCount, releasedCount: body.releasedCount, retainedCount: body.retainedCount,
  })), { examinedCount: 1, releasedCount: 0, retainedCount: 1 });
  assert.deepEqual(fx.db.prepare(`SELECT status,duplicate_state FROM crm_intake_items
    WHERE id='INTAKE-OTHER'`).get(), { status: 'pending', duplicate_state: 'review' });
  const recalculated = fx.db.prepare(`SELECT selected_customer_id,selected_candidate_json,current_candidates_json
    FROM crm_duplicate_reviews WHERE id='DUPREV-208-PROTECTED'`).get();
  assert.equal(recalculated.selected_customer_id, '');
  assert.deepEqual(JSON.parse(recalculated.selected_candidate_json), {});
  assert.deepEqual(JSON.parse(recalculated.current_candidates_json), [{
    isProtected: true, exact: true, matchedBy: 'domain', ruleVersion: 'duplicate-v2',
  }]);

  const listed = await fx.request('/api/sales-crm/duplicate-reviews', { cookie: fx.adminCookie });
  const listedText = await listed.text();
  assert.equal(listedText.includes('ALPHA-208-SECRET'), false);
  assert.equal(listedText.includes('BR-9208'), false);
  const review = JSON.parse(listedText).reviews.find(item => item.id === 'DUPREV-208-PROTECTED');
  assert.equal(review.protectedExact, true);
  assert.equal(review.selectedCandidate, null);

  const release = await fx.request('/api/sales-crm/duplicate-reviews/DUPREV-208-PROTECTED/resolve', {
    cookie: fx.adminCookie, method: 'POST', body: { resolution: 'confirmed_distinct' },
  });
  assert.equal(release.status, 409);
  assert.equal((await release.json()).code, 'DUPLICATE_PROTECTED_EXACT');
});

test('rule recalculation excludes the intake item own stable customer identity', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_intake_items SET external_customer_id='RU-9002' WHERE id='INTAKE-OTHER'").run();
  seedReview(fx, {
    id: 'DUPREV-208-SELF', intakeId: 'INTAKE-OTHER', companyName: 'Owned Fixture', website: '',
  });

  const response = await fx.request('/api/sales-crm/duplicate-reviews/recalculate', {
    cookie: fx.adminCookie, method: 'POST', body: { reviewIds: ['DUPREV-208-SELF'] },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json().then(body => ({
    releasedCount: body.releasedCount, retainedCount: body.retainedCount,
  })), { releasedCount: 1, retainedCount: 0 });
});

test('claim rechecks all available identity evidence before creating a CRM account', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_intake_items SET company_name='Alpha Industry Systems',country='Germany',
    industry='Motion Control',customer_type='Manufacturer',status='assigned',assigned_owner_id='U-OTHER',
    duplicate_state='' WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`INSERT INTO customer_pool
    (customer_id,company_name,country,city,nickname,industry,customer_type)
    VALUES ('DE-9005','Alpha Industrial Systems','Germany','Dresden','Alpha IS','Motion Control','Manufacturer')`).run();
  fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,country,city,industry,customer_type,owner_id,stage,assignment_status,created_at,updated_at)
    VALUES ('CRM-RACE','DE-9005','Alpha Industrial Systems','Germany','Dresden','Motion Control','Manufacturer',
      'U-MGR','qualified','claimed','2026-08-04 08:00:00','2026-08-04 08:00:00')`).run();

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie, method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-OTHER', idempotencyKey: 'claim-evidence-recheck' },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'DUPLICATE_REVIEW_REQUIRED');
  assert.deepEqual(fx.db.prepare(`SELECT status,duplicate_state,crm_customer_id
    FROM crm_intake_items WHERE id='INTAKE-OTHER'`).get(), {
    status: 'pending', duplicate_state: 'review', crm_customer_id: '',
  });
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_accounts
    WHERE company_name='Alpha Industry Systems'`).get().count, 0);
});

test('rule recalculation rejects malformed, duplicate and oversized explicit review IDs', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  for (const reviewIds of [
    'DUPREV-208-X',
    [],
    ['DUPREV-208-X', 'DUPREV-208-X'],
    Array.from({ length: 101 }, (_, index) => `DUPREV-208-${index}`),
  ]) {
    const response = await fx.request('/api/sales-crm/duplicate-reviews/recalculate', {
      cookie: fx.adminCookie, method: 'POST', body: { reviewIds },
    });
    assert.equal(response.status, 400, JSON.stringify(reviewIds).slice(0, 120));
  }
});

test('sales receive no review payload and impersonation blocks every duplicate mutation', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedReview(fx, {
    id: 'DUPREV-208-SEC', intakeId: 'INTAKE-OTHER',
    companyName: 'PRIVATE-SUBMISSION', website: 'https://private-submission.example',
  });

  const bootstrap = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  assert.equal(bootstrap.status, 200);
  const bootstrapText = await bootstrap.text();
  assert.equal(bootstrapText.includes('duplicateReviews'), false);
  for (const sentinel of ['PRIVATE-SUBMISSION', 'Owned Fixture', 'RU-9002', 'U-MGR']) {
    assert.equal(bootstrapText.includes(sentinel), false, sentinel);
  }

  for (const [route, method, body] of [
    ['/api/sales-crm/duplicate-reviews', 'GET'],
    ['/api/sales-crm/duplicate-reviews/DUPREV-208-SEC/candidates?q=Owned', 'GET'],
    ['/api/sales-crm/duplicate-reviews/DUPREV-208-SEC/candidate', 'PATCH', { customerId: 'RU-9003' }],
    ['/api/sales-crm/duplicate-reviews/DUPREV-208-SEC/resolve', 'POST', { resolution: 'confirmed_distinct' }],
    ['/api/sales-crm/duplicate-reviews/bulk-distinct', 'POST', { reviewIds: ['DUPREV-208-SEC'] }],
    ['/api/sales-crm/duplicate-reviews/recalculate', 'POST', {}],
  ]) {
    const response = await fx.request(route, { cookie: fx.otherCookie, method, body });
    assert.equal(response.status, 403, `${method} ${route}`);
    const text = await response.text();
    assert.equal(text.includes('PRIVATE-SUBMISSION'), false);
    assert.equal(text.includes('Owned Fixture'), false);
  }

  await fx.startImpersonation('U-MGR');
  for (const [route, method, body] of [
    ['/api/sales-crm/duplicate-reviews/DUPREV-208-SEC/candidate', 'PATCH', { customerId: 'RU-9003' }],
    ['/api/sales-crm/duplicate-reviews/DUPREV-208-SEC/resolve', 'POST', { resolution: 'confirmed_distinct' }],
    ['/api/sales-crm/duplicate-reviews/bulk-distinct', 'POST', { reviewIds: ['DUPREV-208-SEC'] }],
    ['/api/sales-crm/duplicate-reviews/recalculate', 'POST', {}],
  ]) {
    const response = await fx.request(route, { cookie: fx.adminCookie, method, body });
    assert.equal(response.status, 403, `${method} ${route}`);
    assert.equal((await response.json()).code, 'IMPERSONATION_ACTION_BLOCKED');
  }
  assert.equal(fx.db.prepare("SELECT status FROM crm_duplicate_reviews WHERE id='DUPREV-208-SEC'").get().status, 'pending');
});
