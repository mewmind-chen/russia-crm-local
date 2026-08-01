'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

const ROUTE = '/api/sales-crm/activity-corrections';

function seedActivity(db, {
  id,
  customerId,
  userId,
  managerRequired = 0,
} = {}) {
  db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,
     stage_before,stage_after,manager_required,occurred_at,created_at)
    VALUES (?,?,?,'note','manual','recorded','Issue 171 API fixture','','',
      'qualified','qualified',?,'2026-08-01 08:00:00','2026-08-01 08:00:01')`)
    .run(id, customerId, userId, managerRequired);
}

function correctionBody(overrides = {}) {
  return {
    originalActivityId: 'ACT-171-API-DIRECT',
    targetCustomerId: 'CRM-OWN',
    reason: 'API 回归测试：原跟进记录选错客户',
    idempotencyKey: 'issue171-api-direct-1',
    ...overrides,
  };
}

function correctionWriteCounts(db) {
  return {
    activities: db.prepare('SELECT COUNT(*) count FROM crm_activities').get().count,
    corrections: db.prepare('SELECT COUNT(*) count FROM crm_activity_corrections').get().count,
    proposals: db.prepare('SELECT COUNT(*) count FROM crm_activity_correction_proposals').get().count,
    decisions: db.prepare('SELECT COUNT(*) count FROM crm_activity_correction_decisions').get().count,
  };
}

test('Issue 171 API returns 503 and performs zero writes while the hard flag is disabled', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { activityCorrectionsEnabled: false } },
  });
  t.after(() => fx.close());
  seedActivity(fx.db, {
    id: 'ACT-171-API-DISABLED', customerId: 'CRM-WU', userId: 'U-WU',
  });
  const before = correctionWriteCounts(fx.db);

  const response = await fx.request(ROUTE, {
    cookie: fx.cookie,
    method: 'POST',
    body: correctionBody({
      originalActivityId: 'ACT-171-API-DISABLED',
      idempotencyKey: 'issue171-api-disabled-1',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.code, 'ACTIVITY_CORRECTIONS_DISABLED');
  assert.deepEqual(correctionWriteCounts(fx.db), before);
});

test('Issue 171 API completes a direct correction and replays it idempotently', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { activityCorrectionsEnabled: true } },
  });
  t.after(() => fx.close());
  seedActivity(fx.db, {
    id: 'ACT-171-API-DIRECT', customerId: 'CRM-WU', userId: 'U-WU',
  });

  const firstResponse = await fx.request(ROUTE, {
    cookie: fx.cookie, method: 'POST', body: correctionBody(),
  });
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 200, first.error);
  assert.equal(first.correction.originalActivityId, 'ACT-171-API-DIRECT');
  assert.equal(first.correction.sourceCustomerId, 'CRM-WU');
  assert.equal(first.correction.targetCustomerId, 'CRM-OWN');
  assert.equal(first.correction.deduplicated, false);

  const replayResponse = await fx.request(ROUTE, {
    cookie: fx.cookie, method: 'POST', body: correctionBody(),
  });
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200, replay.error);
  assert.equal(replay.correction.correctionId, first.correction.correctionId);
  assert.equal(replay.correction.replacementActivityId, first.correction.replacementActivityId);
  assert.equal(replay.correction.deduplicated, true);
  assert.deepEqual(correctionWriteCounts(fx.db), {
    activities: 2, corrections: 1, proposals: 0, decisions: 0,
  });
});

test('Issue 171 API creates and replays a 202 proposal, enforces review scope, and replays review', async t => {
  const fx = await adminFixture({
    managerViewAll: false,
    appOptions: { salesCrm: { activityCorrectionsEnabled: true } },
  });
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET owner_id='U-MGR' WHERE id='CRM-WU'").run();
  seedActivity(fx.db, {
    id: 'ACT-171-API-PROPOSAL', customerId: 'CRM-OWN', userId: 'U-WU',
  });
  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  const restrictedManagerCookie = await fx.login('wu@example.com', 'Password123!');
  fx.setUserPermissions('U-WU', { view_all_customers: false });
  const request = correctionBody({
    originalActivityId: 'ACT-171-API-PROPOSAL',
    targetCustomerId: 'CRM-WU',
    idempotencyKey: 'issue171-api-proposal-1',
  });

  const proposalResponse = await fx.request(ROUTE, {
    cookie: managerCookie, method: 'POST', body: request,
  });
  const proposalBody = await proposalResponse.json();
  assert.equal(proposalResponse.status, 202, proposalBody.error);
  assert.equal(proposalBody.proposal.status, 'pending');
  assert.equal(proposalBody.proposal.reasonCode, 'OTHER_CREATOR');

  const proposalReplayResponse = await fx.request(ROUTE, {
    cookie: managerCookie, method: 'POST', body: request,
  });
  const proposalReplay = await proposalReplayResponse.json();
  assert.equal(proposalReplayResponse.status, 202, proposalReplay.error);
  assert.equal(proposalReplay.proposal.proposalId, proposalBody.proposal.proposalId);
  assert.equal(proposalReplay.proposal.deduplicated, true);
  assert.equal(correctionWriteCounts(fx.db).proposals, 1);

  const reviewRoute = `/api/sales-crm/activity-correction-proposals/${proposalBody.proposal.proposalId}/review`;
  const review = {
    decision: 'rejected',
    reason: 'API 范围测试拒绝',
    expectedVersion: 1,
    idempotencyKey: 'issue171-api-review-1',
  };
  const denied = await fx.request(reviewRoute, {
    cookie: restrictedManagerCookie, method: 'POST', body: review,
  });
  const deniedBody = await denied.json();
  const unknown = await fx.request(
    '/api/sales-crm/activity-correction-proposals/CORP-NOT-VISIBLE/review',
    { cookie: restrictedManagerCookie, method: 'POST', body: review },
  );
  const unknownBody = await unknown.json();
  assert.equal(denied.status, 403);
  assert.deepEqual(
    { status: denied.status, code: deniedBody.code, error: deniedBody.error },
    { status: unknown.status, code: unknownBody.code, error: unknownBody.error },
  );

  const reviewedResponse = await fx.request(reviewRoute, {
    cookie: managerCookie, method: 'POST', body: review,
  });
  const reviewed = await reviewedResponse.json();
  assert.equal(reviewedResponse.status, 200, reviewed.error);
  assert.equal(reviewed.result.status, 'rejected');
  assert.equal(reviewed.result.deduplicated, false);

  const reviewReplayResponse = await fx.request(reviewRoute, {
    cookie: managerCookie, method: 'POST', body: review,
  });
  const reviewReplay = await reviewReplayResponse.json();
  assert.equal(reviewReplayResponse.status, 200, reviewReplay.error);
  assert.equal(reviewReplay.result.proposalId, reviewed.result.proposalId);
  assert.equal(reviewReplay.result.deduplicated, true);
  assert.deepEqual(correctionWriteCounts(fx.db), {
    activities: 1, corrections: 0, proposals: 1, decisions: 1,
  });
});

test('Issue 171 API returns indistinguishable 403 responses for unscoped data and blocks impersonation', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { activityCorrectionsEnabled: true } },
  });
  t.after(() => fx.close());
  seedActivity(fx.db, {
    id: 'ACT-171-API-UNSCOPED', customerId: 'CRM-OTHER', userId: 'U-OTHER',
  });
  seedActivity(fx.db, {
    id: 'ACT-171-API-IMPERSONATION', customerId: 'CRM-WU', userId: 'USR-ADMIN',
  });
  const request = correctionBody({
    originalActivityId: 'ACT-171-API-UNSCOPED',
    targetCustomerId: 'CRM-WU',
    idempotencyKey: 'issue171-api-unscoped-1',
  });
  const denied = await fx.request(ROUTE, {
    cookie: fx.otherCookie, method: 'POST', body: request,
  });
  const deniedBody = await denied.json();
  const unknown = await fx.request(ROUTE, {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { ...request, originalActivityId: 'ACT-171-API-DOES-NOT-EXIST' },
  });
  const unknownBody = await unknown.json();
  assert.equal(denied.status, 403);
  assert.deepEqual(
    { status: denied.status, code: deniedBody.code, error: deniedBody.error },
    { status: unknown.status, code: unknownBody.code, error: unknownBody.error },
  );

  await fx.startImpersonation('U-WU');
  const before = correctionWriteCounts(fx.db);
  const impersonated = await fx.request(ROUTE, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: correctionBody({
      originalActivityId: 'ACT-171-API-IMPERSONATION',
      idempotencyKey: 'issue171-api-impersonation-1',
    }),
  });
  const impersonatedBody = await impersonated.json();
  assert.equal(impersonated.status, 403);
  assert.equal(impersonatedBody.code, 'IMPERSONATION_ACTION_BLOCKED');
  assert.deepEqual(correctionWriteCounts(fx.db), before);
});

test('Issue 171 read APIs remain available with management-only correction permission', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-MGR', {
    correct_own_activity: false,
    manage_activity_corrections: true,
  });
  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  for (const path of [
    '/api/sales-crm/activity-correction-targets',
    '/api/sales-crm/activity-corrections',
  ]) {
    const response = await fx.request(path, { cookie: managerCookie });
    assert.equal(response.status, 200, `${path}: ${await response.text()}`);
  }
});

test('Issue 171 list APIs enforce authorized filter versions and pagination', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  const pageResponse = await fx.request(
    '/api/sales-crm/activity-correction-targets?page=1&pageSize=1',
    { cookie: managerCookie },
  );
  const page = await pageResponse.json();
  assert.equal(pageResponse.status, 200, page.error);
  assert.equal(page.page, 1);
  assert.equal(page.pageSize, 1);
  assert.ok(page.rows.length <= 1);
  assert.deepEqual(page.customers, page.rows);
  assert.equal(page.schema.pageKey, 'activity_correction_targets');
  assert.equal(typeof page.total, 'number');
  assert.equal(typeof page.authorizedTotal, 'number');

  const stale = await fx.request(
    '/api/sales-crm/activity-corrections?permissionVersion=0',
    { cookie: managerCookie },
  );
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'FILTER_VERSION_CONFLICT');

  const forged = await fx.request(
    '/api/sales-crm/activity-correction-proposals?status=pending',
    { cookie: managerCookie },
  );
  assert.equal(forged.status, 403);
  assert.equal((await forged.json()).code, 'FILTER_NOT_AUTHORIZED');
});

test('Issue 171 manager proposal API exposes only safe revalidated mapping candidates', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { activityCorrectionsEnabled: true } },
  });
  t.after(() => fx.close());
  seedActivity(fx.db, {
    id: 'ACT-171-API-MAPPING', customerId: 'CRM-OWN', userId: 'U-WU',
  });
  fx.db.prepare("UPDATE crm_activities SET activity_type='repeat_order' WHERE id='ACT-171-API-MAPPING'")
    .run();
  fx.db.prepare(`INSERT INTO crm_orders
    (id,customer_id,user_id,activity_id,is_repeat,ordered_at,created_at) VALUES
    ('ORDER-171-API-1','CRM-OWN','U-WU','ACT-171-API-MAPPING',1,
      '2026-08-01 08:00:00','2026-08-01 08:00:00'),
    ('ORDER-171-API-2','CRM-OWN','U-WU','ACT-171-API-MAPPING',1,
      '2026-08-01 08:00:00','2026-08-01 08:00:00'),
    ('ORDER-171-API-OUTSIDE','CRM-OTHER','U-OTHER','ACT-171-API-MAPPING',1,
      '2026-08-01 08:00:00','2026-08-01 08:00:00')`).run();
  fx.db.prepare(`INSERT INTO crm_activity_correction_proposals
    (id,idempotency_key,request_hash,original_activity_id,source_customer_id,
     target_customer_id,source_external_customer_id,target_external_customer_id,
     requester_id,original_creator_id,reason,reason_code,mapping_evidence_json,
     status,version,created_at,updated_at)
    VALUES ('CORP-171-API-MAPPING','issue171-api-mapping','hash-171-api-mapping',
      'ACT-171-API-MAPPING','CRM-OWN','CRM-WU','EXT-OWN','EXT-WU','U-WU','U-WU',
      'API ambiguous mapping','MAPPING_UNCERTAIN',?,'pending',1,
      '2026-08-04 09:00:00','2026-08-04 09:00:00')`)
    .run(JSON.stringify({
      linkedCount: 999,
      rankedCandidates: 'AI_API_SENTINEL',
      ownerId: 'U-OTHER',
      assignmentReason: 'ASSIGNMENT_API_SENTINEL',
    }));

  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  const response = await fx.request('/api/sales-crm/activity-correction-proposals', {
    cookie: managerCookie,
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  const proposal = body.proposals.find(row => row.proposalId === 'CORP-171-API-MAPPING');
  assert.deepEqual(proposal.mappingResolution, {
    required: true,
    available: true,
    evidence: { linkedCount: 2 },
    candidates: [
      { mode: 'activity_only' },
      { mode: 'commerce_entity', entityType: 'order', entityId: 'ORDER-171-API-1' },
      { mode: 'commerce_entity', entityType: 'order', entityId: 'ORDER-171-API-2' },
    ],
  });
  assert.doesNotMatch(JSON.stringify(proposal),
    /ORDER-171-API-OUTSIDE|AI_API_SENTINEL|ASSIGNMENT_API_SENTINEL|ownerId|assignmentReason/);

  const approvedResponse = await fx.request(
    `/api/sales-crm/activity-correction-proposals/${proposal.proposalId}/review`,
    {
      cookie: managerCookie,
      method: 'POST',
      body: {
        decision: 'approved',
        expectedVersion: proposal.version,
        idempotencyKey: 'issue171-api-mapping-review',
        resolution: proposal.mappingResolution.candidates[1],
      },
    },
  );
  const approved = await approvedResponse.json();
  assert.equal(approvedResponse.status, 200, approved.error);
  assert.equal(approved.result.status, 'approved');
  assert.ok(approved.result.correctionId);

  fx.setUserPermissions('U-OTHER', { manage_activity_corrections: true });
  const salesCookie = await fx.login('other@example.com', 'Password123!');
  const denied = await fx.request('/api/sales-crm/activity-correction-proposals', {
    cookie: salesCookie,
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'FILTER_NOT_AUTHORIZED');
});

test('Issue 171 review API returns a rollback-safe conflict when mapping converges after GET', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { activityCorrectionsEnabled: true } },
  });
  t.after(() => fx.close());
  seedActivity(fx.db, {
    id: 'ACT-171-API-MAPPING-CHANGED', customerId: 'CRM-OWN', userId: 'U-WU',
  });
  fx.db.prepare(`UPDATE crm_activities SET activity_type='order'
    WHERE id='ACT-171-API-MAPPING-CHANGED'`).run();
  fx.db.prepare(`INSERT INTO crm_orders
    (id,customer_id,user_id,activity_id,is_repeat,ordered_at,created_at) VALUES
    ('ORDER-171-CHANGED-1','CRM-OWN','U-WU','ACT-171-API-MAPPING-CHANGED',0,
      '2026-08-01 08:00:00','2026-08-01 08:00:00'),
    ('ORDER-171-CHANGED-2','CRM-OWN','U-WU','ACT-171-API-MAPPING-CHANGED',0,
      '2026-08-01 08:00:00','2026-08-01 08:00:00')`).run();
  fx.db.prepare(`INSERT INTO crm_activity_correction_proposals
    (id,idempotency_key,request_hash,original_activity_id,source_customer_id,
     target_customer_id,source_external_customer_id,target_external_customer_id,
     requester_id,original_creator_id,reason,reason_code,mapping_evidence_json,
     status,version,created_at,updated_at)
    VALUES ('CORP-171-API-MAPPING-CHANGED','issue171-api-mapping-changed',
      'hash-171-api-mapping-changed','ACT-171-API-MAPPING-CHANGED','CRM-OWN','CRM-WU',
      'EXT-OWN','EXT-WU','U-WU','U-WU','mapping changes after GET','MAPPING_UNCERTAIN',
      '{}','pending',1,'2026-08-04 10:00:00','2026-08-04 10:00:00')`).run();

  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  const listResponse = await fx.request('/api/sales-crm/activity-correction-proposals', {
    cookie: managerCookie,
  });
  const listBody = await listResponse.json();
  assert.equal(listResponse.status, 200, listBody.error);
  const proposal = listBody.proposals.find(
    row => row.proposalId === 'CORP-171-API-MAPPING-CHANGED',
  );
  assert.equal(proposal.mappingResolution.candidates.length, 3);
  const submittedResolution = proposal.mappingResolution.candidates[1];

  fx.db.prepare("DELETE FROM crm_orders WHERE id='ORDER-171-CHANGED-2'").run();
  const snapshot = () => ({
    counts: correctionWriteCounts(fx.db),
    activity: fx.db.prepare("SELECT * FROM crm_activities WHERE id='ACT-171-API-MAPPING-CHANGED'")
      .get(),
    orders: fx.db.prepare(`SELECT * FROM crm_orders
      WHERE activity_id='ACT-171-API-MAPPING-CHANGED' ORDER BY id`).all(),
    accounts: fx.db.prepare(`SELECT id,stage,last_activity_at,next_action,next_action_at,
      manager_required,manager_status,updated_at FROM crm_accounts
      WHERE id IN ('CRM-OWN','CRM-WU') ORDER BY id`).all(),
    proposal: fx.db.prepare(`SELECT status,version,reviewer_id,review_reason,correction_id,
      reviewed_at,updated_at FROM crm_activity_correction_proposals
      WHERE id='CORP-171-API-MAPPING-CHANGED'`).get(),
  });
  const before = snapshot();
  const reviewResponse = await fx.request(
    `/api/sales-crm/activity-correction-proposals/${proposal.proposalId}/review`,
    {
      cookie: managerCookie,
      method: 'POST',
      body: {
        decision: 'approved',
        expectedVersion: proposal.version,
        idempotencyKey: 'issue171-api-mapping-changed-review',
        resolution: submittedResolution,
      },
    },
  );
  const reviewBody = await reviewResponse.json();
  assert.equal(reviewResponse.status, 409);
  assert.equal(reviewBody.code, 'ACTIVITY_CORRECTION_MAPPING_CHANGED');
  assert.deepEqual(snapshot(), before);
  assert.equal(before.proposal.status, 'pending');
});
