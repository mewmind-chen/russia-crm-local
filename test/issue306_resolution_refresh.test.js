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

test('resolution success refreshes intake pool and counts in isolation', () => {
  const fn = section(app, 'async function resolveDuplicateReviewAction', 'function openDuplicateNeedsInfoModal');
  assert.match(fn, /reloadDuplicateReviewsAfterMutation\(preferredIndex\)/);
  assert.match(fn, /loadAuthorizedBusinessPage\('intake', \{ reset: true \}\)/);
  assert.match(fn, /refreshTodayTasksAfterAction|refresh\(/);
  assert.match(fn, /catch \(refreshError\)/);
  assert.match(fn, /toast\(/);
  // background refresh must be isolated so the resolution toast flow is never broken
  assert.match(fn, /try \{[\s\S]*loadAuthorizedBusinessPage[\s\S]*\} catch/);
});
