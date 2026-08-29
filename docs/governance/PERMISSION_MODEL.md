# TradePulse 权限模型（取证版）

更新时间：2026-08-27
状态：代码级初稿；仍需用完整权限测试和页面行为验证

## 权限层次

```text
用户身份/角色
  ↓
权限组
  ↓
用户额外覆盖
  ↓
页面访问权限
  ↓
数据范围
  ↓
字段可见性/脱敏
  ↓
筛选、统计、导出和写操作
```

## 角色默认权限

权限定义位于 `lib/access_control.js`，当前角色为 `admin`、`manager`、`sales`。

| 能力 | admin | manager | sales |
|---|---:|---:|---:|
| 查看 Dashboard/客户/开发/线索池/联系人/Recon/管道/待办 | 是 | 是 | 是 |
| 查看团队全部客户 | 是 | 是 | 否 |
| 管理线索入库与分配 | 是 | 是 | 否 |
| 管理客户回收站 | 是 | 是 | 否 |
| 手工客户回收/恢复 | 是 | 否 | 否 |
| 新增客户 | 是 | 是 | 否 |
| 编辑客户/负责人 | 是 | 是 | 否 |
| 记录活动、报价、订单 | 是 | 是 | 是 |
| 经理评价 | 是 | 是 | 否 |
| 发起 Recon | 是 | 是 | 否 |
| 使用 Prospect Agent / AI Assistant | 是 | 是 | 否 |
| AI 任务复核 | 是 | 是 | 否 |
| AI 预算 | 是 | 否 | 否 |
| 用户/权限与数据维护 | 是 | 否 | 否 |
| 导出 | 是 | 否 | 否 |

注意：这是角色默认权限的代码映射，不代表每个用户最终权限。实际权限来自权限组与用户覆盖。

## 权限组和用户覆盖

- `permission_groups` 保存角色关联权限组。
- `user_permission_overrides` 保存单个用户的 `allow`/`deny`。
- 用户有效权限 = 权限组权限 + 用户覆盖。
- 权限组角色必须与账号角色一致。
- 修改权限组或覆盖时必须保留至少一个有效管理员。
- 权限迁移有 `permission_group_migrations` 记录并进行前后校验。

## 数据范围

`buildAccessContext` 和 CRM 查询目前体现：

- 具备 `view_all_customers` 且具备 `manage_intake`：可访问所有活跃、非测试客户。
- 具备 `view_all_customers` 但不具备 `manage_intake`：可访问有负责人的活跃、非测试客户。
- 普通销售：按 `owner_id` 访问本人客户，并排除退回、回收和测试数据。
- admin 对 `customer_pool` 的外部客户 ID 有额外全量集合；这个差异需要继续验证是否符合业务预期。
- 线索页面非管理用户按 `assigned_owner_id` 限制，并隐藏 `duplicate` 等特定状态。

## 页面权限

`PAGE_REQUIRED_PERMISSIONS` 当前定义：

| 页面 | 必需权限 |
|---|---|
| customers | `view_customers` |
| intake / lead_flow | `view_intake` |
| pipeline | `view_pipeline` |
| alerts | `view_alerts` |
| insights | `view_insights` |
| recycle_bin | `manage_customer_recycle` |
| contacts | `view_contacts` |
| recon | `view_recon` |

## 筛选权限

筛选权限由 `filter_definitions`、权限组授权和用户额外授权共同决定：

- 过滤定义包含字段类型、启用状态、敏感性、操作符、适用页面和前置权限。
- 非管理员必须同时满足页面权限、字段前置权限和组/用户授权。
- 管理员可看到启用且展示的字段。
- 每次筛选权限修改会递增版本并写入 `filter_permission_audit`。
- 请求携带旧版本会返回 `FILTER_VERSION_CONFLICT`。
- 未授权字段不会只在前端隐藏，而是在服务端拒绝查询。

## 敏感字段与脱敏

无 `view_contacts` 时，`redactContactFields` 会递归过滤联系人、Recon、内部评价、下一步、备注、报告和其他敏感字段。具体字段清单位于 `CONTACT_KEYS`，属于高风险配置，应纳入字段级测试。

## 路由操作保护

路由策略还包含：

- `adminOnly`
- `realAdminOnly`
- `blockedWhileImpersonating`
- `impersonationControl`

身份查看期间会阻止写操作、权限变更、数据维护、AI 任务执行等指定操作。

## 当前风险

- 角色默认权限、权限组权限、用户覆盖和路由 policy 分散在多个模块。
- 部分路由只声明功能权限，资源级访问仍由处理函数另行完成。
- `CONTACT_KEYS` 是递归字段名黑名单，未来需要改为明确的字段投影/白名单模型。
- `buildAccessContext` 的账户范围与部分页面查询各自实现，需验证是否始终一致。
- 统计、筛选选项、导出、详情和列表必须继续做同角色对照验证。
