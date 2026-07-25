# A3-04 消息和认领验收证据

日期：2026-07-25

## 代码与发布

- 实现提交：`c7a8037`
- PR：[#73](https://github.com/mewmind-chen/russia-crm-local/pull/73)
- 合并提交：`b6da19e8b018ba7d35629e6c1d32062eadee1664`
- 生产 current：`releases/b6da19e8b018`
- 生产 previous（回滚点）：`releases/bf15ad7e2de6`

## 验证结果

- A3-04 专项及受影响回归：`64/64`
- 完整回归：`492/492`
- Node/Zsh/Python 语法检查、`git diff --check`：通过
- 生产部署隔离验证：`492/492`
- 生产数据库 `PRAGMA quick_check`：`ok`
- 部署前备份：`state/backups/crm-before-b6da19e8b018-20260725T045554Z-48582.db`
- 备份 SHA-256：`222fe705c3bb0cf78bee62eedee312623f204758c6ae85742627179c02270881`
- 生产新增表：`crm_notification_deliveries`、`crm_intake_action_requests`

## 生产 smoke

本 smoke 使用生产 release 和生产数据库的 SQLite online backup 隔离副本，未修改生产业务数据；同时对 live local/public `healthz` 做了只读检查。

- local/public `healthz` 均返回 `200`、`database=ok`、release SHA `b6da19e8b018ba7d35629e6c1d32062eadee1664`
- 生产通知投递记录：`web=sent` 两条，`wecom=disabled` 两条；通知 `read_at` 仍为空，网页通知保持未读
- `claim` 第一次和相同幂等键重放均 `200`，重放标记 `deduplicated=true`
- claim smoke 只创建 1 个 CRM 客户
- `return` 第一次和重放均 `200`，结果保持一致
- `reject` 第一次和重放均 `200`，结果保持一致
- 隔离副本最终状态分别为 `claimed`、`returned`、`rejected`

## 结论

A3-04 的通知渠道状态、网页降级、认领/退回/拒绝幂等和生产回滚点均已验证，可以关闭本项。下一项为 A3-05 `RFQ、报价和订单边界`；本轮不实现。
