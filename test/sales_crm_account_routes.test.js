'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  registerSalesCrmAccountReadRoutes,
  registerSalesCrmAccountRecycleRoutes,
} = require('../lib/sales_crm_account_routes');

function recorder() {
  const routes = [];
  return {
    routes,
    get(path, handler) { routes.push(['GET', path, handler]); },
    post(path, handler) { routes.push(['POST', path, handler]); },
    put(path, handler) { routes.push(['PUT', path, handler]); },
    patch(path, handler) { routes.push(['PATCH', path, handler]); },
    use(handler) { routes.push(['USE', '', handler]); },
  };
}

test('account/recycle route registrars expose the stable compatibility matrix', () => {
  const app = recorder();
  registerSalesCrmAccountReadRoutes(app, {});
  registerSalesCrmAccountRecycleRoutes(app, {});

  assert.deepEqual(app.routes.map(([method, path]) => [method, path]), [
    ['GET', '/api/sales-crm/accounts'],
    ['PUT', '/api/sales-crm/customer-stars/:customerId'],
    ['GET', '/api/sales-crm/field-schema/:pageKey'],
    ['POST', '/api/sales-crm/accounts'],
    ['GET', '/api/sales-crm/duplicate-reviews'],
    ['GET', '/api/sales-crm/duplicate-reviews/:reviewId/candidates'],
    ['PATCH', '/api/sales-crm/duplicate-reviews/:reviewId/candidate'],
    ['POST', '/api/sales-crm/duplicate-reviews/:reviewId/resolve'],
    ['POST', '/api/sales-crm/duplicate-reviews/bulk-distinct'],
    ['POST', '/api/sales-crm/duplicate-reviews/recalculate'],
    ['POST', '/api/sales-crm/accounts/bulk-assign'],
    ['GET', '/api/sales-crm/accounts/:customerId/history'],
    ['GET', '/api/sales-crm/accounts/recycle-bin'],
    ['GET', '/api/sales-crm/accounts/:customerId/recycle-profile'],
    ['POST', '/api/sales-crm/accounts/bulk-return'],
    ['POST', '/api/sales-crm/accounts/:customerId/return'],
    ['POST', '/api/sales-crm/accounts/:customerId/trash'],
    ['POST', '/api/sales-crm/accounts/:customerId/restore'],
    ['POST', '/api/sales-crm/accounts/:customerId/reassign'],
    ['POST', '/api/sales-crm/accounts/:customerId/reject'],
    ['GET', '/api/sales-crm/mismatch-recycle//profile'],
    ['GET', '/api/sales-crm/mismatch-recycle/:recordKey/profile'],
    ['USE', ''],
    ['POST', '/api/sales-crm/mismatch-recycle/:recordKey/restore'],
    ['PATCH', '/api/sales-crm/accounts/:customerId'],
    ['PATCH', '/api/sales-crm/customers/:externalCustomerId/nickname'],
    ['PATCH', '/api/sales-crm/master/:customerId'],
  ]);
  assert.ok(app.routes.every(([, , handler]) => typeof handler === 'function'));
});
