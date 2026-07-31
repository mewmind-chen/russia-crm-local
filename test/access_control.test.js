const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function accessControl() {
  try { return require('../lib/access_control'); }
  catch (_error) { return {}; }
}

test('permissionsFor trusts only hydrated group permissions', () => {
  const { permissionsFor } = accessControl();
  assert.equal(permissionsFor({ role: 'admin', permissions_json: '{"view_users":true}' }).view_users, false);
  assert.equal(permissionsFor({ permissions: { view_users: true } }).view_users, true);
});

test('view_all_customers false scopes a manager to owned active accounts', () => {
  const { buildAccessContext, assertAccountAccess } = accessControl();
  assert.equal(typeof buildAccessContext, 'function');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE crm_accounts(id TEXT, external_customer_id TEXT, owner_id TEXT, assignment_status TEXT)');
  db.prepare('INSERT INTO crm_accounts VALUES (?,?,?,?)').run('OWN', 'EXT-OWN', 'U1', 'claimed');
  db.prepare('INSERT INTO crm_accounts VALUES (?,?,?,?)').run('RETURNED', 'EXT-RETURNED', 'U1', 'returned');
  db.prepare('INSERT INTO crm_accounts VALUES (?,?,?,?)').run('OTHER', 'EXT-OTHER', 'U2', 'claimed');
  const context = buildAccessContext(db, {
    id: 'U1', permissions: { view_all_customers: false },
  });
  assert.deepEqual([...context.accountIds], ['OWN']);
  assert.doesNotThrow(() => assertAccountAccess(context, { id: 'OWN' }));
  assert.throws(
    () => assertAccountAccess(context, { id: 'OTHER' }),
    error => error.statusCode === 403,
  );
  db.close();
});

test('view_all_customers true includes every account regardless of role', () => {
  const { buildAccessContext } = accessControl();
  assert.equal(typeof buildAccessContext, 'function');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE crm_accounts(id TEXT, external_customer_id TEXT, owner_id TEXT, assignment_status TEXT)');
  db.prepare('INSERT INTO crm_accounts VALUES (?,?,?,?)').run('OTHER', 'EXT-OTHER', 'U2', 'claimed');
  const context = buildAccessContext(db, {
    id: 'U1', permissions: { view_all_customers: true },
  });
  assert.deepEqual([...context.accountIds], ['OTHER']);
  db.close();
});

test('contact redaction recursively removes sensitive fields', () => {
  const { redactContactFields } = accessControl();
  assert.equal(typeof redactContactFields, 'function');
  const output = redactContactFields({
    email: 'x@example.com',
    contact_methods: 'tg',
    nested: [{ phone: '1', methods_summary: 'email:x@example.com', company_name: 'Safe' }],
  });
  assert.deepEqual(output, { nested: [{ company_name: 'Safe' }] });
});

test('contact redaction covers serialized snake and camel case fields', () => {
  const { redactContactFields } = accessControl();
  const output = redactContactFields({
    company_name: 'Safe', contacts_summary: 'Buyer secret', contactSignal: 'email secret',
    bestPersonId: 'PERSON-1', nested: { result_json: '{"email":"secret"}', contactCount: 3 },
  });
  assert.deepEqual(output, { company_name: 'Safe', nested: {} });
});

test('contact redaction removes narrative fields that can embed contacts', () => {
  const { redactContactFields } = accessControl();
  const output = redactContactFields({
    company_name: 'Safe Company', notes: 'Call buyer@example.test',
    opportunitySummary: 'Ask Secret Buyer', next_action: 'Phone +7-secret',
  });
  assert.deepEqual(output, { company_name: 'Safe Company' });
});

test('unknown browser route and action are denied by default', () => {
  const { policyForLegacyRequest, policyForSalesRequest, SALES_ROUTE_POLICIES } = accessControl();
  assert.equal(typeof policyForLegacyRequest, 'function');
  assert.deepEqual(policyForLegacyRequest('GET', '/unknown', ''), { deny: true });
  assert.deepEqual(policyForLegacyRequest('POST', '/app', 'unknown'), { deny: true });
  assert.deepEqual(policyForLegacyRequest('POST', '/prospect-agent', 'runTask'), { deny: true });
  assert.deepEqual(policyForLegacyRequest('GET', '/report', ''), { permissions: ['view_recon', 'view_contacts'] });
  assert.deepEqual(policyForSalesRequest('GET', '/unmapped'), { deny: true });
  assert.deepEqual(policyForSalesRequest('PATCH', '/accounts/CRM-1'), { permissions: ['edit_customer'] });
  assert.deepEqual(
    policyForSalesRequest('POST', '/ai/governance/strategies/STRATEGY-1/evaluations'),
    SALES_ROUTE_POLICIES['POST /ai/governance/strategies/:strategyId/evaluations'],
  );
  assert.deepEqual(
    policyForSalesRequest('POST', '/ai/governance/strategies/STRATEGY-1/request-publish'),
    SALES_ROUTE_POLICIES['POST /ai/governance/strategies/:strategyId/request-publish'],
  );
  assert.deepEqual(
    policyForSalesRequest('POST', '/ai/governance/strategies/STRATEGY-1/approve'),
    SALES_ROUTE_POLICIES['POST /ai/governance/strategies/:strategyId/approve'],
  );
  assert.deepEqual(
    policyForSalesRequest('POST', '/ai/governance/strategies/STRATEGY-1/rollback'),
    SALES_ROUTE_POLICIES['POST /ai/governance/strategies/:strategyId/rollback'],
  );
  assert.deepEqual(
    policyForSalesRequest('POST', '/ai/jobs/JOB-1/feedback'),
    SALES_ROUTE_POLICIES['POST /ai/jobs/:jobId/feedback'],
  );
});

test('every browser API has an explicit permission policy or separate token boundary', () => {
  const { LEGACY_ROUTE_POLICIES, LEGACY_ACTION_POLICIES, SALES_ROUTE_POLICIES } = accessControl();
  const legacyRoutes = [
    'GET /session/capabilities', 'GET /initial', 'GET /customers',
    'GET /customers/:customerId/people', 'GET /contact-recon/state',
    'GET /recon/results/:jobId', 'GET /report', 'GET /recon-monitor',
    'GET /quality/issues', 'GET /delivery/latest', 'GET /delivery/file',
    'POST /assistant/chat',
  ];
  const appActions = [
    'updateCustomer', 'createTag', 'setCustomerTags', 'removeCustomerTag', 'createReconJob',
    'retryReconJob', 'createContactReconJob',
  ];
  const prospectActions = ['createTask', 'rerunTask', 'promoteCandidate'];
  const salesRoutes = [
    'GET /bootstrap', 'GET /research/pool', 'GET /research/people',
    'GET /research/recon', 'GET /export', 'POST /accounts', 'POST /accounts/bulk-assign',
    'GET /accounts/recycle-bin', 'GET /accounts/:customerId/recycle-profile',
    'POST /accounts/bulk-return',
    'POST /accounts/:customerId/return', 'POST /accounts/:customerId/trash',
    'POST /accounts/:customerId/restore', 'POST /accounts/:customerId/reassign',
    'PATCH /accounts/:customerId',
    'POST /activities', 'POST /quotes', 'POST /orders', 'POST /users',
    'POST /users/:userId/password-reset', 'POST /users/:userId/archive', 'POST /users/:userId/restore',
    'DELETE /users/:userId', 'PATCH /users/:userId', 'GET /permission-groups', 'POST /permission-groups',
    'PATCH /permission-groups/:groupId', 'PUT /users/:userId/permission-overrides',
    'GET /filter-permissions', 'POST /filter-permissions',
    'PUT /filter-permissions/groups/:groupId', 'PUT /filter-permissions/users/:userId',
    'PATCH /filter-permissions/definitions/:filterKey',
    'POST /migration-review/:reviewId', 'POST /impersonation/start', 'POST /impersonation/stop', 'POST /password',
    'POST /intake/scan', 'POST /intake/action', 'PATCH /intake/settings',
    'POST /contacts', 'POST /evaluations', 'POST /evaluations/:evaluationId/retry',
    'GET /ai/customers/:customerId/results',
    'GET /ai/tasks', 'GET /ai/tasks/:taskId',
    'POST /ai/customers/:customerId/stations/customer_fit/run',
    'POST /ai/jobs/:jobId/retry',
    'POST /ai/jobs/:jobId/cancel', 'POST /ai/jobs/:jobId/review',
    'POST /ai/bulk/retry', 'POST /ai/bulk/cancel',
    'GET /ai/budgets', 'PUT /ai/budgets/:scopeType/:scopeId',
  ];
  for (const key of legacyRoutes) assert.ok(LEGACY_ROUTE_POLICIES[key], key);
  for (const action of appActions) assert.ok(LEGACY_ACTION_POLICIES.app[action], `app:${action}`);
  for (const action of prospectActions) assert.ok(LEGACY_ACTION_POLICIES['prospect-agent'][action], `prospect:${action}`);
  for (const key of salesRoutes) assert.ok(SALES_ROUTE_POLICIES[key], key);
});

test('identity inspection blocks exactly the Recon and account-security policies', () => {
  const { LEGACY_ACTION_POLICIES, SALES_ROUTE_POLICIES, policyForLegacyRequest, assertPolicyAllowed } = accessControl();
  const blockedApp = Object.entries(LEGACY_ACTION_POLICIES.app)
    .filter(([, policy]) => policy.blockedWhileImpersonating).map(([action]) => action).sort();
  assert.deepEqual(blockedApp, [
    'createContactReconJob',
    'createReconJob',
    'removeCustomerTag',
    'retryReconJob',
    'setCustomerTags',
  ]);
  const blockedProspect = Object.entries(LEGACY_ACTION_POLICIES['prospect-agent'])
    .filter(([, policy]) => policy.blockedWhileImpersonating).map(([action]) => action);
  assert.deepEqual(blockedProspect, []);
  assert.equal(
    policyForLegacyRequest('POST', '/prospect-agent', 'promoteCandidate', { createRecon: true }).blockedWhileImpersonating,
    true,
  );
  assert.equal(
    policyForLegacyRequest('POST', '/prospect-agent', 'promoteCandidate', { createRecon: false }).blockedWhileImpersonating,
    undefined,
  );
  const blockedSales = Object.entries(SALES_ROUTE_POLICIES)
    .filter(([, policy]) => policy.blockedWhileImpersonating).map(([key]) => key).sort();
  assert.deepEqual(blockedSales, [
    'DELETE /activity-reactions/:reactionId',
    'DELETE /users/:userId',
    'GET /activity-reactions/admin',
    'GET /ai/budgets',
    'GET /ai/features',
    'GET /data-maintenance/capabilities',
    'GET /data-maintenance/runs',
    'PATCH /activity-reactions/:reactionId',
    'PATCH /ai/features/:featureKey',
    'PATCH /filter-permissions/definitions/:filterKey',
    'PATCH /master/:customerId',
    'PATCH /permission-groups/:groupId',
    'PATCH /users/:userId',
    'POST /accounts/:customerId/reassign',
    'POST /accounts/:customerId/restore',
    'POST /accounts/:customerId/trash',
    'POST /activity-reactions',
    'POST /ai/bulk/cancel',
    'POST /ai/bulk/retry',
    'POST /ai/customers/:customerId/action-proposals',
    'POST /ai/customers/:customerId/enrichment/run',
    'POST /ai/customers/:customerId/stations/customer_fit/run',
    'POST /ai/customers/:customerId/stations/sales_pack/run',
    'POST /ai/enrichment/:runId/cancel',
    'POST /ai/governance/strategies',
    'POST /ai/governance/strategies/:strategyId/approve',
    'POST /ai/governance/strategies/:strategyId/evaluations',
    'POST /ai/governance/strategies/:strategyId/request-publish',
    'POST /ai/governance/strategies/:strategyId/rollback',
    'POST /ai/jobs/:jobId/cancel',
    'POST /ai/jobs/:jobId/feedback',
    'POST /ai/jobs/:jobId/next-action/adopt',
    'POST /ai/jobs/:jobId/retry',
    'POST /ai/jobs/:jobId/review',
    'POST /ai/manager-anomalies/run',
    'POST /ai/proposals/:proposalId/review',
    'POST /ai/sales-coaching/:salesUserId/run',
    'POST /data-maintenance/execute',
    'POST /data-maintenance/preview',
    'POST /filter-permissions',
    'POST /impersonation/start',
    'POST /migration-review/:reviewId',
    'POST /password',
    'POST /permission-groups',
    'POST /today-tasks/actions',
    'POST /users',
    'POST /users/:userId/archive',
    'POST /users/:userId/password-reset',
    'POST /users/:userId/restore',
    'PUT /activity-reactions/order',
    'PUT /ai/budgets/:scopeType/:scopeId',
    'PUT /filter-permissions/groups/:groupId',
    'PUT /filter-permissions/users/:userId',
    'PUT /users/:userId/permission-overrides',
  ]);
  assert.equal(typeof assertPolicyAllowed, 'function');
  assert.doesNotThrow(() => assertPolicyAllowed(SALES_ROUTE_POLICIES['POST /users'], { isImpersonating: false }));
  assert.throws(
    () => assertPolicyAllowed(SALES_ROUTE_POLICIES['POST /users'], { isImpersonating: true }),
    error => error.statusCode === 403 && error.code === 'IMPERSONATION_ACTION_BLOCKED',
  );
  assert.doesNotThrow(() => assertPolicyAllowed(SALES_ROUTE_POLICIES['POST /activities'], { isImpersonating: true }));
});
