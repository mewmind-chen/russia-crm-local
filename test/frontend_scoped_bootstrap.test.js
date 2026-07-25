'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

const SECTION_FIELDS = {
  core: [
    'features', 'generatedAt', 'impersonation', 'permissionDefinitions',
    'realUser', 'rolePermissions', 'stages', 'user',
  ],
  today: ['alerts', 'notifications'],
  customers: [
    'accounts', 'activities', 'customerEvaluationTags', 'funnel', 'orders',
    'quotes', 'rfqs', 'summary', 'timeline',
  ],
  intake: ['intake'],
  team: ['teamReport'],
  intelligence: [
    'cohortReport', 'countryReport', 'customerPool', 'insights', 'people',
    'reconResults', 'researchTotals',
  ],
  administration: [
    'archivedUsers', 'auditLog', 'migrationReview', 'permissionGroups', 'users',
  ],
};

function expectedFields(...sections) {
  return ['ok', ...sections.flatMap(section => SECTION_FIELDS[section])].sort();
}

async function getJson(fx, route) {
  const response = await fx.request(route, { cookie: fx.adminCookie });
  return { response, body: await response.json() };
}

test('bootstrap without sections retains the complete legacy payload', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const { response, body } = await getJson(fx, '/api/sales-crm/bootstrap');
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), expectedFields(...Object.keys(SECTION_FIELDS)));
  assert.equal(body.ok, true);
  assert.equal(body.user.id, 'USR-ADMIN');
  assert.ok(Array.isArray(body.accounts));
  assert.ok(Array.isArray(body.notifications));
  assert.ok(Array.isArray(body.users));
});

test('bootstrap projects each requested section without unrelated payload fields', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  for (const section of Object.keys(SECTION_FIELDS)) {
    const { response, body } = await getJson(
      fx,
      `/api/sales-crm/bootstrap?sections=${encodeURIComponent(section)}`,
    );
    assert.equal(response.status, 200, section);
    assert.deepEqual(Object.keys(body).sort(), expectedFields(section), section);
  }
});

test('bootstrap combines, de-duplicates, and accepts repeated section parameters', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const { response, body } = await getJson(
    fx,
    '/api/sales-crm/bootstrap?sections=core,customers&sections=today,core',
  );
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), expectedFields('core', 'customers', 'today'));
  assert.equal(body.user.id, 'USR-ADMIN');
  assert.ok(body.accounts.some(account => account.id === 'CRM-WU'));
});

test('bootstrap rejects empty and unknown sections with a stable 400 error', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  for (const route of [
    '/api/sales-crm/bootstrap?sections=',
    '/api/sales-crm/bootstrap?sections=core,unknown',
  ]) {
    const { response, body } = await getJson(fx, route);
    assert.equal(response.status, 400, route);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'INVALID_BOOTSTRAP_SECTIONS');
  }
});

test('scoped bootstrap keeps existing permission and contact redaction', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { view_contacts: false, view_customers: true });

  const { response, body } = await (async () => {
    const result = await fx.request('/api/sales-crm/bootstrap?sections=customers', {
      cookie: fx.otherCookie,
    });
    return { response: result, body: await result.json() };
  })();

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), expectedFields('customers'));
  assert.doesNotMatch(JSON.stringify(body), /person@secret\.test|\+7-secret/);
});
