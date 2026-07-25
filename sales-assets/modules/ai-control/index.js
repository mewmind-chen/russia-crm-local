import { escapeAttribute, escapeHtml } from '../../components/html.js';
import { renderAIResult } from '../../components/ai-result.js';
import { renderEmptyState } from '../../components/empty-state.js';

export const id = 'ai-control';

const TYPE_LABELS = Object.freeze({
  customer_fit: '客户适配判断',
  contact_readiness: '联系人就绪判断',
  distribution_priority: '线索分配优先级',
  sales_match: '销售匹配建议',
  sales_pack: '销售资料包',
  next_action: '下一步建议',
  manager_anomaly: '经理异常解释',
  sales_coaching: '销售辅导建议',
  action_proposal: '活动草稿',
  company_recon: '公司情报补全',
  contact_recon: '联系人情报补全',
  manager_evaluation: '经理评价标注',
  assistant_chat: 'AI 助手对话',
});

let active = null;

function isForbidden(context) {
  return !['admin', 'manager'].includes(context.access?.role)
    || !context.access?.permissions?.review_ai_tasks;
}

function isAdmin(context) {
  return context.access?.role === 'admin' && !context.access?.impersonating;
}

function initialData(context) {
  return {
    state: 'ready',
    page: 1,
    pageSize: 20,
    total: 0,
    items: [],
    overview: null,
    filters: { state: '', type: '', customer: '', search: '' },
    governance: isAdmin(context) ? { metrics: [], strategies: [] } : null,
    selectedTask: null,
    loading: false,
    detailLoading: false,
    notice: '',
    error: '',
  };
}

async function fetchTasks(context, data) {
  data.loading = true;
  data.error = '';
  paint(context, data);
  try {
    const payload = await context.services.ai.listTasks({
      ...data.filters,
      page: data.page,
      pageSize: data.pageSize,
    }, { signal: context.lifecycle.signal, timeoutMs: 15000 });
    Object.assign(data, {
      items: payload.items || [],
      overview: payload.overview || null,
      total: Number(payload.total || 0),
      page: Number(payload.page || data.page),
      pageSize: Number(payload.pageSize || data.pageSize),
    });
  } catch (error) {
    data.error = error?.status === 403 ? '403 当前角色无权查看 AI 运行审计' : (error?.message || 'AI 任务加载失败');
  } finally {
    data.loading = false;
    paint(context, data);
  }
}

async function fetchGovernance(context, data) {
  if (!isAdmin(context)) return;
  try {
    const payload = await context.services.ai.governance({
      signal: context.lifecycle.signal,
      timeoutMs: 15000,
    });
    data.governance = {
      metrics: payload.metrics || [],
      strategies: payload.strategies || [],
    };
  } catch (error) {
    data.error = error?.status === 403
      ? '403 AI 版本治理仅限真实管理员'
      : (error?.message || 'AI 治理数据加载失败');
  }
}

export async function load(context) {
  if (isForbidden(context)) return { state: 'forbidden' };
  const data = initialData(context);
  const [tasks] = await Promise.allSettled([
    context.services.ai.listTasks({
      page: data.page,
      pageSize: data.pageSize,
    }, { signal: context.lifecycle.signal, timeoutMs: 15000 }),
    fetchGovernance(context, data),
  ]);
  if (tasks.status === 'rejected') {
    return {
      ...data,
      state: tasks.reason?.status === 403 ? 'forbidden' : 'error',
      error: tasks.reason?.message || 'AI 运行审计加载失败',
    };
  }
  Object.assign(data, {
    items: tasks.value.items || [],
    overview: tasks.value.overview || null,
    total: Number(tasks.value.total || 0),
    page: Number(tasks.value.page || 1),
    pageSize: Number(tasks.value.pageSize || 20),
  });
  return data;
}

function statusLabel(value) {
  return {
    queued: '排队中',
    running: '执行中',
    succeeded: '已完成',
    needs_review: '待复核',
    failed: '执行失败',
    retry_wait: '等待重试',
    blocked: '已阻断',
    cancelled: '已取消',
    dead_letter: '已停止重试',
  }[value] || value || '未知';
}

function sourceLabel(value) {
  return {
    manual: '人工发起',
    business_event: '业务事件触发',
    workflow: '受控工作流触发',
    schedule: '定时规则触发',
    api: '接口触发',
    migration: '数据迁移触发',
    release_validation: '上线验收触发',
    legacy_unknown: '来源未记录',
  }[value] || '来源未记录';
}

function overview(data) {
  if (!data.overview) return '';
  const queue = data.overview.queue || {};
  return `<section class="metric-grid" data-ai-admin-overview>
    <article class="metric"><span>排队任务</span><strong>${Number(queue.queued || 0) + Number(queue.retry_wait || 0)}</strong></article>
    <article class="metric"><span>执行任务</span><strong>${Number(queue.running || 0)}</strong></article>
    <article class="metric"><span>24 小时失败率</span><strong>${Math.round(Number(data.overview.failureRate24h || 0) * 100)}%</strong></article>
    <article class="metric"><span>今日模型成本</span><strong>$${Number(data.overview.dailyCost || 0).toFixed(4)}</strong></article>
  </section>`;
}

function taskTable(data) {
  if (data.loading && !data.items.length) return renderEmptyState({ title: '正在加载 AI 运行记录…' });
  if (!data.items.length) return renderEmptyState({
    title: '没有符合条件的运行记录',
    description: '调整筛选条件后重试。',
  });
  return `<div class="table-scroll"><table><thead><tr>
    <th>任务</th><th>业务能力</th><th>客户</th><th>触发来源</th><th>状态</th><th>创建时间</th><th>操作</th>
  </tr></thead><tbody>${data.items.map(item => `<tr>
    <td><strong>${escapeHtml(item.taskId)}</strong><small>${escapeHtml(item.source || '')}</small></td>
    <td>${escapeHtml(TYPE_LABELS[item.taskType] || item.taskType || '未知能力')}</td>
    <td>${escapeHtml(item.customerName || item.customerId || '工作区')}</td>
    <td>${escapeHtml(sourceLabel(item.trigger?.source))}</td>
    <td><span class="pill">${escapeHtml(statusLabel(item.state))}</span></td>
    <td>${escapeHtml(item.createdAt || '未记录')}</td>
    <td><button class="button secondary" type="button" data-ai-task-detail="${escapeAttribute(item.taskId)}">查看详情</button></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function trace(task) {
  const value = task.decisionTrace;
  if (!value) return '';
  return `<section class="workspace-section"><h3>决策版本与证据</h3>
    <div class="detail-grid">
      <div><span>工作站版本</span><strong>${escapeHtml(value.stationVersion || '未记录')}</strong></div>
      <div><span>模型</span><strong>${escapeHtml(value.model || '未记录')}</strong></div>
      <div><span>Prompt 版本</span><strong>${escapeHtml(value.promptVersion || '未记录')}</strong></div>
      <div><span>规则版本</span><strong>${escapeHtml(value.ruleVersion || '未记录')}</strong></div>
      <div><span>生成时间</span><strong>${escapeHtml(value.generatedAt || '未记录')}</strong></div>
      <div><span>有效状态</span><strong>${value.stale ? '已过期，不可直接采纳' : '当前有效'}</strong></div>
    </div>
    <p>证据 ID：${escapeHtml((value.evidenceIds || []).join('、') || '未记录')}</p>
    ${value.stale ? `<p class="status-banner warning">${escapeHtml(value.staleReason || '生成后业务事实发生变化')}</p>` : ''}
  </section>`;
}

function taskDetail(task, context) {
  if (!task) return '';
  const attempts = task.attempts || [];
  const timeline = task.timeline || [];
  const admin = isAdmin(context);
  const businessPresentation = task.presentation ? {
    ...task.presentation,
    humanDecision: {
      ...task.presentation.humanDecision,
      actions: task.presentation.humanDecision.actions.map(action => ({
        ...action,
        enabled: ['view_evidence', 'close'].includes(action.id) && action.enabled,
        disabledReason: ['view_evidence', 'close'].includes(action.id)
          ? action.disabledReason
          : '请在对应业务页面完成该动作',
      })),
    },
  } : null;
  return `<aside class="module-detail-panel" data-ai-task-panel>
    <div class="panel-head"><div><p class="eyebrow">运行审计</p><h2>${escapeHtml(TYPE_LABELS[task.taskType] || task.taskType)}</h2></div>
      <button class="icon-button" type="button" data-ai-detail-close aria-label="关闭详情">&times;</button></div>
    <div class="detail-grid">
      <div><span>任务 ID</span><strong>${escapeHtml(task.taskId)}</strong></div>
      <div><span>客户</span><strong>${escapeHtml(task.customerId || '工作区')}</strong></div>
      <div><span>状态</span><strong>${escapeHtml(statusLabel(task.state))}</strong></div>
      <div><span>触发来源</span><strong>${escapeHtml(sourceLabel(task.trigger?.source))}</strong></div>
    </div>
    ${task.errorSummary ? `<div class="status-banner error">${escapeHtml(task.errorSummary)}</div>` : ''}
    ${businessPresentation ? renderAIResult(businessPresentation, { view_evidence() {}, close() {} }) : ''}
    ${admin ? trace(task) : ''}
    ${admin ? `<section class="workspace-section"><h3>模型尝试</h3>${attempts.length
      ? `<ul class="attention-list">${attempts.map(item => `<li><strong>第 ${Number(item.attempt || 0)} 次 · ${escapeHtml(item.engine || '未知引擎')}</strong><span>${escapeHtml(item.status || '')} · ${Number(item.durationMs || 0)} ms</span></li>`).join('')}</ul>`
      : renderEmptyState({ title: '没有模型尝试记录' })}</section>` : ''}
    <section class="workspace-section"><h3>运行时间线</h3>${timeline.length
      ? `<ul class="attention-list">${timeline.map(item => `<li><strong>${escapeHtml(item.kind || '事件')}</strong><span>${escapeHtml(item.state || '')}</span><small>${escapeHtml(item.at || '')}</small></li>`).join('')}</ul>`
      : renderEmptyState({ title: '没有时间线记录' })}</section>
    <div class="top-actions">
      ${task.canRetry ? `<button class="button secondary" data-ai-task-action="retry" data-job-id="${escapeAttribute(task.taskId)}">重试</button>` : ''}
      ${task.canCancel && context.access.permissions?.cancel_ai_tasks ? `<button class="button secondary" data-ai-task-action="cancel" data-job-id="${escapeAttribute(task.taskId)}">取消</button>` : ''}
      ${task.canReview ? `<button class="button primary" data-ai-task-action="approved" data-job-id="${escapeAttribute(task.taskId)}">通过复核</button>
        <button class="button secondary" data-ai-task-action="rejected" data-job-id="${escapeAttribute(task.taskId)}">退回复核</button>` : ''}
    </div>
  </aside>`;
}

function governance(data) {
  const value = data.governance || { metrics: [], strategies: [] };
  return `<section class="workspace-section" data-ai-governance>
    <div class="panel-head"><div><h2>AI 版本治理</h2><p>仅真实管理员可创建、批准和回滚离线策略版本。</p></div>
      <button class="button primary" type="button" data-governance-create>新建影子版本</button></div>
    <div class="metric-grid">
      <article class="metric"><span>反馈指标组</span><strong>${value.metrics.length}</strong></article>
      <article class="metric"><span>策略版本</span><strong>${value.strategies.length}</strong></article>
    </div>
    ${value.strategies.length ? `<div class="table-scroll"><table><thead><tr>
      <th>策略</th><th>工作站</th><th>版本</th><th>状态</th><th>影子样本</th><th>操作</th>
    </tr></thead><tbody>${value.strategies.map(item => `<tr>
      <td>${escapeHtml(item.strategyKey)}</td><td>${escapeHtml(TYPE_LABELS[item.station] || item.station)}</td>
      <td>${escapeHtml(item.version)}</td><td>${escapeHtml(item.status)}</td><td>${Number(item.evaluationCount || 0)}</td>
      <td>${item.status === 'shadow' ? `<button class="text-button" data-governance-evaluate="${escapeAttribute(item.id)}">记录影子结果</button>` : ''}
        ${item.status === 'shadow' && item.evaluationCount > 0 ? `<button class="text-button" data-governance-action="request-publish" data-strategy-id="${escapeAttribute(item.id)}">申请发布</button>` : ''}
        ${item.status === 'pending_approval' ? `<button class="text-button" data-governance-action="approve" data-strategy-id="${escapeAttribute(item.id)}">批准</button>` : ''}
        ${item.status === 'retired' ? `<button class="text-button" data-governance-action="rollback" data-strategy-id="${escapeAttribute(item.id)}">回滚</button>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>` : renderEmptyState({ title: '暂无策略版本' })}
  </section>`;
}

function content(context, data) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return `<div class="module-workspace" data-module="${id}">
    <header class="workspace-header"><div><p class="eyebrow">AI 运行管理</p><h1>AI 运行审计</h1>
      <p>${isAdmin(context) ? '全局运行、成本、复核与版本治理。' : '仅显示授权客户范围内需要复核或排障的运行记录。'}</p></div></header>
    ${data.notice ? `<div class="status-banner">${escapeHtml(data.notice)}</div>` : ''}
    ${data.error ? `<div class="status-banner error">${escapeHtml(data.error)}</div>` : ''}
    ${isAdmin(context) ? overview(data) : ''}
    <section class="workspace-section">
      <form class="workspace-toolbar" data-ai-task-filter>
        <input name="search" value="${escapeAttribute(data.filters.search)}" placeholder="${isAdmin(context) ? '搜索任务、客户或模型' : '搜索任务或客户'}">
        <select name="state"><option value="">全部状态</option>${['queued', 'running', 'needs_review', 'succeeded', 'failed', 'blocked', 'cancelled'].map(value =>
          `<option value="${value}"${data.filters.state === value ? ' selected' : ''}>${statusLabel(value)}</option>`).join('')}</select>
        <input name="type" value="${escapeAttribute(data.filters.type)}" placeholder="能力标识">
        <input name="customer" value="${escapeAttribute(data.filters.customer)}" placeholder="客户 ID">
        <button class="button secondary" type="submit">筛选</button>
      </form>
      ${taskTable(data)}
      <div class="pagination"><span>第 ${data.page} / ${pages} 页 · 共 ${data.total} 项</span>
        <button class="button secondary" data-ai-page="${data.page - 1}"${data.page <= 1 ? ' disabled' : ''}>上一页</button>
        <button class="button secondary" data-ai-page="${data.page + 1}"${data.page >= pages ? ' disabled' : ''}>下一页</button></div>
    </section>
    ${isAdmin(context) ? governance(data) : ''}
    ${taskDetail(data.selectedTask, context)}
  </div>`;
}

function paint(context, data) {
  if (!context.mount || context.lifecycle.disposed) return;
  context.mount.innerHTML = content(context, data);
}

async function openTask(context, data, taskId) {
  data.detailLoading = true;
  try {
    const payload = await context.services.ai.getTask(taskId, {
      signal: context.lifecycle.signal,
      timeoutMs: 15000,
    });
    data.selectedTask = payload.task || null;
  } catch (error) {
    data.error = error?.status === 403 ? '403 无权查看该任务详情' : error.message;
  } finally {
    data.detailLoading = false;
    paint(context, data);
  }
}

async function taskAction(context, data, action, jobId) {
  try {
    if (action === 'retry') {
      await context.services.ai.retryJob(jobId, { signal: context.lifecycle.signal });
    } else if (action === 'cancel') {
      if (!globalThis.confirm?.('确认取消该任务？')) return;
      await context.services.ai.jobAction(jobId, 'cancel', {}, { signal: context.lifecycle.signal });
    } else {
      const summary = String(globalThis.prompt?.('请输入复核说明', '') || '').trim();
      await context.services.ai.jobAction(jobId, 'review', {
        decision: action,
        summary,
      }, { signal: context.lifecycle.signal });
    }
    data.notice = '任务操作已由服务器确认';
    data.selectedTask = null;
    await fetchTasks(context, data);
  } catch (error) {
    data.error = error?.status === 403 ? '403 当前身份无权执行该操作' : error.message;
    paint(context, data);
  }
}

async function governanceAction(context, data, action, strategyId) {
  try {
    if (action === 'create') {
      const strategyKey = String(globalThis.prompt?.('策略键') || '').trim();
      if (!strategyKey) return;
      const version = String(globalThis.prompt?.('版本') || '').trim();
      const station = String(globalThis.prompt?.('工作站标识', 'customer_fit') || '').trim();
      await context.services.ai.createStrategy({
        strategyKey,
        version,
        station,
        model: String(globalThis.prompt?.('模型', 'qwen3.7-flash') || '').trim(),
        promptVersion: 'v1',
        ruleVersion: 'v1',
        config: {},
      });
    } else if (action === 'evaluate') {
      const outcome = String(globalThis.prompt?.('对照结果：better / same / worse / inconclusive', 'inconclusive') || '').trim();
      await context.services.ai.evaluateStrategy(strategyId, { outcome, metrics: {} });
    } else {
      await context.services.ai.strategyAction(strategyId, action, {});
    }
    await fetchGovernance(context, data);
    data.notice = '治理操作已记录';
  } catch (error) {
    data.error = error?.status === 403 ? '403 AI 治理仅限真实管理员' : error.message;
  }
  paint(context, data);
}

export function render(context) {
  active = { context, data: context.data };
  if (context.data.state === 'forbidden') {
    context.mount.innerHTML = renderEmptyState({
      title: '403 无权查看 AI 运行审计',
      description: '销售不访问技术任务中心；经理需要 AI 任务复核权限。',
    });
    return;
  }
  if (context.data.state === 'error') {
    context.mount.innerHTML = renderEmptyState({
      title: 'AI 运行审计加载失败',
      description: context.data.error,
      actionLabel: '重试',
      actionId: 'retry-ai-control',
    });
    return;
  }
  paint(context, context.data);
  context.lifecycle.listen(context.mount, 'submit', event => {
    if (!event.target.matches('[data-ai-task-filter]')) return;
    event.preventDefault();
    context.data.filters = Object.fromEntries(new FormData(event.target));
    context.data.page = 1;
    void fetchTasks(context, context.data);
  });
  context.lifecycle.listen(context.mount, 'click', event => {
    const resultAction = event.target.closest('[data-ai-result-action]');
    if (resultAction) {
      const result = resultAction.closest('.ai-result');
      if (resultAction.dataset.aiResultAction === 'view_evidence') {
        result?.querySelector('[data-ai-layer="facts"]')
          ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      } else if (resultAction.dataset.aiResultAction === 'close' && result) {
        result.hidden = true;
      }
      return;
    }
    const detail = event.target.closest('[data-ai-task-detail]');
    if (detail) return void openTask(context, context.data, detail.dataset.aiTaskDetail);
    if (event.target.closest('[data-ai-detail-close]')) {
      context.data.selectedTask = null;
      return paint(context, context.data);
    }
    const page = event.target.closest('[data-ai-page]');
    if (page) {
      context.data.page = Number(page.dataset.aiPage);
      return void fetchTasks(context, context.data);
    }
    const task = event.target.closest('[data-ai-task-action]');
    if (task) return void taskAction(context, context.data, task.dataset.aiTaskAction, task.dataset.jobId);
    if (event.target.closest('[data-governance-create]')) {
      return void governanceAction(context, context.data, 'create', '');
    }
    const evaluate = event.target.closest('[data-governance-evaluate]');
    if (evaluate) return void governanceAction(context, context.data, 'evaluate', evaluate.dataset.governanceEvaluate);
    const action = event.target.closest('[data-governance-action]');
    if (action) return void governanceAction(context, context.data, action.dataset.governanceAction, action.dataset.strategyId);
    if (event.target.closest('[data-action="retry-ai-control"]')) void fetchTasks(context, context.data);
  });
}

export function dispose() {
  active = null;
}
