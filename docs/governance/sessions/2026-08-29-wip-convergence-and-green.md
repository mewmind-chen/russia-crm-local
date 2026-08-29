# Session Checkpoint：迁移后 WIP 收敛与全量恢复

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`76b7b56` → 本轮提交 `92c3879`

## 本次目的

按迁移记录 `2026-08-29-workspace-migration-and-governance.md` 的恢复点 2-4 执行：只处理迁移带入的 5 个 WIP 文件，恢复 12 个全量失败，绿灯后分开提交治理与业务。

## 已确认事实

- 5 个迁移 WIP（`lib/domains/identity/index.js`、`lib/sales_crm.js`、`sales-assets/app.js`、`test/domain_facades.test.js`、`test/issue103_frontend.test.js`）是用户有意保留的“去 state DTO + facade 精简”方向：
  - `sales_crm.js` 移除 accounts/bootstrap/profile 的 state DTO 投影，并把此前抽取的部分 domain 引用内联/回放回单体。
  - `app.js` 删除 `accountStageOf`/`managerStateDisplay`/`accountLifecycleActive`/`accountAssignmentReturned`，改为直读裸字段。
  - `identity/index.js` 不再转发 `access_control` 常量与 `contactSafe*`/`redactContactFields` 白名单代理。
- 12 个失败分三类，均已按新契约修复测试（未改动 WIP 行为）：
  1. ownerless return 前端断言（`issue209_ownerless_return.test.js`）→ 直读裸字段断言。
  2. lifecycle state projection 契约（`lifecycle_state_projection.test.js`）→ accounts/bootstrap/profile 改为验证直读列且不要求 state DTO；前端 guards/stage/manager 断言同步更新；白名单兼容测试从 `../lib/access_control` 直连导入。
  3. contact whitelist 兼容导出 → 同上导入修复。
- pipeline 行仍由 `business_page_filters.js` 附加 state DTO（该文件未内联），与 accounts/bootstrap/profile 存在边界差异；前端已确认不消费 state DTO，测试覆盖该差异不回归。

## 验证结果

- `npm test`：全量 `1844/1844` 通过。
- 专项：`domain_facades`+`issue103` 9/9；`lifecycle_state_projection` 22/22；`issue209` 5/5。
- `git diff --check` 通过；无 lint 错误。
- 工作区干净（仅治理文档未提交）。

## 提交

- 业务切片：`92c3879 refactor(frontend): inline account state helpers and read columns directly`（7 个文件）。
- 治理文档：本文件与 `CURRENT_STATE.md` 更新待单独提交。

## 风险与回滚

- 业务提交可按 `git revert 92c3879` 回滚；state DTO 投影、facade 导出可在确认需要时从 `76b7b56` 恢复。
- pipeline 与 accounts 的 state DTO 边界差异需在后续状态解释器工作中显式收敛。
- 未 push、未合并、未部署；未触碰 AI 内容；未创建新 runtime。

## 下一步最小动作

1. 单独提交治理文档 checkpoint。
2. 审计 `origin/main..92c3879` 共 63 个提交中“已抽取且已接线 / 仅抽取未接线 / 被 WIP 回退”的模块，选择下一个最小领域切片。
3. 阶段 B 状态转换契约草案已记录在旧目录治理文档，需按新工作区路径迁移到 `after/docs/governance/`（可选，若继续阶段 B）。
