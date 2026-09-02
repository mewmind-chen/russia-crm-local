'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSalesCrmBootstrapRoutes } = require('../lib/sales_crm_bootstrap_routes');

test('bootstrap route registrar exposes the stable compatibility matrix', () => {
  const routes = [];
  const app = {
    get(path, handler) { routes.push(['GET', path, handler]); },
  };
  registerSalesCrmBootstrapRoutes(app, {});

  assert.deepEqual(routes.map(([method, path]) => [method, path]), [
    ['GET', '/api/sales-crm/bootstrap'],
    ['GET', '/api/sales-crm/filter-schema/:pageKey'],
  ]);
  assert.ok(routes.every(([, , handler]) => typeof handler === 'function'));
});
