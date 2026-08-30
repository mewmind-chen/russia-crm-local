# TradePulse 重构路线图

更新时间：2026-08-29
基线：`origin/main@57c4c42a89e7730545b726b29fd932c5bfb20574`
执行分支：`codex/frontend-widget-pilot@cb6c6e4`（相对基线 ahead 108，未合并）
状态：路线图执行中；阶段 A 接线恢复 13 切片全部完成（42 个域模块 39 个已接入），阶段 B §1 写点收敛完成门达成（含 updateAccount profile 编辑，lib/ 对 crm_accounts 状态/计划/主管列零裸写），阶段 B §4 强化推进中（assert*Transition 守卫 + 状态契约不变量守卫 + time_basis 投影维度 + 告警/报告/pipeline 读路径投影消费），state DTO 边界已收敛（pipeline 行不再附加），全绿

## 当前进度快照

| 阶段 | 状态 | 已有证据 | 尚未完成 |
|---|---|---|---|
| 阶段 0：治理基础 | 已完成并迁移 | 治理文档、前后基线、新根目录 | 本轮文档更新待提交 |
| 阶段 A：后端结构化切分 | 接线恢复完成（39/42 已接入） | `lib/domains/` 42 个文件；39 个域模块已接入（13 个接线切片、24 契约断言），sales_crm.js 12,966 行 | 仅剩 identity/index、identity/middleware、filter/index 三个模块按用户裁定保持内联/精简；聚合文件仍超 1.2 万行 |
| 阶段 B：状态真源 | §1 完成门+§4 强化推进中 | 全部写点收敛到 state_write/collaboration_write 网关（9 切片，含 updateAccount profile 编辑 `aabe4d9`），零裸写；§4 强化已落地 assertQuoteTransition/assertFirstOrderTransition 守卫（`0ae90af`）、assertAccountStateContract 状态契约不变量守卫（`9186a6d`，recycled/returned）、projectNextAction time_basis 维度（`cb6c6e4`）、buildAlerts 告警路径（`754d023`）、buildTeamReport 报告路径（`c4bba3f`）与 pipelineActionKeys 动作键路径（`fe77fb4`）消费投影；state DTO 边界已收敛（pipeline 行不再附加，`6b88d74`） | §4 剩余（assertAccountStateContract 接入回收路径）、AI 写点收敛（红线）、状态解释器统一消费 |
| 阶段 C：权限/筛选/字段 | 进行中 | field catalog、schema 渲染、多个白名单投影已提交 | 白名单兼容回归已恢复；页面覆盖未完成 |
| 阶段 D：线索/任务/商业闭环 | 部分开始 | intake、assignment、planning、commerce helper 已抽取 | 尚未形成完整领域边界 |
| 阶段 E：前端 widgets | 试点完成、架构未完成 | profile widgets、字段分组、用户偏好 | 注册表未落地；iframe 仍存在；`app.js` 仍约 1.4 万行 |
| 阶段 F：AI 零动作 | 持续遵守 | AI 内部未纳入本次重构 | 后续继续保持冻结 |
| 阶段 G：兼容层收尾 | 未开始 | - | 等前述阶段稳定后执行 |

阶段状态只用于导航，具体 Git、WIP 和测试数以 `CURRENT_STATE.md` 为准。

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
把权限、数据范围、字段投影和筛选授权拆成明确组合，并让**字段内容**（线索池、客户资料、客户列表等页面的字段）可配置化自由显示。

### 关键动作
- 把 `access_control` / `permission_groups` / `filter_authorization` 的共享逻辑抽到 `identity/filter`。
- 统一 `buildAccessContext` 与列表查询使用同一范围解释器。
- 落地 **字段目录（FIELDS_CATALOG）**：具体字段定义与试点顺序见 `FIELD_CATALOG.md`；首个试点为线索池（intake/lead_flow），随后客户资料、客户列表。
- 服务端按 角色 + 权限 + 开关 计算**有效字段 schema**（per-page, per-user，含版本，`/field-schema/:pageKey`，冲突码 `FIELD_SCHEMA_VERSION_CONFLICT`），与筛选 schema 同源。
- Widget 按字段 schema 渲染列/详情/表单，前端不再硬编码字段名（消除 `app.js` 中硬编码渲染）。
- 用字段级白名单投影替换 `CONTACT_KEYS` 递归黑名单；未授权字段不下发数据；过渡期保留 `redactContactFields` 兜底并断言结果一致。
- 为每个页面建立“权限->字段->筛选”的合同测试。
- 后续可选：用户/角色级字段显隐覆盖（个人偏好配置），仍由配置驱动。

### 完成门
- 任意角色的页面/API/导出在字段和筛选上得到同一结论。
- 线索池、客户资料、客户列表等页面的字段显隐可通过配置（角色/权限/开关）调整，无需改代码。
- `FILTER_VERSION_CONFLICT`、`FIELD_SCHEMA_VERSION_CONFLICT`、`CUSTOMER_DUPLICATE`、`blockedWhileImpersonating` 语义保持一致。

## 阶段 D：线索、任务与商业闭环收口

### 目标
把 intake、assignment、planning、commerce 的跨域流程固定下来。

### 关键动作
- `crm_intake_*` 逻辑拆出并保留幂等/裁决/审计。
- `next_action` 与 alerts 使用统一解释器。
- RFQ / quote / order / action request 的事务边界显式化。
- manager intervention 与 deferred plan 作为独立用例。

### 完成门
- 批量扫描、分配、领取、退回、报价、订单、下一步建议均可通过独立域测试验证。
- 无必须依赖 `sales_crm.js` 内部私有状态。

## 阶段 E：前端 widget 组合架构与客户完整资料统一

### 目标
把“新壳 iframe + 旧版 `Index.html` 双用途页面”组合下的客户完整资料收敛为统一壳内的 widget 组合视图，并让整个前端变成“模块化、自由搭建、自由选择显示内容”的架构，后续前端 issue 只改对应 widget。

### 现状（已核对代码）
- 正式入口 `/` 返回统一壳 `sales-crm.html`（`server.js:72`）；`/sales` 是 302 重定向到 `/`（`lib/sales_crm.js:5044`）。
- `sales-crm.html#customerProfileView` 通过 `<iframe id="customerProfileFrame">` 加载 `/development-workbench?embedded=1&profile=1&assistant=0&prospect=0&customer=<id>[&intake=<id>]`。
- `/development-workbench` 由 `server.js` 返回旧版 `Index.html`，同一页面按 query 承担“旧工作台（`/legacy`）”与“被嵌入的客户完整资料”两种用途，客户完整资料不是独立、可复用的底层。
- 资料数据来自统一 API：`/api/sales-crm/profile/:customerId` 与 `/api/sales-crm/intake/:itemId/profile`（均调用 `getCustomerProfileData`）。
- 前端资产：`sales-assets/app.js`（约 1.4 万行，统一壳主逻辑）、`sales-assets/filter-component.js`（独立 UMD 组件范式）、`Index.html`（旧版，内嵌脚本）；`/legacy` 与 `/tradelead-v2.html` 由 `CRM_ENABLE_LEGACY` 控制（`server.js:73-78`）。
- 显隐机制已存在：`[data-permission]` 权限显隐、`[data-ai-business]` AI 开关显隐（`app.js` `applyBusinessAIVisibility`）、bootstrap 下发 `permissions + features`。

### 关键动作
1. **建立 Widget 注册表**：widget 元数据（id、页面、权限、开关、位置、顺序、加载方式），页面 = 注册表配置化组装；新增/隐藏内容只改配置。
2. **Widget 化**：按功能拆独立 widget（身份、业务画像、联系人、洞察/评价、时间线、商务、下一步、回收状态、AI 区域等），每个 widget 自包含模板/状态/事件，对外只暴露 `render(container, ctx)`；以 `filter-component.js` 的 UMD 模式为范式。
3. **客户完整资料统一**：`#customerProfileView` 改为统一壳内的 widget 集合，直接消费 `getCustomerProfileData` 返回结构（客户/线索/回收三种来源复用同一集合）；`#customerDrawer` 与完整资料共用同一 widget 集合。
4. **AI 区域**：登记为 widget，由现有开关决定是否挂载/显示，AI 内部代码零改动。
5. **权限与开关裁剪**：widget 显隐沿用 `data-permission` / `data-ai-business` 等价机制 + bootstrap features。
6. 统一视图通过验收后，`/development-workbench` 的 profile 模式与旧版 `Index.html` 收敛为只读/兼容入口（先确认现有使用方，再决定下线方式）；`/legacy`、`/tradelead-v2.html` 继续由 `CRM_ENABLE_LEGACY` 控制。

### 完成门
- 客户完整资料不再加载 `/development-workbench` iframe。
- 联系人管理、评价/洞察、时间线、商务、下一步在统一视图中可用，三角色权限与脱敏行为与现状一致。
- 关闭 AI 开关时 AI widget 不显示；开启时行为与现状一致。
- 新增/隐藏前端内容只需改注册表配置或对应 widget，`app.js` 不再需要整体改动。

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
2. 阶段 A 接线恢复 13 个切片已全部落地（`0560e9c`→`5c23b32`：42 个域模块中 39 个重新接入，含纯函数 drop-in 与注入式错误构造经调用点注入保持语义），接线契约 24/24；全量 1913/1913 绿灯。
3. 阶段 A 接线恢复完成：剩余 `identity/index`、`identity/middleware`、`filter/index` 三个模块按用户裁定保持内联/精简，不再接线。后续如需继续减单体，评估已漂移模块（如 `customer/normalize` 的纯常量/配置类）。
4. 阶段 B §4 强化已分 6 片落地：`0ae90af` `addQuote`/`addOrder` stage 前置校验提炼为网关 `assertQuoteTransition`/`assertFirstOrderTransition` 守卫（`STAGE_INDEX` 单调推进 + `STAGE_PRECONDITION_VIOLATION`）；`9186a6d` 注册 `assertAccountStateContract` 不变量守卫（§4.1 recycled 不配 claimed/assigned、§4.2 returned 不绑 owner）；`cb6c6e4` `projectNextAction` 纳入 time_basis 维度（§4.3 有值必配 basis 否则 degraded）；`754d023` `buildAlerts` 告警路径收敛到 `projectNextAction` 投影（§4.4）并修正 issue225 测试种子补写 basis；`c4bba3f` `buildTeamReport` 报告路径 planned/overdue 收敛到 `projectNextAction` 投影（§4.4）；`fe77fb4` `pipelineActionKeys` 的 due_followup/manager_assistance 收敛到 `projectNextAction.overdue`/`projectManagerState`，并移除失效的 `nowText` 参数（§4.4）。全量 1927/1927 绿灯。
5. 阶段 B §1 收尾：`aabe4d9` 把 `updateAccount`（profile 编辑，此前经动态字段直写 stage/owner/assignment/next_action/manager_*）收敛到 state/plan/manager 三个网关，claim/unassign 权限子流保持；§1"零裸写"完成门经审计纠正后达成。全量 1934/1934 绿灯。
6. 阶段 B §1 收尾：`aabe4d9` 把 `updateAccount`（profile 编辑，此前经动态字段直写 stage/owner/assignment/next_action/manager_*）收敛到 state/plan/manager 三个网关，claim/unassign 权限子流保持；§1"零裸写"完成门经审计纠正后达成。全量 1934/1934 绿灯。
7. 阶段 B 边界收敛：`6b88d74` 移除 pipeline 行的 state DTO（`publicPipelineActionRow` 不再展开 `projectAccountState`），accounts/bootstrap/profile/pipeline 全部统一为"无 state DTO、前端直读裸字段"；原固定差异的 `lifecycle_state_projection` pipeline 测试更新为无 DTO 契约。全量 1936/1936 绿灯。
8. 阶段 B 收尾：继续 §4 强化剩余（将 `assertAccountStateContract` 接入回收/恢复路径的完整视图校验）、AI 写点（受红线约束）与种子收敛（`last_activity_at` 已定为活动溯源）。

未全绿前不新增阶段 A–E 的功能或拆分范围。
