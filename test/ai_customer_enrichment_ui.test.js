'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');

test('customer intake accepts company name or website and keeps country optional', () => {
  assert.match(app, /name="companyName"/);
  assert.match(app, /name="website"[^>]*type="url"/);
  assert.match(app, /name="country"/);
  assert.match(app, /if \(!payload\.companyName && !payload\.website\)/);
  assert.doesNotMatch(app, /name="country" required/);
  assert.match(app, /result\.enrichment/);
});

test('customer enrichment renders workflow, evidence, provisional data and conflicts safely', () => {
  for (const contract of [
    'enrichmentNodeLabels', 'routeState', 'completeness', 'missingItems', 'tags',
    'evidence', 'ai-provisional', 'currentValue', 'proposedValue',
  ]) assert.match(app, new RegExp(contract), `missing UI contract: ${contract}`);
  assert.match(app, /restricted\?\.contacts/);
  assert.match(app, /\.map\\?\.\(.*esc|\.map\(.*esc/s);
  assert.match(css, /\.customer-enrichment/);
  assert.match(css, /\.ai-provisional/);
  assert.match(css, /\.enrichment-conflict/);
});

test('customer enrichment supports review, retry and cancellation through protected APIs', () => {
  assert.match(app, /data-review-enrichment-proposal="accepted"/);
  assert.match(app, /data-review-enrichment-proposal="rejected"/);
  assert.match(app, /data-retry-enrichment/);
  assert.match(app, /data-cancel-enrichment/);
  assert.match(app, /aiService\.reviewProposal\(proposalId, \{ decision \}\)/);
  assert.match(app, /aiService\.cancelEnrichment\(runId, \{\}\)/);
  assert.match(app, /aiService\.runCustomerEnrichment\(customerId, \{\}\)/);
});

test('enrichment polling is terminal-aware, bounded and retains last successful data on degradation', () => {
  assert.match(app, /ENRICHMENT_TERMINAL_STATES/);
  assert.match(app, /CUSTOMER_AI_MAX_POLLS/);
  assert.match(app, /customerEnrichmentLastSuccess/);
  assert.match(app, /保留上次成功加载的补全结果/);
  assert.match(app, /setTimeout\(\(\) => void loadCustomerAI/);
});
