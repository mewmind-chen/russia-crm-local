# TradePulse 重构进度看板

> 自动生成于 `2026-09-03 08:32:49`；运行 `npm run board` 手动重新生成，每个切片收尾自动更新。
> 数据源：git 提交（origin/main..HEAD）、lib/ 代码扫描、CURRENT_STATE.md、sessions/。

## 总览

| 指标 | 当前值 |
|---|---|
| 分支 | `codex/frontend-widget-pilot` |
| HEAD | `36b5cca`（相对 origin/main ahead 405） |
| 工作区 | 有未提交改动 |
| 全量测试 | `node --test` 2148/2148 |
| 核心测试 | `npm test` 1786/1786 |
| sales_crm.js | 11336 行 |
| lib/domains | 44 个文件，生产接线 41 个 |
| 最近会话 | `2026-09-03-readonly-dependency-architecture-audit.md` |

## 提交分布（origin/main..HEAD）

| 类别 | 数量 |
|---|---|
| refactor(state) 状态写收敛 | 10 |
| refactor(domains) 域接线 | 20 |
| refactor(其他/通用) | 70 |
| feat(...) | 57 |
| docs(governance) | 215 |
| 其他 | 33 |

## 阶段 0：治理基础

> **已完成** — 治理目录、权威顺序、前后基线（before/repo/after）、工作区迁移、会话纪律。

### 已完成

- [x] 治理文档体系与权威顺序建立（`09ef77e`）
- [x] 新根目录迁移与基线校准（`2026-08-29 会话`）
- [x] 进度看板自动生成（本文件）（`本次`）

## 阶段 A：后端结构化切分（sales_crm 拆域）

> **已完成** — lib/domains 44 个文件；WIP 收敛曾回退全部接线，接线恢复已完成（41/44 已接入，含 action_request 经 write.js 域间接线，3 个按裁定保持内联）。

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

> **已完成** — §1 写点收敛与 §4 守卫/投影/读路径均已完成（含 updateAccount、回收/恢复、pipeline DTO 与 smoke time_basis）；`b25ad55` 进一步锁定前端 raw-field contract、manager/deferred/today-task 边界与共享投影。AI next_action 写点属于冻结红线，不作为待办。

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
| 状态投影与 manager/deferred/today-task 一致性复核 | `b25ad55` | 2026-09-03 |

## 阶段 C：权限/筛选/字段

> **已完成** — field catalog、schema 渲染、白名单投影、权限→字段→筛选合同与各形状递归脱敏均已闭合；`e10793c` 补齐 raw recon/people/prospect/templates 未知列、源头权限和显式 builder。P1/P3 及 S4/S6 顶层复合白名单迁移按嵌套等价门禁明确冻结，不计为遗漏。

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
- [x] legacy customers bootstrap/profile 字段级白名单（CONTACT_SAFE_CUSTOMER_ROW_KEYS，tags 泄漏校验）（`c595bf0`）
- [x] P1/P3 loadIntakeState 深层形状审计（顶层白名单泄漏证据与残余 lastActivitySummary 风险）（`审计契约`）
- [x] P1/P3 递归脱敏合规边界（lastActivitySummary、complementaryInfo 任意 JSON、arbitration 深层字段）（`f2ec235`）
- [x] S5/P5 export 凭据字段递归合规边界（password/token/session/secret 及嵌套 JSON）（`ccc9bb5`）
- [x] S7 剩余 redactContactFields 调用点审计与迁移边界契约（独立列表投影闭合；AI 红线冻结）（`a57c44f`）
- [x] S4/P4 recycle profile/master profile 逐形状安全契约与迁移门禁（高耦合复合保留）（`09665b5`）
- [x] S6/P2 Bootstrap/masterProfile 共享叶子逐形状契约与复合迁移门禁（establishedYear 修正；recon 漂移保留递归）（`3022dae`）
- [x] S4/P4 masterProfile/people/recon 逐形状权限/递归契约与 profile 路由后处理复裁剪（recycle_reason 收口；复合迁移仍门控）（`343f166`）
- [x] raw recon/people/prospect/templates 未知列、源头权限、自由文本与显式 builder 形状契约（复合迁移保持冻结）（`e10793c`）

## 阶段 D：线索/任务/商业闭环

> **已完成** — intake/assignment/planning/commerce 域模块已抽取并接线；RFQ→quote→order 商业闭环与非 AI manager intervention / deferred plan 应用服务均已收口，`b25ad55` 验证状态投影、经理介入/延期计划/今日待办边界一致，既有权限、幂等、事务、生命周期网关和审计语义保持。

### 已完成

- [x] intake/assignment/decision/query/owner 域模块接线恢复（`48ba93c…8a0ee7d`）
- [x] planning/alerts/risk/streak/today_task 域模块接线恢复（`7328b51…5c23b32`）
- [x] commerce 域模块接线恢复（rules/write/action_request 级联）（`a853a16…b4cfdfc`）
- [x] 商业闭环成型：action_request 事务边界 + 行级写 + 金额/币种/毛利校验 + commitQuote/commitOrder 域服务（`1d15546…b4cfdfc`）
- [x] 非 AI manager intervention / deferred plan 独立应用服务（注入授权、范围、生命周期网关、通知与审计）（`89e6509`）

## 阶段 E：前端 widgets

> **已完成** — 阶段 E 完成门已通过：customerProfile 默认 widget、profile-only 只读兼容、独立 host、全范围非 AI List widget（含用户级多级排序）、CRM 抽屉非 AI 注册表、复杂 activity timeline widget 与旧入口兼容边界均已落地；`062f31a` 锁定 Playwright `1.62.1`，`583f314` 补齐 browser acceptance 断言，隔离临时 SQLite/loopback/AI 关闭环境下 sales/manager 双角色均通过默认 widget、无 legacy iframe、source-tag 宿主存在、AI widget/标记隐藏、profile-only 无保存动作。权限配置矩阵、事务预览/审核工作区保留专用组件；AI 列表与 AI 专用工作区冻结，不纳入迁移。

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
- [x] List widget 协议 + 客户列表样板（列显隐/顺序、用户布局偏好、服务端排序预设、客户字段 schema）（`c246360`）
- [x] List widget 用户级升降序/多级排序收口（服务端授权白名单、稳定主键、非法请求 403）（`549fdfd`）
- [x] Research People 列表迁移（授权列 schema、用户布局偏好、四种服务端排序）（`3c9a97f`）
- [x] Research Recon 列表迁移（授权列 schema、用户布局偏好、三种服务端排序）（`2f3dc4a`）
- [x] 不对口记录列表迁移（授权列 schema、用户布局偏好、四种服务端排序）（`1bbc5c4`）
- [x] Pipeline 推进动作台列表迁移（授权列 schema、用户布局偏好、四种服务端排序）（`eb73388`）
- [x] Intake/lead_flow 线索列表迁移（授权列 schema、用户布局偏好、四种服务端排序）（`fffde40`）
- [x] Alerts/今日待办列表迁移（授权列 schema、用户布局偏好、四种服务端排序）（`dfe5937`）
- [x] 通知中心列表迁移（授权列 schema、用户布局偏好、四种服务端排序）（`302454f`）
- [x] Dashboard 国家转化与价值快照迁移（授权列 schema、用户级布局偏好、六种本地排序）（`ebf0dbe`）
- [x] Markets 国家矩阵、分配批次与细分报表迁移（授权列 schema、用户级布局偏好、本地排序预设）（`cd9f198`）
- [x] 主管任务列表迁移（授权列 schema、用户级布局偏好、期限/状态/负责人排序，保留任务动作）（`b1fa1cc`）
- [x] 主管风险明细列表迁移（授权列 schema、独立用户布局偏好、期限/状态/负责人排序，保留查看历史动作）（`807b56c`）
- [x] 主管指标列表迁移（聚合字段 schema、独立用户布局偏好、销售/指标排序，保留数字钻取动作）（`ed40d76`）
- [x] Team 进度/协作列表迁移（三套非 AI 字段 schema、独立用户布局偏好、排序与原有钻取/追加动作）（`a52e42b`）
- [x] Insights 人工评价列表迁移（非 AI 字段 schema、独立用户布局偏好、服务端排序与人工评价动作）（`75a30b7`）
- [x] 受保护客户目录迁移（授权人工字段 schema、用户布局偏好、安全服务端排序，保留导入/批次/冲突/导出/行操作）（`f1fe7d1`）
- [x] 维护运行记录只读列表迁移（人工字段 schema、用户布局偏好、本地排序，保留 limit=20 与预览/执行契约）（`6001f61`）
- [x] 跟进更正历史只读列表迁移（人工字段 schema、用户布局偏好、本地排序，保留筛选/分页与 target/proposal/review 审批流）（`61a6572`）
- [x] 审计只读列表迁移（人工字段 schema、用户布局偏好、当前 bootstrap 结果本地排序，保留 view_users/脱敏/详情截断）（`3e55b41`）
- [x] 账号、归档用户、权限组、迁移复核与入库批次列表迁移（人工字段 schema、用户级列显隐/顺序/排序，保留高风险动作门控）（`8d1bb05`）
- [x] 权限配置矩阵及事务预览/审核工作区明确为专用组件例外；AI 列表与 AI 专用工作区保持弃用冻结（`8d1bb05`）
- [x] Phase E 隔离浏览器预览 harness（临时 SQLite/loopback/随机端口/AI 关闭/fail-closed）（`dd650ba`）
- [x] Phase E harness 加强：验证默认 customerProfile widget/iframe 边界与 profile-only 只读动作（`3b2fe24`）
- [x] CRM 抽屉非 AI 区块纳入 crmDrawer 注册表；默认 widget 模式清理兼容 iframe src，legacy-only 刷新（`79036e5`）
- [x] 复杂 CRM activity timeline 条目 widget 化（宿主注入权限/溯源回调，保留 inline fallback）（`092d8a0`）
- [x] 旧入口兼容边界锁定：统一根路径为 canonical，/legacy 与 /tradelead-v2.html 仅在 CRM_ENABLE_LEGACY=true 时开放（`bc84567`）
- [x] Phase E sales/manager 浏览器验收（Playwright 1.62.1、默认 widget/无 iframe、source-tag 宿主、AI 关闭、profile-only 只读）（`062f31a…583f314`）
- [x] Phase E preview 首帧竞态修复（widget host/iframe 隐藏/空 src 三条件稳定采样）（`dc51fed`）

## 阶段 F：AI 零动作

> **已完成** — lib/ai_stations/**、crm_ai_*、CRM_AI_* 与既有 AI 触发点零改动（红线持续遵守）。

### 已完成

- [x] AI 面冻结持续核验（`持续`）

## 阶段 G：兼容层收尾

> **已完成** — 兼容层路由/入口装配已收敛：旧 HTML 入口、profile 资源、认证/账号、列表/读取、团队/主管、活动、受保护客户、bootstrap、业务写入与后台管理路由均由独立注册器装配；资料聚合、迁移复核、入库/评价和 AI 运行时等高耦合边界按审计保留原位。

### 已完成

- [x] 旧入口 /legacy 与 /tradelead-v2.html 抽为独立可选装配，保持 CRM_ENABLE_LEGACY 与 canonical / 行为（`d615410`）
- [x] profile 资源与 development-workbench 权限分流抽为独立装配（`7d6e88a`）
- [x] 团队/协作、联系人、页面入口与认证/账号路由注册器接线（`23b6365…bf1f114`）
- [x] 读取/列表、主管、活动、受保护客户路由注册器接线（`fc5bfcd…4be94c3`）
- [x] bootstrap、业务写入与后台管理/维护/筛选路由注册器接线（`077617b…f0ab815`）
- [x] 高耦合资料聚合、迁移复核、密码、入库/评价与 AI 路由保留原位并记录边界（`审计结论`）

## 上线前准备

> **进行中** — 已形成非 AI、非生产的 release candidate 准备包与可重复只读 preflight；当前发布仍为 NO-GO，等待候选进入 origin/main、依赖风险决策及独立的生产 UAT/备份/部署授权。

### 已完成

- [x] 只读 release-preflight 门禁（基线、工作树、冻结路径、测试、治理、AI、依赖）（`本目标`）
- [x] 发布清单、非 AI 验收矩阵、备份/schema dry-run/回滚/健康检查 runbook（`本目标`）

### 待办

- [ ] **R1** 依赖 high/moderate 风险完成修复或明确风险接受，并重新生成 GO preflight
- [ ] **R2** 候选进入 origin/main 后，另立目标执行生产 UAT、备份、维护窗口、部署与回滚演练

## 阶段门禁

- `git diff --check` 通过；全量与专项测试绿灯；权限/状态/筛选回归通过。
- 工作区干净；治理文档（CURRENT_STATE + session + 看板）随业务独立提交。

## 红线

- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 及既有 AI 触发点。
- 不 push、不 merge、不部署、不改生产数据；只在 `after/` 内工作。
