const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');

function sourceOf(name, nextName) {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return app.slice(start, end);
}

test('lead, CRM, recycle and customer selectors share nickname-first identity helpers', () => {
  const display = sourceOf('accountDisplayName', 'accountIdentity');
  const identity = sourceOf('accountIdentity', 'sharedCustomerId');
  const intake = sourceOf('renderIntake', 'customerProfileFrameUrl');
  const customers = sourceOf('renderCustomers', 'loadRecycleBin');
  const recycle = sourceOf('renderRecycleBin', 'openRecycleCustomer');
  const selectors = sourceOf('activityCustomerIdentity', 'selectActivityCustomer');

  assert.match(display, /account\?\.nickname[\s\S]*account\?\.company_name[\s\S]*account\?\.companyName/);
  assert.match(identity, /officialName[\s\S]*customerCode[\s\S]*join\(' · '\)/);
  assert.match(intake, /accountDisplayName\(item\)/);
  assert.match(intake, /accountIdentity\(item\)/);
  assert.match(customers, /accountDisplayName\(account\)/);
  assert.match(customers, /accountIdentity\(account\)/);
  assert.match(recycle, /accountDisplayName\(row\)/);
  assert.match(recycle, /accountIdentity\(row\)/);
  assert.match(selectors, /customer\?\.nickname/);
  assert.match(selectors, /companyName/);
  assert.match(selectors, /externalCustomerId/);
  assert.match(selectors, /ownerName/);
});

test('every shared drawer path clears and recomputes nickname actions for the current object', () => {
  const reset = sourceOf('resetDrawerActions', 'configureDrawerActions');
  const configure = sourceOf('configureDrawerActions', 'openCustomer');
  const customer = sourceOf('openCustomer', 'customerAiSection');
  const intake = sourceOf('openIntakeProfile', 'closeDrawer');
  const recycleOpen = sourceOf('openRecycleCustomer', 'labelsForAccount');
  const recycleRender = sourceOf('renderRecycleDrawer', 'renderDrawer');
  const crmRender = sourceOf('renderDrawer', 'openModal');
  const close = sourceOf('closeDrawer', 'evaluationCard');

  assert.match(reset, /state\.drawerNicknameTarget = null/);
  assert.match(reset, /nicknameButton\?\.classList\.add\('hidden'\)/);
  assert.match(configure, /resetDrawerActions\(\)/);
  assert.match(configure, /customerAllowsNicknameEdit\(customer\)/);
  assert.match(customer, /renderDrawer\(\)/);
  assert.match(intake, /configureDrawerActions\(\{[\s\S]*source: 'intake'/);
  assert.match(recycleOpen, /resetDrawerActions\(\)/);
  assert.match(recycleRender, /configureDrawerActions\(\{[\s\S]*source: 'recycle'/);
  assert.match(crmRender, /configureDrawerActions\(\{[\s\S]*source: 'crm'/);
  assert.match(close, /resetDrawerActions\(\)/);
});

test('a visible nickname action uses the stable master id and synchronizes all local views', () => {
  const modal = sourceOf('openNicknameModal', 'openPasswordModal');
  const synchronize = sourceOf('synchronizeSharedNickname', 'renderAfterSharedNicknameUpdate');
  const profile = sourceOf('renderCustomerProfileHeader', 'returnFromCustomerProfile');

  assert.match(modal, /name="externalCustomerId"/);
  assert.doesNotMatch(modal, /name="customerId"/);
  assert.match(app, /\/api\/sales-crm\/customers\/\$\{encodeURIComponent\(payload\.externalCustomerId\)\}\/nickname/);
  assert.match(app, /synchronizeSharedNickname\(payload\.externalCustomerId, nickname\)/);
  assert.match(synchronize, /state\.data\?\.accounts/);
  assert.match(synchronize, /state\.data\?\.intake\?\.items/);
  assert.match(synchronize, /state\.recycleBin\?\.rows/);
  assert.match(synchronize, /authorizedBusinessLists/);
  assert.match(profile, /customerAllowsNicknameEdit\(profileCustomer\)/);
  assert.doesNotMatch(app, /领取并进入 CRM 后才能设置昵称/);
  assert.match(app, /openNicknameModal\(state\.drawerNicknameTarget\)/);
  assert.match(app, /openNicknameModal\(profileNicknameTarget\(\)\)/);
});

test('nickname actions start hidden and the Issue 147 assets are cache-busted', () => {
  assert.match(html, /id="customerProfileNickname" class="button secondary hidden"/);
  assert.match(html, /id="drawerNicknameBtn" class="button secondary hidden"/);
  assert.match(html, /app\.css\?v=20260801-issue168/);
  assert.match(html, /app\.js\?v=20260801-issue168/);
});
