# 高耦合边界审计与 Stage D 非 AI 管理流程

日期：2026-09-02  
范围：`after/` 重构工作树  
状态：审计完成；manager intervention / deferred plan 已进入独立应用服务收口

## 基线与约束

- 远端 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `current/.release-sha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `state/state.json.lastSuccessfulSha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 本轮只修改 `after/`；不修改生产、不部署、不 push、不 merge。
- AI 功能已弃用冻结；本轮不读取其运行时实现作为业务依赖，不新增、不恢复、不迁移 AI 行为。

## 审计结论

| 边界 | 证据 | 结论 | 原因/保护条件 |
| --- | --- | --- | --- |
| 客户资料聚合 | `lib/db.js:1594-1685` `getCustomerProfileData`；`lib/sales_crm.js:10785-10860` 两个 profile GET | 保留原位 | 同时承担 CRM/线索范围、`intakeReadOnly`、联系人与 Recon 权限、完整资料组装和标签脱敏；不是纯路由装配 |
| profile 标签裁剪 | `lib/sales_crm.js:2889-2920` `redactUnauthorizedProfileTags` | 保留在数据边界 | pool/customers/tags 按授权类别裁剪，AI 标签还受 `view_insights` 控制；不能下移到 widget |
| 迁移复核 | `lib/sales_crm.js:11155-11210` | 保留原位 | 管理员双重授权、旧主档校验、账号创建、活动迁移、复核状态更新在同一事务内 |
| 入库扫描/动作/设置 | `lib/sales_crm.js:11211-11252` | 保留原位 | 扫描、领取/分配/退回、身份审计和幂等/预览门控跨域耦合；已有 intake/assignment 合同测试 |
| 评价写入/重试 | `lib/sales_crm.js:4232-4390`、对应 evaluations 路由 | 保留原位 | 权限、持久化、状态和现有兼容行为耦合；不作为机械 route slice |
| 全局认证/审计/策略中间件 | `lib/sales_crm.js` 认证入口与 `requireUnifiedUser` | 保留原位 | 影响所有路由的身份、范围、审计和脱敏，需另行架构审计 |
| password / AI task middleware | 现有认证与 AI 路由入口 | 保留原位 | password 是安全边界；AI 运行时属于冻结红线，本轮零动作 |

审计没有发现新的“纯 profile 聚合”或“纯高耦合路由”候选。继续缩小 `sales_crm.js` 前，必须先把上述业务边界拆成明确的 service contract，并以权限、脱敏、事务和错误语义的等价测试为门槛。

## Stage D 收口切片

将 manager intervention 与 deferred plan 作为独立的非 AI 应用边界：

- 新增 `lib/manager_workflows.js`，通过依赖注入组合授权、账号范围、生命周期网关、通知、审计和底层 task/plan 服务。
- `deferAccountPlan`、主管任务扫描/设置、主管任务详情账号解析、任务通知、主管干预（形成计划、主管建议、终止、重新分配、升级）及其审计均由该服务提供。
- `sales_crm.js` 仅负责组合根装配；既有路由路径、权限、幂等、事务、错误码、状态网关和数据库生命周期保持不变。
- `manager_tasks.js` 与 `deferred_plan.js` 继续作为低层 schema/event 服务；今日待办的 intake/manager receipt 闭环仍保留其现有事务边界。
- `manager_workflows.js` 不依赖 `sales_crm.js`、AI 模块或前端代码；业务 gateway 由调用方显式注入。

## 验收门

1. manager intervention / deferred plan 既有 API 回归全部通过，包含权限、范围、幂等、未来时间、终止阶段、升级通知和原子回滚。
2. 新模块中的 stage/plan/owner 写入只经过生命周期网关，不出现裸 `UPDATE crm_accounts` 状态写。
3. 高耦合边界不发生生产代码迁移，AI 边界门禁保持通过。
4. 全量 `npm test`、`node --test`、语法、diff、治理权威和 AI 边界检查通过。

回滚：本切片前的阶段 G 业务回滚点为 `f0ab815`；本切片提交后按单一 commit 回滚，不触碰生产。

## 2026-09-03 service/API contract 补录

以下契约把“保留原位”变成可检查边界；它们不是继续拆分的授权。每个边界仍由
`sales_crm.js` 组合根负责装配，调用方必须先完成统一策略、范围和 feature 检查。

| 保留边界 | 输入前置 | 成功输出 | 事务/副作用 | 错误与回滚门 |
|---|---|---|---|---|
| 资料聚合：`getCustomerProfileData`、`loadPayload`、`loadRecycleProfile` | 已解析 session/accessContext；customer/account/intake scope；`view_*` 权限和 AI hard flag（AI 关闭时不恢复 AI） | 统一 profile/bootstrap DTO：master/pool、legacy follow、activity/commerce、timeline、recon、people、tags、`profileAccess` | 只读；多表聚合后按联系人/动态 JSON 边界复裁剪；不改变数据库 | 越权 `403/404`，缺主档 `409`；回滚为 `e030900`/`343f166` 动态边界提交 |
| 迁移复核：`POST /api/sales-crm/migration-review/:reviewId` | real/admin 管理权限；未解决 review；目标旧主档与新 account 可唯一匹配 | `{ok, review, account, migratedCounts}`（实际路由响应以现有实现为准） | 单 SQLite 事务：复核校验、账号创建/关联、活动迁移、review resolved/audit 一次提交 | 复核已解决/目标冲突 `404/409`；任一写失败整笔回滚；不将迁移拆成跨请求步骤 |
| 入库扫描/动作/设置：`intake/scan`、`intake/action`、`intake/settings` | `view_intake`；扫描/设置还需 `manage_intake`；批次/owner/identity scope；preview/version/idempotency（按动作） | intake items/batches、assignment/return/identity warning、settings 与审计摘要 | 扫描、领取/分配/退回、身份审计和通知维持现有事务；P1/P3 读取复用专用递归投影 | 非法状态/版本/重复动作 `400/409`；权限 `403`；事务失败回滚，不部分写入 |
| 评价写入/重试：`POST /evaluations*` | `manage_evaluations`；account/customer scope；AI feature 关闭时只保留既有禁用/降级语义 | evaluation 状态、人工字段与现有 AI 标签投影（不新增 AI） | 状态、持久化、审计与兼容错误保持原事务；不移动 AI runtime | `403/404/409`；失败不覆盖既有完成记录；回滚点为原 `sales_crm.js` 路由切片 |
| 认证/密码：`sales-auth/*`、`POST /password`、统一 middleware | session/token 或登录凭据；密码操作禁止 impersonation；admin/real-admin 条件由策略执行 | session cookie/capabilities；密码接口仅返回 `ok`/时间，不回显 hash/token | session/密码哈希/审计是安全边界；不能被 profile 或 export 聚合复用 | 认证失败 `401`、策略校验 `400`、impersonation `403`；按单请求事务回滚 |

### 最小回归证据

- 资料/脱敏：`phase_c_s4_dynamic_fields_contract`、`phase_c_s4_master_profile_contract`、
  `phase_c_s6_bootstrap_contract`、`phase_c_raw_shape_contract`。
- 入库/身份/批次：`issue306_identity_conflict_*`、`issue205_pagination`、intake/assignment
  action request 契约；保留 P1/P3 递归 fixture。
- 评价与 manager/deferred：`manager_workflows_contract`、`issue170_*`、`issue291_plan_only`、
  `crm_manager_evaluations` 既有权限/状态回归。
- 认证/账号/密码：`sales_auth_*`、`password_*`、权限集成及 AI 全局关闭边界测试。

若未来要把任一边界移出 `sales_crm.js`，必须先新增独立 service contract、输入输出 schema、
逐角色行为矩阵和事务故障回滚测试，并以独立提交作为新的回滚点；本轮不执行该迁移。
