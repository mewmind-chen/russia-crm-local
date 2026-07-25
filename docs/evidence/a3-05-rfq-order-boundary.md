# A3-05 RFQ、报价和订单边界验收证据

日期：2026-07-25

## 代码与发布

- 实现提交：`29e9dfc`
- PR：[#75](https://github.com/mewmind-chen/russia-crm-local/pull/75)
- 合并提交：`bd0953c2eee0e92ab1f2f4e6f8da08a38c5ec27f`
- 生产 current：`releases/bd0953c2eee0`
- 生产 previous（回滚点）：`releases/9545213db522`

## 验证结果

- A3-05 专项测试：`3/3`
- 完整回归：`495/495`
- 主线 CI：通过
- Node/Zsh/Python 语法检查、`git diff --check`：通过
- 生产数据库 `PRAGMA quick_check`：`ok`
- 部署前备份：`state/backups/crm-before-bd0953c2eee0-20260725T053108Z-85447.db`
- 备份 SHA-256：`a8058118046c158dc074430f8c8b17641036b08cabcffbc7ac8e656b6507faa6`
- 新增表：`crm_commerce_action_requests`

## 生产 smoke

smoke 使用生产 release 和生产数据库的 SQLite online backup 隔离副本，未修改生产业务数据；live local/public `healthz` 均只读检查。

- local/public `healthz` 均返回 `200`、`database=ok`、release SHA `bd0953c2eee0e92ab1f2f4e6f8da08a38c5ec27f`
- RFQ 记录成功，状态 `200`
- 非法报价金额被拒绝，状态 `400`
- 有效报价首次提交 `200`，相同幂等键重放 `200` 且 `deduplicated=true`
- 未绑定报价的订单被拒绝，状态 `400`
- 有效订单首次提交 `200`，相同幂等键重放 `200` 且 `deduplicated=true`
- 隔离副本最终计数：RFQ `1`、报价 `1`、订单 `1`
- RFQ/报价事件继续生成 `next_action` AI 建议任务；AI 未获得报价金额、外发或订单写入路径

## 结论

A3-05 的 RFQ 数据校验、报价/订单人工权限边界、订单报价关联和重复提交保护均已验证，可以关闭本项。下一项为 A3-06 验收门；本轮不实现。
