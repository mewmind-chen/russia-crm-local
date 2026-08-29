# Session Checkpoint：阶段 B 商务计划写收敛

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`9ea9824` → 本轮业务提交 `624ceae`

## 目的与范围

承接上一轮（`03d3e91` 收敛了 quote/order 的 stage/updated_at）：本轮把 `addQuote`/`addOrder` 的 `next_action`/`next_action_at`/`next_action_time_basis`/`updated_at` 直写收敛到 `lib/domains/lifecycle/collaboration_write` 的 `applyAccountPlanPatch`（`PLAN_TIME_BASIS`）。执行 STATE_TRANSITION_CONTRACT §1 完成门与 §5 切片规则。

## 改动

- `lib/sales_crm.js`：
  - 引入 `const { applyAccountPlanPatch, PLAN_TIME_BASIS } = require('./domains/lifecycle/collaboration_write');`（与 `state_write` import 相邻）。
  - `addQuote`：把 `UPDATE crm_accounts SET ...next_action='报价后跟进',next_action_at=?,next_action_time_basis='utc'` 改为 `applyAccountPlanPatch(value, account.id, { nextAction:'报价后跟进', nextActionAt: nextFollowAt, timeBasis: PLAN_TIME_BASIS, updatedAt })`；直写收窄为 `UPDATE crm_accounts SET last_activity_at=?`。
  - `addOrder`：同理，`nextAction: repeat ? '维护复购关系' : '首单交付与复购培育'`、`nextActionAt`、`timeBasis: PLAN_TIME_BASIS`、`updatedAt`；直写收窄为 `last_activity_at=?`。
  - `last_activity_at` 是活动时间戳，不在契约网关列，保留直写。
  - `recordExplicitPlanIfEnabled` 未改动：它只写延迟计划事件表（`crm_deferred_plan_events`），从不写 `crm_accounts.next_action`，与本次收敛无冲突。
  - 未触碰 `crm_intake_items` 同步触发器与任何 AI 触发点。
- 新增 `test/collaboration_write_commerce_contract.test.js`（4 断言）：结构化断言（addQuote/addOrder 不得裸写 `next_action*`/`updated_at` 且必须含 `applyAccountPlanPatch`）+ 行为断言（报价/首单后整行计划字段完好：next_action 文本、time_basis=utc、next_action_at/updated_at 保留、last_activity_at 精确透传）。

## 测试证据

- 契约测试 `collaboration_write_commerce_contract` 4/4；`state_write_commerce_contract` 5/5（合计 9/9）。
- 相关专项（a3_05/a3_06/issue171/reject/return/stage/issue137/issue209）29/29。
- `node --test` 全量 `1861/1861`（基线 1857 + 本轮 4）；`npm test` core `1501/1501`。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `624ceae` refactor(state): route addQuote/addOrder next-action writes through the plan gateway

## 风险与回滚

- 单提交可 `git revert 624ceae` 回滚；回退后计划写回到裸 UPDATE。
- `last_activity_at` 与 `addActivity`/AI `next_action` 直写是明确保留的后续切片，非本次回归。
- 未 push、未合并、未部署；未触碰 AI 内容；未创建新 runtime；未改生产数据。

## 下一步最小动作

1. 单独提交治理文档 checkpoint。
2. 阶段 B：把 `addActivity`、`createClaimedAccount` 默认计划、AI `next_action` 等剩余直写收敛到 `collaboration_write` 计划网关。
3. 按接线清单重新接入被 WIP 回退的 domain 模块，优先经 lifecycle 网关。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。