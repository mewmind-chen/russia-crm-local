(function initTradePulseProfileFactsWidget(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseProfileFactsWidget = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  // —— 客户资料"字段事实 + 区块偏好"widget（自包含模板/状态/事件）——
  // 对外只暴露 render(container, ctx)；模板依赖 fieldWidget（字段目录 schema 驱动），
  // 状态（hiddenSections 偏好）与事件（区段显隐开关）本 widget 自持。
  // ctx 约定：
  //   fieldWidget     TradePulseFieldWidget（renderProfileFacts/profileSections/normalizeProfilePreferences）
  //   schema          customer_profile 字段目录
  //   storageKey      偏好 localStorage 键（含用户维度）
  //   getAccount()    返回当前客户 account 行（或 null）
  //   fetchProfile()  返回 profile 接口 payload（customerPool[0] 为数据源）
  //   fallbackPool()  接口失败时的本地 customerPool 回退
  //   buildFactsData(account, poolRecord)  合并为 camelCase 事实结构
  //   formatters()    返回 renderProfileFacts 的 formatters 工厂
  // 容错：fieldWidget/schema 缺失时静默（由注册表 when 门槛兜底），任何步骤异常
  // 回退到 fallbackPool（若有），仍失败则只渲染偏好条，不抛出阻断同页其他 widget。

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character]);
  }

  function defaultPreferences() {
    return Object.freeze({ hiddenSections: [] });
  }

  function normalizeProfilePreferences(preferences) {
    const hiddenSections = Array.isArray(preferences?.hiddenSections)
      ? [...new Set(preferences.hiddenSections.map(value => String(value || '').trim()).filter(Boolean))]
      : [];
    return Object.freeze({ hiddenSections });
  }

  function loadPreferences(storageKey, storage) {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    try {
      const raw = store?.getItem(String(storageKey)) || '';
      if (!raw) return defaultPreferences();
      return normalizeProfilePreferences(JSON.parse(raw));
    } catch (_error) {
      return defaultPreferences();
    }
  }

  function savePreferences(storageKey, preferences, storage) {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    try { store?.setItem(String(storageKey), JSON.stringify(preferences || defaultPreferences())); } catch (_error) {}
  }

  function toggleSection(storageKey, section, storage) {
    const current = loadPreferences(storageKey, storage);
    const hidden = new Set(current.hiddenSections);
    if (hidden.has(section)) hidden.delete(section); else hidden.add(section);
    const next = Object.freeze({ hiddenSections: [...hidden] });
    savePreferences(storageKey, next, storage);
    return next;
  }

  // 字段事实区块（HTML 字符串，纯函数便于契约测试）。
  function renderFactsHtml({ fieldWidget, schema, data, formatters = {}, preferences = {} }) {
    if (!fieldWidget || typeof fieldWidget.renderProfileFacts !== 'function') return '';
    return fieldWidget.renderProfileFacts({ schema, data, formatters, preferences });
  }

  // 区块显隐偏好条（HTML 字符串，纯函数）；无可配置区块时返回 ''。
  function renderPreferenceBarHtml({ fieldWidget, schema, preferences = {} }) {
    if (!fieldWidget || typeof fieldWidget.profileSections !== 'function') return '';
    // 偏好条必须列出完整 schema 区块。若把 hiddenSections 传给
    // profileSections，已隐藏区块会从按钮列表一并消失，用户就无法恢复。
    const sections = fieldWidget.profileSections(schema, {});
    if (!sections.length) return '';
    const hiddenSections = new Set(normalizeProfilePreferences(preferences).hiddenSections);
    return `<div class="profile-widget-preference-head"><strong>字段显示偏好</strong><span class="subtle">仅隐藏当前视图区块，不影响权限或数据下发</span></div><div class="profile-widget-preference-actions">${sections.map(section => {
      const hidden = hiddenSections.has(section.section);
      return `<button class="button secondary tiny" type="button" aria-pressed="${hidden ? 'true' : 'false'}" data-profile-section-toggle="${escapeHtml(section.section)}">${hidden ? '显示' : '隐藏'} ${escapeHtml(section.label)}</button>`;
    }).join('')}<button class="button secondary tiny" type="button" data-profile-sections-show-all>显示全部</button></div>`;
  }

  function placeholderBarHtml() {
    return '';
  }

  function toggleLabel(button, hidden) {
    const text = button.textContent || '';
    button.textContent = text.includes('隐藏')
      ? text.replace('隐藏', '显示')
      : text.replace('显示', '隐藏');
    button.setAttribute?.('aria-pressed', hidden ? 'true' : 'false');
  }

  // 把 facts + 偏好条挂进 container，并在 container 上自持区段显隐点击事件。
  async function render(container, ctx = {}) {
    if (!container) return [];
    container.replaceChildren();
    const fieldWidget = ctx.fieldWidget || null;
    const schema = ctx.schema || null;
    const storageKey = String(ctx.storageKey || '');
    const storage = ctx.storage;
    const preferences = loadPreferences(storageKey, storage);
    const host = [];
    const factsHost = document.createElement('div');
    const bar = document.createElement('div');
    if (fieldWidget && schema?.fields?.length) {
      let poolRecord = null;
      if (typeof ctx.fetchProfile === 'function') {
        try {
          const profile = await ctx.fetchProfile();
          poolRecord = profile?.customerPool?.[0] || null;
        } catch (_error) {
          poolRecord = null;
        }
      }
      if (!poolRecord && typeof ctx.fallbackPool === 'function') {
        try { poolRecord = ctx.fallbackPool() || null; } catch (_error) { poolRecord = null; }
      }
      const facts = renderFactsHtml({
        fieldWidget,
        schema,
        data: typeof ctx.buildFactsData === 'function' ? ctx.buildFactsData(ctx.getAccount ? ctx.getAccount() : null, poolRecord) : {},
        formatters: typeof ctx.formatters === 'function' ? ctx.formatters() : {},
        preferences,
      });
      if (facts) {
        factsHost.className = 'profile-widget-facts';
        factsHost.innerHTML = facts;
        container.appendChild(factsHost);
        host.push({ id: 'facts', status: 'mounted' });
      }
      const barHtml = renderPreferenceBarHtml({ fieldWidget, schema, preferences });
      bar.className = 'profile-widget-preferences';
      bar.innerHTML = barHtml || placeholderBarHtml();
      container.appendChild(bar);
      host.push({ id: 'preferences', status: barHtml ? 'mounted' : 'empty' });
      if (barHtml) {
        bar.addEventListener('click', event => {
          const showAll = event.target.closest?.('[data-profile-sections-show-all]');
          if (showAll) {
            const next = defaultPreferences();
            savePreferences(storageKey, next, storage);
            if (typeof ctx.onSectionsChanged === 'function') ctx.onSectionsChanged(next);
            return;
          }
          const toggle = event.target.closest?.('[data-profile-section-toggle]');
          if (!toggle) return;
          const section = String(toggle.dataset.profileSectionToggle || '').trim();
          if (!section) return;
          const next = toggleSection(storageKey, section, storage);
          toggleLabel(toggle, next.hiddenSections.includes(section));
          if (typeof ctx.onSectionsChanged === 'function') ctx.onSectionsChanged(next);
        });
      }
    }
    return host;
  }

  return Object.freeze({
    defaultPreferences,
    normalizeProfilePreferences,
    loadPreferences,
    savePreferences,
    toggleSection,
    renderFactsHtml,
    renderPreferenceBarHtml,
    render,
  });
}));
