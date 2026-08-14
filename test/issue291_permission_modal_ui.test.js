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

test('permission editor renders three categories with switches', () => {
  const editor = section(app, 'const PERMISSION_CATEGORIES', 'function personalPermissionFields');
  assert.match(editor, /模块访问/);
  assert.match(editor, /客户数据与操作/);
  assert.match(editor, /管理与审计/);
  const fields = section(app, 'function permissionCategoryMarkup', 'function personalPermissionFields');
  assert.match(fields, /role="switch"/);
  assert.match(fields, /data-permission-category/);
});

test('restore default uses an explicit confirm dialog with the required copy', () => {
  assert.match(app, /恢复权限组默认/);
  assert.match(app, /将清除[^<]*的个人权限例外，之后自动跟随/);
  assert.match(app, /权限组本身不会改变/);
  assert.match(app, /确认恢复/);
  assert.doesNotMatch(app, /window\.confirm\('恢复权限组默认/);
});

test('permission switch grid is compact two to three columns', () => {
  assert.match(css, /\.permission-switch-grid/);
  assert.match(css, /repeat\(/);
  assert.match(css, /\.permission-override-list\{display:block/);
  assert.match(css, /\.permission-modal-wide \.permission-switch-panel\{[^}]*overflow:auto/);
  assert.match(css, /\.permission-group-modal \.permission-switch-panel\{[^}]*overflow:visible/);
});

test('module permissions do not render duplicate or retired navigation entries', () => {
  const editor = section(app, 'const PERMISSION_CATEGORIES', 'function permissionCategoryMarkup');
  assert.doesNotMatch(editor, /'view_development'/);
  assert.doesNotMatch(editor, /'view_pool'/);
  assert.equal((editor.match(/'view_intake'/g) || []).length, 1);
});
