'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const {
  auditProtectedCustomerIdentities,
  leadIdentityWarningsForExternalCustomerIds,
} = require('../lib/customer_identity_registry');

const ROOT = path.join(__dirname, '..');
const RESOLUTION_SCRIPT = path.join(ROOT, 'scripts', 'resolve-protected-customer-identities.js');

function installSources(db) {
  db.exec(`
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );
  `);
}

test('lead-only and lead-to-CRM name collisions are warnings while two CRM owners still block', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  installSources(db);
  db.exec(`
    INSERT INTO customer_pool(customer_id,company_name) VALUES
      ('LEAD-1','Lead Shared'),
      ('LEAD-2','Lead Shared'),
      ('CRM-1','Mixed Shared'),
      ('LEAD-3','Mixed Shared'),
      ('CRM-2','CRM Shared'),
      ('CRM-3','CRM Shared');
    INSERT INTO crm_accounts(id,external_customer_id,company_name) VALUES
      ('ACCOUNT-1','CRM-1','Mixed Shared'),
      ('ACCOUNT-2','CRM-2','CRM Shared'),
      ('ACCOUNT-3','CRM-3','CRM Shared');
  `);

  const report = auditProtectedCustomerIdentities(db);
  const byName = new Map(report.conflicts.map(item => [item.normalizedName, item]));

  assert.equal(byName.get('lead shared').disposition, 'lead_warning');
  assert.deepEqual(byName.get('lead shared').leadExternalCustomerIds, ['LEAD-1', 'LEAD-2']);
  assert.deepEqual(byName.get('lead shared').crmExternalCustomerIds, []);
  assert.equal(byName.get('mixed shared').disposition, 'lead_warning');
  assert.deepEqual(byName.get('mixed shared').leadExternalCustomerIds, ['LEAD-3']);
  assert.deepEqual(byName.get('mixed shared').crmExternalCustomerIds, ['CRM-1']);
  assert.equal(byName.get('crm shared').disposition, 'blocking');
  assert.equal(report.unresolved, 3);
  assert.equal(report.leadWarnings, 2);
  assert.equal(report.blockingUnresolved, 1);
  assert.equal(report.canEnter172B, false);

  const warnings = leadIdentityWarningsForExternalCustomerIds(db, ['LEAD-2', 'CRM-1', 'CRM-2']);
  assert.equal(warnings.get('LEAD-2').code, 'LEAD_IDENTITY_REVIEW_REQUIRED');
  assert.equal(warnings.get('CRM-1'), undefined);
  assert.equal(warnings.get('CRM-2'), undefined);
});

test('lead warning is visible without candidate disclosure and blocks claim until the name changes', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const now = '2026-08-01 08:00:00';
  fx.db.prepare('INSERT INTO customer_pool(customer_id,company_name) VALUES (?,?)')
    .run('RU-9104', 'Same Lead Name');
  fx.db.prepare('INSERT INTO customer_pool(customer_id,company_name) VALUES (?,?)')
    .run('RU-9105', 'Same Lead Name');
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,
     assigned_at,claim_due_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    'INTAKE-WARN-1',
    'BATCH-TEST',
    'RU-9104',
    'Same Lead Name',
    'assigned',
    'U-OTHER',
    now,
    '2026-08-02 08:00:00',
    now,
    now,
  );

  const listedResponse = await fx.request('/api/sales-crm/intake?status=assigned', {
    cookie: fx.otherCookie,
  });
  assert.equal(listedResponse.status, 200);
  const listed = await listedResponse.json();
  const item = listed.items.find(row => row.id === 'INTAKE-WARN-1');
  assert.deepEqual(item.identityWarning, {
    active: true,
    code: 'LEAD_IDENTITY_REVIEW_REQUIRED',
    label: '名称待核验',
    message: '疑似同名线索，进入 CRM 前需管理员核验',
  });
  assert.equal(JSON.stringify(item).includes('RU-9105'), false);

  const adminConflicts = await fx.request('/api/sales-crm/protected-customer-conflicts', {
    cookie: fx.adminCookie,
  });
  assert.equal(adminConflicts.status, 200);
  const adminBody = await adminConflicts.json();
  assert.equal(adminBody.unresolved, 1);
  assert.equal(adminBody.leadWarnings, 1);
  assert.equal(adminBody.blockingUnresolved, 0);
  assert.equal(adminBody.canEnter172B, true);
  assert.equal(adminBody.items[0].disposition, 'lead_warning');
  assert.deepEqual(adminBody.items[0].leadExternalCustomerIds, ['RU-9104', 'RU-9105']);

  const blocked = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      action: 'claim',
      itemId: 'INTAKE-WARN-1',
      idempotencyKey: 'claim-warning-1',
    },
  });
  assert.equal(blocked.status, 409);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.code, 'LEAD_IDENTITY_REVIEW_REQUIRED');
  assert.equal(JSON.stringify(blockedBody).includes('RU-9105'), false);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_accounts
    WHERE external_customer_id='RU-9104'`).get().count, 0);

  fx.db.prepare(`UPDATE customer_pool SET company_name='Distinct Lead Name'
    WHERE customer_id='RU-9105'`).run();
  const claimed = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      action: 'claim',
      itemId: 'INTAKE-WARN-1',
      idempotencyKey: 'claim-warning-2',
    },
  });
  assert.equal(claimed.status, 200, await claimed.text());
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_accounts
    WHERE external_customer_id='RU-9104'`).get().count, 1);
});

test('CLI keeps lead warnings auditable without blocking the 172-B gate', t => {
  const directory = fs.mkdtempSync(path.join(
    fs.realpathSync.native(os.tmpdir()),
    'issue184-lead-warning-',
  ));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const databasePath = path.join(directory, 'snapshot.db');
  const db = new Database(databasePath);
  installSources(db);
  db.exec(`INSERT INTO customer_pool(customer_id,company_name) VALUES
    ('RU-9201','CLI Shared Lead'),('RU-9202','CLI Shared Lead')`);
  const item = auditProtectedCustomerIdentities(db).conflicts[0];
  db.close();

  const result = spawnSync(process.execPath, [
    RESOLUTION_SCRIPT,
    '--db', databasePath,
    '--conflict-id', item.conflictId,
    '--decision', 'supplement_and_retry',
    '--expected-version', item.expectedVersion,
    '--details', '线索阶段名称待后续核验',
    '--apply',
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.gate.unresolved, 1);
  assert.equal(output.gate.leadWarnings, 1);
  assert.equal(output.gate.blockingUnresolved, 0);
  assert.equal(output.gate.canEnter172B, true);
});

test('lead pool and profile header render the generic warning marker', () => {
  const source = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
  assert.match(source, /item\.identityWarning\?\.active/);
  assert.match(source, /lead\?\.identityWarning\?\.active/);
  assert.match(source, /疑似同名线索，进入 CRM 前需管理员核验/);
});
