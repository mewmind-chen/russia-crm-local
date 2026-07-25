'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const {
  featureState,
  resolveAIHardFlags,
  setFeatureFlag,
} = require('../lib/ai_stations/feature_flags');

function hardFlags(overrides = {}) {
  return resolveAIHardFlags({
    environment: 'production',
    ai_stations: true,
    customer_enrichment: true,
    customer_enrichment_auto_trigger: true,
    sales_pack: true,
    ...overrides,
  }, {});
}

test('runtime AI flags remain subordinate to environment hard gates and dependencies', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE crm_audit_log (
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL
  )`);
  const flags = hardFlags();
  assert.equal(featureState(db, flags).sales_pack.effectiveEnabled, true);

  setFeatureFlag(db, { key: 'ai_stations', enabled: false, actorId: 'ADMIN' }, flags);
  const disabled = featureState(db, flags);
  assert.equal(disabled.ai_stations.effectiveEnabled, false);
  assert.equal(disabled.sales_pack.runtimeEnabled, true);
  assert.equal(disabled.sales_pack.effectiveEnabled, false);
  assert.equal(disabled.customer_enrichment_auto_trigger.effectiveEnabled, false);
  assert.deepEqual(db.prepare(`SELECT action,entity_id,detail_json FROM crm_audit_log`).get(), {
    action: 'ai_feature_flag_updated',
    entity_id: 'ai_stations',
    detail_json: '{"enabled":false}',
  });

  assert.throws(() => setFeatureFlag(db, {
    key: 'sales_pack', enabled: true, actorId: 'ADMIN',
  }, hardFlags({ sales_pack: false })), error =>
    error.code === 'AI_FEATURE_HARD_DISABLED' && error.statusCode === 409);
  db.close();
});

test('AI feature API is real-admin-only, persistent and reflected in bootstrap', async t => {
  const fx = await fixtures.adminFixture({
    appOptions: {
      salesCrm: {
        aiStationsEnabled: true,
        customerEnrichmentEnabled: true,
        customerEnrichmentAutoTriggerEnabled: true,
        salesPackEnabled: true,
      },
    },
  });
  t.after(() => fx.close());

  assert.equal((await fx.request('/api/sales-crm/ai/features', { cookie: fx.cookie })).status, 403);
  const listed = await fx.request('/api/sales-crm/ai/features', { cookie: fx.adminCookie });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).features.sales_pack.effectiveEnabled, true);

  const changed = await fx.request('/api/sales-crm/ai/features/sales_pack', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { enabled: false },
  });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).feature.effectiveEnabled, false);

  const bootstrap = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.equal((await bootstrap.json()).features.salesPack, false);
  const audit = fx.db.prepare(`SELECT action,entity_type,entity_id FROM crm_audit_log
    WHERE action='ai_feature_flag_updated' ORDER BY created_at DESC LIMIT 1`).get();
  assert.deepEqual(audit, {
    action: 'ai_feature_flag_updated',
    entity_type: 'ai_feature_flag',
    entity_id: 'sales_pack',
  });
});

test('runtime API cannot enable a feature whose production hard gate is closed', async t => {
  const fx = await fixtures.adminFixture({
    appOptions: {
      salesCrm: {
        aiStationsEnabled: true,
        salesPackEnabled: false,
      },
    },
  });
  t.after(() => fx.close());

  const response = await fx.request('/api/sales-crm/ai/features/sales_pack', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { enabled: true },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'AI_FEATURE_HARD_DISABLED');
});
