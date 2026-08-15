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
  for (const [start, end] of [
    ['async function resolveDuplicateReviewAction', 'function openDuplicateNeedsInfoModal'],
    ['async function resolveProtectedConflictAction', 'function openDuplicateNeedsInfoModal'],
  ]) {
    const fn = section(app, start, end);
    assert.match(fn, /const previousIndex = pendingSelectionIndex\(\)/);
    assert.match(fn, /selectPendingAfterMutation\(previousIndex\)/);
    assert.match(fn, /loadAuthorizedBusinessPage\('intake', \{ reset: true \}\)/);
    assert.match(fn, /refreshTodayTasksAfterAction/);
    assert.match(fn, /catch \(refreshError\)/);
    assert.match(fn, /toast\(/);
    // Background refresh must be isolated so a committed resolution remains successful.
    assert.match(fn, /try \{[\s\S]*Promise\.all\([\s\S]*loadAuthorizedBusinessPage[\s\S]*refreshTodayTasksAfterAction[\s\S]*\)[\s\S]*\} catch/);
  }
});

test('resolution errors preserve selected detail controls and candidate search state', () => {
  const helper = section(app, 'function setPendingDetailMutationState', 'function showPendingDetailError');
  assert.match(helper, /querySelectorAll\('button, input, textarea, select'\)/);
  assert.match(helper, /pendingWasDisabled/);

  const duplicate = section(app, 'async function resolveDuplicateReviewAction', 'async function resolveProtectedConflictAction');
  assert.match(duplicate, /const selectedKey = state\.pendingCenter\.selectedKey/);
  assert.match(duplicate, /setPendingDetailMutationState\(true\)/);
  assert.match(duplicate, /catch \(error\)[\s\S]*state\.pendingCenter\.selectedKey = selectedKey/);
  assert.match(duplicate, /showPendingDetailError\(error/);
  assert.doesNotMatch(duplicate, /searchOpenId\s*=/);
  assert.doesNotMatch(duplicate, /searchQueries\[[^\]]+\]\s*=/);

  const conflict = section(app, 'async function resolveProtectedConflictAction', 'function openDuplicateNeedsInfoModal');
  assert.match(conflict, /const selectedKey = state\.pendingCenter\.selectedKey/);
  assert.match(conflict, /setPendingDetailMutationState\(true\)/);
  assert.match(conflict, /catch \(error\)[\s\S]*state\.pendingCenter\.selectedKey = selectedKey/);
  assert.match(conflict, /showPendingDetailError\(error/);
});
