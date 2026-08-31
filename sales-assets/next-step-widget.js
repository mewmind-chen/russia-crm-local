(function initTradePulseNextStepWidget(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseNextStepWidget = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  // —— CRM 抽屉"下一步/状态"条 widget（自包含模板/转义）——
  // CRM 抽屉（NEXT ACTION）、线索抽屉（LEAD PROFILE）、回收抽屉
  // （RECYCLED CUSTOMER · READ ONLY）共用同一 `.next-step` 壳：
  // eyebrow + 主文本 + 尾部 actionHtml。对外只暴露 renderStepHtml(ctx)
  // （纯函数，便于契约测试）与 render(container, ctx)。
  // ctx 说明：
  //   eyebrow     眉题（如 NEXT ACTION / LEAD PROFILE）
  //   text        主文本（已由宿主转义或纯文本，widget 统一转义）
  //   actionHtml  尾部操作 HTML（由宿主传入，已含安全标记，如时间徽标/pill）
  //   className   附加类（可选，如 bordered），缺省空
  // 容错：缺省字段渲染空壳，不注入未转义内容。

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character]);
  }

  function renderStepHtml(ctx = {}) {
    const cls = ctx.className ? ` ${escapeHtml(ctx.className)}` : '';
    return `<div class="next-step${cls}"><div><span class="eyebrow">${escapeHtml(ctx.eyebrow || '')}</span><p>${escapeHtml(ctx.text || '')}</p></div>${ctx.actionHtml || ''}</div>`;
  }

  function render(container, ctx = {}) {
    if (!container) return;
    container.innerHTML = renderStepHtml(ctx);
  }

  return Object.freeze({
    escapeHtml,
    renderStepHtml,
    render,
  });
}));