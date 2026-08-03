'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sharedCss = read('shared-assets/ui-system.css');
const appCss = read('sales-assets/app.css');
const appJs = read('sales-assets/app.js');
const html = read('sales-crm.html');

function specificity(selector) {
  return [
    (selector.match(/#[\w-]+/g) || []).length,
    (selector.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length,
    (selector.match(/(^|\s|>)[a-z][\w-]*/gi) || []).length,
  ];
}

function compareSpecificity(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

test('Issue 206 hides the menu button above 980px despite later icon-button styles', () => {
  const desktopSelector = 'body[data-app="sales"] .menu-button';

  assert.ok(
    html.indexOf('/shared-assets/ui-system.css') < html.indexOf('/sales-assets/app.css'),
    'the regression depends on app.css loading after the shared UI stylesheet',
  );
  assert.match(html, /id="salesMenuBtn" class="menu-button icon-button"/);
  const desktopCss = sharedCss.slice(0, sharedCss.indexOf('@media (max-width: 980px)'));
  assert.match(desktopCss, /\.menu-button,\s*\.sidebar-mask\s*\{\s*display:\s*none;/);
  assert.match(desktopCss, /body\[data-app="sales"\] \.menu-button\s*\{\s*display:\s*none;/);
  assert.match(appCss, /\.icon-button\{display:inline-grid;/);
  const scopedDesktopRule = desktopCss.match(/body\[data-app="sales"\] \.menu-button\s*\{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(scopedDesktopRule, /!important/);
  assert.ok(
    compareSpecificity(specificity(desktopSelector), specificity('.icon-button')) > 0,
    'the desktop hide selector must outrank the later .icon-button rule',
  );
});

test('Issue 206 shows the menu at 980px and keeps mobile sidebar close paths', () => {
  assert.match(
    sharedCss,
    /@media \(max-width: 980px\) \{[\s\S]*?body\[data-app="sales"\] \.menu-button\s*\{[\s\S]*?display:\s*grid;/,
  );
  assert.match(appJs, /#salesMenuBtn'\)\.addEventListener\('click', \(\) => document\.body\.classList\.toggle\('sidebar-open'\)\)/);
  assert.match(appJs, /#salesSidebarMask'\)\.addEventListener\('click', \(\) => document\.body\.classList\.remove\('sidebar-open'\)\)/);
  assert.match(
    appJs,
    /function switchView\([\s\S]*?document\.body\.classList\.remove\('sidebar-open'\);/,
    'navigation must keep closing the mobile sidebar',
  );
  assert.doesNotMatch(appJs, /(?:innerWidth|matchMedia)\([^\n]*sidebar-open/);
});
