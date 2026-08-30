# Session Checkpoint：阶段 D commerce 首片——幂等保留生命周期

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`f2056e5` → `1d15546`

## 本轮切片

### `1d15546` quote/order 幂等保留生命周期抽取
阶段 D（商业闭环）第一片。把 RFQ/quote/order 跨域流程中 **action request 事务边界**（路线图阶段 D 关键动作之一）显式化：

`reserveCommerceAction`/`completeCommerceAction`/`clearCommerceActionReservation`（操作 `crm_commerce_action_requests`，quote/order 幂等保留）从 `sales_crm.js` 内联迁出至 `lib/domains/commerce/action_request.js`。

- `conflictError`/`json`/`nowText` 由调用点注入，保持原 409 错误码（`COMMERCE_IDEMPOTENCY_CONFLICT`/`COMMERCE_ACTION_IN_PROGRESS`）与 `started→completed` 状态迁移、错误回退清理语义不变。
- `commerceActionIdempotencyKey` 复用 `domains/commerce/rules` 既有导出（域内依赖，不重复注入）。
- `addQuote`/`addOrder` 调用点注入 `{ conflictError, json, nowText }`。

契约测试 `test/domain_wiring_commerce_action_request_contract.test.js`（4 断言）：
- **结构**：三函数来自域模块，`sales_crm.js` 无内联定义。
- **行为**：保留创建 started、clear 清理；in-flight 拒绝同请求、绑定他人/他动作/他客户冲突；完成后再保留返回 deduplicated 重放。

## 测试证据

- 新契约 4/4；commerce 相关回归（`state_write_commerce` + `a3_05_rfq_order_boundary` + `domain_wiring_commerce_recycle` + `collaboration_write_commerce` + `issue231` + invariant/stage）= 26/26。
- `node --test` 全量 `1965/1965`（较上轮 +4 断言）；`git diff --check` 通过；lint 无错误；模块加载正常；工作区干净。

## 提交

- `1d15546` refactor(commerce): extract quote/order idempotency reservation lifecycle

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 D 商业闭环剩余：把 RFQ/quote/order 的**写入行级逻辑**（`addQuote`/`addOrder` 的事务体、RFQ 在 `recordActivity` 的记录分支）继续下沉到 commerce 域，最终让 `sales_crm.js` 收敛为路由/聚合。可选切入点：`addQuote`/`addOrder` 的事务体提炼为 `commerce/write.js` 域服务（注入网关依赖注入式保持语义）。
3. intake/assignment/planning 已有域模块；manager intervention 与 deferred plan 为后续独立用例。