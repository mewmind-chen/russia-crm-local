# Session Checkpoint：阶段 D-3b 活动推进协作字段迁移

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`bea0270` / `pilot/lifecycle-collaboration-writes-v1`

## 本次范围

迁移活动推进（`recordActivity`）中最后保留的条件式协作字段写入，使活动产生的计划与经理状态更新统一走 `collaboration_write.js`。

## 迁移内容

- 活动推进中原来的 `CASE WHEN ?=1 THEN ... ELSE 保留` 合并 UPDATE 拆为：
  - `applyAccountPlanPatch()`：写入下一步动作/时间/时区（经理要求时保留原计划，否则写新计划，终止阶段清空）。
  - `applyManagerStatusPatch()`：仅在经理要求时写入 `manager_required=1` + `manager_status='待介入'`。
  - `last_activity_at` 单独更新。
- 语义与原 SQL 完全等价（非经理要求时不动经理字段）。

## 验证

- 活动推进/经理协助/计划/今日待办/无计划专项：62/62 通过。
- 全量 `node --test`：1411/1411 通过。
- `git diff --check`：通过；linter 无错误。

## 提交与回滚

- 提交：`0d3da53 refactor(lifecycle): route activity collaboration writes through shim`
- Tag：`pilot/lifecycle-collaboration-writes-v2`
- 工作区 clean，未 push。

## 未完成

- 资料编辑（`updateAccount`）动态字段中的计划字段仍保留原位，风险较高未迁移。
- `crm_account_rebuild.js` 是独立状态重建工具，含 `rebuildAccountDerivedState` reducer 雏形，未迁移。
- `lib/ai_stations/**` 完全未触碰。
