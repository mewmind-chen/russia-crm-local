'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  CLEAR_ONLY_TABLES,
  assertSyncBoundaries,
  copyTable,
  createPrivateBackup,
  createUserMap,
  prepareRowForImport,
  remapUserReferences,
} = require('../scripts/sync-production-customer-data');

test('development sync clears enrichment children before their referenced control-plane rows', () => {
  const events = CLEAR_ONLY_TABLES.indexOf('crm_ai_enrichment_events');
  const links = CLEAR_ONLY_TABLES.indexOf('crm_ai_enrichment_node_links');
  const runs = CLEAR_ONLY_TABLES.indexOf('crm_ai_enrichment_runs');
  const jobs = CLEAR_ONLY_TABLES.indexOf('crm_ai_jobs');
  assert.ok(events >= 0 && links >= 0 && runs >= 0 && jobs >= 0);
  assert.ok(events < links);
  assert.ok(links < runs);
  assert.ok(runs < jobs);
});

function userDatabase(users) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE sales_users(id TEXT PRIMARY KEY,role TEXT,active INTEGER)');
  const insert = db.prepare('INSERT INTO sales_users VALUES (?,?,1)');
  users.forEach(user => insert.run(user.id, user.role));
  return db;
}

test('production identities map by role without copying identity records', () => {
  const source = userDatabase([
    { id: 'PROD-ADMIN', role: 'admin' }, { id: 'PROD-SALES-1', role: 'sales' }, { id: 'PROD-SALES-2', role: 'sales' },
  ]);
  const destination = userDatabase([
    { id: 'DEV-ADMIN', role: 'admin' }, { id: 'DEV-SALES-1', role: 'sales' }, { id: 'DEV-SALES-2', role: 'sales' },
  ]);
  const userMap = createUserMap(source, destination);
  assert.equal(userMap.mapping.get('PROD-ADMIN'), 'DEV-ADMIN');
  assert.equal(userMap.mapping.get('PROD-SALES-1'), 'DEV-SALES-1');
  assert.equal(userMap.mapping.get('PROD-SALES-2'), 'DEV-SALES-2');
  assert.deepEqual(remapUserReferences({ owner_id: 'PROD-SALES-2', created_by: 'PROD-ADMIN' }, userMap), {
    owner_id: 'DEV-SALES-2', created_by: 'DEV-ADMIN',
  });
  source.close();
  destination.close();
});

test('customer grades are staged until Recon rows exist', () => {
  const source = userDatabase([{ id: 'PROD-ADMIN', role: 'admin' }]);
  const destination = userDatabase([{ id: 'DEV-ADMIN', role: 'admin' }]);
  const userMap = createUserMap(source, destination);
  assert.deepEqual(prepareRowForImport({
    customer_id: 'RU-0001', rating: 'A', current_pool: 'A', owner_id: 'PROD-ADMIN',
  }, 'customer_pool', userMap), {
    customer_id: 'RU-0001', rating: '', current_pool: '未分池', owner_id: 'DEV-ADMIN',
  });
  source.close();
  destination.close();
});

test('table copy uses only compatible columns and keeps destination defaults', () => {
  const source = new Database(':memory:');
  const destination = new Database(':memory:');
  source.exec("CREATE TABLE customer_pool(id TEXT PRIMARY KEY,name TEXT,legacy TEXT); INSERT INTO customer_pool VALUES ('1','Acme','old')");
  destination.exec("CREATE TABLE customer_pool(id TEXT PRIMARY KEY,name TEXT,new_field TEXT NOT NULL DEFAULT 'default')");
  const result = copyTable(source, destination, 'customer_pool');
  assert.equal(result.copied, 1);
  assert.deepEqual(destination.prepare('SELECT * FROM customer_pool').get(), { id: '1', name: 'Acme', new_field: 'default' });
  source.close();
  destination.close();
});

test('sync boundaries require a development destination outside production', () => {
  const productionRoot = '/srv/tradepulse-production';
  assert.doesNotThrow(() => assertSyncBoundaries({
    environment: 'development',
    productionRoot,
    sourcePath: '/srv/tradepulse-production/shared/data/crm.db',
    destinationPath: '/srv/tradepulse-development/crm.db',
  }));
  assert.throws(() => assertSyncBoundaries({
    environment: 'development',
    productionRoot,
    sourcePath: '/srv/tradepulse-production/shared/data/crm.db',
    destinationPath: '/srv/tradepulse-production/shared/data/crm.db',
  }), /destination cannot be inside production/);
  assert.throws(() => assertSyncBoundaries({
    environment: 'production',
    productionRoot,
    sourcePath: '/srv/tradepulse-production/shared/data/crm.db',
    destinationPath: '/srv/tradepulse-development/crm.db',
  }), /NODE_ENV=development/);
});

test('database snapshots are restricted to the current user', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-customer-sync-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = new Database(':memory:');
  t.after(() => database.close());
  database.exec('CREATE TABLE customers(id TEXT PRIMARY KEY)');
  const backupPath = path.join(directory, 'snapshot.db');

  await createPrivateBackup(database, backupPath);

  assert.equal(fs.statSync(backupPath).mode & 0o777, 0o600);
  const backup = new Database(backupPath, { readonly: true });
  t.after(() => backup.close());
  assert.equal(backup.prepare('SELECT COUNT(*) count FROM customers').get().count, 0);
});
