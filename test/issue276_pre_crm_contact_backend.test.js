'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

async function json(response) {
  return { status: response.status, body: await response.json() };
}

test('admin and assigned sales maintain master contacts without creating a CRM account', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("INSERT INTO customer_pool(customer_id,company_name) VALUES ('RU-0031','Milander')").run();
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-0031',company_name='Milander',
    status='assigned',assigned_owner_id='U-OTHER' WHERE id='INTAKE-OTHER'`).run();

  const adminCreated = await json(await fx.request('/api/sales-crm/contacts', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { externalCustomerId: 'RU-0031', name: 'Admin Contact' },
  }));
  assert.equal(adminCreated.status, 200, adminCreated.body.error);

  const salesCreated = await json(await fx.request('/api/sales-crm/contacts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { externalCustomerId: 'RU-0031', name: 'Milander Buyer', email: 'buyer@milandr.test' },
  }));
  assert.equal(salesCreated.status, 200, salesCreated.body.error);
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_accounts WHERE external_customer_id='RU-0031'").get().n, 0);
  assert.deepEqual(
    fx.db.prepare('SELECT customer_id,external_customer_id FROM crm_account_contacts WHERE id=?')
      .get(salesCreated.body.contact.rawId),
    { customer_id: '', external_customer_id: 'RU-0031' },
  );
});

test('foreign sales cannot maintain a master assigned to someone else', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("INSERT INTO customer_pool(customer_id,company_name) VALUES ('RU-0031','Milander')").run();
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-0031',company_name='Milander',
    status='assigned',assigned_owner_id='U-WU' WHERE id='INTAKE-OTHER'`).run();

  const response = await fx.request('/api/sales-crm/contacts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { externalCustomerId: 'RU-0031', name: 'Foreign Contact' },
  });
  assert.equal([403, 404].includes(response.status), true);
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_account_contacts WHERE external_customer_id='RU-0031'").get().n, 0);
});
