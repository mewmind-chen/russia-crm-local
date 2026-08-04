'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');

test('Issue 226 tag editor renders compact chips with explicit check state', () => {
  assert.match(source, /\.tag-checks\s*\{\s*display:\s*flex;\s*flex-wrap:\s*wrap/);
  assert.match(source, /\.tag-check\s*\{[^}]*border-radius:\s*999px/);
  assert.doesNotMatch(source, /\.tag-check\s*\{[^}]*min-height:\s*40px/);
  assert.match(source, /\.tag-check input:checked\s*\+\s*span::before|\.tag-check:has\(input:checked\)[^{]*::before/);
  assert.match(source, /<label class="tag-check"[^>]*><input type="checkbox"/);
  assert.match(source, /function renderTagSummary\(c\)/);
  assert.match(source, /data-open-tag-summary/);
  assert.match(source, /\.tag-summary\s*\{[^}]*white-space:\s*nowrap/);
});

test('Issue 226 top summary is a single compact row with +N and opens the tag page', () => {
  assert.match(source, /renderStatusTags[\s\S]*?renderTagSummary\(c\)/);
  assert.match(source, /renderPoolTags[\s\S]*?renderTagSummary\(c\)/);
  assert.match(source, /\+N|`\+[\s\S]*?更多|data-tag-summary-more/);
  assert.match(source, /data-open-tag-summary[\s\S]*?setDetailTab\('tags'\)/);
});
