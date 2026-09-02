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
