'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture, seededFixture } = require('./helpers/permission_fixture');
const { installSalesCrm } = require('../lib/sales_crm');

async function responseJson(response) {
  const body = await response.json();
  return { response, body };
}

test('unentered and claimed leads update and clear the canonical master nickname', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name)
    VALUES ('BR-9004','Intake Other Master')`).run();
  fx.setUserPermissions('U-OTHER', { edit_customer: true });

  const created = await responseJson(await fx.request(
    '/api/sales-crm/customers/BR-9004/nickname',
    {
      cookie: fx.otherCookie,
      method: 'PATCH',
      body: { nickname: '  巴西潜力客户  ' },
    },
  ));
  assert.equal(created.response.status, 200);
  assert.deepEqual(created.body.customer, {
    externalCustomerId: 'BR-9004',
    nickname: '巴西潜力客户',
    companyName: 'Intake Other Master',
  });
  assert.equal(
    fx.db.prepare("SELECT nickname FROM customer_pool WHERE customer_id='BR-9004'").get().nickname,
    '巴西潜力客户',
  );
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_accounts WHERE external_customer_id='BR-9004'").get().count,
    0,
  );

  const intake = await fx.requestJson(
    '/api/sales-crm/intake?search=%E5%B7%B4%E8%A5%BF%E6%BD%9C%E5%8A%9B%E5%AE%A2%E6%88%B7',
    { cookie: fx.otherCookie },
  );
  assert.deepEqual(intake.items.map(item => item.id), ['INTAKE-OTHER']);
  assert.equal(intake.items[0].nickname, '巴西潜力客户');
  assert.equal(intake.items[0].company_name, 'Intake Other Master');
  assert.equal(intake.items[0].can_edit_nickname, true);

  const schema = await fx.requestJson('/api/sales-crm/filter-schema/lead_flow', {
    cookie: fx.otherCookie,
  });
  const filters = encodeURIComponent(JSON.stringify({
    search: { operator: 'contains', value: '巴西潜力客户' },
  }));
  const flow = await fx.requestJson(
    `/api/sales-crm/lists/lead_flow?permissionVersion=${schema.schema.permissionVersion}&filters=${filters}`,
    { cookie: fx.otherCookie },
  );
  assert.deepEqual(flow.rows.map(item => item.id), ['INTAKE-OTHER']);
  assert.equal(flow.rows[0].nickname, '巴西潜力客户');
  assert.equal(flow.rows[0].can_edit_nickname, true);

  fx.db.prepare("UPDATE crm_intake_items SET status='claimed' WHERE id='INTAKE-OTHER'").run();
  const modified = await responseJson(await fx.request(
    '/api/sales-crm/customers/BR-9004/nickname',
    {
      cookie: fx.otherCookie,
      method: 'PATCH',
      body: { nickname: '已领取共享昵称' },
    },
  ));
  assert.equal(modified.response.status, 200);
  assert.equal(modified.body.customer.nickname, '已领取共享昵称');

  const cleared = await responseJson(await fx.request(
    '/api/sales-crm/customers/BR-9004/nickname',
    { cookie: fx.otherCookie, method: 'PATCH', body: { nickname: '' } },
  ));
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.body.customer.nickname, '');
  assert.equal(
    fx.db.prepare("SELECT nickname FROM customer_pool WHERE customer_id='BR-9004'").get().nickname,
    '',
  );
});

test('nickname API requires edit permission and the effective user data scope', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name)
    VALUES ('BR-9004','Intake Other Master')`).run();

  const missingPermission = await fx.request(
    '/api/sales-crm/customers/BR-9004/nickname',
    {
      cookie: fx.otherCookie,
      method: 'PATCH',
      body: { nickname: '不应写入' },
    },
  );
  assert.equal(missingPermission.status, 403);

  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  fx.setUserPermissions('U-MGR', {
    view_all_customers: false,
    manage_intake: false,
    edit_customer: true,
  });
  const outsideScope = await fx.request(
    '/api/sales-crm/customers/BR-9004/nickname',
    {
      cookie: managerCookie,
      method: 'PATCH',
      body: { nickname: '仍不应写入' },
    },
  );
  assert.equal(outsideScope.status, 403);
  assert.equal(
    fx.db.prepare("SELECT nickname FROM customer_pool WHERE customer_id='BR-9004'").get().nickname,
    '',
  );
});

test('intake managers can edit unassigned leads visible in their intake scope', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name)
    VALUES ('RU-9010','Unassigned Intake Master')`).run();
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-UNASSIGNED','BATCH-TEST','RU-9010','Unassigned Intake',
      'pending','',datetime('now'),datetime('now'))`).run();
  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  fx.setUserPermissions('U-MGR', {
    view_all_customers: false,
    manage_intake: true,
    edit_customer: true,
  });

  const response = await fx.request(
    '/api/sales-crm/customers/RU-9010/nickname',
    {
      cookie: managerCookie,
      method: 'PATCH',
      body: { nickname: '经理线索范围' },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(
    fx.db.prepare("SELECT nickname FROM customer_pool WHERE customer_id='RU-9010'").get().nickname,
    '经理线索范围',
  );
});

test('inspection evaluates target permissions and records real and effective identities', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name)
    VALUES ('BR-9004','Intake Other Master')`).run();

  await fx.startImpersonation('U-OTHER');
  const denied = await fx.request('/api/sales-crm/customers/BR-9004/nickname', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { nickname: '管理员也不能越过被检查账号权限' },
  });
  assert.equal(denied.status, 403);

  fx.setUserPermissions('U-OTHER', { edit_customer: true });
  const allowed = await fx.request('/api/sales-crm/customers/BR-9004/nickname', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { nickname: '身份检查写入' },
  });
  assert.equal(allowed.status, 200);

  const audit = fx.db.prepare(`SELECT * FROM customer_nickname_audit
    WHERE external_customer_id='BR-9004'
    ORDER BY created_at DESC,rowid DESC LIMIT 1`).get();
  assert.equal(audit.real_user_id, 'USR-ADMIN');
  assert.equal(audit.effective_user_id, 'U-OTHER');
  assert.ok(audit.impersonation_context_id);
  assert.equal(audit.old_nickname, '');
  assert.equal(audit.new_nickname, '身份检查写入');
});

test('legacy account nicknames migrate deterministically with conflict audit and mirror sync', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.exec(`
    DROP TRIGGER IF EXISTS customer_pool_sync_account_nickname_update;
    DROP TRIGGER IF EXISTS crm_accounts_load_master_nickname_insert;
    DROP TRIGGER IF EXISTS crm_accounts_load_master_nickname_relink;
    DROP TRIGGER IF EXISTS crm_accounts_legacy_nickname_write_through;
    DROP INDEX IF EXISTS crm_accounts_external_unique_idx;
    DELETE FROM customer_nickname_migration_audit WHERE external_customer_id='RU-9001';
    UPDATE customer_pool SET nickname='' WHERE customer_id='RU-9001';
    UPDATE crm_accounts SET nickname='旧昵称',updated_at='2026-01-01 00:00:00'
      WHERE id='CRM-WU';
    INSERT INTO crm_accounts
      (id,external_customer_id,company_name,nickname,owner_id,stage,assignment_status,
       created_at,updated_at)
    VALUES
      ('CRM-WU-DUP','RU-9001','Wu Fixture','最新昵称','U-WU','qualified','claimed',
       '2026-02-01 00:00:00','2026-03-01 00:00:00');
  `);

  installSalesCrm();

  assert.equal(
    fx.db.prepare("SELECT nickname FROM customer_pool WHERE customer_id='RU-9001'").get().nickname,
    '最新昵称',
  );
  assert.deepEqual(
    fx.db.prepare(`SELECT DISTINCT nickname FROM crm_accounts
      WHERE external_customer_id='RU-9001'`).all(),
    [{ nickname: '最新昵称' }],
  );
  const migration = fx.db.prepare(`SELECT * FROM customer_nickname_migration_audit
    WHERE external_customer_id='RU-9001'`).get();
  assert.equal(migration.selected_nickname, '最新昵称');
  assert.equal(migration.selected_account_id, 'CRM-WU-DUP');
  assert.equal(migration.resolution_rule, 'latest_updated_then_created_then_account_id');
  assert.equal(migration.had_conflict, 1);
  assert.equal(JSON.parse(migration.candidates_json).length, 2);
  assert.ok(fx.db.prepare(`SELECT 1 FROM crm_audit_log
    WHERE action='customer_nickname_migration_conflict'
      AND entity_id='RU-9001'`).get());
  const auditCount = fx.db.prepare(`SELECT COUNT(*) count
    FROM customer_nickname_migration_audit
    WHERE external_customer_id='RU-9001'`).get().count;
  installSalesCrm();
  assert.equal(
    fx.db.prepare(`SELECT COUNT(*) count
      FROM customer_nickname_migration_audit
      WHERE external_customer_id='RU-9001'`).get().count,
    auditCount,
  );

  fx.db.prepare(`UPDATE crm_accounts SET nickname='旧接口兼容写入',updated_at='2026-04-01 00:00:00'
    WHERE id='CRM-WU'`).run();
  assert.equal(
    fx.db.prepare("SELECT nickname FROM customer_pool WHERE customer_id='RU-9001'").get().nickname,
    '旧接口兼容写入',
  );
  assert.deepEqual(
    fx.db.prepare(`SELECT DISTINCT nickname FROM crm_accounts
      WHERE external_customer_id='RU-9001'`).all(),
    [{ nickname: '旧接口兼容写入' }],
  );
});

test('canonical nickname is searchable in CRM and recycle and exported in separate columns', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { manage_customer_recycle: true });
  fx.db.prepare(`UPDATE customer_pool SET company_name='生命周期正式名称'
    WHERE customer_id='RU-9003'`).run();
  const saved = await fx.request('/api/sales-crm/customers/RU-9003/nickname', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { nickname: '生命周期共享代号' },
  });
  assert.equal(saved.status, 200);

  const schema = await fx.requestJson('/api/sales-crm/filter-schema/customers', {
    cookie: fx.adminCookie,
  });
  const filters = encodeURIComponent(JSON.stringify({
    search: { operator: 'contains', value: '生命周期共享代号' },
  }));
  const accounts = await fx.requestJson(
    `/api/sales-crm/accounts?permissionVersion=${schema.schema.permissionVersion}&filters=${filters}`,
    { cookie: fx.adminCookie },
  );
  assert.deepEqual(accounts.rows.map(item => item.id), ['CRM-OTHER']);
  assert.equal(accounts.rows[0].nickname, '生命周期共享代号');
  assert.equal(accounts.rows[0].company_name, '生命周期正式名称');

  const officialFilters = encodeURIComponent(JSON.stringify({
    search: { operator: 'contains', value: '生命周期正式名称' },
  }));
  const officialAccounts = await fx.requestJson(
    `/api/sales-crm/accounts?permissionVersion=${schema.schema.permissionVersion}&filters=${officialFilters}`,
    { cookie: fx.adminCookie },
  );
  assert.deepEqual(officialAccounts.rows.map(item => item.id), ['CRM-OTHER']);

  const exported = await fx.requestJson(
    '/api/sales-crm/export?search=%E7%94%9F%E5%91%BD%E5%91%A8%E6%9C%9F%E5%85%B1%E4%BA%AB%E4%BB%A3%E5%8F%B7',
    { cookie: fx.adminCookie },
  );
  assert.equal(exported.customers[0].nickname, '生命周期共享代号');
  assert.equal(exported.customers[0].company_name, '生命周期正式名称');
  assert.equal(exported.customers[0].external_customer_id, 'RU-9003');

  const returned = await fx.request('/api/sales-crm/accounts/CRM-OTHER/return', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { reason: '验证生命周期昵称保留' },
  });
  assert.equal(returned.status, 200);
  const recycle = await fx.requestJson(
    '/api/sales-crm/accounts/recycle-bin?kind=sales_return&search=%E7%94%9F%E5%91%BD%E5%91%A8%E6%9C%9F%E5%85%B1%E4%BA%AB%E4%BB%A3%E5%8F%B7',
    { cookie: fx.adminCookie },
  );
  assert.deepEqual(recycle.rows.map(item => item.customerId), []);
  assert.equal(
    fx.db.prepare("SELECT nickname FROM crm_accounts WHERE id='CRM-OTHER'").get().nickname,
    '生命周期共享代号',
  );
  const recycleByOfficialName = await fx.requestJson(
    '/api/sales-crm/accounts/recycle-bin?kind=sales_return&search=%E7%94%9F%E5%91%BD%E5%91%A8%E6%9C%9F%E6%AD%A3%E5%BC%8F%E5%90%8D%E7%A7%B0',
    { cookie: fx.adminCookie },
  );
  assert.deepEqual(recycleByOfficialName.rows.map(item => item.customerId), []);
});

test('nickname search never widens customer scope', async t => {
  const fx = await seededFixture({
    managerViewAll: false,
    permissions: { export_data: true, view_customers: true },
  });
  t.after(() => fx.close());
  fx.db.prepare("UPDATE customer_pool SET nickname='相同共享代号' WHERE customer_id IN ('RU-9002','RU-9003')").run();

  const exported = await (await fx.request(
    '/api/sales-crm/export?search=%E7%9B%B8%E5%90%8C%E5%85%B1%E4%BA%AB%E4%BB%A3%E5%8F%B7',
    { cookie: fx.cookie },
  )).json();
  assert.deepEqual(exported.customers.map(item => item.id), ['CRM-OWN']);

  const pool = await (await fx.request(
    '/api/sales-crm/research/pool?search=%E7%9B%B8%E5%90%8C%E5%85%B1%E4%BA%AB%E4%BB%A3%E5%8F%B7',
    { cookie: fx.cookie },
  )).json();
  assert.deepEqual(pool.rows.map(item => item.customer_id), ['RU-9002']);
  assert.equal(pool.rows[0].nickname, '相同共享代号');
});
