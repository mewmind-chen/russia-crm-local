'use strict';

const STRATEGIES = Object.freeze(new Set(['balanced', 'round_robin', 'fixed_priority']));
const TARGET_MODES = Object.freeze(new Set(['selected', 'all_authorized']));
const CONDITION_FIELDS = Object.freeze([
  'countries',
  'industries',
  'products',
  'customerTypes',
  'tagIds',
  'matchGroups',
]);

const FALLBACK_RULE = Object.freeze({
  id: 'system-default',
  name: '默认均衡分配',
  enabled: true,
  position: Number.MAX_SAFE_INTEGER,
  conditions: Object.freeze({
    countries: Object.freeze([]),
    industries: Object.freeze([]),
    products: Object.freeze([]),
    customerTypes: Object.freeze([]),
    tagIds: Object.freeze([]),
    matchGroups: Object.freeze([]),
  }),
  targetMode: 'all_authorized',
  salesUserIds: Object.freeze([]),
  strategy: 'balanced',
  dailyQuota: null,
  isSystemDefault: true,
});

const COUNTRY_ALIASES = Object.freeze({
  ru: '俄罗斯',
  russia: '俄罗斯',
  'russian federation': '俄罗斯',
  br: '巴西',
  brazil: '巴西',
  mx: '墨西哥',
  mexico: '墨西哥',
  us: '美国',
  usa: '美国',
  'united states': '美国',
  de: '德国',
  germany: '德国',
  kz: '哈萨克斯坦',
  kazakhstan: '哈萨克斯坦',
});

function parseJson(value, fallback) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function scalar(value) {
  return String(value ?? '').trim();
}

function normalized(value) {
  return scalar(value).toLocaleLowerCase();
}

function normalizedCountry(value) {
  const text = normalized(value);
  return normalized(COUNTRY_ALIASES[text] || text);
}

function array(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function uniqueStrings(value) {
  const seen = new Set();
  const result = [];
  for (const item of array(value)) {
    const text = scalar(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function flattenProductValues(value, result = []) {
  const parsed = parseJson(value, value);
  if (Array.isArray(parsed)) {
    for (const item of parsed) flattenProductValues(item, result);
  } else if (parsed && typeof parsed === 'object') {
    for (const item of Object.values(parsed)) flattenProductValues(item, result);
  } else if (parsed !== undefined && parsed !== null) {
    const text = normalized(parsed);
    if (text) result.push(text);
  }
  return result;
}

function candidateTagIds(candidate) {
  const values = [
    ...array(candidate.tagIds ?? candidate.tag_ids),
    ...array(candidate.tags),
  ];
  return values.map(item => normalized(
    item && typeof item === 'object' ? (item.id ?? item.tagId ?? item.tag_id) : item,
  )).filter(Boolean);
}

function candidateValues(candidate = {}) {
  return {
    countries: [normalizedCountry(candidate.country ?? candidate.countryName ?? candidate.country_name)].filter(Boolean),
    industries: [normalized(candidate.industry)].filter(Boolean),
    products: flattenProductValues(
      candidate.products
        ?? candidate.productFocus
        ?? candidate.product_focus
        ?? candidate.likely_component_needs_json,
    ),
    customerTypes: [normalized(candidate.customerType ?? candidate.customer_type ?? candidate.company_type)].filter(Boolean),
    tagIds: candidateTagIds(candidate),
    matchGroups: [normalized(candidate.matchGroup ?? candidate.match_group ?? candidate.priority)].filter(Boolean),
  };
}

function ruleConditionValues(field, conditions) {
  const values = uniqueStrings(conditions?.[field]);
  return field === 'countries'
    ? values.map(normalizedCountry).filter(Boolean)
    : values.map(normalized).filter(Boolean);
}

function productMatches(ruleValue, candidateValue) {
  return candidateValue === ruleValue
    || candidateValue.includes(ruleValue)
    || ruleValue.includes(candidateValue);
}

function matchRule(rule, candidate = {}) {
  const values = candidateValues(candidate);
  const fieldResults = {};
  for (const field of CONDITION_FIELDS) {
    const expected = ruleConditionValues(field, rule?.conditions || {});
    if (!expected.length) {
      fieldResults[field] = { configured: false, matched: true, expected: [], actual: values[field] };
      continue;
    }
    const matches = field === 'products'
      ? expected.some(ruleValue => values[field].some(candidateValue => productMatches(ruleValue, candidateValue)))
      : expected.some(ruleValue => values[field].includes(ruleValue));
    fieldResults[field] = {
      configured: true,
      matched: matches,
      expected,
      actual: values[field],
    };
    if (!matches) return { matched: false, fields: fieldResults };
  }
  return { matched: true, fields: fieldResults };
}

function normalizedRule(rule = {}, index = 0) {
  const strategy = STRATEGIES.has(rule.strategy) ? rule.strategy : 'balanced';
  const targetMode = TARGET_MODES.has(rule.targetMode) ? rule.targetMode : 'all_authorized';
  const quota = rule.dailyQuota === null || rule.dailyQuota === undefined || rule.dailyQuota === ''
    ? null
    : Math.max(1, Math.floor(Number(rule.dailyQuota) || 1));
  const conditions = {};
  for (const field of CONDITION_FIELDS) conditions[field] = uniqueStrings(rule.conditions?.[field]);
  return {
    ...rule,
    id: scalar(rule.id) || `rule-${index + 1}`,
    name: scalar(rule.name) || `规则 ${index + 1}`,
    enabled: rule.enabled !== false && Number(rule.enabled) !== 0,
    position: Number.isFinite(Number(rule.position)) ? Number(rule.position) : index,
    conditions,
    targetMode,
    salesUserIds: uniqueStrings(rule.salesUserIds),
    strategy,
    dailyQuota: quota,
    isSystemDefault: Boolean(rule.isSystemDefault),
  };
}

function orderedRules(rules) {
  return array(rules)
    .map(normalizedRule)
    .filter(rule => rule.enabled)
    .sort((left, right) =>
      Number(left.isSystemDefault) - Number(right.isSystemDefault)
      || left.position - right.position
      || left.id.localeCompare(right.id));
}

function userId(user) {
  return scalar(user?.id ?? user?.userId ?? user?.user_id);
}

function userSort(left, right) {
  return scalar(left?.name).localeCompare(scalar(right?.name), 'zh-CN')
    || userId(left).localeCompare(userId(right));
}

function permissionsFor(user) {
  const parsed = parseJson(user?.permissions_json, {});
  return {
    ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
    ...(user?.permissions && typeof user.permissions === 'object' ? user.permissions : {}),
  };
}

function hasIntakePermission(user) {
  if (typeof user?.viewIntake === 'boolean') return user.viewIntake;
  if (typeof user?.view_intake === 'boolean') return user.view_intake;
  const permissions = permissionsFor(user);
  if (Object.prototype.hasOwnProperty.call(permissions, 'view_intake')) {
    return permissions.view_intake === true;
  }
  // Database rows rely on role defaults when no override is present.
  return normalized(user?.role) === 'sales';
}

function isInactive(user) {
  return user?.active === false || Number(user?.active) === 0;
}

function isDeparted(user) {
  if (scalar(user?.archivedAt ?? user?.archived_at)) return true;
  const status = normalized(user?.employmentStatus ?? user?.employment_status ?? user?.status);
  return ['departed', 'terminated', 'resigned', 'left', '离职', '已离职'].includes(status);
}

function quotaCounts(input, rule, id) {
  const byRule = input.dailyByRule?.[rule.id]
    ?? input.ruleDailyByOwner?.[rule.id]
    ?? null;
  if (byRule && rule.dailyQuota !== null) return Number(byRule[id] || 0);
  return Number(input.dailyByOwner?.[id] || 0);
}

function effectiveQuota(input, rule) {
  if (rule.dailyQuota !== null) return rule.dailyQuota;
  return Math.max(1, Math.floor(Number(input.defaultDailyQuota ?? input.dailyQuota ?? 5) || 5));
}

function exclusion(user, rule, input, configuredId = '') {
  const id = userId(user) || scalar(configuredId);
  const quota = effectiveQuota(input, rule);
  const assigned = quotaCounts(input, rule, id);
  if (!user) return { userId: id, reasonCode: 'user_not_found', reason: '指定销售不存在' };
  if (normalized(user.role) !== 'sales') {
    return { userId: id, reasonCode: 'not_sales', reason: '该用户不是销售人员' };
  }
  if (isInactive(user)) {
    return { userId: id, reasonCode: 'inactive_sales', reason: '销售账号已停用' };
  }
  if (isDeparted(user)) {
    return { userId: id, reasonCode: 'departed_sales', reason: '销售人员已离职' };
  }
  if (!hasIntakePermission(user)) {
    return { userId: id, reasonCode: 'missing_view_intake', reason: '销售没有线索权限' };
  }
  if (assigned >= quota) {
    return {
      userId: id,
      reasonCode: 'daily_quota_reached',
      reason: `销售已达到每日额度 ${quota}`,
      dailyAssigned: assigned,
      dailyQuota: quota,
    };
  }
  return null;
}

function candidatesForRule(rule, users) {
  const allUsers = array(users);
  const byId = new Map(allUsers.map(user => [userId(user), user]).filter(([id]) => id));
  if (rule.targetMode === 'selected') {
    return rule.salesUserIds.map(id => ({
      id,
      user: byId.get(id) || null,
    }));
  }
  return [...allUsers]
    .filter(user => normalized(user?.role) === 'sales')
    .sort(userSort)
    .map(user => ({ id: userId(user), user }));
}

function roundRobinCursor(input, rule) {
  const state = input.roundRobinState?.[rule.id] ?? input.rotationState?.[rule.id] ?? 0;
  if (state && typeof state === 'object') return Math.max(0, Math.floor(Number(state.cursor) || 0));
  return Math.max(0, Math.floor(Number(state) || 0));
}

function chooseEligible(rule, eligible, allCandidates, input) {
  if (eligible.length === 1) {
    const index = allCandidates.findIndex(candidate => candidate.id === eligible[0].id);
    return {
      selected: eligible[0],
      nextRoundRobinCursor: rule.strategy === 'round_robin' && allCandidates.length
        ? (index + 1) % allCandidates.length
        : null,
    };
  }
  if (rule.strategy === 'fixed_priority') {
    return { selected: eligible[0], nextRoundRobinCursor: null };
  }
  if (rule.strategy === 'round_robin') {
    const eligibleIds = new Set(eligible.map(candidate => candidate.id));
    const start = roundRobinCursor(input, rule) % allCandidates.length;
    for (let offset = 0; offset < allCandidates.length; offset += 1) {
      const index = (start + offset) % allCandidates.length;
      if (eligibleIds.has(allCandidates[index].id)) {
        return {
          selected: allCandidates[index],
          nextRoundRobinCursor: (index + 1) % allCandidates.length,
        };
      }
    }
  }
  const selected = [...eligible].sort((left, right) =>
    Number(input.workloadByOwner?.[left.id] || 0) - Number(input.workloadByOwner?.[right.id] || 0)
    || quotaCounts(input, rule, left.id) - quotaCounts(input, rule, right.id)
    || allCandidates.findIndex(candidate => candidate.id === left.id)
      - allCandidates.findIndex(candidate => candidate.id === right.id)
    || left.id.localeCompare(right.id))[0];
  return { selected, nextRoundRobinCursor: null };
}

function riskState(candidate, explicitBlocked) {
  const text = normalized([
    candidate?.risk_level,
    candidate?.riskLevel,
    candidate?.risk_status,
    candidate?.riskStatus,
    candidate?.industry,
  ].filter(Boolean).join(' '));
  return Boolean(explicitBlocked)
    || /blocked|sanction|制裁|军工|military|high[\s_-]?risk|高风险/.test(text);
}

function baseDecision(input = {}) {
  const candidate = input.candidate || {};
  if (input.duplicate || candidate.duplicate === true || scalar(candidate.crm_customer_id)) {
    return {
      disposition: 'blocked',
      assignable: false,
      managerReview: false,
      selectedUserId: '',
      userId: '',
      reasonCode: 'duplicate_customer',
      reason: '客户已在 CRM，不能重复分配',
      matchedRule: null,
      candidateUserIds: [],
      eligibleUserIds: [],
      excludedCandidates: [],
      nextRoundRobinCursor: null,
    };
  }
  if (riskState(candidate, input.riskBlocked)) {
    return {
      disposition: 'manager_review',
      assignable: false,
      managerReview: true,
      selectedUserId: '',
      userId: '',
      reasonCode: 'risk_requires_manual_review',
      reason: '风险规则：制裁或高风险线索需要人工确认',
      matchedRule: null,
      candidateUserIds: [],
      eligibleUserIds: [],
      excludedCandidates: [],
      nextRoundRobinCursor: null,
    };
  }
  return null;
}

function evaluateAssignmentRules(input = {}) {
  const safetyDecision = baseDecision(input);
  if (safetyDecision) return safetyDecision;

  const candidate = input.candidate || {};
  const rules = orderedRules(input.rules);
  let selectedRule = null;
  let ruleMatch = null;
  for (const rule of rules) {
    const result = matchRule(rule, candidate);
    if (result.matched) {
      selectedRule = rule;
      ruleMatch = result;
      break;
    }
  }
  if (!selectedRule) {
    selectedRule = normalizedRule(FALLBACK_RULE);
    ruleMatch = matchRule(selectedRule, candidate);
  }

  const candidateEntries = candidatesForRule(selectedRule, input.users);
  const excludedCandidates = [];
  const eligible = [];
  for (const entry of candidateEntries) {
    const excluded = exclusion(entry.user, selectedRule, input, entry.id);
    if (excluded) excludedCandidates.push(excluded);
    else eligible.push(entry);
  }
  const matchedRule = {
    id: selectedRule.id,
    name: selectedRule.name,
    versionId: scalar(selectedRule.versionId ?? input.versionId),
    versionNumber: Number(selectedRule.versionNumber ?? input.versionNumber ?? 0) || null,
    strategy: selectedRule.strategy,
    targetMode: selectedRule.targetMode,
    dailyQuota: effectiveQuota(input, selectedRule),
    isSystemDefault: Boolean(selectedRule.isSystemDefault),
    match: ruleMatch,
  };
  const common = {
    matchedRule,
    ruleId: matchedRule.id,
    ruleName: matchedRule.name,
    ruleVersionId: matchedRule.versionId,
    strategy: selectedRule.strategy,
    candidateUserIds: candidateEntries.map(entry => entry.id),
    eligibleUserIds: eligible.map(entry => entry.id),
    excludedCandidates,
  };

  if (!eligible.length) {
    return {
      ...common,
      disposition: 'manager_review',
      assignable: false,
      managerReview: true,
      selectedUserId: '',
      userId: '',
      reasonCode: candidateEntries.length ? 'rule_candidates_unavailable' : 'rule_has_no_candidates',
      reason: candidateEntries.length
        ? `规则“${selectedRule.name}”的指定销售当前均不可用，转人工处理`
        : `规则“${selectedRule.name}”没有可分配的销售，转人工处理`,
      nextRoundRobinCursor: null,
    };
  }

  const choice = chooseEligible(selectedRule, eligible, candidateEntries, input);
  return {
    ...common,
    disposition: 'assign',
    assignable: true,
    managerReview: false,
    selectedUserId: choice.selected.id,
    userId: choice.selected.id,
    reasonCode: selectedRule.isSystemDefault ? 'default_balanced_assignment' : `rule_${selectedRule.strategy}`,
    reason: `命中规则“${selectedRule.name}”，按${{
      balanced: '负荷均衡',
      round_robin: '轮流分配',
      fixed_priority: '固定优先级',
    }[selectedRule.strategy]}选择销售`,
    nextRoundRobinCursor: choice.nextRoundRobinCursor,
  };
}

module.exports = {
  CONDITION_FIELDS,
  FALLBACK_RULE,
  STRATEGIES,
  TARGET_MODES,
  candidateValues,
  evaluateAssignmentRules,
  matchRule,
  normalizedRule,
  orderedRules,
};
