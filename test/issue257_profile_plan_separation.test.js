'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');

test('customer profile form and submit payload contain no plan fields', () => {
  const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
  const form = app.match(/openModal\('编辑客户资料', '客户资料', `([\s\S]*?)<\/form>`/)?.[1] || '';
  const submit = app.match(/form\.id === 'customerProfileEditForm'([\s\S]*?)\} else if \(form\.id === 'customerMasterForm'\)/)?.[1] || '';
  assert.match(form, /id="customerProfileEditForm"/);
  assert.doesNotMatch(form, /name="nextAction"|name="nextActionAt"|data-future-datetime/);
  assert.doesNotMatch(submit, /nextAction|nextActionAt|apiTime/);
});

test('profile-only save preserves a past plan while explicit plan edits remain future-only', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET next_action='历史计划',
    next_action_at='2026-07-01 08:00:00',next_action_time_basis='utc'
    WHERE id='CRM-OWN'`).run();

  const profileResponse = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { city: '莫斯科', priority: 'A' },
  });
  assert.equal(profileResponse.status, 200, await profileResponse.clone().text());
  assert.deepEqual(fx.db.prepare(`SELECT city,priority,next_action,next_action_at,next_action_time_basis
    FROM crm_accounts WHERE id='CRM-OWN'`).get(), {
    city: '莫斯科',
    priority: 'A',
    next_action: '历史计划',
    next_action_at: '2026-07-01 08:00:00',
    next_action_time_basis: 'utc',
  });

  const planResponse = await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { nextAction: '新的明确计划', nextActionAt: '2000-01-01 08:00:00' },
  });
  assert.equal(planResponse.status, 400, await planResponse.clone().text());
  assert.equal((await planResponse.json()).code, 'NEXT_ACTION_AT_MUST_BE_FUTURE');
});
