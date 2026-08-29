# Session Checkpoint：阶段 A-3 customer 域第五刀 — 资料编辑审计标签

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`d824b0a` / `pilot/customer-summary-v1`

## 本次范围

把 `ACCOUNT_FIELD_LABELS` 字段标签映射与 `changedFieldLabels` 格式化器移入 customer 展示模块，使资料编辑历史渲染彻底脱离 `sales_crm.js`。

## 迁移内容

- `lib/domains/customer/summary.js` 新增 `ACCOUNT_FIELD_LABELS`（17 个账户字段标签）与 `changedFieldLabels(changed, key)`。
- `sales_crm.js` 删除本地映射与实现，`buildAccountHistory` 改用 `accountSummary.changedFieldLabels` 转发。

## 行为保证

- 资料编辑审计 from/to 值映射不变；未知字段回退原始字段名；null 输入返回空对象。

## 测试

- 新增 `changedFieldLabels` 契约测试：已知标签、from 方向、未知回退、null 输入。
- 客户域测试 11/11 通过；全量 `node --test` 1431/1431 通过。

## 提交与回滚

- 提交：`4e328e0 refactor(customer): extract profile change audit labels`
- Tag：`pilot/customer-change-labels-v1`
- 工作区 clean，未 push。

## customer 域进度（5 刀）

normalize（规范化）→ recycle（回收校验）→ create（创建幂等）→ summary（展示/阶段标签）→ change-labels（编辑审计标签）。

## 下一步

客户列表/资料行映射（`detailFor`/`profile` 行组装）或回收流程其余辅助按同模式继续抽离；之后进入 activity 域。