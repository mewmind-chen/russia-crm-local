'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');

test('protection workspace has one title and three top-level views', () => {
  assert.equal((html.match(/<h2>客户保护与查重<\/h2>/g) || []).length, 1);
  for (const view of ['verification', 'directory', 'import']) {
    assert.match(html, new RegExp(`data-protection-view="${view}"`));
    assert.match(html, new RegExp(`data-protection-panel="${view}"`));
  }
  assert.match(app, /function activateProtectionView\(view/);
  assert.match(app, /activeView: 'verification'/);
});

test('directory and import actions live in their own panels', () => {
  const directory = html.slice(html.indexOf('data-protection-panel="directory"'), html.indexOf('data-protection-panel="import"'));
  const importPanel = html.slice(html.indexOf('data-protection-panel="import"'));
  assert.match(directory, /protectedExportBtn/);
  assert.doesNotMatch(directory, /protectedTemplateBtn/);
  assert.match(importPanel, /protectedTemplateBtn/);
});
