'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

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
  assert.match(app, /data-pending-move="-1"[^>]*\$\{interactionLocked \|\| index <= 0 \? 'disabled' : ''\}/);
  assert.match(app, /data-pending-move="1"[^>]*\$\{interactionLocked \|\| index >= records\.length - 1 \? 'disabled' : ''\}/);
  const start = app.indexOf("const pendingMove = event.target.closest('[data-pending-move]')");
  const end = app.indexOf("const conflictToggle", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(app.slice(start, end), /movePendingSelection\(Number\(pendingMove\.dataset\.pendingMove\)\)/);
  assert.match(topLevelFunction('movePendingSelection'), /if \(pendingInteractionLocked\(\)\) return/);
  const lock = topLevelFunction('pendingInteractionLocked');
  assert.match(lock, /conflictPendingId/);
  assert.match(lock, /duplicateReviews\.pendingAction/);
  assert.match(lock, /activeTab === 'conflicts'[\s\S]*conflictsLoading[\s\S]*duplicateReviews\.loading/);
  assert.match(topLevelFunction('pendingNavigationMarkup'), /pendingInteractionLocked\(\)/);
});

test('queue selection stays disabled while a verification mutation is pending', () => {
  const start = app.indexOf('function renderPendingQueue');
  const end = app.indexOf('function duplicateReviewCandidateDecisionMarkup', start);
  const source = app.slice(start, end);
  assert.match(source, /pendingInteractionLocked\(\)/);
  assert.match(topLevelFunction('pendingInteractionLocked'), /state\.protectedCustomers\.conflictPendingId/);
  assert.match(topLevelFunction('pendingInteractionLocked'), /state\.protectedCustomers\.conflictsLoading/);
  assert.match(source, /data-pending-record-key="\$\{esc\(record\.key\)\}"[^>]*\$\{interactionPending \? 'disabled' : ''\}/);
});

test('conflict loading locks mounted queue and detail controls without losing drafts', async () => {
  const state = {
    pendingCenter: { activeTab: 'conflicts', selectedKey: 'conflict:A', query: '' },
    duplicateReviews: { pendingAction: '', loading: false },
    protectedCustomers: {
      conflicts: [{ conflictId: 'A' }, { conflictId: 'B' }],
      conflictStatus: 'unresolved', conflictPage: 1, conflictPageSize: 50,
      conflictsLoading: false, conflictsError: '', conflictPendingId: '',
    },
  };
  const queueButton = { disabled: false, dataset: {} };
  const draft = { disabled: false, dataset: {}, value: 'keep this note' };
  const originallyDisabled = { disabled: true, dataset: {} };
  const roots = {
    '#pendingQueueList': { querySelectorAll: () => [queueButton] },
    '#pendingDetail': { querySelectorAll: () => [draft, originallyDisabled] },
  };
  const pendingInteractionLocked = Function(
    'state', `'use strict'; return (${topLevelFunction('pendingInteractionLocked')});`,
  )(state);
  const setPendingInteractionLock = Function(
    '$', `'use strict'; return (${topLevelFunction('setPendingInteractionLock')});`,
  )(selector => roots[selector] || null);
  const syncPendingInteractionLock = Function(
    'pendingInteractionLocked', 'setPendingInteractionLock',
    `'use strict'; return (${topLevelFunction('syncPendingInteractionLock')});`,
  )(pendingInteractionLocked, setPendingInteractionLock);
  const selections = [];
  const selectPendingRecord = key => {
    state.pendingCenter.selectedKey = key;
    selections.push(key);
    return true;
  };
  const selectPendingRecordFromQueue = Function(
    'pendingInteractionLocked', 'selectPendingRecord',
    `'use strict'; return (${topLevelFunction('selectPendingRecordFromQueue')});`,
  )(pendingInteractionLocked, selectPendingRecord);
  const records = () => state.protectedCustomers.conflicts.map(item => ({
    key: `conflict:${item.conflictId}`,
  }));
  const pendingSelectionIndex = () => records().findIndex(
    item => item.key === state.pendingCenter.selectedKey,
  );
  const movePendingSelection = Function(
    'pendingInteractionLocked', 'pendingQueueRecords', 'pendingSelectionIndex', 'selectPendingRecord',
    `'use strict'; return (${topLevelFunction('movePendingSelection')});`,
  )(pendingInteractionLocked, records, pendingSelectionIndex, selectPendingRecord);
  const request = deferred();
  const loadProtectedConflicts = Function(
    'canManageProtectedCustomers', 'state', 'syncPendingInteractionLock',
    'setProtectedInlineStatus', 'renderProtectedConflicts', 'renderProtectedConflictPagination',
    'api', 'applyProtectedConflictResult', 'applyDuplicateReviewDeepLink', 'toast',
    'renderPendingCenter',
    `'use strict'; return (${topLevelFunction('loadProtectedConflicts')});`,
  )(
    () => true,
    state,
    syncPendingInteractionLock,
    () => {},
    () => {},
    () => {},
    () => request.promise,
    result => { state.protectedCustomers.conflicts = result.items; },
    () => {},
    () => {},
    () => {},
  );

  const loading = loadProtectedConflicts();
  assert.equal(state.protectedCustomers.conflictsLoading, true);
  assert.equal(queueButton.disabled, true);
  assert.equal(draft.disabled, true);
  assert.equal(draft.value, 'keep this note');

  selectPendingRecordFromQueue('conflict:B');
  movePendingSelection(1);
  assert.equal(state.pendingCenter.selectedKey, 'conflict:A');
  assert.deepEqual(selections, []);

  request.resolve({ items: state.protectedCustomers.conflicts, totalPages: 1 });
  assert.equal(await loading, true);
  assert.equal(state.protectedCustomers.conflictsLoading, false);
  assert.equal(queueButton.disabled, false);
  assert.equal(draft.disabled, false);
  assert.equal(originallyDisabled.disabled, true);
  assert.equal(draft.value, 'keep this note');
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

test('deep links apply once per navigation and reapply after leaving and revisiting', () => {
  const state = {
    pendingCenter: {
      activeTab: 'duplicates', selectedKey: '', query: '', mobileDetailOpen: false,
      deepLinkUnavailable: false, deepLinkNavigationHash: '',
      deepLinkNavigationEpoch: 0, consumedDeepLinkEpoch: -1,
    },
    duplicateReviews: {
      loaded: true,
      items: [{ id: 'A', input: {} }, { id: 'B', input: {} }],
    },
    protectedCustomers: { conflictsLoaded: true, conflicts: [] },
  };
  const location = { hash: '#protectedCustomers?review=A' };
  const selections = [];
  const beginPendingDeepLinkNavigation = Function(
    'state', `'use strict'; return (${topLevelFunction('beginPendingDeepLinkNavigation')});`,
  )(state);
  const viewFromLocationHash = Function(
    `'use strict'; return (${topLevelFunction('viewFromLocationHash')});`,
  )();
  const applyDeepLink = Function(
    'location', 'state', 'activateProtectionView', 'canManageProtectedCustomers',
    'canReviewDuplicateCustomers', 'renderPendingCenter', 'activatePendingTab',
    'pendingRecordKey', 'selectPendingRecord', 'beginPendingDeepLinkNavigation',
    'viewFromLocationHash',
    `'use strict'; return (${topLevelFunction('applyDuplicateReviewDeepLink')});`,
  )(
    location,
    state,
    () => {},
    () => true,
    () => true,
    () => {},
    type => { state.pendingCenter.activeTab = type; },
    (type, item) => `${type === 'duplicates' ? 'duplicate' : 'conflict'}:${item.id || item.conflictId}`,
    key => {
      state.pendingCenter.selectedKey = key;
      selections.push(key);
      return true;
    },
    beginPendingDeepLinkNavigation,
    viewFromLocationHash,
  );

  assert.equal(viewFromLocationHash(location.hash), 'protectedCustomers');
  applyDeepLink();
  assert.equal(state.pendingCenter.selectedKey, 'duplicate:A');

  state.pendingCenter.selectedKey = 'duplicate:B';
  applyDeepLink(); // refreshTodayTasksAfterAction -> refresh -> renderAll
  assert.equal(state.pendingCenter.selectedKey, 'duplicate:B');

  location.hash = '#dashboard';
  beginPendingDeepLinkNavigation(location.hash);
  location.hash = '#protectedCustomers?review=A';
  beginPendingDeepLinkNavigation(location.hash);
  applyDeepLink();
  assert.equal(state.pendingCenter.selectedKey, 'duplicate:A');

  state.pendingCenter.selectedKey = 'duplicate:B';
  applyDeepLink();
  assert.equal(state.pendingCenter.selectedKey, 'duplicate:B');
  assert.deepEqual(selections, ['duplicate:A', 'duplicate:A']);
});

test('retired inline expansion state is removed', () => {
  assert.doesNotMatch(app, /expandedConflictId/);
  assert.doesNotMatch(app, /expandedId/);
});
