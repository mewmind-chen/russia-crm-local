# Session Checkpoint：阶段 D-6 漏斗页共享状态投影

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`d483bb8` / `pilot/lifecycle-alert-projection-v1`

## 本次范围

让漏斗页（pipeline 列表 `/api/sales-crm/lists/pipeline`）的每一行与客户列表、bootstrap、资料页共享统一状态 DTO。

## 迁移内容

- `publicPipelineActionRow` 合并 `projectAccountState(row)`，在保留全部旧字段（stage/owner 等）的同时新增 `state` 及顶层投影字段。
- `state.stage` 等派生解释与列表/bootstrap/profile 完全同源。

## 说明

- 团队状态（`team_status.js`）是事件窗口聚合视图，不直接以账户状态字段解释行，未附加投影。
- 统计 summary（`isActivePipelineStage`/`hasReachedStage`）本已使用 `customer_stages` 共享函数，无需改动。

## 验证

- 漏斗/业务列表/今日待办/投影专项：28/28 通过。
- 全量 `node --test`：1412/1412 通过。
- `git diff --check`：通过；linter 无错误。

## 提交与回滚

- 提交：`9c84ead refactor(lifecycle): attach state projection to pipeline rows`
- Tag：`pilot/lifecycle-pipeline-projection-v1`
- 工作区 clean，未 push。

## 现状

读取侧（列表、bootstrap、资料、告警、漏斗）已全部共享 `state_projection.js`；写入侧（主状态、协作/计划、重建工具）已全部统一。`lib/ai_stations/**` 未触碰。下一步建议进入阶段 E：前端按 `state` DTO 消费统一投影（字段投影收口）。
