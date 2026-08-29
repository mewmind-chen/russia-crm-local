# Session Checkpoint：阶段 E-1 前端消费统一状态 DTO

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`9c84ead` / `pilot/lifecycle-pipeline-projection-v1`

## 本次范围

阶段 E 起点：让前端开始消费后端下发的统一 `state` DTO，替换首个状态解释点，同时保留旧字段回退。

## 迁移内容

- `sales-assets/app.js` 新增：
  - `accountLifecycleActive(account)`：优先读 `account.state.lifecycle.key === 'active'`，回退 `lifecycle_status`。
  - `accountAssignmentReturned(account)`：优先读 `account.state.assignment.key === 'returned'`，回退 `assignment_status`。
- `canReturnCustomer` / `canRejectCustomer` 改用上述辅助，权限规则与生命周期规则保持不变。
- 更新 `issue103_frontend.test.js`、`issue209_ownerless_return.test.js` 契约守卫接受新实现（仍拒绝按 owner 存在性判断）。

## 行为保证

- 有 `state` 时按投影解释；无 `state` 时回退旧字段，兼容所有旧数据源。
- 权限边界（manage_customer_recycle / reject_own_customer_mismatch）未变。

## 验证

- 前端守卫/投影/漏斗专项：25/25 通过。
- 全量 `node --test`：1413/1413 通过。
- `git diff --check`：通过；linter 无错误。

## 提交与回滚

- 提交：`87ee2fe feat(lifecycle): consume unified state DTO in frontend guards`
- Tag：`pilot/lifecycle-frontend-dto-v1`
- 工作区 clean，未 push。

## 下一步

继续阶段 E：让列表行状态标签、抽屉状态区、漏斗计数等前端解释点逐步迁移到 `state` DTO；之后再做字段级白名单投影（替换 `CONTACT_KEYS` 黑名单）。
