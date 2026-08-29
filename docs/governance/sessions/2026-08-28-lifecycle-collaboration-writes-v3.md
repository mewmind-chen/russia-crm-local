# Session Checkpoint：阶段 D-3c 资料编辑计划字段迁移

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`0d3da53` / `pilot/lifecycle-collaboration-writes-v2`

## 本次范围

迁移 `updateAccount`（资料编辑 `PATCH /api/sales-crm/accounts/:customerId`）动态字段列表中最后保留的计划字段，使资料编辑的计划写入也统一走协作写入器。

## 迁移内容

- 从动态字段 `allowed` 映射中移除 `nextAction`、`nextActionAt`。
- 构造 `planPatch`：
  - 终止阶段（lost/disqualified）：清空计划。
  - 触及计划：写入规范化后的 `nextAction`、`nextActionAt`、`timeBasis`。
  - 未触及：不写。
- 事务内通过 `applyAccountPlanPatch()` 写入，与 stage/owner patch 共用同一 `stateUpdatedAt`。
- 提前返回判断加入 `planPatch`，避免仅改计划时提前返回。
- 保留 `planChanged` 审计与原有校验。

## 行为说明

- 原动态更新在值未变化时也会写回相同值；拆分后通过协作写入器同样写最终值，数据结果一致。
- 原 `payload.nextActionAt === undefined` 且值变化分支实际为恒等（计算值与库值相同），已并入统一写入，无行为差异。

## 验证

- 资料编辑/计划/阶段写入专项：50/50 通过。
- 全量 `node --test`：1411/1411 通过。
- `git diff --check`：通过；linter 无错误。

## 提交与回滚

- 提交：`2f2ea43 refactor(lifecycle): route profile edit plan writes through shim`
- Tag：`pilot/lifecycle-collaboration-writes-v3`
- 工作区 clean，未 push。

## 现状

`sales_crm.js` 中计划与经理协作字段写入已全部通过 `collaboration_write.js`；`crm_account_rebuild.js` 是独立重建工具未迁移；`lib/ai_stations/**` 未触碰。
