'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { adminFixture, seededFixture } = require('./helpers/permission_fixture');
const {
  projectCustomerState,
  projectAssignmentState,
  projectManagerState,
  projectNextAction,
  projectAccountState,
} = require('../lib/domains/lifecycle/state_projection');

test('lost is a terminal customer stage', () => {
  assert.deepEqual(projectCustomerState({ stage: 'lost' }), { key: 'lost', terminal: true });
});

test('recycled lifecycle is projected without changing the source row', () => {
  const account = { lifecycle_status: 'recycled' };
  const state = projectAccountState(account);
  assert.equal(state.lifecycleStatus, 'recycled');
  assert.deepEqual(state.state.lifecycle, { key: 'recycled', recycled: true });
  assert.equal(account.lifecycle_status, 'recycled');
});

test('returned assignment is not current ownership', () => {
  const state = projectAssignmentState({ assignment_status: 'returned', owner_id: 'U-1' });
  assert.deepEqual(state, { key: 'returned', ownerId: 'U-1', current: false });
});

test('manager_required without a status falls back to waiting', () => {
  assert.deepEqual(projectManagerState({ manager_required: 1, manager_status: '' }), {
    required: true,
    status: '待介入',
  });
  assert.deepEqual(projectManagerState({ manager_required: 0, manager_status: '已完成' }), {
    required: false,
    status: '已完成',
  });
});

test('next action without a time is marked as degraded', () => {
  assert.deepEqual(projectNextAction({ next_action: '确认采购周期' }, Date.parse('2026-08-28T00:00:00Z')), {
    text: '确认采购周期',
    at: '',
    planned: false,
    degraded: true,
    overdue: false,
  });
});

test('expired next action preserves the original timestamp and is only marked overdue', () => {
  const account = { next_action: '跟进报价', next_action_at: '2026-08-27 09:00:00' };
  const state = projectNextAction(account, Date.parse('2026-08-28T09:00:00Z'));
  assert.equal(state.at, account.next_action_at);
  assert.equal(state.overdue, true);
  assert.equal(account.next_action_at, '2026-08-27 09:00:00');
});

test('missing legacy fields use compatibility defaults', () => {
  assert.deepEqual(projectAccountState({}), {
    stage: 'new',
    lifecycleStatus: 'active',
    assignmentStatus: 'claimed',
    managerStatus: '',
    nextAction: '',
    nextActionAt: '',
    state: {
      stage: { key: 'new', terminal: false },
      lifecycle: { key: 'active', recycled: false },
      assignment: { key: 'claimed', ownerId: '', current: false },
      manager: { required: false, status: '' },
      nextAction: { text: '', at: '', planned: false, degraded: false, overdue: false },
    },
  });
});

test('intake status can supply assignment state when account field is absent', () => {
  assert.deepEqual(projectAssignmentState({ owner_id: 'U-2' }, { status: 'assigned', assigned_owner_id: 'U-2' }), {
    key: 'assigned', ownerId: 'U-2', current: true,
  });
});

test('accounts list response includes state projection for each row', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const accounts = await fx.requestJson('/api/sales-crm/accounts', { cookie: fx.adminCookie });
  assert.ok(accounts.rows.length > 0);
  for (const row of accounts.rows) {
    assert.ok('state' in row, 'each account row must have state');
    assert.ok(row.state.stage, 'state.stage must be present');
    assert.ok(typeof row.state.stage.terminal === 'boolean', 'state.stage.terminal must be boolean');
    assert.ok('stage' in row, 'legacy stage field must be preserved');
  }
});

test('bootstrap response includes state projection for each account', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.ok(bootstrap.accounts.length > 0);
  for (const account of bootstrap.accounts) {
    assert.ok('state' in account, 'each bootstrap account must have state');
    assert.ok(account.state.stage, 'state.stage must be present');
    assert.ok('stage' in account, 'legacy stage field must be preserved');
  }
});

test('profile for accessible CRM account includes state', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const profile = await fx.requestJson('/api/sales-crm/profile/RU-9001', { cookie: fx.adminCookie });
  assert.ok(profile.state, 'profile must include state for accessible CRM account');
  assert.ok(profile.state.stage, 'state.stage must be present');
  assert.equal(profile.state.stage.key, 'qualified');
});

test('master profile without CRM account does not include state', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  fx.db.prepare('INSERT INTO customer_pool(customer_id,company_name) VALUES (?,?)')
    .run('BR-9999', 'Master Only');
  const profile = await fx.requestJson('/api/sales-crm/profile/BR-9999', { cookie: fx.adminCookie });
  assert.equal(profile.state, undefined, 'master-only profile must not include state');
  assert.ok(profile.customerPool, 'profile payload must still include customer data');
});

test('pipeline list rows include state projection', async t => {
  const fx = await adminFixture({});
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/lists/pipeline', { cookie: fx.adminCookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.ok(body.rows.length > 0);
  for (const row of body.rows) {
    assert.ok('state' in row, 'each pipeline row must have state');
    assert.ok(row.state.stage, 'state.stage must be present');
    assert.ok('stage' in row, 'legacy stage field must be preserved');
  }
});

test('sales user profile for out-of-scope account does not include state', async t => {
  const fx = await seededFixture({ managerViewAll: false });
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { view_customers: true, view_all_customers: false });
  const cookie = await fx.login('other@example.com', 'Password123!');
  const response = await fx.request('/api/sales-crm/profile/RU-9002', { cookie });
  const profile = await response.json();
  assert.equal(response.status, 403, profile.error);
  assert.equal(profile.state, undefined, 'out-of-scope profile must not include state');
});

test('frontend recycle guards consume the unified state DTO first', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  assert.match(appSource, /function accountLifecycleActive/);
  assert.match(appSource, /account\.state\.lifecycle\.key === 'active'/);
  assert.match(appSource, /function accountAssignmentReturned/);
  assert.match(appSource, /account\.state\.assignment\.key === 'returned'/);
  assert.match(appSource, /canReturnCustomer\(account\)[\s\S]{0,220}accountLifecycleActive/);
});

test('frontend stage and manager display fall back to the unified state DTO', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  assert.match(appSource, /function accountStageOf\(account\)/);
  assert.match(appSource, /account\?\.stage \|\| account\?\.state\?\.stage\?\.key/);
  assert.match(appSource, /function managerStateDisplay\(account\)/);
  assert.match(appSource, /account\?\.state\?\.manager\?\.status/);
  assert.match(appSource, /stageLabel\(accountStageOf\(account\)\)/);
  assert.match(appSource, /\['管理介入', managerStateDisplay\(account\)\]/);
  assert.match(appSource, /stageLabel\(accountStageOf\(account\)\)\)\}[\s\S]{0,80}\$\{stay\}/);
  assert.match(appSource, /\['原阶段', stageLabel\(accountStageOf\(account\)\)\]/);
});

test('account whitelist projection matches the legacy blacklist apart from the state DTO', () => {
  const { redactContactFields, contactSafeAccountRecord } = require('../lib/domains/identity');
  const account = {
    id: 'CRM-1', external_customer_id: 'RU-1', company_name: 'Firm', nickname: '昵称',
    country: 'RU', city: 'M', website: 'https://x.com', industry: 'auto',
    customer_type: 'mfr', source: '展会', product_focus: 'MCU', priority: 'B',
    potential_value: 0, stage: 'meeting', owner_id: 'U-1', created_by: 'U-2',
    first_claimed_by: 'U-1', first_claimed_at: 't', manager_id: 'U-M',
    manager_required: 1, manager_status: '待介入', last_activity_at: 't',
    next_action: '跟进', next_action_at: 't', next_action_time_basis: 'utc',
    loss_reason: '', created_at: 't', updated_at: 't', intake_item_id: 'I-1',
    assignment_status: 'claimed', assigned_at: 't', claim_due_at: 't', claimed_at: 't',
    return_reason: '', lifecycle_status: 'active', recycle_kind: '', recycle_reason: '',
    recycled_by: '', recycled_at: '', previous_owner_id: '', established_year: 2020,
    owner_name: 'A', manager_name: 'M', creator_name: 'C', master_description: 'desc',
    current_pool: '未分池', rating: 'A', best_contact_level: 'L1',
    contact_recon_status: 'done', deep_report: 'report', source_file: 'file.csv',
    stageLabel: '深度沟通', customerTags: [{ id: 1, name: 'x' }],
    lifecycleStatus: 'active', assignmentStatus: 'claimed', managerStatus: '待介入',
    nextAction: '跟进', nextActionAt: 't',
    state: {
      stage: { key: 'meeting', terminal: false },
      lifecycle: { key: 'active', recycled: false },
      assignment: { key: 'claimed', ownerId: 'U-1', current: true },
      manager: { required: true, status: '待介入' },
      nextAction: { text: '跟进', at: 't', planned: true, degraded: false, overdue: false },
    },
  };
  const redacted = redactContactFields(account);
  const projected = contactSafeAccountRecord(account);
  const { state: _redactedState, ...redactedRest } = redacted;
  const { state: _projectedState, ...projectedRest } = projected;
  assert.deepEqual(projectedRest, redactedRest,
    'non-state account keys must be identical to the legacy blacklist output');
  assert.ok(projected.state, 'state DTO must be preserved by the whitelist');
  assert.equal(projected.state.nextAction.text, '',
    'state.nextAction text must be hidden by the whitelist');
  assert.equal(redacted.state.nextAction, undefined,
    'legacy blacklist strips state.nextAction recursively');
});

test('pipeline whitelist projection keeps reaction and queue fields like the blacklist', () => {
  const { redactContactFields, contactSafePipelineRecord } = require('../lib/domains/identity');
  const row = {
    id: 'CRM-1', external_customer_id: 'RU-1', company_name: 'Firm', nickname: '',
    country: 'RU', city: '', website: '', industry: '', customer_type: '',
    source: '', priority: 'B', potential_value: 0, stage: 'meeting', owner_id: 'U-1',
    manager_required: 1, manager_status: '待介入', last_activity_at: 't',
    next_action: '秘密跟进', next_action_at: 't', created_at: 't', updated_at: 't',
    assignment_status: 'claimed', lifecycle_status: 'active',
    owner_name: 'A', creator_name: 'C', stageLabel: '深度沟通',
    latest_reaction: '有回复', latest_progress_key: 'reply',
    latest_activity_summary: '秘密摘要', rfq_count: 1, quote_count: 0, order_count: 0,
    actionQueueKeys: ['due_followup'], actionQueueLabels: ['到期跟进'],
    state: {
      stage: { key: 'meeting', terminal: false },
      lifecycle: { key: 'active', recycled: false },
      assignment: { key: 'claimed', ownerId: 'U-1', current: true },
      manager: { required: true, status: '待介入' },
      nextAction: { text: '秘密跟进', at: 't', planned: true, degraded: false, overdue: false },
    },
  };
  const redacted = redactContactFields(row);
  const projected = contactSafePipelineRecord(row);
  const { state: _redactedState, ...redactedRest } = redacted;
  const { state: _projectedState, ...projectedRest } = projected;
  assert.deepEqual(projectedRest, redactedRest,
    'pipeline keys must be identical to the legacy blacklist output');
  assert.equal(projected.actionQueueKeys[0], 'due_followup',
    'action queue must stay visible for the pipeline board');
  assert.equal(projected.state.nextAction.text, '',
    'pipeline state.nextAction text must be hidden');
});

test('insights whitelist projection matches the legacy blacklist on evaluation rows', () => {
  const { redactContactFields, contactSafeInsightsRecord } = require('../lib/domains/identity');
  const row = {
    customerId: 'CRM-1', externalCustomerId: 'RU-1', companyName: 'Firm', nickname: '',
    country: 'RU', city: '', stage: 'meeting', priority: 'B',
    ownerId: 'U-1', ownerName: 'A',
    evaluationCount: 2, evaluationStatus: 'evaluated', latestEvaluationId: 'EV-1',
    subjectType: 'company', subjectId: 'S-1', subjectName: '秘密采购', subjectTitle: 'Procurement',
    evaluationText: '秘密评价', authorId: 'U-M', authorName: '经理',
    aiStatus: 'completed', aiSummary: '秘密摘要', aiLabelsJson: '[]', aiRisksJson: '[]',
    aiStrategy: '秘密策略', evaluatedAt: 't', evaluationUpdatedAt: 't',
    aiLabels: ['有前景'], aiRisks: ['价格敏感'],
  };
  const redacted = redactContactFields(row);
  const projected = contactSafeInsightsRecord(row);
  assert.deepEqual(projected, redacted,
    'insights whitelist must be identical to the legacy blacklist output');
});

test('alerts whitelist projection matches the legacy blacklist with alert-copy preservation', () => {
  const { redactContactFields, contactSafeAlertsRecord } = require('../lib/domains/identity');
  const alert = {
    id: 'OVERDUE-CRM-1', code: 'OVERDUE', severity: 'critical', title: '跟进任务已超期',
    detail: '秘密跟进 已超过计划时间', action: '今天完成跟进',
    customerId: 'CRM-1', companyName: 'Firm', officialCompanyName: 'Firm', nickname: '',
    externalCustomerId: 'RU-1', intakeItemId: '', ownerId: 'U-1', ownerName: 'A',
    assignedAt: '', actionKind: 'record_activity', allowedActions: ['record_activity'],
    dueAt: 't', stage: 'meeting', customerPriority: 'B', overdueHours: 20, updatedAt: 't',
    reasons: [
      { code: 'OVERDUE', title: '跟进任务已超期', detail: '秘密跟进 已超过计划时间', action: '今天完成跟进', dueAt: 't', overdueHours: 20 },
    ],
    reasonCount: 1, urgency: 'today', urgencyLabel: '今天完成', otherReasons: [],
    maxOverdueHours: 20,
    managerRequest: {
      requesterId: 'U-1', requesterName: 'A', requestedAt: 't',
      reason: '秘密原因', progress: 'email', summary: '秘密摘要', outcome: '秘密结果',
    },
    managerReply: { repliedById: 'U-M', repliedByName: 'M', repliedAt: 't', result: '秘密结果' },
  };
  const redacted = redactContactFields(alert, { preserveAlertCopy: true });
  const projected = contactSafeAlertsRecord(alert);
  assert.deepEqual(projected, redacted,
    'alerts whitelist must be identical to the legacy blacklist output');
  assert.equal(projected.title, '跟进任务已超期', 'alert copy must stay visible');
  assert.equal(projected.managerRequest.reason, undefined,
    'manager request narrative must be hidden');
});

test('activity whitelist projection matches the legacy blacklist on activity rows', () => {
  const { redactContactFields, contactSafeActivityRecord } = require('../lib/domains/identity');
  const row = {
    id: 'ACT-1', customer_id: 'CRM-1', user_id: 'U-1', activity_type: 'email', channel: 'email',
    outcome: '已回复', summary: '秘密摘要', next_action: '秘密跟进', next_action_at: 't',
    stage_before: 'contacted', stage_after: 'replied', manager_required: 0,
    progress_key: 'reply', reaction_option_id: 'R-1', reaction_label_snapshot: '有回复',
    occurred_at: 't', created_at: 't', no_plan: 0, superseded_at: '', superseded_by: '',
    is_test_data: 0, user_name: 'A', actor_name: 'A',
    provenance: {
      kind: 'original', originalActivityId: 'ACT-1', originalCustomerId: 'CRM-1',
      originalActivityType: 'email', sourceActivityId: '',
    },
  };
  const redacted = redactContactFields(row);
  const projected = contactSafeActivityRecord(row);
  assert.deepEqual(projected, redacted,
    'activity whitelist must be identical to the legacy blacklist output');
  assert.equal(projected.summary, undefined, 'activity narrative must be hidden');
  assert.equal(projected.provenance.kind, 'original', 'provenance metadata must stay visible');
});
