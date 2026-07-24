#!/usr/bin/env node
'use strict';

require('dotenv').config();
const crypto = require('node:crypto');
const { resolveRuntimePaths } = require('../lib/runtime_paths');

const TERMINAL_RUN_STATES = new Set(['succeeded', 'needs_review', 'skipped', 'cancelled']);
const ALLOWED_OPERATIONS = Object.freeze([
  'login',
  'read_bootstrap',
  'create_customer',
  'read_enrichment',
  'read_ai_tasks',
]);

function integerOption(argv, name, fallback, minimum, maximum) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function stringOption(argv, name, fallback = '') {
  const index = argv.indexOf(name);
  if (index < 0) return String(fallback || '').trim();
  const value = String(argv[index + 1] || '').trim();
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function parseArguments(argv = process.argv) {
  const known = new Set([
    '--base-url', '--db', '--timeout-ms', '--poll-ms', '--dry-run',
    '--company-name', '--website', '--country', '--owner-id',
  ]);
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!known.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    if (argument !== '--dry-run') index += 1;
  }
  return Object.freeze({
    baseUrl: stringOption(argv, '--base-url'),
    databasePath: stringOption(argv, '--db'),
    timeoutMs: integerOption(argv, '--timeout-ms', 180_000, 10_000, 900_000),
    pollMs: integerOption(argv, '--poll-ms', 1_000, 250, 10_000),
    dryRun: argv.includes('--dry-run'),
    companyName: stringOption(argv, '--company-name'),
    website: stringOption(argv, '--website'),
    country: stringOption(argv, '--country'),
    ownerId: stringOption(argv, '--owner-id'),
  });
}

function explicitlyTrue(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function createDisposableCompanyName(prefix = 'TradePulse A1-09 Smoke', nonce = () =>
  `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`) {
  return `${String(prefix || 'TradePulse A1-09 Smoke').trim()} [DISPOSABLE ${nonce()}]`;
}

function buildConfiguration(options = {}) {
  const env = options.env || process.env;
  const args = parseArguments(options.argv || process.argv);
  if (String(env.NODE_ENV || '').trim().toLowerCase() !== 'development') {
    throw new Error('Customer enrichment smoke requires NODE_ENV=development');
  }
  if (!explicitlyTrue(env.CRM_AI_STATIONS_ENABLED)) {
    throw new Error('Customer enrichment smoke requires CRM_AI_STATIONS_ENABLED=true');
  }
  if (!explicitlyTrue(env.CRM_AI_CUSTOMER_ENRICHMENT_ENABLED)) {
    throw new Error('Customer enrichment smoke requires CRM_AI_CUSTOMER_ENRICHMENT_ENABLED=true');
  }
  if (!explicitlyTrue(env.CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED)) {
    throw new Error(
      'Customer enrichment smoke requires CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED=true',
    );
  }
  const selectedDb = args.databasePath
    || String(env.CRM_AI_ENRICHMENT_SMOKE_DB_PATH || '').trim();
  if (!selectedDb) {
    throw new Error('Set CRM_AI_ENRICHMENT_SMOKE_DB_PATH or pass --db for an isolated development database');
  }
  const paths = resolveRuntimePaths({
    ...env,
    NODE_ENV: 'development',
    CRM_DB_PATH: selectedDb,
  });
  const baseUrl = (args.baseUrl
    || env.CRM_AI_ENRICHMENT_SMOKE_BASE_URL
    || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const parsedUrl = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Smoke base URL must use HTTP(S)');
  }
  const email = String(env.CRM_AI_ENRICHMENT_SMOKE_EMAIL || '').trim();
  const password = String(env.CRM_AI_ENRICHMENT_SMOKE_PASSWORD || '');
  if (!args.dryRun && (!email || !password)) {
    throw new Error(
      'Set CRM_AI_ENRICHMENT_SMOKE_EMAIL and CRM_AI_ENRICHMENT_SMOKE_PASSWORD for development',
    );
  }
  return Object.freeze({
    ...args,
    baseUrl,
    databasePath: paths.databasePath,
    email,
    password,
    companyNamePrefix: args.companyName
      || env.CRM_AI_ENRICHMENT_SMOKE_COMPANY_NAME
      || 'TradePulse A1-09 Smoke',
    website: args.website || env.CRM_AI_ENRICHMENT_SMOKE_WEBSITE || '',
    country: args.country || env.CRM_AI_ENRICHMENT_SMOKE_COUNTRY || '',
    ownerId: args.ownerId || env.CRM_AI_ENRICHMENT_SMOKE_OWNER_ID || '',
  });
}

function selectedReportFields(report) {
  return {
    mode: report.mode,
    databasePath: report.databasePath,
    baseUrl: report.baseUrl,
    companyName: report.companyName,
    customerId: report.customerId || null,
    crmAccountId: report.crmAccountId || null,
    ownerId: report.ownerId || null,
    ownerUnchanged: report.ownerUnchanged ?? null,
    runId: report.runId || null,
    runState: report.runState || null,
    nodeIds: report.nodeIds || [],
    attempts: report.attempts || [],
    totalCost: report.totalCost || 0,
    evidenceCount: report.evidenceCount ?? null,
    finalRoute: report.finalRoute || null,
    elapsedMs: report.elapsedMs ?? null,
    allowedOperations: report.allowedOperations || ALLOWED_OPERATIONS,
  };
}

function formatReport(report) {
  return JSON.stringify(selectedReportFields(report), null, 2);
}

async function responseJson(response, operation) {
  let body;
  try {
    body = await response.json();
  } catch (_error) {
    throw new Error(`${operation} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok || body.ok === false) {
    throw new Error(`${operation} failed with HTTP ${response.status}: ${body.error || 'unknown error'}`);
  }
  return body;
}

function cookieFrom(response) {
  return String(response.headers.get('set-cookie') || '').split(';')[0];
}

function makeClient(baseUrl, fetchImpl) {
  let cookie = '';
  async function request(route, init = {}) {
    const response = await fetchImpl(`${baseUrl}${route}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
    });
    return response;
  }
  return Object.freeze({
    async login(email, password) {
      const response = await request('/api/sales-auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const body = await responseJson(response, 'login');
      cookie = cookieFrom(response);
      if (!cookie) throw new Error('login succeeded without a session cookie');
      return body;
    },
    async get(route, operation) {
      return responseJson(await request(route), operation);
    },
    async post(route, payload, operation) {
      return responseJson(await request(route, {
        method: 'POST',
        body: JSON.stringify(payload),
      }), operation);
    },
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findOwner(configuration, bootstrap) {
  if (configuration.ownerId) return configuration.ownerId;
  if (bootstrap.user?.role === 'sales') return bootstrap.user.id;
  const salesUser = (bootstrap.users || []).find(user => user.role === 'sales' && user.active !== false);
  if (!salesUser) {
    throw new Error('Set CRM_AI_ENRICHMENT_SMOKE_OWNER_ID to an active development sales user');
  }
  return salesUser.id;
}

async function collectAttempts(client, detail, customerId) {
  const taskIds = new Set((detail.nodes || []).map(node => node.aiJobId).filter(Boolean));
  const tasks = await client.get(
    `/api/sales-crm/ai/tasks?customer=${encodeURIComponent(customerId)}&type=customer_fit&pageSize=100`,
    'read customer-fit tasks',
  );
  for (const item of tasks.items || []) taskIds.add(item.taskId);
  const attempts = [];
  for (const taskId of taskIds) {
    const task = await client.get(
      `/api/sales-crm/ai/tasks/${encodeURIComponent(taskId)}`,
      'read AI task detail',
    );
    for (const attempt of task.task?.attempts || task.attempts || []) {
      attempts.push({
        taskId,
        attempt: attempt.attempt,
        engine: attempt.engine || '',
        model: attempt.model || '',
        usage: attempt.usage || {},
        cost: Number(attempt.cost || 0),
        status: attempt.status || '',
      });
    }
  }
  return attempts;
}

async function runSmoke(options = {}) {
  const startedAt = Date.now();
  const configuration = buildConfiguration(options);
  const companyName = createDisposableCompanyName(
    configuration.companyNamePrefix,
    options.nonce,
  );
  const baseReport = {
    mode: configuration.dryRun ? 'dry-run' : 'live-development',
    databasePath: configuration.databasePath,
    baseUrl: configuration.baseUrl,
    companyName,
    ownerId: configuration.ownerId,
    allowedOperations: ALLOWED_OPERATIONS,
  };
  if (configuration.dryRun) return selectedReportFields(baseReport);

  const client = makeClient(configuration.baseUrl, options.fetchImpl || fetch);
  await client.login(configuration.email, configuration.password);
  const bootstrap = await client.get('/api/sales-crm/bootstrap', 'read bootstrap');
  const ownerId = findOwner(configuration, bootstrap);
  const created = await client.post('/api/sales-crm/accounts', {
    companyName,
    website: configuration.website,
    country: configuration.country,
    ownerId,
    source: 'A1-09 development smoke',
  }, 'create disposable development customer');
  if (!created.externalCustomerId || !created.customerId || !created.enrichment?.runId) {
    throw new Error('customer creation did not return enrichment identifiers');
  }

  let detail;
  const deadline = startedAt + configuration.timeoutMs;
  do {
    detail = await client.get(
      `/api/sales-crm/ai/customers/${encodeURIComponent(created.externalCustomerId)}/enrichment`,
      'read enrichment',
    );
    if (TERMINAL_RUN_STATES.has(detail.run?.state)) break;
    if (Date.now() >= deadline) {
      throw new Error(
        `enrichment ${created.enrichment.runId} did not finish within ${configuration.timeoutMs}ms`,
      );
    }
    await (options.sleep || sleep)(configuration.pollMs);
  } while (true);

  const attempts = await collectAttempts(client, detail, created.externalCustomerId);
  const after = await client.get('/api/sales-crm/bootstrap', 'verify customer owner');
  const account = (after.accounts || []).find(item => item.id === created.customerId);
  if (!account) throw new Error('created disposable customer is not visible after enrichment');
  if (account.owner_id !== ownerId) throw new Error('enrichment changed the customer owner');

  return selectedReportFields({
    ...baseReport,
    ownerId,
    ownerUnchanged: true,
    customerId: created.externalCustomerId,
    crmAccountId: created.customerId,
    runId: detail.run.id,
    runState: detail.run.state,
    nodeIds: (detail.nodes || []).map(node => ({
      nodeKey: node.nodeKey,
      aiJobId: node.aiJobId,
      legacyTaskId: node.legacyTask?.taskId || null,
      state: node.state,
    })),
    attempts,
    totalCost: attempts.reduce((sum, attempt) => sum + Number(attempt.cost || 0), 0),
    evidenceCount: (detail.evidence || []).length,
    finalRoute: detail.run.routeState,
    elapsedMs: Date.now() - startedAt,
  });
}

async function main() {
  const report = await runSmoke();
  process.stdout.write(`${formatReport(report)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Customer enrichment smoke failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_OPERATIONS,
  buildConfiguration,
  createDisposableCompanyName,
  formatReport,
  parseArguments,
  runSmoke,
};
