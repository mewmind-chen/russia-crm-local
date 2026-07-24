'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const {
  normalizeMinimalCustomerInput,
} = require('../lib/ai_stations/enrichment/intake');

test('minimal input accepts a company name or canonical HTTP website', () => {
  assert.deepEqual(normalizeMinimalCustomerInput({ companyName: ' Acme ' }), {
    companyName: 'Acme',
    website: '',
    provisionalCompanyName: false,
  });
  assert.deepEqual(normalizeMinimalCustomerInput({ website: 'Example.COM:443/path?utm_source=x#part' }), {
    companyName: 'example.com',
    website: 'https://example.com/path',
    provisionalCompanyName: true,
  });
  assert.throws(() => normalizeMinimalCustomerInput({}), /公司名称或官网/);
  assert.throws(() => normalizeMinimalCustomerInput({ website: 'ftp://example.com' }), /HTTP/);
});

test('website-only account creation returns immediately with an eligible durable trigger', async t => {
  let externalCalls = 0;
  const fx = await fixtures.seededFixture({
    permissions: {
      create_customer: true,
      view_customers: true,
      use_ai_assistant: true,
      run_recon: true,
      view_recon: true,
      view_contacts: true,
    },
    appOptions: {
      salesCrm: {
        customerEnrichmentEnabled: true,
        customerEnrichmentAutoTriggerEnabled: true,
        executeCustomerEnrichment: async () => { externalCalls += 1; },
      },
    },
  });
  t.after(() => fx.close());

  const response = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.cookie,
    method: 'POST',
    body: { website: 'https://New-Example.test/?utm_campaign=x', ownerId: 'U-OTHER' },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.enrichment.state, 'pending_dispatch');
  assert.equal(body.enrichment.reasonCode, '');
  assert.equal(externalCalls, 0);
  assert.deepEqual(fx.db.prepare('SELECT company_name,country,website FROM crm_accounts WHERE id=?').get(body.customerId), {
    company_name: 'new-example.test',
    country: '',
    website: 'https://new-example.test/',
  });
});

test('missing enrichment permission creates the customer with a skipped run', async t => {
  const fx = await fixtures.seededFixture({
    permissions: {
      create_customer: true,
      view_customers: true,
      use_ai_assistant: true,
      run_recon: true,
      view_recon: true,
      view_contacts: false,
    },
    appOptions: {
      salesCrm: {
        customerEnrichmentEnabled: true,
        customerEnrichmentAutoTriggerEnabled: true,
      },
    },
  });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.cookie,
    method: 'POST',
    body: { companyName: 'Permission Gate Fixture', ownerId: 'U-OTHER' },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.deepEqual(body.enrichment, {
    runId: body.enrichment.runId,
    state: 'skipped',
    reasonCode: 'missing_permissions',
  });
  assert.ok(fx.db.prepare('SELECT 1 FROM crm_accounts WHERE id=?').get(body.customerId));
});

test('disabled auto trigger creates the customer with feature_disabled and empty input is rejected', async t => {
  const fx = await fixtures.seededFixture({
    permissions: { create_customer: true },
    appOptions: {
      salesCrm: {
        customerEnrichmentEnabled: true,
        customerEnrichmentAutoTriggerEnabled: false,
      },
    },
  });
  t.after(() => fx.close());
  const created = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.cookie,
    method: 'POST',
    body: { companyName: 'Disabled Trigger Fixture', ownerId: 'U-OTHER' },
  });
  const createdBody = await created.json();
  assert.equal(created.status, 200, createdBody.error);
  assert.equal(createdBody.enrichment.state, 'skipped');
  assert.equal(createdBody.enrichment.reasonCode, 'feature_disabled');

  const rejected = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.cookie,
    method: 'POST',
    body: { ownerId: 'U-OTHER' },
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /公司名称或官网/);
});
