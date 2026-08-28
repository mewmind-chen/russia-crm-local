'use strict';

// 字段目录（FIELDS_CATALOG）
// 试点阶段：先覆盖 CRM 客户抽屉（crm_drawer）的事实字段区。
// 目标：字段显隐/顺序/标签由目录配置驱动，服务端按 角色+权限+开关 计算有效字段 schema，
// 前端 widget 按 schema 渲染，避免硬编码字段渲染。
//
// 字段模型：
//   key        字段标识（唯一）
//   label      显示标签
//   sourceKey  数据源字段名（前端数据对象上的 key；缺省用 key）
//   formatter  渲染提示：text | creator | relative | textOrDash | aiLabels | managerStatus | website
//   kind       text | website（website 表示 formatter 返回安全 HTML）
//   sortOrder  显示顺序
//   defaultValue 空值兜底文案
//   sensitive  敏感标记（用于审计/提示，不在页面直接泄露）
//   visibility.roles        允许的角色（缺省=所有角色）
//   visibility.permissions  要求的权限（全部满足才显示）
//   visibility.features     要求的运行时开关（全部开启才显示，如 ai_stations）

function defineField({
  key,
  label,
  sourceKey = '',
  formatter = 'text',
  kind = 'text',
  sortOrder = 100,
  defaultValue = '',
  sensitive = false,
  visibility = {},
}) {
  return Object.freeze({
    key,
    label,
    sourceKey: sourceKey || key,
    formatter,
    kind,
    sortOrder,
    defaultValue,
    sensitive: Boolean(sensitive),
    visibility: Object.freeze({
      roles: Object.freeze([...(visibility.roles || [])]),
      permissions: Object.freeze([...(visibility.permissions || [])]),
      features: Object.freeze([...(visibility.features || [])]),
    }),
  });
}

// 与现状 CRM 客户抽屉 accountFacts 行为等价：
// - 负责人 / 创建人 / 优先级 / 成立年份 / 最近动作 / 管理介入 / 官网 / 联系人质量：所有角色
// - 客户来源：仅 admin / manager（原 showTechnicalSources = !isSalesRepresentative()）
// - 评价标签：仅 AI 开关开启且非销售（原 technicalAIPresentationAllowed()）
const FIELDS_CATALOG = Object.freeze({
  crm_drawer: Object.freeze([
    defineField({ key: 'owner', label: '负责人', sourceKey: 'owner_name', formatter: 'textOrDash', defaultValue: '未分配', sortOrder: 10 }),
    defineField({ key: 'creator', label: '创建人', formatter: 'creator', sortOrder: 20 }),
    defineField({ key: 'priority', label: '优先级', sortOrder: 30 }),
    defineField({ key: 'source', label: '客户来源', sortOrder: 40, visibility: { roles: ['admin', 'manager'] } }),
    defineField({ key: 'established_year', label: '成立年份', formatter: 'textOrDash', defaultValue: '未填写', sortOrder: 50 }),
    defineField({
      key: 'evaluation_tags',
      label: '评价标签',
      formatter: 'aiLabels',
      sortOrder: 60,
      visibility: { roles: ['admin', 'manager'], features: ['ai_stations'] },
    }),
    defineField({ key: 'last_activity', label: '最近动作', sourceKey: 'last_activity_at', formatter: 'relative', sortOrder: 70 }),
    defineField({ key: 'manager_status', label: '管理介入', formatter: 'managerStatus', sortOrder: 80 }),
    defineField({ key: 'website', label: '官网', formatter: 'website', kind: 'website', sortOrder: 90 }),
    defineField({ key: 'best_contact_level', label: '联系人质量', formatter: 'textOrDash', defaultValue: '—', sortOrder: 100 }),
  ]),
  // 线索池 / 线索流转：与 queryIntakeFlowPage + renderIntake 的列/事实一致。
  // contact_* 字段由 view_contacts 门控（无权限不下发，等价于现状 redactContactFields）；
  // fit_* / readiness / priority 由 ai_stations 开关门控（关闭时回退 match_score/match_group）。
  intake: Object.freeze([
    defineField({ key: 'company_name', label: '公司', sortOrder: 10 }),
    defineField({ key: 'external_customer_id', label: '客户ID', sortOrder: 20 }),
    defineField({ key: 'country', label: '国家', sortOrder: 30 }),
    defineField({ key: 'city', label: '城市', sortOrder: 40 }),
    defineField({ key: 'website', label: '官网', formatter: 'website', kind: 'website', sortOrder: 50 }),
    defineField({ key: 'industry', label: '行业', sortOrder: 60 }),
    defineField({ key: 'customer_type', label: '客户类型', sortOrder: 70 }),
    defineField({ key: 'product_focus', label: '产品需求', sortOrder: 80 }),
    defineField({ key: 'status', label: '线索状态', sortOrder: 90 }),
    defineField({ key: 'assigned_owner_name', label: '分配销售', defaultValue: '待手动分配', sortOrder: 100 }),
    defineField({ key: 'suggested_owner_name', label: '建议销售', defaultValue: '', sortOrder: 110 }),
    defineField({ key: 'decision_reason', label: '分配/阻断原因', sortOrder: 120 }),
    defineField({ key: 'return_reason', label: '退回原因', sortOrder: 130 }),
    defineField({ key: 'claim_due_at', label: '领取截止', sortOrder: 140 }),
    defineField({ key: 'crm_assignment_status', label: 'CRM 状态', sortOrder: 150 }),
    defineField({ key: 'batch_id', label: '来源批次', sortOrder: 160 }),
    defineField({ key: 'updated_at', label: '更新时间', sortOrder: 170 }),
    defineField({ key: 'contact_level', label: '联系人等级', sortOrder: 30, sensitive: true, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'contact_name', label: '具名联系人', sortOrder: 40, sensitive: true, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'contact_title', label: '职位', sortOrder: 50, sensitive: true, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'contact_methods', label: '联系方式', sortOrder: 60, sensitive: true, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'fit_score', label: 'Fit 评分', formatter: 'textOrDash', defaultValue: '—', sortOrder: 10, visibility: { features: ['ai_stations'] } }),
    defineField({ key: 'fit_grade', label: 'Fit 等级', formatter: 'textOrDash', defaultValue: '—', sortOrder: 20, visibility: { features: ['ai_stations'] } }),
    defineField({ key: 'readiness', label: '联系就绪度', sortOrder: 25, visibility: { features: ['ai_stations'] } }),
    defineField({ key: 'priority', label: '优先级', sortOrder: 35, visibility: { features: ['ai_stations'] } }),
  ]),
  lead_flow: Object.freeze([]), // lead_flow 与 intake 共用同一目录（见 resolveFieldSchema 别名）
});

function isFieldVisible(field, role, permissions = {}, features = {}) {
  const visibility = field.visibility || {};
  if (visibility.roles.length && !visibility.roles.includes(role)) return false;
  if (visibility.permissions.length
    && !visibility.permissions.every(permission => Boolean(permissions[permission]))) return false;
  if (visibility.features.length
    && !visibility.features.every(feature => Boolean(features[feature]))) return false;
  return true;
}

function serializeField(field) {
  return {
    key: field.key,
    label: field.label,
    sourceKey: field.sourceKey,
    formatter: field.formatter,
    kind: field.kind,
    sortOrder: field.sortOrder,
    defaultValue: field.defaultValue,
    sensitive: field.sensitive,
  };
}

// 按 角色 + 权限 + 运行时开关 计算某个页面的有效字段 schema。
function effectiveFieldSchema({ pageKey, user, permissions = {}, features = {} }) {
  const resolvedPage = pageKey === 'lead_flow' ? 'intake' : pageKey;
  const catalog = FIELDS_CATALOG[resolvedPage];
  if (!catalog) return null;
  const role = user?.role || '';
  const fields = catalog
    .filter(field => isFieldVisible(field, role, permissions, features))
    .map(serializeField)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  return {
    pageKey,
    version: 'field-schema-v1',
    fields,
  };
}

function listFieldPages() {
  return Object.keys(FIELDS_CATALOG);
}

module.exports = {
  FIELDS_CATALOG,
  effectiveFieldSchema,
  isFieldVisible,
  listFieldPages,
};
