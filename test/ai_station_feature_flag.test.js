'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { resolveAIStationsEnabled } = require('../lib/ai_stations/routes');

test('AI stations default off in production and on outside production', () => {
  assert.equal(resolveAIStationsEnabled({ environment: 'production', configured: '' }), false);
  assert.equal(resolveAIStationsEnabled({ environment: 'development', configured: '' }), true);
  assert.equal(resolveAIStationsEnabled({ environment: 'test', configured: '' }), true);
});

test('AI station feature flag parses explicit values fail closed', () => {
  assert.equal(resolveAIStationsEnabled({ environment: 'production', configured: 'true' }), true);
  assert.equal(resolveAIStationsEnabled({ environment: 'development', configured: 'false' }), false);
  assert.equal(resolveAIStationsEnabled({ environment: 'development', configured: 'unexpected' }), false);
  assert.equal(resolveAIStationsEnabled({ enabled: false, environment: 'development', configured: 'true' }), false);
});

test('disabled AI stations stay out of bootstrap and do not install persistence tables', async t => {
  const fx = await fixtures.seededFixture({
    appOptions: { salesCrm: { aiStationsEnabled: false } },
    permissions: { view_customers: true, use_ai_assistant: true },
  });
  t.after(() => fx.close());

  const bootstrap = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  assert.equal(bootstrap.status, 200);
  assert.deepEqual((await bootstrap.json()).features, {
    aiStations: false,
    customerEnrichment: false,
    customerEnrichmentAutoTrigger: false,
    salesPack: false,
  });
  assert.equal((await fx.request('/api/sales-crm/ai/customers/RU-9002/results', { cookie: fx.cookie })).status, 404);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='crm_ai_jobs'").get().count, 0);
});
