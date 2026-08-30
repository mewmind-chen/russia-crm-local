# TradePulse 当前状态

更新时间：2026-08-29
最近核验：2026-08-29，Asia/Shanghai

> 本文档是重构进度的滚动真源。远端基线以 `git fetch origin --prune` 后的 `origin/main` 为准；重构实现状态以 `after/` 的 Git、工作区和测试结果为准。

## 1. 当前工作区

| 角色 | 绝对路径 | Git 状态 | 用途 |
|---|---|---|---|
| 中心 clone | `/Users/ylf/Desktop/projects/tradepulse-refactor/repo` | `main@57c4c42`，跟踪 `origin/main`，干净 | fetch、分支和 worktree 管理 |
| 重构前 | `/Users/ylf/Desktop/projects/tradepulse-refactor/before` | `baseline/pre-refactor@57c4c42`，干净 | 只读前后对照 |
| 重构后/开发中 | `/Users/ylf/Desktop/projects/tradepulse-refactor/after` | `codex/frontend-widget-pilot@0ae90af`，干净 | 当前唯一重构开发入口 |

- 远程：`https://github.com/mewmind-chen/russia-crm-local.git`
- 当前 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 当前重构提交：`1835f73`（阶段 C 通知白名单切片）
- 重构分支相对 `origin/main`：ahead 93（业务）+ 21（治理），未合并；本地未配置发布或生产动作。
- 旧目录 `/Users/ylf/Desktop/projects/tradepulse-development` 只保留为迁移来源，不再作为当前权威路径。

## 2. 已提交的重构进度

`origin/main..HEAD` 当前 102 个业务提交 + 21 个治理提交。相对 `76b7b56`（62 提交）已追加：`92c3879`（WIP 收敛）、`09ef77e`（治理文档）、阶段 B 的 8 个状态写切片、阶段 A 接线恢复的 13 个切片（首批 3 + 批 1-13）、阶段 B §4 强化的 7 个 guard/投影切片、updateAccount 网关收敛、pipeline state DTO 边界收敛、smoke 种子收敛、阶段 C accounts+intake+通知 白名单三片，以及看板自动化：

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

**阶段 B §1 完成门（经 2026-08-30 审计发现并已收尾）**：对 `lib/` 扫描确认 `crm_accounts` 的 `stage`/`lifecycle_status`/`assignment_status`/`owner_id`/`next_action*`/`manager_*`/`updated_at` **已无裸直写**。审计发现 `updateAccount`（profile 编辑）曾经动态 `fields.push` → `UPDATE crm_accounts SET ${fields.join(',')}` 直写这些列（此前"零裸写"声明不实，因为核验正则以"状态列与 UPDATE 同排"匹配、漏扫动态字段拼装），已由 `aabe4d9` 收敛到三个网关（`applyAccountStatePatch`/`applyAccountPlanPatch`/`applyManagerStatusPatch`），claim/unassign 权限子流保持。`last_activity_at`（活动时间戳）与回收专属字段（`recycle_*`/`previous_owner_id`/`loss_reason`/`return_reason`）为明确的网关列之外直写。测试专用种子（`smoke_test_data.js`、`seedAccounts`）按契约 §2 不在收敛范围。

**阶段 A 接线恢复（13 个切片，39 个模块已接入）**：按接线清单把被 WIP 回退的域模块重新接入 `sales_crm.js`。纪律：先做全量逐字一致性核验（分类器+抽样 diff），仅对与内联版逐字一致的自包含纯函数模块做 drop-in 接线；B 组按函数级核验、只接逐字一致的部分函数；注入式错误构造的函数经调用点注入 `{ httpError }`/`{ badRequest }`/`{ error: httpError }`/SQL 闭包等保持原语义。已接线域模块（38 个被 `sales_crm.js` require，含 3 个生命周期/身份相关经其他 lib 存活者合计 42 个中 39 个接线）：`json/parse`、`list/pagination`、`audit/redact`、`notifications/visibility`、`http/error`、`http/routes`、`reporting/csv`、`insights/labels`、`activity/serialize`、`planning/alerts`、`planning/risk`、`planning/streak`、`intake/query`、`intake/decision`、`intake/assignment`、`assignment/link`、`auth/access`、`auth/credentials`、`auth/session`、`auth/user`、`customer/contacts`、`customer/identity`、`customer/summary`、`customer/recycle`、`customer/normalize`、`customer/dedupe`、`customer/create`、`reporting/builders`、`commerce/rules`、`activity/present`、`activity/progress`、`activity/request`、`intake/owner`、`insights/evaluation`、`filter/errors`、`planning/today_task`、`lifecycle/state_write`、`lifecycle/collaboration_write`（另 `lifecycle/state_projection` 经 `business_page_filters.js` 接线）。**仅剩 3 个按用户裁定保持内联/精简**：`identity/index`（facade 精简）、`identity/middleware`（认证逻辑内联）、`filter/index`（直连 filter_authorization）——即 WIP 收敛时用户裁定的"内联版"边界。`sales_crm.js` 行数从 13,970 降至 12,966（-1004 行）。接线契约 13 文件 24 断言。

**进度看板**：`docs/governance/PROGRESS_BOARD.md`（仓库内真值）与 `docs/governance/progress-board.html`（浏览器可视化）由 `scripts/progress_board.js` 自动生成（`npm run board`；`npm run board:watch` 实时监听）。数据自动推导自 git 提交（origin/main..HEAD）、`lib/` 代码扫描与治理文档（CURRENT_STATE/sessions），无手工维护字段；每个切片收尾按 WORK_PROTOCOL 自动再生成并随治理文档提交。

已经形成的主要切片包括：

- 字段目录与 schema 驱动显示：线索池、客户资料字段分组、profile widgets、用户级 section 偏好。
- identity/filter 兼容 facade 与认证中间件抽取。
- lifecycle 状态投影、状态写入 shim、协作状态写入、前端 DTO 消费。
- contact-restricted 读取的多类白名单投影。
- customer、activity、planning、intake、assignment、commerce、reporting 等纯函数或辅助逻辑抽取。
- `lib/domains/` 当前有 42 个文件。

接线索计（详见 `sessions/2026-08-29-state-write-convergence.md`）：审计确认 `92c3879` 的内联回退覆盖了 `lib/domains/` **全部 42 个模块**在 `sales_crm.js` 的引用（非此前文档所记"部分"）。接线恢复 13 个切片后 39 个域模块已接线（`sales_crm.js` require 38 个 + `state_projection` 经 `business_page_filters.js`），仅剩 3 个按用户裁定保持内联/精简（`identity/index`、`identity/middleware`、`filter/index`）。

规模变化仅表示已经开始拆分，不代表单体拆分完成：

- `origin/main` 的 `lib/sales_crm.js`：13,758 行。
- 当前提交态 `aabe4d9`：12,984 行。
- `sales-assets/app.js` 当前仍为 14,096 行。
- 客户完整资料仍保留 iframe 兼容路径；尚未形成完整 widget 注册表。

因此当前结论是：重构已经实质推进，但仍处于渐进迁移中，不能描述为“拆分完成”或“可合并”。

## 3. 已提交 WIP 收敛（2026-08-29）

迁移 WIP 已按用户裁定保留并提交为 `92c3879`。收敛内容：

- `lib/domains/identity/index.js`：精简 facade，不再转发 `PERMISSION_DEFINITIONS` 等常量与 `contactSafe*`/`redactContactFields` 白名单代理。
- `lib/sales_crm.js`：移除 accounts/bootstrap/profile 的 state DTO 投影（`projectAccountState`），并内联/回放此前抽取的部分 domain 引用，保持外部 API 行为不变。
- `sales-assets/app.js`：删除 `accountStageOf`/`managerStateDisplay`/`accountLifecycleActive`/`accountAssignmentReturned`，直读裸字段。
- `test/domain_facades.test.js`、`test/issue103_frontend.test.js`、`test/issue209_ownerless_return.test.js`、`test/lifecycle_state_projection.test.js`：同步更新契约断言；白名单兼容测试改为从 `access_control` 直连导入。

注意：pipeline 行仍由 `business_page_filters.js` 附加 state DTO（未内联），与 accounts/bootstrap/profile 的“无 state DTO”存在边界差异，已通过测试确认前端不依赖该差异。

`after/` 工作区干净：5 个迁移 WIP 业务文件已提交为 `92c3879`；仅剩 `docs/governance/` 治理文档待提交。

## 4. 最近验证结果

在 `/Users/ylf/Desktop/projects/tradepulse-refactor/after` 执行：

- `npm ci`：成功安装；审计报告未升级依赖。
- `npm test`：全量 core `1591/1591` 通过。
- `node --test`：全量 `1952/1952` 通过（含此前修复的 12 个失败场景）。
- 专项：`domain_facades`+`issue103` 9/9；`lifecycle_state_projection` 22/22；`phase_c_account_whitelist_contract` 3/3；`phase_c_intake_whitelist_contract` 3/3；`phase_c_notification_whitelist_contract` 3/3；`state_projection_time_basis_contract` 3/3；`state_projection_alerts_contract` 3/3；`report_builders_projection_contract` 2/2；`pipeline_key_projection_contract` 1/1；`state_write_update_account_contract` 7/7；`pipeline_row_state_boundary_contract` 2/2；`state_write_recycle_restore_invariant_contract` 5/5；`smoke_seed_plan_basis_contract` 6/6；`smoke_test_data` 5/5；`issue209` 5/5；`state_write_reject_contract` 2/2；`state_write_return_contract` 2/2；`state_write_stage_contract` 4/4；`state_write_stage_precondition_guard_contract` 1/1；`state_write_invariant_contract` 4/4；`state_write_commerce_contract` 5/5；`collaboration_write_commerce_contract` 4/4；`state_write_activity_contract` 4/4；`collaboration_write_plan_points_contract` 6/6；`state_write_claim_manager_contract` 5/5；`state_write_recycle_restore_contract` 4/4；`domain_wiring_*_contract` 13 文件 24 断言全绿；报价/订单/阶段边界回归 22/22。

阶段 B 契约测试 18 文件 66 断言 + 阶段 A 接线契约 13 文件 24 断言 + 阶段 C 白名单契约（accounts 3 + intake 3 + 通知 3 = 9 断言）（含共享结构化断言助手 `test/helpers/lifecycle_gate_contract.js`）。

此前 12 个全量失败已在一轮修复（ownerless return 前端兼容、lifecycle state projection 契约、contact whitelist 兼容导出）。

当前测试结论是“绿灯”。旧文档中的 1353/1353 或 1361/1364 只属于历史 checkpoint，不能作为当前完成证据。

## 5. 当前阶段判断

- 阶段 0 治理基础：已建立；2026-08-29 已迁移到新根目录并完成校准。
- 前端字段目录/widget 试点：已实现多个切片，但 widget 注册表和 iframe 收敛尚未完成。
- 后端领域拆分：`lib/domains/` 42 个文件；审计确认 WIP 回退了其在 `sales_crm.js` 的全部引用；接线恢复 13 个切片后 39 个域模块已接线（`sales_crm.js` require 38 个 + `state_projection` 经 `business_page_filters.js`），仅剩 3 个按用户裁定保持内联/精简（`identity/index`、`identity/middleware`、`filter/index`）。
- 阶段 A 接线恢复：**13 个切片全部完成**——42 个域模块中 39 个已重新接入（纯函数 drop-in + 注入式错误构造经调用点注入保持语义）；`sales_crm.js` 12,984 行；仅剩 3 个模块按用户裁定不接线。
- 阶段 B 状态真源：**全部完成门达成**——§1 写点收敛（`lib/` 对 `crm_accounts` 状态/计划/主管列零裸写，含 `updateAccount` `aabe4d9`）、§4 强化（前置校验 `0ae90af`、不变量守卫 `9186a6d` + 回收/恢复接线 `da34bc2`、time_basis 投影 `cb6c6e4`、告警/报告/pipeline 读路径投影消费 `754d023`/`c4bba3f`/`fe77fb4`）、边界收敛（pipeline 行移除 state DTO `6b88d74`）、种子收敛（生产冒烟夹具补 time_basis `929b8c1`）。契约 §4 不变量均已由契约测试锁定。**红线内（不改）**：AI `next_action` 采纳写点（`lib/ai_stations/next_action.js`，`time_basis='utc'` 语义正确）+ `last_activity_at` 归属为活动溯源。阶段 B 业务侧收尾，剩余项仅涉 AI 红线评估与前端状态解释器。
- 阶段 C 权限/筛选/字段：**推进中**——字段目录 + 各白名单投影已存在；`78e698b` accounts 列表、`5e992fe` intake 页、`1835f73` 通知页均已切到字段级白名单。剩余：评估/bootstrap payload 黑名单路径、统一 `buildAccessContext` 与列表范围解释器、按页面补"权限→字段→筛选"合同。
- 状态、权限与白名单：state DTO 按用户裁定收敛为直读裸字段；白名单投影改为 `access_control` 直连。
- 生产部署/UAT：本轮未执行，不得从本地结果推断生产状态。

## 6. 下一步允许动作

1. 单独提交治理文档 checkpoint（当前更新），与业务提交分离。
2. 阶段 A 接线恢复：**已完成**——42 个域模块中 39 个已重新接入（13 切片、24 契约断言），仅剩 `identity/index`、`identity/middleware`、`filter/index` 三个按用户裁定保持内联/精简。后续如需继续减单体，可评估已漂移模块或转入阶段 B 收尾。
3. 阶段 B 业务侧收尾完成（`929b8c1` 止：§1 写点 + §4 强化 + 边界 + 种子收敛）。剩余项均涉红线/评估——AI next_action 写点（`ai_stations/next_action.js`）仅评估不改；`last_activity_at` 归属明确为"活动溯源"列（addActivity/quote/order/completeManagerAssistance 写、rebuild 重算，不入网关收敛范围）；状态解释器统一消费（前端侧后续评估）。
4. 阶段 C（权限/筛选/字段）为当前执行阶段：`78e698b`/`5e992fe`/`1835f73` 已把 accounts 列表、intake 页、通知页切到字段级白名单。续：评估并收敛剩余 `redactContactFields` 路径（evaluation/alert payload `sales_crm.js:7022/9975/10631/11631`、db bootstrap `db.js:1564/1707`；AI 相关 `assistant.js`/`task_center.js` 红线除外）、统一 `buildAccessContext` 与列表查询范围解释器、按页面落地"权限→字段→筛选"合同测试。
5. 未全绿前不叠加下一阶段新功能或拆分范围。

## 7. 红线

- 不在 `repo/`、`before/` 或旧 `tradepulse-development` 中编辑业务代码。
- 不修改 `/Users/ylf/Desktop/projects/tradepulse-production`、生产数据库、生产配置或生产部署。
- 不重构、迁移或搬运 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 及既有 AI 触发点。
- 新根目录尚未建立专用预览 runtime；在明确数据库路径前，不启动会误连旧 runtime 的服务。
- 未经用户明确要求，不 push、不合并、不删除旧目录。
