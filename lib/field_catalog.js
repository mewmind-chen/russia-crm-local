'use strict';

// 字段目录（FIELDS_CATALOG）
// 试点阶段：先覆盖 CRM 客户抽屉（crm_drawer）的事实字段区。
// 目标：字段显隐/顺序/标签由目录配置驱动，服务端按 角色+权限+开关 计算有效字段 schema，
// 前端 widget 按 schema 渲染，避免硬编码字段渲染。
//
// 字段模型：
//   key        字段标识（唯一）
//   label      显示标签
//   section    所属分区（客户资料分组渲染用；缺省=''）
//   sourceKey  数据源字段名（前端数据对象上的 key；缺省用 key）
//   formatter  渲染提示：text | creator | relative | textOrDash | aiLabels | managerStatus | website | sanction
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
  section = '',
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
    section,
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
  // 今日待办列表：操作列与移动端卡片由页面负责，其余列由授权字段目录约束。
  alerts: Object.freeze([
    defineField({ key: 'urgency', label: '等级', sortOrder: 10 }),
    defineField({ key: 'company', label: '客户', sortOrder: 20 }),
    defineField({ key: 'reasons', label: '主要原因 / 其他原因', sortOrder: 30 }),
    defineField({ key: 'due_at', label: '计划时间', sortOrder: 40 }),
    defineField({ key: 'owner', label: '负责人', sortOrder: 50 }),
  ]),
  // Dashboard 国家转化快照：只读经营指标；不含 AI 字段，列布局由前端按用户保存。
  dashboard: Object.freeze([
    defineField({ key: 'country', label: '国家', sortOrder: 10 }),
    defineField({ key: 'accounts', label: '客户', sortOrder: 20 }),
    defineField({ key: 'reply_rate', label: '回复率', sortOrder: 30 }),
    defineField({ key: 'rfq_rate', label: '询价率', sortOrder: 40 }),
    defineField({ key: 'order_rate', label: '首单率', sortOrder: 50 }),
    defineField({ key: 'value_per_account', label: '单客毛利', sortOrder: 60 }),
  ]),
  // Markets 国家矩阵与分配批次：只读经营报表字段，布局由当前用户保存。
  markets_country: Object.freeze([
    defineField({ key: 'country', label: '国家', sortOrder: 10 }),
    defineField({ key: 'sample', label: '样本', sortOrder: 20 }),
    defineField({ key: 'contact_rate', label: '触达率', sortOrder: 30 }),
    defineField({ key: 'reply_rate', label: '回复率', sortOrder: 40 }),
    defineField({ key: 'meeting_rate', label: '会议率', sortOrder: 50 }),
    defineField({ key: 'rfq_rate', label: '询价率', sortOrder: 60 }),
    defineField({ key: 'order_rate', label: '首单率', sortOrder: 70 }),
    defineField({ key: 'repeat_rate', label: '复购率', sortOrder: 80 }),
    defineField({ key: 'revenue', label: '收入', sortOrder: 90 }),
    defineField({ key: 'value_per_account', label: '单客毛利', sortOrder: 100 }),
    defineField({ key: 'judgement', label: '策略判断', sortOrder: 110 }),
  ]),
  markets_cohort: Object.freeze([
    defineField({ key: 'cohort', label: '分配月份', sortOrder: 10 }),
    defineField({ key: 'assigned', label: '客户数', sortOrder: 20 }),
    defineField({ key: 'contact_rate', label: '触达率', sortOrder: 30 }),
    defineField({ key: 'reply_rate', label: '回复率', sortOrder: 40 }),
    defineField({ key: 'meeting_rate', label: '会议率', sortOrder: 50 }),
    defineField({ key: 'rfq_rate', label: '会议→询价', sortOrder: 60 }),
    defineField({ key: 'order_rate', label: '询价→首单', sortOrder: 70 }),
    defineField({ key: 'revenue', label: '收入', sortOrder: 80 }),
  ]),
  // 主管任务列表：状态/原因/期限为现有只读任务投影，操作按钮由页面负责。
  manager_tasks: Object.freeze([
    defineField({ key: 'company', label: '客户', sortOrder: 10 }),
    defineField({ key: 'customer_id', label: '客户ID', sortOrder: 20 }),
    defineField({ key: 'status', label: '状态', sortOrder: 30 }),
    defineField({ key: 'owner', label: '负责人', sortOrder: 40 }),
    defineField({ key: 'reason', label: '触发原因', sortOrder: 50 }),
    defineField({ key: 'due_at', label: '处理期限', sortOrder: 60 }),
    defineField({ key: 'triggered_at', label: '触发时间', sortOrder: 70 }),
  ]),
  // 风险明细与主管任务共享只读任务投影，但保留独立页面 schema/用户布局。
  manager_risks: Object.freeze([
    defineField({ key: 'company', label: '客户', sortOrder: 10 }),
    defineField({ key: 'customer_id', label: '客户ID', sortOrder: 20 }),
    defineField({ key: 'status', label: '状态', sortOrder: 30 }),
    defineField({ key: 'owner', label: '负责人', sortOrder: 40 }),
    defineField({ key: 'reason', label: '触发原因', sortOrder: 50 }),
    defineField({ key: 'due_at', label: '处理期限', sortOrder: 60 }),
    defineField({ key: 'triggered_at', label: '触发时间', sortOrder: 70 }),
  ]),
  // 主管指标列表：聚合计数/比例仍是只读业务指标，钻取按钮由页面负责。
  manager_metrics: Object.freeze([
    defineField({ key: 'actor', label: '销售', sortOrder: 10 }),
    defineField({ key: 'range_days', label: '统计周期', sortOrder: 20 }),
    defineField({ key: 'active_customers', label: '当前开发客户', sortOrder: 30 }),
    defineField({ key: 'deferred_customers', label: '延期客户', sortOrder: 40 }),
    defineField({ key: 'threshold_customers', label: '需要主管关注', sortOrder: 50 }),
    defineField({ key: 'planned_after_deferred', label: '延期后形成计划', sortOrder: 60 }),
    defineField({ key: 'on_time_action', label: '计划后按时行动', sortOrder: 70 }),
    defineField({ key: 'first_touch_silent', label: '首次触达后未推进', sortOrder: 80 }),
    defineField({ key: 'unimproved_after_intervention', label: '协助后未改善', sortOrder: 90 }),
    defineField({ key: 'review_status', label: '复盘状态', sortOrder: 100 }),
  ]),
  // 通知中心：通知数据仍由服务端按收件人/AI 开关裁剪；目录只约束非敏感展示列。
  notifications: Object.freeze([
    defineField({ key: 'status', label: '状态', sortOrder: 10 }),
    defineField({ key: 'title', label: '通知', sortOrder: 20 }),
    defineField({ key: 'customer', label: '客户', sortOrder: 30 }),
    defineField({ key: 'detail', label: '详情', sortOrder: 40 }),
    defineField({ key: 'created_at', label: '时间', sortOrder: 50 }),
    defineField({ key: 'delivery', label: '投递', sortOrder: 60 }),
  ]),
  // CRM 客户列表：操作列属于前端动作，不是数据字段；其余可见列由有效 schema 门控。
  customers: Object.freeze([
    defineField({ key: 'company', label: '客户', sourceKey: 'company_name', sortOrder: 10 }),
    defineField({ key: 'country_industry', label: '国家 / 行业', sortOrder: 20 }),
    defineField({ key: 'stage', label: '阶段', sortOrder: 30 }),
    defineField({ key: 'owner', label: '负责人', sourceKey: 'owner_name', sortOrder: 40 }),
    defineField({ key: 'last_activity', label: '最近动作', sourceKey: 'last_activity_at', formatter: 'relative', sortOrder: 50 }),
    defineField({ key: 'next_action', label: '下一步', sortOrder: 60 }),
    defineField({ key: 'priority', label: '优先级', sortOrder: 70 }),
    defineField({ key: 'status', label: '状态', sortOrder: 80 }),
  ]),
  // 推进动作台明细列表：摘要卡片和行动过滤仍由页面负责，表格列由目录约束。
  pipeline: Object.freeze([
    defineField({ key: 'company', label: '客户', sourceKey: 'company_name', sortOrder: 10 }),
    defineField({ key: 'stage', label: '当前阶段·停留', sortOrder: 20 }),
    defineField({ key: 'next_action', label: '下一步·计划', sourceKey: 'next_action', sortOrder: 30 }),
    defineField({ key: 'owner', label: '负责人·星标', sourceKey: 'owner_name', sortOrder: 40 }),
  ]),
  // Research People 联系人列表：数据接口本身要求 view_contacts；目录只负责授权后
  // 的可选列集合，用户级显隐/顺序由前端 List widget 偏好单独保存。
  contacts: Object.freeze([
    defineField({ key: 'company', label: '客户', sourceKey: 'company_name', sortOrder: 10 }),
    defineField({ key: 'contact', label: '联系人', sourceKey: 'full_name', sensitive: true, sortOrder: 20, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'title_department', label: '职位 / 部门', sourceKey: 'title', sensitive: true, sortOrder: 30, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'level', label: '等级', sourceKey: 'contact_level', sensitive: true, sortOrder: 40, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'methods', label: '直接联系方式', sourceKey: 'methods_summary', sensitive: true, sortOrder: 50, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'status', label: '资料状态', sourceKey: 'sales_ready', sortOrder: 60, visibility: { permissions: ['view_contacts'] } }),
  ]),
  // Research Recon 情报列表：报告动作列由前端按权限组装；联系人摘要仍由 view_contacts 门控。
  recon: Object.freeze([
    defineField({ key: 'company', label: '客户', sourceKey: 'company_name', sortOrder: 10 }),
    defineField({ key: 'score_group', label: '评分 / 分组', sourceKey: 'score', sortOrder: 20 }),
    defineField({ key: 'profile', label: '客户画像', sourceKey: 'customer_type', sortOrder: 30 }),
    defineField({ key: 'opportunity', label: '需求与机会', sourceKey: 'opportunity_summary', sortOrder: 40 }),
    defineField({ key: 'contacts', label: '联系人', sourceKey: 'contacts_summary', sensitive: true, sortOrder: 50, visibility: { permissions: ['view_contacts'] } }),
  ]),
  // 不对口记录列表：动作列由前端授权动作组装，其余字段由同一目录约束布局可选列。
  recycle_bin: Object.freeze([
    defineField({ key: 'company', label: '客户', sourceKey: 'company_name', sortOrder: 10 }),
    defineField({ key: 'previous_owner', label: '原负责人', sourceKey: 'previous_owner_name', sortOrder: 20 }),
    defineField({ key: 'reason', label: '原因', sourceKey: 'recycle_reason', sortOrder: 30 }),
    defineField({ key: 'recycled_at', label: '回收时间', sourceKey: 'recycled_at', sortOrder: 40 }),
  ]),
  lead_flow: Object.freeze([]), // lead_flow 与 intake 共用同一目录（见 resolveFieldSchema 别名）
  // 客户完整资料（customer_profile）：数据源 getCustomerProfileData -> customerPool[0]（buildPoolCustomer）
  // 与 customers（历史跟进）+ reconResults + people + profileAccess 的合并结构。
  // section 分组与旧版 Index.html renderPoolDetails 的四段（身份与地区/业务画像与产品需求/联系渠道/合规来源与生命周期）
  // 对齐，补充产品关注与来源记录独立分组，便于 widget 按区块渲染。
  // 门控与现状一致：contact_* 由 view_contacts；deep_report/source_file 由 view_recon；
  // creatorName/customerSource 由 view_all_customers；AI 评价标签由 ai_stations 且非销售。
  customer_profile: Object.freeze([
    // —— 身份与地区 ——
    defineField({ key: 'customerId', label: '客户ID', section: 'identity_region', sortOrder: 10 }),
    defineField({ key: 'companyName', label: '公司名称', section: 'identity_region', sortOrder: 20 }),
    defineField({ key: 'russianName', label: '俄文名称', section: 'identity_region', sortOrder: 40 }),
    defineField({ key: 'englishName', label: '英文名称', section: 'identity_region', sortOrder: 50 }),
    defineField({ key: 'country', label: '国家', section: 'identity_region', sortOrder: 60 }),
    defineField({ key: 'city', label: '城市', section: 'identity_region', sortOrder: 70 }),
    defineField({ key: 'website', label: '官网', formatter: 'website', kind: 'website', section: 'identity_region', sortOrder: 80 }),
    defineField({ key: 'inn', label: 'INN', section: 'identity_region', sortOrder: 90 }),
    // —— 业务画像 ——
    defineField({ key: 'industry', label: '行业', section: 'business_profile', sortOrder: 10 }),
    defineField({ key: 'customerType', label: '客户类型', section: 'business_profile', sortOrder: 20 }),
    defineField({ key: 'description', label: '简介', section: 'business_profile', sortOrder: 30 }),
    defineField({ key: 'products', label: '产品需求', section: 'business_profile', sortOrder: 40 }),
    defineField({ key: 'rating', label: '评级', section: 'business_profile', sortOrder: 50 }),
    defineField({ key: 'currentPool', label: '当前分组', section: 'business_profile', sortOrder: 60 }),
    // —— 产品关注 ——
    defineField({ key: 'productFocus', label: '主推产品', section: 'product_focus', sortOrder: 10 }),
    defineField({ key: 'recommendedProducts', label: '推荐产品', section: 'product_focus', sortOrder: 20 }),
    // —— 联系渠道 ——
    defineField({ key: 'email', label: '邮箱', section: 'contact_channels', sensitive: true, sortOrder: 10, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'phone', label: '电话', section: 'contact_channels', sensitive: true, sortOrder: 20, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'contactCount', label: '联系人数量', section: 'contact_channels', sortOrder: 30, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'bestContactLevel', label: '最优联系人等级', section: 'contact_channels', sortOrder: 40, visibility: { permissions: ['view_contacts'] } }),
    defineField({ key: 'salesReadyContactCount', label: '可交付联系人', section: 'contact_channels', sortOrder: 60, visibility: { permissions: ['view_contacts'] } }),
    // —— 合规信息 ——
    defineField({ key: 'sanctionStatus', label: '制裁状态', formatter: 'sanction', section: 'compliance', sortOrder: 10 }),
    defineField({ key: 'riskStatus', label: '风险状态', section: 'compliance', sortOrder: 20 }),
    // —— 来源与记录 ——
    defineField({ key: 'deepReport', label: '深度报告', section: 'source_record', sortOrder: 30, visibility: { permissions: ['view_recon'] } }),
    defineField({ key: 'sourceFile', label: '来源文件', section: 'source_record', sortOrder: 40, visibility: { permissions: ['view_recon'] } }),
    defineField({ key: 'verified', label: '已验证', section: 'source_record', sortOrder: 80 }),
    defineField({ key: 'notes', label: '备注', section: 'source_record', sortOrder: 90 }),
    defineField({ key: 'createdAt', label: '创建时间', section: 'source_record', sortOrder: 100 }),
    defineField({ key: 'updatedAt', label: '更新时间', section: 'source_record', sortOrder: 110 }),
    defineField({ key: 'creatorName', label: '创建人', section: 'source_record', sortOrder: 120, visibility: { permissions: ['view_all_customers'] } }),
    defineField({ key: 'customerSource', label: '客户来源', section: 'source_record', sortOrder: 130, visibility: { permissions: ['view_all_customers'] } }),
  ]),
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
    section: field.section,
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
