# Session: customer_profile 回归守卫（31/6/权限/section/渲染）

日期：2026-08-28
基线：origin/main@57c4c42（git fetch 后仍为 57c4c42，Merge PR #346）
隔离：worktree frontend-widget-pilot / 分支 codex/frontend-widget-pilot / runtime 3201（CRM_SEED_DEMO_DATA=true）

## 目标

为已落地的 31字段/6分组 `customer_profile` 字段目录补动态变更回归守卫，使 `lib/field_catalog.js` / `sales-assets/field-widget.js` 的目录、权限、分组、标签变更即时被测试捕获。

## 决策

用户选择“补字段目录动态变更回归断言（推荐）”作为下一步（regression_guard）。

## 完成

- `test/field_catalog.test.js`：`12 → 17` 例（`+5` 例 customer_profile 守卫），`field_catalog + profile_widgets` 合计 `28 pass`。
  1. `customer_profile admin sees 31 fields across 6 sections` — `FIELDS_CATALOG.length===31`，分组尺寸 `{identity_region:8,business_profile:6,product_focus:2,contact_channels:5,compliance:2,source_record:8}`，`section` 已序列化，`version==='field-schema-v1'`。
  2. `customer_profile hides contact_channels without view_contacts` — `sales []` 无 `email/phone/contactCount` 且 `22` 字段，`[view_contacts]` 有 `email/phone` 且 `email.sensitive===true`。
  3. `customer_profile hides deepReport/sourceFile without view_recon and creatorName/customerSource without view_all_customers` — `view_recon` 门控 `deepReport/sourceFile`，`view_all_customers` 门控 `creatorName/customerSource`。
  4. `customer_profile is visible in listFieldPages and profileSections groups correctly` — `listFieldPages()` 含 `customer_profile`，`profileSections(admin)` 6区且顺序/标签正确。
  5. `renderProfileFacts produces 6 sections for admin and respects permission filtering` — admin 6区且含关键字，受限销售不含 `a@b.c/系统导入`。
- 提交：`1e5be3d` `test(field-catalog): 补 customer_profile 回归守卫（31/6/权限/section/渲染）`，tag `pilot/profile-widgets-v1-guarded`（未 push）。
- 治理：`docs/governance/CURRENT_STATE.md` 已更新至 `1e5be3d`，本 session 落盘。

## 验证

```bash
node --check lib/field_catalog.js sales-assets/field-widget.js
# syntax OK
node --test test/field_catalog.test.js
# 17 pass 0 fail
node --test test/field_catalog.test.js test/profile_widgets.test.js
# 28 pass 0 fail（live 2例 seededFixture wu@example.com/Password123!）
curl -b admin /api/sales-crm/field-schema/customer_profile
# admin 31（8/6/2/5/2/8），anna 29（无 creatorName/customerSource），无权 22（无 email/phone/deepReport）
```

3 例基线回归（permission_integration 1205/1214/1240，7a26074 已存在）仍 fail，未纳入本 DoD，已记录于 CURRENT_STATE 下一步。

## 回滚

`git checkout pilot/profile-widgets-v1-fix -- test/field_catalog.test.js` 或 `git reset --hard a4bd518`。

## 下一步

按 CURRENT_STATE：用户级字段显示偏好 / 基线 3 fail 修复。
