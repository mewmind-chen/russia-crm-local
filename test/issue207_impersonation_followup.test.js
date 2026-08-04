'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const shellHtml = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');

test('Issue 207 impersonation allows customer tag writes with dual-identity audit', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-WU', { edit_customer: true });
  await fx.startImpersonation('U-WU');
  const tag = fx.db.prepare(`INSERT INTO tags (name,category,color,is_preset)
    VALUES ('检查标签','客户标签','',0)`).run();

  const response = await fx.request('/api/app', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'setCustomerTags', customerId: 'RU-9002', tagIds: [Number(tag.lastInsertRowid)] },
  });
  assert.equal(response.status, 200, await response.clone().text());

  const audit = fx.db.prepare(`SELECT * FROM crm_audit_log
    WHERE action='customer_tags_updated' ORDER BY rowid DESC LIMIT 1`).get();
  assert.equal(audit.real_user_id, 'USR-ADMIN');
  assert.equal(audit.effective_user_id, 'U-WU');
  assert.notEqual(audit.impersonation_context_id, '');

  const history = fx.db.prepare(`SELECT actor_id FROM customer_tag_history
    WHERE customer_id='RU-9002' ORDER BY rowid DESC LIMIT 1`).get();
  assert.equal(history.actor_id, 'U-WU');
});

test('Issue 207 tag writes still follow the effective users permission', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-WU', { edit_customer: false });
  await fx.startImpersonation('U-WU');
  const response = await fx.request('/api/app', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'setCustomerTags', customerId: 'RU-9002', tagIds: [] },
  });
  assert.equal(response.status, 403);
});

test('Issue 207 security writes stay blocked during impersonation', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  await fx.startImpersonation('U-MGR');
  const requests = [
    ['/api/sales-crm/users/U-OTHER', 'PATCH', { name: 'Blocked Rename' }],
    ['/api/sales-crm/password', 'POST', { oldPassword: 'Password123!', newPassword: 'Blocked123!' }],
    ['/api/sales-crm/data-maintenance/execute', 'POST', { runId: 'RUN-BLOCKED' }],
  ];
  for (const [route, method, body] of requests) {
    const response = await fx.request(route, { cookie: fx.adminCookie, method, body });
    assert.equal(response.status, 403, route);
  }
});

test('Issue 207 out-of-scope business writes return 403 during impersonation', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { edit_customer: true });
  await fx.startImpersonation('U-OTHER');
  const response = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { priority: 'A' },
  });
  assert.equal(response.status, 403);
});

test('Issue 207 frontend removes impersonation read-only and distinguishes messages', () => {
  assert.doesNotMatch(indexHtml, /&&!state\.capabilities\.impersonation/);
  assert.doesNotMatch(indexHtml, /身份检查期间只读/);
  assert.match(indexHtml, /function canRemoveManualTags\(\)\{return !state\.profileAccess\?\.readOnly&&Boolean/);
  assert.match(shellHtml, /身份检查中的业务操作会真实生效并记录审计/);
  assert.match(app, /身份检查期间禁止此安全操作/);
  assert.match(app, /function todayTaskSecurityBlocked/);
  assert.match(app, /todayTaskSecurityBlocked\(kind\)/);
});
