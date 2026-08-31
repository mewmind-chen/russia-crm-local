(function initTradePulseDrawerFactsWidget(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ui-format'));
  else root.TradePulseDrawerFactsWidget = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule(uiFormatArg) {
  'use strict';

  // —— CRM 抽屉客户事实区 widget（自包含模板/状态/事件全部由字段目录或回退驱动）——
  // 与 profile-facts 共用同一 facts 渲染理念：schema 就绪就近用 fieldWidget.renderFacts
  // 按服务端字段目录渲染；否则回退到 accountFacts 硬编码行。对外只暴露
  // renderFactsHtml(ctx)（纯函数，便于契约测试）与 render(container, ctx)。
  // ctx 说明：
  //   fieldWidget  TradePulseFieldWidget（renderFacts）
  //   schema       crm_drawer 字段目录
  //   data         account 行（snake_case）
  //   formatters   renderFacts 的 formatter 工厂（由宿主注入 app 级 helper，如相对时间/创建人/AI 标签）
  //   fallback     回退行 [[label, value, kind]]，kind==='website' 走安全链接标记
  // 容错：schema+fieldWidget 就绪时优先 schema，任一环节异常回退 fallback。

  // uiFormat 延迟解析：Node（工厂注入）优先，浏览器回退到全局 TradePulseUIFormat，
  // 避免与 ui-format.js 的脚本加载顺序耦合。
  function resolveUiFormat() {
    if (uiFormatArg) return uiFormatArg;
    return (typeof globalThis !== 'undefined' && globalThis.TradePulseUIFormat) || null;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character]);
  }

  function websiteMarkup(value) {
    const fmt = resolveUiFormat();
    const site = fmt?.website ? fmt.website(value) : null;
    return site
      ? `<a class="tp-website" href="${escapeHtml(site.href)}" target="_blank" rel="noopener">${escapeHtml(site.label)}${fmt.icon ? fmt.icon('external') : ''}</a>`
      : '<span class="tp-empty-value">暂无官网</span>';
  }

  function factMarkup([label, value, kind = 'text']) {
    const content = kind === 'website'
      ? websiteMarkup(value)
      : `<strong>${escapeHtml(value || '—')}</strong>`;
    return `<div class="fact"><span>${escapeHtml(label)}</span>${content}</div>`;
  }

  // schema 优先 + fallback 兜底；返回事实区 HTML 字符串。
  function renderFactsHtml({ fieldWidget, schema, data = {}, formatters = {}, fallback = [] }) {
    const serializer = fieldWidget && typeof fieldWidget.renderFacts === 'function' ? fieldWidget : null;
    if (serializer && schema?.fields?.length) {
      try {
        const html = serializer.renderFacts({ schema, data, formatters });
        if (html) return html;
      } catch (_error) {
        // 回退到硬编码行
      }
    }
    return fallback.map(factMarkup).join('');
  }

  function render(container, ctx = {}) {
    if (!container) return;
    container.innerHTML = renderFactsHtml(ctx);
  }

  return Object.freeze({
    escapeHtml,
    websiteMarkup,
    factMarkup,
    renderFactsHtml,
    render,
  });
}));