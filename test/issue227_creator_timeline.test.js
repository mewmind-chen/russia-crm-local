'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');

test('Issue 227 separates creator, first claimer and current owner', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name,nickname)
    VALUES ('BR-2271','Creator Check','')`).run();
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,duplicate_state,created_at,updated_at)
    VALUES ('I227','BATCH-TEST','BR-2271','Creator Check','assigned','U-OTHER','cleared',?,?)`).run(
    '2026-08-04 08:00:00', '2026-08-04 08:00:00');

  const claim = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'I227', idempotencyKey: 'issue227-claim' },
  });
  assert.equal(claim.status, 200, await claim.clone().text());
  const account = fx.db.prepare('SELECT * FROM crm_accounts WHERE external_customer_id=?').get('BR-2271');
  assert.equal(account.created_by, 'system');
  assert.equal(account.first_claimed_by, 'U-OTHER');
  assert.ok(account.first_claimed_at);
  assert.equal(account.owner_id, 'U-OTHER');
  const profile = await fx.requestJson('/api/sales-crm/intake/I227/profile', {
    cookie: fx.adminCookie,
  });
  assert.equal(profile.customerPool?.[0]?.creatorName, '系统导入');

  const nick = await fx.request('/api/sales-crm/customers/BR-2271/nickname', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { nickname: 'Creator Renamed' },
  });
  assert.equal(nick.status, 200, await nick.clone().text());
  const afterNick = fx.db.prepare(`SELECT created_by,first_claimed_by,first_claimed_at
    FROM crm_accounts WHERE id=?`).get(account.id);
  assert.equal(afterNick.created_by, 'system');
  assert.equal(afterNick.first_claimed_by, 'U-OTHER');
});

test('Issue 227 on-demand history returns Chinese lifecycle events', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET assignment_status='claimed',claimed_at=?,
    first_claimed_by='U-WU',first_claimed_at=? WHERE id='CRM-OWN'`).run(
    '2026-08-04 08:00:00', '2026-08-04 08:00:00');
  fx.db.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
    VALUES ('AUD-227','U-WU','customer_nickname_updated','crm_account','CRM-OWN',
      '{"oldNickname":"旧名","newNickname":"新名"}','2026-08-04 09:00:00','U-WU','U-WU','')`).run();

  const history = await fx.requestJson('/api/sales-crm/accounts/CRM-OWN/history', {
    cookie: fx.adminCookie,
  });
  assert.ok(Array.isArray(history.timeline));
  assert.equal(history.timeline.some(event => event.kind === 'claim' && event.title === '领取客户'), true);
  assert.equal(history.timeline.some(event => event.kind === 'nickname_update'), true);
  const nicknameEvent = history.timeline.find(event => event.kind === 'nickname_update');
  assert.equal(nicknameEvent.title, '修改客户昵称');
  assert.match(nicknameEvent.summary, /Wu修改了客户昵称/);
  assert.deepEqual(nicknameEvent.before, { 昵称: '旧名' });
  assert.deepEqual(nicknameEvent.after, { 昵称: '新名' });

  const forbidden = await fx.request('/api/sales-crm/accounts/CRM-OWN/history', {
    cookie: fx.otherCookie,
  });
  assert.equal(forbidden.status, 403);
});

test('Issue 227 manual accounts keep the original creator', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const created = await fx.requestJson('/api/sales-crm/accounts', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { companyName: 'Manual Creator', ownerId: 'U-OTHER', establishedYear: 2010 },
  });
  const account = fx.db.prepare('SELECT created_by FROM crm_accounts WHERE id=?').get(created.customerId);
  assert.equal(account.created_by, 'USR-ADMIN');
});

test('Issue 227 manual customers keep their creator after return and reclaim', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const accountId = 'CRM-OTHER';
  fx.db.prepare(`UPDATE crm_accounts SET external_customer_id='BR-9004',intake_item_id='INTAKE-OTHER',
    lifecycle_status='recycled',recycle_kind='sales_return',owner_id='U-OTHER',created_by='USR-ADMIN'
    WHERE id=?`).run(accountId);
  assert.equal(
    fx.db.prepare('SELECT created_by FROM crm_accounts WHERE id=?').get(accountId).created_by,
    'USR-ADMIN',
  );

  const claim = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-OTHER', idempotencyKey: 'issue227-manual-reclaim' },
  });
  assert.equal(claim.status, 200, await claim.clone().text());
  const after = fx.db.prepare('SELECT created_by,first_claimed_by FROM crm_accounts WHERE id=?')
    .get(accountId);
  assert.equal(after.created_by, 'USR-ADMIN');
  assert.equal(after.first_claimed_by, 'U-OTHER');
});

test('Issue 227 backfill script is dry-run first, applies once and is idempotent', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue227-backfill-'));
  const dbPath = path.join(dir, 'crm.db');
  const previous = process.env.CRM_DB_PATH;
  process.env.CRM_DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  t.after(() => {
    if (previous === undefined) delete process.env.CRM_DB_PATH;
    else process.env.CRM_DB_PATH = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const { installSalesCrm } = require('../lib/sales_crm');
  const { ensureTables } = require('../lib/db');
  installSalesCrm();
  ensureTables();
  const db = new Database(dbPath);
  db.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,
     languages_json,countries_json,channels_json,permission_group_id,created_at,updated_at)
    VALUES ('U-OTHER','other@example.com','Other','sales','','',1,0,'[]','[]','[]',
      (SELECT id FROM permission_groups WHERE role_key='sales' LIMIT 1),?,?)`).run(
    '2026-08-04 08:00:00', '2026-08-04 08:00:00');
  db.prepare(`INSERT INTO crm_intake_batches(id,batch_date,status,created_at)
    VALUES ('B227','2026-08-04','done','2026-08-04 08:00:00')`).run();
  db.prepare(`INSERT INTO crm_intake_items (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('I227-B','B227','BR-227B','Backfill Check','claimed','U-OTHER',?,?)`).run(
    '2026-08-04 08:00:00', '2026-08-04 08:00:00');
  db.prepare(`INSERT INTO crm_intake_decisions
    (id,intake_item_id,decision_type,actor_id,manual_decision_json,created_at)
    VALUES ('DEC-227-B','I227-B','manual','U-OTHER','{"action":"claim","status":"claimed"}','2026-08-04 09:00:00')`).run();
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,created_by,intake_item_id,created_at,updated_at)
    VALUES ('CRM-227-B','BR-227B','Backfill Check','U-OTHER','U-OTHER','I227-B',?,?)`).run(
    '2026-08-04 08:00:00', '2026-08-04 08:00:00');
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,created_by,intake_item_id,created_at,updated_at)
    VALUES ('CRM-227-M','BR-227M','Manual Linked','U-OTHER','USR-ADMIN','I227-B',?,?)`).run(
    '2026-08-04 08:00:00', '2026-08-04 08:00:00');
  db.close();

  const script = path.join(root, 'scripts', 'backfill-customer-creators.js');
  const dry = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));
  assert.equal(dry.dryRun, true);
  assert.equal(dry.fixed, 2, JSON.stringify(dry));
  assert.equal(dry.unknown, 0);
  const bugAccount = dry.details.find(item => item.id === 'CRM-227-B');
  const manualAccount = dry.details.find(item => item.id === 'CRM-227-M');
  assert.deepEqual(
    Object.keys(bugAccount.changes).sort(),
    ['created_by', 'first_claimed_at', 'first_claimed_by'],
  );
  assert.deepEqual(
    Object.keys(manualAccount.changes).sort(),
    ['first_claimed_at', 'first_claimed_by'],
  );
  assert.deepEqual(
    Object.keys(dry.details[0].changes).sort(),
    ['created_by', 'first_claimed_at', 'first_claimed_by'],
  );

  const applied = JSON.parse(execFileSync(process.execPath, [script, '--apply'], { encoding: 'utf8' }));
  assert.equal(applied.dryRun, false);
  assert.equal(applied.fixed, dry.fixed);
  assert.ok(applied.backup && fs.existsSync(applied.backup));

  const db2 = new Database(dbPath);
  const row = db2.prepare("SELECT created_by,first_claimed_by,first_claimed_at FROM crm_accounts WHERE id='CRM-227-B'").get();
  db2.close();
  assert.equal(row.created_by, 'system');
  assert.equal(row.first_claimed_by, 'U-OTHER');
  assert.ok(row.first_claimed_at);

  const second = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));
  assert.equal(second.fixed, 0);
  const db3 = new Database(dbPath);
  const manualRow = db3.prepare("SELECT created_by FROM crm_accounts WHERE id='CRM-227-M'").get();
  db3.close();
  assert.equal(manualRow.created_by, 'USR-ADMIN');
});

test('Issue 227 frontend exposes creator mapping and on-demand history', () => {
  const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
  assert.match(app, /function creatorDisplayName\(account\)[\s\S]*?系统导入/);
  assert.match(app, /历史数据\/未知/);
  assert.match(app, /data-customer-history/);
  assert.match(app, /查看客户历史/);
  assert.match(app, /async function openCustomerHistoryModal/);
  assert.doesNotMatch(app, /customerHistoryList/);
});
