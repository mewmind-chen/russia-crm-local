'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSalesCrmProtectedRoutes } = require('../lib/sales_crm_protected_routes');

function recorder() {
  const routes = [];
  return {
    routes,
    get(path, handler) { routes.push(['GET', path, handler]); },
    post(path, handler) { routes.push(['POST', path, handler]); },
    patch(path, handler) { routes.push(['PATCH', path, handler]); },
  };
}

test('protected customer route registrar exposes the stable compatibility matrix', () => {
  const app = recorder();
  registerSalesCrmProtectedRoutes(app, {});

  assert.deepEqual(app.routes.map(([method, path]) => [method, path]), [
    ['GET', '/api/sales-crm/protected-customer-conflicts'],
    ['POST', '/api/sales-crm/protected-customer-conflicts/rescan'],
    ['POST', '/api/sales-crm/protected-customer-conflicts/:conflictId/resolve'],
    ['POST', '/api/sales-crm/protected-customer-conflicts/:conflictId/supplement'],
    ['GET', '/api/sales-crm/protected-customers'],
    ['GET', '/api/sales-crm/protected-customers/template'],
    ['GET', '/api/sales-crm/protected-customers/export'],
    ['POST', '/api/sales-crm/protected-customers/batches/preview'],
    ['POST', '/api/sales-crm/protected-customers/batches/:batchId/commit'],
    ['POST', '/api/sales-crm/protected-customers/:externalCustomerId/activate'],
    ['POST', '/api/sales-crm/protected-customers/batches/:batchId/rollback'],
    ['GET', '/api/sales-crm/protected-customers/:externalCustomerId'],
    ['PATCH', '/api/sales-crm/protected-customers/:externalCustomerId'],
  ]);
  assert.ok(app.routes.every(([, , handler]) => typeof handler === 'function'));
});
