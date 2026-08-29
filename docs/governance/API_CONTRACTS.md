# TradePulse API 清单（初始取证版）

更新时间：2026-08-27
状态：路由级初稿；请求/响应/权限/错误码待逐接口整理

> 范围：AI 相关接口（`/api/sales-crm/ai/*`、`/api/assistant/*`）不纳入本次重构范围，保持现状；本次重构聚焦统一 CRM 与旧版界面的收敛。

## HTTP 入口

| 范围 | 主要路由 |
|---|---|
| 页面 | `/`（统一壳 `sales-crm.html`）、`/sales`（302 -> `/`）、`/development-workbench`（旧版 `Index.html`，含 profile/embedded 模式）、`/legacy`、`/tradelead-v2.html`（旧入口，`CRM_ENABLE_LEGACY` 控制） |
| 健康/交付 | `/healthz`、`/api/delivery/latest`、`/api/delivery/file` |
| 通用旧 API | `/api/initial`、`/api/customers`、`/api/recon/results/:jobId`、`/api/quality/issues`、`/api/report`、`/api/recon-monitor` |
| 认证 | `/api/sales-auth/login`、`/api/sales-auth/logout`、`/api/session/capabilities` |
| CRM 启动/查询 | `/api/sales-crm/bootstrap`、`/api/sales-crm/filter-schema/:pageKey`、`/api/sales-crm/lists/:pageKey`、`/api/sales-crm/accounts`、`/api/sales-crm/profile/:customerId` |
| 线索与回收 | `/api/sales-crm/intake`、`/api/sales-crm/intake/action`、`/api/sales-crm/intake/scan`、`/api/sales-crm/accounts/recycle-bin`、`/api/sales-crm/accounts/:customerId/return`、`/trash`、`/restore`、`/reassign` |
| 客户操作 | `/api/sales-crm/accounts`、`/master/:customerId`、`/export`、`/activities`、`/quotes`、`/orders` |
| 联系人与评价 | `/api/sales-crm/contacts`、`/evaluations`、`/evaluations/:evaluationId/retry`、`/customers/:customerId/people` |
| 用户/权限 | `/users`、`/permission-groups`、`/users/:userId/permission-overrides`、`/filter-permissions`、`/filter-permissions/definitions/:filterKey` |
| Assistant | `/api/assistant/runtime`、`/api/assistant/conversations`、`/api/assistant/chat` |
| AI Station | `/api/sales-crm/ai/*`，覆盖 features、governance、tasks、budgets、enrichment、proposals、next-action 和批量操作 |
| 分享报告 | `/share/report/:token/:jobId`、`/share/contact-report/:token/:jobId` |

## 当前观察

- Express 路由主要集中在 `server.js`、`lib/sales_crm.js` 和 `lib/ai_stations/routes.js`。
- CRM 路由安装函数与数据库/业务函数位于同一个大模块中。
- 新旧 API 并存，部分旧 API 面向旧数据模型，部分统一 CRM API 面向 `crm_accounts` 等新模型。
- `/api/sales-crm/lists/:pageKey` 和 `/filter-schema/:pageKey` 是统一筛选体系的重要入口。

## 逐接口分析模板

后续每个接口需要补齐：

```text
方法和路径：
业务领域：
认证要求：
角色/功能权限：
数据范围：
字段可见性：
请求参数：
成功响应：
错误码和状态码：
写入表：
审计行为：
幂等性：
相关测试：
迁移/兼容约束：
```

## 重点核查顺序

1. 认证、session 和访问上下文
2. bootstrap、列表、详情和导出的一致性
3. 客户活动和状态变更
4. 线索领取、退回、拒绝、重新分配
5. 回收站和恢复
6. 联系人、评价和敏感数据
7. 筛选 schema、授权和分页
8. AI 任务、提案和审批（本次仅确认不纳入重构）
9. 客户完整资料相关接口：`/api/sales-crm/profile/:customerId`、`/intake/:itemId/profile`、`/master/:customerId`、`/recycle-profile`（统一视图将直接复用这些数据源）

不应仅凭路由名判断接口的最终业务职责；必须继续追踪处理函数、SQL、权限检查和测试。
