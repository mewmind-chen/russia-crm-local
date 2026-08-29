# TradePulse 目标架构

更新时间：2026-08-27
基线：`origin/main@57c4c42a89e7730545b726b29fd932c5bfb20574`（已 `git fetch origin --prune`）
状态：已批准用于重构；以最新 main 代码、可重复验证为准

## 0. 本次确认的两个范围边界

### 0.1 AI 内容不进入领域重构（不删除、不迁移、不搬运）

- 现有 AI 能力（`lib/ai_stations/`、`crm_ai_*`、Qwen、Prospect、Assistant 等）通过 `crm_ai_feature_flags` 与 `CRM_AI_*` 环境变量开关控制显示和执行，系统无 AI 时降级为规则/人工流程。
- 本次重构对 AI 采取 **零动作**：不改造、不合并、不简化、不迁移、不删除，也不“搬运”任何 AI 触发点。
- `sales_crm.js` 中已有的 AI 触发点（如 `enqueueSalesPack/enqueueNextAction` 等）**留在原位置**，重构领域切分时不移动它们，因此没有相关任务量。
- 前端新架构只把 AI 区域作为“已注册的 widget”，由现有开关决定是否挂载/显示，AI 内部代码零改动。
- 因此原有 `REFACTOR_ROADMAP` 中“AI 触发点收口”或“原样搬运”的任何阶段均从本次重构中移除。

### 0.2 前端目标：模块化自由搭建的 widget 组合架构

当前痛点（用户反馈）：

- 历史多个前端显示/交互 issue 改动难，因为逻辑集中在大文件（`sales-assets/app.js` 约 1.4 万行 + `Index.html` 内嵌脚本）。
- 客户完整资料界面不是独立底层，而是“新壳 iframe + 旧版 `Index.html` 双用途页面”的组合，难以单独修改和构建。

已有可复用机制（代码已核对）：

- `[data-permission]`：按钮/导航按权限显隐（`app.js` `$$('[data-permission]')`）。
- `[data-ai-business]`：AI 区域按开关显隐（`app.js` `applyBusinessAIVisibility`，联动 `features.aiStations` 等）。
- `sales-assets/filter-component.js`：独立 UMD 组件，自渲染、自管理状态，不依赖 `app.js` 内部状态，是 widget 化的现成范式。

本次重构的目标前端架构：

- **Widget 组件化**：每个页面视图拆成独立 widget（身份、业务画像、联系人、洞察/评价、时间线、商务、下一步、回收状态、AI 区域等）；widget 自包含模板、状态、事件，对外只暴露 `render(container, ctx)`。
- **注册表驱动**：widget 通过注册表登记（`id / 页面 / 权限 / 开关 / 位置`），页面 = 配置化组装，新增或隐藏内容只改注册表配置，不动其他 widget。
- **服务端组合控制**：`/api/sales-crm/bootstrap` 已下发 permissions + features；组合配置按权限、`data-ai-business` 等价开关裁剪，前端同现有机制一致。
- **抽屉/完整资料共用同一 widget 集合**：`#customerDrawer` 与客户完整资料渲染同一组 widget，消除两套口径。
- 客户完整资料从旧版 `Index.html` iframe 依赖中剥离后，由这些 widget 在统一壳 `sales-crm.html` 内直接组装。
- 旧版界面（`Index.html`、`tradelead-v2.html`、`/legacy`，由 `CRM_ENABLE_LEGACY` 控制）保留只读/兼容入口，不作为新功能载体。

这样后续修改前端显示/交互时，只需改对应 widget 或注册表配置，不再依赖大文件整体回归。


## 1. 设计原则

1. 以最新 `origin/main` 为唯一事实，不回退到 2026-07-25 规划的阶段假设。
2. 不重建第二套 CRM，不重置账号/权限/会话，不迁移第二套 AI router。
3. 行为保持兼容：`/api/sales-crm/*` 契约、错误码、权限拒绝、筛选版本冲突语义不变。
4. 绞杀式重构 `lib/sales_crm.js`（5872 行）：按领域抽离，不一次性重写。
5. 状态真源单一化：投影字段仅作缓存/查询优化，真源为有效活动历史 + 商务事件。
6. 权限分层可审计：功能权限 -> 数据范围 -> 字段投影 -> 筛选授权 四层一致。
7. 测试门禁：每个阶段 `npm test` 全量通过 + 受影响域聚焦回归 + 契约校验。
8. **AI 内容不纳入重构范围**：`lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 开关及其运行时 `ai_stations` 开关控制保持原样，仅保留调用契约，不做结构调整、不做行为改动、不删除。
9. **客户完整资料必须统一为单一视图层**：当前“新壳 iframe + 旧版 `Index.html` + `profile-contacts.js`/`profile-insights.js` 两个独立切片 + 轻量抽屉”的四段组合是重构对象，目标是把客户完整资料收敛为同构的单一 UI 层，消除对旧页 iframe 的依赖。

## 2. 现状痛点（量化）

- `lib/sales_crm.js` 5872 行，聚合身份、客户、线索、活动、商务、回收、告警、报表、迁移、审计。
- `lib/db.js` 3028 行，聚合旧 Recon/联系人/客户池 + 统一 CRM 初始化，仅迁移部分已隔离。
- 状态写入分散：`ACTIVITY_STAGE` 12 映射 + `advanceStage` + 报价/订单/退回/重分配直接写 `stage`，无统一状态机。
- 统计与列表口径分叉：部分读 `crm_accounts.stage` 投影，部分读 `crm_activities/rfqs/quotes/orders` 事实。
- `CONTACT_KEYS` 递归黑名单脱敏，需改为白名单投影。
- 客户完整资料不是单一 UI 层：`sales-crm.html#customerProfileView` 用 `<iframe id="customerProfileFrame">` 加载旧版 `Index.html`（`/development-workbench?profile=1&customer=…|intake=…`，分别要求 `view_customers`/`view_intake`，`X-Frame-Options: SAMEORIGIN`），旧页在 `body.profile-mode` 下隐藏导航，并独立挂载 `profile-contacts.js`（联系人管理）和 `profile-insights.js`（洞察/评价）两个脚本切片；同时还有轻量 `#customerDrawer` 抽屉，以及 `CRM_ENABLE_LEGACY` 控制的 `/legacy`、`/tradelead-v2.html` 旧入口。资料视图能力被拆在旧页、两个脚本和抽屉之间。
- AI 内容（`lib/ai_stations/**` + `crm_ai_*` + `CRM_AI_*` 开关）已自成一体，由开关控制显示；不纳入本次重构。

## 3. 目标分层

```
HTTP/API (server.js + lib/*_routes)
  ↓
Service / UseCase (lib/domains/**/service.js)
  ↓
Domain (lib/domains/**/model.js, stages.js, policy.js)
  ↓
Repository (lib/domains/**/repository.js)
  ↓
DB / SQLite (lib/db/* + runtime_paths)
  ↓
Worker / AI Adapter (lib/ai/*, lib/ai_stations/*)
```

规则：
- API 层只做鉴权、参数校验、调用 Service，不直接拼 SQL。
- Domain 层纯函数，无 I/O，可单元测试。
- Repository 层唯一持有 SQL，事务边界显式。
- 跨域通过事件/显式调用，不直接共享表。
- 兼容层隔离旧 `/api/customers` 等，不污染新域。

## 4. 领域边界与目标落位

| 领域 | 现状核心 | 目标落位 | 关键表 | 说明 |
|---|---|---|---|---|
| identity | `access_control.js` `permission_groups.js` | `lib/domains/identity/` | `sales_users/sessions/permission_groups/user_permission_overrides` | `view_all_customers + manage_intake` 决定范围，保持 `blockedWhileImpersonating/realAdminOnly` |
| customer | `crm_accounts` + `customer_pool` | `lib/domains/customer/` | `customer_pool/customers/crm_accounts/tags/customer_tags` | `external_customer_id` 为关联真源；受保护标识预检独立 |
| activity | `crm_activities` | `lib/domains/activity/` | `crm_activities/crm_audit_log/crm_manager_evaluations` | 有效历史重建 + 纠错为真源，投影异步同步 |
| commerce | `rfqs/quotes/orders` | `lib/domains/commerce/` | `crm_rfqs/crm_quotes/crm_orders/crm_commerce_action_requests` | 金额/币种/毛利校验，订单必绑同客户报价，幂等 |
| intake | `crm_intake_*` | `lib/domains/intake/` | `crm_intake_batches/items/action_requests/manual_assignment_requests/decisions` | `pending->assigned->claimed->returned/rejected/duplicate` 状态机，触发器只同步不裁决 |
| assignment | `chooseIntakeOwner/arbitrateCandidate` | `lib/domains/assignment/` | `crm_intake_items` + 候选快照 | 规则最终裁决，AI 仅建议 |
| lifecycle/recycle | `lifecycle_status/recycle_kind` | `lib/domains/lifecycle/` | `crm_accounts(lifecycle_status/recycle_kind/assignment_status)` | `active <-> recycled(sales_return/manual_delete)`，审计必记 |
| planning | `next_action` + `buildAlerts` | `lib/domains/planning/` | `crm_accounts.next_action/_at + crm_notifications` | `deferred plan/manager intervention` 独立，`OVERDUE/NO_NEXT/INTAKE_IDLE` 等 12 类告警收敛 |
| contact | `crm_account_contacts/person_*` | `lib/domains/contact/` | `crm_account_contacts/person_candidates/evidence/methods` | 白名单投影替代 `CONTACT_KEYS` 黑名单 |
| recon | `recon_*` | `lib/domains/recon/` | `recon_jobs/results/evidence` | Worker 原子领取 + V3 契约 |
| ai | `lib/ai_stations/**` | **保持原样，不纳入重构** | `crm_ai_jobs/results/evidence_bindings/model_runs` | 开关控制显示；重构只读契约，不改结构/行为/不删除 |
| profile-ui | `sales-crm.html iframe + Index.html + profile-contacts.js + profile-insights.js + 抽屉` | `lib/domains/customer/` 视图层 + 单一 profile 前端模块 | 无新表 | 消除旧页 iframe 依赖，合并两个脚本切片为统一客户完整资料视图 |
| filter | `filter_authorization/catalog` | `lib/domains/filter/` | `filter_definitions/group_grants/user_extra_grants/state` | 页面级版本化，`FILTER_VERSION_CONFLICT` 契约不变 |
| delivery | `reports/daily` + notifier | `lib/domains/delivery/` | `crm_notifications/deliveries` | web/wecom 双通道 |

## 5. 目录目标

```
lib/
  domains/
    identity/       # access_control + permission_groups 抽离
    customer/       # account, pool, tags, protected identity
    activity/       # stages, history, correction
    commerce/       # rfq, quote, order, commerce_requests
    intake/         # batches, items, decisions, scans
    assignment/     # chooseIntakeOwner, arbitration
    lifecycle/      # recycle, return, restore, reassign
    planning/       # next_action, alerts, pipeline
    contact/        # contacts, evidence, projection
    recon/          # jobs, results, evidence
    filter/         # catalog, authorization, audit
    delivery/       # reports, notifications
  ai/               # adapter, triggers -> ai_stations
  db/
    migrations/
    seeds/
  shared/
    errors.js
    pagination.js
    audit.js
server.js           # 仅路由装配
```

`lib/sales_crm.js` 按此目录逐步绞杀，最终仅保留兼容转发或删除。

## 6. 状态真源约定

- 活动真源：`crm_activities` 有效历史（纠错后）推导 `stage/last_activity_at`，`crm_accounts.stage` 为投影。
- 商务真源：`rfqs/quotes/orders` 事件；`crm_accounts` 仅缓存最新阶段。
- 分配真源：`crm_intake_items.status`；`crm_accounts` 的 `assignment_status` 同步但不裁决。
- 生命周期真源：`lifecycle_status + recycle_kind`；`assignment_status` 不单独决定回收。
- 告警推导：`buildAlerts/groupAlerts` 基于 `next_action_at/claim_due_at/stage/activities/rfqs/quotes` 实时计算，不持久化优先级。

## 7. 权限与筛选一致性

```
SALES_ROUTE_POLICIES (deny-by-default)
  → Service 权限检查 (hasPermission)
  → Repository 范围 (accountScope/buildAccessContext)
  → 字段投影 (白名单 per view_contacts/view_recon)
  → 筛选授权 (effectiveFilterSchemaFor + validateFilterQuery)
```

不变契约：
- 未登记路由 deny。
- `FILTER_VERSION_CONFLICT` 版本冲突。
- `CUSTOMER_DUPLICATE 409`。
- 三角色隔离。

## 7.5 字段级自由显示（Field Schema 组合层）

用户需求：不止 UI 结构，线索池、客户资料等页面的**字段内容**也要能自由显示/隐藏。

现状基础（已核对）：

- `lib/filter_catalog.js` 已有字段级定义范式：`key / label / type / displayMode / sortOrder / sensitive / requiredPermissions / pages`，服务端按权限生成筛选 schema（`authorizedFilterSchema`）。
- `lib/access_control.js` 已有 `CONTACT_KEYS`（黑名单）+ `CONTACT_SAFE_POOL_KEYS`/`CONTACT_SAFE_RECON_KEYS`（白名单）做字段脱敏。
- 前端列表/详情字段渲染仍硬编码在 `app.js`（约 1.4 万行），未字段化。

目标：把“筛选字段”扩展到“展示字段”，形成统一字段组合层：

```text
字段目录（FIELDS_CATALOG，仿 filter_catalog.js）
  key / label / section / sortOrder / kind(列|详情|编辑)
  visibility: { roles?, permissions?, features? }
  editable: { roles?, permissions? }
  sensitive / redactWhenMissing
        ↓ 服务端按 角色 + 权限 + 开关 计算
有效字段 schema（per-page, per-user，含版本）
        ↓
Widget 按字段 schema 渲染列/详情/表单（无硬编码字段名）
        ↓
个人显示配置（后续可选）：用户/角色级字段显隐覆盖，配置驱动，无需改代码
```

覆盖页面：客户资料（`/profile/:customerId`）、线索池（`intake/lead_flow`）、CRM 客户列表、回收站、负责人线索、Recon 等。

效果：
- 字段显隐 = 改配置（角色/权限/开关或用户偏好），不改代码。
- 替换 `CONTACT_KEYS` 黑名单为字段级白名单投影；未授权字段不下发数据（不只隐藏显示）。
- 字段 schema 与筛选 schema 同源（同一 catalog），避免两套口径。

## 8. AI 边界（不纳入重构，零动作）

- `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 环境开关、运行时 `ai_stations` 开关均**保持原样**。
- 重构对 AI **不删除、不迁移、不搬运**；`sales_crm.js` 中已有 AI 触发点留在原位置。
- AI 显示与否继续由开关控制（`feature_flags.js`：`CRM_AI_STATIONS_ENABLED`、`CRM_AI_CUSTOMER_ENRICHMENT_ENABLED`、`CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED`、`CRM_AI_SALES_PACK_ENABLED`、`CRM_AI_QWEN_ONLINE_ENABLED`、`CRM_AI_QWEN_BATCH_ENABLED`；capabilities 返回 `features.aiStations`）。
- 前端新架构把 AI 区域登记为 widget，由现有开关决定是否挂载/显示，AI 内部代码零改动。

## 8.1 前端 Widget 组合架构（本次重构核心方向）

背景：历史前端显示/交互 issue 难以修改，因为逻辑集中在大文件（`sales-assets/app.js` 约 1.4 万行 + `Index.html` 内嵌脚本）；客户完整资料也不是独立底层，而是“新壳 iframe + 旧版 `Index.html` 双用途页面”的组合。

目标架构：

```text
统一壳 sales-crm.html
  ├─ Widget 注册表（id / 页面 / 权限 / 开关 / 位置 / 顺序）
  ├─ 页面 = 配置化组装 widget（权限 + 开关裁剪）
  └─ 每个 widget 自包含模板、状态、事件，只暴露 render(container, ctx)
```

关键机制（复用现有）：

- `[data-permission]` 权限显隐、`[data-ai-business]` AI 开关显隐、bootstrap 下发 `permissions + features`。
- `sales-assets/filter-component.js` 的独立 UMD 组件模式作为 widget 范式（自渲染、自管理状态）。

客户完整资料统一：

- `#customerProfileView` 拆为 widget 集合：身份、业务画像、联系人、洞察/评价、时间线、商务、下一步、回收状态、AI 区域。
- widget 直接消费 `getCustomerProfileData` 返回结构（客户/线索/回收三种来源复用同一集合）。
- `#customerDrawer` 与完整资料共用同一 widget 集合，消除两套口径。
- AI widget 注册但不强制显示，由现有开关决定。
- 保留 `view_customers`/`view_intake` 权限边界、联系人/洞察脱敏与标签授权。
- 统一视图上线并验证后，`/development-workbench` 的 profile 模式与旧版 `Index.html` 收敛为只读/兼容入口（先确认现有使用方，再决定下线方式）；`/legacy`、`/tradelead-v2.html` 继续由 `CRM_ENABLE_LEGACY` 控制。

后续修改前端显示/交互时，只改对应 widget 或注册表配置，不再依赖大文件整体回归。

## 9. 部署与数据

- `DEPLOY_ROOT/current -> releases/<12-char-sha>`，`git archive` 无 `.git`，`.release-sha/state.json/.backup/healthz` 契约不变。
- 迁移仅新增表/列，不删业务对象；生产 `.backup` 必须先行。

## 10. 非目标

- 不切 PostgreSQL/Redis（阈值驱动）。
- 不做多租户 SaaS。
- 不重做 V3 studio/deck 视觉，仅保证域拆分不破坏现有 UI。
- 不重构 AI 内容（`lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 开关），保持原样，不做任何搬运。

## 11. 验证门

每个域抽离必须：`npm test` 全量通过 + 受影响域聚焦通过 + API 契约/权限/黑名单脱敏/版本冲突回归通过 + `git diff --check`。
每个前端 widget 独立提交，`data-permission`/`data-ai-business` 等价显隐回归通过后合入。
