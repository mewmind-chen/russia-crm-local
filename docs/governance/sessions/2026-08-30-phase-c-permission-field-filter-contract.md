# Session Checkpoint：阶段 C 按页面"权限→字段→筛选"合同

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`2ca107b` → `45e0c05`

## 本轮切片

### `45e0c05` 权限→字段→筛选 一致性合同
利用 `issue170` 的迷你 filter DB harness（permission_groups + sales_users + user_permission_overrides + `installFilterAuthorization`），锁定三条不变量：

1. **schema 不泄漏**：任一角色的已授权筛选 schema 永不包含用户 `hasPermission` 不满足 `requiredPermissions` 的筛选器（sales-no-contact / sales-contact / manager / admin × customers/intake/lead_flow/pipeline/alerts/notifications）。
2. **联系人筛选门控**：`tag_business_product`/`tag_demand_product` 目录不变量须在 `requiredPermissions` 声明 `view_contacts`；无 view_contacts 销售在客户类四页 schema 中绝对缺席。
3. **字段↔筛选对称**：account 白名单剥 email/phone/contact/contact_level 等联系人字段（与无 view_contacts 的筛选缺席一致）。

澄清：筛选目录的 `sensitive:true` = "需显式授权/admin 绕过"，**≠** view_contacts 语义（`owner`/`recipient` 亦然）；联系人才用 `requiredPermissions:['view_contacts']` 显式门控。contract 依此定界。

## 测试证据

- 新契约 3/3；filter 授权相关回归（issue170 + issue116）20/20。
- `node --test` 全量 `1960/1960`；core `1599/1599`。
- `git diff --check` 通过；lint 无错误；`node -e require` 加载正常；工作区干净。

## 提交

- `45e0c05` refactor(access): lock permission->field->filter contract for account pages

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 C 剩余：范围解释器代码级去重（待安全落点）、可选残值（legacy customers 形状白名单）。P1/P3/S5/S6 判定已入册。