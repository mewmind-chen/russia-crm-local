# Session Checkpoint：阶段 B 收尾——smoke 种子 time_basis 收敛

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`da34bc2` → `929b8c1`

## 本轮切片

### `929b8c1` 生产冒烟夹具与 §4.3 计划语义对齐
`lib/smoke_test_data.js`（生产冒烟脚本，验证 AI next-action 流）此前建立 next_action 计划时不写 `next_action_time_basis`——冒烟客户被 `projectNextAction` 判为 degraded，与生产写点（一律 `PLAN_TIME_BASIS='utc'`）语义发散。收敛：

- 账户 INSERT：列清单加 `next_action_time_basis`，值 `'utc'`。
- 计划 UPDATE（重跑路径）：`next_action_time_basis='utc'`。
- legacy 清理（`cleanupLegacyA303Smoke`）：清空时 `next_action_time_basis=''`。
- 快照清理（`cleanupNextActionSmoke`）：快照新增 `nextActionTimeBasis: current.next_action_time_basis`，恢复 UPDATE 写 `next_action_time_basis=?`（快照原值或 ''），冒烟前的既有计划原样还原。

范围说明：仅收敛"生产冒烟夹具"（production-parity fixture）。其余 issue 级测试种子（issue174/issue335/issue243 等）经审计确认：要么不建立非空计划、要么断言不依赖投影语义、要么已随 issue225 修复，均不需要改。

## 测试证据

- 契约 `test/smoke_seed_plan_basis_contract.test.js`（5 结构 + 1 行为）：结构锁定 INSERT/UPDATE/两处清理/快照均含 basis；行为验证 prepare 后 utc、cleanup 后清空。
- 既有 `smoke_test_data.test.js` 5/5 保持。
- `node --test` 全量 `1943/1943`；`npm test` core `1582/1582`。
- `git diff --check` 通过；lint 无错误；`node -e require` 加载正常；工作区干净。

## 提交

- `929b8c1` refactor(seeds): align production smoke fixture with §4.3 plan semantics

## 风险与回滚

- 行为变化面：冒烟夹具 now 与生产写点一致（影响冒烟客户自身的投影判定，测试确认无断言变化）；快照恢复新增 basis 字段（快照 JSON 兼容旧数据，`|| ''` 兜底）。
- 可独立 `git revert`；未 push/未合并/未部署；未触碰 `ai_stations/**`（脚本调用 `enqueueNextAction` 保持原样，仅修正其夹具 SQL）。

## 阶段 B 状态

业务侧全部完成：§1 写点收敛（9 切片）、§4 强化（守卫/投影/读路径）、state DTO 边界收敛、smoke 种子收敛。剩余项涉红线/评估：AI next_action 写点（仅评估不改）、`last_activity_at` 归属（已明确为活动溯源）、状态解释器统一消费（前端侧）。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 C（权限/筛选/字段）为下一个可执行阶段：字段级白名单投影替换 `CONTACT_KEYS` 递归黑名单、统一 `buildAccessContext` 与列表查询范围解释器、按页面落地"权限→字段→筛选"合同测试。
3. 或评估已漂移模块继续减单体（阶段 A 延伸）。