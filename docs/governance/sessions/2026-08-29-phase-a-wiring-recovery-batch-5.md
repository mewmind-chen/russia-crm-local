# Session Checkpoint：阶段 A 接线恢复批 5（B 组函数级：commerce/recycle）

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`13c5368` → `a853a16`（B 组函数级接线）

## 背景

在全量逐字核验分类（A 组 14 可 drop-in、B 组 6 函数级部分可接、C 组约 15 不宜接线）基础上，A 组 14 模块已全部落地（批 1-4，`7328b51`→`13c5368`）。本轮处理 B 组第一轮函数级接线。

## 本轮切片

### `a853a16` commerce/recycle 函数级接线（2 模块，3 函数）
- `lib/domains/commerce/rules` → `advanceStage`/`commerceActionIdempotencyKey`（逐字一致，drop-in）
- `lib/domains/customer/recycle` → `manualReturnBatchId`（逐字一致，drop-in）
- 保持内联的函数（注入式错误构造，行为与内联 HttpError 不同）：
  - `validateMargin`/`validateRfqPayload` — 使用 `options.badRequest`，内联版直接调用 `badRequest`（HttpError 400）
  - `validateRecycleReason`/`mismatchRecordNotFound`/`parseMismatchRecordKey`/`assertCustomerReturnEligible` — 使用 `options.httpError`，内联版调用 `recycleError`（带 statusCode 与 code 的 HttpError）
- 契约测试：`test/domain_wiring_commerce_recycle_contract.test.js`（1 断言）。

## 测试证据

- 接线契约 1/1；相关消费专项（quotes/orders/rfq 边界、recycle/return/mismatch、stage gate）46/46 全绿。
- `node --test` 全量 `1903/1903`；`npm test` core `1542/1542`。
- `sales_crm.js` 行数：13,352 → 13,323（-29 行，累计 -647）。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 A 接线恢复续：
   - B 组剩余：`customer/recycle` 的 validateRecycleReason/parseMismatchRecordKey 等如需接线需把调用点改为注入 `{ httpError: recycleError }`（行为保持）。
   - 未核验模块：`activity/present`、`customer/dedupe`、`auth/user`、`intake/owner`、`insights/evaluation` 等需先做逐字核验。
   - 已漂移模块（`customer/normalize`、`customer/create`、`activity/progress`、`activity/request`、`filter/errors`、`planning/today_task`）如需恢复需同步调用点，逐个评估。
3. 阶段 B 收尾：§4 强化、AI 写点（受红线约束）与种子收敛、明确 `last_activity_at` 归属。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。