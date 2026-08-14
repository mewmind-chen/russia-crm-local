'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets', 'app.css'), 'utf8');

test('Issue 229 empty overrides restore group defaults and audit clears', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-WU', { view_contacts: false });
  assert.equal(
    fx.db.prepare('SELECT COUNT(*) n FROM user_permission_overrides WHERE user_id=?').get('U-WU').n > 0,
    true,
  );

  const restored = await fx.request('/api/sales-crm/users/U-WU/permission-overrides', {
    cookie: fx.adminCookie,
    method: 'PUT',
    body: { restoreDefault: true },
  });
  assert.equal(restored.status, 200, await restored.clone().text());
  assert.equal(
    fx.db.prepare('SELECT COUNT(*) n FROM user_permission_overrides WHERE user_id=?').get('U-WU').n,
    0,
  );
  const audit = fx.db.prepare(`SELECT detail_json FROM crm_audit_log
    WHERE action='user_personal_permissions_updated' AND entity_id='U-WU'
    ORDER BY created_at DESC,id DESC LIMIT 1`).get();
  assert.deepEqual(JSON.parse(audit.detail_json), { personalPermissionCount: 0 });
});

test('Issue 229 non-admins cannot restore personal permissions', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const denied = await fx.request('/api/sales-crm/users/U-WU/permission-overrides', {
    cookie: fx.otherCookie,
    method: 'PUT',
    body: { restoreDefault: true },
  });
  assert.equal(denied.status, 403);
});

test('Issue 229 modal uses one switch per permission with restore-default', () => {
  assert.doesNotMatch(app, /type="radio" name="personalPermission__/);
  assert.match(app, /type="checkbox" role="switch" name="personalPermission__/);
  assert.match(app, /跟随权限组/);
  assert.match(app, /个人调整/);
  assert.match(app, /恢复权限组默认/);
  assert.match(app, /将清除[^<]*的个人权限例外，之后自动跟随/);
  assert.match(app, /权限组本身不会改变/);
  assert.match(app, /permission-modal-wide/);
  assert.match(css, /\.permission-override-list\{display:block;min-height:0\}/);
  assert.match(css, /\.permission-switch-panel\{max-height:100%;overflow:auto/);
  assert.match(css, /\.permission-switch-row input\[type="checkbox"\]/);
  assert.match(css, /\.permission-modal-wide\{[^}]*overflow:hidden/);
});
