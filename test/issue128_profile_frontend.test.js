const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workbench = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const crm = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');

function functionSource(name, nextName) {
  const pattern = new RegExp(`function ${name}\\([^)]*\\)\\{([\\s\\S]*?)\\n\\s*function ${nextName}\\(`);
  const match = workbench.match(pattern);
  assert.ok(match, `${name} source should be present`);
  return match[0];
}

test('issue 128 customer pool details expose only the customer-facing fields', () => {
  const details = functionSource('renderPoolDetails', 'renderTagEditor');

  for (const label of ['搜索次数', '已验证', '备注', '域名', '官网验证', '首次发现', '最后发现']) {
    assert.doesNotMatch(details, new RegExp(label), `${label} should not be rendered`);
  }
  for (const label of ['官网', '客户类型', '制裁状态', '创建时间', '最后修改时间']) {
    assert.match(details, new RegExp(label), `${label} should remain visible`);
  }

  assert.match(details, /renderWebsite\(c\.website\)/);
  assert.doesNotMatch(details, /c\.domain|c\.websiteVerification/);
  assert.doesNotMatch(details, /c\.searchCount|c\.verified|c\.notes/);
});

test('issue 128 profile consumes the three-state sanction and lifecycle API contract', () => {
  const details = functionSource('renderPoolDetails', 'renderTagEditor');

  assert.match(details, /\['受制裁','未制裁','未知'\]\.includes\(c\.sanctionStatus\)/);
  assert.match(details, /\?c\.sanctionStatus:'未知'/);
  assert.doesNotMatch(details, /riskStatus|compliance|sanctioned/);
  assert.match(details, /c\.createdAt\?formatDateTime\(c\.createdAt\):'-'/);
  assert.match(details, /c\.updatedAt\?formatDateTime\(c\.updatedAt\):'-'/);
});

test('issue 128 profile keeps one company heading and preserves tags', () => {
  const hero = functionSource('renderDetailHero', 'renderDetails');
  const poolTags = functionSource('renderPoolTags', 'renderDetailHero');

  assert.match(crm, /<h2 id="customerProfileTitle">客户资料<\/h2>/);
  assert.match(workbench, /body\.profile-mode #modalTitle,\s*body\.profile-mode \.detail-hero h3 \{ display: none; \}/);
  assert.match(workbench, /body\.profile-mode #closeModalBtn \{ display: none; \}/);
  assert.doesNotMatch(workbench, /body\.profile-mode \.modal-head \{ display: none; \}/);
  assert.match(hero, /<h3>\$\{escapeHtml\(name\)\}<\/h3>/);
  assert.match(hero, /site=c\.website\|\|''/);
  assert.doesNotMatch(hero, /c\.website\|\|c\.domain/);
  assert.match(workbench, /id="modalTags"/);
  assert.match(poolTags, /renderSemanticSummary\(c,\{removable:canRemoveManualTags\(\)\}\)/);
  assert.match(workbench, /\['客户类型',c\.customerType\]/);
});

test('issue 128 detail cards retain bounded desktop and single-column mobile grids', () => {
  assert.match(workbench, /\.detail-grid \{ display: grid; grid-template-columns: repeat\(3,minmax\(180px,1fr\)\); gap: 10px; \}/);
  assert.match(workbench, /@media \(max-width:720px\)[^{]*\{[\s\S]*?\.detail-grid,[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(workbench, /@media \(max-width:720px\)[^{]*\{[\s\S]*?\.detail-item\.span-2, \.detail-item\.span-3,[\s\S]*?grid-column: auto;/);
});
