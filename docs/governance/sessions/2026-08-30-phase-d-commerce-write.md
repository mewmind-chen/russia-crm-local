# Session Checkpoint：阶段 D commerce 二片——行级写入下沉

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`1d15546` → `f5c650e`

## 本轮切片

### `f5c650e` RFQ/quote/order 行级写入下沉
阶段 D（商业闭环）第二片，延续 action request 幂等保留后继续收敛 RFQ/quote/order 的写入行级逻辑：

`crm_rfqs`/`crm_quotes`/`crm_orders` 的 INSERT/UPDATE 语句从 `addQuote`、`addOrder` 的 `recordActivity` 的 rfq 分支迁出至新域模块 `lib/domains/commerce/write.js`：

- `insertRfqRow` — crm_rfqs 插入（记录 activity_type=rfq 时）
- `insertQuoteRow` — crm_quotes 插入（含 loss_leader 布尔归一）
- `markRfqQuoted` — crm_rfqs 置 quoted + quoted_at
- `insertOrderRow` — crm_orders 插入（含 is_repeat 布尔归一）

这些是**纯行写、无错误构造**，时间戳/ID 全由调用点传入，逐字一致 drop-in。`addQuote`/`addOrder` 事务体与 `recordActivity` 的 rfq 分支改为调用域函数。

契约测试 `test/domain_wiring_commerce_write_contract.test.js`（4 断言）：
- **结构**：四函数来自域模块，`sales_crm.js` 无内联 SQL 定义。
- **行为**：quote 插入 + rfq 置 quoted 后形状正确（金额/币种/毛利/状态/跟进时间）；order 插入保留 repeat 标志；rfq 插入绑定来源 activity 与 open 状态。

## 测试证据

- 新契约 4/4；commerce 相关回归（write + action_request + recycle + `state_write_commerce` + `a3_05_rfq_order_boundary` + collaboration_write + issue231 + state_stage/activity/invariant）= 34/34。
- `node --test` 全量 `1969/1969`（较上轮 +4）；`git diff --check` 通过；lint 无错误；模块加载正常；工作区干净。

## 提交

- `f5c650e` refactor(commerce): extract RFQ/quote/order row-level writes

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 D 商业闭环剩余：`addQuote`/`addOrder` 的**编排逻辑**（权限、校验、幂等、事务、活动/计划链接、next_action 入队）可继续下沉为 `commerce/write.js` 或独立域服务的 place 级函数；`recordActivity` 的 rfq 分支也已行写下沉。装卸量级内联已基本清空，后续可评估把 `addQuote`/`addOrder` 整体提炼为 `commitQuote`/`commitOrder` 域服务（注入网关依赖保持语义）。
3. intake/assignment/planning 已有域模块；manager intervention 与 deferred plan 为后续独立用例。