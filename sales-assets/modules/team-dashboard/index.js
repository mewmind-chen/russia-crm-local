import { escapeHtml } from '../../components/html.js';
import { renderEmptyState } from '../../components/empty-state.js';

export const id = 'team-dashboard';

let runtime = null;

function stopRuntime() {
  if (!runtime) return;
  runtime.controller?.abort();
  if (runtime.timer !== null) clearTimeout(runtime.timer);
  runtime = null;
}

function schedule(context) {
  const delay = Number(context.pollIntervalMs ?? 60000);
  if (!runtime || !Number.isFinite(delay) || delay <= 0) return;
  runtime.timer = setTimeout(async () => {
    try {
      const next = await context.services.session.bootstrap(
        ['today', 'customers', 'team'],
        { signal: runtime?.controller?.signal },
      );
      context.onRefresh?.(buildDashboard(next));
    } catch (error) {
      if (error?.name !== 'AbortError') context.onRefreshError?.(error);
    } finally {
      if (runtime) schedule(context);
    }
  }, delay);
  runtime.timer.unref?.();
}

export function buildDashboard(payload = {}) {
  const summary = payload.summary || {};
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
  const funnel = Array.isArray(payload.funnel) ? payload.funnel : [];
  const activities = Array.isArray(payload.activities) ? payload.activities : [];
  const rfqCount = Number(summary.rfqs || 0);
  const orderCount = Number(summary.orders || 0);
  return {
    summary,
    accounts,
    alerts,
    funnel,
    activities: activities.slice(0, 8),
    orderRate: rfqCount > 0 ? `${Math.round(orderCount / rfqCount * 100)}%` : '暂无样本',
  };
}

export async function load(context) {
  stopRuntime();
  const controller = context.lifecycle?.createAbortController?.() || new AbortController();
  runtime = { controller, timer: null };
  const payload = await context.services.session.bootstrap(
    ['today', 'customers', 'team'],
    { signal: controller.signal },
  );
  schedule(context);
  return buildDashboard(payload);
}

export function render({ mount, data = {} } = {}) {
  const summary = data.summary || {};
  const alerts = data.alerts || [];
  const funnel = data.funnel || [];
  const activities = data.activities || [];
  const output = `<div class="role-home manager-home">
    <div class="section-intro"><div><p class="eyebrow">经营概览</p><h2>经营驾驶舱</h2></div></div>
    <div class="metric-grid">
      <article class="metric"><span>客户总量</span><strong>${Number(summary.accounts || 0)}</strong></article>
      <article class="metric"><span>活跃客户</span><strong>${Number(summary.active || 0)}</strong></article>
      <article class="metric"><span>今日异常</span><strong>${alerts.length}</strong></article>
      <article class="metric"><span>订单转化</span><strong>${escapeHtml(data.orderRate || '暂无样本')}</strong></article>
    </div>
    <div class="dashboard-grid">
      <article class="panel span-7"><div class="panel-head"><h2>累计漏斗</h2></div>${funnel.length
        ? `<ol class="funnel-chart">${funnel.map(item => `<li><span>${escapeHtml(item.label)}</span><strong>${Number(item.count || 0)}</strong></li>`).join('')}</ol>`
        : renderEmptyState({ title: '暂无漏斗样本' })}</article>
      <article class="panel span-5"><div class="panel-head"><h2>需要处理</h2></div>${alerts.length
        ? `<ul class="attention-list">${alerts.slice(0, 8).map(item => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.companyName || '')}</span></li>`).join('')}</ul>`
        : renderEmptyState({ title: '当前没有待处理异常' })}</article>
      <article class="panel span-12"><div class="panel-head"><h2>最新有效动作</h2></div>${activities.length
        ? `<ul class="activity-feed">${activities.map(item => `<li><strong>${escapeHtml(item.company_name || item.customer_id || '客户')}</strong><span>${escapeHtml(item.summary || item.activity_type || '')}</span><small>${escapeHtml(item.occurred_at || '')}</small></li>`).join('')}</ul>`
        : renderEmptyState({ title: '暂无动作记录' })}</article>
    </div>
  </div>`;
  if (mount) mount.innerHTML = output;
  return output;
}

export function dispose() {
  stopRuntime();
}
