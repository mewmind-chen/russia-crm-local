# TradePulse 领域地图（初始版）

更新时间：2026-08-27
状态：初步取证，待代码和需求交叉验证

> 范围边界：AI 内容不纳入本次领域重构（见 `TARGET_ARCHITECTURE.md 0.1`）；前端存在两套界面并存，客户完整资料不是单一底层（见 `TARGET_ARCHITECTURE.md 0.2`）。

## 领域列表

| 领域 | 目标 | 主要实体 | 初步代码边界 |
|---|---|---|---|
| 身份与权限 | 用户登录、角色、功能权限、数据范围、字段可见性和审计 | User、Session、Permission、PermissionGroup | `sales_users`、`sales_sessions`、`lib/access_control.js`、`lib/permission_groups.js`、`lib/filter_authorization.js` |
| 客户主数据 | 保存企业主档和统一客户编号 | Customer/Account、Company Identifier | `crm_accounts`、`customer_pool`、`customers`、`lib/db.js`、`lib/sales_crm.js` |
| 线索管理 | 入池、筛选、分配、领取、退回和重新进入 CRM | Pool Lead、Intake Item、Assignment | `crm_intake_*`、`customer_pool`、`lib/intake_flow_filters.js` |
| 客户生命周期 | 维护客户当前有效状态和历史动作 | Lifecycle、Activity、Transition | `crm_accounts`、`crm_activities`、`crm_audit_log`、`lib/customer_stages.js` |
| 任务与推进 | 处理下一步计划、今日任务和推进动作 | Plan、Task、Pipeline Item | `crm_activities`、`crm_notifications`、相关 `sales_crm.js` 逻辑 |
| 经理协作 | 经理介入、回复、销售确认计划并闭环 | Assistance Task、Reply、Receipt | CRM 任务/活动/通知相关逻辑，需继续定位 |
| 联系人与质量 | 维护联系人、联系方式、在职和交付等级 | Contact、Person Candidate、Method、Evidence | `contacts`、`person_candidates`、`contact_methods`、`person_evidence`、`lib/contact_quality.js` |
| 企业 Recon | 调研任务、结构化结果、证据和评级 | Recon Job、Result、Evidence | `recon_jobs`、`recon_results`、`recon_evidence`、Python workers |
| AI Station | AI 任务、模型调用、预算、治理、结果和 enrichment | AI Job、Run、Proposal、Budget | `lib/ai_stations/`、`crm_ai_*` | **不纳入重构**：开关控制显示，原样保留 |
| 报表与交付 | 每日交付、公开报告、通知 | Report、Delivery、Notification | `scripts/generate-*`、`crm_notifications`、`server.js` 分享路由 |
| 数据治理 | 迁移、质量审计、规范化和历史修复 | Migration Review、Quality Issue、Audit | `lib/data_maintenance.js`、`scripts/` |
| 部署运维 | 发布、健康检查、备份、回滚和服务调度 | Release、Runtime、Backup | `deploy/`、`lib/release_health.js`、`scripts/deploy-*` |
| 客户完整资料视图 | 客户资料展示、联系人管理、洞察评价的统一 UI 层 | Profile View、Drawer、Profile Scripts | `sales-crm.html#customerProfileView`、`Index.html(profile-mode)`、`profile-contacts.js`、`profile-insights.js` | **需重构**：当前是 iframe 旧页 + 双脚本切片 + 抽屉的组合，目标为单一视图层 |

## 需要继续验证的边界

- `customers`、`customer_pool` 和 `crm_accounts` 的关系及最终主数据真源。
- 当前客户状态是字段直接存储、由活动推导，还是不同页面使用不同口径。
- 经理协助和今日任务的完整状态转换。
- Recon/联系人数据在客户、线索和销售可见范围之间的边界。
- AI enrichment 对客户主数据的写入权限和提案审批边界（AI 不纳入重构，但契约保留）。
- 统计、导出、筛选和列表之间是否完全共用数据范围。
- 客户完整资料统一视图与旧 iframe/双脚本切片/抽屉之间的功能等价性。

## 前端界面落位（本次重构需要处理的组合）

```text
正式入口 / -> 统一壳 sales-crm.html（/sales 302 重定向到 /）
  ├─ 客户资料视图：#customerProfileView
  │     └─ iframe #customerProfileFrame
  │           └─ GET /development-workbench?embedded=1&profile=1&assistant=0&prospect=0&customer=…[&intake=…]
  │                 └─ 旧版 Index.html（body.profile-mode 隐藏导航，双用途页面）
  │                       └─ 数据来自 /api/sales-crm/profile/:customerId 或 /intake/:itemId/profile
  └─ 轻量抽屉 #customerDrawer（同一数据源，见 sales-assets/app.js）
旧版独立入口：/legacy、/tradelead-v2.html（CRM_ENABLE_LEGACY=true 时可用，见 server.js:73-78）
```

## 重构候选依赖顺序

```text
身份与权限
    ↓
客户主数据
    ↓
客户生命周期
    ↓
线索与分配
    ↓
任务与推进
    ↓
经理协作
    ↓
联系人与 Recon
    ↓
客户完整资料视图统一
```

AI 不进入重构依赖链（保持原样）。这是初步依赖假设，不是已经批准的实施计划；必须在数据和状态分析完成后确认。
