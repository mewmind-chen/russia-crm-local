# Session Checkpoint：阶段 B 边界收敛——pipeline 行移除 state DTO

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`aabe4d9` → `6b88d74`

## 本轮切片

### `6b88d74` pipeline 行不再附加 state DTO（边界统一为"无 DTO"）
- `lib/business_page_filters.js`：
  - `publicPipelineActionRow` 移除 `...projectAccountState(row)` 展开；state_projection import 精简为 `{ projectNextAction, projectManagerState }`（后两者仍被 `pipelineActionKeys` 使用）。
  - pipeline 行从此与 accounts/bootstrap/profile 一致：直读裸字段（stage/lifecycle_status/assignment_status/manager_*/next_action*），无 `state` DTO。
  - actionQueueKeys/actionQueueLabels 与 latest* 派生字段保持。
- 契约测试：`test/pipeline_row_state_boundary_contract.test.js`（2 断言）：
  - 结构：`publicPipelineActionRow` 不得再展开 `projectAccountState`；import 不得含该符号。
  - 行为：`listPipelineRows` 返回的 pipeline 行无 `state` 键、裸字段（stage/assignment_status/manager_required）与 actionQueueKeys 仍在。
- 同步更新：`test/lifecycle_state_projection.test.js` 原"pipeline list rows include state projection"（固定旧边界差异的测试）改为"no state DTO"契约，与 accounts/bootstrap 断言一致。

## 收敛依据（只读核验）

- 前端 `sales-assets/app.js`：零 `.state.*` 消费（唯一 `.state` 为 AI job/proposal 状态，非客户行 DTO）。
- 后端：`lib/` 中仅 `access_control.js:710` 白名单 redact 读 `state.nextAction.text`，且 `contactSafeStateRecord` 对缺 `state` 优雅降级。
- 全目录扫描：`projectAccountState` 唯一附加点是 `publicPipelineActionRow`（无其他列表路径附加 DTO）。
- 方向与用户裁定一致（accounts/bootstrap/profile 已无 DTO、前端直读裸字段）。

## 测试证据

- 新契约 2/2；pipeline/白名单/投影/前端兼容/状态写回归 51/51。
- `node --test` 全量 `1936/1936`；`npm test` core `1575/1575`。
- `git diff --check` 通过；lint 无错误；`node -e require` 加载正常；工作区干净。
- `sales_crm.js` 行数不变（12,984）；`business_page_filters.js` 净减 1 行。

## 提交

- `6b88d74` refactor(pipeline): drop the state DTO from pipeline rows to match account boundary

## 风险与回滚

- 行为变化面：pipeline API 响应不再含 `state` 对象（wire 载荷减少）；前端无消费者（已核验）。白名单对含 state 的旧行仍可处理（redact 兼容）。
- 可独立 `git revert`；未 push/未合并/未部署；未触碰 AI 内容与 intake 触发器。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 B §4 剩余：将 `assertAccountStateContract` 接入回收/恢复路径的完整视图校验。
3. AI next_action 写点与测试种子收敛：红线内仅评估，不改；`last_activity_at` 归属已明确为活动溯源。