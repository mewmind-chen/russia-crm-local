import { visiblePages } from '../core/registry.js';
import { escapeAttribute, escapeHtml } from './html.js';

const GROUP_LABELS = Object.freeze({
  sales: '今日工作',
  customers: '客户经营',
  intake: '线索流转',
  assistant: '智能协作',
  management: '团队管理',
  administration: '系统管理',
});

function navigation(context, activePageId) {
  const groups = new Map();
  for (const page of visiblePages(context)) {
    const group = page.nav.group || 'sales';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(page);
  }
  return [...groups.entries()].map(([group, pages]) => `<section class="modular-nav-group">
    <h2>${escapeHtml(GROUP_LABELS[group] || group)}</h2>
    ${pages.map(page => `<a href="#${escapeAttribute(page.id)}" data-page-id="${escapeAttribute(page.id)}"${page.id === activePageId ? ' aria-current="page"' : ''}>${escapeHtml(page.nav.label)}</a>`).join('')}
  </section>`).join('');
}

export function renderShell({
  context = {},
  activePageId = '',
  user = context.user || {},
} = {}) {
  const name = user.name || 'TradePulse 用户';
  const role = user.role || context.role || '';
  return `<div class="modular-shell">
    <aside class="modular-sidebar">
      <a class="modular-brand" href="#${role === 'sales' ? 'my-today' : 'team-dashboard'}"><span>TP</span><strong>TradePulse</strong></a>
      <nav aria-label="主导航">${navigation({ ...context, role }, activePageId)}</nav>
      <footer><span class="avatar">${escapeHtml(name.slice(0, 1))}</span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(role)}</small></div><button class="icon-button" type="button" data-action="logout" title="退出登录" aria-label="退出登录">&#8617;</button></footer>
    </aside>
    <main class="modular-main">
      <header class="modular-topbar"><button class="icon-button modular-menu" type="button" data-action="menu" aria-label="打开导航">&#9776;</button><div><p class="eyebrow">TRADEPULSE CRM</p><h1 data-page-title>工作台</h1></div></header>
      <section id="pageMount" class="modular-page" tabindex="-1"></section>
    </main>
  </div>`;
}

export function mountShell(root, options = {}) {
  if (!root) throw new TypeError('mountShell requires a root element');
  root.innerHTML = renderShell(options);
  return {
    root,
    pageMount: root.querySelector('#pageMount'),
    dispose() {
      root.replaceChildren();
    },
  };
}
