# Session Checkpoint：阶段 D-1 只读状态投影

日期：2026-08-28

## 需求与范围

按阶段 D 第一刀新增统一客户状态只读投影，不改状态写入逻辑。投影覆盖客户阶段、生命周期、分配、经理介入和下一步计划；旧 API 字段保持兼容。

## 代码基线与工作区

- 代码基线：`origin/main@57c4c42a89e7730545b726b29fd932c5bfb20574`
- 开发 worktree：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
- 分支：`codex/frontend-widget-pilot`
- 隔离 runtime：`runtime/data/crm.db`
- 验证端口：`3201`

## 修改文件

- `lib/domains/lifecycle/state_projection.js`
- `lib/sales_crm.js`
- `test/lifecycle_state_projection.test.js`
- `docs/governance/CURRENT_STATE.md`（权威 repo checkout 中的治理文档）

## 已确认事实

- `crm_accounts.stage` 默认 `new`。
- `lifecycle_status` 默认 `active`。
- `assignment_status` 默认 `claimed`；`assigned`/`claimed` 且存在 owner 才视为当前领取。
- `manager_required` 与 `manager_status` 是独立协作投影；需要介入但缺少状态时显示 `待介入`。
- `next_action_at` 过期只投影为 `overdue`，不修改数据库原值。
- 越权 profile 仍返回原有 403，不下发 CRM 状态。

## 未确认/后续事项

- `state` 仍是读取侧投影，不是真源，也未纳入所有今日待办和线索详情接口。
- 下一刀需盘点并统一 `stage`、`assignment_status`、`lifecycle_status` 的写入事务；`manager_status` 与 `next_action` 继续独立。
- 需要在有认证会话的浏览器中完成 admin/sales 角色页面检查；本次仅完成 3201 服务启动及未认证 401 smoke。

## 验证

- `node --test test/lifecycle_state_projection.test.js`：13/13 pass。
- `npm test`：1391/1391 pass。
- `git diff --check`：pass。
- 3201 server：启动成功；未认证 `/api/sales-crm/bootstrap` 返回 401，`/development-workbench` 返回 401。

## 风险、权限与数据影响

- 无 schema 变更、无 trigger 变更、无生产数据库操作、无状态写入变更、无 AI 代码变更。
- profile 投影严格以 `profileAccess.crmAccessible` 为门控，保持权限边界。

## 回滚

回滚本切片提交即可；旧 API 字段和旧写入路径未删除。

## 当前分支状态

提交和 tag 待完成：

- 提交名：`refactor(lifecycle): add unified customer state projection`
- tag：`pilot/lifecycle-state-projection-v1`
