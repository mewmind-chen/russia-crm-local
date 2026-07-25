'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');

function importCore(name) {
  return import(pathToFileURL(path.join(root, 'sales-assets', 'core', name)).href);
}

test('API client sends JSON defaults and returns the decoded payload', async () => {
  const { createApiClient } = await importCore('api.js');
  let captured;
  const api = createApiClient({
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ ok: true, customerId: 'CRM-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const result = await api('/api/customers', {
    method: 'POST',
    headers: { 'X-Request-Id': 'req-1' },
    body: JSON.stringify({ name: 'Acme' }),
  });

  assert.deepEqual(result, { ok: true, customerId: 'CRM-1' });
  assert.equal(captured.url, '/api/customers');
  assert.equal(captured.options.credentials, 'same-origin');
  assert.equal(captured.options.headers['Content-Type'], 'application/json');
  assert.equal(captured.options.headers['X-Request-Id'], 'req-1');
  assert.equal('timeoutMs' in captured.options, false);
});

test('API client invokes unauthorized callback and throws a structured HttpError', async () => {
  const { createApiClient, HttpError } = await importCore('api.js');
  const unauthorized = [];
  const api = createApiClient({
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      error: '登录已过期',
      code: 'SESSION_EXPIRED',
      requestId: 'req-401',
    }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
    onUnauthorized(error) {
      unauthorized.push(error);
    },
  });

  await assert.rejects(
    api('/api/private'),
    error => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.name, 'HttpError');
      assert.equal(error.message, '登录已过期');
      assert.equal(error.status, 401);
      assert.equal(error.code, 'SESSION_EXPIRED');
      assert.equal(error.url, '/api/private');
      assert.equal(error.method, 'GET');
      assert.equal(error.details.requestId, 'req-401');
      return true;
    },
  );
  assert.equal(unauthorized.length, 1);
  assert.equal(unauthorized[0].status, 401);
});

test('API client aborts timed out requests and reports a structured timeout', async () => {
  const { createApiClient, HttpError } = await importCore('api.js');
  let requestSignal;
  const api = createApiClient({
    defaultTimeoutMs: 10,
    fetchImpl: (_url, options) => {
      requestSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      });
    },
  });

  await assert.rejects(
    api('/api/slow'),
    error => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 0);
      assert.equal(error.code, 'REQUEST_TIMEOUT');
      assert.equal(error.message, '请求超时，请检查网络后重试');
      return true;
    },
  );
  assert.equal(requestSignal.aborted, true);
});

test('store notifies only changed state partitions and supports unsubscribe', async () => {
  const { createStore } = await importCore('state.js');
  const store = createStore({
    session: { userId: 'U-1' },
    customers: [],
  });
  const sessionEvents = [];
  const customerEvents = [];
  const unsubscribeSession = store.subscribe('session', (value, previous) => {
    sessionEvents.push({ value, previous });
  });
  store.subscribe('customers', (value, previous) => {
    customerEvents.push({ value, previous });
  });

  store.setSection('customers', [{ id: 'CRM-1' }]);
  store.setSection('session', current => ({ ...current, userId: 'U-2' }));
  unsubscribeSession();
  store.setSection('session', { userId: 'U-3' });
  store.setSection('customers', store.getState().customers);

  assert.equal(sessionEvents.length, 1);
  assert.deepEqual(sessionEvents[0].previous, { userId: 'U-1' });
  assert.deepEqual(sessionEvents[0].value, { userId: 'U-2' });
  assert.equal(customerEvents.length, 1);
  assert.deepEqual(customerEvents[0].value, [{ id: 'CRM-1' }]);
  assert.equal(store.getState().session.userId, 'U-3');
});

test('lifecycle scope clears timers, requests, listeners, and tolerates repeated dispose', async () => {
  const { createLifecycleScope } = await importCore('lifecycle.js');
  const scope = createLifecycleScope();
  const target = new EventTarget();
  const request = scope.createAbortController();
  let events = 0;
  let intervalTicks = 0;
  let timeoutFired = false;

  scope.listen(target, 'change', () => { events += 1; });
  scope.interval(() => { intervalTicks += 1; }, 5);
  scope.timeout(() => { timeoutFired = true; }, 40);
  target.dispatchEvent(new Event('change'));
  await new Promise(resolve => setTimeout(resolve, 15));

  assert.equal(events, 1);
  assert.ok(intervalTicks > 0);
  scope.dispose();
  scope.dispose();
  target.dispatchEvent(new Event('change'));
  const ticksAtDispose = intervalTicks;
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(scope.disposed, true);
  assert.equal(request.signal.aborted, true);
  assert.equal(events, 1);
  assert.equal(intervalTicks, ticksAtDispose);
  assert.equal(timeoutFired, false);
});

test('sales CRM loads the legacy shell as an ES module wired to the core runtime', () => {
  const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
  assert.match(html, /<script type="module" src="\/sales-assets\/app\.js\?/);
  assert.match(app, /from '\.\/core\/api\.js'/);
  assert.match(app, /from '\.\/core\/state\.js'/);
  assert.match(app, /from '\.\/core\/lifecycle\.js'/);
  assert.match(app, /createApiClient/);
  assert.match(app, /createLifecycleScope/);
});
