(function initTradePulseInsightSectionWidget(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseInsightSectionWidget = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  // —— CRM 抽屉洞察区块 widget（自包含模板/转义）——
  // 回收站抽屉的联系人历史、客户经营复盘、商务分组、完整时间线、客户审计历史
  // 共用同一 `insight-section` 壳（insight-head + panel-note + body）。对外只暴露
  // renderSectionHtml(ctx)（纯函数，便于契约测试）与 render(container, ctx)。
  // ctx 说明：
  //   eyebrow     眉题（可选，如 CONTACT HISTORY / FULL TIMELINE / AUDIT TRAIL）
  //   title       区块标题（如 联系人历史 / 客户审计历史）
  //   note        panel-note 文案（如 "3 人" / "12 条"）
  //   actionHtml  头部操作按钮 HTML（由宿主传入，已含安全标记，如展开时间线）
  //   bodyClass   内容容器类（默认 insight-body；时间线用 timeline）
  //   bodyHtml    内容 HTML（由宿主组装并过滤，如联系人卡片/时间线条目/审计行）
  // 容错：eyebrow 缺省不渲染眉题；bodyHtml 缺省渲染空壳，不注入未转义内容。

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character]);
  }

  function renderSectionHtml(ctx = {}) {
    const eyebrow = ctx.eyebrow
      ? `<p class="eyebrow">${escapeHtml(ctx.eyebrow)}</p>`
      : '';
    const note = ctx.note
      ? `<span class="panel-note">${escapeHtml(ctx.note)}${ctx.actionHtml || ''}</span>`
      : '';
    const bodyClass = ctx.bodyClass || 'insight-body';
    const body = ctx.bodyHtml || '';
    return `<section class="insight-section">
      <div class="insight-head"><div>${eyebrow}<h3>${escapeHtml(ctx.title || '')}</h3></div>${note}</div>
      <div class="${escapeHtml(bodyClass)}">${body}</div>
    </section>`;
  }

  function render(container, ctx = {}) {
    if (!container) return;
    container.innerHTML = renderSectionHtml(ctx);
  }

  return Object.freeze({
    escapeHtml,
    renderSectionHtml,
    render,
  });
}));