'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

test('sales receive only a minimal message for another owner and can open their own duplicate', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true });

  const otherOwner = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { companyName: 'Wu Fixture', idempotencyKey: 'dup-other-owner' },
  });
  const otherBody = await otherOwner.json();
  assert.equal(otherOwner.status, 409);
  assert.equal(otherBody.code, 'CUSTOMER_DUPLICATE');
  assert.equal(otherBody.error, '该客户已有跟进人，无法重复新增。');
  assert.equal('duplicate' in otherBody, false);
  assert.equal('existingCustomerId' in otherBody, false);
  assert.equal(JSON.stringify(otherBody).includes('U-WU'), false);

  const own = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { companyName: 'Other Fixture LLC', idempotencyKey: 'dup-own' },
  });
  const ownBody = await own.json();
  assert.equal(own.status, 409);
  assert.equal(ownBody.error, '该客户已在你的客户列表');
  assert.equal(ownBody.existingCustomerId, 'CRM-OTHER');
  assert.equal(ownBody.canOpenExistingCustomer, true);
});

test('fuzzy duplicate enters management review, then a distinct decision permits one create', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true });
  fx.db.prepare(`UPDATE customer_pool SET country='俄罗斯',city='莫斯科',industry='工业自动化'
    WHERE customer_id='RU-9002'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET country='俄罗斯',city='莫斯科',industry='工业自动化'
    WHERE id='CRM-OWN'`).run();

  const pending = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      companyName: 'Owned Fixturex', country: '俄罗斯', city: '莫斯科', industry: '工业自动化',
      idempotencyKey: 'fuzzy-first',
    },
  });
  const pendingBody = await pending.json();
  assert.equal(pending.status, 202);
  assert.equal(pendingBody.accepted, true);
  assert.equal(pendingBody.message, '该客户需要管理员确认，确认后可继续领取。');
  assert.equal('reviewRequired' in pendingBody, false);
  assert.equal('reviewId' in pendingBody, false);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_accounts WHERE company_name=?').get('Owned Fixturex').count, 0);

  const salesReviews = await fx.request('/api/sales-crm/duplicate-reviews', { cookie: fx.otherCookie });
  assert.equal(salesReviews.status, 403);

  const managerReviews = await fx.request('/api/sales-crm/duplicate-reviews', { cookie: fx.adminCookie });
  const managerBody = await managerReviews.json();
  assert.equal(managerReviews.status, 200);
  const review = managerBody.reviews.find(item => item.input.companyName === 'Owned Fixturex');
  assert.ok(review);
  assert.equal(review.candidates[0].customerId, 'RU-9002');
  assert.equal(review.candidates[0].ownerId, 'U-MGR');

  const resolved = await fx.request(`/api/sales-crm/duplicate-reviews/${review.id}/resolve`, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { resolution: 'confirmed_distinct', note: '名称相似但核实为不同公司' },
  });
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).review.status, 'confirmed_distinct');

  const changedIdentity = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      companyName: 'Owned Fixturex', country: '俄罗斯', city: '圣彼得堡', industry: '工业自动化',
      idempotencyKey: 'fuzzy-changed-city',
    },
  });
  assert.equal(changedIdentity.status, 202);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_duplicate_reviews
    WHERE status='pending' AND input_json LIKE '%圣彼得堡%'`).get().count, 1);

  const created = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      companyName: 'Owned Fixturex', country: '俄罗斯', city: '莫斯科', industry: '工业自动化',
      idempotencyKey: 'fuzzy-approved',
    },
  });
  const createdBody = await created.json();
  assert.equal(created.status, 200, createdBody.error);
  assert.equal(createdBody.externalCustomerId.startsWith('RU-'), true);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_accounts WHERE company_name=?').get('Owned Fixturex').count, 1);
  assert.deepEqual(fx.db.prepare(`SELECT created_account_id,created_external_customer_id
    FROM crm_duplicate_reviews WHERE id=?`).get(review.id), {
    created_account_id: createdBody.customerId,
    created_external_customer_id: createdBody.externalCustomerId,
  });
});

test('manual create idempotency returns the same customer and intake fuzzy protection blocks assignment', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true });
  const payload = { companyName: 'Idempotent New Customer', country: '英国', idempotencyKey: 'same-create' };
  const first = await fx.request('/api/sales-crm/accounts', { cookie: fx.otherCookie, method: 'POST', body: payload });
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  const second = await fx.request('/api/sales-crm/accounts', { cookie: fx.otherCookie, method: 'POST', body: payload });
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.deduplicated, true);
  assert.equal(secondBody.customerId, firstBody.customerId);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_accounts WHERE company_name=?').get(payload.companyName).count, 1);

  fx.db.prepare(`UPDATE crm_intake_items SET duplicate_state='review',duplicate_review_id='DUPREV-TEST',status='pending',assigned_owner_id='' WHERE id='INTAKE-OTHER'`).run();
  const preview = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'manual_assign_preview', itemIds: ['INTAKE-OTHER'] },
  });
  const previewBody = await preview.json();
  assert.equal(preview.status, 200);
  assert.equal(previewBody.eligibleCount, 0);
  assert.equal(previewBody.blockedReasons['疑似重名，等待管理员确认'], 1);
});

test('concurrent exact creates allocate only one customer identity', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true });

  const submit = key => fx.request('/api/sales-crm/accounts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      companyName: 'Concurrent Identity Fixture',
      website: 'https://concurrent-identity.example/path',
      country: '英国',
      idempotencyKey: key,
    },
  });
  const responses = await Promise.all([submit('concurrent-a'), submit('concurrent-b')]);
  const bodies = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  assert.equal(bodies.find(body => body.code === 'CUSTOMER_DUPLICATE').error, '该客户已在你的客户列表');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_accounts WHERE company_name=?')
    .get('Concurrent Identity Fixture').count, 1);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM customer_pool WHERE website LIKE '%concurrent-identity.example%'").get().count, 1);
});
