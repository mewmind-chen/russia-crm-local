(function initTradePulseFilterComponent(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseFilterComponent = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  const STORAGE_PREFIX = 'tradepulse.authorizedFilters';
  const FIELD_TYPES = new Set([
    'search', 'text', 'facet', 'tag', 'select', 'boolean', 'date', 'date_range',
  ]);
  const TYPE_OPERATORS = Object.freeze({
    search: new Set(['contains']),
    text: new Set(['contains', 'eq']),
    facet: new Set(['in']),
    tag: new Set(['in']),
    select: new Set(['eq', 'in']),
    boolean: new Set(['eq']),
    date: new Set(['eq', 'gte', 'lte']),
    date_range: new Set(['between']),
  });
  const DEFAULT_OPERATORS = Object.freeze({
    search: 'contains',
    text: 'contains',
    facet: 'in',
    tag: 'in',
    select: 'eq',
    boolean: 'eq',
    date: 'eq',
    date_range: 'between',
  });

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
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

  function uniqueStrings(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : [values])
      .map(value => String(value ?? '').trim())
      .filter(value => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  }

  function normalizeOption(option) {
    const object = option && typeof option === 'object' ? option : { value: option, label: option };
    const value = String(object.value ?? object.id ?? '').trim();
    if (!value) return null;
    const count = Number(object.count);
    return {
      value,
      label: String(object.label ?? object.name ?? value).trim() || value,
      ...(Number.isFinite(count) ? { count } : {}),
    };
  }

  function normalizeField(rawField) {
    if (!rawField || typeof rawField !== 'object') return null;
    const key = String(rawField.key || '').trim();
    if (!key) return null;
    const type = FIELD_TYPES.has(rawField.type) ? rawField.type : 'select';
    const allowedOperators = TYPE_OPERATORS[type];
    const requestedOperator = String(rawField.operator || '').trim();
    const operator = allowedOperators.has(requestedOperator)
      ? requestedOperator
      : DEFAULT_OPERATORS[type];
    const optionMap = new Map();
    (Array.isArray(rawField.options) ? rawField.options : []).forEach(rawOption => {
      const option = normalizeOption(rawOption);
      if (option && !optionMap.has(option.value)) optionMap.set(option.value, option);
    });
    const defaultPlacement = type === 'search' ? 'search'
      : type === 'facet' ? 'facet'
        : type === 'tag' ? 'tag'
          : 'more';
    const placement = ['search', 'facet', 'tag', 'more'].includes(rawField.placement)
      ? rawField.placement
      : defaultPlacement;
    return {
      key,
      label: String(rawField.label || key).trim(),
      type,
      operator,
      placement,
      multi: Boolean(rawField.multi || ['facet', 'tag'].includes(type) || operator === 'in'),
      placeholder: String(rawField.placeholder || '').trim(),
      helpText: String(rawField.helpText || '').trim(),
      sensitive: Boolean(rawField.sensitive),
      options: [...optionMap.values()],
    };
  }

  function normalizeSchema(rawSchema = {}) {
    const fieldMap = new Map();
    (Array.isArray(rawSchema.fields) ? rawSchema.fields : []).forEach(rawField => {
      const field = normalizeField(rawField);
      if (field && !fieldMap.has(field.key)) fieldMap.set(field.key, field);
    });
    return {
      schemaVersion: String(rawSchema.schemaVersion || ''),
      permissionVersion: String(rawSchema.permissionVersion || ''),
      fields: [...fieldMap.values()],
    };
  }

  function fieldMapFor(schema) {
    return new Map(schema.fields.map(field => [field.key, field]));
  }

  function optionValueAllowed(field, value) {
    if (!['facet', 'tag', 'select'].includes(field.type)) return true;
    return field.options.some(option => option.value === value);
  }

  function normalizeFieldValue(field, rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;
    if (field.type === 'search' || field.type === 'text' || field.type === 'date') {
      const value = String(rawValue).trim();
      return value || undefined;
    }
    if (field.type === 'boolean') {
      if (rawValue === true || rawValue === 'true' || rawValue === '1') return true;
      return undefined;
    }
    if (field.type === 'date_range') {
      if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return undefined;
      const from = String(rawValue.from || '').trim();
      const to = String(rawValue.to || '').trim();
      return from || to ? { ...(from ? { from } : {}), ...(to ? { to } : {}) } : undefined;
    }
    if (field.multi) {
      const values = uniqueStrings(rawValue).filter(value => optionValueAllowed(field, value));
      return values.length ? values : undefined;
    }
    const value = String(Array.isArray(rawValue) ? rawValue[0] || '' : rawValue).trim();
    return value && optionValueAllowed(field, value) ? value : undefined;
  }

  function sanitizeValues(rawValues, schema) {
    const result = {};
    const source = rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues)
      ? rawValues
      : {};
    schema.fields.forEach(field => {
      const value = normalizeFieldValue(field, source[field.key]);
      if (value !== undefined) result[field.key] = value;
    });
    return result;
  }

  function removeValue(field, current, targetValue) {
    if (current === undefined) return undefined;
    if (!field.multi) {
      if (current && typeof current === 'object') return undefined;
      return String(current) === String(targetValue) ? undefined : current;
    }
    const next = current.filter(value => String(value) !== String(targetValue));
    return next.length ? next : undefined;
  }

  function createFilterController(options = {}) {
    const pageKey = String(options.pageKey || '').trim();
    if (!pageKey) throw new Error('pageKey is required');
    const storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const storageKey = `${options.storagePrefix || STORAGE_PREFIX}.${pageKey}`;
    let currentSchema = normalizeSchema(options.schema);
    const onApply = typeof options.onApply === 'function' ? options.onApply : null;
    const onPermissionChange = typeof options.onPermissionChange === 'function'
      ? options.onPermissionChange
      : null;
    let restored = {};
    if (storage) {
      try {
        restored = JSON.parse(storage.getItem(storageKey) || '{}');
      } catch (_error) {
        restored = {};
      }
    }
    const state = {
      pageKey,
      schemaVersion: currentSchema.schemaVersion,
      permissionVersion: currentSchema.permissionVersion,
      draft: sanitizeValues(restored.draft, currentSchema),
      applied: sanitizeValues(restored.applied, currentSchema),
    };

    function persist() {
      if (!storage) return;
      try {
        storage.setItem(storageKey, JSON.stringify(state));
      } catch (_error) {}
    }

    function getField(fieldKey) {
      return fieldMapFor(currentSchema).get(String(fieldKey || ''));
    }

    function serialize(source = 'applied') {
      const values = sanitizeValues(state[source], currentSchema);
      const filters = currentSchema.fields.flatMap(field => (
        Object.hasOwn(values, field.key)
          ? [{ field: field.key, operator: field.operator, value: clone(values[field.key]) }]
          : []
      ));
      return {
        pageKey,
        schemaVersion: currentSchema.schemaVersion,
        permissionVersion: currentSchema.permissionVersion,
        filters,
      };
    }

    function emitApply() {
      const payload = serialize('applied');
      if (onApply) onApply(clone(payload));
      return payload;
    }

    const controller = {
      pageKey,
      storageKey,

      getSchema() {
        return clone(currentSchema);
      },

      getState() {
        return clone(state);
      },

      setDraft(fieldKey, rawValue) {
        const field = getField(fieldKey);
        if (!field) return false;
        const value = normalizeFieldValue(field, rawValue);
        if (value === undefined) delete state.draft[field.key];
        else state.draft[field.key] = value;
        state.draft = sanitizeValues(state.draft, currentSchema);
        persist();
        return true;
      },

      toggleValue(fieldKey, rawValue) {
        const field = getField(fieldKey);
        const value = String(rawValue ?? '').trim();
        if (!field || !field.multi || !value || !optionValueAllowed(field, value)) return false;
        const current = Array.isArray(state.draft[field.key]) ? state.draft[field.key] : [];
        state.draft[field.key] = current.includes(value)
          ? current.filter(item => item !== value)
          : [...current, value];
        if (!state.draft[field.key].length) delete state.draft[field.key];
        persist();
        return true;
      },

      clearField(fieldKey, settings = {}) {
        const field = getField(fieldKey);
        if (!field) return false;
        delete state.draft[field.key];
        if (!settings.draftOnly) delete state.applied[field.key];
        persist();
        if (settings.apply) emitApply();
        return true;
      },

      remove(fieldKey, targetValue, settings = {}) {
        const field = getField(fieldKey);
        if (!field) return false;
        const draftValue = removeValue(field, state.draft[field.key], targetValue);
        const appliedValue = removeValue(field, state.applied[field.key], targetValue);
        if (draftValue === undefined) delete state.draft[field.key];
        else state.draft[field.key] = draftValue;
        if (appliedValue === undefined) delete state.applied[field.key];
        else state.applied[field.key] = appliedValue;
        persist();
        if (settings.apply !== false) emitApply();
        return true;
      },

      clearAll(settings = {}) {
        state.draft = {};
        state.applied = {};
        persist();
        if (settings.apply !== false) emitApply();
        return serialize('applied');
      },

      apply() {
        state.draft = sanitizeValues(state.draft, currentSchema);
        state.applied = clone(state.draft);
        persist();
        return emitApply();
      },

      serialize,

      updateSchema(nextSchema) {
        const previousPermissionVersion = currentSchema.permissionVersion;
        const previousSchemaVersion = currentSchema.schemaVersion;
        currentSchema = normalizeSchema(nextSchema);
        state.schemaVersion = currentSchema.schemaVersion;
        state.permissionVersion = currentSchema.permissionVersion;
        state.draft = sanitizeValues(state.draft, currentSchema);
        state.applied = sanitizeValues(state.applied, currentSchema);
        persist();
        if (previousPermissionVersion
          && previousPermissionVersion !== currentSchema.permissionVersion
          && onPermissionChange) {
          onPermissionChange({
            pageKey,
            previousPermissionVersion,
            permissionVersion: currentSchema.permissionVersion,
            previousSchemaVersion,
            schemaVersion: currentSchema.schemaVersion,
            state: clone(state),
          });
        }
        return controller.getState();
      },
    };

    persist();
    return controller;
  }

  function selectedValuesFor(state, field, source = 'draft') {
    const value = state?.[source]?.[field.key];
    if (field.multi) return Array.isArray(value) ? value.map(String) : [];
    return value === undefined ? [] : [String(value)];
  }

  function optionIsDisabled(option, selected) {
    return option.count === 0 && !selected;
  }

  function renderOption(field, option, selected) {
    const count = option.count === undefined ? '' : `<small>${escapeHtml(option.count)}</small>`;
    const disabled = optionIsDisabled(option, selected);
    return `<button class="tp-filter-option" type="button" data-filter-field="${escapeHtml(field.key)}" data-filter-value="${escapeHtml(option.value)}" aria-pressed="${selected ? 'true' : 'false'}"${disabled ? ' disabled' : ''}><span>${escapeHtml(option.label)}</span>${count}</button>`;
  }

  function renderFacetRow(field, state) {
    const selected = selectedValuesFor(state, field);
    const options = field.options.map(option => renderOption(
      field,
      option,
      selected.includes(option.value),
    )).join('');
    const count = field.options.length;
    return `<div class="tp-filter-facet-row" data-filter-kind="${escapeHtml(field.type)}">
      <div class="tp-filter-facet-label"><strong>${escapeHtml(field.label)}</strong><small>${count} 个可用选项</small></div>
      <div class="tp-filter-facet-options">
        <button class="tp-filter-option tp-filter-all" type="button" data-filter-field="${escapeHtml(field.key)}" data-filter-all="true" aria-pressed="${selected.length ? 'false' : 'true'}">全部</button>
        ${options}
      </div>
    </div>`;
  }

  function renderSearchField(field, state) {
    const value = String(state?.draft?.[field.key] || '');
    return `<label class="tp-filter-search">
      <span>${escapeHtml(field.label)}</span>
      <input type="search" data-filter-search="${escapeHtml(field.key)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || `搜索${field.label}`)}" autocomplete="off">
    </label>`;
  }

  function renderMoreField(field, state) {
    const selected = selectedValuesFor(state, field);
    if (field.type === 'boolean') {
      const checked = state?.draft?.[field.key] === true;
      return `<label class="tp-filter-boolean"><input type="checkbox" data-filter-basic="${escapeHtml(field.key)}" ${checked ? 'checked' : ''}><span>${escapeHtml(field.label)}</span></label>`;
    }
    if (field.type === 'date_range') {
      const value = state?.draft?.[field.key] || {};
      return `<fieldset class="tp-filter-date-range"><legend>${escapeHtml(field.label)}</legend><input type="date" data-filter-basic="${escapeHtml(field.key)}" data-range-edge="from" value="${escapeHtml(value.from || '')}"><span>至</span><input type="date" data-filter-basic="${escapeHtml(field.key)}" data-range-edge="to" value="${escapeHtml(value.to || '')}"></fieldset>`;
    }
    if (field.type === 'date' || field.type === 'text') {
      const inputType = field.type === 'date' ? 'date' : 'text';
      return `<label class="tp-filter-basic-field"><span>${escapeHtml(field.label)}</span><input type="${inputType}" data-filter-basic="${escapeHtml(field.key)}" value="${escapeHtml(state?.draft?.[field.key] || '')}"></label>`;
    }
    return `<label class="tp-filter-basic-field"><span>${escapeHtml(field.label)}</span><select data-filter-basic="${escapeHtml(field.key)}" ${field.multi ? 'multiple' : ''}>
      ${field.multi ? '' : '<option value="">全部</option>'}
      ${field.options.map(option => {
        const isSelected = selected.includes(option.value);
        return `<option value="${escapeHtml(option.value)}" ${isSelected ? 'selected' : ''}${optionIsDisabled(option, isSelected) ? ' disabled' : ''}>${escapeHtml(option.label)}</option>`;
      }).join('')}
    </select></label>`;
  }

  function chipLabel(field, rawValue) {
    const option = field.options.find(item => item.value === String(rawValue));
    return option?.label || String(rawValue);
  }

  function renderAppliedChips(schema, state) {
    const chips = [];
    schema.fields.forEach(field => {
      const rawValue = state?.applied?.[field.key];
      if (rawValue === undefined) return;
      const values = field.multi ? rawValue : [rawValue];
      values.forEach(value => {
        const display = value && typeof value === 'object'
          ? [value.from, value.to].filter(Boolean).join(' — ')
          : chipLabel(field, value);
        const removalValue = value && typeof value === 'object' ? '' : value;
        chips.push(`<button class="tp-filter-chip" type="button" data-filter-remove="${escapeHtml(field.key)}" data-filter-value="${escapeHtml(removalValue)}">${escapeHtml(field.label)}：${escapeHtml(display)} <span aria-hidden="true">×</span></button>`);
      });
    });
    return chips;
  }

  function renderResultMeta(resultMeta = {}) {
    if (resultMeta.loading) return '<span class="tp-filter-result-count">正在读取结果…</span>';
    if (Number.isFinite(Number(resultMeta.total))) {
      const total = Number(resultMeta.total);
      const shown = Number(resultMeta.shown);
      return `<span class="tp-filter-result-count">${escapeHtml(total)} 条结果${Number.isFinite(shown) && shown !== total ? ` · 已显示 ${escapeHtml(shown)}` : ''}</span>`;
    }
    return '<span class="tp-filter-result-count">等待应用筛选</span>';
  }

  const PRIMARY_FILTER_KEYS = new Set([
    'country',
    'owner',
    'assigned_owner',
    'assigned_owner_id',
    'stage',
    'status',
    'intake_status',
    'lead_status',
  ]);

  function splitFilterFields(schema) {
    const searchFields = schema.fields.filter(field => field.placement === 'search');
    const nonSearch = schema.fields.filter(field => field.placement !== 'search');
    const primaryFields = nonSearch.filter(field => (
      PRIMARY_FILTER_KEYS.has(field.key)
      && !['tag', 'date_range'].includes(field.type)
    ));
    const advancedFields = nonSearch.filter(field => !primaryFields.includes(field));
    return { searchFields, primaryFields, advancedFields };
  }

  function renderCompactField(field, state) {
    if (['facet', 'tag'].includes(field.type) || field.multi) return renderMenuField(field, state);
    return renderMoreField(field, state);
  }

  function renderMenuField(field, state) {
    const selected = selectedValuesFor(state, field);
    const summaryText = selected.length === 1
      ? chipLabel(field, selected[0])
      : selected.length > 1
        ? `已选 ${selected.length}`
        : '全部';
    return `<div class="tp-filter-basic-field">
      <span>${escapeHtml(field.label)}</span>
      <details class="tp-filter-menu" data-filter-menu="${escapeHtml(field.key)}">
        <summary><span class="tp-filter-menu-value">${escapeHtml(summaryText)}</span>${selected.length ? ` <span>${selected.length}</span>` : ''}</summary>
        <div class="tp-filter-menu-options">
          <button class="tp-filter-option tp-filter-all" type="button" data-filter-field="${escapeHtml(field.key)}" data-filter-all="true" aria-pressed="${selected.length ? 'false' : 'true'}">全部</button>
          ${field.options.map(option => renderOption(field, option, selected.includes(option.value))).join('')}
        </div>
      </details>
    </div>`;
  }

  function renderPrimaryField(field, state) {
    if (!['facet', 'tag'].includes(field.type) && !field.multi) return renderMoreField(field, state);
    return renderMenuField(field, state);
  }

  function renderAdvancedFilterIcon() {
    const icon = globalThis.TradePulseUIFormat?.icon;
    return `<span class="tp-filter-advanced-icon" aria-hidden="true">${
      typeof icon === 'function' ? icon('pipeline') : '≡'
    }</span>`;
  }

  function renderFilterComponent(model = {}) {
    const status = model.status || 'ready';
    const schema = normalizeSchema(model.schema);
    const error = String(model.error || '').trim();
    if (status === 'loading') {
      return '<section class="tp-filter-component tp-filter-state" data-filter-status="loading" aria-live="polite">正在加载可用筛选项…</section>';
    }
    if (status === 'error') {
      return `<section class="tp-filter-component tp-filter-state tp-filter-error" data-filter-status="error" role="alert">${escapeHtml(error || '筛选项读取失败，请重试')}</section>`;
    }
    if (!schema.fields.length) {
      return '<section class="tp-filter-component tp-filter-state" data-filter-status="empty">当前没有可用筛选项</section>';
    }
    const state = {
      draft: sanitizeValues(model.state?.draft, schema),
      applied: sanitizeValues(model.state?.applied, schema),
    };
    const { searchFields, primaryFields, advancedFields } = splitFilterFields(schema);
    const appliedCount = Object.keys(state.applied).length;
    const selectedAdvancedCount = advancedFields.filter(field => (
      state.draft[field.key] !== undefined
    )).length;
    const chips = renderAppliedChips(schema, state);
    const resultStatus = appliedCount
      ? `已启用条件 · ${appliedCount} 项`
      : '暂无条件，显示当前权限范围内全部数据';
    return `<section class="tp-filter-component" data-filter-status="ready"
        data-schema-version="${escapeHtml(schema.schemaVersion)}"
        data-permission-version="${escapeHtml(schema.permissionVersion)}">
      <div class="tp-filter-primary-row">
        ${searchFields.map(field => renderSearchField(field, state)).join('')}
        ${primaryFields.map(field => renderPrimaryField(field, state)).join('')}
        <div class="tp-filter-primary-actions">
          <button class="tp-filter-clear" type="button" data-filter-clear>清空筛选</button>
          <button class="tp-filter-apply" type="button" data-filter-apply>应用筛选</button>
        </div>
      </div>
      <div class="tp-filter-foot">
        ${advancedFields.length ? `<details class="tp-filter-advanced">
          <summary aria-expanded="false">
            ${renderAdvancedFilterIcon()}
            <span class="tp-filter-advanced-label">详细筛选</span>
            <span class="tp-filter-advanced-count" data-filter-advanced-count
              aria-label="已选 ${selectedAdvancedCount} 个高级条件" ${selectedAdvancedCount ? '' : 'hidden'}>${selectedAdvancedCount}</span>
            <span class="tp-filter-advanced-arrow" aria-hidden="true">▼</span>
          </summary>
          <div class="tp-filter-advanced-grid">${advancedFields.map(field => renderCompactField(field, state)).join('')}</div>
        </details>` : ''}
        <div class="tp-filter-applied">
          <div class="tp-filter-applied-head">当前结果 ${renderResultMeta(model.resultMeta)} · ${resultStatus}</div>
          ${chips.length ? `<div class="tp-filter-chip-list">${chips.join('')}</div>` : ''}
        </div>
      </div>
    </section>`;
  }

  function mountFilterComponent(rootElement, options = {}) {
    if (!rootElement || typeof rootElement.addEventListener !== 'function') {
      throw new Error('A valid root element is required');
    }
    const controller = options.controller || createFilterController(options);
    let status = options.status || 'ready';
    let error = options.error || '';
    let resultMeta = options.resultMeta || {};
    let linkTimer = 0;
    let linkEpoch = 0;

    function render() {
      rootElement.innerHTML = renderFilterComponent({
        schema: controller.getSchema(),
        state: controller.getState(),
        status,
        error,
        resultMeta,
      });
    }

    function restoreOpenMenu(fieldKey) {
      if (!fieldKey || typeof rootElement.querySelectorAll !== 'function') return;
      const menu = [...rootElement.querySelectorAll('[data-filter-menu]')]
        .find(element => element.dataset.filterMenu === fieldKey);
      if (menu) menu.open = true;
    }

    function captureFilterUi() {
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const searchKey = active?.dataset?.filterSearch || '';
      return {
        advancedWasOpen: typeof rootElement.querySelector === 'function'
          && Boolean(rootElement.querySelector('.tp-filter-advanced')?.open),
        openMenu: typeof rootElement.querySelectorAll === 'function'
          ? ([...rootElement.querySelectorAll('[data-filter-menu]')].find(element => element.open)
            ?.dataset.filterMenu || '')
          : '',
        searchKey,
        selectionStart: searchKey ? active.selectionStart : null,
        selectionEnd: searchKey ? active.selectionEnd : null,
      };
    }

    function restoreFilterUi(ui = {}) {
      restoreOpenMenu(ui.openMenu);
      restoreAdvancedDisclosure(ui.advancedWasOpen);
      if (!ui.searchKey || typeof rootElement.querySelector !== 'function') return;
      const input = rootElement.querySelector(`[data-filter-search="${ui.searchKey}"]`);
      if (!input || typeof input.focus !== 'function') return;
      input.focus();
      if (ui.selectionStart != null && typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(ui.selectionStart, ui.selectionEnd);
      }
    }

    async function refreshLinkedSchema() {
      if (typeof options.fetchLinkedSchema !== 'function') return;
      const epoch = ++linkEpoch;
      const ui = captureFilterUi();
      try {
        const schema = await options.fetchLinkedSchema(controller);
        if (epoch !== linkEpoch || !schema) return;
        controller.updateSchema(schema);
        render();
        restoreFilterUi(ui);
      } catch (_error) {}
    }

    function scheduleLinkedSchemaRefresh() {
      if (typeof options.fetchLinkedSchema !== 'function') return;
      if (linkTimer) clearTimeout(linkTimer);
      linkTimer = setTimeout(() => {
        linkTimer = 0;
        void refreshLinkedSchema();
      }, 160);
    }

    function syncAdvancedToggle(advanced) {
      if (!advanced) return;
      const summary = advanced.querySelector?.('summary');
      summary?.setAttribute?.('aria-expanded', String(Boolean(advanced.open)));
      const arrow = summary?.querySelector?.('.tp-filter-advanced-arrow');
      if (arrow) arrow.textContent = advanced.open ? '▲' : '▼';
      const label = summary?.querySelector?.('.tp-filter-advanced-label');
      if (label) label.textContent = advanced.open ? '收起详细筛选' : '详细筛选';
    }

    function restoreAdvancedDisclosure(wasOpen) {
      if (!wasOpen || typeof rootElement.querySelector !== 'function') return;
      const advanced = rootElement.querySelector('.tp-filter-advanced');
      if (!advanced) return;
      advanced.open = true;
      syncAdvancedToggle(advanced);
    }

    function handleClick(event) {
      const menuSummary = event.target.closest?.('summary');
      const openMenu = menuSummary?.closest?.('[data-filter-menu]');
      if (openMenu && rootElement.contains(openMenu)) {
        if (openMenu.open) event.preventDefault?.();
        return;
      }
      const all = event.target.closest('[data-filter-all]');
      if (all && rootElement.contains(all)) {
        const menuField = all.closest?.('[data-filter-menu]')?.dataset.filterMenu || '';
        const advancedWasOpen = Boolean(all.closest?.('.tp-filter-advanced')?.open);
        controller.clearField(all.dataset.filterField, { draftOnly: true });
        render();
        restoreOpenMenu(menuField);
        restoreAdvancedDisclosure(advancedWasOpen);
        scheduleLinkedSchemaRefresh();
        return;
      }
      const option = event.target.closest('.tp-filter-option[data-filter-value]');
      if (option && rootElement.contains(option)) {
        if (option.disabled) return;
        const menuField = option.closest?.('[data-filter-menu]')?.dataset.filterMenu || '';
        const advancedWasOpen = Boolean(option.closest?.('.tp-filter-advanced')?.open);
        controller.toggleValue(option.dataset.filterField, option.dataset.filterValue);
        render();
        restoreOpenMenu(menuField);
        restoreAdvancedDisclosure(advancedWasOpen);
        scheduleLinkedSchemaRefresh();
        return;
      }
      const remove = event.target.closest('[data-filter-remove]');
      if (remove && rootElement.contains(remove)) {
        controller.remove(remove.dataset.filterRemove, remove.dataset.filterValue);
        render();
        scheduleLinkedSchemaRefresh();
        return;
      }
      if (event.target.closest('[data-filter-clear]')) {
        controller.clearAll();
        render();
        scheduleLinkedSchemaRefresh();
        return;
      }
      if (event.target.closest('[data-filter-apply]')) {
        controller.apply();
        render();
      }
    }

    function handleInput(event) {
      const search = event.target.closest('[data-filter-search]');
      if (search && rootElement.contains(search)) {
        controller.setDraft(search.dataset.filterSearch, search.value);
        scheduleLinkedSchemaRefresh();
        return;
      }
      const input = event.target.closest('[data-filter-basic]');
      if (!input || !rootElement.contains(input) || !['date', 'text'].includes(input.type)) return;
      setBasicDraft(input);
      syncAdvancedCount();
      scheduleLinkedSchemaRefresh();
    }

    function setBasicDraft(input) {
      const fieldKey = input.dataset.filterBasic;
      if (input.dataset.rangeEdge) {
        const current = controller.getState().draft[fieldKey] || {};
        controller.setDraft(fieldKey, { ...current, [input.dataset.rangeEdge]: input.value });
      } else if (input.type === 'checkbox') {
        controller.setDraft(fieldKey, input.checked);
      } else if (input.multiple) {
        controller.setDraft(fieldKey, [...input.selectedOptions].map(option => option.value));
      } else {
        controller.setDraft(fieldKey, input.value);
      }
    }

    function syncAdvancedCount() {
      const counter = rootElement.querySelector('[data-filter-advanced-count]');
      if (!counter) return;
      const { advancedFields } = splitFilterFields(controller.getSchema());
      const draft = controller.getState().draft;
      const count = advancedFields.filter(field => draft[field.key] !== undefined).length;
      counter.textContent = String(count);
      counter.hidden = count === 0;
      counter.setAttribute('aria-label', `已选 ${count} 个高级条件`);
    }

    function handleChange(event) {
      const input = event.target.closest('[data-filter-basic]');
      if (!input || !rootElement.contains(input)) return;
      setBasicDraft(input);
      syncAdvancedCount();
      scheduleLinkedSchemaRefresh();
    }

    function handleMenuMouseOut(event) {
      const menu = event.target.closest?.('[data-filter-menu]');
      if (!menu || !rootElement.contains(menu) || !menu.open) return;
      const next = event.relatedTarget;
      if (next && (next === menu || (typeof menu.contains === 'function' && menu.contains(next)))) {
        return;
      }
      if (next && typeof next.closest === 'function' && next.closest('[data-filter-menu]') === menu) {
        return;
      }
      menu.open = false;
    }

    function handleToggle(event) {
      const advanced = event.target.closest?.('.tp-filter-advanced');
      if (!advanced || !rootElement.contains(advanced)) return;
      syncAdvancedToggle(advanced);
    }

    rootElement.addEventListener('click', handleClick);
    rootElement.addEventListener('input', handleInput);
    rootElement.addEventListener('change', handleChange);
    rootElement.addEventListener('toggle', handleToggle, true);
    rootElement.addEventListener('mouseout', handleMenuMouseOut);
    render();

    return {
      controller,
      render,
      setStatus(nextStatus, nextError = '') {
        status = nextStatus || 'ready';
        error = nextError;
        render();
      },
      setResultMeta(nextResultMeta = {}) {
        resultMeta = nextResultMeta;
        render();
      },
      updateSchema(nextSchema) {
        controller.updateSchema(nextSchema);
        render();
      },
      destroy() {
        linkEpoch += 1;
        if (linkTimer) clearTimeout(linkTimer);
        linkTimer = 0;
        rootElement.removeEventListener('click', handleClick);
        rootElement.removeEventListener('input', handleInput);
        rootElement.removeEventListener('change', handleChange);
        rootElement.removeEventListener('toggle', handleToggle, true);
        rootElement.removeEventListener('mouseout', handleMenuMouseOut);
        rootElement.innerHTML = '';
      },
    };
  }

  return Object.freeze({
    STORAGE_PREFIX,
    normalizeSchema,
    createFilterController,
    splitFilterFields,
    renderFilterComponent,
    mountFilterComponent,
  });
}));
