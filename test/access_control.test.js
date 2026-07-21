const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function accessControl() {
  try { return require('../lib/access_control'); }
  catch (_error) { return {}; }
}

test('view_all_customers false scopes a manager to owned active accounts', () => {
  const { buildAccessContext, assertAccountAccess } = accessControl();
  assert.equal(typeof buildAccessContext, 'function');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE crm_accounts(id TEXT, external_customer_id TEXT, owner_id TEXT, assignment_status TEXT)');
  db.prepare('INSERT INTO crm_accounts VALUES (?,?,?,?)').run('OWN', 'EXT-OWN', 'U1', 'claimed');
  db.prepare('INSERT INTO crm_accounts VALUES (?,?,?,?)').run('RETURNED', 'EXT-RETURNED', 'U1', 'returned');
  db.prepare('INSERT INTO crm_accounts VALUES (?,?,?,?)').run('OTHER', 'EXT-OTHER', 'U2', 'claimed');
  const context = buildAccessContext(db, {
    id: 'U1', role: 'manager', permissions_json: '{"view_all_customers":false}',
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
    id: 'U1', role: 'sales', permissions_json: '{"view_all_customers":true}',
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

test('unknown browser route and action are denied by default', () => {
  const { policyForLegacyRequest } = accessControl();
  assert.equal(typeof policyForLegacyRequest, 'function');
  assert.deepEqual(policyForLegacyRequest('GET', '/unknown', ''), { deny: true });
  assert.deepEqual(policyForLegacyRequest('POST', '/app', 'unknown'), { deny: true });
});
