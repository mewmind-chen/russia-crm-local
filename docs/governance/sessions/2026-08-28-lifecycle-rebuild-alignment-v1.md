# Session Checkpoint：阶段 D-4 重建工具写入对齐

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`2f2ea43` / `pilot/lifecycle-collaboration-writes-v3`

## 本次范围

将独立状态重建工具 `lib/crm_account_rebuild.js` 的写库路径与统一生命周期写入器对齐，使重建产出的状态字段同样经过校验与规范化。

## 迁移内容

- `rebuildAccountDerivedState` 写库由单条动态 UPDATE 拆为：
  - `applyAccountStatePatch()` 写 `stage`（仅在 `isValidStage` 时）。
  - `applyAccountPlanPatch()` 写 `next_action`/`next_action_at`/`next_action_time_basis`（列存在时）。
  - `applyManagerStatusPatch()` 写 `manager_required`/`manager_status`/`manager_id`（列存在时）。
  - `last_activity_at` 单独更新。
- 保留 `tableColumns` 列防御、`changed` 判断、不主动开事务的契约。
- 调用方 `correctActivity` 已有外层事务，拆分后仍原子。

## 行为说明

- 非法/缺失 `stage` 不再回写（原行为会写回旧值），重建仅收敛为合法状态。
- `updated_at` 由各 writer 在列存在时统一写入同一时间戳。

## 验证

- 重建/活动更正/无计划/生命周期专项：31/31 通过。
- 全量 `node --test`：1411/1411 通过。
- `git diff --check`：通过；linter 无错误。

## 提交与回滚

- 提交：`2245032 refactor(lifecycle): align account rebuild writes with state writers`
- Tag：`pilot/lifecycle-rebuild-alignment-v1`
- 工作区 clean，未 push。

## 现状

客户主状态、协作/计划字段、重建工具的写库路径已全部统一到 `state_write.js` / `collaboration_write.js`。`lib/ai_stations/**` 未触碰。下一步建议：前端按 `state` DTO 消费统一投影（阶段 E 字段投影收口），或收尾 `manager_status`/`next_action` 独立投影的 reducer 语义。
