'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');

test('customer profile exposes manager evaluations and stable contact choices', async t => {
  const fx = await fixtures.seededFixture({
    appOptions: { salesCrm: { aiStationsEnabled: false } },
    permissions: { view_contacts: true, view_insights: true, manage_evaluations: true },
  });
  t.after(() => fx.close());

  const createdResponse = await fx.request('/api/sales-crm/contacts', {
    cookie: fx.cookie,
    method: 'POST',
    body: { customerId: 'CRM-WU', name: 'Anna Buyer', title: '采购主管' },
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200, created.error);
  assert.match(created.contact.id, /^local:P-/);

  const profile = await (await fx.request('/api/sales-crm/profile/RU-9001', { cookie: fx.cookie })).json();
  assert.equal(profile.insightAccess.canView, true);
  assert.equal(profile.insightAccess.canManage, true);
  assert.ok(profile.insights.contacts.some(contact => contact.id === created.contact.id));
  assert.ok(profile.insights.contacts.some(contact => contact.id === 'person:PERSON-WU'));

  const company = await fx.request('/api/sales-crm/evaluations', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', subjectType: 'company',
      evaluationText: '企业采购流程清晰，适合持续推进。',
    },
  });
  assert.equal(company.status, 200, await company.text());

  const contact = await fx.request('/api/sales-crm/evaluations', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', subjectType: 'contact', subjectId: created.contact.id,
      subjectName: '伪造姓名', subjectTitle: '伪造职位',
      evaluationText: '该联系人掌握供应商初筛，值得重点维护。',
    },
  });
  const contactBody = await contact.json();
  assert.equal(contact.status, 200, contactBody.error);
  assert.equal(contactBody.evaluation.subjectId, created.contact.id);
  assert.equal(contactBody.evaluation.subjectName, 'Anna Buyer');
  assert.equal(contactBody.evaluation.subjectTitle, '采购主管');

  const recon = await fx.request('/api/sales-crm/evaluations', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', subjectType: 'contact', subjectId: 'person:PERSON-WU',
      evaluationText: 'Recon 发现的采购候选需要继续确认职责。',
    },
  });
  assert.equal(recon.status, 200, await recon.text());

  const invalid = await fx.request('/api/sales-crm/evaluations', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', subjectType: 'contact', subjectId: 'local:P-NOT-OWNED',
      subjectName: '错误联系人', evaluationText: '这条评价不应被保存。',
    },
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /联系人/);
});

test('profile manager evaluation UI is separate from the customer drawer', () => {
  const root = path.resolve(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'profile-insights.js'), 'utf8');
  const salesApp = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

  assert.match(index, /profile-insights\.js/);
  assert.match(script, /data-detail-tab =?['"]insights['"]|data-detail-tab="insights"/);
  assert.match(script, /企业评价/);
  assert.match(script, /联系人评价/);
  assert.match(script, /subjectId/);
  assert.match(script, /accountContacts|insights\.contacts/);
  const crmDrawer = salesApp.match(/function renderDrawer\(\)[\s\S]*?\n  function openModal\(/)?.[0] || '';
  assert.doesNotMatch(crmDrawer, /MANAGER INSIGHT/);
  assert.doesNotMatch(crmDrawer, /CONTACT PROFILE/);
  assert.doesNotMatch(crmDrawer, /CONTACT INTELLIGENCE/);
});
