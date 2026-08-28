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

const {
  normalizeCountry,
  normalizeEstablishedYear,
  normalizeAccountNickname,
  normalizeCustomerStarReason,
} = require('../lib/domains/customer/normalize');
const { validateRecycleReason } = require('../lib/domains/customer/recycle');
const { customerCreateRequestHash } = require('../lib/domains/customer/create');
const { creatorDisplayName, historyAccountSummary, changedFieldLabels } = require('../lib/domains/customer/summary');
const { publicAccountContact } = require('../lib/domains/customer/contacts');

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
