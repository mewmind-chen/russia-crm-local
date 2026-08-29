# Session Checkpoint：阶段 D-2d 创建与编辑状态写入校验

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`e0d6bfe` / `pilot/lifecycle-state-writes-v3`

## 本次范围

继续阶段 D 第二刀，将客户创建与资料编辑的主状态写入接入统一生命周期写入器；保持既有主档字段、协作字段、权限、幂等、审计、schema、trigger 与 AI 不变。

## 新增能力

- `state_write.js` 新增 `buildAccountInsertState()`，为创建路径统一校验并规范化 `stage`、`lifecycle_status`、`assignment_status`、`owner_id`。

## 迁移内容

- 每日未开发线索领取创建：`stage`/`assignment_status`/`owner_id` 经创建状态校验写入。
- 手动新增客户（`POST /api/sales-crm/accounts`）：初始 `stage`、`assignment_status`（claimed/unassigned）、`owner_id` 经创建状态校验写入。
- 旧跟进复核迁移创建：`stage`/`assignment_status`/`lifecycle_status`/`owner_id` 显式写入且经校验。
- 资料编辑（`PATCH /api/sales-crm/accounts/:customerId`）：`stage` 与 owner/assignment 联动改由 `applyAccountStatePatch()` 写入；`next_action`、`manager_status`、主档字段仍走原路径。

## 测试

- `test/lifecycle_state_write.test.js` 新增：创建状态规范化/拒绝、手动创建带负责人（claimed）、无负责人（unassigned）、资料编辑 stage 与 owner 联动、非法 stage 不落库。
- 专项（领取/资料/迁移/报价订单）：25/25 通过。
- 全量 `node --test`：1402/1402 通过。
- `git diff --check`：通过；linter 无错误。

## 提交与回滚

- 提交：`e25f1ad refactor(lifecycle): validate creation and edit state writes`
- Tag：`pilot/lifecycle-state-writes-v4`
- 工作区 clean，未 push。

## 未完成

- 其余活动/经理流程、直接 SQL 写入路径尚未全部迁移。
- `manager_status`、`next_action` 保持独立协作/计划投影。
- 下一刀建议：盘点剩余的 stage/assignment 直接写入，评估是否收口为 reducer 并补充跨表一致性断言。
