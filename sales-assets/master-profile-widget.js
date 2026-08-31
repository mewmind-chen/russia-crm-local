(function initTradePulseMasterProfileWidget(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseMasterProfileWidget = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  // —— CRM 客户主档区 widget（自包含模板/转义）——
  // 客户抽屉、回收站抽屉、线索抽屉共用同一 `master-profile` 区块结构：insight-head
  // （eyebrow + 标题 + actions 位）+ master-profile-grid 卡片网格。对外只暴露
  // renderMasterSectionHtml(ctx)（纯函数，便于契约测试）与 render(container, ctx)。
  // ctx 说明：
  //   eyebrow   eyebrow 文案（默认 CUSTOMER MASTER DATA）
  //   title     区块标题（如 企业背景与开发依据 / 客户主档）
  //   actions   头部动作 HTML（由宿主传入，已含安全标记）
  //   gridClass 附加网格类（如 drawer-master-grid ），缺省空
  //   rows      [[label, valueHtml, cardClass]]：label 与 cardClass 内部转义，
  //             valueHtml 为宿主已过滤的安全 HTML（链接等）
  // 容错：任一环节异常回退最小架（不缺行），不抛出阻断同页其他 widget。

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character]);
  }

  function cardMarkup([label, valueHtml = '', cardClass = '']) {
    const cls = cardClass ? ` class="${escapeHtml(cardClass)}"` : '';
    return `<div${cls}><span>${escapeHtml(label)}</span><p>${valueHtml || '<span class="tp-empty-value">—</span>'}</p></div>`;
  }

  function renderMasterSectionHtml(ctx = {}) {
    const eyebrow = escapeHtml(ctx.eyebrow || 'CUSTOMER MASTER DATA');
    const title = escapeHtml(ctx.title || '');
    const gridClass = ctx.gridClass ? ` ${escapeHtml(ctx.gridClass)}` : '';
    const cards = (Array.isArray(ctx.rows) ? ctx.rows : [])
      .map(cardMarkup).join('');
    return `<section class="master-profile">
      <div class="insight-head"><div><p class="eyebrow">${eyebrow}</p><h3>${title}</h3></div>${ctx.actions || ''}</div>
      <div class="master-profile-grid${gridClass}">${cards}</div>
    </section>`;
  }

  function render(container, ctx = {}) {
    if (!container) return;
    container.innerHTML = renderMasterSectionHtml(ctx);
  }

  return Object.freeze({
    escapeHtml,
    cardMarkup,
    renderMasterSectionHtml,
    render,
  });
}));