'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets/app.css'), 'utf8');
const sharedCss = fs.readFileSync(path.join(root, 'shared-assets/ui-system.css'), 'utf8');

// Issue 1 - 无障碍: Customer Drawer dialog 语义
test('customer drawer has dialog semantics and an accessible label', () => {
  const drawer = html.match(/<aside id="customerDrawer"[^>]*>/)?.[0] || '';
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /aria-labelledby="drawerCompany"/);
  assert.match(drawer, /tabindex="-1"/);
});

// Issue 1 - 无障碍: 关键按钮 type=button，避免误触发表单提交
test('critical business buttons declare type="button"', () => {
  for (const id of ['newCustomerBtn', 'quickUpdateBtn', 'drawerUpdateBtn']) {
    const btn = html.match(new RegExp(`<button id="${id}"[^>]*>`))?.[0] || '';
    assert.match(btn, /type="button"/, `${id} must be type=button`);
  }
});

// Issue 1 - 无障碍: 非 AI 检索输入具备可访问名
test('non-AI search inputs expose an accessible name', () => {
  for (const id of ['intakeSearch', 'recycleSearch', 'insightSearch']) {
    const input = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0] || '';
    assert.match(input, /aria-label="/, `${id} must have aria-label`);
  }
});

// Issue 1 - 无障碍: Drawer 打开时 Tab 焦点圈禁（含反向）
test('drawer traps Tab focus while open (aria-modal focus containment)', () => {
  assert.match(js, /event\.key === 'Tab' && \$\(['"]#customerDrawer['"]\)\.classList\.contains\('open'\)/);
  assert.match(js, /if \(event\.shiftKey && document\.activeElement === first\) \{ event\.preventDefault\(\); last\.focus\(\); \}/);
});

// Issue 1 - 无障碍: Drawer 打开聚焦/关闭复原
test('drawer saves and restores focus across open and close', () => {
  assert.match(js, /state\.drawerFocusReturn = document\.activeElement/);
  assert.match(js, /const returnEl = state\.drawerFocusReturn;/);
});

// Issue 2 - 响应式: 视口高度使用 100dvh，无 100vh 残留
test('full-screen containers use dvh; no vh-only fallback remains unqualified', () => {
  assert.doesNotMatch(css, /100vh/);
  assert.doesNotMatch(sharedCss, /100vh/);
  assert.match(css, /\.app-shell\{[^}]*min-height:100dvh/);
  assert.match(css, /\.sidebar\{[^}]*height:100dvh/);
});

// Issue 2 - 响应式: 安全区与移动端 Drawer 全屏
test('safe-area insets and full-screen mobile drawer are defined', () => {
  assert.match(css, /env\(safe-area-inset-top, 0px\)/);
  assert.match(css, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(css, /@media\(max-width:600px\)\{[^}]*\.drawer\{width:100%;height:100dvh\}/);
});

// Issue 3 - 动效: 过渡属性被限定（Drawer→transform, Backdrop→opacity），无未限定 transition
test('transitions are scoped to specific properties', () => {
  assert.match(css, /\.drawer\{[^}]*transition:transform \.22s ease/);
  assert.match(css, /\.backdrop,[^{]*\.modal-backdrop\{[^}]*transition:opacity \.18s ease/);
  assert.doesNotMatch(css, /transition:\./);
  assert.doesNotMatch(sharedCss, /transition:\./);
});
