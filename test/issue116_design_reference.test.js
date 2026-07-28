const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const referenceDir = path.join(root, 'docs', 'design-references', 'issue-116');
const referenceHtmlPath = path.join(referenceDir, 'admin-filter-permission-preview.html');
const referencePngPath = path.join(referenceDir, 'admin-filter-permission-preview.png');
const readmePath = path.join(referenceDir, 'README.md');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('Issue #116 keeps the approved design references byte-for-byte', () => {
  assert.equal(
    sha256(referenceHtmlPath),
    '8e6c4216e1af09575b01cb51e359358530fd9dc6aaa40247512aac7abd1120dd',
  );
  assert.equal(
    sha256(referencePngPath),
    '2bb35efc08f4ed03a7276b3bcee1e8adb01dbe254cb8b14a4537ff9d3a92d250',
  );
});

test('the PNG metadata remains available for visual-review tooling', () => {
  const png = fs.readFileSync(referencePngPath);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), 915);
  assert.equal(png.readUInt32BE(20), 1059);
});

test('the HTML reference contains the approved shell and permission interactions', () => {
  const html = fs.readFileSync(referenceHtmlPath, 'utf8');
  for (const marker of [
    'TradePulse',
    '筛选字段权限',
    '配置范围',
    '权限组',
    '个人例外',
    '恢复组默认',
    '保存配置',
    '横向筛选',
    '更多筛选',
  ]) {
    assert.match(html, new RegExp(marker), `missing approved marker: ${marker}`);
  }
});

test('the acceptance README records categories, viewport checks, conflicts, and issue boundaries', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');
  for (const category of [
    '客户类型',
    '客户经营产品',
    '应用行业',
    '需求/采购产品',
    '重点场景',
    '需确认属性',
    '名单标签',
  ]) {
    assert.match(readme, new RegExp(category), `missing category: ${category}`);
  }
  for (const contract of [
    '1440 × 900',
    '390 × 844',
    'OR（或）',
    'AND（且）',
    '只能出现在“用户与权限”页',
    '#111',
    '#113',
    '服务端分页 API',
    '导出必须复用',
  ]) {
    assert.match(readme, new RegExp(contract), `missing acceptance contract: ${contract}`);
  }
});
