# TradePulse 重构进度看板

> 自动生成于 `2026-08-30 05:09:23`；运行 `npm run board` 手动重新生成，每个切片收尾自动更新。
> 数据源：git 提交（origin/main..HEAD）、lib/ 代码扫描、CURRENT_STATE.md、sessions/。

## 总览

| 指标 | 当前值 |
|---|---|
| 分支 | `codex/frontend-widget-pilot` |
| HEAD | `c4bba3f`（相对 origin/main ahead 117） |
| 工作区 | 有未提交改动 |
| 全量测试 | `node --test` 1926/1926 |
| 核心测试 | `npm test` 1565/1565 |
| sales_crm.js | 12969 行 |
| lib/domains | 42 个文件，生产接线 39 个 |
| 最近会话 | `2026-08-29-phase-b-section4-buildAlerts-projection.md` |

## 提交分布（origin/main..HEAD）

| 类别 | 数量 |
|---|---|
| refactor(state) 状态写收敛 | 8 |
| refactor(domains) 域接线 | 20 |
| refactor(其他/通用) | 39 |
| feat(...) | 15 |
| docs(governance) | 23 |
| 其他 | 12 |

## 阶段 0：治理基础

> **已完成** — 治理目录、权威顺序、前后基线（before/repo/after）、工作区迁移、会话纪律。

### 已完成

- [x] 治理文档体系与权威顺序建立（`09ef77e`）
- [x] 新根目录迁移与基线校准（`2026-08-29 会话`）
- [x] 进度看板自动生成（本文件）（`本次`）

## 阶段 A：后端结构化切分（sales_crm 拆域）

> **进行中** — lib/domains 42 个文件；WIP 收敛曾回退全部接线，接线恢复已完成（39/42 已接入，3 个按裁定保持内联）。

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
| `lib/domains/commerce/rules.js` | [x] 已接线 | a853a16 |
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

> **进行中** — §1 完成门已达成（lib/ 对 crm_accounts 状态/计划/主管列零裸写）；§4 强化含 buildAlerts（754d023）与 buildTeamReport（c4bba3f）投影消费；契约测试 49 断言。

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

### 待办

- [ ] **B-P1** §4 强化续：§4.4 剩余（pipelineActionKeys 裸列评估、assertAccountStateContract 接入回收路径）
- [ ] **B-P2** AI next_action 写点与测试专用种子收敛（AI 受红线约束）
- [ ] **B-P3** pipeline 与 accounts 的 state DTO 边界差异收敛

## 阶段 C：权限/筛选/字段

> **进行中** — field catalog、schema 渲染、白名单投影已提交；页面覆盖未完成。

### 已完成

- [x] 字段目录与 schema 驱动显示（5 提交）（`7a26074…077c88c`）
- [x] contact-restricted 白名单投影（access_control 直连）（`9607123…6d7e540`）
- [x] 身份/筛选 facade 与认证中间件抽取（被 WIP 精简，调用方直连真源）（`003b527…61f8c34`）

### 待办

- [ ] **access** 页面级覆盖与白名单回归收尾

## 阶段 D：线索/任务/商业闭环

> **进行中** — intake/assignment/planning/commerce 域模块已抽取并接线；闭环边界收口未完成。

### 已完成

- [x] intake/assignment/decision/query/owner 域模块接线恢复（`48ba93c…8a0ee7d`）
- [x] planning/alerts/risk/streak/today_task 域模块接线恢复（`7328b51…5c23b32`）
- [x] commerce/rules 域模块接线恢复（`a853a16`）

### 待办

- [ ] **commerce** 商业闭环（rfq→quote→order）领域边界成型

## 阶段 E：前端 widgets

> **进行中** — profile widgets、字段分组、用户偏好已试点；注册表与 iframe 收敛未完成。

### 已完成

- [x] 字段目录/widget 试点提交（`7a26074…077c88c`）

### 待办

- [ ] **frontend** widget 注册表落地
- [ ] **frontend** 客户完整资料 iframe 收敛为统一壳

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
