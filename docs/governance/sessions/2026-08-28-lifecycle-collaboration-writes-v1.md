# Session Checkpoint：阶段 D-3 协作/计划写入隔离

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`d9a625b` / `pilot/lifecycle-state-writes-v5`

## 本次范围

按既定原则，`manager_status` 与 `next_action` 保持为独立协作/计划投影，不并入客户主状态。本次为这些字段建立独立写入辅助，并迁移低风险、边界清晰的纯写入点。

## 新增模块

- `lib/domains/lifecycle/collaboration_write.js`
  - `applyAccountPlanPatch()`：仅写 `next_action`、`next_action_at`、`next_action_time_basis`、`updated_at`。
  - `applyManagerStatusPatch()`：仅写 `manager_required`、`manager_status`、`manager_id`、`updated_at`。
  - 与 `state_write.js`（stage/lifecycle/assignment/owner）完全解耦。

## 迁移内容

- 领取创建后的“完成首次触达”计划写入。
- 延期计划清除。
- 经理任务计划写入与终止阶段清空计划。
- 今日待办添加计划、经理协助回执（计划 + 经理状态）。
- 经理回复、经理介入状态写入。
- 活动 `lost` 清空计划。
- `plan_only` 计划保存。

未迁移（保持原位）：活动推进中的条件式 `manager_required/manager_status`（`CASE WHEN`）与资料编辑动态字段里的计划字段，风险高且非纯协作写入。

## 测试

- 新增 `test/lifecycle_collaboration_write.test.js`：6 项（patch 规范化、计划/经理字段互不干扰、清空计划不丢负责人）。
- 经理任务/计划/今日待办/无计划专项：49/49 通过。
- 全量 `node --test`：1411/1411 通过。
- `git diff --check`：通过；linter 无错误。

## 提交与回滚

- 提交：`bea0270 refactor(lifecycle): isolate plan and manager collaboration writes`
- Tag：`pilot/lifecycle-collaboration-writes-v1`
- 工作区 clean，未 push。

## 下一步

- 可继续迁移活动推进与资料编辑中的条件式协作字段，或进入状态 reducer 真源统一。
- `manager_status`、`next_action` 继续独立投影，不强行合并进客户主状态。
