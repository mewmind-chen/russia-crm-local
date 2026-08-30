# Session Checkpoint：阶段 B §4.4 强化（buildTeamReport 收敛到 state_projection）

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`754d023` → `c4bba3f`

## 本轮切片

### `c4bba3f` buildTeamReport 的 planned/overdue 消费 projectNextAction 投影
- `lib/domains/reporting/builders.js`：
  - `buildTeamReport` 此前自行推导 `planned = row.next_action && row.next_action_at`（自读裸列，未含 time_basis）、`overdue = new Date(row.next_action_at) < Date.now()`。
  - 收敛为 `activeOwned.map(row => projectNextAction(row))` 后按 `.planned` / `.overdue` 计数（跨域依赖 `../lifecycle/state_projection`，与既有 `../auth/user` 依赖同型）。
  - 语义变化面：`planned` 现在只计 text+time+basis 齐全的行（§4.3），`overdue` 经投影时间判定——生产写点一律 `PLAN_TIME_BASIS='utc'`，因此生产正常行行为不变。
- 契约测试：`test/report_builders_projection_contract.test.js`（2 断言）：
  - 静态：`buildTeamReport` 不再 `new Date(String(row.next_action_at))` 自解析、import 已含 `state_projection`、函数体用 `projectNextAction`。
  - 行为：无 basis 行不计入 planned（红态 expect 3 → 收敛后 2）；时间已过的行计入 overdue（1）。

## 背景与语义

契约 §4.4：「报告/导出/告警统一消费 state_projection」。`buildAlerts`（`754d023`）与 `buildTeamReport`（`c4bba3f`）两处读路径先后从自读裸列改为消费 `projectNextAction`，消除与 §4.3 time_basis 语义的发散。剩余裸列读取点：`pipelineActionKeys`（pipeline 行内部键投影，`business_page_filters.js`，为 pipe 行 DTO 边界），与 `assertAccountStateContract` 接入回收/恢复路径。

## 测试证据

- 新契约 2/2；`report_files` + `issue174_team_status_*` + `issue323` + `domain_wiring_reporting_contract` 合计 39/39。
- `node --test` 全量 `1926/1926`；`npm test` core `1565/1565`。
- `git diff --check` 通过；lint 无错误；工作区干净。
- `sales_crm.js` 行数不变（12,969）；`reporting/builders.js` 变动一处。

## 提交

- `c4bba3f` refactor(reporting): drive buildTeamReport planned/overdue from state projection

## 风险与回滚

- 行为变化面：`scores.execution` 中 `planned` 分母口径从"有文本+时间"收紧为"文本+时间+basis"，仅影响缺 basis 的非生产一致行（生产写点恒带 basis）。
- 可独立 `git revert`；未 push/未合并/未部署；未触碰 AI 内容与 intake 触发器。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 B §4 强化续：
   - §4.4 剩余：`pipelineActionKeys` 裸列读取评估（eval 是否收敛到 `projectNextAction`）。
   - 将 `assertAccountStateContract` 接入回收/恢复路径的完整视图校验。
3. AI next_action 写点与测试专用种子收敛（受红线约束）、明确 `last_activity_at` 归属。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。