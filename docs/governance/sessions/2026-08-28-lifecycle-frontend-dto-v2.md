# Session Checkpoint：阶段 E-2 前端阶段/经理显示迁移

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`87ee2fe` / `pilot/lifecycle-frontend-dto-v1`

## 本次范围

继续阶段 E：把列表行阶段列、抽屉阶段、抽屉"管理介入"事实迁移到统一 `state` DTO。

## 迁移内容

- 新增前端辅助：
  - `accountStageOf(account)`：优先 `account.stage`，回退 `state.stage.key`。
  - `managerStateDisplay(account)`：优先 `state.manager.status`，回退原"待介入/暂不需要"解释。
- 迁移点：
  - 客户列表行阶段列 `statusMarkup(accountStageOf(account), ...)`。
  - 抽屉阶段 `stageLabel(accountStageOf(account))`。
  - 抽屉事实 `['管理介入', managerStateDisplay(account)]`。

## 行为保证

- 对合法行，`state.stage.key` 与 `account.stage` 一致，显示无变化。
- 对缺失 stage 的脏数据，回退投影默认 `new`，显示从"—"变为"客户入库"（预期改善）。
- 经理状态回退链与旧解释严格等价。

## 测试

- 更新 `issue287_next_action_time.test.js` 抽屉可执行生命周期 harness，注入 `accountStageOf`、`managerStateDisplay` 依赖。
- 新增前端契约守卫 `frontend stage and manager display fall back to the unified state DTO`。
- 专项 31/31 通过；全量 `node --test` 1414/1414 通过。

## 提交与回滚

- 提交：`dc1a026 feat(lifecycle): read stage and manager display from state DTO`
- Tag：`pilot/lifecycle-frontend-dto-v2`
- 工作区 clean，未 push。

## 下一步

继续阶段 E：漏斗计数、列表计划时间、活动模态等解释点可继续迁移；之后做字段级白名单投影（替换 `CONTACT_KEYS` 黑名单）。
