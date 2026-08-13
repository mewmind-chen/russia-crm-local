'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'sales-assets/app.css'), 'utf8');
const uiFormat = require('../sales-assets/ui-format');

function functionSource(name, nextName) {
  const start = appSource.indexOf(`  function ${name}(`);
  const end = appSource.indexOf(`  function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} must be declared`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return appSource.slice(start, end);
}

function drawerFactRenderer() {
  const source = [
    functionSource('esc', 'websiteMarkup'),
    functionSource('websiteMarkup', 'productChipMarkup'),
    functionSource('drawerFactMarkup', 'productChipMarkup'),
    'return drawerFactMarkup;',
  ].join('\n');
  return Function('uiFormat', source)(uiFormat);
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cssSource.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

test('drawer facts render safe website links without allowing script URLs', () => {
  const render = drawerFactRenderer();
  const safe = render(['官网', 'smcbr.com.br/path', 'website']);
  assert.match(safe, /href="https:\/\/smcbr\.com\.br\/path"/);
  assert.match(safe, />smcbr\.com\.br<svg/);
  assert.match(safe, /target="_blank"/);
  assert.match(safe, /rel="noopener"/);

  const dangerous = render(['官网', 'javascript:alert(1)', 'website']);
  assert.doesNotMatch(dangerous, /href=|javascript:/i);
  assert.match(dangerous, /暂无官网/);

  const credentialed = render(['官网', 'https://example.com@evil.com/path', 'website']);
  assert.doesNotMatch(credentialed, /href=|example\.com@evil\.com/i);
  assert.match(credentialed, /暂无官网/);
});

test('drawer website facts keep very long hostnames inside the account-facts grid', () => {
  const render = drawerFactRenderer();
  const hostname = `${'customer-portal-'.repeat(12)}example.com`;
  const fact = render(['官网', `https://${hostname}/catalog`, 'website']);
  assert.match(fact, new RegExp(`href="https://${hostname}/catalog"`));
  assert.match(fact, new RegExp(`>${hostname}<svg`));

  const factRule = cssRule('.account-facts .fact');
  const websiteRule = cssRule('.account-facts .tp-website');
  assert.match(factRule, /min-width:\s*0/);
  assert.match(websiteRule, /max-width:\s*100%/);
  assert.match(websiteRule, /min-width:\s*0/);
  assert.match(websiteRule, /overflow-wrap:\s*anywhere/);
  assert.match(websiteRule, /white-space:\s*normal/);
  assert.match(websiteRule, /word-break:\s*break-word/);
});

test('drawer text facts escape labels and values instead of accepting raw HTML', () => {
  const render = drawerFactRenderer();
  const fact = render(['<img src=x onerror=alert(1)>', '<script>alert(1)</script>']);
  assert.doesNotMatch(fact, /<img|<script>/i);
  assert.match(fact, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(fact, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('CRM drawer uses website fact rendering and removes the repeated master-data card', () => {
  const drawer = appSource.match(/  function renderDrawer\(\)[\s\S]*?\n  function openModal\(/)?.[0] || '';
  const master = drawer.match(/<section class="master-profile">[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(drawer, /\['官网', account\.website, 'website'\]/);
  assert.match(drawer, /accountFacts\.map\(drawerFactMarkup\)/);
  assert.doesNotMatch(master, /行业与客户类型/);
  assert.match(master, /企业简介/);
  assert.match(master, /产品与潜在需求/);
  assert.match(master, /背调与来源/);
});
