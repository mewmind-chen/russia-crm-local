'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');
const { redactExportCredentials } = require('../lib/access_control');

const ROOT = path.resolve(__dirname, '..');
const salesCrmSource = fs.readFileSync(path.join(ROOT, 'lib', 'sales_crm.js'), 'utf8');
const accessControlSource = fs.readFileSync(path.join(ROOT, 'lib', 'access_control.js'), 'utf8');

const CREDENTIAL_KEY = /^(?:password|passwords|passwordhash|passwordsalt|passwd|passphrase|passhash|passsalt|token|tokens|tokenhash|accesstoken|refreshtoken|csrftoken|session|sessions|sessionid|sessionhash|sessiontoken|salessessions|secret|secrets|secretkey|clientsecret|apisecret|apikey|apikeys|privatekey|encryptionkey|credential|credentials|authorization|cookie|cookies|salt|previewtoken|previewtokenhash|(?:password|passwd|passphrase|token|session|secret|credential|authorization|cookie)(?:s|hash|salt|token|secret|key|value|id|json|metadata|data)+)$/i;

function parseJsonContainer(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const isJsonContainer = (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!isJsonContainer) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function collectKeys(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => collectKeys(child, `${prefix}[${index}]`));
  }
  const parsed = parseJsonContainer(value);
  if (parsed) return collectKeys(parsed, prefix);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const current = prefix ? `${prefix}.${key}` : key;
    return [current, ...collectKeys(child, current)];
  });
}

function assertNoCredentialKeys(value, label) {
  const leaked = collectKeys(value).filter(key => {
    const leaf = key.split('.').pop().replace(/\[\d+\]$/, '');
    return CREDENTIAL_KEY.test(leaf);
  });
  assert.deepEqual(leaked, [], `${label} leaked credential keys: ${leaked.join(', ')}`);
}

function seedExportCredentialFixtures(fx) {
  const now = '2026-09-02 09:00:00';
  fx.db.prepare(`UPDATE sales_users SET password_hash=?,password_salt=?`).run(
    'S5_PASSWORD_HASH_SENTINEL',
    'S5_PASSWORD_SALT_SENTINEL',
  );
  fx.db.exec("ALTER TABLE crm_activities ADD COLUMN metadata_json TEXT NOT NULL DEFAULT ''");
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,summary,occurred_at,created_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    'ACT-S5-CREDENTIAL',
    'CRM-WU',
    'U-WU',
    'note',
    'S5 legal activity',
    now,
    now,
    JSON.stringify({
      publicNote: 'preserve this business metadata',
      nested: {
        password_hash: 'S5_NESTED_PASSWORD',
        apiKey: 'S5_NESTED_API_KEY',
        safe: 'preserve-safe-value',
        tokenCount: 2,
        secretary: 'preserve-secretary',
      },
      encodedPayload: JSON.stringify({
        session_token: 'S5_DOUBLE_ENCODED_SESSION',
        safe: 'preserve-encoded-safe-value',
      }),
    }),
  );
  fx.db.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,reference,received_at,created_at)
    VALUES (?,?,?,?,?,?)`).run('RFQ-S5', 'CRM-WU', 'U-WU', 'S5-RFQ', now, now);
  fx.db.prepare(`INSERT INTO crm_quotes
    (id,rfq_id,customer_id,user_id,amount,sent_at,created_at)
    VALUES (?,?,?,?,?,?,?)`).run('QUOTE-S5', 'RFQ-S5', 'CRM-WU', 'U-WU', 1234, now, now);
  fx.db.prepare(`INSERT INTO crm_orders
    (id,customer_id,user_id,amount,ordered_at,created_at)
    VALUES (?,?,?,?,?,?)`).run('ORDER-S5', 'CRM-WU', 'U-WU', 2345, now, now);
}

test('export credential projection removes credential keys recursively, including JSON text fields', () => {
  const input = {
    password_hash: 'hash',
    passwordSalt: 'salt',
    token_hash: 'token',
    nested: {
      sessionToken: 'session',
      client_secret: 'secret',
      apiKey: 'api-key',
      tokenCount: 2,
      secretary: 'keep',
    },
    metadata_json: JSON.stringify({
      credentials: { password: 'nested-password' },
      safe: 'keep',
      nested: [{ refresh_token: 'refresh', value: 'keep' }],
      encoded: JSON.stringify({ session_token: 'double-encoded-session', safe: 'keep' }),
    }),
  };
  const projected = redactExportCredentials(input);

  assert.equal(projected.password_hash, undefined);
  assert.equal(projected.passwordSalt, undefined);
  assert.equal(projected.token_hash, undefined);
  assert.equal(projected.nested.sessionToken, undefined);
  assert.equal(projected.nested.client_secret, undefined);
  assert.equal(projected.nested.apiKey, undefined);
  assert.equal(projected.nested.tokenCount, 2);
  assert.equal(projected.nested.secretary, 'keep');
  assert.deepEqual(JSON.parse(projected.metadata_json), {
    safe: 'keep',
    nested: [{ value: 'keep' }],
    encoded: JSON.stringify({ safe: 'keep' }),
  });
  assert.equal(input.nested.client_secret, 'secret', 'projection must not mutate source data');
});

test('admin JSON and CSV exports preserve legal business fields and never expose credentials', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: false } },
  });
  t.after(() => fx.close());
  seedExportCredentialFixtures(fx);

  const jsonResponse = await fx.request('/api/sales-crm/export', { cookie: fx.adminCookie });
  assert.equal(jsonResponse.status, 200);
  const jsonText = await jsonResponse.text();
  const payload = JSON.parse(jsonText);
  assertNoCredentialKeys(payload, 'admin JSON export');
  for (const sentinel of [
    'S5_PASSWORD_HASH_SENTINEL',
    'S5_PASSWORD_SALT_SENTINEL',
    'S5_NESTED_PASSWORD',
    'S5_NESTED_API_KEY',
    'S5_DOUBLE_ENCODED_SESSION',
  ]) assert.equal(jsonText.includes(sentinel), false, `JSON leaked ${sentinel}`);
  assert.equal(payload.users.some(user => user.id === 'USR-ADMIN'), true);
  assert.equal(payload.customers.some(customer => customer.id === 'CRM-WU'), true);
  assert.equal(payload.activities.some(activity => activity.id === 'ACT-S5-CREDENTIAL'), true);
  assert.equal(payload.rfqs.some(row => row.reference === 'S5-RFQ'), true);
  assert.equal(payload.quotes.some(row => row.id === 'QUOTE-S5' && row.amount === 1234), true);
  assert.equal(payload.orders.some(row => row.id === 'ORDER-S5' && row.amount === 2345), true);
  const metadata = JSON.parse(payload.activities.find(row => row.id === 'ACT-S5-CREDENTIAL').metadata_json);
  assert.deepEqual(metadata.nested, {
    safe: 'preserve-safe-value',
    tokenCount: 2,
    secretary: 'preserve-secretary',
  });
  assert.equal(
    metadata.encodedPayload,
    JSON.stringify({ safe: 'preserve-encoded-safe-value' }),
  );

  const customersCsvResponse = await fx.request('/api/sales-crm/export?format=csv', {
    cookie: fx.adminCookie,
  });
  assert.equal(customersCsvResponse.status, 200);
  const customersCsv = await customersCsvResponse.text();
  assert.match(customersCsv, /客户编码/);
  assert.match(customersCsv, /Wu Fixture/);
  assert.doesNotMatch(customersCsv, /password_hash|password_salt|token_hash|session_token|api_key/i);
  for (const sentinel of ['S5_PASSWORD_HASH_SENTINEL', 'S5_PASSWORD_SALT_SENTINEL']) {
    assert.equal(customersCsv.includes(sentinel), false, `customer CSV leaked ${sentinel}`);
  }

  const activityCsvResponse = await fx.request('/api/sales-crm/export?format=csv&dataset=activities', {
    cookie: fx.adminCookie,
  });
  assert.equal(activityCsvResponse.status, 200);
  const activityCsv = await activityCsvResponse.text();
  assert.match(activityCsv, /S5 legal activity/);
  assert.doesNotMatch(activityCsv, /password_hash|password_salt|token_hash|session_token|api_key/i);
  assert.doesNotMatch(activityCsv, /S5_NESTED_PASSWORD|S5_NESTED_API_KEY|S5_DOUBLE_ENCODED_SESSION/);
});

test('authorized non-admin JSON/CSV exports keep scope and business fields while credentials stay absent', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: false } },
  });
  t.after(() => fx.close());
  seedExportCredentialFixtures(fx);
  fx.setUserPermissions('U-WU', {
    export_data: true,
    view_customers: true,
    view_all_customers: false,
    view_contacts: false,
  });

  const jsonResponse = await fx.request('/api/sales-crm/export', { cookie: fx.cookie });
  assert.equal(jsonResponse.status, 200);
  const jsonText = await jsonResponse.text();
  const payload = JSON.parse(jsonText);
  assertNoCredentialKeys(payload, 'manager JSON export');
  assert.deepEqual(payload.users, []);
  assert.deepEqual(payload.contacts, []);
  assert.deepEqual(payload.customers.map(row => row.id), ['CRM-WU']);
  assert.equal(payload.rfqs.some(row => row.reference === 'S5-RFQ'), true);
  assert.equal(payload.quotes.some(row => row.id === 'QUOTE-S5'), true);
  assert.equal(payload.orders.some(row => row.id === 'ORDER-S5'), true);
  assert.equal(jsonText.includes('S5_PASSWORD_HASH_SENTINEL'), false);
  assert.equal(jsonText.includes('S5_NESTED_PASSWORD'), false);
  assert.equal(jsonText.includes('S5_NESTED_API_KEY'), false);

  const csvResponse = await fx.request('/api/sales-crm/export?format=csv', { cookie: fx.cookie });
  assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text();
  assert.match(csv, /Wu Fixture/);
  assert.doesNotMatch(csv, /Owned Fixture|Other Fixture/);
  assert.doesNotMatch(csv, /password_hash|password_salt|token_hash|session_token|api_key/i);
});

test('empty scoped export stays empty in JSON/CSV and export permission remains enforced', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: false } },
  });
  t.after(() => fx.close());
  seedExportCredentialFixtures(fx);
  const created = await fx.requestJson('/api/sales-crm/users', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      email: 's5-empty-export@example.com',
      name: 'S5 Empty Export',
      role: 'sales',
      permissionGroupId: fx.salesGroupId,
      password: 'Password123!',
    },
  });
  fx.setUserPermissions(created.userId, {
    export_data: true,
    view_customers: true,
    view_contacts: false,
  });
  const emptyCookie = await fx.login('s5-empty-export@example.com', 'Password123!');

  const jsonResponse = await fx.request('/api/sales-crm/export', { cookie: emptyCookie });
  assert.equal(jsonResponse.status, 200);
  const jsonText = await jsonResponse.text();
  const payload = JSON.parse(jsonText);
  for (const key of ['customers', 'contacts', 'activities', 'rfqs', 'quotes', 'orders', 'evaluations']) {
    assert.deepEqual(payload[key], [], key);
  }
  assertNoCredentialKeys(payload, 'empty JSON export');
  assert.equal(jsonText.includes('S5_PASSWORD_HASH_SENTINEL'), false);

  const csvResponse = await fx.request('/api/sales-crm/export?format=csv', { cookie: emptyCookie });
  assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text();
  assert.match(csv, /客户编码/);
  assert.doesNotMatch(csv, /Wu Fixture|Owned Fixture|Other Fixture/);
  assert.doesNotMatch(csv, /password_hash|password_salt|token_hash|session_token|api_key/i);

  const forbidden = await fx.request('/api/sales-crm/export', { cookie: fx.otherCookie });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { ok: false, error: '没有权限：export_data' });
});

test('S5 export contract is wired at the aggregate boundary and leaves AI sources untouched', () => {
  assert.match(accessControlSource, /function redactExportCredentials\(/);
  assert.match(accessControlSource, /EXPORT_CREDENTIAL_KEYS/);
  const exportStart = salesCrmSource.indexOf('function exportCrmData(');
  const csvStart = salesCrmSource.indexOf('function exportCrmCsv(', exportStart);
  assert.ok(exportStart >= 0 && csvStart > exportStart);
  const exportSource = salesCrmSource.slice(exportStart, csvStart);
  assert.match(exportSource, /redactExportCredentials\(contactSafePayload\)/);
  assert.match(exportSource, /assertPermission\(user, 'export_data'\)/);
  assert.match(exportSource, /assertPermission\(user, 'view_customers'\)/);
});
