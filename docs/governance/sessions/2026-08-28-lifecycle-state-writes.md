# Session Checkpoint：阶段 D-2 状态写入兼容 shim

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：阶段 D-1 状态投影提交 `c07aa6b`

## 需求与范围

进入阶段 D 第二刀，先集中状态写入入口，不改数据库 schema、SQLite trigger、API 错误码、权限边界或 AI 逻辑。

## 本次修改

- 新增 `lib/domains/lifecycle/state_write.js`。
- `buildAccountStatePatch()` 校验并规范化 `stage`、`lifecycleStatus`、`assignmentStatus`、`ownerId`、`updatedAt`。
- `applyAccountStatePatch()` 支持单 SQL 更新和可选的乐观状态条件。
- 迁移超时待办的重新分配/退回，以及正式客户退回路径的账户状态更新。
- 保留原有 intake 明细更新、回收字段清理、审计、错误码和外层事务。

## 明确未迁移

客户创建、领取、普通分配、重分配、活动推进、报价、订单、经理介入、下一步计划等其他写入点仍保留原路径，作为后续切片。

`manager_status` 和 `next_action` 继续作为独立协作/计划字段，不纳入客户主状态 patch。

## 验证

- `node --test --test-reporter spec test/lifecycle_state_write.test.js`：4/4 通过。
- 相关状态/回收/今日待办回归：通过。
- `npm test`：1395/1395 通过。
- `git diff --check`：通过。
- linter：无错误。

## 风险与回滚

- 代码修改仅在隔离 worktree；没有修改生产数据库。
- 保留原外层事务和 SQL 更新顺序。
- 回滚点为本次提交；tag：`pilot/lifecycle-state-writes-v1`。

## 下一步

盘点并迁移客户创建/领取、普通分配和活动推进中剩余的 `stage`、`assignment_status`、`lifecycle_status` 写入；每个动作继续保留原权限、幂等和审计契约。
