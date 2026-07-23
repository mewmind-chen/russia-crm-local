'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');

test('customer profile contains the real customer fit station surface', () => {
  assert.match(html, /id="customerAiStation"/);
  assert.match(html, /id="customerAiStationBody"/);
  assert.match(html, /id="customerAiStationActions"/);
  assert.match(html, /app\.css\?v=20260723-6/);
  assert.match(html, /app\.js\?v=20260723-6/);
});

test('customer fit UI reads, runs and retries only through Sales CRM APIs', () => {
  assert.match(app, /\/api\/sales-crm\/ai\/customers\/\$\{encodeURIComponent\(customerId\)\}\/results/);
  assert.match(app, /\/api\/sales-crm\/ai\/customers\/\$\{encodeURIComponent\(customerId\)\}\/stations\/customer_fit\/run/);
  assert.match(app, /\/api\/sales-crm\/ai\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/retry/);
  assert.doesNotMatch(app, /fetch\(['"`]https?:\/\//);
});

test('customer fit UI exposes result metadata, evidence and every job state', () => {
  for (const field of ['fitScore', 'grade', 'confidence', 'reasonCodes', 'promptVersion', 'schemaVersion', 'generatedAt', 'evidence']) {
    assert.match(app, new RegExp(field), `missing field: ${field}`);
  }
  for (const state of ['queued', 'running', 'retry_wait', 'needs_review', 'succeeded', 'dead_letter', 'stale']) {
    assert.match(app, new RegExp(state), `missing state: ${state}`);
  }
});

test('customer fit actions respect AI permission and identity inspection', () => {
  assert.match(app, /const canRun = can\('use_ai_assistant'\) && !state\.data\?\.impersonation/);
  assert.match(app, /data-run-customer-fit/);
  assert.match(app, /data-retry-ai-job/);
});

test('customer fit surface has bounded responsive layout and preserves the profile frame', () => {
  assert.match(css, /\.customer-profile-view\.active\{[^}]*grid-template-rows:auto auto minmax\(0,1fr\)/);
  assert.match(css, /\.customer-ai-station\{[^}]*max-height:270px[^}]*overflow:auto/);
  assert.match(css, /@media\(max-width:780px\)\{\.customer-ai-station/);
  assert.match(html, /id="customerProfileFrame"/);
});
