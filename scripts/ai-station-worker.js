#!/usr/bin/env node
'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const { createAIStationWorker } = require('../lib/ai_stations/worker');
const {
  scheduleContactReadinessForCompletedFits,
} = require('../lib/ai_stations/contact_readiness');
const { createEnrichmentExecutors } = require('../lib/ai_stations/enrichment/executors');
const {
  resolveExplicitWebsiteIdentity,
} = require('../lib/ai_stations/enrichment/identity_resolver');
const { resolveCustomerEnrichmentFlags } = require('../lib/ai_stations/enrichment/flags');
const { dispatchPendingEnrichment } = require('../lib/ai_stations/enrichment/workflow');
const { consumePendingEnrichmentEvent } = require('../lib/ai_stations/enrichment/events');
const { resolveAIStationsEnabled } = require('../lib/ai_stations/routes');
const { databasePath } = require('../lib/runtime_paths');

const DEFAULT_EXECUTION_RESOURCES = Object.freeze({
  global: Object.freeze({ maxConcurrency: 10, rateLimit: 0, rateWindowMs: 60_000 }),
  deepseek: Object.freeze({ maxConcurrency: 4, rateLimit: 0, rateWindowMs: 60_000 }),
  web: Object.freeze({ maxConcurrency: 4, rateLimit: 0, rateWindowMs: 60_000 }),
  'kimi-cli': Object.freeze({ maxConcurrency: 1, rateLimit: 0, rateWindowMs: 60_000 }),
  hermes: Object.freeze({ maxConcurrency: 1, rateLimit: 0, rateWindowMs: 60_000 }),
});

function integerArgument(name, fallback, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function defaultExecutionResources() {
  return Object.fromEntries(Object.entries(DEFAULT_EXECUTION_RESOURCES)
    .map(([name, value]) => [name, { ...value }]));
}

function jsonObject(value, name, fallback) {
  const selected = String(value || '').trim();
  if (!selected) return fallback;
  let parsed;
  try {
    parsed = JSON.parse(selected);
  } catch (_error) {
    throw new Error(`${name} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed;
}

function executionResourcesFromEnvironment(env = process.env) {
  return jsonObject(
    env.CRM_AI_EXECUTION_RESOURCES_JSON,
    'CRM_AI_EXECUTION_RESOURCES_JSON',
    defaultExecutionResources(),
  );
}

function stationResourcesFromEnvironment(env = process.env) {
  return jsonObject(env.CRM_AI_STATION_RESOURCES_JSON, 'CRM_AI_STATION_RESOURCES_JSON', {});
}

function jsonArray(value, name, fallback = []) {
  const selected = String(value || '').trim();
  if (!selected) return fallback;
  let parsed;
  try {
    parsed = JSON.parse(selected);
  } catch (_error) {
    throw new Error(`${name} must be valid JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array`);
  return parsed;
}

function budgetConfigurationFromEnvironment(env = process.env) {
  return {
    pricing: jsonObject(env.CRM_AI_PRICING_JSON, 'CRM_AI_PRICING_JSON', {}),
    policies: jsonArray(env.CRM_AI_BUDGET_POLICIES_JSON, 'CRM_AI_BUDGET_POLICIES_JSON'),
  };
}

function enrichmentConfigurationFromEnvironment(env = process.env) {
  return resolveCustomerEnrichmentFlags({
    environment: env.NODE_ENV,
    enabled: env.CRM_AI_CUSTOMER_ENRICHMENT_ENABLED ?? '',
    autoTriggerEnabled: env.CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED ?? '',
  });
}

function openDb() {
  const db = new Database(databasePath());
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

async function main(options = {}) {
  const env = options.env || process.env;
  const argv = options.argv || process.argv;
  if (!resolveAIStationsEnabled({ configured: env.CRM_AI_STATIONS_ENABLED, environment: env.NODE_ENV })) {
    throw new Error('AI stations are disabled for this environment');
  }
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
  const budgetConfiguration = budgetConfigurationFromEnvironment(env);
  const enrichmentConfiguration = enrichmentConfigurationFromEnvironment(env);
  const worker = createAIStationWorker({
    openDb,
    workerId: env.CRM_AI_WORKER_ID,
    jobStoreOptions: {
      leaseMs: integerArgument('--lease-ms', Number(env.CRM_AI_JOB_LEASE_MS) || 60_000, argv),
      executionResources: executionResourcesFromEnvironment(env),
      resourceForStation: stationResourcesFromEnvironment(env),
    },
    budgetOptions: {
      companyId: String(env.CRM_AI_COMPANY_ID || 'default'),
      pricing: budgetConfiguration.pricing,
      onAlert: alert => process.stderr.write(`${JSON.stringify({ event: 'ai_budget_alert', ...alert })}\n`),
    },
    budgetPolicies: budgetConfiguration.policies,
    executors: createEnrichmentExecutors(),
    beforeClaim: async ({ db, workerId }) => {
      scheduleContactReadinessForCompletedFits(db);
      if (enrichmentConfiguration.enabled) {
        await dispatchPendingEnrichment(db, undefined, {
          dispatcherId: `${workerId}:customer-enrichment`,
        });
        return consumePendingEnrichmentEvent(db, `${workerId}:customer-enrichment-events`);
      }
      return null;
    },
    executorOptions: {
      identityResolver: resolveExplicitWebsiteIdentity,
      timeoutMs: integerArgument('--timeout-ms', Number(env.CRM_AI_EXECUTION_TIMEOUT_MS) || 75_000, argv),
      maxEngineAttempts: Number(env.ASSISTANT_ROUTER_MAX_ATTEMPTS) || 2,
    },
    queueHealthOptions: {
      backlogWarning: Number(env.CRM_AI_QUEUE_BACKLOG_WARNING) || 100,
      maxWaitMs: Number(env.CRM_AI_QUEUE_WAIT_WARNING_MS) || 300_000,
    },
    onQueueAlert: health => process.stderr.write(`${JSON.stringify({ event: 'ai_queue_alert', ...health })}\n`),
  });
  const result = await worker.run({
    once: argv.includes('--once'),
    limit: integerArgument('--limit', Number(env.CRM_AI_WORKER_LIMIT) || Number.MAX_SAFE_INTEGER, argv),
    idleMs: integerArgument('--idle-ms', Number(env.CRM_AI_WORKER_IDLE_MS) || 1_000, argv),
    signal: controller.signal,
  });
  if (argv.includes('--once')) process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`AI station worker failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  budgetConfigurationFromEnvironment,
  defaultExecutionResources,
  enrichmentConfigurationFromEnvironment,
  executionResourcesFromEnvironment,
  stationResourcesFromEnvironment,
  integerArgument,
  main,
};
