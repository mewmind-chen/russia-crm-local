'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const appCss = () => read('sales-assets/app.css');
const appJs = () => read('sales-assets/app.js');
const crm = () => read('sales-crm.html');

test('approved semantic tokens and typography define the CRM shell', () => {
  const css = appCss();
  for (const contract of [
    '--surface-page:#f4f6f5',
    '--surface-panel:#fff',
    '--surface-subtle:#eef2f0',
    '--text-primary:#1a2321',
    '--text-secondary:#556360',
    '--border-default:#e7ebe9',
    '--brand:#0f766e',
    '--brand-hover:#0a6459',
    '--brand-subtle:#e6f4f1',
    '--info:#33689b',
    '--warning:#b06f11',
    '--danger:#c2413b',
  ]) assert.match(css.toLowerCase(), new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(css, /h1\{[^}]*font-size:21px/);
  assert.match(css, /\.topbar\{[^}]*min-height:52px/);
  assert.match(css, /body\[data-app="sales"\] \.nav button\.active\{[^}]*background:var\(--brand-subtle\)/);
  assert.match(css, /\.panel-head \.eyebrow,[^{]*\.section-intro \.eyebrow\{display:none\}/);
  assert.match(css, /\.data-table th\{[^}]*font-size:12px/);
  assert.match(css, /\.data-table td\{[^}]*font-size:13px/);
  assert.match(css, /body\[data-theme="deck"\]/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.ok(
    crm().indexOf('/shared-assets/ui-system.css') < crm().indexOf('/sales-assets/app.css'),
    'CRM app styles must load after the shared shell so approved typography wins',
  );
  assert.match(css, /body\[data-app="sales"\] \.topbar h1\{[^}]*font-size:21px/);
  assert.match(css, /body\[data-app="sales"\] \.panel,[\s\S]*?border-radius:10px/);
  assert.match(crm(), /id="themeSwitcher"/);
  assert.match(css, /\.funnel-bar\{[^}]*height:15px/);
  assert.match(css, /\.button\{[^}]*min-height:34px/);
  assert.match(css, /#pipelineBoard \.pipeline-tabs-row/);
  assert.match(css, /#pipelineBoard \.pipeline-stage-cell/);
  assert.match(css, /\.access-section-tabs button\{[^}]*border-radius:20px/);
  assert.match(appJs(), /theme=\$\{theme\}/);
  assert.match(appJs(), /pipeline-list-head/);
  assert.match(read('Index.html'), /q\.get\('theme'\)==='deck'/);
  assert.match(read('sales-assets/filter-component.css'), /border-radius: 10px/);
});

test('shell navigation and icon-only actions use semantic line icons', () => {
  const html = crm();
  const sidebar = html.match(/<aside class="sidebar"[\s\S]*?<\/aside>/)?.[0] || '';
  const format = require('../sales-assets/ui-format');
  assert.match(html, /<script src="\/sales-assets\/ui-format\.js\?v=/);
  assert.match(format.icon('dashboard'), /class="tp-icon"[\s\S]*<rect/);
  assert.match(sidebar, /data-tp-icon="dashboard"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(sidebar, /[◫✓⇣♙⌕◎↺≡◇✎⌁⊕⌫↪]/);
  assert.match(html, /id="notificationButton"[\s\S]*aria-label="打开通知中心"/);
  assert.match(html, /id="salesMenuBtn"[\s\S]*aria-label="打开导航"/);
  assert.match(html, /data-close-drawer[^>]*aria-label="关闭客户详情"/);
  assert.match(html, /data-close-modal[^>]*aria-label="关闭弹窗"/);
  assert.match(html, /id="toast"[^>]*aria-live="polite"/);
});

test('customer profile removes redundant English eyebrow labels', () => {
  assert.doesNotMatch(crm(), /CUSTOMER PROFILE|AI SALES ASSIST/);
});

test('dashboard keeps six lifecycle metrics and moves urgency into attention', () => {
  const js = appJs();
  const dashboard = js.match(/function renderDashboard\(\)[\s\S]*?\n  function percent/)?.[0] || '';
  assert.doesNotMatch(dashboard, /\['超期 \/ 待介入'/);
  assert.match(dashboard, /const cards = \[[\s\S]*?\];/);
  assert.match(dashboard, /#attentionSummary/);
  assert.match(dashboard, /summary\.overdue/);
  assert.match(dashboard, /summary\.managerNeeded/);
  assert.equal((dashboard.match(/^\s+\['/gm) || []).length, 6);
  assert.match(crm(), /id="attentionSummary" class="attention-summary"/);
  assert.match(appCss(), /\.funnel-chart\{[^}]*max-width:/);
});

test('UI formatter normalizes websites, products, and statuses', () => {
  const format = require('../sales-assets/ui-format');
  assert.deepEqual(format.website('https://www.example.com/path?q=1'), {
    href: 'https://www.example.com/path?q=1',
    label: 'example.com',
  });
  assert.deepEqual(format.website('smcbr.com.br/path'), {
    href: 'https://smcbr.com.br/path',
    label: 'smcbr.com.br',
  });
  assert.deepEqual(format.website('http://www.example.com/path?ref=crm'), {
    href: 'http://www.example.com/path?ref=crm',
    label: 'example.com',
  });
  for (const rejected of [
    '',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com/file',
    'https://',
    'https://user:pass@example.com/path',
    'https://example.com@evil.com/path',
  ]) assert.equal(format.website(rejected), null, `must reject unsafe website: ${rejected}`);
  assert.deepEqual(format.products('["MCU","FPGA","电源","连接器"]'), {
    items: ['MCU', 'FPGA', '电源'],
    overflow: 1,
  });
  assert.deepEqual(format.status('claimed', { claimed: '已领取' }), {
    label: '已领取',
    tone: 'success',
  });
  assert.deepEqual(format.status('disqualified', { disqualified: '确认不对口' }), {
    label: '确认不对口',
    tone: 'danger',
  });
});

test('business tables have readable anchors and semantic secondary content', () => {
  const js = appJs();
  assert.match(js, /function websiteMarkup\(/);
  assert.match(js, /function productChipMarkup\(/);
  assert.match(js, /tp-company-anchor/);
  assert.match(js, /tp-status-dot/);
  const css = appCss();
  assert.match(css, /\.data-table th\{[^}]*font-size:12px/);
  assert.match(css, /\.data-table td\{[^}]*font-size:13px/);
  assert.match(css, /\.tp-company-anchor\{[^}]*font-size:13\.5px/);
  assert.match(css, /\.data-table tbody tr:hover/);
});
