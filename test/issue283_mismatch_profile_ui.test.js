'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');

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

function customerDrawerHarness() {
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
    data: {
      accounts: [{ id: 'CRM-B', company_name: 'CRM B' }],
    },
    selectedCustomerId: '',
    drawerOwner: '',
    drawerRequestEpoch: 0,
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
  const renderDrawer = () => renders.push(`drawer:${state.drawerOwner}`);
  const toast = message => toasts.push(message);
  const stopDrawerNextActionTimer = () => {};
  const claimCustomerDrawer = Function(
    'state', 'stopDrawerNextActionTimer', `return (${topLevelFunction('claimCustomerDrawer')});`,
  )(state, stopDrawerNextActionTimer);
  const isCustomerDrawerRequestCurrent = Function(
    'state', '$', `return (${topLevelFunction('isCustomerDrawerRequestCurrent')});`,
  )(state, $);
  const close = Function(
    'state', '$', 'resetDrawerActions', 'stopDrawerNextActionTimer',
    `return (${topLevelFunction('closeDrawer')});`,
  )(state, $, resetDrawerActions, stopDrawerNextActionTimer);
  const openMismatch = Function(
    'state', 'api', '$', 'resetDrawerActions', 'renderMismatchRecordDrawer', 'toast',
    'claimCustomerDrawer', 'isCustomerDrawerRequestCurrent', 'closeDrawer',
    `return (${topLevelFunction('openMismatchRecord')});`,
  )(state, api, $, resetDrawerActions, renderMismatchRecordDrawer, toast,
    claimCustomerDrawer, isCustomerDrawerRequestCurrent, close);
  const openRecycle = Function(
    'state', 'api', '$', 'resetDrawerActions', 'renderDrawer', 'toast', 'can',
    'claimCustomerDrawer', 'isCustomerDrawerRequestCurrent', 'closeDrawer',
    `return (${topLevelFunction('openRecycleCustomer')});`,
  )(state, api, $, resetDrawerActions, renderDrawer, toast, () => true,
    claimCustomerDrawer, isCustomerDrawerRequestCurrent, close);
  const openCustomer = Function(
    'state', '$', 'resetDrawerActions', 'renderDrawer', 'toast', 'claimCustomerDrawer',
    `return (${topLevelFunction('openCustomer')});`,
  )(state, $, resetDrawerActions, renderDrawer, toast, claimCustomerDrawer);
  const guardedRenderDrawer = Function(
    'state', 'renderMismatchRecordDrawer',
    `return (${topLevelFunction('renderDrawer')});`,
  )(state, renderMismatchRecordDrawer);
  return {
    state, elements, pending, renders, toasts, openMismatch, openRecycle, openCustomer,
    guardedRenderDrawer, close,
  };
}

function mismatchPayload(overrides = {}) {
  return {
    recordKey: 'account:CRM-A',
    sourceType: 'account',
    customer: {
      accountId: 'CRM-A', intakeItemId: '', externalCustomerId: 'RU-1', nickname: '',
      companyName: 'Acme', country: '俄罗斯', city: '莫斯科', website: 'https://acme.example',
      industry: '工业自动化', customerType: '终端制造商', products: '传感器',
      description: '自动化设备制造商',
    },
    recycle: {
      kind: 'mismatch', reason: '采购方向不符', previousOwnerId: 'U-OLD',
      previousOwnerName: '原销售', recycledBy: 'U-MGR', recycledByName: '经理',
      recycledAt: '2026-08-13T02:00:00Z',
    },
    profile: {
      customerPool: [], customers: [], reconJobs: [], reconResults: [], contactReconJobs: [],
      people: [], accountContacts: [],
    },
    history: {
      activities: [], rfqs: [], quotes: [], orders: [], timeline: [], evaluations: [], auditLog: [],
    },
    actions: [],
    ...overrides,
  };
}

function mismatchRendererHarness(payload, expanded = false) {
  const elements = {
    '#drawerStage': { textContent: '', classList: classList() },
    '#drawerCompany': { textContent: '', classList: classList() },
    '#drawerMeta': { textContent: '', classList: classList() },
    '#drawerUpdateBtn': { classList: classList() },
    '#drawerNicknameBtn': { classList: classList() },
    '#drawerContent': { innerHTML: '', classList: classList() },
  };
  const state = {
    mismatchRecordDetail: { ...payload, loading: false, error: '' },
    mismatchRecordExpanded: expanded,
    data: { assignmentCandidates: [{ id: 'U-NEW', name: '新销售' }] },
  };
  const $ = selector => elements[selector];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));
  const shortDate = value => String(value || '—');
  const safeObject = Function(`return (${topLevelFunction('mismatchSafeObject')});`)();
  const safeText = Function('mismatchSafeObject', `return (${topLevelFunction('mismatchSafeText')});`)(safeObject);
  const safeJoin = Function('mismatchSafeText', `return (${topLevelFunction('mismatchSafeJoin')});`)(safeText);
  const website = Function('esc', 'mismatchSafeText',
    `return (${topLevelFunction('mismatchWebsiteMarkup')});`)(esc, safeText);
  const render = Function(
    'state', '$', 'resetDrawerActions', 'esc', 'shortDate', 'mismatchWebsiteMarkup',
    'mismatchSafeObject', 'mismatchSafeText', 'mismatchSafeJoin',
    `return (${topLevelFunction('renderMismatchRecordDrawer')});`,
  )(state, $, () => {}, esc, shortDate, website, safeObject, safeText, safeJoin);
  render();
  return { state, elements, html: elements['#drawerContent'].innerHTML, render };
}

test('mismatch profile assets use the current production cache token', () => {
  assert.match(shell, /sales-assets\/app\.css\?v=20260814-issue306-dedupe-rework/);
  assert.match(shell, /sales-assets\/app\.js\?v=20260814-issue306-dedupe-rework/);
});

test('every authorized mismatch record has one explicit profile button while actions stay server-driven', () => {
  const render = topLevelFunction('renderRecycleBin');
  const handler = clickHandler();

  assert.match(app, /mismatchRecordDetail:\s*null/);
  assert.match(app, /mismatchRecordRequestEpoch:\s*0/);
  assert.match(app, /mismatchRecordExpanded:\s*false/);
  assert.match(app, /drawerRequestEpoch:\s*0/);
  assert.match(app, /drawerOwner:\s*''/);
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
  assert.match(open, /claimCustomerDrawer\(`mismatch:\$\{recordKey\}`\)/);
  assert.match(open, /isCustomerDrawerRequestCurrent\(request\)/);
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
  const harness = customerDrawerHarness();
  const openingA = harness.openMismatch('account:CRM-A');
  const openingB = harness.openMismatch('intake:INTAKE-B');
  const urlA = '/api/sales-crm/mismatch-recycle/account%3ACRM-A/profile';
  const urlB = '/api/sales-crm/mismatch-recycle/intake%3AINTAKE-B/profile';

  harness.pending.get(urlB).resolve({ recordKey: 'intake:INTAKE-B', companyName: 'B' });
  await openingB;
  assert.equal(harness.state.mismatchRecordDetail.recordKey, 'intake:INTAKE-B');
  assert.equal(harness.state.mismatchRecordDetail.loading, false);
  assert.equal(harness.state.mismatchRecordDetail.companyName, 'B');

  harness.pending.get(urlA).resolve({ recordKey: 'account:CRM-A', companyName: 'A' });
  await openingA;
  assert.equal(harness.state.mismatchRecordDetail.recordKey, 'intake:INTAKE-B');
  assert.equal(harness.state.mismatchRecordDetail.companyName, 'B');
});

test('closing a loading mismatch drawer invalidates its late response', async () => {
  const harness = customerDrawerHarness();
  const opening = harness.openMismatch('account:CRM-A');
  const request = harness.pending.get('/api/sales-crm/mismatch-recycle/account%3ACRM-A/profile');
  const renderCountBeforeClose = harness.renders.length;

  harness.close();
  request.resolve({ recordKey: 'account:CRM-A', companyName: 'late A' });
  await opening;

  assert.equal(harness.elements['#customerDrawer'].classList.contains('open'), false);
  assert.equal(harness.state.mismatchRecordDetail, null);
  assert.equal(harness.renders.length, renderCountBeforeClose);
});

for (const outcome of ['success', 'failure']) {
  test(`late recycle ${outcome} cannot overwrite or close a newer mismatch drawer`, async () => {
    const harness = customerDrawerHarness();
    const openingRecycle = harness.openRecycle('CRM-A');
    const recycleRequest = harness.pending.get('/api/sales-crm/accounts/CRM-A/recycle-profile');
    const openingMismatch = harness.openMismatch('intake:INTAKE-B');
    const mismatchRequest = harness.pending.get('/api/sales-crm/mismatch-recycle/intake%3AINTAKE-B/profile');
    mismatchRequest.resolve({ recordKey: 'intake:INTAKE-B', customer: { companyName: 'B' } });
    await openingMismatch;
    const rendersAfterB = harness.renders.length;

    if (outcome === 'success') recycleRequest.resolve({ account: { id: 'CRM-A' } });
    else recycleRequest.reject(new Error('late recycle failed'));
    await openingRecycle;

    assert.equal(harness.state.drawerOwner, 'mismatch:intake:INTAKE-B');
    assert.equal(harness.state.mismatchRecordDetail.recordKey, 'intake:INTAKE-B');
    assert.equal(harness.elements['#customerDrawer'].classList.contains('open'), true);
    assert.equal(harness.renders.length, rendersAfterB);
    assert.deepEqual(harness.toasts, []);
  });
}

for (const newerOwner of ['recycle', 'crm']) {
  for (const outcome of ['success', 'failure']) {
    test(`late mismatch ${outcome} cannot overwrite or close a newer ${newerOwner} drawer`, async () => {
      const harness = customerDrawerHarness();
      const openingMismatch = harness.openMismatch('account:CRM-A');
      const mismatchRequest = harness.pending.get('/api/sales-crm/mismatch-recycle/account%3ACRM-A/profile');
      let openingNewer = null;
      if (newerOwner === 'recycle') openingNewer = harness.openRecycle('CRM-B');
      else harness.openCustomer('CRM-B');
      const rendersAfterNewer = harness.renders.length;

      if (outcome === 'success') mismatchRequest.resolve({ recordKey: 'account:CRM-A' });
      else mismatchRequest.reject(new Error('late mismatch failed'));
      await openingMismatch;

      assert.equal(harness.state.drawerOwner, `${newerOwner}:CRM-B`);
      assert.equal(harness.state.mismatchRecordDetail, null);
      assert.equal(harness.elements['#customerDrawer'].classList.contains('open'), true);
      assert.equal(harness.renders.length, rendersAfterNewer);
      assert.deepEqual(harness.toasts, []);
      if (openingNewer) {
        harness.pending.get('/api/sales-crm/accounts/CRM-B/recycle-profile')
          .resolve({ account: { id: 'CRM-B' } });
        await openingNewer;
      }
    });
  }
}

test('renderDrawer delegates to mismatch renderer while mismatch owns the drawer', () => {
  const harness = customerDrawerHarness();
  harness.state.drawerOwner = 'mismatch:account:CRM-A';
  harness.state.mismatchRecordDetail = {
    recordKey: 'account:CRM-A', loading: false, profile: { customer: { companyName: 'A' } },
  };
  harness.state.selectedCustomerId = 'CRM-B';

  harness.guardedRenderDrawer();

  assert.deepEqual(harness.renders, ['account:CRM-A']);
});

test('all customer drawer entry points claim unified ownership', () => {
  for (const name of ['openMismatchRecord', 'openRecycleCustomer', 'openCustomer', 'openIntakeProfile']) {
    assert.match(topLevelFunction(name), /claimCustomerDrawer\(/, name);
  }
  assert.match(topLevelFunction('closeDrawer'), /state\.drawerRequestEpoch\s*\+=\s*1/);
  assert.match(topLevelFunction('closeDrawer'), /state\.drawerOwner\s*=\s*''/);
});

test('compact mismatch drawer renders fixed read-only summary with a safe website and expand control', () => {
  const harness = mismatchRendererHarness(mismatchPayload());

  assert.equal(harness.elements['#drawerCompany'].textContent, 'Acme');
  assert.match(harness.elements['#drawerMeta'].textContent, /account:CRM-A/);
  for (const copy of [
    'CRM客户', '原销售', '采购方向不符', '经理', '2026-08-13T02:00:00Z',
    '俄罗斯 · 莫斯科', '工业自动化', '终端制造商', '传感器', '自动化设备制造商',
  ]) assert.match(harness.html, new RegExp(copy));
  assert.match(harness.html, /data-expand-mismatch-profile/);
  assert.match(harness.html, /查看完整客户资料 →/);
  assert.match(harness.html, /href="https:\/\/acme\.example\/" target="_blank" rel="noopener"/);
  assert.doesNotMatch(harness.html, /完整资料明细/);
});

test('unsafe mismatch websites and every field are escaped instead of becoming executable markup', () => {
  const payload = mismatchPayload({
    customer: {
      ...mismatchPayload().customer,
      companyName: '<img src=x onerror=alert(1)>',
      website: 'javascript:alert(1)',
      description: '<script>alert(2)</script>',
    },
    recycle: { ...mismatchPayload().recycle, reason: '<svg onload=alert(3)>' },
  });
  const harness = mismatchRendererHarness(payload);

  assert.doesNotMatch(harness.html, /<script|<svg|<img|href="javascript:/i);
  assert.match(harness.html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(harness.html, /&lt;svg onload=alert\(3\)&gt;/);
  assert.match(harness.html, /javascript:alert\(1\)/);
});

test('expanded mismatch drawer names every complete profile section and uses concrete empty states', () => {
  const harness = mismatchRendererHarness(mismatchPayload(), true);

  assert.match(harness.html, /收起完整客户资料/);
  assert.match(harness.html, /完整资料明细/);
  for (const copy of [
    '联系人', '活动', '询价', '报价', '订单', '时间线', '评价', '审计',
    '暂无联系人记录', '暂无跟进记录', '暂无询价记录', '暂无报价记录',
    '暂无订单记录', '暂无时间线记录', '暂无评价记录', '暂无审计记录',
  ]) assert.match(harness.html, new RegExp(copy));
  assert.doesNotMatch(harness.html, />\s*[—-]\s*</);
});

test('expanded mismatch drawer renders authorized profile and history arrays from the original payload', () => {
  const base = mismatchPayload();
  const harness = mismatchRendererHarness(mismatchPayload({
    profile: {
      ...base.profile,
      customerPool: [{ companyName: '主档企业', industry: '电子制造' }],
      customers: [{ company_name: 'CRM快照', stage: 'contacted' }],
      reconResults: [{ summary: '背调摘要' }],
      people: [{ name: 'Ivan', title: '采购', email: 'ivan@example.com' }],
      accountContacts: [{ name: 'Anna', phone: '+7 123' }],
    },
    history: {
      activities: [{ activity_type: 'email', summary: '已发送开发信' }],
      rfqs: [{ subject: '传感器询价', status: 'new' }],
      quotes: [{ quoteNo: 'Q-1', status: 'sent' }],
      orders: [{ orderNo: 'O-1', status: 'won' }],
      timeline: [{ title: '首次触达', summary: '邮件' }],
      evaluations: [{ authorName: '经理', evaluationText: '继续跟进' }],
      auditLog: [{ action: 'reject', actorName: '经理' }],
    },
  }), true);

  for (const copy of [
    '主档企业', 'CRM快照', '背调摘要', 'Ivan', 'Anna', '已发送开发信',
    '传感器询价', 'Q-1', 'O-1', '首次触达', '继续跟进', 'reject',
  ]) assert.match(harness.html, new RegExp(copy));
});

test('mismatch detail drawer remains read-only even when list actions are authorized', () => {
  const render = topLevelFunction('renderMismatchRecordDrawer');
  assert.doesNotMatch(render, /detail\.actions|state\.data\.user|can\(/);
  const account = mismatchRendererHarness(mismatchPayload({ actions: ['reassign'] })).html;
  assert.doesNotMatch(account, /data-reassign-customer|data-mismatch-owner/);
  assert.doesNotMatch(account, /data-restore-mismatch/);

  const intake = mismatchRendererHarness(mismatchPayload({
    recordKey: 'intake:INTAKE-A', sourceType: 'intake',
    customer: { ...mismatchPayload().customer, accountId: '', intakeItemId: 'INTAKE-A' },
    actions: ['restore'],
  })).html;
  assert.doesNotMatch(intake, /data-restore-mismatch|data-reassign-customer/);

  const none = mismatchRendererHarness(mismatchPayload({ actions: [] })).html;
  assert.doesNotMatch(none, /data-(?:restore-mismatch|reassign-customer)/);
});

test('mismatch renderer tolerates malformed nested DTO values without object leaks', () => {
  const base = mismatchPayload();
  const malformedRows = [null, 'raw', {
    title: { label: '<Boss>' }, summary: { value: '<Summary>' },
    contactMethods: ['a', { name: 'b' }], amount: { value: 99 },
  }];
  const payload = mismatchPayload({
    customer: {
      ...base.customer,
      companyName: { label: '<Acme>' },
      products: ['sensor', { name: '<module>' }, { secret: 'must-not-leak' }],
      description: { summary: '<maker>' },
      website: { value: 'https://safe.example/path' },
    },
    profile: {
      ...base.profile,
      customerPool: [null, 'raw', { companyName: { label: '<Pool>' }, products: ['x', { name: 'y' }] }],
      people: [null, 'raw', { name: 'Buyer', contactMethods: ['a', 'b'], title: { label: 'Boss' } }],
      accountContacts: malformedRows,
      reconResults: malformedRows,
    },
    history: Object.fromEntries(Object.keys(base.history).map(key => [key, malformedRows])),
    actions: { reassign: true },
  });

  let harness;
  assert.doesNotThrow(() => { harness = mismatchRendererHarness(payload, true); });
  assert.doesNotMatch(harness.html, /\[object Object\]|must-not-leak/);
  for (const copy of ['&lt;Acme&gt;', 'sensor · &lt;module&gt;', '&lt;maker&gt;', 'Buyer', 'a · b', 'Boss']) {
    assert.match(harness.html, new RegExp(copy));
  }
  assert.match(harness.html, /href="https:\/\/safe\.example\/path" target="_blank" rel="noopener"/);
  assert.doesNotMatch(harness.html, /data-(?:restore-mismatch|reassign-customer)/);
});

function mismatchActionHarness({ rejectApi = false } = {}) {
  const calls = { api: [], close: 0, refresh: [], load: 0, toast: [] };
  const api = async (url, options) => {
    calls.api.push({ url, options });
    if (rejectApi) throw new Error('network failed');
    return { ok: true };
  };
  const closeDrawer = () => { calls.close += 1; };
  const refresh = async message => { calls.refresh.push(message); };
  const loadRecycleBin = async () => { calls.load += 1; };
  const toast = message => calls.toast.push(message);
  const refreshAfter = Function(
    'closeDrawer', 'refresh', 'loadRecycleBin',
    `return (${topLevelFunction('refreshAfterMismatchAction')});`,
  )(closeDrawer, refresh, loadRecycleBin);
  const restore = Function(
    'api', 'refreshAfterMismatchAction', 'toast',
    `return (${topLevelFunction('restoreMismatchRecord')});`,
  )(api, refreshAfter, toast);
  const reassign = Function(
    'api', 'refreshAfterMismatchAction', 'toast',
    `return (${topLevelFunction('reassignMismatchCustomer')});`,
  )(api, refreshAfter, toast);
  return { calls, restore, reassign };
}

test('intake restore executes the record-key route and refreshes once only after success', async () => {
  const harness = mismatchActionHarness();
  await harness.restore('intake:INTAKE-A', '判定修正');

  assert.equal(harness.calls.api.length, 1);
  assert.equal(harness.calls.api[0].url, '/api/sales-crm/mismatch-recycle/intake%3AINTAKE-A/restore');
  assert.deepEqual(JSON.parse(harness.calls.api[0].options.body), { reason: '判定修正' });
  assert.equal(harness.calls.close, 1);
  assert.deepEqual(harness.calls.refresh, [undefined]);
  assert.equal(harness.calls.load, 1);
});

test('failed intake restore preserves the open drawer and reports the API error', async () => {
  const harness = mismatchActionHarness({ rejectApi: true });
  await harness.restore('intake:INTAKE-A', '判定修正');

  assert.equal(harness.calls.close, 0);
  assert.deepEqual(harness.calls.refresh, []);
  assert.equal(harness.calls.load, 0);
  assert.deepEqual(harness.calls.toast, ['network failed']);
});

test('account reassign reads customer and selected owner from the actual action control', async () => {
  const harness = mismatchActionHarness();
  const button = {
    dataset: { reassignCustomer: 'CRM-A' },
    parentElement: { querySelector: selector => selector === 'select' ? { value: 'U-NEW' } : null },
  };
  await harness.reassign(button, '重新分配');

  assert.equal(harness.calls.api[0].url, '/api/sales-crm/accounts/CRM-A/reassign');
  assert.deepEqual(JSON.parse(harness.calls.api[0].options.body), {
    ownerId: 'U-NEW', reason: '重新分配',
  });
  assert.equal(harness.calls.close, 1);
  assert.deepEqual(harness.calls.refresh, ['客户已重新分配']);
  assert.equal(harness.calls.load, 1);
});

test('failed account reassign preserves the drawer and reports the API error', async () => {
  const harness = mismatchActionHarness({ rejectApi: true });
  const button = {
    dataset: { reassignCustomer: 'CRM-A' },
    parentElement: { querySelector: selector => selector === 'select' ? { value: 'U-NEW' } : null },
  };

  const result = await harness.reassign(button, '重新分配');

  assert.equal(result, false);
  assert.equal(harness.calls.api.length, 1);
  assert.equal(harness.calls.api[0].url, '/api/sales-crm/accounts/CRM-A/reassign');
  assert.deepEqual(JSON.parse(harness.calls.api[0].options.body), {
    ownerId: 'U-NEW', reason: '重新分配',
  });
  assert.equal(harness.calls.close, 0);
  assert.deepEqual(harness.calls.refresh, []);
  assert.equal(harness.calls.load, 0);
  assert.deepEqual(harness.calls.toast, ['network failed']);
});

test('post-action recycle reload executes against the current page without clearing applied filters', async () => {
  const calls = { clear: 0, authorized: [] };
  const controller = {
    clearAll() { calls.clear += 1; },
    getSchema() { return { fields: [] }; },
    apply() {},
  };
  const state = {
    authorizedBusinessLists: { recycle_bin: { filterController: controller, page: 4 } },
  };
  const load = Function(
    'can', 'state', 'initializeAuthorizedBusinessFilters', '$', 'loadAuthorizedBusinessPage',
    `return (${topLevelFunction('loadRecycleBin')});`,
  )(
    () => true,
    state,
    async () => { throw new Error('must not reinitialize'); },
    () => ({ value: '' }),
    async (pageKey, options) => calls.authorized.push({ pageKey, options }),
  );

  await load();

  assert.equal(calls.clear, 0);
  assert.deepEqual(calls.authorized, [{
    pageKey: 'recycle_bin',
    options: { reset: false, force: true, page: 4 },
  }]);
});

test('expand and collapse rerender the loaded payload without issuing another profile request', async () => {
  const harness = customerDrawerHarness();
  const opening = harness.openMismatch('account:CRM-A');
  harness.pending.get('/api/sales-crm/mismatch-recycle/account%3ACRM-A/profile')
    .resolve(mismatchPayload());
  await opening;
  const toggle = Function(
    'state', 'renderMismatchRecordDrawer',
    `return (${topLevelFunction('toggleMismatchRecordExpanded')});`,
  )(harness.state, () => harness.renders.push('toggle'));

  toggle();
  assert.equal(harness.state.mismatchRecordExpanded, true);
  toggle();
  assert.equal(harness.state.mismatchRecordExpanded, false);
  assert.equal(harness.pending.size, 1);
  assert.match(clickHandler(), /data-expand-mismatch-profile/);
  assert.doesNotMatch(topLevelFunction('toggleMismatchRecordExpanded'), /api\(|openCustomerProfile|openCustomer|openRecycleCustomer/);
});

test('closing mismatch details clears the expanded state', () => {
  const harness = customerDrawerHarness();
  harness.state.mismatchRecordExpanded = true;
  harness.close();
  assert.equal(harness.state.mismatchRecordExpanded, false);
});

test('successful mismatch actions close the drawer and refresh the same authorized list page', () => {
  const load = topLevelFunction('loadRecycleBin');
  const handler = clickHandler();
  const refreshAction = topLevelFunction('refreshAfterMismatchAction');
  const restoreStart = handler.indexOf('const restoreMismatch =');
  const reassignStart = handler.indexOf('const reassignCustomer =', restoreStart);
  const reassignEnd = handler.indexOf('const retryResearch =', reassignStart);
  const restoreMismatch = handler.slice(restoreStart, reassignStart);
  const reassignMismatch = handler.slice(reassignStart, reassignEnd);

  assert.ok(restoreStart > -1 && reassignStart > restoreStart && reassignEnd > reassignStart);
  assert.match(load, /reset\s*=\s*false/);
  assert.match(load, /const targetPage\s*=\s*reset\s*\?\s*1\s*:\s*Math\.max\(1, Number\(page \|\| meta\.page \|\| 1\)\)/);
  assert.match(load, /loadAuthorizedBusinessPage\('recycle_bin'/);
  assert.match(load, /reset:\s*false/);
  assert.match(load, /page:\s*targetPage/);
  assert.match(restoreMismatch, /restoreMismatchRecord\(restoreMismatch\.dataset\.restoreMismatch, reason\)/);
  assert.match(reassignMismatch, /reassignMismatchCustomer\(reassignCustomer, reason\)/);
  assert.match(refreshAction, /closeDrawer\(\)/);
  assert.match(refreshAction, /await refresh\(message\)/);
  assert.match(refreshAction, /await loadRecycleBin\(\)/);
});
