# Session: 阶段 A-1 identity/filter 前置调查

日期：2026-08-28
权威基线：origin/main@57c4c42（git fetch 后一致）
调查 worktree：worktrees/frontend-widget-pilot / codex/frontend-widget-pilot@077c88c
runtime：3201 / runtime/frontend-widget-pilot/data/crm.db

## 本次任务确认

用户连续选择继续，并选择暂缓修复 3 个已知基线权限回归；本次进入阶段 A-1 identity/filter 前置调查。目标是识别可抽离边界，不立即修改业务代码。

## 已确认边界

- identity 真源在 `lib/access_control.js`：`PERMISSION_DEFINITIONS`、`ROLE_PERMISSIONS`、`permissionsFor`、`buildAccessContext`、单客户访问断言、脱敏与路由策略。
- filter 真源由两层组成：`lib/filter_catalog.js` 静态定义；`lib/filter_authorization.js` 负责 DB grant/version、effective schema、AST 校验。
- `lib/business_page_filters.js`、`lib/intake_flow_filters.js` 是查询适配器，`lib/sales_crm.js` 负责路由装配和 CRM DTO 兼容。
- `sales_crm.js` 内 `accountScope` 与 `access_control.js` `buildAccessContext` 存在重复/耦合，不能在首刀复制或重写规则。
- `inaccessibleOrMissing` 定义 403/404 不可枚举策略，必须与现有契约测试一起处理。

## 结论

最小安全顺序：

1. A-1a identity facade：代理现有权限/访问函数，旧实现保持原位；零 SQL/状态/错误码变化。
2. A-1b filter facade：代理有效 schema/version/AST 校验，保留 `FILTER_VERSION_CONFLICT`。
3. A-1c 路由前置装配：最后处理 `requireSalesUser`/`requireUnifiedUser`/`policyForSalesRequest`。

具体边界和回滚见 `docs/governance/IDENTITY_FILTER_EXTRACTION.md`。

## 验证

- `node --check` / `ReadLints` 对调查涉及代码均无错误。
- worktree `077c88c` clean，未修改业务代码。
- 3201 HTTP 200。
- 已知全量 3 fail 未处理，且用户明确选择暂缓：permission profile/evaluation/bootstrap 三个历史契约失败。

## 当前状态

本 session 只读调查完成，未新增 commit。治理调查文件已写入权威 repo：`IDENTITY_FILTER_EXTRACTION.md` 与本 checkpoint；未修改生产与其他 worktree。

## 下一步允许动作

在用户确认后实施 A-1a identity facade；仍需保持旧实现与 API 契约兼容，完成专项测试后单独 commit+tag。
