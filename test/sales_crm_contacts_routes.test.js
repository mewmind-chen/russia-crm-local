const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSalesCrmContactRoutes } = require('../lib/sales_crm_contacts_routes');

test('contact route registrar owns the stable contact route matrix', () => {
  const calls = [];
  const app = {
    post(route, ...handlers) { calls.push({ method: 'POST', route, handlers }); return this; },
    patch(route, ...handlers) { calls.push({ method: 'PATCH', route, handlers }); return this; },
  };
  registerSalesCrmContactRoutes(app, {});

  assert.deepEqual(calls.map(({ method, route }) => `${method} ${route}`), [
    'POST /api/sales-crm/contacts',
    'PATCH /api/sales-crm/contacts/:contactId',
    'POST /api/sales-crm/contacts/:contactId/archive',
  ]);
  assert.ok(calls.every(({ handlers }) => handlers.every(handler => typeof handler === 'function')));
});
