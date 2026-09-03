# TradePulse API 清单与契约

更新时间：2026-09-03
状态：非 AI 核心 API 契约矩阵已收口；AI 路由仍为弃用冻结，仅保留边界记录

> 范围：AI 相关接口（`/api/sales-crm/ai/*`、`/api/assistant/*`）不纳入本次重构范围，保持现状；本次重构聚焦统一 CRM 与旧版界面的收敛。

## HTTP 入口

| 范围 | 主要路由 |
|---|---|
| 页面 | `/`（统一壳 `sales-crm.html`）、`/sales`（302 -> `/`）、`/development-workbench`（旧版 `Index.html`，含 profile/embedded 模式）、`/legacy`、`/tradelead-v2.html`（旧入口，`CRM_ENABLE_LEGACY` 控制） |
| 健康/交付 | `/healthz`、`/api/delivery/latest`、`/api/delivery/file` |
| 通用旧 API | `/api/initial`、`/api/customers`、`/api/recon/results/:jobId`、`/api/quality/issues`、`/api/report`、`/api/recon-monitor` |
| 认证 | `/api/sales-auth/login`、`/api/sales-auth/logout`、`/api/session/capabilities` |
| CRM 启动/查询 | `/api/sales-crm/bootstrap`、`/api/sales-crm/filter-schema/:pageKey`、`/api/sales-crm/lists/:pageKey`、`/api/sales-crm/accounts`、`/api/sales-crm/profile/:customerId` |
| 线索与回收 | `/api/sales-crm/intake`、`/api/sales-crm/intake/action`、`/api/sales-crm/intake/scan`、`/api/sales-crm/accounts/recycle-bin`、`/api/sales-crm/accounts/:customerId/return`、`/trash`、`/restore`、`/reassign` |
| 客户操作 | `/api/sales-crm/accounts`、`/master/:customerId`、`/export`、`/activities`、`/quotes`、`/orders` |
| 联系人与评价 | `/api/sales-crm/contacts`、`/evaluations`、`/evaluations/:evaluationId/retry`、`/customers/:customerId/people` |
| 用户/权限 | `/users`、`/permission-groups`、`/users/:userId/permission-overrides`、`/filter-permissions`、`/filter-permissions/definitions/:filterKey` |
| Assistant | `/api/assistant/runtime`、`/api/assistant/conversations`、`/api/assistant/chat` |
| AI Station | `/api/sales-crm/ai/*`，覆盖 features、governance、tasks、budgets、enrichment、proposals、next-action 和批量操作 |
| 分享报告 | `/share/report/:token/:jobId`、`/share/contact-report/:token/:jobId` |

## 当前观察

- Express 路由主要集中在 `server.js`、`lib/sales_crm.js` 和 `lib/ai_stations/routes.js`。
- CRM 路由安装函数与数据库/业务函数位于同一个大模块中。
- 新旧 API 并存，部分旧 API 面向旧数据模型，部分统一 CRM API 面向 `crm_accounts` 等新模型。
- `/api/sales-crm/lists/:pageKey` 和 `/filter-schema/:pageKey` 是统一筛选体系的重要入口。

## 逐接口分析模板

后续每个接口需要补齐：

```text
方法和路径：
业务领域：
认证要求：
角色/功能权限：
数据范围：
字段可见性：
请求参数：
成功响应：
错误码和状态码：
写入表：
审计行为：
幂等性：
相关测试：
迁移/兼容约束：
```

## 非 AI 核心 API 契约矩阵（2026-09-03）

下表以实际注册器、`SALES_ROUTE_POLICIES`/`LEGACY_ROUTE_POLICIES`、服务函数和现有
契约测试为准。路径中的 `:id` 表示已校验的 route 参数；“字段”指成功响应中允许
公开的业务字段集合或其服务端 schema，不等于数据库 `SELECT *` 的全部列。

### 通用约束

| 维度 | 契约 |
|---|---|
| 认证 | 除 `/api/sales-auth/login`、健康/交付公开入口外，统一 API 先解析 session；缺失/过期返回 `401`，不会回退匿名数据。 |
| 权限 | 路由策略先于处理函数执行；缺权限返回 `403`（含稳定 `code` 时一并返回）。`anyPermissions` 为任一满足，`permissions` 为全部满足；`realAdminOnly`/`adminOnly`/`blockedWhileImpersonating` 由策略统一执行。 |
| 范围 | 客户读写必须经过 `accountScope`/`buildIntakeQueryScope`/`assertRequestCustomer`；越权资源对非全局角色统一表现为 `403` 或“不可访问/不存在”，不得通过计数、排序或错误信息探测。 |
| 字段 | 列表使用服务端授权 schema；联系人受限路径使用 shape-specific projection 或递归边界。未知 JSON/动态列不得因 `SELECT *` 自动进入响应；详见 `phase-c-raw-shape-closure`。 |
| 错误 | 参数/业务冲突 `400`，资源不存在 `404`，权限/范围 `403`，幂等冲突或状态冲突 `409`，未捕获服务错误 `500`；统一错误体为 `{ok:false,error,code?}`。 |
| 幂等 | 带 `idempotencyKey` 的写入以服务端 request 表唯一键为准，重复请求返回原结果；无 idempotency 契约的动作不得由客户端重试假设为安全。 |
| 兼容 | 旧 `/api/*`、`/legacy` 和 `development-workbench` 继续按既有开关/策略工作；新 `/api/sales-crm/*` 只复用服务和数据源，不改变路径、字段语义或事务边界。 |

### 读取、列表与资料

| 方法/路径 | 权限与范围 | 字段/请求 | 响应、错误、兼容 |
|---|---|---|---|
| `GET /api/sales-crm/bootstrap` | 已登录；按各模块权限和账号范围返回 | 可选 feature/query；`accounts/activities/rfqs/quotes/orders/timeline/alerts/intake/insights` 等 bootstrap DTO；联系人字段按 `view_contacts` 投影 | `200 {ok,...}`；策略/数据库错误按通用错误；作为统一壳主数据入口，AI payload 仍冻结 |
| `GET /api/sales-crm/filter-schema/:pageKey`、`GET /api/sales-crm/field-schema/:pageKey` | 已登录；字段目录按页面授权动态裁剪 | `pageKey`；仅返回 schema、列可见性/排序能力和版本 | 未知目录 `404 FIELD_SCHEMA_NOT_FOUND`；schema 是列表 widget 唯一授权源 |
| `GET /api/sales-crm/lists/:pageKey` | 已登录；`pageKey` 对应页面权限/范围 | `page,pageSize,filters,sort,permissionVersion`；行字段严格按页面 schema | `400/403` 非法筛选/排序；稳定主键追加排序；保留既有分页/导出/动作 |
| `GET /api/sales-crm/accounts`、`GET /api/sales-crm/accounts/:customerId/history` | `view_customers`；账号 scope | 分页、搜索、筛选、sort；account 业务列、历史事件 | 越权 `403/404`；account 列表使用 `contactSafeAccountRecord`；历史为只读兼容 |
| `GET /api/sales-crm/profile/:customerId`、`GET /api/sales-crm/intake/:itemId/profile` | `view_customers`/`view_intake`；客户/线索 scope；intake profile 强制只读 | customer pool、legacy customers、account、activities/commerce、timeline、联系人/洞察按权限；后处理字段必须再次过联系人边界 | 资源不存在/越权 `403/404`；`intake` 无主档 `409`；统一资料 widget 直接消费该 DTO，旧 iframe 只作显式兼容 |
| `GET /api/sales-crm/profile/:customerId/tag-history` | `view_customers`；客户 scope | `limit/page`；授权标签类别、变更时间和操作者 | `403/404`；只读，不产生写审计 |
| `GET /api/sales-crm/research/pool`、`/research/recon` | 分别 `view_pool`、`view_recon`；研究范围 | `page,pageSize,filters,sort`；pool/recon 业务字段；recon 无联系人权限使用 `contactSafeReconRecord` | 无模块权限 `403`；未知筛选/排序 `403 FILTER/SORT_NOT_AUTHORIZED`；保留 `SELECT *` 存储读取但不放宽响应 |
| `GET /api/sales-crm/research/people`、`GET /api/customers/:customerId/people`、`GET /api/contact-recon/state` | `view_contacts`；客户/研究范围 | 联系人、方法摘要、质量统计；不接受匿名/部分联系人投影 | 无 `view_contacts` 直接 `403`；授权角色保持完整联系人兼容形状 |
| `GET /api/sales-crm/accounts/recycle-bin`、`GET /api/sales-crm/accounts/:customerId/recycle-profile` | `manage_customer_recycle`；回收/本人不对口范围 | 回收列表及资料聚合；联系人阶段按 `view_contacts` 递归投影 | 越权 `403/404`；复合 profile 不迁移顶层白名单 |
| `GET /api/customers`、`GET /api/recon/results/:jobId`、`GET /api/quality/issues`、`GET /api/report`、`GET /api/recon-monitor` | legacy policy：`view_pool`、`view_recon`、或组合权限；external customer scope | 旧 pool/recon/质量/报告字段；recon resultV3/evidence 仅联系人权限可见 | 保留旧错误体和分页；无联系人权限使用 pool/recon 专用投影，未知列不外泄 |
| `GET /api/sales-crm/export`、`GET /api/sales-crm/manager-tasks/export`、`GET /api/sales-crm/team-status/export`、`GET /api/sales-crm/collaboration-support/export` | `export_data` 加业务查看权限；范围同读取 | `format`/筛选按各列表 schema；CSV/JSON 字段由导出 builder 生成 | `403` 无导出权限；联系人投影后再执行凭据递归投影；重复下载无副作用 |

### 客户、活动与商业写入

| 方法/路径 | 权限与范围 | 请求/写入与响应 | 错误、幂等、兼容 |
|---|---|---|---|
| `POST /api/sales-crm/accounts`、`PATCH /api/sales-crm/accounts/:customerId`、`PATCH /api/sales-crm/master/:customerId` | `create_customer`/`edit_customer`；master 写入 real admin；客户 scope | 白名单字段；状态/计划/主管写经 state/plan/manager gateway；返回 account/profile DTO | `400` 校验、`403` 权限/范围、`409` 状态冲突；master/迁移边界原位，不改变 legacy 字段 |
| `POST /api/sales-crm/accounts/:customerId/reject`、`trash`、`restore`、`return`、`reassign`、`bulk-assign`、`bulk-return` | 回收/入库管理或本人不对口权限；逐客户/批量范围 | 原因、目标 owner、expected version；写 lifecycle/assignment/owner gateway，返回状态与审计信息 | 非法状态 `409`；批量动作逐项授权、事务回滚；impersonation 对高风险动作按策略阻断 |
| `PATCH /api/sales-crm/customers/:externalCustomerId/nickname`、`PUT /api/sales-crm/customer-stars/:customerId` | `edit_customer`/`view_customers`；客户 scope | 昵称/星标布尔；返回更新值和时间 | `400/403/404`；星标按用户幂等 upsert，昵称保持旧主档兼容 |
| `POST /api/sales-crm/activities`、`POST /api/sales-crm/activities/plan-only`、`POST /api/sales-crm/accounts/:customerId/deferred-plan` | `record_activity`；计划动作按客户 scope | activity 或计划字段、`idempotencyKey`；状态/计划/manager 写经 gateway；返回 activity/plan projection | 重复 key 返回原结果；未来时间/缺 time basis `400/409`；保留今日待办既有事务 |
| `POST /api/sales-crm/quotes`、`POST /api/sales-crm/orders` | `record_quote`/`record_order`；客户 scope | RFQ/报价/订单金额、币种、毛利、关联 activity；幂等键 | stage 前置、金额/毛利非法 `409/400`；事务内行写和状态 gateway；重复请求回放 |
| `GET/POST/PATCH/DELETE /api/sales-crm/activity-reactions*` | 读为 `record_activity`；管理写为 real admin | reaction schema、排序、启停 | 非法 key/顺序 `400`；管理写 impersonation 阻断；兼容旧反应菜单 |
| `GET/POST/PATCH /api/sales-crm/contacts*` | `view_contacts` + `manage_customer_contacts`；客户 scope | 联系人字段、方法、归档状态；服务端清洗和公开投影 | `400/403/404`；联系人写非 AI；归档幂等，审计保留 |

### 线索、主管、团队与保护域

| 方法/路径 | 权限与范围 | 请求/响应与副作用 | 错误/幂等/兼容 |
|---|---|---|---|
| `GET /api/sales-crm/intake`、`POST /api/sales-crm/intake/scan`、`POST /api/sales-crm/intake/action`、`PATCH /api/sales-crm/intake/settings` | 读取 `view_intake`；扫描/设置 `view_intake+manage_intake`；动作按 owner/团队范围 | intake items、batches、arbitration、developmentHistory、complementaryInfo；写动作含 claim/return/assign/identity audit | P1/P3 无联系人权限走专用递归 helper；动作幂等/预览门控，冲突 `409`，不恢复 AI |
| `GET/POST/PATCH /api/sales-crm/manager-task-settings`、`/manager-tasks*`、`/manager-metrics*`、`/manager-risks` | `resolve_manager_tasks`；经理团队范围 | 任务筛选、详情、resolve action、指标/风险 drilldown；intervention/deferred plan 经 `manager_workflows` | 动作权限/状态冲突 `403/409`；resolve 幂等；既有通知/审计/事务边界不变 |
| `GET/POST /api/sales-crm/team-status*`、`/collaboration-support*` | 读 `view_team` 或 `view_customers`；写协作权限；客户/团队范围 | 分页 cursor、事件 relation（original/supplement/correction/revocation）、导出 | cursor/关系非法 `400`；写 blockedWhileImpersonating；append-only 事件与审计 |
| `GET/POST/PATCH /api/sales-crm/protected-customers*`、`/protected-customer-conflicts*` | `manage_protected_customers` + real admin；impersonation 全阻断 | 模板、预览、批次 commit/rollback、冲突 resolve/supplement、激活和受保护资料 | 版本/批次冲突 `409`，字段校验 `400`；批次写事务、可回滚；CSV 导出走 export projection |
| `POST /api/sales-crm/migration-review/:reviewId` | `view_users+manage_users`，impersonation 阻断 | 管理员复核、目标 account、迁移动作；单事务迁移并更新 review | 复核不存在/已解决 `404/409`；保持高耦合原位，不拆事务 |
| `POST /api/sales-crm/password`、`POST /api/sales-auth/login`、`POST /api/sales-auth/logout`、`GET /api/session/capabilities` | 登录公开；密码需本人且禁止 impersonation；capabilities 需 session | 密码当前/新值、session cookie、权限 capabilities | 认证失败 `401`，密码策略 `400`，安全操作 impersonation `403`；session cookie/密码字段永不进入业务 DTO |
| `GET/POST/PATCH/DELETE /api/sales-crm/users*`、`/permission-groups*`、`/filter-permissions*` | `view_users/manage_users`，按策略 real/admin | 用户、权限组、override、筛选授权矩阵；写入审计 | 非法权限键/版本 `400/409`；高风险写阻断 impersonation；保留专用权限工作区，不纳入普通 List widget |
| `GET/POST /api/sales-crm/data-maintenance/*` | `manage_data_maintenance` + real admin | capabilities、runs、preview、execute；execute 明确 confirmation | 预览/执行错误 `400/409`，无权限 `403`；运行记录只读列表，生产目录不在本契约范围 |

### 明确冻结的接口

- `/api/assistant/*`、`/api/sales-crm/ai/*`、AI 专用 UI 和 `crm_ai_*` 数据写点不属于本次
  非 AI API 重构；只保留 feature-off/权限边界测试，不新增字段、行为或迁移。
- `/api/prospect-agent` 的执行与 AI/Prospect 生产逻辑保持原位；bootstrap 中 prospect
  形状只接受 `use_prospect_agent` 源头门和显式 builder，不把它当作新 AI 功能恢复。
- `/legacy`、`/tradelead-v2.html`、`/development-workbench` 只有在兼容开关/显式入口下提供；
  canonical `/` 是统一壳，旧入口不作为新业务真源。

## 重点核查顺序

1. 认证、session 和访问上下文
2. bootstrap、列表、详情和导出的一致性
3. 客户活动和状态变更
4. 线索领取、退回、拒绝、重新分配
5. 回收站和恢复
6. 联系人、评价和敏感数据
7. 筛选 schema、授权和分页
8. AI 任务、提案和审批（本次仅确认不纳入重构）
9. 客户完整资料相关接口：`/api/sales-crm/profile/:customerId`、`/intake/:itemId/profile`、`/master/:customerId`、`/recycle-profile`（统一视图将直接复用这些数据源）

不应仅凭路由名判断接口的最终业务职责；必须继续追踪处理函数、SQL、权限检查和测试。
