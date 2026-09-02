'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSalesCrmManagerRoutes } = require('../lib/sales_crm_manager_routes');

function recorder() {
  const routes = [];
  return {
    routes,
    get(path, handler) { routes.push(['GET', path, handler]); },
    post(path, handler) { routes.push(['POST', path, handler]); },
    patch(path, handler) { routes.push(['PATCH', path, handler]); },
  };
}

test('manager route registrar owns the stable task, metrics and risks matrix', () => {
  const app = recorder();
  registerSalesCrmManagerRoutes(app);

  assert.deepEqual(app.routes.map(([method, path]) => [method, path]), [
    ['GET', '/api/sales-crm/manager-task-settings'],
    ['PATCH', '/api/sales-crm/manager-task-settings'],
    ['POST', '/api/sales-crm/manager-tasks'],
    ['GET', '/api/sales-crm/manager-tasks'],
    ['GET', '/api/sales-crm/manager-tasks/export'],
    ['GET', '/api/sales-crm/manager-tasks/:taskId'],
    ['POST', '/api/sales-crm/manager-tasks/:taskId/resolve'],
    ['GET', '/api/sales-crm/manager-metrics'],
    ['GET', '/api/sales-crm/manager-metrics/drilldown'],
    ['GET', '/api/sales-crm/manager-risks'],
  ]);
  assert.ok(app.routes.every(([, , handler]) => typeof handler === 'function'));
});
