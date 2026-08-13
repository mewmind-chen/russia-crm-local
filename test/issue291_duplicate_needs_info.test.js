'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

function seedReview(fx, id = 'REV-NEEDS-1') {
  const at = '2026-08-13 08:00:00';
  fx.db.prepare(`INSERT INTO crm_duplicate_reviews
    (id,target_type,target_id,fingerprint,submitted_by,input_json,candidates_json,status,created_at,updated_at)
    VALUES (?, 'intake_item','INTAKE-OTHER','fingerprint','U-OTHER',?,?,'pending',?,?)`).run(
    id,
    JSON.stringify({ companyName: 'Eltron Group', website: 'https://eltron-group.ru' }),
    JSON.stringify([{ customerId: 'RU-9002', crmAccountId: 'CRM-OWN', companyName: 'Eltron', matchedBy: 'fuzzy_domain', score: 0.75 }]),
    at, at,
  );
  fx.db.prepare(`UPDATE crm_intake_items SET duplicate_state='review',duplicate_review_id=?,decision_reason='资料已提交管理层核验'
    WHERE id='INTAKE-OTHER'`).run(id);
}

test('admin can ask for more information and the intake stays blocked with the review open', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedReview(fx);
  const response = await fx.request('/api/sales-crm/duplicate-reviews/REV-NEEDS-1/resolve', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { resolution: 'needs_info', note: '请补充采购负责人姓名与官网备案信息' },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const review = fx.db.prepare("SELECT * FROM crm_duplicate_reviews WHERE id='REV-NEEDS-1'").get();
  assert.equal(review.status, 'needs_info');
  const intake = fx.db.prepare("SELECT * FROM crm_intake_items WHERE id='INTAKE-OTHER'").get();
  assert.equal(intake.duplicate_state, 'review');
  assert.equal(intake.decision_reason, '管理员要求补充资料后再判断');
});

test('needs_info without a note is rejected', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedReview(fx, 'REV-NEEDS-2');
  const response = await fx.request('/api/sales-crm/duplicate-reviews/REV-NEEDS-2/resolve', {
    cookie: fx.adminCookie, method: 'POST', body: { resolution: 'needs_info', note: '  ' },
  });
  assert.equal(response.status, 400);
});

test('updating the customer master reopens a needs_info review', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedReview(fx, 'REV-NEEDS-3');
  fx.db.prepare("INSERT INTO customer_pool(customer_id,company_name) VALUES ('BR-9004','Intake Other')").run();
  fx.db.prepare("UPDATE crm_duplicate_reviews SET status='needs_info',resolution_note='补充资料',reviewed_by='USR-ADMIN',reviewed_at='2026-08-13 09:00:00' WHERE id='REV-NEEDS-3'").run();
  const response = await fx.request('/api/sales-crm/master/BR-9004', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { description: '补充后的企业简介' },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const review = fx.db.prepare("SELECT * FROM crm_duplicate_reviews WHERE id='REV-NEEDS-3'").get();
  assert.equal(review.status, 'pending');
  const intake = fx.db.prepare("SELECT * FROM crm_intake_items WHERE id='INTAKE-OTHER'").get();
  assert.equal(intake.decision_reason, '资料已更新，重新进入管理层核验');
});
