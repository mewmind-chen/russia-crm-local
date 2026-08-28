(function initTradePulseFieldWidget(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseFieldWidget = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character]);
  }

  function defaultTextFormatter(data, field) {
    const value = data?.[field.sourceKey];
    if (value === undefined || value === null || value === '') return field.defaultValue || '—';
    return value;
  }

  // formatters: { [formatterName]: (data, field) => string|html }
  // 约定：field.kind === 'website' 或 formatter 返回值含 HTML 时使用 formatter 原文，
  // 其余字段按纯文本转义。字段目录中 kind 决定输出方式。
  function renderFacts({ schema, data, formatters = {} }) {
    if (!schema || !Array.isArray(schema.fields)) return '';
    return schema.fields
      .map(field => {
        const formatter = formatters[field.formatter] || formatters.text || defaultTextFormatter;
        let content;
        try {
          content = formatter(data, field);
        } catch (_error) {
          content = field.defaultValue || '—';
        }
        const contentHtml = field.kind === 'html' || field.kind === 'website'
          ? String(content ?? '')
          : `<strong>${escapeHtml(content ?? field.defaultValue ?? '—')}</strong>`;
        return `<div class="fact"><span>${escapeHtml(field.label)}</span>${contentHtml}</div>`;
      })
      .join('');
  }

  // —— 线索池列模型 ——
  // 每列由一组 schema 字段驱动：列可见 = 该列任一字段在有效 schema 中可见。
  // 与 renderIntake 的旧列（company/fit/candidates/contact/owner/status/actions）保持一致，
  // candidates 与 actions 不是数据字段，不在目录中，由调用方按原开关/固定逻辑控制。
  const INTAKE_COLUMN_FIELDS = Object.freeze({
    company: ['company_name', 'external_customer_id', 'country', 'city', 'website', 'industry',
      'customer_type', 'product_focus', 'batch_id', 'updated_at'],
    fit: ['fit_score', 'fit_grade', 'readiness', 'priority'],
    contact: ['contact_level', 'contact_name', 'contact_title', 'contact_methods'],
    owner: ['assigned_owner_name', 'suggested_owner_name', 'decision_reason', 'return_reason'],
    status: ['status', 'claim_due_at', 'crm_assignment_status'],
  });

  // 返回 schema 驱动的可见列键（按旧渲染顺序），schema 缺失/空字段时返回 null 表示走回退路径。
  function intakeColumnKeys(schema) {
    if (!schema || !Array.isArray(schema.fields) || !schema.fields.length) return null;
    const visible = new Set(schema.fields.map(field => field.key));
    return ['company', 'fit', 'contact', 'owner', 'status']
      .filter(key => (INTAKE_COLUMN_FIELDS[key] || []).some(fieldKey => visible.has(fieldKey)));
  }

  function mount(container, options = {}) {
    if (!container) return;
    container.innerHTML = renderFacts(options);
  }

  return Object.freeze({
    INTAKE_COLUMN_FIELDS,
    intakeColumnKeys,
    renderFacts,
    mount,
  });
}));
