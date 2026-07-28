'use strict';

const FILTER_TYPES = Object.freeze([
  'text',
  'multi',
  'date_range',
  'tag_multi',
]);

const FILTER_OPERATORS = Object.freeze({
  text: Object.freeze(['contains']),
  multi: Object.freeze(['in']),
  date_range: Object.freeze(['between']),
  tag_multi: Object.freeze(['in']),
});

const DISPLAY_MODES = Object.freeze([
  'horizontal',
  'more',
  'date_range',
]);

const PAGE_REQUIRED_PERMISSIONS = Object.freeze({
  customers: Object.freeze(['view_customers']),
  pipeline: Object.freeze(['view_pipeline']),
});

function definition({
  key,
  label,
  type = 'multi',
  operators = FILTER_OPERATORS[type],
  displayMode = 'horizontal',
  sortOrder,
  sensitive = false,
  requiredPermissions = [],
  pages = ['customers', 'pipeline'],
  tagCategory = '',
}) {
  return Object.freeze({
    key,
    label,
    type,
    enabled: true,
    sensitive,
    operators: Object.freeze([...operators]),
    displayMode,
    sortOrder,
    requiredPermissions: Object.freeze([...requiredPermissions]),
    pages: Object.freeze([...pages]),
    tagCategory,
  });
}

const FILTER_DEFINITIONS = Object.freeze([
  definition({
    key: 'search',
    label: '关键词',
    type: 'text',
    displayMode: 'horizontal',
    sortOrder: 10,
  }),
  definition({ key: 'country', label: '国家 / 地区', sortOrder: 20 }),
  definition({
    key: 'owner',
    label: '分配销售',
    sortOrder: 30,
    sensitive: true,
    requiredPermissions: ['view_all_customers'],
  }),
  definition({ key: 'stage', label: '客户阶段', sortOrder: 40 }),
  definition({ key: 'customer_type', label: '客户类型字段', sortOrder: 50 }),
  definition({ key: 'industry', label: '行业', displayMode: 'more', sortOrder: 60 }),
  definition({ key: 'priority', label: '客户优先级', displayMode: 'more', sortOrder: 70 }),
  definition({ key: 'source', label: '客户来源', displayMode: 'more', sortOrder: 80 }),
  definition({
    key: 'creator',
    label: '创建人',
    displayMode: 'more',
    sortOrder: 90,
    sensitive: true,
    requiredPermissions: ['view_all_customers'],
  }),
  definition({
    key: 'last_action',
    label: '最近动作',
    displayMode: 'more',
    sortOrder: 100,
  }),
  definition({
    key: 'next_step',
    label: '下一步',
    displayMode: 'more',
    sortOrder: 110,
  }),
  definition({
    key: 'created_at',
    label: '创建日期',
    type: 'date_range',
    displayMode: 'date_range',
    sortOrder: 120,
  }),
  definition({
    key: 'tag_customer_type',
    label: '客户类型',
    type: 'tag_multi',
    sortOrder: 200,
    tagCategory: '客户类型',
  }),
  definition({
    key: 'tag_business_product',
    label: '客户经营产品',
    type: 'tag_multi',
    sortOrder: 210,
    sensitive: true,
    requiredPermissions: ['view_contacts'],
    tagCategory: '客户经营产品',
  }),
  definition({
    key: 'tag_demand_product',
    label: '需求 / 采购产品',
    type: 'tag_multi',
    sortOrder: 220,
    sensitive: true,
    requiredPermissions: ['view_contacts'],
    tagCategory: '需求/采购产品',
  }),
  definition({
    key: 'tag_industry',
    label: '应用行业',
    type: 'tag_multi',
    sortOrder: 230,
    tagCategory: '应用行业',
  }),
  definition({
    key: 'tag_focus_scenario',
    label: '重点场景',
    type: 'tag_multi',
    sortOrder: 240,
    tagCategory: '重点场景',
  }),
  definition({
    key: 'tag_needs_confirmation',
    label: '需确认属性',
    type: 'tag_multi',
    sortOrder: 250,
    sensitive: true,
    tagCategory: '需确认属性',
  }),
  definition({
    key: 'tag_list',
    label: '名单标签',
    type: 'tag_multi',
    sortOrder: 260,
    sensitive: true,
    tagCategory: '名单标签',
  }),
]);

module.exports = {
  FILTER_TYPES,
  FILTER_OPERATORS,
  DISPLAY_MODES,
  PAGE_REQUIRED_PERMISSIONS,
  FILTER_DEFINITIONS,
};
