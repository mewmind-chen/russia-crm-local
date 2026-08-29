# Session: 客户完整资料字段目录与组合 widgets

日期：2026-08-28
基线：origin/main@57c4c42（git fetch 后仍为 57c4c42，Merge PR #346: fix/issue-344-row-actions）
隔离：worktree frontend-widget-pilot / 分支 codex/frontend-widget-pilot / runtime/frontend-widget-pilot (3201)

## 目标

落地 31 字段/6 分组的 customer_profile 字段目录，#customerProfileView 按 section 分组渲染事实区块 + contacts 资产组合，iframe 保留回退，字段级自由显示。

## 完成

- lib/field_catalog.js：section 字段 + customer_profile 31 字段/6 分组（identity_region/business_profile/product_focus/contact_channels/compliance/source_record），权限门控 view_contacts/view_recon/view_all_customers
- sales-assets/field-widget.js：profileSections()/renderProfileFacts() 纯函数，按 section 分组
- sales-assets/profile-widgets.js：9.7K UMD，mountContacts/loadProfile/renderContacts/profileEndpoint，与 profile-contacts.js 同端点/字段契约
- sales-assets/app.js：mountCustomerProfileWidgets() 组合（schema 事实区 + contacts），profileFactsData/profileFactsFormatters，preload 包含 customer_profile
- sales-crm.html：#customerProfileWidgets/#profileWidgetRoot 位于 iframe 之前
- 校验：field-schema/customer_profile 31/31，sales 无权 22/无 email，section 序列化；语法 OK；test 23 pass
- 提交：c2aa865，tag pilot/profile-widgets-v1

## 验证

同步 profileWidgets.test.js：profile 数据经后端 3201 校验；field_catalog 委托后端权限过滤，不在前端白名单；销售视角由后端 payload 驱遣。
