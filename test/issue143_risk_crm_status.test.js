'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');
const { installSalesCrm } = require('../lib/sales_crm');

function insertIntake(db, id, externalId, company) {
  db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    id,
    'BATCH-TEST',
    externalId,
    company,
    'pending',
    '2026-07-30 09:00:00',
    '2026-07-30 09:00:00',
  );
}

test('risk information no longer blocks manual lead assignment', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  insertIntake(fx.db, 'INT-143-RISK', 'RU-9143', 'Risk Information');
  fx.db.prepare(`UPDATE crm_intake_items
    SET decision_reason='风险拦截：需管理员审核后分配'
    WHERE id='INT-143-RISK'`).run();
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name,risk_status)
    VALUES ('RU-9143','Risk Information','sanction blocked')`).run();
  installSalesCrm();
  assert.equal(
    fx.db.prepare("SELECT decision_reason FROM crm_intake_items WHERE id='INT-143-RISK'")
      .get().decision_reason,
    '',
  );

  let response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign_preview',
      itemIds: ['INT-143-RISK'],
    },
  });
  let body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.eligibleCount, 1);
  assert.equal(body.blockedCount, 0);

  response = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign',
      itemIds: ['INT-143-RISK'],
      ownerId: 'U-OTHER',
      amount: 1,
      idempotencyKey: 'issue-143-risk-assign',
    },
  });
  body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.assigned, 1);
  assert.equal(
    fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='INT-143-RISK'").get().status,
    'assigned',
  );
});

test('CRM creation synchronizes a pending lead to a visible non-assignable status', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  insertIntake(fx.db, 'INT-143-IN-CRM', 'RU-9144', 'Already In CRM');
  fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,created_at,updated_at)
    VALUES ('CRM-143','RU-9144','Already In CRM',?,?)`)
    .run('2026-07-30 09:01:00', '2026-07-30 09:01:00');

  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,decision_reason
      FROM crm_intake_items WHERE id='INT-143-IN-CRM'`).get(),
    {
      status: 'duplicate',
      crm_customer_id: 'CRM-143',
      decision_reason: '客户已在CRM',
    },
  );

  const schemaResponse = await fx.request('/api/sales-crm/filter-schema/intake', {
    cookie: fx.adminCookie,
  });
  const schemaBody = await schemaResponse.json();
  assert.equal(schemaResponse.status, 200, schemaBody.error);
  const statusOptions = schemaBody.schema.fields.find(field => field.key === 'status').options;
  assert.equal(statusOptions.find(option => option.value === 'duplicate').label, '已在 CRM');
  assert.equal(statusOptions.find(option => option.value === 'assigned').label, '待领取');

  const listResponse = await fx.request(
    `/api/sales-crm/lists/intake?page=1&pageSize=200`
      + `&permissionVersion=${schemaBody.schema.permissionVersion}&filters=%7B%7D`,
    { cookie: fx.adminCookie },
  );
  const listBody = await listResponse.json();
  assert.equal(listResponse.status, 200, listBody.error);
  const item = listBody.rows.find(row => row.id === 'INT-143-IN-CRM');
  assert.equal(item.status, 'duplicate');
  assert.equal(item.crm_customer_id, 'CRM-143');

  const appSource = fs.readFileSync(
    path.join(__dirname, '..', 'sales-assets', 'app.js'),
    'utf8',
  );
  assert.match(appSource, /duplicate:\s*'已在 CRM'/);
  assert.match(appSource, /!Boolean\(item\?\.in_crm\)/);
});
