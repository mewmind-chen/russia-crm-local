# Session Checkpoint：阶段 B §4 收尾——回收/恢复路径完整视图守卫接线

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`6b88d74` → `da34bc2`

## 本轮切片

### `da34bc2` assertAccountStateContract 接入回收/恢复写点
`assertAccountStateContract`（§4.1 recycled 不配 claimed/assigned、§4.2 returned 不绑 owner）此前仅在 `state_write` 域模块内作为可复用规则导出，未被任何调用点显式使用。本轮接入三个**产生完整状态视图**的写点：

- `rejectCrmCustomer`：落库前断言合并目标视图 `{ ...account, lifecycle_status:'recycled', assignment_status:'returned', owner_id:null }`。
- `trashManualCustomer`：同样断言 recycled+returned+owner null。
- `restoreManualCustomer`：断言 `{ ...account, lifecycle_status:'active', assignment_status: ownerId?'claimed':'unassigned', owner_id:ownerId }`。

设计要点：
- 校验的是**合并后的完整视图**（当前行 + 意图覆盖），而非 patch 增量——若未来编辑漏覆盖某一维（如只写 recycled 不写 returned、或 returned 带上 owner），守卫立即在事务内抛错回滚，阻止不一致状态落库。
- 守卫在今日正确 patch 上不可达（自证性防御），锁定的是 shim 刻意留给调用点的"配对职责"。
- 守卫抛普通 `Error`（编程不变量语义，非用户错误）；正确代码下不可达，无需转 HttpError。

- 契约测试：`test/state_write_recycle_restore_invariant_contract.test.js`（4 结构 + 1 行为）：
  - 结构：import 含守卫；三个写点函数体均调用守卫且目标视图字段（snake_case）正确。
  - 行为：trash→restore 全周期在守卫接线下仍绿（recycled+returned+null → active+unassigned+null，因 U-WU 为 manager 无 sales 恢复归属）。

## 背景

§4 契约列表至本轮全部落地：前置校验守卫（`0ae90af`）、状态契约不变量（`9186a6d`）、time_basis 投影（`cb6c6e4`）、读路径投影消费（`754d023`/`c4bba3f`/`fe77fb4`）、边界收敛（`6b88d74`）、本轮的完整视图守卫接线。阶段 B §4 强化**完成**。

## 测试证据

- 新契约 5/5；回收/恢复/不变量/ownerless/手工返回/退回线索/回收站 UI 回归 42/42。
- `node --test` 全量 `1941/1941`；`npm test` core `1580/1580`。
- `git diff --check` 通过；lint 无错误；`node -e require` 加载正常；工作区干净。
- `sales_crm.js` 13,002 行（+18：三处守卫调用 + import）。

## 提交

- `da34bc2` refactor(state): assert state contract on merged views in recycle/restore paths

## 风险与回滚

- 行为变化面：仅新增不可达的防御性校验（正确路径零行为差异）；trash/restore 周期回归确认。
- 可独立 `git revert`；未 push/未合并/未部署；未触碰 AI 内容与 intake 触发器。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 剩余项涉红线/评估：AI next_action 写点与测试种子收敛（仅评估不改）；`last_activity_at` 归属已明确为活动溯源；状态解释器统一消费（前端侧后续评估）。
3. 可选：转阶段 C（权限/筛选/字段）或评估已漂移模块继续减单体。