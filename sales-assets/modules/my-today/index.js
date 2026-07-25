import { escapeHtml } from '../../components/html.js';
import { renderEmptyState } from '../../components/empty-state.js';

export const id = 'my-today';

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
        ['today', 'customers', 'intake'],
        { signal: runtime?.controller?.signal },
      );
      context.onRefresh?.(selectMyTodayItems(next));
    } catch (error) {
      if (error?.name !== 'AbortError') context.onRefreshError?.(error);
    } finally {
      if (runtime) schedule(context);
    }
  }, delay);
  runtime.timer.unref?.();
}

export function selectMyTodayItems(payload = {}) {
  const userId = payload.user?.id || '';
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const intakeItems = Array.isArray(payload.intake?.items) ? payload.intake.items : [];
  const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
  const notifications = Array.isArray(payload.notifications) ? payload.notifications : [];
  const closedStages = new Set(['won', 'repeat', 'lost']);
  const dueByEndOfToday = new Date();
  dueByEndOfToday.setHours(23, 59, 59, 999);

  const claims = intakeItems.filter(item =>
    item.status === 'assigned'
    && (!userId || (item.assigned_owner_id || item.assignedOwnerId) === userId));
  const formalTasks = accounts.filter(account => {
    if (!account.next_action || closedStages.has(account.stage)) return false;
    if (!account.next_action_at) return true;
    const dueAt = new Date(String(account.next_action_at).replace(' ', 'T') + 'Z');
    return !Number.isNaN(dueAt.getTime()) && dueAt <= dueByEndOfToday;
  }).map(account => ({
    id: account.id,
    companyName: account.company_name,
    action: account.next_action,
    dueAt: account.next_action_at,
  }));
  const aiSuggestions = notifications.filter(item =>
    item.status === 'unread'
    && (!userId || item.user_id === userId)
    && /AI|NEXT_ACTION|PROPOSAL|REVIEW/i.test(`${item.code || ''}`));

  return { claims, alerts, formalTasks, aiSuggestions };
}

export async function load(context) {
  stopRuntime();
  const controller = context.lifecycle?.createAbortController?.() || new AbortController();
  runtime = { controller, timer: null };
  const payload = await context.services.session.bootstrap(
    ['today', 'customers', 'intake'],
    { signal: controller.signal },
  );
  schedule(context);
  return selectMyTodayItems(payload);
}

function list(items, renderItem, emptyTitle) {
  return items.length
    ? `<ul class="attention-list">${items.map(renderItem).join('')}</ul>`
    : renderEmptyState({ title: emptyTitle });
}

export function render({ mount, data = {} } = {}) {
  const claims = data.claims || [];
  const alerts = data.alerts || [];
  const formalTasks = data.formalTasks || [];
  const aiSuggestions = data.aiSuggestions || [];
  const output = `<div class="role-home sales-home">
    <div class="section-intro"><div><p class="eyebrow">MY DAY</p><h2>我的今日</h2></div></div>
    <div class="metric-grid">
      <article class="metric"><span>待我领取</span><strong>${claims.length}</strong></article>
      <article class="metric"><span>我的预警</span><strong>${alerts.length}</strong></article>
      <article class="metric"><span>正式待办</span><strong>${formalTasks.length}</strong></article>
      <article class="metric"><span>待复核建议</span><strong>${aiSuggestions.length}</strong></article>
    </div>
    <div class="dashboard-grid">
      <article class="panel span-6"><div class="panel-head"><h2>待我领取</h2></div>${list(claims, item =>
        `<li><strong>${escapeHtml(item.company_name || item.companyName)}</strong><span>${escapeHtml(item.claim_due_at || item.claimDueAt || '待确认')}</span></li>`, '当前没有待领取线索')}</article>
      <article class="panel span-6"><div class="panel-head"><h2>我的预警</h2></div>${list(alerts, item =>
        `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.companyName || '')}</span><small>${escapeHtml(item.action || '')}</small></li>`, '当前没有业务预警')}</article>
      <article class="panel span-7"><div class="panel-head"><h2>今天该跟进 · 正式待办</h2></div>${list(formalTasks, item =>
        `<li><strong>${escapeHtml(item.companyName)}</strong><span>${escapeHtml(item.action)}</span><small>${escapeHtml(item.dueAt || '')}</small></li>`, '今天没有已确认的跟进事项')}</article>
      <article class="panel span-5"><div class="panel-head"><h2>待本人复核的建议</h2></div><p class="subtle">尚未采纳的建议不计入正式待办。</p>${list(aiSuggestions, () =>
        '<li><strong>有一条新建议等待复核</strong><span>查看依据后决定是否采纳</span></li>', '当前没有待复核建议')}</article>
    </div>
  </div>`;
  if (mount) mount.innerHTML = output;
  return output;
}

export function dispose() {
  stopRuntime();
}
