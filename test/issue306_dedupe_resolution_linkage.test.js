'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

function seedReview(fx, { itemId, externalCustomerId, companyName, masterId = 'CRM-OTHER' } = {}) {
  const now = '2026-08-14 10:00:00';
  fx.db.prepare('INSERT OR IGNORE INTO crm_intake_batches (id,batch_date,source,status,candidate_count,imported_count,assigned_count,skipped_count,created_by,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('B-306','','screened-customer-pool','scanned',0,0,0,0,'system',now,'');
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,contact_name,contact_methods,website,industry,created_at,updated_at,duplicate_state,duplicate_review_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    itemId, 'B-306', externalCustomerId, companyName, 'pending',
    '', '', '', '', now, now, 'review', `REV-${itemId}`,
  );
  const master = fx.db.prepare("SELECT * FROM crm_accounts WHERE id=?").get(masterId);
  fx.db.prepare(`INSERT INTO crm_duplicate_reviews
    (id,target_type,target_id,fingerprint,submitted_by,input_json,candidates_json,status,
     created_at,updated_at,current_candidates_json,selected_customer_id,selected_candidate_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `REV-${itemId}`, 'intake_item', itemId, `fp-${itemId}`, 'USR-ADMIN',
    JSON.stringify({ companyName, website: '', country: '', city: '', industry: '', externalCustomerId }),
    '[]', 'pending', now, now,
    JSON.stringify([{ customerId: master.external_customer_id, crmAccountId: master.id, nickname: master.company_name, companyName: master.company_name, website: master.website || '', country: master.country || '', customerStage: master.stage, ownerName: 'Admin', industry: master.industry || '' }]),
    master.external_customer_id,
    JSON.stringify({ customerId: master.external_customer_id, crmAccountId: master.id, nickname: master.company_name, companyName: master.company_name, website: master.website || '', country: master.country || '', customerStage: master.stage, ownerName: 'Admin', industry: master.industry || '' }),
  );
  return { master };
}

test('confirmed_same links master, writes timeline, never deletes, and blocks reassignment', async t => {
  const fx = await fixtures.adminFixture({ permissions: { manage_intake: true, view_all_customers: true, manage_protected_customers: true } });
  t.after(() => fx.close());
  seedReview(fx, { itemId: 'IN-306-SAME', externalCustomerId: 'RU-9998', companyName: 'Same Co' });

  const response = await fx.request('/api/sales-crm/duplicate-reviews/REV-IN-306-SAME/resolve', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { resolution: 'confirmed_same', candidateCustomerId: 'RU-9003', note: '确认为同一家公司' },
  });
  assert.equal(response.status, 200, await response.clone().text());

  const item = fx.db.prepare("SELECT * FROM crm_intake_items WHERE id='IN-306-SAME'").get();
  assert.equal(item.status, 'duplicate');
  assert.equal(item.duplicate_state, 'exact');
  assert.equal(item.crm_customer_id, 'CRM-OTHER');

  // timeline activity on master
  const activity = fx.db.prepare(
    "SELECT * FROM crm_activities WHERE customer_id='CRM-OTHER' AND activity_type='note' AND summary LIKE '%RU-9998%'",
  ).get();
  assert.ok(activity, 'master timeline activity written');
  assert.match(activity.summary, /同一客户|关联/);

  // no deletion
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_intake_items WHERE id='IN-306-SAME'").get().n, 1);
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_accounts WHERE id='CRM-OTHER'").get().n, 1);

  // linked item blocked from manual assignment
  const preview = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'manual_assign_preview', itemIds: ['IN-306-SAME'], filterScope: {}, idempotencyKey: 'k-same-1' },
  });
  assert.equal(preview.status, 200, await preview.clone().text());
  const previewBody = await preview.json();
  assert.equal(previewBody.blockedReasons?.['客户已在 CRM'], 1, 'linked item blocked');
});

test('needs_info persists supplement requirement and hydration exposes it', async t => {
  const fx = await fixtures.adminFixture({ permissions: { manage_intake: true, view_all_customers: true, manage_protected_customers: true } });
  t.after(() => fx.close());
  seedReview(fx, { itemId: 'IN-306-NEEDS', externalCustomerId: 'RU-9997', companyName: 'Needs Co' });

  const response = await fx.request('/api/sales-crm/duplicate-reviews/REV-IN-306-NEEDS/resolve', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { resolution: 'needs_info', note: '请补充官网和采购联系人' },
  });
  assert.equal(response.status, 200, await response.clone().text());

  const item = fx.db.prepare("SELECT * FROM crm_intake_items WHERE id='IN-306-NEEDS'").get();
  assert.equal(item.supplement_requirement, '请补充官网和采购联系人');

  const intake = await fx.request('/api/sales-crm/intake?page=1&pageSize=50', { cookie: fx.adminCookie });
  assert.equal(intake.status, 200);
  const body = await intake.json();
  const hydrated = (body.items || []).find(row => row.id === 'IN-306-NEEDS');
  assert.equal(hydrated.supplementRequirement, '请补充官网和采购联系人');
});

test('confirmed_distinct clears the block and the lead becomes assignable again', async t => {
  const fx = await fixtures.adminFixture({ permissions: { manage_intake: true, view_all_customers: true, manage_protected_customers: true } });
  t.after(() => fx.close());
  seedReview(fx, { itemId: 'IN-306-CLEAR', externalCustomerId: 'RU-9996', companyName: 'Clear Co' });

  const response = await fx.request('/api/sales-crm/duplicate-reviews/REV-IN-306-CLEAR/resolve', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { resolution: 'confirmed_distinct', note: '不同公司' },
  });
  assert.equal(response.status, 200, await response.clone().text());

  const item = fx.db.prepare("SELECT * FROM crm_intake_items WHERE id='IN-306-CLEAR'").get();
  assert.equal(item.status, 'approved');
  assert.equal(item.duplicate_state, 'cleared');
});

test('confirmed_same sets complementary-info flag when lead has contact/website master lacks', async t => {
  const fx = await fixtures.adminFixture({ permissions: { manage_intake: true, view_all_customers: true, manage_protected_customers: true } });
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET website='' WHERE id='CRM-OTHER'").run();
  seedReview(fx, { itemId: 'IN-306-COMP', externalCustomerId: 'RU-9995', companyName: 'Comp Co' });
  fx.db.prepare(
    "UPDATE crm_intake_items SET contact_name='Ivan Petrov', contact_methods='email', website='https://comp.example' WHERE id='IN-306-COMP'",
  ).run();

  const response = await fx.request('/api/sales-crm/duplicate-reviews/REV-IN-306-COMP/resolve', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { resolution: 'confirmed_same', candidateCustomerId: 'RU-9003', note: '同一家' },
  });
  assert.equal(response.status, 200, await response.clone().text());

  const item = fx.db.prepare("SELECT * FROM crm_intake_items WHERE id='IN-306-COMP'").get();
  const flag = JSON.parse(item.supplement_pending_json || '{}');
  assert.equal(flag.contact, true);
  assert.equal(flag.website, true);

  const intake = await fx.request('/api/sales-crm/intake?page=1&pageSize=50', { cookie: fx.adminCookie });
  const body = await intake.json();
  const hydrated = (body.items || []).find(row => row.id === 'IN-306-COMP');
  if (hydrated) assert.deepEqual(hydrated.complementaryInfo, { contact: true, website: true });
});
