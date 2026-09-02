const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSalesAuthRoutes } = require('../lib/sales_auth_routes');

test('sales auth route registrar owns login and logout adapters', () => {
  const calls = [];
  const app = {
    post(route, ...handlers) { calls.push({ method: 'POST', route, handlers }); return this; },
  };
  registerSalesAuthRoutes(app, {});

  assert.deepEqual(calls.map(({ method, route }) => `${method} ${route}`), [
    'POST /api/sales-auth/login',
    'POST /api/sales-auth/logout',
  ]);
  assert.ok(calls.every(({ handlers }) => handlers.every(handler => typeof handler === 'function')));
});
