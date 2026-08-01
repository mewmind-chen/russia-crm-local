'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const {
  findExactDuplicate,
  findFuzzyDuplicateCandidates,
  loadDuplicateCustomerRows,
} = require('../lib/ai_stations/enrichment/dedupe');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      russian_name TEXT NOT NULL DEFAULT '',
      english_name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      lifecycle_status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE crm_protected_customers (
      external_customer_id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
    INSERT INTO customer_pool(customer_id,company_name,website,nickname) VALUES
      ('P-1','Protected Official','https://protected.example','Alpha Hidden'),
      ('W-1','Withdrawn Official','https://withdrawn.example','Alpha Withdrawn'),
      ('A-1','Activated Official','https://activated.example','Alpha Activated'),
      ('N-1','Normal Official','https://normal.example','Normal Alias');
    INSERT INTO crm_accounts(id,external_customer_id,company_name,website,nickname) VALUES
      ('CRM-A','A-1','Activated Official','https://activated.example','Alpha Activated'),
      ('CRM-N','N-1','Normal Official','https://normal.example','Normal Alias');
    INSERT INTO crm_protected_customers(external_customer_id,status) VALUES
      ('P-1','protected'),
      ('W-1','withdrawn'),
      ('A-1','activated');
  `);
  return db;
}

test('ordinary duplicate rows exclude protected and withdrawn customers', t => {
  const db = fixture();
  t.after(() => db.close());

  assert.deepEqual(
    loadDuplicateCustomerRows(db).map(row => row.customer_id),
    ['A-1', 'N-1'],
  );
  assert.deepEqual(
    loadDuplicateCustomerRows(db, { crmOnly: true }).map(row => row.customer_id),
    ['A-1', 'N-1'],
  );
});

test('server-side duplicate checks can explicitly include an unactivated protected customer', t => {
  const db = fixture();
  t.after(() => db.close());

  const rows = loadDuplicateCustomerRows(db, { crmOnly: true, includeProtected: true });
  assert.deepEqual(rows.map(row => row.customer_id), ['A-1', 'N-1', 'P-1']);
  assert.equal(rows.some(row => row.customer_id === 'W-1'), false);
  assert.equal(findExactDuplicate(db, {
    companyName: 'Alpha Hidden',
  }, { crmOnly: true, rows }).isProtected, true);
});

test('protected exact matches expose only a non-sensitive protection flag', t => {
  const db = fixture();
  t.after(() => db.close());

  assert.equal(findExactDuplicate(db, {
    companyName: 'Alpha Hidden',
  }), null);
  const match = findExactDuplicate(db, {
    companyName: 'Alpha Hidden',
  }, { crmOnly: true, includeProtected: true });
  assert.deepEqual(match, {
    customerId: 'P-1',
    crmAccountId: '',
    companyName: '',
    matchedBy: 'name',
    isProtected: true,
  });
  assert.doesNotMatch(JSON.stringify(match), /Alpha Hidden/i);
});

test('protected fuzzy matches redact the Alpha name while normal matches keep their shape', t => {
  const db = fixture();
  t.after(() => db.close());

  const protectedMatch = findFuzzyDuplicateCandidates(db, {
    companyName: 'Alpha Hiddens',
  }, { crmOnly: true, includeProtected: true, threshold: 0.7 })
    .find(row => row.isProtected);
  assert.ok(protectedMatch);
  assert.equal(protectedMatch.companyName, '');
  assert.doesNotMatch(JSON.stringify(protectedMatch), /Alpha Hidden/i);

  assert.deepEqual(findExactDuplicate(db, {
    companyName: 'Normal Alias',
  }), {
    customerId: 'N-1',
    crmAccountId: 'CRM-N',
    companyName: 'Normal Official',
    matchedBy: 'name',
  });
});

test('committed protected customers stay out of every ordinary API and return generic duplicate conflicts', async t => {
  const previousGate = process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'true';
  const fx = await fixtures.adminFixture();
  t.after(async () => {
    await fx.close();
    if (previousGate === undefined) delete process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
    else process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = previousGate;
  });

  fx.setUserPermissions('U-WU', {
    view_development: true,
    view_pool: true,
    view_customers: true,
    create_customer: true,
    view_all_customers: true,
    manage_intake: true,
  });
  fx.setUserPermissions('U-OTHER', {
    view_development: true,
    view_pool: true,
    view_customers: true,
    create_customer: true,
  });

  const alphaNickname = 'Alpha Privacy Sentinel 188';
  const previewResponse = await fx.request('/api/sales-crm/protected-customers/batches/preview', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'privacy-preview-188',
      rows: [{
        alphaNickname,
        companyName: 'Privacy Sentinel Official LLC',
        country: 'Russia',
      }],
    },
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  const commitResponse = await fx.request(
    `/api/sales-crm/protected-customers/batches/${preview.batchId}/commit`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: { idempotencyKey: 'privacy-commit-188' },
    },
  );
  assert.equal(commitResponse.status, 200);
  const committed = await commitResponse.json();
  const externalCustomerId = committed.rows[0].externalCustomerId;
  assert.match(externalCustomerId, /^RU-\d{4}$/);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_accounts
    WHERE external_customer_id=?`).get(externalCustomerId).count, 0);

  const actors = [
    ['admin', fx.adminCookie],
    ['manager', fx.cookie],
    ['sales', fx.otherCookie],
  ];
  const listRoutes = [
    `/api/customers?search=${encodeURIComponent(alphaNickname)}`,
    '/api/initial',
    '/api/sales-crm/bootstrap',
    `/api/sales-crm/research/pool?search=${encodeURIComponent(alphaNickname)}`,
  ];
  for (const [role, cookie] of actors) {
    for (const route of listRoutes) {
      const response = await fx.request(route, { cookie });
      assert.equal(response.status, 200, `${role}:${route}`);
      const text = await response.text();
      assert.equal(text.includes(alphaNickname), false, `${role}:${route}:alpha`);
      assert.equal(text.includes(externalCustomerId), false, `${role}:${route}:customer-id`);
    }
    const profile = await fx.request(`/api/sales-crm/profile/${externalCustomerId}`, { cookie });
    assert.ok([403, 404].includes(profile.status), `${role}:profile:${profile.status}`);
    const profileText = await profile.text();
    assert.equal(profileText.includes(alphaNickname), false, `${role}:profile:alpha`);
    assert.equal(profileText.includes(externalCustomerId), false, `${role}:profile:customer-id`);
  }

  const scanResponse = await fx.request('/api/sales-crm/intake/scan', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { force: true },
  });
  assert.equal(scanResponse.status, 200);
  const scanText = await scanResponse.text();
  assert.equal(scanText.includes(alphaNickname), false);
  assert.equal(scanText.includes(externalCustomerId), false);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_intake_items
    WHERE external_customer_id=?`).get(externalCustomerId).count, 0);

  for (const [role, cookie] of actors) {
    const duplicateResponse = await fx.request('/api/sales-crm/accounts', {
      cookie,
      method: 'POST',
      body: {
        companyName: alphaNickname,
        country: 'Russia',
        ownerId: role === 'sales' ? 'U-OTHER' : '__unassigned__',
      },
    });
    assert.equal(duplicateResponse.status, 409, `${role}:duplicate`);
    const duplicateText = await duplicateResponse.text();
    const duplicateBody = JSON.parse(duplicateText);
    assert.equal(duplicateBody.code, 'CUSTOMER_DUPLICATE', `${role}:duplicate-code`);
    assert.equal(duplicateText.includes(alphaNickname), false, `${role}:duplicate-alpha`);
    assert.equal(duplicateText.includes(externalCustomerId), false, `${role}:duplicate-customer-id`);
    assert.doesNotMatch(duplicateText, /protected|alpha|保护名单|合作客户/i, `${role}:duplicate-generic`);
  }
});
