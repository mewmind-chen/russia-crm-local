'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  registerSalesCrmPageEntrypoints,
  registerServerPageEntrypoints,
} = require('../lib/page_entrypoints');

function recorder() {
  const calls = [];
  return {
    calls,
    get(route, handler) { calls.push(['get', route, handler]); },
    use(route, handler) { calls.push(['use', route, handler]); },
  };
}

test('page entrypoint registrars preserve route order and handlers', () => {
  const sales = recorder();
  registerSalesCrmPageEntrypoints(sales, { rootDir: '/tmp/tradepulse' });
  assert.deepEqual(sales.calls.map(([method, route]) => [method, route]), [
    ['get', '/sales'], ['use', '/sales-assets'],
  ]);
  assert.equal(sales.calls.every(([, , handler]) => typeof handler === 'function'), true);

  const server = recorder();
  registerServerPageEntrypoints(server, { rootDir: '/tmp/tradepulse' });
  assert.deepEqual(server.calls.map(([method, route]) => [method, route]), [
    ['get', '/'], ['use', '/shared-assets'],
  ]);
  assert.equal(server.calls.every(([, , handler]) => typeof handler === 'function'), true);
});
