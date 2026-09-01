const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const legacyHtml = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const crmHtml = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const crmJs = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');
const sourceTagsJs = fs.readFileSync(path.join(root, 'sales-assets/source-tags-widget.js'), 'utf8');
const sourceTagsWidget = require('../sales-assets/source-tags-widget');

test('tag text normalization and dedup use the raw tag-name comparison contract', () => {
  assert.match(legacyHtml, /\.normalize\('NFKC'\)\.trim\(\)\.replace\(\/\\s\+\/gu,' '\)/);
  assert.match(sourceTagsJs, /\.normalize\('NFKC'\)\s*\.trim\(\)\s*\.replace\(\/\\s\+\/gu, ' '\)/);
  assert.match(legacyHtml, /function dedupeSourceTags\(tags\)\{const seen=new Set/);
  assert.match(legacyHtml, /const key=normalizeTagText\(tag\.name\)/);
  assert.match(crmJs, /sourceTagsWidgetApi\(\)\?\.normalizeTagText/);
  assert.match(crmJs, /sourceTagsWidgetApi\(\)\?\.uniqueSourceTags/);
  assert.doesNotMatch(crmJs, /const key = normalizeTagText\(tag\.name\)/);
  assert.doesNotMatch(crmJs, /const key = `\$\{tag\.source\}:\$\{normalizeTagText\(tag\.name\)\}`/);

  assert.equal(sourceTagsWidget.normalizeTagText('  ＡＢＣ\t  Def  '), 'abc def');
  const tags = sourceTagsWidget.uniqueSourceTags([
    { name: '  ＡＢＣ  ' },
    { name: 'abc' },
    { name: ' \t ' },
    { name: '客户\n标签' },
    { name: '客户 标签' },
    { name: '另一个' },
  ]);
  assert.deepEqual(tags.map(tag => tag.name), ['  ＡＢＣ  ', '客户\n标签', '另一个']);
});

test('customer tag summaries render the stored tag name without source prefixes', () => {
  assert.match(
    legacyHtml,
    /return`<span class="tag customer-tag" title="\$\{escapeAttr\(tag\.category\|\|'客户标签'\)\}">\$\{escapeHtml\(tag\.name\|\|''\)\}\$\{remove\}<\/span>`/,
  );
  assert.match(sourceTagsJs, /\$\{escapeHtml\(tag\.source\)\}.*\$\{escapeHtml\(tag\.category \|\| '客户标签'\)\}.*\$\{escapeHtml\(tag\.name\)\}/s);
  const markup = sourceTagsWidget.renderSourceTagRowHtml({
    account: { customerTags: [{ name: '人工标签', category: '来源' }] },
    includeReadOnly: true,
  });
  assert.match(markup, /人工标签/);
  assert.doesNotMatch(markup, /人工 ·|AI ·/);
  for (const prefix of ['人工', 'AI', '风险', '客户类型']) {
    assert.doesNotMatch(legacyHtml, new RegExp(`${prefix} · \\$\\{escapeHtml\\(tag\\.name`));
    assert.doesNotMatch(sourceTagsJs, new RegExp(`${prefix} · \\$\\{escapeHtml\\(tag\\.name`));
  }
  assert.doesNotMatch(sourceTagsJs, /\$\{escapeHtml\(tag\.prefix\)\} · \$\{escapeHtml\(tag\.name\)\}/);
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
  assert.match(crmJs, /function accountSourceTags\(account, options = \{\}\)/);
  assert.match(crmJs, /widget\.accountSourceTags\(account, \{ includeReadOnly \}\)/);
  assert.doesNotMatch(sourceTagsJs, /customer_type|industry/);
  assert.deepEqual(
    sourceTagsWidget.accountSourceTags({
      customer_type: '制造商',
      industry: '电子',
      customerTags: [{ name: '仅来自标签' }],
    }, { includeReadOnly: true }).map(tag => tag.name),
    ['仅来自标签'],
  );
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
  assert.match(crmJs, /includeReadOnly: customerAIEnabled\(\)/);
  assert.doesNotMatch(sourceTagsJs, /prefix: 'AI'/);
  const account = {
    customerTags: [
      { name: '手工', readOnly: false },
      { name: 'AI 结论', readOnly: true },
    ],
  };
  assert.deepEqual(sourceTagsWidget.accountSourceTags(account, { includeReadOnly: false }).map(tag => tag.name), ['手工']);
  assert.deepEqual(sourceTagsWidget.accountSourceTags(account, { includeReadOnly: true }).map(tag => tag.name), ['手工', 'AI 结论']);
});

test('source tag widget escapes name/category/source and honors the default limit and overflow', () => {
  const account = {
    customerTags: [
      { name: '<img src=x onerror=alert(1)>', category: '"quoted" & <unsafe>', readOnly: false },
      { name: 'AI 标签', category: "'><script>", readOnly: true },
      { name: '第三个', category: '第三类', readOnly: false },
      { name: '第四个', category: '第四类', readOnly: false },
      { name: '第五个', category: '第五类', readOnly: false },
      { name: '第六个', category: '第六类', readOnly: false },
    ],
  };
  const markup = sourceTagsWidget.renderSourceTagRowHtml({ account, includeReadOnly: true });
  assert.doesNotMatch(markup, /<img|<script>/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markup, /title="&quot;quoted&quot; &amp; &lt;unsafe&gt;"/);
  assert.match(markup, /source-tag manual/);
  assert.match(markup, /source-tag ai/);
  assert.match(markup, /\+1/);
  const firstFive = [
    '&lt;img src=x onerror=alert(1)&gt;',
    'AI 标签', '第三个', '第四个', '第五个',
  ];
  for (let index = 1; index < firstFive.length; index += 1) {
    assert.ok(markup.indexOf(firstFive[index - 1]) < markup.indexOf(firstFive[index]),
      `tag ${index} must preserve source order`);
  }
  assert.doesNotMatch(markup, /第六个/);
  assert.equal((markup.match(/class="source-tag /g) || []).length, 6);
  assert.equal(sourceTagsWidget.renderSourceTagRowHtml({ account: { customerTags: [] } }), '');
  assert.doesNotThrow(() => sourceTagsWidget.accountSourceTags({
    customerTags: [null, undefined, 'primitive', 0, false, { name: '有效标签' }],
  }, { includeReadOnly: true }));
  assert.deepEqual(sourceTagsWidget.accountSourceTags({
    customerTags: [null, undefined, 'primitive', 0, false, { name: '有效标签' }],
  }, { includeReadOnly: true }).map(tag => tag.name), ['有效标签']);
  assert.doesNotThrow(() => sourceTagsWidget.renderSourceTagRowHtml(null));
  assert.equal(sourceTagsWidget.renderSourceTagRowHtml(null), '');
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
  assert.match(crmHtml, /app\.css\?v=20260824-studio-deck-v1/);
  assert.match(crmHtml, /app\.js\?v=20260824-studio-deck-v1/);
  assert.match(crmHtml, /source-tags-widget\.js\?v=20260824-studio-deck-v1/);
  assert.match(crmHtml, /id="customerProfileTags"/);
  assert.match(crmJs, /\$\('#customerProfileTags'\)\.innerHTML = sourceTagMarkup\(account \|\|/);
  assert.match(crmJs, /<span class="pill amber">\$\{esc\(lead\.identityWarning\.label \|\| '名称待核验'\)\}<\/span>/);
});
