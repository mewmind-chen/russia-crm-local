import { escapeAttribute, escapeHtml } from '../../components/html.js';
import { renderEmptyState } from '../../components/empty-state.js';

export const id = 'customers';

let activeContext = null;
let searchTimer = null;

function requestId(prefix) {
  const value = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${value}`;
}

export function normalizeCustomerFilters(filters = {}) {
  return {
    search: String(filters.search || '').trim(),
    stage: String(filters.stage || '').trim(),
    priority: String(filters.priority || '').trim(),
    ownerId: String(filters.ownerId || '').trim(),
    onlyOverdue: Boolean(filters.onlyOverdue),
  };
}

function requestedMode(route = {}) {
  if (route.requestedRoute === 'pipeline') return 'pipeline';
  if (route.requestedRoute === 'recycleBin') return 'recycle';
  return 'customers';
}

function currentModel(context) {
  return context.store.state.customerWorkflow || {
    mode: requestedMode(context.route),
    accounts: [],
    activities: [],
    rfqs: [],
    quotes: [],
    orders: [],
    alerts: [],
    timeline: [],
    funnel: [],
    summary: {},
    recycle: { rows: [], total: 0 },
    filters: normalizeCustomerFilters(),
    selected: [],
    pendingAction: '',
    loading: false,
    message: '',
    error: '',
  };
}

function commit(context, patch) {
  return context.store.setSection('customerWorkflow', {
    ...currentModel(context),
    ...patch,
  });
}

function invalidateCounters(context) {
  context.store.setSection('workflowCounters', previous => ({
    ...(previous || {}),
    customers: Number(previous?.customers || 0) + 1,
    pipeline: Number(previous?.pipeline || 0) + 1,
    today: Number(previous?.today || 0) + 1,
  }));
}

async function refreshAuthoritative(context, options = {}) {
  const model = currentModel(context);
  if (model.mode === 'recycle') {
    const recycle = await context.services.customers.listRecycleBin({
      kind: options.recycleKind || model.recycle.kind || 'sales_return',
      page: 1,
      pageSize: 100,
      search: model.filters.search,
    }, { signal: context.lifecycle.signal });
    const next = commit(context, {
      recycle,
      loading: false,
      pendingAction: '',
      error: '',
      message: options.message || '',
    });
    if (options.invalidate) invalidateCounters(context);
    paint(context);
    return next;
  }
  const payload = await context.services.session.bootstrap(['customers', 'today'], {
    timeoutMs: 15000,
    signal: context.lifecycle.signal,
  });
  const next = commit(context, {
    ...payload,
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
    await refreshAuthoritative(context, { invalidate: true, message: '服务器数据已更新' });
  } catch (error) {
    if (error?.status === 409) {
      await refreshAuthoritative(context, {
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
  const mode = requestedMode(context.route);
  commit(context, { mode, loading: true, filters: normalizeCustomerFilters(), error: '', message: '' });
  return refreshAuthoritative(context);
}

function filteredAccounts(model) {
  const search = model.filters.search.toLowerCase();
  const overdue = new Set((model.alerts || []).filter(item => item.code === 'OVERDUE').map(item => item.customerId));
  return (model.accounts || []).filter(account => {
    const haystack = [
      account.company_name, account.external_customer_id, account.country,
      account.industry, account.owner_name,
    ].join(' ').toLowerCase();
    return (!search || haystack.includes(search))
      && (!model.filters.stage || account.stage === model.filters.stage)
      && (!model.filters.priority || account.priority === model.filters.priority)
      && (!model.filters.ownerId || account.owner_id === model.filters.ownerId)
      && (!model.filters.onlyOverdue || overdue.has(account.id));
  });
}

function commercePanel(model, account) {
  if (!account) return '';
  const rfqs = (model.rfqs || []).filter(item => item.customer_id === account.id);
  const quotes = (model.quotes || []).filter(item => item.customer_id === account.id);
  return `<details class="panel" data-commerce-panel>
    <summary>记录询价、报价或订单</summary>
    <form class="form-grid two" data-commerce-form>
      <input type="hidden" name="customerId" value="${escapeAttribute(account.id)}">
      <input type="hidden" name="idempotencyKey" value="${escapeAttribute(requestId(`commerce:${account.id}`))}">
      <label>类型<select name="kind" data-commerce-kind><option value="rfq">收到询价</option><option value="quote">发送报价</option><option value="order">确认订单</option></select></label>
      <label>币种<select name="currency"><option>USD</option><option>EUR</option><option>CNY</option><option>RUB</option></select></label>
      <label>金额<input name="amount" type="number" min="0" step=".01"></label>
      <label>毛利率 %<input name="grossMargin" type="number" min="-100" max="100" step=".1" value="8"></label>
      <label>RFQ<select name="rfqId"><option value="">最近询价</option>${rfqs.map(rfq =>
        `<option value="${escapeAttribute(rfq.id)}">${escapeHtml(rfq.reference || rfq.id)}</option>`).join('')}</select></label>
      <label>关联报价<select name="quoteId"><option value="">请选择报价</option>${quotes.map(quote =>
        `<option value="${escapeAttribute(quote.id)}">${escapeHtml(`${quote.id} · ${quote.amount} ${quote.currency || 'USD'}`)}</option>`).join('')}</select></label>
      <label>BOM 行数<input name="bomLines" type="number" min="0" step="1"></label>
      <label>询价资料完整度<input name="completeness" type="number" min="0" max="100" step="1"></label>
      <label>询价预估金额<input name="expectedValue" type="number" min="0" step=".01"></label>
      <label>产品类别<input name="productCategory"></label>
      <label><input name="lossLeader" type="checkbox"> 引流报价</label>
      <label><input name="isRepeat" type="checkbox"> 复购订单</label>
      <button class="button primary" type="submit"${model.pendingAction ? ' disabled' : ''}>提交业务记录</button>
    </form>
  </details>`;
}

function customerTable(model, context) {
  const rows = filteredAccounts(model);
  if (!rows.length) return renderEmptyState({ title: '没有符合条件的客户', description: '调整筛选条件后重试。' });
  return `<div class="table-scroll" tabindex="0"><table>
    <thead><tr><th>选择</th><th>客户</th><th>阶段</th><th>负责人</th><th>优先级</th><th>下一步</th><th>操作</th></tr></thead>
    <tbody>${rows.map(account => `<tr data-row-key="${escapeAttribute(account.id)}">
      <td><input type="checkbox" data-customer-select="${escapeAttribute(account.id)}"${model.selected.includes(account.id) ? ' checked' : ''}></td>
      <td><button class="text-button customer-name-detail" type="button" data-customer-detail="${escapeAttribute(account.external_customer_id || account.id)}"><strong>${escapeHtml(account.company_name)}</strong></button><br><small>${escapeHtml(account.external_customer_id || account.id)}</small></td>
      <td>${escapeHtml(context.store.state.session?.stages
        ?.find(stage => stage.key === account.stage)?.label || account.stage || '新客户')}</td>
      <td>${escapeHtml(account.owner_name || '未分配')}</td>
      <td>${escapeHtml(account.priority || 'B')}</td>
      <td>${escapeHtml(account.next_action || '未填写')}</td>
      <td><button class="button secondary customer-detail-secondary" type="button" data-customer-detail="${escapeAttribute(account.external_customer_id || account.id)}">查看详情</button>
        <button class="button secondary" type="button" data-customer-focus="${escapeAttribute(account.id)}">经营写入</button>
        ${context.access.permissions?.manage_customer_recycle ? `<button class="button secondary" type="button" data-customer-return="${escapeAttribute(account.id)}">退回</button>
        <button class="button secondary" type="button" data-customer-trash="${escapeAttribute(account.id)}">回收</button>` : ''}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function pipeline(model) {
  const stages = activeContext.store.state.session?.stages || [];
  const counts = new Map((model.accounts || []).map(account => account.stage)
    .map(stage => [stage, (model.accounts || []).filter(item => item.stage === stage).length]));
  return `<section class="panel"><header class="panel-head"><h3>阶段管道</h3><span>阶段由服务器业务写入决定</span></header>
    <div class="funnel-chart">${stages.map(stage => `<div class="funnel-row">
      <span class="funnel-label">${escapeHtml(stage.label)}</span><div class="funnel-track"><div class="funnel-bar" style="width:${Math.max(2, Math.min(100, Number(counts.get(stage.key) || 0) * 8))}%"></div></div>
      <strong>${Number(counts.get(stage.key) || 0)}</strong></div>`).join('')}</div>
  </section>`;
}

function recycleTable(model) {
  const rows = model.recycle.rows || [];
  if (!rows.length) return renderEmptyState({ title: '回收站为空' });
  return `<div class="table-scroll" tabindex="0"><table>
    <thead><tr><th>客户</th><th>类型</th><th>原因</th><th>原负责人</th><th>操作</th></tr></thead>
    <tbody>${rows.map(row => `<tr>
      <td>${escapeHtml(row.company_name || row.external_customer_id || row.customer_id)}</td>
      <td>${escapeHtml(row.recycle_kind || row.kind || '')}</td>
      <td>${escapeHtml(row.recycle_reason || row.return_reason || '')}</td>
      <td>${escapeHtml(row.owner_name || row.previous_owner_name || '')}</td>
      <td>${row.recycle_kind === 'manual_trash' || row.kind === 'manual_trash'
        ? `<button class="button primary" data-customer-restore="${escapeAttribute(row.id)}">恢复</button>`
        : `<button class="button primary" data-customer-reassign="${escapeAttribute(row.id)}">重新分配</button>`}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function paint(context) {
  if (!context.mount) return;
  const model = currentModel(context);
  const focused = (model.accounts || []).find(account => account.id === model.focusedCustomerId);
  if (model.mode === 'recycle') {
    context.mount.innerHTML = `<section data-module="${id}" data-mode="recycle">
      <header class="section-intro"><div><p class="eyebrow">客户回收</p><h2>客户回收与重分配</h2></div></header>
      <form class="toolbar" data-customer-filter><input name="search" value="${escapeAttribute(model.filters.search)}" placeholder="搜索回收客户"><button class="button secondary">搜索</button></form>
      <div role="status">${escapeHtml(model.error || model.message || `共 ${model.recycle.total || 0} 条`)}</div>
      ${recycleTable(model)}
    </section>`;
    return;
  }
  const stages = activeContext.store.state.session?.stages || [];
  context.mount.innerHTML = `<section class="workflow-module" data-module="${id}" data-mode="${escapeAttribute(model.mode)}">
    <header class="section-intro"><div><p class="eyebrow">客户经营流程</p><h2>${model.mode === 'pipeline' ? '销售管道' : '客户经营'}</h2></div>
      <div class="top-actions"><a class="button secondary" data-customer-export href="${escapeAttribute(context.services.customers.exportUrl(model.filters))}">导出</a></div></header>
    <form class="toolbar" data-customer-filter>
      <input name="search" type="search" value="${escapeAttribute(model.filters.search)}" placeholder="搜索客户">
      <select name="stage"><option value="">全部阶段</option>${stages.map(stage =>
        `<option value="${escapeAttribute(stage.key)}"${model.filters.stage === stage.key ? ' selected' : ''}>${escapeHtml(stage.label)}</option>`).join('')}</select>
      <select name="priority"><option value="">全部优先级</option>${['A', 'B', 'C'].map(value =>
        `<option${model.filters.priority === value ? ' selected' : ''}>${value}</option>`).join('')}</select>
      <label><input name="onlyOverdue" type="checkbox"${model.filters.onlyOverdue ? ' checked' : ''}> 仅逾期</label>
      <button class="button secondary" type="submit">筛选</button>
    </form>
    <div class="customer-bulk-bar">
      <input data-bulk-owner placeholder="目标销售 ID">
      <button class="button primary" type="button" data-customer-bulk${!model.selected.length || model.pendingAction ? ' disabled' : ''}>批量分配 ${model.selected.length || ''}</button>
      <button class="button secondary" type="button" data-customer-bulk-return${!model.selected.length || model.pendingAction ? ' disabled' : ''}>批量退回</button>
    </div>
    <div role="status" aria-live="polite">${escapeHtml(model.error || model.message || (model.loading ? '正在读取服务器数据…' : `共 ${filteredAccounts(model).length} 家客户`))}</div>
    ${model.mode === 'pipeline' ? pipeline(model) : customerTable(model, context)}
    ${commercePanel(model, focused)}
  </section>`;
}

function formValues(form) {
  const payload = Object.fromEntries(new FormData(form));
  form.querySelectorAll('input[type="checkbox"]').forEach(input => {
    payload[input.name] = input.checked;
  });
  for (const key of ['amount', 'grossMargin', 'bomLines', 'completeness', 'expectedValue']) {
    if (payload[key] !== '') payload[key] = Number(payload[key]);
  }
  return payload;
}

async function submitCommerce(context, payload) {
  const kind = payload.kind;
  delete payload.kind;
  if (kind === 'rfq') {
    return context.services.activities.create({
      ...payload,
      activityType: 'rfq',
      idempotencyKey: payload.idempotencyKey || requestId('rfq'),
    }, { signal: context.lifecycle.signal });
  }
  if (kind === 'quote') {
    return context.services.activities.createQuote({
      ...payload,
      idempotencyKey: payload.idempotencyKey || requestId('quote'),
    }, { signal: context.lifecycle.signal });
  }
  if (!payload.quoteId) throw new Error('订单必须关联已有报价');
  return context.services.activities.createOrder({
    ...payload,
    idempotencyKey: payload.idempotencyKey || requestId('order'),
  }, { signal: context.lifecycle.signal });
}

function bind(context) {
  context.lifecycle.listen(context.mount, 'submit', event => {
    const filter = event.target.closest('[data-customer-filter]');
    if (filter) {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(filter));
      values.onlyOverdue = Boolean(filter.elements.onlyOverdue?.checked);
      commit(context, { filters: normalizeCustomerFilters(values) });
      if (currentModel(context).mode === 'recycle') void refreshAuthoritative(context);
      else paint(context);
      return;
    }
    const commerce = event.target.closest('[data-commerce-form]');
    if (!commerce) return;
    event.preventDefault();
    const payload = formValues(commerce);
    void runWrite(context, `commerce:${payload.kind}`, () => submitCommerce(context, payload));
  });

  context.lifecycle.listen(context.mount, 'input', event => {
    if (!event.target.matches('[data-customer-filter] input[name="search"]')) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      commit(context, {
        filters: normalizeCustomerFilters({
          ...currentModel(context).filters,
          search: event.target.value,
        }),
      });
      if (currentModel(context).mode === 'recycle') void refreshAuthoritative(context);
      else paint(context);
    }, 300);
  });

  context.lifecycle.listen(context.mount, 'change', event => {
    const selected = event.target.closest('[data-customer-select]');
    if (!selected) return;
    const values = new Set(currentModel(context).selected);
    if (selected.checked) values.add(selected.dataset.customerSelect);
    else values.delete(selected.dataset.customerSelect);
    commit(context, { selected: [...values] });
    paint(context);
  });

  context.lifecycle.listen(context.mount, 'click', event => {
    const detail = event.target.closest('[data-customer-detail]');
    if (detail) {
      context.navigate?.('customer-detail', {
        customerId: detail.dataset.customerDetail,
        from: context.route?.requestedRoute || context.route?.pageId || 'customers',
      });
      return;
    }
    const focus = event.target.closest('[data-customer-focus]');
    if (focus) {
      commit(context, { focusedCustomerId: focus.dataset.customerFocus });
      paint(context);
      return;
    }
    if (event.target.closest('[data-customer-bulk]')) {
      const ownerId = context.mount.querySelector('[data-bulk-owner]')?.value.trim() || '';
      if (!ownerId) return;
      void runWrite(context, 'bulk-assign', () => context.services.customers.bulkAssign({
        customerIds: currentModel(context).selected,
        ownerId,
      }, { signal: context.lifecycle.signal }));
      return;
    }
    if (event.target.closest('[data-customer-bulk-return]')) {
      const reason = String(globalThis.prompt?.('请输入批量退回原因') || '').trim();
      if (!reason) return;
      void runWrite(context, 'bulk-return', () => context.services.customers.bulkReturn({
        customerIds: currentModel(context).selected,
        reason,
      }, { signal: context.lifecycle.signal }));
      return;
    }
    const returnButton = event.target.closest('[data-customer-return]');
    const trashButton = event.target.closest('[data-customer-trash]');
    if (returnButton || trashButton) {
      const reason = String(globalThis.prompt?.('请输入操作原因') || '').trim();
      if (!reason) return;
      const customerId = (returnButton || trashButton).dataset.customerReturn
        || (returnButton || trashButton).dataset.customerTrash;
      void runWrite(context, 'recycle', () => returnButton
        ? context.services.customers.returnToPool(customerId, { reason }, { signal: context.lifecycle.signal })
        : context.services.customers.trash(customerId, { reason }, { signal: context.lifecycle.signal }));
      return;
    }
    const restore = event.target.closest('[data-customer-restore]');
    if (restore) {
      void runWrite(context, 'restore', () =>
        context.services.customers.restore(restore.dataset.customerRestore, { signal: context.lifecycle.signal }));
      return;
    }
    const reassign = event.target.closest('[data-customer-reassign]');
    if (reassign) {
      const ownerId = String(globalThis.prompt?.('请输入目标销售 ID') || '').trim();
      const reason = ownerId ? String(globalThis.prompt?.('请输入重新分配原因') || '').trim() : '';
      if (!ownerId || !reason) return;
      void runWrite(context, 'reassign', () => context.services.customers.reassign(
        reassign.dataset.customerReassign,
        { ownerId, reason },
        { signal: context.lifecycle.signal },
      ));
    }
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
