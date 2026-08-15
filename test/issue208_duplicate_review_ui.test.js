'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets/app.css'), 'utf8');

test('duplicate review lives only in customer protection and dedupe workspace', () => {
  assert.match(html, /data-view="protectedCustomers"[^>]*>[\s\S]*?客户保护与查重/);
  assert.equal((html.match(/id="pendingVerificationPanel"/g) || []).length, 1);
  const usersEnd = html.indexOf('<section id="protectedCustomersView"');
  assert.equal(html.slice(0, usersEnd).includes('id="pendingVerificationPanel"'), false);
  assert.match(html, /id="protectedCustomersView"[\s\S]*id="pendingVerificationPanel"/);
  assert.doesNotMatch(html, /data-duplicate-review-candidate/);
});

test('review UI renders submitted and existing customers with real website links and evidence classes', () => {
  assert.match(app, /duplicate-review-comparison/);
  assert.match(app, /员工新提交/);
  assert.match(app, /疑似已有客户/);
  assert.match(app, /websiteMarkup\(input\.website\)/);
  assert.match(app, /websiteMarkup\(candidate\.website\)/);
  assert.match(app, /reliableEvidence/);
  assert.match(app, /referenceSignals/);
  assert.match(app, /href="\$\{esc\(site\.href\)\}" target="_blank" rel="noopener"/);
});

test('candidate replacement, single decisions and distinct-only bulk action call real APIs', () => {
  assert.match(app, /\/duplicate-reviews\/\$\{encodeURIComponent\(reviewId\)\}\/candidates\?q=/);
  assert.match(app, /method: 'PATCH'[\s\S]*body: JSON\.stringify\(\{ customerId \}\)/);
  assert.match(app, /data-duplicate-resolution="confirmed_same"/);
  assert.match(app, /data-duplicate-resolution="confirmed_distinct"/);
  assert.match(app, /\/duplicate-reviews\/bulk-distinct/);
  assert.match(html, /id="duplicateReviewBulkDistinct"[^>]*>批量确认不是同一客户/);
  assert.doesNotMatch(html, /批量确认同一客户/);
  assert.doesNotMatch(app, /bulk-same|bulkSame/);
});

test('candidate selection and closing invalidate queued or in-flight searches', () => {
  assert.match(app, /function invalidateDuplicateCandidateSearch\(reviewId\)[\s\S]*requestEpochs\[reviewId\][\s\S]*\+ 1/);
  assert.match(app, /async function chooseDuplicateCandidate\(reviewId, customerId\)[\s\S]*invalidateDuplicateCandidateSearch\(reviewId\)[\s\S]*method: 'PATCH'/);
  assert.match(app, /const duplicateSearchToggle[\s\S]*invalidateDuplicateCandidateSearch\(state\.duplicateReviews\.searchOpenId\)/);
  assert.match(app, /event\.key === 'Escape'[\s\S]*invalidateDuplicateCandidateSearch\(reviewId\)[\s\S]*searchOpenId = ''/);
});

test('comparison is two-column desktop and stacked mobile with stable actions', () => {
  assert.match(css, /\.duplicate-review-comparison\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*\.duplicate-review-comparison\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.duplicate-review-actions\{position:sticky;bottom:0/);
  assert.match(css, /\.duplicate-review-actions \.button\{[^}]*min-height:44px/);
});

test('review access is a union while protection administration keeps its original gate', () => {
  assert.match(app, /function canReviewDuplicateCustomers\(\)[\s\S]*view_all_customers[\s\S]*manage_intake/);
  assert.match(app, /function canAccessProtectionAndDedupe\(\)[\s\S]*canManageProtectedCustomers\(\) \|\| canReviewDuplicateCustomers\(\)/);
  assert.match(app, /protectedAdminWorkspace[^\n]*classList\.toggle\('hidden', !canManageProtectedCustomers\(\)\)/);
  assert.match(app, /#pendingVerificationPanel'\)\?\.classList\.toggle\('hidden', !canAccessProtectionAndDedupe\(\)\)/);
});
