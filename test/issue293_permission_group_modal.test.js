'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('Issue 293 uses current module names once and removes stale navigation wording', () => {
  const categories = section(app, 'const PERMISSION_CATEGORIES', 'function permissionCategoryMarkup');
  const permissionPresentationSource = section(app, 'function visiblePermissionDefinitions', 'function applyBusinessAIVisibility');
  for (const label of ['经营驾驶舱', '今日待办', '通知中心', '线索池', '客户联系人线索',
    'Recon 情报', 'CRM客户全景', '不对口记录', '推进管道', '主管介入任务',
    '团队状态', '经理评价', '用户与权限', '客户保护与查重', '数据维护']) {
    assert.match(permissionPresentationSource, new RegExp(label));
  }
  assert.doesNotMatch(permissionPresentationSource, /客户回收站|客户开发工作台/);
  assert.equal((categories.match(/'view_intake'/g) || []).length, 1);
  assert.match(app, /team: 'view_team'/);
});

test('every visible permission card has category-aware explanatory copy', () => {
  const groupFields = section(app, 'function permissionFields', 'function openEditUserModal');
  assert.match(groupFields, /permissionDescription\(/);
  assert.match(app, /允许进入/);
  assert.match(app, /允许执行/);
});

test('category counts use only definitions that are actually rendered', () => {
  assert.match(app, /function visibleCategoryPermissions\(/);
  assert.match(app, /visiblePermissions\.length/);
  assert.match(app, /本分类共 \$\{visiblePermissions\.length\} 项/);
});

test('group editor uses a dedicated wide modal shell and layout contracts', () => {
  const modal = section(app, 'function openPermissionGroupModal', 'function openOverridesModal');
  assert.match(modal, /permission-group-modal/);
  assert.match(modal, /permission-group-form/);
  assert.match(modal, /permission-group-metadata/);
  assert.match(modal, /permission-group-description/);
  assert.match(modal, /permission-group-guidance/);
  assert.match(modal, /permission-group-footer/);
  assert.match(css, /\.permission-group-modal\{[^}]*width:min\(1320px,calc\(100vw - 48px\)\)/);
  assert.match(css, /\.permission-group-modal\{[^}]*overflow:hidden/);
  assert.match(css, /\.permission-group-modal \.permission-switch-panel\{[^}]*overflow:visible/);
  assert.match(css, /\.permission-group-footer\{[^}]*position:sticky/);
  assert.match(css, /@media\(max-width:1099px\)[\s\S]*permission-group-modal[\s\S]*overflow:auto/);
});

test('permission category tabs connect named panels and support keyboard navigation', () => {
  assert.match(app, /aria-controls="permission-group-panel-/);
  assert.match(app, /role="tabpanel"/);
  assert.match(app, /ArrowLeft|ArrowRight/);
  assert.match(app, /event\.key === 'Home'|event\.key === 'End'/);
});
