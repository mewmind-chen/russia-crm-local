'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');

function importModule(name) {
  return import(pathToFileURL(path.join(root, 'sales-assets', 'modules', name, 'index.js')).href);
}

function fakeStore(initial = {}) {
  const state = { ...initial };
  const writes = [];
  return {
    state,
    writes,
    setSection(section, value) {
      const next = typeof value === 'function' ? value(state[section]) : value;
      state[section] = next;
      writes.push({ section, value: next });
      return next;
    },
  };
}

function context(overrides = {}) {
  return {
    route: { requestedRoute: 'customers' },
    store: fakeStore({ session: { stages: [] } }),
    services: {},
    lifecycle: { signal: new AbortController().signal },
    access: { role: 'sales', permissions: {} },
    ...overrides,
  };
}

test('intake module exposes the page contract and loads route-scoped pagination into domain store', async () => {
  const module = await importModule('intake');
  for (const name of ['id', 'load', 'render', 'dispose']) assert.ok(name in module);
  assert.equal(module.id, 'intake');
  assert.deepEqual(module.normalizeIntakeQuery({
    page: '-4', pageSize: '900', search: '  Acme ', status: 'assigned',
  }), {
    page: 1, pageSize: 100, search: 'Acme', status: 'assigned', country: '', owner: '',
  });

  const calls = [];
  const store = fakeStore();
  const ctx = context({
    route: { requestedRoute: 'pending' },
    store,
    services: {
      intake: {
        async list(query) {
          calls.push(query);
          return { items: [{ id: 'I-1' }], total: 1, hasMore: false, stats: {} };
        },
      },
    },
  });
  const result = await module.load(ctx);
  assert.equal(calls[0].status, 'assigned');
  assert.equal(calls[0].page, 1);
  assert.equal(result.items[0].id, 'I-1');
  assert.equal(store.state.intakeWorkflow.items[0].id, 'I-1');
});

test('customer module exposes the page contract and loads customer or recycle authority by route', async () => {
  const module = await importModule('customers');
  for (const name of ['id', 'load', 'render', 'dispose']) assert.ok(name in module);
  assert.equal(module.id, 'customers');
  assert.deepEqual(module.normalizeCustomerFilters({
    search: '  Buyer ', stage: 'quoted', priority: 'A', onlyOverdue: 1,
  }), {
    search: 'Buyer', stage: 'quoted', priority: 'A', ownerId: '', onlyOverdue: true,
  });

  const requested = [];
  const store = fakeStore({ session: { stages: [] } });
  const ctx = context({
    route: { requestedRoute: 'pipeline' },
    store,
    services: {
      session: {
        async bootstrap(sections) {
          requested.push(sections);
          return { accounts: [{ id: 'CRM-1', stage: 'quoted' }], quotes: [], rfqs: [] };
        },
      },
    },
  });
  const result = await module.load(ctx);
  assert.deepEqual(requested[0], ['customers', 'today']);
  assert.equal(result.mode, 'pipeline');
  assert.equal(store.state.customerWorkflow.accounts[0].id, 'CRM-1');
});

test('workflow modules encode server-first writes, idempotency, conflict refresh, and commerce boundaries', () => {
  const intake = fs.readFileSync(path.join(root, 'sales-assets', 'modules', 'intake', 'index.js'), 'utf8');
  const customers = fs.readFileSync(path.join(root, 'sales-assets', 'modules', 'customers', 'index.js'), 'utf8');

  for (const contract of [
    'data-intake-filter', 'data-intake-page', 'data-intake-bulk',
    "data-intake-action=\"claim\"", "data-intake-action=\"return\"",
    "data-intake-action=\"reject\"", 'idempotencyKey',
  ]) assert.match(intake, new RegExp(contract));
  assert.match(intake, /await operation\(\);[\s\S]*?await refreshAuthoritative/);
  assert.match(intake, /error\?\.status === 409[\s\S]*?refreshAuthoritative/);
  assert.doesNotMatch(intake, /stage\s*=|qualification\s*=/);

  for (const contract of [
    'normalizeCustomerFilters', 'data-customer-export', 'data-customer-bulk',
    'data-customer-return', 'data-customer-trash', 'data-customer-restore',
    'data-customer-reassign', 'funnel-chart',
  ]) assert.match(customers, new RegExp(contract));
  assert.match(customers, /await operation\(\);[\s\S]*?await refreshAuthoritative/);
  assert.match(customers, /error\?\.status === 409[\s\S]*?refreshAuthoritative/);
  assert.match(customers, /activities\.create\(\{[\s\S]*?activityType: 'rfq'/);
  assert.match(customers, /activities\.createQuote/);
  assert.match(customers, /activities\.createOrder/);
  assert.match(customers, /name="currency"/);
  assert.match(customers, /name="grossMargin"/);
  assert.match(customers, /name="quoteId"/);
  assert.match(customers, /订单必须关联已有报价/);
  assert.match(customers, /idempotencyKey/);
  assert.doesNotMatch(customers, /account\.stage\s*=(?!=)|stageAfter\s*:/);
});
