# A3-06 销售执行验收门证据

日期：2026-07-25

## 代码与发布

- 实现提交：`e9f2137`
- PR：[#77](https://github.com/mewmind-chen/russia-crm-local/pull/77)
- 合并提交：`35858514259af935884e7745fd2e8db6db35e9ad`
- 生产 current：`releases/35858514259a`
- 生产 previous（回滚点）：`releases/4e912fbd0d68`

## 验证结果

- A3-06 专项：`2/2`
- 受影响回归：`78/78`
- 完整回归：`497/497`
- GitHub CI：通过
- Node/Zsh/Python 语法检查、`git diff --check`：通过
- 生产数据库 `PRAGMA quick_check`：`ok`
- 生产数据库 journal mode：`wal`
- 部署前 SQLite online backup：
  `state/backups/crm-before-35858514259a-20260725T060204Z-13973.db`
- 备份 SHA-256：
  `119f8238d8aa6deffb7617a63b05ee6186bf3fd65925bf6660b86226319fab64`
- 备份权限/大小：`0600` / `43835392` bytes
- 生产四个 AI 开关：`ai_stations=1`、`customer_enrichment=1`、
  `customer_enrichment_auto_trigger=1`、`sales_pack=1`

## 验收门

- 统一客户时间线包含 `claim`、`sales_pack`、`activity`、`next_action`、
  `rfq`、`quote`、`order` 七类事件；客户抽屉改为读取 bootstrap 的统一时间线。
- 资料包只产生人工复核草稿；人工触达通过既有 activity API；报价金额、报价外发和订单
  均由具备相应权限的员工提交，AI 没有业务事实写入路径。
- 测试先领取资料包任务并人为过期租约，再由新 Worker 恢复；结果只写入一条，
  claim、建议采纳、报价和订单的重复请求均保持幂等且只保留一条业务记录。
- 企微投递模拟 `HTTP 503` 后，通知仍为网页未读，web delivery 为 `sent`，
  wecom delivery 为 `failed`。

## 生产隔离 smoke

smoke 使用生产 release 和部署前生产数据库 online backup 的临时副本，所有业务写入
均限制在副本；副本已删除，生产库未写入测试数据。

- 生产 release 路径运行 A3-06 专项：`2/2`
- local `healthz`：`200`、`database=ok`、SHA `35858514259af935884e7745fd2e8db6db35e9ad`
- public `healthz`：`200`、`database=ok`、同一 SHA
- server 与 AI Station Worker launchd 服务均加载
- `current`/`previous` 与 `state.json` 一致

## 结论

A3-06 的客户执行时间线、人工确认边界、Worker 租约恢复/幂等、企微故障网页降级均
通过，可以关闭阶段 3。下一项为阶段 4 A4-01 `manager_anomaly`；本轮不实现。
