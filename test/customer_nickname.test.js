const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture, seededFixture } = require('./helpers/permission_fixture');

test('nickname migration, validation, permission and audit rules are enforced', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const column = fx.db.prepare("PRAGMA table_info(crm_accounts)").all()
    .find(item => item.name === 'nickname');
  assert.equal(column.notnull, 1);
  assert.equal(column.dflt_value, "''");

  const updated = await fx.requestJson('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.adminCookie, method: 'PATCH', body: { nickname: '  北方重点客户  ' },
  });
  assert.equal(updated.nickname, '北方重点客户');
  assert.equal(
    fx.db.prepare("SELECT nickname FROM crm_accounts WHERE id='CRM-WU'").get().nickname,
    '北方重点客户',
  );

  const audit = fx.db.prepare(`SELECT user_id,entity_id,detail_json FROM crm_audit_log
    WHERE action='customer_nickname_updated' AND entity_id='CRM-WU'
    ORDER BY created_at DESC,id DESC LIMIT 1`).get();
  assert.equal(audit.user_id, 'USR-ADMIN');
  assert.equal(audit.entity_id, 'CRM-WU');
  assert.deepEqual(JSON.parse(audit.detail_json), {
    oldNickname: '',
    newNickname: '北方重点客户',
  });

  for (const nickname of ['   ', '内部\n昵称', '客'.repeat(41)]) {
    const response = await fx.request('/api/sales-crm/accounts/CRM-WU', {
      cookie: fx.adminCookie, method: 'PATCH', body: { nickname },
    });
    assert.equal(response.status, 400, JSON.stringify(nickname));
  }

  const fortyUnicodeCharacters = '😀'.repeat(40);
  const unicode = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.adminCookie, method: 'PATCH', body: { nickname: fortyUnicodeCharacters },
  });
  assert.equal(unicode.status, 200);

  const xssNickname = '<img src=x onerror=alert(1)>';
  const xss = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.adminCookie, method: 'PATCH', body: { nickname: xssNickname },
  });
  assert.equal(xss.status, 200);
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.equal(bootstrap.accounts.find(item => item.id === 'CRM-WU').nickname, xssNickname);

  const denied = await fx.request('/api/sales-crm/accounts/CRM-OTHER', {
    cookie: fx.otherCookie, method: 'PATCH', body: { nickname: '越权昵称' },
  });
  assert.equal(denied.status, 403);
  assert.notEqual(
    fx.db.prepare("SELECT nickname FROM crm_accounts WHERE id='CRM-OTHER'").get().nickname,
    '越权昵称',
  );

  const cleared = await fx.requestJson('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.adminCookie, method: 'PATCH', body: { nickname: '' },
  });
  assert.equal(cleared.nickname, '');
});

test('nickname search preserves row scope and JSON/CSV exports separate official names', async t => {
  const fx = await seededFixture({
    managerViewAll: false,
    permissions: { export_data: true, view_customers: true },
  });
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET nickname='共享代号' WHERE id IN ('CRM-OWN','CRM-OTHER')").run();

  const response = await fx.request('/api/sales-crm/export?search=%E5%85%B1%E4%BA%AB%E4%BB%A3%E5%8F%B7', {
    cookie: fx.cookie,
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.customers.map(item => item.id), ['CRM-OWN']);
  assert.equal(payload.customers[0].nickname, '共享代号');
  assert.equal(payload.customers[0].company_name, 'Owned Fixture');

  const officialNameSearch = await fx.request('/api/sales-crm/export?search=Owned%20Fixture', {
    cookie: fx.cookie,
  });
  assert.deepEqual(
    (await officialNameSearch.json()).customers.map(item => item.id),
    ['CRM-OWN'],
  );

  const csvResponse = await fx.request('/api/sales-crm/export?format=csv&search=%E5%85%B1%E4%BA%AB%E4%BB%A3%E5%8F%B7', {
    cookie: fx.cookie,
  });
  const csv = await csvResponse.text();
  assert.match(csv, /^昵称,正式名称,本地名称\/别名,英文名称,客户编码,/);
  assert.match(csv, /共享代号,Owned Fixture,,,RU-9002/);
  assert.doesNotMatch(csv, /Other Fixture/);
});

test('nickname survives return, reassignment, trash and restore workflows', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { manage_customer_recycle: true });
  fx.db.prepare("UPDATE crm_accounts SET nickname='长期合作方' WHERE id='CRM-OTHER'").run();

  assert.equal((await fx.request('/api/sales-crm/accounts/CRM-OTHER/return', {
    cookie: fx.otherCookie, method: 'POST', body: { reason: '区域策略调整' },
  })).status, 200);
  assert.equal(
    fx.db.prepare("SELECT nickname FROM crm_accounts WHERE id='CRM-OTHER'").get().nickname,
    '长期合作方',
  );

  const recycleBin = await fx.requestJson(
    '/api/sales-crm/accounts/recycle-bin?kind=sales_return&search=%E9%95%BF%E6%9C%9F%E5%90%88%E4%BD%9C%E6%96%B9',
    { cookie: fx.adminCookie },
  );
  assert.equal(recycleBin.rows.length, 0);

  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-9003',crm_customer_id='CRM-OTHER',
    status='returned',assigned_owner_id='' WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET external_customer_id='RU-9003',intake_item_id='INTAKE-OTHER'
    WHERE id='CRM-OTHER'`).run();
  assert.equal((await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie, method: 'POST',
    body: { action: 'assign', itemId: 'INTAKE-OTHER', ownerId: 'U-OTHER' },
  })).status, 200);
  assert.equal(
    fx.db.prepare("SELECT nickname FROM crm_accounts WHERE id='CRM-OTHER'").get().nickname,
    '长期合作方',
  );

  const created = await fx.requestJson('/api/sales-crm/accounts', {
    cookie: fx.adminCookie, method: 'POST',
    body: { companyName: 'Manual Nickname Fixture', country: '俄罗斯', ownerId: 'U-OTHER' },
  });
  fx.db.prepare("UPDATE crm_accounts SET nickname='手工客户昵称' WHERE id=?").run(created.customerId);
  assert.equal((await fx.request(`/api/sales-crm/accounts/${created.customerId}/trash`, {
    cookie: fx.adminCookie, method: 'POST', body: { reason: '验证昵称保留' },
  })).status, 200);
  assert.equal((await fx.request(`/api/sales-crm/accounts/${created.customerId}/restore`, {
    cookie: fx.adminCookie, method: 'POST', body: {},
  })).status, 200);
  assert.equal(
    fx.db.prepare('SELECT nickname FROM crm_accounts WHERE id=?').get(created.customerId).nickname,
    '手工客户昵称',
  );
});

test('nickname UI uses escaped display helpers across primary CRM entry points', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');

  assert.match(app, /function accountDisplayName\(account\)/);
  assert.match(app, /esc\(accountDisplayName\(account\)\)/);
  assert.match(app, /esc\(accountIdentity\(account\)\)/);
  assert.match(app, /function renderCustomerProfileHeader\(\)/);
  assert.match(app, /function openNicknameModal\(customerId\)/);
  assert.match(html, /id="drawerNicknameBtn"/);
  assert.match(html, /id="customerProfileDataEdit"/);
  assert.match(app, /data-clear-nickname/);
  assert.match(app, /nicknameForm/);
  assert.match(app, /function activityCustomerDisplayName\(customer\)/);
  assert.match(app, /activityCustomerDisplayName\(customer\)/);
  assert.match(app, /activityCustomerIdentity\(customer\)/);
  assert.match(app, /renderRecycleBin[\s\S]*accountDisplayName\(row\)/);
  assert.match(app, /renderPipeline[\s\S]*accountDisplayName\(account\)/);
  assert.match(app, /renderAlerts[\s\S]*accountDisplayName\(account\)/);
  assert.match(app, /renderNotifications[\s\S]*accountDisplayName\(account\)/);
  assert.match(html, /id="customerProfileIdentity"/);
});
