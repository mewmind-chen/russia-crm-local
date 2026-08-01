# Russia CRM Local

本地 CRM、Hermes Russia Recon 调度与证据回填系统。

## Architecture

```text
CRM API → recon_agent_worker.py → Hermes + russia-recon Skill
        ← V3 result + evidence ← validated report output

CRM API → contact_recon_worker.py → Hermes + russia-contact-recon Skill
        ← person + employment + method + evidence ← server-rated contact level
```

- Hermes负责公开来源调研、事实判断和报告。
- Worker负责原子领取、能力探测、Hermes调用、V3封装与提交前校验。
- CRM负责二次校验、事务入库、最终证据计数和兼容字段。
- 前端分别展示任务状态、数据质量、合规状态和业务优先级。

共享契约位于 `contracts/recon-result-v3.schema.json`。Legacy Markdown/YAML解析仍作为迁移期回退。
负责人挖掘使用 `contracts/contact-recon-v1.schema.json`，评级由 CRM 服务端重新计算，不信任 Worker 自报等级。

## Setup

```bash
npm install
cp .env.example .env
npm start
```

开发环境必须使用独立 runtime 和数据库，完整目录、环境变量与 worktree 规则见
[`docs/development.md`](docs/development.md)。

默认只监听 `127.0.0.1`。如设置 `HOST=0.0.0.0`，应同时设置 `CRM_ACCESS_TOKEN`；浏览器首次使用：

```text
http://server:3000/?token=<CRM_ACCESS_TOKEN>
```

Token会保存在浏览器本地存储中，URL随后自动清理。Worker继续使用独立的 `RECON_WORKER_TOKEN`。

## Sales management CRM

经营管理系统位于：

```text
http://127.0.0.1:3000/sales
```

首次运行会初始化用户、销售漏斗及演示经营数据。管理员账号由
`CRM_ADMIN_EMAIL` 和 `CRM_ADMIN_PASSWORD` 设置；未配置时本地默认值为
`admin@crm.local` / `ChangeMe123!`，登录后应立即修改密码。

系统包含客户时间线、快速跟进、询价/报价/订单、异常预警、管理者介入、
国家与细分市场分析、销售能力画像、用户角色与客户可见范围。销售仅能访问
本人负责的客户，经理与管理员可查看团队全盘。

客户详情中的“经理洞察”支持企业评价和逐个对接人评价。经理原文与AI结果
分开保存：AI只根据经理原文提取标签、赢单关键、风险和策略建议，界面统一
显示“AI标注”及实际模型来源，不会覆盖或冒充人工评价。主AI不可用时会切换
到备用受限AI；两个引擎都不可用时仍保存经理原文，并允许稍后重新生成标注。

“未开发线索每日入库”会在每日筛选交付完成后自动运行。`customer_pool` 中的企业
统一视为未开发线索，不计入 CRM 客户；A/B/C/D 组线索（不限 L0/L1/L2/L3）
去重后全部进入线索池，保留联系质量、筛选证据和背调入口。系统不会在入库时
自动指定销售。管理员在线索池勾选具体线索，或先设置筛选条件，再选择销售和
本次分配数量；分配成功后只创建待领取任务。销售确认领取后才创建 CRM 客户。
手动分配不设每日或单次条数上限；默认 24 小时内领取、领取后 48 小时内首次触达。

手动运行每日入库：

```bash
npm run crm:intake:daily
```

## Recon Worker

```bash
python3 scripts/recon_agent_worker.py --once
python3 scripts/recon_agent_worker.py
```

Worker通过 `claimReconJob` 原子领取任务，并使用租约避免多个Worker重复处理同一任务。新结果写出：

```text
report.md
report.html
result-v3.json
execution_log.json
hermes_stdout.txt
hermes_stderr.log
```

## Contact Recon Worker

```bash
npm run contact-recon:once
npm run contact-recon:worker
```

前端的“负责人线索”页可发起任务并查看人员、在职证据、可触达方式与下一步。等级口径：

- L3：可交付给销售；具名相关负责人、当前在职证据、非通用直接联系方式及来源齐全。
- L2：个人联系方式为推断或在职证据不足，必须人工验证，不直接交付销售。
- L1：仅有具名员工或公司通用入口。
- L0：未找到有效负责人线索。

历史数据分类预览与执行：

```bash
npm run contact-quality:migrate
npm run contact-quality:migrate:apply
```

迁移不会把原有官网邮箱自动升级成 L2/L3。

## Daily customer delivery

全量公司初判与分组：

```bash
npm run company-screening:preview
npm run company-screening:run
```

批量入队前预览，以及正式加入 Contact Recon：

```bash
npm run contact-recon:enqueue:dry -- --group A --country RU --limit 20
npm run contact-recon:enqueue -- --group A --country RU --limit 20
```

手动生成当日交付文件：

```bash
npm run delivery:generate
```

安装 macOS 后台服务（CRM、3个Worker、每天4批入队、早晚报表）：

```bash
npm run delivery:services:install
```

每日文件位于 `reports/daily/YYYY-MM-DD/`。只有 `01-sales-ready-L3.csv` 可直接交给销售；`02-manual-review-L2.csv` 必须人工确认。默认在 00:30、06:30、12:30、18:30 为俄罗斯 A 组各补充 30 个从未完成的任务，08:00 和 20:00 刷新报表。已完成客户不会重复消耗，除非显式使用 `--include-completed`。

完成通知器每5分钟检查一次队列。当 `queued + running = 0` 时，会刷新报表并通过 Hermes 的飞书 home channel 发送一次批次摘要；指纹文件保存在 `data/.contact-recon-notification.json`，避免重复通知。

### Public HTML report links

`01-sales-ready-L3.csv` 的 `report_url` 字段会在客户存在 Recon HTML 报告时生成带随机分享令牌的只读 HTTPS 链接。公开路由不暴露 CRM API，并返回 `noindex/nofollow/noarchive` 标头。

```bash
npm run reports:share:setup
npm run delivery:generate
```

如使用未登录账户的 `trycloudflare.com` Quick Tunnel，地址可能在隧道或 Mac 重启后变更，不提供生产稳定性保证。长期交付应登录 Cloudflare，创建 Named Tunnel 并绑定固定域名，然后设置 `PUBLIC_REPORT_BASE_URL`。分享链接等同于读取令牌，不要发布到公开网页。

## Data Quality

只读审计：

```bash
npm run quality:audit
```

历史治理预览与执行：

```bash
npm run quality:normalize
npm run quality:normalize:apply
```

执行模式会先在 `data/backups/` 创建数据库备份。治理脚本只处理确定性的标准化和证据计数，不会自动合并公司，也不会代替业务人员填写负责人、下一步动作或跟进日期。

## Tests

```bash
npm test
npm audit --omit=dev
node --check server.js
python3 -m compileall -q scripts automation/hermes-skills/russia-recon/scripts
```

权限隔离的路由、数据范围与回归测试对照表见
[`docs/permission-matrix.md`](docs/permission-matrix.md)。使用生产数据库验证时，禁止让测试直接连接运行中的数据库；先生成一致性副本，再由测试夹具制作第二份临时副本：

```bash
CRM_FIXTURE_BASE_DB=/absolute/path/to/crm-production-copy.db \
  NODE_ENV=test node --test test/access_control.test.js \
  test/permission_integration.test.js test/assistant_scope.test.js
```

测试只向系统临时目录中的第二份副本写入匿名夹具，结束后自动删除。

## Deploy, health check, and rollback

Automatic deployment accepts `origin/main` as its only source. Normal: merge PR -> Mac
validates latest origin/main -> backup -> switch -> health check.

Mac production files have one root, separate from every development checkout:

```text
$HOME/Desktop/projects/tradepulse-production/
├── current -> releases/<12-char-sha>
├── releases/
├── shared/
└── state/
```

`DEPLOY_ROOT` overrides this root when required. The deployer derives all managed
paths from it; explicit fine-grained path variables are reserved for tests and
migrations. The installer requires the currently active release as a provenance
check:

```bash
export DEPLOY_ROOT="$HOME/Desktop/projects/tradepulse-production"
DEPLOY_BOOTSTRAP_RELEASE="$(cd "$DEPLOY_ROOT/current" && pwd -P)" \
  npm run deploy:mac:install
npm run deploy:mac:status
npm run deploy:mac:retry
tail -f "$DEPLOY_ROOT/shared/logs/com.russia-crm.auto-deploy."{out,err}".log"
curl -fsS http://127.0.0.1:3000/healthz
```

Also confirm the public `/healthz` endpoint after a deployment. Notifications: none in the first version.

Run the release gate with an explicit endpoint, full expected commit SHA, and
absolute SQLite path. The gate does not derive a database from the repository,
`DEPLOY_ROOT`, or `CRM_DB_PATH`; it opens only the supplied file in read-only mode:

```bash
bash scripts/verify-release-gate.sh \
  --health-url http://127.0.0.1:3000/healthz \
  --expected-sha 0123456789abcdef0123456789abcdef01234567 \
  --database /absolute/path/to/tradepulse-production/shared/data/crm.db
```

The command requires healthy JSON with the exact release SHA, then requires
`PRAGMA integrity_check` to return `ok` and `PRAGMA foreign_key_check` to return
no rows. Use the SHA selected by the release process rather than an abbreviated
commit ID.

Rollback boundary: code symlink is automatic; SQLite restore is manual and requires
stopped services. Automatic database restore is forbidden.

合并并更新 `/opt/tradepulse` 后，Linux 生产环境使用：

```bash
sudo systemctl restart tradepulse.service
sudo systemctl status --no-pager tradepulse.service
curl --fail --silent --show-error http://127.0.0.1:3000/healthz >/dev/null
```

当前 Mac + Cloudflare Named Tunnel 环境使用：

```bash
launchctl kickstart -k gui/$(id -u)/com.russia-crm.server
launchctl kickstart -k gui/$(id -u)/com.russia-crm.cloudflare-tunnel
launchctl print gui/$(id -u)/com.russia-crm.server
curl --fail --silent --show-error http://127.0.0.1:3000/healthz >/dev/null
```

公网检查还应验证登录页返回 200，并用低权限测试账号确认禁止模块返回 403。若出现 502，先检查本地健康检查和服务日志；Cloudflare 显示 `Host Error` 通常表示源站服务未监听或隧道无法连接源站。

回滚顺序：停止 CRM 与 Worker，切回上一稳定提交，恢复上线前 SQLite `.backup` 产物，再启动 CRM、Worker 和隧道并重复健康检查。不要用普通文件复制替换正在运行的 WAL 数据库。数据库恢复必须由操作人员手动执行，部署器绝不自动恢复数据库。

## Backup and rollback

上线前备份：

```bash
mkdir -p data/backups
sqlite3 data/crm.db ".backup 'data/backups/crm-before-release.db'"
```

回滚时先停止服务和Worker，再用目标备份替换 `data/crm.db`。不要在运行状态下直接复制WAL数据库文件。

## Compatibility

- 现有扁平 `recon_results` 字段继续更新，供旧页面使用。
- V3原文保存在 `recon_results.result_json`。
- 联系人、网站检查、企业标识和制裁检查同时写入规范化表。
- 历史结果标记为 `schema_version=legacy`，前端会显示Legacy证据口径。
# TradePulse 统一外贸客户系统

正式入口统一为 `/`。登录后，销售进入个人客户与今日任务，经理和管理员进入经营驾驶舱；客户池、Recon、负责人线索、每日分配、客户推进、经理评价与经营分析都在同一套导航内。

## 正式数据切换

先执行 `npm run crm:migrate:unified:dry` 查看模拟数据和旧跟进记录，再执行 `npm run crm:migrate:unified`。正式迁移会先在 `backups/` 生成可恢复数据库，不会直接删除无法判断归属的旧记录，而是写入 `crm_migration_review`。

## 公网部署

`deploy/` 提供 Caddy HTTPS、systemd 常驻服务、每日入库、五分钟 SLA/企业微信通知和备份脚本。生产环境必须设置 `NODE_ENV=production`、强管理员密码、`RECON_WORKER_TOKEN`、`REPORT_SHARE_TOKEN`、`CRM_DOMAIN`；企业微信提醒需设置 `WECOM_WEBHOOK_URL`。
