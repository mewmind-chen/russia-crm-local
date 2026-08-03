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
  assert.match(app, /function customerAiSection\(context\) \{\s*if \(!customerAIEnabled\(\) \|\| !can\('use_ai_assistant'\)\) return '';/);
  assert.match(app, /function canViewManagerAnomalies\(\) \{\s*return customerAIEnabled\(\)/);
  assert.match(app, /function canViewSalesCoaching\(\) \{\s*return customerAIEnabled\(\)/);
  assert.match(app, /function canGovernAI\(\) \{\s*return customerAIEnabled\(\)/);
  assert.match(html, /data-view="aiTasks"[^>]*data-ai-business/);
  assert.match(html, /manager-anomaly-panel"[^>]*data-ai-business/);
  assert.match(html, /id="teamCoachingStatus"[^>]*data-ai-business/);
});

test('disabled intake rendering removes AI headers, cells and the third decision track', () => {
  assert.match(app, /const intakeHeaders = \[[\s\S]*?\.\.\.\(showAI \? \['Fit \/ readiness \/ 优先级'\] : \[\]\)/);
  assert.match(app, /\.\.\.\(showAssignmentAI \? \['候选销售排名'\] : \[\]\)/);
  assert.match(app, /salesView \? '负责人' : '负责人 \/ 阻断原因'/);
  assert.match(app, /const row = showAI\s*\? \[businessColumns\[0\], \.\.\.aiColumns, \.\.\.businessColumns\.slice\(1\)\]\s*: businessColumns/);
  assert.match(app, /<div class="decision-review-grid \$\{showAI \? '' : 'without-ai'\}">/);
  assert.match(css, /\.decision-review-grid\.without-ai\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(app, /const suggestedOwnerId = customerAIEnabled\(\) \? item\.suggested_owner_id : ''/);
  assert.doesNotMatch(app, /name="reason" value="\$\{esc\(customerAIEnabled\(\)/);
  assert.doesNotMatch(app, /分配说明/);
});

test('disabled customer, evaluation and notification views omit historical AI presentation', () => {
  assert.match(app, /const ai = !customerAIEnabled\(\) \? '' : item\.aiStatus/);
  assert.match(app, /showAI \? '保存并生成AI标注' : '保存评价'/);
  assert.match(app, /\.\.\.\(customerAIEnabled\(\) \? \[\['评价标签'/);
  assert.match(app, /const customerTags = Array\.isArray\(account\?\.customerTags\) \? account\.customerTags : \[\]/);
  assert.doesNotMatch(app, /const ai = customerAIEnabled\(\) && account\?\.id\s*\? labelsForAccount\(account\.id\)/);
  assert.match(app, /function notificationRowsAllowedByAIGate\(rows\) \{[\s\S]*?const aiEnabled = customerAIEnabled\(\);[\s\S]*?const packEnabled = salesPackEnabled\(\);[\s\S]*?!aiNotificationCodes\.has[\s\S]*?!salesPackNotificationCodes\.has/);
  assert.match(app, /visiblePermissionDefinitions\(\)/);
  assert.match(app, /visible\.manage_evaluations = '维护经理评价'/);
});

test('legacy workbench removes assistant, customer AI route and AI-only tags from the DOM', () => {
  assert.match(legacy, /function legacyAIEnabled\(\)\{return Boolean\(state\.capabilities\.features&&state\.capabilities\.features\.aiStations\)\}/);
  assert.match(legacy, /function removeLegacyAIBusinessUI\(\)\{document\.body\.classList\.toggle\('ai-business-disabled',!legacyAIEnabled\(\)\);if\(legacyAIEnabled\(\)\)return;revokeModule\('assistant'\)/);
  assert.match(legacy, /document\.querySelector\('\[data-detail-tab="ai"\]'\)\?\.remove\(\)/);
  assert.match(legacy, /\$\('#detailPaneAi'\)\?\.remove\(\)/);
  assert.match(legacy, /ai=legacyAIEnabled\(\)\?/);
  assert.match(legacy, /body\.ai-business-disabled \[data-prospect-ask\] \{ display: none !important; \}/);
});

test('hidden AI views fall back to an allowed business route and can be restored', () => {
  assert.match(app, /function firstAllowedBusinessView\(\)/);
  assert.match(app, /if \(view === 'aiTasks' && !customerAIEnabled\(\)\) \{\s*view = firstAllowedBusinessView\(\)/);
  assert.match(app, /state\.data\.features\.aiStations = Boolean\(features\.ai_stations\?\.effectiveEnabled\)/);
  assert.match(app, /applyUser\(\);\s*populateFilters\(\);\s*renderAll\(\);/);
});
