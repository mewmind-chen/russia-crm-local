'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { presentAIResult } = require('../lib/ai_stations/presentation');

const root = path.join(__dirname, '..');

function importDetail(file = 'index.js') {
  return import(pathToFileURL(path.join(
    root, 'sales-assets', 'modules', 'customer-detail', file,
  )).href);
}

function fakeStore(initial = {}) {
  const state = { ...initial };
  return {
    state,
    setSection(section, value) {
      state[section] = typeof value === 'function' ? value(state[section]) : value;
      return state[section];
    },
  };
}

function lifecycle() {
  const controllers = [];
  return {
    signal: new AbortController().signal,
    controllers,
    createAbortController() {
      const controller = new AbortController();
      controllers.push(controller);
      return controller;
    },
    listen() {},
  };
}

function context(overrides = {}) {
  return {
    route: { customerId: 'RU-1', requestedRoute: 'customer-detail' },
    store: fakeStore(),
    services: {},
    lifecycle: lifecycle(),
    access: { permissions: { view_contacts: true } },
    ...overrides,
  };
}

test('customer detail exports one module contract and seven Chinese tabs', async () => {
  const detail = await importDetail();
  const tabs = await importDetail('tabs.js');
  for (const name of ['id', 'load', 'render', 'dispose']) assert.ok(name in detail);
  assert.equal(detail.id, 'customer-detail');
  assert.deepEqual(
    tabs.CUSTOMER_DETAIL_TABS.map(item => item.label),
    ['概览', '跟进与时间线', '商务', '情报', '评价', '标签', 'AI'],
  );
  assert.deepEqual(
    tabs.CUSTOMER_DETAIL_TABS.map(item => item.id),
    ['overview', 'timeline', 'commerce', 'intelligence', 'evaluations', 'tags', 'ai'],
  );
});

test('legacy deep link preserves customer, tab, drawer mode, and return source', async () => {
  const detail = await importDetail();
  const route = {
    isLegacy: true,
    requestedRoute: 'customerProfile',
    url: new URL('http://localhost/sales-crm.html?customer=RU-9001&tab=commerce&from=pipeline&presentation=drawer#customerProfile'),
  };
  assert.deepEqual(detail.resolveCustomerDetailContext(route), {
    customerId: 'RU-9001',
    activeTab: 'commerce',
    presentation: 'drawer',
    returnSource: 'pipeline',
    returnHref: '#pipeline',
    legacy: true,
    requestedRoute: 'customerProfile',
  });
});

test('page and drawer reuse the same renderer with accessible tab semantics', async () => {
  const detail = await importDetail();
  const state = {
    customerId: 'RU-1',
    activeTab: 'overview',
    presentation: 'page',
    returnHref: '#customers',
    legacy: false,
    loadingTab: '',
    staleTabs: [],
    errorByTab: {},
    dataByTab: {
      overview: {
        customerPool: [{ companyName: 'Acme', country: 'RU', industry: 'EMS' }],
        people: [{ full_name: 'Buyer', methods_summary: 'buyer@example.test' }],
      },
    },
  };
  const page = detail.renderCustomerDetailView(state, {
    presentation: 'page',
    canViewContacts: true,
  });
  const drawer = detail.renderCustomerDetailView(state, {
    presentation: 'drawer',
    canViewContacts: true,
  });
  assert.match(page, /data-presentation="page"/);
  assert.doesNotMatch(page, /role="dialog"/);
  assert.match(drawer, /data-presentation="drawer"/);
  assert.match(drawer, /role="dialog" aria-modal="true"/);
  assert.equal((page.match(/role="tab"/g) || []).length, 7);
  assert.equal((drawer.match(/role="tab"/g) || []).length, 7);
  assert.match(page, /data-customer-detail-back href="#customers"/);
});

test('AI result actions retain their business capability routing context', async () => {
  const tabs = await importDetail('tabs.js');
  const presentation = presentAIResult({
    job: { station: 'next_action', trigger: { source: 'manual', actorId: 'U-1' } },
    result: {
      value: {
        nextAction: '安排需求会议',
        nextActionAt: '2026-08-01',
        reason: '客户已回复',
        confidence: 0.88,
      },
    },
    evidence: [{ kind: 'crm', summary: '客户已回复' }],
    permissions: { use_ai_assistant: true, record_activity: true },
  });
  const html = tabs.renderCustomerDetailTab('ai', {
    results: { nextAction: { presentation } },
  });
  assert.match(html, /data-capability="next_action"[\s\S]*data-ai-result-action="adopt"/);
});

test('tab loader uses only the selected tab dependency', async () => {
  const tabs = await importDetail('tabs.js');
  const calls = [];
  const record = name => async (customerId, options) => {
    calls.push({ name, customerId, signal: options.signal });
    return { name };
  };
  const services = {
    customers: {
      getProfile: record('profile'),
      getTimeline: record('timeline'),
      getCommerce: record('commerce'),
      getEvaluations: record('evaluations'),
      getTags: record('tags'),
    },
    intelligence: { customerDetail: record('intelligence') },
    ai: {
      customerResults: record('ai-results'),
      customerEnrichment: record('ai-enrichment'),
    },
  };
  const signal = new AbortController().signal;
  for (const tabId of ['overview', 'timeline', 'commerce', 'intelligence', 'evaluations', 'tags']) {
    calls.length = 0;
    await tabs.loadCustomerDetailTab({
      services, customerId: 'RU-1', tabId, signal, canViewContacts: true,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].customerId, 'RU-1');
    assert.equal(calls[0].signal, signal);
  }
  calls.length = 0;
  await tabs.loadCustomerDetailTab({
    services, customerId: 'RU-1', tabId: 'ai', signal, canViewContacts: true,
  });
  assert.deepEqual(calls.map(item => item.name).sort(), ['ai-enrichment', 'ai-results']);
});

test('switching customer aborts the previous request and ignores its completion', async () => {
  const detail = await importDetail();
  let firstSignal;
  let releaseFirst;
  const firstPending = new Promise(resolve => { releaseFirst = resolve; });
  const firstContext = context({
    route: { customerId: 'RU-OLD', requestedRoute: 'customer-detail' },
    services: {
      customers: {
        getProfile(_customerId, { signal }) {
          firstSignal = signal;
          return firstPending;
        },
      },
    },
  });
  const oldLoad = detail.load(firstContext);
  await Promise.resolve();
  assert.equal(firstSignal.aborted, false);

  const nextContext = context({
    route: { customerId: 'RU-NEW', requestedRoute: 'customer-detail' },
    services: {
      customers: {
        async getProfile() {
          return { customerPool: [{ customerId: 'RU-NEW', companyName: 'New' }] };
        },
      },
    },
  });
  const next = await detail.load(nextContext);
  assert.equal(firstSignal.aborted, true);
  assert.equal(next.customerId, 'RU-NEW');
  releaseFirst({ customerPool: [{ customerId: 'RU-OLD', companyName: 'Old' }] });
  await oldLoad;
  assert.equal(nextContext.store.state.customerDetail.customerId, 'RU-NEW');
  detail.dispose();
});

test('403, 404, stale, retry, and missing service states are explicit', async () => {
  const tabs = await importDetail('tabs.js');
  assert.deepEqual(tabs.classifyDetailError({ status: 403 }), {
    kind: 'forbidden', retryable: false,
  });
  assert.deepEqual(tabs.classifyDetailError({ statusCode: 404 }), {
    kind: 'not-found', retryable: false,
  });
  assert.deepEqual(tabs.classifyDetailError({ status: 409 }), {
    kind: 'stale', retryable: true,
  });
  assert.deepEqual(tabs.classifyDetailError(new Error('offline')), {
    kind: 'network', retryable: true,
  });
  await assert.rejects(
    tabs.loadCustomerDetailTab({
      services: { customers: {} },
      customerId: 'RU-1',
      tabId: 'timeline',
      signal: new AbortController().signal,
    }),
    error => error.code === 'SERVICE_DEPENDENCY_MISSING'
      && error.dependency === 'customers.getTimeline(customerId, options)',
  );
});

test('contact-restricted detail recursively removes contact and narrative fields', async () => {
  const tabs = await importDetail('tabs.js');
  const secret = 'buyer-secret@example.test';
  const source = {
    customerPool: [{
      customerId: 'RU-1',
      companyName: 'Safe Company',
      email: secret,
      phone: '+7-secret',
      notes: `Call ${secret}`,
      description: `Ask ${secret}`,
    }],
    people: [{
      person_id: 'PERSON-1',
      full_name: 'Secret Buyer',
      methods_summary: secret,
    }],
  };
  const redacted = tabs.redactContactFields(source);
  const serialized = JSON.stringify(redacted);
  assert.match(serialized, /Safe Company/);
  for (const hidden of [secret, '+7-secret', 'Secret Buyer', 'PERSON-1']) {
    assert.doesNotMatch(serialized, new RegExp(hidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
