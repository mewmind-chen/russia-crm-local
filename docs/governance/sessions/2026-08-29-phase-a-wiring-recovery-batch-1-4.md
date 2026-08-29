# Session Checkpoint：阶段 A 接线恢复批 1-4（activity/planning/intake/assignment/auth/customer/reporting-builders）

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`873d1b0` → 本轮四个接线提交 `7328b51`、`48ba93c`、`ad657ac`、`13c5368`

## 前置：全量逐字一致性核验

回答"42 个域模块能否一次性恢复"：先做全量核验（脚本比对域模块导出函数与 `sales_crm.js` 内联版逐字一致性，括号配对解析函数边界，规范化空白），并对分类器结果抽样直接 diff 复核。结论：

- **A 组 14 个模块可 drop-in**（逐字一致、行为零变化）：`activity/serialize`、`assignment/link`、`auth/access`、`auth/credentials`、`auth/session`、`customer/contacts`、`customer/identity`、`customer/summary`、`intake/assignment`、`intake/decision`、`intake/query`、`planning/alerts`、`planning/risk`、`planning/streak`、`reporting/builders`。
- **B 组 6 个模块函数级部分可接**：如 `commerce/rules` 的 advanceStage/idempotencyKey 逐字一致但 validateMargin/validateRfqPayload 已漂移；`customer/recycle` 仅 manualReturnBatchId 一致。
- **C 组约 15 个不宜接线**：已接线 10 个（lifecycle 三网关 + 首批 8 个 helper 中已含在 sales_crm 的）；用户裁定保持内联/精简的 `identity/index`、`identity/middleware`、`filter/index`；已漂移需逐点改造的 `customer/normalize`、`customer/create`、`activity/progress`、`activity/request`、`filter/errors`、`planning/today_task`。

**不建议一次性全接的理由**：约 15 个模块非逐字一致（盲接会静默改行为）；部分按用户裁定不应恢复；治理协议要求每切片独立提交可回滚。改为 A 组 14 个模块按功能域分 4 批，一次对话内全部完成。

## 本轮四个切片

### `7328b51` activity/planning helper（4 模块，6 函数）
- `lib/domains/activity/serialize` → `publicActivityRecord`/`publicActivityRecords`
- `lib/domains/planning/alerts` → `reasonOrder`/`urgencyFor`/`groupAlerts`
- `lib/domains/planning/risk` → `emptyCustomerPlanRisk`
- `lib/domains/planning/streak` → `noPlanStreakForActivities`
- 契约测试：`test/domain_wiring_activity_planning_contract.test.js`（3 断言；import 断言放宽为多行正则匹配）。

### `48ba93c` intake/assignment helper（4 模块，12 函数）
- `lib/domains/intake/assignment` → `intakeActionIdempotencyKey`/`manualAssignmentRequestHash`/`manualAssignmentRequiresPreview`
- `lib/domains/intake/decision` → `serializeArbitrationDecision`/`withoutArbitrationAI`/`serializeRecommendation`
- `lib/domains/intake/query` → `intakeQueryValues`/`intakeQueryBoolean`/`intakeQueryDate`
- `lib/domains/assignment/link` → `isCurrentIntakeAccount`/`isReturnedAccountForIntake`/`reusableReturnedAccountForIntake`
- 契约测试：`test/domain_wiring_intake_assignment_contract.test.js`（3 断言）。

### `ad657ac` auth/customer helper（6 模块，9 函数）
- `lib/domains/auth/access` → `inaccessibleOrMissing`；`auth/credentials` → `hashPassword`；`auth/session` → `parseCookies`
- `lib/domains/customer/contacts` → `cleanContactFields`/`publicAccountContact`；`customer/identity` → `identityConflictNote`；`customer/summary` → `creatorDisplayName`/`historyAccountSummary`/`changedFieldLabels`
- 契约测试：`test/domain_wiring_auth_customer_contract.test.js`（3 断言）。

### `13c5368` reporting builders（1 模块，4 函数）
- `lib/domains/reporting/builders` → `rate`/`buildCountryReport`/`buildCohortReport`/`buildTeamReport`
- 契约测试：`test/domain_wiring_reporting_contract.test.js`（1 断言）。

## 核验方法（关键纪律）

- 候选模块必须与 sales_crm.js 内联版**逐字一致**才接线；注入式依赖或交叉依赖模块暂缓（如 `customer/recycle` 注入 `options.httpError`）。
- 接线形态：`sales_crm.js` import 域模块并在模块作用域绑定同名标识符，删除内联定义（用括号配对脚本按函数名精确删除）；所有裸名调用点不变。
- 结构契约测试用 `doesNotMatch(/^function X\(/m)` 锁定"不再内联"，import 断言锁定"已接线"。

## 测试证据

- 接线契约 4 文件 10 断言全绿；相关消费专项（activity serialize、streak/alerts/risk、intake query/decision、auth hash/session、customer summary/identity/contacts、报表）全绿。
- `node --test` 全量 `1902/1902`；`npm test` core `1541/1541`。
- `git diff --check` 通过；lint 无错误；工作区干净。
- `sales_crm.js` 行数：13,850 → 13,352（-498 行，累计 -618）。

## 提交

- `7328b51` refactor(domains): re-wire activity serializers and planning helpers to their modules
- `48ba93c` refactor(domains): re-wire intake and assignment helpers to their domain modules
- `ad657ac` refactor(domains): re-wire auth and customer helpers to their domain modules
- `13c5368` refactor(domains): re-wire reporting builders to their domain module

## 风险与回滚

- 四个提交可分别 `git revert` 回滚；接线前后行为逐字一致，全量回归兜底。
- 未 push、未合并、未部署；未触碰 AI 内容与 intake 触发器；未创建新 runtime；未改生产数据。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），并重新生成进度看板。
2. 阶段 A 接线恢复续：B 组函数级部分一致的模块（`commerce/rules` 的 advanceStage/idempotencyKey、`customer/recycle` 的 manualReturnBatchId）做函数级接线；已漂移模块（normalize/create/progress/request/errors/today_task）如需恢复需同步调用点，逐个评估。
3. 阶段 B 收尾：§4 强化、AI 写点（受红线约束）与种子收敛、明确 `last_activity_at` 归属。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。
