'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');

function between(start, end) {
  const from = appJs.indexOf(start);
  const to = appJs.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `missing ${end}`);
  return appJs.slice(from, to);
}

test('Issue 207 keeps ordinary business controls available during identity inspection', () => {
  const ordinarySections = [
    between('function currentIntakeAssignmentScope', 'function switchIntakeSelectionToCurrentPage'),
    between('function renderIntakeAssignmentBar', 'function intakeAssignmentCandidates'),
    between('function renderIntake()', 'function customerProfileFrameUrl'),
    between('function canReturnCustomer', 'function canSelectCustomer'),
    between('function openOverdueLeadTaskModal', 'function openNextPlanTaskModal'),
    between('function openNextPlanTaskModal', 'function setNextPlanMode'),
    between('function openManagerAssistanceTaskModal', 'function openTodayTaskAction'),
  ];
  for (const source of ordinarySections) {
    assert.doesNotMatch(source, /impersonation/, source.slice(0, 80));
  }
  assert.match(appJs, /can\('record_activity'\)/);
  assert.match(appJs, /can\('manage_intake'\)/);
  assert.match(appJs, /can\('manage_customer_recycle'\)/);
  assert.match(appJs, /const canManualAssign = !salesView && can\('manage_intake'\)/);
});

test('Issue 207 keeps security controls gated and the inspection banner persistent', () => {
  assert.match(html, /id="impersonationBanner"/);
  assert.match(html, /id="stopImpersonationBtn"/);
  assert.match(html, /身份检查中的业务操作会真实生效并记录审计/);
  assert.match(css, /\.impersonation-banner small\{[^}]*flex-basis:100%[^}]*overflow-wrap:anywhere/);
  assert.match(appJs, /data-view="users"[\s\S]*data-view="maintenance"/);
  assert.match(appJs, /can\('manage_users'\)\s*&&\s*!state\.data(?:\?)?\.impersonation/);
  assert.match(appJs, /can\('manage_data_maintenance'\)[\s\S]{0,120}state\.data\.impersonation/);
  assert.match(appJs, /can\('manage_manual_customer_deletion'\)[\s\S]{0,120}!state\.data\.impersonation/);
  assert.match(appJs, /#intakeSettingsBtn[\s\S]{0,120}Boolean\(state\.data\.impersonation\)/);
  assert.match(appJs, /#scanIntakeBtn[\s\S]{0,120}Boolean\(state\.data\.impersonation\)/);
});

test('Issue 207 hides AI security writes while preserving read-only AI views', () => {
  const applyUser = between('function applyUser()', 'function populateFilters');
  const taskDetail = between('function renderAiTaskDetail', 'async function openAiTask');
  const runAnomalies = between('async function runManagerAnomalies', 'function renderInsightsHub');
  const coachingGate = between('function canViewSalesCoaching', 'function coachingFor');
  const runCoaching = between('async function runSalesCoaching', 'function salesCoachingBlock');
  const coachingMarkup = between('function salesCoachingBlock', 'function renderTeam()');

  assert.match(applyUser, /#runManagerAnomaly[\s\S]{0,180}Boolean\(state\.data\.impersonation\)/);
  assert.match(runAnomalies, /if \(state\.data\?\.impersonation \|\| !canViewManagerAnomalies\(\)/);
  assert.match(taskDetail, /const canMutateAITasks = !state\.data\?\.impersonation/);
  for (const capability of ['canRetry', 'canCancel', 'canReview']) {
    assert.match(taskDetail, new RegExp(`canMutateAITasks && task\\.${capability}`));
  }
  assert.match(coachingGate, /function canRunSalesCoaching\(\)[\s\S]*canViewSalesCoaching\(\) && !state\.data\?\.impersonation/);
  assert.match(runCoaching, /if \(!canRunSalesCoaching\(\)/);
  assert.match(coachingMarkup, /const action = canRunSalesCoaching\(\)/);
});

test('Issue 207 redirects security administration views and gates their row actions', () => {
  const viewGate = between('function identityInspectionAllowsView', 'function firstAllowedBusinessView');
  const firstAllowed = between('function firstAllowedBusinessView', 'async function load');
  const load = between('async function load', 'function applyUser');
  const users = between('function renderUsers', 'function renderManagerTaskSettings');
  const duplicateGate = between('function canReviewDuplicateCustomers', 'function canAccessProtectionAndDedupe');
  const duplicateReviews = between('function renderDuplicateReviews', 'async function loadDuplicateReviews');
  const switcher = between('function switchView', "window.addEventListener('hashchange'");

  assert.match(viewGate, /\['activityCorrections', 'users', 'maintenance', 'protectedCustomers'\]\.includes\(view\)/);
  assert.match(firstAllowed, /identityInspectionAllowsView\(view\)/);
  assert.match(load, /requestedAllowed[\s\S]{0,180}identityInspectionAllowsView\(requestedView\)/);
  assert.match(switcher, /if \(!identityInspectionAllowsView\(canonicalView\)\)[\s\S]{0,180}firstAllowedBusinessView\(\)/);
  assert.match(users, /const canMutate = can\('manage_users'\) && !state\.data\.impersonation/);
  assert.match(duplicateGate, /!state\.data\?\.impersonation/);
  assert.match(duplicateReviews, /const allowed = canReviewDuplicateCustomers\(\)/);
  assert.match(appJs, /#pendingVerificationPanel'\)\?\.classList\.toggle\('hidden', !canAccessProtectionAndDedupe\(\)\)/);
  assert.match(duplicateReviews, /if \(!allowed\) return/);
});

test('Issue 207 restores password controls and disables cursor-advancing team ranges', () => {
  const applyUser = between('function applyUser()', 'function populateFilters');
  const teamStatus = between('async function loadTeamStatus', 'async function loadTeamCollaboration');

  assert.match(applyUser, /#changePasswordBtn'\)\?\.classList\.toggle\('hidden', Boolean\(state\.data\.impersonation\)\)/);
  assert.doesNotMatch(applyUser, /#changePasswordBtn[^\n]*classList\.add\('hidden'\)/);
  assert.match(applyUser, /option\[value="since-last-view"\][\s\S]{0,240}\.hidden = Boolean\(state\.data\.impersonation\)/);
  assert.match(applyUser, /sinceLastViewOption\.disabled = Boolean\(state\.data\.impersonation\)/);
  assert.match(teamStatus, /state\.data\?\.impersonation && selectedRange === 'since-last-view'[\s\S]{0,80}\? '30d'/);
});

test('Issue 207 distinguishes safety restrictions from ordinary permission failures', () => {
  const api = between('async function api(url, options = {})', 'function componentPayloadToRaw');
  assert.match(api, /result\.code === 'IMPERSONATION_ACTION_BLOCKED'/);
  assert.match(api, /身份检查期间禁止此安全操作/);
  assert.match(api, /result\.error \|\| '请求失败'/);
  assert.match(appJs, /当前账号无权处理该超时线索/);
  assert.match(appJs, /当前账号无权为该客户补充计划/);
  assert.match(appJs, /当前账号无权完成该协助请求/);
  assert.match(api, /!\['IMPERSONATION_ACTION_BLOCKED', 'FILTER_NOT_AUTHORIZED'\]\.includes\(error\.code\)/);
});
