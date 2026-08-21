const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sales_crm.js'), 'utf8');
const workbenchHtml = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const appCss = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');

function sidebarMarkup() {
  return html.match(/<aside class="sidebar"[\s\S]*?<\/aside>/)?.[0] || '';
}

test('primary navigation has one intake entry in the customer lifecycle', () => {
  const sidebar = sidebarMarkup();
  for (const label of ['经营驾驶舱', '今日待办', 'CRM客户全景', '推进动作台', '线索池', '客户经营复盘', '团队状态', '市场策略', '用户与权限']) {
    assert.match(sidebar, new RegExp(`>${label}<`), `missing navigation entry: ${label}`);
  }
  for (const label of ['待领取', '已领取', '线索分配', '未开发线索池', '客户开发工作台', '联系人速览', 'Recon 结果速览']) {
    assert.doesNotMatch(sidebar, new RegExp(`>${label}<`), `obsolete primary entry remains: ${label}`);
  }
  assert.equal((sidebar.match(/data-view="pool"/g) || []).length, 1);
  assert.doesNotMatch(sidebar, /data-view="intake"/);
  assert.match(sidebar, /客户流转[\s\S]*data-view="pool"[\s\S]*管理中心/);
  assert.match(appJs, /navIntakeLabel'\)\.textContent = can\('manage_intake'\) \? '线索池' : '我的线索'/);
});

test('intake, pending and claimed routes select the canonical pool view', () => {
  assert.match(appJs, /const viewPermissions = \{[^}]*pending: 'view_intake'[^}]*claimed: 'view_intake'[^}]*\}/);
  assert.match(appJs, /requestedView === 'customerProfile' && requestedIntakeItemId[\s\S]*?'view_intake'/);
  assert.match(appJs, /legacyIntakeStatus = view === 'pending' \? 'assigned' : view === 'claimed' \? 'claimed' : ''/);
  assert.match(appJs, /intakeAlias = \['intake', 'pending', 'claimed'\]\.includes\(view\)/);
  assert.match(appJs, /canonicalView = intakeAlias \? 'pool' : view/);
  assert.match(appJs, /state\.intakeStatus = legacyIntakeStatus \|\| \(canonicalView === 'pool' \? '' : state\.intakeStatus\)/);
  assert.match(appJs, /history\.replaceState\(null, '', navigationUrl\)/);
  assert.match(appJs, /status === state\.intakeStatus/);
});

test('unified pool defaults to all and combines pending states', () => {
  assert.doesNotMatch(appJs, /salesLanding/);
  assert.match(appJs, /canonicalView === 'pool' \? '' : state\.intakeStatus/);
  assert.match(html, /data-intake-status="unassigned">待分配/);
  assert.doesNotMatch(html, /data-intake-status="pending"|data-intake-status="approved"|待审核/);
  assert.doesNotMatch(html, /data-intake-status="rejected">不对口/);
});

test('intake badge uses the same assigned count as the pending tab', () => {
  assert.match(appJs, /navIntakeCount/);
  assert.match(appJs, /canViewAssignmentDecisions\(\)/);
  assert.match(appJs, /intakeStats\?\.assigned/);
  assert.doesNotMatch(`${html}\n${appJs}`, /navPendingCount|navClaimedCount/);
});

test('today tasks permission uses the matching UI name and scope explanation', () => {
  assert.match(appJs, /permissionDescriptions/);
  assert.match(backend, /permissionDescriptions: PERMISSION_DESCRIPTIONS/);
});

test('dashboard intake alerts open the matching lead profile', () => {
  assert.match(appJs, /item\.intakeItemId \? `data-intake-profile="\$\{esc\(item\.intakeItemId\)\}"`/);
  assert.match(appJs, /intakeProfile\.matches\('button\[data-intake-profile\]'\)/);
});

test('customer and intake rows expose profile click targets', () => {
  assert.match(appJs, /row\._attrs = `data-customer="\$\{esc\(accounts\[index\]\.id\)\}"`/);
  assert.match(appJs, /row\._attrs = `data-intake-profile/);
  assert.match(appJs, /data-intake-profile/);
  assert.match(appJs, /function openIntakeProfile\(itemId\)/);
});

test('customer filters are server-authorized and do not expose a static evaluation field', () => {
  assert.match(html, /id="customerAuthorizedFilters"/);
  assert.doesNotMatch(html, /id="evaluationTagFilter"/);
  assert.match(appJs, /\/filter-schema\/\$\{pageKey\}/);
  assert.match(appJs, /TradePulseFilterComponent\.mountFilterComponent/);
  assert.match(backend, /canViewInsights/);
});

test('customer profiles contain contextual AI Q&A', () => {
  assert.match(appJs, /function customerAiSection\(context\)/);
  assert.match(appJs, /if \(!technicalAIPresentationAllowed\(\) \|\| !can\('use_ai_assistant'\)\) return '';/);
  assert.match(appJs, /id="drawerAiForm"/);
  assert.match(appJs, /\/api\/assistant\/chat/);
});

test('original workbench supports a profile-only customer page', () => {
  assert.match(workbenchHtml, /q\.get\('profile'\)===['"]1['"][\s\S]*?profile-mode/);
  assert.match(workbenchHtml, /body\.profile-mode/);
  assert.match(workbenchHtml, /function openRequestedCustomer\(\)/);
  assert.match(workbenchHtml, /function renderRequestedCustomerError\(/);
  assert.match(workbenchHtml, /\/api\/sales-crm\/profile\/\$\{encodeURIComponent\(profileCustomerId\)\}/);
  assert.match(workbenchHtml, /readOnly/);
});

test('complete customer data opens a non-sidebar profile page and returns to CRM', () => {
  const sidebar = sidebarMarkup();
  const masterHandler = appJs.match(/const master = event\.target\.closest\('\[data-open-master\]'\);[\s\S]*?\n    const stageJump =/)?.[0] || '';
  assert.match(html, /id="customerProfileView"/);
  assert.match(html, /id="customerProfileBack"/);
  assert.match(html, /id="customerProfileDataEdit"/);
  assert.match(html, /id="customerProfileFrame"/);
  assert.doesNotMatch(sidebar, /customerProfileView|客户资料/);
  assert.match(masterHandler, /openCustomerProfile\(master\.dataset\.openMaster\)/);
  assert.doesNotMatch(masterHandler, /switchView\('pool'\)/);
  assert.match(appJs, /function openCustomerProfile\(externalCustomerId\)/);
  assert.match(appJs, /profile=1[\s\S]*?customer=\$\{encodeURIComponent\(externalCustomerId\)\}/);
  assert.match(appJs, /searchParams\.set\('customer', externalCustomerId\)/);
  assert.match(appJs, /state\.selectedCustomerId = account\.id/);
  assert.match(appJs, /#customerProfileDataEdit/);
  assert.match(appJs, /function returnFromCustomerProfile\(\)/);
  assert.match(appJs, /requestedView === 'customerProfile'[\s\S]*?openCustomerProfile\(requestedCustomerId\)/);
});

test('mobile customer profile removes hidden toolbar space and fills the viewport', () => {
  assert.match(appCss, /body\.customer-profile-active \.top-actions\{display:none\}/);
  assert.match(appCss, /@media\(max-width:780px\)\{\.customer-profile-view\.active\{height:calc\(100dvh - 95px\)/);
  assert.match(html, /app\.css\?v=[^"]+/);
  assert.match(html, /app\.js\?v=[^"]+/);
});

test('manual customer creation surfaces enrichment state and opens the new customer profile', () => {
  const handler = appJs.match(/else if \(form\.id === 'customerForm'\)[\s\S]*?else if \(form\.id === 'quoteForm'\)/)?.[0] || '';
  assert.match(handler, /const result = await api\('\/api\/sales-crm\/accounts'/);
  assert.match(handler, /result\.externalCustomerId/);
  assert.match(handler, /result\.enrichment/);
  assert.match(handler, /openCustomerProfile\(result\.externalCustomerId\)/);
});

test('unclaimed lead AI uses a scoped profile summary instead of an inaccessible CRM target', () => {
  const intakeProfileSource = appJs.match(/function openIntakeProfile\(itemId\)[\s\S]*?\n  function closeDrawer\(/)?.[0] || '';
  assert.doesNotMatch(intakeProfileSource, /customerId:/);
  assert.match(intakeProfileSource, /profileSummary:/);
  assert.match(appJs, /const scopedMessage = context\.profileSummary/);
});

test('issue 3 account administration and identity inspection remain intact', () => {
  for (const contract of ['data-edit-user', 'data-reset-password', 'data-start-impersonation', 'impersonationBanner', 'stopImpersonationBtn']) {
    assert.match(`${html}\n${appJs}`, new RegExp(contract), `missing Issue #3 contract: ${contract}`);
  }
});

test('administrators can operate the AI engine runtime and workbench restores server conversations', () => {
  assert.match(html, /id="assistantRuntimePanel"/);
  for (const label of ['Automatic', 'Kimi', 'Hermes', 'DeepSeek']) {
    assert.match(`${html}\n${appJs}`, new RegExp(label), `missing AI mode label: ${label}`);
  }
  const loadRuntime = appJs.match(/async function loadAssistantRuntime\(\)[\s\S]*?\n  }\n\n  async function setAssistantRuntimeMode/)?.[0] || '';
  const renderRuntime = appJs.match(/function renderAssistantRuntime\(\)[\s\S]*?\n  }\n\n  async function loadAssistantRuntime/)?.[0] || '';
  const setMode = appJs.match(/async function setAssistantRuntimeMode\(mode\)[\s\S]*?\n  }\n\n  async function recheckAssistantRuntime/)?.[0] || '';
  const recheck = appJs.match(/async function recheckAssistantRuntime\(\)[\s\S]*?\n  }\n\n  function auditOperator/)?.[0] || '';

  assert.match(loadRuntime, /if \(!can\('manage_users'\) \|\| state\.data\?\.impersonation\) return;/);
  assert.match(loadRuntime, /await api\('\/api\/assistant\/runtime'\)/);
  assert.match(setMode, /await api\('\/api\/assistant\/runtime', \{ method: 'PATCH', body: JSON\.stringify\(\{ mode \}\) \}\)/);
  assert.match(recheck, /await api\('\/api\/assistant\/runtime\/recheck', \{ method: 'POST', body: '\{\}' \}\)/);
  for (const source of [setMode, recheck]) {
    assert.match(source, /state\.assistantRuntimePending = true;/);
    assert.match(source, /finally \{\s*state\.assistantRuntimePending = false;/);
  }
  assert.match(renderRuntime, /mode\.disabled = pending \|\| !runtime;/);
  assert.match(renderRuntime, /recheck\.disabled = pending \|\| !runtime;/);
  assert.match(renderRuntime, /class="assistant-runtime-state \$\{esc\(health\.status \|\| 'unknown'\)\}"/);
  assert.match(renderRuntime, /title="\$\{esc\(error\)\}"/);
  assert.match(renderRuntime, /\$\{esc\(error \|\| '—'\)\}/);

  const sendAssistant = workbenchHtml.match(/async function sendAssistantMessage\(override,cursor\)[\s\S]*?\n    function buildAssistantContext/)?.[0] || '';
  const restoreConversation = workbenchHtml.match(/function restoreAssistantConversation\(\)[\s\S]*?\n    function persistAssistantConversation/)?.[0] || '';
  const persistConversation = workbenchHtml.match(/function persistAssistantConversation\(\)[\s\S]*?\n    function clearAssistantChat/)?.[0] || '';
  assert.match(sendAssistant, /sessionEngine:assistantState\.sessionEngine\|\|''/);
  assert.match(sendAssistant, /if\(responseEngine&&responseEngine!==assistantState\.sessionEngine\)\{assistantState\.sessionEngine=responseEngine;assistantState\.sessionId=responseSessionId\}/);
  assert.match(sendAssistant, /conversationId:assistantState\.conversationId\|\|''/);
  assert.match(sendAssistant, /clientMessageId/);
  assert.match(restoreConversation, /\/assistant\/conversations\/\$\{encodeURIComponent\(assistantState\.conversationId\)\}/);
  assert.match(restoreConversation, /assistantState\.messages=\(c\.messages\|\|\[\]\)/);
  assert.match(persistConversation, /JSON\.stringify\(\{conversationId:assistantState\.conversationId\|\|'',scope:assistantState\.scope\}\)/);
  assert.doesNotMatch(persistConversation.split('\n')[0], /messages/);
});
