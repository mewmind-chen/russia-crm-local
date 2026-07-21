const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

test('capabilities contain permissions but no business data', async t => {
  assert.equal(typeof fixtures.seededFixture, 'function');
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const cookie = await fx.login('wu@example.com', 'Password123!');
  const response = await fx.request('/api/session/capabilities', { cookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.permissions.view_contacts, false);
  assert.equal(body.modules.includes('contacts'), false);
  assert.equal(JSON.stringify(body).includes('RU-9001'), false);
  assert.equal(JSON.stringify(body).includes('person@secret.test'), false);
});

test('permission changes affect the existing session on the next request', async t => {
  assert.equal(typeof fixtures.seededFixture, 'function');
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const cookie = await fx.login('wu@example.com', 'Password123!');
  assert.equal((await fx.request('/development-workbench', { cookie })).status, 200);
  fx.db.prepare('UPDATE sales_users SET permissions_json=? WHERE email=?')
    .run('{"view_development":false}', 'wu@example.com');
  const response = await fx.request('/development-workbench', { cookie });
  assert.equal(response.status, 403);
});

test('Wu Wei cannot receive contact data through initial or direct contact routes', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const initial = await fx.request('/api/initial', { cookie: fx.cookie });
  assert.equal(initial.status, 200);
  const text = await initial.text();
  for (const secret of ['person@secret.test', '+7-secret', 'Verified Buyer']) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.equal(
    (await fx.request('/api/customers/RU-9001/people', { cookie: fx.cookie })).status,
    403,
  );
  assert.equal(
    (await fx.request('/api/contact-recon/state', { cookie: fx.cookie })).status,
    403,
  );
});

test('each disabled legacy module permission denies its direct API', async () => {
  const cases = [
    ['view_pool', '/api/customers'],
    ['view_recon', '/api/recon/results/JOB-OWN'],
    ['view_intake', '/api/delivery/latest'],
  ];
  for (const [permission, route] of cases) {
    const fx = await fixtures.fixtureWithPermission(permission, false);
    try {
      const response = await fx.request(route, { cookie: fx.cookie });
      assert.equal(response.status, 403, `${permission}: ${route}`);
    } finally {
      await fx.close();
    }
  }
});

test('workbench bootstraps from capabilities without embedded business contacts', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const response = await fx.request('/development-workbench', { cookie: fx.cookie });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /\/api\/session\/capabilities/);
  assert.match(html, /MODULE_PERMISSION/);
  assert.equal(html.includes('sales@chipdip.ru'), false);
  assert.equal(html.includes('+7 (495) 544-00-08'), false);
});
