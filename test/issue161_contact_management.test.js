'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');
const { ROLE_PERMISSIONS } = require('../lib/access_control');

test('dedicated contact permission is configurable through groups and personal overrides', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  assert.equal(ROLE_PERMISSIONS.sales.manage_customer_contacts, true);

  const denied = await fx.request('/api/sales-crm/users/U-OTHER/permission-overrides', {
    cookie: fx.adminCookie,
    method: 'PUT',
    body: {
      permissions: { ...ROLE_PERMISSIONS.sales, manage_customer_contacts: false },
    },
  });
  assert.equal(denied.status, 200);
  const capabilities = await (await fx.request('/api/session/capabilities', {
    cookie: fx.otherCookie,
  })).json();
  assert.equal(capabilities.permissions.manage_customer_contacts, false);

  const blocked = await fx.request('/api/sales-crm/contacts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { customerId: 'CRM-OTHER', name: 'Blocked contact' },
  });
  assert.equal(blocked.status, 403);
});

test('contact maintenance enforces ownership and preserves the asset across reassignment', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_contacts: true, manage_customer_contacts: true },
  });
  t.after(() => fx.close());

  const createdResponse = await fx.request('/api/sales-crm/contacts', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN',
      name: 'Anna Buyer',
      title: '采购经理',
      department: '采购部',
      phone: '+7 100 200',
      email: 'anna@example.test',
      social: 'Telegram: @anna',
    },
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200, created.error);
  assert.match(created.contact.id, /^local:P-/);
  assert.equal(created.contact.externalCustomerId, 'RU-9002');

  const otherCookie = await fx.login('other@example.com', 'Password123!');
  const crossScope = await fx.request(`/api/sales-crm/contacts/${encodeURIComponent(created.contact.id)}`, {
    cookie: otherCookie,
    method: 'PATCH',
    body: { ...created.contact, title: '越权修改' },
  });
  assert.equal(crossScope.status, 403);

  const updatedResponse = await fx.request(`/api/sales-crm/contacts/${encodeURIComponent(created.contact.id)}`, {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { ...created.contact, title: '高级采购经理' },
  });
  const updated = await updatedResponse.json();
  assert.equal(updatedResponse.status, 200, updated.error);
  assert.equal(updated.contact.title, '高级采购经理');

  fx.db.prepare("UPDATE crm_accounts SET owner_id='U-OTHER' WHERE id='CRM-OWN'").run();
  const oldOwnerProfile = await fx.request('/api/sales-crm/profile/RU-9002', { cookie: fx.cookie });
  assert.equal(oldOwnerProfile.status, 403);
  const newOwnerProfileResponse = await fx.request('/api/sales-crm/profile/RU-9002', {
    cookie: otherCookie,
  });
  const newOwnerProfile = await newOwnerProfileResponse.json();
  assert.equal(newOwnerProfileResponse.status, 200, newOwnerProfile.error);
  assert.equal(newOwnerProfile.contactAccess.canMaintain, true);
  assert.ok(newOwnerProfile.accountContacts.some(contact =>
    contact.id === created.contact.id && contact.title === '高级采购经理'));

  const archivedResponse = await fx.request(`/api/sales-crm/contacts/${encodeURIComponent(created.contact.id)}/archive`, {
    cookie: otherCookie,
    method: 'POST',
    body: {},
  });
  assert.equal(archivedResponse.status, 200);
  const afterArchive = await (await fx.request('/api/sales-crm/profile/RU-9002', {
    cookie: otherCookie,
  })).json();
  assert.ok(!afterArchive.accountContacts.some(contact => contact.id === created.contact.id));
  const stored = fx.db.prepare('SELECT archived_at,created_by,updated_by,archived_by,external_customer_id FROM crm_account_contacts WHERE id=?')
    .get(created.contact.rawId);
  assert.ok(stored.archived_at);
  assert.equal(stored.created_by, 'U-MGR');
  assert.equal(stored.updated_by, 'U-OTHER');
  assert.equal(stored.archived_by, 'U-OTHER');
  assert.equal(stored.external_customer_id, 'RU-9002');
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_audit_log WHERE entity_id=? AND action LIKE 'customer_contact_%'")
    .get(created.contact.rawId).n, 3);
});

test('full customer profile installs a standalone contact tab and does not depend on manager evaluation UI', () => {
  const root = path.resolve(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'profile-contacts.js'), 'utf8');
  const salesApp = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

  assert.match(index, /profile-contacts\.js/);
  assert.match(script, /dataDetailTab|dataset\.detailTab = 'contacts'|data-detail-tab=\\"contacts\\"/);
  assert.match(script, /联系人资产/);
  assert.match(script, /data-contact-add/);
  assert.match(script, /data-contact-edit/);
  assert.match(script, /data-contact-archive/);
  assert.match(script, /sourceLabel/);
  assert.doesNotMatch(salesApp, /canEvaluate \? '<button class="button secondary tiny" data-add-contact/);
});
