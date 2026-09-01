(function initTradePulseSourceTagsWidget(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseSourceTagsWidget = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  // —— 客户身份/来源标签 widget（纯投影与模板）——
  // 只读取 account.customerTags；权限与 AI 开关由宿主通过 includeReadOnly 注入。
  // 结构化客户字段不在此处合成，避免把字段误报为标签。

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character]);
  }

  function normalizeTagText(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLocaleLowerCase('zh-CN');
  }

  // 按规范化后的原始 name 去重，保留第一次出现的标签及其顺序。
  function uniqueSourceTags(tags) {
    const seen = new Set();
    return (Array.isArray(tags) ? tags : []).filter(tag => {
      if (!tag || typeof tag !== 'object') return false;
      const key = normalizeTagText(tag.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function accountSourceTags(account, options = {}) {
    const includeReadOnly = options?.includeReadOnly === undefined
      ? true
      : Boolean(options.includeReadOnly);
    const customerTags = Array.isArray(account?.customerTags) ? account.customerTags : [];
    return uniqueSourceTags(customerTags
      .filter(tag => tag && typeof tag === 'object')
      .filter(tag => includeReadOnly || !tag.readOnly)
      .map(tag => ({
        source: tag.readOnly ? 'ai' : 'manual',
        name: tag.name,
        category: tag.category,
      })));
  }

  function normalizeLimit(value, fallback = 5) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.floor(number));
  }

  function renderSourceTagRowHtml(options = {}) {
    const { account, limit = 5, includeReadOnly = true } = options || {};
    const tags = accountSourceTags(account, { includeReadOnly });
    const shown = tags.slice(0, normalizeLimit(limit));
    if (!shown.length) return '';
    const overflow = tags.length - shown.length;
    const tagMarkup = shown.map(tag => `<span class="source-tag ${escapeHtml(tag.source)}" title="${escapeHtml(tag.category || '客户标签')}">${escapeHtml(tag.name)}</span>`).join('');
    const overflowMarkup = overflow > 0 ? `<span class="source-tag manual">+${overflow}</span>` : '';
    return `<div class="source-tag-row">${tagMarkup}${overflowMarkup}</div>`;
  }

  return Object.freeze({
    escapeHtml,
    normalizeTagText,
    uniqueSourceTags,
    accountSourceTags,
    renderSourceTagRowHtml,
  });
}));
