> **冻结归档（2026-09-01）**
>
> 本文是 2026-07-25 的历史证据，仅供审计和追溯。**不得**用它判断当前进度、代码/生产基线或下一步工作；当前事实只以实时远端 `main`、生产 `current`/release state、`after/` 的 Git/代码/测试和 `docs/governance/` 为准。

# TradePulse AI CRM 执行计划

> 正式版本说明：本文件自 2026-07-24 起纳入正式产品仓库管理。后续进度、SHA、PR 和验收结果必须通过 GitHub PR 更新；`tradepulse-ai-crm` 中的同名文件仅作为历史镜像。

**状态：** 35/38 个任务已完成；A4-04 已完成开发、CI 和生产发布；下一项 R5-01
**版本：** v2.0
**日期：** 2026-07-25
**上位文档：** `docs/planning/tradepulse-unified-master-plan.md`
**正式产品仓库：** `https://github.com/mewmind-chen/russia-crm-local`
**生产根目录：** `/Users/ylf/Desktop/projects/tradepulse-production`
**目标开发根目录：** `/Users/ylf/Desktop/projects/tradepulse-development`

## 1. 执行目标

按以下顺序完成 TradePulse：

1. 先消除生产版本漂移和开发环境混乱。
2. 保留现有生产账号、权限、客户数据和 AI 路由。
3. 将 `tradepulse-ai-crm` 的 AI 能力适配到正式 CRM，而不是部署第二套 CRM。
4. 按用户可见纵切交付 8 个 AI 工作站和原始 16 步流程。
5. 每个阶段独立测试、独立发布、可关闭、可回滚。

## 2. 全程硬约束

- 不 reset、clean、覆盖或删除 `/Users/ylf/Desktop/projects/russia-crm-local`。
- 不删除旧 release、旧仓库、生产备份或实验项目。
- 不复制正在运行的 SQLite DB/WAL/SHM；备份只使用 SQLite online backup。
- 不重建、迁移或批量修改现有生产账号、密码、会话、权限组和覆盖权限。
- 不重置 `assistant_runtime_settings`，不迁移第二套 AI router。
- 生产只部署 GitHub `origin/main` 的完整 SHA。
- release 必须无 `.git`，禁止在 release 内 pull、checkout 或手工编辑。
- 环境阶段不夹带 AI 业务功能。
- AI 阶段不修改生产目录结构。
- AI 不拥有最终分配、金额修改、订单确认和外发权限。
- 每个阶段只有通过验收门才能进入下一阶段。

## 3. 分支、评审和发布规则

### 3.1 分支

| 用途 | 分支 |
|---|---|
| 生产可部署主线 | `main` |
| 环境统一 | `codex/environment-unification` |
| AI 集成主分支 | `codex/ai-integration` |
| 阶段功能 | 从 `codex/ai-integration` 创建短期 `codex/ai-*` 分支，完成后合回 |
| 紧急修复 | 从最新 `origin/main` 创建 `codex/hotfix-*` |

### 3.2 合并门

任何进入 `main` 的提交必须满足：

- CI 必须执行且通过 `npm ci`、`npm test`、Node/Zsh/Python 语法检查。
- `git diff --check` 通过。
- 没有 `.env`、数据库、日志、报告、模型凭据或生产数据进入 Git。
- 至少有一份阶段验收记录。
- 生产发布前记录目标完整 SHA 和回滚 SHA。

### 3.3 发布门

- 只从已合并的 `origin/main` 部署。
- feature branch 只能进入开发/验收环境，不能成为 production/current。
- 数据迁移必须在生产备份后执行。
- 部署时不自动恢复数据库。

## 4. 阶段 0：生产与开发环境统一

**目标：** 建立唯一干净源码、独立开发 runtime 和不可变生产发布。
**预计：** 2-3 个工作日。
**功能边界：** 不增加 AI 工作站，不修改账号和业务数据。

### E0-01 记录生产基线

**依赖：** 无。
**修改：** 无，只读。

执行：

1. 记录 `current`、`previous` 的链接目标和真实路径。
2. 记录 current 目录名、Git HEAD、`origin/main` SHA。
3. 记录 8 个 LaunchAgent 的加载状态、WorkingDirectory 和 ProgramArguments。
4. 记录 3000、3100 端口进程。
5. 检查本地首页和公网首页状态码。
6. 对 `shared/data/crm.db` 执行 `PRAGMA quick_check` 和读取 journal mode。
7. 记录 `.env`、活动数据库和目录权限，不输出值。
8. 将结果写入 `tradepulse-production/state/preflight-<timestamp>.md`，不得包含密钥和客户资料。

验收：

- 本地和公网首页均为 200。
- SQLite quick_check 为 `ok`，journal mode 为 `wal`。
- 8 个预期 LaunchAgent 均可识别。
- 记录当前回滚目标。

停止条件：

- quick_check 非 `ok`。
- 本地或公网服务在执行前已异常。
- current 不是软链接或真实目标无法解析。

回滚：不适用，只读任务。

### E0-02 建立干净开发根目录

**依赖：** E0-01。
**创建：**

```text
/Users/ylf/Desktop/projects/tradepulse-development/
  repo/
  worktrees/
  runtime/
  snapshots/sanitized/
  artifacts/
```

执行：

1. 创建根目录，目录默认只允许当前用户写入。
2. 从 GitHub clone 到 `tradepulse-development/repo`。
3. 校验 `repo/main == origin/main`，并确认工作区干净。
4. 从旧本地仓库 fetch `codex/github-auto-deploy` 为只读 donor ref，不修改旧工作区。
5. 从 `origin/main` 创建 `codex/environment-unification`。
6. 创建外置 worktree：`worktrees/environment-unification`。

验收命令：

```bash
git -C /Users/ylf/Desktop/projects/tradepulse-development/repo status --short --branch
git -C /Users/ylf/Desktop/projects/tradepulse-development/repo rev-parse main
git -C /Users/ylf/Desktop/projects/tradepulse-development/repo rev-parse origin/main
git -C /Users/ylf/Desktop/projects/tradepulse-development/repo worktree list
```

验收：

- main 与 origin/main SHA 相同。
- main 工作区为空。
- 环境功能只在外置 worktree 开发。
- 旧脏仓库状态没有变化。

回滚：删除本阶段新建的开发根目录前必须再次确认其路径；旧仓库和生产不受影响。

### E0-03 整合并更新部署能力

**依赖：** E0-02。
**工作树：** `worktrees/environment-unification`。
**来源：** 旧仓库 `codex/github-auto-deploy` 的已提交内容。

目标文件：

- `.github/workflows/ci.yml`
- `lib/release_health.js`
- `lib/macos_launch_agents.js`
- `scripts/deploy-from-github.sh`
- `scripts/deploy-state.js`
- `scripts/install-auto-deploy.js`
- `scripts/install-daily-services.js`
- `server.js`
- `package.json`
- `test/deploy_*.test.js`
- `test/release_health.test.js`
- `test/macos_launch_agents.test.js`
- `README.md`
- `deploy/cloudflare-tunnel.md`

执行：

1. 将 donor branch 合入 `codex/environment-unification`，基于最新 origin/main 解决冲突。
2. 不带入 donor worktree 的未提交 task report 修改。
3. 确认 deployment root 默认值为 `tradepulse-production`。
4. 确认 release 通过 `git archive` 构建，无 `.git`。
5. 确认 `.release-sha`、`state.json`、锁、备份和 current/previous 都使用生产根目录。
6. 确认 healthz 只返回 `ok`、database 和完整 release SHA。
7. 确认错误不会打印 `.env` 或凭据。
8. 增加或修正 bootstrap 场景测试：已存在人工构建 release 且 state 未初始化时，不得错误覆盖或删除 release。

测试：

```bash
npm ci
npm test
node --check server.js
node --check scripts/deploy-state.js
node --check scripts/install-auto-deploy.js
zsh -n scripts/deploy-from-github.sh
bash -n deploy/backup.sh
python3 -m compileall -q scripts automation/hermes-skills/russia-recon/scripts
git diff --check
```

验收：

- 完整测试通过，不只运行 deployment 子集。
- 测试覆盖 candidate 失败、切换失败、restart 失败、health 失败和 rollback。
- 任何失败不会自动恢复 SQLite。
- auto-deploy 程序不依赖脏开发目录。

回滚：放弃 `codex/environment-unification`，生产不受影响。

### E0-04 增加开发/生产路径保护

**依赖：** E0-03。
**修改位置：** 配置加载、数据库路径解析、相关测试和开发文档。

执行：

1. 集中解析 `NODE_ENV`、`CRM_DB_PATH`、输出目录和运行根目录。
2. development/test 环境检测到 `tradepulse-production` 路径时拒绝启动。
3. production 环境要求 CRM DB 位于 `tradepulse-production/shared/data`。
4. 为测试注入临时路径，不写死用户 HOME。
5. 增加路径规范化和软链接 realpath 测试，防止软链接绕过。
6. 增加 `docs/development.md`，记录工作树和 runtime 规则。

验收：

- 开发误指向生产 DB 的测试明确失败。
- 正常开发临时 DB 和正式 shared DB 测试通过。
- 不读取或输出生产 `.env` 内容。

回滚：回退本任务提交，不影响生产数据。

### E0-05 评审并合并环境 PR

**依赖：** E0-03、E0-04 全部通过。

执行：

1. 推送 `codex/environment-unification`。
2. 创建 PR，附完整测试结果和生产迁移步骤。
3. 确认 PR 只包含部署、环境保护和文档，不包含 AI 工作站业务。
4. CI 通过后，人工批准合并 main。
5. fetch 最新 origin/main，记录完整目标 SHA。

停止条件：

- CI 未通过。
- PR 混入账号迁移、AI 业务或生产数据。
- origin/main 在评审期间前进且未重新验证。

### E0-06 构建不可变生产 candidate

**依赖：** E0-05 已合并。
**修改生产：** 创建新 candidate/release，不切换 current。

执行：

1. 初始化 `tradepulse-production/state/repo.git` bare repo。
2. fetch origin/main 并解析完整 SHA，禁止使用未解析分支名作为 release 身份。
3. 导出到 `releases/.candidate-<sha>-<pid>`。
4. 写入 `.release-sha`。
5. `npm ci` 并执行 E0-03 的全部验证。
6. 确认 candidate 无 `.git`。
7. 将 `.env`、data、logs、reports、runs、output、backups、tmp、memory 链接到 shared。
8. 验证所有链接真实目标都在 production/shared。
9. candidate 原子 rename 为 `releases/<12-char-sha>`。

验收：

- release 名称与 `.release-sha` 一致。
- release 无 `.git`。
- release 完整测试通过。
- 尚未改变 current 和任何运行进程。

回滚：仅移除未切换且路径已严格验证的 candidate；已经提升的 release 保留，不覆盖。

### E0-07 创建生产在线备份

**依赖：** E0-06。

执行：

1. 再次 quick_check 活动数据库。
2. 使用 `sqlite3 ... ".backup '<explicit path>'"` 写入 `state/backups`。
3. 对备份执行 quick_check。
4. 记录备份大小、时间、目标 release SHA。
5. 备份失败时停止发布，不切换 current。

验收：活动 DB 和备份均为 `ok`，备份非空。

### E0-08 原子切换生产

**依赖：** E0-06、E0-07。
**预计中断：** 仅服务重启窗口。

执行顺序：

1. 保存 current 的真实目标作为 rollback target。
2. 在生产根目录内为旧 current 建立 previous 指针；不得继续指向外部旧 releases 根目录。
3. 原子切换 current 到新 release。
4. 按顺序重启 server、recon worker、两个 contact worker。
5. 确认其他 schedule/tunnel 仍加载。
6. 轮询本地 `/healthz`，要求 SHA 等于目标完整 SHA。
7. 检查公网 `/healthz` 和首页。
8. 检查 SQLite quick_check、8 个 LaunchAgent、3000 监听和新日志。
9. 写入 `state.json` 成功记录。

失败回滚：

1. current 原子切回 rollback target。
2. 重启同一组服务。
3. 检查旧版本本地和公网首页。
4. 记录 failed SHA 和 failed stage。
5. 不自动恢复数据库。

验收：

- current/previous 都解析到 production/releases 内。
- `/healthz` 返回目标 SHA、database=ok、ok=true。
- 首页本地和公网均为 200。
- 8 个 LaunchAgent 正常。
- 现有账号能继续登录，现有权限和 AI runtime mode 未改变。

### E0-09 安装和验证部署控制器

**依赖：** E0-08 成功。

执行：

1. 用当前不可变 release 初始化/核对 deployment state。
2. 安装 auto-deploy LaunchAgent，ProgramArguments 不得指向旧开发目录。
3. 先使用 dry-run/fixture 验证，不触发第二次实际切换。
4. 验证锁、重复 SHA、failed SHA、force retry 和 rollback 行为。
5. 默认只监听 GitHub main；首版不添加通知或数据库恢复。

验收：

- deploy status 能报告 lastSuccessfulSha、current 和 previous。
- 重复目标 SHA 不重复部署。
- deployment controller 不读取 AI 实验仓库。

### E0-10 建立 AI 集成开发实例

**依赖：** E0-08；可以与 E0-09 后半段并行执行，但不得共享写状态。

执行：

1. 在干净 repo 从最新 origin/main 创建 `codex/ai-integration`。
2. 建外置 worktree `worktrees/ai-integration`。
3. 建 `runtime/ai-integration`，权限仅当前用户。
4. 生成仅含开发配置的 `.env`：`NODE_ENV=development`、`HOST=127.0.0.1`、`PORT=3100`、独立 CRM DB 路径。
5. 不复制生产 API Key、Cookie、账号或渠道配置。
6. 初始化开发 DB，使用开发/验收账号。
7. 运行完整测试并启动 3100。
8. 验证应用拒绝 production/shared/data 路径。

验收：

- repo/main 干净。
- AI worktree 分支正确。
- 开发 DB inode/realpath 与生产 DB 不同且不在生产根目录。
- 3000 仍是生产，3100 是统一开发实例。
- 现有 3100 验收壳停止前先记录用途；停止不删除其数据库和产物。

### 阶段 0 总验收门

以下验收门已全部通过，允许开始阶段 1 AI 业务集成：

- [x] 主计划和执行计划已更新实际 SHA。
- [x] production/current 是无 `.git` 的 immutable release。
- [x] current、previous 都在 production/releases 内。
- [x] `/healthz` 本地和公网报告目标 SHA、DB ok。
- [x] 8 个 LaunchAgent 正常。
- [x] 现有账号、权限和 AI router 配置未变化。
- [x] 干净 repo/main 与 origin/main 一致。
- [x] `codex/ai-integration` 使用独立 runtime 和 DB。
- [x] 环境路径保护测试通过。
- [x] 生产备份和回滚点已记录。

## 5. 阶段 1：第一个可见 AI 纵切 `customer_fit`

**目标：** 在正式 CRM 客户页面真实运行并显示客户价值评分。
**预计：** 首个评分纵切已完成；新增 Control Plane 与新客户补全闭环预计 8-14 个工作日。
**发布策略：** 默认 feature flag 关闭，先开发 DB，再生产影子运行。

### A1-01 移植 AI 合同层

创建建议：

- `lib/ai_stations/prompt_registry.js`
- `lib/ai_stations/prompts/v1.js`
- `lib/ai_stations/schemas/customer_fit.v1.json`
- `lib/ai_stations/contracts.js`
- `test/ai_station_contracts.test.js`

执行：

1. 增加锁定版本 AJV 依赖。
2. 只迁 `customer_fit` Schema 和通用验证器，不一次迁完所有业务代码。
3. 保留 version、confidence、evidenceIds、reasonCodes、fitScore、grade、reviewRequired。
4. 增加 evidence 白名单校验。
5. Prompt 明确用户内容不可信，禁止写业务状态。

验收：合法输出通过；缺字段、陌生字段、虚构 evidence、越界分数全部拒绝。

### A1-02 新增 AI 持久任务和结果表

创建建议：

- `lib/ai_stations/schema.js`
- `lib/ai_stations/jobs.js`
- `lib/ai_stations/results.js`
- `lib/ai_stations/audit.js`
- `test/ai_station_jobs.test.js`
- `test/ai_station_results.test.js`

表：

- `crm_ai_jobs`
- `crm_ai_station_results`
- `crm_ai_evidence_bindings`
- `crm_ai_model_runs`

要求：

- 只引用现有文本 customer ID/CRM account ID。
- 状态包含 queued、running、retry_wait、needs_review、succeeded、dead_letter。
- 幂等键唯一且非空。
- 有 lease owner、lease expiry、attempts、next run、错误摘要。
- 结果保存 station、context hash、model、prompt/schema version、usage、cost、evidence IDs。
- schema 安装必须幂等，不修改现有账号、客户和 router 表。

### A1-03 构建正式 CRM 上下文 adapter

创建建议：

- `lib/ai_stations/context.js`
- `lib/ai_stations/evidence.js`
- `test/ai_station_scope.test.js`

读取：

- `customer_pool`
- `company_screening`
- 最新 `recon_results`、`recon_evidence`
- `person_candidates`、`person_evidence`、`contact_methods`
- 对应 `crm_accounts` 和必要活动摘要

要求：

- 使用现有 `buildAccessContext` 和客户范围断言。
- 无 `view_contacts` 时不查询或发送联系人字段。
- 无 `view_recon` 时不发送 Recon 内容。
- 每条证据生成稳定、可校验的 evidence ID。
- 对可信上下文生成 context hash，保存前再次比较。

### A1-04 通过现有 AI router 执行

创建建议：

- `lib/ai_stations/executor.js`
- `lib/ai_stations/worker.js`
- `scripts/ai-station-worker.js`
- `test/ai_station_executor.test.js`

执行：

1. 调用现有 `callAssistantModel`，不导入新项目 router/provider 配置。
2. 传入结构化 prompt，解析返回 answer 中的 JSON。
3. 记录实际 engine、model、attempts、fallback、usage 和耗时。
4. JSON 或 Schema 失败进入 needs_review，不保存伪结果。
5. 模型失败进入 retry_wait/dead_letter，CRM 业务不受影响。
6. Worker 使用有界并发、租约和优雅退出。

### A1-05 新增受权限控制的 API

修改：

- `lib/access_control.js`
- `lib/sales_crm.js` 或新的 `lib/ai_stations/routes.js`
- `server.js`
- 对应 API 测试

建议接口：

- `GET /api/sales-crm/ai/customers/:customerId/results`
- `POST /api/sales-crm/ai/customers/:customerId/stations/customer_fit/run`
- `POST /api/sales-crm/ai/jobs/:jobId/retry`

权限：

- 读取：现有 `view_customers` + 客户行级范围。
- 执行：现有 `use_ai_assistant` + 客户行级范围。
- 联系人和 Recon 内容继续分别受 `view_contacts`、`view_recon` 限制。
- 新路由全部加入 deny-by-default policy map 和路由匿名化审计。
- 身份检查期间禁止造成后台 AI 写入或使用被检查身份消耗模型。

### A1-06 在正式 CRM 页面显示结果

修改：

- `sales-assets/app.js`
- `sales-assets/app.css`
- `sales-crm.html` 或客户详情模板
- UI contract tests

必须显示：

- 评分、等级、置信度。
- 原因和证据入口。
- prompt/schema/model version 和生成时间。
- queued、running、needs_review、failed、stale 状态。
- 有权限的重试操作。
- AI 不可用时不影响其他客户操作。

禁止：

- 固定演示结果。
- AI 自动改变客户等级、分配或业务阶段。
- 页面直接调用 provider。

### A1-07 阶段 1 验证和发布

验证：

- 完整旧 CRM 测试全部通过。
- 新 Schema、权限、行级范围、联系人脱敏、context hash 和 Worker 恢复测试通过。
- 开发浏览器用管理员、经理、销售三个角色验收。
- 使用开发 DB 的真实结构数据执行一次真实模型 smoke。
- production feature flag 默认关闭。
- 部署后管理员只读触发少量客户，检查成本、延迟和输出质量。

继续门：至少一个正式 CRM 客户页可显示真实 AI 评分，且无越权、无业务状态误改。

### A1-08 AI Control Plane 与任务中心

目标：把当前由 HTTP 请求同步执行的单任务能力升级为可持续承载多客户、多工作站并发的统一执行层。任务中心是 Control Plane 的可见界面，不是本任务的全部。

#### A1-08.1 持久队列和任务依赖

- 所有 AI 业务入口只负责验证权限、生成幂等键并持久入队；模型调用由独立 Worker 执行。
- 扩展 `crm_ai_jobs`，支持父子任务、依赖、优先级、可运行时间、取消请求和关联业务事件。
- 支持小型 DAG；上游成功后才释放下游，失败时按策略进入 retry_wait、needs_review、blocked 或 dead_letter。
- 复用现有 lease、retry 和 context hash；服务或 Worker 重启后任务不丢失、不重复结算。
- 队列积压不阻塞客户创建和 CRM 人工操作，并提供积压量和最老等待时间告警。

状态（2026-07-24）：已完成。HTTP 入口已改为持久入队并快速返回，独立 Worker、持久 DAG/依赖、优先级/定时、取消、租约恢复、执行前权限与行级范围重验、队列积压告警及版本化迁移均已实现并验证。本子任务未包含的跨进程并发治理已由 A1-08.2 完成，预算治理已由 A1-08.3 完成；统一任务中心继续由 A1-08.4 完成。

#### A1-08.2 独立 Worker 池和全局并发治理

- 建立独立 Worker 进程，不再在 Sales CRM HTTP 请求生命周期中等待模型完成。
- 并发槽位必须存放在数据库或后续可替换的 Redis 协调层中，不使用单进程内存计数作为全局限制。
- 按执行资源分别限制并发、速率、超时和熔断：初始建议 DeepSeek API 4、网页搜索/抓取 4、Kimi CLI 1、Hermes 1；全部由环境配置控制。
- 支持公平调度和每客户串行保护，避免单个批量任务占满所有资源或同一客户并发覆盖结果。
- Router 仍是唯一模型入口；Control Plane 管理任务调度，不复制 provider、密钥或管理员路由配置。

状态（2026-07-24）：已完成。新增 SQLite 持久化全局/资源并发槽位、速率窗口、公平调度和每客户租约锁；实际 Router 引擎调用分别占用 DeepSeek、Kimi CLI、Hermes 等资源槽位，Worker 心跳统一续租，成功、重试、取消、权限阻断、429、超时和租约恢复均释放资源。独立 Worker 默认并发为 global 10、DeepSeek 4、web 4、Kimi CLI 1、Hermes 1，支持 JSON 环境配置和 75 秒任务超时。6 个独立 Worker 进程竞争 20 个跨客户任务时全部恰好执行一次，全局实测峰值 4 未越过配置；专项 49/49、全量 307/307、GitHub CI 通过。代码提交 `61815c95e2ced946b3cff5ffe91fde1ad68d0a60`，PR [#18](https://github.com/mewmind-chen/russia-crm-local/pull/18) 已合并到 `codex/ai-integration`，合并 SHA `0a62398d75cdad9ff8bd1480e252d16716209074`。生产 feature flag 和 Worker 仍关闭，本次未部署。

#### A1-08.3 用量、费用和预算

- 统一归一化每次模型尝试的 input/output tokens、估算费用、实际费用、fallback 费用和计费版本。
- 调用前预算预占，调用后按实际 usage 结算并释放差额；usage 缺失时使用保守估算并明确标记。
- 支持公司、团队、用户、Station 四级日/月预算和单任务上限。
- 达到 80% 记录告警；达到 100% 阻止新的非必要调用，但不影响 CRM、历史任务读取和人工流程。
- 重试、fallback、缓存命中和去重都进入同一费用台账，避免一项业务需求被隐藏计费多次。

状态（2026-07-24）：已完成。AI Schema v3 新增持久预算策略、预占、统一 usage/cost 台账和告警；使用 SQLite immediate transaction 对公司、团队、用户、Station 四级日/月预算及单任务上限执行跨进程原子预占，调用结束按每个 Router attempt 结算并释放差额。Provider usage 支持常见 token 字段归一化；缺失 usage、429、超时和失败 fallback 使用带 `pricing_version` 的保守估算并显式标记，实际 provider cost 优先；缓存命中和幂等去重以零费用事件进入同一台账。80% 告警持久化并由独立 Worker 输出，100% 将新的非必要模型调用转为持久 policy block，不消耗任务重试且不影响 CRM 读取和人工流程；租约恢复会释放孤儿预占。公司/团队/用户/Station、双数据库连接竞争、预占/结算、缺失 usage、fallback、429/超时、缓存/去重和 Worker policy block 测试通过；既有 6 Worker/20 跨客户任务测试继续通过，全量 323/323、GitHub CI 通过。代码提交 `502579ff21a71e36ba51df5b10c3cc460b7b2a13`，PR [#20](https://github.com/mewmind-chen/russia-crm-local/pull/20) 已合并到 `codex/ai-integration`，合并 SHA `d9910d29f4bd82bb2c174f520d3bcab2b62c988f`。生产 feature flag 和 Worker 仍关闭，本次未执行真实模型任务或部署。

#### A1-08.4 统一 AI 任务中心

- 纳入当前及未来所有 AI Station 任务、Recon/Prospect AI adapter、模型尝试和结构化结果。
- 对话类 AI 请求至少记录作用域、引擎、耗时、usage/cost 和结果状态；默认不保存或展示完整系统 prompt。
- 显示任务 ID、类型、关联客户、发起人、状态、优先级、依赖节点、队列等待和执行耗时。
- 显示 engine/model、usage/cost、fallback、Prompt/Schema 版本、失败摘要、重试、复核、结果与证据。
- 支持按状态、任务类型、客户、负责人、模型和时间筛选，支持分页、详情时间线、取消、重试和复核。
- 客户详情显示该客户的当前流水线节点；管理员任务中心显示全局队列、并发槽位、预算和失败率。

状态（2026-07-24）：已完成。AI Schema v4 新增不含 prompt/message/history 的对话 AI 运行记录和人工复核历史；统一任务查询层聚合 AI Station、公司 Recon、联系人 Recon、Prospect、经理评价和对话 AI，提供状态/类型/客户/发起人/模型/时间筛选、分页和详情时间线。AI Station 详情显示依赖、模型尝试、usage/cost、fallback、Prompt/Schema 版本、失败摘要、结构化结果和按现有权限裁剪的证据；管理员额外获得全局队列、活跃并发槽位、24 小时/月度成本、预算策略/告警和失败率。正式 CRM 已新增 AI 任务中心页面、客户任务跳转以及权限化重试、取消和复核；经理/销售继续使用现有客户行级范围，非客户任务仅发起人或管理员可见，写操作继续匿名化审计并在身份检查时阻断。对话 AI 成功或失败均只记录作用域、引擎、模型、耗时、usage/cost、fallback、尝试与结果状态，记录失败不影响原请求。专项 18/18、全量 330/330，既有 6 Worker/20 跨客户、多连接竞争、每客户串行、租约恢复、429、超时和 fallback 回归继续通过，GitHub CI 通过。主代码提交 `c50259007817907839b583c72ad1e781b6443a04` 由 PR [#22](https://github.com/mewmind-chen/russia-crm-local/pull/22) 合并，预算概览补丁 `7d602e3` 由 PR [#23](https://github.com/mewmind-chen/russia-crm-local/pull/23) 合并；最终集成 SHA `87d9942d9779c78fbf3cc511feb1e01048558316`。生产 feature flag 和 Worker 仍关闭，本次未执行真实模型任务或部署。

#### A1-08.5 权限、审计和降级

- 列表、详情和操作继续使用现有权限组和客户行级范围；销售不得看到其他销售客户的任务。
- 联系人和 Recon 内容继续分别受 `view_contacts`、`view_recon` 控制，任务摘要也必须脱敏。
- 重试要求 `use_ai_assistant`；取消、批量操作、预算配置和复核分别执行服务端授权。
- 所有操作写入匿名化审计，不记录密钥、Cookie、完整 prompt 或未脱敏联系人内容。
- 开发环境只使用独立开发 Key 和独立额度，不从生产 `.env` 复制 DeepSeek 或其他 provider Key；密钥不进入数据库、Git、任务详情或验收文档。
- AI、Router 或 Worker 不可用时，CRM 和历史任务中心仍可使用；生产 AI Station 开关在本任务完成前保持关闭。

验收：

- 并发提交至少 20 个跨客户任务，任务不丢失、不重复，HTTP 请求无需等待模型结果。
- 多 Worker 竞争、租约过期、进程重启、引擎 429/超时和 fallback 测试通过。
- 全局及每引擎并发不超过配置；同一客户冲突写入被串行化或拒绝。
- 80% 告警、100% 阻止、预占/结算、usage 缺失和 fallback 费用测试通过。
- 所有 AI 业务执行均可在任务中心回顾；管理员、经理、销售三角色范围正确。
- 完整旧 CRM 回归通过，生产保持 flag 关闭并完成只读部署验证。

状态（2026-07-24）：已完成。AI 任务列表、详情和操作继续使用现有权限组、身份检查和客户行级范围，管理员/经理/销售矩阵验证销售只能查看本人客户任务；联系人任务与公司 Recon 任务分别按 `view_contacts`、`view_recon` 对列表和详情摘要独立脱敏，通用错误中的邮箱、电话和 URL 也按权限遮蔽。重试继续要求 `use_ai_assistant`，取消、最多 50 项的原子批量操作、预算配置和复核新增独立服务端权限；任一批量目标越权或状态非法时整批回滚。AI 写操作继续使用匿名化路由审计，不记录任务/客户/scope ID、请求正文、Cookie、完整 prompt 或 provider 密钥。CRM 与历史任务 API 在 Worker 缺席或 Router 失败时仍可读取，任务中心刷新失败时保留上次成功数据并显示降级提示。A1-08 专项 88/88、完整回归 335/335，既有 6 Worker/20 跨客户、全局/引擎并发、每客户串行、租约恢复、429/超时/fallback 和四级预算回归继续通过；GitHub CI 通过。代码提交 `f79ff85b38662d254fe190a556109f041bd3df66` 由 PR [#25](https://github.com/mewmind-chen/russia-crm-local/pull/25) 合并，最终集成 SHA `a226dd2cc5c565e137def0d4396eed086fb1805d`。生产只读核对仍为 `92e9f609026eaf67c03ac7651cbaa7a6b616e929`、首页 200、数据库健康，AI Station 和 Worker 保持关闭；未部署、未修改生产数据库、未执行真实模型任务或读取生产 provider 密钥。证据见 `tradepulse-development/artifacts/a1-08-5-permissions-audit-degradation-20260724T033129Z.md`。A1-08 整体完成，下一步 A1-09。

### A1-09 新客户自动补全闭环

目标：销售只输入公司名、官网或最小线索即可立即建立客户；AI 在后台完成资料补全和判断，结果带证据进入现有 CRM，而不是要求销售等待一次长模型请求。

状态（2026-07-24）：A1-09.1 已完成。最小客户创建现在接受公司名或官网，官网执行规范化且国家可选；客户、CRM account 和 enrichment run 在同一事务中落库并立即返回。自动补全沿用 `create_customer`、`view_customers`、`use_ai_assistant`、`run_recon`、`view_recon`、`view_contacts` 和客户行级范围，创建时缺权或 flag 关闭只跳过 enrichment，不阻断客户创建；dispatcher 在创建 DAG 前再次重建权限和客户范围。AI schema v5 新增持久 run、node link 和 completion-event outbox，A1-08 Worker 新增 `beforeClaim`，独立进程每轮最多领取一个 trigger；稳定 workflow/idempotency 防止竞争重复，当前仅 `intake_precheck` 可领取，后续六个节点仅持久投影，不会误触发外部 Worker。代码提交 `d913e9e78ccb9aeee80975ab6ea927c5242ecfbf` 由 PR [#28](https://github.com/mewmind-chen/russia-crm-local/pull/28) 合并，集成 SHA `03089063d69727ac14a1464e21096bf0165cf85f`；聚焦测试 86/86、完整回归 350/350、GitHub CI 通过，既有 6 Worker/20 跨客户、租约恢复、每客户串行和 429/超时回归继续通过。生产两个 enrichment flag 默认关闭，未部署、未修改生产数据库、未读取生产 provider 密钥。证据见 `tradepulse-development/artifacts/a1-09-1-minimal-enrichment-dag-20260724T042853Z.md`。下一步 A1-09.2：去重、官网/主体验证和字段级证据模型。

状态（2026-07-24）：A1-09.2 已完成。AI schema v6 新增 canonical enrichment evidence 与字段 provenance，强制 URL、采集时间、内容哈希、置信度、采集器和版本，并区分 `employee_confirmed` 与 evidence-backed `ai_provisional`；联系人敏感摘要在持久化前脱敏。创建前按 canonical domain 与 normalized name 精确去重并返回稳定 409 identity；模糊候选只进入复核、绝不自动合并。`identity_verify` 已成为 `intake_precheck` 的依赖后可运行节点，使用注入 resolver，证据不足、低置信度、风险命中、主体不确定和 possible duplicate 均不写规范字段；节点执行前再次校验外部能力权限。代码提交 `94554af0ab0f2ed84be42704cb8034bf875757e8` 由 PR [#30](https://github.com/mewmind-chen/russia-crm-local/pull/30) 合并，集成 SHA `59242c459215cbdf64c894f21a8963b3c515e2fd`；聚焦测试 107/107、完整回归 361/361、GitHub CI 通过。生产 AI Station、Worker 与 enrichment flags 继续关闭，未部署、未修改生产数据库、未读取或复制生产 provider 密钥。证据见 `tradepulse-development/artifacts/a1-09-2-identity-evidence-20260724T044520Z.md`。下一步 A1-09.3：Recon/Contact adapter 与持久完成唤醒。

状态（2026-07-24）：A1-09.3 已完成。`recon_dispatch`/`contact_dispatch` 通过持久 adapter 创建或复用 legacy Recon/Contact Recon 任务，外部任务创建前执行预算预占，缺失用量按 `estimated_missing` 保守结算，任务中心仅暴露安全关联 ID、类型、节点和状态。Recon/Contact 结果与 completion event 在同一数据库事务提交；事件消费者使用幂等 key、租约和依赖作业实现崩溃恢复，重复回调不会重复创建 collect 或后续 dispatch。既有取消权限和匿名化审计边界继续生效；已完成 adapter 但仍绑定活动 legacy 任务时仍可取消，排队任务立即终止，运行中 Python Worker 在外部执行前、执行中 heartbeat 和提交前响应取消并释放租约；迟到结果只保留原始证据，不覆盖客户或联系人主数据。代码由 PR [#32](https://github.com/mewmind-chen/russia-crm-local/pull/32) 合并，集成 SHA `6eb423de8f1d7a2a7a661842663a3b4c8e5b9bee`；聚焦 adapter/event/cancel/API 回归 39/39，完整回归 374/374，两个 Python Worker 编译和 GitHub CI 通过。生产 AI Station、Worker 与 enrichment flags 继续关闭，未部署、未修改生产数据库、未执行真实模型任务或读取生产 provider 密钥。证据见 `tradepulse-development/artifacts/a1-09-3-legacy-workflow-adapters-20260724T050735Z.md`。下一步 A1-09.4：字段提案、复核、finalize 和客户 UI。

状态（2026-07-24）：A1-09.4 已完成。AI schema v7 新增 evidence-backed 字段提案；机械规范化保留审计，空字段只在证据匹配时以 `ai_provisional` 自动写入，`employee_confirmed` 字段、可靠来源冲突和上下文变化分别进入保护、人工复核或 superseded。`enrichment_finalize` 只产生 `missing_info`、`needs_review`、`pending_assignment`，并持久化完整度、缺失项和标签。新增受保护的补全查询/启动/取消/提案复核 API，继续执行客户行级范围、完整启动权限、身份检查写阻断、feature flag、联系人/Recon 脱敏和匿名化审计；A1-08 任务中心现在投影补全 run/node，同时保留 legacy Recon 链接。客户创建 UI 支持公司名或官网、国家可选，并显示节点、证据、暂定标记、冲突前后值、接受/拒绝、重试、取消；非终态轮询有界，读取降级时保留上次成功结果。代码由 PR [#34](https://github.com/mewmind-chen/russia-crm-local/pull/34) 合并，集成 SHA `08e96e8c6f8162098b918c69fd25cf29214fcb54`；A1-09 聚焦 49/49、完整回归 386/386、Python 编译、JS 语法检查和 GitHub CI 通过。生产 AI Station、Worker 与 enrichment flags 继续关闭，未部署、未修改生产数据库、未读取生产 provider 密钥。证据见 `tradepulse-development/artifacts/a1-09-4-proposals-api-ui-20260724T053236Z.md`。下一步 A1-09.5：三类结构化 E2E、6 Worker/20 跨客户并发故障矩阵和隔离开发真实模型 smoke。

状态（2026-07-24）：A1-09.5 与 A1-09 整体已完成。三类结构化 E2E 覆盖仅公司名、仅官网和不完整既有客户，验证完整 DAG、证据、暂定字段和 owner 不变；6 个独立 Worker 进程完成 20 个跨客户补全任务，未重复执行或突破全局槽位，同客户在多连接间保持串行。故障矩阵覆盖 trigger/event/AI/Recon/Contact Recon 租约恢复、429、超时、fallback、永久失败、预算阻断、权限撤销、owner scope 变化、去重、主体不确定、无联系人、证据冲突和取消后迟到结果。开发 smoke 新增隔离数据库 identity 绑定、单一绝对 deadline、输出 allowlist 和生产路径/端口拒绝；默认 identity resolver 只信任当前值哈希匹配的 `employee_confirmed` provenance，并拒绝凭据、私网、本地及特殊用途 URL。隔离开发真实模型验证中，IANA 客户通过持久任务的受保护重试由 Hermes 成功执行，最终 `needs_review`、完整度 100、16 条规范证据且 owner 未变化；该 smoke 明确记录首次短窗口失败及 durable manual retry，不使用生产凭据。代码由 PR [#36](https://github.com/mewmind-chen/russia-crm-local/pull/36) 合并，集成 SHA `35341e8f6f291c62b86c24800100e0d692e439e5`；最终 A1-09 聚焦 62/62、smoke/identity 14/14、完整回归 408/408、两个 Python Worker 编译、GitHub CI 和独立代码复审通过。生产 current/health 仍为 `92e9f609026eaf67c03ac7651cbaa7a6b616e929`，AI Station、Worker 与 enrichment flags 默认关闭，未部署、未修改生产数据库。证据见 `tradepulse-development/artifacts/a1-09-5-e2e-smoke-20260724T0644Z.md`。下一步 A2-01：扩展合同。

触发和流水线：

1. 创建最小客户记录并立即返回；批量导入和明确要求重新补全也可生成同一流水线。
2. 服务器先执行去重、域名规范化和风险预检。
3. 识别并验证官网、真实经营主体、国家和基础公司信息。
4. 通过现有 Recon/网页能力采集实时来源，提取行业、产品、规模、业务类型和潜在需求。
5. 搜索公开联系人、采购入口和联系方式；继续遵守联系人权限和合规限制。
6. 生成 `customer_fit`、资料完整度、自动标签、证据和待补查项。
7. 根据结果进入待补查、人工复核或待分配；分配仍由阶段 2 的规则和审批完成。

数据和页面要求：

- 使用 A1-08 DAG 编排每个节点；同一客户/同一上下文重复触发时去重。
- 每个提取字段保留来源 URL、抓取时间、置信度和生成版本；禁止无证据字段成为已确认事实。
- AI 不静默覆盖员工确认字段；冲突结果进入复核并保留前后值。
- 客户页实时显示每个节点的 queued、running、succeeded、needs_review、failed 和跳过原因。
- 允许人工补充、确认或驳回结果，并把反馈写入审计和后续评估数据。
- AI 不可用、预算耗尽或网页抓取失败时，最小客户记录仍可正常查看和人工编辑。

验收：

- 用“只有公司名”“只有官网”“资料不完整的已有客户”三类真实结构样本完成端到端测试。
- 页面能看到公司画像、产品/需求、联系人候选、评分、标签、完整度和对应证据。
- 重复客户、官网不确定、无联系人、证据冲突、预算阻断和模型故障路径均有明确状态。
- 所有任务出现在 A1-08 任务中心，费用被正确归集，三角色权限和联系人脱敏通过。
- 不自动外发、不自动改变客户归属；完成阶段 2 前只进入待补查、复核或待分配队列。
- 开发真实模型 smoke 和完整回归通过后，才允许申请生产影子运行。

## 6. 阶段 2：判断与分发闭环

**目标：** 完成原始步骤 04-08。
**预计：** 4-6 个工作日。

### A2-01 扩展合同

迁入并测试：

- `contact_readiness`
- `distribution_priority`
- `sales_match`

状态（2026-07-24）：已完成。迁入三个严格 v1 合同、Prompt Registry 和 fail-closed AJV 校验；证据只接受允许来源，销售候选只接受服务端生成的正整数快照 ID，并拒绝未知、重复或稀疏快照；验证后的输出保持不可变。代码由 PR [#38](https://github.com/mewmind-chen/russia-crm-local/pull/38) 合并，合并提交 `1ef5e17`；聚焦合同测试 19/19，完整 Node 回归 421/421，JavaScript 语法检查、三个 JSON Schema 解析和 `git diff --check` 通过，独立复审为 0 critical、important、minor。首次 GitHub CI 的既有多进程 enrichment 并发测试出现一次时序抖动，未改动文件对照与隔离复跑通过，重跑 CI 成功。未接入触发、持久化、UI、router/provider、生产部署、feature flag 或业务状态写入；生产 current/health 仍为 `92e9f609026eaf67c03ac7651cbaa7a6b616e929`，AI Station、Worker 和 enrichment flags 保持关闭。下一步 A2-02：联系就绪触发。

### A2-02 联系就绪触发

- customer_fit 成功后触发 contact_readiness。
- 联系人/联系方式变化时让旧结果 stale。
- not_ready/partial 生成补研建议，不进入自动分配。

状态（2026-07-24）：已完成。基于 `codex/ai-integration` @ `0add7f6` 在
`codex/ai-contact-readiness-a2-02` 接入 `contact_readiness` 运行时：Worker 只扫描
schema v8 上线后成功的 `customer_fit`，按 fit、联系人和联系方式上下文幂等创建后继任务；
enrichment DAG 调整为 `contact_collect -> customer_fit -> contact_readiness ->
enrichment_finalize`。输出只接受服务器联系人 ID 白名单；联系人 Recon、包含联系人字段的
普通 Recon 和手工联系人新增会原子地将旧结果标为 stale，并取消旧排队任务或请求取消运行任务。
`partial/not_ready` 写入补研建议并优先保持 `missing_info`，不会改变 owner、创建 intake 或进入
`distribution_priority/sales_match`。聚焦验收 9/9、完整 Node 回归 427/427、全部改动 JavaScript
语法检查、JSON Schema 解析和 `git diff --check` 通过。证据见
`docs/evidence/a2-02-contact-readiness.md`。实现提交为 `d96a48c`，PR
[#44](https://github.com/mewmind-chen/russia-crm-local/pull/44) 已合并到
`codex/ai-integration` @ `c6b2150`，CI `test` 通过；尚未部署，生产 current/health 与 AI
Station、Worker、enrichment flags 均未变化。下一步 A2-03：销售候选快照。

### A2-03 销售候选快照

- 服务端从现有有效 sales_users、权限、国家、语言、渠道和负荷生成候选集。
- 创建一次性整数 token 到文本 sales user ID 的快照映射。
- AI 只能排序快照 ID；陌生或重复 ID 拒绝。
- 快照过期或销售状态变化时重新计算。

状态（2026-07-24）：已完成。schema v9 新增 `crm_ai_candidate_snapshots` 和
`crm_ai_candidate_snapshot_items`，服务端按有效 `sales_users`、生效权限、国家/语言/渠道匹配、
当前在手负荷和每日配额生成稳定候选；每次快照将真实文本销售 ID 映射为从 1 开始的一次性正整数，
模型上下文只接收 token 和能力摘要。快照保存上下文 hash、候选状态 hash、创建/过期时间和可选
AI job 绑定；重复上下文幂等复用，销售停用、权限/能力/负荷变化或过期后标记失效并要求重算。
服务器解析排名时拒绝陌生、重复、不完整或已失效的 token，映射回真实销售 ID 仅留在服务端。
未接入 `chooseIntakeOwner`、规则最终裁决、owner/intake 写入、页面、外发或生产开关。
聚焦验收 3/3，完整 Node 回归 430/430，JavaScript 语法检查和 `git diff --check` 通过；
GitHub CI `test` 通过。PR [#46](https://github.com/mewmind-chen/russia-crm-local/pull/46)
已合并到 `codex/ai-integration` @ `51aecaa`，证据见
`docs/evidence/a2-03-candidate-snapshots.md`；尚未部署。

### A2-04 规则最终裁决

- 将 AI 排名作为 `chooseIntakeOwner` 的建议输入。
- 每日配额、在手负荷、重复客户、风险阻断和权限继续由事务内规则决定。
- 低置信度、高价值、冲突或跨团队情况进入经理审批。
- AI 不可用时沿用现有确定性匹配。

状态（2026-07-24）：已完成。新增 `assignment_arbitration` 裁决层：仅允许有效且具备
`view_intake` 的销售进入候选；事务内重新读取授权销售、在手负荷和当日配额。AI 与确定性
`chooseIntakeOwner` 一致且置信度足够时自动分配，AI 不可用时确定性回退；冲突、候选失去资格、
低置信度、高价值、风险阻断、跨团队和重复客户进入经理审批或规则阻止。A2-03 快照 token
只在服务端解析，过期、状态变化、非法或不完整排名 fail-closed。`scanDailyIntake` 和
`bulk_assign` 已接入裁决层，手动 owner 写入复用授权校验。聚焦验收 5/5，完整 Node 回归
435/435，语法检查、`git diff --check` 和 GitHub CI `test` 通过。实现提交 `ea8fb8b`，
PR [#49](https://github.com/mewmind-chen/russia-crm-local/pull/49) 已合并到
`codex/ai-integration` @ `4e4619e`；证据见 `docs/evidence/a2-04-assignment-arbitration.md`。
未实现 A2-05 页面与完整审计 UI，尚未部署，生产 current/health、previous 和
`CRM_AI_STATIONS_ENABLED=false` 未变化。下一步 A2-05 页面与审计。

### A2-05 页面与审计

- 入库队列显示 fit、readiness、priority、候选销售排名和阻断原因。
- 审批显示 AI 推荐、规则裁决和人工最终决定三层信息。
- 每次分配保留候选快照、规则结果、人工操作和审计。

状态（2026-07-24）：已完成。新增 `crm_intake_decisions` 决策历史表，记录自动/批量裁决、
候选快照 ID、AI 推荐、规则结果、人工最终决定和操作者；bootstrap 返回 Fit/readiness/priority、
候选排名、三层裁决和 `assignmentAudit`。入库队列及详情抽屉已展示 Fit/readiness/优先级、
候选销售排名、规则裁决、阻断原因、人工决定和审计轨迹；销售端按 owner 范围脱敏候选排名。
专项验收 7/7，完整 Node 回归 437/437，语法检查、`git diff --check` 和 GitHub CI `test`
通过。实现提交 `2d04abc`，PR [#51](https://github.com/mewmind-chen/russia-crm-local/pull/51)
已合并到 `codex/ai-integration` @ `92e64cc`；证据见
`docs/evidence/a2-05-intake-review-audit.md`。尚未执行生产迁移、部署或打开 AI 开关。
下一步 A2-06 验收门。

### A2-06 验收门

- 同一客户并发扫描不重复创建 intake/account。
- 非候选销售不能被 AI 指定。
- 规则阻断不能被 AI 越过。
- AI 故障时现有自动/人工分配可继续。
- 管理员、经理、销售权限测试全部通过。

状态（2026-07-25）：已完成。并发扫描、owner scope/分页、AI 越权阻断、规则最终裁决、
AI 故障确定性回退和管理员/经理/销售权限均通过专项验收；Issue #62 同步完成销售 CRM
体验对齐，包括漏斗累计口径与说明、入库中心服务端搜索/分页/国家及负责人筛选、批量负责人
确认、按筛选导出带 UTF-8 BOM 的 CSV、经理评价入口、客户资料跟进入口、hash 导航/浏览器
后退、销售待领取落地和移动端横向滚动/弹窗操作区。专项 7/7、受影响回归 18/18、
完整回归 466/466，语法检查和 `git diff --check` 通过；本地 `PORT=3101` 管理员登录、
`#intake` 导航/后退及 390px smoke 通过。证据见
`docs/evidence/issue-62-a2-06-acceptance.md`。尚未合并到 `main`、执行生产迁移或部署，
生产 `CRM_AI_STATIONS_ENABLED=false` 及其他 AI 开关继续关闭。下一步 A3-01 `sales_pack`：
销售认领后异步生成只读销售包，展示摘要、切入点、风险和草稿，但不自动外发消息。

## 7. 阶段 3：销售执行闭环

**目标：** 完成原始步骤 09-14。
**预计：** 4-6 个工作日。

### A3-01 `sales_pack`

- 销售认领成功后异步入队。
- 读取当前客户、证据、联系人和产品信息。
- 在客户详情显示摘要、切入点、风险和草稿。
- 不自动发送邮件、企微或社媒消息。

状态（2026-07-25）：已完成。认领成功后通过 `customer_claimed` 事件幂等入队
`sales_pack@v1`，独立 AI Station Worker 执行并在客户详情显示摘要、切入点、风险、
人工审核草稿及任务状态；生成结果写入 `SALES_PACK_READY` 内部通知，企微状态固定为
`disabled`，不自动外发。新增环境硬门禁 `CRM_AI_SALES_PACK_ENABLED`，并在管理员面板
提供 `ai_stations`、`customer_enrichment`、`customer_enrichment_auto_trigger`、
`sales_pack` 四个持久化运行时开关；开关变更仅真实管理员可操作并写入审计，关闭时保留已有
队列但阻止新入队/新领取。Worker 已加入 launchd、部署和回滚服务清单。A3-01 专项测试、
AI 开关、API/Worker/合同/权限/UI/部署聚焦测试 50/50，完整回归 476/476，语法和
`git diff --check` 通过。证据见
`docs/evidence/a3-01-sales-pack-and-ai-flags.md`。PR [#66](https://github.com/mewmind-chen/russia-crm-local/pull/66)
已合并集成，发布 PR [#67](https://github.com/mewmind-chen/russia-crm-local/pull/67)
已合并 `main` @ `8de1076` 并完成生产部署；下一步 A3-02 `action_proposal`。

### A3-02 `action_proposal`

- 销售输入自然语言触达结果。
- AI 生成待确认 activity type、channel、outcome、summary、next action 和时间。
- 页面回显；员工确认后才调用现有 activity API。
- 低置信度或字段不完整时保留草稿。

状态（2026-07-25）：已完成开发与本地验收。新增严格 `action_proposal@v1` 合同，
销售可在“记录客户动作”弹窗输入自然语言，由持久 AI 队列和独立 Worker 异步生成
activity type、channel、outcome、summary、next action 和时间草稿。结果固定
`reviewRequired=true`；页面回填后仍需员工核对、修改并点击“确认并记录”，才会调用现有
`/activities` API。低置信度和缺失字段显示警告，字段未补全时服务端拒绝写入；通用 AI
任务复核接口不能绕过活动表单，一次性消费记录保证同一提案只生成一条活动。完整回归
480/480、语法和 `git diff --check` 通过；本地浏览器完成桌面与 390px 生成/回填验收，
AI 任务中心显示“活动提案/需要复核”，未点击确认且未写入客户活动。证据见
`docs/evidence/a3-02-action-proposal.md`。当前进入 PR、CI 和生产发布门；完成后停止，
下一步为 A3-03 `next_action`，本轮不实现。

### A3-03 `next_action`

- 新活动、回复、会议、RFQ、报价后异步触发。
- AI 只建议动作和时间，不直接写业务事实。
- 销售确认或规则采纳后进入现有 next_action 字段和提醒。
- AI 失败时确定性 SLA 扫描继续工作。

状态（2026-07-25）：已完成 `next_action@v1` 全流程。活动、回复、会议、RFQ
经 `/activities` 写入，报价经 `/quotes` 写入后均以事件幂等入队；独立 Worker
生成严格结构化建议并进入 `needs_review`。客户页显示建议、任务入口、动作/时间/经理
介入字段；只有授权员工点击采纳（可编辑后提交）才写入既有
`crm_accounts.next_action/next_action_at`，并复用今日待办、超期提醒和客户时间线。
通用任务复核不能绕过采纳接口；权限撤销、owner scope、重复事件、Worker 重启和 AI
失败均 fail-closed，确定性 SLA 提醒继续工作。schema 从 v10 升到 v11，新增一次性
消费审计表。专项 24/24、完整回归 488/488、语法和 `git diff --check` 通过，
桌面与 390px 客户页验收通过；证据见 `docs/evidence/a3-03-next-action.md`。
已合并 `main` 并完成生产 backup/quick_check、回滚点确认、部署和 smoke；生产 AI
开关保持显式开启。下一项为 A3-04 消息和认领，本轮完成后停止。

### A3-04 消息和认领

- 复用现有 CRM 通知和企微基础。
- 统一任务投递状态和幂等键。
- 渠道失败保留网页通知。
- claim/return/reject 重复提交保持幂等。

状态（2026-07-25）：已完成通知和认领闭环。新增 `crm_notification_deliveries`，将
网页和企微投递拆分为独立状态、尝试次数、租约、错误和幂等键；企微不可用或未配置时
保留网页未读通知。新增 `crm_intake_action_requests`，claim/return/reject 通过服务端
幂等键安全重放，重复 claim 不重复创建客户。生产部署目标为合并 SHA
`b6da19e8b018ba7d35629e6c1d32062eadee1664`，回滚点为 `bf15ad7e2de632a02d1858dd22cd72a74f8c3db2`；
专项/受影响回归 64/64、完整回归 492/492、生产隔离验证 492/492，数据库
`quick_check=ok`，通知和三类认领 smoke 通过。证据见
`docs/evidence/a3-04-notifications-claims.md`。本轮完成后停止，下一项为 A3-05。

### A3-05 RFQ、报价和订单边界

- 复用现有业务对象和阶段推进。
- AI 可提取 RFQ 摘要和生成跟进建议。
- 金额、币种、毛利、报价外发和订单确认由授权员工操作。
- 不允许 AI 直接创建订单或修改金额。

状态（2026-07-25）：已完成 RFQ/报价/订单边界。RFQ 的 BOM 行数、预估金额和资料
完整度在写入前校验；报价校验金额、币种和毛利，并通过
`crm_commerce_action_requests` 记录服务端幂等状态；订单必须关联同一客户的已有报价，
金额、币种和毛利仍由具备 `record_order` 的员工提交。订单界面要求明确选择报价并发送
客户端幂等键。RFQ/报价事件继续复用 `next_action@v1` 生成跟进建议，AI 不具备报价、
外发或订单写入路径。专项 3/3、完整回归 495/495、主线 CI、生产
`quick_check=ok` 和 RFQ/报价/订单 smoke 均通过。生产 current 为
`bd0953c2eee0e92ab1f2f4e6f8da08a38c5ec27f`，回滚点为
`9545213db522a2b001498637df4b7cdc08ad75ae`。证据见
`docs/evidence/a3-05-rfq-order-boundary.md`。本轮完成后停止，下一项为 A3-06。

### A3-06 验收门

- 认领到资料包、人工触达、活动、下一步、RFQ、报价、订单可在一个客户时间线看到。
- 外发、金额和订单均有人工确认。
- Worker 重启不丢任务、不重复业务写入。
- 企微不可用时网页流程完整。

状态（2026-07-25）：已完成阶段 3 销售执行验收门。客户 bootstrap 和客户抽屉统一展示
认领、`sales_pack`、人工 activity、人工采纳的 `next_action`、RFQ、报价和订单七类
时间线事件；资料包和下一步建议均保持人工复核，外发、金额和订单继续由授权员工确认。
专项 2/2、受影响回归 78/78、完整回归 497/497、GitHub CI、Node/Zsh/Python
语法和 `git diff --check` 均通过。验收测试覆盖 Worker 租约过期后由新 Worker 恢复、
结果唯一写入、认领/建议采纳/报价/订单幂等，以及企微失败时网页通知保持可用。PR
[#77](https://github.com/mewmind-chen/russia-crm-local/pull/77) 已合并 `main` @
`35858514259af935884e7745fd2e8db6db35e9ad` 并完成生产备份、`quick_check`、回滚点确认、
部署和 local/public smoke；证据见 `docs/evidence/a3-06-sales-execution-gate.md`。
阶段 3 已完成；A4-01 已进入下方阶段 4 执行记录。
## 8. 阶段 4：经理监督与反馈

**目标：** 完成原始步骤 15-16。
**预计：** 4-7 个工作日。

### A4-01 `manager_anomaly`

- 规则扫描会议无 RFQ、RFQ 未报价、报价无回复、高价值停滞和负荷不均。
- AI 只解释异常、排序和提出干预建议。
- 经理团队范围由服务端确定。
- 经理决定实际干预。

状态（2026-07-25）：已完成。服务端在授权客户范围内确定性扫描五类异常，AI 只输出
中文解释、优先分和人工介入建议，异常/客户/证据 ID 均执行白名单校验；销售无法读取
团队异常或从通用任务中心绕过。补齐用户可见通知中心、本人已读边界、客户跳转和
网页渠道降级，并将结构化 AI、自由问答和经理评价的员工可见分析统一约束为简体中文。
聚焦 26/26、全部 AI 回归 214/214、完整回归与生产隔离验证 503/503，桌面和 390px
浏览器验收、GitHub CI、生产 backup/quick_check、回滚确认和 local/public smoke 均通过。
PR [#79](https://github.com/mewmind-chen/russia-crm-local/pull/79) 已合并 `main` @
`a7f2841c8edcbe534e44ce8c3628873b764e224a` 并发布；四个 AI 开关保持显式开启。证据见
`docs/evidence/a4-01-manager-anomaly.md`。下一项为 A4-02 `sales_coaching`，本轮不实现。

### A4-02 `sales_coaching`

- 只使用聚合后的真实活动、转化和 SLA 结果。
- 样本不足时明确标记，不输出伪精确结论。
- 在现有团队能力页面显示优势、差距和建议。

状态（2026-07-25）：已完成。`sales_coaching@v1` 只接收授权团队的聚合活动、转化、
订单和 SLA 指标，不包含客户身份、联系方式或单条活动正文；少于 10 个真实观察样本时
不调用模型，10-29 个样本限制置信度，所有结果保持经理人工复核并强制中文展示。销售
无法查看团队辅导或从任务中心绕过，内部持久化锚点不对外显示；结果完成后创建本人网页
通知。聚焦 36/36、AI 220/220、本地/GitHub CI/生产隔离完整回归均为 508/508，隔离库
浏览器、backup/quick_check、回滚确认和 local/public smoke 通过。PR
[#82](https://github.com/mewmind-chen/russia-crm-local/pull/82) 已合并 `main` @
`cbf8c596db315a88bb921529794e75d539ce32f3` 并发布，current `cbf8c596db31`、previous
`8f3df69dafa9`，四个 AI 开关保持开启。证据见
`docs/evidence/a4-02-sales-coaching.md`。下一项为 A4-03 反馈和版本治理，本轮不实现。

### A4-03 反馈和版本治理

- 保存成交、回复、退回、停滞和人工驳回标签。
- 按模型、prompt version、规则版本计算对照指标。
- 新策略先影子运行，不在线自动替换。
- 发布需要管理员/经理批准并保留旧版本回滚。

状态（2026-07-25）：开发、CI 和生产发布完成。新增五类中文
业务反馈标签及模型/Prompt/规则版本对照指标；策略严格经过影子运行、评估、申请发布、
人工批准和旧版本回滚，模型不能自行发布。管理员和授权经理可见治理面板，销售和身份
检查状态均被服务端阻断。浏览器验收发现并修复动态治理 API 未映射权限策略，以及
390px 顶栏 7px 横向溢出；完整治理流程、Qwen 在线/Batch 开关和桌面/390px 页面通过。
最终完整回归 `531/531`，全部修改 JavaScript 语法和 `git diff --check` 通过。同期按
Issue #81 完成 Qwen 在线路由和文件式 DashScope Batch 通道；证据见
`docs/evidence/a4-03-ai-governance.md` 和 `docs/evidence/issue-81-qwen-online-batch.md`。
PR #84 与生产验收修复 PR #85 均通过 CI；最终生产 `current=296edd268162`、
`previous=a1e7043a2165`，活动库/备份 `quick_check`、local/public health、Qwen 在线真实
调用和 Batch 禁用态退出均通过。下一项为 A4-04，本轮不实现。

### A4-04 验收门

- 经理只能看到授权团队。
- 销售看不到团队级敏感数据。
- AI 不在线修改 prompt、模型或规则。
- 新旧版本指标可比较，旧决策仍可解释。

状态（2026-07-25）：已完成开发、CI 和生产发布。现有服务端客户范围、
团队权限和治理写入门禁通过专项验收；AI schema v16 为新任务保存不可变决策版本快照，
任务详情新增白名单化 `decisionTrace` 和“决策版本与证据”页面，历史任务使用明确的
`v1` 兼容值。治理策略的创建、影子评估、批准和回滚前后，在线 Prompt Registry 与
模型策略保持不变；新旧模型、Prompt 和规则版本指标可同时比较。聚焦 `40/40`、完整
回归 `535/535`、GitHub CI、JavaScript 语法和 diff 检查通过；隔离数据库桌面和实际
`390×844` 浏览器验收无溢出或控制台错误。PR #87 合并为 `e1d3e611f5ef`；生产两份
备份、活动库与备份 `quick_check`、schema v16、local/public health、公网页面和未登录
边界通过，previous 为 `d03092ec8b25`。证据见 `docs/evidence/a4-04-stage-gate.md`。
正式进度为 `35/38`，剩余 3 项，下一项为 R5-01 影子运行。

## 9. 阶段 5：生产试运行与正式开放

**目标：** 从影子运行逐步开放。
**预计：** 5-10 个工作日，可与阶段 4 后半段重叠。

### R5-01 影子运行

- 只保存 AI 结果，不改变分配和业务状态。
- 记录成功率、P50/P95 延迟、重试率、needs_review、成本和证据拒绝率。
- 人工抽检评分、就绪度、匹配、资料包和下一步建议。

### R5-02 小范围开放

- 先管理员，再经理，再少量销售。
- 每个工作站独立 feature flag。
- 记录采纳、修改、驳回及原因。

### R5-03 全员开放门

- 无越权或联系人泄露。
- AI 故障不阻断 CRM。
- 成本和并发未超过配置上限。
- 关键结果达到约定人工质量门槛。
- 生产备份、代码回滚和 feature flag 关闭均验证成功。

## 10. 每次任务的标准验证模板

每个任务完成后必须记录：

```text
Task ID:
Branch:
Commit SHA:
Changed files:
Database migration:
Feature flag:
Commands run:
Test pass/fail counts:
Browser roles tested:
Production impact:
Rollback point:
Known gaps:
Decision: continue / stop
```

禁止使用“代码已写完”“smoke 通过”代替上述记录。

## 11. 执行顺序和依赖图

```text
E0-01 生产基线
  -> E0-02 干净开发根
  -> E0-03 部署能力整合
  -> E0-04 路径保护
  -> E0-05 PR 合并
  -> E0-06 不可变 release
  -> E0-07 在线备份
  -> E0-08 生产切换
  -> E0-09 部署控制器
  -> E0-10 AI 开发实例
  -> 阶段 0 验收
  -> A1-01..A1-07 customer_fit 可见纵切
  -> A1-08 AI Control Plane
  -> A1-09 新客户自动补全闭环
  -> A2 判断与分发
  -> A3 销售执行
  -> A4 经理与反馈
  -> R5 影子运行和逐步开放
```

## 12. 里程碑

| 里程碑 | 目标时间 | 可见结果 |
|---|---:|---|
| M0 环境统一 | 2-3 个工作日 | 生产 SHA 可验证，开发/生产 DB 隔离 |
| M1 首个 AI 纵切 | 已完成 | 正式 CRM 客户页显示真实 customer_fit |
| M1.1 AI 执行底座 | M1 后 4-7 个工作日 | 多任务异步执行、全局并发、预算和统一任务中心 |
| M1.2 新客户补全 | M1.1 后 4-7 个工作日 | 最小线索自动补全为有证据的客户画像并进入复核/待分配 |
| M2 判断分发 | M1.2 后 4-6 个工作日 | AI 排名进入现有审批和规则分配 |
| M3 销售执行 | M2 后 4-6 个工作日 | 认领、资料包、触达、下一步、交易时间线 |
| M4 经理与反馈 | M3 后 4-7 个工作日 | 异常解释、辅导和版本对照 |
| M5 受控生产 | 从当前约 5-8 周 | 分批开放且可关闭、可回滚；取决于真实数据质量和外部 API 稳定性 |

## 13. 本计划开始执行的条件

开始 E0-01 前确认：

- [ ] 上位主计划内容认可。
- [ ] 本执行计划的任务顺序认可。
- [ ] 允许创建 `tradepulse-development`，但不删除旧目录。
- [ ] 允许在通过测试和 PR 合并后，对 production/current 做一次原子切换。
- [ ] 现有账号、权限和 AI router 必须原样保留。
- [x] 阶段 0 完成前不开始 AI 业务集成。

确认后先只执行 E0-01 至 E0-05。到达生产切换前再次报告目标 SHA、备份路径、回滚目标和验证结果；确认迁移前置条件满足后，再执行 E0-06 至 E0-10。

## 14. 当前执行记录

更新时间：2026-07-24

| 任务 | 状态 | 实际证据 |
|---|---|---|
| E0-01 | 已完成 | `tradepulse-production/state/preflight-20260723-152138.md`；本地/公网首页 200；SQLite `quick_check=ok`、WAL；8 个 LaunchAgent 可识别 |
| E0-02 | 已完成 | `tradepulse-development/repo` 的 main 等于 `origin/main`；外置 `worktrees/environment-unification` 已建立；旧脏仓库未改变 |
| E0-03 | 已完成 | donor 已按目标文件范围合入；bootstrap、失败回滚、健康检查和不可变 release 测试通过；提交 `3a894d9210fdffdeaa7711ab420402b390d9a140` |
| E0-04 | 已完成 | realpath 路径保护、隔离测试 runtime 和 `docs/development.md` 已完成；提交 `944d9f56f7be45763b21faeee0ceda715713c94c` |
| E0-05 | 已完成 | PR [#11](https://github.com/mewmind-chen/russia-crm-local/pull/11) 已合并；最终 `origin/main` 为 `060e3859ca776e0698f31b685b1e4328ee74dfba`；本地 240/240，GitHub PR CI 通过 |
| E0-06 | 已完成 | PR [#12](https://github.com/mewmind-chen/russia-crm-local/pull/12) 已合并；`origin/main`、生产 bare repo 和干净本地 main 均为 `5c4b2ae9afc5576367c3eac5e1ee9614c4de63b4`；不可变 release `tradepulse-production/releases/5c4b2ae9afc5` 已从 `git archive` 构建，240/240 及全部语法检查通过，无 `.git`，11 个 runtime 链接均解析到 production/shared；证据见 `tradepulse-production/state/e0-06-candidate-20260723T082900Z.md`；current、进程和数据库未切换或修改 |
| E0-07 | 已完成 | 使用 SQLite online backup 创建 `tradepulse-production/state/backups/crm-before-5c4b2ae9afc5-20260723T083912Z.db`；43151360 bytes、权限 600、最终 SHA-256 `6e1743eb582846f136e61b2d4e971f81654aec90f22203dad71df932d296f09f`；活动库和备份 `quick_check=ok`，备份 `integrity_check=ok`；证据见 `tradepulse-production/state/e0-07-backup-20260723T083912Z.md`；current 和进程未变化 |
| E0-08 | 已完成 | `current` 已原子切换到 `releases/5c4b2ae9afc5`，`previous` 已修正为内部回滚点 `releases/555b6e5-origin-main`；本地/公网 `/healthz` 均返回完整 SHA `5c4b2ae9afc5576367c3eac5e1ee9614c4de63b4`、`ok=true`、`database=ok`，首页均为 200；活动库 `quick_check=ok`/WAL；8 个 LaunchAgent 保持加载，4 个常驻服务从新 release 运行；账号、权限、会话和 AI runtime 摘要与切换前一致；未触发回滚；证据见 `tradepulse-production/state/e0-08-switch-20260723T091051Z.md` |
| E0-09 | 已完成 | PR [#15](https://github.com/mewmind-chen/russia-crm-local/pull/15) 已合并，合并提交 `2b55ed0fb7fc2c455199dd11e269cf93115ac325`；控制器自动部署通过，候选验证 242/242，生产 current 为 `releases/2b55ed0fb7fc`，previous 和 state.json 均指向 `releases/f7bb248e91f2`；本地/公网 `/healthz` 均返回目标 SHA、`database=ok`，首页均 200，数据库 WAL/quick_check=ok，账号/权限/会话/AI runtime 行数未变；证据见 `tradepulse-production/state/e0-09-final-20260723T101900Z.md` |
| E0-10 | 已完成 | 干净 clone 已与 `origin/main` 同步到 `2b55ed0fb7fc2c455199dd11e269cf93115ac325`；外置 worktree `/Users/ylf/Desktop/projects/tradepulse-development/worktrees/ai-integration` 使用分支 `codex/ai-integration`；独立 runtime/DB 位于 `/Users/ylf/Desktop/projects/tradepulse-development/runtime/ai-integration`，路径保护拒绝生产 DB；完整测试 242/242，3100 首页、开发登录、CRM bootstrap 和 capabilities 通过，3000 生产健康不变；证据见 `tradepulse-development/artifacts/e0-10-dev-instance-20260723T103700Z.md` |
| A1-01 | 已完成 | 在 `codex/ai-integration` 添加 `customer_fit@v1` Schema、Prompt Registry、AJV 合同验证器和 fail-closed evidence 白名单；AJV 锁定 `8.20.0`；合同测试 6/6、正式 CRM 全量测试 248/248；未接入 route、job、模型或生产数据库；证据见 `tradepulse-development/artifacts/a1-01-customer-fit-contract-20260723T110047Z.md` |
| A1-02 | 已完成 | 在 `codex/ai-integration` 添加四张 `crm_ai_*` 持久化表、幂等任务、lease/retry/dead-letter、结果/evidence/model-run 记录和错误脱敏；专项测试 6/6、正式 CRM 全量测试 254/254、语法与 diff 检查通过；开发 DB 6 用户/3 权限组/18 CRM 账户/AI runtime auto 保持不变，生产 `/healthz` 未变化；证据见 `tradepulse-development/artifacts/a1-02-ai-persistence-20260723T112617Z.md` |
| A1-03 | 已完成 | 添加正式 CRM context/evidence adapter；按 `externalCustomerIds/accountIds` 约束客户范围，按 `view_contacts/view_recon/view_customers` 脱敏和裁剪；支持 `crm_accounts` 回退、稳定 evidence ID 和 context hash；专项测试 5/5、正式 CRM 全量测试 259/259、开发 DB 只读 smoke 通过；证据见 `tradepulse-development/artifacts/a1-03-crm-context-20260723T114612Z.md` |
| A1-04 | 已完成 | 添加 `executeCustomerFitJob`；通过现有 `callAssistantModel` router 执行 `customer_fit@v1`，传入只读 scope 和 `externalAllowed=false`，严格校验 JSON/evidence 后保存结果与 model run；专项测试 7/7、正式 CRM 全量测试 261/261、语法与 diff 检查通过；证据见 `tradepulse-development/artifacts/a1-04-router-execution-20260723T121810Z.md` |
| A1-05 | 已完成 | 添加三条正式 Sales CRM AI API；读取使用 `view_customers`，执行/重试使用 `use_ai_assistant`，全部叠加客户行级范围；支持 context-hash 幂等、精确任务认领、dead-letter 有界重试、scoped evidence/stale 状态、身份检查阻断和匿名化审计；专项 18/18、受影响回归 55/55、全量 267/267；3100 真实只读 API smoke 为 200，开发库 AI jobs/results 仍为 0；代码提交 `1333506`，证据见 `tradepulse-development/artifacts/a1-05-scoped-ai-api-20260723T135014Z.md` |
| A1-06 | 已完成 | 正式 CRM 完整客户页新增真实 `customer_fit` 区域，显示评分、等级、置信度、原因、证据、模型/Prompt/Schema 版本、时间和完整任务状态，并提供权限化生成/重试；开发库通过只读快照导入生产客户业务数据，保留 6 个开发账号、3 个权限组和现有 router 设置，不复制生产身份或会话；浏览器验证 9 个 CRM 客户、真实结果 78/B/85%、18 条证据、桌面/移动布局及 0 控制台错误；全量 277/277；提交 `7192e6f`、`b7d46a7`；证据见 `tradepulse-development/artifacts/a1-06-customer-fit-ui-and-production-snapshot-20260723T142232Z.md` |
| A1-07 | 已完成 | 三角色浏览器验收通过：管理员/经理可查看全范围结果，销售仅见本人 6 个客户、无执行按钮且无法读取他人客户；`RU-0068` 真实模型 smoke 经 Kimi 15.277 秒生成 86/A/85% 和 14 条证据，客户业务状态前后 SHA 完全一致；全量 280/280；PR [#16](https://github.com/mewmind-chen/russia-crm-local/pull/16) 合并为 `92e9f609` 并自动部署；生产 current/health 为目标 SHA，previous 为 `2b55ed0f`，部署备份 `quick_check=ok`，生产 flag 实测关闭且未创建 `crm_ai_*` 表；证据见 `tradepulse-development/artifacts/a1-07-stage-one-release-gate-20260723T150532Z.md` 和 `tradepulse-production/state/a1-07-stage-one-deployment-20260723T151753Z.md` |
| A1-08 | 已完成 | A1-08.1 持久入队、DAG、取消、恢复和独立 Worker 已由 PR [#17](https://github.com/mewmind-chen/russia-crm-local/pull/17) 合并为 `56d63ed2`；A1-08.2 新增数据库全局/资源槽位、速率窗口、公平调度、每客户串行和 Router 引擎调用期占位，6 个 Worker 进程完成 20 个跨客户任务且全局峰值 4，全量 307/307，PR [#18](https://github.com/mewmind-chen/russia-crm-local/pull/18) 合并；A1-08.3 新增四级预算、原子预占/结算、80% 告警、100% policy block、attempt 级 usage/cost/fallback 台账、缺失 usage 保守估算、缓存/去重零费用事件和孤儿预占恢复，全量 323/323，PR [#20](https://github.com/mewmind-chen/russia-crm-local/pull/20) 合并；A1-08.4 新增统一任务中心、运行指标、对话元数据和人工复核，PR [#22](https://github.com/mewmind-chen/russia-crm-local/pull/22) 与 [#23](https://github.com/mewmind-chen/russia-crm-local/pull/23) 合并；A1-08.5 新增三角色范围验证、联系人/Recon 独立脱敏、取消/批量/预算/复核独立授权、原子批量 API、匿名化审计和不可用降级，A1-08 专项 88/88、全量 335/335、GitHub CI 通过，PR [#25](https://github.com/mewmind-chen/russia-crm-local/pull/25) 合并为 `a226dd2c`。生产 AI Station 和 Worker 仍关闭且未部署。证据见 `tradepulse-development/artifacts/a1-08-1-persistent-queue-20260723T165726Z.md`、`tradepulse-development/artifacts/a1-08-2-global-concurrency-20260724T012512Z.md`、`tradepulse-development/artifacts/a1-08-3-usage-budget-20260724T023103Z.md`、`tradepulse-development/artifacts/a1-08-4-unified-task-center-20260724T030316Z.md` 和 `tradepulse-development/artifacts/a1-08-5-permissions-audit-degradation-20260724T033129Z.md` |
| A1-09 | 已完成 | A1-09.1 PR [#28](https://github.com/mewmind-chen/russia-crm-local/pull/28) 完成最小创建与 DAG；A1-09.2 PR [#30](https://github.com/mewmind-chen/russia-crm-local/pull/30) 完成 identity/evidence；A1-09.3 PR [#32](https://github.com/mewmind-chen/russia-crm-local/pull/32) 完成 legacy adapter、事务完成事件与取消；A1-09.4 PR [#34](https://github.com/mewmind-chen/russia-crm-local/pull/34) 完成字段提案/复核/finalize、受保护 API、任务中心投影和客户 UI；A1-09.5 PR [#36](https://github.com/mewmind-chen/russia-crm-local/pull/36) 完成三类 E2E、6 Worker/20 跨客户竞争、租约/故障矩阵及隔离开发真实模型 smoke，集成 @ `35341e8`，聚焦 62/62、smoke/identity 14/14、全量 408/408、Python 检查、CI 与独立复审通过。生产 flags 关闭且未部署；下一步 A2-01 |
| A2-01 | 已完成 | PR [#38](https://github.com/mewmind-chen/russia-crm-local/pull/38) 已合并为 `1ef5e17`，文档 PR #39 后集成基线为 `0add7f6`；三类严格 v1 合同、证据/联系人/销售候选白名单和 fail-closed 校验落地；聚焦 19/19、全量 421/421、CI 与独立复审通过；生产 flags 关闭且未部署 |
| A2-02 | 已完成 | `codex/ai-contact-readiness-a2-02` 基于 `0add7f6` 完成 fit 后继触发、schema v8 stale 结果、联系人变化失效、enrichment DAG 和 partial/not_ready 补研阻断；实现提交 `d96a48c`，PR [#44](https://github.com/mewmind-chen/russia-crm-local/pull/44) 已合并到 `codex/ai-integration` @ `c6b2150`，CI `test` 通过；聚焦 9/9、全量 427/427、语法/Schema/diff 检查通过；证据见 `docs/evidence/a2-02-contact-readiness.md`；尚未部署；下一步 A2-03 |
| A2-03 | 已完成 | schema v9 新增销售候选快照元数据与 token 映射；服务端按有效销售、权限、国家/语言、渠道、负荷和配额生成候选，AI 只接收一次性正整数 token；过期或销售状态变化 fail-closed 并要求重算；未接入最终裁决或业务写入；PR [#46](https://github.com/mewmind-chen/russia-crm-local/pull/46) 已合并到 `codex/ai-integration` @ `51aecaa`，CI `test` 通过；聚焦 3/3、全量 430/430、语法/diff 检查通过；证据见 `docs/evidence/a2-03-candidate-snapshots.md`；尚未部署；下一步 A2-04 |
| A2-04 | 已完成 | 新增 `assignment_arbitration` 规则最终裁决：AI 仅作建议，事务内重读有效销售、权限、负荷和配额；一致且高置信可自动分配，AI 不可用确定性回退，冲突、低置信、高价值、风险、重复和跨团队进入经理审批或规则阻止；A2-03 快照 token 服务端 fail-closed 解析；PR [#49](https://github.com/mewmind-chen/russia-crm-local/pull/49) 已合并到 `codex/ai-integration` @ `4e4619e`，CI `test` 通过；聚焦 5/5、全量 435/435、语法/diff 检查通过；证据见 `docs/evidence/a2-04-assignment-arbitration.md`；尚未部署；下一步 A2-05 页面与审计 |
| A2-05 | 已完成 | 新增 `crm_intake_decisions` 决策历史，保存候选快照、AI 推荐、规则结果、人工最终决定、操作者和时间；bootstrap/入库队列/详情抽屉展示 Fit、readiness、priority、候选排名、阻断原因和三层裁决；销售端按 owner 范围脱敏；PR [#51](https://github.com/mewmind-chen/russia-crm-local/pull/51) 已合并到 `codex/ai-integration` @ `92e64cc`，CI `test` 通过；专项 7/7、全量 437/437、语法/diff 检查通过；证据见 `docs/evidence/a2-05-intake-review-audit.md`；尚未部署；下一步 A2-06 验收门 |
| A2-06 | 已完成 | 并发扫描幂等、owner scope/分页、AI 越权阻断、规则阻断、AI 故障回退和三角色权限验收通过；Issue #62 页面与导航体验对齐完成；专项 7/7、受影响回归 18/18、全量 466/466、语法/diff 检查通过；本地 3101 管理员登录、`#intake`/后退和 390px smoke 通过；证据见 `docs/evidence/issue-62-a2-06-acceptance.md`；尚未合并到 `main`、迁移或部署，生产 AI 开关保持关闭；下一步 A3-01 `sales_pack` |
| A3-01 | 已完成 | `sales_pack@v1` 认领后异步幂等入队、Worker 执行、客户详情摘要/切入点/风险/审核草稿、`SALES_PACK_READY` 内部通知和企微禁发完成；管理员面板提供四个持久化 AI 开关，环境变量硬门禁、管理员权限和审计完成；Worker 已纳入 launchd/部署/回滚清单；聚焦 50/50、完整回归 476/476、语法/diff 检查通过；PR #66 合并集成、PR #67 合并 `main` @ `8de1076` 并完成生产 smoke；证据见 `docs/evidence/a3-01-sales-pack-and-ai-flags.md`；下一步 A3-02 `action_proposal` |
| A3-02 | 已完成 | `action_proposal@v1` 自然语言输入、异步队列/Worker、可编辑活动草稿、人工确认后复用现有 activity API、低置信度/缺字段阻断、通用复核防绕过和一次性消费幂等已完成；完整回归 480/480、语法/diff 检查通过；桌面与 390px 浏览器生成/回填及任务中心验收通过且未写活动；证据见 `docs/evidence/a3-02-action-proposal.md`；已合并并完成生产发布；下一步 A3-03 `next_action` |
| A3-03 | 已完成 | `next_action@v1` 已接入活动/回复/会议/RFQ/报价事件，异步 Worker 生成 `needs_review` 建议；客户页可编辑并经独立采纳接口写入现有 next_action 字段，通用复核不能绕过，失败回退确定性 SLA；schema v11、消费审计、权限/owner scope/幂等和迁移完成；专项 24/24、完整回归 488/488、语法/diff 检查通过，桌面与 390px 验收通过；证据见 `docs/evidence/a3-03-next-action.md`；已合并 `main` 并完成生产 backup/quick_check、回滚确认、部署和 smoke，AI 开关显式开启；下一步 A3-04 消息和认领 |
| A3-04 | 已完成 | 新增通知 web/wecom 独立投递状态、租约、失败记录和幂等键；企微失败/未配置时保留网页未读通知；claim/return/reject 新增服务端幂等重放，不重复创建客户；专项/受影响回归 64/64、完整回归 492/492、生产隔离验证 492/492，生产 `quick_check=ok`，current 为 `b6da19e8b018`、previous 回滚点为 `bf15ad7e2de6`；PR #73 已合并并发布；证据见 `docs/evidence/a3-04-notifications-claims.md`；下一步 A3-05 RFQ、报价和订单边界 |
| A3-05 | 已完成 | RFQ BOM/金额/完整度校验，报价金额/币种/毛利校验，订单必须绑定同客户报价；新增报价/订单幂等请求表，重复提交不重复写业务对象；订单 UI 明确选择报价并携带幂等键；RFQ/报价继续通过 `next_action@v1` 生成建议，AI 无报价/订单写入权限；专项 3/3、完整回归 495/495、生产隔离验证通过，current 为 `bd0953c2eee0`、previous 为 `9545213db522`；PR #75 已合并并发布；证据见 `docs/evidence/a3-05-rfq-order-boundary.md`；下一步 A3-06 验收门 |
| A3-06 | 已完成 | 统一客户时间线覆盖认领、资料包、人工活动、人工采纳下一步、RFQ、报价和订单；资料包/下一步保持人工复核，外发、金额、订单由授权员工确认；Worker 租约恢复、结果唯一写入、认领/建议采纳/报价/订单幂等和企微失败网页降级通过；专项 2/2、受影响回归 78/78、完整回归 497/497；PR #77 已合并 `main` @ `35858514259af935884e7745fd2e8db6db35e9ad` 并完成生产发布，current 为 `35858514259a`、previous 为 `4e912fbd0d68`；证据见 `docs/evidence/a3-06-sales-execution-gate.md`；下一步阶段 4 A4-01 `manager_anomaly` |
| A4-01 | 已完成 | 服务端确定性扫描会议无 RFQ、RFQ 未报价、报价无回复、高价值停滞和团队负荷不均；`manager_anomaly@v1` 只生成中文解释、优先分和人工介入建议，严格限制异常/客户/证据 ID；销售隔离、Worker 恢复、幂等和无业务写入通过；补齐通知中心、本人已读边界和客户跳转，并统一员工可见 AI 中文输出；聚焦 26/26、AI 214/214、完整与生产隔离验证 503/503、桌面/390px、CI、backup/quick_check、local/public smoke 通过；PR #79 已合并 `main` @ `a7f2841c8edcbe534e44ce8c3628873b764e224a` 并发布，current `a7f2841c8edc`、previous `cc4ea9b0d552`，四个 AI 开关为 1；证据见 `docs/evidence/a4-01-manager-anomaly.md`；下一步 A4-02 `sales_coaching` |
| A4-02 | 已完成 | `sales_coaching@v1` 只使用授权团队聚合活动、转化、订单和 SLA；少于 10 个真实观察样本不调用模型，10-29 个样本限制置信度，结果中文且始终人工复核；销售隔离、任务中心锚点脱敏、过期判断、通知和约 2 分钟前端轮询通过；聚焦 36/36、AI 220/220、本地/GitHub CI/生产隔离完整回归 508/508，隔离库浏览器、backup/quick_check、local/public smoke 通过；PR #82 已合并 `main` @ `cbf8c596db315a88bb921529794e75d539ce32f3` 并发布，current `cbf8c596db31`、previous `8f3df69dafa9`，四个 AI 开关为 1；证据见 `docs/evidence/a4-02-sales-coaching.md`；下一步 A4-03 反馈和版本治理 |
| A4-03 | 已完成 | 五类业务反馈、版本化指标及 shadow → 评估 → 申请发布 → 人工批准 → 回滚治理链完成；Issue #81 的 Qwen 在线路由、DeepSeek 单次降级、文件式 DashScope Batch、成本/汇率/预算、stale 重排和独立 LaunchAgent 同批交付；浏览器修复动态治理 API 权限映射及 390px 横向溢出；生产验收修复 Batch 关闭时退出码；治理专项 12/12、完整回归 531/531、GitHub CI、备份/quick_check、local/public health 和真实 Qwen smoke 通过；PR #84/#85 已合并，生产 `current=296edd268162`、`previous=a1e7043a2165`；证据见 `docs/evidence/a4-03-ai-governance.md`、`docs/evidence/issue-81-qwen-online-batch.md`；下一项 A4-04 |
| A4-04 | 已完成 | 经理授权范围、销售团队数据隔离、离线版本治理和新旧指标比较验收通过；schema v16 固化不可变决策版本快照，任务详情显示白名单化版本、上下文、证据和 stale 追溯且不泄露 Prompt/配置/队列内部字段；聚焦 40/40、完整回归 535/535、GitHub CI、语法/diff、桌面/390px、生产备份/quick_check、schema v16 和 local/public smoke 通过；功能 PR #87 发布 `e1d3e611f5ef`，发布记录 PR #88 为 `634372f750d7`；证据见 `docs/evidence/a4-04-stage-gate.md`；下一项 R5-01 |

当前进度：38 个计划任务中已完成 35 个，剩余 3 个。A4-04 已完成开发、GitHub CI、
生产备份和 `quick_check`、部署、schema v16 与 local/public smoke。阶段 4 已完成，
下一项为 R5-01 影子运行。
