# Session Checkpoint：阶段 B §4.4 加固（pipelineActionKeys 收敛到投影）

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`c4bba3f` → `fe77fb4`

## 本轮切片

### `fe77fb4` pipelineActionKeys 的 due_followup / manager_assistance 消费投影
- `lib/business_page_filters.js`：
  - `due_followup`（此前裸比较 `row.next_action_at && String(row.next_action_at) <= nowText`）改为 `projectNextAction(row).overdue && !terminal(stage)`。
  - `manager_assistance`（此前裸比较 `row.manager_required && row.manager_status !== '已完成'`）改为 `projectManagerState(row)` 的 `required && status !== '已完成'`。
  - 两函数失效的 `nowText` 参数移除：`pipelineActionKeys(row)` / `publicPipelineActionRow(row)` 及其调用点（`nowText` 唯一消费方已被投影取代）。
  - `inquiry_no_order`/`order_growth` 属商业计数（rfq_count/order_count），非 lifecycle 状态，保持裸读。
- 契约测试：`test/pipeline_key_projection_contract.test.js`（1 结构断言）：
  - import 含 `projectNextAction`/`projectManagerState`；`pipelineActionKeys` 函数体使用二者；不得再出现 `String(row.next_action_at) <= nowText` 或 `row.manager_status !==`。

## 背景与语义

契约 §4.4：读路径统一消费 state_projection。`pipelineActionKeys` 属 pipeline 行的动作键信号（告警式），此前 self 推导 next-action 过期与主管待介入，与投影语义发散。收敛后 align §4.3（overdue 经投影 time 判定）与主管状态归一（`projectManagerState` 将 required 且无 status 归一 '待介入'，语义与裸比较一致）。`publicPipelineActionRow` 本已对同一行调用 `projectAccountState`，本片消除重复的裸推导。

## 测试证据

- 新契约 1/1；pipeline/stars/投影/今日筛选/状态动作/客户规范化回归 102/102。
- `node --test` 全量 `1927/1927`；`npm test` core `1566/1566`。
- `git diff --check` 通过；lint 无错误；工作区干净。
- `sales_crm.js` 行数不变（12,969）；`business_page_filters.js` 净减 8 行（-参数与裸比较）。

## 提交

- `fe77fb4` refactor(pipeline): drive pipeline action keys from state projection

## 风险与回滚

- 行为变化面：`due_followup` 从字符串 `<= nowText` 改为投影 `timestamp < now`（边界时刻差异可忽略）；`manager_assistance` 主管状态经投影归一（required 且空态 → '待介入'，不影响 `!== '已完成'` 判定）。pipeline 动作键计算无测试直接锁定（既有 `lifecycle_state_projection`/`issue335`/`issue336` 仅断言白名单保留 actionQueueKeys 输入），故本片行为保持对生产正常行不变。
- 可独立 `git revert`；未 push/未合并/未部署；未触碰 AI 内容与 intake 触发器。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 B §4 强化续：§4.4 剩余——将 `assertAccountStateContract` 接入回收/恢复路径的完整视图校验。
3. AI next_action 写点与测试专用种子收敛（受红线约束）、明确 `last_activity_at` 归属。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。