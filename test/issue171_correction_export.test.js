'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { installActivityCorrectionSchema } = require('../lib/crm_activity_corrections');

const NOW = '2026-08-02 08:00:00';
const ORIGINAL_ID = 'ACT-171-EXPORT-ORIGINAL';
const REPLACEMENT_ID = 'ACT-171-EXPORT-REPLACEMENT';
const CORRECTION_ID = 'CORR-171-EXPORT';
const PROPOSAL_ID = 'PROP-171-EXPORT';
const REVIEWER_ID = 'U-WU';
const FORMULA_REASON = '=HYPERLINK("https://invalid.example","click")';

let fx;
let managerCookie;

function insertActivity(db, row) {
  db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,
     stage_before,stage_after,manager_required,occurred_at,created_at,superseded_at,superseded_by)
    VALUES (@id,@customerId,@userId,'call','phone','answered',@summary,'follow up',
      '2026-08-10 08:00:00','qualified','contacted',0,@occurredAt,@createdAt,@supersededAt,@supersededBy)`)
    .run(row);
}

function insertProposal(db, row) {
  db.prepare(`INSERT INTO crm_activity_correction_proposals
    (id,idempotency_key,request_hash,original_activity_id,source_customer_id,target_customer_id,
     source_external_customer_id,target_external_customer_id,requester_id,original_creator_id,
     reason,reason_code,mapping_evidence_json,status,version,reviewer_id,review_reason,
     correction_id,created_at,reviewed_at,updated_at)
    VALUES (@id,@idempotencyKey,@requestHash,@originalActivityId,@sourceCustomerId,@targetCustomerId,
      @sourceExternalCustomerId,@targetExternalCustomerId,@requesterId,@originalCreatorId,
      @reason,'OTHER_CREATOR','{}','approved',2,@reviewerId,'approved after review',
      @correctionId,@createdAt,@createdAt,@createdAt)`).run(row);
}

function insertCorrection(db, row) {
  db.prepare(`INSERT INTO crm_activity_corrections
    (id,idempotency_key,request_hash,original_activity_id,replacement_activity_id,
     source_customer_id,target_customer_id,source_external_customer_id,target_external_customer_id,
     actor_id,original_creator_id,reviewer_id,reason,proposal_id,milestone_type,
     milestone_source_id,milestone_target_id,mapping_evidence_json,created_at,reviewed_at,decision_reason)
    VALUES (@id,@idempotencyKey,@requestHash,@originalActivityId,@replacementActivityId,
      @sourceCustomerId,@targetCustomerId,@sourceExternalCustomerId,@targetExternalCustomerId,
      @actorId,@originalCreatorId,@reviewerId,@reason,@proposalId,'','','','{}',
      @createdAt,@createdAt,'approved after review')`).run(row);
}

function seedVisibleCorrection(db) {
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,created_at,updated_at)
    VALUES ('CRM-OWN-TARGET','RU-9010','Owned Target Fixture','U-MGR','qualified','claimed',?,?)`)
    .run(NOW, NOW);
  db.prepare(`INSERT INTO customer_pool(customer_id,company_name)
    VALUES ('RU-9010','Owned Target Fixture')`).run();

  insertActivity(db, {
    id: ORIGINAL_ID,
    customerId: 'CRM-OWN',
    userId: 'U-MGR',
    summary: 'misfiled activity retained for audit',
    occurredAt: '2026-07-31 08:00:00',
    createdAt: '2026-07-31 08:00:01',
    supersededAt: NOW,
    supersededBy: REPLACEMENT_ID,
  });
  insertActivity(db, {
    id: REPLACEMENT_ID,
    customerId: 'CRM-OWN-TARGET',
    userId: 'U-MGR',
    summary: 'misfiled activity retained for audit',
    occurredAt: '2026-07-31 08:00:00',
    createdAt: NOW,
    supersededAt: '',
    supersededBy: '',
  });
  const relation = {
    id: PROPOSAL_ID,
    idempotencyKey: 'issue171-export-proposal',
    requestHash: 'issue171-export-proposal-hash',
    originalActivityId: ORIGINAL_ID,
    replacementActivityId: REPLACEMENT_ID,
    sourceCustomerId: 'CRM-OWN',
    targetCustomerId: 'CRM-OWN-TARGET',
    sourceExternalCustomerId: 'RU-9002',
    targetExternalCustomerId: 'RU-9010',
    requesterId: 'U-MGR',
    actorId: 'U-MGR',
    originalCreatorId: 'U-MGR',
    reviewerId: REVIEWER_ID,
    reason: FORMULA_REASON,
    proposalId: PROPOSAL_ID,
    correctionId: CORRECTION_ID,
    createdAt: NOW,
  };
  insertProposal(db, relation);
  insertCorrection(db, {
    ...relation,
    id: CORRECTION_ID,
    idempotencyKey: 'issue171-export-correction',
    requestHash: 'issue171-export-correction-hash',
  });
}

function seedCrossScopeCorrection(db) {
  const originalActivityId = 'ACT-171-CROSS-ORIGINAL';
  const replacementActivityId = 'ACT-171-CROSS-REPLACEMENT';
  insertActivity(db, {
    id: originalActivityId,
    customerId: 'CRM-OWN',
    userId: 'U-MGR',
    summary: 'authorized-side activity',
    occurredAt: '2026-07-30 08:00:00',
    createdAt: '2026-07-30 08:00:01',
    supersededAt: NOW,
    supersededBy: replacementActivityId,
  });
  insertActivity(db, {
    id: replacementActivityId,
    customerId: 'CRM-OTHER',
    userId: 'U-OTHER',
    summary: 'CROSS_SCOPE_SECRET_ACTIVITY',
    occurredAt: '2026-07-30 08:00:00',
    createdAt: NOW,
    supersededAt: '',
    supersededBy: '',
  });
  const relation = {
    id: 'PROP-171-CROSS-SCOPE',
    idempotencyKey: 'issue171-cross-proposal',
    requestHash: 'issue171-cross-proposal-hash',
    originalActivityId,
    replacementActivityId,
    sourceCustomerId: 'CRM-OWN',
    targetCustomerId: 'CRM-OTHER',
    sourceExternalCustomerId: 'RU-9002',
    targetExternalCustomerId: 'RU-9003',
    requesterId: 'U-MGR',
    actorId: 'U-MGR',
    originalCreatorId: 'U-MGR',
    reviewerId: REVIEWER_ID,
    reason: 'CROSS_SCOPE_SECRET_REASON',
    proposalId: 'PROP-171-CROSS-SCOPE',
    correctionId: 'CORR-171-CROSS-SCOPE',
    createdAt: NOW,
  };
  insertProposal(db, relation);
  insertCorrection(db, {
    ...relation,
    id: relation.correctionId,
    idempotencyKey: 'issue171-cross-correction',
    requestHash: 'issue171-cross-correction-hash',
  });
}

async function exportJson(cookie = managerCookie) {
  const response = await fx.request('/api/sales-crm/export', { cookie });
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body);
}

test.before(async () => {
  fx = await fixtures.adminFixture({
    managerViewAll: false,
    appOptions: {
      salesCrm: {
        aiStationsEnabled: false,
        activityCorrectionsEnabled: false,
      },
    },
  });
  installActivityCorrectionSchema(fx.db);
  fx.setUserPermissions('U-MGR', {
    export_data: true,
    view_customers: true,
    view_all_customers: false,
    view_insights: true,
  });
  managerCookie = await fx.login('manager@example.com', 'Password123!');
  seedVisibleCorrection(fx.db);
  seedCrossScopeCorrection(fx.db);
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,subject_id,subject_name,subject_title,evaluation_text,
     author_id,author_name,ai_status,ai_summary,ai_labels_json,created_at,updated_at)
    VALUES ('EV-171-AI-OFF','CRM-OWN','company','','Owned Fixture','','human evaluation',
      'U-MGR','Manager','completed','AI_EXPORT_SECRET','["AI_EXPORT_SECRET_LABEL"]',?,?)`)
    .run(NOW, NOW);
});

test.after(async () => {
  if (fx) await fx.close();
});

test('Issue 171 JSON export advances its schema and publishes correction audit datasets', async () => {
  const payload = await exportJson();
  assert.equal(payload.schemaVersion, 3);
  assert.ok(Array.isArray(payload.activityCorrections), 'activityCorrections must be exported');
  assert.ok(Array.isArray(payload.activityCorrectionProposals),
    'activityCorrectionProposals must be exported');
});

test('Issue 171 JSON export includes stable relation and effective-state fields', async () => {
  const payload = await exportJson();
  const correction = payload.activityCorrections?.find(row => row.correctionId === CORRECTION_ID);
  assert.ok(correction, 'authorized correction history is missing');
  assert.deepEqual({
    correctionId: correction.correctionId,
    originalActivityId: correction.originalActivityId,
    replacementActivityId: correction.replacementActivityId,
    proposalId: correction.proposalId,
    reviewerId: correction.reviewerId,
  }, {
    correctionId: CORRECTION_ID,
    originalActivityId: ORIGINAL_ID,
    replacementActivityId: REPLACEMENT_ID,
    proposalId: PROPOSAL_ID,
    reviewerId: REVIEWER_ID,
  });
  const proposal = payload.activityCorrectionProposals
    ?.find(row => row.proposalId === PROPOSAL_ID);
  assert.ok(proposal, 'authorized proposal history is missing');
  assert.equal(proposal.reviewerId, REVIEWER_ID);
  assert.equal(proposal.correctionId, CORRECTION_ID);

  const original = payload.activities.find(row => row.id === ORIGINAL_ID);
  const replacement = payload.activities.find(row => row.id === REPLACEMENT_ID);
  assert.ok(original);
  assert.ok(replacement);
  for (const row of [original, replacement]) {
    assert.equal(row.correctionId, CORRECTION_ID);
    assert.equal(row.originalActivityId, ORIGINAL_ID);
    assert.equal(row.replacementActivityId, REPLACEMENT_ID);
    assert.equal(row.proposalId, PROPOSAL_ID);
    assert.equal(row.reviewerId, REVIEWER_ID);
  }
  assert.equal(original.effective, false);
  assert.equal(replacement.effective, true);
});

test('Issue 171 export requires both relation endpoints to be inside authorized scope', async () => {
  const payload = await exportJson();
  const serialized = JSON.stringify(payload);
  for (const secret of [
    'CRM-OTHER',
    'RU-9003',
    'Other Fixture',
    'CORR-171-CROSS-SCOPE',
    'PROP-171-CROSS-SCOPE',
    'CROSS_SCOPE_SECRET_REASON',
    'CROSS_SCOPE_SECRET_ACTIVITY',
  ]) {
    assert.equal(serialized.includes(secret), false, `cross-scope export leaked ${secret}`);
  }
  assert.ok(Array.isArray(payload.activityCorrections),
    'activityCorrections must exist before scope can be verified');
  assert.ok(Array.isArray(payload.activityCorrectionProposals),
    'activityCorrectionProposals must exist before scope can be verified');
  assert.deepEqual(payload.activityCorrections.map(row => row.correctionId), [CORRECTION_ID]);
  assert.deepEqual(payload.activityCorrectionProposals.map(row => row.proposalId), [PROPOSAL_ID]);
});

test('Issue 171 activity CSV adds correction audit columns', async () => {
  const response = await fx.request('/api/sales-crm/export?format=csv&dataset=activities', {
    cookie: managerCookie,
  });
  assert.equal(response.status, 200);
  const csv = await response.text();
  const header = csv.slice(0, csv.indexOf('\r\n'));
  for (const column of [
    '更正ID', '原活动ID', '替代活动ID', '审批申请ID', '审批人ID', '有效状态', '更正原因',
  ]) {
    assert.equal(header.includes(column), true, `CSV header is missing ${column}`);
  }
  assert.match(csv, new RegExp(CORRECTION_ID));
  assert.match(csv, new RegExp(ORIGINAL_ID));
  assert.match(csv, new RegExp(REPLACEMENT_ID));
  assert.match(csv, new RegExp(PROPOSAL_ID));
  assert.match(csv, new RegExp(REVIEWER_ID));
});

test('Issue 171 CSV protects formula-like correction reasons', async () => {
  const response = await fx.request('/api/sales-crm/export?format=csv&dataset=activities', {
    cookie: managerCookie,
  });
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.equal(csv.includes('"=HYPERLINK'), false, 'formula reason was exported without a quote prefix');
  assert.equal(csv.includes('"\'=HYPERLINK'), true, 'formula reason must be prefixed with a single quote');
});

test('disabled correction writes still allow authorized historical exports', async () => {
  const payload = await exportJson();
  assert.ok(Array.isArray(payload.activityCorrections),
    'historical corrections must remain exportable while writes are disabled');
  assert.ok(Array.isArray(payload.activityCorrectionProposals),
    'historical proposals must remain exportable while writes are disabled');
  assert.equal(payload.activityCorrections.some(row => row.correctionId === CORRECTION_ID), true);
  assert.equal(payload.activityCorrectionProposals.some(row => row.proposalId === PROPOSAL_ID), true);
});

test('AI-off export keeps correction history while omitting AI fields and values', async () => {
  const payload = await exportJson();
  const evaluation = payload.evaluations.find(row => row.id === 'EV-171-AI-OFF');
  assert.ok(evaluation);
  assert.equal(Object.keys(evaluation).some(key => /^ai_/i.test(key)), false);
  const serialized = JSON.stringify({
    corrections: payload.activityCorrections,
    proposals: payload.activityCorrectionProposals,
    evaluation,
  });
  assert.doesNotMatch(serialized, /AI_EXPORT_SECRET/);
  assert.ok(Array.isArray(payload.activityCorrections),
    'AI-off must not remove the non-AI correction history dataset');
  assert.equal(payload.activityCorrections.some(row => row.correctionId === CORRECTION_ID), true);
});

test('Issue 171 export remains forbidden without export_data permission', async () => {
  const response = await fx.request('/api/sales-crm/export', { cookie: fx.otherCookie });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: '没有权限：export_data',
  });
});
