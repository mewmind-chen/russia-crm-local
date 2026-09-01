# TradePulse 重构进度看板

> 自动生成于 `2026-09-01 03:21:58`；运行 `npm run board` 手动重新生成，每个切片收尾自动更新。
> 数据源：git 提交（origin/main..HEAD）、lib/ 代码扫描、CURRENT_STATE.md、sessions/。

## 总览

| 指标 | 当前值 |
|---|---|
| 分支 | `codex/frontend-widget-pilot` |
| HEAD | `f544554`（相对 origin/main ahead 216） |
| 工作区 | 干净 |
| 全量测试 | `node --test` 2031/2031 |
| 核心测试 | `npm test` 1670/1670 |
| sales_crm.js | 12883 行 |
| lib/domains | 44 个文件，生产接线 41 个 |
| 最近会话 | `2026-09-01-phase-e-source-tags-widget.md` |

## 提交分布（origin/main..HEAD）

| 类别 | 数量 |
|---|---|
| refactor(state) 状态写收敛 | 10 |
| refactor(domains) 域接线 | 20 |
| refactor(其他/通用) | 54 |
| feat(...) | 32 |
| docs(governance) | 85 |
| 其他 | 15 |

## 阶段 0：治理基础

> **已完成** — 治理目录、权威顺序、前后基线（before/repo/after）、工作区迁移、会话纪律。

### 已完成

- [x] 治理文档体系与权威顺序建立（`09ef77e`）
- [x] 新根目录迁移与基线校准（`2026-08-29 会话`）
- [x] 进度看板自动生成（本文件）（`本次`）

## 阶段 A：后端结构化切分（sales_crm 拆域）

> **进行中** — lib/domains 44 个文件；WIP 收敛曾回退全部接线，接线恢复已完成（41/44 已接入，含 action_request 经 write.js 域间接线，3 个按裁定保持内联）。

### 域模块接线状态（自动扫描）

| 模块 | 状态 | 接线提交 |
|---|---|---|
| `lib/domains/activity/present.js` | [x] 已接线 | e9f29d0 |
| `lib/domains/activity/progress.js` | [x] 已接线 | f5eb7f2 |
| `lib/domains/activity/request.js` | [x] 已接线 | 0fcbf71 |
| `lib/domains/activity/serialize.js` | [x] 已接线 | 7328b51 |
| `lib/domains/assignment/link.js` | [x] 已接线 | 48ba93c |
| `lib/domains/audit/redact.js` | [x] 已接线 | 0560e9c |
| `lib/domains/auth/access.js` | [x] 已接线 | ad657ac |
| `lib/domains/auth/credentials.js` | [x] 已接线 | ad657ac |
| `lib/domains/auth/session.js` | [x] 已接线 | ad657ac |
| `lib/domains/auth/user.js` | [x] 已接线 | 8a0ee7d |
| `lib/domains/commerce/action_request.js` | [x] 已接线 | b4cfdfc |
| `lib/domains/commerce/rules.js` | [x] 已接线 | a853a16 |
| `lib/domains/commerce/write.js` | [x] 已接线 | f5c650e |
| `lib/domains/customer/contacts.js` | [x] 已接线 | ad657ac |
| `lib/domains/customer/create.js` | [x] 已接线 | 5c23b32 |
| `lib/domains/customer/dedupe.js` | [x] 已接线 | dab8168 |
| `lib/domains/customer/identity.js` | [x] 已接线 | ad657ac |
| `lib/domains/customer/normalize.js` | [x] 已接线 | 47daed9 |
| `lib/domains/customer/recycle.js` | [x] 已接线 | a853a16 |
| `lib/domains/customer/summary.js` | [x] 已接线 | ad657ac |
| `lib/domains/filter/errors.js` | [x] 已接线 | 5c23b32 |
| `lib/domains/http/error.js` | [x] 已接线 | d51596c |
| `lib/domains/http/routes.js` | [x] 已接线 | d51596c |
| `lib/domains/insights/evaluation.js` | [x] 已接线 | 8a0ee7d |
| `lib/domains/insights/labels.js` | [x] 已接线 | 873d1b0 |
| `lib/domains/intake/assignment.js` | [x] 已接线 | 48ba93c |
| `lib/domains/intake/decision.js` | [x] 已接线 | 48ba93c |
| `lib/domains/intake/owner.js` | [x] 已接线 | 8a0ee7d |
| `lib/domains/intake/query.js` | [x] 已接线 | 48ba93c |
| `lib/domains/json/parse.js` | [x] 已接线 | 0560e9c |
| `lib/domains/lifecycle/collaboration_write.js` | [x] 已接线 | 2245032 |
| `lib/domains/lifecycle/state_projection.js` | [x] 已接线 | 9c84ead |
| `lib/domains/lifecycle/state_write.js` | [x] 已接线 | 2245032 |
| `lib/domains/list/pagination.js` | [x] 已接线 | 0560e9c |
| `lib/domains/notifications/visibility.js` | [x] 已接线 | 0560e9c |
| `lib/domains/planning/alerts.js` | [x] 已接线 | 7328b51 |
| `lib/domains/planning/risk.js` | [x] 已接线 | 7328b51 |
| `lib/domains/planning/streak.js` | [x] 已接线 | 7328b51 |
| `lib/domains/planning/today_task.js` | [x] 已接线 | 5c23b32 |
| `lib/domains/reporting/builders.js` | [x] 已接线 | 13c5368 |
| `lib/domains/reporting/csv.js` | [x] 已接线 | 873d1b0 |
| `lib/domains/filter/index.js` | [ ] 按裁定保持内联（不接线） | — |
| `lib/domains/identity/index.js` | [ ] 按裁定保持内联（不接线） | — |
| `lib/domains/identity/middleware.js` | [ ] 按裁定保持内联（不接线） | — |

### 已完成

- [x] lifecycle 网关接线（state_write/collaboration_write）（`13cd37a…227b3d7`）
- [x] 纯 helper 接线：json/list/audit/notifications（`0560e9c`）
- [x] http 接线：error/routes（`d51596c`）
- [x] csv/insights 接线（`873d1b0`）
- [x] activity/planning、intake/assignment、auth/customer、reporting 接线（`7328b51…13c5368`）
- [x] B 组：commerce/recycle、activity/present、customer/dedupe 等接线（`a853a16…5c23b32`）

## 阶段 B：状态真源

> **进行中** — §1 写点收敛完成门达成（含 updateAccount profile 编辑 aabe4d9，lib/ 对状态/计划/主管列零裸写）；§4 强化完成（守卫/投影/读路径收敛，含 assertAccountStateContract 接入回收/恢复 da34bc2）；state DTO 边界已收敛（pipeline 行不再附加，6b88d74）；smoke 种子收敛 929b8c1；契约测试 66 断言。

### 已落地切片

| 切片 | 提交 | 日期 |
|---|---|---|
| rejectCrmCustomer 状态写收敛（state_write） | `13cd37a` | 2026-08-29 |
| applyCustomerReturn 仅 assignment 收敛 | `06a9868` | 2026-08-29 |
| addQuote/addOrder stage 前置校验 | `a783c8c` | 2026-08-29 |
| addQuote/addOrder stage 写收敛 | `03d3e91` | 2026-08-29 |
| addQuote/addOrder 计划写收敛（collaboration_write） | `624ceae` | 2026-08-29 |
| addActivity 状态/计划/主管三路写收敛 | `d5d7b68` | 2026-08-29 |
| 今日任务/纯计划写收敛 | `8743912` | 2026-08-29 |
| 领取/主管任务/超时线索/重分配写收敛 | `531bc71` | 2026-08-29 |
| 回收/恢复写收敛 | `227b3d7` | 2026-08-29 |
| updateAccount profile 编辑写收敛 | `aabe4d9` | 2026-08-30 |
| pipeline 行 state DTO 边界收敛 | `6b88d74` | 2026-08-30 |
| 回收/恢复完整视图守卫接线 | `da34bc2` | 2026-08-30 |
| smoke 种子 time_basis 收敛 | `929b8c1` | 2026-08-30 |

### 待办

- [ ] **B-P1** AI next_action 写点（红线，仅评估）；last_activity_at 归属已明确为活动溯源

## 阶段 C：权限/筛选/字段

> **进行中** — field catalog、schema 渲染、白名单投影已提交；accounts/intake/通知列表与 S3 timeline/auditLog 形状已白名单化；范围解释器等价契约（2ca107b）与代码级统一（f2056e5）、按页面权限→字段→筛选合同（45e0c05）均已落地。

### 已完成

- [x] 字段目录与 schema 驱动显示（5 提交）（`7a26074…077c88c`）
- [x] contact-restricted 白名单投影（access_control 直连）（`9607123…6d7e540`）
- [x] 身份/筛选 facade 与认证中间件抽取（被 WIP 精简，调用方直连真源）（`003b527…61f8c34`）
- [x] accounts 列表切字段级白名单（contactSafeAccountRecord 接线，blacklist≡whitelist 契约）（`78e698b`）
- [x] intake 页切字段级白名单（contactSafeIntakeRecord 新投影，contact_* 隐藏）（`5e992fe`）
- [x] 通知页切字段级白名单（contactSafeNotificationRecord 新投影）（`1835f73`）
- [x] S3 形状：timeline/auditLog 白名单（含 provenance 泄漏校验）（`38bfe7d`）
- [x] 范围解释器等价契约：accountScope ≡ buildAccessContext（`2ca107b`）
- [x] 范围解释器代码级统一：共享 accountVisibilityScope（`f2056e5`）
- [x] 按页面权限→字段→筛选合同（sensitive/filter/whitelist 一致性）（`45e0c05`）

### 待办

- [ ] **access** 可选残值：legacy customers 形状白名单（S6 审计确认其余联系形状已源头门控）
- [ ] **access** P1/P3 loadIntakeState 与 S5 export 暂缓（嵌套泄漏 / users 密码哈希暴露，见设计）

## 阶段 D：线索/任务/商业闭环

> **进行中** — intake/assignment/planning/commerce 域模块已抽取并接线；RFQ→quote→order 商业闭环领域边界已成（1d15546/f5c650e/24aa67e/b4cfdfc）。

### 已完成

- [x] intake/assignment/decision/query/owner 域模块接线恢复（`48ba93c…8a0ee7d`）
- [x] planning/alerts/risk/streak/today_task 域模块接线恢复（`7328b51…5c23b32`）
- [x] commerce 域模块接线恢复（rules/write/action_request 级联）（`a853a16…b4cfdfc`）
- [x] 商业闭环成型：action_request 事务边界 + 行级写 + 金额/币种/毛利校验 + commitQuote/commitOrder 域服务（`1d15546…b4cfdfc`）

### 待办

- [ ] **commerce** 独立用例（manager intervention / deferred plan）不在闭环内，后续评估

## 阶段 E：前端 widgets

> **进行中** — customerProfile 默认 widget view 已接线（29282df）；/development-workbench profile-only 只读兼容契约已锁定（e59bf22，浏览器运行时无写入仍待验证）；widget registry 已实现独立 per-widget mount host 隔离（8a86425）；profile-facts、drawer-facts、drawer-ai、customer-ai-station、master-profile、insight-section、next-step（含告警条）、timeline 抽为自包含 UMD widget，三源抽屉 facts/主档/状态条/时间线共用；identity/source tags 的 sourceTagMarkup 已抽为自包含 UMD widget（3adc1d1，customerTags 只读投影、去重/limit/source-category-name 转义，AI gate 由 app 注入）。

### 已完成

- [x] 字段目录/widget 试点提交（`7a26074…077c88c`）
- [x] widget 注册表落地 + customerProfile 注册表化组装（`2d98eea`）
- [x] customerProfile 默认 widget view 接线（profile-only 兼容入口保留）（`29282df`）
- [x] /development-workbench profile-only 只读兼容契约（浏览器运行时无写入待验证）（`e59bf22`）
- [x] widget registry 每个 widget 独立 mount host（失败隔离/重渲染清理）（`8a86425`）
- [x] profile-facts 抽为自包含 UMD widget（模板/偏好/事件下沉）（`41a722e`）
- [x] drawer-facts 抽为自包含 UMD widget（三源 facts 统一）（`7c76fb3…8135ac2`）
- [x] drawer-ai 抽为自包含 UMD widget（AI 问答区，AI 零改动）（`64b9418`）
- [x] customer-ai-station 登记为 widget（现有开关决定挂载）（`39990be`）
- [x] master-profile 抽为共用 UMD widget（三源主档统一）（`3e84f63`）
- [x] insight-section 抽为共用壳 widget（洞察/商务/审计/时间线壳）（`6aa9353`）
- [x] next-step 抽为共用 widget（三源状态条 + 告警条/异常明细）（`f8e67c9…e920f7b`）
- [x] timeline 抽为共用 widget（开发历史/完整时间线条目）（`93b5dbb`）
- [x] identity/source tags：sourceTagMarkup 抽为自包含 UMD widget（只读投影、去重/limit/转义；AI gate 由 app 注入）（`3adc1d1`）

### 待办

- [ ] **frontend** 销售/经理页面浏览器验证：先建立临时 SQLite + 127.0.0.1 + 禁用 AI provider/monitor 的 Phase E preview harness，再验证默认 customerProfile 与 profile-only 兼容入口（尚未运行）
- [ ] **frontend** 其余 widget 化：身份/业务画像/洞察/商务/回收状态的具体 body
- [ ] **frontend** #customerDrawer 与完整资料共用同一 widget 集合（CRM 复杂 activity timeline 尚未下沉，剩余主体待评估）

## 阶段 F：AI 零动作

> **已完成** — lib/ai_stations/**、crm_ai_*、CRM_AI_* 与既有 AI 触发点零改动（红线持续遵守）。

### 已完成

- [x] AI 面冻结持续核验（`持续`）

## 阶段 G：兼容层收尾

> **待办** — 依赖阶段 A/B/C 稳定后执行；销售_crm 收敛为路由/聚合层，前端全由 widget 组装。

### 待办

- [ ] **compat** sales_crm 收敛为路由转发/聚合层
- [ ] **compat** 旧入口收敛与 widget 全组装

## 阶段门禁

- `git diff --check` 通过；全量与专项测试绿灯；权限/状态/筛选回归通过。
- 工作区干净；治理文档（CURRENT_STATE + session + 看板）随业务独立提交。

## 红线

- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 及既有 AI 触发点。
- 不 push、不 merge、不部署、不改生产数据；只在 `after/` 内工作。
