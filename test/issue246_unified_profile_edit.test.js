'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

test('Issue 246 customer profile edit is a single entry on drawer and profile toolbar', () => {
  assert.match(html, /id="customerProfileDataEdit"[\s\S]*?>编辑客户资料</);
  assert.doesNotMatch(html, /customerProfileStageEdit/);
  assert.doesNotMatch(html, /customerProfileNickname/);
  assert.match(app, /can\('edit_customer'\) \? '<button class="button secondary" data-edit-customer-profile>编辑客户资料<\/button>' : ''/);
  assert.doesNotMatch(app, /data-edit-stage-rating/);
  assert.doesNotMatch(app, /openStageRatingModal/);
  assert.match(app, /#customerProfileDataEdit'\)\.classList\.toggle\('hidden', readOnly \|\| !can\('edit_customer'\)\)/);
});

test('Issue 246 unified form contains the full profile, stage and nickname field set', () => {
  const form = app.match(/openModal\('编辑客户资料', 'CUSTOMER PROFILE', `([\s\S]*?)<\/form>`/)?.[1] || '';
  assert.match(form, /id="customerProfileEditForm"/);
  for (const name of [
    'stage', 'ownerId', 'priority', 'nextAction', 'nextActionAt',
    'country', 'city', 'website', 'industry', 'customerType', 'source',
    'establishedYear', 'productFocus',
  ]) {
    assert.match(form, new RegExp(`name="${name}"`), name);
  }
  assert.match(form, /\$\{nicknameField\}/);
  assert.match(app, /name="nickname"/);
  assert.doesNotMatch(form, /name="potentialValue"/);
  assert.match(form, /data-future-datetime/);
  assert.match(app, /customerAllowsNicknameEdit\(account\)/);
  assert.match(app, /can\('view_all_customers'\) && can\('manage_intake'\)/);
  assert.match(app, /form\.id === 'customerProfileEditForm'[\s\S]*?reloadCustomerProfileFrame\(\)/);
  assert.doesNotMatch(app, /form\.id === 'stageRatingForm'/);
  assert.doesNotMatch(app, /form\.id === 'customerProfileForm'/);
});

test('Issue 246 unified save handles owner unassign and nickname sync through one PATCH', () => {
  const submit = app.match(/form\.id === 'customerProfileEditForm'([\s\S]*?)\} else if \(form\.id === 'customerMasterForm'\)/)?.[1] || '';
  assert.match(submit, /\/api\/sales-crm\/accounts\/\$\{encodeURIComponent\(customerId\)\}/);
  assert.match(submit, /__unassigned__/);
  assert.match(submit, /unassignConfirmed/);
  assert.match(submit, /nextActionAt = apiTime/);
  assert.match(submit, /refresh\('客户资料已更新'\)/);
});
