# Session Checkpoint：阶段 A 接线恢复批 6（customer/recycle 注入式错误构造全量接线）

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`a853a16` → `af770f5`

## 本轮切片

### `af770f5` customer/recycle 注入式错误构造函数全量接线（1 模块，4 函数）
- `lib/domains/customer/recycle` → `validateRecycleReason`/`mismatchRecordNotFound`/`parseMismatchRecordKey`/`assertCustomerReturnEligible`
- 这四个函数与内联版逐字一致，仅错误构造为注入式（`options.httpError`，默认 `new Error`）。接线方式：全部 12 个调用点注入 `{ httpError: recycleError }`，使抛出的错误与内联版一致（`recycleError` = `httpError(statusCode, message, code)`，带 statusCode 与 code）。
- `manualReturnBatchId` 并入同一 require（上轮已接线，批 5 的单行 import 合并为多行）。
- 同步修正 `test/domain_wiring_commerce_recycle_contract.test.js` 中对 `manualReturnBatchId` 单行 import 的过时断言（现为多行 require），并入本切片。
- 契约测试：`test/domain_wiring_recycle_injected_contract.test.js`（1 断言，含注入点计数 >=12）。

## 核验方法

- 域版 `parseMismatchRecordKey` 内部调用 `mismatchRecordNotFound(options)` 会透传 options，因此 parse 路径只需在外部调用点注入一次，内部自动继承 httpError——契约测试断言注入点数量与实际调用点一致。
- 12 个注入调用点：`validateRecycleReason`×5（returnCustomer/bulkReturnCustomers/restoreMismatchRecord/trashManualCustomer/reassignReturnedCustomer）、`assertCustomerReturnEligible`×3、`parseMismatchRecordKey`×1、`mismatchRecordNotFound`×3（含 404 路由回调）。

## 测试证据

- 接线契约 1/1；recycle/mismatch/return 回归 9 文件 38/38 全绿。
- `node --test` 全量 `1904/1904`；`npm test` core `1542/1542`。
- `sales_crm.js` 行数：13,323 → 13,295（-28 行，累计 -675）。

## 提交

- `af770f5` refactor(domains): re-wire customer/recycle injected-error helpers with httpError injection

## 风险与回滚

- 行为保持：注入 `recycleError` 后错误语义与内联版逐字一致（statusCode 400/404/409 + 稳定 code），由 recycle/mismatch 回归 38/38 锁定。
- 未 push/未合并/未部署；未触碰 AI 内容与 intake 触发器。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 A 接线恢复续：未核验模块（`activity/present`、`customer/dedupe`、`auth/user`、`intake/owner`、`insights/evaluation`）先做逐字核验；已漂移模块（`customer/normalize`、`customer/create`、`activity/progress`、`activity/request`、`filter/errors`、`planning/today_task`）如需恢复需同步调用点，逐个评估。
3. 阶段 B 收尾：§4 强化、AI 写点（受红线约束）与种子收敛、明确 `last_activity_at` 归属。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。
