import { escapeAttribute, escapeHtml } from '../../components/html.js';
import { renderAIResult } from '../../components/ai-result.js';
import { renderEmptyState } from '../../components/empty-state.js';

export const id = 'team-insights';

let current = null;

function forbidden(access) {
  return !['admin', 'manager'].includes(access?.role)
    || !['view_team', 'view_insights', 'view_markets'].every(key => access?.permissions?.[key]);
}

function errorState(error) {
  return {
    state: error?.status === 403 ? 'forbidden' : 'error',
    message: error?.message || '团队洞察加载失败',
  };
}

export async function load(context) {
  context.mount.innerHTML = '<div class="empty-state" role="status"><strong>正在加载团队洞察…</strong></div>';
  if (forbidden(context.access)) return { state: 'forbidden' };
  try {
    const controller = context.lifecycle.createAbortController();
    const [payload, coaching] = await Promise.all([
      context.services.session.bootstrap(['core', 'team', 'intelligence'], {
        signal: controller.signal,
        timeoutMs: 15000,
      }),
      context.access.featureFlags?.aiStations
        ? context.services.ai.salesCoaching({ signal: controller.signal, timeoutMs: 12000 })
          .catch(error => ({ error }))
        : Promise.resolve({ items: [] }),
    ]);
    return {
      state: 'ready',
      payload,
      coaching: coaching.items || [],
      coachingError: coaching.error?.message || '',
      selectedUserId: '',
    };
  } catch (error) {
    return errorState(error);
  }
}

function percent(value) {
  const number = Number(value || 0);
  return `${Number.isFinite(number) ? number.toFixed(1) : '0.0'}%`;
}

function deterministicCard(item) {
  const scores = Object.entries(item.scores || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return `<button class="team-card" type="button" data-team-user="${escapeAttribute(item.user?.id || '')}">
    <div class="team-card-top">
      <div class="person"><span class="avatar">${escapeHtml((item.user?.name || '?').slice(0, 1))}</span>
        <div><strong>${escapeHtml(item.user?.name || '未命名成员')}</strong>
        <small>${escapeHtml((item.bestCountries || []).join(' / ') || '待积累国家数据')}</small></div>
      </div>
      <strong>${Number(item.overall || 0)}</strong>
    </div>
    <div class="capability-bars">${scores.map(([key, value]) =>
      `<div class="cap-row"><span>${escapeHtml(key)}</span><progress max="100" value="${Number(value || 0)}"></progress><b>${Number(value || 0)}</b></div>`).join('')}</div>
    <small>样本 ${Number(item.sampleSize || 0)} · ${escapeHtml(item.sampleStatus || '待积累')}</small>
  </button>`;
}

function coachingBlock(data, item) {
  const coaching = data.coaching.find(row => row.salesUserId === item.user?.id);
  const snapshot = coaching?.snapshot || {};
  const sampleSize = Number(snapshot.sampleSize ?? item.sampleSize ?? 0);
  const sampleStatus = snapshot.sampleStatus
    || (sampleSize < 10 ? 'insufficient' : sampleSize < 30 ? 'limited' : 'sufficient');
  const value = coaching?.ai?.stale ? null : coaching?.ai?.result?.value;
  if (coaching?.ai?.presentation) {
    return renderAIResult(coaching.ai.presentation, {
      view_evidence() {},
      regenerate() {},
      review() {},
      close() {},
    });
  }
  if (value) {
    return `<div class="coaching-output">
      <strong>AI 辅导建议</strong>
      <p>${escapeHtml((value.recommendations || []).join('；') || '暂无建议')}</p>
      <small>基于 ${sampleSize} 个已观察客户，需经理复核后使用。</small>
    </div>`;
  }
  if (sampleStatus === 'insufficient') {
    return `<div class="empty-state"><strong>样本不足（${sampleSize}/10）</strong><p>不调用模型，继续积累确定性业务样本。</p></div>`;
  }
  return `<div class="empty-state"><strong>尚无 AI 辅导</strong><p>${escapeHtml(data.coachingError || '确定性指标不受影响。')}</p></div>`;
}

function selectedDetail(data) {
  const item = data.payload.teamReport?.find(row => row.user?.id === data.selectedUserId);
  if (!item) return '';
  return `<section class="workspace-section" data-section="team-detail">
    <div class="panel-head"><div><p class="eyebrow">确定性指标检视</p><h2>${escapeHtml(item.user?.name)} · 团队检视</h2></div></div>
    <div class="metric-grid">
      <article class="metric"><span>资源激活率</span><strong>${percent(item.rates?.activation)}</strong></article>
      <article class="metric"><span>有效回复率</span><strong>${percent(item.rates?.reply)}</strong></article>
      <article class="metric"><span>会议转询价</span><strong>${percent(item.rates?.rfq)}</strong></article>
      <article class="metric"><span>询价转首单</span><strong>${percent(item.rates?.order)}</strong></article>
    </div>
    <div class="recommendation"><strong>确定性分配依据</strong><p>优势国家：${escapeHtml((item.bestCountries || []).join('、') || '待积累')}；优势渠道：${escapeHtml((item.bestChannels || []).join('、') || '待积累')}。</p></div>
    <section data-section="ai-coaching"><p class="eyebrow">AI 辅导 · 位于确定性指标之后</p>${coachingBlock(data, item)}</section>
  </section>`;
}

function content(data) {
  const rows = data.payload.teamReport || [];
  if (!rows.length) return renderEmptyState({
    title: '暂无团队样本',
    description: '当前行级范围内没有可汇总的销售数据。',
  });
  const countries = data.payload.countryReport || [];
  return `<div class="module-workspace" data-module="${id}">
    <header class="workspace-header"><div><p class="eyebrow">团队洞察</p><h1>团队洞察</h1>
      <p>指标仅来自当前管理范围，确定性业务数据优先于 AI 辅导。</p></div></header>
    <section class="workspace-section" data-section="deterministic-metrics">
      <div class="panel-head"><div><h2>确定性团队指标</h2><p>成员能力、漏斗和市场表现</p></div></div>
      <div class="team-grid">${rows.map(deterministicCard).join('')}</div>
      <div class="market-summary">${countries.slice(0, 6).map(row =>
        `<span class="pill">${escapeHtml(row.country || '未标注')} · ${Number(row.accounts || 0)} 客户</span>`).join('')}</div>
    </section>
    ${selectedDetail(data)}
  </div>`;
}

export function render(context) {
  current = { context, data: context.data };
  if (context.data.state === 'forbidden') {
    context.mount.innerHTML = renderEmptyState({ title: '403 无权查看团队洞察', description: '需要团队、洞察和市场查看权限。' });
    return;
  }
  if (context.data.state === 'error') {
    context.mount.innerHTML = renderEmptyState({ title: '团队洞察加载失败', description: context.data.message, actionLabel: '重试', actionId: 'retry-team-insights' });
    return;
  }
  context.mount.innerHTML = content(context.data);
  context.lifecycle.listen(context.mount, 'click', event => {
    const aiAction = event.target.closest?.('[data-ai-result-action]');
    if (aiAction) {
      const action = aiAction.dataset.aiResultAction;
      if (action === 'view_evidence') {
        aiAction.closest('.ai-result')?.querySelector('[data-ai-layer="facts"]')
          ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      } else if (action === 'close') {
        const result = aiAction.closest('.ai-result');
        if (result) result.hidden = true;
      } else if (action === 'review') {
        context.navigate?.('ai-control');
      } else if (action === 'regenerate' && context.data.selectedUserId) {
        void context.services.ai.runSalesCoaching(context.data.selectedUserId, {}, {
          signal: context.lifecycle.signal,
        });
      }
      return;
    }
    const member = event.target.closest?.('[data-team-user]');
    if (!member) return;
    context.data.selectedUserId = member.dataset.teamUser;
    context.mount.innerHTML = content(context.data);
  });
}

export function dispose() {
  current = null;
}
