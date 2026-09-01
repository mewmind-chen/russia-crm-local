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
      group: source.group == null ? '' : String(source.group).trim(),
      section: source.section == null ? '' : String(source.section).trim(),
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
    source.forEach((item, sourceIndex) => {
      const descriptor = item && typeof item === 'object' ? item : { key: item };
      const rawKey = String(descriptor.key || descriptor.sortKey || descriptor.field || '').trim();
      const column = byKey.get(rawKey) || bySortKey.get(rawKey);
      if (!column || !column.sortable || seen.has(column.sortKey)) return;
      const direction = String(descriptor.direction || descriptor.order || 'asc').toLowerCase() === 'desc'
        ? 'desc' : 'asc';
      const rawRank = Number(descriptor.rank ?? descriptor.priority ?? descriptor.level);
      const rank = Number.isFinite(rawRank) && rawRank > 0 ? Math.floor(rawRank) : null;
      result.push({
        key: column.key,
        sortKey: column.sortKey,
        direction,
        rank,
        sourceIndex,
      });
      seen.add(column.sortKey);
    });
    if (result.length) {
      const hasRank = result.some(item => item.rank != null);
      result.sort((left, right) => {
        if (!hasRank) return left.sourceIndex - right.sourceIndex;
        const leftRank = left.rank == null ? Number.MAX_SAFE_INTEGER : left.rank;
        const rightRank = right.rank == null ? Number.MAX_SAFE_INTEGER : right.rank;
        return leftRank - rightRank || left.sourceIndex - right.sourceIndex;
      });
      return result.map(({ rank, sourceIndex, ...item }) => Object.freeze(item));
    }
    if (!Array.isArray(fallback) || !fallback.length) return result;
    return normalizeSort(fallback, normalized, []);
  }

  function compareSortValues(left, right) {
    const leftEmpty = left == null || String(left).trim() === '';
    const rightEmpty = right == null || String(right).trim() === '';
    if (leftEmpty || rightEmpty) {
      if (leftEmpty && rightEmpty) return 0;
      return leftEmpty ? 1 : -1;
    }
    const leftNumber = typeof left === 'number' ? left : Number(left);
    const rightNumber = typeof right === 'number' ? right : Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(left).trim())
      && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(right).trim())) {
      return leftNumber - rightNumber;
    }
    return String(left).localeCompare(String(right), 'zh-CN', { numeric: true, sensitivity: 'base' });
  }

  function sortRows(rows, sort, columns = [], options = {}) {
    const records = Array.isArray(rows) ? rows : [];
    const normalized = normalizeColumns(columns);
    const descriptors = normalizeSort(sort, normalized);
    if (!descriptors.length || records.length < 2) return [...records];
    const byKey = new Map(normalized.map(column => [column.key, column]));
    const getValue = typeof options.getValue === 'function'
      ? options.getValue
      : (record, column) => record?.[column.key] ?? record?.[column.sortKey];
    const getTieBreaker = typeof options.tieBreaker === 'function'
      ? options.tieBreaker
      : record => record?.id ?? record?.key ?? record?.external_customer_id ?? '';
    return records.map((record, index) => ({ record, index })).sort((left, right) => {
      for (const descriptor of descriptors) {
        const column = byKey.get(descriptor.key);
        if (!column) continue;
        const compared = compareSortValues(
          getValue(left.record, column, descriptor),
          getValue(right.record, column, descriptor),
        );
        if (compared) return descriptor.direction === 'desc' ? -compared : compared;
      }
      const tied = compareSortValues(getTieBreaker(left.record), getTieBreaker(right.record));
      return tied || left.index - right.index;
    }).map(item => item.record);
  }

  function readSortSettings(root, columns = []) {
    const descriptors = [];
    if (!root?.querySelectorAll) return [];
    root.querySelectorAll('[data-list-sort-rank]').forEach(rankControl => {
      const rank = Number(rankControl.value);
      if (!Number.isFinite(rank) || rank < 1) return;
      const row = rankControl.closest('[data-list-column-row]');
      const key = String(rankControl.dataset.listSortRank || row?.dataset.listColumnRow || '').trim();
      const directionControl = row?.querySelector('[data-list-sort-direction]');
      descriptors.push({ key, rank, direction: directionControl?.value || 'asc' });
    });
    return normalizeSort(descriptors, columns);
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

  function columnGroupLabel(column) {
    // 页面字段目录可提供明确分组；旧目录没有时仍给出一致、可读的默认分组。
    if (column.group) return column.group;
    if (column.section) return column.section;
    if (column.key === 'pool' || column.key.indexOf('pool_') === 0) return '客户主档';
    if (column.key === 'select' || column.key === 'actions') return '操作';
    return '业务字段';
  }

  function groupColumnsForSettings(columns) {
    const groups = [];
    const byLabel = new Map();
    columns.forEach(column => {
      const label = columnGroupLabel(column);
      if (!byLabel.has(label)) {
        const group = { label, columns: [] };
        byLabel.set(label, group);
        groups.push(group);
      }
      byLabel.get(label).columns.push(column);
    });
    return groups;
  }

  function renderColumnSettingsHtml({ columns = [], preferences = {}, title = '列设置' } = {}) {
    const normalized = normalizeColumns(columns);
    const resolved = resolveColumns(normalized, preferences);
    const visible = new Set(resolved.map(column => column.key));
    const order = new Set(resolved.map(column => column.key));
    const ordered = [...resolved, ...normalized.filter(column => !order.has(column.key))];
    const sort = normalizeSort(preferences.sort, normalized);
    const sortByKey = new Map(sort.map((item, index) => [item.key, { ...item, rank: index + 1 }]));
    const sortableCount = normalized.filter(column => column.sortable).length;
    const visibleCount = normalized.filter(column => visible.has(column.key) || column.required).length;
    const rankOptions = rank => [
      '<option value="">不排序</option>',
      ...Array.from({ length: sortableCount }, (_value, index) => {
        const value = index + 1;
        return `<option value="${value}"${rank === value ? ' selected' : ''}>第${value}优先</option>`;
      }),
    ].join('');
    const rowMarkup = (column, index) => {
        const checked = visible.has(column.key) || column.required;
        const disabled = column.required ? ' disabled' : '';
        const upDisabled = index === 0 ? ' disabled' : '';
        const downDisabled = index === ordered.length - 1 ? ' disabled' : '';
        const core = column.required || column.defaultVisible;
        const selectedSort = sortByKey.get(column.key);
        const sortControls = column.sortable
          ? `<span class="list-column-setting-sort"><label>优先级<select data-list-sort-rank="${escapeHtml(column.key)}" aria-label="${escapeHtml(column.label)}排序优先级">${rankOptions(selectedSort?.rank || 0)}</select></label><label>方向<select data-list-sort-direction="${escapeHtml(column.key)}" aria-label="${escapeHtml(column.label)}排序方向"><option value="asc"${selectedSort?.direction !== 'desc' ? ' selected' : ''}>升序</option><option value="desc"${selectedSort?.direction === 'desc' ? ' selected' : ''}>降序</option></select></label></span>`
          : '<span class="list-column-setting-sort list-column-setting-sort-disabled">不可排序</span>';
        return `<div class="list-column-setting" data-list-column-row="${escapeHtml(column.key)}" data-list-column-core="${core ? 'true' : 'false'}" data-list-column-search-text="${escapeHtml(`${column.label} ${column.key}`.toLowerCase())}">`
          + `<label><input type="checkbox" data-list-column-toggle="${escapeHtml(column.key)}"${checked ? ' checked' : ''}${disabled}> <span>${escapeHtml(column.label)}</span></label>`
          + sortControls
          + `<span class="list-column-setting-actions"><button type="button" class="text-button" data-list-column-move="up" data-list-column-key="${escapeHtml(column.key)}"${upDisabled} aria-label="上移 ${escapeHtml(column.label)}">↑</button><button type="button" class="text-button" data-list-column-move="down" data-list-column-key="${escapeHtml(column.key)}"${downDisabled} aria-label="下移 ${escapeHtml(column.label)}">↓</button></span>`
          + '</div>';
      };
    const groupedRows = groupColumnsForSettings(ordered).map(group => `<section class="list-column-settings-group" data-list-column-group="${escapeHtml(group.label)}"><div class="list-column-settings-group-head"><strong>${escapeHtml(group.label)}</strong><span class="subtle">${group.columns.length} 项</span></div>${group.columns.map(column => rowMarkup(column, ordered.indexOf(column))).join('')}</section>`).join('');
    return `<div class="list-column-settings-head"><div><strong>${escapeHtml(title)}</strong><span class="subtle">只影响当前用户的列表显示</span></div><span class="list-column-selected-count" aria-live="polite">已选 ${visibleCount}/${normalized.length}</span></div>`
      + '<div class="list-column-settings-tools"><label><span class="sr-only">搜索列</span><input type="search" data-list-column-search placeholder="搜索字段" autocomplete="off" aria-label="搜索列"></label><span class="list-column-settings-presets"><button type="button" class="text-button" data-list-column-preset="core">仅核心</button><button type="button" class="text-button" data-list-column-preset="all">显示全部</button></span></div>'
      + `<div class="list-column-settings-list">${groupedRows}</div>`
      + '<div class="list-column-settings-help">可为多个字段设置优先级；未设置的字段不参与排序。相同值按稳定主键保持顺序。</div>'
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
    const preferences = normalizePreferences(options.preferences || {}, options.columns || []);
    const records = Array.isArray(options.rows) ? options.rows : [];
    const sortedRecords = preferences.sort.length
      ? sortRows(records, preferences.sort, options.columns || [], {
        getValue: (record, column) => (record?._sort || record?.__sort)?.[column.sortKey]
          ?? record?.[column.key]
          ?? record?.[column.sortKey],
      })
      : records;
    if (!sortedRecords.length) return `<div class="empty">${escapeHtml(options.emptyText || '暂无符合条件的数据')}</div>`;
    const headers = columns.map(column => column.header || escapeHtml(column.label));
    const cells = sortedRecords.map((record, index) => columns.map(column => {
      if (column.render) return column.render(record, index);
      return record?.[column.key] ?? '';
    }));
    return renderTable(headers, cells.map((row, index) => {
      const source = sortedRecords[index];
      if (source?._attrs) row._attrs = source._attrs;
      return row;
    }), options.attrs || '', options.headerAttrs || '');
  }

  function refreshColumnSettingsCount(panel) {
    const count = panel?.querySelector?.('.list-column-selected-count');
    if (!count) return;
    const toggles = [...panel.querySelectorAll('[data-list-column-toggle]')];
    count.textContent = `已选 ${toggles.filter(toggle => toggle.checked).length}/${toggles.length}`;
  }

  function filterColumnSettingsRows(panel, query) {
    if (!panel?.querySelectorAll) return;
    const needle = String(query || '').trim().toLowerCase();
    panel.querySelectorAll('[data-list-column-row]').forEach(row => {
      const haystack = String(row.dataset.listColumnSearchText || row.textContent || '').toLowerCase();
      row.hidden = Boolean(needle && !haystack.includes(needle));
    });
    panel.querySelectorAll('[data-list-column-group]').forEach(group => {
      group.hidden = [...group.querySelectorAll('[data-list-column-row]')].every(row => row.hidden);
    });
  }

  function bindColumnSettingsInteractions() {
    if (typeof document === 'undefined' || document.documentElement?.dataset.listWidgetBound) return;
    document.documentElement.dataset.listWidgetBound = 'true';
    document.addEventListener('input', event => {
      const search = event.target?.closest?.('[data-list-column-search]');
      if (!search) return;
      filterColumnSettingsRows(search.closest('.list-column-settings'), search.value);
    });
    document.addEventListener('change', event => {
      const toggle = event.target?.closest?.('[data-list-column-toggle]');
      if (toggle) refreshColumnSettingsCount(toggle.closest('.list-column-settings'));
    });
    document.addEventListener('click', event => {
      const preset = event.target?.closest?.('[data-list-column-preset]');
      if (!preset) return;
      const panel = preset.closest('.list-column-settings');
      const mode = preset.dataset.listColumnPreset;
      if (!panel || !['core', 'all'].includes(mode)) return;
      event.preventDefault();
      // The page owns persistence and refresh. Emit one semantic event instead
      // of dispatching one change per checkbox (which would rerender the panel
      // during the loop and leave a partially applied preset).
      panel.querySelectorAll('[data-list-column-toggle]').forEach(toggle => {
        const row = toggle.closest('[data-list-column-row]');
        const shouldShow = mode === 'all' || toggle.disabled || row?.dataset.listColumnCore === 'true';
        toggle.checked = shouldShow;
      });
      refreshColumnSettingsCount(panel);
      preset.dispatchEvent(new CustomEvent('tradepulse:list-layout-preset', {
        bubbles: true,
        detail: { mode },
      }));
    });
  }

  bindColumnSettingsInteractions();

  return Object.freeze({
    escapeHtml,
    uniqueStrings,
    normalizeColumn,
    normalizeColumns,
    defaultPreferences,
    normalizeSort,
    normalizePreferences,
    compareSortValues,
    sortRows,
    readSortSettings,
    resolveColumns,
    loadPreferences,
    savePreferences,
    columnGroupLabel,
    groupColumnsForSettings,
    renderColumnSettingsHtml,
    renderTable,
  });
}));
