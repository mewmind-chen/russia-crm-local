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
