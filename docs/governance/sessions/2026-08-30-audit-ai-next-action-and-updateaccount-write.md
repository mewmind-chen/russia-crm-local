# Session Checkpoint：阶段 B 只读审计（AI next_action 写点 / last_activity_at 归属 / §1 门纠正）

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`fe77fb4`（读路径，治理已同步到 `4ba791f`）
性质：**只读审计，无业务代码改动**；仅治理文档 + 看板同步。

## 审计结论

### A. AI next_action 写点（红线，不改）
- 唯一 AI 计划写点：`lib/ai_stations/next_action.js`（AI 采纳下一步）。
  - 直写 `next_action`/`next_action_at` 且 `next_action_time_basis='utc'`（§4.3 语义正确）。
  - 直写 `manager_required`/`manager_status`（CASE WHEN 合并，待介入归一）。
  - 有终止阶段守卫（`isFollowUpTerminalStage`）+ `recordExplicitPlan` 延迟计划对照。
- `next_action_time_basis` 全目录扫描：`ai_stations` 仅命中 next_action.js:116。无其他 AI 裸写下一计划。
- 结论：AI 写点语义正确；位于 `ai_stations/**` 红线内，不做收敛。如需未来统一，须先解除红线并另立授权。

### B. last_activity_at 归属（明确）
- 写点：`sales_crm.js` `addActivity`(7898)/`addQuote`(8080)/`addOrder`(8143)/`completeManagerAssistanceTodayTask`(6087) 均为**活动时间戳**；`crm_account_rebuild.js:380` 重建重算。
- 语义：`last_activity_at` = "最近有效活动时间"，属**活动溯源**非生命周期状态列。阶段 B §1 声明其"网关列之外直写"正确。
- 建议契约明示：`last_activity_at` 归活动溯源，不入 state_write/collaboration_write 收敛范围（gateway 列 = stage/lifecycle/assignment/owner/next_action*/manager_*/updated_at）。

### C. §1 完成门纠正（重要——审计发现的声明修正）
- **`updateAccount`（`sales_crm.js:9044`，手动资料编辑 API）经动态 `fields.push` → `UPDATE crm_accounts SET ${fields.join(',')}` 直写 `stage`/`owner_id`/`assignment_status`/`assigned_at`/`next_action`/`next_action_at`/`next_action_time_basis`/`updated_at`，完全绕过 `state_write`/`collaboration_write` 网关。**
- 此前 §1 "对 crm_accounts 状态/计划/主管列零裸写" 声明**不成立**：只读核验正则以"状态列与 `UPDATE crm_accounts SET` 同排"匹配，漏扫动态字段拼装（`fields.push('stage=?')` 不在 UPDATE 语句行）。
- 这是当前最大的残余直写面（profile 编辑可改写生命周期/计划/负责人/分配，含 claim/unassign 子流）。
- 标记为待收敛切片：需契约测试先行 + 保持 claim/unassign 权限子流语义，独立提交。**本轮不改代码**（用户选择只读审计）。

## 测试证据

- 本轮无业务改动，无新测试；基线维持 `node --test` 1927/1927、core 1566/1566（`fe77fb4`）。
- 治理文档/看板随审计结论同步。

## 提交

- 治理文档（CURRENT_STATE + session + 看板生成器 + 看板刷新），与业务基线分离提交。

## 风险与回滚

- 仅是文档修正 + 声明纠正；无代码行为变化；未 push/未合并/未部署；未触碰 AI 内容。
- 若后续收敛 `updateAccount`，为独立契约切片，可单独回滚。

## 下一步最小动作（按优先级）

1. **收敛 `updateAccount` 直写**（§1 剩余的最大面）：契约测试先行，把 stage/next_action*/owner/assignment/updated_at 改经网关，保持 claim/unassign 子流权限；独立提交。
2. §4 强化续：`assertAccountStateContract` 接入回收/恢复路径完整视图校验（§4.4 剩余）。
3. AI next_action 写点与测试种子收敛：红线内仅评估，不改。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。