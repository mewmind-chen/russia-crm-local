(function initTradePulseListWidget(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseListWidget = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  // 通用业务列表协议：列目录负责“能不能展示”，用户偏好只负责“怎么展示”。
  // 数据授权、分页和服务端过滤仍由页面/API负责；本 widget 不推断权限，也不生成智能内容。
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }[character]));
  }

  function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map(value => String(value || '').trim()).filter(Boolean))];
  }

  function normalizeColumn(column, index = 0) {
    const source = column && typeof column === 'object' ? column : {};
    const key = String(source.key || '').trim();
    if (!key) return null;
    const label = String(source.label ?? source.header ?? key);
    return Object.freeze({
      key,
      label,
      header: source.header == null ? '' : String(source.header),
      sortKey: source.sortKey == null ? key : String(source.sortKey),
      sortable: source.sortable !== false,
      required: Boolean(source.required),
      defaultVisible: source.defaultVisible !== false,
      className: String(source.className || '').trim(),
      width: source.width == null ? '' : String(source.width),
      order: Number.isFinite(Number(source.order)) ? Number(source.order) : index,
      render: typeof source.render === 'function' ? source.render : null,
    });
  }

  function normalizeColumns(columns) {
    return (Array.isArray(columns) ? columns : [])
      .map(normalizeColumn)
      .filter(Boolean);
  }

  function defaultPreferences(columns = []) {
    const normalized = normalizeColumns(columns);
    return Object.freeze({
      visibleColumns: normalized.filter(column => column.defaultVisible).map(column => column.key),
      columnOrder: normalized.map(column => column.key),
      sort: [],
      sortPreset: '',
    });
  }

  function normalizeSort(sort, columns = [], fallback = []) {
    const normalized = normalizeColumns(columns);
    const byKey = new Map(normalized.map(column => [column.key, column]));
    const bySortKey = new Map(normalized.map(column => [column.sortKey, column]));
    const source = Array.isArray(sort) ? sort : (sort ? [sort] : []);
    const result = [];
    const seen = new Set();
    source.forEach(item => {
      const descriptor = item && typeof item === 'object' ? item : { key: item };
      const rawKey = String(descriptor.key || descriptor.sortKey || descriptor.field || '').trim();
      const column = byKey.get(rawKey) || bySortKey.get(rawKey);
      if (!column || !column.sortable || seen.has(column.sortKey)) return;
      const direction = String(descriptor.direction || descriptor.order || 'asc').toLowerCase() === 'desc'
        ? 'desc' : 'asc';
      result.push(Object.freeze({ key: column.key, sortKey: column.sortKey, direction }));
      seen.add(column.sortKey);
    });
    if (result.length || !Array.isArray(fallback) || !fallback.length) return result;
    return normalizeSort(fallback, normalized, []);
  }

  function normalizePreferences(preferences = {}, columns = []) {
    const normalized = normalizeColumns(columns);
    const known = new Set(normalized.map(column => column.key));
    const required = new Set(normalized.filter(column => column.required).map(column => column.key));
    const defaults = defaultPreferences(normalized);
    const visible = uniqueStrings(preferences.visibleColumns).filter(key => known.has(key));
    const visibleColumns = uniqueStrings([
      ...(visible.length ? visible : defaults.visibleColumns),
      ...required,
    ]).filter(key => known.has(key));
    const preferredOrder = uniqueStrings(preferences.columnOrder).filter(key => known.has(key));
    const columnOrder = uniqueStrings([...preferredOrder, ...defaults.columnOrder]);
    return Object.freeze({
      visibleColumns,
      columnOrder,
      sort: normalizeSort(preferences.sort, normalized),
      sortPreset: String(preferences.sortPreset || '').trim(),
    });
  }

  function resolveColumns(columns, preferences = {}) {
    const normalized = normalizeColumns(columns);
    const prefs = normalizePreferences(preferences, normalized);
    const order = new Map(prefs.columnOrder.map((key, index) => [key, index]));
    const visible = new Set(prefs.visibleColumns);
    return normalized
      .filter(column => visible.has(column.key) || column.required)
      .sort((left, right) => (order.get(left.key) ?? normalized.length) - (order.get(right.key) ?? normalized.length));
  }

  function loadPreferences(storageKey, storage, columns = []) {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    try {
      const raw = store?.getItem(String(storageKey)) || '';
      return normalizePreferences(raw ? JSON.parse(raw) : {}, columns);
    } catch (_error) {
      return normalizePreferences({}, columns);
    }
  }

  function savePreferences(storageKey, preferences, storage, columns = []) {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const normalized = normalizePreferences(preferences, columns);
    try { store?.setItem(String(storageKey), JSON.stringify(normalized)); } catch (_error) {}
    return normalized;
  }

  function renderColumnSettingsHtml({ columns = [], preferences = {}, title = '列设置' } = {}) {
    const normalized = normalizeColumns(columns);
    const resolved = resolveColumns(normalized, preferences);
    const visible = new Set(resolved.map(column => column.key));
    const order = new Set(resolved.map(column => column.key));
    const ordered = [...resolved, ...normalized.filter(column => !order.has(column.key))];
    return `<div class="list-column-settings-head"><strong>${escapeHtml(title)}</strong><span class="subtle">只影响当前用户的列表显示</span></div>`
      + `<div class="list-column-settings-list">${ordered.map((column, index) => {
        const checked = visible.has(column.key) || column.required;
        const disabled = column.required ? ' disabled' : '';
        const upDisabled = index === 0 ? ' disabled' : '';
        const downDisabled = index === ordered.length - 1 ? ' disabled' : '';
        return `<div class="list-column-setting" data-list-column-row="${escapeHtml(column.key)}">`
          + `<label><input type="checkbox" data-list-column-toggle="${escapeHtml(column.key)}"${checked ? ' checked' : ''}${disabled}> <span>${escapeHtml(column.label)}</span></label>`
          + `<span class="list-column-setting-actions"><button type="button" class="text-button" data-list-column-move="up" data-list-column-key="${escapeHtml(column.key)}"${upDisabled} aria-label="上移 ${escapeHtml(column.label)}">↑</button><button type="button" class="text-button" data-list-column-move="down" data-list-column-key="${escapeHtml(column.key)}"${downDisabled} aria-label="下移 ${escapeHtml(column.label)}">↓</button></span>`
          + '</div>';
      }).join('')}</div>`
      + '<div class="list-column-settings-footer"><button type="button" class="text-button" data-list-layout-reset>恢复默认</button><button type="button" class="button primary tiny" data-list-layout-close>完成</button></div>';
  }

  function renderTable(input, rows, attrs = '', headerAttrs = '') {
    // 兼容现有 table(headers, rows, attrs)；新页面可传 { columns, rows, attrs }。
    if (Array.isArray(input)) {
      const headers = input;
      if (!rows?.length) return '<div class="empty">暂无符合条件的数据</div>';
      return `<table ${attrs}><thead><tr${headerAttrs ? ` ${headerAttrs}` : ''}>${headers.map(item => `<th>${item}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr${row._attrs ? ` ${row._attrs}` : ''}>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    const options = input || {};
    const columns = resolveColumns(options.columns || [], options.preferences || {});
    const records = Array.isArray(options.rows) ? options.rows : [];
    if (!records.length) return `<div class="empty">${escapeHtml(options.emptyText || '暂无符合条件的数据')}</div>`;
    const headers = columns.map(column => column.header || escapeHtml(column.label));
    const cells = records.map((record, index) => columns.map(column => {
      if (column.render) return column.render(record, index);
      return record?.[column.key] ?? '';
    }));
    return renderTable(headers, cells.map((row, index) => {
      const source = records[index];
      if (source?._attrs) row._attrs = source._attrs;
      return row;
    }), options.attrs || '', options.headerAttrs || '');
  }

  return Object.freeze({
    escapeHtml,
    uniqueStrings,
    normalizeColumn,
    normalizeColumns,
    defaultPreferences,
    normalizeSort,
    normalizePreferences,
    resolveColumns,
    loadPreferences,
    savePreferences,
    renderColumnSettingsHtml,
    renderTable,
  });
}));
