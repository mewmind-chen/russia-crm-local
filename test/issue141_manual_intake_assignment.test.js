'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');

function insertIntake(db, {
  id,
  externalId,
  company,
  country = '',
  status = 'pending',
  assignedOwnerId = '',
  assignedAt = '',
}) {
  db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,country,status,assigned_owner_id,
      assigned_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    'BATCH-TEST',
    externalId,
    company,
    country,
    status,
    assignedOwnerId,
    assignedAt,
    '2026-07-29 08:00:00',
    '2026-07-29 08:00:00',
  );
}

test('lead pool exposes selection or filter based manual assignment and removes issue 138 rules UI', () => {
  const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');

  assert.match(html, /id="intakeBulkBar"/);
  assert.match(html, /id="manualAssignIntakeBtn"/);
  assert.doesNotMatch(html, /bulkAssignIntakeBtn|assignmentRulesView|data-assignment-rules-nav/);
  assert.match(js, /data-select-intake/);
  assert.match(js, /scopeType:\s*'selection'/);
  assert.match(js, /scopeType:\s*'filter'/);
  assert.match(js, /action:\s*'manual_assign_preview'/);
  assert.match(js, /action:\s*'manual_assign'/);
  assert.doesNotMatch(js, /action:\s*'bulk_assign'/);
});

test('manual assignment uses only selected leads and replays duplicate submissions safely', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  insertIntake(fx.db, {
    id: 'INT-141-SELECT-1',
    externalId: 'BR-141-SELECT-1',
    company: 'Selected One',
    country: '巴西',
  });
  insertIntake(fx.db, {
    id: 'INT-141-SELECT-2',
    externalId: 'BR-141-SELECT-2',
    company: 'Selected Two',
    country: '巴西',
  });
  insertIntake(fx.db, {
    id: 'INT-141-NOT-SELECTED',
    externalId: 'BR-141-NOT-SELECTED',
    company: 'Not Selected',
    country: '巴西',
  });

  let response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign_preview',
      itemIds: ['INT-141-SELECT-1', 'INT-141-SELECT-2'],
    },
  });
  let body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.scopeType, 'selection');
  assert.equal(body.scopeTotal, 2);
  assert.equal(body.eligibleCount, 2);
  assert.equal(body.sales.some(owner => owner.id === 'U-OTHER'), true);

  const request = {
    action: 'manual_assign',
    itemIds: ['INT-141-SELECT-1', 'INT-141-SELECT-2'],
    ownerId: 'U-OTHER',
    amount: 2,
    idempotencyKey: 'issue-141-selected-once',
  };
  response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: request,
  });
  body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.assigned, 2);

  const rows = fx.db.prepare(`SELECT id,status,assigned_owner_id
    FROM crm_intake_items WHERE id LIKE 'INT-141-%' ORDER BY id`).all();
  assert.deepEqual(rows.map(row => [row.id, row.status, row.assigned_owner_id]), [
    ['INT-141-NOT-SELECTED', 'pending', ''],
    ['INT-141-SELECT-1', 'assigned', 'U-OTHER'],
    ['INT-141-SELECT-2', 'assigned', 'U-OTHER'],
  ]);

  response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: request,
  });
  body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.assigned, 2);
  assert.equal(body.deduplicated, true);
});

test('manual assignment uses the authorized filter scope instead of selecting from the full database', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  for (let index = 1; index <= 3; index += 1) {
    insertIntake(fx.db, {
      id: `INT-141-BR-${index}`,
      externalId: `BR-141-${index}`,
      company: `Brazil ${index}`,
      country: '巴西',
    });
  }
  for (let index = 1; index <= 2; index += 1) {
    insertIntake(fx.db, {
      id: `INT-141-RU-${index}`,
      externalId: `RU-141-${index}`,
      company: `Russia ${index}`,
      country: '俄罗斯',
    });
  }

  const schemaResponse = await fx.requestJson('/api/sales-crm/filter-schema/intake', {
    cookie: fx.adminCookie,
  });
  const filterScope = {
    permissionVersion: schemaResponse.schema.permissionVersion,
    filters: {
      country: { operator: 'in', values: ['巴西'] },
    },
  };
  let response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'manual_assign_preview', filterScope },
  });
  let body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.scopeType, 'filter');
  assert.equal(body.scopeTotal, 3);
  assert.equal(body.eligibleCount, 3);

  response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign',
      filterScope,
      ownerId: 'U-OTHER',
      amount: 2,
      idempotencyKey: 'issue-141-filter-once',
    },
  });
  body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.assigned, 2);
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_intake_items WHERE id LIKE 'INT-141-RU-%' AND status='assigned'").get().count,
    0,
  );
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_intake_items WHERE id LIKE 'INT-141-BR-%' AND status='assigned'").get().count,
    2,
  );
});

test('manual assignment ignores daily quota and does not block risk information', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_intake_settings SET daily_per_sales=1 WHERE id='default'").run();
  const today = `${new Date().toISOString().slice(0, 10)} 08:00:00`;
  insertIntake(fx.db, {
    id: 'INT-141-QUOTA',
    externalId: 'BR-141-QUOTA',
    company: 'Quota Used',
    status: 'assigned',
    assignedOwnerId: 'U-OTHER',
    assignedAt: today,
  });
  insertIntake(fx.db, {
    id: 'INT-141-WAITING',
    externalId: 'BR-141-WAITING',
    company: 'Waiting',
  });
  insertIntake(fx.db, {
    id: 'INT-141-RISK',
    externalId: 'BR-0141',
    company: 'Risk Blocked',
  });
  insertIntake(fx.db, {
    id: 'INT-141-CLEAR',
    externalId: 'BR-0142',
    company: 'Risk Clear',
  });
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name,risk_status)
    VALUES ('BR-0141','Risk Blocked','sanction blocked'),
           ('BR-0142','Risk Clear','CLEAR｜未发现制裁命中')`).run();

  let response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign_preview',
      itemIds: ['INT-141-WAITING', 'INT-141-RISK', 'INT-141-CLEAR'],
    },
  });
  let body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.eligibleCount, 3);
  assert.equal(body.blockedCount, 0);
  assert.deepEqual(
    Object.keys(body.sales.find(owner => owner.id === 'U-OTHER')).sort(),
    ['id', 'name'],
  );

  response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign',
      itemIds: ['INT-141-WAITING'],
      ownerId: 'U-OTHER',
      amount: 1,
      idempotencyKey: 'issue-141-quota-block',
    },
  });
  body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.assigned, 1);
  assert.equal(
    fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='INT-141-WAITING'").get().status,
    'assigned',
  );
});

test('manual assignment has no daily or 500 item count limit', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_intake_settings SET daily_per_sales=1 WHERE id='default'").run();
  const itemIds = Array.from({ length: 501 }, (_, index) => `INT-141-NOLIMIT-${index + 1}`);
  const insert = fx.db.transaction(() => {
    itemIds.forEach((id, index) => insertIntake(fx.db, {
      id,
      externalId: `BR-141-NOLIMIT-${index + 1}`,
      company: `No Limit ${index + 1}`,
      country: '巴西',
    }));
  });
  insert();

  let response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'manual_assign_preview', itemIds },
  });
  let body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.scopeTotal, 501);
  assert.equal(body.eligibleCount, 501);

  response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign',
      itemIds,
      ownerId: 'U-OTHER',
      amount: 501,
      idempotencyKey: 'issue-141-no-count-limit',
    },
  });
  body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.assigned, 501);
});
