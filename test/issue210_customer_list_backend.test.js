'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

function envelope(filters = {}) {
  return encodeURIComponent(JSON.stringify(filters));
}

async function customerSchema(fx, cookie = fx.adminCookie) {
  return fx.requestJson('/api/sales-crm/filter-schema/customers', { cookie });
}

function seedSortAccounts(fx) {
  const insertPool = fx.db.prepare(`INSERT INTO customer_pool
    (customer_id,company_name) VALUES (?,?)`);
  const insertAccount = fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,
     manager_required,manager_status,last_activity_at,next_action,next_action_at,
     created_at,updated_at,potential_value,established_year)
    VALUES (?,?,?,'U-WU','qualified','claimed',?,?,?,?,?,?,?,?,?)`);
  const rows = [
    ['CRM-210-A', 'RU-2101', 'Issue210Sort Zeta', 0, '', '2020-01-01 00:00:00', 'Follow', '2020-01-01 00:00:00', '2020-01-01 00:00:00', '2020-01-01 00:00:00', 900, 2001],
    ['CRM-210-B', 'RU-2102', 'Issue210Sort Eta', 0, '', '2021-01-01 00:00:00', 'Follow', '2020-01-01 00:00:00', '2021-01-01 00:00:00', '2021-01-01 00:00:00', 800, 2002],
    ['CRM-210-C', 'RU-2103', 'Issue210Sort Delta', 1, '待介入', '2022-01-01 00:00:00', 'Future', '2099-01-01 00:00:00', '2022-01-01 00:00:00', '2022-01-01 00:00:00', 700, 2003],
    ['CRM-210-D', 'RU-2104', 'Issue210Sort Gamma', 0, '', '', '', '', '2023-01-01 00:00:00', '2023-01-01 00:00:00', 600, 2004],
    ['CRM-210-E', 'RU-2105', 'Issue210Sort Beta', 0, '', '2024-01-01 00:00:00', 'Future', '2099-01-01 00:00:00', '2024-01-01 00:00:00', '2024-01-01 00:00:00', 500, 2005],
    ['CRM-210-F', 'RU-2106', 'Issue210Sort Alpha', 0, '', '2024-01-01 00:00:00', 'Future', '2099-01-01 00:00:00', '2024-01-01 00:00:00', '2024-01-01 00:00:00', 400, 2006],
  ];
  for (const row of rows) {
    insertPool.run(row[1], row[2]);
    insertAccount.run(...row);
  }
}

async function sortedIds(fx, sort) {
  const response = await fx.requestJson(
    `/api/sales-crm/accounts?sort=${sort}&filters=${envelope({
      search: { operator: 'contains', value: 'Issue210Sort' },
    })}`,
    { cookie: fx.adminCookie },
  );
  return response.rows.map(row => row.id);
}

test('Issue 210 implements five strict stable server sorts and rejects the removed amount sort', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedSortAccounts(fx);

  assert.deepEqual(await sortedIds(fx, 'pending_priority'), [
    'CRM-210-A', 'CRM-210-B', 'CRM-210-C', 'CRM-210-D', 'CRM-210-E', 'CRM-210-F',
  ]);
  assert.deepEqual(await sortedIds(fx, 'oldest_activity'), [
    'CRM-210-D', 'CRM-210-A', 'CRM-210-B', 'CRM-210-C', 'CRM-210-E', 'CRM-210-F',
  ]);
  assert.deepEqual(await sortedIds(fx, 'recent_progress'), [
    'CRM-210-E', 'CRM-210-F', 'CRM-210-C', 'CRM-210-B', 'CRM-210-A', 'CRM-210-D',
  ]);
  assert.deepEqual(await sortedIds(fx, 'newest'), [
    'CRM-210-E', 'CRM-210-F', 'CRM-210-D', 'CRM-210-C', 'CRM-210-B', 'CRM-210-A',
  ]);
  assert.deepEqual(await sortedIds(fx, 'company'), [
    'CRM-210-F', 'CRM-210-E', 'CRM-210-C', 'CRM-210-B', 'CRM-210-D', 'CRM-210-A',
  ]);

  const removed = await fx.request('/api/sales-crm/accounts?sort=potential_desc', {
    cookie: fx.adminCookie,
  });
  assert.equal(removed.status, 400);
  assert.equal((await removed.json()).code, 'INVALID_CUSTOMER_SORT');
  const unknownExport = await fx.request('/api/sales-crm/export?sort=potential_desc', {
    cookie: fx.adminCookie,
  });
  assert.equal(unknownExport.status, 400);
});

test('Issue 210 owner and unassigned filters are SQL-backed and remain inside account scope', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET owner_id=NULL,assignment_status='unassigned' WHERE id='CRM-OWN'").run();

  const owned = await fx.requestJson(`/api/sales-crm/accounts?filters=${envelope({
    owner: { operator: 'in', values: ['U-WU'] },
  })}`, { cookie: fx.adminCookie });
  assert.equal(owned.rows.length > 0, true);
  assert.equal(owned.rows.every(row => row.owner_id === 'U-WU'), true);

  const unassigned = await fx.requestJson(`/api/sales-crm/accounts?filters=${envelope({
    owner: { operator: 'in', values: ['__unassigned__'] },
  })}`, { cookie: fx.adminCookie });
  assert.equal(unassigned.rows.some(row => row.id === 'CRM-OWN'), true);
  assert.equal(unassigned.rows.every(row => !row.owner_id), true);

  const forged = await fx.request(`/api/sales-crm/accounts?filters=${envelope({
    owner: { operator: 'in', values: ['U-WU'] },
  })}`, { cookie: fx.otherCookie });
  assert.equal(forged.status, 403);
});

test('Issue 210 filter-scoped bulk assignment is authorized, atomic, capped and audited per customer', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedSortAccounts(fx);
  const schema = await customerSchema(fx);
  const filterScope = {
    permissionVersion: schema.schema.permissionVersion,
    filters: { created_at: { operator: 'between', from: '2024-01-01', to: '2024-01-01' } },
  };
  const assigned = await fx.request('/api/sales-crm/accounts/bulk-assign', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { filterScope, ownerId: 'U-OTHER' },
  });
  assert.equal(assigned.status, 200, await assigned.clone().text());
  assert.equal((await assigned.json()).updated, 2);
  assert.deepEqual(
    fx.db.prepare("SELECT id,owner_id FROM crm_accounts WHERE id IN ('CRM-210-E','CRM-210-F') ORDER BY id").all(),
    [{ id: 'CRM-210-E', owner_id: 'U-OTHER' }, { id: 'CRM-210-F', owner_id: 'U-OTHER' }],
  );
  const audits = fx.db.prepare(`SELECT entity_id,detail_json FROM crm_audit_log
    WHERE action='customer_bulk_assigned' AND entity_id IN ('CRM-210-E','CRM-210-F') ORDER BY entity_id`).all();
  assert.equal(audits.length, 2);
  assert.deepEqual(JSON.parse(audits[0].detail_json), {
    previousOwnerId: 'U-WU', ownerId: 'U-OTHER', batchSize: 2,
  });

  const both = await fx.request('/api/sales-crm/accounts/bulk-assign', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { customerIds: ['CRM-WU'], filterScope, ownerId: 'U-OTHER' },
  });
  assert.equal(both.status, 400);

  const forbidden = await fx.request('/api/sales-crm/accounts/bulk-assign', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { customerIds: ['CRM-OTHER'], ownerId: 'U-OTHER' },
  });
  assert.equal(forbidden.status, 403);

  const tooMany = Array.from({ length: 501 }, (_, index) => `CRM-X-${index}`);
  const capped = await fx.request('/api/sales-crm/accounts/bulk-assign', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { customerIds: tooMany, ownerId: 'U-OTHER' },
  });
  assert.equal(capped.status, 400);
});

test('Issue 210 manager bootstrap exposes assignment candidates without user-directory access', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.cookie });

  assert.equal(bootstrap.user.role, 'manager');
  assert.equal(bootstrap.users.length, 1);
  assert.equal(bootstrap.users[0].id, bootstrap.user.id);
  assert.equal(bootstrap.todayTaskAssignmentCandidates.length > 0, true);
  assert.equal(
    bootstrap.todayTaskAssignmentCandidates.every(candidate => candidate.id && candidate.name),
    true,
  );
});

test('Issue 210 bulk return accepts authorized filter scope and rolls back an out-of-scope explicit batch', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedSortAccounts(fx);
  const schema = await customerSchema(fx);
  const returned = await fx.request('/api/sales-crm/accounts/bulk-return', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      filterScope: {
        permissionVersion: schema.schema.permissionVersion,
        filters: { created_at: { operator: 'between', from: '2024-01-01', to: '2024-01-01' } },
      },
      reason: '重新评估筛选客户',
    },
  });
  assert.equal(returned.status, 200);
  assert.equal((await returned.json()).updated, 2);

  fx.setUserPermissions('U-OTHER', { manage_customer_recycle: true });
  const before = fx.db.prepare("SELECT id,lifecycle_status FROM crm_accounts WHERE id IN ('CRM-OTHER','CRM-WU') ORDER BY id").all();
  const mixed = await fx.request('/api/sales-crm/accounts/bulk-return', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { customerIds: ['CRM-OTHER', 'CRM-WU'], reason: '测试越权原子回滚' },
  });
  assert.equal(mixed.status, 404);
  assert.deepEqual(
    fx.db.prepare("SELECT id,lifecycle_status FROM crm_accounts WHERE id IN ('CRM-OTHER','CRM-WU') ORDER BY id").all(),
    before,
  );
});

test('Issue 210 removes deprecated amount data while preserving established year in list and exports', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET potential_value=98765,established_year=2003 WHERE id='CRM-OWN'").run();
  fx.db.prepare("UPDATE customer_pool SET established_year=2003 WHERE customer_id='RU-9002'").run();

  const list = await fx.requestJson(`/api/sales-crm/accounts?filters=${envelope({
    search: { operator: 'contains', value: 'Owned Fixture' },
  })}`, { cookie: fx.adminCookie });
  assert.equal(list.rows.length, 1);
  assert.equal(Object.hasOwn(list.rows[0], 'potential_value'), false);
  assert.equal(list.rows[0].established_year, 2003);

  const exported = await fx.requestJson('/api/sales-crm/export?search=Owned%20Fixture', {
    cookie: fx.adminCookie,
  });
  assert.equal(exported.customers.length, 1);
  assert.equal(Object.hasOwn(exported.customers[0], 'potential_value'), false);
  assert.equal(exported.customers[0].established_year, 2003);

  const csv = await (await fx.request('/api/sales-crm/export?format=csv&search=Owned%20Fixture', {
    cookie: fx.adminCookie,
  })).text();
  assert.match(csv, /成立年份/);
  assert.match(csv, /2003/);
  assert.doesNotMatch(csv, /潜在金额|98765/);

  const created = await fx.requestJson('/api/sales-crm/accounts', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      companyName: 'Issue210 Amount Ignored', ownerId: '__unassigned__',
      potentialValue: 123456, establishedYear: 2010,
    },
  });
  assert.equal(
    fx.db.prepare('SELECT potential_value FROM crm_accounts WHERE id=?').get(created.customerId).potential_value,
    0,
  );
  await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { potentialValue: 1 },
  });
  assert.equal(
    fx.db.prepare("SELECT potential_value FROM crm_accounts WHERE id='CRM-OWN'").get().potential_value,
    98765,
  );
});
