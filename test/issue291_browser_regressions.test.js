'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'lib', 'sales_crm.js'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('activity modal converts stored plans into the business timezone', () => {
  const modal = section(app, 'function openActivityModal', 'function renderActivityReactionAdminModal');
  assert.match(modal, /storedPlanDateInputWithBasis\(/);
  assert.doesNotMatch(modal, /account\?\.next_action_at \? apiTime\(/);
});

test('lead drawer follows the accepted master-data and history structure', () => {
  const drawer = section(app, 'function openIntakeProfile', 'function closeDrawer');
  assert.match(drawer, /分配客户/);
  assert.match(drawer, /masterProfileSectionHtml\(\{/);
  assert.match(drawer, /企业背景与开发依据/);
  assert.match(drawer, /潜在需求/);
  assert.match(drawer, /开发历史/);
  assert.match(drawer, /成立年份/);
  assert.match(drawer, /更新时间/);
  assert.doesNotMatch(drawer, /ASSIGNMENT STATUS/);
  assert.doesNotMatch(drawer, /领取截止/);
});

test('mismatch detail shows history immediately and stays read-only', () => {
  const drawer = section(app, 'function renderMismatchRecordDrawer', 'function toggleMismatchRecordExpanded');
  assert.match(drawer, /DEVELOPMENT HISTORY/);
  assert.match(drawer, /开发历史/);
  assert.doesNotMatch(drawer, /data-mismatch-owner/);
  assert.doesNotMatch(drawer, /data-restore-mismatch/);
});

test('identity warnings disable intake actions and expose only the public hint', () => {
  assert.match(app, /item\.identityWarning/);
  assert.match(server, /该客户需要管理员确认，确认后可继续领取。/);
  assert.match(server, /item\.assignable = false/);
});

test('manager task dates have separate due and trigger rows', () => {
  const renderer = section(app, 'function renderManagerTasks', 'function renderManagerRisks');
  assert.match(renderer, /manager-task-dates/);
});
