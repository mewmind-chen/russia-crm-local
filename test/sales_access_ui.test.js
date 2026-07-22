const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readAsset(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8');
}

test('access UI exposes groups tri-state overrides account edits and password reset', () => {
  const html = readAsset('sales-crm.html');
  const js = readAsset('sales-assets', 'app.js');
  assert.match(html, /id="permissionGroupTable"/);
  assert.match(js, /permissionOverrideForm/);
  assert.match(js, /value="inherit"/);
  assert.match(js, /value="allow"/);
  assert.match(js, /value="deny"/);
  assert.match(js, /adminPasswordResetForm/);
  assert.match(js, /passwordConfirm/);
  assert.match(js, /data-edit-user/);
});

test('permission group panel sits beside the user and audit panels', () => {
  const html = readAsset('sales-crm.html');
  assert.match(html, /id="newPermissionGroupBtn"/);
  const usersView = html.slice(html.indexOf('id="usersView"'));
  assert.ok(usersView.includes('id="permissionGroupTable"'), 'group table inside users view');
  assert.ok(usersView.includes('id="userTable"'), 'user table inside users view');
  assert.ok(usersView.includes('id="auditTable"'), 'audit table inside users view');
});

test('user table renders group column override counts and scoped actions', () => {
  const js = readAsset('sales-assets', 'app.js');
  assert.match(js, /'用户', '角色', '权限组', '覆盖数', '状态', '操作'/);
  assert.match(js, /data-edit-overrides/);
  assert.match(js, /data-reset-password/);
  assert.match(js, /data-start-impersonation/);
  assert.match(js, /manage_users/);
});

test('audit rows show real and effective operators when they differ', () => {
  const js = readAsset('sales-assets', 'app.js');
  assert.match(js, /real_user_name/);
  assert.match(js, /effective_user_name/);
});

test('account and group forms follow the role-matched backend contract', () => {
  const js = readAsset('sales-assets', 'app.js');
  assert.match(js, /id="editUserForm"/);
  assert.match(js, /id="permissionGroupForm"/);
  assert.match(js, /name="permissionGroupId"/);
  assert.match(js, /data-role-source/);
  assert.match(js, /data-role-group/);
  assert.doesNotMatch(js, /id="permissionForm"/);
});

test('admin password reset uses blank confirmed new-password fields', () => {
  const js = readAsset('sales-assets', 'app.js');
  assert.match(js, /name="password" type="password" minlength="8" autocomplete="new-password"/);
  assert.match(js, /name="passwordConfirm" type="password" minlength="8" autocomplete="new-password"/);
  assert.match(js, /\/password-reset/);
});

test('override editor styles exist and asset versions are refreshed', () => {
  const html = readAsset('sales-crm.html');
  const css = readAsset('sales-assets', 'app.css');
  const js = readAsset('sales-assets', 'app.js');
  assert.match(js, /permission-override-row/);
  assert.match(css, /permission-override-row/);
  assert.doesNotMatch(html, /app\.css\?v=20260719-4/);
  assert.doesNotMatch(html, /app\.js\?v=20260720-4/);
});

test('identity inspection UI has a persistent banner and explicit return flow', () => {
  const html = readAsset('sales-crm.html');
  const js = readAsset('sales-assets', 'app.js');
  assert.match(html, /id="impersonationBanner"/);
  assert.match(html, /id="stopImpersonationBtn"/);
  assert.match(js, /IMPERSONATION_ENDED/);
  assert.match(js, /\/api\/sales-crm\/impersonation\/start/);
  assert.match(js, /\/api\/sales-crm\/impersonation\/stop/);
  assert.match(js, /setInterval/);
});

test('inspection banner lives at the top of the main column without a dismiss control', () => {
  const html = readAsset('sales-crm.html');
  const css = readAsset('sales-assets', 'app.css');
  const mainStart = html.indexOf('<main class="main">');
  const banner = html.indexOf('id="impersonationBanner"');
  const topbar = html.indexOf('class="topbar"');
  assert.ok(mainStart > -1 && banner > mainStart, 'banner inside .main');
  assert.ok(topbar > banner, 'banner before .topbar');
  assert.doesNotMatch(html.slice(banner, topbar), /data-close|icon-button/);
  assert.match(css, /impersonation-banner/);
});

test('inspection flow renders countdown from server expiry and suppresses forbidden UI', () => {
  const js = readAsset('sales-assets', 'app.js');
  assert.match(js, /function renderImpersonationBanner/);
  assert.match(js, /function startIdentityInspection/);
  assert.match(js, /function stopIdentityInspection/);
  assert.match(js, /expiresAt\.replace\(' ', 'T'\)/);
  assert.match(js, /身份检查已结束，正在恢复管理员账号/);
  assert.match(js, /state\.data\.impersonation/);
  assert.match(js, /data-view="users"/);
});

test('impersonation action blocked responses keep business state intact', () => {
  const js = readAsset('sales-assets', 'app.js');
  assert.match(js, /IMPERSONATION_ACTION_BLOCKED/);
  const apiMatch = js.match(/async function api\(url, options = \{\}\) \{[\s\S]*?\n  \}/);
  assert.ok(apiMatch, 'api helper found');
  assert.match(apiMatch[0], /error\.code\s*=\s*result\.code/);
});

test('data maintenance UI is permission gated and requires preview before execute', () => {
  const html = readAsset('sales-crm.html');
  const js = readAsset('sales-assets', 'app.js');
  const css = readAsset('sales-assets', 'app.css');
  assert.match(html, /data-view="maintenance" data-permission="manage_data_maintenance"/);
  assert.match(html, /id="maintenancePreviewPanel"/);
  assert.match(js, /id="maintenanceExecuteBtn"/);
  assert.match(js, /\/api\/sales-crm\/data-maintenance\/preview/);
  assert.match(js, /\/api\/sales-crm\/data-maintenance\/execute/);
  assert.match(js, /state\.maintenancePreview/);
  assert.match(js, /data-view="maintenance"/);
  assert.match(css, /maintenance-warning/);
  assert.match(css, /button\.danger/);
});
