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
  assert.match(css, /\.data-table th\{[^}]*font-size:11px/);
  assert.match(css, /\.data-table td\{[^}]*font-size:12\.5px/);
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
  assert.match(css, /#pipelineBoard \.pipeline-queue-grid/);
  assert.match(css, /#pipelineBoard \.pipeline-grid/);
  assert.match(css, /#poolView \.studio-pills-row/);
  assert.match(css, /#poolView \.intake-kpi-primary/);
  assert.match(appJs(), /intake-kpi-secondary/);
  assert.match(appJs(), /manager-metric-primary/);
  assert.match(css, /\.team-progress-metrics-rest/);
  assert.match(css, /\.access-section-tabs button\{[^}]*border-radius:20px/);
  assert.match(appJs(), /theme=\$\{theme\}/);
  assert.match(appJs(), /pipeline-list-head/);
  assert.match(appJs(), /function viewSubtitle/);
  assert.match(crm(), /id="viewSub"/);
  assert.match(read('Index.html'), /q\.get\('theme'\)==='deck'/);
  assert.match(read('sales-assets/filter-component.css'), /border-radius: 10px/);
});

test('card and field fills use surface tokens so Deck does not leave white tiles', () => {
  const css = appCss();
  const withoutRoot = css.replace(/:root\{[^}]+\}/, '');
  const leftoverWhite = [...withoutRoot.matchAll(/background:#fff(?![0-9a-fA-F])/g)].filter(match => {
    const ctx = withoutRoot.slice(Math.max(0, match.index - 140), match.index);
    return !(ctx.includes('checkbox') && ctx.includes('::after'));
  });
  assert.equal(
    leftoverWhite.length,
    0,
    leftoverWhite.map(match => withoutRoot.slice(Math.max(0, match.index - 70), match.index + 18)).join('\n'),
  );
  assert.doesNotMatch(withoutRoot, /background:#fafcfb/);
  assert.doesNotMatch(withoutRoot, /background:#f7faf8/);
  assert.doesNotMatch(withoutRoot, /background:#f7f9f8/);
  assert.match(css, /\.customer-bulk-bar\{[^}]*background:var\(--surface-header\)/);
});

test('warning fills use tokens so Deck amber blocks stay readable', () => {
  const css = appCss();
  const withoutRoot = css.replace(/:root\{[^}]+\}/, '');
  for (const brown of ['#76551d', '#72511d', '#765800', '#744916', '#8b6512', '#8b5e00', '#75540c', '#9a5c14']) {
    assert.doesNotMatch(
      withoutRoot.toLowerCase(),
      new RegExp(brown),
      `warning text ${brown} must use var(--warning) so Deck contrast holds`,
    );
  }
  assert.match(css, /--warning-border:#ead6af/);
  assert.match(css, /body\[data-theme="deck"\]\{[^}]*--warning-subtle:#352914/);
  assert.match(css, /body\[data-theme="deck"\]\{[^}]*--warning-border:#6e5424/);
  assert.match(css, /body\[data-theme="deck"\]\{[^}]*--amberbg:var\(--warning-subtle\)/);
  assert.match(css, /body\[data-theme="deck"\]\{[^}]*--redbg:var\(--danger-subtle\)/);
  assert.match(css, /\.maintenance-warning\{[^}]*color:var\(--text-primary\)/);
  assert.match(css, /\.protected-gate\.is-disabled\{[^}]*color:var\(--text-primary\)/);
  assert.match(css, /\.pipeline-star-distribution\{[^}]*color:var\(--warning\)/);
  assert.match(css, /\.customer-star-meta\{[^}]*color:var\(--warning\)/);
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
  assert.match(css, /\.data-table th\{[^}]*font-size:11px/);
  assert.match(css, /\.data-table td\{[^}]*font-size:12\.5px/);
  assert.match(css, /\.data-table td\{[^}]*padding:10px 14px/);
  assert.match(css, /\.button\.tiny\{[^}]*min-height:25px/);
  assert.match(css, /body\[data-app="sales"\] \.notification-item\{[^}]*padding:10px 14px/);
  assert.match(css, /body\[data-app="sales"\] \.manager-task-card,[\s\S]*?padding:10px 14px/);
  assert.match(css, /body\[data-app="sales"\] \.manager-task-actions \.button\{[^}]*min-height:25px/);
  assert.match(css, /body\[data-app="sales"\] \.protected-data-table td,[\s\S]*?padding:10px 14px/);
  assert.match(css, /body\[data-app="sales"\] \.insight-hub-card\{[\s\S]*?padding:10px 14px/);
  assert.match(css, /body\[data-app="sales"\] \.feed-item\{[^}]*padding:7px 0/);
  assert.match(css, /body\[data-app="sales"\] \.data-table \.button,[\s\S]*?min-height:25px/);
  assert.match(css, /\.pending-queue-row\{[^}]*min-height:82px/);
  assert.match(css, /\.tp-company-anchor\{[^}]*font-size:13\.5px/);
  assert.match(css, /\.data-table tbody tr:hover/);
});

test('list rows use V3 two-line entity language and overflow actions', () => {
  const js = appJs();
  const css = appCss();
  const slice = (startName, endName) => {
    const start = js.indexOf(`function ${startName}(`);
    const end = js.indexOf(`function ${endName}(`);
    assert.notEqual(start, -1, `missing ${startName}`);
    assert.notEqual(end, -1, `missing ${endName}`);
    return js.slice(start, end);
  };
  assert.match(js, /function hostLabel\(/);
  assert.match(js, /function listEntityMarkup\(/);
  assert.match(js, /function listChipMarkup\(/);
  assert.match(js, /function rowActionCluster\(/);
  assert.match(js, /class="an tp-company-anchor"/);
  assert.match(js, /class="row-more"/);
  assert.match(js, /summary class="more"/);
  assert.match(js, /closest\([^)]*summary[^)]*details/);

  const pipeline = slice('renderPipeline', 'pipelineStayMarkup');
  assert.match(pipeline, /listEntityMarkup\(/);
  assert.match(pipeline, /rowActionCluster\(/);
  assert.match(js, /停留 \$\{days\} 天/);
  assert.doesNotMatch(pipeline, /pipeline-fact-note/);
  assert.doesNotMatch(pipeline, /company-star-line/);

  const customers = slice('renderCustomers', 'loadRecycleBin');
  assert.match(customers, /listEntityMarkup\(/);
  assert.match(customers, /assignment-actions/);
  assert.doesNotMatch(customers, /创建人：/);
  assert.doesNotMatch(customers, /websiteMarkup\(account\.website/);
  assert.doesNotMatch(customers, /sourceTagMarkup\(account, 4\)/);

  const intake = slice('renderIntake', 'customerProfileFrameUrl');
  assert.match(intake, /listEntityMarkup\(/);
  assert.match(intake, /listChipMarkup\(/);
  assert.match(intake, /data-open-customer="\$\{item\.crm_customer_id\}"/);
  assert.doesNotMatch(intake, /具名联系人与联系方式完备/);
  assert.doesNotMatch(intake, /productChipMarkup\(/);
  assert.doesNotMatch(intake, /websiteMarkup\(item\.website\)/);

  const users = slice('renderUsers', 'renderManagerTaskSettings');
  assert.match(users, /class="an"/);
  assert.match(users, /user-row-actions/);
  assert.match(users, /data-edit-user/);
  assert.doesNotMatch(users, /class="person"/);
  assert.doesNotMatch(users, /class="avatar"/);

  assert.match(css, /\.an\{[^}]*font-size:13\.5px/);
  assert.match(css, /\.id\{[^}]*font-size:11px/);
  assert.match(css, /\.more\{[^}]*height:25px/);
  assert.match(css, /\.chip\{[^}]*font-size:11px/);
  assert.match(css, /\.row-actions\{/);
  assert.doesNotMatch(css, /\.pipeline-action-row strong\{font-size:11px/);
  assert.match(css, /\.pending-queue-row\{[^}]*min-height:82px/);
});
