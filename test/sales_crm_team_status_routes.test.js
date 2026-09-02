const test = require('node:test');
const assert = require('node:assert/strict');
const { registerTeamStatusRoutes } = require('../lib/sales_crm_team_status_routes');

test('team status route registrar owns the stable team/collaboration route matrix', () => {
  const calls = [];
  const app = {
    get(route, ...handlers) { calls.push({ method: 'GET', route, handlers }); return this; },
    post(route, ...handlers) { calls.push({ method: 'POST', route, handlers }); return this; },
  };
  registerTeamStatusRoutes(app, {});

  assert.deepEqual(calls.map(({ method, route }) => `${method} ${route}`), [
    'GET /api/sales-crm/team-status',
    'POST /api/sales-crm/team-status/since-last-view',
    'GET /api/sales-crm/team-status/export',
    'GET /api/sales-crm/collaboration-support',
    'GET /api/sales-crm/collaboration-support/export',
    'POST /api/sales-crm/collaboration-support',
    'POST /api/sales-crm/collaboration-support/:eventId/supplements',
    'POST /api/sales-crm/collaboration-support/:eventId/corrections',
    'POST /api/sales-crm/collaboration-support/:eventId/revocations',
  ]);
  assert.ok(calls.every(({ handlers }) => handlers.every(handler => typeof handler === 'function')));
});
