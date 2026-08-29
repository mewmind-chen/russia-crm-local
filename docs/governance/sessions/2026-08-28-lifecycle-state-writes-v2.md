# Session Checkpoint：阶段 D-2b 核心状态写入迁移

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`c34761d` / `pilot/lifecycle-state-writes-v1`

## 本次范围

继续阶段 D 第二刀，将剩余高频、边界清晰的 CRM 状态更新接入既有 `state_write` shim；不改变外部 API、权限、幂等、审计、schema、trigger 或 AI。

## 迁移内容

- 客户领取：`assignment_status='claimed'` 通过 `applyAccountStatePatch()` 写入。
- 经理任务重分配：`owner_id`、`assignment_status` 通过 shim 写入。
- 终止阶段任务：`stage='lost'` 通过 shim 写入。
- 活动推进：活动产生的 `stage` 投影通过 shim 写入。
- 计划字段、经理协作字段、活动时间线字段仍使用原有独立更新。

## 验证

- 生命周期/回收/今日待办/手工分配专项：19/19 通过。
- 全量 `node --test`：1395/1395 通过。
- `git diff --check`：通过。
- linter：无错误。

## 提交与回滚

- 提交：`f9e79b5 refactor(lifecycle): route core state transitions through shim`
- Tag：`pilot/lifecycle-state-writes-v2`
- 工作区 clean，未 push。

## 未完成

报价、订单、客户创建、普通批量分配、回收恢复中的其他字段更新，以及更多活动/经理流程仍待后续小切片迁移。`manager_status` 和 `next_action` 继续保持独立投影。
