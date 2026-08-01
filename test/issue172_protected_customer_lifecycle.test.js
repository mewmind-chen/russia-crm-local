'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

async function protectedFixture(t) {
  const previousGate = process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'true';
  const fx = await fixtures.adminFixture();
  t.after(async () => {
    await fx.close();
    if (previousGate === undefined) delete process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
    else process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = previousGate;
  });
  return fx;
}

test('protected batch commits valid rows, rejects invalid rows, and is idempotent', async t => {
  const fx = await protectedFixture(t);
  const previewResponse = await fx.request('/api/sales-crm/protected-customers/batches/preview', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'preview-lifecycle-1',
      rows: [
        { alphaNickname: 'Alpha North', country: 'Russia', companyName: 'North Official LLC' },
        { alphaNickname: '   ', country: 'Russia' },
      ],
    },
  });
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.headers.get('cache-control'), 'private, no-store');
  const preview = await previewResponse.json();
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0].status, 'ready');
  assert.equal(preview.rows[1].status, 'rejected');
  assert.equal(preview.rows[1].errorCode, 'PROTECTED_CUSTOMER_ALPHA_NICKNAME_REQUIRED');

  const commitRoute = `/api/sales-crm/protected-customers/batches/${preview.batchId}/commit`;
  const commitResponse = await fx.request(commitRoute, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { idempotencyKey: 'commit-lifecycle-1' },
  });
  assert.equal(commitResponse.status, 200);
  const committed = await commitResponse.json();
  assert.equal(committed.imported, 1);
  assert.equal(committed.rejected, 1);
  assert.equal(committed.rows[0].status, 'imported');
  assert.match(committed.rows[0].externalCustomerId, /^RU-\d{4}$/);
  assert.equal(
    fx.db.prepare('SELECT COUNT(*) count FROM crm_accounts WHERE external_customer_id=?')
      .get(committed.rows[0].externalCustomerId).count,
    0,
  );

  const repeated = await fx.request(commitRoute, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { idempotencyKey: 'commit-lifecycle-1' },
  });
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), committed);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_protected_customers').get().count, 1);
});

test('activation preserves the external customer id, creates one account, and blocks rollback', async t => {
  const fx = await protectedFixture(t);
  const preview = await fx.requestJson('/api/sales-crm/protected-customers/batches/preview', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'preview-activate-1',
      rows: [{ alphaNickname: 'Alpha South', country: 'Brazil' }],
    },
  });
  const committed = await fx.requestJson(
    `/api/sales-crm/protected-customers/batches/${preview.batchId}/commit`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: { idempotencyKey: 'commit-activate-1' },
    },
  );
  const externalCustomerId = committed.rows[0].externalCustomerId;
  assert.match(externalCustomerId, /^BR-\d{4}$/);

  const activateRoute = `/api/sales-crm/protected-customers/${externalCustomerId}/activate`;
  const incompleteActivation = await fx.request(activateRoute, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { idempotencyKey: 'activate-incomplete', ownerId: 'U-OTHER' },
  });
  assert.equal(incompleteActivation.status, 400);
  assert.equal(
    (await incompleteActivation.json()).code,
    'PROTECTED_CUSTOMER_COMPANY_NAME_REQUIRED',
  );
  const activationResponse = await fx.request(activateRoute, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'activate-1',
      ownerId: 'U-OTHER',
      companyName: 'South Official SA',
      nextAction: '首次联系',
    },
  });
  assert.equal(activationResponse.status, 200);
  const activated = await activationResponse.json();
  assert.equal(activated.externalCustomerId, externalCustomerId);
  assert.match(activated.accountId, /^CRM-/);
  assert.equal(
    fx.db.prepare('SELECT COUNT(*) count FROM crm_accounts WHERE external_customer_id=?')
      .get(externalCustomerId).count,
    1,
  );

  const repeated = await fx.request(activateRoute, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'activate-1',
      ownerId: 'U-OTHER',
      companyName: 'South Official SA',
      nextAction: '首次联系',
    },
  });
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), activated);

  const rollback = await fx.request(
    `/api/sales-crm/protected-customers/batches/${preview.batchId}/rollback`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: { reason: 'should be rejected' },
    },
  );
  assert.equal(rollback.status, 409);
  assert.equal((await rollback.json()).code, 'PROTECTED_CUSTOMER_BATCH_NOT_ROLLBACKABLE');
});

test('activation accepts only an active non-archived sales owner and invalid owners write nothing', async t => {
  const fx = await protectedFixture(t);
  const preview = await fx.requestJson('/api/sales-crm/protected-customers/batches/preview', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'preview-owner-eligibility',
      rows: [{ alphaNickname: 'Alpha Owner Eligibility', country: 'Russia' }],
    },
  });
  const committed = await fx.requestJson(
    `/api/sales-crm/protected-customers/batches/${preview.batchId}/commit`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: { idempotencyKey: 'commit-owner-eligibility' },
    },
  );
  const externalCustomerId = committed.rows[0].externalCustomerId;
  const route = `/api/sales-crm/protected-customers/${externalCustomerId}/activate`;

  async function assertOwnerRejected(ownerId, idempotencyKey) {
    const response = await fx.request(route, {
      cookie: fx.adminCookie,
      method: 'POST',
      body: {
        idempotencyKey,
        ownerId,
        companyName: 'Owner Eligibility Official LLC',
      },
    });
    assert.equal(response.status, 400, ownerId);
    assert.equal((await response.json()).code, 'PROTECTED_CUSTOMER_OWNER_REQUIRED', ownerId);
    assert.deepEqual(
      fx.db.prepare(`SELECT status,activated_account_id accountId
        FROM crm_protected_customers WHERE external_customer_id=?`).get(externalCustomerId),
      { status: 'protected', accountId: '' },
      ownerId,
    );
    assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_accounts
      WHERE external_customer_id=?`).get(externalCustomerId).count, 0, ownerId);
    assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_protected_customer_audit
      WHERE external_customer_id=? AND action='protected_customer_activated'`)
      .get(externalCustomerId).count, 0, ownerId);
    assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_protected_customer_action_requests
      WHERE action='activate'`).get().count, 0, ownerId);
  }

  await assertOwnerRejected('USR-ADMIN', 'activate-owner-admin');
  await assertOwnerRejected('U-WU', 'activate-owner-manager');

  fx.db.prepare("UPDATE sales_users SET active=0 WHERE id='U-OTHER'").run();
  await assertOwnerRejected('U-OTHER', 'activate-owner-inactive-sales');
  fx.db.prepare("UPDATE sales_users SET active=1,archived_at='2026-08-01 00:00:00' WHERE id='U-OTHER'").run();
  await assertOwnerRejected('U-OTHER', 'activate-owner-archived-sales');

  fx.db.prepare("UPDATE sales_users SET archived_at='' WHERE id='U-OTHER'").run();
  const activatedResponse = await fx.request(route, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'activate-owner-valid-sales',
      ownerId: 'U-OTHER',
      companyName: 'Owner Eligibility Official LLC',
    },
  });
  assert.equal(activatedResponse.status, 200);
  assert.equal(
    fx.db.prepare('SELECT owner_id FROM crm_accounts WHERE external_customer_id=?')
      .get(externalCustomerId).owner_id,
    'U-OTHER',
  );
});

test('an unactivated batch can be rolled back without reusing its stable customer id', async t => {
  const fx = await protectedFixture(t);
  const preview = await fx.requestJson('/api/sales-crm/protected-customers/batches/preview', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'preview-rollback-1',
      rows: [{ alphaNickname: 'Alpha Withdrawn' }],
    },
  });
  const committed = await fx.requestJson(
    `/api/sales-crm/protected-customers/batches/${preview.batchId}/commit`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: { idempotencyKey: 'commit-rollback-1' },
    },
  );
  const withdrawnId = committed.rows[0].externalCustomerId;
  const rollbackRoute = `/api/sales-crm/protected-customers/batches/${preview.batchId}/rollback`;
  const rolledBack = await fx.requestJson(rollbackRoute, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { idempotencyKey: 'rollback-1', reason: 'contract cancelled' },
  });
  assert.equal(rolledBack.rolledBack, true);
  assert.equal(
    fx.db.prepare('SELECT status FROM crm_protected_customers WHERE external_customer_id=?')
      .get(withdrawnId).status,
    'withdrawn',
  );
  assert.equal(
    fx.db.prepare('SELECT company_name FROM customer_pool WHERE customer_id=?').get(withdrawnId).company_name,
    '',
  );
  assert.equal(
    fx.db.prepare('SELECT COUNT(*) count FROM crm_customer_identity_registry WHERE external_customer_id=?')
      .get(withdrawnId).count,
    0,
  );

  const nextPreview = await fx.requestJson('/api/sales-crm/protected-customers/batches/preview', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'preview-after-rollback',
      rows: [{ alphaNickname: 'Alpha Replacement' }],
    },
  });
  const nextCommit = await fx.requestJson(
    `/api/sales-crm/protected-customers/batches/${nextPreview.batchId}/commit`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: { idempotencyKey: 'commit-after-rollback' },
    },
  );
  assert.notEqual(nextCommit.rows[0].externalCustomerId, withdrawnId);
});

test('a preview idempotency key cannot be reused for different rows', async t => {
  const fx = await protectedFixture(t);
  const route = '/api/sales-crm/protected-customers/batches/preview';
  const first = await fx.request(route, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { idempotencyKey: 'preview-mismatch', rows: [{ alphaNickname: 'Alpha First' }] },
  });
  assert.equal(first.status, 200);
  const second = await fx.request(route, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { idempotencyKey: 'preview-mismatch', rows: [{ alphaNickname: 'Alpha Second' }] },
  });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, 'PROTECTED_CUSTOMER_IDEMPOTENCY_MISMATCH');
});

test('protected customer routes require a real non-impersonating administrator', async t => {
  const fx = await protectedFixture(t);
  const route = '/api/sales-crm/protected-customers/batches/preview';
  const body = { rows: [{ alphaNickname: 'Private Alpha' }] };

  assert.equal((await fx.request(route, { method: 'POST', body })).status, 401);
  for (const cookie of [fx.cookie, fx.otherCookie]) {
    const response = await fx.request(route, { cookie, method: 'POST', body });
    assert.equal(response.status, 403);
    assert.equal((await response.text()).includes('Private Alpha'), false);
  }

  fx.setUserPermissions('U-WU', { manage_protected_customers: true });
  assert.equal((await fx.request(route, { cookie: fx.cookie, method: 'POST', body })).status, 403);

  await fx.startImpersonation('U-OTHER');
  const impersonated = await fx.request(route, { cookie: fx.adminCookie, method: 'POST', body });
  assert.equal(impersonated.status, 403);
  assert.equal((await impersonated.text()).includes('Private Alpha'), false);
});

test('disabled write gate blocks lifecycle writes without creating a batch', async t => {
  const fx = await protectedFixture(t);
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'false';
  const response = await fx.request('/api/sales-crm/protected-customers/batches/preview', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { rows: [{ alphaNickname: 'Gate Protected' }] },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PROTECTED_CUSTOMER_WRITES_DISABLED');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_protected_customer_batches').get().count, 0);
});

test('admin workspace exposes complete protected profiles, template, detail, update, and mapping export', async t => {
  const fx = await protectedFixture(t);
  const preview = await fx.requestJson('/api/sales-crm/protected-customers/batches/preview', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'preview-admin-workspace',
      rows: [{
        alphaNickname: 'Alpha Workspace',
        companyName: 'Workspace Draft LLC',
        country: 'Russia',
        city: 'Moscow',
        website: 'https://draft.example',
        industry: 'Electronics',
        customerType: 'OEM',
        productFocus: 'MCU',
      }],
    },
  });
  const committed = await fx.requestJson(
    `/api/sales-crm/protected-customers/batches/${preview.batchId}/commit`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: { idempotencyKey: 'commit-admin-workspace' },
    },
  );
  const externalCustomerId = committed.rows[0].externalCustomerId;

  const listResponse = await fx.request(
    '/api/sales-crm/protected-customers?query=Workspace&status=protected',
    { cookie: fx.adminCookie },
  );
  assert.equal(listResponse.status, 200);
  const listed = await listResponse.json();
  assert.equal(listed.writeEnabled, true);
  assert.equal(listed.total, 1);
  assert.deepEqual(
    Object.fromEntries([
      'externalCustomerId', 'alphaNickname', 'crmNickname', 'companyName', 'country', 'city',
      'website', 'industry', 'customerType', 'productFocus', 'batchId', 'status', 'createdAt',
    ].map(key => [key, listed.items[0][key]])),
    {
      externalCustomerId,
      alphaNickname: 'Alpha Workspace',
      crmNickname: '',
      companyName: 'Workspace Draft LLC',
      country: 'Russia',
      city: 'Moscow',
      website: 'https://draft.example',
      industry: 'Electronics',
      customerType: 'OEM',
      productFocus: 'MCU',
      batchId: preview.batchId,
      status: 'protected',
      createdAt: listed.items[0].createdAt,
    },
  );

  const templateResponse = await fx.request('/api/sales-crm/protected-customers/template', {
    cookie: fx.adminCookie,
  });
  assert.equal(templateResponse.status, 200);
  assert.match(templateResponse.headers.get('content-type'), /^text\/csv/);
  assert.match(templateResponse.headers.get('content-disposition'), /protected-customer-template\.csv/);
  assert.match(await templateResponse.text(), /^alphaNickname,companyName,country,city,website,industry,customerType,productFocus/);

  const detailResponse = await fx.request(
    `/api/sales-crm/protected-customers/${encodeURIComponent(externalCustomerId)}`,
    { cookie: fx.adminCookie },
  );
  assert.equal(detailResponse.status, 200);
  assert.equal((await detailResponse.json()).customer.alphaNickname, 'Alpha Workspace');

  const updateResponse = await fx.request(
    `/api/sales-crm/protected-customers/${encodeURIComponent(externalCustomerId)}`,
    {
      cookie: fx.adminCookie,
      method: 'PATCH',
      body: {
        companyName: 'Workspace Official LLC',
        city: 'Saint Petersburg',
        website: 'https://workspace.example',
        productFocus: 'Sensors',
      },
    },
  );
  assert.equal(updateResponse.status, 200);
  const updated = (await updateResponse.json()).customer;
  assert.equal(updated.companyName, 'Workspace Official LLC');
  assert.equal(updated.city, 'Saint Petersburg');
  assert.equal(updated.productFocus, 'Sensors');

  const exportResponse = await fx.request('/api/sales-crm/protected-customers/export', {
    cookie: fx.adminCookie,
  });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type'), /^text\/csv/);
  assert.match(exportResponse.headers.get('content-disposition'), /protected-customer-mapping\.csv/);
  const exported = await exportResponse.text();
  assert.match(exported, /Alpha Workspace/);
  assert.match(exported, /Workspace Official LLC/);
  assert.match(exported, new RegExp(externalCustomerId));

  const ordinaryExport = await fx.request('/api/sales-crm/export?format=csv', {
    cookie: fx.adminCookie,
  });
  const ordinaryText = await ordinaryExport.text();
  assert.equal(ordinaryText.includes('Alpha Workspace'), false);
  assert.equal(ordinaryText.includes('Workspace Official LLC'), false);
});

test('new protected workspace routes stay admin-only and write endpoints fail closed', async t => {
  const fx = await protectedFixture(t);
  const readRoutes = [
    '/api/sales-crm/protected-customers/template',
    '/api/sales-crm/protected-customers/export',
    '/api/sales-crm/protected-customers/RU-UNKNOWN',
  ];
  for (const route of readRoutes) {
    assert.equal((await fx.request(route, { cookie: fx.cookie })).status, 403, route);
    assert.equal((await fx.request(route, { cookie: fx.otherCookie })).status, 403, route);
  }

  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'false';
  const readOnlyList = await fx.request('/api/sales-crm/protected-customers', {
    cookie: fx.adminCookie,
  });
  assert.equal(readOnlyList.status, 200);
  assert.equal((await readOnlyList.json()).writeEnabled, false);
  assert.equal((await fx.request('/api/sales-crm/protected-customers/template', {
    cookie: fx.adminCookie,
  })).status, 200);
  assert.equal((await fx.request('/api/sales-crm/protected-customers/export', {
    cookie: fx.adminCookie,
  })).status, 200);
  const update = await fx.request('/api/sales-crm/protected-customers/RU-UNKNOWN', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { companyName: 'Must Not Persist' },
  });
  assert.equal(update.status, 409);
  assert.equal((await update.json()).code, 'PROTECTED_CUSTOMER_WRITES_DISABLED');
});
