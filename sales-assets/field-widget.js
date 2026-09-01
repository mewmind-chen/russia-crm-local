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
  function intakeColumnKeys(schema, options = {}) {
    if (!schema || !Array.isArray(schema.fields) || !schema.fields.length) return null;
    const visible = new Set(schema.fields.map(field => field.key));
    const legacy = ['company', 'fit', 'contact', 'owner', 'status']
      .filter(key => (INTAKE_COLUMN_FIELDS[key] || []).some(fieldKey => visible.has(fieldKey)));
    if (!options.includeDynamic) return legacy;
    // 客户主档字段以 pool_* 键直接成为可配置列；这让字段目录新增字段后，
    // 不必再维护一份“列是否存在”的硬编码映射。
    return [...legacy, ...schema.fields
      .map(field => String(field.key || '').trim())
      .filter(key => key.startsWith('pool_') && visible.has(key))];
  }

  // —— 客户资料分区渲染 ——
  // customer_profile 字段目录带 section 分组（身份与地区/业务画像/产品关注/联系渠道/合规信息/来源与记录）。
  // profileSections：把有效 schema 字段按 section 分组（保持 section 内 sortOrder），
  // 返回 [{ section, label, fields }]，无 section 的字段归入 'other'。
  const PROFILE_SECTION_LABELS = Object.freeze({
    identity_region: '身份与地区',
    business_profile: '业务画像',
    product_focus: '产品关注',
    contact_channels: '联系渠道',
    compliance: '合规信息',
    source_record: '来源与记录',
    other: '其他',
  });

  function normalizeProfilePreferences(preferences = {}) {
    const hiddenSections = Array.isArray(preferences.hiddenSections)
      ? [...new Set(preferences.hiddenSections.map(section => String(section || '').trim()).filter(Boolean))]
      : [];
    return Object.freeze({ hiddenSections });
  }

  function profileSections(schema, preferences = {}) {
    if (!schema || !Array.isArray(schema.fields) || !schema.fields.length) return [];
    const hiddenSections = new Set(normalizeProfilePreferences(preferences).hiddenSections);
    const groups = new Map();
    for (const field of schema.fields) {
      const section = field.section || 'other';
      if (hiddenSections.has(section)) continue;
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push(field);
    }
    return Array.from(groups.entries()).map(([section, fields]) => ({
      section,
      label: PROFILE_SECTION_LABELS[section] || section,
      fields,
    }));
  }

  // 按 section 分组渲染客户完整资料区块；data 为 getCustomerProfileData 返回的 customerPool[0]
  // 合并结构（buildPoolCustomer + profileAccess 等），formatters 与 renderFacts 同构。
  function renderProfileFacts({ schema, data, formatters = {}, preferences = {} }) {
    const sections = profileSections(schema, preferences);
    if (!sections.length) return '';
    return sections.map(({ label, fields }) => {
      const facts = renderFacts({ schema: { fields }, data, formatters });
      if (!facts) return '';
      return `<section class="profile-widget-section"><h3>${escapeHtml(label)}</h3>${facts}</section>`;
    }).join('');
  }

  function mount(container, options = {}) {
    if (!container) return;
    container.innerHTML = renderFacts(options);
  }

  return Object.freeze({
    INTAKE_COLUMN_FIELDS,
    PROFILE_SECTION_LABELS,
    normalizeProfilePreferences,
    intakeColumnKeys,
    profileSections,
    renderFacts,
    renderProfileFacts,
    mount,
  });
}));
