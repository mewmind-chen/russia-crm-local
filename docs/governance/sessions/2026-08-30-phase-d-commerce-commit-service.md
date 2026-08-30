# Session Checkpoint：阶段 D commerce 第四片——编排下沉为域服务

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`24aa67e` → `b4cfdfc`

## 本轮切片

### `b4cfdfc` addQuote/addOrder 编排下沉为 place 级 commitQuote/commitOrder 域服务
阶段 D（商业闭环）第四片。把 `addQuote`/`addOrder` 的**完整编排**（权限、金额/币种/毛利校验、幂等保留、阶段前置守卫、事务体：quote/order 行写 + rfq 置 quoted + 状态网关 + 计划网关 + last_activity + 活动 INSERT + 活动链接 + 显式计划、next_action 入队、完成/回退清理）兑现为 `lib/domains/commerce/write.js` 的 place 级域服务：

- `commitQuote(value, user, payload, deps, options)` 与 `commitOrder(value, user, payload, deps)` 封装全文流程，行为与内联版逐字节一致。
- 同域依赖由域模块内部 require：`./rules`（validateMoney/validateCurrency/validateMargin）、`./action_request`（reserve/complete/clearCommerceAction）。
- 跨域与 sales_crm 内部 helper 经 `deps` 注入：`assertPermission`、`getAccountForUser`、`assertQuoteTransition`/`assertFirstOrderTransition`、`applyAccountStatePatch`、`applyAccountPlanPatch`/`PLAN_TIME_BASIS`、`linkCommerceActivity`、`recordExplicitPlanIfEnabled`、`enqueueNextActionForEvent`、`parseBusinessDateTime`、`nowText`/`id`/`badRequest`/`conflictError`/`json`。
- `sales_crm.js` 的 `addQuote`/`addOrder` 收敛为薄委托（打开 db → 注入 deps → 调 commit 服务 → 关闭 db）；不再直接导入 quote/order 行写、幂等生命周期与校验函数（`write.js` 仅导出 `insertRfqRow`/`commitQuote`/`commitOrder` 供 sales_crm 使用）。

**契约测试**（新增 `test/domain_wiring_commerce_commit_contract.test.js`，5 断言）：
- 结构：commitQuote/commitOrder 由域模块导出、`write.js` 内部 require `./rules` 与 `./action_request`；addQuote/addOrder 为薄委托且不含事务体/裸 SQL/守卫/幂等调用；事务体与活动/链接逻辑在 `write.js`。
- 行为（HTTP 端到端，复用 `adminFixture`）：commitQuote 响应形状 + quote 行 `activity_id` 链接 + 幂等表 completed（response_json 存 commit 服务原始返回，不含路由追加的 `ok`）；commitOrder 落 won + completed；幂等键重放返回相同 quoteId + `deduplicated:true` 且不重复写行。

**既有契约测试按新边界更新**（5 文件）：
- `domain_wiring_commerce_write_contract.test.js`：write 导入解构改为 `insertRfqRow/commitQuote/commitOrder`；器级 insert 不再被 sales_crm 导入。
- `domain_wiring_commerce_action_request_contract.test.js`：改为断言 sales_crm 不再直接导入 action_request（幂等生命周期仅经 write.js 服务）。
- `domain_wiring_commerce_recycle_contract.test.js`：rules 导入解构仅剩 `advanceStage`；校验注入调用点断言移入 write.js 源码。
- `state_write_commerce_contract.test.js` / `collaboration_write_commerce_contract.test.js`：函数切片内不再要求含 `applyAccountStatePatch`/`applyAccountPlanPatch`（网关调用已下沉），改为断言不含。
- `state_write_stage_precondition_guard_contract.test.js`：守卫调用点断言移至 write.js（`assertQuoteTransition(account, { conflictError })` 等），sales_crm 切片断言为不含守卫。

## 测试证据

- 新/更新契约 + 阶段 D commerce 与阶段 B state/plan/precondition 相关：49/49 commerce 回归 + 15/15 stage guard 组全绿。
- `node --test` 全量 `1975/1975`（较上轮 +5，来自新 commit 契约）；`npm test` 核心 `1614/1614`（+15）。
- `git diff --check` 通过；lint 无错误；工作区干净（提交后）。
- `sales_crm.js` 行数 `13001 → 12883`（-118）；`lib/domains/commerce/write.js` 增至 221 行（含服务与既有行写）。

## 提交

- `b4cfdfc` refactor(commerce): extract quote/order commit orchestration as place-level services

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 D 商业闭环的 addQuote/addOrder 编排已完整下沉；`recordActivity` 的 rfq 分支行写此前已下沉。后续可选：manager intervention 与 deferred plan 为**独立用例**（不在本环节文案内）；或转入阶段 D 线索/任务部分（intake/assignment/planning 已有域模块）。
3. 全量绿灯，可评估进入阶段 E（前端 widget 注册表）或阶段 G（兼容层收尾）的准备动作。