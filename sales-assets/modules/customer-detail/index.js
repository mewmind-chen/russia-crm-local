import { escapeAttribute, escapeHtml } from '../../components/html.js';
import { renderEmptyState } from '../../components/empty-state.js';
import {
  CUSTOMER_DETAIL_TABS,
  TAB_SERVICE_DEPENDENCIES,
  classifyDetailError,
  loadCustomerDetailTab,
  normalizeCustomerDetailTab,
  renderCustomerDetailTab,
} from './tabs.js';

export const id = 'customer-detail';

let runtime = null;

function queryValue(route, name) {
  if (route?.url?.searchParams?.get) return route.url.searchParams.get(name) || '';
  const url = route?.url ? new URL(String(route.url), 'http://localhost/') : null;
  return url?.searchParams.get(name) || '';
}

function safeReturnHref(value) {
  const source = String(value || '').trim();
  if (!source) return '#customers';
  if (/^#[A-Za-z0-9/_-]+$/.test(source)) return source;
  if (/^[A-Za-z0-9/_-]+$/.test(source)) return `#${source}`;
  if (/^\/[^/]/.test(source) && !source.includes('://')) return source;
  return '#customers';
}

export function resolveCustomerDetailContext(route = {}) {
  const requestedRoute = String(route.requestedRoute || route.route || '');
  const presentation = String(
    route.presentation || queryValue(route, 'presentation') || queryValue(route, 'mode') || 'page',
  ) === 'drawer' ? 'drawer' : 'page';
  const returnSource = route.returnTo || route.sourceRoute || queryValue(route, 'from') || 'customers';
  return {
    customerId: String(route.customerId || queryValue(route, 'customer') || '').trim(),
    activeTab: normalizeCustomerDetailTab(route.tab || queryValue(route, 'tab')),
    presentation,
    returnSource,
    returnHref: safeReturnHref(returnSource),
    legacy: Boolean(route.isLegacy || requestedRoute === 'customerProfile'),
    requestedRoute,
  };
}

function emptyState(detail) {
  return {
    ...detail,
    dataByTab: {},
    errorByTab: {},
    staleTabs: [],
    loadingTab: '',
    requestVersion: 0,
  };
}

function commit(context, patch) {
  const previous = context.store.state.customerDetail || emptyState(resolveCustomerDetailContext(context.route));
  const next = { ...previous, ...patch };
  context.store.setSection('customerDetail', next);
  return next;
}

function currentState(context) {
  return context.store.state.customerDetail || emptyState(resolveCustomerDetailContext(context.route));
}

function abortActiveRequest() {
  runtime?.controller?.abort();
  if (runtime) runtime.controller = null;
}

function focusDetailTab(context, tabId) {
  context.mount?.querySelector(`[data-customer-detail-tab="${tabId}"]`)
    ?.focus({ preventScroll: true });
}

function createController(context) {
  return context.lifecycle?.createAbortController?.() || new AbortController();
}

function titleFromOverview(state) {
  const overview = state.dataByTab.overview || {};
  const pool = overview.customerPool?.[0] || overview.customer_pool?.[0] || overview.pool || {};
  const customer = overview.customers?.[0] || overview.accounts?.[0] || {};
  return pool.companyName || pool.company_name || customer.companyName || customer.company_name
    || state.dataByTab.ai?.results?.customerName
    || Object.values(state.dataByTab).find(value => value?.account)?.account?.company_name
    || state.customerId || '客户详情';
}

function errorMarkup(state) {
  const failure = state.errorByTab[state.activeTab];
  if (!failure) return '';
  if (failure.kind === 'forbidden') {
    return `<div class="detail-state forbidden" role="alert"><h2>无权查看此客户</h2><p>当前身份没有该客户或该详情区块的访问权限。</p><a class="button secondary" href="${escapeAttribute(state.returnHref)}">返回来源页面</a></div>`;
  }
  if (failure.kind === 'not-found') {
    return `<div class="detail-state not-found" role="alert"><h2>客户不存在或已不可访问</h2><p>客户可能已回收、删除，或不在当前数据范围内。</p><a class="button secondary" href="${escapeAttribute(state.returnHref)}">返回来源页面</a></div>`;
  }
  if (failure.kind === 'dependency') {
    return renderEmptyState({
      title: '该详情区块等待接口接入',
      description: failure.dependency || TAB_SERVICE_DEPENDENCIES[state.activeTab],
    });
  }
  const label = failure.kind === 'stale'
    ? '数据版本已变化，当前显示可能已过期'
    : '详情加载失败，已保留此前成功读取的数据';
  return `<div class="detail-state ${escapeAttribute(failure.kind)}" role="alert">
    <p>${escapeHtml(label)}</p>
    <button class="button secondary" type="button" data-customer-detail-retry>重试</button>
  </div>`;
}

export function renderCustomerDetailView(state, options = {}) {
  const presentation = options.presentation || state.presentation || 'page';
  const activeData = state.dataByTab[state.activeTab];
  const failure = state.errorByTab[state.activeTab];
  const hasData = activeData !== undefined;
  const canViewContacts = Boolean(options.canViewContacts);
  return `<section class="customer-detail customer-detail-${escapeAttribute(presentation)}"
    data-module="${id}" data-presentation="${escapeAttribute(presentation)}"
    data-customer-id="${escapeAttribute(state.customerId)}"
    ${presentation === 'drawer' ? 'role="dialog" aria-modal="true"' : ''}>
    <header class="customer-detail-head">
      <a class="button secondary" data-customer-detail-back href="${escapeAttribute(state.returnHref)}">返回</a>
      <div><p class="eyebrow">${state.legacy ? '旧链接兼容入口' : '客户详情'}</p>
        <h2>${escapeHtml(titleFromOverview(state))}</h2>
        <span>${escapeHtml(state.customerId)}</span></div>
      ${presentation === 'drawer' ? '<button class="button secondary" type="button" data-customer-detail-close aria-label="关闭客户详情">关闭</button>' : ''}
    </header>
    <nav class="customer-detail-tabs" role="tablist" aria-label="客户详情">
      ${CUSTOMER_DETAIL_TABS.map(tab => `<button type="button" role="tab"
        id="customer-tab-${escapeAttribute(tab.id)}"
        aria-controls="customer-panel-${escapeAttribute(tab.id)}"
        aria-selected="${state.activeTab === tab.id}"
        tabindex="${state.activeTab === tab.id ? '0' : '-1'}"
        data-customer-detail-tab="${escapeAttribute(tab.id)}">${escapeHtml(tab.label)}</button>`).join('')}
    </nav>
    <div id="customer-panel-${escapeAttribute(state.activeTab)}" class="customer-detail-panel"
      role="tabpanel" aria-labelledby="customer-tab-${escapeAttribute(state.activeTab)}"
      aria-busy="${state.loadingTab === state.activeTab}">
      ${errorMarkup(state)}
      ${hasData ? renderCustomerDetailTab(state.activeTab, activeData, { canViewContacts }) : ''}
      ${!hasData && !failure
        ? renderEmptyState({ title: state.loadingTab ? '正在加载客户详情' : '暂无可显示数据' })
        : ''}
    </div>
  </section>`;
}

async function loadActiveTab(context, { force = false, restoreTabFocus = false } = {}) {
  const state = currentState(context);
  const tabId = state.activeTab;
  if (!force && state.dataByTab[tabId] !== undefined && !state.staleTabs.includes(tabId)) {
    return state;
  }
  abortActiveRequest();
  const controller = createController(context);
  const version = state.requestVersion + 1;
  runtime.controller = controller;
  commit(context, {
    loadingTab: tabId,
    requestVersion: version,
    errorByTab: { ...state.errorByTab, [tabId]: null },
  });
  paint(context);
  if (restoreTabFocus) focusDetailTab(context, tabId);
  try {
    const data = await loadCustomerDetailTab({
      services: context.services,
      customerId: state.customerId,
      tabId,
      signal: controller.signal,
      canViewContacts: Boolean(context.access.permissions?.view_contacts),
    });
    if (!runtime || controller.signal.aborted || currentState(context).requestVersion !== version) {
      return currentState(context);
    }
    const latest = currentState(context);
    return commit(context, {
      dataByTab: { ...latest.dataByTab, [tabId]: data },
      errorByTab: { ...latest.errorByTab, [tabId]: null },
      staleTabs: latest.staleTabs.filter(value => value !== tabId),
      loadingTab: '',
    });
  } catch (error) {
    const classification = classifyDetailError(error);
    if (classification.kind === 'aborted' || !runtime || currentState(context).requestVersion !== version) {
      return currentState(context);
    }
    const latest = currentState(context);
    const staleTabs = classification.kind === 'stale' || latest.dataByTab[tabId] !== undefined
      ? [...new Set([...latest.staleTabs, tabId])]
      : latest.staleTabs;
    return commit(context, {
      errorByTab: {
        ...latest.errorByTab,
        [tabId]: {
          ...classification,
          message: error?.message || '客户详情加载失败',
          dependency: error?.dependency || '',
        },
      },
      staleTabs,
      loadingTab: '',
    });
  } finally {
    if (runtime?.controller === controller) runtime.controller = null;
    paint(context);
    if (restoreTabFocus) focusDetailTab(context, tabId);
  }
}

export async function load(context) {
  abortActiveRequest();
  const detail = resolveCustomerDetailContext(context.route);
  runtime = { context, controller: null, bound: false };
  commit(context, emptyState(detail));
  if (!detail.customerId) {
    return commit(context, {
      errorByTab: {
        overview: { kind: 'not-found', retryable: false, message: '缺少客户 ID' },
      },
    });
  }
  return loadActiveTab(context);
}

function paint(context) {
  if (!context?.mount) return '';
  const state = currentState(context);
  const output = renderCustomerDetailView(state, {
    presentation: state.presentation,
    canViewContacts: Boolean(context.access.permissions?.view_contacts),
  });
  context.mount.innerHTML = output;
  return output;
}

function bind(context) {
  if (!runtime || runtime.bound || !context.mount) return;
  runtime.bound = true;
  context.lifecycle.listen(context.mount, 'click', event => {
    const aiAction = event.target.closest('[data-ai-result-action]');
    if (aiAction) {
      void handleAIResultAction(context, aiAction);
      return;
    }
    const tab = event.target.closest('[data-customer-detail-tab]');
    if (tab) {
      const tabId = normalizeCustomerDetailTab(tab.dataset.customerDetailTab);
      if (tabId === currentState(context).activeTab) return;
      if (globalThis.location && globalThis.history?.replaceState) {
        const url = new URL(globalThis.location.href);
        url.searchParams.set('tab', tabId);
        globalThis.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
      abortActiveRequest();
      commit(context, { activeTab: tabId, loadingTab: '' });
      paint(context);
      focusDetailTab(context, tabId);
      void loadActiveTab(context, { restoreTabFocus: true });
      return;
    }
    const back = event.target.closest('[data-customer-detail-back]');
    if (back && context.navigate) {
      event.preventDefault();
      context.navigate(currentState(context).returnSource || 'customers');
      return;
    }
    if (event.target.closest('[data-customer-detail-retry]')) {
      void loadActiveTab(context, { force: true });
      return;
    }
    if (event.target.closest('[data-customer-detail-close]')) {
      abortActiveRequest();
      context.onClose?.({
        customerId: currentState(context).customerId,
        returnHref: currentState(context).returnHref,
      });
    }
  });
  context.lifecycle.listen(context.mount, 'keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (!event.target.closest('[data-customer-detail-tab]')) return;
    event.preventDefault();
    const current = CUSTOMER_DETAIL_TABS.findIndex(tab => tab.id === currentState(context).activeTab);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const next = CUSTOMER_DETAIL_TABS[(current + direction + CUSTOMER_DETAIL_TABS.length) % CUSTOMER_DETAIL_TABS.length];
    context.mount.querySelector(`[data-customer-detail-tab="${next.id}"]`)?.click();
  });
}

function aiEntry(state, capability) {
  const payload = state.dataByTab.ai?.results || {};
  if (capability === 'customer_fit') return { job: payload.job, result: payload.result };
  if (capability === 'sales_pack') return payload.salesPack || {};
  if (capability === 'next_action') return payload.nextAction || {};
  return {};
}

async function handleAIResultAction(context, button) {
  const action = button.dataset.aiResultAction;
  const article = button.closest('[data-capability]');
  const capability = article?.dataset.capability || '';
  if (action === 'view_evidence') {
    article?.querySelector('[data-ai-layer="facts"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (action === 'close') {
    if (article) article.hidden = true;
    return;
  }
  const state = currentState(context);
  const entry = aiEntry(state, capability);
  try {
    if (action === 'regenerate') {
      if (capability === 'customer_fit') {
        await context.services.ai.runCustomerFit(state.customerId, { signal: context.lifecycle.signal });
      } else if (capability === 'sales_pack') {
        await context.services.ai.runSalesPack(state.customerId, { signal: context.lifecycle.signal });
      } else if (entry.job?.id) {
        await context.services.ai.retryJob(entry.job.id, { signal: context.lifecycle.signal });
      }
    } else if (action === 'copy' && capability === 'sales_pack') {
      const draft = entry.result?.value?.draft || {};
      await globalThis.navigator?.clipboard?.writeText?.(
        [draft.subject, draft.body].filter(Boolean).join('\n\n'),
      );
    } else if (['adopt', 'edit_adopt'].includes(action) && capability === 'next_action') {
      const value = entry.result?.value || {};
      const nextAction = action === 'edit_adopt'
        ? String(globalThis.prompt?.('确认下一步内容', value.nextAction || '') || '').trim()
        : value.nextAction;
      if (!nextAction || !entry.job?.id) return;
      await context.services.ai.adoptNextAction(entry.job.id, {
        nextAction,
        nextActionAt: value.nextActionAt || '',
        managerRequired: Boolean(value.managerRequired),
      }, { signal: context.lifecycle.signal });
    } else if (action === 'reject' && entry.job?.id) {
      const summary = String(globalThis.prompt?.('请输入拒绝原因', '') || '').trim();
      await context.services.ai.jobAction(entry.job.id, 'review', {
        decision: 'rejected',
        summary,
      }, { signal: context.lifecycle.signal });
    } else if (action === 'review' && context.access.permissions?.review_ai_tasks) {
      context.navigate?.('ai-control');
      return;
    } else {
      return;
    }
    commit(context, {
      staleTabs: [...new Set([...currentState(context).staleTabs, 'ai'])],
    });
    await loadActiveTab(context, { force: true });
  } catch (error) {
    const latest = currentState(context);
    commit(context, {
      errorByTab: {
        ...latest.errorByTab,
        ai: {
          ...classifyDetailError(error),
          message: error?.message || 'AI 操作失败',
        },
      },
    });
    paint(context);
  }
}

export function render(context = {}) {
  if (!runtime) runtime = { context, controller: null, bound: false };
  const output = paint(context);
  bind(context);
  return output;
}

export function dispose() {
  abortActiveRequest();
  runtime = null;
}
