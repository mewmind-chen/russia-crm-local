'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const profileContacts = fs.readFileSync(path.join(root, 'profile-contacts.js'), 'utf8');

test('Issue 233 contact flags persist with Chinese labels', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const created = await fx.requestJson('/api/sales-crm/contacts', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN',
      name: 'Flag Buyer',
      matchStatus: 'match',
      procurementRole: 'yes',
      workContent: '老板，负责采购与供应商审批',
    },
  });
  assert.equal(created.contact.matchStatus, 'match');
  assert.equal(created.contact.matchStatusLabel, '对口');
  assert.equal(created.contact.procurementRole, 'yes');
  assert.equal(created.contact.procurementRoleLabel, '负责采购');
  assert.equal(created.contact.workContent, '老板，负责采购与供应商审批');

  const updated = await fx.requestJson(
    `/api/sales-crm/contacts/${encodeURIComponent(created.contactId)}`,
    {
      cookie: fx.adminCookie,
      method: 'PATCH',
      body: { matchStatus: 'mismatch', procurementRole: 'no' },
    },
  );
  assert.equal(updated.contact.matchStatusLabel, '不对口');
  assert.equal(updated.contact.procurementRoleLabel, '不负责采购');
  assert.equal(updated.contact.workContent, '老板，负责采购与供应商审批');

  const audit = fx.db.prepare(`SELECT detail_json FROM crm_audit_log
    WHERE action='customer_contact_updated' AND entity_id=?
    ORDER BY created_at DESC,id DESC LIMIT 1`).get(created.contact.rawId);
  assert.ok(audit);
  const detail = JSON.parse(audit.detail_json);
  assert.ok(detail.changedFields.includes('matchStatus'));
  assert.ok(detail.changedFields.includes('procurementRole'));
});

test('Issue 233 contacts sort match and procurement owners first', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const create = async (name, flags) => fx.requestJson('/api/sales-crm/contacts', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { customerId: 'CRM-OWN', name, ...flags },
  });
  await create('Ann Pending', {});
  await create('Cara Mismatch', { matchStatus: 'mismatch', procurementRole: 'no' });
  await create('Bob Match', { matchStatus: 'match', procurementRole: 'yes' });

  const profile = await fx.requestJson('/api/sales-crm/profile/RU-9002', {
    cookie: fx.adminCookie,
  });
  const names = (profile.accountContacts || []).map(contact => contact.name);
  assert.deepEqual(names.slice(0, 3), ['Bob Match', 'Ann Pending', 'Cara Mismatch']);
});

test('Issue 233 contact writes stay permission-scoped', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-MGR', { manage_customer_contacts: false });
  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  const denied = await fx.request('/api/sales-crm/contacts', {
    cookie: managerCookie,
    method: 'POST',
    body: { customerId: 'CRM-OWN', name: 'No Permission' },
  });
  assert.equal(denied.status, 403);

  const outOfScope = await fx.request('/api/sales-crm/contacts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { customerId: 'CRM-OWN', name: 'Out Of Scope' },
  });
  assert.equal([403, 404].includes(outOfScope.status), true, String(outOfScope.status));
});

test('Issue 233 frontend contact form exposes the three flags and an edit entry', () => {
  assert.match(profileContacts, /matchStatus/);
  assert.match(profileContacts, /procurementRole/);
  assert.match(profileContacts, /workContent/);
  assert.match(profileContacts, /data-contact-edit/);
  assert.match(profileContacts, /sourceLabel/);
  assert.doesNotMatch(app, /CONTACT PROFILE/);
});
