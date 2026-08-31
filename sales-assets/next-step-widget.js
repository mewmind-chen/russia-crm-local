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

  // —— CRM 抽屉告警条（next-step 变体：strong 标题 + 详情 + 严重度 pill）——
  // ctx：{ severity, title, detail, action }；severity 仅区分 critical/其他，
  // 对应红色/琥珀色边框与 pill，模板与转义在 widget 内自持。
  function renderAlertStepHtml(ctx = {}) {
    const critical = ctx.severity === 'critical';
    const border = critical ? '#e0a09c' : '#e5c27c';
    const tone = critical ? 'red' : 'amber';
    return `<div class="next-step" style="border-color:${escapeHtml(border)}"><div><strong>${escapeHtml(ctx.title || '')}</strong><p>${escapeHtml(ctx.detail || '')}</p></div><span class="pill ${tone}">${escapeHtml(ctx.action || '')}</span></div>`;
  }

  // —— CRM 抽屉异常明细列表 ——
  // rows：[{ title, detail, metaHtml }]，title/detail 内部转义，metaHtml 为宿主
  // 组装的安全 HTML（计划时间/超时时长/动作）。
  function renderAlertDetailsHtml(ctx = {}) {
    const rows = Array.isArray(ctx.rows) ? ctx.rows : [];
    return `<div class="alert-details"><span class="eyebrow">异常明细</span>${rows.map(row => `<div class="alert-detail-row"><strong>${escapeHtml(row.title || '')}</strong><p>${escapeHtml(row.detail || '')}</p><span>${row.metaHtml || ''}</span></div>`).join('')}</div>`;
  }

  function render(container, ctx = {}) {
    if (!container) return;
    container.innerHTML = renderStepHtml(ctx);
  }

  return Object.freeze({
    escapeHtml,
    renderStepHtml,
    renderAlertStepHtml,
    renderAlertDetailsHtml,
    render,
  });
}));