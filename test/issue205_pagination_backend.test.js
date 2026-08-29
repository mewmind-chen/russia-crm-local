'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');
const { createAIJobStore } = require('../lib/ai_stations/jobs');

async function adminFixture(t, options = {}) {
  const previousGate = process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'true';
  const fx = await fixtures.adminFixture(options);
  t.after(async () => {
    await fx.close();
    if (previousGate === undefined) delete process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
    else process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = previousGate;
  });
  return fx;
}

test('protected-customer list paginates while its export remains the full filtered result', async t => {
  const fx = await adminFixture(t);
  await fx.requestJson('/api/sales-crm/protected-customers', { cookie: fx.adminCookie });
  fx.db.prepare(`INSERT INTO crm_protected_customer_batches
    (batch_id,idempotency_key,input_hash,status,created_by,created_at,committed_at)
    VALUES ('PCB-205','issue-205-protected','hash-205','committed','USR-ADMIN',
      '2026-08-03 00:00:00','2026-08-03 00:00:00')`).run();
  const insert = fx.db.prepare(`INSERT INTO crm_protected_customers
    (external_customer_id,normalized_name,alpha_nickname,batch_id,status,created_by,created_at,updated_at)
    VALUES (?,?,?,'PCB-205','protected','USR-ADMIN','2026-08-03 00:00:00','2026-08-03 00:00:00')`);
  for (let index = 0; index < 55; index += 1) {
    const suffix = String(index).padStart(2, '0');
    insert.run(`ZZ-${2000 + index}`, `issue 205 protected ${suffix}`, `Issue 205 Protected ${suffix}`);
  }

  const first = await fx.requestJson(
    '/api/sales-crm/protected-customers?page=1&pageSize=50',
    { cookie: fx.adminCookie },
  );
  const second = await fx.requestJson(
    '/api/sales-crm/protected-customers?page=2&pageSize=50',
    { cookie: fx.adminCookie },
  );
  assert.equal(first.page, 1);
  assert.equal(first.pageSize, 50);
  assert.equal(first.total, 55);
  assert.equal(first.totalPages, 2);
  assert.equal(first.items.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 5);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.externalCustomerId)).size, 55);

  const exported = await fx.request('/api/sales-crm/protected-customers/export', {
    cookie: fx.adminCookie,
  });
  assert.equal(exported.status, 200);
  assert.equal((await exported.text()).trim().split(/\r?\n/).length, 56);
});

test('protected identity conflicts support 50 and 100 row pages with a 50 row default', async t => {
  const fx = await adminFixture(t);
  const insert = fx.db.prepare('INSERT INTO customer_pool(customer_id,company_name,nickname) VALUES (?,?,?)');
  for (let index = 0; index < 51; index += 1) {
    const suffix = String(index).padStart(2, '0');
    const nickname = `Issue 205 Conflict ${suffix}`;
    insert.run(`ZZ-${3000 + index * 2}`, `Conflict ${suffix} A`, nickname);
    insert.run(`ZZ-${3001 + index * 2}`, `Conflict ${suffix} B`, nickname);
  }

  const base = '/api/sales-crm/protected-customer-conflicts?status=unresolved';
  const first = await fx.requestJson(`${base}&page=1`, { cookie: fx.adminCookie });
  const second = await fx.requestJson(`${base}&page=2`, { cookie: fx.adminCookie });
  assert.equal(first.pageSize, 50);
  assert.equal(first.total, 51);
  assert.equal(first.totalPages, 2);
  assert.equal(first.items.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 1);
  assert.equal(second.hasMore, false);

  const all = await fx.requestJson(`${base}&page=1&pageSize=100`, { cookie: fx.adminCookie });
  assert.equal(all.pageSize, 100);
  assert.equal(all.totalPages, 1);
  assert.equal(all.items.length, 51);
  assert.equal(all.hasMore, false);
});

test('AI task center defaults to 50 rows and returns hasMore without weakening scope', async t => {
  const fx = await adminFixture(t, {
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  for (let index = 0; index < 51; index += 1) {
    const taskId = `AIJ-205-${String(index).padStart(2, '0')}`;
    createAIJobStore(fx.db, { idFactory: () => taskId }).enqueue({
      customerId: 'RU-9002',
      crmAccountId: 'CRM-OWN',
      station: 'customer_fit',
      contextHash: String(index).padStart(64, '0'),
      payload: {},
      createdBy: 'U-MGR',
    }, `issue-205:${index}`);
  }

  const route = '/api/sales-crm/ai/tasks?type=customer_fit';
  const first = await fx.requestJson(route, { cookie: fx.adminCookie });
  const second = await fx.requestJson(`${route}&page=2`, { cookie: fx.adminCookie });
  assert.equal(first.pageSize, 50);
  assert.equal(first.total, 51);
  assert.equal(first.totalPages, 2);
  assert.equal(first.items.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 1);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.taskId)).size, 51);
});

test('team progress drilldown returns only the requested server page', async t => {
  const fx = await adminFixture(t);
  const insert = fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,created_at,updated_at)
    VALUES (?,?,?,?,?,'2026-08-01 00:00:00','2026-08-03 00:00:00')`);
  for (let index = 0; index < 55; index += 1) {
    const suffix = String(index).padStart(2, '0');
    insert.run(`CRM-205-${suffix}`, `EXT-205-${suffix}`, `Issue 205 Team ${suffix}`,
      'USR-ADMIN', 'new');
  }
  const filters = encodeURIComponent('{}');
  const base = `/api/sales-crm/team-status?range=30d&drilldown=customer&pageSize=50&filters=${filters}`;
  const first = await fx.requestJson(`${base}&page=1`, { cookie: fx.adminCookie });
  const second = await fx.requestJson(`${base}&page=2`, { cookie: fx.adminCookie });
  assert.equal(first.progress.pagination.page, 1);
  assert.equal(first.progress.pagination.pageSize, 50);
  assert.equal(first.progress.pagination.total >= 55, true);
  assert.equal(first.progress.pagination.totalPages, 2);
  assert.equal(first.progress.drilldown.customers.length, 50);
  assert.equal(second.progress.pagination.page, 2);
  assert.equal(second.progress.drilldown.customers.length, first.progress.pagination.total - 50);
  assert.equal(new Set([
    ...first.progress.drilldown.customers,
    ...second.progress.drilldown.customers,
  ].map(row => row.accountId)).size, first.progress.pagination.total);
});

test('offset-paginated intake, research and today-task orderings end in unique keys', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sales_crm.js'), 'utf8');
  const alertsModule = fs.readFileSync(path.join(__dirname, '..', 'lib', 'domains', 'planning', 'alerts.js'), 'utf8');
  assert.match(source, /i\.created_at DESC,i\.match_score DESC,i\.id ASC LIMIT \? OFFSET \?/);
  assert.match(source, /pc\.updated_at DESC,pc\.person_id ASC/);
  assert.match(source, /r\.updated_at DESC,r\.job_id ASC/);
  assert.match(alertsModule, /String\(left\.customerId \|\| ''\)\.localeCompare/);
  assert.match(alertsModule, /String\(left\.intakeItemId \|\| ''\)\.localeCompare/);
  assert.match(alertsModule, /String\(left\.id \|\| ''\)\.localeCompare/);
});
