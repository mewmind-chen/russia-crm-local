import { escapeAttribute, escapeHtml } from './html.js';

function items(values, empty = '暂无') {
  const rows = Array.isArray(values) ? values.filter(Boolean) : [];
  return rows.length
    ? `<ul>${rows.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
    : `<p class="subtle">${escapeHtml(empty)}</p>`;
}

function coverage(view) {
  const coverageValue = view.inference.coverage;
  return `<div class="ai-result-indicators">
    <div><span>数据覆盖</span><strong>${escapeHtml(coverageValue.label)}</strong>
      ${coverageValue.analyzedLabel ? `<small>已分析 ${escapeHtml(coverageValue.analyzedLabel)}</small>` : ''}
    </div>
    <div><span>AI 置信度</span><strong>${escapeHtml(view.inference.confidence.label)}</strong></div>
  </div>
  ${coverageValue.metrics.length ? `<div class="ai-result-metrics">${coverageValue.metrics.map(metric =>
    `<div><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.displayValue)}</strong></div>`).join('')}</div>` : ''}
  ${coverageValue.coveredFields.length ? `<p><strong>已覆盖：</strong>${escapeHtml(coverageValue.coveredFields.join('、'))}</p>` : ''}
  ${coverageValue.missingFields.length ? `<p><strong>缺失：</strong>${escapeHtml(coverageValue.missingFields.join('、'))}</p>` : ''}
  ${coverageValue.restrictedFields.length ? `<p><strong>受限：</strong>${escapeHtml(coverageValue.restrictedFields.join('、'))}</p>` : ''}`;
}

function trigger(view) {
  const value = view.trigger;
  return `<section class="ai-result-section" data-ai-layer="trigger">
    <h3>为什么出现</h3>
    <p><strong>${escapeHtml(value.label)}</strong>${value.reason ? ` · ${escapeHtml(value.reason)}` : ''}</p>
    ${value.event ? `<p>业务事件：${escapeHtml(value.event)}</p>` : ''}
    ${value.actorId ? `<p>发起人：${escapeHtml(value.actorId)}</p>` : ''}
    ${value.workflowId ? `<p>工作流：${escapeHtml(value.workflowId)}</p>` : ''}
    ${value.triggeredAt ? `<p>触发时间：${escapeHtml(value.triggeredAt)}</p>` : ''}
  </section>`;
}

function facts(view) {
  return `<section class="ai-result-section" data-ai-layer="facts">
    <h3>${escapeHtml(view.facts.title)}</h3>
    <p>依据 ${view.facts.evidenceCount} 条，可查看 ${view.facts.visibleCount} 条。</p>
    ${view.facts.restrictedNotice ? `<p class="status-banner warning">${escapeHtml(view.facts.restrictedNotice)}</p>` : ''}
    ${view.facts.items.length ? `<ol>${view.facts.items.map(item =>
      `<li${item.restricted ? ' data-restricted="true"' : ''}><span>${escapeHtml(item.summary)}</span>
        ${item.updatedAt ? `<small>${escapeHtml(item.updatedAt)}</small>` : ''}
        ${item.sourceUrl ? `<a href="${escapeAttribute(item.sourceUrl)}" target="_blank" rel="noopener">查看来源</a>` : ''}
      </li>`).join('')}</ol>` : '<p class="subtle">暂无可用事实或证据</p>'}
  </section>`;
}

function actions(view, bindings) {
  return `<div class="ai-result-actions">${view.humanDecision.actions.map(action => {
    const bound = typeof bindings?.[action.id] === 'function';
    return `<button class="button secondary" type="button" data-ai-result-action="${escapeAttribute(action.id)}"
      data-action-bound="${bound}" ${action.enabled ? '' : 'disabled'}
      ${action.disabledReason ? `title="${escapeAttribute(action.disabledReason)}"` : ''}>${escapeHtml(action.label)}</button>`;
  }).join('')}</div>`;
}

export function renderAIResult(viewModel, actionBindings = {}) {
  if (!viewModel || viewModel.kind !== 'ai_business_result') {
    throw new TypeError('renderAIResult requires a server AI business view model');
  }
  return `<article class="ai-result" data-ai-business-result>
    <header class="ai-result-header" data-ai-layer="what">
      <div><span class="status-badge status-info">${escapeHtml(viewModel.badge)}</span>
        <h2>${escapeHtml(viewModel.businessName)}</h2></div>
      <div><strong>${escapeHtml(viewModel.staleLabel)}</strong>
        ${viewModel.generatedAt ? `<small>生成于 ${escapeHtml(viewModel.generatedAt)}</small>` : '<small>生成时间未记录</small>'}</div>
    </header>
    ${trigger(viewModel)}
    ${facts(viewModel)}
    <section class="ai-result-section" data-ai-layer="rules">
      <h3>${escapeHtml(viewModel.rules.title)}</h3>${items(viewModel.rules.items, '暂无额外规则')}
    </section>
    <section class="ai-result-section" data-ai-layer="inference">
      <h3>${escapeHtml(viewModel.inference.title)}</h3>
      <p class="ai-result-conclusion">${escapeHtml(viewModel.inference.conclusion)}</p>
      ${coverage(viewModel)}
      <h4>理由</h4>${items(viewModel.inference.reasons)}
      <h4>结果明细</h4>${items(viewModel.inference.details)}
      <h4>适用限制</h4>${items(viewModel.inference.limitations)}
    </section>
    <section class="ai-result-section" data-ai-layer="human-decision">
      <h3>${escapeHtml(viewModel.humanDecision.title)}</h3>
      <p>${viewModel.humanDecision.required ? '需要人工查看、修改或确认。' : '可查看依据后关闭结果。'}</p>
      ${actions(viewModel, actionBindings)}
    </section>
    <section class="ai-result-section" data-ai-layer="system-action">
      <h3>${escapeHtml(viewModel.systemAction.title)}</h3>
      <p>${escapeHtml(viewModel.systemAction.notice)}</p>
      <h4>确认后会发生</h4>${items(viewModel.systemAction.onConfirm, '不会自动写入业务数据')}
      <h4>不会发生</h4>${items(viewModel.systemAction.notPerformed)}
    </section>
  </article>`;
}
