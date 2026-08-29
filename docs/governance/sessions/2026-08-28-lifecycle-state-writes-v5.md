# Session Checkpoint：阶段 D-2e 跨表状态配对守卫

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`e25f1ad` / `pilot/lifecycle-state-writes-v4`

## 盘点结论（只读）

存量文件 `lib/sales_crm.js` 中的 `UPDATE crm_accounts` 已全部归类：

- 已由 `applyAccountStatePatch` 收口的业务路径：领取、退回、恢复、重分配、批量分配、报价、订单、活动推进、资料编辑、经理任务。
- 未收口（保留且不动）：
  - SQL schema/trigger（`installIntakeCrmStatusSync` 等 DB 级一致性规则）内的 `owner_id`/`claimed_at` 回填。
  - `seedAccounts` 演示数据初始化。
  - 主档昵称/字段同步（`crm_accounts_load_master_nickname_*`）。
- `manager_status`、`next_action` 继续独立写入，不并入客户主状态。

本轮未新增/改动任何产品写入 SQL；账套级主状态写入点在 D-2a~D-2d 已收口，本轮只补跨表一致性守卫。

## 新增测试

`test/lifecycle_state_write.test.js` 追加 3 组配对守卫：

- `claimed`↔`unassigned` 与 `owner_id` 的配对规则。
- 回收账户保持 `recycled` + `returned/独立维度` 的边界。
- 创建状态与退回状态的字段契约。

这些都是模块层面的纯函数断言，直接锁定 `crm_accounts` 与 `crm_intake_items` 打配合所依赖的状态值；若后续任何写入点悄悄改坏配对值，测试立刻失败。

## 验证

- `node --test test/lifecycle_state_write.test.js`：14/14 通过。
- 全量 `node --test`：1405/1405 通过。
- `git diff --check`：通过；linter 无错误。
- 工作区 clean，未 push。

## 提交与回滚

- 提交：`d9a625b test(lifecycle): guard cross-table state pairing`
- Tag：`pilot/lifecycle-state-writes-v5`

## 下一步建议

1. 把 `manager_status`、`next_action` 独立投影进一步做实为 reducer 真源（阶段 D-3）。
2. 或盘点 `crm_intake_items` 侧的状态写入，封装跨表一致性函数（account/intake 双写原子约束）。