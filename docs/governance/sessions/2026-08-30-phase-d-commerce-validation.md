# Session Checkpoint：阶段 D commerce 三片——校验下沉

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`f5c650e` → `24aa67e`

## 本轮切片

### `24aa67e` quote/order 金额/币种/毛利校验下沉
阶段 D（商业闭环）第三片。把 `addQuote`/`addOrder` 的输入校验纳入 commerce 域：

`COMMERCE_CURRENCIES`/`validateMoney`/`validateCurrency`/`validateMargin` 从 `sales_crm.js` 内联迁至 `lib/domains/commerce/rules.js`（`validateMargin` 已在域版，本轮补 `validateMoney`/`validateCurrency`/`COMMERCE_CURRENCIES`）。错误构造由调用点注入 `{ badRequest }`，校验消息与归一后数值逐字一致。

`addQuote`/`addOrder` 调用点注入 `{ badRequest }`；内联四定义删除。`validateRfqPayload` 仍按既有裁定（注入式、与内联版行为差异）保持内联。

契约测试（并入 `test/domain_wiring_commerce_recycle_contract.test.js`，现 2 断言）：
- **结构**：四校验函数来自域模块、`sales_crm.js` 无内联定义；调用点注入 `{ badRequest }`。
- **行为**：注入式错误构造、金额/币种归一、毛利对允许负数与范围 0-100 判定（`Math.round(-2.35*10)/10=-2.3`）。

## 测试证据

- 新/更新契约 2/2；commerce 相关回归（recycle/write/action_request + `state_write_commerce` + `a3_05` + collaboration_write + issue231 + invariant/stage/activity）= 35/35。
- `node --test` 全量 `1970/1970`（较上轮 +1）；`git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `24aa67e` refactor(commerce): extract quote/order amount and margin validation

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 D 商业闭环剩余：`addQuote`/`addOrder` 的编排逻辑（事务体外围：权限、幂等保留、事务执行、活动/计划链接、next_action 入队）已基本只剩壳层，可评估把整体提炼为 `write.js` 的 place 级 `commitQuote`/`commitOrder` 域服务（注入网关依赖保持语义）；`recordActivity` 的 rfq 分支行写已下沉。
3. intake/assignment/planning 已有域模块；manager intervention 与 deferred plan 为后续独立用例。