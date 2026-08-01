const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERMISSION_DEFINITIONS,
  ROLE_PERMISSIONS,
  SALES_ROUTE_POLICIES,
  normalizePermissions,
  policyForSalesRequest,
  assertPolicyAllowed,
} = require('../lib/access_control');

const routeCases = [
  ['GET', '/activity-correction-targets', {
    anyPermissions: ['correct_own_activity', 'manage_activity_corrections'],
  }],
  ['GET', '/activity-corrections', {
    anyPermissions: ['correct_own_activity', 'manage_activity_corrections'],
  }],
  ['POST', '/activity-corrections', {
    permissions: ['correct_own_activity'], blockedWhileImpersonating: true,
  }],
  ['GET', '/activity-correction-proposals', { permissions: ['manage_activity_corrections'] }],
  ['POST', '/activity-correction-proposals', {
    permissions: ['correct_own_activity'], blockedWhileImpersonating: true,
  }],
  ['POST', '/activity-correction-proposals/proposal-123/review', {
    permissions: ['manage_activity_corrections'], blockedWhileImpersonating: true,
  }],
];

test('Issue 171 correction permissions are registered with the intended role defaults', () => {
  assert.equal(PERMISSION_DEFINITIONS.correct_own_activity, '更正本人客户动作');
  assert.equal(PERMISSION_DEFINITIONS.manage_activity_corrections, '管理客户动作更正');
  assert.deepEqual(
    Object.fromEntries(Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => [role, {
      correct_own_activity: permissions.correct_own_activity,
      manage_activity_corrections: permissions.manage_activity_corrections,
    }])),
    {
      admin: { correct_own_activity: true, manage_activity_corrections: true },
      manager: { correct_own_activity: true, manage_activity_corrections: true },
      sales: { correct_own_activity: true, manage_activity_corrections: false },
    },
  );
});

test('permission normalization accepts registered correction keys and ignores forged keys', () => {
  assert.deepEqual(normalizePermissions({
    correct_own_activity: 1,
    manage_activity_corrections: 0,
    forged_activity_correction: true,
  }), {
    correct_own_activity: true,
    manage_activity_corrections: false,
  });
});

test('Issue 171 correction routes resolve through plain and API-prefixed paths', () => {
  for (const [method, route, policy] of routeCases) {
    assert.deepEqual(policyForSalesRequest(method, `${route}?source=test`), policy);
    assert.deepEqual(policyForSalesRequest(method, `/api/sales-crm${route}?source=test`), policy);
  }
  assert.deepEqual(
    SALES_ROUTE_POLICIES['POST /activity-correction-proposals/:proposalId/review'],
    routeCases.at(-1)[2],
  );
});

test('proposal review IDs normalize without weakening the route boundary', () => {
  const policy = {
    permissions: ['manage_activity_corrections'], blockedWhileImpersonating: true,
  };
  for (const proposalId of ['42', 'proposal_with_symbols-123', encodeURIComponent('提案 1')]) {
    assert.deepEqual(
      policyForSalesRequest('POST', `/activity-correction-proposals/${proposalId}/review`),
      policy,
    );
  }
});

test('only correction write routes block impersonation', () => {
  for (const [method, route, policy] of routeCases) {
    assert.equal(Boolean(policy.blockedWhileImpersonating), method === 'POST', `${method} ${route}`);
    assert.doesNotThrow(() => assertPolicyAllowed(policy, { isImpersonating: false }));
    if (method === 'GET') {
      assert.doesNotThrow(() => assertPolicyAllowed(policy, { isImpersonating: true }));
      continue;
    }
    assert.throws(
      () => assertPolicyAllowed(policy, { isImpersonating: true }),
      error => error.statusCode === 403 && error.code === 'IMPERSONATION_ACTION_BLOCKED',
    );
  }
});

test('unknown correction sibling routes remain denied', () => {
  const unknownRoutes = [
    ['PATCH', '/activity-corrections'],
    ['PATCH', '/activity-correction-proposals/proposal-123/review'],
    ['POST', '/activity-correction-proposals/proposal-123/review/extra'],
    ['POST', '/activity-correction-proposals//review'],
  ];
  for (const [method, route] of unknownRoutes) {
    assert.deepEqual(policyForSalesRequest(method, route), { deny: true }, `${method} ${route}`);
  }
});
