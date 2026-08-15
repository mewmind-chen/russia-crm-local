'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('pending center merges both types with per-type tabs', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
  assert.match(html, /pendingVerificationPanel/);
  assert.match(html, /pendingTypeTabs/);
  assert.match(html, /待核验中心/);
  assert.doesNotMatch(html, /protectedConflictList/);
  assert.doesNotMatch(html, /duplicateReviewList/);
  assert.doesNotMatch(html, /duplicateReviewStatus/);
  const dispatcher = section(app, 'function renderPendingCenter', 'function applyDuplicateReviewDeepLink');
  assert.match(dispatcher, /activeTab/);
  assert.match(dispatcher, /pendingTabsAvailable/);
  assert.match(dispatcher, /activatePendingTab/);
  assert.match(dispatcher, /renderProtectedConflicts/);
  assert.match(dispatcher, /renderDuplicateReviews/);
});

test('identity conflict detail is a business workbench, not audit UI', () => {
  const renderer = section(app, 'function protectedConflictTargetExternalCustomerId', 'function duplicateEvidenceMarkup');
  assert.match(renderer, /是不是同一个客户？/);
  assert.match(renderer, /option\('link_existing', '是同一个客户'/);
  assert.match(renderer, /option\('confirm_new', '不是同一个客户'/);
  assert.match(renderer, /option\('supplement_and_retry', '资料还不够'/);
  assert.match(renderer, /保存并处理下一条/);
  assert.match(renderer, /leadNames/);
  assert.doesNotMatch(renderer, /normalizedName/);
  assert.doesNotMatch(renderer, /expectedVersion/);
  assert.doesNotMatch(renderer, /sha256/);
  assert.doesNotMatch(renderer, /稳定客户编号/);
});

test('supplement actions render only on the resolved link_existing card', () => {
  const source = section(app, 'function protectedConflictTargetExternalCustomerId', 'function duplicateEvidenceMarkup');
  const detailMarkup = Function(
    'esc', 'duplicateFacts', 'protectedConflictSupplementFlags', 'protectedWritesAvailable', 'state', 'pendingNavigationMarkup',
    `${source}; return protectedConflictDetailMarkup;`,
  )(
    value => String(value),
    () => '<dl class="duplicate-review-facts"></dl>',
    () => '联系人、官网',
    () => true,
    { protectedCustomers: { conflictPendingId: '' } },
    () => '',
  );
  const resolvedLink = detailMarkup({
    conflictId: 'C1', status: 'resolved', decision: 'link_existing',
    leadNames: [{ rawName: '新线索', externalCustomerId: 'LEAD-1' }],
    crmNames: [{ rawName: '主客户', externalCustomerId: 'MASTER-1' }],
    complementaryInfo: { contact: true, website: true },
  });
  assert.match(resolvedLink, /补充到主客户/);
  assert.match(resolvedLink, /暂不补充/);
  assert.match(resolvedLink, /可补充资料：联系人、官网/);

  const pending = detailMarkup({
    conflictId: 'C2', status: 'unresolved',
    leadNames: [{ rawName: '待核验线索', externalCustomerId: 'LEAD-2' }],
    crmNames: [{ rawName: '主客户', externalCustomerId: 'MASTER-2' }],
    complementaryInfo: null,
  });
  assert.doesNotMatch(pending, /补充到主客户/);
  assert.doesNotMatch(pending, /暂不补充/);
  assert.doesNotMatch(pending, /可补充资料/);

  for (const item of [
    {
      conflictId: 'C3', status: 'resolved', decision: 'confirm_new',
      leadNames: [{ rawName: '独立客户', externalCustomerId: 'LEAD-3' }],
      crmNames: [{ rawName: '已有客户', externalCustomerId: 'MASTER-3' }],
      complementaryInfo: { contact: true, website: true },
    },
    {
      conflictId: 'C4', status: 'retry', decision: 'supplement_and_retry',
      leadNames: [{ rawName: '待补充线索', externalCustomerId: 'LEAD-4' }],
      crmNames: [{ rawName: '已有客户', externalCustomerId: 'MASTER-4' }],
      complementaryInfo: { contact: true, website: true },
    },
  ]) {
    const markup = detailMarkup(item);
    assert.doesNotMatch(markup, /补充到主客户/);
    assert.doesNotMatch(markup, /暂不补充/);
    assert.doesNotMatch(markup, /可补充资料/);
  }
});

test('pending decision options are gated to what the backend accepts', () => {
  const source = section(app, 'function protectedConflictTargetExternalCustomerId', 'function duplicateEvidenceMarkup');
  const decisionMarkup = Function(
    'esc', 'duplicateFacts', 'protectedWritesAvailable',
    `${source}; return protectedConflictDecisionMarkup;`,
  )(
    value => String(value),
    () => '<dl class="duplicate-review-facts"></dl>',
    () => true,
  );
  const render = item => decisionMarkup(item, { conflictPendingId: '' });

  // Without a comparable CRM candidate, only supplement-and-retry is offered.
  const leadOnly = render({
    conflictId: 'L1', status: 'unresolved',
    leadNames: [{ rawName: '线索A', externalCustomerId: 'LEAD-A' }],
    crmNames: [],
    leadExternalCustomerIds: ['LEAD-A', 'LEAD-B'], crmExternalCustomerIds: [],
  });
  assert.doesNotMatch(leadOnly, /value="link_existing"/);
  assert.doesNotMatch(leadOnly, /value="confirm_new"/);
  assert.match(leadOnly, /value="supplement_and_retry" checked/);
  assert.match(leadOnly, /要求补充资料/);

  // Live conflict with one CRM side: link enabled, confirm still disabled.
  const withCrm = render({
    conflictId: 'L2', status: 'unresolved',
    leadNames: [{ rawName: '线索A', externalCustomerId: 'LEAD-A' }],
    crmNames: [{ rawName: '主客户', externalCustomerId: 'MASTER-1' }],
    leadExternalCustomerIds: ['LEAD-A'], crmExternalCustomerIds: ['MASTER-1'],
  });
  assert.doesNotMatch(withCrm, /value="link_existing"[^>]*disabled/);
  assert.match(withCrm, /value="confirm_new"[^>]*disabled/);

  // Stored-only records without a CRM side follow the same no-candidate rule.
  const storedOnly = render({
    conflictId: 'L3', status: 'unresolved',
    leadNames: [], crmNames: [],
    leadExternalCustomerIds: [], crmExternalCustomerIds: [],
  });
  assert.doesNotMatch(storedOnly, /value="link_existing"/);
  assert.doesNotMatch(storedOnly, /value="confirm_new"/);
  assert.match(storedOnly, /value="supplement_and_retry" checked/);
});

test('save handler sends the state version and a business default reason', () => {
  const handler = section(app, "const conflictSave = event.target.closest('[data-save-protected-conflict]')", 'const supplementApply');
  assert.match(handler, /管理员确认为同一客户/);
  assert.match(handler, /管理员确认不是同一客户/);
  assert.match(handler, /expectedVersion: item\.expectedVersion \|\| ''/);
  assert.doesNotMatch(handler, /sourceExpectedVersion/);
});

test('deep-link and post-adjudication refresh are wired', () => {
  const intake = section(app, 'function intakeReviewDeepLink', 'function openIntakeReview');
  assert.match(intake, /conflict=/);
  const deep = section(app, 'function applyDuplicateReviewDeepLink', 'async function loadDuplicateReviews');
  assert.match(deep, /conflict/);
  assert.match(deep, /activatePendingTab/);
  assert.match(deep, /selectPendingRecord/);
  assert.match(deep, /pendingRecordKey/);
  const save = section(app, 'function resolveProtectedConflictAction', 'function openDuplicateNeedsInfoModal');
  assert.match(save, /loadAuthorizedBusinessPage\('intake', \{ reset: true \}\)/);
  assert.match(save, /refreshTodayTasksAfterAction/);
  assert.match(save, /catch \(refreshError\)/);
});
