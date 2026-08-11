'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

async function body(response) {
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error);
  return payload;
}

test('one master contact remains the same row before and after claim', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("INSERT INTO customer_pool(customer_id,company_name) VALUES ('RU-0031','Milander')").run();
  fx.db.prepare(`UPDATE crm_intake_items SET external_customer_id='RU-0031',company_name='Milander',
    status='assigned',assigned_owner_id='U-OTHER',assigned_at='2026-08-11 05:00:00'
    WHERE id='INTAKE-OTHER'`).run();

  const created = await body(await fx.request('/api/sales-crm/contacts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { externalCustomerId: 'RU-0031', name: 'Milander Buyer' },
  }));
  const rawId = created.contact.rawId;

  const before = await body(await fx.request('/api/sales-crm/intake/INTAKE-OTHER/profile', {
    cookie: fx.otherCookie,
  }));
  assert.equal(before.profileAccess.crmAccessible, false);
  assert.equal(before.contactAccess.canMaintain, true);
  assert.equal(before.accountContacts[0].rawId, rawId);

  await body(await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-OTHER', idempotencyKey: 'issue276-claim' },
  }));
  const after = await body(await fx.request('/api/sales-crm/profile/RU-0031', {
    cookie: fx.otherCookie,
  }));
  assert.equal(after.contactAccess.canMaintain, true);
  assert.equal(after.accountContacts[0].rawId, rawId);
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_account_contacts WHERE external_customer_id='RU-0031'").get().n, 1);
});
