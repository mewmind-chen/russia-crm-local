'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  registerSalesCrmListRoutes,
  registerSalesCrmIntakeResearchRoutes,
} = require('../lib/sales_crm_read_routes');

function recorder() {
  const routes = [];
  return {
    routes,
    get(path, handler) { routes.push(['GET', path, handler]); },
    post(path, handler) { routes.push(['POST', path, handler]); },
  };
}

test('read route registrars expose the stable CRM list and intake matrix', () => {
  const app = recorder();
  registerSalesCrmListRoutes(app, {});
  registerSalesCrmIntakeResearchRoutes(app, {});

  assert.deepEqual(app.routes.map(([method, path]) => [method, path]), [
    ['GET', '/api/sales-crm/lists/:pageKey'],
    ['POST', '/api/sales-crm/today-tasks/actions'],
    ['GET', '/api/sales-crm/intake'],
    ['GET', '/api/sales-crm/research/:kind'],
  ]);
  assert.ok(app.routes.every(([, , handler]) => typeof handler === 'function'));
});
