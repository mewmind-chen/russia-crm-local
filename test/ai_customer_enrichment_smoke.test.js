'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildConfiguration,
  createDisposableCompanyName,
  formatReport,
  parseArguments,
  runSmoke,
} = require('../scripts/smoke-ai-customer-enrichment');

function safeEnvironment(root, overrides = {}) {
  return {
    HOME: root,
    NODE_ENV: 'development',
    CRM_PRODUCTION_ROOT: path.join(root, 'tradepulse-production'),
    CRM_RUNTIME_ROOT: path.join(root, 'tradepulse-development'),
    CRM_AI_ENRICHMENT_SMOKE_DB_PATH: path.join(root, 'tradepulse-development', 'data', 'smoke.db'),
    CRM_AI_STATIONS_ENABLED: 'true',
    CRM_AI_CUSTOMER_ENRICHMENT_ENABLED: 'true',
    CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED: 'true',
    ...overrides,
  };
}

test('smoke parser bounds wait settings and creates unique disposable names', () => {
  const parsed = parseArguments([
    'node', 'smoke-ai-customer-enrichment.js', '--dry-run',
    '--timeout-ms', '120000', '--poll-ms', '500',
  ]);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.timeoutMs, 120000);
  assert.equal(parsed.pollMs, 500);
  assert.throws(() => parseArguments([
    'node', 'smoke-ai-customer-enrichment.js', '--timeout-ms', '9999',
  ]), /between 10000 and 900000/);
  assert.throws(() => parseArguments([
    'node', 'smoke-ai-customer-enrichment.js', '--poll-ms', '10001',
  ]), /between 250 and 10000/);
  assert.notEqual(
    createDisposableCompanyName('A1-09 Smoke', () => 'one'),
    createDisposableCompanyName('A1-09 Smoke', () => 'two'),
  );
});

test('smoke configuration refuses production and requires both explicit flags', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-09-smoke-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const productionRoot = path.join(root, 'tradepulse-production');
  const productionDb = path.join(productionRoot, 'shared', 'data', 'crm.db');

  assert.throws(() => buildConfiguration({
    argv: ['node', 'smoke.js', '--dry-run'],
    env: safeEnvironment(root, {
      CRM_AI_ENRICHMENT_SMOKE_DB_PATH: productionDb,
    }),
  }), /production root/);
  assert.throws(() => buildConfiguration({
    argv: ['node', 'smoke.js', '--dry-run'],
    env: safeEnvironment(root, {
      CRM_AI_CUSTOMER_ENRICHMENT_ENABLED: '',
    }),
  }), /CRM_AI_CUSTOMER_ENRICHMENT_ENABLED=true/);
  assert.throws(() => buildConfiguration({
    argv: ['node', 'smoke.js', '--dry-run'],
    env: safeEnvironment(root, {
      CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED: 'false',
    }),
  }), /CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED=true/);
  assert.throws(() => buildConfiguration({
    argv: ['node', 'smoke.js', '--dry-run'],
    env: safeEnvironment(root, { NODE_ENV: 'production' }),
  }), /NODE_ENV=development/);
  assert.throws(() => buildConfiguration({
    argv: ['node', 'smoke.js', '--dry-run'],
    env: safeEnvironment(root, { CRM_AI_STATIONS_ENABLED: 'false' }),
  }), /CRM_AI_STATIONS_ENABLED=true/);
});

test('dry run makes no HTTP request, preserves owner intent, and never renders secrets', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-09-smoke-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = safeEnvironment(root, {
    CRM_AI_ENRICHMENT_SMOKE_EMAIL: 'smoke@example.test',
    CRM_AI_ENRICHMENT_SMOKE_PASSWORD: 'provider-secret-do-not-print',
    DEEPSEEK_API_KEY: 'provider-key-do-not-print',
    CRM_AI_ENRICHMENT_SMOKE_OWNER_ID: 'USR-SALES-1',
  });
  let fetchCalls = 0;
  const report = await runSmoke({
    argv: ['node', 'smoke.js', '--dry-run'],
    env,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('dry run must not call fetch');
    },
    nonce: () => 'fixed-nonce',
  });

  assert.equal(fetchCalls, 0);
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.ownerId, 'USR-SALES-1');
  assert.match(report.companyName, /fixed-nonce/);
  assert.deepEqual(report.allowedOperations, [
    'login',
    'read_bootstrap',
    'create_customer',
    'read_enrichment',
    'read_ai_tasks',
  ]);
  const rendered = formatReport({
    ...report,
    password: env.CRM_AI_ENRICHMENT_SMOKE_PASSWORD,
    apiKey: env.DEEPSEEK_API_KEY,
  });
  assert.doesNotMatch(rendered, /provider-secret-do-not-print|provider-key-do-not-print/);

  const source = fs.readFileSync(path.join(
    __dirname, '..', 'scripts', 'smoke-ai-customer-enrichment.js',
  ), 'utf8');
  assert.doesNotMatch(source, /\/activities|\/quotes|\/orders|\/outreach|\/messages/);
  assert.doesNotMatch(source, /patchJson|method:\s*['"]PATCH['"]/);
});
