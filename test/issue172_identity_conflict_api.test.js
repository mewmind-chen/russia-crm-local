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

test('admin list preserves the previous candidate anchor after sources clear for confirm_new', async t => {
  const fx = await conflictFixture(t);
  const route = '/api/sales-crm/protected-customer-conflicts';
  const initial = await fx.requestJson(route, { cookie: fx.adminCookie });
  const item = initial.items[0];
  const retry = await fx.requestJson(`${route}/${encodeURIComponent(item.conflictId)}/resolve`, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      decision: 'supplement_and_retry',
      details: { reason: '等待正式名称资料' },
      expectedVersion: item.expectedVersion,
    },
  });
  assert.equal(retry.resolution.status, 'retry');

  fx.db.prepare('UPDATE customer_pool SET nickname=? WHERE customer_id=?')
    .run('Distinct Customer A', 'RU-9101');
  fx.db.prepare('UPDATE customer_pool SET nickname=? WHERE customer_id=?')
    .run('Distinct Customer B', 'RU-9102');
  fx.db.prepare('UPDATE crm_accounts SET nickname=? WHERE external_customer_id=?')
    .run('Distinct CRM Customer B', 'RU-9102');

  const cleared = await fx.requestJson(`${route}?status=unresolved`, { cookie: fx.adminCookie });
  const clearedItem = cleared.items.find(candidate => candidate.conflictId === item.conflictId);
  assert.ok(clearedItem);
  assert.deepEqual(clearedItem.externalCustomerIds, []);
  assert.deepEqual(clearedItem.previousExternalCustomerIds, ['RU-9101', 'RU-9102']);

  const confirmed = await fx.requestJson(
    `${route}/${encodeURIComponent(item.conflictId)}/resolve`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: {
        decision: 'confirm_new',
        targetExternalCustomerId: 'RU-9101',
        details: { reason: '来源已清零，按上一轮证据确认新身份锚点' },
        expectedVersion: clearedItem.expectedVersion,
      },
    },
  );
  assert.equal(confirmed.resolution.status, 'resolved');
  assert.equal(confirmed.resolution.targetExternalCustomerId, 'RU-9101');
});

test('admin conflict list paginates beyond twenty blocking conflicts', async t => {
  const fx = await conflictFixture(t);
  const insert = fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name,nickname)
    VALUES (?,?,?)`);
  for (let index = 0; index < 20; index += 1) {
    const suffix = String(index).padStart(2, '0');
    const nickname = `Paged Conflict ${suffix}`;
    insert.run(`RU-${9200 + index * 2}`, `Paged Company ${suffix} A`, nickname);
    insert.run(`RU-${9201 + index * 2}`, `Paged Company ${suffix} B`, nickname);
  }
  const route = '/api/sales-crm/protected-customer-conflicts?status=unresolved';
  const first = await fx.requestJson(`${route}&page=1`, { cookie: fx.adminCookie });
  const second = await fx.requestJson(`${route}&page=2`, { cookie: fx.adminCookie });
  assert.equal(first.total, 21);
  assert.equal(first.page, 1);
  assert.equal(first.pageSize, 20);
  assert.equal(first.totalPages, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.items.length, 20);
  assert.equal(second.page, 2);
  assert.equal(second.hasMore, false);
  assert.equal(second.items.length, 1);
  const firstIds = new Set(first.items.map(item => item.conflictId));
  assert.equal(firstIds.has(second.items[0].conflictId), false);
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

test('admin can explicitly rescan conflicts and the write gate blocks rescans', async t => {
  const fx = await conflictFixture(t);
  const route = '/api/sales-crm/protected-customer-conflicts/rescan';
  assert.equal((await fx.request(route, { cookie: fx.cookie, method: 'POST' })).status, 403);
  assert.equal((await fx.request(route, { cookie: fx.otherCookie, method: 'POST' })).status, 403);

  const response = await fx.request(route, { cookie: fx.adminCookie, method: 'POST' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.rescanned, true);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].normalizedName, 'protected secret name');

  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'false';
  const blocked = await fx.request(route, { cookie: fx.adminCookie, method: 'POST' });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, 'PROTECTED_CUSTOMER_WRITES_DISABLED');
});
