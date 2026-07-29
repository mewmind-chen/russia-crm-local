'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets', 'app.css'), 'utf8');

test('assignment rules are a management-center page and the lead-pool shortcut navigates to it', () => {
  assert.match(html, /data-view="assignmentRules"[^>]*data-permission="manage_intake"/);
  assert.match(html, /id="assignmentRulesView"[^>]*assignment-rules-view/);
  assert.match(html, /id="assignmentRulesList"/);
  assert.match(html, /id="assignmentRulesSimulate"/);
  assert.match(html, /id="assignmentRulesHistory"/);
  assert.match(html, /id="assignmentRulesPublish"/);
  assert.match(js, /closest\('#intakeSettingsBtn'\)\)\s*switchView\('assignmentRules'\)/);
  assert.match(js, /canonicalView === 'assignmentRules'\)\s*void loadAssignmentRules\(\)/);
});

test('rule editor exposes only structured business fields and all supported strategies', () => {
  for (const field of [
    'countries', 'industries', 'products', 'customerTypes', 'tagIds', 'matchGroups',
  ]) {
    assert.match(js, new RegExp(`name="${field}"`));
  }
  assert.match(js, /value="selected"/);
  assert.match(js, /value="all_authorized"/);
  assert.match(js, /value="balanced"/);
  assert.match(js, /value="round_robin"/);
  assert.match(js, /value="fixed_priority"/);
  assert.match(js, /name="dailyQuota"/);
  assert.match(js, /data-rule-sales-priority/);
  assert.doesNotMatch(html + js, /name="(?:sql|script|formula|code)"/i);
});

test('frontend uses the issue 138 draft, ordering, publishing, history and simulation API contract', () => {
  assert.match(js, /api\('\/intake\/assignment-rules'\)/);
  assert.match(js, /api\('\/intake\/assignment-rules\/draft'/);
  assert.match(js, /api\(`\/intake\/assignment-rules\/\$\{encodeURIComponent\(ruleId\)\}`/);
  assert.match(js, /api\('\/intake\/assignment-rules\/reorder'/);
  assert.match(js, /api\('\/intake\/assignment-rules\/publish'/);
  assert.match(js, /api\('\/intake\/assignment-rules\/versions'\)/);
  assert.match(js, /\/intake\/assignment-rules\/versions\/\$\{encodeURIComponent\(versionId\)\}\/restore/);
  assert.match(js, /api\('\/intake\/assignment-rules\/simulate'/);
  assert.match(js, /expectedRevision:\s*state\.assignmentRules\.draftRevision/);
  assert.match(js, /不会分配客户、创建 CRM 客户或占用销售额度/);
  assert.match(js, /function assignmentChangeSummaryText\(summary\)/);
  assert.match(js, /本次变更：/);
  assert.match(js, /恢复自 v/);
  assert.doesNotMatch(js, /esc\(version\.note \|\| version\.changeSummary/);
});

test('administrator, manager, sales and impersonated identities receive different rule controls', () => {
  assert.match(js, /state\.data\?\.user\?\.role === 'admin'[\s\S]*!state\.data\?\.impersonation/);
  assert.match(js, /\['admin', 'manager'\]\.includes\(state\.data\?\.user\?\.role\)/);
  assert.match(js, /data-assignment-admin-action/);
  assert.match(js, /候选人员明细和每日额度仅管理员可见/);
  assert.match(js, /当前正在模拟其他账号[\s\S]*不能修改、排序、发布或恢复版本/);
  assert.match(js, /assignmentRulesList'\)\?\.classList\.toggle\('redacted', !admin\)/);
  assert.match(js, /销售经理只显示命中规则、最终结果和业务原因/);
  assert.match(js, /view === 'assignmentRules' && !canViewAssignmentRules\(\)/);
  assert.match(js, /canSeeRuleReason = \['admin', 'manager'\]\.includes/);
  assert.match(js, /仅显示分配给你的线索/);
  assert.match(js, /salesView \? '' : `<span class="decision-block">/);
});

test('assignment rule workspace is responsive across phone, tablet and desktop layouts', () => {
  assert.match(css, /\.assignment-rules-table-head,.assignment-rule-row\{display:grid/);
  assert.match(css, /@media\(max-width:1180px\)/);
  assert.match(css, /@media\(max-width:780px\)[\s\S]*\.assignment-rule-form\{grid-template-columns:1fr\}/);
  assert.match(css, /@media\(max-width:480px\)[\s\S]*\.assignment-rules-actions\{grid-template-columns:1fr\}/);
});
