# Stage B/D 状态投影与管理流程一致性收口

日期：2026-09-03  
范围：`after/` 非 AI、非生产重构工作树  
状态：一致性复核完成；未发现需要改动业务代码的漂移

## 基线与冻结边界

- `origin/main`、生产 `current/.release-sha`、生产 `state/state.json.lastSuccessfulSha` 均为
  `57c4c42a89e7730545b726b29fd932c5bfb20574`。
- 本轮只修改 `after/`；不写生产、不部署、不 push、不 merge。
- AI runtime、AI UI、AI 触发点继续冻结。`sales-assets/app.js` 中仅 AI 时间线的
  `item.state` 属于冻结兼容形状，不纳入非 AI 状态投影收口。

## 一致性矩阵

| 边界 | 统一真源/投影 | 复核结论 | 证据 |
|---|---|---|---|
| 客户阶段/生命周期/分配 | `projectCustomerState`、`projectAssignmentState`、`projectAccountState` | 列表、详情、bootstrap 继续消费既有列与共享投影；未引入第二套 `account.state`/`row.state` 读取 | `lifecycle_state_projection`、`pipeline_key_projection`、`state_projection_time_basis`、`state_projection_alerts` |
| 下一步计划 | `projectNextAction`（含 `next_action_time_basis`、degraded/overdue） | `buildAlerts`、团队报告和 pipeline action keys 复用投影，不自行比较裸日期/文本 | `report_builders_projection`、`pipeline_key_projection`、`phase_b_d_consistency_closure_contract` |
| 经理介入 | `manager_required` + `manager_status`，写入经 `applyManagerStatusPatch` | 经理任务、通知、升级、回复闭环仍由非 AI workflow + 生命周期 gateway 组合；无裸状态 UPDATE | `manager_workflows_contract`、`issue257_*`、`issue291_*`、`issue301_*`、`phase_b_d_consistency_closure_contract` |
| 延期计划 | `crm_deferred_plan_events` + 既有账号计划快照 | 延期清空显式计划但不伪造 activity；幂等、终止阶段和重试语义保持 | `issue170_deferred_plan_state`、`issue170_manager_api` |
| 今日待办 | alerts 投影 + intake/manager receipt 既有事务 | 保存计划后下一次 bootstrap 移除已解决任务；sales/manager/admin 范围与权限不漂移 | `issue157_today_task_actions`、`today_tasks_integration`、`state_projection_alerts` |
| 前端解释 | 既有 legacy raw-field contract（`next_action*`、`manager_*`、阶段/生命周期列） | 前端没有新增平行 `state` DTO；统一投影仅作为服务端计算/筛选契约 | `phase_b_d_consistency_closure_contract`、`pipeline_state_projection_contract` |

## 结论与不变式

1. Stage B 的状态投影职责已集中在 `lib/domains/lifecycle/state_projection.js`；业务读取方继续通过
   `projectNextAction`/`projectManagerState` 解释状态。不存在需要为本轮新增 reducer 或重写前端字段的证据。
2. Stage D 的 manager intervention/deferred plan 仍通过 `lib/manager_workflows.js` 的依赖注入边界装配，
   `sales_crm.js` 保留组合根与今日待办的原子事务；未发现重复写路径或跨域事务漂移。
3. 本轮只新增可执行契约测试，不改变 API 响应、数据库 schema、生产配置或 AI 行为。若未来改变 legacy raw-field
   contract，必须先补逐角色 API/浏览器等价证据并单独提交。

## 回归证据

专项组合：

```text
node --test \
  test/phase_b_d_consistency_closure_contract.test.js \
  test/lifecycle_state_projection.test.js \
  test/state_projection_time_basis_contract.test.js \
  test/state_projection_alerts_contract.test.js \
  test/report_builders_projection_contract.test.js \
  test/pipeline_key_projection_contract.test.js \
  test/manager_workflows_contract.test.js \
  test/issue170_manager_api.test.js \
  test/issue170_deferred_plan_state.test.js \
  test/issue257_manager_assistance_task.test.js \
  test/issue291_manager_assistance_loop.test.js \
  test/issue301_manager_assistance_history.test.js \
  test/issue157_today_task_actions.test.js \
  test/today_tasks_integration.test.js
```

结果：`83/83` 通过。完整 `node --test`、`npm test` 和治理/AI 门禁在最终收口阶段重跑。

