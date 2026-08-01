'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

const SECRET_NAME = 'Protected Secret Name';

function seedConflict(db) {
  const insertPool = db.prepare(`INSERT INTO customer_pool(customer_id,company_name,nickname)
    VALUES (?,?,?)`);
  insertPool.run('RU-9101', 'Protected A Official', SECRET_NAME);
  insertPool.run('RU-9102', 'Protected B Official', SECRET_NAME);
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,nickname,created_at,updated_at)
    VALUES (?,?,?,?,?,?)`).run(
    'CRM-PROTECTED-B',
    'RU-9102',
    'Protected B Official',
    SECRET_NAME,
    '2026-08-01 00:00:00',
    '2026-08-01 00:00:00',
  );
}

async function conflictFixture(t) {
  const previousGate = process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'true';
  const fx = await fixtures.adminFixture();
  t.after(async () => {
    await fx.close();
    if (previousGate === undefined) delete process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
    else process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = previousGate;
  });
  seedConflict(fx.db);
  return fx;
}

function assertPrivateResponse(text) {
  assert.equal(text.includes(SECRET_NAME), false);
  assert.equal(text.includes('protected secret name'), false);
  assert.equal(text.includes('RU-9101'), false);
  assert.equal(text.includes('RU-9102'), false);
}

test('protected identity conflict routes require a real non-impersonating administrator', async t => {
  const fx = await conflictFixture(t);
  const route = '/api/sales-crm/protected-customer-conflicts';

  const unauthenticated = await fx.request(route);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get('cache-control'), 'private, no-store');
  for (const cookie of [fx.otherCookie, fx.cookie]) {
    const response = await fx.request(route, { cookie });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assertPrivateResponse(await response.text());
  }

  fx.setUserPermissions('U-WU', { manage_protected_customers: true });
  const grantedManager = await fx.request(route, { cookie: fx.cookie });
  assert.equal(grantedManager.status, 403);
  assert.equal(grantedManager.headers.get('cache-control'), 'private, no-store');
  assertPrivateResponse(await grantedManager.text());

  await fx.startImpersonation('U-OTHER');
  const impersonatedGet = await fx.request(route, { cookie: fx.adminCookie });
  assert.equal(impersonatedGet.status, 403);
  assert.equal(impersonatedGet.headers.get('cache-control'), 'private, no-store');
  assertPrivateResponse(await impersonatedGet.text());
  const impersonatedPost = await fx.request(
    `${route}/${encodeURIComponent('identity-conflict:unknown')}/resolve`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: {
        decision: 'link_existing',
        targetExternalCustomerId: 'RU-9101',
        details: 'must not execute',
        expectedVersion: 'sha256:unknown',
      },
    },
  );
  assert.equal(impersonatedPost.status, 403);
  assert.equal(impersonatedPost.headers.get('cache-control'), 'private, no-store');
  assertPrivateResponse(await impersonatedPost.text());
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_customer_identity_conflicts').get().count, 0);
});

test('admin can list and resolve conflicts without leaking details into generic request audit', async t => {
  const fx = await conflictFixture(t);
  const route = '/api/sales-crm/protected-customer-conflicts';
  const listedResponse = await fx.request(`${route}?status=unresolved&query=secret&page=1`, {
    cookie: fx.adminCookie,
  });
  assert.equal(listedResponse.status, 200);
  assert.equal(listedResponse.headers.get('cache-control'), 'private, no-store');
  const listed = await listedResponse.json();
  assert.equal(listed.page, 1);
  assert.equal(listed.pageSize, 20);
  assert.equal(listed.total, 1);
  assert.equal(listed.unresolved, 1);
  assert.equal(listed.hasMore, false);
  const item = listed.items[0];
  assert.equal(item.normalizedName, 'protected secret name');
  assert.deepEqual(item.externalCustomerIds, ['RU-9101', 'RU-9102']);

  const requestBody = {
    decision: 'link_existing',
    targetExternalCustomerId: 'RU-9101',
    details: { reason: 'contract review confirms the same customer' },
    expectedVersion: item.expectedVersion,
  };
  const resolveRoute = `${route}/${encodeURIComponent(item.conflictId)}/resolve`;
  const resolvedResponse = await fx.request(resolveRoute, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: requestBody,
  });
  assert.equal(resolvedResponse.status, 200);
  assert.equal(resolvedResponse.headers.get('cache-control'), 'private, no-store');
  const resolved = await resolvedResponse.json();
  assert.equal(resolved.resolution.status, 'resolved');
  assert.equal(resolved.resolution.idempotent, false);

  const repeated = await fx.request(resolveRoute, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: requestBody,
  });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).resolution.idempotent, true);
  assert.equal(
    fx.db.prepare(`SELECT COUNT(*) count FROM crm_customer_identity_conflict_audit
      WHERE conflict_id=?`).get(item.conflictId).count,
    1,
  );
  const historyResponse = await fx.request(`${route}?status=all`, { cookie: fx.adminCookie });
  const history = (await historyResponse.json()).items[0].history;
  assert.equal(history.length, 1);
  assert.equal(history[0].actorId, 'USR-ADMIN');
  assert.equal(history[0].decision, 'link_existing');
  assert.equal(history[0].before.expectedVersion, item.expectedVersion);
  assert.equal(history[0].after.expectedVersion, resolved.resolution.expectedVersion);

  const stale = await fx.request(resolveRoute, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { ...requestBody, targetExternalCustomerId: 'RU-9102' },
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'PROTECTED_IDENTITY_CONFLICT_VERSION_STALE');

  const auditRows = fx.db.prepare(`SELECT action,entity_id,detail_json FROM crm_audit_log
    WHERE action='POST /protected-customer-conflicts/:conflictId/resolve'`).all();
  assert.ok(auditRows.length >= 2);
  for (const row of auditRows) {
    assert.equal(row.entity_id, '');
    assert.deepEqual(JSON.parse(row.detail_json), {
      route: 'POST /protected-customer-conflicts/:conflictId/resolve',
    });
    assertPrivateResponse(JSON.stringify(row));
  }

  const after = await fx.request(`${route}?status=unresolved`, { cookie: fx.adminCookie });
  const afterBody = await after.json();
  assert.equal(afterBody.unresolved, 0);
  assert.equal(afterBody.total, 0);
});

test('disabled production write gate rejects resolution while keeping the read list available', async t => {
  const fx = await conflictFixture(t);
  const route = '/api/sales-crm/protected-customer-conflicts';
  const listed = await fx.requestJson(route, { cookie: fx.adminCookie });
  const item = listed.items[0];
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'false';
  const response = await fx.request(
    `${route}/${encodeURIComponent(item.conflictId)}/resolve`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: {
        decision: 'link_existing',
        targetExternalCustomerId: 'RU-9101',
        details: 'should remain blocked',
        expectedVersion: item.expectedVersion,
      },
    },
  );
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json()).code, 'PROTECTED_CUSTOMER_WRITES_DISABLED');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_customer_identity_conflicts').get().count, 0);
});
