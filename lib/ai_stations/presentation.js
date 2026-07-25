'use strict';

const SOURCE_LABELS = Object.freeze({
  manual: '人工发起',
  business_event: '业务事件触发',
  workflow: '受控工作流触发',
  schedule: '定时规则触发',
  api: 'API 请求触发',
  migration: '数据迁移触发',
  release_validation: '上线验收触发',
  legacy_unknown: '来源未记录',
});

const COVERAGE_LABELS = Object.freeze({
  none: '无依据',
  insufficient: '样本不足',
  limited: '有限样本',
  sufficient: '样本充分',
  covered: '资料已覆盖',
  partial: '资料部分覆盖',
  stale: '已过期',
});

const ACTION_LABELS = Object.freeze({
  view_evidence: '查看依据',
  regenerate: '重新生成',
  adopt: '采纳',
  edit_adopt: '修改后采纳',
  reject: '拒绝',
  review: '进入人工复核',
  copy: '复制草稿',
  close: '关闭',
});

const CAPABILITIES = Object.freeze({
  customer_fit: Object.freeze({
    businessName: '是否值得优先开发',
    permission: '',
    actionIds: ['view_evidence', 'regenerate', 'close'],
    onConfirm: [],
    notPerformed: ['不改变客户状态', '不改变客户分组', '不更换负责人'],
  }),
  contact_readiness: Object.freeze({
    businessName: '是否具备可联系条件',
    permission: 'review_ai_tasks',
    actionIds: ['view_evidence', 'regenerate', 'review', 'reject', 'close'],
    onConfirm: ['进入人工联系人复核'],
    notPerformed: ['不自动认定联系人有效', '不自动外发消息'],
  }),
  distribution_priority: Object.freeze({
    businessName: '哪些线索应先分配',
    permission: 'manage_intake',
    actionIds: ['view_evidence', 'regenerate', 'adopt', 'edit_adopt', 'reject', 'close'],
    onConfirm: ['按经理确认结果更新线索优先级'],
    notPerformed: ['确认前不分配线索', '确认前不改变优先级'],
  }),
  sales_match: Object.freeze({
    businessName: '更适合由谁跟进',
    permission: 'manage_intake',
    actionIds: ['view_evidence', 'regenerate', 'adopt', 'edit_adopt', 'reject', 'close'],
    onConfirm: ['把客户分配给经理选定的范围内销售'],
    notPerformed: ['AI 不扩展候选销售范围', '确认前不更换负责人'],
  }),
  sales_pack: Object.freeze({
    businessName: '开发前参考资料',
    permission: '',
    actionIds: ['view_evidence', 'regenerate', 'copy', 'close'],
    onConfirm: [],
    notPerformed: ['绝不自动发送消息', '不写入客户状态', '不更换负责人'],
  }),
  next_action: Object.freeze({
    businessName: '接下来建议做什么',
    permission: 'record_activity',
    actionIds: ['view_evidence', 'regenerate', 'adopt', 'edit_adopt', 'reject', 'close'],
    onConfirm: ['写入人工确认后的下一步内容与计划时间', '需要经理介入时创建明确标记'],
    notPerformed: ['生成建议本身不写入 CRM', '未采纳建议不进入正式待办'],
  }),
  manager_anomaly: Object.freeze({
    businessName: '为什么出现规则异常',
    permission: 'review_ai_tasks',
    actionIds: ['view_evidence', 'regenerate', 'review', 'close'],
    onConfirm: ['进入经理人工介入流程'],
    notPerformed: ['AI 不创建异常', '不改变客户状态', '不重新分配客户'],
    rules: ['异常由服务端确定性规则识别，AI 只解释原因并提供介入建议'],
  }),
  sales_coaching: Object.freeze({
    businessName: '该如何辅导销售',
    permission: 'review_ai_tasks',
    actionIds: ['view_evidence', 'regenerate', 'review', 'close'],
    onConfirm: ['保存经理人工复核结论'],
    notPerformed: ['不作为绩效定论', '不自动改变客户分配', '样本不足时不调用模型'],
    rules: ['少于 10 个已观察客户为样本不足；10–29 为有限样本；30 及以上为样本充分'],
  }),
  action_proposal: Object.freeze({
    businessName: '把触达结果整理为活动草稿',
    permission: 'record_activity',
    actionIds: ['view_evidence', 'regenerate', 'adopt', 'edit_adopt', 'reject', 'close'],
    onConfirm: ['创建人工确认后的活动记录', '写入确认后的下一步与计划时间', '仅执行确认界面列出的阶段变化'],
    notPerformed: ['确认前不写入活动', '不自动发送消息', '不使用未确认字段'],
  }),
  enrichment: Object.freeze({
    businessName: '客户资料补全建议',
    permission: 'edit_customer',
    actionIds: ['view_evidence', 'regenerate', 'review', 'reject', 'close'],
    onConfirm: ['仅更新逐项接受的客户字段', '记录每项旧值、新值、依据和人工决定'],
    notPerformed: ['拒绝项不写入客户主数据', '不自动认定联系人有效', '不绕过敏感信息权限'],
  }),
});

const ENRICHMENT_STATIONS = new Set([
  'intake_precheck', 'identity_verify', 'recon_dispatch', 'recon_collect',
  'contact_dispatch', 'contact_collect', 'enrichment_finalize',
  'customer_enrichment', 'enrichment',
]);

function text(value, limit = 2000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function list(value, limit = 12) {
  return Array.isArray(value)
    ? value.map(item => text(item, 500)).filter(Boolean).slice(0, limit)
    : [];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function capabilityName(job = {}) {
  const station = text(job.station || job.capability, 80);
  return ENRICHMENT_STATIONS.has(station) ? 'enrichment' : station;
}

function triggerView(job = {}) {
  const trigger = job.trigger && typeof job.trigger === 'object' ? job.trigger : {};
  const source = SOURCE_LABELS[trigger.source] ? trigger.source : 'legacy_unknown';
  const eventType = text(trigger.eventType || job.eventType, 120);
  const eventId = text(trigger.eventId || job.eventId, 160);
  const workflowId = text(trigger.workflowId || job.workflowId, 160);
  return {
    source,
    label: SOURCE_LABELS[source],
    event: eventType && eventId ? `${eventType} · ${eventId}` : '',
    actorId: text(trigger.actorId, 160),
    workflowId,
    reason: text(trigger.reason, 300),
    triggeredAt: text(trigger.triggeredAt, 80),
  };
}

function restrictedEvidence(item, permissions = {}) {
  if (item?.restricted || item?.visibility === 'restricted') return true;
  if (item?.requiredPermission && !permissions[item.requiredPermission]) return true;
  const kind = text(item?.kind || item?.type || item?.category || item?.sourceTable, 80).toLowerCase();
  if (kind.includes('contact') && !permissions.view_contacts) return true;
  if ((kind.includes('recon') || kind.includes('research')) && !permissions.view_recon) return true;
  return false;
}

function safeUrl(value) {
  const selected = text(value, 1000);
  return /^https?:\/\//i.test(selected) ? selected : '';
}

function factsView(evidence = [], permissions = {}) {
  const rows = Array.isArray(evidence) ? evidence : [];
  let restrictedCount = 0;
  const items = rows.map((item, index) => {
    if (restrictedEvidence(item, permissions)) {
      restrictedCount += 1;
      return {
        id: `restricted-${index + 1}`,
        summary: '部分依据因权限不可见',
        sourceUrl: '',
        updatedAt: '',
        restricted: true,
      };
    }
    return {
      id: text(item.id || `evidence-${index + 1}`, 160),
      summary: text(item.summary || item.value || item.title || item.label || '已记录的业务事实', 600),
      sourceUrl: safeUrl(item.sourceUrl || item.source_url || item.url),
      updatedAt: text(item.updatedAt || item.observedAt || item.collectedAt || item.createdAt, 80),
      restricted: false,
    };
  });
  return {
    title: '来源事实',
    evidenceCount: rows.length,
    visibleCount: rows.length - restrictedCount,
    restrictedCount,
    restrictedNotice: restrictedCount ? '部分依据因权限不可见' : '',
    items,
  };
}

function normalizeCoverage(coverage = {}, stale = false, capability = '') {
  const sampleSize = Number.isFinite(Number(coverage.sampleSize)) ? Number(coverage.sampleSize) : null;
  let state = text(coverage.state || coverage.status, 40).toLowerCase();
  const aliases = {
    no_evidence: 'none', empty: 'none', insufficient_sample: 'insufficient',
    sufficient_sample: 'sufficient', complete: 'covered',
  };
  state = aliases[state] || state;
  if (capability === 'sales_coaching' && sampleSize !== null) {
    state = sampleSize < 10 ? 'insufficient' : sampleSize < 30 ? 'limited' : 'sufficient';
  }
  if (!state) {
    if (Number(coverage.total || 0) > 0) state = Number(coverage.analyzed || 0) >= Number(coverage.total) ? 'covered' : 'partial';
    else if ((coverage.missingFields || []).length) state = 'partial';
    else state = 'none';
  }
  if (stale) state = 'stale';
  const metrics = (Array.isArray(coverage.metrics) ? coverage.metrics : []).map(metric => {
    const denominator = Number(metric.denominator);
    const numerator = Number(metric.numerator);
    return {
      label: text(metric.label, 120),
      numerator: Number.isFinite(numerator) ? numerator : null,
      denominator: Number.isFinite(denominator) ? denominator : null,
      displayValue: !Number.isFinite(denominator) || denominator === 0
        ? '暂无样本'
        : `${((Number.isFinite(numerator) ? numerator : 0) / denominator * 100).toFixed(1)}%`,
    };
  });
  const analyzed = Number.isFinite(Number(coverage.analyzed)) ? Number(coverage.analyzed) : null;
  const total = Number.isFinite(Number(coverage.total)) ? Number(coverage.total) : null;
  return {
    state,
    label: COVERAGE_LABELS[state] || '覆盖状态未记录',
    sampleSize,
    minimumSample: Number.isFinite(Number(coverage.minimumSample)) ? Number(coverage.minimumSample) : null,
    analyzed,
    total,
    analyzedLabel: analyzed !== null && total !== null ? `${analyzed} / ${total}` : '',
    coveredFields: list(coverage.coveredFields, 30),
    missingFields: list(coverage.missingFields, 30),
    restrictedFields: list(coverage.restrictedFields, 30),
    metrics,
  };
}

function confidenceView(value, modelEligible) {
  const confidence = Number(value);
  if (!modelEligible || !Number.isFinite(confidence)) return { value: null, label: '暂无 AI 置信度' };
  const normalized = Math.max(0, Math.min(confidence, 1));
  const level = normalized >= 0.8 ? '较高' : normalized >= 0.5 ? '中等' : '较低';
  return { value: normalized, label: `${level} · ${(normalized * 100).toFixed(0)}%` };
}

function inferenceFor(capability, value = {}, modelEligible = true) {
  if (!modelEligible) {
    return { conclusion: '样本不足，不生成 AI 辅导', reasons: [], details: [] };
  }
  const reasonCodes = list(value.reasonCodes);
  const map = {
    customer_fit: () => ({
      conclusion: `适配等级 ${text(value.grade || '待判断')} · 评分 ${Number(value.fitScore ?? 0)}`,
      reasons: reasonCodes,
      details: [],
    }),
    contact_readiness: () => ({
      conclusion: ({ ready: '具备可联系条件', partial: '部分具备联系条件', not_ready: '暂不具备联系条件' })[value.readiness] || '联系条件待判断',
      reasons: reasonCodes,
      details: list(value.contactIds).map(id => `候选联系人 ${id}`),
    }),
    distribution_priority: () => ({
      conclusion: `建议优先级 ${text(value.priority || '待判断')} · 紧迫度 ${Number(value.urgency ?? 0)}`,
      reasons: reasonCodes,
      details: list(value.blockingReasons),
    }),
    sales_match: () => ({
      conclusion: `建议候选 ${Array.isArray(value.rankedCandidates) ? value.rankedCandidates.length : 0} 人`,
      reasons: reasonCodes,
      details: (Array.isArray(value.rankedCandidates) ? value.rankedCandidates : []).slice(0, 10)
        .map(item => `候选 ${Number(item.employeeId)} · ${Number(item.score)} 分 · ${list(item.reasons, 3).join('；')}`),
    }),
    sales_pack: () => ({
      conclusion: text(value.summary || '销售资料包已生成'),
      reasons: list(value.entryPoints),
      details: [
        ...list(value.risks).map(item => `风险：${item}`),
        value.draft?.body ? `沟通草稿：${text(value.draft.body, 1200)}` : '',
      ].filter(Boolean),
    }),
    next_action: () => ({
      conclusion: text(value.nextAction || '下一步待补充'),
      reasons: [text(value.reason)].filter(Boolean),
      details: [value.nextActionAt ? `计划时间：${text(value.nextActionAt, 80)}` : '', value.managerRequired ? '需要经理介入' : ''].filter(Boolean),
    }),
    manager_anomaly: () => ({
      conclusion: text(value.explanation || '规则异常待解释'),
      reasons: [text(value.anomalyCode), text(value.severity)].filter(Boolean),
      details: [text(value.interventionSuggestion)].filter(Boolean),
    }),
    sales_coaching: () => ({
      conclusion: '销售辅导趋势建议',
      reasons: list(value.strengths).map(item => `优势：${item}`),
      details: [
        ...list(value.gaps).map(item => `差距：${item}`),
        ...list(value.recommendations).map(item => `建议：${item}`),
      ],
    }),
    action_proposal: () => ({
      conclusion: text(value.summary || '活动草稿待确认'),
      reasons: [value.activityType ? `活动类型：${text(value.activityType)}` : '', value.outcome ? `结果：${text(value.outcome)}` : ''].filter(Boolean),
      details: [value.nextAction ? `下一步：${text(value.nextAction)}` : '', value.nextActionAt ? `计划时间：${text(value.nextActionAt)}` : ''].filter(Boolean),
    }),
    enrichment: () => {
      const proposals = Array.isArray(value.proposals) ? value.proposals : [];
      return {
        conclusion: `客户资料补全建议 ${proposals.length} 项`,
        reasons: list(value.tags || value.reasonCodes),
        details: proposals.slice(0, 30).map(item =>
          `${text(item.field || item.fieldName || '字段')}：${text(item.oldValue || '未填写')} → ${text(item.newValue || item.proposedValue || '待确认')}`),
      };
    },
  };
  return (map[capability] || (() => ({
    conclusion: 'AI 结果待业务解释',
    reasons: reasonCodes,
    details: [],
  })))();
}

function permissionAllowed(permissions, permission) {
  return !permission || Boolean(permissions?.[permission]);
}

function actionView(config, facts, permissions, stale, modelEligible) {
  return config.actionIds.map(id => {
    let enabled = true;
    let disabledReason = '';
    if (id === 'view_evidence' && facts.evidenceCount === 0) {
      enabled = false;
      disabledReason = '没有可查看的依据';
    }
    if (id === 'regenerate' && (!permissions?.use_ai_assistant || !modelEligible)) {
      enabled = false;
      disabledReason = modelEligible ? '当前账号无重新生成权限' : '当前覆盖或样本不满足生成条件';
    }
    if (['adopt', 'edit_adopt', 'reject', 'review'].includes(id)
        && !permissionAllowed(permissions, config.permission)) {
      enabled = false;
      disabledReason = '当前账号无人工决定权限';
    }
    if (stale && ['adopt', 'edit_adopt', 'review'].includes(id)) {
      enabled = false;
      disabledReason = '结果已过期，请先重新生成';
    }
    return { id, label: ACTION_LABELS[id], enabled, disabledReason };
  });
}

function presentAIResult(input = {}) {
  const job = input.job && typeof input.job === 'object' ? input.job : {};
  const result = input.result && typeof input.result === 'object' ? input.result : {};
  const value = result.value && typeof result.value === 'object' ? result.value : result;
  const capability = capabilityName(job);
  const config = CAPABILITIES[capability];
  if (!config) throw new Error(`unsupported AI business capability: ${capability || 'missing'}`);
  const stale = Boolean(result.stale || input.coverage?.state === 'stale');
  const coverageInput = {
    ...(input.coverage || {}),
    ...(input.coverage?.sampleSize === undefined && value.sampleSize !== undefined
      ? { sampleSize: value.sampleSize } : {}),
  };
  if (!coverageInput.state && !coverageInput.status && Array.isArray(input.evidence) && input.evidence.length) {
    coverageInput.state = 'partial';
  }
  const coverage = normalizeCoverage(coverageInput, stale, capability);
  const modelEligible = !(coverage.state === 'none' || coverage.state === 'insufficient');
  const facts = factsView(input.evidence, input.permissions);
  const inferenceValue = inferenceFor(capability, value, modelEligible);
  const rules = [
    ...(config.rules || []),
    ...list(coverageInput.rules, 20),
    ...(coverage.state === 'none' ? ['没有可用事实或证据，不调用模型'] : []),
    ...(coverage.state === 'insufficient' ? ['未达到该场景最低样本门槛，不调用模型'] : []),
    ...(stale ? ['关键事实或样本在生成后发生变化，结果不可直接采纳'] : []),
  ];
  const actions = actionView(config, facts, input.permissions || {}, stale, modelEligible);
  return deepFreeze({
    kind: 'ai_business_result',
    capability,
    businessName: config.businessName,
    badge: 'AI 推断',
    generatedAt: text(result.generatedAt || result.createdAt || job.finishedAt, 80),
    stale,
    staleLabel: stale ? '结果已过期' : '当前结果',
    trigger: triggerView(job),
    facts,
    rules: { title: '确定性规则', items: rules },
    inference: {
      title: 'AI 推断',
      conclusion: inferenceValue.conclusion,
      reasons: inferenceValue.reasons,
      details: inferenceValue.details,
      confidence: confidenceView(value.confidence ?? result.confidence, modelEligible),
      coverage,
      missingInformation: coverage.missingFields,
      limitations: [
        ...(coverage.state === 'limited' ? ['仅可作为趋势参考，不用于精确归因'] : []),
        ...(facts.restrictedCount ? ['部分依据因权限不可见'] : []),
        ...(stale ? ['结果已过期，不可直接采纳'] : []),
      ],
      modelEligible,
    },
    humanDecision: {
      title: '人工决定',
      required: config.onConfirm.length > 0,
      actions,
    },
    systemAction: {
      title: '系统动作',
      onConfirm: [...config.onConfirm],
      notPerformed: [...config.notPerformed],
      notice: config.onConfirm.length
        ? '只有人工确认后，服务端才执行以下业务动作。'
        : '该结果仅供查看，不会自动写入业务数据。',
    },
  });
}

module.exports = {
  CAPABILITIES,
  presentAIResult,
};
