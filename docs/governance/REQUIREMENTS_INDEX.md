# TradePulse 需求索引

更新时间：2026-08-27
基线：`origin/main@57c4c42a89e7730545b726b29fd932c5bfb20574`（已 `git fetch origin --prune`）
状态：条目级索引 v1；以最新代码、测试、可重复验证为准，`docs/planning` v2.0 仅作历史背景（见 `PLANNING_SUPPLEMENT.md`）

## 需求来源优先级

1. 用户当前明确要求
2. 当前产品边界和核心不变量（`PROJECT_CHARTER.md`）
3. 最新主线代码和可重复验证结果
4. 已批准的设计/规划文档
5. 自动化测试和验收证据
6. 历史 HANDOFF、旧 Issue 和兼容逻辑

来源冲突时不自行选择；必须记录冲突、影响和待确认项。

## 条目总览

| 编号 | 主题 | 角色 | 当前实现 | 可信度 | 关键证据 |
|---|---|---|---|---|---|
| REQ-001 | 身份与权限 | admin/manager/sales | 已实现 | 高 | `lib/access_control.js` `lib/permission_groups.js` `PERMISSION_DEFINITIONS 30+` `SALES_ROUTE_POLICIES deny-by-default` |
| REQ-002 | 客户主数据与受保护标识 | admin/manager/sales | 已实现 | 高 | `customer_pool / customers / crm_accounts.external_customer_id` `lib/db.js` `issue-96/158/172/184/188` |
| REQ-003 | CRM 账户与归属 | admin/manager/sales | 已实现 | 高 | `crm_accounts(owner_id/created_by/nickname)` `accountScope/buildAccessContext` `issue-109/147/232/246` |
| REQ-004 | 生命周期与活动历史 | sales/manager | 已实现 | 高 | `ACTIVITY_STAGE + advanceStage` `crm_activities` `issue-171有效历史重建 + 活动纠错` |
| REQ-005 | RFQ/报价/订单边界 | sales/manager | 已实现 | 高 | `crm_rfqs/crm_quotes/crm_orders/crm_commerce_action_requests` `S1-05` |
| REQ-006 | 线索入库与分配 | admin/manager/sales | 已实现 | 高 | `crm_intake_*` `scanDailyIntake/arbitrateCandidate` `issue-138/141/142/143/145/212/221/224` |
| REQ-007 | 任务与推进（含延期计划/经理介入） | sales/manager | 已实现 | 高 | `next_action/next_action_at` `buildAlerts/groupAlerts` `issue-149/157/168/170/243/265` |
| REQ-008 | 回收与退回 | sales/manager/admin | 已实现 | 高 | `lifecycle_status/recycle_kind` `return/bulkReturn/trash/restore/reassign` `issue-188/209/241/324` |
| REQ-009 | 联系人与证据脱敏 | sales/manager/admin | 已实现 | 高 | `crm_account_contacts/person_*` `CONTACT_KEYS redaction` `research_filters.js` `issue-161` |
| REQ-010 | Recon 调研 | admin/manager | 已实现 | 中高 | `recon_jobs/results/evidence` `recon_agent_worker.py` `contracts/recon-result-v3` |
| REQ-011 | AI Station | admin/manager/sales | 已实现，不纳入本次重构 | 高 | `lib/ai_stations/**` `crm_ai_*` `CRM_AI_*` 开关；`A1-A4 已发布 296edd2/634372f`；`feature_flags.js` + capabilities `features.aiStations` |
| REQ-012 | 交付与通知 | system/sales | 已实现 | 中 | `reports/daily` `crm_notifications/deliveries` `scripts/generate-*` |
| REQ-013 | 筛选授权 | admin/manager/sales | 已实现 | 高 | `filter_definitions/filter_catalog/filter_authorization` `issue-116/148/229` `FILTER_VERSION_CONFLICT` |
| REQ-014 | 部署与发布 | ops | 已实现 | 高 | `deploy/` `release_health.js` `issue-175/181` `DEPLOY_ROOT/current->releases/<sha>` |
| REQ-015 | 客户完整资料统一视图 | sales/manager/admin | 需重构 | 高 | `sales-crm.html#customerProfileView` iframe `/development-workbench`（旧版 `Index.html`）+ `#customerDrawer`；`server.js` `sales-assets/app.js`；用户 2026-08-27 明确要求 |
| REQ-016 | 前端 widget 组合架构 | admin/manager/sales | 需重构 | 高 | `sales-assets/filter-component.js` 组件范式；`data-permission`/`data-ai-business` 显隐；用户 2026-08-27 明确要求 |
| REQ-017 | 字段级自由显示 | admin/manager/sales | 需重构 | 高 | `filter_catalog.js` 字段定义范式；`CONTACT_KEYS`/`CONTACT_SAFE_*_KEYS`；用户 2026-08-27 明确要求 |
| REQ-016 | 前端 widget 组合架构 | 前端全局 | 需重构 | 高 | widget 注册表 + 页面配置化组装；复用 `data-permission`/`data-ai-business`；`sales-assets/filter-component.js` 为现有组件范式；用户 2026-08-27 明确要求 |

## 已废弃/仅兼容

| 主题 | 说明 | 影响 |
|---|---|---|
| 前端模块化重构发布 90/91 | 已被 `92 Revert` 回滚，不在当前主线 | 不作为重构目标；当前前端演进为 V3 studio/deck 增量 |
| 旧 API `/api/customers` 等 | 仍保留兼容，未纳入统一筛选体系 | 通过防腐层隔离，不污染 ` /api/sales-crm/*` |
| `rejected` 统计口径 | `issue-264` 后已清理 | 线索池仅 `actionable` 范围 |
| 旧版工作台 `Index.html`（含 `/development-workbench`） | 与统一壳并存，客户完整资料通过 iframe 嵌入旧版页面，双用途 | 本次重构把客户完整资料收敛为统一壳内 widget 组合视图，旧版收敛为兼容入口 |
| `tradelead-v2.html` | 旧版第二套入口 | 保持兼容，不作为新功能载体 |
| AI 内容（`lib/ai_stations/**`、`crm_ai_*`） | 由 `CRM_AI_*` 环境开关 + `ai_stations` 运行时开关控制显示和执行 | **完全不触碰**：不删除、不迁移、不搬运，`sales_crm.js` 中触发点留在原位置；前端登记为 widget 按开关显示 |

## 逐条记录

### REQ-001 身份与权限
- 业务目标：同一套账号、权限组、行级范围覆盖所有 CRM 能力
- 包含：`view_dashboard/view_intake/view_customers/view_all_customers/manage_intake/create_customer/edit_customer/record_activity/quote/order/manage_customer_recycle/manage_manual_customer_deletion/manage_evaluations/run_recon/view_contacts/view_recon/view_pipeline/view_alerts/view_insights/view_team/view_markets/use_ai_assistant` 等
- 排除：第二套账号体系
- 状态/数据影响：`sales_users/permission_groups/user_permission_overrides`；`buildAccessContext` 决定 `accountIds/externalCustomerIds`
- 权限影响：`adminOnly/realAdminOnly/blockedWhileImpersonating` 由中间件统一
- API 影响：`SALES_ROUTE_POLICIES` 未登记即 deny
- 验收：三角色隔离测试、`permission_integration` 通过
- 来源：`access_control.js` + planning A1-A4

### REQ-002 客户主数据与受保护标识
- 包含：`customer_pool` 主档、`customers` 兼容、`crm_accounts.external_customer_id` 关联、受保护标识预检/冲突裁决/退役名称
- 验收：`issue-172/184` 专项；重复客户 `409 CUSTOMER_DUPLICATE`
- 冲突：`customer_pool` 与 `crm_accounts` 的“主档 vs 账户”双写由 `external_customer_id` 关联收敛

### REQ-003 CRM 账户与归属
- 包含：昵称、创建者保留、owner 变更、`assignment_status`、`customer_tags/tags.category` 授权过滤
- 验收：`issue-109/147/232/246/329` 相关回归

### REQ-004 生命周期与活动
- 包含：`stage` 投影、`crm_activities.stage_after/manager_required`、有效历史重建、活动纠错审计
- 规则：`ACTIVITY_STAGE 12 映射` + `advanceStage 只向前`；`lost` 需显式动作；重分配 `lost->qualified` 恢复
- 验收：`issue-171/292/265`；`buildAlerts` 不作为阶段真源

### REQ-005 RFQ/报价/订单
- 包含：BOM 行数/金额/币种/毛利校验、`crm_commerce_action_requests` 幂等、订单必须绑定同客户报价
- 约束：AI 不直接写金额/订单
- 验收：`A3-05` 专项

### REQ-006 线索入库与分配
- 包含：批次扫描、候选销售、`chooseIntakeOwner/arbitrateCandidate`、`crm_intake_action_requests` 幂等、`duplicate` 触发器同步
- 验收：`issue-138/141/142/143/145/212/221`；`assigned -> claimed -> returned/rejected/duplicate` 状态机

### REQ-007 任务与推进
- 包含：`next_action`、`buildAlerts/groupAlerts` 分组、`deferred plan/manager intervention`、今日任务闭环、`disqualified` 阶段
- 验收：`issue-149/157/168/170/241/243/265/301/303/304`

### REQ-008 回收与退回
- 包含：`lifecycle_status=recycled`、`recycle_kind=sales_return/manual_delete`、`return/bulkReturn/trash/restore/reassign`、`crm_audit_log`
- 验收：`issue-188/209/241/273/276/281/324`

### REQ-009 联系人与证据
- 包含：`crm_account_contacts`、`person_candidates/evidence/methods`、`CONTACT_KEYS` 递归脱敏、`research_filters`
- 验收：`issue-161`；无 `view_contacts` 时字段不可见

### REQ-010 Recon
- 包含：任务领取、Hermes 执行、V3 封装、证据回填、HTML 报告分享
- 验收：`recon-results-contract` 测试；分享链接 `noindex/nofollow`

### REQ-011 AI Station（不纳入本次重构）
- 业务目标：AI 任务、模型调用、预算、治理和结果以开关控制显示和执行
- 包含：8 工作站、Control Plane 持久队列/lease/并发/预算、上下文 adapter、候选快照、context hash
- 范围约束：`lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 环境开关与 `ai_stations` 运行时开关**保持原样**；本次重构不迁移、不删除、不简化
- 触发点约束：领域抽离若必须移动 `sales_crm.js` 中既有 AI 触发点，只做原样搬运并跑通既有测试
- 验收：`A1-A4` 全量 `535/535`（历史记录）；当前仅需保持开关语义与降级行为不变
- 冲突：无

### REQ-015 客户完整资料界面统一（本次重构新增）
- 业务目标：客户完整资料成为统一壳的第一方视图，不再依赖旧版 iframe
- 现状：`sales-crm.html#customerProfileView` 通过 `/development-workbench?embedded=1&profile=1&...` iframe 加载旧版 `Index.html`；`Index.html` 同一页面承担旧工作台与资料页两种用途，客户资料不是独立底层
- 包含：客户/线索/回收三类资料统一视图、权限与脱敏、抽屉共用同一数据源
- 验收：资料页不再加载 `/development-workbench`；三角色权限、联系人/洞察脱敏、标签授权行为与现状一致
- 来源：用户 2026-08-27 明确要求
- **重构范围**：不纳入本次重构。`lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 开关原样保留；既有 AI 触发点若在领域抽离中必须移动，只做原样搬运 + 冒烟验证

### REQ-015 客户完整资料统一视图
- 业务目标：客户完整资料收敛为单一 UI 层，消除旧版 `Index.html` iframe 依赖和双脚本切片
- 包含：`sales-crm.html#customerProfileView`、`#customerDrawer`、`profile-contacts.js`、`profile-insights.js`、`/development-workbench?profile=1`、`/legacy`、`/tradelead-v2.html`（`CRM_ENABLE_LEGACY` 控制）
- 排除：不重做 V3 studio/deck 视觉；不新增表
- 状态/数据影响：无新表；复用 `/api/sales-crm/profile/:customerId`、`/intake/:itemId/profile`、tag-history 等既有契约
- 权限影响：保留 `view_customers`/`view_intake` 边界；联系人/洞察脱敏不变
- 验收：完整资料不再依赖 iframe；联系人管理、洞察/评价在统一视图可用；三角色权限一致；旧入口关闭不影响主流程
- 来源：用户 2026-08-27 明确要求 + `server.js`/`sales-crm.html`/`Index.html`/`sales-assets/app.js` 取证

### REQ-016 前端 widget 组合架构（本次重构新增）
- 业务目标：前端模块化、可自由搭建、可自由选择显示内容；后续前端显示/交互 issue 只需改对应 widget 或注册表配置
- 现状：`sales-assets/app.js` 约 1.4 万行承担统一壳几乎所有渲染逻辑；已有 `filter-component.js` 独立 UMD 组件范式；已有 `[data-permission]` / `[data-ai-business]` 显隐机制
- 包含：Widget 注册表（id/页面/权限/开关/位置/顺序）、页面配置化组装、客户资料 widget 集合、AI 区域作为开关控制 widget
- 验收：新增/隐藏前端内容只改配置或对应 widget，`app.js` 无需整体改动；权限与开关显隐行为与现状一致
- 来源：用户 2026-08-27 明确要求

### REQ-017 字段级自由显示（本次重构新增）
- 业务目标：不止 UI 结构，线索池、客户资料、客户列表等页面的**字段内容**可自由显示/隐藏
- 现状：`filter_catalog.js` 已有字段级定义范式（key/label/sensitive/requiredPermissions/pages）；`access_control.js` 有 `CONTACT_KEYS` 黑名单与 `CONTACT_SAFE_*_KEYS` 白名单；前端列表/详情字段渲染硬编码在 `app.js`
- 包含：字段目录（FIELDS_CATALOG，具体定义见 `FIELD_CATALOG.md`）、服务端按 角色+权限+开关 计算有效字段 schema（per-page/per-user/版本化，`/field-schema/:pageKey` + `FIELD_SCHEMA_VERSION_CONFLICT`）、Widget 按 schema 渲染、字段级白名单投影替换黑名单
- 试点顺序：线索池（intake/lead_flow）-> 客户资料（profile）-> 客户列表（customers）
- 验收：线索池/客户资料/客户列表等页面的字段显隐可通过配置调整，无需改代码；未授权字段不下发数据；字段 schema 与筛选 schema 同源；AI 关闭时 AI 字段组不显示且回退字段生效
- 来源：用户 2026-08-27 明确要求

### REQ-012 交付与通知
- 包含：`reports/daily/YYYY-MM-DD/01-sales-ready-L3.csv`、5 分钟 completion notifier、`crm_notifications` web/wecom 双通道
- 验收：`delivery:generate` + tunnel 分享

### REQ-013 筛选授权
- 包含：`filter_definitions/pages/requiredPermissions/sensitive/displayMode`、`permission_group_filter_grants/user_filter_extra_grants`、`filter_permission_state.version`、`FILTER_VERSION_CONFLICT`
- 验收：`issue-116/148/229`；` /api/sales-crm/filter-schema/:pageKey` + `/lists/:pageKey`

### REQ-014 部署与发布
- 包含：`DEPLOY_ROOT/current->releases/<12-char-sha>`、`git archive` 无 `.git`、`.release-sha`、`state.json`、`.backup`、`/healthz SHA/database`、LaunchAgent 8 项
- 验收：`issue-175/181`；回滚 `current->previous` 原子切换

## 冲突与待确认（已记录，未阻塞重构）

- `crm_accounts` 投影字段 vs `crm_activities` 有效历史：目标以事件推导为准，当前部分统计仍直接读投影（见 `TARGET_ARCHITECTURE.md 6`）
- `CONTACT_KEYS` 黑名单脱敏待改为字段目录白名单投影（见 `TARGET_ARCHITECTURE.md 7.5`、`RISK_REGISTER R-005`）
- AI 与核心 CRM 的写入边界已通过开关隔离；AI 内容不纳入本次重构，`sales_crm.js` 中既有 AI 触发点触碰时只原样搬运（见 `TARGET_ARCHITECTURE.md 0.1`）

## 单条记录模板（后续新增使用）

```text
需求编号：
业务目标：
用户角色：
包含范围：
排除范围：
状态/数据影响：
权限影响：
API/Worker 影响：
验收标准：
来源：
可信度：
当前实现：
冲突与待确认项：
```
