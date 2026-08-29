# Session Checkpoint：阶段 B §1 完成门达成（活动/今日任务/回收写全量收敛）

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`6ad6756` → 本轮四个业务提交 `d5d7b68`、`8743912`、`531bc71`、`227b3d7`

## 目的与范围

承接 `624ceae`（quote/order 计划写收敛），把剩余 `crm_accounts` 状态/计划/主管裸写点全部收敛到 `lib/domains/lifecycle/` 网关，达成 STATE_TRANSITION_CONTRACT §1 完成门。四个切片，每片契约测试先行、独立提交。

## 本轮四个切片

### `d5d7b68` addActivity（活动记录主路径）
- 合并写拆为：`applyAccountStatePatch`(stage) + `applyAccountPlanPatch`(next_action*) + `applyManagerStatusPatch`(manager_required/status，仅 managerRequired 时) + 直写 `last_activity_at`。
- `manager_join` 分支 → manager 网关；`lost` 分支 → 计划清空（plan 网关）+ 直写 `loss_reason`。
- 新增共享助手 `test/helpers/lifecycle_gate_contract.js`（functionSlice + 三类列正则 + 网关调用断言）。

### `8743912` 今日任务/纯计划/主管回执
- `deferAccountPlan`/`addNextPlanTodayTask`/`planOnlyActivity` 的计划写 → `applyAccountPlanPatch`。
- `completeManagerAssistanceTodayTask` 的主管回复写 → `applyManagerStatusPatch`（last_activity_at 直写）。
- `confirmManagerAssistanceTodayTask` 计划+主管双写 → 两个网关。

### `531bc71` 领取/主管任务/超时线索/重分配
- `manageIntake` claim：assignment → state 网关，`完成首次触达` 计划 → plan 网关，`claimed_at` 直写；不可达的 return 分支以同条件守卫调用网关，保持"静默空操作"语义。
- `managerTaskChange` 三分支（plan_formed/terminal_stage/reassigned）→ 对应网关。
- `resolveOverdueLeadTodayTask` reassign/return_to_pool 账户写 → state 网关。
- `reassignReturnedCustomer` → state 网关。

### `227b3d7` 回收/恢复
- `createClaimedAccount` 恢复分支、`trashManualCustomer`、`restoreManualCustomer` → state 网关；回收专属字段（recycle_*、previous_owner_id、intake 关联字段）仍直写。
- 网关把空 owner 归一为 NULL，符合统一状态契约。

## 完成门证据

- `lib/` 全目录扫描：`crm_accounts` 的 `stage`/`lifecycle_status`/`assignment_status`/`owner_id`/`next_action*`/`manager_*`/`updated_at` 已无任何裸 `UPDATE crm_accounts SET ...` 直写；剩余直写仅 `last_activity_at`（活动时间戳）与回收专属字段（`recycle_*`/`previous_owner_id`/`loss_reason`/`return_reason`）。测试专用种子（`smoke_test_data.js`、`seedAccounts`）按契约 §2 不在范围。
- `sales_crm.js` 网关调用：`applyAccountStatePatch` 15、`applyAccountPlanPatch` 11、`applyManagerStatusPatch` 4。

## 测试证据

- 新增契约测试 4 文件 19 断言：activity 4/4、plan-points 6/6、claim-manager 5/5、recycle-restore 4/4；累计阶段 B 契约 8 文件 34/34。
- 相关专项：活动/主管 56/56；今日任务/延迟计划 65/65；领取/回收/重分配 58/58；回收/恢复 33/33。
- `node --test` 全量 `1881/1881`；`npm test` core `1520/1520`。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `d5d7b68` refactor(state): route addActivity account writes through the lifecycle gateways
- `8743912` refactor(state): route today-task and plan-only next-action writes through gateways
- `531bc71` refactor(state): route claim, manager-task, overdue-lead, and reassign writes through gateways
- `227b3d7` refactor(state): route recycle and restore account writes through the state gateway

## 风险与回滚

- 四个业务提交可分别 `git revert` 回滚；每片独立契约测试锁定行为。
- 行为保持：仅 `manageIntake` 不可达 return 分支与 `createClaimedAccount` 恢复分支的 owner 归一（''→NULL）属网关契约内语义统一，已由全量回归覆盖。
- 未 push、未合并、未部署；未触碰 AI 内容（`enqueueNextActionForEvent`/AI 写点未动）；未创建新 runtime；未改生产数据。

## 下一步最小动作

1. 单独提交治理文档 checkpoint。
2. 阶段 B 收尾：§4 强化（assert*Transition 全面落地）、AI next_action 写点与测试专用种子收敛、明确 `last_activity_at` 归属。
3. 按接线清单重新接入被 WIP 回退的 `lib/domains/` 模块，优先经 lifecycle 网关。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。