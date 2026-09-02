'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSalesCrmActivityRoutes } = require('../lib/sales_crm_activity_routes');

function recorder() {
  const routes = [];
  return {
    routes,
    get(path, handler) { routes.push(['GET', path, handler]); },
    post(path, handler) { routes.push(['POST', path, handler]); },
    patch(path, handler) { routes.push(['PATCH', path, handler]); },
    put(path, handler) { routes.push(['PUT', path, handler]); },
    delete(path, handler) { routes.push(['DELETE', path, handler]); },
  };
}

test('activity route registrar owns the stable non-AI activity matrix', () => {
  const app = recorder();
  registerSalesCrmActivityRoutes(app);

  assert.deepEqual(app.routes.map(([method, path]) => [method, path]), [
    ['GET', '/api/sales-crm/activity-customers'],
    ['GET', '/api/sales-crm/activity-correction-targets'],
    ['GET', '/api/sales-crm/activity-corrections'],
    ['POST', '/api/sales-crm/activity-corrections'],
    ['GET', '/api/sales-crm/activity-correction-proposals'],
    ['POST', '/api/sales-crm/activity-correction-proposals'],
    ['POST', '/api/sales-crm/activity-correction-proposals/:proposalId/review'],
    ['GET', '/api/sales-crm/activity-reactions'],
    ['GET', '/api/sales-crm/activity-reactions/admin'],
    ['POST', '/api/sales-crm/activity-reactions'],
    ['PATCH', '/api/sales-crm/activity-reactions/:reactionId'],
    ['PUT', '/api/sales-crm/activity-reactions/order'],
    ['DELETE', '/api/sales-crm/activity-reactions/:reactionId'],
  ]);
  assert.ok(app.routes.every(([, , handler]) => typeof handler === 'function'));
});
