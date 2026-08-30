# Session Checkpoint：阶段 B §4 强化首切片（assert*Transition stage 守卫）

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`5c23b32` → `0ae90af`

## 背景

阶段 B §1 完成门已达成（状态/计划/主管列零裸写）。§4 强化要求"assert\*Transition 前置校验全面落地"——把散落在 `sales_crm.js` 聚合文件里的状态转移前置判定提炼为有签名的域级守卫，让转换规则内聚到 lifecycle 网关。本轮为首切片：报价/首单的 stage 前置校验。

## 本轮切片

### `0ae90af` assert\*Transition stage 前置守卫
- `lib/domains/lifecycle/state_write.js` 新增：
  - `assertQuoteTransition(account, { conflictError })`：报价前 stage 单调 ≤ `quoted`（`STAGE_INDEX[current] > STAGE_INDEX.quoted` 则抛 `STAGE_PRECONDITION_VIOLATION`）
  - `assertFirstOrderTransition(account, { conflictError })`：首单前 stage 单调 ≤ `won`（首单前 `won`/`repeat` 拒绝）
- `lib/sales_crm.js`：`addQuote` 内联 `const quoteStageIndex = STAGE_INDEX[...]...` + if 块改为 `assertQuoteTransition(account, { conflictError })`；`addOrder` 非复购分支同样替换。复购（`isRepeat`）仍任意跳过。
- 错误构造 `conflictError` 由调用点注入，保持与原内联版一致（`httpError(409, message, 'STAGE_PRECONDITION_VIOLATION')`）。
- 契约测试：`test/state_write_stage_precondition_guard_contract.test.js`（1 断言），锁定：
  - `addQuote`/`addOrder` 函数体内不再出现 `STAGE_PRECONDITION_VIOLATION`/`STAGE_INDEX`（不再内联）
  - 调用点改为 `assertQuoteTransition(`/`assertFirstOrderTransition(`
  - 守卫实现在 `state_write` 网关且含 `STAGE_PRECONDITION_VIOLATION`

## 行为等价核验

守卫用 `STAGE_INDEX[current] > STAGE_INDEX.quoted/won`，与内联版逐字等价（`quoted`=idx8、`won`=idx10；报价后推进到 `won`/`repeat` 的行为、复购任意跳过均不变）。`33` 行守卫取代 `12` 行内联判定。

## 测试证据

- 守卫契约 1/1；原 `state_write_stage_contract` 4/4。
- 报价/订单/阶段边界回归 7 文件 22/22（含 `a3_05_rfq_order_boundary`、`a4_04_stage_gate`、`state_write_commerce_contract` 等）。
- `node --test` 全量 `1914/1914`；`npm test` core `1553/1553`。
- `git diff --check` 通过；lint 无错误；工作区干净。
- `sales_crm.js` 行数：12,973 → 12,966。

## 提交

- `0ae90af` refactor(domains): add assert*Transition stage guards to the lifecycle gateway

## 风险与回滚

- 行为保持：守卫与内联版逐字等价，报价/订单回归 22/22 兜底，可独立 `git revert`。
- 未 push/未合并/未部署；未触碰 AI 内容与 intake 触发器。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 B §4 强化续：为 §4.1「recycled 不配 claimed/assigned」、§4.2「returned 无 owner」、§4.3「next_action 有值必配 time_basis」补 `assert*` 守卫（契约测试已锁定不变量，补守卫使规则可复用）。
3. AI next_action 写点与测试专用种子收敛（受红线约束）、明确 `last_activity_at` 归属。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。