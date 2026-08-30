# Session Checkpoint：阶段 B §4.4 强化（buildAlerts 收敛到 state_projection）

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`cb6c6e4` → `754d023`

## 本轮切片

### `754d023` buildAlerts 告警路径消费 projectNextAction 投影
- `lib/sales_crm.js`：
  - `buildAlerts` 的 NO_NEXT/OVERDUE 判定从自读裸列（`!account.next_action || !account.next_action_at`、`account.next_action_at` 直接比较）改为消费 `lib/domains/lifecycle/state_projection` 的 `projectNextAction(account)`（planned/overdue）。
  - 语义变化面（契约 §4.3 要求的统一）：缺 `next_action_time_basis` 的行此前被误判为"有计划"，现在按"未计划"新增 NO_NEXT 告警。
- 契约测试：`test/state_projection_alerts_contract.test.js`（3 断言）：
  - 静态：`buildAlerts` 不再自读 `next_action_at` 裸列做判定、import 已含 `projectNextAction`。
  - 行为：文本+时间+time_basis 齐全 → 有计划不触发 NO_NEXT；缺 basis → 未计划触发 NO_NEXT。

### 同步修正 `test/issue225_today_filter_chinese.test.js`
- `seedOverdueLead` 此前裸写 `next_action` + `next_action_at` 但**漏写 `next_action_time_basis`**，与生产写点（一律 `PLAN_TIME_BASIS='utc'`）不一致。§4.3 新语义下该种子客户被判"未计划"多出一条 NO_NEXT 告警，破坏 due_status facet 计数断言。补上 `next_action_time_basis` 使种子与生产语义一致。

## 背景与语义

契约 §4.4：「报告/导出/告警统一消费 state_projection」。审计发现 `buildAlerts` 是首个缺口——它自读裸列、未消费投影，因此在 §4.3 收紧后（缺 basis → 非 planned）漏判告警。pipeline 行（`business_page_filters.js`）此前已消费 `projectNextAction`（`publicPipelineActionRow`），本轮把告警路径对齐。剩余裸列读取点：`pipelineActionKeys`（pipeline 行内部键投影，`business_page_filters.js`）与报告/导出路径，留待后续切片评估。

## 测试证据

- 新契约 3/3；既有 `state_projection_time_basis_contract` 3/3、`lifecycle_state_projection` 22/22 保持。
- 告警相关回归 30/30；`issue225` 种子修复后全量通过。
- `node --test` 全量 `1924/1924`；`npm test` core `1563/1563`。
- `git diff --check` 通过；lint 无错误；工作区干净。
- `sales_crm.js` 12,969 行（+2：import 一行 + buildAlerts 拆分一行）。

## 提交

- `754d023` refactor(lifecycle): converge buildAlerts onto projectNextAction projection

## 风险与回滚

- 行为变化面：任何"有文本+时间但缺 basis"的活跃客户会新增 NO_NEXT 告警（契约要求）。全量回归确认仅 `issue225` 种子受影响（已修种子），生产写点一律带 basis。
- 可独立 `git revert`；未 push/未合并/未部署；未触碰 AI 内容与 intake 触发器。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 B §4 强化续：
   - §4.4 剩余：报告/导出路径的状态读取审计与 `pipelineActionKeys` 裸列读取评估。
   - 将 `assertAccountStateContract` 接入回收/恢复路径的完整视图校验。
3. AI next_action 写点与测试专用种子收敛（受红线约束）、明确 `last_activity_at` 归属。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。
