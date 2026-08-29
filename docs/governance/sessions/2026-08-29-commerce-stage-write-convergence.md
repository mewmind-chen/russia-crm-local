# Session Checkpoint：阶段 B 商务 stage 写收敛

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`f9daa00` → 本轮业务提交 `03d3e91`

## 目的与范围

承接上一轮：把 `addQuote`/`addOrder` 的站 stage/updated_at **写入**从裸 `UPDATE crm_accounts SET stage=...` 收敛到 `lib/domains/lifecycle/state_write` 网关（上一轮 `a783c8c` 只加了 stage 前置校验）。沿用 STATE_TRANSITION_CONTRACT §1 完成门与 §5 切片规则。

## 改动

- `lib/sales_crm.js`：
  - `addQuote`：把 `UPDATE crm_accounts SET stage='quoted',...,updated_at=?` 拆为「`applyAccountStatePatch(value, account.id, { stage:'quoted', updatedAt })`」+「直写 `last_activity_at`/`next_action`/`next_action_at`/`next_action_time_basis`」。
  - `addOrder`：同上，`stage=repeat?'repeat':'won'` 与 `updated_at` 走网关，`last_activity_at`/`next_action*` 直写保持不变。
  - `next_action*` 与 `last_activity_at` 属计划/活动字段，不在本轮 state_write 收敛范围（下一切片走 `collaboration_write`），故保留直写。
  - 未触碰 `crm_intake_items` 同步触发器与任何 AI 触发点。
- 新增 `test/state_write_commerce_contract.test.js`（5 断言）：结构化断言（addQuote/addOrder 不得裸写 stage/lifecycle/assignment/owner/updated_at 且必须含网关）+ 行为断言（报价/首单/复购后整行字段完好：stage 推进 + last_activity_at 精确透传 + next_action 文本 + time_basis=utc + next_action_at 保留）。

## 测试证据

- 契约测试 `state_write_commerce_contract` 5/5。
- 相关专项（a3_05/a3_06/issue171/stage/reject/return/issue137）27/27。
- `node --test` 全量 `1857/1857`（基线 1852 + 本轮 5）；`npm test` core `1497/1497`。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `03d3e91` refactor(state): route addQuote/addOrder stage writes through the lifecycle gateway

## 风险与回滚

- 单提交可 `git revert 03d3e91` 回滚；回退后 stage 写回到裸 UPDATE（仍在 WIP 内联态，尚未构成契约完成门之外的偏差）。
- `next_action*`/`last_activity_at` 仍直写是明确保留的下一切片，非本次回归。
- 未 push、未合并、未部署；未触碰 AI 内容；未创建新 runtime；未改生产数据。

## 下一步最小动作

1. 单独提交治理文档 checkpoint。
2. 阶段 B：把 `addQuote`/`addOrder`（及 `addActivity`/AI next_action 等）的 `next_action*`/`last_activity_at` 直写收敛到 `collaboration_write` 计划网关。
3. 按接线清单重新接入被 WIP 回退的 domain 模块，优先经 lifecycle 网关。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。