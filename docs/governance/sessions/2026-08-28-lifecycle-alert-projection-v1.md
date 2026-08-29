# Session Checkpoint：阶段 D-5 告警共享投影解释

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`2245032` / `pilot/lifecycle-rebuild-alignment-v1`

## 本次范围

让告警（`buildAlerts`，即今日待办/工作台告警）的客户状态解释与列表、bootstrap、资料页共享同一投影解释器，实现“同一客户在各页面解释一致”。

## 迁移内容

- 引入 `projectAssignmentState`、`projectManagerState`、`projectNextAction`。
- `UNCLAIMED`：`assignmentProjection.key === 'assigned'`。
- `NO_NEXT`/`NO_NEXT_DEFERRED`：`nextProjection.planned`。
- `OVERDUE`：`nextProjection.overdue`（沿用同款 UTC 时间解析）。
- `MANAGER_NEEDED`/`MANAGER_REPLIED`：`managerProjection.required/status`。
- `POST_MANAGER_IDLE`：`managerProjection.status === '已介入'`。
- `INTAKE_IDLE` 保留原字段判断，避免空 `assignment_status` 归一化为 `claimed` 导致的行为差异。

## 语义保证

每个告警触发条件与原实现严格等价（投影字段只承载解释，不改触发语义）；`OVERDUE` 的超时小时数仍由原解析计算。

## 验证

- 今日待办/经理协助/延期计划/无计划专项：38/38 通过。
- 全量 `node --test`：1411/1411 通过。
- `git diff --check`：通过；linter 无错误。

## 提交与回滚

- 提交：`d483bb8 refactor(lifecycle): share projection in alert interpretation`
- Tag：`pilot/lifecycle-alert-projection-v1`
- 工作区 clean，未 push。

## 现状

列表、bootstrap、资料、告警四类读取场景均已共享 `state_projection.js` 解释。`lib/ai_stations/**` 未触碰。
