'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const permissionFixtures = require('./helpers/permission_fixture');

test('intake bootstrap exposes arbitration layers and keeps manual assignment history', async t => {
  const fx = await permissionFixtures.seededFixture();
  t.after(() => fx.close());

  fx.db.prepare(`INSERT INTO crm_intake_decisions
    (id,intake_item_id,decision_type,actor_id,candidate_snapshot_id,ai_recommendation_json,rule_decision_json,manual_decision_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    'DECISION-ARBITRATION',
    'INTAKE-OTHER',
    'arbitration',
    'system',
    'SNAPSHOT-1',
    JSON.stringify({
      available: true,
      confidence: 0.88,
      rankedCandidates: [{ userId: 'U-OTHER', name: 'Other', score: 92, reasons: ['country_match'] }],
    }),
    JSON.stringify({
      disposition: 'manager_review',
      reason: '需要经理审批',
      reasonCode: 'high_value_review',
      deterministicUserId: 'U-OTHER',
    }),
    '{}',
    '2026-07-21 08:01:00',
  );

  const bootstrap = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  assert.equal(bootstrap.status, 200);
  const body = await bootstrap.json();
  const item = body.intake.items.find(row => row.id === 'INTAKE-OTHER');
  assert.ok(item);
  assert.equal(item.arbitration.candidateSnapshotId, 'SNAPSHOT-1');
  assert.deepEqual(item.arbitration.aiRecommendation.rankedCandidates, []);
  assert.equal(item.arbitration.ruleDecision.reasonCode, 'high_value_review');
  assert.equal(item.assignmentAudit.length, 1);

  const action = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.cookie,
    method: 'POST',
    body: { action: 'reassign', itemId: 'INTAKE-OTHER', ownerId: 'U-OTHER', reason: '经理确认分配' },
  });
  assert.equal(action.status, 200);
  const manual = fx.db.prepare(`SELECT * FROM crm_intake_decisions
    WHERE intake_item_id=? AND decision_type='manual' ORDER BY created_at DESC,id DESC LIMIT 1`).get('INTAKE-OTHER');
  assert.ok(manual);
  assert.equal(manual.actor_id, 'U-WU');
  assert.equal(JSON.parse(manual.manual_decision_json).ownerId, 'U-OTHER');
  assert.equal(manual.candidate_snapshot_id, 'SNAPSHOT-1');
});
