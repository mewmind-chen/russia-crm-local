# Session Checkpoint：阶段 B §4.3 强化（next_action time_basis 投影维度）

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`9186a6d` → `cb6c6e4`

## 本轮切片

### `cb6c6e4` projectNextAction 增加 time_basis 维度
- `lib/domains/lifecycle/state_projection.js`：
  - `projectNextAction` 增加 `next_action_time_basis` 检查——`next_action` 有值时，时间与 time_basis **两者都必须存在**才算 `planned`，缺任一标 `degraded`。
  - 实现：`complete = Boolean(textValue && atValue && basisValue)`；`planned = complete`；`degraded = Boolean(textValue && !complete)`。
- 契约测试：`test/state_projection_time_basis_contract.test.js`（3 断言）：
  - 有文本+时间但**无 basis** → degraded（此前误标 planned）
  - 文本+时间+basis 齐全 → planned
  - 空文本 → not planned / not degraded

## 背景与语义

契约 §4.3 原文：「`next_action` 有值时必配 `next_action_time_basis`（否则 degraded）」。此前 `projectNextAction` 只检查 `next_action_at`（degraded = 有文本无时间），未检查 time_basis 维度。本轮补齐使投影与契约一致。

注意：`buildPlanPatch` 刻意保持 plan 字段独立（既有契约 `lifecycle_collaboration_write.test.js` 允许 `nextAction` 无 timeBasis），因此本强化落在**投影侧**而非写 shim——与 §4.1 独立维度教训一致。

## 测试证据

- 新契约 3/3；既有 `lifecycle_state_projection` 22/22 保持。
- `node --test` 全量 `1921/1921`；`npm test` core `1560/1560`。
- `git diff --check` 通过；lint 无错误；工作区干净。
- `sales_crm.js` 行数不变（12,966）。

## 提交

- `cb6c6e4` refactor(domains): enforce time-basis dimension in next-action projection

## 风险与回滚

- 行为变化面：任何"有文本+时间但缺 basis"的行会从 planned 变为 degraded（契约要求），已由全量回归确认无消费方回退。
- 可独立 `git revert`；未 push/未合并/未部署；未触碰 AI 内容与 intake 触发器。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 B §4 强化续：
   - §4.4「报告/导出/告警统一消费 state_projection」：审计这些路径是否仍读裸列。
   - 将 `assertAccountStateContract` 接入回收/恢复路径的完整视图校验。
3. AI next_action 写点与测试专用种子收敛（受红线约束）、明确 `last_activity_at` 归属。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。
