# Session Checkpoint：阶段 B 状态写收敛首批 + 审计接线清单

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`09ef77e` → 本轮三个业务提交 `13cd37a`、`06a9868`、`a783c8c`

## 目的与范围

按 WORK_PROTOCOL 恢复点执行只读取审计 + 阶段 B 无歧义切片：

- 只读审计 `origin/main..92c3879` 共 63 个提交，形成"已抽取且已接线 / 仅抽取未接线 / 被 WIP 回退"接线清单。
- 从 `STATE_TRANSITION_CONTRACT.md` 落地三个无歧义切片，每片独立测试 + 独立提交。

## 审计结论（接线清单）

对 `origin/main..92c3879` 全部 63 提交逐一核对 `92c3879` 的 diff + 全局 `require` 扫描：

- **关键发现**：`92c3879` 从 `lib/sales_crm.js` 移除了 `lib/domains/` **全部 42 个模块**的引用（此前文档记为"部分"，实测为全部），把代码内联回单体；`sales_crm.js` 现在对 `lib/domains/` 零引用。
- **已抽取且已接线（3 个，经其他 lib 存活，均在 sales_crm.js 之外）**：
  - `lifecycle/state_projection` → `lib/business_page_filters.js:6`（pipeline 行 state DTO，未内联边界差异）
  - `lifecycle/state_write` → `lib/crm_account_rebuild.js:9`
  - `lifecycle/collaboration_write` → `lib/crm_account_rebuild.js:13`
- **被 WIP 回退（39 个：文件保留、测试覆盖，但 sales_crm.js 内联回）**：
  - identity：`index`（facade 精简，调用方直连 access_control）、`middleware`
  - filter：`index`（改回直连 filter_authorization）、`errors`
  - customer：`normalize/identity/dedupe/recycle/create/summary/contacts`
  - activity：`present/progress/serialize/request`
  - planning：`streak/alerts/risk/today_task`
  - intake：`owner/query/decision/assignment`
  - commerce：`rules`；assignment：`link`
  - auth：`access/credentials/session/user`
  - reporting：`builders/csv`；audit：`redact`
  - list：`pagination`；json：`parse`
  - http：`routes/error`；notifications：`visibility`
  - insights：`labels/evaluation`
  - lifecycle：`state_projection/state_write/collaboration_write`（在 sales_crm.js 内被回退，但经上述接线点仍存活）
- **仅抽取未接线（0 个）**：42 个模块在 `92c3879` 前均已接入 sales_crm.js。
- 字段目录/widget 5 个提交（`7a26074`…`077c88c`）属功能切片，`field_catalog.js` 仍被 `sales_crm.js` 引用，不受 WIP 影响。

## 本轮三个切片（实现 + 契约测试 + 独立提交）

共同前提：把 `lib/domains/lifecycle/state_write` 的 `applyAccountStatePatch` 重新接入 `sales_crm.js`。这正是阶段 B 完成门（写经网关）要求，不违背用户"内联版"裁定（裁定只涉及读路径 state DTO 与 identity facade，不含写网关）。

### 切片 1 `13cd37a` rejectCrmCustomer
- 三字段收敛：`stage='lost'` / `lifecycle_status='recycled'` / `assignment_status='returned'` / `owner_id=NULL` / `updated_at` 经 `applyAccountStatePatch`。
- 回收专属字段（`recycle_kind='mismatch'`、reason/by/at、`previous_owner_id`、loss/return_reason）仍为直写（不在统一状态契约内）。
- 不新增 `expected` WHERE，保持与原 `WHERE id=?` 完全一致（含 COALESCE 把 NULL lifecycle 视作 active 的情形）。
- 一次性 reject 幂等守卫沿用既有前置检查；已回收账号二次 reject 现返回 404（状态退出作用域），非 409。
- 契约测试：`test/state_write_reject_contract.test.js`（结构性：函数体内不得裸 UPDATE 状态列且必须含网关；行为性：recycled 不配 claimed/assigned、returned 无 owner）。

### 切片 2 `06a9868` applyCustomerReturn
- 只走 assignment 网关：`assignment_status='returned'` + `owner_id=null` + `updated_at` 经 `applyAccountStatePatch`。
- 明确不触动 lifecycle（保持 active，不回收）与 stage。
- recycling 专属字段（清 recycle_kind/reason/by/at + `previous_owner_id` + `return_reason`）仍直写。
- 函数内新增 `assertCustomerReturnEligible(account)`，保留"已返回 → 409 CUSTOMER_RETURN_STATE_INVALID"的幂等守卫（原 WHERE 的防御语义）。
- 契约测试：`test/state_write_return_contract.test.js`。

### 切片 3 `a783c8c` addQuote/addOrder stage 前置校验
- `addQuote`：前 stage 索引 ≤ `quoted`（8），否则 409 `STAGE_PRECONDITION_VIOLATION`，且在任何 commerce 行写入前拒绝。
- `addOrder`（首单 `!isRepeat`）：前 stage 索引 ≤ `won`（10）；复购单跳过（复购前 stage 任意）。
- 前置校验放在 `reservation.replay` **幂等短路之后**：对已完成的 quote/order 回放命中 `deduplicated` 时不受 stage 影响（关键回归：`issue171_effective_activity` 的 rfq→quote→order(won)→回放 quote 场景曾因此被误拒）。
- 契约测试：`test/state_write_stage_contract.test.js`（won-stage 报价被拒、rfq-stage 报价成功至 quoted、repeat-stage 首单被拒、lost-stage 复购单成功至 repeat）。

## 测试证据

- 契约测试：reject 2/2、return 2/2、stage 4/4（共 8）。
- 相关专项：`issue137`+`issue209`+`issue257`+`issue273`+`lifecycle_state_write`+`state_projection`+`a3_05` 共 58/58；`a3_06`(含 AI 全量 quote/order 流程)+`domain_facades`+`issue103` 等 53/53；`issue171` 18/18（含回放修复）。
- `node --test` 全量 `1852/1852`（基线 1844 + 本轮 8）。
- `npm test` core `1492/1492`。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `13cd37a` refactor(state): route rejectCrmCustomer account-state writes through the lifecycle gateway
- `06a9868` refactor(state): route applyCustomerReturn assignment write through the lifecycle gateway
- `a783c8c` feat(commerce): gate addQuote/addOrder behind a stage precondition

## 风险与回滚

- 三个业务提交均可分别 `git revert` 单点回滚；`applyAccountStatePatch` 接入是契约完成门的必需动作，回退后状态写将退回裸 UPDATE（仍在 WIP 内联状态）。
- `addQuote`/`addOrder` 的 stage **写入**本身仍为直写 SQL，未收敛到网关——本轮只加了前置校验，是明确保留的后续切片，非本次回归。
- 审计显示 WIP 回退覆盖全部 42 个模块（非"部分"）：这是对既有文档描述的修正，不改变任何已裁定事实；后续阶段 A 恢复需按接线清单逐块重建。
- 未 push、未合并、未部署；未触碰 AI 内容；未创建新 runtime；未改生产数据。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（本文件 + CURRENT_STATE.md 更新）。
2. 阶段 B：把 `addQuote`/`addOrder` 的 stage 写入收敛到 `state_write` 网关；继续收其他商务/回收写点。
3. 按接线清单优先恢复经 lifecycle 网关的写路径接线，再逐模块重建阶段 A 抽取。
4. 收敛 pipeline 与 accounts/bootstrap/profile 的 state DTO 边界差异。