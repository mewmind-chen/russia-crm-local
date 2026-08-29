# Identity / Filter 阶段 A-1 前置调查

日期：2026-08-28
基线：origin/main@57c4c42
调查 worktree：frontend-widget-pilot@077c88c
状态：只读调查，未修改业务代码

> 历史说明（2026-08-29）：本文保留 A-1 实施前的调查结论，不能代表当前进度。此后 identity/filter facade、认证中间件和多项共享 helper 已在 `003b527` 至 `76b7b56` 之间落地；当前未提交 WIP 又撤回了部分 facade/白名单接线并造成回归。后续恢复点以 `CURRENT_STATE.md` 为准，本文仅用于解释最初边界设计。

## 结论

`identity` 与 `filter` 目前已经有可识别的职责边界，但存在两个需要保持不变的真源：

- identity 真源：`lib/access_control.js` 的角色权限、数据范围与脱敏；`lib/sales_crm.js` 仅负责路由装配和少量 CRM 查询兼容。
- filter 真源：`lib/filter_catalog.js` 定义字段/页面/操作符，`lib/filter_authorization.js` 负责 DB 中的启用状态、授权授予、版本和 AST 校验；`lib/business_page_filters.js` 与 `lib/intake_flow_filters.js` 是业务页查询适配器。

因此第一刀不应把 SQL scope、权限判断、筛选 AST 和路由一起搬迁。

## identity 当前边界

| 责任 | 当前位置 | 首刀建议 |
|---|---|---|
| 角色权限定义/解析 | `lib/access_control.js` `PERMISSION_DEFINITIONS`、`ROLE_PERMISSIONS`、`permissionsFor` | 保持原位，先加 contract test |
| CRM 数据范围 | `lib/access_control.js` `buildAccessContext`；`lib/sales_crm.js` `accountScope` | 先统一调用入口，不复制规则 |
| 单客户访问断言 | `lib/access_control.js` `assertAccountAccess`、`assertExternalCustomerAccess` | 可抽成 identity facade，内部代理旧函数 |
| 403/404 不可枚举策略 | `lib/sales_crm.js` `inaccessibleOrMissing` | 必须与已有 API 测试一起迁移，不能独立重写 |
| 路由权限策略 | `lib/access_control.js` `SALES_ROUTE_POLICIES`、`policyForSalesRequest` | 后置，路由表与业务 scope 需先建立映射 |
| contact/recon 数据投影 | `lib/access_control.js` `redactContactFields`、safe key sets | 不与 identity 首刀混合；未来字段目录白名单替换 |

## filter 当前边界

| 责任 | 当前位置 | 首刀建议 |
|---|---|---|
| 静态 filter 定义 | `lib/filter_catalog.js` | 保持真源，作为 domain module 输入 |
| DB grant/version | `lib/filter_authorization.js` | 保持真源，先用 facade 代理 |
| 有效 schema | `effectiveFilterSchemaFor` | 首个可抽函数候选，输出契约不变 |
| AST 校验 | `validateFilterQuery` | 与 version/error code 测试一起抽离 |
| CRM query 转换 | `sales_crm.js` `filterAstToCustomerQuery` | 后置，依赖 page DTO 契约 |
| 客户页查询 | `business_page_filters.js`、`sales_crm.js` | 不在 A-1 首刀搬迁 |
| 线索页查询 | `intake_flow_filters.js`、`sales_crm.js` | 不在 A-1 首刀搬迁 |

## 最小实施切片

### A-1a：identity facade（建议下一刀）

新增 `lib/domains/identity/`，仅导出代理：

- `permissionsFor`
- `hasPermission`
- `buildAccessContext`
- `assertAccountAccess`
- `assertExternalCustomerAccess`
- `inaccessibleOrMissing` 的等价错误工厂（先不移动原实现）

`lib/sales_crm.js` 只替换调用入口，旧函数保持兼容。首刀不改变 SQL、不改变错误码、不改变 `redactContactFields`。

测试：现有 `permission_integration` + `access_control` 套件；新增 facade identity equivalence test，比较代理与旧函数的输出/错误 status。

回滚：只回退 facade import/call-site commit；旧实现完整保留。

### A-1b：filter facade

新增 `lib/domains/filter/`，代理：

- `effectiveFilterSchemaFor`
- `validateFilterQuery`
- `getFilterPermissionVersion`
- `authorizedFilterAst` 的纯 envelope/版本代理

首刀不改变 `filter_catalog.js`、DB grant 表、AST 结构、`FILTER_VERSION_CONFLICT`。

测试：`filter_authorization`、`filter_contract`、客户/线索/业务页 query regression。

回滚：只回退 filter facade import/call-site commit。

### A-1c：拆分路由前置

只有 A-1a/A-1b 稳定后，才把 `requireSalesUser`、`requireUnifiedUser` 与 `policyForSalesRequest` 的组装拆出；保留 `sales_crm.js` 兼容调用。

## 不允许在 A-1 做的事

- 不修改权限定义、角色默认权限、数据范围 SQL 或 contact 脱敏规则
- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*`
- 不处理当前已知 3 个 baseline fail；它们属于独立权限契约修复线
- 不变更生产数据库/部署，不 push
- 不同时抽 customer/activity/lifecycle

## 阶段门禁

每个子切片满足：

1. `git diff --check`
2. `node --test` 受影响测试
3. `node scripts/run-core-tests.js` 与基线差异明确
4. 权限矩阵：admin/manager/sales + scoped user
5. API status/error code 不变
6. 一个子切片一个 commit + tag
