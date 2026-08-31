'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nextActionTime = require('../sales-assets/next-action-time');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'sales-assets', 'app.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');

const nowMs = Date.parse('2026-08-13T00:00:00Z');

function atOffset(milliseconds) {
  return new Date(nowMs + milliseconds).toISOString();
}

test('describes restrained next-action countdown states against a fixed clock', () => {
  const HOUR = 60 * 60 * 1000;
  const MINUTE = 60 * 1000;
  const matrix = [
    [49 * HOUR, 'normal', '还有 2 天'],
    [36 * HOUR, 'normal', '还有 1 天 12 小时'],
    [12 * HOUR, 'approaching', '还有 12 小时'],
    [5 * HOUR, 'dueSoon', '还有 5 小时'],
    [59 * MINUTE, 'dueSoon', '还有 59 分钟'],
    [0, 'dueSoon', '已到计划时间'],
    [-MINUTE, 'overdue', '已超时 1 分钟'],
    [-26 * HOUR, 'overdue', '已超时 1 天 2 小时'],
  ];

  matrix.forEach(([offset, state, label]) => {
    assert.deepEqual(
      nextActionTime.describeNextActionTime(atOffset(offset), 'utc', nowMs),
      { state, label, ariaLabel: label },
    );
  });
});

test('does not infer relative time for legacy, empty, or invalid plan timestamps', () => {
  const unavailable = { state: 'unavailable', label: '', ariaLabel: '' };
  assert.deepEqual(nextActionTime.describeNextActionTime(atOffset(60_000), '', nowMs), unavailable);
  assert.deepEqual(nextActionTime.describeNextActionTime('', 'utc', nowMs), unavailable);
  assert.deepEqual(nextActionTime.describeNextActionTime('not-a-date', 'utc', nowMs), unavailable);
  assert.deepEqual(nextActionTime.describeNextActionTime(atOffset(60_000), 'utc', NaN), unavailable);
});

test('loads the browser countdown module before the CRM app', () => {
  const cacheToken = '20260824-studio-deck-v1';
  const moduleIndex = htmlSource.indexOf('/sales-assets/next-action-time.js?v=');
  const appIndex = htmlSource.indexOf('/sales-assets/app.js?v=');
  assert.ok(moduleIndex >= 0, 'next-action-time browser module must be loaded');
  assert.ok(moduleIndex < appIndex, 'next-action-time browser module must load before app.js');
  for (const asset of ['app.css', 'ui-format.js', 'next-action-time.js', 'app.js']) {
    assert.ok(
      htmlSource.includes(`/sales-assets/${asset}?v=${cacheToken}`),
      `${asset} must use the current customer-drawer cache token`,
    );
  }
  assert.match(appSource, /const nextActionTime = window\.TradePulseNextActionTime;/);
  assert.match(appSource, /drawerNextActionTimer: null/);
});

test('ordinary CRM drawer keeps exact plan time beside a relative countdown', () => {
  assert.match(appSource, /function nextActionTimeMarkup\(account, nowMs = Date\.now\(\)\)/);
  assert.match(appSource, /storedPlanDateLabel\(account\.next_action_at, account\.next_action_time_basis\)/);
  assert.match(appSource, /nextActionTime\?\.describeNextActionTime/);
  assert.match(appSource, /data-next-action-time/);
  assert.match(appSource, /<time>\$\{esc\(accurate\)\}<\/time>/);
  assert.match(appSource, /nextActionTimeMarkup\(account\)/);
});

test('drawer timer refreshes only each minute and follows drawer and page visibility', () => {
  const lifecycle = appSource.match(/function stopDrawerNextActionTimer\(\)[\s\S]*?\n\s*function openModal\(/)?.[0] || '';
  assert.match(appSource, /function stopDrawerNextActionTimer\(\)/);
  assert.match(appSource, /function refreshDrawerNextActionTime\(\)/);
  assert.match(appSource, /function startDrawerNextActionTimer\(\)/);
  assert.match(lifecycle, /setInterval\(refreshDrawerNextActionTime, 60 \* 1000\)/);
  assert.doesNotMatch(lifecycle, /setInterval\([^,]+,\s*1000\)/);
  assert.match(appSource, /function closeDrawer\(\)\s*\{\s*stopDrawerNextActionTimer\(\);/);
  assert.match(appSource, /renderDrawer\(\)[\s\S]*?startDrawerNextActionTimer\(\);\s*\n\s*\}/);
  assert.match(appSource, /document\.addEventListener\('visibilitychange',[\s\S]*?stopDrawerNextActionTimer\(\)[\s\S]*?startDrawerNextActionTimer\(\)/);
  assert.match(appSource, /state\.drawerOwner\.startsWith\('crm:'\)/);
});

test('next-action write paths trigger an immediate visible countdown refresh', () => {
  const activityHandler = appSource.match(/else if \(form\.id === 'activityForm'\)[\s\S]*?else if \(form\.id === 'customerForm'\)/)?.[0] || '';
  const editHandler = appSource.match(/else if \(form\.id === 'customerProfileEditForm'\)[\s\S]*?else if \(form\.id === 'customerMasterForm'\)/)?.[0] || '';
  assert.match(activityHandler, /await refresh(?:TodayTasksAfterAction)?\([\s\S]*?refreshDrawerNextActionTime\(\)/);
  assert.match(editHandler, /await refresh\('客户资料已更新'\);\s*refreshDrawerNextActionTime\(\);/);
});

test('countdown presentation is restrained and does not animate or paint the card red', () => {
  assert.match(cssSource, /\.next-action-time\s*\{/);
  assert.match(cssSource, /\.next-action-relative\.overdue\s*\{[^}]*color:\s*var\(--danger\)/);
  const countdownCss = cssSource.match(/\.next-action-time\s*\{[\s\S]*?\.next-action-time\.unavailable\s*\{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(countdownCss, /animation|background\s*:\s*(?:var\(--danger\)|#(?:f00|ff0000))/i);
});

function productionFunction(name, nextName) {
  const start = appSource.indexOf(`  function ${name}(`);
  const end = appSource.indexOf(`  function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return appSource.slice(start, end);
}

function executableDrawerLifecycle() {
  const elements = new Map();
  const classList = initial => {
    const values = new Set(initial);
    return {
      add: value => values.add(value),
      remove: value => values.delete(value),
      contains: value => values.has(value),
    };
  };
  const drawer = { classList: classList(['open']), setAttribute() {} };
  const backdrop = { classList: classList(['open']) };
  const content = { innerHTML: '' };
  const stage = { textContent: '' };
  const company = { textContent: '' };
  const meta = { textContent: '' };
  let replacements = 0;
  let mount = { replaceWith() { replacements += 1; } };
  elements.set('#customerDrawer', drawer);
  elements.set('#drawerBackdrop', backdrop);
  elements.set('#drawerContent', content);
  elements.set('#drawerStage', stage);
  elements.set('#drawerCompany', company);
  elements.set('#drawerMeta', meta);
  const $ = selector => selector === '#drawerContent [data-next-action-time]' ? mount : elements.get(selector) || null;

  const visibilityHandlers = [];
  const document = {
    visibilityState: 'visible',
    createElement() {
      const holder = { firstElementChild: null };
      Object.defineProperty(holder, 'innerHTML', {
        set() { holder.firstElementChild = {}; },
      });
      return holder;
    },
    addEventListener(type, handler) {
      if (type === 'visibilitychange') visibilityHandlers.push(handler);
    },
  };
  let nextTimerId = 0;
  const intervals = new Map();
  const setInterval = (handler, milliseconds) => {
    const id = ++nextTimerId;
    intervals.set(id, { handler, milliseconds });
    return id;
  };
  const clearInterval = id => intervals.delete(id);
  const account = {
    id: 'account-1', external_customer_id: 'RU-1', company_name: 'Example',
    next_action: 'Follow up', next_action_at: '2026-08-14 00:00:00',
    next_action_time_basis: 'utc', priority: 'B', website: 'https://example.com',
  };
  const state = {
    drawerOwner: '', drawerRequestEpoch: 0, drawerNextActionTimer: null,
    mismatchRecordRequestEpoch: 0, mismatchRecordDetail: null, mismatchRecordExpanded: false,
    recycleCustomerDetail: null, selectedCustomerId: account.id, drawerAiContext: null,
    data: { accounts: [account], activities: [], rfqs: [], quotes: [], orders: [], timeline: [], impersonation: null },
  };
  const lifecycleSource = [
    productionFunction('claimCustomerDrawer', 'isCustomerDrawerRequestCurrent'),
    productionFunction('closeDrawer', 'evaluationCard'),
    productionFunction('renderDrawer', 'stopDrawerNextActionTimer'),
    productionFunction('stopDrawerNextActionTimer', 'openModal'),
  ].join('\n');
  const dependencyNames = [
    'renderMismatchRecordDrawer', 'renderRecycleDrawer', 'resetDrawerActions',
    'configureDrawerActions', 'syncStarButton', 'stageLabel', 'accountDisplayName', 'accountIdentity',
    'alertFor', 'creatorDisplayName', 'customerAIEnabled', 'technicalAIPresentationAllowed',
    'isSalesRepresentative', 'labelsForAccount', 'relative',
    'hasMeaningfulAlertCopy', 'alertReasons', 'esc', 'shortDate', 'sourceTagMarkup',
    'drawerFactMarkup', 'customerAiSection', 'can', 'canReturnCustomer',
    'canRejectCustomer', 'renderActivityTimelineItem', 'nextActionTimeMarkup',
    'accountStageOf', 'managerStateDisplay', 'registerProfilePageWidgets', 'drawerFactsContext',
    'masterProfileSectionHtml', 'nextStepHtml', 'alertStepHtml', 'alertDetailsHtml',
    'timelineSectionHtml',
  ];
  const identity = value => String(value || '');
  const dependencyValues = [
    () => {}, () => {}, () => {}, () => {}, () => {}, identity, () => 'Example', identity,
    () => null, () => 'System', () => false, () => false, () => false, () => [], () => 'never',
    () => false, () => [], identity, identity, () => '', () => '',
    () => '', () => '', () => false, () => false, () => false, () => '',
    value => `<span data-next-action-time>${identity(value.next_action_at)}</span>`,
    account => account?.stage || account?.state?.stage?.key || '',
    () => {},
    () => ({ drawerFactsWidget: null, fieldWidget: null, schema: null, data: {}, formatters: {}, fallback: [] }),
    () => '',
    () => '',
    () => '',
    () => '',
    () => '',
  ];
  const compile = Function(
    'state', '$', 'document', 'setInterval', 'clearInterval',
    ...dependencyNames,
    `${lifecycleSource}\nreturn { claimCustomerDrawer, closeDrawer, renderDrawer, stopDrawerNextActionTimer, refreshDrawerNextActionTime, startDrawerNextActionTimer };`,
  );
  const api = compile(state, $, document, setInterval, clearInterval, ...dependencyValues);
  const visibilityStart = appSource.indexOf("  document.addEventListener('visibilitychange'");
  const visibilityEnd = appSource.indexOf('\n\n  initializeDataTableOverflowHints', visibilityStart);
  assert.ok(visibilityStart >= 0 && visibilityEnd > visibilityStart, 'visibility handler must remain executable');
  Function(
    'state', '$', 'document', 'stopDrawerNextActionTimer',
    'refreshDrawerNextActionTime', 'startDrawerNextActionTimer',
    appSource.slice(visibilityStart, visibilityEnd),
  )(state, $, document, api.stopDrawerNextActionTimer,
    api.refreshDrawerNextActionTime, api.startDrawerNextActionTimer);

  return {
    api, state, account, drawer, document, intervals, visibilityHandlers,
    replacements: () => replacements,
    resetMount() { mount = { replaceWith() { replacements += 1; } }; },
  };
}

test('executable production lifecycle isolates the minute timer to the ordinary CRM drawer', () => {
  const harness = executableDrawerLifecycle();
  harness.api.claimCustomerDrawer(`crm:${harness.account.id}`);
  harness.api.renderDrawer();
  assert.equal(harness.intervals.size, 1);
  assert.equal([...harness.intervals.values()][0].milliseconds, 60 * 1000);

  ['mismatch:record-1', 'recycle:account-1', 'intake:intake-1'].forEach(owner => {
    harness.api.claimCustomerDrawer(owner);
    assert.equal(harness.intervals.size, 0, `${owner} must stop the CRM timer`);
    harness.api.startDrawerNextActionTimer();
    assert.equal(harness.intervals.size, 0, `${owner} must not start the CRM timer`);
    harness.api.claimCustomerDrawer(`crm:${harness.account.id}`);
    harness.api.startDrawerNextActionTimer();
    assert.equal(harness.intervals.size, 1);
  });

  harness.api.closeDrawer();
  assert.equal(harness.intervals.size, 0);
  assert.equal(harness.state.drawerNextActionTimer, null);
});

test('executable visibility lifecycle stops hidden work and resumes one immediate minute timer', () => {
  const harness = executableDrawerLifecycle();
  const [visibilityChange] = harness.visibilityHandlers;
  assert.equal(typeof visibilityChange, 'function');
  harness.api.claimCustomerDrawer(`crm:${harness.account.id}`);
  harness.api.startDrawerNextActionTimer();
  assert.equal(harness.intervals.size, 1);

  harness.document.visibilityState = 'hidden';
  visibilityChange();
  assert.equal(harness.intervals.size, 0);

  const before = harness.replacements();
  harness.document.visibilityState = 'visible';
  visibilityChange();
  assert.ok(harness.replacements() > before, 'visible restoration must refresh immediately');
  assert.equal(harness.intervals.size, 1);
  assert.equal([...harness.intervals.values()][0].milliseconds, 60 * 1000);
});
