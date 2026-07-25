import { escapeAttribute, escapeHtml } from '../../components/html.js';
import { renderEmptyState } from '../../components/empty-state.js';

export const id = 'intake';

const STATUS_LABELS = Object.freeze({
  pending: '待审核',
  approved: '待分配',
  assigned: '待领取',
  claimed: '已领取',
  returned: '已退回',
  rejected: '不对口',
  duplicate: '重复客户',
});

let activeContext = null;
let searchTimer = null;

function requestId(prefix = 'intake') {
  const value = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${value}`;
}

export function normalizeIntakeQuery(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(query.pageSize, 10) || 50));
  return {
    page,
    pageSize,
    search: String(query.search || '').trim(),
    status: String(query.status || '').trim(),
    country: String(query.country || '').trim(),
    owner: String(query.owner || '').trim(),
  };
}

function initialStatus(route = {}) {
  if (route.requestedRoute === 'pending') return 'assigned';
  if (route.requestedRoute === 'claimed') return 'claimed';
  return '';
}

function currentModel(context) {
  return context.store.state.intakeWorkflow || {
    query: normalizeIntakeQuery({ status: initialStatus(context.route) }),
    items: [],
    stats: {},
    settings: {},
    batches: [],
    total: 0,
    hasMore: false,
    loading: false,
    pendingAction: '',
    message: '',
    error: '',
  };
}

function commit(context, patch) {
  const previous = currentModel(context);
  return context.store.setSection('intakeWorkflow', { ...previous, ...patch });
}

function invalidateCounters(context) {
  context.store.setSection('workflowCounters', previous => ({
    ...(previous || {}),
    intake: Number(previous?.intake || 0) + 1,
    today: Number(previous?.today || 0) + 1,
  }));
}

async function refreshAuthoritative(context, query = currentModel(context).query, options = {}) {
  const normalized = normalizeIntakeQuery(query);
  const result = await context.services.intake.list(normalized, { signal: context.lifecycle.signal });
  const next = commit(context, {
    ...result,
    query: normalized,
    items: result.items || [],
    loading: false,
    pendingAction: '',
    error: '',
    message: options.message || '',
  });
  if (options.invalidate) invalidateCounters(context);
  paint(context);
  return next;
}

async function runWrite(context, actionKey, operation) {
  if (currentModel(context).pendingAction) return;
  commit(context, { pendingAction: actionKey, message: '', error: '' });
  paint(context);
  try {
    await operation();
    await refreshAuthoritative(context, currentModel(context).query, {
      invalidate: true,
      message: '服务器数据已更新',
    });
  } catch (error) {
    if (error?.status === 409) {
      await refreshAuthoritative(context, currentModel(context).query, {
        message: '数据已被其他操作更新，已刷新为服务器最新状态',
      });
      return;
    }
    commit(context, { pendingAction: '', error: error?.message || '操作失败' });
    paint(context);
  }
}

export async function load(context) {
  activeContext = context;
  const query = normalizeIntakeQuery({ status: initialStatus(context.route) });
  commit(context, { query, loading: true, error: '', message: '' });
  return refreshAuthoritative(context, query);
}

function actionButtons(item, access) {
  const disabled = currentModel(activeContext).pendingAction ? ' disabled' : '';
  if (access.role === 'sales') {
    return [
      item.status === 'assigned'
        ? `<button class="button primary" type="button" data-intake-action="claim" data-item-id="${escapeAttribute(item.id)}"${disabled}>领取</button>`
        : '',
      ['assigned', 'claimed'].includes(item.status)
        ? `<button class="button secondary" type="button" data-intake-action="return" data-item-id="${escapeAttribute(item.id)}"${disabled}>退回</button>
          <button class="button secondary" type="button" data-intake-action="reject" data-item-id="${escapeAttribute(item.id)}"${disabled}>不对口</button>`
        : '',
    ].join('');
  }
  if (access.permissions?.manage_intake && ['pending', 'approved', 'returned'].includes(item.status)) {
    return `<button class="button primary" type="button" data-intake-action="assign" data-item-id="${escapeAttribute(item.id)}" data-owner-id="${escapeAttribute(item.suggested_owner_id || '')}"${disabled}>按建议分配</button>`;
  }
  return '';
}

function intakeRows(model, access) {
  if (!model.items.length) {
    return renderEmptyState({
      title: '没有符合条件的线索',
      description: '调整状态或搜索条件后重试。',
    });
  }
  return `<div class="table-scroll" tabindex="0"><table>
    <thead><tr><th>选择</th><th>企业</th><th>地区 / 行业</th><th>状态</th><th>建议负责人</th><th>裁决</th><th>操作</th></tr></thead>
    <tbody>${model.items.map(item => `<tr data-row-key="${escapeAttribute(item.id)}">
      <td><input type="checkbox" data-intake-select="${escapeAttribute(item.id)}" aria-label="选择 ${escapeAttribute(item.company_name || item.id)}"></td>
      <td><strong>${escapeHtml(item.company_name || '未命名企业')}</strong><br><small>${escapeHtml(item.external_customer_id || item.id)}</small></td>
      <td>${escapeHtml(item.country || '未标注')}<br><small>${escapeHtml(item.industry || '未标注')}</small></td>
      <td>${escapeHtml(STATUS_LABELS[item.status] || item.status || '未知')}</td>
      <td>${escapeHtml(item.suggested_owner_name || item.assigned_owner_name || '未分配')}</td>
      <td>${escapeHtml(item.decision_reason || item.arbitration?.ruleDecision?.reason || '等待裁决')}</td>
      <td>${actionButtons(item, access)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function paint(context) {
  if (!context.mount) return;
  const model = currentModel(context);
  const canManage = Boolean(context.access.permissions?.manage_intake);
  const totalPages = Math.max(1, Math.ceil(Number(model.total || 0) / model.query.pageSize));
  context.mount.innerHTML = `<section class="workflow-module" data-module="${id}">
    <header class="section-intro">
      <div><p class="eyebrow">LEAD INTAKE</p><h2>${canManage ? '线索分配' : '我的线索'}</h2></div>
      <div class="top-actions">
        ${canManage ? '<button class="button secondary" type="button" data-intake-scan>同步线索</button><button class="button primary" type="button" data-intake-bulk>批量分配</button>' : ''}
      </div>
    </header>
    <form class="toolbar" data-intake-filter>
      <input name="search" type="search" value="${escapeAttribute(model.query.search)}" placeholder="搜索企业、编码或官网">
      <select name="status"><option value="">全部状态</option>${Object.entries(STATUS_LABELS).map(([value, label]) =>
        `<option value="${value}"${model.query.status === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
      <input name="country" value="${escapeAttribute(model.query.country)}" placeholder="国家">
      <button class="button secondary" type="submit">筛选</button>
    </form>
    <div role="status" aria-live="polite">${escapeHtml(model.error || model.message || (model.loading ? '正在读取服务器数据…' : `共 ${model.total || 0} 条`))}</div>
    ${intakeRows(model, context.access)}
    <footer class="load-more-row">
      <button class="button secondary" type="button" data-intake-page="${model.query.page - 1}"${model.query.page <= 1 || model.pendingAction ? ' disabled' : ''}>上一页</button>
      <span>第 ${model.query.page} / ${totalPages} 页</span>
      <button class="button secondary" type="button" data-intake-page="${model.query.page + 1}"${!model.hasMore || model.pendingAction ? ' disabled' : ''}>下一页</button>
    </footer>
  </section>`;
}

function selectedIds(mount) {
  return [...mount.querySelectorAll('[data-intake-select]:checked')]
    .map(input => input.dataset.intakeSelect)
    .filter(Boolean);
}

function bind(context) {
  context.lifecycle.listen(context.mount, 'submit', event => {
    const form = event.target.closest('[data-intake-filter]');
    if (!form) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    void refreshAuthoritative(context, { ...currentModel(context).query, ...values, page: 1 });
  });

  context.lifecycle.listen(context.mount, 'input', event => {
    if (!event.target.matches('[data-intake-filter] input[name="search"]')) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void refreshAuthoritative(context, {
        ...currentModel(context).query,
        search: event.target.value,
        page: 1,
      });
    }, 300);
  });

  context.lifecycle.listen(context.mount, 'click', event => {
    const page = event.target.closest('[data-intake-page]');
    if (page) {
      void refreshAuthoritative(context, {
        ...currentModel(context).query,
        page: Number(page.dataset.intakePage),
      });
      return;
    }
    if (event.target.closest('[data-intake-scan]')) {
      void runWrite(context, 'scan', () => context.services.intake.scan({ signal: context.lifecycle.signal }));
      return;
    }
    if (event.target.closest('[data-intake-bulk]')) {
      const itemIds = selectedIds(context.mount);
      void runWrite(context, 'bulk_assign', () => context.services.intake.act({
        action: 'bulk_assign',
        itemIds,
        idempotencyKey: requestId('bulk-assign'),
      }, { signal: context.lifecycle.signal }));
      return;
    }
    const button = event.target.closest('[data-intake-action]');
    if (!button) return;
    const action = button.dataset.intakeAction;
    const reason = ['return', 'reject'].includes(action)
      ? String(globalThis.prompt?.(action === 'reject' ? '请输入不对口原因' : '请输入退回原因') || '').trim()
      : '';
    if (['return', 'reject'].includes(action) && !reason) return;
    void runWrite(context, `${action}:${button.dataset.itemId}`, () => context.services.intake.act({
      action,
      itemId: button.dataset.itemId,
      ownerId: button.dataset.ownerId || '',
      reason,
      idempotencyKey: requestId(`${action}:${button.dataset.itemId}`),
    }, { signal: context.lifecycle.signal }));
  });
}

export function render(context) {
  activeContext = context;
  paint(context);
  bind(context);
}

export function dispose() {
  clearTimeout(searchTimer);
  searchTimer = null;
  activeContext = null;
}
