'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  budgetConfigurationFromEnvironment,
  defaultExecutionResources,
  executionResourcesFromEnvironment,
  stationResourcesFromEnvironment,
} = require('../scripts/ai-station-worker');

test('independent Worker exposes safe default global and engine concurrency', () => {
  assert.deepEqual(defaultExecutionResources(), {
    global: { maxConcurrency: 10, rateLimit: 0, rateWindowMs: 60_000 },
    deepseek: { maxConcurrency: 4, rateLimit: 0, rateWindowMs: 60_000 },
    web: { maxConcurrency: 4, rateLimit: 0, rateWindowMs: 60_000 },
    'kimi-cli': { maxConcurrency: 1, rateLimit: 0, rateWindowMs: 60_000 },
    hermes: { maxConcurrency: 1, rateLimit: 0, rateWindowMs: 60_000 },
  });
});

test('Worker validates persistent budget policy and pricing environment config', () => {
  assert.deepEqual(budgetConfigurationFromEnvironment({
    CRM_AI_PRICING_JSON: '{"version":"pricing-v2","default":{"defaultAttemptCost":0.02}}',
    CRM_AI_BUDGET_POLICIES_JSON: '[{"scopeType":"company","scopeId":"default","dailyLimit":10}]',
  }), {
    pricing: { version: 'pricing-v2', default: { defaultAttemptCost: 0.02 } },
    policies: [{ scopeType: 'company', scopeId: 'default', dailyLimit: 10 }],
  });
  assert.throws(
    () => budgetConfigurationFromEnvironment({ CRM_AI_BUDGET_POLICIES_JSON: '{}' }),
    /CRM_AI_BUDGET_POLICIES_JSON must be a JSON array/,
  );
  assert.throws(
    () => budgetConfigurationFromEnvironment({ CRM_AI_PRICING_JSON: '[]' }),
    /CRM_AI_PRICING_JSON must be a JSON object/,
  );
});

test('Worker resource and station maps are overridden by validated JSON environment config', () => {
  const configured = executionResourcesFromEnvironment({
    CRM_AI_EXECUTION_RESOURCES_JSON: JSON.stringify({
      global: { maxConcurrency: 3, rateLimit: 20, rateWindowMs: 10_000 },
      deepseek: { maxConcurrency: 2, rateLimit: 8, rateWindowMs: 60_000 },
    }),
  });
  assert.deepEqual(configured, {
    global: { maxConcurrency: 3, rateLimit: 20, rateWindowMs: 10_000 },
    deepseek: { maxConcurrency: 2, rateLimit: 8, rateWindowMs: 60_000 },
  });
  assert.deepEqual(stationResourcesFromEnvironment({
    CRM_AI_STATION_RESOURCES_JSON: '{"customer_fit":"model"}',
  }), { customer_fit: 'model' });
  assert.throws(
    () => executionResourcesFromEnvironment({ CRM_AI_EXECUTION_RESOURCES_JSON: '{bad json' }),
    /CRM_AI_EXECUTION_RESOURCES_JSON must be valid JSON/,
  );
  assert.throws(
    () => stationResourcesFromEnvironment({ CRM_AI_STATION_RESOURCES_JSON: '[]' }),
    /CRM_AI_STATION_RESOURCES_JSON must be a JSON object/,
  );
});
