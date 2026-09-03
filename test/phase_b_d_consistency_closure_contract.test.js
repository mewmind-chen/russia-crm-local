'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const appSource = read('sales-assets/app.js');
const salesCrmSource = read('lib/sales_crm.js');
const filtersSource = read('lib/business_page_filters.js');
const workflowSource = read('lib/manager_workflows.js');
const projectionSource = read('lib/domains/lifecycle/state_projection.js');

function functionSlice(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing ${nextFunctionName}`);
  return source.slice(start, end);
}

test('Stage B state projection is the only derived interpretation and frontend keeps one raw-field contract', () => {
  assert.match(projectionSource, /function projectNextAction\(/);
  assert.match(projectionSource, /next_action_time_basis/);
  assert.match(projectionSource, /function projectManagerState\(/);
  assert.match(salesCrmSource, /projectNextAction\(/, 'alerts/reporting must consume the shared projection');
  assert.match(filtersSource, /projectNextAction\(/);
  assert.match(filtersSource, /projectManagerState\(/);

  // Pipeline/accounts/bootstrap/profile payloads intentionally expose legacy
  // columns; the frontend must not reintroduce a parallel `state` DTO reader.
  // `item.state` remains an AI-only timeline shape and is intentionally out
  // of this non-AI contract. Business account/row readers must not invent a
  // parallel state DTO.
  assert.doesNotMatch(appSource, /\b(?:account|row)\.state(?:\.|\b)/);
  for (const field of ['next_action', 'next_action_at', 'next_action_time_basis', 'manager_status', 'manager_required']) {
    assert.match(appSource, new RegExp(`\\b${field}\\b`), `frontend raw-field contract missing ${field}`);
  }
});

test('manager/deferred/today-task boundaries remain non-AI and gateway-backed', () => {
  assert.doesNotMatch(workflowSource, /ai_stations|assistant_|sales_evaluation_ai/);
  assert.match(workflowSource, /applyAccountPlanPatch\(/);
  assert.match(workflowSource, /applyAccountStatePatch\(/);
  // Manager status writes stay behind the same lifecycle gateway in the CRM
  // composition root; the workflow service only needs plan/state changes.
  assert.match(salesCrmSource, /applyManagerStatusPatch\(/);
  assert.doesNotMatch(
    workflowSource,
    /UPDATE crm_accounts SET[^;]*(?:stage\s*=|owner_id\s*=|assignment_status\s*=|next_action\s*=|next_action_at\s*=|manager_required\s*=|manager_status\s*=)/,
  );

  const alerts = functionSlice(salesCrmSource, 'buildAlerts', 'filterTodayTaskAlertsForUser');
  assert.match(alerts, /projectNextAction\(/);
  assert.doesNotMatch(alerts, /!account\.next_action \|\| !account\.next_action_at/);
  const actionKeys = functionSlice(filtersSource, 'pipelineActionKeys', 'publicPipelineActionRow');
  assert.match(actionKeys, /projectNextAction\(/);
  assert.match(actionKeys, /projectManagerState\(/);
});
