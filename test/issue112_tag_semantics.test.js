const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const legacyHtml = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const crmHtml = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const crmJs = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');

test('tag text normalization and dedup use the raw tag-name comparison contract', () => {
  assert.match(legacyHtml, /\.normalize\('NFKC'\)\.trim\(\)\.replace\(\/\\s\+\/gu,' '\)/);
  assert.match(crmJs, /\.normalize\('NFKC'\)\.trim\(\)\.replace\(\/\\s\+\/gu, ' '\)/);
  assert.match(legacyHtml, /function dedupeSourceTags\(tags\)\{const seen=new Set/);
  assert.match(legacyHtml, /const key=normalizeTagText\(tag\.name\)/);
  assert.match(crmJs, /const key = normalizeTagText\(tag\.name\)/);
  assert.doesNotMatch(crmJs, /const key = `\$\{tag\.source\}:\$\{normalizeTagText\(tag\.name\)\}`/);
});

test('customer tag summaries render the stored tag name without source prefixes', () => {
  assert.match(
    legacyHtml,
    /return`<span class="tag customer-tag" title="\$\{escapeAttr\(tag\.category\|\|'客户标签'\)\}">\$\{escapeHtml\(tag\.name\|\|''\)\}\$\{remove\}<\/span>`/,
  );
  assert.match(crmJs, /\$\{shown\.map\(tag => `<span class="source-tag \$\{esc\(tag\.source\)\}" title="\$\{esc\(tag\.category \|\| '客户标签'\)\}">\$\{esc\(tag\.name\)\}<\/span>`\)/);
  for (const prefix of ['人工', 'AI', '风险', '客户类型']) {
    assert.doesNotMatch(legacyHtml, new RegExp(`${prefix} · \\$\\{escapeHtml\\(tag\\.name`));
    assert.doesNotMatch(crmJs, new RegExp(`${prefix} · \\$\\{esc\\(tag\\.name`));
  }
  assert.doesNotMatch(crmJs, /\$\{esc\(tag\.prefix\)\} · \$\{esc\(tag\.name\)\}/);
});

test('tag summaries use assigned database tags and do not synthesize structured field tags', () => {
  assert.match(
    legacyHtml,
    /function semanticTagGroups\(c\)\{const tags=Array\.isArray\(c&&c\.tags\)\?c\.tags:\[\]/,
  );
  assert.match(legacyHtml, /tags\.forEach\(tag=>\{if\(tag\.readOnly\)ai\.push\(tag\);else manual\.push\(tag\)\}\)/);
  assert.match(legacyHtml, /return\{manual:dedupeSourceTags\(manual\),manualAll:manual,ai:dedupeSourceTags\(ai\),structuredNames:new Set\}/);
  assert.doesNotMatch(legacyHtml, /source:'structured',prefix:'客户类型'/);
  assert.doesNotMatch(legacyHtml, /tag\.category==='需确认属性'/);
  assert.doesNotMatch(legacyHtml, /parts=\[c\.customerType,c\.industry/);
  assert.match(crmJs, /const customerTags = Array\.isArray\(account\?\.customerTags\) \? account\.customerTags : \[\]/);
  assert.doesNotMatch(crmJs, /account\?\.customer_type \? \{ source: 'structured'/);
  assert.doesNotMatch(crmJs, /account\?\.industry \? \{ source: 'structured'/);
  assert.doesNotMatch(crmJs, /structuredNames/);
});

test('all non-AI labels remain editable regardless of category or preset status', () => {
  assert.match(legacyHtml, /manualCatalog=\(state\.tags\|\|\[\]\)\.filter\(tag=>!tag\.readOnly\)/);
  assert.doesNotMatch(legacyHtml, /function isProtectedCustomerTag\(tag\)/);
  assert.doesNotMatch(legacyHtml, /\['客户类型','需确认属性'\]\.includes\(tag\.category\)/);
  assert.doesNotMatch(legacyHtml, /protectedIds=/);
  assert.match(legacyHtml, /const tagIds=unique\(\$\$\('\.customer-tag-check'\)\.filter\(i=>i\.checked\)\.map\(i=>Number\(i\.value\)\)\)/);
  assert.match(legacyHtml, /if\(!target\)return;refreshTagViews/);
});

test('AI tags disappear when the AI feature is disabled and never add an AI prefix', () => {
  assert.match(legacyHtml, /\.\.\.\(legacyAIEnabled\(\)\?groups\.ai\.map/);
  assert.match(crmJs, /customerAIEnabled\(\)/);
  assert.doesNotMatch(crmJs, /prefix: 'AI'/);
  assert.doesNotMatch(crmJs, /sourceTagMarkup\(account, 4\)\}\$\{customerAIEnabled/);
});

test('manual removal is keyboard accessible, optimistic, reversible, and synchronized to the parent', () => {
  assert.match(legacyHtml, /<button class="tag-remove" type="button" data-remove-manual-tag=/);
  assert.match(legacyHtml, /aria-label="移除标签 \$\{escapeAttr\(tag\.name\|\|''\)\}"/);
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
  assert.match(crmHtml, /app\.css\?v=20260814-issue291-browser-regressions/);
  assert.match(crmHtml, /app\.js\?v=20260814-issue291-browser-regressions/);
  assert.match(crmHtml, /id="customerProfileTags"/);
  assert.match(crmJs, /\$\('#customerProfileTags'\)\.innerHTML = sourceTagMarkup\(account \|\|/);
});
