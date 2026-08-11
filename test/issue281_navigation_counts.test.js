'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

async function rejectMismatchRecords(fx) {
  const intake = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      action: 'reject', itemId: 'INTAKE-OTHER', reason: '原厂，不对口',
      idempotencyKey: 'issue281-intake-mismatch',
    },
  });
  assert.equal(intake.status, 200, await intake.clone().text());
  const account = await fx.request('/api/sales-crm/accounts/CRM-OTHER/reject', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { reason: '客户类型不符' },
  });
  assert.equal(account.status, 200, await account.clone().text());
}

test('bootstrap recycle badge count equals the unfiltered authorized recycle total', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await rejectMismatchRecords(fx);

  for (const cookie of [fx.otherCookie, fx.cookie, fx.adminCookie]) {
    const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie });
    const recycle = await fx.requestJson(
      '/api/sales-crm/lists/recycle_bin?page=1&pageSize=50&filters=%7B%7D',
      { cookie },
    );
    assert.equal(bootstrap.navigationCounts.recycleBin, recycle.authorizedTotal);
    assert.equal(bootstrap.navigationCounts.recycleBin, 2);
  }
});

test('bootstrap navigation snapshots align with unfiltered authorized endpoints', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const customers = await fx.requestJson(
    '/api/sales-crm/accounts?page=1&pageSize=50&filters=%7B%7D',
    { cookie: fx.adminCookie },
  );
  const alerts = await fx.requestJson(
    '/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D',
    { cookie: fx.adminCookie },
  );
  const notifications = await fx.requestJson(
    '/api/sales-crm/lists/notifications?page=1&pageSize=50&filters=%7B%7D',
    { cookie: fx.adminCookie },
  );

  assert.equal(bootstrap.navigationCounts.customers, customers.authorizedTotal);
  assert.equal(bootstrap.navigationCounts.alerts, alerts.authorizedTotal);
  assert.equal(bootstrap.navigationCounts.notificationsUnread, notifications.summary.unread);
});

test('notification badge uses the unpaginated unread summary beyond bootstrap row limits', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const insert = fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,wecom_status,created_at,read_at)
    VALUES (?,?,'CRM-OWN','TEST_NOTICE','info',?,'','unread',?,'pending',?,'')`);
  for (let index = 0; index < 105; index += 1) {
    const id = `NOTE-281-${String(index).padStart(3, '0')}`;
    insert.run(id, 'USR-ADMIN', id, `issue281:${id}`, `2026-08-11 12:${String(index % 60).padStart(2, '0')}:00`);
  }

  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const notifications = await fx.requestJson(
    '/api/sales-crm/lists/notifications?page=1&pageSize=50&filters=%7B%7D',
    { cookie: fx.adminCookie },
  );
  assert.equal(bootstrap.notifications.length, 100);
  assert.equal(notifications.summary.unread, 105);
  assert.equal(bootstrap.navigationCounts.notificationsUnread, 105);
});

test('navigation badges prefer loaded unfiltered totals and preserve intake business semantics', () => {
  const render = functionBlock(app, 'renderNavigationCounts');
  assert.match(render, /customerList\.loaded[\s\S]*customerList\.authorizedTotal/);
  assert.match(render, /authorizedBusinessLists\.alerts[\s\S]*authorizedTotal/);
  assert.match(render, /authorizedBusinessLists\.recycle_bin[\s\S]*authorizedTotal/);
  assert.match(render, /notificationMeta\.summary[\s\S]*unread/);
  assert.match(render, /intakeSalesView[\s\S]*intakeStats\?\.assigned/);
  assert.match(render, /intakeStats\?\.pending[\s\S]*intakeStats\?\.returned/);
});

test('every asynchronous source refreshes navigation badges after applying results', () => {
  assert.match(functionBlock(app, 'loadCustomerPage'), /renderNavigationCounts\(\)/);
  assert.match(functionBlock(app, 'loadAuthorizedBusinessPage'), /renderNavigationCounts\(\)/);
  assert.match(functionBlock(app, 'renderAll'), /renderNavigationCounts\(\)/);
});
