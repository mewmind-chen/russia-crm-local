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
  const dispatcher = section(app, 'function renderPendingCenter', 'function renderDuplicateReviews');
  assert.match(dispatcher, /activeTab/);
  assert.match(dispatcher, /pendingTabsAvailable/);
  assert.match(dispatcher, /activatePendingTab/);
});

test('identity conflict cards are business workbench, not audit UI', () => {
  const renderer = section(app, 'function protectedConflictTargetExternalCustomerId', 'function duplicateEvidenceMarkup');
  assert.match(renderer, /疑似重名 · 匹配 /);
  assert.match(renderer, /是不是同一个客户？/);
  assert.match(renderer, /option\('link_existing', '是同一个客户'/);
  assert.match(renderer, /option\('confirm_new', '不是同一个客户'/);
  assert.match(renderer, /option\('supplement_and_retry', '资料还不够'/);
  assert.match(renderer, /保存处理结果/);
  assert.match(renderer, /leadNames/);
  assert.doesNotMatch(renderer, /normalizedName/);
  assert.doesNotMatch(renderer, /expectedVersion/);
  assert.doesNotMatch(renderer, /sha256/);
  assert.doesNotMatch(renderer, /稳定客户编号/);
});

test('supplement actions render only on the resolved link_existing card', () => {
  const source = section(app, 'function protectedConflictTargetExternalCustomerId', 'function duplicateEvidenceMarkup');
  const cardMarkup = Function(
    'esc', 'duplicateFacts', 'protectedConflictSupplementFlags', 'protectedWritesAvailable',
    `${source}; return protectedConflictCardMarkup;`,
  )(
    value => String(value),
    () => '<dl class="duplicate-review-facts"></dl>',
    () => '联系人、官网',
    () => true,
  );
  const resolvedLink = cardMarkup({
    conflictId: 'C1', status: 'resolved', decision: 'link_existing',
    leadNames: [{ rawName: '新线索', externalCustomerId: 'LEAD-1' }],
    crmNames: [{ rawName: '主客户', externalCustomerId: 'MASTER-1' }],
    complementaryInfo: { contact: true, website: true },
  }, { expandedConflictId: 'C1', conflictPendingId: '' });
  assert.match(resolvedLink, /补充到主客户/);
  assert.match(resolvedLink, /暂不补充/);
  assert.match(resolvedLink, /可补充资料：联系人、官网/);

  const pending = cardMarkup({
    conflictId: 'C2', status: 'unresolved',
    leadNames: [{ rawName: '待核验线索', externalCustomerId: 'LEAD-2' }],
    crmNames: [{ rawName: '主客户', externalCustomerId: 'MASTER-2' }],
    complementaryInfo: null,
  }, { expandedConflictId: 'C2', conflictPendingId: '' });
  assert.doesNotMatch(pending, /补充到主客户/);
  assert.doesNotMatch(pending, /暂不补充/);
  assert.doesNotMatch(pending, /可补充资料/);
});

test('pending decision options are gated to what the backend accepts', () => {
  const source = section(app, 'function protectedConflictTargetExternalCustomerId', 'function duplicateEvidenceMarkup');
  const cardMarkup = Function(
    'esc', 'duplicateFacts', 'protectedConflictSupplementFlags', 'protectedWritesAvailable',
    `${source}; return protectedConflictCardMarkup;`,
  )(
    value => String(value),
    () => '<dl class="duplicate-review-facts"></dl>',
    () => '',
    () => true,
  );
  const render = (item) => cardMarkup(item, { expandedConflictId: item.conflictId, conflictPendingId: '' });

  // Live lead-only conflict (the real production shape): link + confirm disabled with hints, retry enabled.
  const leadOnly = render({
    conflictId: 'L1', status: 'unresolved',
    leadNames: [{ rawName: '线索A', externalCustomerId: 'LEAD-A' }],
    crmNames: [],
    leadExternalCustomerIds: ['LEAD-A', 'LEAD-B'], crmExternalCustomerIds: [],
  });
  assert.match(leadOnly, /value="link_existing"[^>]*disabled/);
  assert.match(leadOnly, /当前线索没有可关联的已有客户/);
  assert.match(leadOnly, /value="confirm_new"[^>]*disabled/);
  assert.match(leadOnly, /需先补充资料或等待证据变化后再确认/);
  assert.doesNotMatch(leadOnly, /value="supplement_and_retry"[^>]*disabled/);

  // Live conflict with one CRM side: link enabled, confirm still disabled.
  const withCrm = render({
    conflictId: 'L2', status: 'unresolved',
    leadNames: [{ rawName: '线索A', externalCustomerId: 'LEAD-A' }],
    crmNames: [{ rawName: '主客户', externalCustomerId: 'MASTER-1' }],
    leadExternalCustomerIds: ['LEAD-A'], crmExternalCustomerIds: ['MASTER-1'],
  });
  assert.doesNotMatch(withCrm, /value="link_existing"[^>]*disabled/);
  assert.match(withCrm, /value="confirm_new"[^>]*disabled/);

  // Stored-only (non-live, reopened) item: confirm enabled, link disabled (no crm side).
  const storedOnly = render({
    conflictId: 'L3', status: 'unresolved',
    leadNames: [], crmNames: [],
    leadExternalCustomerIds: [], crmExternalCustomerIds: [],
  });
  assert.match(storedOnly, /value="link_existing"[^>]*disabled/);
  assert.doesNotMatch(storedOnly, /value="confirm_new"[^>]*disabled/);
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
  assert.match(deep, /activeTab/);
  assert.match(deep, /activatePendingTab/);
  assert.match(deep, /expandedConflictId/);
  const save = section(app, 'function resolveProtectedConflictAction', 'function openDuplicateNeedsInfoModal');
  assert.match(save, /loadAuthorizedBusinessPage\('intake', \{ reset: true \}\)/);
  assert.match(save, /refreshTodayTasksAfterAction/);
  assert.match(save, /catch \(refreshError\)/);
});
