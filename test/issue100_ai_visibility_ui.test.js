'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');
const legacy = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');

test('one effective AI station gate controls every business AI surface', () => {
  assert.match(app, /function customerAIEnabled\(\) \{\s*return Boolean\(state\.data\?\.features\?\.aiStations\)/);
  assert.match(app, /function customerAiSection\(context\) \{[\s\S]*?drawerAiContext\(context\)/);
  assert.match(app, /function drawerAiContext\(context\) \{[\s\S]*?enabled: technicalAIPresentationAllowed\(\) && can\('use_ai_assistant'\)/);
  assert.match(app, /function canViewManagerAnomalies\(\) \{\s*return customerAIEnabled\(\)/);
  assert.match(app, /function canViewSalesCoaching\(\) \{\s*return customerAIEnabled\(\)/);
  assert.match(app, /function canGovernAI\(\) \{\s*return customerAIEnabled\(\)/);
  assert.match(html, /data-view="aiTasks"[^>]*data-ai-business/);
  assert.match(html, /manager-anomaly-panel"[^>]*data-ai-business/);
  assert.match(html, /id="teamCoachingStatus"[^>]*data-ai-business/);
});

test('disabled intake rendering removes AI headers, cells and the third decision track', () => {
  // AI 门控契约：showAI/showAssignmentAI 驱动列定义，schema 就绪时由 intakeColumnKeys
  // 进一步裁剪（等价性由 field_catalog.test.js 的 intake columns match legacy gates 覆盖）。
  assert.match(app, /const showAI = technicalAIPresentationAllowed\(\)/);
  assert.match(app, /const showAssignmentAI = showAI && !salesView/);
  assert.match(app, /header: 'Fit \/ readiness \/ 优先级', fieldClass: 'col-fit', visible: showAI/);
  assert.match(app, /header: '候选销售排名', fieldClass: 'col-candidates', visible: showAssignmentAI/);
  assert.match(app, /salesView \? '负责人' : '负责人 \/ 阻断原因'/);
  assert.match(app, /const intakeColumns = \[[\s\S]*?\]\.filter\(column => \{/);
  assert.match(app, /const row = intakeColumns\.map\(column => \(\{/);
  assert.match(app, /<div class="decision-review-grid \$\{showAI \? '' : 'without-ai'\}">/);
  assert.match(css, /\.decision-review-grid\.without-ai\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(app, /const suggestedOwnerId = customerAIEnabled\(\) \? item\.suggested_owner_id : ''/);
  assert.doesNotMatch(app, /name="reason" value="\$\{esc\(customerAIEnabled\(\)/);
  assert.doesNotMatch(app, /分配说明/);
});

test('disabled customer, evaluation and notification views omit historical AI presentation', () => {
  assert.match(app, /const ai = !technicalAIPresentationAllowed\(\) \? '' : item\.aiStatus/);
  assert.match(app, /showAI \? '保存并生成AI标注' : '保存评价'/);
  assert.match(app, /\.\.\.\(technicalAIPresentationAllowed\(\) \? \[\['评价标签'/);
  assert.match(app, /const customerTags = Array\.isArray\(account\?\.customerTags\) \? account\.customerTags : \[\]/);
  assert.doesNotMatch(app, /const ai = customerAIEnabled\(\) && account\?\.id\s*\? labelsForAccount\(account\.id\)/);
  assert.match(app, /function notificationRowsAllowedByAIGate\(rows\) \{[\s\S]*?const aiEnabled = customerAIEnabled\(\);[\s\S]*?const packEnabled = salesPackEnabled\(\);[\s\S]*?!aiNotificationCodes\.has[\s\S]*?!salesPackNotificationCodes\.has/);
  assert.match(app, /visiblePermissionDefinitions\(\)/);
  const aiPermissions = app.match(/const aiPermissionKeys = new Set\(\[[\s\S]*?\]\);/)?.[0] || '';
  assert.doesNotMatch(aiPermissions, /manage_evaluations/);
  assert.match(app, /manage_evaluations: Object\.freeze\(\{ label: '客户经营复盘' \}\)/);
});

test('legacy workbench removes assistant, customer AI route and AI-only tags from the DOM', () => {
  assert.match(legacy, /function legacyAIEnabled\(\)\{return Boolean\(state\.capabilities\.features&&state\.capabilities\.features\.aiStations\)&&state\.capabilities\.user\?\.role!==\'sales\'\}/);
  assert.match(legacy, /function removeLegacyAIBusinessUI\(\)\{document\.body\.classList\.toggle\('ai-business-disabled',!legacyAIEnabled\(\)\);if\(legacyAIEnabled\(\)\)return;revokeModule\('assistant'\)/);
  assert.match(legacy, /document\.querySelector\('\[data-detail-tab="ai"\]'\)\?\.remove\(\)/);
  assert.match(legacy, /\$\('#detailPaneAi'\)\?\.remove\(\)/);
  assert.match(legacy, /ai=legacyAIEnabled\(\)\?/);
  assert.match(legacy, /body\.ai-business-disabled \[data-prospect-ask\] \{ display: none !important; \}/);
});

test('hidden AI views fall back to an allowed business route and can be restored', () => {
  assert.match(app, /function firstAllowedBusinessView\(\)/);
  assert.match(app, /if \(view === 'aiTasks' && !technicalAIPresentationAllowed\(\)\) \{\s*view = firstAllowedBusinessView\(\)/);
  assert.match(app, /state\.data\.features\.aiStations = Boolean\(features\.ai_stations\?\.effectiveEnabled\)/);
  assert.match(app, /applyUser\(\);\s*populateFilters\(\);\s*renderAll\(\);/);
});
