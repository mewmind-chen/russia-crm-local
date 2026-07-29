const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workbench = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const crm = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');

function functionSource(name, nextName) {
  const pattern = new RegExp(`function ${name}\\([^)]*\\)\\{([\\s\\S]*?)\\n\\s*(?:async\\s+)?function ${nextName}\\(`);
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
  const sanctionStatus = functionSource('customerSanctionStatus', 'renderReconInline');
  const reconPanel = functionSource('renderReconPanel', 'reconQualityLabel');
  const reconCompliance = functionSource('reconComplianceLabel', 'reconEvidenceLabel');
  const sanctionTag = functionSource('renderSanctionTag', 'renderReportLink');
  const reconExtended = functionSource('loadReconExtendedDetail', 'closeModal');

  assert.match(details, /customerSanctionStatus\(c\)/);
  assert.doesNotMatch(details, /riskStatus|compliance|sanctioned/);
  assert.match(details, /c\.createdAt\?formatDateTime\(c\.createdAt\):'未知'/);
  assert.match(details, /c\.updatedAt\?formatDateTime\(c\.updatedAt\):'未知'/);
  assert.match(sanctionStatus, /\['受制裁','未制裁','未知'\]\.includes\(status\)/);
  assert.match(sanctionStatus, /state\.customerPool\.find/);
  assert.match(reconPanel, /sn=renderSanctionTag\(c\)/);
  assert.match(reconPanel, /任务未完成，可重新执行以获取最新结果/);
  assert.doesNotMatch(reconPanel, /j\.error|compliance_status|sanction_status|sanctioned/);
  assert.match(reconCompliance, /customerSanctionStatus\(c\)/);
  assert.doesNotMatch(reconCompliance, /compliance_status|sanction_status|CLEAR|检查失败|未检查/);
  assert.match(sanctionTag, /escapeHtml\(status\)/);
  assert.doesNotMatch(sanctionTag, /sanction_source|sanction_program|未命中/);
  assert.match(reconExtended, /sanctionStatus=customerSanctionStatus\(target\)/);
  assert.match(reconExtended, /<span>制裁状态<\/span>/);
  assert.doesNotMatch(reconExtended, /sanction\.result|sanction\.review_status|e\.message|合规复核/);
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

test('issue 128 tag changes refresh the lifecycle value in the open profile', () => {
  const applyTags = functionSource('applyCustomerTags', 'notifyParentTags');
  const refreshTags = functionSource('refreshTagViews', 'saveCustomerTags');
  const saveTags = functionSource('saveCustomerTags', 'removeManualTag');

  assert.match(applyTags, /c\.updatedAt=updatedAt/);
  assert.match(refreshTags, /renderPoolDetails\(state\.currentTagTarget\)/);
  assert.match(saveTags, /r\.updatedAt\|\|''/);
});

test('issue 128 detail cards retain bounded desktop and single-column mobile grids', () => {
  assert.match(workbench, /\.detail-grid \{ display: grid; grid-template-columns: repeat\(3,minmax\(180px,1fr\)\); gap: 10px; \}/);
  assert.match(workbench, /@media \(max-width:720px\)[^{]*\{[\s\S]*?\.detail-grid,[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(workbench, /@media \(max-width:720px\)[^{]*\{[\s\S]*?\.detail-item\.span-2, \.detail-item\.span-3,[\s\S]*?grid-column: auto;/);
});
