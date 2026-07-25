'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fixtures = require('./helpers/permission_fixture');
const { featureState, resolveAIHardFlags, setFeatureFlag } = require('../lib/ai_stations/feature_flags');
const { getStation, renderPrompt } = require('../lib/ai_stations/prompt_registry');
const { validateStationOutput } = require('../lib/ai_stations/contracts');
const { createAIStationWorker } = require('../lib/ai_stations/worker');

function output(overrides = {}) {
  return {
    version: 'v1',
    summary: 'Verified manufacturer with an active component sourcing signal.',
    entryPoints: ['Lead with the verified MCU requirement.'],
    risks: ['Confirm the current purchasing window.'],
    draft: {
      channel: 'email',
      subject: 'Component sourcing support',
      body: 'Hello, we can support the verified requirement. Please review availability with us.',
    },
    evidenceIds: ['EV-1'],
    confidence: 0.86,
    reviewRequired: true,
    ...overrides,
  };
}

test('sales_pack has a strict, versioned output contract and evidence allowlist', () => {
  assert.equal(getStation('sales_pack', 'v1').name, 'sales_pack');
  assert.equal(validateStationOutput('sales_pack', 'v1', output(), {
    evidenceIds: ['EV-1', 'EV-2'],
  }).ok, true);
  const invented = validateStationOutput('sales_pack', 'v1', output({
    evidenceIds: ['EV-INVENTED'],
  }), { evidenceIds: ['EV-1'] });
  assert.equal(invented.ok, false);
  assert.match(invented.errors.join(' '), /not allowed/);
  assert.equal(validateStationOutput('sales_pack', 'v1', output({
    draft: { channel: 'automatic_send', subject: '', body: 'Do it' },
  }), { evidenceIds: ['EV-1'] }).ok, false);
});

test('sales_pack prompt requires contact and recon permissions and forbids business mutations', () => {
  const station = getStation('sales_pack');
  assert.deepEqual(station.requiredPermissions, ['view_contacts', 'view_recon']);
  const prompt = renderPrompt('sales_pack', {
    actor: {
      id: 'U-SALES',
      role: 'sales',
      permissions: ['use_ai_assistant', 'view_customers', 'view_contacts', 'view_recon'],
    },
    trustedCrmContext: { customerId: 'RU-1' },
    evidence: [{ id: 'EV-1', value: 'Verified requirement' }],
  });
  assert.match(prompt.systemPolicy, /Never send messages or change CRM data/);
});

test('claiming a lead enqueues one sales_pack job without blocking the claim', async t => {
  const fx = await fixtures.seededFixture({
    appOptions: {
      salesCrm: {
        aiStationsEnabled: true,
        salesPackEnabled: true,
      },
    },
  });
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { use_ai_assistant: true });
  fx.db.prepare("INSERT INTO customer_pool(customer_id,company_name) VALUES ('BR-9004','Intake Other')").run();
  const cookie = await fx.login('other@example.com', 'Password123!');

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-OTHER' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.salesPackJobId, /^AIJ-/);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_ai_jobs
    WHERE station='sales_pack' AND event_type='customer_claimed' AND event_id='INTAKE-OTHER'`).get().count, 1);
  assert.equal(fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='INTAKE-OTHER'").get().status, 'claimed');
});

test('AI enqueue failures never roll back a successful lead claim', async t => {
  const fx = await fixtures.seededFixture({
    appOptions: {
      salesCrm: {
        aiStationsEnabled: true,
        salesPackEnabled: true,
      },
    },
  });
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { use_ai_assistant: true });
  const cookie = await fx.login('other@example.com', 'Password123!');

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie,
    method: 'POST',
    body: { action: 'claim', itemId: 'INTAKE-OTHER' },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).salesPackJobId, '');
  assert.equal(fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='INTAKE-OTHER'").get().status, 'claimed');
});

test('runtime disable leaves sales_pack queued; re-enable executes, persists and notifies internally', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: {
      use_ai_assistant: true,
      view_customers: true,
      view_contacts: true,
      view_recon: true,
    },
    appOptions: {
      salesCrm: {
        aiStationsEnabled: true,
        salesPackEnabled: true,
      },
    },
  });
  t.after(() => fx.close());
  const hard = resolveAIHardFlags({
    environment: 'production',
    ai_stations: true,
    customer_enrichment: false,
    customer_enrichment_auto_trigger: false,
    sales_pack: true,
  }, {});
  const queuedResponse = await fx.request('/api/sales-crm/ai/customers/RU-9002/stations/sales_pack/run', {
    cookie: fx.cookie,
    method: 'POST',
  });
  assert.equal(queuedResponse.status, 202);
  const queued = (await queuedResponse.json()).job;

  setFeatureFlag(fx.db, { key: 'sales_pack', enabled: false, actorId: 'USR-ADMIN' }, hard);
  let modelCalls = 0;
  const worker = createAIStationWorker({
    workerId: 'sales-pack-test-worker',
    openDb: () => new Database(fx.dbPath),
    isJobEnabled: ({ db, job }) => {
      const features = featureState(db, hard);
      return features.ai_stations.effectiveEnabled
        && (job.station !== 'sales_pack' || features.sales_pack.effectiveEnabled);
    },
    executorOptions: {
      modelCall: async messages => {
        modelCalls += 1;
        const input = JSON.parse(messages[1].content);
        return {
          answer: JSON.stringify(output({
            evidenceIds: input.evidence.slice(0, 2).map(item => item.id),
          })),
          engine: 'test',
          model: 'sales-pack-fixture',
          usage: { inputTokens: 100, outputTokens: 80 },
          cost: 0,
        };
      },
    },
  });

  assert.equal((await worker.runOnce()).status, 'idle');
  assert.equal(fx.db.prepare('SELECT state FROM crm_ai_jobs WHERE id=?').get(queued.id).state, 'queued');
  assert.equal(modelCalls, 0);

  setFeatureFlag(fx.db, { key: 'sales_pack', enabled: true, actorId: 'USR-ADMIN' }, hard);
  assert.equal((await worker.runOnce()).status, 'succeeded');
  assert.equal(modelCalls, 1);

  const resultResponse = await fx.request('/api/sales-crm/ai/customers/RU-9002/results', {
    cookie: fx.cookie,
  });
  assert.equal(resultResponse.status, 200);
  const result = (await resultResponse.json()).salesPack.result;
  assert.equal(result.value.draft.channel, 'email');
  assert.equal(result.value.reviewRequired, true);
  assert.deepEqual(fx.db.prepare(`SELECT code,status,wecom_status FROM crm_notifications
    WHERE dedupe_key=?`).get(`sales-pack:${queued.id}:ready`), {
    code: 'SALES_PACK_READY',
    status: 'unread',
    wecom_status: 'disabled',
  });
});
