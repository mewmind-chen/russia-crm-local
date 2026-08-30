# Session Checkpoint：阶段 B §4.1/§4.2 状态契约不变量守卫

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`0ae90af` → `9186a6d`

## 本轮切片

### `9186a6d` 状态契约不变量守卫（§4.1/§4.2）
- `lib/domains/lifecycle/state_write.js` 新增导出 `assertAccountStateContract(state)`：
  - §4.1：`recycled` 不允许配合 `claimed`/`assigned` 分配状态
  - §4.2：`returned` 不允许绑定非空 owner
  - 兼容 `lifecycle_status`/`lifecycleStatus`、`assignment_status`/`assignmentStatus`、`owner_id`/`ownerId` 两种字段命名
- **关键设计决策**：`buildAccountStatePatch` 刻意保持 `lifecycle` 与 `assignment` 为**独立维度**（既有契约测试 `lifecycle_state_write.test.js` 明确锁定 `recycled + claimed` 是 shim 层的合法中间态，pairing 由回收/返回调用点负责）。因此守卫**不在 shim 内强制调用**，只作为可复用规则导出，供需要校验完整状态视图的调用点/解释器显式使用。
- 契约测试：`test/state_write_invariant_contract.test.js`（4 断言）：
  - 守卫拒绝 `recycled + claimed/assigned`（2 例）
  - 守卫允许 `recycled + returned/unassigned`（2 例）
  - 守卫拒绝 `returned + 非空 owner`
  - shim 保持独立维度（`recycled + claimed + owner` 合法）

## 一个中途修正（重要）

第一版把 §4.1 校验直接加进 `buildAccountStatePatch`（在同一 patch 调用内拦截），导致全量出现 1 个失败：

- `test/lifecycle_state_write.test.js:229`「recycled lifecycle write keeps the returned assignment boundary intact」明确断言 `buildAccountStatePatch({ lifecycleStatus:'recycled', assignmentStatus:'claimed', ownerId:'U-1' })` 返回合法 patch。

这暴露了契约的真实语义：**write shim 不跨维度校验组合，配对由调用点负责**。于是把守卫从 shim 内强制改为独立导出的 `assertAccountStateContract(state)`，回退 shim 改动，契约测试改为测守卫本身 + 显式锁定"shim 独立维度"。这正是按 STATE_TRANSITION_CONTRACT §4"契约测试锁定不变量"的精神——守卫作为规则载体，不改变写 shim 的既有行为。

## 测试证据

- 守卫契约 4/4；原 `lifecycle_state_write` 14/14、recycle/reject/return 8/8 全绿。
- `node --test` 全量 `1918/1918`；`npm test` core `1557/1557`。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `9186a6d` refactor(domains): add state-contract invariants guard to the lifecycle gateway

## 风险与回滚

- 守卫为新导出、仅在测试中显式调用；shim 行为零变化（独立维度语义由 `lifecycle_state_write.test.js` 锁定）。可独立 `git revert`。
- 未 push/未合并/未部署；未触碰 AI 内容与 intake 触发器。

## 下一步最小动作

1. 跟随 `0ae90af`/`9186a6d` 提交治理文档 checkpoint（CURRENT_STATE、REFACTOR_ROADMAP、session、看板）。
2. 阶段 B §4 强化续：将 `assertAccountStateContract` 接入需要完整视图校验的调用点（如回收/恢复路径的序号构建 helper），或补充状态解释器统一消费。
3. §4.3「next_action 有值必配 time_basis」（契约测试已锁定）与 §4.5 的 AI next_action 写点、`last_activity_at` 归属。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。