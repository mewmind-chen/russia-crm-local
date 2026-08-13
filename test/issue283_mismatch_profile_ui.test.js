'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');

function topLevelFunction(name) {
  const pattern = new RegExp(`\\n  (?:async )?function ${name}\\(`);
  const match = pattern.exec(app);
  assert.ok(match, `sales-assets/app.js must define ${name}()`);
  const start = match.index;
  const next = /\n  (?:async )?function [A-Za-z0-9_$]+\(/g;
  next.lastIndex = start + match[0].length;
  const following = next.exec(app);
  return app.slice(start, following?.index ?? app.length).trim();
}

function clickHandler() {
  const start = app.indexOf("document.addEventListener('click', async event => {");
  const end = app.indexOf("document.addEventListener('change',", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return app.slice(start, end);
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

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name),
  };
}

function openMismatchHarness() {
  const elements = {
    '#drawerStage': { textContent: '', classList: classList() },
    '#drawerCompany': { textContent: '', classList: classList() },
    '#drawerMeta': { textContent: '', classList: classList() },
    '#drawerUpdateBtn': { classList: classList() },
    '#drawerNicknameBtn': { classList: classList() },
    '#drawerContent': { innerHTML: '', classList: classList() },
    '#customerDrawer': { classList: classList(), setAttribute() {} },
    '#drawerBackdrop': { classList: classList() },
  };
  const state = {
    mismatchRecordDetail: null,
    mismatchRecordRequestEpoch: 0,
    mismatchRecordExpanded: false,
    recycleCustomerDetail: null,
  };
  const pending = new Map();
  const renders = [];
  const toasts = [];
  const api = url => {
    const request = deferred();
    pending.set(url, request);
    return request.promise;
  };
  const $ = selector => elements[selector];
  const resetDrawerActions = () => {};
  const renderMismatchRecordDrawer = () => renders.push(state.mismatchRecordDetail?.recordKey || 'none');
  const toast = message => toasts.push(message);
  const open = Function(
    'state', 'api', '$', 'resetDrawerActions', 'renderMismatchRecordDrawer', 'toast',
    `return (${topLevelFunction('openMismatchRecord')});`,
  )(state, api, $, resetDrawerActions, renderMismatchRecordDrawer, toast);
  const close = Function(
    'state', '$', 'resetDrawerActions',
    `return (${topLevelFunction('closeDrawer')});`,
  )(state, $, resetDrawerActions);
  return { state, elements, pending, renders, toasts, open, close };
}

test('every authorized mismatch record has one explicit profile button while actions stay server-driven', () => {
  const render = topLevelFunction('renderRecycleBin');
  const handler = clickHandler();

  assert.match(app, /mismatchRecordDetail:\s*null/);
  assert.match(app, /mismatchRecordRequestEpoch:\s*0/);
  assert.match(app, /mismatchRecordExpanded:\s*false/);
  assert.match(render, /table\([\s\S]*'class="mismatch-record-table"'/);
  assert.match(
    render,
    /<button type="button" class="text-button tp-company-anchor" data-open-mismatch-record="\$\{esc\(row\.recordKey\)\}">/,
  );
  assert.doesNotMatch(render, /canOpenProfile/);
  assert.doesNotMatch(render, /sourceType\s*===\s*'account'[\s\S]{0,120}manage_customer_recycle/);
  assert.match(render, /row\.actions\?\.includes\('reassign'\)/);
  assert.match(render, /row\.actions\?\.includes\('restore'\)/);
  assert.match(handler, /closest\('\[data-open-mismatch-record\]'\)/);
  assert.match(handler, /openMismatchRecord\(mismatchRecord\.dataset\.openMismatchRecord\)/);
});

test('mismatch profile entry calls the record-key route and never falls through to CRM profile', () => {
  const open = topLevelFunction('openMismatchRecord');
  assert.match(open, /String\(recordKey \|\| ''\)\.trim\(\)/);
  assert.match(
    open,
    /api\(`\/api\/sales-crm\/mismatch-recycle\/\$\{encodeURIComponent\(recordKey\)\}\/profile`\)/,
  );
  assert.doesNotMatch(open, /openCustomerProfile|openRecycleCustomer/);
  assert.match(open, /epoch\s*!==\s*state\.mismatchRecordRequestEpoch/);
  assert.match(open, /state\.mismatchRecordDetail\?\.recordKey\s*!==\s*recordKey/);
});

test('mismatch record table alignment is page-scoped and wraps long company names', () => {
  assert.match(css, /\.mismatch-record-table\s+th:first-child\s*\{[^}]*text-align:left/);
  assert.match(css, /\.mismatch-record-table\s+td:first-child\s*\{[^}]*text-align:left/);
  assert.match(css, /\.mismatch-record-table\s+\.company-cell\s*\{[^}]*align-items:flex-start/);
  assert.match(css, /\.mismatch-record-table\s+th:first-child\s*\{[^}]*width:/);
  assert.match(css, /\.mismatch-record-table\s+\.tp-company-anchor\s*\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /@media\(max-width:780px\)[\s\S]*\.mismatch-record-table/);
  assert.doesNotMatch(css, /(?:^|})\s*th:first-child\s*,\s*td:first-child/);
});

test('older mismatch profile responses cannot overwrite the newest opened record', async () => {
  const harness = openMismatchHarness();
  const openingA = harness.open('account:CRM-A');
  const openingB = harness.open('intake:INTAKE-B');
  const urlA = '/api/sales-crm/mismatch-recycle/account%3ACRM-A/profile';
  const urlB = '/api/sales-crm/mismatch-recycle/intake%3AINTAKE-B/profile';

  harness.pending.get(urlB).resolve({ recordKey: 'intake:INTAKE-B', companyName: 'B' });
  await openingB;
  assert.equal(harness.state.mismatchRecordDetail.recordKey, 'intake:INTAKE-B');
  assert.equal(harness.state.mismatchRecordDetail.loading, false);
  assert.equal(harness.state.mismatchRecordDetail.profile.companyName, 'B');

  harness.pending.get(urlA).resolve({ recordKey: 'account:CRM-A', companyName: 'A' });
  await openingA;
  assert.equal(harness.state.mismatchRecordDetail.recordKey, 'intake:INTAKE-B');
  assert.equal(harness.state.mismatchRecordDetail.profile.companyName, 'B');
});

test('closing a loading mismatch drawer invalidates its late response', async () => {
  const harness = openMismatchHarness();
  const opening = harness.open('account:CRM-A');
  const request = harness.pending.get('/api/sales-crm/mismatch-recycle/account%3ACRM-A/profile');
  const renderCountBeforeClose = harness.renders.length;

  harness.close();
  request.resolve({ recordKey: 'account:CRM-A', companyName: 'late A' });
  await opening;

  assert.equal(harness.elements['#customerDrawer'].classList.contains('open'), false);
  assert.equal(harness.state.mismatchRecordDetail, null);
  assert.equal(harness.renders.length, renderCountBeforeClose);
});
