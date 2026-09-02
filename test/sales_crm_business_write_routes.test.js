'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSalesCrmBusinessWriteRoutes } = require('../lib/sales_crm_business_write_routes');

function recorder() {
  const routes = [];
  return {
    routes,
    get(path, handler) { routes.push(['GET', path, handler]); },
    post(path, handler) { routes.push(['POST', path, handler]); },
  };
}

test('business write registrar preserves export, activity, commerce and impersonation routes', () => {
  const app = recorder();
  registerSalesCrmBusinessWriteRoutes(app, {});

  assert.deepEqual(app.routes.map(([method, path]) => [method, path]), [
    ['GET', '/api/sales-crm/export'],
    ['POST', '/api/sales-crm/activities/plan-only'],
    ['POST', '/api/sales-crm/activities'],
    ['POST', '/api/sales-crm/accounts/:customerId/deferred-plan'],
    ['POST', '/api/sales-crm/quotes'],
    ['POST', '/api/sales-crm/orders'],
    ['POST', '/api/sales-crm/impersonation/start'],
    ['POST', '/api/sales-crm/impersonation/stop'],
  ]);
  assert.ok(app.routes.every(([, , handler]) => typeof handler === 'function'));
});

test('business write registrar can preserve split registration points', () => {
  const app = recorder();
  registerSalesCrmBusinessWriteRoutes(app, {}, {
    commerce: false,
    impersonation: false,
  });
  assert.deepEqual(app.routes.map(([method, path]) => [method, path]), [
    ['GET', '/api/sales-crm/export'],
    ['POST', '/api/sales-crm/activities/plan-only'],
    ['POST', '/api/sales-crm/activities'],
    ['POST', '/api/sales-crm/accounts/:customerId/deferred-plan'],
  ]);
});
