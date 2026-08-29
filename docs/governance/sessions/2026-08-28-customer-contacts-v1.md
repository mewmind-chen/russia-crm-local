# Session Checkpoint：阶段 A-3 customer 域第六刀 — 联系人展示映射

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`4e328e0` / `pilot/customer-change-labels-v1`

## 本次范围

抽离客户联系人的展示序列化与标签映射，缩小 customer 域对 `sales_crm.js` 的依赖。

## 迁移内容

- 新增 `lib/domains/customer/contacts.js`：
  - `CONTACT_MATCH_STATUS_LABELS`（待确认/对口/不对口）
  - `CONTACT_PROCUREMENT_ROLE_LABELS`（待确认/负责采购/不负责采购）
  - `publicAccountContact(row)`：联系人公开序列化（rawId/标签/来源/创建审计者）
- `sales_crm.js` 命名空间转发，删除本地映射与实现。

## 行为保证

- 联系人序列化字段、标签回退、来源文案、`updatedBy` 兜底 `createdBy` 全部不变。

## 测试

- 新增 `publicAccountContact` 契约测试。
- 客户域测试 12/12 通过；全量 `node --test` 1432/1432 通过。

## 提交与回滚

- 提交：`a08a350 refactor(customer): extract contact display mapping`
- Tag：`pilot/customer-contacts-v1`
- 工作区 clean，未 push。

## customer 域进度（6 刀）

normalize → recycle → create → summary → change-labels → contacts。

## 下一步

客户列表/资料行映射或回收流程其余辅助继续抽离；customer 域纯辅助逐步完成后再进入 activity 域。