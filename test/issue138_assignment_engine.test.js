'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateAssignmentRules,
  matchRule,
  normalizedRule,
  orderedRules,
} = require('../lib/intake_assignment_engine');

function sales(id, overrides = {}) {
  return {
    id,
    name: id,
    role: 'sales',
    active: 1,
    permissions: { view_intake: true },
    ...overrides,
  };
}

function rule(overrides = {}) {
  return {
    id: 'RULE-BR',
    name: '巴西工业客户',
    enabled: true,
    position: 10,
    conditions: {
      countries: ['巴西'],
      industries: ['工业控制'],
      products: ['MCU'],
      customerTypes: ['终端制造商'],
      tagIds: ['TAG-KEY'],
      matchGroups: ['A', 'B'],
    },
    targetMode: 'selected',
    salesUserIds: ['S-1', 'S-2'],
    strategy: 'balanced',
    dailyQuota: 3,
    ...overrides,
  };
}

test('conditions are OR within one field and AND between configured fields', () => {
  const candidate = {
    country: 'Brazil',
    industry: '工业控制',
    product_focus: 'STM32 MCU / Connector',
    customer_type: '终端制造商',
    tags: [{ id: 'TAG-KEY' }],
    match_group: 'b',
  };
  assert.equal(matchRule(rule(), candidate).matched, true);
  assert.equal(matchRule(rule({
    conditions: { ...rule().conditions, countries: ['墨西哥', '巴西'] },
  }), candidate).matched, true);
  assert.equal(matchRule(rule({
    conditions: { ...rule().conditions, industries: ['汽车电子'] },
  }), candidate).matched, false);
});

test('rules use the first enabled match and always order the system default last', () => {
  const rules = orderedRules([
    rule({ id: 'DEFAULT', position: 0, isSystemDefault: true, conditions: {} }),
    rule({ id: 'OFF', enabled: false, position: 1 }),
    rule({ id: 'SECOND', position: 20 }),
    rule({ id: 'FIRST', position: 10 }),
  ]);
  assert.deepEqual(rules.map(item => item.id), ['FIRST', 'SECOND', 'DEFAULT']);

  const decision = evaluateAssignmentRules({
    candidate: {
      country: '巴西',
      industry: '工业控制',
      products: ['MCU'],
      customerType: '终端制造商',
      tagIds: ['TAG-KEY'],
      matchGroup: 'A',
    },
    rules,
    users: [sales('S-1'), sales('S-2')],
    workloadByOwner: { 'S-1': 5, 'S-2': 1 },
    dailyByRule: { FIRST: { 'S-1': 0, 'S-2': 0 } },
    defaultDailyQuota: 5,
  });
  assert.equal(decision.ruleId, 'FIRST');
  assert.equal(decision.selectedUserId, 'S-2');
  assert.equal(decision.reasonCode, 'rule_balanced');
});

test('balanced assignment chooses the lightest workload and applies rule quota counts', () => {
  const decision = evaluateAssignmentRules({
    candidate: { country: '巴西' },
    rules: [rule({ conditions: { countries: ['巴西'] } })],
    users: [sales('S-1'), sales('S-2')],
    workloadByOwner: { 'S-1': 0, 'S-2': 4 },
    dailyByOwner: { 'S-1': 99, 'S-2': 0 },
    dailyByRule: { 'RULE-BR': { 'S-1': 2, 'S-2': 0 } },
    defaultDailyQuota: 5,
  });
  assert.equal(decision.selectedUserId, 'S-1');
  assert.equal(decision.excludedCandidates.length, 0);

  const quotaDecision = evaluateAssignmentRules({
    candidate: { country: '巴西' },
    rules: [rule({ conditions: { countries: ['巴西'] } })],
    users: [sales('S-1'), sales('S-2')],
    workloadByOwner: { 'S-1': 0, 'S-2': 4 },
    dailyByRule: { 'RULE-BR': { 'S-1': 3, 'S-2': 0 } },
    defaultDailyQuota: 5,
  });
  assert.equal(quotaDecision.selectedUserId, 'S-2');
  assert.deepEqual(quotaDecision.excludedCandidates.map(item => item.reasonCode), ['daily_quota_reached']);
});

test('round robin skips unavailable users without mutating rotation input', () => {
  const rotationState = { 'RULE-BR': { cursor: 1 } };
  const before = structuredClone(rotationState);
  const decision = evaluateAssignmentRules({
    candidate: { country: '巴西' },
    rules: [rule({
      conditions: { countries: ['巴西'] },
      salesUserIds: ['S-1', 'S-2', 'S-3'],
      strategy: 'round_robin',
    })],
    users: [
      sales('S-1'),
      sales('S-2', { active: 0 }),
      sales('S-3'),
    ],
    dailyByRule: { 'RULE-BR': {} },
    rotationState,
  });
  assert.equal(decision.selectedUserId, 'S-3');
  assert.equal(decision.nextRoundRobinCursor, 0);
  assert.deepEqual(rotationState, before);
});

test('fixed priority preserves configured order and selected scope never expands', () => {
  const decision = evaluateAssignmentRules({
    candidate: { country: '巴西' },
    rules: [rule({
      conditions: { countries: ['巴西'] },
      salesUserIds: ['S-2', 'S-1'],
      strategy: 'fixed_priority',
    })],
    users: [sales('S-1'), sales('S-2', { active: 0 }), sales('S-OUTSIDE')],
    dailyByRule: { 'RULE-BR': {} },
  });
  assert.equal(decision.selectedUserId, 'S-1');
  assert.deepEqual(decision.candidateUserIds, ['S-2', 'S-1']);
  assert.ok(!decision.candidateUserIds.includes('S-OUTSIDE'));

  const unavailable = evaluateAssignmentRules({
    candidate: { country: '巴西' },
    rules: [rule({
      conditions: { countries: ['巴西'] },
      salesUserIds: ['S-2'],
      strategy: 'fixed_priority',
    })],
    users: [sales('S-2', { active: 0 }), sales('S-OUTSIDE')],
  });
  assert.equal(unavailable.disposition, 'manager_review');
  assert.equal(unavailable.selectedUserId, '');
  assert.equal(unavailable.reasonCode, 'rule_candidates_unavailable');
});

test('selected targets report missing users while role-default database rows remain eligible', () => {
  const decision = evaluateAssignmentRules({
    candidate: { country: '巴西' },
    rules: [rule({
      conditions: { countries: ['巴西'] },
      salesUserIds: ['REMOVED', 'LEGACY'],
      strategy: 'fixed_priority',
    })],
    users: [{
      id: 'LEGACY',
      name: 'Legacy row',
      role: 'sales',
      active: 1,
      permissions_json: '{}',
    }],
  });
  assert.equal(decision.selectedUserId, 'LEGACY');
  assert.deepEqual(decision.excludedCandidates, [{
    userId: 'REMOVED',
    reasonCode: 'user_not_found',
    reason: '指定销售不存在',
  }]);
});

test('all-authorized target reports state, employment, permission and quota exclusions', () => {
  const decision = evaluateAssignmentRules({
    candidate: { country: '加拿大' },
    rules: [],
    users: [
      sales('ACTIVE'),
      sales('INACTIVE', { active: 0 }),
      sales('LEFT', { archived_at: '2026-07-01' }),
      sales('DENIED', { permissions: { view_intake: false } }),
      { id: 'MANAGER', role: 'manager', active: 1, permissions: { view_intake: true } },
      sales('FULL'),
    ],
    workloadByOwner: { ACTIVE: 2 },
    dailyByOwner: { FULL: 5 },
    defaultDailyQuota: 5,
  });
  assert.equal(decision.ruleId, 'system-default');
  assert.equal(decision.selectedUserId, 'ACTIVE');
  assert.deepEqual(
    decision.excludedCandidates.map(item => item.reasonCode).sort(),
    ['daily_quota_reached', 'departed_sales', 'inactive_sales', 'missing_view_intake'].sort(),
  );
  assert.ok(!decision.candidateUserIds.includes('MANAGER'));
});

test('duplicate and risk safety boundaries run before configurable rules', () => {
  const input = {
    candidate: { country: '巴西' },
    rules: [rule({ conditions: {} })],
    users: [sales('S-1')],
  };
  const duplicate = evaluateAssignmentRules({ ...input, duplicate: true });
  assert.equal(duplicate.disposition, 'blocked');
  assert.equal(duplicate.reasonCode, 'duplicate_customer');

  const risk = evaluateAssignmentRules({
    ...input,
    candidate: { country: '巴西', risk_status: 'SANCTIONS MATCH' },
  });
  assert.equal(risk.disposition, 'manager_review');
  assert.equal(risk.reasonCode, 'risk_requires_manual_review');
  assert.equal(risk.selectedUserId, '');
});

test('simulation is pure and deterministic, including fallback balanced assignment', () => {
  const input = {
    candidate: { country: '加拿大' },
    rules: [rule({ conditions: { countries: ['巴西'] } })],
    users: [sales('S-2'), sales('S-1')],
    workloadByOwner: { 'S-1': 1, 'S-2': 5 },
    dailyByOwner: { 'S-1': 0, 'S-2': 0 },
    roundRobinState: { 'RULE-BR': 4 },
    defaultDailyQuota: 5,
  };
  const before = structuredClone(input);
  const first = evaluateAssignmentRules(input);
  const second = evaluateAssignmentRules(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.equal(first.ruleId, 'system-default');
  assert.equal(first.selectedUserId, 'S-1');
  assert.equal(first.reasonCode, 'default_balanced_assignment');
});

test('normalization rejects unsupported strategy and preserves published version metadata', () => {
  const value = normalizedRule({
    id: 'R',
    name: 'Versioned',
    enabled: 1,
    conditions: {},
    targetMode: 'invalid',
    strategy: 'script',
    versionId: 'VER-3',
    versionNumber: 3,
    dailyQuota: '8',
  });
  assert.equal(value.targetMode, 'all_authorized');
  assert.equal(value.strategy, 'balanced');
  assert.equal(value.dailyQuota, 8);
  assert.equal(value.versionId, 'VER-3');
  assert.equal(value.versionNumber, 3);
});
