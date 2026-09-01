# TradePulse 当前状态

更新时间：2026-09-01
最近核验：2026-09-01，Asia/Shanghai

> 本文档是重构进度的滚动真源。远端基线以 `git fetch origin --prune` 后的 `origin/main` 为准；重构实现状态以 `after/` 的 Git、工作区和测试结果为准。

## 1. 当前工作区

| 角色 | 绝对路径 | Git 状态 | 用途 |
|---|---|---|---|
| 中心 clone | `/Users/ylf/Desktop/projects/tradepulse-refactor/repo` | `main@57c4c42`，跟踪 `origin/main`，干净 | fetch、分支和 worktree 管理 |
| 重构前 | `/Users/ylf/Desktop/projects/tradepulse-refactor/before` | `baseline/pre-refactor@57c4c42`，干净 | 只读前后对照 |
| 重构后/开发中 | `/Users/ylf/Desktop/projects/tradepulse-refactor/after` | `codex/frontend-widget-pilot@6bfa5f0`，所有纳入本轮范围的业务列表已迁移到 List widget；CRM 抽屉非 AI 区块已纳入 `crmDrawer` 注册表；权限配置矩阵、事务预览/审核工作区与 AI 专用列表按专用边界冻结；Phase E 隔离预览 harness 已提交；工作区当前干净 | 当前唯一重构开发入口 |

- 远程：`https://github.com/mewmind-chen/russia-crm-local.git`
- 当前 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 当前重构提交：`6bfa5f0`（`79036e5` 在 `8d1bb05` 列表迁移基础上，将 CRM 抽屉的非 AI 状态条、事实、主档和时间线区块纳入 `crmDrawer` 注册表同步装配；保留动作区、权限门控与逐区块回退模板；同时将默认 profile widget 模式的兼容 iframe 加载严格限制为显式 `profileView=legacy`，不改 bootstrap 查询、后端写入或 AI 行为；`6bfa5f0` 对应架构调整后的抽屉摘要契约对齐）
- 双基线实时核验（2026-09-01）：远端 `origin/main`、生产 `current/.release-sha` 与 `state/state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；两者一致，继续以此作为重构唯一双基线。
- 当前验证（2026-09-01）：列表 widget/访问控制/API 定向 `62/62`，widget/抽屉/iframe 定向 `105/105`，`npm test` core `1716/1716`，`node --test` `2078/2078`；本轮业务切片已通过 `node --check`、`git diff --check`。治理权威门禁与 AI 边界门禁将在本轮治理文档更新后复跑。
- 重构分支未合并；本轮未执行浏览器双角色验收、生产验证或部署。
- 旧目录 `/Users/ylf/Desktop/projects/tradepulse-development` 只保留为迁移来源，不再作为当前权威路径。
- 用户新增目标（2026-09-01）：所有业务列表页统一支持按用户配置列显隐、列顺序、升降序/多级排序和布局偏好；配置只能在服务端授权字段范围内生效，不引入智能内容或推荐功能。本轮已完成通用协议、Dashboard 国家快照、Markets 国家矩阵/分配批次/细分报表、manager_tasks、manager_risks、manager_metrics、Team 进度/协作、customers、Research People、Research Recon、不对口记录、Pipeline、Intake/lead_flow 及入库批次、Alerts/今日待办、通知中心、Insights 人工评价列表、受保护客户目录、维护运行记录、跟进更正历史、审计只读列表、用户/归档用户/权限组/迁移复核列表迁移。权限配置矩阵与事务预览/审核工作区保留专用组件边界；AI 功能全部弃用冻结，不新增、不恢复、不迁移 AI 行为。

## 2. 已提交的重构进度

`origin/main..HEAD` 已累积业务与治理两类提交；精确提交分布以自动生成的 `PROGRESS_BOARD.md` 为准。相对既有治理基线已追加阶段 E 的 widget 组合切片与看板校准：

- `3adc1d1`：抽取 `sales-assets/source-tags-widget.js` identity/source tags UMD widget；`sales-assets/app.js` 的 wrappers 改为委托，`sales-crm.html` 在 registry/app 之前加载该资产。保留只读 `customerTags` 投影、归一化/去重保序/空名过滤、默认 5 项与 `+N` 溢出；UMD 负责 source/category/name 转义，`app.js` 注入 AI 开关的 `includeReadOnly`，identity warning 仍由 `app.js` 以 `esc` 转义并追加。`Index.html` 编辑/postMessage、API 与 AI internals 未改。
- `79036e5`：CRM 抽屉非 AI 状态条、事实、主档、时间线区块由 `crmDrawer` 注册表同步选配，保留即时 DOM 契约、逐 widget 回退与原有动作/权限语义；默认 profile widget 模式清理遗留 iframe `src`，兼容 iframe 仅在显式 `profileView=legacy` 时设置或按主题刷新，并新增 registry/iframe 契约。
- `6bfa5f0`：按抽屉注册表组合后的真实结构更新摘要/布局静态契约测试；不改变运行时代码或 AI 边界。
- `4941b7e`：校准进度看板，使阶段 E 显示 profile-only 只读契约、默认 widget 视图、独立 host 隔离与 source tags UMD 的真实状态；该提交仅为治理看板校准。
- `e59bf22`：为 `/development-workbench` 的 profile-only 只读兼容门槛补契约，锁定 `profileAccess.readOnly` 与现有只读分支；运行时无写入口仍列入浏览器验收。
- `8a86425`：修正 WidgetRegistry 挂载隔离：此前多个 widget 共用一个 root，后渲染区块会覆盖先前区块；现每次 `renderPage` 清空 root，并为每个 eligible widget 创建独立 `data-widget-id` host。重跑只保留本轮 eligible host，widget 与 host 创建异常均按 widget 隔离，不阻断后续挂载。

- `13cd37a`：`rejectCrmCustomer` 的 stage/lifecycle/assignment/owner 写收敛到 `lib/domains/lifecycle/state_write` 网关，回收专属字段仍直写。
- `06a9868`：`applyCustomerReturn` 的 assignment/owner 写经同一网关，lifecycle 保持 active、stage 不动。
- `a783c8c`：`addQuote`/`addOrder` 增加 stage 前置校验（报价前 stage≤quoted、首单前 stage≤won、复购任意），放在幂等回放短路之后。
- `03d3e91`：`addQuote`/`addOrder` 的 stage/updated_at **写入**收敛到 `applyAccountStatePatch`。
- `624ceae`：`addQuote`/`addOrder` 的 `next_action*`/`updated_at` **写入**收敛到 `applyAccountPlanPatch`（`PLAN_TIME_BASIS`）。
- `d5d7b68`：`addActivity` 的 stage/计划/主管三路写收敛（含 manager_join 与 lost 分支）。
- `8743912`：今日任务/纯计划路径（`deferAccountPlan`/`addNextPlanTodayTask`/`completeManagerAssistanceTodayTask`/`confirmManagerAssistanceTodayTask`/`planOnlyActivity`）的计划/主管写收敛。
- `531bc71`：`manageIntake` 领取与退回分支、`managerTaskChange` 三分支、超时线索重分配/退回、`reassignReturnedCustomer` 的状态写收敛。
- `227b3d7`：`createClaimedAccount` 恢复分支、`trashManualCustomer`、`restoreManualCustomer` 的回收/恢复状态写收敛。
- `0560e9c`：纯共享 helper 接线恢复——`json/parse`、`list/pagination`、`audit/redact`、`notifications/visibility`（`notificationVisibleForFeatures` 与两个 AI 通知码集合）。
- `d51596c`：http 域 helper 接线恢复——`http/error`（httpError/badRequest/notFound/conflictError）、`http/routes`（anonymousSalesRoute）。
- `873d1b0`：`reporting/csv`（csvCell/csvSerialize，4 处内联序列化模板改为调用 csvSerialize）、`insights/labels`（safeEvaluationLabel）。
- `7328b51`：activity/planning helper 接线恢复——`activity/serialize`（publicActivityRecord(s)）、`planning/alerts`（reasonOrder/urgencyFor/groupAlerts）、`planning/risk`（emptyCustomerPlanRisk）、`planning/streak`（noPlanStreakForActivities）。
- `48ba93c`：intake/assignment helper 接线恢复——`intake/query`（intakeQueryValues/Boolean/Date）、`intake/decision`（serializeArbitrationDecision/withoutArbitrationAI/serializeRecommendation）、`intake/assignment`（intakeActionIdempotencyKey/manualAssignmentRequestHash/manualAssignmentRequiresPreview）、`assignment/link`（isCurrentIntakeAccount/isReturnedAccountForIntake/reusableReturnedAccountForIntake）。
- `ad657ac`：auth/customer helper 接线恢复——`auth/access`（inaccessibleOrMissing）、`auth/credentials`（hashPassword）、`auth/session`（parseCookies）、`customer/contacts`（cleanContactFields/publicAccountContact）、`customer/identity`（identityConflictNote）、`customer/summary`（creatorDisplayName/historyAccountSummary/changedFieldLabels）。
- `13c5368`：reporting builder 接线恢复——`reporting/builders`（rate/buildCountryReport/buildCohortReport/buildTeamReport）。
- `a853a16`：B 组函数级接线恢复——`commerce/rules`（advanceStage/commerceActionIdempotencyKey，纯函数逐字一致）、`customer/recycle`（manualReturnBatchId，逐字一致）；`validateMargin`/`validateRfqPayload`/`validateRecycleReason`/`assertCustomerReturnEligible` 等使用注入式错误构造，与内联版 HttpError 行为不同，保持内联。核验纪律：先做全量逐字一致性核验，B 组仅接函数级一致的部分。
- `af770f5`：B 组注入式错误构造接线恢复——`customer/recycle` 的 `validateRecycleReason`/`mismatchRecordNotFound`/`parseMismatchRecordKey`/`assertCustomerReturnEligible` 全部 domain-lift，12 个调用点注入 `{ httpError: recycleError }` 保持与内联版相同的 HttpError 语义（statusCode + code）；`manualReturnBatchId` 并入同一 require。
- `e9f29d0`：`activity/present` 7 个 helper 接线（4 纯函数 drop-in + 3 注入式，10 个调用点注入 `{ badRequest }`；`PIPELINE_ACTION_QUEUE_KEYS` 随接线移入域模块）。
- `dab8168`：`customer/dedupe` 4 个 helper 接线（duplicateFingerprint/hydrateDuplicateCandidate/reviewCandidateRows/reviewHasProtectedExact，逐字一致 drop-in；`canonicalDomain`/`canonicalHostname` 孤儿 import 移除）。
- `8a0ee7d`：`auth/user`（safeUser）、`intake/owner`（chooseIntakeOwner）、`insights/evaluation`（normalizeEvaluation/withoutEvaluationAI/withoutEvaluationAIRow/aiFeatureDisabled）接线。
- `47daed9`：`customer/normalize` 4 个 helper 接线（normalizeCountry 纯函数 drop-in + 3 注入式，6 个调用点注入 `{ badRequest }`）。
- `f5eb7f2`：`activity/progress` 常量（ACTIVITY_STAGE 等 4 个）与 resolveActivityRequestSpec 接线（recordActivity 注入 `{ badRequest }`；ACTIVITY_STAGE 仍经 exports 导出）。
- `0fcbf71`：`activity/request` 的 resolveActivityReaction 接线（域版以注入式 findReactionById/findReactionByKey 隔离 SQL，调用点注入闭包）。
- `5c23b32`：`customer/create`（customerCreateRequestHash）、`filter/errors`（filterVersionError）、`planning/today_task`（todayTaskError/normalizeTodayTaskDate）接线（注入式错误构造的调用点注入 `{ error: httpError }`/`{ httpError }`/`{ parseBusinessDateTime }` 保持语义）。
- `0ae90af`：阶段 B §4 强化首切片——`addQuote`/`addOrder` 内联 stage 前置校验提炼为 `lifecycle/state_write` 网关守卫 `assertQuoteTransition`/`assertFirstOrderTransition`（基于 `STAGE_INDEX` 单调推进 + `STAGE_PRECONDITION_VIOLATION`），调用点注入 `conflictError` 保持语义。
- `9186a6d`：阶段 B §4.1/§4.2 强化——新增 `lifecycle/state_write` 网关注册 `assertAccountStateContract(state)` 守卫（recycled 不配 claimed/assigned、returned 不绑 owner）。`buildAccountStatePatch` 刻意保持 lifecycle/assignment 独立维度（pairing 由回收/返回调用点负责，既有契约 `lifecycle_state_write.test.js` 锁定），守卫作为可复用规则导出而非在 shim 内强制。
- `cb6c6e4`：阶段 B §4.3 强化——`state_projection.projectNextAction` 增加 `next_action_time_basis` 维度：next_action 有值时，时间与 time_basis 两者都必须存在才算 `planned`，缺任一标 `degraded`（契约原文「有值必配 time_basis，否则 degraded」）；既有「有文本无时间 → degraded」语义保持。
- `754d023`：阶段 B §4.4 强化——`buildAlerts`（sales_crm.js）的 NO_NEXT/OVERDUE 判定从自读裸列（`next_action`/`next_action_at`）改为消费 `state_projection.projectNextAction` 投影：缺 `next_action_time_basis` 的行按 §4.3 语义判为未计划（新增 NO_NEXT 告警）。同步修正 `issue225` 测试种子补写 `next_action_time_basis`（生产写点一律 `PLAN_TIME_BASIS='utc'`，种子此前与生产语义不一致）。
- `c4bba3f`：阶段 B §4.4 强化（报告路径）——`reporting/builders.buildTeamReport` 的 `planned`/`overdue` 度量从自读裸列改为消费 `state_projection.projectNextAction`（`planned` 现计 text+time+basis 齐全的行，`overdue` 经投影时间判定）；消除与 §4.3 的发散。契约测试 `test/report_builders_projection_contract.test.js`（2 断言）。
- `fe77fb4`：阶段 B §4.4 加固（pipeline 路径）——`business_page_filters.pipelineActionKeys` 的 `due_followup`（裸比较 `next_action_at <= nowText`）与 `manager_assistance`（裸比较 `manager_status`）改为消费 `projectNextAction(row).overdue` / `projectManagerState(row)`；移除两函数失效的 `nowText` 参数（其唯一消费方已被投影取代）。`inquiry_no_order`/`order_growth` 属商业计数非 lifecycle 状态，保持裸读。契约测试 `test/pipeline_key_projection_contract.test.js`（1 断言）。
- `aabe4d9`：阶段 B §1 收尾——`updateAccount`（profile 编辑 PATCH）的直写收敛：动态 `fields.join` 的 `UPDATE crm_accounts SET ...` 不再直写网关列，改在事务内经 `applyAccountStatePatch`（stage + ownerId/assignmentStatus）、`applyAccountPlanPatch`（next_action*/time_basis，含 stopsFollowUp 清空）、`applyManagerStatusPatch`（manager_required/status）落库；非网关列（标量/customer_type/assigned_at/return_reason/master+pool 字段）仍直写。claim/unassign 权限子流（view_all_customers + manage_intake、authorized sales 校验、unassign 原因）保持。空 payload 早退纳入网关输入判断。契约测试 `test/state_write_update_account_contract.test.js`（1 结构 + 6 行为）。
- `6b88d74`：阶段 B 边界收敛——pipeline 行移除 state DTO：`publicPipelineActionRow` 不再展开 `projectAccountState`，与 accounts/bootstrap/profile 的"无 state DTO、前端直读裸字段"边界完全一致（此前是最后一个携带 DTO 的读路径；前端零 `.state.*` 消费、后端唯一读者是白名单 redact 且对缺字段优雅降级）。裸字段（stage/lifecycle/assignment/manager）与投影派生的 actionQueueKeys 保持。原"固定边界差异"的 `lifecycle_state_projection` pipeline 测试改为无 DTO 契约。契约测试 `test/pipeline_row_state_boundary_contract.test.js`（1 结构 + 1 行为）。
- `da34bc2`：阶段 B §4 收尾——`assertAccountStateContract` 接入三个产生完整状态视图的写点（`rejectCrmCustomer`/`trashManualCustomer`/`restoreManualCustomer`）：落库前对**合并后的完整目标视图**（当前行 + 意图中的 lifecycle/assignment/owner）做 §4.1/§4.2 不变量校验，防未来编辑漏覆盖产生 recycled+claimed 等非法组合时快速失败（而非落库不一致状态）。守卫在今日正确 patch 上不可达；锁定 shim 刻意留给调用点的配对职责。契约测试 `test/state_write_recycle_restore_invariant_contract.test.js`（4 结构 + 1 行为）。
- `929b8c1`：阶段 B 种子收敛——`smoke_test_data.js`（生产冒烟夹具）建立 next_action 计划时此前不写 `next_action_time_basis`，冒烟客户被 §4.3 投影判为 degraded，与生产写点（一律 `PLAN_TIME_BASIS='utc'`）发散。现：账户 INSERT 与计划 UPDATE 写 `'utc'`；legacy 清理清空 basis；快照捕获/恢复 `next_action_time_basis`（冒烟前的既有计划原样还原）。契约测试 `test/smoke_seed_plan_basis_contract.test.js`（5 结构 + 1 行为）。
- `78e698b`：阶段 C 首片——accounts 列表（`listCustomerAccounts`，无 view_contacts 分支）由递归 `redactContactFields` 黑名单切换到字段级白名单 `contactSafeAccountRecord`（FIELDS_CATALOG 派生 + 显式业务键，此前定义未接线）；白名单补 `is_test_data`/`test_run_id` 两键使切换逐键等价（契约以端点同款行锁定 blacklist≡whitelist）。账户页从此走显式字段 schema（阶段 C"权限→字段→筛选"）。契约测试 `test/phase_c_account_whitelist_contract.test.js`（1 结构 + 1 等价 + 1 行为）。
- `5e992fe`：阶段 C 次片——intake 页（`queryIntakeFlowPage`，intake/lead_flow 页面）同样从递归黑名单切到新的字段级白名单 `contactSafeIntakeRecord`（`CONTACT_SAFE_INTAKE_KEYS` 镜像黑名单在 `crm_intake_items` 行保留的全部 29 键；contact_name/title/methods/level、evidence/report_url、decision_reason、return_reason 继续隐藏）。契约测试 `test/phase_c_intake_whitelist_contract.test.js`（1 结构 + 1 等价 + 1 行为，路由 `GET /api/sales-crm/lists/intake`）。
- `1835f73`：阶段 C 通知白名单——通知页（`listNotificationRows`）从递归黑名单切到字段级白名单 `contactSafeNotificationRecord`（`CONTACT_SAFE_NOTIFICATION_KEYS` 镜像黑名单在通知行保留的全部键；title/detail 属 CONTACT_KEYS，对无 view_contacts 用户一并剥离——忠实镜像黑名单，issue325 的 title 断言仅对 view_contacts 用户成立）；sales 角色的收件人/收件名裁剪保持。契约测试 `test/phase_c_notification_whitelist_contract.test.js`（1 结构 + 1 等价 + 1 行为）。
- `38bfe7d`：阶段 C S3 形状——timeline 与 auditLog 字段级白名单（`contactSafeTimelineRecord`/`contactSafeAuditLogRecord`）：timeline 事件保留结构键与 provenance、剥离 copy 字段（title/summary/next_action/outcome 属 CONTACT_KEYS）；provenance 纯结构键已做泄漏校验（保留值在黑名单下不变）；audit 行剥 `action`。契约测试 `test/phase_c_timeline_audit_whitelist_contract.test.js`（2 等价 + 1 泄漏校验）。为 S4/S6 复合投影的可复用形状。**S5（export）审计发现 users 形状经黑名单保留 `password_hash`/`password_salt`**——忠实镜像会将其列入白名单（合规隐患），判定暂缓（保留黑名单或先修合规）。
- `2ca107b`：阶段 C 范围解释器统一——`accountScope`（每页 SQL 条件集）与 `buildAccessContext`（accountIds 集）实现同一账户可见性门控（view_all/manage_intake/owner/returned/test-data/lifecycle），此前独立维护。契约测试 `test/phase_c_account_scope_contract.test.js`（2 断言）：对异质 fixture（returned+test-data+recycled 账户）跨 sales/admin 权限组合断言两解释器选中账户集完全一致，防止后续漂移；代码级去重因涉及 `buildAccessContext` 的 PRAGMA 列存在性守卫（兼容老 schema）而延后，以契约为护栏。
- `f2056e5`：阶段 C 范围解释器代码级统一——共享 `accountVisibilityScope(user, alias, options)` 提炼进 `access_control.js`，`buildAccessContext` 传入 PRAGMA 实际列存在性（老 schema 优雅降级保持）、`business_page_filters.accountScope` 委托共享解释器，两套账户可见性逻辑合而为一。契约测试补结构断言（accountScope 必须委托、buildAccessContext 必须复用共享解释器且不再自行分支可见性）。**修复空 WHERE 子句 bug**：全量回归发现 `ai_control_plane` 的 6-worker 并发测试稳定失败，二分归因到 lib 改动（worker 每次 job 经 `executionIdentity` 调 `buildAccessContext`），根因是 AI 测试 fixture 的 `crm_accounts` 无 `lifecycle_status`/`is_test_data` 列、原实现 `WHERE 1=1${clause}` 空子句退化为合法 SQL，而新实现拼出空 `WHERE` 语法错误 → job 被 block → worker 循环耗尽；修复为条件基底 `1=1`。契约测试 `test/phase_c_account_scope_contract.test.js`（2 等价 + 1 结构）。
- `1d15546`：阶段 D 商业闭环首片——quote/order 幂等保留生命周期（`reserveCommerceAction`/`completeCommerceAction`/`clearCommerceActionReservation`，操作 `crm_commerce_action_requests`）从 `sales_crm.js` 迁出至新域模块 `lib/domains/commerce/action_request.js`，`conflictError`/`json`/`nowText` 由调用点注入保持原 409 错误码与 `started→completed` 状态迁移、错误回退清理语义；`addQuote`/`addOrder` 调用点注入保持语义。契约测试 `test/domain_wiring_commerce_action_request_contract.test.js`（1 结构 + 3 行为：保留/清理、in-flight 拒绝 + 绑定冲突、完成重放）。对应路线图阶段 D 关键动作"RFQ / quote / order / action request 的事务边界显式化"。
- `f5c650e`：阶段 D 商业闭环次片——RFQ/quote/order 行级写入下沉：`crm_rfqs`/`crm_quotes`/`crm_orders` 的 INSERT/UPDATE 从 `addQuote`、`addOrder` 与 `recordActivity` 的 rfq 分支迁出至新域模块 `lib/domains/commerce/write.js`（`insertRfqRow`/`insertQuoteRow`/`markRfqQuoted`/`insertOrderRow`）。纯行写、无错误构造，时间戳/ID 全由调用点传入，逐字一致 drop-in。契约测试 `test/domain_wiring_commerce_write_contract.test.js`（1 结构 + 3 行为：quote 插入 + rfq 置 quoted 形状、order 保留 repeat、rfq 绑定来源 activity）。
- `24aa67e`：阶段 D 商业闭环第三片——quote/order 金额/币种/毛利校验下沉：`COMMERCE_CURRENCIES`/`validateMoney`/`validateCurrency`/`validateMargin` 从 `sales_crm.js` 内联迁至 `lib/domains/commerce/rules.js`（`validateMargin` 已在域版，本轮补三定义）。错误构造由调用点注入 `{ badRequest }`，校验消息与归一数值逐字一致；`addQuote`/`addOrder` 调用点注入保持语义，内联四定义删除。`validateRfqPayload` 仍按既有裁定（注入式、与内联版行为差异）保持内联。契约测试并入 `test/domain_wiring_commerce_recycle_contract.test.js`（2 结构+行为）。
- `b4cfdfc`：阶段 D 商业闭环第四片——`addQuote`/`addOrder` 的**完整编排**下沉为 `lib/domains/commerce/write.js` 的 place 级域服务 `commitQuote`/`commitOrder`（权限/校验/幂等保留/阶段守卫/事务体/next_action 入队/完成清理）。同域依赖由 `write.js` 内部 require（`./rules`、`./action_request`）；跨域与 sales_crm helper（`assertPermission`/`getAccountForUser`/`assert*Transition`/`applyAccountStatePatch`/`applyAccountPlanPatch`/`linkCommerceActivity`/`recordExplicitPlanIfEnabled`/`enqueueNextActionForEvent`/`parseBusinessDateTime`/`nowText`/`id`/`badRequest`/`conflictError`/`json`）经 `deps` 注入，行为逐字节一致。`sales_crm.js` 收敛为薄委托（db → 注入 → 服务 → close），不再导入 quote/order 行写、幂等生命周期与校验函数（`write.js` 仅导出 `insertRfqRow`/`commitQuote`/`commitOrder`）。新增契约 `test/domain_wiring_commerce_commit_contract.test.js`（5 断言：结构 + 引用端到端 + 幂等重放）；`state_write_*`/`collaboration_write_*`/`stage_precondition_guard`/三段 wiring 契约按新边界更新。`sales_crm.js` 13001→12883 行（-118）。

**阶段 B §1 完成门（经 2026-08-30 审计发现并已收尾）**：对 `lib/` 扫描确认 `crm_accounts` 的 `stage`/`lifecycle_status`/`assignment_status`/`owner_id`/`next_action*`/`manager_*`/`updated_at` **已无裸直写**。审计发现 `updateAccount`（profile 编辑）曾经动态 `fields.push` → `UPDATE crm_accounts SET ${fields.join(',')}` 直写这些列（此前"零裸写"声明不实，因为核验正则以"状态列与 UPDATE 同排"匹配、漏扫动态字段拼装），已由 `aabe4d9` 收敛到三个网关（`applyAccountStatePatch`/`applyAccountPlanPatch`/`applyManagerStatusPatch`），claim/unassign 权限子流保持。`last_activity_at`（活动时间戳）与回收专属字段（`recycle_*`/`previous_owner_id`/`loss_reason`/`return_reason`）为明确的网关列之外直写。测试专用种子（`smoke_test_data.js`、`seedAccounts`）按契约 §2 不在收敛范围。

**阶段 A 接线恢复（历史阶段快照，13 个切片，41 个模块已接入）**：按接线清单把被 WIP 回退的域模块重新接入 `sales_crm.js`。纪律：先做全量逐字一致性核验（分类器+抽样 diff），仅对与内联版逐字一致的自包含纯函数模块做 drop-in 接线；B 组按函数级核验、只接逐字一致的部分函数；注入式错误构造的函数经调用点注入 `{ httpError }`/`{ badRequest }`/`{ error: httpError }`/SQL 闭包等保持原语义。已接线域模块（生产代码直接 require 40 个 + `action_request` 经 `commerce/write` 域间接线，合计 44 个中 41 个接线）：`json/parse`、`list/pagination`、`audit/redact`、`notifications/visibility`、`http/error`、`http/routes`、`reporting/csv`、`insights/labels`、`activity/serialize`、`planning/alerts`、`planning/risk`、`planning/streak`、`intake/query`、`intake/decision`、`intake/assignment`、`assignment/link`、`auth/access`、`auth/credentials`、`auth/session`、`auth/user`、`customer/contacts`、`customer/identity`、`customer/summary`、`customer/recycle`、`customer/normalize`、`customer/dedupe`、`customer/create`、`reporting/builders`、`commerce/rules`、`activity/present`、`activity/progress`、`activity/request`、`intake/owner`、`insights/evaluation`、`filter/errors`、`planning/today_task`、`lifecycle/state_write`、`lifecycle/collaboration_write`（另 `lifecycle/state_projection` 经 `business_page_filters.js` 接线）。**仅剩 3 个按用户裁定保持内联/精简**：`identity/index`（facade 精简）、`identity/middleware`（认证逻辑内联）、`filter/index`（直连 filter_authorization）——即 WIP 收敛时用户裁定的"内联版"边界。该段的 `sales_crm.js` 行数 12,966 是当时历史快照，当前行数见本节最新提交态。接线契约 13 文件 24 断言。

**USD 看板接线口径修正（历史阶段快照，2026-08-30，本会话）**：进度看板生成器 `scripts/progress_board.js` 的"域模块接线状态"从"仅生产代码直接 require"扩展为"直接 require + 域间接线传递闭包"。此前 `commerce/action_request` 在 `b4cfdfc` 把幂等生命周期下沉进 `commerce/write.js` 后不再被 `sales_crm.js` 直接 require，被看板误报为"未接线（待恢复）"；现按 write.js 内部 `require('./action_request')`/`require('./rules')`（及 `reporting/builders`→`../auth/user`、`auth/*`→`../identity` 等相对 require）做 Node 式解析并传递闭包，`action_request` 恢复为"已接线（b4cfdfc）"。用户裁定内联的 `identity/index`、`identity/middleware`、`filter/index` 即使存在域间接线，仍按"不接线（内联）"展示。当前口径：44 个域模块文件，41 已接线（40 直接 + action_request 传递闭包），3 按裁定内联。全量测试 1975/1975 是当时历史快照，当前测试见最新验证行。数据自动推导自 git 提交（origin/main..HEAD）、`lib/` 代码扫描与治理文档（CURRENT_STATE/sessions），无手工维护字段；每个切片收尾按 WORK_PROTOCOL 自动再生成并随治理文档提交。

已经形成的主要切片包括：

- 字段目录与 schema 驱动显示：线索池、客户资料字段分组、profile widgets、用户级 section 偏好。
- identity/filter 兼容 facade 与认证中间件抽取。
- lifecycle 状态投影、状态写入 shim、协作状态写入、前端 DTO 消费。
- contact-restricted 读取的多类白名单投影。
- customer、activity、planning、intake、assignment、commerce、reporting 等纯函数或辅助逻辑抽取。
- `lib/domains/` 当前有 44 个文件。

接线索计（详见 `sessions/2026-08-29-state-write-convergence.md`）：审计确认 `92c3879` 的内联回退覆盖了 `lib/domains/` **全部模块**在 `sales_crm.js` 的引用（非此前文档所记"部分"）。接线恢复后 41 个域模块已接线（`sales_crm.js` 等生产代码直接 require 40 个 + `action_request` 经 `commerce/write` 域间接线传递闭包），仅剩 3 个按用户裁定保持内联/精简（`identity/index`、`identity/middleware`、`filter/index`）。

规模变化仅表示已经开始拆分，不代表单体拆分完成：

- `origin/main` 的 `lib/sales_crm.js`：13,758 行。
- 当前提交态 `6bfa5f0`：`lib/sales_crm.js` 12,945 行；`sales-assets/app.js` 17,606 行。
- 客户完整资料默认由 widget 注册表组装；仅 `profileView=legacy` 显式保留 `/development-workbench` iframe 兼容回退；profile-only workbench 为只读兼容入口。浏览器双角色（sales/manager）仍待验收。

因此当前结论是：重构已经实质推进，但仍处于渐进迁移中，不能描述为“拆分完成”或“可合并”。

## 3. 已提交 WIP 收敛（2026-08-29）

迁移 WIP 已按用户裁定保留并提交为 `92c3879`。收敛内容：

- `lib/domains/identity/index.js`：精简 facade，不再转发 `PERMISSION_DEFINITIONS` 等常量与 `contactSafe*`/`redactContactFields` 白名单代理。
- `lib/sales_crm.js`：移除 accounts/bootstrap/profile 的 state DTO 投影（`projectAccountState`），并内联/回放此前抽取的部分 domain 引用，保持外部 API 行为不变。
- `sales-assets/app.js`：删除 `accountStageOf`/`managerStateDisplay`/`accountLifecycleActive`/`accountAssignmentReturned`，直读裸字段。
- `test/domain_facades.test.js`、`test/issue103_frontend.test.js`、`test/issue209_ownerless_return.test.js`、`test/lifecycle_state_projection.test.js`：同步更新契约断言；白名单兼容测试改为从 `access_control` 直连导入。

历史注意：pipeline 行曾由 `business_page_filters.js` 附加 state DTO；该边界差异已在 `6b88d74` 收敛，当前行仅保留裸状态字段与业务派生行动队列。

`after/` 当前业务提交 `6bfa5f0`（`79036e5` 在 `8d1bb05` 列表迁移基础上完成 CRM 抽屉非 AI 注册表组合与 profile iframe 兼容边界，`6bfa5f0` 对齐摘要契约；审计只读列表及其他前序列表为先前业务提交）与前置治理提交已落地；本治理 checkpoint（`CURRENT_STATE.md`、路线图、看板生成器、生成看板与本次 session 记录）随独立治理提交落地。生产目录保持只读。

## 4. 最近验证结果

在 `/Users/ylf/Desktop/projects/tradepulse-refactor/after` 执行：

- `npm ci`：成功安装；审计报告未升级依赖。
- `npm test`：全量 core `1716/1716` 通过。
- `node --test`：全量 `2078/2078` 通过。
- 本轮 `79036e5`：列表 widget/访问控制/API 定向 `62/62`，widget/抽屉/iframe 定向 `105/105`，core `npm test` `1716/1716`，全量 `node --test` `2078/2078`；`node --check`、`git diff --check` 已通过。真实浏览器双角色验收未执行（依赖未锁定时入口 fail-closed），生产或部署验证未执行。
- 专项：`domain_facades`+`issue103` 9/9；`lifecycle_state_projection` 22/22；`phase_c_account_whitelist_contract` 3/3；`phase_c_intake_whitelist_contract` 3/3；`phase_c_notification_whitelist_contract` 3/3；`phase_c_timeline_audit_whitelist_contract` 3/3；`phase_c_account_scope_contract` 3/3；`phase_c_permission_field_filter_contract` 3/3；`state_projection_time_basis_contract` 3/3；`state_projection_alerts_contract` 3/3；`report_builders_projection_contract` 2/2；`pipeline_key_projection_contract` 1/1；`state_write_update_account_contract` 7/7；`pipeline_row_state_boundary_contract` 2/2；`state_write_recycle_restore_invariant_contract` 5/5；`smoke_seed_plan_basis_contract` 6/6；`smoke_test_data` 5/5；`issue209` 5/5；`state_write_reject_contract` 2/2；`state_write_return_contract` 2/2；`state_write_stage_contract` 4/4；`state_write_stage_precondition_guard_contract` 1/1；`state_write_invariant_contract` 4/4；`state_write_commerce_contract` 5/5；`collaboration_write_commerce_contract` 4/4；`state_write_activity_contract` 4/4；`collaboration_write_plan_points_contract` 6/6；`state_write_claim_manager_contract` 5/5；`state_write_recycle_restore_contract` 4/4；`domain_wiring_*_contract` 15 文件 33 断言全绿（含新增 `domain_wiring_commerce_commit_contract` 5 断言）；报价/订单/阶段边界回归 49/49 + stage guard 组 15/15。

阶段 B 契约测试 18 文件 66 断言 + 阶段 A 接线契约 13 文件 24 断言 + 阶段 C 契约（白名单 accounts 3 + intake 3 + 通知 3 + timeline/audit 3 + 范围等价+结构 3 + 权限→字段→筛选 3 = 18 断言）+ 阶段 D commerce 契约（幂等保留 4 + 行级写 4 + 金额/币种/毛利校验 2 + commit 服务 5 = 15 断言）（含共享结构化断言助手 `test/helpers/lifecycle_gate_contract.js`）。

此前 12 个全量失败已在一轮修复（ownerless return 前端兼容、lifecycle state projection 契约、contact whitelist 兼容导出）。

当前测试结论是“绿灯”。本轮列表 widget/访问控制/API 定向 `62/62`，widget/抽屉/iframe 定向 `105/105`，core `1716/1716`、全量 `2078/2078`。旧文档中的其他测试数字只属于历史 checkpoint，不能作为当前完成证据。

## 5. 当前阶段判断

- 阶段 0 治理基础：已建立；2026-08-29 已迁移到新根目录并完成校准。
- 前端字段目录/widget 试点：widget 注册表已落地，customerProfile 默认使用 widget 组合视图；legacy iframe 仅由 `profileView=legacy` 显式兼容回退，profile-only workbench 已收敛为只读兼容入口；identity/source tags 已抽为 UMD widget；通用 `list-widget.js` 已用于 Dashboard 国家快照、Markets 国家矩阵/分配批次/细分报表、主管任务/风险/指标、Team 进度/协作、customers、Research People、Research Recon、不对口记录、Pipeline、Intake/lead_flow 及入库批次、Alerts/今日待办、通知中心、Insights 人工评价列表、受保护客户目录、维护运行记录、跟进更正历史、审计只读列表、用户/归档用户/权限组/迁移复核列表，支持授权字段目录、列显隐/顺序、用户级偏好和排序预设。权限配置矩阵与事务预览/审核工作区为专用组件；AI 功能弃用冻结。阶段 E 仍未完成，浏览器双角色验收待做。
- 后端领域拆分：`lib/domains/` 44 个文件；审计确认 WIP 回退了其在 `sales_crm.js` 的全部引用；接线恢复后 41 个域模块已接线（生产代码直接 require 40 个 + `action_request` 经 `commerce/write` 域间接线），仅剩 3 个按用户裁定保持内联/精简（`identity/index`、`identity/middleware`、`filter/index`）。
- 阶段 A 接线恢复：**13 个切片全部完成**——44 个域模块中 41 个已重新接入（纯函数 drop-in + 注入式错误构造经调用点注入保持语义）；`sales_crm.js` 12,945 行；仅剩 3 个模块按用户裁定不接线。
- 阶段 B 状态真源：**全部完成门达成**——§1 写点收敛（`lib/` 对 `crm_accounts` 状态/计划/主管列零裸写，含 `updateAccount` `aabe4d9`）、§4 强化（前置校验 `0ae90af`、不变量守卫 `9186a6d` + 回收/恢复接线 `da34bc2`、time_basis 投影 `cb6c6e4`、告警/报告/pipeline 读路径投影消费 `754d023`/`c4bba3f`/`fe77fb4`）、边界收敛（pipeline 行移除 state DTO `6b88d74`）、种子收敛（生产冒烟夹具补 time_basis `929b8c1`）。契约 §4 不变量均已由契约测试锁定。**红线内（不改）**：AI `next_action` 采纳写点（`lib/ai_stations/next_action.js`，`time_basis='utc'` 语义正确）+ `last_activity_at` 归属为活动溯源。阶段 B 业务侧收尾，剩余项仅涉 AI 红线评估与前端状态解释器。
- 阶段 C 权限/筛选/字段：**推进中（主体完成）**——字段目录 + 白名单投影已存在；`78e698b`（accounts）/`5e992fe`（intake）/`1835f73`（通知）列表路径白名单化；`38bfe7d` S3 形状（timeline/auditLog）；`2ca107b` 范围解释器等价契约；`45e0c05` 权限→字段→筛选合同（schema 不泄漏、联系人筛选对无 view_contacts 缺席、账户白名单剥联系人字段）；`f2056e5` 范围解释器代码级统一（共享 `accountVisibilityScope`，同时修复空 WHERE 子句 bug——老 schema 缺 `lifecycle_status`/`is_test_data` 列时 `WHERE` 空子句非法，以 `1=1` 为基底保证合法）。大聚合设计三轮审计（P1/P3 嵌套泄漏、S5 users 密码哈希、S6 联系形状源头门控）均入册。剩余仅：可选残值（legacy customers 形状白名单）。
- 阶段 D 线索/任务/商业闭环：**推进中**——intake/assignment/planning/commerce 域模块已抽取并接线；商业闭环 action request 事务边界（`1d15546`）、RFQ/quote/order 行级写（`f5c650e`）、金额/币种/毛利校验（`24aa67e`）、`addQuote`/`addOrder` 完整编排下沉（`b4cfdfc` commitQuote/commitOrder 域服务）均已显式化。剩余：manager intervention 与 deferred plan 为**独立用例**（不在 commerce 闭环内）；前端状态解释器统一与阶段 E/G 待后续。
- 状态、权限与白名单：state DTO 按用户裁定收敛为直读裸字段；白名单投影改为 `access_control` 直连。
- 生产部署/UAT：本轮未执行，不得从本地结果推断生产状态。

## 6. 下一步允许动作

1. 单独提交治理文档 checkpoint（当前更新），与业务提交分离。
2. 阶段 A 接线恢复：**已完成**——44 个域模块中 41 个已重新接入，仅剩 `identity/index`、`identity/middleware`、`filter/index` 三个按用户裁定保持内联/精简。后续如需继续减单体，可评估已漂移模块或转入阶段 B 收尾。
3. 阶段 B 业务侧收尾完成（`929b8c1` 止：§1 写点 + §4 强化 + 边界 + 种子收敛）。剩余项均涉红线/评估——AI next_action 写点（`ai_stations/next_action.js`）仅评估不改；`last_activity_at` 归属明确为"活动溯源"列（addActivity/quote/order/completeManagerAssistance 写、rebuild 重算，不入网关收敛范围）；状态解释器统一消费（前端侧后续评估）。
4. 阶段 C（权限/筛选/字段）：**主体完成**——列表路径白名单化（accounts/intake/通知）、S3 形状（timeline/auditLog）、范围解释器等价契约（`2ca107b`）与代码级统一（`f2056e5`，含空 WHERE 修复）、按页面"权限→字段→筛选"合同（`45e0c05`）均落地。**大聚合设计**（`docs/governance/PHASE_C_AGGREGATE_WHITELIST_DESIGN.md`）三轮审计结论：P1/P3（loadIntakeState 嵌套泄漏）、S5（export users 密码哈希）暂缓；S6（db bootstrap）联系形状源头门控、低价值。剩余仅：可选残值（legacy customers 形状白名单，S6 审计确认其余联系形状已源头门控，低价值可暂缓）。
5. 阶段 D（线索/任务/商业闭环）：**商业闭环成型**——intake/assignment/planning/commerce 域模块已抽取并接线；商业闭环 action request 事务边界（`1d15546`）、RFQ/quote/order 行级写（`f5c650e`）、金额/币种/毛利校验（`24aa67e`）、addQuote/addOrder 完整编排下沉（`b4cfdfc`，commitQuote/commitOrder place 级域服务）均已显式化。剩余为独立用例（manager intervention / deferred plan），后续评估。
6. **阶段 E（前端 widgets）为当前执行阶段**：`2d98eea` widget 注册表（`sales-assets/widget-registry.js`，UMD，register/renderPage/widgetsForPage + permission/feature/when 门槛 + order 排序 + 逐 widget 错误隔离）并把 customerProfile 页面改为注册表组装；`41a722e` 再把 profile-facts（字段事实 + hiddenSections 偏好）抽为自包含 UMD widget（`sales-assets/profile-facts-widget.js`，自持模板/状态/事件），app.js 只注入 ctx 并委托 render（净 -55 行）。行为与既有 facts+偏好条逐字节一致；契约测试 12 断言 + 既有 profile_widgets 12 断言 + 前端专项 57/57 全绿。`7c76fb3` 把 CRM 抽屉客户事实区抽为自包含 UMD widget（`sales-assets/drawer-facts-widget.js`，自持 schema 优先/fallback 回退/website 安全转义，`drawerFactsContext` 集中 ctx，`registerIfMissing` 幂等注册 `drawer-facts`@crmDrawer）；`64b9418` 把抽屉 AI 问答区抽为自包含 UMD widget（`sales-assets/drawer-ai-widget.js`，自持模板/转义，`drawerAiContext` 集中 `technicalAIPresentationAllowed && can('use_ai_assistant')` 门槛，注册 `drawer-ai`@crmDrawer，drawerAiForm 提交仍由 app 级委托、AI 内部零改动）；`3e84f63` 把抽屉客户主档区块（`CUSTOMER MASTER DATA`）抽为共用 UMD widget（`sales-assets/master-profile-widget.js`，自持 master-profile 模板与 label/cardClass 转义，`masterProfileSectionHtml` 辅助 widget 优先/内联回退，renderDrawer/openIntakeProfile/renderRecycleDrawer 三源组装 rows 共用同一模板，兑现"customerDrawer 共用同一 widget 集合"）。`3a42f1c` 记录该片。本轮 `6aa9353` 再把客户/回收抽屉重复的 `insight-section` 宿主壳抽为自包含 UMD widget（`sales-assets/insight-section-widget.js`，自持 insight-head + panel-note + body 容器模板与 eyebrow/title/note 转义，`insightSectionHtml` 辅助 widget 优先/内联回退；renderRecycleDrawer 的 5 个重复区块——CONTACT HISTORY/MANAGER INSIGHT/商务分组/FULL TIMELINE/AUDIT TRAIL——改为只组装 bodyHtml/actionHtml，时间线用 `bodyClass: 'timeline'` 并保留 `data-open-timeline-modal`）。本轮契约 +3、专项 78/78、全量 2000/2000 全绿。`39990be` 再把完整资料页 AI 站登记为
widget（profileWidgetContext 注入 `customerAiEnabled`（复用 customerAIEnabled 开关）；
registerProfilePageWidgets 注册 `customer-ai-station`（pages: ['customerProfile']，
when 门槛 = ctx.customerAiEnabled）；`renderCustomerAiStationWidget` 委托既有
`renderCustomerAI`（评分/资料包/补全渲染零改动，与 drawer-ai 同范式，兑现路线图
关键动作 4"AI 区域登记为 widget，由现有开关决定挂载"）。本轮契约 +2、AI/注册表
专项 48/48、全量 2000/2000 全绿。`8135ac2` 再把 CRM/线索/回收三源抽屉事实区统一经
drawer-facts-widget 渲染（新增 `drawerFactsFallbackHtml(rows)` 辅助 widget 优先/
内联回退，openIntakeProfile 与 renderRecycleDrawer 的 account-facts 内联 map 改为
委托，与 renderDrawer 共用同一 fallback 路径，兑现"customerDrawer 共用同一 widget
集合"的 facts 收敛）。本轮契约 +1、抽屉专项 82/82、全量 2002/2002 全绿。`f8e67c9` 再把 CRM/线索/回收三处抽屉重复的
`.next-step` 状态条壳抽为自包含 UMD widget（`sales-assets/next-step-widget.js`，
自持 eyebrow/主文本/尾部 actionHtml/可选 className 模板与转义，`nextStepHtml`
辅助 widget 优先/内联回退；renderDrawer NEXT ACTION、openIntakeProfile
LEAD PROFILE、renderRecycleDrawer RECYCLED CUSTOMER 三处委托）。
本轮契约 +3、专项 56/56、全量 2005/2005 全绿。`e920f7b` 再把 CRM 抽屉告警条
（`.next-step` 变体）与异常明细列表下沉到 next-step-widget（新增
`renderAlertStepHtml`：severity→边框色/pill 色调与转义；`renderAlertDetailsHtml`：
title/detail 转义、metaHtml 宿主组装；app.js 新增 `alertStepHtml`/`alertDetailsHtml`
门槛+widget 优先/内联回退，renderDrawer 内联改委托）。本轮契约 +2、专项 48/48、
全量 2007/2007 全绿。`93b5dbb` 再把线索抽屉（开发历史）与回收抽屉（完整时间线）
重复的时间线条目列表抽为自包含 UMD widget（`sales-assets/timeline-widget.js`，
自持 `.timeline` 列表模板与 title/summary/下一步/actor/date 转义+空态，
`timelineItemsHtml` 辅助 widget 优先/内联回退；recycle 用 nextAction: true、
intake 无下一步行；CRM 复杂活动时间线含校正交互保留内联待评估）。本轮契约 +3、
专项 62/62、全量 2010/2010 全绿。`2e1210c` 再把 CRM 抽屉 FULL TIMELINE 区块壳
（panel-head 风格）抽入 timeline-widget（新增 `renderSectionHtml`，`timelineSectionHtml`
辅助 widget 优先/内联回退，活动时间线条目含校正交互仍保留内联）。`8e0d187`/`96733f6`
治理收口：2026-07-25 计划对冻结归档为审计证据，新增 `check-governance-authority`
门禁，活跃文档只引用实时远端/生产 release/after 的 Git 代码测试。`28fb124` 修 AI
边界门禁：`lib/domains/customer/dedupe.js` 白名单为既有耦合的单一隔离点（before
sales_crm 本就 require 同一 AI 指纹工具，抽域收敛而来、AI 模块零改动、白名单不
扩大耦合面），契约测试锁定隔离点；`check:ai-boundary` OK、`check:governance-authority`
OK。本轮 core 1658/1658、全量 2019/2019 全绿。`3c9369d` 再让完整资料 widget 模式与
抽屉共用同一主档模板（profileWidgetContext 注入 `ctx.account`；注册 `profile-master`
@customerProfile order 25；`renderProfileMasterWidget` 复用 `masterProfileSectionHtml`
组装 企业背景/产品需求/背调来源 行，业务画像区块进入统一 widget 集合）。
本轮 core 1659/1659、全量 2020/2020 全绿。随后阶段 E 继续落地：`e59bf22` 锁定
`/development-workbench` profile-only 只读兼容契约，`8a86425` 修复注册表独立
widget host 隔离，`3adc1d1` 将 identity/source tags 抽为 `source-tags-widget.js`
UMD；本次目标前端/标签专项 `106/106`、core `1670/1670`、全量 `2031/2031`。
阶段 E 仍进行中：尚余 sales/manager 浏览器双角色验收、其余复杂 widget body 与 CRM 活动时间线评估下沉。隔离 preview/mock runtime 已建立为显式
opt-in harness；当前环境缺少锁定浏览器依赖，浏览器入口 fail-closed，真实浏览器验收不得写成已通过。
`79036e5` 已补齐默认模式 iframe 边界，并把 CRM 抽屉非 AI 区块纳入 `crmDrawer` 注册表；下一动作固定为：在具备锁定浏览器依赖的环境运行 Phase E harness，完成 sales/manager 双角色默认 customerProfile 与 profile-only 只读兼容验收；同时评估剩余 widget body 与兼容层收敛。列表迁移切片已完成，AI 功能继续弃用冻结。
本轮已先落地可独立验证的 List widget 基础切片：`sales-assets/list-widget.js` 提供
列 schema、必选列、显隐/顺序编辑、排序描述、偏好读写和 descriptor table 渲染；
`customers` 字段目录由 `/api/sales-crm/field-schema/customers` 提供，客户列表接入
用户级列设置和既有服务端排序预设；随后 Research People、不对口记录、Pipeline、
Intake/lead_flow、Alerts/今日待办、通知中心、Research Recon、Dashboard 国家快照与 Markets
国家矩阵/分配批次/细分报表
列表已接入同一协议，均由服务端授权字段目录约束；仍不触碰 AI。Team 进度销售汇总、客户/待办/事实时间线明细与协作支持列表迁移（`a52e42b`），Insights 人工评价列表迁移（`75a30b7`）、受保护客户目录迁移（`f1fe7d1`）、维护运行记录迁移（`6001f61`）、跟进更正历史迁移（`61a6572`）、审计只读列表迁移（`3e55b41`）与账号/归档/权限组/迁移复核/入库批次迁移（`8d1bb05`）均保留原有筛选、分页和权限，已有钻取/导出/行操作继续保持；审计仍使用原有 bootstrap 只读数据。权限配置矩阵及事务预览/审核工作区保留专用组件边界，AI 功能弃用冻结。Phase E 浏览器预览 harness 已建立（显式 opt-in、临时 SQLite、`127.0.0.1`、随机端口、AI provider/monitor 关闭、缺失浏览器依赖 fail-closed），真实浏览器验收尚未运行。
7. 每个切片必须保持全量绿灯后再进入下一个列表页面，不新增 AI 字段或行为。

## 7. 红线

- 不在 `repo/`、`before/` 或旧 `tradepulse-development` 中编辑业务代码。
- 不修改 `/Users/ylf/Desktop/projects/tradepulse-production`、生产数据库、生产配置或生产部署。
- 不重构、迁移或搬运 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 及既有 AI 触发点。
- 新根目录尚未建立专用预览 runtime；在明确数据库路径前，不启动会误连旧 runtime 的服务。
- 未经用户明确要求，不 push、不合并、不删除旧目录。
