'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { recycleScope, mismatchIntakeScope } = require('../lib/business_page_filters');

async function responseJson(response) {
  return { response, body: await response.json() };
}

async function recycleList(fx, cookie) {
  return responseJson(await fx.request(
    '/api/sales-crm/lists/recycle_bin?page=1&pageSize=50&filters=%7B%7D',
    { cookie },
  ));
}

function profileRoute(recordKey) {
  return `/api/sales-crm/mismatch-recycle/${encodeURIComponent(recordKey)}/profile`;
}

async function setupMismatchProfileFixture(t) {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  fx.db.prepare(`UPDATE sales_users SET role='sales',permission_group_id=? WHERE id='U-WU'`)
    .run(fx.salesGroupId);
  fx.setUserPermissions('U-WU', { view_all_customers: false, view_own_mismatch_history: true });
  fx.salesCookie = await fx.login('wu@example.com', 'Password123!');
  fx.managerCookie = await fx.login('manager@example.com', 'Password123!');

  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='mismatch',
    recycle_reason='Wu account mismatch',recycled_by='U-WU',recycled_at='2026-08-13 09:00:00',
    previous_owner_id='U-WU',owner_id=NULL,assignment_status='returned'
    WHERE id='CRM-WU'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='mismatch',
    recycle_reason='Other account mismatch',recycled_by='U-OTHER',recycled_at='2026-08-13 09:01:00',
    previous_owner_id='U-OTHER',owner_id=NULL,assignment_status='returned'
    WHERE id='CRM-OTHER'`).run();

  const now = '2026-08-13 09:02:00';
  const insertIntake = fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,previous_owner_id,
     rejected_by,rejected_at,return_reason,crm_customer_id,created_at,updated_at)
    VALUES (?,?,?,?, 'rejected','',?,?,?,?, '',?,?)`);
  insertIntake.run(
    'INTAKE-WU', 'BATCH-TEST', 'RU-9010', 'Wu Intake Mismatch',
    'U-WU', 'U-WU', now, 'Wu intake mismatch', now, now,
  );
  insertIntake.run(
    'INTAKE-FOREIGN', 'BATCH-TEST', 'RU-9011', 'Foreign Intake Mismatch',
    'U-OTHER', 'U-OTHER', now, 'Foreign intake mismatch', now, now,
  );

  return fx;
}

test('account mismatch profile enforces sales ownership and view-all access', async t => {
  const fx = await setupMismatchProfileFixture(t);

  const salesList = await recycleList(fx, fx.salesCookie);
  assert.equal(salesList.response.status, 200, salesList.body.error);
  assert.deepEqual(
    salesList.body.rows.map(row => row.recordKey).sort(),
    ['account:CRM-WU', 'intake:INTAKE-WU'],
  );

  const cases = [
    { actor: 'sales', cookie: fx.salesCookie, recordKey: 'account:CRM-WU', status: 200 },
    {
      actor: 'sales', cookie: fx.salesCookie, recordKey: 'account:CRM-OTHER', status: 403,
      code: 'MISMATCH_RECORD_FORBIDDEN',
    },
    { actor: 'manager', cookie: fx.managerCookie, recordKey: 'account:CRM-WU', status: 200 },
    { actor: 'manager', cookie: fx.managerCookie, recordKey: 'account:CRM-OTHER', status: 200 },
    { actor: 'admin', cookie: fx.adminCookie, recordKey: 'account:CRM-WU', status: 200 },
    { actor: 'admin', cookie: fx.adminCookie, recordKey: 'account:CRM-OTHER', status: 200 },
  ];
  for (const scenario of cases) {
    await t.test(`${scenario.actor} sees ${scenario.recordKey} as ${scenario.status}`, async () => {
      const response = await fx.request(profileRoute(scenario.recordKey), { cookie: scenario.cookie });
      const body = await response.json();
      assert.equal(response.status, scenario.status, `${scenario.recordKey}: ${JSON.stringify(body)}`);
      if (scenario.code) assert.equal(body.code, scenario.code);
    });
  }
});

test('account mismatch profile returns the unified read-only DTO and no-store header', async t => {
  const fx = await setupMismatchProfileFixture(t);

  let response = await fx.request(profileRoute('account:CRM-WU'), { cookie: fx.salesCookie });
  let body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Object.keys(body).sort(), [
    'actions', 'customer', 'history', 'ok', 'profile', 'recordKey', 'recycle', 'sourceType',
  ]);
  assert.equal(body.ok, true);
  assert.equal(body.recordKey, 'account:CRM-WU');
  assert.equal(body.sourceType, 'account');
  assert.deepEqual(Object.keys(body.customer), [
    'accountId', 'intakeItemId', 'externalCustomerId', 'nickname', 'companyName', 'country',
    'city', 'website', 'industry', 'customerType', 'products', 'description',
  ]);
  assert.equal(body.customer.accountId, 'CRM-WU');
  assert.equal(body.customer.intakeItemId, '');
  assert.equal(body.customer.externalCustomerId, 'RU-9001');
  assert.equal(body.customer.companyName, 'Wu Fixture');
  assert.deepEqual(Object.keys(body.profile), [
    'customerPool', 'customers', 'reconJobs', 'reconResults', 'contactReconJobs', 'people',
    'accountContacts',
  ]);
  assert.deepEqual(Object.keys(body.history), [
    'activities', 'rfqs', 'quotes', 'orders', 'timeline', 'evaluations', 'auditLog',
  ]);
  for (const rows of [...Object.values(body.profile), ...Object.values(body.history)]) {
    assert.equal(Array.isArray(rows), true);
  }
  assert.deepEqual(body.profile.people, []);
  assert.deepEqual(body.profile.accountContacts, []);
  assert.deepEqual(body.history.evaluations, []);
  assert.deepEqual(body.actions, []);

  response = await fx.request(profileRoute('account:CRM-WU'), { cookie: fx.managerCookie });
  body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.deepEqual(body.actions, ['reassign']);
});

test.skip('Task 5: intake mismatch profile enforces sales ownership and view-all access', async t => {
  const fx = await setupMismatchProfileFixture(t);
  for (const scenario of [
    { cookie: fx.salesCookie, recordKey: 'intake:INTAKE-WU', status: 200 },
    { cookie: fx.salesCookie, recordKey: 'intake:INTAKE-FOREIGN', status: 403 },
    { cookie: fx.managerCookie, recordKey: 'intake:INTAKE-WU', status: 200 },
    { cookie: fx.managerCookie, recordKey: 'intake:INTAKE-FOREIGN', status: 200 },
  ]) {
    const response = await fx.request(profileRoute(scenario.recordKey), { cookie: scenario.cookie });
    assert.equal(response.status, scenario.status, await response.text());
  }
});

test('shared mismatch scopes preserve account and pre-CRM visibility predicates', () => {
  const sales = { id: 'U-WU', permissions: { view_all_customers: false } };
  const viewAll = { id: 'U-MGR', permissions: { view_all_customers: true } };

  assert.deepEqual(recycleScope(sales, 'acct'), {
    conditions: [
      "COALESCE(acct.lifecycle_status,'active')='recycled'",
      "acct.recycle_kind IN ('mismatch','manual_delete')",
      '(acct.previous_owner_id=? OR acct.recycled_by=?)',
    ],
    params: ['U-WU', 'U-WU'],
  });
  assert.deepEqual(mismatchIntakeScope(sales, 'intake'), {
    conditions: [
      "intake.status='rejected'",
      "COALESCE(intake.crm_customer_id,'')=''",
      "COALESCE(intake.rejected_at,'')!=''",
      '(intake.previous_owner_id=? OR intake.rejected_by=?)',
    ],
    params: ['U-WU', 'U-WU'],
  });
  assert.equal(recycleScope(viewAll).params.length, 0);
  assert.equal(mismatchIntakeScope(viewAll).params.length, 0);
});

test('mismatch profile returns stable 404 for malformed or missing record keys', async t => {
  const fx = await setupMismatchProfileFixture(t);

  for (const recordKey of [
    ' ', 'malformed', 'account:CRM-WU:extra', 'unknown:CRM-WU', 'account:', 'intake:',
    'account:CRM-MISSING', 'intake:INTAKE-MISSING',
  ]) {
    await t.test(recordKey, async () => {
      const response = await fx.request(profileRoute(recordKey), { cookie: fx.adminCookie });
      const body = await response.json();
      assert.equal(response.status, 404, `${recordKey}: ${JSON.stringify(body)}`);
      assert.equal(body.code, 'MISMATCH_RECORD_NOT_FOUND');
    });
  }
});
