'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

test('contact schema accepts a master-owned row and remains idempotent', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const now = '2026-08-11 05:00:00';

  fx.db.prepare(`INSERT INTO crm_account_contacts
    (id,customer_id,external_customer_id,name,created_by,updated_by,created_at,updated_at)
    VALUES ('P-PRE','','RU-0031','Milander Buyer','USR-ADMIN','USR-ADMIN',?,?)`)
    .run(now, now);

  const { installSalesCrm } = require('../lib/sales_crm');
  installSalesCrm();
  assert.deepEqual(
    fx.db.prepare("SELECT customer_id,external_customer_id,name FROM crm_account_contacts WHERE id='P-PRE'").get(),
    { customer_id: '', external_customer_id: 'RU-0031', name: 'Milander Buyer' },
  );
  const schema = fx.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='crm_account_contacts'").get().sql;
  assert.doesNotMatch(schema, /REFERENCES\s+crm_accounts/i);
});
