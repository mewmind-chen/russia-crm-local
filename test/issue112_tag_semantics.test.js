const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const legacyHtml = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const crmHtml = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const crmJs = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');
const crmCss = fs.readFileSync(path.join(root, 'sales-assets/app.css'), 'utf8');

test('tag text normalization and same-source dedup use the issue 112 comparison contract', () => {
  assert.match(legacyHtml, /\.normalize\('NFKC'\)\.trim\(\)\.replace\(\/\\s\+\/gu,' '\)/);
  assert.match(crmJs, /\.normalize\('NFKC'\)\.trim\(\)\.replace\(\/\\s\+\/gu, ' '\)/);
  assert.match(legacyHtml, /function dedupeSourceTags\(tags\)\{const seen=new Set/);
  assert.match(crmJs, /const key = `\$\{tag\.source\}:\$\{normalizeTagText\(tag\.name\)\}`/);
});

test('structured manual AI and risk tags expose consistent text and color semantics', () => {
  for (const source of ['structured', 'manual', 'ai', 'risk']) {
    assert.match(legacyHtml, new RegExp(`\\.tag\\.source-${source}`));
    assert.match(crmCss, new RegExp(`\\.source-tag\\.${source}`));
  }
  assert.match(legacyHtml, /manual:'人工',ai:'AI',risk:'风险'/);
  assert.match(crmJs, /prefix: 'AI'/);
  assert.match(crmJs, /tag\.source === 'ai' \? 'AI评价，只读'/);
});

test('manual duplicates stay selected in the editor but are suppressed from summaries', () => {
  assert.match(legacyHtml, /manualAll:dedupeSourceTags\(manual\)/);
  assert.match(legacyHtml, /manual:dedupeSourceTags\(manual\)\.filter\(tag=>!structuredNames\.has/);
  assert.match(legacyHtml, /selected=new Set\(semantic\.manualAll\.map/);
  assert.match(legacyHtml, /与结构化字段重复，顶部已合并/);
  assert.match(crmJs, /tag\.source !== 'manual' \|\| !structuredNames\.has/);
});

test('preset customer labels remain editable except system customer type and risk categories', () => {
  assert.match(legacyHtml, /function isProtectedCustomerTag\(tag\)/);
  assert.match(legacyHtml, /\['客户类型','需确认属性'\]\.includes\(tag\.category\)/);
  assert.match(legacyHtml, /manualCatalog=\(state\.tags\|\|\[\]\)\.filter\(tag=>!\(tag\.isPreset&&\['客户类型','需确认属性'\]\.includes\(tag\.category\)\)\)/);
  assert.match(legacyHtml, /else manual\.push\(tag\)/);
  assert.match(legacyHtml, /filter\(isProtectedCustomerTag\)/);
  assert.match(legacyHtml, /if\(!target\|\|isProtectedCustomerTag\(target\)\)return/);
});

test('AI tags remain source-distinct and disappear when the AI feature is disabled', () => {
  assert.match(legacyHtml, /\.\.\.\(legacyAIEnabled\(\)\?groups\.ai\.map/);
  assert.match(crmJs, /const ai = customerAIEnabled\(\) && account\?\.id/);
  assert.match(crmJs, /return uniqueSourceTags\(\[\.\.\.structured, \.\.\.tagged, \.\.\.ai\]\)/);
  assert.doesNotMatch(crmJs, /sourceTagMarkup\(account, 4\)\}\$\{customerAIEnabled/);
});

test('manual removal is keyboard accessible, optimistic, reversible, and synchronized to the parent', () => {
  assert.match(legacyHtml, /<button class="tag-remove" type="button" data-remove-manual-tag=/);
  assert.match(legacyHtml, /aria-label="移除人工标签 \$\{escapeAttr\(tag\.name\|\|''\)\}"/);
  assert.match(legacyHtml, /refreshTagViews\(c\.customerId,previous\.filter/);
  assert.match(legacyHtml, /catch\(error\)\{refreshTagViews\(c\.customerId,previous\)/);
  assert.match(legacyHtml, /window\.parent\.postMessage\(\{type:'tradepulse:customer-tags-updated'/);
  assert.match(crmJs, /event\.source !== profileFrame\?\.contentWindow/);
  assert.match(crmJs, /event\.data\?\.type !== 'tradepulse:customer-tags-updated'/);
  assert.match(crmJs, /renderCustomers\(\);\s+renderIntake\(\);/);
});

test('server refreshes preserve read-only AI tags and new manual tags do not submit AI IDs', () => {
  assert.match(legacyHtml, /function mergeCustomerTags\(existing,incoming\)/);
  assert.match(legacyHtml, /\.filter\(tag=>tag\.readOnly\)\.forEach/);
  assert.match(legacyHtml, /\.filter\(tag=>!tag\.readOnly\)\.map\(t=>String\(t\.id\)\)/);
});

test('CRM assets use the current tag cache version and profile header has a synchronized tag target', () => {
  assert.match(crmHtml, /app\.css\?v=20260728-issue-120/);
  assert.match(crmHtml, /app\.js\?v=20260728-issue-120/);
  assert.match(crmHtml, /id="customerProfileTags"/);
  assert.match(crmJs, /\$\('#customerProfileTags'\)\.innerHTML = sourceTagMarkup\(account\)/);
});
