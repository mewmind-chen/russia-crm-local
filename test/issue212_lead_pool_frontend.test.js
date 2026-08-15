'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets', 'app.css'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

test('Issue 212 uses one authorized lead list and removes ambiguous page tabs', () => {
  assert.doesNotMatch(html, /data-authorized-intake-page|intakeAuthorizedPageTabs/);
  assert.match(html, /id="intakeAuthorizedFilters"/);
  assert.match(html, /id="intakePagination"/);
  assert.match(app, /initializeAuthorizedBusinessFilters\('intake'/);
  assert.doesNotMatch(functionBlock(app, 'renderIntake'), /intakeAuthorizedPage/);
});

test('Issue 212 renders manager stat buttons with CRM entry and no claimed/rejected cards', () => {
  const cards = functionBlock(app, 'intakeStatCards');
  for (const key of ['today', 'unassigned', 'assigned', 'crm', 'contacted', 'idle', 'returned', 'overdue']) {
    assert.match(cards, new RegExp(`\\['${key}',`), key);
  }
  const managerCards = cards.slice(cards.indexOf('] : [') + 4);
  assert.doesNotMatch(managerCards, /\['claimed',/);
  assert.doesNotMatch(managerCards, /\['rejected',/);
  const render = functionBlock(app, 'renderIntake');
  assert.match(render, /<button type="button" class="metric/);
  assert.match(render, /data-intake-stat=/);
  assert.match(render, /aria-pressed=/);
  assert.match(render, /data-intake-stat-crm/);
  assert.match(css, /button\.metric\.is-active/);
});

test('Issue 212 stat cards map to SQL-backed drafts and restorable URL state', () => {
  const draft = functionBlock(app, 'intakeStatDraft');
  assert.match(draft, /today:\s*\{ created_today: true \}/);
  assert.match(draft, /unassigned:\s*\{ status: \['pending', 'approved'\] \}/);
  assert.match(draft, /idle:\s*\{ status: \['pending', 'approved', 'returned'\] \}/);
  assert.match(draft, /overdue:\s*\{ status: \['assigned'\], claim_overdue: true \}/);
  const poolJump = functionBlock(app, 'applyIntakeStatCard');
  assert.match(poolJump, /controller\.clearAll\(\{ apply: false \}\)/);
  assert.match(poolJump, /updateLeadWorkflowUrl\(key, 'pool'\)/);
  const crmJump = functionBlock(app, 'jumpIntakeStatToCrm');
  assert.match(crmJump, /pendingCustomerIntakeFlow = flow/);
  assert.match(crmJump, /updateLeadWorkflowUrl\(flow, 'customers'\)/);
  assert.match(app, /requestedParams\.get\('leadView'\)/);
  assert.match(functionBlock(app, 'restoreLeadWorkflowFromLocation'), /pendingIntakeStat/);
  assert.match(functionBlock(app, 'restoreLeadWorkflowFromLocation'), /pendingCustomerIntakeFlow/);
  assert.match(functionBlock(app, 'leadWorkflowNavigationUrl'), /searchParams\.delete\('leadView'\)/);
  assert.match(functionBlock(app, 'intakeActiveStatCard'), /leadView/);
});

test('Issue 212 current-page selection excludes blocked rows and maintains checkbox state', () => {
  const render = functionBlock(app, 'renderIntake');
  assert.match(render, /id="selectVisibleIntake"/);
  assert.match(render, /items\.filter\(intakeItemAssignable\)/);
  assert.match(render, /intakeItemAssignable\(item\)[\s\S]*data-select-intake/);
  assert.match(render, /selectVisible\.checked/);
  assert.match(render, /selectVisible\.indeterminate/);
  assert.match(render, /selectVisible\.disabled = !assignableItems\.length/);
  assert.match(render, /当前页没有可分配线索/);
  assert.match(render, /state\.intakeSelectAllScope/);
  assert.match(app, /switchIntakeSelectionToCurrentPage/);
});

test('Issue 212 all-filtered selection is confirmed and previewed for the eligible count', () => {
  const marker = app.indexOf("event.target.closest('#intakeSelectAllResults')");
  assert.notEqual(marker, -1);
  const block = app.slice(marker, marker + 2200);
  assert.match(block, /window\.confirm\(`将选择全部筛选结果/);
  assert.match(block, /action: 'manual_assign_preview'/);
  assert.match(block, /allFiltered: true/);
  assert.match(block, /total: Number\(preview\.eligibleCount/);
  assert.match(block, /全部筛选结果中没有可分配线索/);
  const modal = functionBlock(app, 'openManualIntakeAssignment');
  assert.match(modal, /name="confirmAll" required/);
  assert.match(modal, /全部筛选结果中的可分配线索/);
  assert.match(app, /previewToken: assignment\.preview\.previewToken/);
});

test('Issue 212 manual assignment restores retry state after submission failure', () => {
  const marker = app.indexOf("form.id === 'intakeManualAssignForm'");
  assert.notEqual(marker, -1);
  const block = app.slice(marker, marker + 2600);
  assert.match(block, /finally\s*\{[\s\S]*state\.intakeAssignmentSubmitting = false;/);
  assert.match(block, /button\.textContent = '确认分配'/);
  assert.match(block, /syncManualAssignmentAmount\(\)/);
  assert.match(block, /ASSIGNMENT_PREVIEW_EXPIRED[\s\S]*state\.intakeAssignmentPreview = null/);
});

test('Issue 212 assignment and unassignment expose the correct lifecycle actions', () => {
  const render = functionBlock(app, 'renderIntake');
  assert.match(render, /item\.status === 'assigned'[\s\S]*data-intake-assign=[\s\S]*data-intake-unassign=/);
  assert.match(render, /item\.status === 'claimed'[\s\S]*data-open-customer=/);
  assert.doesNotMatch(render, /item\.status === 'claimed'[^;]*data-intake-unassign=/);
  assert.match(app, /action: 'unassign'/);
  assert.match(app, /refreshIntakeWorkflow\('已取消分配/);
  assert.match(app, /action === 'claim'[\s\S]*refreshIntakeWorkflow/);
  assert.match(functionBlock(app, 'refreshIntakeWorkflow'), /loadAuthorizedBusinessPage\('intake', \{ reset: true \}\)/);
});

test('Issue 212 assignment dialogs use authorized candidates and no handwritten reason', () => {
  const candidates = functionBlock(app, 'intakeAssignmentCandidates');
  assert.match(candidates, /todayTaskAssignmentCandidates/);
  const modal = functionBlock(app, 'openIntakeAssignModal');
  assert.match(modal, /assigned_owner_id/);
  assert.match(modal, /filter\(user => String\(user\.id\) !== String\(item\.assigned_owner_id/);
  assert.match(modal, /当前负责人/);
  assert.doesNotMatch(modal, /name="reason"|分配说明/);
  assert.match(app, /blockedReasons[\s\S]*阻断/);
});

test('Issue 212 explicitly describes empty lead results and refreshes asset versions', () => {
  assert.match(functionBlock(app, 'renderIntake'), /暂无符合条件的线索/);
  assert.match(html, /id="intakeSelectionCount" aria-live="polite"/);
  assert.match(html, /app\.css\?v=20260816-issue314-verification-workbench/);
  assert.match(html, /app\.js\?v=20260816-issue314-verification-workbench/);
});
