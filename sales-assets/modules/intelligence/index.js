import { escapeAttribute, escapeHtml } from '../../components/html.js';
import { renderEmptyState } from '../../components/empty-state.js';

export const id = 'intelligence';

const KINDS = Object.freeze(['pool', 'people', 'recon']);
const LABELS = Object.freeze({ pool: '线索池', people: '联系人', recon: 'Recon 情报' });
const PERMISSIONS = Object.freeze({ pool: 'view_pool', people: 'view_contacts', recon: 'view_recon' });
let current = null;

function initialCollection() {
  return Object.fromEntries(KINDS.map(kind => [kind, {
    rows: [], page: 0, total: 0, hasMore: false, loading: false, loaded: false,
    error: '', forbidden: false, search: '',
  }]));
}

async function fetchKind(context, data, kind, { reset = false } = {}) {
  const state = data.collections[kind];
  if (!context.access.permissions?.[PERMISSIONS[kind]] || state.loading) return;
  state.loading = true;
  state.error = '';
  if (reset) Object.assign(state, { rows: [], page: 0, total: 0, hasMore: false, loaded: false });
  renderContent(context, data);
  try {
    const controller = context.lifecycle.createAbortController();
    const payload = await context.services.intelligence.research(kind, {
      page: state.page + 1,
      pageSize: 50,
      search: state.search,
    }, { signal: controller.signal, timeoutMs: 12000 });
    state.rows = reset ? (payload.rows || []) : [...state.rows, ...(payload.rows || [])];
    Object.assign(state, {
      page: Number(payload.page || state.page + 1),
      total: Number(payload.total || 0),
      hasMore: Boolean(payload.hasMore),
      loaded: true,
    });
  } catch (error) {
    state.forbidden = error?.status === 403;
    state.error = error?.message || '情报加载失败';
    state.loaded = true;
  } finally {
    state.loading = false;
    renderContent(context, data);
  }
}

export async function load(context) {
  context.mount.innerHTML = '<div class="empty-state" role="status"><strong>正在加载情报中心…</strong></div>';
  const available = KINDS.filter(kind => context.access.permissions?.[PERMISSIONS[kind]]);
  if (!available.length) return { state: 'forbidden', collections: initialCollection(), active: 'pool' };
  const data = { state: 'ready', collections: initialCollection(), active: available[0] };
  await Promise.all(available.map(kind => fetchKind(context, data, kind, { reset: true })));
  return data;
}

function poolRows(rows) {
  return rows.map(row => `<tr>
    <td><strong>${escapeHtml(row.company_name || '未命名企业')}</strong><small>${escapeHtml(row.customer_id || '')}</small></td>
    <td>${escapeHtml(row.country || '未标注')} · ${escapeHtml(row.industry || '未标注')}</td>
    <td>${escapeHtml(row.current_pool || '未分池')}</td>
    <td>${escapeHtml(row.best_contact_level || 'L0')}</td>
    <td>${escapeHtml(row.owner_name || row.lead_owner_name || '未分配')}</td>
  </tr>`).join('');
}

function peopleRows(rows) {
  return rows.map(row => `<tr>
    <td><strong>${escapeHtml(row.company_name || row.customer_id || '未命名企业')}</strong></td>
    <td>${escapeHtml(row.name || row.full_name || row.full_name_local || '未识别')}</td>
    <td>${escapeHtml(row.title || '未标注')} · ${escapeHtml(row.department || '')}</td>
    <td>${escapeHtml(row.contact_level || 'L0')}</td>
    <td>${escapeHtml(row.methods_summary || '未找到直接联系方式')}</td>
  </tr>`).join('');
}

function reconRows(rows) {
  return rows.map(row => `<tr>
    <td><strong>${escapeHtml(row.company_name || row.customer_id || '未命名企业')}</strong></td>
    <td>${escapeHtml(row.score || '—')} · ${escapeHtml(row.current_pool || '未分池')}</td>
    <td>${escapeHtml(row.customer_type || row.industry || '待确认')}</td>
    <td>${escapeHtml(row.demand_summary || row.product_focus || '待补充')}</td>
    <td>${row.job_id ? `<a class="text-button" href="/api/report?job_id=${escapeAttribute(row.job_id)}" target="_blank" rel="noopener">查看报告</a>` : '已关联档案'}</td>
  </tr>`).join('');
}

function table(kind, rows) {
  const headers = {
    pool: ['企业', '国家/行业', '分组', '联系人质量', '负责人'],
    people: ['客户', '联系人', '职位/部门', '等级', '联系方式'],
    recon: ['客户', '评分/分组', '画像', '需求与机会', '报告'],
  }[kind];
  const body = kind === 'pool' ? poolRows(rows) : kind === 'people' ? peopleRows(rows) : reconRows(rows);
  return `<div class="table-scroll"><table><thead><tr>${headers.map(value => `<th>${value}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function panel(data, kind) {
  const state = data.collections[kind];
  if (state.forbidden) return renderEmptyState({ title: '403 无权查看', description: `当前账号没有${LABELS[kind]}权限。` });
  if (state.loading && !state.loaded) return renderEmptyState({ title: `正在加载${LABELS[kind]}…` });
  if (state.error) return renderEmptyState({ title: `${LABELS[kind]}加载失败`, description: state.error, actionLabel: '重试', actionId: `retry-intelligence-${kind}` });
  if (!state.rows.length) return renderEmptyState({ title: `暂无${LABELS[kind]}数据`, description: '当前行级范围和筛选条件下没有结果。' });
  return `${table(kind, state.rows)}
    <div class="pagination">
      <span>已显示 ${state.rows.length} / ${state.total}</span>
      <button class="button secondary" type="button" data-load-more="${kind}" ${!state.hasMore || state.loading ? 'disabled' : ''}>
        ${state.loading ? '正在加载…' : state.hasMore ? '继续加载' : '已加载全部'}
      </button>
    </div>`;
}

function content(data) {
  const state = data.collections[data.active];
  return `<div class="module-workspace" data-module="${id}">
    <header class="workspace-header"><div><p class="eyebrow">客户情报</p><h1>情报中心</h1>
      <p>结果由服务端按客户与联系人权限裁剪。</p></div></header>
    <div class="workspace-toolbar">
      <div class="segmented-control" role="tablist">${KINDS.map(kind =>
        `<button type="button" role="tab" data-intelligence-tab="${kind}" aria-selected="${data.active === kind}" ${state.forbidden ? '' : ''}>${LABELS[kind]}</button>`).join('')}</div>
      <form data-intelligence-search><input name="search" value="${escapeAttribute(state.search)}" placeholder="搜索当前视图"><button class="button secondary">搜索</button></form>
    </div>
    <section class="workspace-section" data-intelligence-panel="${data.active}">${panel(data, data.active)}</section>
  </div>`;
}

function renderContent(context, data) {
  if (!context.mount || context.lifecycle.disposed) return;
  context.mount.innerHTML = content(data);
}

export function render(context) {
  current = { context, data: context.data };
  if (context.data.state === 'forbidden') {
    context.mount.innerHTML = renderEmptyState({ title: '403 无权访问情报中心', description: '需要线索池、联系人或 Recon 查看权限。' });
    return;
  }
  renderContent(context, context.data);
  context.lifecycle.listen(context.mount, 'click', event => {
    const tab = event.target.closest?.('[data-intelligence-tab]');
    if (tab) {
      context.data.active = tab.dataset.intelligenceTab;
      renderContent(context, context.data);
      return;
    }
    const more = event.target.closest?.('[data-load-more]');
    if (more) void fetchKind(context, context.data, more.dataset.loadMore);
    const action = event.target.closest?.('[data-action]')?.dataset.action || '';
    if (action.startsWith('retry-intelligence-')) {
      void fetchKind(context, context.data, action.replace('retry-intelligence-', ''), { reset: true });
    }
  });
  context.lifecycle.listen(context.mount, 'submit', event => {
    if (!event.target.matches?.('[data-intelligence-search]')) return;
    event.preventDefault();
    context.data.collections[context.data.active].search = String(new FormData(event.target).get('search') || '').trim();
    void fetchKind(context, context.data, context.data.active, { reset: true });
  });
}

export function dispose() {
  current = null;
}
