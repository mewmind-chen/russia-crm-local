'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { presentAIResult } = require('../lib/ai_stations/presentation');

const permissions = {
  use_ai_assistant: true,
  view_contacts: true,
  view_recon: true,
  review_ai_tasks: true,
  manage_intake: true,
  record_activity: true,
  edit_customer: true,
};

const values = {
  customer_fit: { grade: 'A', fitScore: 88, reasonCodes: ['PRODUCT_MATCH'], confidence: 0.9 },
  contact_readiness: { readiness: 'partial', contactIds: ['P-1'], reasonCodes: ['EMAIL_UNVERIFIED'], confidence: 0.7 },
  distribution_priority: { priority: 'A', urgency: 90, blockingReasons: [], reasonCodes: ['HIGH_VALUE'], confidence: 0.8 },
  sales_match: { rankedCandidates: [{ employeeId: 7, score: 90, reasons: ['区域匹配'] }], reasonCodes: ['REGION_MATCH'], confidence: 0.82 },
  sales_pack: { summary: '客户需要工业控制芯片', entryPoints: ['从缺货替代切入'], risks: ['联系人待核验'], draft: { body: '您好' }, confidence: 0.77 },
  next_action: { nextAction: '安排需求会议', nextActionAt: '2026-08-01', reason: '客户已回复', confidence: 0.86 },
  manager_anomaly: { anomalyCode: 'RFQ_UNQUOTED', severity: 'warning', explanation: '询价尚未报价', interventionSuggestion: '经理复核报价阻塞', confidence: 0.8 },
  sales_coaching: { sampleSize: 20, strengths: ['回复及时'], gaps: ['询价转化偏低'], recommendations: ['复盘需求会议'], confidence: 0.72 },
  action_proposal: { activityType: 'meeting', outcome: '已完成', summary: '完成需求会议', nextAction: '整理 BOM', nextActionAt: '2026-08-02', confidence: 0.91 },
  enrichment: { proposals: [{ field: 'industry', oldValue: '', newValue: '工业自动化' }], tags: ['资料待确认'], confidence: 0.84 },
};

function presentation(capability, overrides = {}) {
  return presentAIResult({
    job: {
      station: capability,
      finishedAt: '2026-07-26T10:00:00.000Z',
      trigger: {
        source: 'business_event',
        eventType: 'rfq_created',
        eventId: 'RFQ-1',
        actorId: 'U-1',
        reason: '询价创建后生成建议',
        triggeredAt: '2026-07-26T09:59:00.000Z',
      },
    },
    result: {
      value: values[capability],
      generatedAt: '2026-07-26T10:00:00.000Z',
      prompt: 'SECRET PROMPT',
      usage: { total_tokens: 999 },
      cost: 12.3,
    },
    evidence: [{
      id: 'EV-1',
      kind: 'crm',
      summary: '客户提交了工业控制 BOM',
      sourceUrl: 'https://evidence.example/source',
      updatedAt: '2026-07-26T09:00:00.000Z',
    }],
    coverage: {
      state: capability === 'sales_coaching' ? 'limited' : 'partial',
      analyzed: 1,
      total: 3,
      coveredFields: ['公司名称'],
      missingFields: ['已核验联系人'],
      rules: ['关键字段缺失时必须人工复核'],
    },
    permissions,
    ...overrides,
  });
}

test('eight capabilities, action proposal, and enrichment share the fixed business layers', () => {
  const capabilities = [
    'customer_fit', 'contact_readiness', 'distribution_priority', 'sales_match',
    'sales_pack', 'next_action', 'manager_anomaly', 'sales_coaching',
    'action_proposal', 'enrichment',
  ];
  for (const capability of capabilities) {
    const view = presentation(capability);
    assert.equal(view.kind, 'ai_business_result', capability);
    assert.equal(view.badge, 'AI 推断', capability);
    assert.equal(view.facts.title, '来源事实', capability);
    assert.equal(view.rules.title, '确定性规则', capability);
    assert.equal(view.inference.title, 'AI 推断', capability);
    assert.equal(view.humanDecision.title, '人工决定', capability);
    assert.equal(view.systemAction.title, '系统动作', capability);
    assert.ok(view.businessName, capability);
    assert.ok(Array.isArray(view.humanDecision.actions), capability);
    assert.equal(view.trigger.label, '业务事件触发', capability);
    assert.equal(Object.isFrozen(view), true);
  }
});

test('confidence and coverage remain separate and zero denominators show no sample', () => {
  const view = presentation('customer_fit', {
    coverage: {
      state: 'partial',
      metrics: [
        { label: '报价转订单', numerator: 0, denominator: 0 },
        { label: '回复率', numerator: 1, denominator: 4 },
      ],
    },
  });
  assert.equal(view.inference.confidence.label, '较高 · 90%');
  assert.equal(view.inference.coverage.label, '资料部分覆盖');
  assert.equal(view.inference.coverage.metrics[0].displayValue, '暂无样本');
  assert.equal(view.inference.coverage.metrics[1].displayValue, '25.0%');
});

test('sales coaching sample threshold blocks model presentation below ten', () => {
  const view = presentation('sales_coaching', {
    result: { value: { ...values.sales_coaching, sampleSize: 9, confidence: 0.99 } },
    coverage: { sampleSize: 9 },
  });
  assert.equal(view.inference.coverage.state, 'insufficient');
  assert.equal(view.inference.modelEligible, false);
  assert.equal(view.inference.conclusion, '样本不足，不生成 AI 辅导');
  assert.equal(view.inference.confidence.label, '暂无 AI 置信度');
  assert.match(view.rules.items.join(' '), /不调用模型/);
  assert.equal(view.humanDecision.actions.find(action => action.id === 'regenerate').enabled, false);
});

test('restricted evidence never exposes its summary or URL', () => {
  const view = presentation('sales_pack', {
    evidence: [{
      id: 'CONTACT-SECRET',
      kind: 'contact',
      summary: 'secret.person@example.test +7-secret',
      sourceUrl: 'https://secret.example/contact',
    }],
    permissions: { ...permissions, view_contacts: false },
  });
  const serialized = JSON.stringify(view);
  assert.equal(view.facts.restrictedCount, 1);
  assert.equal(view.facts.items[0].summary, '部分依据因权限不可见');
  assert.doesNotMatch(serialized, /secret\.person|secret\.example|\+7-secret|CONTACT-SECRET/);
});

test('business side effects are explicit and stale proposals cannot be adopted', () => {
  const fit = presentation('customer_fit');
  assert.match(fit.systemAction.notPerformed.join(' '), /不改变客户状态/);
  const pack = presentation('sales_pack');
  assert.match(pack.systemAction.notPerformed.join(' '), /绝不自动发送/);
  const anomaly = presentation('manager_anomaly');
  assert.match(anomaly.rules.items.join(' '), /确定性规则/);
  assert.match(anomaly.systemAction.notPerformed.join(' '), /不创建异常/);

  const stale = presentation('next_action', {
    result: { value: values.next_action, stale: true, staleReason: 'customer_changed' },
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.inference.coverage.state, 'stale');
  assert.equal(stale.humanDecision.actions.find(action => action.id === 'adopt').enabled, false);
  assert.equal(stale.humanDecision.actions.find(action => action.id === 'edit_adopt').enabled, false);
  assert.match(stale.rules.items.join(' '), /不可直接采纳/);
});

test('business view model excludes operational AI internals', () => {
  const serialized = JSON.stringify(presentation('action_proposal'));
  assert.doesNotMatch(serialized, /SECRET PROMPT|total_tokens|999|12\.3/);
  assert.doesNotMatch(serialized, /promptVersion|schemaVersion|decisionTrace|fallback|cost/);
});
