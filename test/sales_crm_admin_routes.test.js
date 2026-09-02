'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerSalesCrmAdminRoutes } = require('../lib/sales_crm_admin_routes');

test('admin route assembly registers the complete 19-route matrix', () => {
  const routes = [];
  const app = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    app[method] = (path) => routes.push(`${method.toUpperCase()} ${path}`);
  }
  const deps = new Proxy({}, { get: () => () => ({}) });

  registerSalesCrmAdminRoutes(app, deps);

  assert.deepEqual(routes, [
    'GET /api/sales-crm/data-maintenance/capabilities',
    'GET /api/sales-crm/data-maintenance/runs',
    'POST /api/sales-crm/data-maintenance/preview',
    'POST /api/sales-crm/data-maintenance/execute',
    'POST /api/sales-crm/users',
    'POST /api/sales-crm/users/:userId/password-reset',
    'PATCH /api/sales-crm/users/:userId',
    'POST /api/sales-crm/users/:userId/archive',
    'POST /api/sales-crm/users/:userId/restore',
    'DELETE /api/sales-crm/users/:userId',
    'GET /api/sales-crm/permission-groups',
    'POST /api/sales-crm/permission-groups',
    'PATCH /api/sales-crm/permission-groups/:groupId',
    'PUT /api/sales-crm/users/:userId/permission-overrides',
    'GET /api/sales-crm/filter-permissions',
    'POST /api/sales-crm/filter-permissions',
    'PUT /api/sales-crm/filter-permissions/groups/:groupId',
    'PUT /api/sales-crm/filter-permissions/users/:userId',
    'PATCH /api/sales-crm/filter-permissions/definitions/:filterKey',
  ]);
});
