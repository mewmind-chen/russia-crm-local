const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  SYSTEM_DEFAULT_RULE_ID,
  LEGACY_INITIAL_RULE_ID,
  createIntakeAssignmentRuleStore,
  installIntakeAssignmentRules,
  normalizeAssignmentRule,
  assignmentDecisionForActor,
} = require('../lib/intake_assignment_rules');

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE crm_intake_settings (
      id TEXT PRIMARY KEY,
      daily_per_sales INTEGER NOT NULL DEFAULT 5,
      match_groups_json TEXT NOT NULL DEFAULT '[]',
      countries_json TEXT NOT NULL DEFAULT '[]'
    );
    INSERT INTO crm_intake_settings
      (id,daily_per_sales,match_groups_json,countries_json)
    VALUES ('default',7,'["A","B"]','["巴西","墨西哥"]');
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO sales_users(id,role,active) VALUES
      ('S-WU','sales',1),
      ('S-RU','sales',1),
      ('S-DISABLED','sales',0),
      ('M-ONE','manager',1);
  `);
  let clock = 0;
  let sequence = 0;
  const options = {
    now: () => new Date(Date.UTC(2026, 6, 29, 1, 0, clock++)),
    idFactory: prefix => `${prefix}-TEST-${++sequence}`,
  };
  const store = createIntakeAssignmentRuleStore(db, options);
  return { db, store };
}

const admin = {
  id: 'A-ONE',
  role: 'admin',
  isImpersonating: false,
  permissions: { view_intake: true, manage_intake: true },
};
const manager = {
  id: 'M-ONE',
  role: 'manager',
  isImpersonating: false,
  permissions: { view_intake: true, manage_intake: true },
};
const sales = {
  id: 'S-WU',
  role: 'sales',
  isImpersonating: false,
  permissions: { view_intake: true, manage_intake: false },
};

function selectedRule(overrides = {}) {
  return {
    name: '巴西工业客户',
    enabled: true,
    conditions: {
      countries: ['巴西'],
      industries: ['工业控制'],
      products: ['MCU'],
      customerTypes: ['终端制造商'],
      tagIds: ['TAG-FOCUS'],
      matchGroups: ['A', 'B'],
    },
    targetMode: 'selected',
    salesUserIds: ['S-WU', 'S-RU'],
    strategy: 'round_robin',
    dailyQuota: 4,
    ...overrides,
  };
}

test('legacy intake settings migrate once into a published initial rule and immutable fallback', () => {
  const { db, store } = fixture();
  const config = store.getConfig(admin);
  assert.equal(config.state.draftRevision, 1);
  assert.equal(config.state.publishedVersionNumber, 1);
  assert.deepEqual(config.rules.map(rule => rule.id), [LEGACY_INITIAL_RULE_ID, SYSTEM_DEFAULT_RULE_ID]);
  assert.deepEqual(config.rules[0].conditions.countries, ['巴西', '墨西哥']);
  assert.deepEqual(config.rules[0].conditions.matchGroups, ['A', 'B']);
  assert.equal(config.rules[0].dailyQuota, null);
  assert.deepEqual(config.rules[1], {
    id: SYSTEM_DEFAULT_RULE_ID,
    name: '默认均衡分配',
    enabled: true,
    position: 1,
    conditions: {
      countries: [],
      industries: [],
      products: [],
      customerTypes: [],
      tagIds: [],
      matchGroups: [],
    },
    targetMode: 'all_authorized',
    salesUserIds: [],
    strategy: 'balanced',
    dailyQuota: null,
    isSystemDefault: true,
    revision: 1,
    createdBy: 'system:migration',
    createdAt: '2026-07-29 01:00:00',
    updatedBy: 'system:migration',
    updatedAt: '2026-07-29 01:00:00',
  });
  const firstVersionId = config.state.publishedVersionId;
  installIntakeAssignmentRules(db);
  assert.equal(store.getState().publishedVersionId, firstVersionId);
  assert.equal(store.listVersions(admin).length, 1);
  db.close();
});

test('schema validation rejects scripts, unknown keys, invalid candidates and invalid quota', () => {
  const { db, store } = fixture();
  const revision = store.getState().draftRevision;
  assert.throws(() => store.createDraft({
    ...selectedRule(),
    expectedRevision: revision,
    sql: 'DROP TABLE crm_accounts',
  }, admin), /不支持的字段/);
  assert.throws(() => normalizeAssignmentRule(selectedRule({
    conditions: { countries: ['巴西'], expression: 'country = ?' },
  })), /不支持的字段/);
  assert.throws(() => store.createDraft({
    ...selectedRule({ salesUserIds: ['M-ONE'] }),
    expectedRevision: revision,
  }, admin), /不存在或不是销售账号/);
  assert.throws(() => store.createDraft({
    ...selectedRule({ dailyQuota: 0 }),
    expectedRevision: revision,
  }, admin), /每日额度/);
  assert.throws(() => store.createDraft({
    ...selectedRule({ targetMode: 'selected', salesUserIds: [] }),
    expectedRevision: revision,
  }, admin), /至少需要选择一名销售/);
  db.close();
});

test('admin can create, modify and reorder a draft with optimistic revision checks', () => {
  const { db, store } = fixture();
  const created = store.createDraft({
    ...selectedRule(),
    expectedRevision: 1,
  }, admin);
  assert.equal(created.state.draftRevision, 2);
  assert.equal(created.rule.position, 1);
  assert.equal(store.getDraftRules().at(-1).id, SYSTEM_DEFAULT_RULE_ID);
  assert.throws(() => store.updateDraft(created.rule.id, {
    expectedRevision: 1,
    name: '过期修改',
  }, admin), error => error.statusCode === 409 && error.code === 'ASSIGNMENT_RULE_REVISION_CONFLICT');
  const updated = store.updateDraft(created.rule.id, {
    expectedRevision: 2,
    name: '巴西重点工业客户',
    strategy: 'fixed_priority',
  }, admin);
  assert.equal(updated.rule.name, '巴西重点工业客户');
  assert.equal(updated.rule.strategy, 'fixed_priority');
  assert.throws(() => store.reorderDraft(
    [SYSTEM_DEFAULT_RULE_ID, created.rule.id, LEGACY_INITIAL_RULE_ID],
    3,
    admin,
  ), /系统默认规则必须排在最后/);
  const reordered = store.reorderDraft(
    [created.rule.id, LEGACY_INITIAL_RULE_ID, SYSTEM_DEFAULT_RULE_ID],
    3,
    admin,
  );
  assert.deepEqual(reordered.rules.map(rule => rule.id), [
    created.rule.id,
    LEGACY_INITIAL_RULE_ID,
    SYSTEM_DEFAULT_RULE_ID,
  ]);
  assert.equal(reordered.state.draftRevision, 4);
  db.close();
});

test('system fallback invariants cannot be disabled or converted into a selected rule', () => {
  const { db, store } = fixture();
  assert.throws(() => store.updateDraft(SYSTEM_DEFAULT_RULE_ID, {
    expectedRevision: 1,
    enabled: false,
  }, admin), /系统默认规则必须保持启用/);
  assert.throws(() => store.updateDraft(SYSTEM_DEFAULT_RULE_ID, {
    expectedRevision: 1,
    targetMode: 'selected',
    salesUserIds: ['S-WU'],
  }, admin), /系统默认规则必须保持启用/);
  db.close();
});

test('publish creates an immutable version and restore publishes a new version', () => {
  const { db, store } = fixture();
  const initial = store.getPublishedRules();
  const created = store.createDraft({
    ...selectedRule(),
    expectedRevision: 1,
  }, admin);
  const published = store.publish({ expectedRevision: 2 }, admin);
  assert.equal(published.version.versionNumber, 2);
  assert.equal(published.version.changeSummary.added[0].id, created.rule.id);
  assert.equal(store.getPublishedRules().rules.some(rule => rule.id === created.rule.id), true);
  assert.throws(() => store.publish({ expectedRevision: 2 }, admin), error =>
    error.statusCode === 409 && error.code === 'NO_ASSIGNMENT_RULE_CHANGES');
  const restored = store.restore(initial.publishedVersionId, { expectedRevision: 2 }, admin);
  assert.equal(restored.version.versionNumber, 3);
  assert.equal(restored.version.restoredFromVersionId, initial.publishedVersionId);
  assert.equal(restored.state.draftRevision, 3);
  assert.deepEqual(restored.rules.map(rule => rule.id), [
    LEGACY_INITIAL_RULE_ID,
    SYSTEM_DEFAULT_RULE_ID,
  ]);
  assert.equal(store.getPublishedRules().rules.some(rule => rule.id === created.rule.id), false);
  assert.equal(store.listVersions(admin).length, 3);
  db.close();
});

test('manager responses are read-only and redact candidate identities, quotas and version snapshots', () => {
  const { db, store } = fixture();
  const created = store.createDraft({
    ...selectedRule(),
    expectedRevision: 1,
  }, admin);
  const config = store.getConfig(manager);
  const rule = config.rules.find(item => item.id === created.rule.id);
  assert.equal(config.capabilities.canEdit, false);
  assert.equal(config.capabilities.canSimulate, true);
  assert.equal(rule.candidateCount, 2);
  assert.equal(rule.hasRuleQuota, true);
  assert.equal(Object.hasOwn(rule, 'salesUserIds'), false);
  assert.equal(Object.hasOwn(rule, 'dailyQuota'), false);
  const versions = store.listVersions(manager);
  assert.equal(Object.hasOwn(versions[0], 'rules'), false);
  assert.throws(() => store.updateDraft(created.rule.id, {
    expectedRevision: 2,
    name: '经理不能修改',
  }, manager), error => error.statusCode === 403);
  db.close();
});

test('sales cannot read rules and impersonating administrators cannot write or publish', () => {
  const { db, store } = fixture();
  assert.throws(() => store.getConfig(sales), error => error.statusCode === 403);
  assert.equal(store.getConfig({ id: 'A-BARE', role: 'admin' }).capabilities.canEdit, true);
  const impersonating = { ...admin, isImpersonating: true };
  const config = store.getConfig(impersonating);
  assert.equal(config.capabilities.canEdit, false);
  assert.throws(() => store.createDraft({
    ...selectedRule(),
    expectedRevision: 1,
  }, impersonating), error => error.statusCode === 403 && error.code === 'IMPERSONATION_ACTION_BLOCKED');
  assert.throws(() => store.publish({ expectedRevision: 1 }, impersonating), error =>
    error.statusCode === 403 && error.code === 'IMPERSONATION_ACTION_BLOCKED');
  db.close();
});

test('rule quota and round-robin cursor reservations are atomic and expose engine runtime shape', () => {
  const { db, store } = fixture();
  const versionId = store.getState().publishedVersionId;
  const first = store.reserveRuntime({
    ruleId: LEGACY_INITIAL_RULE_ID,
    versionId,
    salesUserId: 'S-WU',
    usageDate: '2026-07-29',
    dailyQuota: 2,
    expectedRoundRobinCursor: 0,
    nextRoundRobinCursor: 1,
  });
  assert.equal(first.assignedCount, 1);
  assert.equal(first.roundRobinCursor, 1);
  assert.throws(() => store.reserveRuntime({
    ruleId: LEGACY_INITIAL_RULE_ID,
    versionId,
    salesUserId: 'S-RU',
    usageDate: '2026-07-29',
    dailyQuota: 2,
    expectedRoundRobinCursor: 0,
    nextRoundRobinCursor: 1,
  }), error => error.statusCode === 409 && error.code === 'ASSIGNMENT_RULE_ROTATION_CONFLICT');
  store.reserveRuntime({
    ruleId: LEGACY_INITIAL_RULE_ID,
    versionId,
    salesUserId: 'S-WU',
    usageDate: '2026-07-29',
    dailyQuota: 2,
    expectedRoundRobinCursor: 1,
    nextRoundRobinCursor: 0,
  });
  assert.throws(() => store.reserveRuntime({
    ruleId: LEGACY_INITIAL_RULE_ID,
    versionId,
    salesUserId: 'S-WU',
    usageDate: '2026-07-29',
    dailyQuota: 2,
  }), error => error.statusCode === 409 && error.code === 'ASSIGNMENT_RULE_DAILY_QUOTA_REACHED');
  assert.deepEqual(store.loadRuntimeState({
    versionId,
    usageDate: '2026-07-29',
  }), {
    versionId,
    usageDate: '2026-07-29',
    dailyByRule: {
      [LEGACY_INITIAL_RULE_ID]: { 'S-WU': 2 },
    },
    roundRobinState: {
      [LEGACY_INITIAL_RULE_ID]: { cursor: 0 },
    },
  });
  db.close();
});

test('publishing a new version preserves rule quota usage and round-robin position', () => {
  const { db, store } = fixture();
  const firstVersionId = store.getState().publishedVersionId;
  store.reserveRuntime({
    ruleId: LEGACY_INITIAL_RULE_ID,
    versionId: firstVersionId,
    salesUserId: 'S-WU',
    usageDate: '2026-07-29',
    dailyQuota: 2,
    expectedRoundRobinCursor: 0,
    nextRoundRobinCursor: 1,
  });
  store.updateDraft(LEGACY_INITIAL_RULE_ID, {
    expectedRevision: 1,
    name: '更新后的国家与匹配等级规则',
  }, admin);
  const secondVersionId = store.publish({ expectedRevision: 2 }, admin).state.publishedVersionId;
  assert.notEqual(secondVersionId, firstVersionId);
  assert.deepEqual(store.loadRuntimeState({
    versionId: secondVersionId,
    usageDate: '2026-07-29',
  }).dailyByRule, {
    [LEGACY_INITIAL_RULE_ID]: { 'S-WU': 1 },
  });
  assert.deepEqual(store.loadRuntimeState({
    versionId: secondVersionId,
    usageDate: '2026-07-29',
  }).roundRobinState, {
    [LEGACY_INITIAL_RULE_ID]: { cursor: 1 },
  });
  assert.equal(store.reserveRuntime({
    ruleId: LEGACY_INITIAL_RULE_ID,
    versionId: secondVersionId,
    salesUserId: 'S-WU',
    usageDate: '2026-07-29',
    dailyQuota: 2,
    expectedRoundRobinCursor: 1,
    nextRoundRobinCursor: 0,
  }).assignedCount, 2);
  assert.throws(() => store.reserveRuntime({
    ruleId: LEGACY_INITIAL_RULE_ID,
    versionId: secondVersionId,
    salesUserId: 'S-WU',
    usageDate: '2026-07-29',
    dailyQuota: 2,
  }), error => error.statusCode === 409 && error.code === 'ASSIGNMENT_RULE_DAILY_QUOTA_REACHED');
  assert.deepEqual(db.prepare(`SELECT rule_version_id,assigned_count
    FROM crm_intake_assignment_rule_usage
    WHERE rule_id=? AND sales_user_id=? AND usage_date=?
    ORDER BY rule_version_id`).all(LEGACY_INITIAL_RULE_ID, 'S-WU', '2026-07-29')
    .map(row => row.assigned_count), [1, 1]);
  assert.deepEqual(db.prepare(`SELECT DISTINCT cursor
    FROM crm_intake_assignment_rule_rotation WHERE rule_id=?`)
    .all(LEGACY_INITIAL_RULE_ID), [{ cursor: 0 }]);
  db.close();
});

test('manager simulation projection keeps the result and reason without candidate identities or quotas', () => {
  const decision = {
    disposition: 'assign',
    assignable: true,
    managerReview: false,
    selectedUserId: 'S-WU',
    userId: 'S-WU',
    ruleId: 'RULE-BR',
    ruleName: '巴西规则',
    ruleVersionId: 'RULEVER-2',
    strategy: 'balanced',
    reasonCode: 'rule_balanced',
    reason: '命中规则“巴西规则”',
    candidateUserIds: ['S-WU', 'S-RU'],
    eligibleUserIds: ['S-WU'],
    excludedCandidates: [{
      userId: 'S-RU',
      reasonCode: 'daily_quota_reached',
      reason: '销售已达到每日额度 4',
      dailyAssigned: 4,
      dailyQuota: 4,
    }],
    matchedRule: {
      id: 'RULE-BR',
      name: '巴西规则',
      versionId: 'RULEVER-2',
      versionNumber: 2,
      strategy: 'balanced',
      targetMode: 'selected',
      dailyQuota: 4,
      isSystemDefault: false,
      match: { fields: { countries: { matched: true } } },
    },
  };
  assert.equal(assignmentDecisionForActor(decision, admin), decision);
  const visible = assignmentDecisionForActor(decision, manager);
  assert.equal(visible.selectedUserId, 'S-WU');
  assert.equal(visible.candidateCount, 2);
  assert.equal(visible.eligibleCandidateCount, 1);
  assert.deepEqual(visible.excludedReasonCounts, { daily_quota_reached: 1 });
  assert.equal(Object.hasOwn(visible, 'candidateUserIds'), false);
  assert.equal(Object.hasOwn(visible, 'excludedCandidates'), false);
  assert.equal(Object.hasOwn(visible.matchedRule, 'dailyQuota'), false);
});
