'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeActivityReactionName,
  activityReactionNameKey,
  legacyProgressKey,
  scopedActivityProvenance,
} = require('../lib/domains/activity/present');
const {
  ACTIVITY_STAGE,
  PROGRESS_TYPE_MAP,
  resolveActivityRequestSpec,
} = require('../lib/domains/activity/progress');
const { publicActivityRecord, publicActivityRecords } = require('../lib/domains/activity/serialize');
const { resolveActivityReaction } = require('../lib/domains/activity/request');
const { noPlanStreakForActivities } = require('../lib/domains/planning/streak');
const { reasonOrder, urgencyFor, groupAlerts } = require('../lib/domains/planning/alerts');
const { emptyCustomerPlanRisk } = require('../lib/domains/planning/risk');
const { intakeQueryValues, intakeQueryBoolean, intakeQueryDate } = require('../lib/domains/intake/query');
const { chooseIntakeOwner } = require('../lib/domains/intake/owner');
const { validateMargin, validateRfqPayload, commerceActionIdempotencyKey } = require('../lib/domains/commerce/rules');
const { isCurrentIntakeAccount, isReturnedAccountForIntake, reusableReturnedAccountForIntake } = require('../lib/domains/assignment/link');
const { buildCountryReport, buildCohortReport, buildTeamReport } = require('../lib/domains/reporting/builders');
const { csvCell, csvSerialize } = require('../lib/domains/reporting/csv');
const { advanceStage } = require('../lib/domains/commerce/rules');
const { identityConflictNote } = require('../lib/domains/customer/identity');
const { parseMismatchRecordKey, mismatchRecordNotFound } = require('../lib/domains/customer/recycle');
const { safeEvaluationLabel } = require('../lib/domains/insights/labels');
const { normalizeEvaluation, withoutEvaluationAI, withoutEvaluationAIRow, aiFeatureDisabled } = require('../lib/domains/insights/evaluation');
const { serializeArbitrationDecision, withoutArbitrationAI, serializeRecommendation } = require('../lib/domains/intake/decision');
const { duplicateFingerprint, hydrateDuplicateCandidate, reviewCandidateRows, reviewHasProtectedExact } = require('../lib/domains/customer/dedupe');
const { redactAuditPayload } = require('../lib/domains/audit/redact');
const { normalizeActivityActionQueueKey, publicActivityReaction, escapeActivitySearchLike } = require('../lib/domains/activity/present');
const { hashPassword } = require('../lib/domains/auth/credentials');
const { parseCookies } = require('../lib/domains/auth/session');
const { safeUser } = require('../lib/domains/auth/user');
const { intakeActionIdempotencyKey, manualAssignmentRequestHash, manualAssignmentRequiresPreview } = require('../lib/domains/intake/assignment');
const { normalizeListQuery, listPage } = require('../lib/domains/list/pagination');
const { json, parseJsonObject } = require('../lib/domains/json/parse');

const {
  normalizeCountry,
  normalizeEstablishedYear,
  normalizeAccountNickname,
  normalizeCustomerStarReason,
} = require('../lib/domains/customer/normalize');
const { validateRecycleReason } = require('../lib/domains/customer/recycle');
const { customerCreateRequestHash } = require('../lib/domains/customer/create');
const { creatorDisplayName, historyAccountSummary, changedFieldLabels } = require('../lib/domains/customer/summary');
const { publicAccountContact, cleanContactFields } = require('../lib/domains/customer/contacts');

test('normalizeCountry maps aliases and preserves unknown values', () => {
  assert.equal(normalizeCountry('ru'), '俄罗斯');
  assert.equal(normalizeCountry('RUSSIA'), '俄罗斯');
  assert.equal(normalizeCountry(' br '), '巴西');
  assert.equal(normalizeCountry('us'), '美国');
  assert.equal(normalizeCountry('kz'), '哈萨克斯坦');
  assert.equal(normalizeCountry('德国'), '德国');
  assert.equal(normalizeCountry('未知国家'), '未知国家');
  assert.equal(normalizeCountry(''), '');
});

test('normalizeEstablishedYear accepts four-digit years within range', () => {
  assert.equal(normalizeEstablishedYear(''), null);
  assert.equal(normalizeEstablishedYear('  '), null);
  assert.equal(normalizeEstablishedYear('2020'), 2020);
  assert.equal(normalizeEstablishedYear('1000'), 1000);
});

test('normalizeEstablishedYear rejects invalid years with the injected error', () => {
  const badRequest = message => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  };
  assert.throws(() => normalizeEstablishedYear('999', { badRequest }), error => {
    assert.equal(error.statusCode, 400);
    assert.match(error.message, /成立年份/);
    return true;
  });
  assert.throws(() => normalizeEstablishedYear('20201', { badRequest }), /成立年份/);
  assert.throws(() => normalizeEstablishedYear('2025', {
    badRequest, now: new Date('2024-06-01T00:00:00Z'),
  }), /成立年份/);
});

test('normalizeAccountNickname trims and enforces the 40-character limit', () => {
  assert.equal(normalizeAccountNickname(''), '');
  assert.equal(normalizeAccountNickname(null), '');
  assert.equal(normalizeAccountNickname('  昵称  '), '昵称');
  assert.equal(normalizeAccountNickname('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十'), '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十');
});

test('normalizeAccountNickname rejects blank, control, and oversized values', () => {
  const badRequest = message => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  };
  assert.throws(() => normalizeAccountNickname('   ', { badRequest }), error => {
    assert.equal(error.statusCode, 400);
    assert.match(error.message, /不能只包含空白/);
    return true;
  });
  assert.throws(() => normalizeAccountNickname('a\u0000b', { badRequest }), /控制字符/);
  assert.throws(() => normalizeAccountNickname('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一', { badRequest }), /最多40/);
});

test('normalizeCustomerStarReason collapses whitespace and enforces limits', () => {
  assert.equal(normalizeCustomerStarReason(''), '');
  assert.equal(normalizeCustomerStarReason('  重点  客户  '), '重点 客户');
  const badRequest = message => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  };
  assert.throws(() => normalizeCustomerStarReason('a\u0000b', { badRequest }), /控制字符/);
  assert.throws(() => normalizeCustomerStarReason('a'.repeat(101), { badRequest }), /最多100/);
});

test('validateRecycleReason accepts 2-500 characters and rejects out-of-range values', () => {
  const httpError = (statusCode, message, code) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
  };
  assert.equal(validateRecycleReason(' 退回 '), '退回');
  assert.equal(validateRecycleReason('x'.repeat(500)), 'x'.repeat(500));
  assert.throws(() => validateRecycleReason('x', { httpError }), error => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'INVALID_RECYCLE_REASON');
    assert.match(error.message, /2至500/);
    return true;
  });
  assert.throws(() => validateRecycleReason('x'.repeat(501), { httpError }), /2至500/);
});

test('customerCreateRequestHash is stable and ignores the client idempotency key', () => {
  const user = { id: 'U-1' };
  const payload = { companyName: 'Firm', country: '俄罗斯' };
  const first = customerCreateRequestHash(user, payload);
  assert.equal(customerCreateRequestHash(user, { ...payload, idempotencyKey: 'a' }), first);
  assert.equal(customerCreateRequestHash(user, { ...payload, idempotencyKey: 'b' }), first);
  assert.notEqual(customerCreateRequestHash({ id: 'U-2' }, payload), first);
  assert.notEqual(customerCreateRequestHash(user, { ...payload, country: '巴西' }), first);
});

test('changedFieldLabels maps account labels and falls back to raw field names', () => {
  assert.deepEqual(changedFieldLabels({ nickname: { from: '', to: '新昵称' } }, 'to'),
    { 昵称: '新昵称' });
  assert.deepEqual(changedFieldLabels({ establishedYear: { from: 0, to: 2020 } }, 'from'),
    { 成立年份: 0 });
  assert.deepEqual(changedFieldLabels({ unknownField: { from: 'a', to: 'b' } }, 'to'),
    { unknownField: 'b' });
  assert.deepEqual(changedFieldLabels(null, 'to'), {});
});

test('publicAccountContact maps labels, source, and ids consistently', () => {
  const contact = publicAccountContact({
    id: 'CON-1', customer_id: 'CRM-1', external_customer_id: 'RU-1',
    name: 'Buyer', title: 'Procurement', department: 'Purchasing',
    phone: '+7', email: 'b@x.test', social: '',
    match_status: 'match', procurement_role: 'yes', work_content: 'engine',
    source_type: 'recon', created_by: 'U-1', updated_by: '',
    created_at: 't', updated_at: 't', archived_at: '',
  });
  assert.equal(contact.id, 'local:CON-1');
  assert.equal(contact.rawId, 'CON-1');
  assert.equal(contact.matchStatusLabel, '对口');
  assert.equal(contact.procurementRoleLabel, '负责采购');
  assert.equal(contact.sourceLabel, '联系人研究');
  assert.equal(contact.updatedBy, 'U-1');
  assert.equal(contact.archivedAt, '');
  assert.equal(publicAccountContact({ match_status: 'x', procurement_role: 'x', source_type: 'manual' }).matchStatusLabel, '待确认');
});

test('activity reaction name normalization collapses whitespace and enforces limits', () => {
  const badRequest = message => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  };
  assert.equal(normalizeActivityReactionName('  有兴趣  跟进  '), '有兴趣 跟进');
  assert.throws(() => normalizeActivityReactionName('', { badRequest }), /不能为空/);
  assert.throws(() => normalizeActivityReactionName('a\u0000b', { badRequest }), /控制字符/);
  assert.throws(() => normalizeActivityReactionName('  ', { badRequest }), /不能为空/);
  assert.throws(() => normalizeActivityReactionName('a'.repeat(41), { badRequest }), /最多40/);
});

test('activity reaction name key lowercases in zh-CN and preserves whitespace folding', () => {
  assert.equal(activityReactionNameKey('有兴趣'), '有兴趣');
  assert.equal(activityReactionNameKey('A B'), 'a b');
});

test('legacyProgressKey maps social channels and falls back for others', () => {
  assert.equal(legacyProgressKey('email', 'email'), 'email');
  assert.equal(legacyProgressKey('social', 'WhatsApp'), 'whatsapp');
  assert.equal(legacyProgressKey('social', 'Telegram'), 'telegram');
  assert.equal(legacyProgressKey('social', 'LinkedIn'), 'linkedin');
  assert.equal(legacyProgressKey('social', '展会'), 'social');
  assert.equal(legacyProgressKey('note', 'other'), 'note');
});

test('scopedActivityProvenance hides replacement ids that are not visible', () => {
  const visible = new Set(['ACT-1']);
  const superseded = { kind: 'superseded_original', replacementActivityId: 'ACT-9', replacementCustomerId: 'CRM-9' };
  assert.deepEqual(scopedActivityProvenance({ provenance: superseded, superseded_by: 'ACT-9' }, visible), {
    kind: 'superseded_original', replacementActivityId: '', replacementCustomerId: '',
  });
  assert.deepEqual(scopedActivityProvenance({ provenance: { ...superseded, replacementActivityId: 'ACT-1' }, superseded_by: 'ACT-1' }, visible), {
    kind: 'superseded_original', replacementActivityId: 'ACT-1', replacementCustomerId: 'CRM-9',
  });
  const replacement = { kind: 'replacement', originalActivityId: 'ACT-9', originalCustomerId: 'CRM-9' };
  assert.deepEqual(scopedActivityProvenance({ provenance: replacement }, visible), {
    kind: 'replacement', originalActivityId: '', originalCustomerId: '',
  });
  assert.equal(scopedActivityProvenance({ provenance: null }, visible), null);
});

test('resolveActivityRequestSpec resolves modern progress keys with legacy=false', () => {
  const spec = resolveActivityRequestSpec({ progressType: 'meeting' });
  assert.equal(spec.progressKey, 'meeting');
  assert.equal(spec.activityType, 'meeting');
  assert.equal(spec.channel, 'video');
  assert.equal(spec.proposedStage, 'meeting');
  assert.equal(spec.legacy, false);
  const badRequest = message => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  };
  assert.throws(() => resolveActivityRequestSpec({ progressType: 'bogus' }, { badRequest }), /不支持的本次进展类型/);
});

test('resolveActivityRequestSpec validates legacy activity types and channels', () => {
  const badRequest = message => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  };
  const spec = resolveActivityRequestSpec({ activityType: 'social', channel: 'WhatsApp' });
  assert.equal(spec.progressKey, 'whatsapp');
  assert.equal(spec.channel, 'WhatsApp');
  assert.equal(spec.proposedStage, 'connected');
  assert.equal(spec.legacy, true);
  assert.throws(() => resolveActivityRequestSpec({ activityType: 'bogus' }, { badRequest }), /请选择有效的本次进展/);
  assert.throws(() => resolveActivityRequestSpec({ activityType: 'email', channel: 'chip' }, { badRequest }), /不支持的进展渠道/);
});

test('progress constants mirror the request-spec stage mapping', () => {
  assert.equal(ACTIVITY_STAGE.meeting, 'meeting');
  assert.equal(PROGRESS_TYPE_MAP.whatsapp.channel, 'WhatsApp');
});

test('publicActivityRecord serializes progress, reaction, and provenance consistently', () => {
  const record = publicActivityRecord({
    id: 'ACT-1', customer_id: 'CRM-1', user_id: 'U-1', activity_type: 'social',
    channel: 'WhatsApp', outcome: 'aws', progress_key: 'whatsapp',
    reaction_option_id: 'R-1', reaction_label_snapshot: '有回复',
    next_action: '跟进', next_action_at: 't', manager_required: 1, no_plan: 1,
    superseded_at: 't', superseded_by: 'ACT-9', is_test_data: 0,
    provenance: { kind: 'superseded_original', replacementActivityId: 'ACT-9', replacementCustomerId: 'CRM-9' },
  }, new Set(['ACT-1']));
  assert.equal(record.progressType, 'whatsapp');
  assert.equal(record.activityType, 'social');
  assert.equal(record.reactionSnapshot, '有回复');
  assert.equal(record.managerRequired, true);
  assert.equal(record.noPlan, true);
  assert.equal(record.supersededBy, '');
  assert.equal(record.provenance.replacementActivityId, '');
  assert.equal(typeof record.effective, 'boolean');
  assert.equal(record.reaction_label_snapshot, '有回复', 'raw snake_case keys are preserved in the public row');
});

test('resolveActivityReaction resolves custom, by-id, and by-key reactions', () => {
  const badRequest = message => { const e = new Error(message); e.statusCode = 400; return e; };
  const conflictError = (message, code) => { const e = new Error(message); e.statusCode = 409; e.code = code; return e; };
  const opts = { badRequest, conflictError };
  assert.deepEqual(resolveActivityReaction({ reactionCustom: '自定义' }, { ...opts,
    findReactionById: () => null, findReactionByKey: () => null }), { id: '', name: '自定义' });
  assert.throws(() => resolveActivityReaction({ reactionCustom: 'x', reactionOptionId: 'R1' }, { ...opts }),
    /不能与标准选项同时提交/);

  const byId = { id: 'R1', name: '有兴趣' };
  assert.deepEqual(resolveActivityReaction({ reactionOptionId: 'R1' }, { ...opts,
    findReactionById: () => byId, findReactionByKey: () => null }), { id: 'R1', name: '有兴趣' });

  const byKey = { id: 'R2', name: '有兴趣' };
  assert.deepEqual(resolveActivityReaction({ outcome: '有兴趣' }, { ...opts,
    findReactionById: () => null, findReactionByKey: () => byKey }), { id: 'R2', name: '有兴趣' });

  assert.deepEqual(resolveActivityReaction({}, { ...opts,
    findReactionById: () => null, findReactionByKey: () => null }), { id: '', name: '' });
});

test('resolveActivityReaction surfaces stale, invalid, and mismatch errors', () => {
  const badRequest = message => { const e = new Error(message); e.statusCode = 400; return e; };
  const conflictError = (message, code) => { const e = new Error(message); e.statusCode = 409; e.code = code; return e; };
  const opts = { badRequest, conflictError };
  assert.throws(() => resolveActivityReaction({ reactionOptionId: 'R1' }, { ...opts,
    findReactionById: () => null }), error => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, 'ACTIVITY_REACTION_STALE');
    return true;
  });
  assert.throws(() => resolveActivityReaction({ outcome: '无效' }, { ...opts,
    findReactionByKey: () => null }), /请选择有效的客户反应/);
  const different = { id: 'R9', name: '其他' };
  assert.throws(() => resolveActivityReaction({ reactionOptionId: 'R1', outcome: '有兴趣' }, { ...opts,
    findReactionById: () => ({ id: 'R1', name: '有兴趣' }), findReactionByKey: () => different }), /与文字不一致/);
});

test('noPlanStreakForActivities counts trailing no-plan activities in time order', () => {
  const mk = (id, at, no) => ({ id, occurred_at: at, no_plan: no });
  const streak = noPlanStreakForActivities([
    mk('A1', '2026-08-20 10:00:00', 0),
    mk('A2', '2026-08-21 10:00:00', 1),
    mk('A3', '2026-08-22 10:00:00', 1),
    mk('A4', '2026-08-23 10:00:00', 1),
  ]);
  assert.equal(streak.count, 3);
  assert.equal(streak.streakStartId, 'A2');
});

test('noPlanStreakForActivities stops at a planned activity and ignores test data', () => {
  const mk = (id, at, no, test) => ({ id, occurred_at: at, no_plan: no, is_test_data: test });
  const streak = noPlanStreakForActivities([
    mk('A1', '2026-08-20 10:00:00', 0, 0),
    mk('A2', '2026-08-21 10:00:00', 1, 1),
    mk('A3', '2026-08-22 10:00:00', 0, 0),
  ]);
  assert.equal(streak.count, 0);
  assert.equal(streak.streakStartId, '');
  assert.equal(noPlanStreakForActivities([]).count, 0);
});

test('reasonOrder and urgencyFor derive alert priority buckets', () => {
  assert.equal(reasonOrder({ code: 'OVERDUE', customerPriority: 'A', overdueHours: 80 }), 40);
  assert.equal(reasonOrder({ code: 'OVERDUE', customerPriority: 'C', overdueHours: 80 }), 70);
  assert.equal(reasonOrder({ code: 'UNKNOWN' }), 999);
  assert.equal(urgencyFor({ code: 'OVERDUE', customerPriority: 'A', overdueHours: 80 }), 'immediate');
  assert.equal(urgencyFor({ code: 'NO_NEXT' }), 'today');
  assert.equal(urgencyFor({ code: 'STALE' }), 'attention');
});

test('groupAlerts merges overdue-claim siblings and orders groups by urgency', () => {
  const base = { customerId: 'CRM-1', id: 'A', code: 'UNCLAIMED', intakeItemId: 'I-1', overdueHours: 2, updatedAt: 't', companyName: 'X', title: '未认领' };
  const grouped = groupAlerts([
    { ...base, code: 'UNCLAIMED', title: '未认领' },
    { ...base, code: 'UNCLAIMED_LEAD', title: '未认领线索', customerPriority: 'B' },
    { ...base, code: 'STALE', id: 'B', title: '过期', customerPriority: 'A' },
  ]);
  assert.equal(grouped.length, 1);
  const group = grouped[0];
  assert.equal(group.reasonCount, 2, 'overdue claims merge into one semantic reason');
  assert.equal(group.maxOverdueHours, 2);
});

test('emptyCustomerPlanRisk builds the no-risk fallback frame', () => {
  const risk = emptyCustomerPlanRisk({ customerId: 'CRM-1' }, { id: 'CRM-1', external_customer_id: 'RU-1', owner_id: 'U-1' });
  assert.equal(risk.customerId, 'RU-1');
  assert.equal(risk.accountId, 'CRM-1');
  assert.equal(risk.currentOwnerId, 'U-1');
  assert.equal(risk.state, 'none');
  assert.equal(risk.currentConsecutiveDeferredCount, 0);
  assert.deepEqual(risk.history, []);
});

test('intakeQueryValues normalizes and dedupes list params', () => {
  assert.deepEqual(intakeQueryValues('A,,B,B'), ['A', 'B']);
  assert.deepEqual(intakeQueryValues(['C', ' C ', 'D', 'c']), ['C', 'D', 'c']);
  assert.deepEqual(intakeQueryValues([], 3), []);
  assert.deepEqual(intakeQueryValues('a,b,c,d', 3), ['a', 'b', 'c']);
});

test('intakeQueryBoolean and intakeQueryDate map query flags and dates', () => {
  assert.equal(intakeQueryBoolean('1'), true);
  assert.equal(intakeQueryBoolean('no'), false);
  assert.equal(intakeQueryBoolean('maybe'), null);
  assert.equal(intakeQueryDate(''), '');
  assert.equal(intakeQueryDate('2026-08-28'), '2026-08-28 00:00:00');
  assert.equal(intakeQueryDate('2026-08-28', true), '2026-08-28 23:59:59');
  assert.equal(intakeQueryDate('28/08/2026'), '');
});

test('chooseIntakeOwner scores country, language, channel, and load deterministically', () => {
  const users = [
    { id: 'U-1', role: 'sales', active: 1, countries_json: '["俄罗斯"]', languages_json: '["中文","俄语"]', channels_json: '["邮件"]' },
    { id: 'U-2', role: 'sales', active: 1, countries_json: '[]', languages_json: '[]', channels_json: '[]' },
    { id: 'U-3', role: 'manager', active: 1, countries_json: '[]', languages_json: '[]', channels_json: '[]' },
    { id: 'U-4', role: 'sales', active: 0, countries_json: '[]', languages_json: '[]', channels_json: '[]' },
  ];
  const winner = chooseIntakeOwner({ country: '俄罗斯', contact_methods: 'email' }, users, { 'U-1': 1 }, { 'U-1': 0 });
  assert.equal(winner.userId, 'U-1');
  assert.match(winner.reason, /国家经验：俄罗斯/);
  assert.match(winner.reason, /俄语能力/);
  const balanced = chooseIntakeOwner({ country: '未知' }, users);
  assert.ok(balanced, 'unmatched candidates still pick by load balance');
  assert.equal(balanced.userId, 'U-1');
  assert.equal(balanced.reason, '按当前负荷均衡分配');
});

test('validateMargin clamps gross margin to the allowed range', () => {
  const badRequest = message => { const e = new Error(message); e.statusCode = 400; return e; };
  assert.equal(validateMargin('8.35', false, { badRequest }), 8.4);
  assert.equal(validateMargin('-2.5', true, { badRequest }), -2.5);
  assert.throws(() => validateMargin('200', false, { badRequest }), /毛利率/);
  assert.throws(() => validateMargin('-5', false, { badRequest }), /毛利率/);
});

test('validateRfqPayload validates bom lines, expected value, and completeness', () => {
  const badRequest = message => { const e = new Error(message); e.statusCode = 400; return e; };
  assert.doesNotThrow(() => validateRfqPayload({ bomLines: 10, expectedValue: 1000, completeness: 80 }, { badRequest }));
  assert.throws(() => validateRfqPayload({ bomLines: -1 }, { badRequest }), /BOM 行数/);
  assert.throws(() => validateRfqPayload({ expectedValue: -5 }, { badRequest }), /预估金额/);
  assert.throws(() => validateRfqPayload({ completeness: 101 }, { badRequest }), /完整度/);
});

test('commerceActionIdempotencyKey prefers a client key and derives a hash otherwise', () => {
  const user = { id: 'U-1' };
  const payload = { amount: 100, currency: 'USD' };
  assert.equal(commerceActionIdempotencyKey(user, 'order', { ...payload, idempotencyKey: 'k1' }, 'CRM-1'), 'k1');
  assert.equal(commerceActionIdempotencyKey(user, 'order', { ...payload, clientRequestId: 'c1' }, 'CRM-1'), 'c1');
  const hash = commerceActionIdempotencyKey(user, 'order', payload, 'CRM-1');
  assert.match(hash, /^commerce:/);
  assert.equal(commerceActionIdempotencyKey(user, 'order', payload, 'CRM-1'), hash);
  assert.notEqual(commerceActionIdempotencyKey(user, 'quote', payload, 'CRM-1'), hash);
});

test('assignment link predicates match current and reused returned accounts', () => {
  const item = { id: 'I-1', external_customer_id: 'RU-1' };
  const linked = { id: 'CRM-1', intake_item_id: 'I-1', lifecycle_status: 'active', assignment_status: 'returned' };
  assert.equal(isCurrentIntakeAccount(linked, item), true);
  assert.equal(isReturnedAccountForIntake(linked, item), true);
  assert.equal(isCurrentIntakeAccount({ id: 'CRM-9', intake_item_id: 'X' }, item), false);
  assert.equal(isReturnedAccountForIntake({ id: 'CRM-1', intake_item_id: 'I-1', lifecycle_status: 'recycled', recycle_kind: 'manual_delete' }, item), false);
  assert.equal(reusableReturnedAccountForIntake([linked], item).id, 'CRM-1');
  assert.equal(reusableReturnedAccountForIntake([{ id: 'CRM-2', external_customer_id: 'RU-1', lifecycle_status: 'recycled', recycle_kind: 'sales_return' }], item).id, 'CRM-2');
  assert.equal(reusableReturnedAccountForIntake([{ id: 'CRM-3', external_customer_id: 'RU-1', lifecycle_status: 'active' }], item), null);
});

test('cleanContactFields trims, truncates, and enforces enum defaults', () => {
  const cleaned = cleanContactFields({
    name: ' A ', title: 'B', department: 'x'.repeat(300), phone: 'P', email: 'e',
    social: 's', matchStatus: 'match', procurementRole: 'no', workContent: 'w',
  });
  assert.equal(cleaned.name, 'A');
  assert.equal(cleaned.department.length, 160);
  assert.equal(cleaned.matchStatus, 'match');
  assert.equal(cleaned.procurementRole, 'no');
  const defaults = cleanContactFields({});
  assert.equal(defaults.matchStatus, 'pending');
  assert.equal(defaults.procurementRole, 'pending');
  assert.equal(defaults.workContent, '');
});

function reportingRows() {
  const accounts = [{ id: 'CRM-1', country: '俄罗斯', stage: 'won', assigned_at: '2026-08-01 10:00:00' }];
  const activities = [
    { customer_id: 'CRM-1', activity_type: 'email' },
    { customer_id: 'CRM-1', activity_type: 'reply' },
    { customer_id: 'CRM-1', activity_type: 'meeting' },
    { customer_id: 'CRM-1', activity_type: 'rfq' },
  ];
  const orders = [{ customer_id: 'CRM-1', amount: 1000, gross_margin: 10, is_repeat: 0 }];
  return { accounts, activities, orders };
}

test('buildCountryReport aggregates accounts and derives funnel rates', () => {
  const reports = buildCountryReport(...Object.values(reportingRows()));
  assert.equal(reports.length, 1);
  const row = reports[0];
  assert.equal(row.accounts, 1);
  assert.equal(row.contacted, 1);
  assert.equal(row.replied, 1);
  assert.equal(row.meetings, 1);
  assert.equal(row.orders, 1);
  assert.equal(row.revenue, 1000);
  assert.equal(row.grossProfit, 100);
  assert.equal(row.contactRate, 100);
  assert.equal(row.sampleStatus, '样本不足');
});

test('buildCohortReport groups by month and computes stage-based rates', () => {
  const reports = buildCohortReport(...Object.values(reportingRows()));
  assert.equal(reports.length, 1);
  const row = reports[0];
  assert.equal(row.cohort, '2026-08');
  assert.equal(row.contacted, 1);
  assert.equal(row.replied, 1);
  assert.equal(row.meetings, 1);
  assert.equal(row.ordered, 1);
  assert.equal(row.revenue, 1000);
  assert.equal(row.contactRate, 100);
});

test('publicActivityRecords applies a shared visible-id set across the batch', () => {
  const records = publicActivityRecords([
    { id: 'ACT-1', activity_type: 'email', channel: 'email', superseded_by: '' },
    { id: 'ACT-2', activity_type: 'note', channel: 'other', superseded_by: 'ACT-1' },
  ]);
  assert.equal(records[1].supersededBy, 'ACT-1');
  assert.equal(records[0].effective, true);
});

test('creatorDisplayName resolves system, named, and unknown creators', () => {
  assert.equal(creatorDisplayName({ created_by: 'system' }), '系统导入');
  assert.equal(creatorDisplayName({ created_by: 'U-1', creator_name: 'Anna' }), 'Anna');
  assert.equal(creatorDisplayName({ created_by: 'U-1' }), '历史数据/未知');
  assert.equal(creatorDisplayName(null), '历史数据/未知');
});

test('historyAccountSummary maps account rows to the development-history shape', () => {
  assert.deepEqual(historyAccountSummary({
    company_name: ' Firm ', nickname: ' 昵称 ', external_customer_id: 'RU-1',
    country: '俄罗斯', stage: 'meeting', assignment_status: 'claimed',
    lifecycle_status: 'active',
  }), {
    companyName: 'Firm', nickname: '昵称', externalCustomerId: 'RU-1',
    country: '俄罗斯', stageLabel: '深度沟通', status: 'CRM 客户',
  });
  assert.equal(historyAccountSummary({
    assignment_status: 'returned', lifecycle_status: 'recycled', stage: 'unknown-stage',
  }).status, '已退回线索池');
  assert.equal(historyAccountSummary({
    assignment_status: 'claimed', lifecycle_status: 'recycled', stage: 'unknown-stage',
  }).status, '历史客户');
  assert.equal(historyAccountSummary({ stage: 'unknown-stage' }).stageLabel, 'unknown-stage');
});

test('safeEvaluationLabel sanitizes suspicious evaluation labels', () => {
  assert.equal(safeEvaluationLabel(' 已深度 沟通 '), '已深度 沟通');
  assert.equal(safeEvaluationLabel('a'.repeat(50)).length, 40);
  assert.equal(safeEvaluationLabel('email@example.com'), '');
  assert.equal(safeEvaluationLabel('https://evil.example/x'), '');
  assert.equal(safeEvaluationLabel('www.evil.example'), '');
  assert.equal(safeEvaluationLabel('1234567890123'), '');
  assert.equal(safeEvaluationLabel({ name: ' 有效 标签 ' }), '有效 标签');
  assert.equal(safeEvaluationLabel(''), '');
  assert.equal(safeEvaluationLabel(undefined), '');
  assert.equal(safeEvaluationLabel(null), '');
});

test('csvCell sanitizes formulas and quotes separators while csvSerialize renders a BOM document', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('=SUM(A1)'), `'=SUM(A1)`);
  assert.equal(csvCell('+123'), `'+123`);
  assert.equal(csvCell('-bad'), `'-bad`);
  assert.equal(csvCell('@mention'), `'@mention`);
  assert.equal(csvCell('  =leading'), `'  =leading`);
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '0');
  const document = csvSerialize(['名称', '备注'], [['ACME, Inc.', '=x'], ['中 "引" 号', 'ok']]);
  assert.equal(document, '\uFEFF名称,备注\r\n"ACME, Inc.",\'=x\r\n"中 ""引"" 号",ok\r\n');
});

test('advanceStage enforces monotonic stage progression', () => {
  assert.equal(advanceStage('new', 'meeting'), 'meeting');
  assert.equal(advanceStage('meeting', 'new'), 'meeting');
  assert.equal(advanceStage('meeting', ''), 'meeting');
  assert.equal(advanceStage('new', 'lost'), 'lost');
  assert.equal(advanceStage('lost', 'meeting'), 'meeting');
  assert.equal(advanceStage('won', 'lost'), 'lost');
});

test('identityConflictNote extracts a trimmed note from string or reason envelope', () => {
  assert.equal(identityConflictNote('  hello  '), 'hello');
  assert.equal(identityConflictNote({ reason: ' 重复 公司 ' }), '重复 公司');
  assert.equal(identityConflictNote({ reason: '' }), '');
  assert.equal(identityConflictNote({}), '');
  assert.equal(identityConflictNote(null), '');
  assert.equal(identityConflictNote(undefined), '');
});

test('parseMismatchRecordKey parses account and intake keys and rejects malformed ones', () => {
  assert.deepEqual(parseMismatchRecordKey('account:CRM-1'), { sourceType: 'account', sourceId: 'CRM-1', recordKey: 'account:CRM-1' });
  assert.deepEqual(parseMismatchRecordKey('intake:IN-2'), { sourceType: 'intake', sourceId: 'IN-2', recordKey: 'intake:IN-2' });
  assert.deepEqual(parseMismatchRecordKey('  account:CRM-3  '), { sourceType: 'account', sourceId: 'CRM-3', recordKey: 'account:CRM-3' });
  for (const bad of ['', 'account', 'account:', 'other:CRM-1', 'a:b:c', '  ']) {
    assert.throws(() => parseMismatchRecordKey(bad), { message: '不对口记录不存在' });
  }
  const capture = [];
  const notFound = mismatchRecordNotFound({ httpError: (statusCode, message, code) => {
    capture.push([statusCode, message, code]);
    return { statusCode, message, code };
  } });
  assert.deepEqual(capture, [[404, '不对口记录不存在', 'MISMATCH_RECORD_NOT_FOUND']]);
  assert.equal(notFound.statusCode, 404);
});

test('duplicateFingerprint is deterministic and legacy rule versions keep the v1 contract', () => {
  const input = {
    companyName: ' Acme ', website: 'https://acme.example', country: '俄罗斯',
    city: '莫斯科', industry: '连接器', customerType: '渠道', nickname: 'Acme', russianName: '', englishName: 'Acme',
  };
  assert.equal(duplicateFingerprint(input), duplicateFingerprint(input));
  assert.notEqual(duplicateFingerprint(input), duplicateFingerprint(input, 'legacy-v1'));
  assert.equal(duplicateFingerprint({ companyName: 'Acme', country: '俄罗斯' }), duplicateFingerprint({ companyName: ' Acme ', country: ' 俄罗斯 ' }));
  assert.equal(duplicateFingerprint({}, 'legacy-v1'), duplicateFingerprint({}, 'legacy-v1'));
});

test('serializeArbitrationDecision projects the stable DTO shape', () => {
  assert.deepEqual(serializeArbitrationDecision({
    disposition: 'assign', assignable: true, managerReview: false, userId: 'U-1',
    suggestedUserId: 'U-1', deterministicUserId: 'U-1', aiUserId: 'AI-1', source: 'deterministic_rules',
    reasonCode: 'ok', reason: '正常', aiConfidence: 0.8,
  }), {
    disposition: 'assign', assignable: true, managerReview: false, userId: 'U-1',
    suggestedUserId: 'U-1', deterministicUserId: 'U-1', aiUserId: 'AI-1', source: 'deterministic_rules',
    reasonCode: 'ok', reason: '正常', aiConfidence: 0.8,
  });
  assert.deepEqual(serializeArbitrationDecision({}), {
    disposition: '', assignable: false, managerReview: false, userId: '', suggestedUserId: '',
    deterministicUserId: '', aiUserId: '', source: '', reasonCode: '', reason: '', aiConfidence: 0,
  });
});

test('withoutArbitrationAI masks AI influence in arbitration decisions', () => {
  const decision = {
    disposition: 'assign', source: 'ai_ranking', reasonCode: 'ranking_based',
    reason: 'AI 推荐高分', userId: 'U-1', deterministicUserId: 'U-1', assignable: true, managerReview: false,
  };
  const safe = withoutArbitrationAI(decision, 'fallback');
  assert.equal(safe.source, 'deterministic_rules');
  assert.equal(safe.reasonCode, 'deterministic_fallback');
  assert.equal(safe.reason, '按确定性规则与当前负荷分配');
  const kept = withoutArbitrationAI({ disposition: 'assign', source: 'rules', reasonCode: 'low_load', reason: '负荷低', userId: 'U-1' });
  assert.equal(kept.source, 'rules');
  assert.equal(kept.reasonCode, 'low_load');
});

test('serializeRecommendation projects the ranked candidate DTO shape', () => {
  assert.deepEqual(serializeRecommendation({
    available: true, reasonCode: 'ok', resultId: 'R-1', jobId: 'J-1', snapshotId: 'S-1',
    confidence: 0.9, reviewRequired: false,
    rankedCandidates: [{ userId: 'U-1', score: 10, reasons: ['a', 'b'] }],
  }), {
    available: true, reasonCode: 'ok', resultId: 'R-1', jobId: 'J-1', snapshotId: 'S-1',
    confidence: 0.9, reviewRequired: false,
    rankedCandidates: [{ userId: 'U-1', score: 10, reasons: ['a', 'b'] }],
  });
  assert.deepEqual(serializeRecommendation({}), {
    available: false, reasonCode: '', resultId: '', jobId: '', snapshotId: '',
    confidence: 0, reviewRequired: false, rankedCandidates: [],
  });
});

test('normalizeEvaluation projects the DTO shape and without* strips AI fields', () => {
  const row = {
    id: 'EV-1', customer_id: 'CRM-1', subject_type: 'account', subject_id: 'CRM-1', subject_name: 'Acme',
    subject_title: '销售', evaluation_text: '不错', author_id: 'U-1', author_name: '王五',
    ai_status: 'done', ai_summary: 'AI', ai_labels_json: '["好"]', ai_order_keys_json: '["k"]',
    ai_risks_json: '[]', ai_strategy: 's', ai_model: 'm', ai_error: '', ai_generated_at: '2026-01-01',
    created_at: '2026-01-02',
  };
  const evaluation = normalizeEvaluation(row);
  assert.equal(evaluation.id, 'EV-1');
  assert.equal(evaluation.customerId, 'CRM-1');
  assert.equal(evaluation.aiLabels[0], '好');
  assert.equal(evaluation.aiStatus, 'done');
  const manual = withoutEvaluationAI(evaluation);
  assert.equal(manual.aiStatus, undefined);
  assert.equal(manual.evaluationText, '不错');
  assert.equal(withoutEvaluationAIRow({ ai_status: 'done', name: 'Acme' }).name, 'Acme');
  assert.equal(withoutEvaluationAIRow({ ai_status: 'done' }).ai_status, undefined);
  assert.equal(withoutEvaluationAI(null), null);
  assert.equal(withoutEvaluationAIRow(null), null);
  const error = aiFeatureDisabled();
  assert.equal(error.message, 'AI feature is disabled');
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, 'AI_FEATURE_DISABLED');
});

test('redactAuditPayload replaces sensitive keys recursively and leaves others intact', () => {
  assert.deepEqual(redactAuditPayload({ name: 'Acme', password: 'secret', nested: { token: 'abc', note: 'ok' } }), {
    name: 'Acme', password: '[REDACTED]', nested: { token: '[REDACTED]', note: 'ok' },
  });
  assert.deepEqual(redactAuditPayload([{ authorization: 'Bearer x' }, 'plain']), [{ authorization: '[REDACTED]' }, 'plain']);
  assert.equal(redactAuditPayload('plain'), 'plain');
  assert.equal(redactAuditPayload(null), null);
  assert.deepEqual(redactAuditPayload({ previewId: 'p-1', confirmationText: 'yes' }), { previewId: '[REDACTED]', confirmationText: '[REDACTED]' });
});

test('normalizeActivityActionQueueKey accepts pipeline keys and publicActivityReaction projects the DTO', () => {
  assert.equal(normalizeActivityActionQueueKey(' due_followup '), 'due_followup');
  assert.equal(normalizeActivityActionQueueKey(''), '');
  assert.throws(() => normalizeActivityActionQueueKey('bogus'), { message: '请选择有效的行动队列' });
  assert.deepEqual(publicActivityReaction({ id: 'R-1', name: '有兴趣', action_queue_key: 'due_followup', sort_order: 3, active: 1 }), {
    id: 'R-1', name: '有兴趣', actionQueueKey: 'due_followup', sortOrder: 3, active: true,
  });
});

test('hashPassword is scrypt-based and parseCookies decodes the session header', () => {
  const creds = hashPassword('s3cret');
  assert.equal(typeof creds.hash, 'string');
  assert.equal(creds.hash.length, 128);
  assert.equal(creds.salt.length > 0, true);
  const salted = hashPassword('same', 'x'.repeat(32));
  assert.notEqual(salted.hash, hashPassword('same', 'y'.repeat(32)).hash);
  assert.deepEqual(parseCookies('a=1; sales_session=abc%20def; '), { a: '1', sales_session: 'abc def' });
  assert.deepEqual(parseCookies(''), {});
});

test('normalizeListQuery and listPage normalize pagination within bounds', () => {
  assert.deepEqual(normalizeListQuery({ page: 2, pageSize: 50, search: '  Acme ' }), { page: 2, pageSize: 50, offset: 50, search: 'Acme' });
  assert.equal(normalizeListQuery({ page: 0 }).page, 1);
  assert.equal(normalizeListQuery({ pageSize: 100 }).pageSize, 100);
  assert.equal(normalizeListQuery({ pageSize: 30 }).pageSize, 50);
  assert.equal(normalizeListQuery({ search: 'x'.repeat(200) }).search.length, 120);
  assert.deepEqual(listPage({ page: 3, pageSize: 25 }), { page: 3, pageSize: 25, offset: 50 });
  assert.equal(listPage({ pageSize: 500 }).pageSize, 100);
  assert.equal(listPage({}, 20).pageSize, 20);
  assert.equal(listPage({ page: 0 }).page, 1);
});

test('escapeActivitySearchLike escapes SQL LIKE wildcards', () => {
  assert.equal(escapeActivitySearchLike('a_b%c\\d'), 'a\\_b\\%c\\\\d');
  assert.equal(escapeActivitySearchLike('plain'), 'plain');
  assert.equal(escapeActivitySearchLike(''), '');
});

test('safeUser projects the response DTO without credentials', () => {
  const row = {
    id: 'U-1', email: 'a@b.co', name: '王五', role: 'sales', active: 1, archived_at: '',
    must_change_password: 0, languages_json: '["zh"]', countries_json: '[]', channels_json: '["whatsapp"]',
    permissions: { view_customers: true }, permission_group_id: 'G-1', permission_group_name: '销售组',
    permissionOverrides: { view_contacts: true }, created_at: '2026-01-01',
  };
  const user = safeUser(row);
  assert.equal(user.id, 'U-1');
  assert.equal(user.email, 'a@b.co');
  assert.deepEqual(user.languages, ['zh']);
  assert.equal(user.permissions.view_customers, true);
  assert.equal(user.permissionOverrideCount, 1);
  assert.equal(user.password_hash, undefined);
  assert.equal(safeUser(null), null);
});

test('intake assignment idempotency, request hash, and preview requirement are deterministic', () => {
  const user = { id: 'U-1' };
  assert.equal(intakeActionIdempotencyKey(user, { action: 'claim', itemId: 'IN-1', reason: 'ok' }), intakeActionIdempotencyKey(user, { action: 'claim', itemId: 'IN-1', reason: 'ok' }));
  assert.notEqual(intakeActionIdempotencyKey(user, { action: 'claim', itemId: 'IN-1', reason: 'ok' }), intakeActionIdempotencyKey(user, { action: 'claim', itemId: 'IN-1', reason: 'no' }));
  assert.equal(intakeActionIdempotencyKey(user, { idempotencyKey: 'custom-key' }), 'custom-key');
  assert.equal(intakeActionIdempotencyKey(user, { idempotencyKey: 'x'.repeat(300) }).length, 240);
  assert.equal(manualAssignmentRequestHash(user, { itemIds: ['IN-1'], ownerId: 'U-2' }), manualAssignmentRequestHash(user, { itemIds: ['IN-1'], ownerId: 'U-2' }));
  assert.equal(manualAssignmentRequiresPreview({ itemIds: ['IN-1'] }), false);
  assert.equal(manualAssignmentRequiresPreview({ allFiltered: true }), true);
  assert.equal(manualAssignmentRequiresPreview({ filterScope: { filters: { stage: ['new'] } } }), true);
  assert.equal(manualAssignmentRequiresPreview({}), false);
});

test('json parses resiliently and parseJsonObject narrows to a plain object', () => {
  assert.deepEqual(json('{"a":1}'), { a: 1 });
  assert.deepEqual(json('[1,2]'), [1, 2]);
  assert.deepEqual(json(''), []);
  assert.deepEqual(json('null'), []);
  assert.deepEqual(json('not json'), []);
  assert.deepEqual(json('{"a":1}', {}), { a: 1 });
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonObject('[1,2]'), {});
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonObject('garbage'), {});
  assert.deepEqual(parseJsonObject(null), {});
});

test('buildTeamReport aggregates per-sales performance with rates and ranking', () => {
  const sales = { id: 'U-1', name: '王五', role: 'sales', email: 'a@b.co', permissions: {}, permissionOverrides: {}, created_at: '2026-01-01' };
  const manager = { id: 'U-2', name: '经理', role: 'manager', email: 'm@b.co', permissions: {}, permissionOverrides: {}, created_at: '2026-01-01' };
  const accounts = [
    { id: 'C-1', owner_id: 'U-1', stage: 'quoted', country: '俄罗斯', next_action: '报价', next_action_at: '2026-08-30 10:00', manager_required: 0, assigned_at: '2026-08-01 00:00' },
    { id: 'C-2', owner_id: 'U-1', stage: 'lost', country: '俄罗斯', next_action: '', next_action_at: '', manager_required: 0, assigned_at: '2026-08-01 00:00' },
  ];
  const activities = [
    { id: 'A-1', customer_id: 'C-1', activity_type: 'email', channel: 'email' },
    { id: 'A-2', customer_id: 'C-1', activity_type: 'reply', channel: 'email' },
  ];
  const rfqs = [{ id: 'R-1', customer_id: 'C-1', completeness: 80 }];
  const quotes = [{ id: 'Q-1', customer_id: 'C-1' }];
  const orders = [{ id: 'O-1', customer_id: 'C-1', is_repeat: 0, amount: 1000, gross_margin: 20 }];
  const report = buildTeamReport([manager, sales], accounts, activities, rfqs, quotes, orders);
  assert.equal(report.length, 1);
  const row = report[0];
  assert.equal(row.user.id, 'U-1');
  assert.equal(row.metrics.assigned, 2);
  assert.equal(row.metrics.orders, 1);
  assert.equal(row.overall > 0, true);
  assert.deepEqual(row.bestCountries, ['俄罗斯']);
});

test('hydrateDuplicateCandidate prefers live catalog values and review helpers parse row JSON', () => {
  const catalog = [{
    customerId: 'C-1', crmAccountId: 'CRM-1', companyName: 'Acme 正式', nickname: 'Acme', website: 'https://acme.example',
    country: '俄罗斯', ownerId: 'U-1', ownerName: '王五', customerStage: 'meeting', assignmentStatus: 'claimed',
  }];
  const hydrated = hydrateDuplicateCandidate({ customerId: 'C-1', crmAccountId: 'CRM-1', score: 0.8, matchedBy: 'fuzzy' }, catalog);
  assert.equal(hydrated.companyName, 'Acme 正式');
  assert.equal(hydrated.ownerId, 'U-1');
  assert.equal(hydrated.score, 0.8);
  assert.equal(hydrated.matchedBy, 'fuzzy');
  assert.equal(hydrated.website, 'https://acme.example');
  assert.equal(hydrateDuplicateCandidate({ customerId: 'C-X', score: 2 }, []).customerId, 'C-X');
  assert.deepEqual(reviewCandidateRows({ current_candidates_json: '[{"customerId":"C-1"},{"score":1}]' }).map(row => row.customerId), ['C-1']);
  assert.deepEqual(reviewCandidateRows({ candidates_json: '[{"customerId":"C-2"}]' }).map(row => row.customerId), ['C-2']);
  assert.equal(reviewHasProtectedExact({ current_candidates_json: '[{"isProtected":true,"exact":true}]' }), true);
  assert.equal(reviewHasProtectedExact({ current_candidates_json: '[{"isProtected":true,"exact":false}]' }), false);
  assert.equal(reviewHasProtectedExact({}), false);
});
