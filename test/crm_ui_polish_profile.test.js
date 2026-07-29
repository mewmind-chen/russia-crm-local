const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workbench = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');

function functionSource(name, nextName) {
  const pattern = new RegExp(
    `function ${name}\\([^)]*\\)\\{([\\s\\S]*?)\\n\\s*(?:async\\s+)?function ${nextName}\\(`,
  );
  const match = workbench.match(pattern);
  assert.ok(match, `${name} source should be present`);
  return match[0];
}

test('embedded customer profile uses four definition groups', () => {
  const details = functionSource('renderPoolDetails', 'renderTagEditor');

  assert.equal((details.match(/renderDetailSection\(/g) || []).length, 4);
  for (const heading of [
    '身份与地区',
    '业务画像与产品需求',
    '联系渠道',
    '合规、来源与生命周期',
  ]) {
    assert.match(details, new RegExp(heading));
  }

  assert.match(workbench, /function renderDetailValue\(value,\s*raw\s*=\s*false\)/);
  assert.match(workbench, /function renderDetailSection\(title,\s*rows\)/);
  assert.match(workbench, /function readableProductText\(value\)/);
  assert.match(workbench, /JSON\.parse\(raw\)/);
  assert.match(details, /readableProductText\(c\.products\)/);
  assert.match(workbench, /\.detail-definition-grid\s*\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(workbench, /\.detail-empty\s*\{[^}]*color:\s*var\(--muted\)/);
});

test('Recon has an intentional empty state while preserving its action gate', () => {
  const panel = functionSource('renderReconPanel', 'reconQualityLabel');

  assert.match(panel, /if\s*\(!j\s*&&\s*!r\)/);
  assert.match(panel, /class="recon-empty-state"/);
  assert.match(panel, /尚未生成客户情报/);
  assert.match(panel, /state\.profileAccess\?\.readOnly/);
  assert.match(panel, /id="startReconBtn"/);
  assert.match(panel, /只读资料/);
  assert.match(workbench, /\.recon-empty-state\s*\{[^}]*min-height:\s*320px/);
  assert.match(workbench, /\.recon-empty-state \.line-icon\s*\{/);
});

test('tag editor supports search, disclosure counts, and sticky save', () => {
  const editor = functionSource('renderTagEditor', 'groupTags');

  assert.match(editor, /id="tagSearch"/);
  assert.match(editor, /<details class="tag-group"/);
  assert.match(editor, /selectedCount\s*\?\s*' open'\s*:\s*''/);
  assert.match(editor, /\$\{selectedCount\}\s*\/\s*\$\{groups\[cat\]\.length\}/);
  assert.match(editor, /class="customer-tag-check"/);
  assert.match(editor, /id="saveTagsBtn"/);
  assert.match(editor, /id="tagEditorCancel"/);
  assert.match(editor, /class="tag-editor-actions"/);
  assert.match(workbench, /function filterTagEditor\(query\)/);
  assert.match(workbench, /function updateTagSelectionCount\(input\)/);
  assert.match(workbench, /\.tag-editor-actions\s*\{[^}]*position:\s*sticky/);
});

test('tag UI keeps existing IDs, API actions, permissions, and parent notification', () => {
  const bindEvents = functionSource('bindEvents', 'bindNavigationShell');
  const saveTags = functionSource('saveCustomerTags', 'removeManualTag');
  const createTag = functionSource('createCustomTag', 'saveCustomer');
  const notifyParent = functionSource('notifyParentTags', 'refreshTagViews');

  assert.match(bindEvents, /#saveTagsBtn/);
  assert.match(bindEvents, /#createTagBtn/);
  assert.match(bindEvents, /#tagEditorCancel/);
  assert.match(bindEvents, /#tagSearch/);
  assert.match(saveTags, /postAppAction\('setCustomerTags'/);
  assert.match(saveTags, /\.customer-tag-check/);
  assert.match(saveTags, /setAttribute\('aria-busy','true'\)/);
  assert.match(saveTags, /removeAttribute\('aria-busy'\)/);
  assert.match(createTag, /postAppAction\('createTag'/);
  assert.match(createTag, /postAppAction\('setCustomerTags'/);
  assert.match(workbench, /function canRemoveManualTags\(\)/);
  assert.match(notifyParent, /window\.parent\.postMessage/);
  assert.match(notifyParent, /tradepulse:customer-tags-updated/);
});

test('cancelling tag edits discards the draft before returning to overview', () => {
  const cancel = functionSource('cancelTagEditor', 'groupTags');

  assert.match(cancel, /state\.currentTagTarget/);
  assert.match(
    cancel,
    /#tagEditorPanel[\s\S]*?renderTagEditor\(state\.currentTagTarget\)[\s\S]*?setDetailTab\('overview'\)/,
  );
});
