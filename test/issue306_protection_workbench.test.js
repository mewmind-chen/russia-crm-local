'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('protection view title becomes 客户保护与查重处理', () => {
  const meta = section(app, "const viewMeta = {", 'const viewPermissions');
  assert.match(meta, /protectedCustomers: \['客户保护与查重', '客户保护与查重处理'\]/);
});

test('duplicate review queue keeps business summary and selects a persistent detail', () => {
  const adapter = section(app, 'function pendingRecordKey', 'function ensurePendingSelection');
  const renderer = section(app, 'function renderPendingQueue', 'function duplicateReviewCandidateDecisionMarkup');
  assert.match(adapter, /key: pendingRecordKey\('duplicates', item\)/);
  assert.match(adapter, /name: item\.input\?\.companyName/);
  assert.match(adapter, /reference: item\.input\?\.externalCustomerId \|\| item\.id/);
  assert.match(adapter, /疑似已有客户/);
  assert.match(adapter, /证据不足/);
  assert.match(adapter, /待管理员确认/);
  assert.match(adapter, /待补充资料/);
  assert.match(adapter, /已解决/);
  assert.match(renderer, /data-pending-record-key/);
  assert.match(renderer, /aria-pressed="\$\{selected\}"/);
  assert.match(renderer, /pending-queue-row\$\{selected \? ' selected' : ''\}/);
});

test('duplicate review persistent detail asks the one question and keeps three business actions', () => {
  const renderer = section(app, 'function duplicateReviewCandidateDecisionMarkup', 'function renderPendingDetail');
  assert.match(renderer, /是不是同一个客户？/);
  assert.match(renderer, />是同一个客户</);
  assert.match(renderer, />不是同一个客户</);
  assert.match(renderer, />资料还不够</);
  for (const attr of ['data-duplicate-resolution="confirmed_same"', 'data-duplicate-resolution="confirmed_distinct"', 'data-duplicate-resolution="needs_info"']) {
    assert.match(renderer, new RegExp(attr.replace(/["]/g, '\\"')));
  }
});

test('no technical copy leaks into the review UI', () => {
  const renderer = section(app, 'function pendingRecordKey', 'function pendingTabsAvailable');
  assert.doesNotMatch(renderer, /legacy-v1/);
  assert.doesNotMatch(renderer, /evaluatedRuleVersion/);
  assert.doesNotMatch(renderer, /提交人/);
  assert.doesNotMatch(renderer, /sha256/);
});

test('selection handler and deep links select the persistent detail', () => {
  const selection = section(app, 'function selectPendingRecord', 'function renderPendingQueue');
  assert.match(selection, /pendingQueueRecords\(\)\.find\(item => item\.key === key\)/);
  assert.match(selection, /if \(!record\) return false/);
  assert.match(selection, /state\.pendingCenter\.selectedKey = record\.key/);
  assert.match(selection, /renderPendingQueue\(\)/);
  assert.match(selection, /renderPendingDetail\(\)/);
  const toggle = section(app, "const duplicateReviewToggle = event.target.closest('[data-toggle-duplicate-review]')", 'const duplicateSearchToggle');
  assert.match(toggle, /selectPendingRecord\(`duplicate:\$\{reviewId\}`/);
  const deepLink = section(app, 'function applyDuplicateReviewDeepLink', 'async function loadDuplicateReviews');
  assert.match(deepLink, /selectPendingRecord\(pendingRecordKey\('duplicates', matched\)/);
  assert.doesNotMatch(deepLink, /scrollIntoView/);
});

test('collapsed card and mobile fallback CSS exist', () => {
  assert.match(css, /\.duplicate-review-item-head\{[^}]*display:grid/);
  assert.match(css, /\.duplicate-card-summary/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*duplicate-review-item-head/);
});

test('preview-aligned guidance, options, and save button', () => {
  const renderer = section(app, 'function duplicateReviewCandidateDecisionMarkup', 'function renderPendingDetail');
  assert.match(renderer, /duplicate-review-options/);
  assert.match(renderer, /data-duplicate-resolution-save/);
  assert.match(renderer, /保存并处理下一条/);
  assert.match(renderer, /关联已有客户，不再分配成新客户。/);
  assert.match(renderer, /放行，主管可以继续分配。/);
  assert.match(renderer, /要求补充官网、联系人或来源说明。/);
  const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
  assert.match(html, /待核验中心/);
  assert.match(app, /data-duplicate-resolution-save/);
  assert.doesNotMatch(app, /版本 \$\{esc\(item\.expectedVersion/);
});

test('no explainer copy in the workbench UI', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
  const renderer = section(app, 'function duplicateReviewCandidateDecisionMarkup', 'function renderPendingDetail');
  assert.doesNotMatch(html, /duplicate-review-steps/);
  assert.doesNotMatch(html, /主管不用猜能不能分配/);
  assert.doesNotMatch(renderer, /不是直接拦死/);
  assert.doesNotMatch(renderer, /保存后，主管在线索池看到明确结果/);
  assert.match(renderer, /是不是同一个客户？/);
});

test('save handler reads the checked radio and routes needs_info to the modal', () => {
  const handler = section(app, "const duplicateResolutionSave = event.target.closest('[data-duplicate-resolution-save]')", 'const duplicateReviewToggle');
  assert.match(handler, /input\[data-duplicate-resolution\]\[data-review-id=/);
  assert.match(handler, /:checked/);
  assert.match(handler, /请先选择处理方式/);
  assert.match(handler, /openDuplicateNeedsInfoModal\(reviewId\)/);
  assert.match(handler, /resolveDuplicateReviewAction\(reviewId, resolution/);
});

test('visible app version badge renders the cache-bust version', () => {
  const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
  assert.match(html, /data-app-version="20260821-issue322-recycle-nickname"/);
  assert.match(html, /id="appVersionBadge"/);
  assert.match(app, /function renderAppVersionBadge/);
  assert.match(app, /界面版本 /);
  assert.match(css, /\.app-version-badge/);
});

test('linked leads expose a view entry to the master customer in the pool', () => {
  const intake = section(app, 'function renderIntake', 'function customerProfileFrameUrl');
  assert.match(intake, /item\.duplicate_state === 'exact' && item\.crm_customer_id/);
  assert.match(intake, /查看已关联客户/);
  assert.match(intake, /data-open-customer="\$\{item\.crm_customer_id\}"/);
});
