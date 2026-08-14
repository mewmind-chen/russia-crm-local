'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

const IDENTITY_REVIEW_REASON = '疑似重名，等待管理员确认';
const AT = '2026-08-05 08:00:00';

function seedIdentityWarningItem(fx, id = 'INTAKE-WARN', externalCustomerId = 'RU-9111') {
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name) VALUES (?,?)`)
    .run('RU-9111', 'Same Lead Name');
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name) VALUES (?,?)`)
    .run('RU-9112', 'Same Lead Name');
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    id, 'BATCH-TEST', externalCustomerId, 'Same Lead Name', 'pending', '', AT, AT,
  );
}

function itemState(fx, id) {
  return fx.db.prepare(`SELECT status,assigned_owner_id,decision_reason,duplicate_state
    FROM crm_intake_items WHERE id=?`).get(id);
}

async function timedRequest(fx, route, options) {
  const started = Date.now();
  const response = await fx.request(route, options);
  return { response, elapsed: Date.now() - started };
}

test('manual assignment preview blocks identity-warning items with the business reason', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIdentityWarningItem(fx);

  const { response, elapsed } = await timedRequest(fx, '/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'manual_assign_preview', itemIds: ['INTAKE-WARN'] },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.eligibleCount, 0);
  assert.equal(body.blockedCount, 1);
  assert.equal(body.blockedReasons[IDENTITY_REVIEW_REASON], 1);
  assert.ok(elapsed < 2000, `preview responded fast (${elapsed}ms)`);
});

test('manual assignment submit for identity-warning items writes nothing and reports the reason', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIdentityWarningItem(fx);
  const before = itemState(fx, 'INTAKE-WARN');

  const { response, elapsed } = await timedRequest(fx, '/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign', itemIds: ['INTAKE-WARN'], ownerId: 'U-OTHER',
      amount: 1, idempotencyKey: 'issue306-identity-warning-manual-assign',
    },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.assigned, 0);
  assert.equal(body.blocked, 1);
  assert.equal(body.blockedReasons[IDENTITY_REVIEW_REASON], 1);
  assert.ok(body.results.some(item => !item.ok && item.reason === IDENTITY_REVIEW_REASON));
  assert.ok(elapsed < 2000, `submit responded fast (${elapsed}ms)`);

  assert.deepEqual(itemState(fx, 'INTAKE-WARN'), before, 'no intake owner/status changes');
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_accounts
    WHERE external_customer_id='RU-9111'`).get().count, 0, 'no account created');
});

test('filtered preview then submit for identity-warning items avoids preview-expiry errors', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIdentityWarningItem(fx);
  const schema = await fx.requestJson('/api/sales-crm/filter-schema/intake', {
    cookie: fx.adminCookie,
  });
  const filterScope = {
    permissionVersion: schema.schema.permissionVersion,
    filters: { search: { operator: 'contains', value: 'Same Lead Name' } },
  };

  const preview = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'manual_assign_preview', filterScope, allFiltered: true },
  });
  assert.equal(preview.status, 200, await preview.clone().text());
  const previewBody = await preview.json();
  assert.equal(previewBody.eligibleCount, 0);
  assert.equal(previewBody.blockedReasons[IDENTITY_REVIEW_REASON], 1);
  assert.ok(previewBody.previewToken, 'filter preview issues a preview token');

  const submitted = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign', filterScope, allFiltered: true,
      ownerId: 'U-OTHER', amount: 1, previewToken: previewBody.previewToken,
      idempotencyKey: 'issue306-identity-warning-filtered-assign',
    },
  });
  assert.equal(submitted.status, 200, await submitted.clone().text());
  const body = await submitted.json();
  assert.notEqual(body.code, 'ASSIGNMENT_PREVIEW_EXPIRED');
  assert.equal(body.assigned, 0);
  assert.equal(body.blocked, 1);
  assert.equal(body.blockedReasons[IDENTITY_REVIEW_REASON], 1);
  assert.equal(fx.db.prepare(`SELECT status FROM crm_intake_items WHERE id='INTAKE-WARN'`).get().status, 'pending');
});

test('intake list exposes the unified business reason for identity-warning items', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIdentityWarningItem(fx);

  const response = await fx.request('/api/sales-crm/intake?pageSize=50', { cookie: fx.adminCookie });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  const item = body.items.find(row => row.id === 'INTAKE-WARN');
  assert.ok(item, 'identity-warning item appears in the intake list');
  assert.equal(item.assignable, false);
  assert.equal(item.assignmentBlockReason, IDENTITY_REVIEW_REASON);
});
