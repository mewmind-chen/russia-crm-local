'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { adminFixture } = require('./helpers/permission_fixture');

test('runtime AI shutdown removes business AI payloads and fails closed while keeping admin controls', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  t.after(() => fx.close());

  const now = '2026-07-27 09:00:00';
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,subject_id,subject_name,subject_title,evaluation_text,
     author_id,author_name,ai_status,ai_summary,ai_labels_json,created_at,updated_at)
    VALUES ('EV-AI-OFF','CRM-OWN','company','','Owned Fixture','','人工评价内容足够长',
      'U-WU','Wu','completed','AI 历史总结','["高潜"]',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO crm_intake_decisions
    (id,intake_item_id,decision_type,actor_id,candidate_snapshot_id,
     ai_recommendation_json,rule_decision_json,manual_decision_json,created_at)
    VALUES ('INTDEC-AI-OFF','INTAKE-OTHER','arbitration','U-WU','SNAP-HIDDEN',
      '{"available":true,"confidence":0.99,"rankedCandidates":[{"userId":"U-OTHER"}]}',
      '{"disposition":"manager_review","managerReview":true,"deterministicUserId":"U-OTHER",
        "aiUserId":"U-WU","source":"rule_conflict","reasonCode":"ranking_rule_conflict",
        "reason":"AI 排名与确定性规则结果冲突，需要经理审批","aiConfidence":0.99}',
      '{}',?)`).run(now);
  fx.db.prepare(`UPDATE crm_intake_items
    SET suggested_owner_id='U-WU',decision_reason='AI 排名与确定性规则结果冲突，需要经理审批'
    WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,wecom_status,created_at)
    VALUES ('NTF-AI-OFF','U-WU','CRM-OWN','SALES_PACK_READY','info',
      '销售资料包已生成','','unread','test:ai-off','disabled',?)`).run(now);
  fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,wecom_status,created_at)
    VALUES ('NTF-AI-TASK-OFF','U-WU','CRM-OWN','AI_TASK_READY','info',
      'AI 任务已完成','','unread','test:ai-task-off','disabled',?)`).run(now);

  await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  fx.db.prepare("UPDATE crm_ai_feature_flags SET enabled=0 WHERE feature_key='ai_stations'").run();

  const capabilities = await fx.requestJson('/api/session/capabilities', { cookie: fx.cookie });
  assert.deepEqual(capabilities.features, { aiStations: false });
  assert.equal(capabilities.modules.includes('assistant'), false);

  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  assert.equal(bootstrap.features.aiStations, false);
  const intake = bootstrap.intake.items.find(item => item.id === 'INTAKE-OTHER');
  assert.ok(intake);
  assert.equal(Object.hasOwn(intake, 'signals'), false);
  assert.equal(Object.hasOwn(intake.arbitration, 'aiRecommendation'), false);
  assert.equal(Object.hasOwn(intake.arbitration, 'candidateSnapshotId'), false);
  assert.equal(Object.hasOwn(intake.assignmentAudit[0], 'aiRecommendation'), false);
  assert.equal(Object.hasOwn(intake, 'suggested_owner_id'), false);
  assert.equal(Object.hasOwn(intake, 'suggested_owner_name'), false);
  assert.equal(Object.hasOwn(intake.arbitration.ruleDecision, 'aiUserId'), false);
  assert.equal(Object.hasOwn(intake.arbitration.ruleDecision, 'aiConfidence'), false);
  assert.doesNotMatch(JSON.stringify(intake), /AI 排名|ranking_rule_conflict|SNAP-HIDDEN/);
  assert.equal(bootstrap.customerEvaluationTags.length, 0);
  const evaluation = bootstrap.insights.evaluations.find(item => item.id === 'EV-AI-OFF');
  assert.ok(evaluation);
  assert.equal(Object.hasOwn(evaluation, 'aiSummary'), false);
  assert.equal(Object.hasOwn(evaluation, 'aiLabels'), false);
  assert.equal(bootstrap.notifications.some(item => item.code === 'SALES_PACK_READY'), false);
  assert.equal(bootstrap.notifications.some(item => item.code === 'AI_TASK_READY'), false);

  const intakePayload = await fx.requestJson('/api/sales-crm/intake', { cookie: fx.cookie });
  const directIntake = intakePayload.items.find(item => item.id === 'INTAKE-OTHER');
  assert.ok(directIntake);
  assert.equal(Object.hasOwn(directIntake, 'signals'), false);
  assert.equal(Object.hasOwn(directIntake.arbitration, 'aiRecommendation'), false);
  assert.equal(Object.hasOwn(directIntake, 'suggested_owner_id'), false);

  const profile = await fx.requestJson('/api/sales-crm/profile/RU-9002', {
    cookie: fx.cookie,
  });
  assert.equal(profile.customerPool[0].tags.some(tag => tag.category === 'AI评价标签'), false);
  assert.equal(profile.tagCategories.includes('AI评价标签'), false);

  const exportedResponse = await fx.request('/api/sales-crm/export', { cookie: fx.adminCookie });
  assert.equal(exportedResponse.status, 200);
  const exported = JSON.parse(await exportedResponse.text());
  const exportedEvaluation = exported.evaluations.find(item => item.id === 'EV-AI-OFF');
  assert.ok(exportedEvaluation);
  assert.equal(Object.keys(exportedEvaluation).some(key => key.startsWith('ai_')), false);

  assert.equal((await fx.request('/api/sales-crm/notifications/NTF-AI-OFF/read', {
    cookie: fx.cookie,
    method: 'POST',
  })).status, 404);
  assert.equal((await fx.request('/api/sales-crm/notifications/NTF-AI-TASK-OFF/read', {
    cookie: fx.cookie,
    method: 'POST',
  })).status, 404);

  for (const route of [
    '/api/assistant/runtime',
    '/api/assistant/conversations',
    '/api/sales-crm/ai/tasks',
    '/api/sales-crm/ai/governance',
  ]) {
    const response = await fx.request(route, { cookie: fx.cookie });
    assert.equal(response.status, 409, route);
    assert.equal((await response.json()).code, 'AI_FEATURE_DISABLED', route);
  }
  assert.equal(
    (await fx.request('/api/assistant/runtime', { cookie: fx.adminCookie })).status,
    200,
  );
  assert.equal(
    (await fx.request('/api/sales-crm/ai/features', { cookie: fx.adminCookie })).status,
    200,
  );

  const created = await fx.requestJson('/api/sales-crm/evaluations', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN',
      subjectType: 'company',
      evaluationText: '这是一条关闭 AI 后仍需保存的人工评价',
    },
  });
  assert.equal(created.ok, true);
  assert.equal(Object.hasOwn(created.evaluation, 'aiStatus'), false);
  assert.equal(
    fx.db.prepare('SELECT ai_status FROM crm_manager_evaluations WHERE id=?')
      .get(created.evaluation.id).ai_status,
    'disabled',
  );

  const retried = await fx.request('/api/sales-crm/evaluations/EV-AI-OFF/retry', {
    cookie: fx.cookie,
    method: 'POST',
  });
  assert.equal(retried.status, 409);
  assert.equal((await retried.json()).code, 'AI_FEATURE_DISABLED');

  fx.db.prepare("UPDATE crm_ai_feature_flags SET enabled=1 WHERE feature_key='ai_stations'").run();
  const restored = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const restoredIntake = restored.intake.items.find(item => item.id === 'INTAKE-OTHER');
  const restoredEvaluation = restored.insights.evaluations.find(item => item.id === 'EV-AI-OFF');
  assert.equal(restored.features.aiStations, true);
  assert.equal(restoredIntake.arbitration.candidateSnapshotId, 'SNAP-HIDDEN');
  assert.equal(restoredIntake.arbitration.aiRecommendation.confidence, 0.99);
  assert.equal(restoredEvaluation.aiSummary, 'AI 历史总结');
  assert.equal(restored.notifications.some(item => item.code === 'SALES_PACK_READY'), false);
  const restoredRecipient = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  assert.equal(restoredRecipient.notifications.some(item => item.code === 'SALES_PACK_READY'), true);

  const restoredProfile = await fx.requestJson('/api/sales-crm/profile/RU-9002', {
    cookie: fx.adminCookie,
  });
  assert.equal(restoredProfile.customerPool[0].tags.some(tag => tag.category === 'AI评价标签'), true);
});
