# A3-01 `sales_pack` 与管理面板 AI 开关验收

日期：2026-07-25  
分支：`codex/a3-01-sales-pack`

## 范围

- 销售认领成功后以 `customer_claimed` 事件幂等入队 `sales_pack@v1`。
- AI Station Worker 执行资料包并在客户详情展示摘要、切入点、风险和人工审核草稿。
- 成功/失败写入内部通知；`wecom_status='disabled'`，不自动发送企微、邮件或社媒。
- 管理员面板提供四个持久化运行时开关：`ai_stations`、`customer_enrichment`、
  `customer_enrichment_auto_trigger`、`sales_pack`。
- 环境变量是硬门禁；运行时开关只允许真实管理员变更并写入审计。
- 关闭开关不删除已有队列，但阻止新任务入队或 Worker 领取。
- Worker 已纳入 launchd、部署和回滚服务清单。

## 验收结果

专项覆盖 `test/ai_sales_pack.test.js`、`test/ai_feature_flags.test.js` 及相关
AI Station/API/Worker/合同/权限/UI/launchd/部署测试。最终完整回归：

```text
node --test
476 tests, 476 passed, 0 failed
```

静态检查：

```text
node --check server.js
node --check lib/ai_stations/feature_flags.js
node --check lib/ai_stations/sales_pack.js
node --check lib/ai_stations/routes.js
node --check lib/ai_stations/worker.js
git diff --check
```

## 发布边界

本证据只证明代码和本地隔离运行时通过验收，不代表已进入生产。合并和部署前仍需
GitHub CI、生产 SQLite online backup、`quick_check`、current/previous 回滚点确认、
LaunchAgent Worker 状态检查；上线后需验证 `/healthz`、管理员面板开关、Worker、认领入队、
客户详情资料包和 `SALES_PACK_READY` 通知，并确认企微未自动发送。
