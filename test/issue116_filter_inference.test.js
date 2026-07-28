'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

test('Issue #116 blocks manager-evaluation inference and user-directory export', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const now = '2026-07-28 12:00:00';
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,evaluation_text,author_id,author_name,ai_labels_json,created_at,updated_at)
    VALUES ('E-ISSUE116','CRM-WU','company','ISSUE116-SECRET-EVALUATION','USR-ADMIN','Admin',
      '["ISSUE116-SECRET-LABEL"]',?,?)`).run(now, now);
  fx.setUserPermissions('U-WU', {
    export_data: true,
    view_customers: true,
    view_all_customers: true,
    view_insights: false,
    view_users: false,
  });
  const cookie = await fx.login('wu@example.com', 'Password123!');

  const unfiltered = await fx.requestJson('/api/sales-crm/export', { cookie });
  assert.deepEqual(unfiltered.evaluations, []);
  assert.ok(unfiltered.customers.length > 0);
  assert.equal(unfiltered.customers.some(item => Object.hasOwn(item, 'product_focus')), false);
  assert.equal(unfiltered.customers.some(item => Object.hasOwn(item, 'next_action')), false);

  const hidden = await fx.requestJson(
    '/api/sales-crm/export?search=ISSUE116-SECRET-EVALUATION',
    { cookie },
  );
  assert.deepEqual(hidden.customers, []);
  assert.deepEqual(hidden.users, []);

  const forged = await fx.request(
    '/api/sales-crm/export?evaluationTags=ISSUE116-SECRET-LABEL',
    { cookie },
  );
  assert.equal(forged.status, 403);
  const forgedPayload = await forged.json();
  assert.equal(forgedPayload.code, 'FILTER_NOT_AUTHORIZED');
});

test('Issue #116 blocks intake contact inference without contact permission', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const now = '2026-07-28 12:00:00';
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,
     contact_name,contact_title,contact_methods,contact_level,created_at,updated_at)
    VALUES ('INTAKE-ISSUE116','BATCH-TEST','RU-ISSUE116','Visible Company','assigned','U-WU',
      'ISSUE116-SECRET-CONTACT','采购经理','secret@example.test','L3',?,?)`).run(now, now);
  fx.setUserPermissions('U-WU', {
    view_intake: true,
    manage_intake: false,
    view_contacts: false,
  });
  const cookie = await fx.login('wu@example.com', 'Password123!');

  const hidden = await fx.requestJson(
    '/api/sales-crm/intake?search=ISSUE116-SECRET-CONTACT',
    { cookie },
  );
  assert.equal(hidden.total, 0);
  assert.equal(Object.hasOwn(hidden.filterOptions, 'contactLevels'), false);

  for (const suffix of ['contactLevel=L3', 'hasNamedContact=true']) {
    const forged = await fx.request(`/api/sales-crm/intake?${suffix}`, { cookie });
    assert.equal(forged.status, 403, suffix);
    assert.equal((await forged.json()).code, 'FILTER_NOT_AUTHORIZED', suffix);
  }

  const visibleRows = await fx.requestJson(
    '/api/sales-crm/intake?status=assigned',
    { cookie },
  );
  const row = visibleRows.items.find(item => item.id === 'INTAKE-ISSUE116');
  assert.ok(row);
  assert.doesNotMatch(JSON.stringify(row), /ISSUE116-SECRET-CONTACT|secret@example\.test/);
  for (const key of ['contact_name', 'contact_title', 'contact_methods', 'contact_level']) {
    assert.equal(Object.hasOwn(row, key), false, key);
  }
});
