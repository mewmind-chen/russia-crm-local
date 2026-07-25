import { escapeHtml } from '../../components/html.js';
import { renderEmptyState } from '../../components/empty-state.js';

export const id = 'team-tasks';

let runtime = null;

function stopRuntime() {
  if (!runtime) return;
  runtime.controller?.abort();
  if (runtime.timer !== null) clearTimeout(runtime.timer);
  runtime = null;
}

async function fetchData(context, signal) {
  const payload = await context.services.session.bootstrap(
    ['today', 'customers'],
    { signal },
  );
  let anomalies = [];
  const canReview = Boolean(context.access?.permissions?.review_ai_tasks);
  if (context.access?.featureFlags?.aiStations && canReview) {
    try {
      anomalies = (await context.services.ai.managerAnomalies({ signal })).anomalies || [];
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
    }
  }
  return buildTeamTasks(payload, anomalies);
}

function schedule(context) {
  const delay = Number(context.pollIntervalMs ?? 45000);
  if (!runtime || !Number.isFinite(delay) || delay <= 0) return;
  runtime.timer = setTimeout(async () => {
    try {
      context.onRefresh?.(await fetchData(context, runtime?.controller?.signal));
    } catch (error) {
      if (error?.name !== 'AbortError') context.onRefreshError?.(error);
    } finally {
      if (runtime) schedule(context);
    }
  }, delay);
  runtime.timer.unref?.();
}

export function buildTeamTasks(payload = {}, anomalies = []) {
  const ruleTasks = (Array.isArray(payload.alerts) ? payload.alerts : []).map(item => ({
    id: item.id,
    severity: item.severity,
    title: item.title,
    detail: item.detail,
    action: item.action,
    companyName: item.companyName,
    customerId: item.customerId,
  }));
  const aiAdvisories = (Array.isArray(anomalies) ? anomalies : [])
    .filter(item => item.ai?.result?.value && !item.ai?.stale)
    .map(item => ({
      id: item.id,
      customerId: item.customerId,
      companyName: item.companyName,
      explanation: item.ai.result.value.explanation,
      suggestion: item.ai.result.value.interventionSuggestion,
    }));
  return { formalTasks: ruleTasks, ruleTasks, aiAdvisories };
}

export async function load(context) {
  stopRuntime();
  const controller = context.lifecycle?.createAbortController?.() || new AbortController();
  runtime = { controller, timer: null };
  const data = await fetchData(context, controller.signal);
  schedule(context);
  return data;
}

export function render({ mount, data = {} } = {}) {
  const ruleTasks = data.ruleTasks || [];
  const aiAdvisories = data.aiAdvisories || [];
  const output = `<div class="role-home manager-tasks">
    <div class="section-intro"><div><p class="eyebrow">TODAY ACTIONS</p><h2>今日待办</h2><p>规则异常优先，经理确认后再执行介入动作。</p></div></div>
    <div class="metric-grid">
      <article class="metric"><span>正式待办</span><strong>${ruleTasks.length}</strong></article>
      <article class="metric"><span>辅助解释</span><strong>${aiAdvisories.length}</strong></article>
    </div>
    <article class="panel"><div class="panel-head"><h2>规则异常 · 正式待办</h2></div>${ruleTasks.length
      ? `<ul class="attention-list">${ruleTasks.map(item => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.companyName || '')}</span><p>${escapeHtml(item.detail || '')}</p><small>${escapeHtml(item.action || '')}</small></li>`).join('')}</ul>`
      : renderEmptyState({ title: '当前没有规则异常' })}</article>
    <article class="panel"><div class="panel-head"><h2>AI 解释与介入建议</h2></div><p class="subtle">建议仅供复核，未采纳前不计入正式待办，也不会改变客户状态或负责人。</p>${aiAdvisories.length
      ? `<ul class="attention-list">${aiAdvisories.map(item => `<li><strong>${escapeHtml(item.companyName || '客户')}</strong><p>${escapeHtml(item.explanation)}</p><small>${escapeHtml(item.suggestion)}</small></li>`).join('')}</ul>`
      : renderEmptyState({ title: '当前没有可复核建议' })}</article>
  </div>`;
  if (mount) mount.innerHTML = output;
  return output;
}

export function dispose() {
  stopRuntime();
}
