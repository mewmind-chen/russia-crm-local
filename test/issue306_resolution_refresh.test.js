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

function topLevelFunction(name) {
  const pattern = new RegExp(`\\n  (?:async )?function ${name}\\(`);
  const match = pattern.exec(app);
  assert.ok(match, `sales-assets/app.js must define ${name}()`);
  const next = /\n  (?:async )?function [A-Za-z0-9_$]+\(/g;
  next.lastIndex = match.index + match[0].length;
  const following = next.exec(app);
  return app.slice(match.index, following?.index ?? app.length).trim();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mutationHarness(type) {
  const duplicate = type === 'duplicates';
  const state = {
    pendingCenter: {
      activeTab: duplicate ? 'duplicates' : 'conflicts',
      selectedKey: duplicate ? 'duplicate:A' : 'conflict:A',
    },
    duplicateReviews: {
      items: duplicate ? [{ id: 'A' }, { id: 'B' }] : [],
      total: duplicate ? 2 : 0,
      pendingAction: '', loading: false, selectedIds: new Set(duplicate ? ['A'] : []),
    },
    protectedCustomers: {
      conflicts: duplicate ? [] : [{ conflictId: 'A' }, { conflictId: 'B' }],
      conflictTotal: duplicate ? 0 : 2,
      unresolved: duplicate ? 0 : 2,
      conflictPendingId: '', conflictsLoading: false,
    },
  };
  const reload = deferred();
  const mutationResult = { committed: true };
  const toasts = [];
  const errors = [];
  const renders = [];
  const pendingSelectionIndex = () => 0;
  const setPendingDetailMutationState = pending => renders.push(['detail-lock', pending]);
  const renderPendingQueue = () => renders.push(['queue']);
  const renderDuplicateReviews = () => renders.push(['duplicates']);
  const renderPendingCenter = () => renders.push(['center']);
  const selectPendingAfterMutation = index => {
    const rows = duplicate ? state.duplicateReviews.items : state.protectedCustomers.conflicts;
    const row = rows[Math.min(index, Math.max(0, rows.length - 1))];
    state.pendingCenter.selectedKey = row
      ? `${duplicate ? 'duplicate' : 'conflict'}:${duplicate ? row.id : row.conflictId}`
      : '';
  };
  const api = async () => mutationResult;
  const common = {
    state,
    pendingSelectionIndex,
    setPendingDetailMutationState,
    renderPendingQueue,
    api,
    toast: message => toasts.push(message),
    selectPendingAfterMutation,
    loadAuthorizedBusinessPage: async () => {},
    refreshTodayTasksAfterAction: async () => {},
    showPendingDetailError: error => errors.push(error),
  };
  const action = duplicate
    ? Function(
      ...Object.keys(common),
      'reloadDuplicateReviewsAfterMutation', 'renderDuplicateReviews',
      'openDuplicateNeedsInfoModal', 'window',
      `'use strict'; return (${topLevelFunction('resolveDuplicateReviewAction')});`,
    )(
      ...Object.values(common),
      () => reload.promise, renderDuplicateReviews, () => {}, { confirm: () => true },
    )
    : Function(
      ...Object.keys(common),
      'reloadProtectedWorkspace', 'renderPendingCenter',
      `'use strict'; return (${topLevelFunction('resolveProtectedConflictAction')});`,
    )(
      ...Object.values(common),
      () => reload.promise, renderPendingCenter,
    );
  return { action, state, reload, mutationResult, toasts, errors, renders };
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
  const helper = section(app, 'function setPendingInteractionLock', 'function syncPendingInteractionLock');
  assert.match(helper, /'#pendingQueueList', '#pendingDetail'/);
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

for (const type of ['duplicates', 'conflicts']) {
  test(`${type} mutation keeps committed success and removes the stale record when reload fails`, async () => {
    const harness = mutationHarness(type);
    const action = type === 'duplicates'
      ? harness.action('A', 'confirmed_distinct')
      : harness.action('A', { decision: 'confirm_new' });

    await Promise.resolve();
    assert.equal(
      type === 'duplicates'
        ? harness.state.duplicateReviews.pendingAction
        : harness.state.protectedCustomers.conflictPendingId,
      'A',
    );

    harness.reload.resolve(false);
    const result = await action;

    assert.equal(result, harness.mutationResult);
    assert.deepEqual(
      type === 'duplicates'
        ? harness.state.duplicateReviews.items.map(item => item.id)
        : harness.state.protectedCustomers.conflicts.map(item => item.conflictId),
      ['B'],
    );
    assert.equal(harness.state.pendingCenter.selectedKey, `${type === 'duplicates' ? 'duplicate' : 'conflict'}:B`);
    assert.equal(harness.errors.length, 0);
    assert.equal(harness.toasts.some(message => /刷新失败/.test(message)), true);
    assert.equal(
      type === 'duplicates'
        ? harness.state.duplicateReviews.pendingAction
        : harness.state.protectedCustomers.conflictPendingId,
      '',
    );
  });
}
