'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { databaseIdentity } = require('../lib/release_health');

const {
  buildConfiguration,
  createDisposableCompanyName,
  formatReport,
  makeClient,
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
    CRM_AI_ENRICHMENT_SMOKE_BASE_URL: 'http://127.0.0.1:3100',
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
  assert.throws(() => buildConfiguration({
    argv: ['node', 'smoke.js', '--dry-run'],
    env: safeEnvironment(root, { CRM_AI_ENRICHMENT_SMOKE_BASE_URL: 'http://127.0.0.1:3000' }),
  }), /production port 3000/);
  assert.throws(() => buildConfiguration({
    argv: ['node', 'smoke.js', '--dry-run'],
    env: safeEnvironment(root, { CRM_AI_ENRICHMENT_SMOKE_BASE_URL: 'https://crm.example.test' }),
  }), /loopback development server/);
  assert.throws(() => buildConfiguration({
    argv: ['node', 'smoke.js', '--dry-run'],
    env: safeEnvironment(root, {
      CRM_AI_ENRICHMENT_SMOKE_BASE_URL: 'http://user:secret@localhost:3100',
    }),
  }), /cannot contain credentials/);
  assert.throws(() => buildConfiguration({
    argv: ['node', 'smoke.js', '--dry-run'],
    env: safeEnvironment(root, {
      CRM_AI_ENRICHMENT_SMOKE_BASE_URL: 'http://localhost:3100/?token=secret',
    }),
  }), /query parameters/);
});

test('smoke HTTP client aborts a hung request at the shared deadline', async () => {
  const client = makeClient('http://127.0.0.1:3100', (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }), Date.now() + 25);
  await assert.rejects(client.get('/healthz', 'bounded health check'), /deadline exceeded/);
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
    'verify_development_runtime',
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

test('live smoke verifies database identity and reports the terminal API result', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-09-smoke-live-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = safeEnvironment(root, {
    CRM_AI_ENRICHMENT_SMOKE_EMAIL: 'sales@example.test',
    CRM_AI_ENRICHMENT_SMOKE_PASSWORD: 'development-only-password',
  });
  const dbPath = path.join(root, 'tradepulse-development', 'data', 'smoke.db');
  const calls = [];
  let bootstrapCount = 0;
  const json = (body, init = {}) => new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, method: init.method || 'GET', signal: init.signal });
    if (parsed.pathname === '/healthz') {
      return json({
        ok: true,
        database: 'ok',
        releaseSha: 'a'.repeat(40),
        developmentDatabaseIdentity: databaseIdentity(dbPath),
      });
    }
    if (parsed.pathname === '/api/sales-auth/login') {
      return json({ ok: true, user: { id: 'USR-SALES', role: 'sales' } }, {
        headers: { 'set-cookie': 'sales_session=fixture; Path=/; HttpOnly' },
      });
    }
    if (parsed.pathname === '/api/sales-crm/bootstrap') {
      bootstrapCount += 1;
      return json({
        ok: true,
        user: { id: 'USR-SALES', role: 'sales' },
        users: [{ id: 'USR-SALES', role: 'sales', active: true }],
        accounts: bootstrapCount > 1
          ? [{ id: 'CRM-SMOKE', external_customer_id: 'CN-SMOKE', owner_id: 'USR-SALES' }]
          : [],
      });
    }
    if (parsed.pathname === '/api/sales-crm/accounts') {
      return json({
        ok: true,
        customerId: 'CRM-SMOKE',
        externalCustomerId: 'CN-SMOKE',
        enrichment: { runId: 'AER-SMOKE', state: 'pending_dispatch' },
      });
    }
    if (parsed.pathname === '/api/sales-crm/ai/customers/CN-SMOKE/enrichment') {
      return json({
        ok: true,
        run: {
          id: 'AER-SMOKE',
          state: 'needs_review',
          routeState: 'needs_review',
        },
        nodes: [{
          nodeKey: 'identity_verify',
          aiJobId: 'AIJ-IDENTITY',
          legacyTask: null,
          state: 'succeeded',
        }],
        evidence: [{ id: 'EVIDENCE-1' }, { id: 'EVIDENCE-2' }],
      });
    }
    if (parsed.pathname === '/api/sales-crm/ai/tasks') {
      return json({ ok: true, items: [{ taskId: 'AIJ-FIT' }] });
    }
    if (parsed.pathname === '/api/sales-crm/ai/tasks/AIJ-IDENTITY') {
      return json({
        ok: true,
        task: {
          attempts: [{
            attempt: 1,
            engine: 'development-engine',
            model: 'development-model',
            usage: { input_tokens: 10, output_tokens: 5 },
            cost: 0.002,
            status: 'succeeded',
          }],
        },
      });
    }
    if (parsed.pathname === '/api/sales-crm/ai/tasks/AIJ-FIT') {
      return json({
        ok: true,
        task: {
          attempts: [{
            attempt: 1,
            engine: 'development-engine',
            model: 'development-model',
            usage: { input_tokens: 20, output_tokens: 8 },
            cost: 0.003,
            status: 'succeeded',
          }],
        },
      });
    }
    return json({ ok: false, error: `unexpected route ${parsed.pathname}` }, { status: 404 });
  };

  const report = await runSmoke({
    argv: ['node', 'smoke.js', '--timeout-ms', '10000'],
    env,
    fetchImpl,
    nonce: () => 'live-fixture',
  });

  assert.equal(report.runId, 'AER-SMOKE');
  assert.equal(report.runState, 'needs_review');
  assert.equal(report.finalRoute, 'needs_review');
  assert.equal(report.evidenceCount, 2);
  assert.equal(report.ownerUnchanged, true);
  assert.equal(report.attempts.length, 2);
  assert.equal(report.totalCost, 0.005);
  assert.equal(calls[0].path, '/healthz');
  assert.equal(calls.find(item => item.path === '/api/sales-crm/accounts').method, 'POST');
  assert.ok(calls.every(item => item.signal instanceof AbortSignal));
  assert.equal(calls.some(item => item.method === 'PATCH'), false);
});

test('live smoke refuses a mismatched server database before login or mutation', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-09-smoke-mismatch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = safeEnvironment(root, {
    CRM_AI_ENRICHMENT_SMOKE_EMAIL: 'sales@example.test',
    CRM_AI_ENRICHMENT_SMOKE_PASSWORD: 'development-only-password',
  });
  let calls = 0;
  await assert.rejects(runSmoke({
    argv: ['node', 'smoke.js', '--timeout-ms', '10000'],
    env,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        ok: true,
        developmentDatabaseIdentity: 'different-database',
      }), { headers: { 'content-type': 'application/json' } });
    },
  }), /database identity does not match/);
  assert.equal(calls, 1);
});
