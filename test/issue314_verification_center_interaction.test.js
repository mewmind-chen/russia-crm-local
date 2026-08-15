'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

test('pending center renders a selectable queue and persistent detail', () => {
  for (const signature of [
    'function pendingRecordKey',
    'function pendingQueueRecords',
    'function selectPendingRecord',
    'function renderPendingQueue',
    'function renderPendingDetail',
  ]) assert.match(app, new RegExp(signature));
  assert.match(app, /data-pending-record-key/);
  assert.match(app, /selectedKey/);
});

test('identity decision UI adapts to candidate availability', () => {
  assert.match(app, /function protectedConflictDecisionMarkup/);
  assert.match(app, /function duplicateReviewDecisionMarkup/);
  assert.match(app, /没有可比较的已有客户/);
  assert.match(app, /要求补充资料/);
  assert.match(app, /crmNames.*length/s);
  assert.match(app, /是同一个客户/);
  assert.match(app, /不是同一个客户/);
  assert.doesNotMatch(app, /当前线索没有可关联的已有客户，暂不能合并/);
});

test('sequential review keeps position and advances only after success', () => {
  assert.match(app, /function movePendingSelection\(delta/);
  assert.match(app, /function selectPendingAfterMutation\(previousIndex/);
  assert.match(app, /保存并处理下一条/);
  assert.match(app, /pendingSelectionIndex\(\)/);
  assert.match(app, /catch \(error\)[\s\S]*selectedKey/s);
});

test('sequential navigation exposes keyboard-focusable bounded controls', () => {
  assert.match(app, /data-pending-move="-1"[^>]*\$\{index <= 0 \? 'disabled' : ''\}/);
  assert.match(app, /data-pending-move="1"[^>]*\$\{index >= records\.length - 1 \? 'disabled' : ''\}/);
  const start = app.indexOf("const pendingMove = event.target.closest('[data-pending-move]')");
  const end = app.indexOf("const conflictToggle", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(app.slice(start, end), /movePendingSelection\(Number\(pendingMove\.dataset\.pendingMove\)\)/);
});

test('queue selection stays disabled while a verification mutation is pending', () => {
  const start = app.indexOf('function renderPendingQueue');
  const end = app.indexOf('function duplicateReviewCandidateDecisionMarkup', start);
  const source = app.slice(start, end);
  assert.match(source, /state\.protectedCustomers\.conflictPendingId/);
  assert.match(source, /data-pending-record-key="\$\{esc\(record\.key\)\}"[^>]*\$\{interactionPending \? 'disabled' : ''\}/);
});

test('deep links select detail instead of expanding an inline card', () => {
  const start = app.indexOf('function applyDuplicateReviewDeepLink');
  const end = app.indexOf('async function loadDuplicateReviews', start);
  const source = app.slice(start, end);
  assert.match(source, /activateProtectionView\('verification'\)/);
  assert.match(source, /selectPendingRecord/);
  assert.match(source, /openMobile: true, focus: true/);
  assert.doesNotMatch(source, /scrollIntoView/);
  assert.doesNotMatch(source, /expandedConflictId/);
  assert.doesNotMatch(source, /expandedId/);
});

test('unavailable deep links render a generic state without the requested id', () => {
  const deepLink = app.slice(
    app.indexOf('function applyDuplicateReviewDeepLink'),
    app.indexOf('async function loadDuplicateReviews'),
  );
  assert.match(deepLink, /deepLinkUnavailable = true/);
  assert.match(app, /核验记录不可用或无权查看/);
  assert.doesNotMatch(deepLink, /innerHTML[\s\S]*conflictId/);
  assert.doesNotMatch(deepLink, /innerHTML[\s\S]*reviewId/);
});
