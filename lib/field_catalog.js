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
  audit: Object.freeze([
    defineField({ key: 'created_at', label: '时间', required: true, sortOrder: 10 }),
    defineField({ key: 'operator', label: '操作人', sortOrder: 20 }),
    defineField({ key: 'action', label: '动作', required: true, sortOrder: 30 }),
    defineField({ key: 'object', label: '对象', sortOrder: 40 }),
    defineField({ key: 'detail', label: '详情', sortOrder: 50 }),
  ]),
  correction_history: Object.freeze([
    defineField({ key: 'source', label: '来源客户', sortOrder: 10 }),
    defineField({ key: 'target', label: '目标客户', sortOrder: 20 }),
    defineField({ key: 'milestone', label: '里程碑', sortOrder: 30 }),
    defineField({ key: 'reason', label: '原因', sortOrder: 40 }),
    defineField({ key: 'status', label: '状态', sortOrder: 50 }),
    defineField({ key: 'operator', label: '操作人', sortOrder: 60 }),
    defineField({ key: 'created_at', label: '时间', sortOrder: 70 }),
  ]),
  users: Object.freeze([
    defineField({ key: 'user', label: '用户', sortOrder: 10 }), defineField({ key: 'role', label: '角色', sortOrder: 20 }),
    defineField({ key: 'permission_group', label: '权限组', sortOrder: 30 }), defineField({ key: 'overrides', label: '个人调整', sortOrder: 40 }),
    defineField({ key: 'status', label: '状态', sortOrder: 50 }), defineField({ key: 'actions', label: '操作', required: true, sortOrder: 60 }),
  ]),
  archived_users: Object.freeze([
    defineField({ key: 'user', label: '用户', sortOrder: 10 }), defineField({ key: 'role', label: '角色', sortOrder: 20 }),
    defineField({ key: 'archived_at', label: '归档时间', sortOrder: 30 }), defineField({ key: 'actions', label: '操作', required: true, sortOrder: 40 }),
  ]),
  migration_review: Object.freeze([
    defineField({ key: 'source', label: '旧记录', sortOrder: 10 }), defineField({ key: 'owner', label: '原负责人', sortOrder: 20 }),
    defineField({ key: 'reason', label: '原因', sortOrder: 30 }), defineField({ key: 'assigned_owner', label: '分配销售', sortOrder: 40 }),
    defineField({ key: 'actions', label: '操作', required: true, sortOrder: 50 }),
  ]),
  intake_batches: Object.freeze([
    defineField({ key: 'batch_date', label: '日期', sortOrder: 10 }),
    defineField({ key: 'source', label: '来源', sortOrder: 20 }),
    defineField({ key: 'candidates', label: '候选', sortOrder: 30 }),
    defineField({ key: 'imported', label: '入库', sortOrder: 40 }),
    defineField({ key: 'assigned', label: '已分配', sortOrder: 50 }),
    defineField({ key: 'skipped', label: '跳过', sortOrder: 60 }),
    defineField({ key: 'status', label: '状态', sortOrder: 70 }),
  ]),
  permission_groups: Object.freeze([
    defineField({ key: 'group', label: '权限组', sortOrder: 10 }),
    defineField({ key: 'role', label: '角色', sortOrder: 20 }),
    defineField({ key: 'permissions', label: '权限', sortOrder: 30 }),
    defineField({ key: 'members', label: '成员', sortOrder: 40 }),
    defineField({ key: 'actions', label: '操作', required: true, sortOrder: 50 }),
  ]),
  maintenance_runs: Object.freeze([
    defineField({ key: 'created_at', label: '时间', sortOrder: 10 }),
    defineField({ key: 'operator', label: '操作人', sortOrder: 20 }),
    defineField({ key: 'status', label: '状态', sortOrder: 30 }),
    defineField({ key: 'target', label: '目标', sortOrder: 40 }),
    defineField({ key: 'backup', label: '备份', sortOrder: 50 }),
  ]),
  protected_customers: Object.freeze([
    defineField({ key: 'external_customer_id', label: '客户ID', sortOrder: 10 }),
    defineField({ key: 'alpha_nickname', label: 'Alpha 昵称', sortOrder: 20 }),
    defineField({ key: 'crm_nickname', label: 'CRM 昵称', sortOrder: 30 }),
    defineField({ key: 'company_name', label: '公司', sortOrder: 40 }),
    defineField({ key: 'country', label: '国家', sortOrder: 50 }),
    defineField({ key: 'city', label: '城市', sortOrder: 60 }),
    defineField({ key: 'website', label: '官网', formatter: 'website', kind: 'website', sortOrder: 70 }),
    defineField({ key: 'industry', label: '行业', sortOrder: 80 }),
    defineField({ key: 'customer_type', label: '客户类型', sortOrder: 90 }),
    defineField({ key: 'product_focus', label: '产品方向', sortOrder: 100 }),
    defineField({ key: 'status', label: '状态', sortOrder: 110 }),
    defineField({ key: 'batch_id', label: '批次', sortOrder: 120 }),
    defineField({ key: 'created_at', label: '创建时间', sortOrder: 130 }),
    defineField({ key: 'activated_at', label: '激活时间', sortOrder: 140 }),
    defineField({ key: 'updated_at', label: '更新时间', sortOrder: 150 }),
  ]),
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
    defineField({ key: 'pool_domain', label: '客户域名', sortOrder: 180 }),
    defineField({ key: 'pool_customer_id', label: '客户主档ID', sortOrder: 181 }),
    defineField({ key: 'pool_company_name', label: '主档公司名', sortOrder: 182 }),
    defineField({ key: 'pool_nickname', label: '客户简称', sortOrder: 190 }),
    defineField({ key: 'pool_russian_name', label: '俄文名称', sortOrder: 200 }),
    defineField({ key: 'pool_english_name', label: '英文名称', sortOrder: 210 }),
    defineField({ key: 'pool_country', label: '主档国家', sortOrder: 211 }),
    defineField({ key: 'pool_city', label: '主档城市', sortOrder: 212 }),
    defineField({ key: 'pool_website', label: '主档官网', formatter: 'website', kind: 'website', sortOrder: 213 }),
    defineField({ key: 'pool_industry', label: '主档行业', sortOrder: 214 }),
    defineField({ key: 'pool_customer_type', label: '主档客户类型', sortOrder: 215 }),
    defineField({ key: 'pool_established_year', label: '成立年份', sortOrder: 220 }),
    defineField({ key: 'pool_description', label: '客户简介', visibility: { permissions: ['view_contacts', 'view_recon'] }, sortOrder: 230 }),
    defineField({ key: 'pool_products', label: '产品需求', visibility: { permissions: ['view_contacts', 'view_recon'] }, sortOrder: 240 }),
    defineField({ key: 'pool_rating', label: '评级', sortOrder: 245 }),
    defineField({ key: 'pool_current_pool', label: '当前分组', sortOrder: 246 }),
    defineField({ key: 'pool_assigned_to', label: '线索池分配人', sortOrder: 247 }),
    defineField({ key: 'pool_assigned_at', label: '线索池分配时间', sortOrder: 248 }),
    defineField({ key: 'pool_country_code', label: '国家代码', sortOrder: 249 }),
    defineField({ key: 'pool_phone', label: '电话', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 250 }),
    defineField({ key: 'pool_email', label: '邮箱', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 260 }),
    defineField({ key: 'pool_email_raw', label: '原始邮箱', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 261 }),
    defineField({ key: 'pool_inn', label: 'INN', sortOrder: 270 }),
    defineField({ key: 'pool_risk_status', label: '风险状态', sortOrder: 280 }),
    defineField({ key: 'pool_website_verification', label: '官网核验', sortOrder: 290 }),
    defineField({ key: 'pool_contact_count', label: '联系人数量', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 300 }),
    defineField({ key: 'pool_deep_report', label: '深度报告', visibility: { permissions: ['view_contacts', 'view_recon'] }, sortOrder: 310 }),
    defineField({ key: 'pool_source_file', label: '来源文件', visibility: { permissions: ['view_contacts', 'view_recon'] }, sortOrder: 320 }),
    defineField({ key: 'pool_first_found', label: '首次发现', sortOrder: 330 }),
    defineField({ key: 'pool_last_found', label: '最近发现', sortOrder: 340 }),
    defineField({ key: 'pool_search_count', label: '搜索次数', sortOrder: 350 }),
    defineField({ key: 'pool_verified', label: '已验证', sortOrder: 360 }),
    defineField({ key: 'pool_notes', label: '备注', visibility: { permissions: ['view_contacts', 'view_recon'] }, sortOrder: 370 }),
    defineField({ key: 'pool_created_at', label: '资料创建时间', sortOrder: 380 }),
    defineField({ key: 'pool_updated_at', label: '资料更新时间', sortOrder: 390 }),
    defineField({ key: 'pool_best_contact_level', label: '最优联系人等级', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 391 }),
    defineField({ key: 'pool_best_person_id', label: '最佳联系人ID', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 392 }),
    defineField({ key: 'pool_sales_ready_contact_count', label: '可交付联系人', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 393 }),
    defineField({ key: 'pool_contact_recon_status', label: '联系人核验状态', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 394 }),
    defineField({ key: 'pool_contact_last_checked_at', label: '联系人最近核验', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 395 }),
    defineField({ key: 'pool_contact_next_action', label: '联系人下一步', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 396 }),
    defineField({ key: 'created_by', label: '创建人', visibility: { permissions: ['view_all_customers'] }, sortOrder: 400 }),
    defineField({ key: 'source', label: '客户来源', visibility: { permissions: ['view_all_customers'] }, sortOrder: 410 }),
    defineField({ key: 'product_focus', label: '主推产品', sortOrder: 420 }),
    defineField({ key: 'owner_id', label: '负责人ID', sortOrder: 440 }),
    defineField({ key: 'created_at', label: '创建时间', sortOrder: 450 }),
    defineField({ key: 'updated_at', label: '更新时间', sortOrder: 460 }),
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
  // Team 业务推进销售汇总：仅包含真实业务推进/主管协作统计，动作列由页面固定。
  team_progress_sales: Object.freeze([
    defineField({ key: 'owner', label: '销售', sortOrder: 10 }),
    defineField({ key: 'sample', label: '样本', sortOrder: 20 }),
    defineField({ key: 'progress_rate', label: '推进率', sortOrder: 30 }),
    defineField({ key: 'progressed_customers', label: '真实推进', sortOrder: 40 }),
    defineField({ key: 'silent_customers', label: '持续沉默', sortOrder: 50 }),
    defineField({ key: 'repeated_deferred_customers', label: '反复延期', sortOrder: 60 }),
    defineField({ key: 'plans_formed_customers', label: '形成计划', sortOrder: 70 }),
    defineField({ key: 'actions_after_plan_customers', label: '计划后行动', sortOrder: 80 }),
    defineField({ key: 'overdue_manager_tasks', label: '主管逾期', sortOrder: 90 }),
    defineField({ key: 'escalated_manager_tasks', label: '已升级', sortOrder: 100 }),
  ]),
  // Team 推进明细：客户、主管待办和事实时间线共用只读字段；动作仍由页面负责。
  team_progress_drilldown: Object.freeze([
    defineField({ key: 'company', label: '客户', sortOrder: 10 }),
    defineField({ key: 'customer_id', label: '客户ID', sortOrder: 20 }),
    defineField({ key: 'owner', label: '负责人', sortOrder: 30 }),
    defineField({ key: 'country', label: '国家', sortOrder: 40 }),
    defineField({ key: 'stage', label: '阶段', sortOrder: 50 }),
    defineField({ key: 'facts', label: '推进事实', sortOrder: 60 }),
    defineField({ key: 'task_reason', label: '待办原因', sortOrder: 70 }),
    defineField({ key: 'status', label: '状态', sortOrder: 80 }),
    defineField({ key: 'kind', label: '事实类型', sortOrder: 90 }),
    defineField({ key: 'detail', label: '事实详情', sortOrder: 100 }),
    defineField({ key: 'occurred_at', label: '发生时间', sortOrder: 110 }),
  ]),
  // Team 协作记录：只读协作事实字段；补记/更正/撤销动作由页面固定。
  team_collaboration: Object.freeze([
    defineField({ key: 'sales_user', label: '销售', sortOrder: 10 }),
    defineField({ key: 'customer', label: '客户', sortOrder: 20 }),
    defineField({ key: 'status', label: '状态', sortOrder: 30 }),
    defineField({ key: 'source', label: '来源', sortOrder: 40 }),
    defineField({ key: 'relation', label: '记录关系', sortOrder: 50 }),
    defineField({ key: 'problem', label: '问题', sortOrder: 60 }),
    defineField({ key: 'suggestion', label: '建议', sortOrder: 70 }),
    defineField({ key: 'outcome', label: '结果', sortOrder: 80 }),
    defineField({ key: 'next_step', label: '下一步', sortOrder: 90 }),
    defineField({ key: 'created_at', label: '创建时间', sortOrder: 100 }),
    defineField({ key: 'actions', label: '操作', sortOrder: 110 }),
  ]),
  // Insights 人工企业经营评价列表：只读人工事实，AI 标签/摘要不进入目录；操作列由页面固定。
  insights: Object.freeze([
    defineField({ key: 'company', label: '客户', sortOrder: 10 }),
    defineField({ key: 'stage', label: '阶段', sortOrder: 20 }),
    defineField({ key: 'country', label: '国家', sortOrder: 30 }),
    defineField({ key: 'owner', label: '负责人', sortOrder: 40 }),
    defineField({ key: 'evaluation_status', label: '评价状态', sortOrder: 50 }),
    defineField({ key: 'evaluation_text', label: '经营评价', sortOrder: 60 }),
    defineField({ key: 'evaluation_count', label: '评价数量', sortOrder: 70 }),
    defineField({ key: 'evaluated_at', label: '最近评价时间', sortOrder: 80 }),
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
    defineField({ key: 'external_customer_id', label: '客户ID', sortOrder: 81 }),
    defineField({ key: 'nickname', label: 'CRM简称', sortOrder: 82 }),
    defineField({ key: 'russian_name', label: 'CRM俄文名称', sortOrder: 83 }),
    defineField({ key: 'english_name', label: 'CRM英文名称', sortOrder: 84 }),
    defineField({ key: 'city', label: '城市', sortOrder: 85 }),
    defineField({ key: 'website', label: '官网', formatter: 'website', kind: 'website', sortOrder: 86 }),
    defineField({ key: 'customer_type', label: '客户类型', sortOrder: 87 }),
    defineField({ key: 'established_year', label: '成立年份', sortOrder: 88 }),
    defineField({ key: 'manager_id', label: '主管ID', sortOrder: 89 }),
    defineField({ key: 'manager_required', label: '需要主管', sortOrder: 90 }),
    defineField({ key: 'manager_status', label: '主管状态', sortOrder: 91 }),
    defineField({ key: 'next_action_at', label: '下一步计划时间', sortOrder: 92 }),
    defineField({ key: 'next_action_time_basis', label: '计划时间基准', sortOrder: 93 }),
    defineField({ key: 'loss_reason', label: '流失原因', visibility: { permissions: ['view_recon'] }, sortOrder: 94 }),
    defineField({ key: 'lifecycle_status', label: '生命周期状态', sortOrder: 94.5 }),
    defineField({ key: 'intake_item_id', label: '线索ID', sortOrder: 95 }),
    defineField({ key: 'assignment_status', label: '分配状态', sortOrder: 96 }),
    defineField({ key: 'assigned_at', label: '分配时间', sortOrder: 97 }),
    defineField({ key: 'claim_due_at', label: '领取截止', sortOrder: 98 }),
    defineField({ key: 'claimed_at', label: '领取时间', sortOrder: 99 }),
    defineField({ key: 'first_claimed_by', label: '首次领取人', sortOrder: 100 }),
    defineField({ key: 'first_claimed_at', label: '首次领取时间', sortOrder: 101 }),
    defineField({ key: 'return_reason', label: '退回原因', visibility: { permissions: ['view_recon'] }, sortOrder: 102 }),
    defineField({ key: 'recycle_kind', label: '回收类型', sortOrder: 103 }),
    defineField({ key: 'recycle_reason', label: '回收原因', visibility: { permissions: ['view_recon'] }, sortOrder: 104 }),
    defineField({ key: 'recycled_by', label: '回收人', sortOrder: 105 }),
    defineField({ key: 'recycled_at', label: '回收时间', sortOrder: 106 }),
    defineField({ key: 'previous_owner_id', label: '原负责人ID', sortOrder: 107 }),
    defineField({ key: 'pool_domain', label: '客户域名', sortOrder: 90 }),
    defineField({ key: 'pool_customer_id', label: '客户主档ID', sortOrder: 91 }),
    defineField({ key: 'pool_company_name', label: '主档公司名', sortOrder: 92 }),
    defineField({ key: 'pool_nickname', label: '客户简称', sortOrder: 100 }),
    defineField({ key: 'pool_russian_name', label: '俄文名称', sortOrder: 110 }),
    defineField({ key: 'pool_english_name', label: '英文名称', sortOrder: 120 }),
    defineField({ key: 'pool_country', label: '主档国家', sortOrder: 121 }),
    defineField({ key: 'pool_city', label: '主档城市', sortOrder: 122 }),
    defineField({ key: 'pool_website', label: '主档官网', formatter: 'website', kind: 'website', sortOrder: 123 }),
    defineField({ key: 'pool_industry', label: '主档行业', sortOrder: 124 }),
    defineField({ key: 'pool_customer_type', label: '主档客户类型', sortOrder: 125 }),
    defineField({ key: 'pool_established_year', label: '成立年份', sortOrder: 130 }),
    defineField({ key: 'pool_description', label: '客户简介', visibility: { permissions: ['view_contacts', 'view_recon'] }, sortOrder: 140 }),
    defineField({ key: 'pool_products', label: '产品需求', visibility: { permissions: ['view_contacts', 'view_recon'] }, sortOrder: 150 }),
    defineField({ key: 'pool_rating', label: '评级', sortOrder: 155 }),
    defineField({ key: 'pool_current_pool', label: '当前分组', sortOrder: 156 }),
    defineField({ key: 'pool_assigned_to', label: '线索池分配人', sortOrder: 157 }),
    defineField({ key: 'pool_assigned_at', label: '线索池分配时间', sortOrder: 158 }),
    defineField({ key: 'pool_country_code', label: '国家代码', sortOrder: 159 }),
    defineField({ key: 'pool_phone', label: '电话', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 160 }),
    defineField({ key: 'pool_email', label: '邮箱', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 170 }),
    defineField({ key: 'pool_email_raw', label: '原始邮箱', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 171 }),
    defineField({ key: 'pool_inn', label: 'INN', sortOrder: 180 }),
    defineField({ key: 'pool_risk_status', label: '风险状态', sortOrder: 190 }),
    defineField({ key: 'pool_website_verification', label: '官网核验', sortOrder: 200 }),
    defineField({ key: 'pool_contact_count', label: '联系人数量', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 210 }),
    defineField({ key: 'pool_deep_report', label: '深度报告', visibility: { permissions: ['view_contacts', 'view_recon'] }, sortOrder: 220 }),
    defineField({ key: 'pool_source_file', label: '来源文件', visibility: { permissions: ['view_contacts', 'view_recon'] }, sortOrder: 230 }),
    defineField({ key: 'pool_first_found', label: '首次发现', sortOrder: 240 }),
    defineField({ key: 'pool_last_found', label: '最近发现', sortOrder: 250 }),
    defineField({ key: 'pool_search_count', label: '搜索次数', sortOrder: 260 }),
    defineField({ key: 'pool_verified', label: '已验证', sortOrder: 270 }),
    defineField({ key: 'pool_notes', label: '备注', visibility: { permissions: ['view_contacts', 'view_recon'] }, sortOrder: 280 }),
    defineField({ key: 'pool_created_at', label: '资料创建时间', sortOrder: 290 }),
    defineField({ key: 'pool_updated_at', label: '资料更新时间', sortOrder: 300 }),
    defineField({ key: 'pool_best_contact_level', label: '最优联系人等级', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 301 }),
    defineField({ key: 'pool_best_person_id', label: '最佳联系人ID', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 302 }),
    defineField({ key: 'pool_sales_ready_contact_count', label: '可交付联系人', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 303 }),
    defineField({ key: 'pool_contact_recon_status', label: '联系人核验状态', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 304 }),
    defineField({ key: 'pool_contact_last_checked_at', label: '联系人最近核验', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 305 }),
    defineField({ key: 'pool_contact_next_action', label: '联系人下一步', sensitive: true, visibility: { permissions: ['view_contacts'] }, sortOrder: 306 }),
    defineField({ key: 'created_by', label: '创建人', visibility: { permissions: ['view_all_customers'] }, sortOrder: 310 }),
    defineField({ key: 'source', label: '客户来源', visibility: { permissions: ['view_all_customers'] }, sortOrder: 320 }),
    defineField({ key: 'product_focus', label: '主推产品', sortOrder: 330 }),
    defineField({ key: 'owner_id', label: '负责人ID', sortOrder: 350 }),
    defineField({ key: 'created_at', label: '创建时间', sortOrder: 360 }),
    defineField({ key: 'updated_at', label: '更新时间', sortOrder: 370 }),
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

const CUSTOMER_DETAIL_LIST_FIELDS = new Set([
  'external_customer_id', 'nickname', 'russian_name', 'english_name', 'city', 'website',
  'customer_type', 'established_year', 'manager_id', 'manager_required', 'manager_status',
  'next_action_at', 'next_action_time_basis', 'loss_reason', 'intake_item_id',
  'assignment_status', 'assigned_at', 'claim_due_at', 'claimed_at', 'first_claimed_by',
  'first_claimed_at', 'return_reason', 'recycle_kind', 'recycle_reason', 'recycled_by',
  'recycled_at', 'previous_owner_id', 'pool_customer_id', 'pool_domain', 'pool_company_name',
  'pool_nickname', 'pool_russian_name', 'pool_english_name', 'pool_country', 'pool_city',
  'pool_website', 'pool_industry', 'pool_customer_type', 'pool_established_year', 'pool_description',
  'pool_products', 'pool_rating', 'pool_current_pool', 'pool_assigned_to', 'pool_assigned_at',
  'pool_country_code', 'pool_phone', 'pool_email', 'pool_email_raw', 'pool_inn',
  'pool_risk_status', 'pool_website_verification', 'pool_contact_count', 'pool_deep_report',
  'pool_source_file', 'pool_first_found', 'pool_last_found', 'pool_search_count', 'pool_verified',
  'pool_notes', 'pool_created_at', 'pool_updated_at', 'created_by', 'source', 'product_focus',
  'owner_id', 'created_at', 'updated_at',
  'lifecycle_status',
]);

// 按 角色 + 权限 + 运行时开关 计算某个页面的有效字段 schema。
function effectiveFieldSchema({ pageKey, user, permissions = {}, features = {} }) {
  const resolvedPage = pageKey === 'lead_flow' ? 'intake' : pageKey;
  const catalog = FIELDS_CATALOG[resolvedPage];
  if (!catalog) return null;
  const role = user?.role || '';
  const fields = catalog
    .filter(field => isFieldVisible(field, role, permissions, features))
    // 客户全景的扩展字段属于“可见客户主档”范围；销售仍保留原 8 列，
    // 管理账号拥有 view_all_customers 时可在列设置中自由取舍全部字段。
    .filter(field => resolvedPage !== 'customers'
      || permissions.view_all_customers
      || !CUSTOMER_DETAIL_LIST_FIELDS.has(field.key))
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
