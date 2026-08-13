'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

function seedSubmittedReview(fx) {
  const at = '2026-08-13 08:00:00';
  fx.db.prepare(`UPDATE crm_intake_items SET duplicate_state='review',
    duplicate_review_id='REV-HINT',decision_reason='资料已提交管理层核验',status='pending'
    WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_duplicate_reviews
    (id,target_type,target_id,fingerprint,submitted_by,input_json,candidates_json,status,created_at,updated_at)
    VALUES ('REV-HINT','intake_item','INTAKE-OTHER','fp','U-OTHER',?,?, 'pending',?,?)`).run(
    JSON.stringify({ companyName: 'Intake Other', website: 'https://other.example' }),
    JSON.stringify([{ customerId: 'RU-9002', crmAccountId: 'CRM-OWN', companyName: 'Owned Fixture', matchedBy: 'fuzzy_name', score: 0.81 }]),
    at, at,
  );
}

test('sales sees their submitted review item with only the vague hint', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedSubmittedReview(fx);
  const body = await fx.requestJson('/api/sales-crm/intake?page=1&pageSize=50', {
    cookie: fx.otherCookie,
  });
  const item = body.items.find(row => row.id === 'INTAKE-OTHER');
  assert.ok(item, 'expected the sales submitted review item to be visible');
  assert.equal(item.reviewVagueHint, '该客户需要管理员确认，确认后可继续领取。');
  assert.equal(item.assignable, false);
  assert.equal(item.decision_reason, undefined);
  assert.equal(item.suggested_owner_id, undefined);
  assert.ok(!JSON.stringify(item).includes('Owned Fixture'));
  assert.ok(!JSON.stringify(item).includes('0.81'));
});

test('sales does not see other pending review items', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedSubmittedReview(fx);
  fx.db.prepare("UPDATE crm_duplicate_reviews SET submitted_by='U-MGR' WHERE id='REV-HINT'").run();
  const body = await fx.requestJson('/api/sales-crm/intake?page=1&pageSize=50', {
    cookie: fx.otherCookie,
  });
  assert.ok(!body.items.some(row => row.id === 'INTAKE-OTHER'));
});

test('creating a customer that enters review returns the vague message to sales', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true });
  fx.db.prepare("UPDATE customer_pool SET country='俄罗斯',city='莫斯科',industry='工业自动化' WHERE customer_id='RU-9002'").run();
  fx.db.prepare("UPDATE crm_accounts SET country='俄罗斯',city='莫斯科',industry='工业自动化' WHERE id='CRM-OWN'").run();
  const response = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      companyName: 'Owned Fixturex', country: '俄罗斯', city: '莫斯科', industry: '工业自动化',
      idempotencyKey: 'issue291-review-msg',
    },
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.message, '该客户需要管理员确认，确认后可继续领取。');
});
