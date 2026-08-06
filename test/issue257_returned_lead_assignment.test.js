'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');

function encodedFilters(filters = {}) {
  return encodeURIComponent(JSON.stringify(filters));
}

async function businessList(fx, pageKey, filters = {}) {
  const schema = await fx.requestJson(`/api/sales-crm/filter-schema/${pageKey}`, {
    cookie: fx.adminCookie,
  });
  return fx.requestJson(
    `/api/sales-crm/lists/${pageKey}?page=1&pageSize=50`
      + `&permissionVersion=${schema.schema.permissionVersion}&filters=${encodedFilters(filters)}`,
    { cookie: fx.adminCookie },
  );
}

function linkReturnedCustomer(fx) {
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-9003',
    crm_customer_id='CRM-OTHER',status='claimed',assigned_owner_id='U-OTHER',
    duplicate_state='cleared' WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET intake_item_id='INTAKE-OTHER',
    assignment_status='claimed',owner_id='U-OTHER' WHERE id='CRM-OTHER'`).run();
}

test('returned linked leads are assignable while active duplicates and review rows stay blocked', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  linkReturnedCustomer(fx);
  const returned = await fx.request('/api/sales-crm/accounts/CRM-OTHER/return', {
    cookie: fx.adminCookie, method: 'POST', body: { reason: '重新进入线索池分配' },
  });
  assert.equal(returned.status, 200, await returned.clone().text());
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,duplicate_state,created_at,updated_at)
    VALUES ('INTAKE-ACTIVE-DUP','BATCH-TEST','RU-9002','Active duplicate','pending','cleared',?,?),
           ('INTAKE-REVIEW','BATCH-TEST','RU-REVIEW','Review row','pending','review',?,?)`).run(
    '2026-08-05 08:00:00', '2026-08-05 08:00:00',
    '2026-08-05 08:00:00', '2026-08-05 08:00:00',
  );

  const response = await fx.request('/api/sales-crm/intake?pageSize=50', { cookie: fx.adminCookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  const byId = new Map(body.items.map(item => [item.id, item]));
  assert.equal(byId.get('INTAKE-OTHER').status, 'returned');
  assert.equal(byId.get('INTAKE-OTHER').assignable, true);
  assert.equal(byId.get('INTAKE-OTHER').assignmentBlockReason, '');
  assert.equal(byId.get('INTAKE-ACTIVE-DUP').assignable, false);
  assert.equal(byId.get('INTAKE-ACTIVE-DUP').assignmentBlockReason, '客户已在 CRM');
  assert.equal(byId.get('INTAKE-REVIEW').assignable, false);
  assert.equal(byId.get('INTAKE-REVIEW').assignmentBlockReason, '待管理层查重核验');
});

test('current filtered intake endpoint marks legacy linked sales returns assignable', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET external_customer_id='LEGACY-RU-9003',intake_item_id='',owner_id=NULL,
    lifecycle_status='recycled',recycle_kind='sales_return',assignment_status='returned'
    WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-9003',
    crm_customer_id='CRM-OTHER',status='returned',assigned_owner_id='',
    duplicate_state='',decision_reason='客户已在CRM' WHERE id='INTAKE-OTHER'`).run();

  const body = await businessList(fx, 'intake', {
    status: { operator: 'in', values: ['returned'] },
  });
  const item = body.rows.find(row => row.id === 'INTAKE-OTHER');
  assert.ok(item);
  assert.equal(item.assignable, true);
  assert.equal(item.assignmentBlockReason, '');

  const preview = await fx.requestJson('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'manual_assign_preview', itemIds: ['INTAKE-OTHER'] },
  });
  assert.equal(preview.eligibleCount, 1);
  assert.equal(preview.blockedCount, 0);
});

test('stale duplicate flags do not block the only linked sales return', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET external_customer_id='LEGACY-RU-9003',intake_item_id='',owner_id=NULL,
    lifecycle_status='recycled',recycle_kind='sales_return',assignment_status='returned'
    WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-9003',
    crm_customer_id='CRM-OTHER',status='returned',assigned_owner_id='',
    duplicate_state='exact',decision_reason='客户已在CRM' WHERE id='INTAKE-OTHER'`).run();

  const body = await businessList(fx, 'intake', {
    status: { operator: 'in', values: ['returned'] },
  });
  const item = body.rows.find(row => row.id === 'INTAKE-OTHER');
  assert.ok(item);
  assert.equal(item.assignable, true);
  assert.equal(item.assignmentBlockReason, '');

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign', itemIds: ['INTAKE-OTHER'], ownerId: 'U-OTHER', amount: 1,
      idempotencyKey: 'issue257-stale-duplicate-sales-return',
    },
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  assert.equal(result.assigned, 1);
  const saved = fx.db.prepare(`SELECT status,crm_customer_id,duplicate_state,duplicate_review_id
    FROM crm_intake_items WHERE id='INTAKE-OTHER'`).get();
  assert.deepEqual(saved, {
    status: 'assigned', crm_customer_id: 'CRM-OTHER',
    duplicate_state: 'cleared', duplicate_review_id: '',
  });
});

test('legacy duplicate rows reuse the only sales return matched by external customer id', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET intake_item_id='',owner_id=NULL,
    lifecycle_status='recycled',recycle_kind='sales_return',assignment_status='returned'
    WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-9003',
    crm_customer_id='',status='duplicate',assigned_owner_id='',
    duplicate_state='',decision_reason='客户已在CRM' WHERE id='INTAKE-OTHER'`).run();

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign', itemIds: ['INTAKE-OTHER'], ownerId: 'U-OTHER', amount: 1,
      idempotencyKey: 'issue259-legacy-external-sales-return',
    },
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  assert.equal(result.assigned, 1);
  assert.deepEqual(fx.db.prepare(`SELECT status,crm_customer_id,duplicate_state
    FROM crm_intake_items WHERE id='INTAKE-OTHER'`).get(), {
    status: 'assigned', crm_customer_id: 'CRM-OTHER', duplicate_state: 'cleared',
  });
});

test('legacy duplicate rows remain blocked when another CRM account exists', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET intake_item_id='',owner_id=NULL,
    lifecycle_status='recycled',recycle_kind='sales_return',assignment_status='returned'
    WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,intake_item_id,company_name,owner_id,lifecycle_status,
     assignment_status,created_at,updated_at)
    VALUES ('CRM-ISSUE259-DUP','LEGACY-DUP','INTAKE-OTHER','Real duplicate','U-WU',
      'active','claimed',?,?)`)
    .run('2026-08-05 10:00:00', '2026-08-05 10:00:00');
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-9003',
    crm_customer_id='',status='duplicate',assigned_owner_id='',duplicate_state=''
    WHERE id='INTAKE-OTHER'`).run();

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign', itemIds: ['INTAKE-OTHER'], ownerId: 'U-OTHER', amount: 1,
      idempotencyKey: 'issue259-legacy-duplicate-blocked',
    },
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  assert.equal(result.assigned, 0);
  assert.equal(result.blocked, 1);
  assert.equal(result.results.some(item => !item.ok && item.reason === '客户已在 CRM'), true);
});

test('high value review copy does not block a manager manual assignment', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name)
    VALUES ('BR-1257','High Value Manual Assignment')`).run();
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,decision_reason,created_at,updated_at)
    VALUES ('INTAKE-HIGH-VALUE-257','BATCH-TEST','BR-1257',
      'High Value Manual Assignment','pending','高价值客户需要经理审批',?,?)`)
    .run('2026-08-05 09:00:00', '2026-08-05 09:00:00');

  const body = await businessList(fx, 'intake', {
    search: { operator: 'contains', value: 'High Value Manual Assignment' },
  });
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].assignable, true);
  assert.equal(body.rows[0].assignmentBlockReason, '');

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign', itemIds: ['INTAKE-HIGH-VALUE-257'], ownerId: 'U-OTHER',
      amount: 1, idempotencyKey: 'issue257-high-value-manual-assignment',
    },
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  assert.equal(result.assigned, 1);
  assert.deepEqual(result.blockedReasons, {});
});

test('pre-claim return clears all assignment state', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_intake_items SET status='assigned',crm_customer_id='',
    assigned_owner_id='U-OTHER',suggested_owner_id='U-OTHER',assigned_at='2026-08-05 08:00:00',
    claim_due_at='2026-08-06 08:00:00',claimed_at='2026-08-05 08:30:00'
    WHERE id='INTAKE-OTHER'`).run();
  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      action: 'return', itemId: 'INTAKE-OTHER', reason: '退回待重新分配',
      idempotencyKey: 'issue257-preclaim-return',
    },
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(fx.db.prepare(`SELECT status,assigned_owner_id,suggested_owner_id,
    assigned_at,claim_due_at,claimed_at FROM crm_intake_items WHERE id='INTAKE-OTHER'`).get(), {
    status: 'returned',
    assigned_owner_id: '',
    suggested_owner_id: '',
    assigned_at: '',
    claim_due_at: '',
    claimed_at: '',
  });
});

test('recycle bin defaults to mismatch while explicit legacy sales returns remain readable', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='sales_return',
    recycle_reason='历史退回',previous_owner_id='U-WU',recycled_by='USR-ADMIN',
    recycled_at='2026-08-04 08:00:00' WHERE id='CRM-WU'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='mismatch',
    recycle_reason='不对口',previous_owner_id='U-MGR',recycled_by='USR-ADMIN',
    recycled_at='2026-08-05 08:00:00' WHERE id='CRM-OWN'`).run();

  const defaultResponse = await fx.request('/api/sales-crm/accounts/recycle-bin', {
    cookie: fx.adminCookie,
  });
  const defaultBody = await defaultResponse.json();
  assert.equal(defaultResponse.status, 200, defaultBody.error);
  assert.equal(defaultBody.kind, 'mismatch');
  assert.deepEqual(defaultBody.rows.map(row => row.customerId), ['CRM-OWN']);

  const legacyResponse = await fx.request('/api/sales-crm/accounts/recycle-bin?kind=sales_return', {
    cookie: fx.adminCookie,
  });
  const legacyBody = await legacyResponse.json();
  assert.equal(legacyResponse.status, 200, legacyBody.error);
  assert.equal(legacyBody.kind, 'sales_return');
  assert.deepEqual(legacyBody.rows.map(row => row.customerId), ['CRM-WU']);
});

test('current recycle workspace includes mismatch and manual deletes but never sales returns', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='sales_return',
    recycle_reason='历史退回',previous_owner_id='U-WU',recycled_by='USR-ADMIN',
    recycled_at='2026-08-04 08:00:00' WHERE id='CRM-WU'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='mismatch',
    recycle_reason='不对口',previous_owner_id='U-MGR',recycled_by='USR-ADMIN',
    recycled_at='2026-08-05 08:00:00' WHERE id='CRM-OWN'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='manual_delete',
    recycle_reason='手动删除',previous_owner_id='U-OTHER',recycled_by='USR-ADMIN',
    recycled_at='2026-08-05 09:00:00' WHERE id='CRM-OTHER'`).run();

  const schema = await fx.requestJson('/api/sales-crm/filter-schema/recycle_bin', {
    cookie: fx.adminCookie,
  });
  const kind = schema.schema.fields.find(field => field.key === 'recycle_kind');
  assert.deepEqual(kind.options.map(option => option.value).sort(), ['manual_delete', 'mismatch']);

  const body = await businessList(fx, 'recycle_bin');
  assert.equal(body.total, 2);
  assert.equal(body.authorizedTotal, 2);
  assert.deepEqual(body.rows.map(row => row.recycleKind).sort(), ['manual_delete', 'mismatch']);
  assert.equal(body.rows.some(row => row.recycleKind === 'sales_return'), false);
});

test('frontend consumes backend assignability and exposes no sales-return recycle tab', () => {
  const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
  assert.match(app, /typeof item\?\.assignable === 'boolean'/);
  assert.match(app, /assignmentBlockReason/);
  assert.doesNotMatch(app, /state\.recycleKind|recycleTabs|data-recycle-kind/);
  assert.doesNotMatch(html, /data-recycle-kind="sales_return"/);
  assert.doesNotMatch(html, /id="recycleTabs"/);
});
