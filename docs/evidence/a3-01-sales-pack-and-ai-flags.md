# A3-01 `sales_pack` 与管理面板 AI 开关验收

日期：2026-07-25  
分支：`codex/a3-01-sales-pack`
发布：PR #66 合并集成；PR #67 合并 `main` @ `8de107697c6bb034a1cb139710fc5f189d4d9d49`

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

## 生产发布与 smoke

- 生产四个硬门禁均已设为 `true`，数据库运行时四个开关均为 `enabled=1`。
- 发布前 SQLite online backup：
  `/Users/ylf/Desktop/projects/tradepulse-production/state/backups/a3-01-predeploy-20260725T004720Z.db`；
  源库与备份 `PRAGMA quick_check` 均为 `ok`。
- 生产 `current=8de107697c6b`，`previous=639c640dbc1d`；本地和公网 `/healthz`
  均返回 `ok` 与 release SHA `8de107697c6bb034a1cb139710fc5f189d4d9d49`。
- LaunchAgent `com.russia-crm.ai-station-worker` 为 running、keepalive；真实
  `sales_pack` smoke job 进入 `needs_review`，结果 confidence `0.85`、`review_required=1`，
  并写入 `SALES_PACK_READY`、`status=unread`、`wecom_status=disabled`。
- 未登录访问 AI 功能 API 返回 `401 AUTH_REQUIRED`；生产页面包含 `aiFeatureRows` 和
  版本化 AI 资源。管理员交互面板因现有浏览器会话已过期未代填密码，未绕过登录。

本次完成 A3-01 后停止，下一项为 A3-02 `action_proposal`。
