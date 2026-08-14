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

test('duplicate review cards collapse by default with business summary and 查看并处理', () => {
  const renderer = section(app, "root.innerHTML = model.items.map(review => {", '}).join(\'\');');
  assert.match(renderer, /data-toggle-duplicate-review/);
  assert.match(renderer, /查看并处理/);
  assert.match(renderer, /等待管理员核验/);
  assert.match(renderer, /已关联已有客户/);
  assert.match(renderer, /已确认不是同一客户/);
  assert.match(renderer, /待补充资料/);
  assert.match(renderer, /疑似重名，需确认是否同一客户/);
  assert.match(renderer, /expanded \? '收起' : '查看并处理'/);
  assert.match(renderer, /duplicate-review-comparison\$\{expanded \? '' : ' hidden'\}/);
});

test('duplicate review expanded view asks the one question and keeps three business actions', () => {
  const renderer = section(app, "root.innerHTML = model.items.map(review => {", '}).join(\'\');');
  assert.match(renderer, /管理员只需要确认：它是不是已有客户？/);
  assert.match(renderer, />是同一个客户</);
  assert.match(renderer, />不是同一个客户</);
  assert.match(renderer, />资料还不够</);
  for (const attr of ['data-duplicate-resolution="confirmed_same"', 'data-duplicate-resolution="confirmed_distinct"', 'data-duplicate-resolution="needs_info"']) {
    assert.match(renderer, new RegExp(attr.replace(/["]/g, '\\"')));
  }
});

test('no technical copy leaks into the review UI', () => {
  const renderer = section(app, "root.innerHTML = model.items.map(review => {", '}).join(\'\');');
  assert.doesNotMatch(renderer, /legacy-v1/);
  assert.doesNotMatch(renderer, /evaluatedRuleVersion/);
  assert.doesNotMatch(renderer, /提交人/);
  assert.doesNotMatch(renderer, /sha256/);
});

test('expandedId toggle handler and deep-link expand exist', () => {
  const toggle = section(app, "const duplicateReviewToggle = event.target.closest('[data-toggle-duplicate-review]')", 'const duplicateSearchToggle');
  assert.match(toggle, /expandedId/);
  assert.match(toggle, /renderDuplicateReviews\(\)/);
  assert.match(app, /function applyDuplicateReviewDeepLink/);
  assert.match(app, /model\.expandedId = matched\.id/);
});

test('collapsed card and mobile fallback CSS exist', () => {
  assert.match(css, /\.duplicate-review-item-head\{[^}]*display:grid/);
  assert.match(css, /\.duplicate-card-summary/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*duplicate-review-item-head/);
});

test('preview-aligned guidance, options, save button and warm notes', () => {
  const renderer = section(app, "root.innerHTML = model.items.map(review => {", '}).join(\'\');');
  assert.match(renderer, /不是直接拦死，只是先保护客户不被误分配。/);
  assert.match(renderer, /duplicate-review-options/);
  assert.match(renderer, /data-duplicate-resolution-save/);
  assert.match(renderer, /保存处理结果/);
  assert.match(renderer, /关联已有客户，不再分配成新客户。/);
  assert.match(renderer, /放行，主管可以继续分配。/);
  assert.match(renderer, /要求补充官网、联系人或来源说明。/);
  assert.match(renderer, /保存后，主管在线索池看到明确结果，不再卡在转圈。/);
  const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
  assert.match(html, /这里专门处理“可能重名”的线索/);
  assert.match(html, /duplicate-review-steps/);
  assert.match(html, /主管不用猜能不能分配/);
  assert.match(app, /data-duplicate-resolution-save/);
  assert.doesNotMatch(app, /版本 \$\{esc\(item\.expectedVersion/);
});

test('save handler reads the checked radio and routes needs_info to the modal', () => {
  const handler = section(app, "const duplicateResolutionSave = event.target.closest('[data-duplicate-resolution-save]')", 'const duplicateReviewToggle');
  assert.match(handler, /input\[data-duplicate-resolution\]\[data-review-id=/);
  assert.match(handler, /:checked/);
  assert.match(handler, /请先选择处理方式/);
  assert.match(handler, /openDuplicateNeedsInfoModal\(reviewId\)/);
  assert.match(handler, /resolveDuplicateReviewAction\(reviewId, resolution/);
});
