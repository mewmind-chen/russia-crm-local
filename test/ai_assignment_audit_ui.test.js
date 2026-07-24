'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sales_crm.js'), 'utf8');

test('intake UI exposes fit readiness ranking three decision layers and audit history', () => {
  assert.match(appJs, /function intakeSignals\(item\)/);
  assert.match(appJs, /function intakeDecisionLayers\(item\)/);
  assert.match(appJs, /AI 推荐/);
  assert.match(appJs, /规则裁决/);
  assert.match(appJs, /人工最终决定/);
  assert.match(appJs, /function intakeAuditMarkup\(item\)/);
  assert.match(appJs, /assignmentAudit/);
  assert.match(appJs, /Fit \/ readiness \/ 优先级/);
  assert.match(appCss, /\.decision-review-grid/);
  assert.match(appCss, /\.ranked-candidate/);
  assert.match(backend, /CREATE TABLE IF NOT EXISTS crm_intake_decisions/);
  assert.match(backend, /candidateSnapshotId/);
  assert.match(backend, /recordIntakeDecision/);
});
