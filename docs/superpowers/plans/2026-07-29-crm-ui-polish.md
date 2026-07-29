# CRM UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing TradePulse CRM into a compact, readable B2B operations interface while preserving every API, permission, lifecycle, filter, and profile integration contract.

**Architecture:** Upgrade the existing server-rendered HTML, CSS, and browser JavaScript in place. Add one small UMD formatting module for deterministic website, product, status, and SVG-icon rendering; keep business state and API calls in their current owners. Lock each visual or structural change with Node contract tests before changing production markup.

**Tech Stack:** HTML5, CSS custom properties and responsive CSS, browser JavaScript, CommonJS/UMD, Node.js 18+ `node:test`, existing Express application, authenticated in-app browser verification.

## Global Constraints

- Work only in `/Users/ylf/Desktop/projects/tradepulse-development/worktrees/ui-polish` on branch `codex/ui-polish`.
- Do not modify the dirty user worktrees at `/Users/ylf/Desktop/projects/tradepulse-ai-crm` or `/Users/ylf/Desktop/projects/russia-crm-local`.
- Do not add React, Tailwind, shadcn/ui, a frontend build step, or a parallel frontend.
- Do not change backend data models, API contracts, permission gates, filter authorization, filter serialization, customer lifecycle, assignment, Recon execution, AI behavior, or `postMessage` integration.
- Keep existing element IDs and event hooks unless a test in the same task documents an intentional semantic markup change.
- Use `#F5F7F9` page, `#FFFFFF` panel, `#F7F9FB` subtle surface, `#18212F` primary text, `#667085` secondary text, and `#E2E7ED` borders.
- Use `#0F766E` for primary and active states, `#0B625B` for primary hover, `#E7F5F2` for selected surfaces, `#2563EB` for links/information, `#B7791F` for attention, and `#C2413B` for destructive or critical states.
- Use the system-first font stack `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif`.
- Use the approved `24 / 18 / 16 / 14 / 13 / 12 / 11px` type scale; no operational text may be smaller than `11px`; letter spacing is `0`.
- Use `6-8px` radii for controls and panels, full pills only for statuses and compact filters, one-pixel panel borders, and shadows only for floating menus, drawers, modals, or active floating controls.
- Desktop controls are at least `40px` high; controls at widths up to `780px` are at least `44px` high.
- Limit transitions to color, opacity, border, and shadow for `150-200ms`; remove scale and translate hover effects; honor `prefers-reduced-motion`.
- Use consistent inline line SVG icons; icon-only controls require Chinese accessible names and useful tooltips.
- Keep the main work area fluid with a maximum readable width of `1680px`.
- Verify `375x812`, `768x1024`, `1024x768`, `1440x900`, and at least `1920px` wide; no page-level horizontal scrolling is allowed.
- At `1440x900`, the customer and lead table headers must be visible without scrolling through the complete filter catalog.
- Existing Issue 116, 124, 128, and 130 tests and the complete Node test suite must remain green.

## File Map

- Create `sales-assets/ui-format.js`: pure UMD helpers for line icons and user-facing website, product, and status formatting.
- Create `test/crm_ui_polish.test.js`: visual-system, shell, dashboard, filter, table, profile, tag-editor, and accessibility contracts.
- Modify `sales-assets/app.css`: semantic tokens, shell, controls, dashboard, tables, profile shell, and responsive rules.
- Modify `sales-assets/filter-component.css`: compact basic row, advanced disclosure, applied chips, and responsive filter layout.
- Modify `sales-assets/filter-component.js`: presentation-only field grouping and disclosure markup; controller and payload stay unchanged.
- Modify `sales-assets/app.js`: dashboard grouping and table display formatting only.
- Modify `sales-crm.html`: semantic icon sprite/markup, attention-summary target, script versions, and small structural classes.
- Modify `Index.html`: grouped customer details, Recon empty state, searchable tag disclosures, sticky save action, and matching embedded styles.
- Modify `test/issue128_profile_frontend.test.js`: replace the obsolete independent-card expectation with the approved grouped-definition layout contract.

---

### Task 1: Semantic Visual Foundation and Line Icons

**Files:**
- Create: `sales-assets/ui-format.js`
- Create: `test/crm_ui_polish.test.js`
- Modify: `sales-assets/app.css:1-10`
- Modify: `sales-crm.html:8-104`

**Interfaces:**
- Consumes: existing global `window`, CommonJS `module.exports`, and escaped string inputs.
- Produces: `TradePulseUIFormat.icon(name, label = '') -> string`, plus the semantic CSS variables used by every later task.

- [ ] **Step 1: Write the failing foundation and icon tests**

Create `test/crm_ui_polish.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const appCss = () => read('sales-assets/app.css');
const filterCss = () => read('sales-assets/filter-component.css');
const appJs = () => read('sales-assets/app.js');
const crm = () => read('sales-crm.html');
const workbench = () => read('Index.html');

test('approved semantic tokens and typography floor define the CRM visual system', () => {
  const css = appCss();
  for (const contract of [
    '--surface-page:#f5f7f9',
    '--surface-panel:#fff',
    '--surface-subtle:#f7f9fb',
    '--text-primary:#18212f',
    '--text-secondary:#667085',
    '--border-default:#e2e7ed',
    '--brand:#0f766e',
    '--brand-hover:#0b625b',
    '--brand-subtle:#e7f5f2',
    '--info:#2563eb',
    '--warning:#b7791f',
    '--danger:#c2413b',
  ]) assert.match(css.toLowerCase(), new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(css, /h1\{[^}]*font-size:24px/);
  assert.match(css, /\.topbar\{[^}]*min-height:64px/);
  assert.match(css, /\.nav button\.active\{[^}]*background:var\(--brand-subtle\)/);
  assert.match(css, /\.panel-head \.eyebrow,[^{]*\.section-intro \.eyebrow\{display:none\}/);
  assert.match(css, /\.data-table th\{[^}]*font-size:12px/);
  assert.match(css, /\.data-table td\{[^}]*font-size:13px/);
  assert.doesNotMatch(css, /letter-spacing:\s*-\./);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
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
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test test/crm_ui_polish.test.js
```

Expected: FAIL because `ui-format.js`, semantic token names, 24px page-title contract, reduced-motion rule, and SVG icon markup do not exist.

- [ ] **Step 3: Add the reusable icon formatter**

Create `sales-assets/ui-format.js`:

```js
(function initTradePulseUIFormat(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.TradePulseUIFormat = api;
    const mount = () => api.mountIcons(root.document);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createUIFormat() {
  'use strict';

  const paths = Object.freeze({
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    dashboard: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    inbox: '<path d="M4 4h16v13H4z"/><path d="M4 13h4l2 3h4l2-3h4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    building: '<path d="M3 21h18M6 21V3h12v18M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
    archive: '<path d="M3 6h18M5 6v15h14V6M9 10h6"/><path d="M4 3h16v3H4z"/>',
    pipeline: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-8"/>',
    sparkles: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3zM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15zM19 13l.8 2.2L22 16l-2.2.8L19 19l-.8-2.2L16 16l2.2-.8L19 13z"/>',
    note: '<path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M15 3h6v18h-6"/>',
    external: '<path d="M14 3h7v7M10 14 21 3"/><path d="M21 14v7H3V3h7"/>',
    alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 9v5M12 18h.01"/>',
    empty: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>',
  });

  function escapeAttribute(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[character]);
  }

  function icon(name, label = '') {
    const title = label ? `<title>${escapeAttribute(label)}</title>` : '';
    const accessibility = label ? ` role="img" aria-label="${escapeAttribute(label)}"` : ' aria-hidden="true"';
    return `<svg class="tp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${accessibility}>${title}${paths[name] || paths.empty}</svg>`;
  }

  function mountIcons(scope) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return;
    scope.querySelectorAll('[data-tp-icon]').forEach(node => {
      node.innerHTML = icon(node.dataset.tpIcon);
    });
  }

  return Object.freeze({ icon, mountIcons });
}));
```

- [ ] **Step 4: Apply semantic tokens, typography, control, width, focus, and motion rules**

Replace the first global rules in `sales-assets/app.css` with:

```css
:root{--surface-page:#f5f7f9;--surface-panel:#fff;--surface-subtle:#f7f9fb;--text-primary:#18212f;--text-secondary:#667085;--border-default:#e2e7ed;--brand:#0f766e;--brand-hover:#0b625b;--brand-subtle:#e7f5f2;--info:#2563eb;--warning:#b7791f;--warning-subtle:#fff8e6;--danger:#c2413b;--danger-subtle:#fff1f0;--ink:var(--text-primary);--muted:var(--text-secondary);--line:var(--border-default);--bg:var(--surface-page);--panel:var(--surface-panel);--green:var(--brand);--green2:var(--brand-hover);--mint:var(--brand-subtle);--red:var(--danger);--redbg:var(--danger-subtle);--amber:var(--warning);--amberbg:var(--warning-subtle);--blue:var(--info);--shadow:0 12px 32px rgba(24,33,47,.1);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Noto Sans CJK SC","Noto Sans SC",sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--surface-page);color:var(--text-primary);font-size:14px;line-height:1.5}
button,input,select,textarea{font:inherit;letter-spacing:0}
button{cursor:pointer}
.hidden{display:none!important}
.eyebrow{margin:0 0 4px;color:var(--text-secondary);font-size:11px;font-weight:600;letter-spacing:0}
.eyebrow.red{color:var(--danger)}
.subtle,.panel-note{color:var(--text-secondary)}
h1,h2,h3,p{margin-top:0;letter-spacing:0}
h1{font-size:24px;line-height:1.3;font-weight:650;margin-bottom:0}
h2{font-size:18px;line-height:1.35;font-weight:650;margin-bottom:0}
h3{font-size:16px;line-height:1.4;font-weight:650}
.button{min-height:40px;border:1px solid transparent;border-radius:7px;padding:9px 14px;font-weight:600;transition:color .16s,border-color .16s,background-color .16s,box-shadow .16s}
.button.primary{background:var(--brand);color:#fff}
.button.primary:hover{background:var(--brand-hover)}
.button.secondary{background:var(--surface-panel);color:var(--text-primary);border-color:var(--border-default)}
.button:focus-visible,.text-button:focus-visible,.nav button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:0;box-shadow:0 0 0 3px rgba(15,118,110,.2)}
.tp-icon{display:block;width:18px;height:18px;flex:0 0 auto}
.icon-button{display:inline-grid;place-items:center;width:40px;height:40px;border:1px solid var(--border-default);border-radius:7px;background:var(--surface-panel);color:var(--text-primary)}
.panel-head .eyebrow,.section-intro .eyebrow{display:none}
@media (max-width:780px){.button,.icon-button,input,select{min-height:44px}}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
```

Replace the existing `.app-shell` through `.account-mini button` shell block and the `.main` / `.topbar` block with:

```css
.app-shell{min-height:100vh;display:grid;grid-template-columns:232px minmax(0,1fr)}
.sidebar{position:sticky;top:0;height:100vh;padding:18px 12px;display:flex;flex-direction:column;background:var(--surface-panel);border-right:1px solid var(--border-default);color:var(--text-primary)}
.brand-block{display:flex;gap:10px;align-items:center;padding:0 8px 20px;color:inherit;text-decoration:none}
.brand-mark{width:36px;height:36px;display:grid;place-items:center;border-radius:8px;background:var(--brand);color:#fff;font-weight:700}
.brand-block div:last-child{display:grid}.brand-block strong{font-size:16px}.brand-block span{font-size:11px;color:var(--text-secondary)}
.nav{display:grid;gap:4px}.nav-group{display:grid;gap:3px}.nav-group+.nav-group{margin-top:14px}
.nav-group-label{padding:0 10px 5px;color:var(--text-secondary);font-size:11px;font-weight:600}
.nav button{min-height:40px;border:0;border-radius:7px;padding:8px 10px;display:grid;grid-template-columns:20px 1fr auto;gap:9px;align-items:center;background:transparent;color:var(--text-secondary);text-align:left;transition:color .16s,background-color .16s,box-shadow .16s}
.nav button:hover{background:var(--surface-subtle);color:var(--text-primary)}
.nav button.active{background:var(--brand-subtle);color:var(--brand);box-shadow:inset 3px 0 var(--brand);font-weight:600}
.nav i{display:grid;place-items:center;font-style:normal}.nav b{padding:2px 6px;border-radius:999px;background:#eef1f4;color:var(--text-secondary);font-size:11px}.nav .danger-count{background:var(--danger-subtle);color:var(--danger)}
.sidebar-foot{margin-top:auto}.account-mini{display:grid;grid-template-columns:34px 1fr 40px 40px;gap:8px;align-items:center;padding:14px 4px 0;border-top:1px solid var(--border-default)}
.avatar{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:var(--brand-subtle);color:var(--brand);font-weight:650}
.account-mini div{display:grid}.account-mini small{color:var(--text-secondary);font-size:11px}.account-mini .icon-button{width:40px;height:40px}
.main{min-width:0;padding:0 24px 48px}
.main>.topbar,.main>.view,.main>.impersonation-banner{width:min(100%,1680px);margin-inline:auto}
.topbar{min-height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid transparent}
.top-actions,.filters-inline{display:flex;gap:8px;align-items:center}
.filters-inline select{min-height:40px;padding:8px 28px 8px 10px;border:1px solid var(--border-default);border-radius:7px;background:#fff}
```

Delete the older duplicate shell, topbar, button, and icon-button declarations after these replacements so source order cannot restore the 100px header, dark navigation, 9-13px radii, or circular icon controls.

In `sales-crm.html`, load `/sales-assets/ui-format.js` before `app.js` and replace the sidebar, account, menu, and notification markup with:

```html
<nav id="nav" class="nav">
  <div class="nav-group"><div class="nav-group-label">今日工作</div>
    <button data-view="dashboard" data-permission="view_dashboard" class="active"><i data-tp-icon="dashboard" aria-hidden="true"></i><span>经营驾驶舱</span></button>
    <button data-view="alerts" data-permission="view_alerts"><i data-tp-icon="alert" aria-hidden="true"></i><span>今日待办</span><b id="navAlertCount" class="danger-count">0</b></button>
    <button data-view="notifications" data-permission="view_customers"><i data-tp-icon="bell" aria-hidden="true"></i><span>通知中心</span><b id="navNotificationCount" class="danger-count">0</b></button>
    <button data-view="aiTasks" data-permission="view_customers" data-ai-business><i data-tp-icon="sparkles" aria-hidden="true"></i><span>AI任务中心</span></button>
  </div>
  <div class="nav-group"><div class="nav-group-label">客户流转</div>
    <button data-view="pool" data-permission="view_intake"><i data-tp-icon="inbox" aria-hidden="true"></i><span id="navIntakeLabel">线索池</span><b id="navIntakeCount">0</b></button>
    <button data-view="contacts" data-permission="view_contacts"><i data-tp-icon="users" aria-hidden="true"></i><span>负责人线索</span></button>
    <button data-view="recon" data-permission="view_recon"><i data-tp-icon="search" aria-hidden="true"></i><span>Recon 情报</span></button>
    <button data-view="customers" data-permission="view_customers"><i data-tp-icon="building" aria-hidden="true"></i><span>CRM客户全景</span><b id="navCustomerCount">0</b></button>
    <button data-view="recycleBin" data-permission="manage_customer_recycle"><i data-tp-icon="archive" aria-hidden="true"></i><span>客户回收站</span><b id="navRecycleCount">0</b></button>
    <button data-view="pipeline" data-permission="view_pipeline"><i data-tp-icon="pipeline" aria-hidden="true"></i><span>推进管道</span></button>
  </div>
  <div class="nav-group"><div class="nav-group-label">管理中心</div>
    <button data-view="team" data-permission="view_team"><i data-tp-icon="chart" aria-hidden="true"></i><span>销售能力</span></button>
    <button data-view="insights" data-permission="view_insights"><i data-tp-icon="note" aria-hidden="true"></i><span>经理评价</span><b id="navInsightCount">0</b></button>
    <button data-view="markets" data-permission="view_markets"><i data-tp-icon="globe" aria-hidden="true"></i><span>市场策略</span></button>
    <button data-view="users" data-permission="view_users"><i data-tp-icon="users" aria-hidden="true"></i><span>用户与权限</span></button>
    <button data-view="maintenance" data-permission="manage_data_maintenance"><i data-tp-icon="settings" aria-hidden="true"></i><span>数据维护</span></button>
  </div>
</nav>
<div class="sidebar-foot">
  <div class="account-mini">
    <span id="userAvatar" class="avatar">管</span>
    <div><strong id="userName">—</strong><small id="userRole">—</small></div>
    <button id="changePasswordBtn" class="icon-button" title="修改密码" aria-label="修改密码"><span data-tp-icon="settings" aria-hidden="true"></span></button>
    <button id="logoutBtn" class="icon-button" title="退出登录" aria-label="退出登录"><span data-tp-icon="logout" aria-hidden="true"></span></button>
  </div>
</div>
```

Use these exact top-bar controls:

```html
<button id="salesMenuBtn" class="menu-button icon-button" type="button" aria-label="打开导航" title="打开导航"><span data-tp-icon="menu" aria-hidden="true"></span></button>
<button id="notificationButton" data-view="notifications" data-permission="view_customers" class="notification-button icon-button" type="button" title="打开通知中心" aria-label="打开通知中心"><span data-tp-icon="bell" aria-hidden="true"></span><b id="topNotificationCount">0</b></button>
```

Preserve the surrounding brand, `#salesSidebarMask`, page-title block, filters, and primary actions.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
node --test test/crm_ui_polish.test.js test/sales_menu.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the foundation**

```bash
git add sales-assets/ui-format.js sales-assets/app.css sales-crm.html test/crm_ui_polish.test.js
git commit -m "feat: establish CRM visual system"
```

---

### Task 2: Dashboard Hierarchy and Attention Summary

**Files:**
- Modify: `test/crm_ui_polish.test.js`
- Modify: `sales-crm.html:107-139`
- Modify: `sales-assets/app.js:1072-1111`
- Modify: `sales-assets/app.css` dashboard rules

**Interfaces:**
- Consumes: `computeSummary(accounts) -> { overdue, managerNeeded, ... }` and existing `#attentionList`.
- Produces: exactly six `.metric` cards and `#attentionSummary` text inside the `需要我处理` panel header.

- [ ] **Step 1: Add the failing dashboard contract**

Append to `test/crm_ui_polish.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and verify the seventh metric causes failure**

Run:

```bash
node --test test/crm_ui_polish.test.js
```

Expected: FAIL because the cards array contains `超期 / 待介入`, `#attentionSummary` is absent, and the funnel is unbounded.

- [ ] **Step 3: Move urgency into the attention header**

In `sales-crm.html`, replace the attention panel heading block with:

```html
<div class="panel-head">
  <div>
    <h2>需要我处理</h2>
    <span id="attentionSummary" class="attention-summary">当前无待处理提醒</span>
  </div>
  <button class="text-button" data-go="alerts">查看全部</button>
</div>
```

In `renderDashboard()`, keep this exact six-card array and add the summary assignment:

```js
const cards = [
  ['未开发线索', state.data.researchTotals?.poolAvailable || 0, '等待每日分配', ''],
  ['CRM客户', summary.accounts, '已领取并开始开发', ''],
  ['获得回复', summary.replies, `触达后 ${percent(summary.replies, summary.contacted)}`, ''],
  ['深度会议', summary.meetings, `回复后 ${percent(summary.meetings, summary.replies)}`, ''],
  ['正式询价', summary.rfqs, `会议后 ${percent(summary.rfqs, summary.meetings)}`, ''],
  ['成交订单', summary.orders, money(summary.revenue), ''],
];
$('#summaryCards').innerHTML = cards.map(([label, value, note, cls]) => (
  `<article class="metric ${cls}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`
)).join('');
const attentionSummary = $('#attentionSummary');
if (attentionSummary) {
  attentionSummary.textContent = summary.overdue || summary.managerNeeded
    ? `${summary.overdue} 个超期 · ${summary.managerNeeded} 个待介入`
    : '当前无待处理提醒';
  attentionSummary.classList.toggle('critical', Boolean(summary.overdue));
}
```

- [ ] **Step 4: Apply restrained KPI and bounded-funnel styles**

Add or replace the dashboard rules in `sales-assets/app.css`:

```css
.metric-grid{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:12px;margin-bottom:16px}
.metric{min-height:104px;padding:16px;background:var(--surface-panel);border:1px solid var(--border-default);border-radius:8px;box-shadow:none}
.metric::after{display:none}
.metric span,.metric small{font-size:12px;color:var(--text-secondary)}
.metric strong{display:block;margin:5px 0 2px;font-size:28px;line-height:1.15;font-weight:650;font-variant-numeric:tabular-nums}
.panel{background:var(--surface-panel);border:1px solid var(--border-default);border-radius:8px;box-shadow:none}
.attention-summary{display:block;margin-top:4px;color:var(--warning);font-size:12px;font-weight:600}
.attention-summary.critical{color:var(--danger)}
.attention-item{border-bottom:1px solid var(--border-default);background:transparent}
.attention-item:hover{background:var(--surface-subtle)}
.funnel-chart{width:min(100%,900px);max-width:900px}
.funnel-count,.funnel-rate{font-variant-numeric:tabular-nums}
@media (max-width:1200px){.metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:640px){.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
```

- [ ] **Step 5: Run dashboard and navigation tests**

Run:

```bash
node --test test/crm_ui_polish.test.js test/sales_menu.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the dashboard**

```bash
git add sales-crm.html sales-assets/app.js sales-assets/app.css test/crm_ui_polish.test.js
git commit -m "feat: clarify dashboard action hierarchy"
```

---

### Task 3: Compact Authorization-Aware Filters

**Files:**
- Modify: `test/issue116_filter_component.test.js`
- Modify: `test/crm_ui_polish.test.js`
- Modify: `sales-assets/filter-component.js:338-545`
- Modify: `sales-assets/filter-component.css`

**Interfaces:**
- Consumes: normalized schema fields, existing controller state, `data-filter-*` events, and unchanged `controller.serialize()`.
- Produces: `splitFilterFields(schema) -> { searchFields, primaryFields, advancedFields }`; collapsed `<details class="tp-filter-advanced">`; always-visible applied chips and result count.

- [ ] **Step 1: Add failing structure and payload-preservation tests**

Append to `test/issue116_filter_component.test.js`:

```js
test('compact layout keeps common fields visible and advanced filters collapsed', () => {
  const html = renderFilterComponent({
    schema: schema({
      fields: [
        ...schema().fields,
        { key: 'stage', label: '客户阶段', type: 'select', operator: 'eq', placement: 'more',
          options: [{ value: 'qualified', label: '已确认' }] },
        { key: 'updated_range', label: '更新时间', type: 'date_range', operator: 'between', placement: 'more' },
      ],
    }),
    state: { draft: {}, applied: {} },
    resultMeta: { total: 42, shown: 42 },
  });
  assert.match(html, /class="tp-filter-primary-row"/);
  assert.match(html, /class="tp-filter-menu"/);
  assert.match(html, /data-filter-basic="owner"/);
  assert.match(html, /data-filter-basic="stage"/);
  assert.match(html, /<details class="tp-filter-advanced">/);
  assert.doesNotMatch(html, /<details class="tp-filter-advanced" open/);
  assert.match(html, /更新时间/);
  assert.match(html, /42 条结果/);
});

test('presentation grouping does not alter serialized authorization payload', () => {
  const controller = createFilterController({ pageKey: 'customers', schema: schema(), storage: new MemoryStorage() });
  controller.setDraft('search', '电源');
  controller.toggleValue('country', 'RU');
  controller.setDraft('owner', 'U-1');
  assert.deepEqual(controller.apply().filters, [
    { field: 'search', operator: 'contains', value: '电源' },
    { field: 'country', operator: 'in', value: ['RU'] },
    { field: 'owner', operator: 'eq', value: 'U-1' },
  ]);
});
```

In the existing `mount API is exported...` test, replace the obsolete blue and 600px assertions with:

```js
assert.match(css, /#0f766e/i);
assert.match(css, /@media\s*\(max-width:\s*780px\)/);
```

Append to `test/crm_ui_polish.test.js`:

```js
test('filter presentation is compact, accessible, and keeps applied state visible', () => {
  const css = filterCss();
  assert.match(css, /\.tp-filter-primary-row/);
  assert.match(css, /\.tp-filter-advanced/);
  assert.match(css, /\.tp-filter-chip-list/);
  assert.match(css, /min-height:\s*40px/);
  assert.match(css, /@media \(max-width:\s*780px\)[\s\S]*min-height:\s*44px/);
});
```

- [ ] **Step 2: Run the filter tests and verify structural failure**

Run:

```bash
node --test test/issue116_filter_component.test.js test/crm_ui_polish.test.js
```

Expected: the new compact-layout test FAILS; all pre-existing controller and payload tests still PASS.

- [ ] **Step 3: Add presentation-only grouping and disclosure markup**

Add before `renderFilterComponent()` in `filter-component.js`:

```js
const PRIMARY_FILTER_KEYS = new Set([
  'country', 'owner', 'assigned_owner', 'assigned_owner_id',
  'stage', 'status', 'intake_status', 'lead_status',
]);

function splitFilterFields(schema) {
  const searchFields = schema.fields.filter(field => field.placement === 'search');
  const nonSearch = schema.fields.filter(field => field.placement !== 'search');
  const primaryFields = nonSearch.filter(field => (
    PRIMARY_FILTER_KEYS.has(field.key)
    && !['tag', 'date_range'].includes(field.type)
  ));
  const advancedFields = nonSearch.filter(field => !primaryFields.includes(field));
  return { searchFields, primaryFields, advancedFields };
}

function renderCompactField(field, state) {
  if (['facet', 'tag'].includes(field.type)) return renderFacetRow(field, state);
  return renderMoreField(field, state);
}

function renderPrimaryField(field, state) {
  if (!['facet', 'tag'].includes(field.type)) return renderMoreField(field, state);
  const selected = selectedValuesFor(state, field);
  return `<details class="tp-filter-menu">
    <summary>${escapeHtml(field.label)}${selected.length ? ` <span>${selected.length}</span>` : ''}</summary>
    <div class="tp-filter-menu-options">
      <button class="tp-filter-option tp-filter-all" type="button" data-filter-field="${escapeHtml(field.key)}" data-filter-all="true" aria-pressed="${selected.length ? 'false' : 'true'}">全部</button>
      ${field.options.map(option => renderOption(field, option, selected.includes(option.value))).join('')}
    </div>
  </details>`;
}
```

Replace the ready-state body of `renderFilterComponent()` with:

```js
const { searchFields, primaryFields, advancedFields } = splitFilterFields(schema);
const appliedCount = Object.keys(state.applied).length;
const selectedAdvancedCount = advancedFields.filter(field => (
  state.applied[field.key] !== undefined
)).length;
return `<section class="tp-filter-component" data-filter-status="ready"
    data-schema-version="${escapeHtml(schema.schemaVersion)}"
    data-permission-version="${escapeHtml(schema.permissionVersion)}">
  <div class="tp-filter-primary-row">
    ${searchFields.map(field => renderSearchField(field, state)).join('')}
    ${primaryFields.map(field => renderPrimaryField(field, state)).join('')}
    <div class="tp-filter-primary-actions">
      <button class="tp-filter-clear" type="button" data-filter-clear>清空</button>
      <button class="tp-filter-apply" type="button" data-filter-apply>应用筛选</button>
    </div>
  </div>
  ${advancedFields.length ? `<details class="tp-filter-advanced">
    <summary>详细筛选${selectedAdvancedCount ? ` <span>${selectedAdvancedCount}</span>` : ''}</summary>
    <div class="tp-filter-advanced-grid">${advancedFields.map(field => renderCompactField(field, state)).join('')}</div>
  </details>` : ''}
  <div class="tp-filter-applied">
    <div class="tp-filter-applied-head">
      <strong>${appliedCount ? `已启用条件 · ${appliedCount} 项` : '当前结果'}</strong>
      ${renderResultMeta(model.resultMeta)}
    </div>
    ${renderAppliedChips(schema, state)}
  </div>
</section>`;
```

Do not modify controller methods, schema normalization, event data attributes, storage keys, or `serialize()`.

- [ ] **Step 4: Add compact disclosure styles and remove conflicting earlier declarations**

Append this override block to `filter-component.css`, then remove earlier declarations for the selectors repeated below so each repeated selector has one authoritative definition. Keep untouched rules for `.tp-filter-boolean`, `.tp-filter-date-range`, error state, focus, and disabled state.

```css
.tp-filter-component{--tp-filter-brand:var(--brand,#0f766e);--tp-filter-brand-soft:var(--brand-subtle,#e7f5f2);--tp-filter-text:var(--text-primary,#18212f);--tp-filter-muted:var(--text-secondary,#667085);--tp-filter-line:var(--border-default,#e2e7ed);width:100%;color:var(--tp-filter-text);background:#fff;border-bottom:1px solid var(--tp-filter-line);font-family:inherit}
.tp-filter-component *{box-sizing:border-box}
.tp-filter-primary-row{display:grid;grid-template-columns:minmax(260px,2fr) repeat(3,minmax(150px,1fr)) auto;gap:10px;align-items:end;padding:14px 16px}
.tp-filter-primary-row label{min-width:0}
.tp-filter-search,.tp-filter-basic-field{display:grid;gap:5px}
.tp-filter-search>span,.tp-filter-basic-field>span,.tp-filter-date-range legend{font-size:12px;font-weight:600}
.tp-filter-search input,.tp-filter-basic-field input,.tp-filter-basic-field select,.tp-filter-date-range input{width:100%;min-width:0;min-height:40px;padding:8px 10px;border:1px solid var(--tp-filter-line);border-radius:7px;background:#fff;color:var(--tp-filter-text)}
.tp-filter-primary-actions{display:flex;gap:8px}
.tp-filter-menu{position:relative;min-width:0}
.tp-filter-menu summary{min-height:40px;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 10px;border:1px solid var(--tp-filter-line);border-radius:7px;background:#fff;font-size:13px;cursor:pointer}
.tp-filter-menu summary span{padding:1px 6px;border-radius:999px;background:var(--tp-filter-brand-soft);color:var(--tp-filter-brand);font-size:11px}
.tp-filter-menu-options{position:absolute;top:calc(100% + 4px);left:0;z-index:6;width:min(320px,80vw);max-height:260px;display:flex;flex-wrap:wrap;gap:6px;overflow:auto;padding:10px;border:1px solid var(--tp-filter-line);border-radius:7px;background:#fff;box-shadow:0 12px 32px rgba(24,33,47,.12)}
.tp-filter-apply,.tp-filter-clear{min-height:40px;padding:8px 13px;border-radius:7px;font-weight:600}
.tp-filter-apply{border:1px solid var(--tp-filter-brand);background:var(--tp-filter-brand);color:#fff}
.tp-filter-clear{border:1px solid var(--tp-filter-line);background:#fff;color:var(--tp-filter-text)}
.tp-filter-advanced{border-top:1px solid var(--tp-filter-line)}
.tp-filter-advanced summary{min-height:40px;display:flex;align-items:center;gap:6px;padding:8px 16px;color:var(--tp-filter-brand);font-size:13px;font-weight:600;cursor:pointer}
.tp-filter-advanced summary span{min-width:20px;padding:1px 6px;border-radius:999px;background:var(--tp-filter-brand-soft);text-align:center;font-size:11px}
.tp-filter-advanced-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:0 16px 16px}
.tp-filter-facet-row{min-width:0;border:1px solid var(--tp-filter-line);border-radius:7px;background:#fff}
.tp-filter-facet-label{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;border-bottom:1px solid var(--tp-filter-line)}
.tp-filter-facet-label strong{font-size:12px}.tp-filter-facet-label small{font-size:11px;color:var(--tp-filter-muted)}
.tp-filter-facet-options{display:flex;flex-wrap:wrap;gap:6px;max-height:152px;overflow:auto;padding:9px}
.tp-filter-option{min-height:32px;border:1px solid var(--tp-filter-line);border-radius:999px;background:#fff;color:var(--tp-filter-text);font-size:12px}
.tp-filter-option[aria-pressed="true"]{border-color:var(--tp-filter-brand);background:var(--tp-filter-brand-soft);color:var(--tp-filter-brand)}
.tp-filter-applied{display:grid;gap:8px;padding:10px 16px;border-top:1px solid var(--tp-filter-line);background:var(--surface-subtle,#f7f9fb)}
.tp-filter-applied-head{display:flex;justify-content:space-between;gap:12px;font-size:12px}
.tp-filter-chip-list{display:flex;flex-wrap:wrap;gap:6px}
.tp-filter-chip{min-height:30px;border:1px solid #b9ddd8;border-radius:999px;background:var(--tp-filter-brand-soft);color:var(--tp-filter-brand);font-size:12px}
.tp-filter-empty-copy{margin:0;color:var(--tp-filter-muted);font-size:12px}
.tp-filter-state{min-height:72px;display:grid;place-items:center;padding:16px;color:var(--tp-filter-muted)}
@media (max-width:1100px){.tp-filter-primary-row{grid-template-columns:repeat(2,minmax(0,1fr))}.tp-filter-advanced-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:780px){.tp-filter-primary-row,.tp-filter-advanced-grid{grid-template-columns:1fr}.tp-filter-search input,.tp-filter-basic-field input,.tp-filter-basic-field select,.tp-filter-date-range input,.tp-filter-menu summary,.tp-filter-apply,.tp-filter-clear,.tp-filter-advanced summary{min-height:44px}.tp-filter-primary-actions>*{flex:1}}
```

- [ ] **Step 5: Run all Issue 116 filter tests**

Run:

```bash
node --test test/issue116_filter_component.test.js test/issue116_business_page_component.test.js test/issue116_research_filter_component.test.js test/crm_ui_polish.test.js
```

Expected: all tests PASS, including the unchanged serialization contract.

- [ ] **Step 6: Commit the compact filters**

```bash
git add sales-assets/filter-component.js sales-assets/filter-component.css test/issue116_filter_component.test.js test/crm_ui_polish.test.js
git commit -m "feat: compact authorized CRM filters"
```

---

### Task 4: Readable Customer and Lead Tables

**Files:**
- Modify: `sales-assets/ui-format.js`
- Modify: `test/crm_ui_polish.test.js`
- Modify: `sales-assets/app.js:1517-1665,2644-2785`
- Modify: `sales-assets/app.css` table rules
- Modify: `sales-crm.html` script query versions

**Interfaces:**
- Consumes: website strings, arrays/JSON/delimited product values, existing Chinese status maps.
- Produces: `website(value) -> { href, label } | null`, `products(value, limit = 3) -> { items, overflow }`, and `status(value, labels) -> { label, tone }`.

- [ ] **Step 1: Add failing pure-format and table contract tests**

Append to `test/crm_ui_polish.test.js`:

```js
test('UI formatter normalizes websites, products, and statuses', () => {
  const format = require('../sales-assets/ui-format');
  assert.deepEqual(format.website('https://www.example.com/path?q=1'), {
    href: 'https://www.example.com/path?q=1',
    label: 'example.com',
  });
  assert.deepEqual(format.products('["MCU","FPGA","电源","连接器"]'), {
    items: ['MCU', 'FPGA', '电源'],
    overflow: 1,
  });
  assert.deepEqual(format.status('claimed', { claimed: '已领取' }), {
    label: '已领取',
    tone: 'success',
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
  assert.match(css, /\.tp-company-anchor\{[^}]*font-size:14px/);
  assert.match(css, /\.data-table tbody tr:hover/);
});
```

- [ ] **Step 2: Run the test and verify formatter failure**

Run:

```bash
node --test test/crm_ui_polish.test.js
```

Expected: FAIL because `website`, `products`, `status`, and table markup helpers are not exported.

- [ ] **Step 3: Add pure display formatting**

Before the return in `ui-format.js`, add:

```js
function website(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(href);
    return { href, label: url.hostname.replace(/^www\./i, '') };
  } catch (_error) {
    return null;
  }
}

function products(value, limit = 3) {
  let source = value;
  if (typeof source === 'string' && /^\s*\[/.test(source)) {
    try { source = JSON.parse(source); } catch (_error) {}
  }
  const values = (Array.isArray(source) ? source : String(source || '').split(/[,;；、|]/))
    .map(item => String(item || '').trim())
    .filter((item, index, list) => item && list.indexOf(item) === index);
  return { items: values.slice(0, limit), overflow: Math.max(0, values.length - limit) };
}

function status(value, labels = {}) {
  const key = String(value || '').trim();
  const toneMap = {
    failed: 'danger', rejected: 'danger', returned: 'danger', overdue: 'danger',
    assigned: 'warning', pending: 'warning', approved: 'info',
    claimed: 'success', completed: 'success', active: 'success',
  };
  return { label: labels[key] || key || '未标注', tone: toneMap[key] || 'neutral' };
}
```

Change the export to:

```js
return Object.freeze({ icon, mountIcons, website, products, status });
```

- [ ] **Step 4: Use the formatter without changing row actions or data**

Near other display helpers in `app.js`, add:

```js
const uiFormat = window.TradePulseUIFormat;

function websiteMarkup(value) {
  const site = uiFormat.website(value);
  return site
    ? `<a class="tp-website" href="${esc(site.href)}" target="_blank" rel="noopener">${esc(site.label)}${uiFormat.icon('external')}</a>`
    : '<span class="tp-empty-value">暂无官网</span>';
}

function productChipMarkup(value) {
  const result = uiFormat.products(value);
  if (!result.items.length) return '<span class="tp-empty-value">暂无产品信息</span>';
  return `<span class="tp-product-list">${result.items.map(item => `<span>${esc(item)}</span>`).join('')}${result.overflow ? `<b>+${result.overflow}</b>` : ''}</span>`;
}

function statusMarkup(value, labels) {
  const display = uiFormat.status(value, labels);
  return `<span class="tp-status ${display.tone}"><i class="tp-status-dot" aria-hidden="true"></i>${esc(display.label)}</span>`;
}
```

In `renderIntake()`, replace the existing `website` constant and `businessColumns` array with:

```js
const website = websiteMarkup(item.website);
const productSummary = productChipMarkup(item.product_focus || item.potential_demand);
const contactCompleteness = item.contact_name && item.contact_methods
  ? '具名联系人与联系方式完备'
  : item.contact_name ? '已有具名联系人，联系方式待补齐' : '具名联系人与联系方式待补齐';
const businessColumns = [
  `<div class="company-cell"><strong class="tp-company-anchor">${esc(item.company_name)}</strong><span>${esc(item.external_customer_id)} · ${esc([item.country, item.city].filter(Boolean).join(' / ') || '地区未标注')}</span><span>${website}</span><span>${esc([item.industry, item.customer_type].filter(Boolean).join(' · ') || '行业 / 类型未标注')}</span>${productSummary}${sourceTagMarkup({ customer_type: item.customer_type, industry: item.industry, customerTags }, 4)}<span>${sources || '暂无来源证据'} · 批次 ${esc(item.batch_id || '—')} · 更新 ${esc(shortDate(item.updated_at, true))}</span></div>`,
  `<div class="intake-contact"><strong><span class="pill ${item.contact_level === 'L3' ? '' : item.contact_level === 'L2' ? 'amber' : 'gray'}">${esc(item.contact_level || 'L0')}</span> ${esc(item.contact_name || '暂无具名联系人')}</strong><span>${esc(item.contact_title || '')}</span><span>${esc(item.contact_methods || '需要继续寻找联系方式')}</span><span>${esc(contactCompleteness)}</span></div>`,
  `<div class="decision-stack"><strong>${esc(item.assigned_owner_name || (showAI ? item.suggested_owner_name : '') || '暂无可用配额')}</strong>${layers.rule}<span class="decision-block">${esc(item.decision_reason || (showAI ? signals.riskStatus : '') || '')}</span></div>`,
  `<div class="assignment-cell">${statusMarkup(item.status, { [item.status]: intakeStatusLabel(item.status) })}<span class="${item.status === 'assigned' && item.claim_due_at < state.data.generatedAt ? 'overdue-text' : 'subtle'}">${item.claim_due_at ? `领取截止 ${shortDate(item.claim_due_at, true)}` : esc(item.return_reason || '')}</span></div>`,
  actions,
];
```

In `renderCustomers()`, replace cells 2-4 of the returned row with:

```js
`<div class="company-cell"><strong class="tp-company-anchor">${esc(accountDisplayName(account))}</strong><span>${esc(accountIdentity(account))}${accountIdentity(account) ? ' · ' : ''}${esc(account.customer_type || account.source || '—')} · 创建人：${esc(account.creator_name || '历史数据')}</span>${websiteMarkup(account.website || account.domain)}${sourceTagMarkup(account, 4)}</div>`,
`<div class="company-cell"><strong>${esc(account.country || '—')}</strong><span>${esc(account.industry || '—')}</span></div>`,
statusMarkup(account.stage, { [account.stage]: stageLabel(account.stage) }),
```

Do not change the remaining owner, activity, next-action, potential, alert, lifecycle-action, selection, `_attrs`, or click-target cells.

- [ ] **Step 5: Apply the table rhythm**

Add or replace in `app.css`:

```css
.data-table{width:100%;overflow:auto;border:1px solid var(--border-default);border-radius:7px;background:var(--surface-panel)}
.data-table table{width:100%;border-collapse:separate;border-spacing:0}
.data-table th{position:sticky;top:0;z-index:2;padding:10px 12px;background:var(--surface-subtle);border-bottom:1px solid var(--border-default);color:var(--text-secondary);font-size:12px;font-weight:600;line-height:1.45;text-align:left;white-space:nowrap}
.data-table td{padding:11px 12px;border-bottom:1px solid var(--border-default);color:var(--text-primary);font-size:13px;line-height:1.45;vertical-align:top}
.data-table tbody tr{transition:background-color .16s}
.data-table tbody tr:hover{background:var(--brand-subtle)}
.tp-company-anchor{display:block;color:var(--text-primary);font-size:14px;font-weight:650;line-height:1.4}
.company-cell>span,.intake-contact>span,.assignment-cell>span{font-size:12px;color:var(--text-secondary)}
.tp-website{display:inline-flex;align-items:center;gap:4px;color:var(--info);font-size:12px;text-decoration:none}
.tp-website .tp-icon{width:13px;height:13px}
.tp-product-list{display:flex;flex-wrap:wrap;gap:4px}
.tp-product-list span,.tp-product-list b{padding:2px 6px;border-radius:999px;background:var(--surface-subtle);font-size:12px;font-weight:500}
.tp-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600}
.tp-status-dot{width:7px;height:7px;border-radius:50%;background:var(--text-secondary)}
.tp-status.success .tp-status-dot{background:var(--brand)}.tp-status.warning .tp-status-dot{background:var(--warning)}.tp-status.danger .tp-status-dot{background:var(--danger)}.tp-status.info .tp-status-dot{background:var(--info)}
.tp-empty-value{color:var(--text-secondary);font-size:12px}
```

- [ ] **Step 6: Run table and intake regressions**

Run:

```bash
node --test test/crm_ui_polish.test.js test/issue124_intake_profile.test.js test/sales_menu.test.js
```

Expected: all tests PASS.

- [ ] **Step 7: Commit the table work**

```bash
git add sales-assets/ui-format.js sales-assets/app.js sales-assets/app.css sales-crm.html test/crm_ui_polish.test.js
git commit -m "feat: improve CRM table readability"
```

---

### Task 5: Grouped Customer Profile and Recon Empty State

**Files:**
- Modify: `test/crm_ui_polish.test.js`
- Modify: `test/issue128_profile_frontend.test.js`
- Modify: `Index.html:1083-1108` and embedded profile styles

**Interfaces:**
- Consumes: every existing Issue 127/128 customer field and existing `renderWebsite()`, `customerSanctionStatus()`, Recon state, permissions, and action IDs.
- Produces: `renderDetailSection(title, rows) -> string`, four `.detail-section` groups for pool profiles, and `.recon-empty-state` when no Recon result exists.

- [ ] **Step 1: Replace the obsolete independent-card test and add profile contracts**

Replace the last `issue 128 detail cards...` test in `test/issue128_profile_frontend.test.js` with:

```js
test('issue 128 profile fields are retained in grouped responsive sections', () => {
  const poolDetails = functionSource('renderPoolDetails', 'renderTagEditor');
  for (const field of [
    '客户ID', '官网', '俄文名称', '英文名称', '国家/城市', '客户类型', '行业',
    '当前池子', '简介', '产品需求', '邮箱', '电话', 'INN', '制裁状态',
    '联系人数量', '深度报告', '来源文件', '创建时间', '最后修改时间',
  ]) assert.match(poolDetails, new RegExp(field));
  assert.match(poolDetails, /renderDetailSection/);
  assert.match(workbench, /\.detail-section/);
  assert.match(workbench, /@media \(max-width:720px\)[^{]*\{[\s\S]*?\.detail-definition-grid[\s\S]*?grid-template-columns:1fr/);
});
```

Append to `test/crm_ui_polish.test.js`:

```js
test('embedded customer profile uses four definition groups and an actionable Recon empty state', () => {
  const html = workbench();
  const details = html.match(/function renderPoolDetails\(c\)[\s\S]*?function renderTagEditor/)?.[0] || '';
  assert.equal((details.match(/renderDetailSection\(/g) || []).length, 4);
  assert.match(details, /身份与地区/);
  assert.match(details, /业务画像与产品需求/);
  assert.match(details, /联系渠道/);
  assert.match(details, /合规、来源与生命周期/);
  assert.match(html, /class="recon-empty-state"/);
  assert.match(html, /尚未生成客户情报/);
  assert.match(html, /id="startReconBtn"/);
});
```

- [ ] **Step 2: Run profile tests and verify failure**

Run:

```bash
node --test test/issue128_profile_frontend.test.js test/crm_ui_polish.test.js
```

Expected: FAIL because the profile still renders 19 `.detail-item` cards and Recon has no intentional empty state.

- [ ] **Step 3: Render four semantic definition sections**

Add in `Index.html` before `renderPoolDetails()`:

```js
function renderDetailValue(value, raw = false) {
  if (value === undefined || value === null || value === '' || value === '-') {
    return '<span class="detail-empty">暂无</span>';
  }
  return raw ? value : escapeHtml(value);
}

function renderDetailSection(title, rows) {
  return `<section class="detail-section"><h3>${escapeHtml(title)}</h3><dl class="detail-definition-grid">${
    rows.map(([label, value, raw = false, wide = false]) => (
      `<div class="detail-definition ${wide ? 'wide' : ''}"><dt>${escapeHtml(label)}</dt><dd>${renderDetailValue(value, raw)}</dd></div>`
    )).join('')
  }</dl></section>`;
}
```

Replace `renderPoolDetails(c)` with:

```js
function renderPoolDetails(c) {
  const sanctionStatus = customerSanctionStatus(c);
  return [
    renderDetailSection('身份与地区', [
      ['客户ID', c.customerId],
      ['官网', renderWebsite(c.website), true],
      ['俄文名称', c.russianName],
      ['英文名称', c.englishName],
      ['国家/城市', [c.country, c.city].filter(Boolean).join(' / ')],
      ['当前池子', c.currentPool],
    ]),
    renderDetailSection('业务画像与产品需求', [
      ['客户类型', c.customerType],
      ['行业', c.industry],
      ['简介', c.description, false, true],
      ['产品需求', c.products, false, true],
    ]),
    renderDetailSection('联系渠道', [
      ['邮箱', c.email],
      ['电话', c.phone],
      ['联系人数量', c.contactCount],
    ]),
    renderDetailSection('合规、来源与生命周期', [
      ['INN', c.inn],
      ['制裁状态', sanctionStatus],
      ['深度报告', c.deepReport],
      ['来源文件', c.sourceFile],
      ['创建时间', c.createdAt ? formatDateTime(c.createdAt) : '未知'],
      ['最后修改时间', c.updatedAt ? formatDateTime(c.updatedAt) : '未知'],
    ]),
  ].join('');
}
```

- [ ] **Step 4: Add a direct Recon empty state without changing action behavior**

In `renderReconPanel(c)`, return this branch when both `j` and `r` are absent:

```js
if (!j && !r) {
  const action = state.profileAccess?.readOnly
    ? '<span class="tag">只读资料</span>'
    : '<button class="btn" id="startReconBtn" type="button">开始 Russia-recon</button>';
  return `<div class="recon-empty-state">
    <svg class="line-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
    <h3>尚未生成客户情报</h3>
    <p>运行 Recon 后可查看需求信号、联系人、证据与建议动作。</p>
    ${action}
  </div>`;
}
```

Leave queued, running, failed, completed, read-only, evidence, report, and retry branches unchanged.

- [ ] **Step 5: Replace independent-card profile styles**

In the embedded stylesheet in `Index.html`, use:

```css
.detail-grid{display:grid;gap:14px}
.detail-section{padding:0;border:1px solid var(--line);border-radius:8px;background:#fff;overflow:hidden}
.detail-section h3{margin:0;padding:12px 14px;border-bottom:1px solid var(--line);background:#f7f9fb;font-size:16px;line-height:1.4}
.detail-definition-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin:0}
.detail-definition{display:grid;grid-template-columns:minmax(90px,128px) minmax(0,1fr);gap:12px;padding:10px 14px;border-bottom:1px solid var(--line)}
.detail-definition:nth-last-child(-n+2){border-bottom:0}
.detail-definition.wide{grid-column:1/-1}
.detail-definition dt{color:var(--muted);font-size:12px;font-weight:600}
.detail-definition dd{min-width:0;margin:0;color:var(--ink);font-size:14px;overflow-wrap:anywhere}
.detail-empty{color:var(--muted)}
.recon-empty-state{min-height:320px;display:grid;place-items:center;align-content:center;gap:10px;padding:32px;text-align:center}
.recon-empty-state .line-icon{width:34px;height:34px;fill:none;stroke:var(--primary);stroke-width:1.7;stroke-linecap:round}
.recon-empty-state h3,.recon-empty-state p{margin:0}.recon-empty-state p{max-width:440px;color:var(--muted)}
@media (max-width:720px){.detail-definition-grid{grid-template-columns:1fr}.detail-definition,.detail-definition.wide{grid-column:auto;grid-template-columns:1fr;gap:3px}.detail-definition:nth-last-child(-n+2){border-bottom:1px solid var(--line)}.detail-definition:last-child{border-bottom:0}}
```

- [ ] **Step 6: Run profile, access, and intake regressions**

Run:

```bash
node --test test/issue128_profile_frontend.test.js test/issue124_intake_profile.test.js test/issue130_profile_access_status.test.js test/crm_ui_polish.test.js
```

Expected: all tests PASS and all Issue 127/128 fields remain present.

- [ ] **Step 7: Commit the grouped profile**

```bash
git add Index.html test/issue128_profile_frontend.test.js test/crm_ui_polish.test.js
git commit -m "feat: group customer profile information"
```

---

### Task 6: Searchable Tag Disclosures and Sticky Mobile Save

**Files:**
- Modify: `test/crm_ui_polish.test.js`
- Modify: `Index.html:1007,1086-1099` and embedded tag styles

**Interfaces:**
- Consumes: existing tag IDs, `state.tags`, permission checks, `.customer-tag-check`, `saveCustomerTags()`, and `createCustomTag()`.
- Produces: `filterTagEditor(query) -> void`, native category `<details>`, `#tagSearch`, `#tagEditorCancel`, and sticky `.tag-editor-actions`.

- [ ] **Step 1: Add failing tag-editor contracts**

Append to `test/crm_ui_polish.test.js`:

```js
test('tag editor supports search, disclosure counts, and sticky save without changing IDs', () => {
  const html = workbench();
  const editor = html.match(/function renderTagEditor\(c\)[\s\S]*?function renderStatusTags/)?.[0] || '';
  assert.match(editor, /id="tagSearch"/);
  assert.match(editor, /<details class="tag-group"/);
  assert.match(editor, /selectedCount \? ' open' : ''/);
  assert.match(editor, /\$\{selectedCount\} \/ \$\{groups\[cat\]\.length\}/);
  assert.match(editor, /class="customer-tag-check"/);
  assert.match(editor, /id="saveTagsBtn"/);
  assert.match(editor, /class="tag-editor-actions"/);
  assert.match(html, /function filterTagEditor\(query\)/);
  assert.match(html, /\.tag-editor-actions\{[^}]*position:sticky/);
});
```

- [ ] **Step 2: Run the test and verify tag editor failure**

Run:

```bash
node --test test/crm_ui_polish.test.js
```

Expected: FAIL because the editor renders all categories expanded, has no search, and save is only at the top.

- [ ] **Step 3: Add category disclosures with selected counts**

Replace the editable branch inside `renderTagEditor(c)` with:

```js
const manualEditor = Object.keys(groups).length
  ? Object.keys(groups).map(cat => {
      const selectedCount = groups[cat].filter(tag => selected.has(String(tag.id))).length;
      return `<details class="tag-group"${selectedCount ? ' open' : ''} data-tag-category>
        <summary><span>${escapeHtml(cat)}</span><small>${selectedCount} / ${groups[cat].length}</small></summary>
        <div class="tag-checks">${groups[cat].map(tag => (
          `<label class="tag-check" data-tag-name="${escapeAttr(tag.name.toLowerCase())}">
            <input type="checkbox" class="customer-tag-check" value="${escapeAttr(tag.id)}" ${selected.has(String(tag.id)) ? 'checked' : ''}>
            <span>${escapeHtml(tag.name)}</span>
          </label>`
        )).join('')}</div>
      </details>`;
    }).join('')
  : '<div class="empty">暂无客户标签</div>';
return `<div class="tag-editor-head">
  <div><h3>客户标签</h3><p class="muted">按分类选择需要保留在客户主档的标签</p></div>
  <label class="tag-search"><span class="sr-only">搜索标签</span><input class="input" id="tagSearch" type="search" placeholder="搜索标签"></label>
</div>
<div class="tag-groups">${manualEditor}${ai}</div>
<div class="tag-create">
  <select class="select" id="newTagCategory">${defaultTagCategories().map(cat => `<option value="${escapeAttr(cat)}">${escapeHtml(cat)}</option>`).join('')}</select>
  <input class="input" id="newTagName" placeholder="新增标签">
  <button class="btn secondary small" type="button" id="createTagBtn">新增标签</button>
</div>
<div class="tag-editor-actions">
  <button class="btn ghost" type="button" id="tagEditorCancel">取消</button>
  <button class="btn" type="button" id="saveTagsBtn">保存标签</button>
</div>`;
```

- [ ] **Step 4: Add delegated search and cancel behavior**

Add:

```js
function filterTagEditor(query) {
  const normalized = String(query || '').trim().toLowerCase();
  $$('#tagEditorPanel [data-tag-name]').forEach(label => {
    label.hidden = Boolean(normalized) && !label.dataset.tagName.includes(normalized);
  });
  $$('#tagEditorPanel [data-tag-category]').forEach(group => {
    const visible = [...group.querySelectorAll('[data-tag-name]')].some(label => !label.hidden);
    group.hidden = !visible;
    if (normalized && visible) group.open = true;
  });
}
```

Extend the existing delegated listeners in `bindEvents()`:

```js
$('#tagEditorPanel').addEventListener('click', e => {
  if (e.target.closest('#saveTagsBtn')) saveCustomerTags();
  if (e.target.closest('#createTagBtn')) createCustomTag();
  if (e.target.closest('#tagEditorCancel')) setDetailTab('overview');
});
$('#tagEditorPanel').addEventListener('input', e => {
  if (e.target.matches('#tagSearch')) filterTagEditor(e.target.value);
});
```

Keep `saveCustomerTags()` collecting `.customer-tag-check` values and keep both API actions unchanged.

- [ ] **Step 5: Add compact disclosure and sticky-action styles**

In the embedded stylesheet:

```css
.tag-editor{display:grid;gap:14px;padding-bottom:8px}
.tag-editor-head{display:flex;justify-content:space-between;align-items:end;gap:12px}
.tag-editor-head h3,.tag-editor-head p{margin:0}
.tag-search{width:min(300px,100%)}
.tag-groups{display:grid;gap:8px}
.tag-group{border:1px solid var(--line);border-radius:8px;background:#fff;overflow:hidden}
.tag-group summary{min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;background:#f7f9fb;cursor:pointer;font-size:14px;font-weight:600}
.tag-group summary small{color:var(--muted);font-size:12px}
.tag-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:10px}
.tag-check{min-height:40px;display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid var(--line);border-radius:7px;font-size:13px}
.tag-check:has(input:checked){border-color:var(--primary);background:#e7f5f2;color:var(--primary)}
.tag-create{display:grid;grid-template-columns:minmax(140px,.7fr) minmax(180px,1fr) auto;gap:8px;padding-top:14px;border-top:1px solid var(--line)}
.tag-editor-actions{position:sticky;bottom:0;z-index:3;display:flex;justify-content:flex-end;gap:8px;padding:10px 0;background:#fff;border-top:1px solid var(--line)}
@media (max-width:720px){.tag-editor-head{align-items:stretch;flex-direction:column}.tag-search{width:100%}.tag-checks,.tag-create{grid-template-columns:1fr}.tag-check{min-height:44px}.tag-editor-actions{margin:0 -14px -14px;padding:10px 14px;padding-bottom:max(10px,env(safe-area-inset-bottom))}.tag-editor-actions .btn{flex:1;min-height:44px}}
```

- [ ] **Step 6: Run profile and tag regression tests**

Run:

```bash
node --test test/crm_ui_polish.test.js test/issue112_tag_semantics.test.js test/issue128_profile_frontend.test.js test/issue130_profile_access_status.test.js
```

Expected: all tests PASS; tag IDs, permissions, create/save actions, and profile refresh contracts remain unchanged.

- [ ] **Step 7: Commit the tag editor**

```bash
git add Index.html test/crm_ui_polish.test.js
git commit -m "feat: streamline customer tag editing"
```

---

### Task 7: Responsive, Accessibility, and Browser Verification

**Files:**
- Modify: `test/crm_ui_polish.test.js`
- Modify: `sales-assets/app.css`
- Modify: `sales-assets/filter-component.css`
- Modify: `Index.html`
- Modify: `sales-crm.html` asset query versions

**Interfaces:**
- Consumes: all UI contracts produced by Tasks 1-6.
- Produces: verified layouts at five target viewports, full regression evidence, and final cache-busted assets.

- [ ] **Step 1: Add final static accessibility and containment contracts**

Append to `test/crm_ui_polish.test.js`:

```js
test('responsive contracts prevent page overflow and preserve mobile actions', () => {
  const css = appCss();
  assert.match(css, /\.main\{[^}]*min-width:0/);
  assert.match(css, /\.main>\.topbar,[^{]*\.main>\.view[^{]*\{[^}]*1680px/);
  assert.match(css, /@media \(max-width:780px\)/);
  assert.match(css, /overflow-x:auto/);
  assert.match(workbench(), /padding-bottom:max\(10px,env\(safe-area-inset-bottom\)\)/);
});

test('interactive feedback exposes focus, loading, and polite live regions', () => {
  const css = `${appCss()}\n${filterCss()}`;
  assert.match(css, /:focus-visible/);
  assert.match(crm(), /id="toast" class="toast" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(workbench(), /class="toast" id="toast" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(workbench(), /btn\.disabled=!0;btn\.textContent='保存中\.\.\.'/);
  assert.match(workbench(), /showToast/);
});
```

Update the two existing toast roots without changing their IDs:

```html
<div id="toast" class="toast" role="status" aria-live="polite" aria-atomic="true"></div>
```

```html
<div class="toast" id="toast" role="status" aria-live="polite" aria-atomic="true"></div>
```

- [ ] **Step 2: Run focused UI contracts**

Run:

```bash
node --test test/crm_ui_polish.test.js
```

Expected: PASS after any missing containment or focus rule is added. Do not weaken assertions to accommodate an overflowing layout.

- [ ] **Step 3: Run all directly affected regression tests**

Run:

```bash
node --test \
  test/issue116_filter_component.test.js \
  test/issue116_business_page_component.test.js \
  test/issue116_research_filter_component.test.js \
  test/issue124_intake_profile.test.js \
  test/issue128_profile_frontend.test.js \
  test/issue130_profile_access_status.test.js \
  test/issue112_tag_semantics.test.js \
  test/sales_menu.test.js \
  test/crm_ui_polish.test.js
```

Expected: all tests PASS with zero failures.

- [ ] **Step 4: Run the complete Node test suite**

Run:

```bash
npm test
```

Expected: exit code `0`; all tests PASS.

- [ ] **Step 5: Start an isolated local server**

Run:

```bash
PORT=3117 HOST=127.0.0.1 node server.js
```

Expected: the server reports it is listening at `http://127.0.0.1:3117`. Leave this session running only for browser verification.

- [ ] **Step 6: Verify the six user workflows in an authenticated browser**

Use the in-app browser with an existing authorized CRM session or the repository's development login. For each viewport `375x812`, `768x1024`, `1024x768`, `1440x900`, and `1920x1080`, inspect:

1. `#dashboard`: six KPIs, attention count in panel header, readable bounded funnel, no orphan card.
2. `#customers`: compact filter row, collapsed detailed filters, visible applied chips, table header visible at `1440x900`, internal table scrolling only.
3. `#pool`: summary does not dominate the page, compact authorized filters, lead table header visible at `1440x900`.
4. Customer profile overview: four information groups, no duplicate company heading, no horizontal overflow at `375px`.
5. Recon tab with no result: complete empty state, one clear action, no unexplained blank area.
6. Tags tab: search narrows labels, selected categories start open, other categories start closed, sticky Save remains visible at `375px`, final tag is not covered.

At each viewport, evaluate:

```js
({
  pageScrollWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
  hasPageOverflow: document.documentElement.scrollWidth > window.innerWidth,
})
```

Expected: `hasPageOverflow` is `false`. Tables may have internal horizontal overflow. No text overlaps, no button label clips, controls do not shift on hover, keyboard focus is visible, and mobile action targets are at least `44px`.

- [ ] **Step 7: Capture final screenshots and inspect them**

Capture:

- Dashboard at `1440x900` and `375x812`.
- Customer panorama at `1440x900`.
- Lead pool at `1440x900`.
- Profile overview, Recon empty state, and tag editor at `375x812`.
- Dashboard or customer panorama at `1920x1080`.

Expected: screenshots show the approved neutral/teal palette, clear 24/18/16/14/13/12 hierarchy, restrained borders, no nested-card clutter, no overlap, and no blank or clipped regions.

- [ ] **Step 8: Update cache-busting query strings once**

In `sales-crm.html`, set the changed assets to one release key:

```html
<link rel="stylesheet" href="/sales-assets/app.css?v=20260729-ui-polish">
<link rel="stylesheet" href="/sales-assets/filter-component.css?v=20260729-ui-polish">
<script src="/sales-assets/ui-format.js?v=20260729-ui-polish"></script>
<script src="/sales-assets/filter-component.js?v=20260729-ui-polish"></script>
<script src="/sales-assets/app.js?v=20260729-ui-polish"></script>
```

- [ ] **Step 9: Re-run the final verification after cache-key changes**

Run:

```bash
node --test test/crm_ui_polish.test.js test/sales_menu.test.js
npm test
git diff --check
git status --short
```

Expected: both test commands exit `0`, `git diff --check` prints nothing, and status lists only the planned UI files.

- [ ] **Step 10: Commit the verified result**

```bash
git add sales-assets/app.css sales-assets/filter-component.css sales-crm.html Index.html test/crm_ui_polish.test.js
git commit -m "test: verify responsive CRM polish"
```
