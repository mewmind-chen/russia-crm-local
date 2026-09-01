(function initTradePulseWidgetRegistry(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseWidgetRegistry = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  // —— Widget 注册表 ——
  // 页面 = 注册表配置化组装：每个 widget 声明 id、适用页面、顺序、权限/开关门槛
  // 与 render(container, ctx)。新增/隐藏前端内容只改注册表配置或对应 widget。
  // 门槛沿用 data-permission / data-ai-business 等价机制 + bootstrap features：
  //   - permission: string | string[]，ctx.permissions 中全部满足
  //   - feature:    string | string[]，ctx.features 中全部为真（如 aiStations）
  //   - when:       (ctx) => boolean，自定义谓词
  // renderPage 按页面过滤 + 门槛过滤 + order 排序后逐个挂载；单个 widget 异常
  // 不阻断同页其余 widget（可组合、可回滚）。

  const registry = new Map(); // id -> normalized widget

  function normalizeWidget(widget) {
    if (!widget || typeof widget !== 'object') throw new Error('widget 必须是对象');
    const id = String(widget.id || '').trim();
    if (!id) throw new Error('widget.id 必填');
    const pages = Array.isArray(widget.pages)
      ? widget.pages.map(value => String(value).trim()).filter(Boolean)
      : [String(widget.page || '').trim()].filter(Boolean);
    if (!pages.length) throw new Error(`widget ${id} 未声明 pages/page`);
    if (typeof widget.render !== 'function') throw new Error(`widget ${id} 未实现 render(container, ctx)`);
    const toList = value => Array.isArray(value)
      ? value.map(item => String(item).trim()).filter(Boolean)
      : value == null ? [] : [String(value).trim()].filter(Boolean);
    return Object.freeze({
      id,
      pages: Object.freeze(pages),
      order: Number.isFinite(widget.order) ? widget.order : 100,
      permission: Object.freeze(toList(widget.permission)),
      feature: Object.freeze(toList(widget.feature)),
      when: typeof widget.when === 'function' ? widget.when : null,
      render: widget.render,
    });
  }

  function register(widget) {
    const normalized = normalizeWidget(widget);
    registry.set(normalized.id, normalized);
    return normalized;
  }

  function unregister(id) {
    return registry.delete(String(id));
  }

  function has(id) {
    return registry.has(String(id));
  }

  function list() {
    return [...registry.values()];
  }

  function clear() {
    registry.clear();
  }

  function isEligible(widget, ctx = {}) {
    const permissions = ctx.permissions || {};
    if (widget.permission.some(key => !permissions[key])) return false;
    const features = ctx.features || {};
    if (widget.feature.some(key => !features[key])) return false;
    return widget.when ? Boolean(widget.when(ctx)) : true;
  }

  function widgetsForPage(pageKey, ctx = {}) {
    const key = String(pageKey);
    return list()
      .filter(widget => widget.pages.includes(key))
      .filter(widget => isEligible(widget, ctx))
      .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
  }

  function clearContainer(container) {
    if (typeof container.replaceChildren === 'function') {
      container.replaceChildren();
      return;
    }
    if (typeof container.removeChild === 'function') {
      while (container.firstChild) container.removeChild(container.firstChild);
    }
    if (Array.isArray(container.children)) container.children.length = 0;
    if ('innerHTML' in container) container.innerHTML = '';
  }

  function createWidgetHost(container, widgetId) {
    const ownerDocument = container && container.ownerDocument;
    const documentRef = ownerDocument && typeof ownerDocument.createElement === 'function'
      ? ownerDocument
      : typeof globalThis !== 'undefined' ? globalThis.document : null;
    const host = documentRef && typeof documentRef.createElement === 'function'
      ? documentRef.createElement('div')
      : {
        children: [],
        innerHTML: '',
        className: '',
        appendChild(node) { this.children.push(node); return node; },
        replaceChildren(...nodes) {
          this.children.length = 0;
          this.children.push(...nodes);
        },
        addEventListener() {},
        querySelector() { return null; },
      };
    if (host && host.dataset && typeof host.dataset === 'object') host.dataset.widgetId = widgetId;
    if (host && typeof host.setAttribute === 'function') host.setAttribute('data-widget-id', widgetId);
    else if (host && (!host.dataset || typeof host.dataset !== 'object')) host.dataset = { widgetId };
    return host;
  }

  // 返回挂载结果列表：[{ id }] 或 [{ id, error }]；不抛异常，异常按 widget 隔离。
  // render 可为 async（内部拉取数据后落 DOM），renderPage 依次 await 保持装配顺序。
  async function renderPage(pageKey, container, ctx = {}) {
    if (!container) return [];
    clearContainer(container);
    const mounted = [];
    for (const widget of widgetsForPage(pageKey, ctx)) {
      try {
        const host = createWidgetHost(container, widget.id);
        container.appendChild(host);
        await widget.render(host, ctx);
        mounted.push({ id: widget.id });
      } catch (error) {
        mounted.push({ id: widget.id, error: error && error.message ? error.message : String(error) });
      }
    }
    return mounted;
  }

  return Object.freeze({
    register,
    unregister,
    has,
    list,
    clear,
    widgetsForPage,
    renderPage,
  });
}));
