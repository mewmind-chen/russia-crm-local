# TradePulse 重构路线图

更新时间：2026-09-03
基线：`origin/main@57c4c42a89e7730545b726b29fd932c5bfb20574`
执行分支：`codex/frontend-widget-pilot@e7280ed`（未合并；Stage D 收口回滚点 `89e6509`，阶段 G 路由回滚点 `f0ab815`）
状态：路线图进入非 AI、非生产收尾大目标的最终门禁阶段；阶段 B/D 状态投影与 manager/deferred/today-task 一致性复核已由 `b25ad55` 锁定，Stage C raw/递归字段契约由 `e10793c` 闭合，阶段 D 的业务闭环、阶段 E 的 widget/浏览器验收、阶段 G 的兼容入口和路由装配均已完成。后续仅维护冻结边界、重跑门禁和记录新风险；资料聚合、迁移复核、密码、入库/评价及 AI 路由仍按审计原位，权限配置矩阵与事务预览/审核工作区仍为专用组件，AI 专用列表继续弃用冻结。

> **上线前准备目标（2026-09-03）**：形成可审计、可复现、可回滚的 release candidate，但不执行正式上线。清单、preflight、非 AI 验收矩阵和只读数据保护 runbook 见 [`docs/release/2026-09-03-release-preparation.md`](../release/2026-09-03-release-preparation.md)。当前候选因尚未发布到 `origin/main` 及 `npm audit` 的 1 high/3 moderate 维持 NO-GO。

## 当前进度快照

| 阶段 | 状态 | 已有证据 | 尚未完成 |
|---|---|---|---|
| 阶段 0：治理基础 | 已完成并迁移 | 治理文档、前后基线、新根目录、滚动看板与会话记录 | 无 |
| 阶段 A：后端结构化切分 | 接线恢复完成（41/44 已接入） | `lib/domains/` 44 个文件；41 个域模块已接入（13 个接线切片、24 契约断言），sales_crm.js 约 11,320 行 | 仅剩 identity/index、identity/middleware、filter/index 三个模块按用户裁定保持内联/精简；资料/事务高耦合服务按审计保留或单独立项 |
| 阶段 B：状态真源 | 完成（含一致性复核） | 全部写点收敛到 state_write/collaboration_write 网关（含 updateAccount profile 编辑 `aabe4d9`），零裸写；`b25ad55` 锁定前端 raw-field contract、共享投影、经理/延期/今日待办边界；§4 守卫、回收/恢复不变量、pipeline DTO 边界和 smoke basis 均有契约 | AI 写点继续红线冻结；不恢复第二套状态模型 |
| 阶段 C：权限/筛选/字段 | 完成（raw/递归契约闭合，复合迁移冻结） | field catalog、schema 渲染、列表/形状白名单；范围解释器等价契约（`2ca107b`）与代码级统一（`f2056e5`）；按页面权限→字段→筛选合同（`45e0c05`）；legacy customers、P1/P3 递归、S5 凭据、S4/P4/S6 共享叶子与动态 JSON 边界均已有证据；`e10793c` 为 recon/people/prospect/templates 的未知列、源头权限和 builder 契约 | 复合顶层白名单迁移按嵌套等价门禁明确冻结；新增动态列只需按既有矩阵追加审计，不属于当前缺口 |
| 阶段 D：线索/任务/商业闭环 | 完成（非 AI 管理流程已收口） | intake/assignment/planning/commerce 已抽取接线；RFQ→quote→order 事务、行写、校验与 commit 服务已显式化（`1d15546…b4cfdfc`）；`89e6509` 将 manager intervention / deferred plan 收口为独立应用服务；`b25ad55` 验证经理/延期/今日待办与投影边界一致，并保留权限、幂等、事务、生命周期网关和审计语义 | 无新增范围；今日待办的 intake/manager receipt 继续保留既有事务边界 |
| 阶段 E：前端 widgets | 完成门已通过：注册表、默认视图、全范围非 AI List widget（含用户级多级排序）、CRM 抽屉非 AI 注册表组合、复杂 activity timeline widget、旧入口兼容边界、隔离 preview harness 与 sales/manager 双角色浏览器验收均已落地；阶段 G 兼容装配随后完成 | `2d98eea` 注册表；`e59bf22` profile-only 只读兼容契约；`8a86425` 独立 host 隔离；`3adc1d1` identity/source tags UMD；`cd9f198` Markets 等多列表迁移；`b1fa1cc` manager_tasks；`807b56c` manager_risks；`ed40d76` manager_metrics；`a52e42b` Team 进度/协作列表；`75a30b7` Insights 人工评价列表；`f1fe7d1` 受保护客户目录；`6001f61` 维护运行记录；`61a6572` 跟进更正历史只读列表；`3e55b41` 审计只读列表；`8d1bb05` 账号/归档/权限组/迁移复核/入库批次列表；`79036e5` CRM 抽屉非 AI 区块注册表组合与默认 iframe 边界；`092d8a0` 复杂 activity timeline 条目 widget 化；`bc84567` 旧入口兼容边界锁定；`3b2fe24` Phase E harness 加强；`dd650ba` Phase E 隔离 preview harness；`549fdfd` 多级排序协议与服务端白名单收口；`062f31a` 项目锁定 Playwright 1.62.1 与缺失依赖 fail-closed 合同；`583f314` 浏览器验收断言与输出语义收口 | 阶段 E 与随后阶段 G 均已完成；继续维持 AI 冻结 |
| 阶段 F：AI 零动作 | 持续遵守 | AI 内部未纳入本次重构 | 后续继续保持冻结 |
| 阶段 G：兼容层收尾 | 已完成（保留高耦合边界） | `d615410`、`7d6e88a`、`23b6365…f0ab815` 完成旧入口、profile 资源、CRM 各路由组与后台管理装配；`2026-09-02-high-coupled-stage-d-audit.md` 完成高耦合边界审计；每组均有注册器契约/专项回归，路由顺序、权限、脱敏、错误响应保持等价 | 资料聚合、迁移复核、密码、入库/评价和 AI 路由按审计保留原位；继续拆分需另立 service contract 与专项审计 |

阶段状态只用于导航，具体 Git、WIP 和测试数以 `CURRENT_STATE.md` 为准。

## 当前收尾大目标（2026-09-03）

以 `docs/governance/sessions/2026-09-03-refactor-closure-inventory.md` 为执行清单，统一收口
Stage C 的 raw/复合字段安全契约、Stage B/D 状态与管理流程一致性复核、Stage G 高耦合保留边界
service/API contract、非 AI 核心 API 逐接口矩阵以及依赖/治理风险校准。raw recon/people/
prospect/templates 已由 `e10793c` 与 `2026-09-03-stage-c-raw-shape-closure.md` 首轮收口，Stage B/D 一致性由
`b25ad55` 与 `2026-09-03-stage-b-d-consistency.md` 锁定；每项均须有风险矩阵、
契约测试、专项/全量证据和可回滚提交；只对已证明 blacklist≡whitelist 且无嵌套泄漏的独立叶子
接线，顶层复合白名单继续门控。

AI runtime/UI/触发点、生产/UAT/部署、push/merge、按裁定内联的三个 domain 模块，以及未经
等价证明的高耦合 composite 迁移，均为本目标明确冻结项。

## 路线原则

1. 从最新主线向外绞杀，不回头实现已存在能力。
2. 每阶段只收敛一个领域边界或一组强耦合边界。
3. 每阶段必须有可运行测试、可回滚点和可观察证据。
4. 先抽离 Domain/Service/Repository，再删除大文件内实现。
5. 兼容层优先保持路由和错误码不变，UI 和 API 逐步迁移。
6. **AI 内容完全不触碰**：`lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 环境开关和 `ai_stations` 运行时开关保持原样，不删除、不迁移、不搬运；`sales_crm.js` 中既有 AI 触发点留在原位置，本次重构不对其做任何动作。
7. **前端改为 widget 组合架构**：页面由 widget 注册表配置化组装，按权限与开关（复用 `data-permission`/`data-ai-business` 机制）自由选择显示内容；客户完整资料由同一 widget 集合在统一壳内直接组装，解除旧版 iframe 依赖，后续前端 issue 只需改对应 widget。

## 阶段 A：结构化切分 `sales_crm`

### 目标
把 `lib/sales_crm.js` 拆成可测试的领域模块，先不改变外部 API。

### 拆分顺序
1. `lib/domains/identity/`
2. `lib/domains/filter/`
3. `lib/domains/customer/`
4. `lib/domains/activity/`
5. `lib/domains/planning/`
6. `lib/domains/lifecycle/`
7. `lib/domains/intake/`
8. `lib/domains/assignment/`
9. `lib/domains/commerce/`
10. `lib/domains/contact/`
11. `lib/domains/recon/`
12. `lib/domains/delivery/`

> AI 不在拆分序列内：`lib/ai_stations/**` 保持原样，`sales_crm.js` 中既有 AI 触发点留在原位置，不做任何搬运。

### 每个子阶段通用步骤
- 复制或提取纯函数到域模块。
- 用现有测试覆盖模块输出。
- 保持 `sales_crm.js` 调用代理。
- 验证 `npm test` + 受影响域专项回归。
- 通过后再将调用点从 `sales_crm.js` 切到新模块。

### 完成门
- `sales_crm.js` 行数下降到 < 3500。
- 业务路由和错误码保持一致。
- 没有新增越权、数据丢失或状态漂移。

### 回滚点
- 每个子领域独立 commit + 独立测试证据。
- 任一子领域失败时仅回退该 commit，不影响其他领域。

## 阶段 B：统一状态真源

### 目标
把 `stage` / `next_action` / `manager_status` / `lifecycle_status` / `assignment_status` 的读写口径收敛。

### 范围
- 活动真源：重建与纠错后的 `crm_activities`。
- 业务阶段投影：`crm_accounts.stage`。
- 生命周期：`crm_accounts.lifecycle_status/recycle_kind`。
- 线索分配：`crm_intake_items.status`。

### 关键动作
- 引入 domain-level state reducer / projector。
- 所有写阶段动作改用 reducer 生成投影更新。
- 把 `advanceStage`、退回、重分配、报价格式、订单推进纳入统一状态规则。
- 让 alerts、dashboard、pipeline 共享同一状态解释器。

### 完成门
- 同一客户在列表、详情、统计、告警中阶段解释一致。
- 状态测试覆盖：向前推进、lost 恢复、退回、回收、重分配、经理介入。

### 回滚点
- 保留旧写路径作为兼容 shim，直到 projector 证明稳定。

## 阶段 C：权限与筛选收口 + 字段级自由显示

### 目标
把权限、数据范围、字段投影和筛选授权拆成明确组合，并让**所有业务列表页面**的字段内容、列顺序和行排序可按用户配置；客户资料等详情视图复用同一字段 schema。

### 关键动作
- 把 `access_control` / `permission_groups` / `filter_authorization` 的共享逻辑抽到 `identity/filter`。
- 统一 `buildAccessContext` 与列表查询使用同一范围解释器。
- 落地 **字段目录（FIELDS_CATALOG）**：具体字段定义与试点顺序见 `FIELD_CATALOG.md`；首个试点为线索池（intake/lead_flow），随后客户资料、客户列表。
- 服务端按 角色 + 权限 + 开关 计算**有效字段 schema**（per-page, per-user，含版本，`/field-schema/:pageKey`，冲突码 `FIELD_SCHEMA_VERSION_CONFLICT`），与筛选 schema 同源。
- Widget 按字段 schema 渲染列/详情/表单，前端不再硬编码字段名（消除 `app.js` 中硬编码渲染）。
- 建立统一 List widget 协议，覆盖客户、线索池、管道、告警、洞察、回收站、主管任务/风险/指标、Team 进度/协作、通知及联系人/Recon 等列表页；按有效 schema 提供列显隐、列顺序、升降序/多级排序。
- 为每个用户保存列表布局偏好（`visibleColumns`、`columnOrder`、`sort`）；偏好只能在授权字段集合内生效，schema 版本变化时校验并安全回退。
- 用字段级白名单投影替换 `CONTACT_KEYS` 递归黑名单；未授权字段不下发数据；过渡期保留 `redactContactFields` 兜底并断言结果一致。
- 为每个页面建立“权限->字段->筛选”的合同测试。

### 完成门
- 任意角色的页面/API/导出在字段和筛选上得到同一结论。
- 所有业务列表页的字段显隐、列顺序和排序可通过统一配置与用户偏好调整，无需改代码；详情页字段继续复用同一 schema。
- 用户偏好不能扩大数据范围、字段权限、筛选授权、导出权限或业务动作权限。
- `FILTER_VERSION_CONFLICT`、`FIELD_SCHEMA_VERSION_CONFLICT`、`CUSTOMER_DUPLICATE`、`blockedWhileImpersonating` 语义保持一致。

## 阶段 D：线索、任务与商业闭环收口

### 目标
把 intake、assignment、planning、commerce 的跨域流程固定下来。

### 关键动作
- `crm_intake_*` 逻辑拆出并保留幂等/裁决/审计。
- `next_action` 与 alerts 使用统一解释器。
- RFQ / quote / order / action request 的事务边界显式化。
- manager intervention 与 deferred plan 作为独立非 AI 应用用例，由 `lib/manager_workflows.js` 通过依赖注入组合授权、范围、生命周期网关、通知与审计。

### 完成门
- 批量扫描、分配、领取、退回、报价、订单、下一步建议均可通过独立域测试验证。
- manager intervention / deferred plan 不再依赖 `sales_crm.js` 内部私有状态；组合根只负责显式注入依赖。
- `sales_crm.js` 保留今日待办 intake/manager receipt 的原事务边界，避免跨域事务拆分造成语义漂移。

### 当前完成结论（2026-09-02）

`89e6509` 完成了 Stage D 的非 AI 管理流程收口：`deferAccountPlan`、主管任务扫描/设置/详情、任务通知、主管干预动作、升级通知与审计均由 `lib/manager_workflows.js` 提供。`manager_tasks.js` 与 `deferred_plan.js` 继续负责低层 schema/event；既有路由、权限、范围、幂等、事务、错误码和生命周期网关保持不变。

高耦合边界审计记录在 `docs/governance/sessions/2026-09-02-high-coupled-stage-d-audit.md`。资料聚合、profile 脱敏、迁移复核、入库扫描/动作、评价写入/重试、全局认证/审计策略、密码和 AI task middleware 均判定保留原位；这不是遗漏，而是本轮安全边界。

## 阶段 E：前端 widget 组合架构与客户完整资料统一

### 目标
把“新壳 iframe + 旧版 `Index.html` 双用途页面”组合下的客户完整资料收敛为统一壳内的 widget 组合视图，并让整个前端变成“模块化、自由搭建、自由选择显示内容”的架构；所有业务列表页统一使用 List widget，后续前端 issue 只改对应 widget。

### 现状（已核对代码，截至 `583f314`；业务切片含全范围非 AI List widget、用户级多级排序、复杂 activity timeline widget、专用组件例外与浏览器验收）
- 正式入口 `/` 返回统一壳 `sales-crm.html`（`server.js:72`）；`/sales` 是 302 重定向到 `/`（`lib/sales_crm.js:5044`）。
- `sales-crm.html#customerProfileView` 默认由 `sales-assets/widget-registry.js` 组装 customerProfile widget 集合；仅 `profileView=legacy` 显式回退到 `/development-workbench?...` iframe 兼容路径。
- `/development-workbench` 由 `server.js` 返回旧版 `Index.html`；profile-only 路径已由 `e59bf22` 约束为只读兼容入口，旧工作台与兼容资料页仍按 query 区分。
- 资料数据来自统一 API：`/api/sales-crm/profile/:customerId` 与 `/api/sales-crm/intake/:itemId/profile`（均调用 `getCustomerProfileData`）。
- 前端资产：`sales-assets/app.js`（17,606 行，统一壳主逻辑）、`sales-assets/widget-registry.js`（UMD 注册表）、`sales-assets/source-tags-widget.js`（identity/source tags UMD）、`sales-assets/list-widget.js`（共享列表协议）、`sales-assets/filter-component.js`（独立 UMD 组件范式）、`Index.html`（旧版，内嵌脚本）；`sales-crm.html` 在 registry/app 前加载 source-tags widget；`/legacy` 与 `/tradelead-v2.html` 由 `CRM_ENABLE_LEGACY` 控制（`server.js:73-78`）。
- 显隐机制已存在：`[data-permission]` 权限显隐、`[data-ai-business]` AI 开关显隐（`app.js` `applyBusinessAIVisibility`）、bootstrap 下发 `permissions + features`。

### 关键动作
1. **建立 Widget 注册表**：widget 元数据（id、页面、权限、开关、位置、顺序、加载方式），页面 = 注册表配置化组装；新增/隐藏内容只改配置。
2. **Widget 化**：按功能拆独立 widget（身份、业务画像、联系人、洞察/评价、时间线、商务、下一步、回收状态、AI 区域等），每个 widget 自包含模板/状态/事件，对外只暴露 `render(container, ctx)`；以 `filter-component.js` 的 UMD 模式为范式。
3. **统一列表 widget**：已抽出共享的列 schema、列显隐/顺序编辑器、用户级排序描述与偏好读写、稳定多级比较和表格渲染，并已接入 Dashboard、Markets、客户、线索池及入库批次、Pipeline、Alerts、通知、Research、主管三表、Team 三类业务列表、Insights 人工评价、受保护客户目录、维护运行记录、跟进更正历史、审计只读列表、用户/归档用户/权限组/迁移复核等后台列表；服务端按页面白名单执行 JSON 排序并 fail-closed，页面只提供数据与授权 schema。权限配置矩阵、事务预览/审核工作区属于专用组件例外，AI 专用列表保持弃用冻结。
4. **客户完整资料统一**：`#customerProfileView` 改为统一壳内的 widget 集合，直接消费 `getCustomerProfileData` 返回结构（客户/线索/回收三种来源复用同一集合）；`#customerDrawer` 的非 AI 状态条、事实、主档、时间线已由 `crmDrawer` 注册表按顺序同步装配，并与完整资料复用同一模板/渲染器；AI 区域保留既有冻结路径。
5. **权限与开关裁剪**：widget 显隐沿用 `data-permission` / `data-ai-business` 等价机制 + bootstrap features。
6. 统一视图通过验收后，`/development-workbench` 的 profile 模式与旧版 `Index.html` 收敛为只读/兼容入口（先确认现有使用方，再决定下线方式）；`/legacy`、`/tradelead-v2.html` 继续由 `CRM_ENABLE_LEGACY` 控制。
7. **身份/来源标签下沉**：`3adc1d1` 以 UMD `source-tags-widget` 承担只读 `customerTags` 的归一化、去重保序、来源分类、AI 开关裁剪、数量上限与安全转义；`app.js` 只保留兼容 wrappers，既有编辑/postMessage、API 与 AI internals 不变。
8. **浏览器验收前置条件**：先建立独立临时 SQLite、绑定 `127.0.0.1`、禁用 AI provider/monitor 的 Phase E browser-preview harness，再做 sales/manager 双角色验收；未建立前不得启动默认 runtime，也不得将未跑浏览器写成通过。

### 完成门
- 客户完整资料默认不加载 `/development-workbench` iframe；仅显式 `profileView=legacy` 兼容模式允许设置或刷新 iframe。
- 所有纳入本轮业务范围的普通业务列表页均由统一 List widget 提供授权列显隐、列顺序、用户级布局偏好和升降序/多级排序；当前已覆盖 Dashboard、Markets、客户、线索池及入库批次、Pipeline、Alerts、通知、Research、主管三表、Team 三类列表、Insights 人工评价、受保护客户目录、维护运行记录、跟进更正历史、审计只读列表、用户/归档用户/权限组/迁移复核列表，不引入 AI。权限配置矩阵、事务预览/审核工作区为专用组件例外，AI 专用列表保持弃用冻结。
- 列表偏好不能绕过服务端权限、数据范围、筛选授权、导出权限或动作权限。
- 联系人管理、评价/洞察、时间线、商务、下一步在统一视图中可用，三角色权限与脱敏行为与现状一致。
- 关闭 AI 开关时 AI widget 不显示；开启时行为与现状一致。
- 新增/隐藏前端内容只需改注册表配置或对应 widget，`app.js` 不再需要整体改动。
- source tags identity 投影保持只读、顺序/去重/AI 开关/转义语义与现状一致，并通过 sales/manager 浏览器验收。

### 回滚点
- 统一视图以独立 widget 提交；确认旧入口访问方后，先保持旧路径可访问，再逐步收敛。

## 阶段 F：AI 零动作确认（非任务）

### 内容
- 不重构、不迁移、不删除、**不搬运** `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 开关及运行时开关；`sales_crm.js` 中既有 AI 触发点留在原位置。
- 前端统一视图中的 AI 区域作为 widget 登记，由现有开关控制显示，不改 AI 内部代码。
- 本次重构对 AI 的总工作量 = 0。

## 阶段 G：兼容层收尾

### 目标
当新域稳定后，缩小 `sales_crm.js` 为路由转发/聚合层；旧版 `Index.html`/`tradelead-v2.html` 仅保留兼容；前端页面全部由 widget 注册表组装。

### 完成门
- 核心业务域模块化完成。
- 兼容层只保留不可拆路由、旧 API shim 和少量装配代码。
- 大文件规模明显下降，测试可针对领域单独运行。
- 前端新页面/显示调整不再依赖 `app.js` 整体修改。

### 当前完成结论（2026-09-02）

阶段 G 的兼容装配目标已完成。`server.js` 与 `lib/sales_crm.js` 的可安全抽取入口/路由已按职责拆为独立注册器，保留原注册顺序和行为；高耦合边界审计也已完成：

- `lib/legacy_entrypoints.js`、`lib/profile_entrypoints.js`、`lib/page_entrypoints.js`：旧 HTML、profile 资源和页面入口。
- `lib/sales_auth_routes.js`、`lib/sales_crm_account_routes.js`、`lib/sales_crm_contacts_routes.js`：认证、账号/回收和联系人。
- `lib/sales_crm_read_routes.js`、`lib/sales_crm_team_status_routes.js`、`lib/sales_crm_manager_routes.js`、`lib/sales_crm_activity_routes.js`：读取/列表、团队、主管、活动及更正。
- `lib/sales_crm_protected_routes.js`、`lib/sales_crm_bootstrap_routes.js`、`lib/sales_crm_business_write_routes.js`、`lib/sales_crm_admin_routes.js`：受保护客户、bootstrap、业务写入与后台管理/维护/筛选。

对应实现提交为 `d615410`、`7d6e88a`、`23b6365`、`0359cff`、`efb4da9`、`bf1f114`、`fc5bfcd`、`9804e0b`、`fb1b795`、`4be94c3`、`077617b`、`575cd23`、`f0ab815`。每个注册器均有路由矩阵契约或受影响域回归；阶段 G 收尾专项覆盖权限、脱敏、筛选、分页、导出、事务和 impersonation。

独立审计确认以下边界暂留在 `sales_crm.js`：全局认证/审计/策略中间件、资料聚合与 profile 写入、迁移复核事务、密码修改、入库与评价写入，以及 AI task middleware/`registerAIStationRoutes`。这些边界共享大量私有状态、事务闭包或 AI 红线，继续抽取不属于本轮安全范围；不得据此恢复或新增 AI 功能。Stage D 的非 AI manager intervention / deferred plan 已在 `89e6509` 独立收口，不改变上述保留结论。

## 阶段间门禁

每阶段都必须满足：
- `git diff --check`
- `npm test`
- 受影响域专项测试
- 权限与脱敏回归
- 状态/筛选/导出一致性回归
- 记录回滚点和证据路径

## 当前恢复点

恢复顺序固定为：

1. 阶段 B §1 完成门已达成（8 个状态写切片 `13cd37a`→`227b3d7` 已独立提交），契约测试 34/34。
2. 阶段 A 接线恢复 13 个切片已全部落地（当时快照：`0560e9c`→`5c23b32`，42 个域模块中 39 个重新接入，含纯函数 drop-in 与注入式错误构造经调用点注入保持语义），接线契约 24/24；全量 1913/1913 绿灯。当前口径见顶部快照：44 个域文件、41 个已接线。
3. 阶段 A 接线恢复完成：剩余 `identity/index`、`identity/middleware`、`filter/index` 三个模块按用户裁定保持内联/精简，不再接线。后续如需继续减单体，评估已漂移模块（如 `customer/normalize` 的纯常量/配置类）。
4. 阶段 B §4 强化已分 6 片落地：`0ae90af` `addQuote`/`addOrder` stage 前置校验提炼为网关 `assertQuoteTransition`/`assertFirstOrderTransition` 守卫（`STAGE_INDEX` 单调推进 + `STAGE_PRECONDITION_VIOLATION`）；`9186a6d` 注册 `assertAccountStateContract` 不变量守卫（§4.1 recycled 不配 claimed/assigned、§4.2 returned 不绑 owner）；`cb6c6e4` `projectNextAction` 纳入 time_basis 维度（§4.3 有值必配 basis 否则 degraded）；`754d023` `buildAlerts` 告警路径收敛到 `projectNextAction` 投影（§4.4）并修正 issue225 测试种子补写 basis；`c4bba3f` `buildTeamReport` 报告路径 planned/overdue 收敛到 `projectNextAction` 投影（§4.4）；`fe77fb4` `pipelineActionKeys` 的 due_followup/manager_assistance 收敛到 `projectNextAction.overdue`/`projectManagerState`，并移除失效的 `nowText` 参数（§4.4）。全量 1927/1927 绿灯。
5. 阶段 B §1 收尾：`aabe4d9` 把 `updateAccount`（profile 编辑，此前经动态字段直写 stage/owner/assignment/next_action/manager_*）收敛到 state/plan/manager 三个网关，claim/unassign 权限子流保持；§1"零裸写"完成门经审计纠正后达成。全量 1934/1934 绿灯。
6. 阶段 B §1 收尾：`aabe4d9` 把 `updateAccount`（profile 编辑，此前经动态字段直写 stage/owner/assignment/next_action/manager_*）收敛到 state/plan/manager 三个网关，claim/unassign 权限子流保持；§1"零裸写"完成门经审计纠正后达成。全量 1934/1934 绿灯。
7. 阶段 B 边界收敛：`6b88d74` 移除 pipeline 行的 state DTO（`publicPipelineActionRow` 不再展开 `projectAccountState`），accounts/bootstrap/profile/pipeline 全部统一为"无 state DTO、前端直读裸字段"；原固定差异的 `lifecycle_state_projection` pipeline 测试更新为无 DTO 契约。全量 1936/1936 绿灯。
8. 阶段 B 收尾：`da34bc2` 将 `assertAccountStateContract` 接入回收/恢复三个完整视图写点（reject/trash/restore 落库前校验合并目标视图），§4 强化完成。全量 1941/1941 绿灯。
9. 阶段 B 种子收敛：`929b8c1` 让生产冒烟夹具（smoke_test_data.js）写 next_action 计划时配 `next_action_time_basis`（'utc' 建立、'' 清理、快照恢复原 basis），与 §4.3 生产语义一致。全量 1943/1943 绿灯。阶段 B 业务侧收尾完成；剩余项涉红线（AI 写点）与前端（状态解释器）。
10. 阶段 C 首片：`78e698b` 把 accounts 列表（`listCustomerAccounts`，无 view_contacts 分支）从递归 `redactContactFields` 黑名单切到字段级白名单 `contactSafeAccountRecord`（FIELDS_CATALOG 派生 + 显式业务键，此前定义未接线），白名单补 `is_test_data`/`test_run_id` 使切换逐键等价（blacklist≡whitelist 契约 + API 行为契约）。全量 1946/1946 绿灯。续：剩余黑名单路径评估、范围解释器统一、按页面合同。
11. 阶段 C 次片：`5e992fe` 把 intake 页（`queryIntakeFlowPage`，intake/lead_flow）从递归黑名单切到新字段级白名单 `contactSafeIntakeRecord`（`CONTACT_SAFE_INTAKE_KEYS` 镜像黑名单保留的全部键；contact_*/evidence/report_url/decision_reason/return_reason 继续隐藏），等价 + API 行为契约锁定。全量 1949/1949 绿灯。续：通知/评估/bootstrap 黑名单路径评估、范围解释器统一、按页面合同。
12. 阶段 C 通知片：`1835f73` 把通知页（`listNotificationRows`）从递归黑名单切到新字段级白名单 `contactSafeNotificationRecord`（镜像黑名单保留的全部键；title/detail 属 CONTACT_KEYS，对无 view_contacts 一并剥离，忠实镜像），sales 收件人裁剪保持。全量 1952/1952 绿灯。续：evaluation/db bootstrap 黑名单路径评估、范围解释器统一、按页面合同。
13. 阶段 C S3 形状：`38bfe7d` 建 timeline/auditLog 字段级白名单（timeline 剥 copy 字段、provenance 泄漏校验；audit 剥 action），等价/泄漏契约 3/3，为 S4/S6 可复用形状。S5（export）审计发现 users 形状经黑名单保留 password_hash/password_salt——判定暂缓（或先修合规）。全量 1955/1955 绿灯。续：S6（db bootstrap）→ S4（recycle-profile）。
14. 阶段 E 最新恢复点：`e59bf22` profile-only 只读兼容契约、`8a86425` 独立 widget host 隔离、`3adc1d1` identity/source tags UMD、`c246360` List widget 协议、`ed40d76` 主管指标列表、`a52e42b` Team 三类业务列表、`75a30b7` Insights 人工评价列表、`f1fe7d1` 受保护客户目录、`6001f61` 维护运行记录、`61a6572` 跟进更正历史、`3e55b41` 审计只读列表、`8d1bb05` 账号/归档/权限组/迁移复核/入库批次列表、`79036e5` CRM 抽屉非 AI 注册表组合与默认 iframe 边界、`092d8a0` 复杂 activity timeline 条目 widget 化、`549fdfd` 用户级多级排序与服务端白名单、`062f31a` 项目锁定 Playwright 1.62.1、`583f314` browser acceptance 断言均已落地；本轮列表/排序定向 `67/67`、逐页面 JSON 字段烟测全部通过，Phase E harness contract `5/5`、core `npm test` `1726/1726`、全量 `node --test` `2088/2088`、Playwright manager/sales 隔离验收退出码 0，`node --check`、diff check、治理权威与 AI 边界门禁均通过；权限配置矩阵、事务预览/审核工作区明确为专用组件；AI 功能弃用冻结。阶段 E 完成门已通过，生产未启动或写入。

下一可执行动作：保持 `89e6509` 作为 Stage D 非 AI 管理流程回滚点、`f0ab815` 作为阶段 G 路由装配回滚点，继续维持 AI 功能弃用冻结。raw shape 首轮收口后，继续做 Stage B/D 状态解释与今日待办边界复核、运行只读依赖风险评估并重跑全量门禁。若要继续缩小 `sales_crm.js`，必须先使用 `2026-09-02-high-coupled-stage-d-audit.md` 中的 service contract 另立切片；本轮不再机械拆分。列表迁移、用户级多级排序、CRM 抽屉非 AI 注册表组合、复杂 activity timeline 展示层与浏览器验收均已完成。

15. 2026-09-02 高耦合边界审计与 Stage D 收口：`89e6509` 将 manager intervention / deferred plan 收口为独立非 AI 应用服务，既有 manager API 权限、范围、幂等、事务、错误码和生命周期网关语义保持；资料聚合、profile 脱敏、迁移复核、入库扫描/动作、评价写入/重试、全局认证/审计策略、密码和 AI task middleware 均按审计保留原位。当前 core `npm test` `1748/1748`、全量 `node --test` `2110/2110`；详见 `docs/governance/sessions/2026-09-02-high-coupled-stage-d-audit.md`。

未全绿前不新增阶段 A–E 的功能或拆分范围。
