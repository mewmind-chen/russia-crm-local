'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createManagerWorkflowServices } = require('../lib/manager_workflows');
const { functionSlice } = require('./helpers/lifecycle_gate_contract');

const root = path.join(__dirname, '..');
const workflowSource = fs.readFileSync(path.join(root, 'lib', 'manager_workflows.js'), 'utf8');
const salesCrmSource = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');
const profileSource = fs.readFileSync(path.join(root, 'lib', 'db.js'), 'utf8');

test('manager workflow exposes an independent non-AI application boundary', () => {
  assert.equal(typeof createManagerWorkflowServices, 'function');
  assert.doesNotMatch(workflowSource, /require\([^)]*sales_crm/);
  assert.doesNotMatch(workflowSource, /ai_stations|sales_evaluation_ai|assistant_/);
  const service = createManagerWorkflowServices({});
  assert.deepEqual(Object.keys(service).sort(), [
    'assertManagerSettingsAdmin',
    'assertManagerTaskRole',
    'canRecipientAccessAccount',
    'deferAccountPlan',
    'managerAssistanceRecipientIds',
    'managerTaskAccount',
    'notifyManagerTaskEscalation',
    'notifyManagerTaskRecipients',
    'notifyNoPlanStreak',
    'recordExplicitPlanIfEnabled',
    'resolveManagerTaskAction',
    'scanManagerTasks',
    'scopedManagerAccount',
    'scopedManagerTasks',
    'scopedManagerTasksForTodayAlerts',
    'updateManagerSettings',
  ]);
});

test('manager intervention writes remain behind lifecycle gateways', () => {
  const body = functionSlice(workflowSource, 'managerTaskChange', 'resolveManagerTaskAction');
  assert.doesNotMatch(
    body,
    /UPDATE crm_accounts SET[^;]*(?:stage\s*=|owner_id\s*=|assignment_status\s*=|next_action\s*=|next_action_at\s*=|manager_required\s*=|manager_status\s*=)/,
  );
  assert.match(body, /applyAccountStatePatch\(/);
  assert.match(body, /applyAccountPlanPatch\(/);
});

test('audited high-coupling profile and transaction boundaries remain in the composition root', () => {
  assert.match(profileSource, /function getCustomerProfileData\(/);
  assert.match(salesCrmSource, /getCustomerProfileData\(/);
  assert.match(salesCrmSource, /app\.post\('\/api\/sales-crm\/migration-review\/:reviewId'/);
  assert.match(salesCrmSource, /app\.post\('\/api\/sales-crm\/intake\/scan'/);
  assert.match(salesCrmSource, /app\.post\('\/api\/sales-crm\/intake\/action'/);
  assert.match(salesCrmSource, /app\.post\('\/api\/sales-crm\/evaluations'/);
  assert.match(salesCrmSource, /registerAIStationRoutes\(/);
});
