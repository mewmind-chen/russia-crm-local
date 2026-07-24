# TradePulse AI CRM 统一主计划

> 正式版本说明：本文件自 2026-07-24 起纳入正式产品仓库管理。后续产品边界、阶段状态和验收结论必须通过 GitHub PR 更新；`tradepulse-ai-crm` 中的同名文件仅作为历史镜像。

**文档状态：** 23/38 个任务已完成；阶段 2 进行中；A2-04 已完成；下一步执行 A2-05 页面与审计
**版本：** v1.6
**日期：** 2026-07-24
**产品依据：** `/Users/ylf/Desktop/ai-crm-complete-flow.html`
**当前生产根目录：** `/Users/ylf/Desktop/projects/tradepulse-production`
**配套执行计划：** `docs/planning/tradepulse-execution-plan.md`

## 1. 文档目的

这份文档统一此前关于产品目标、两套代码、生产部署、开发环境、AI 工作站和上线顺序的结论。后续开发和部署必须以本计划为边界，避免再次出现以下偏差：

- 重复建设第二套 CRM，而不是增强已经上线的 CRM。
- 完成大量底层代码，却没有用户可见的 AI 驱动工作流。
- 开发仓库、运行数据库和生产版本来源不明确。
- 把测试壳、基础设施 smoke test 或 Worker 能力当成产品已经完成。
- 直接修改生产 release，导致目录名称、Git SHA 和实际运行代码不一致。

本计划先解决环境和产品架构，再按可见业务闭环逐步交付 AI 功能。

## 2. 最终产品定义

TradePulse 是面向外贸 B2B 销售团队的 AI 驱动 CRM。它不是普通客户信息表加聊天框，而是把客户研究、价值判断、分配、销售执行、跟进、成交和经理监督连接成一条可审计工作流。

最终产品必须满足：

1. 真实客户、研究证据、联系人和 CRM 业务对象使用同一数据源。
2. AI 输出必须结构化、引用证据、带置信度并可人工复核。
3. AI 只能建议、排序和归纳，权限、配额、冲突、金额和外发由规则或员工最终决定。
4. AI 不可用时，销售仍可通过规则和人工流程继续工作。
5. 每次 AI 判断、人工批准、分配、触达、报价和订单都可追溯。
6. 销售和经理必须能在现有 CRM 页面直接看到 AI 结果和下一步，而不是进入另一套应用。

## 3. 已确认的总体决策

### 3.1 唯一产品主体

`mewmind-chen/russia-crm-local` 是唯一正式产品仓库和业务数据模型。

保留并继续使用其中已经上线的：

- 登录、账号、密码和会话。
- 权限组、个人覆盖权限、客户行级范围和身份检查。
- 客户池、Recon、联系人研究和证据。
- 每日线索入库、候选销售、配额、审批、分配、领取和退回。
- 客户详情、时间线、活动、RFQ、报价和订单。
- 经理评价、通知、审计、报表和维护工具。
- Kimi、Hermes、DeepSeek 统一 AI 路由及故障切换。

### 3.2 AI 项目的定位

`tradepulse-ai-crm` 不再作为第二套 CRM 继续发展。它改为 AI 能力来源，选择性迁入正式产品仓库。

复用内容：

- 8 个 AI 工作站的 JSON Schema。
- Prompt registry 和版本化提示词。
- 输出解析、AJV 校验、证据白名单和候选销售白名单。
- 幂等任务、租约、重试、待复核和死信状态模式。
- Worker、调度器和真实模型 smoke test 的可复用部分。
- 模型调用元数据、成本、耗时和失败原因记录方式。

不迁入内容：

- 新项目的客户、员工、账号、权限和会话表。
- 新项目的分配、账户、活动、RFQ、报价和订单表。
- 新项目的第二套登录页、CRM 外壳和 AI 路由管理。
- 与正式 CRM 重复的业务 API 和页面。

`tradepulse-ai-workflow` 作为实验项目保留，但不作为生产来源。

### 3.3 合并原则

不是合并两个数据库，也不是把两个应用拼在一起。正确方式是在正式 CRM 中增加 AI adapter：

```text
现有 CRM 页面和 API
        |
        v
CRM AI Adapter
        |
        +-- 读取现有客户、Recon、联系人、活动、RFQ、报价和订单
        +-- 使用现有权限范围构建可信上下文
        +-- 调用现有统一 AI 路由
        +-- 使用新项目 Schema 校验结构化结果
        +-- 写入 crm_ai_* 命名空间表
        +-- 回写现有通知、审计和页面展示
```

### 3.4 现有 AI 路由原样保留

正式 CRM 已上线的 AI 路由是全系统唯一模型入口，不迁移或并行运行新项目的第二套路由。

原样保留：

- Kimi CLI、Hermes 和 DeepSeek adapters。
- `auto`、`kimi-cli`、`hermes`、`deepseek` 运行模式。
- 管理员现有的模型切换、健康检查和重新检测功能。
- 自动优先级、超时、最多尝试次数、故障切换和熔断状态。
- 会话引擎延续、切换引擎时的会话隔离和错误脱敏。
- 现有 AI 路由权限、审计和生产配置。

8 个 AI 工作站通过现有 `callAssistantModel -> assistantRouter.route` 链路执行。新增的只是路由上层能力：

- 按工作站构建结构化 prompt 和 JSON Schema。
- 记录 station、prompt version、schema version、usage、cost 和路由结果。
- 对模型回答执行 JSON 解析、Schema、证据 ID 和候选 ID 校验。
- 工作站级模型偏好只能作为现有 router 的策略输入，不创建新的 provider 凭据、健康状态或管理页面。

现有 `assistant_runtime_settings` 和生产路由配置继续保留，不在环境整改或 AI 集成时重置。

### 3.5 AI Control Plane 是统一执行层

最终系统会同时处理大量客户研究、评分、联系人补全、分配建议和销售行动任务，不能依赖 HTTP 请求同步等待，也不能用单进程内存计数代表生产并发。

新增 AI Control Plane，职责限定为：

- 持久队列、任务依赖/DAG、优先级、租约、重试、取消和死信。
- 独立 Worker 池，以及跨进程的全局并发槽位、速率限制、公平调度和每客户冲突保护。
- 公司、团队、用户、Station 四级预算的调用前预占、调用后结算、告警和阻断。
- 统一 AI 任务中心，展示状态、模型尝试、token/费用、fallback、结果、证据和操作历史。
- AI 不可用时保持 CRM、人工流程和历史任务可读。

Control Plane 不取代现有 AI router：Router 决定一次模型调用使用哪个已配置引擎，Control Plane 决定哪些业务任务何时执行、可以占用多少资源和预算、失败后如何恢复。

初始生产建议并发为 DeepSeek API 4、网页搜索/抓取 4、Kimi CLI 1、Hermes 1，全部通过环境配置调整。队列可以容纳超过即时并发能力的任务，调用量由速率和预算共同约束。

## 4. 当前代码与环境事实

### 4.1 正式 CRM 代码

- 远端 `origin/main` 检查 SHA：`6eb96b16dbd25140955251698c4b793d7b2bf205`。
- 隔离运行远端正式代码测试：`192/192` 通过。
- 现有 AI 路由接口支持标准 messages、request options 和 adapters。
- 销售 CRM 未登记的新 API 默认拒绝，新增 AI 路由必须显式加入权限策略。
- 客户和销售主键是文本 ID。
- 当前业务规模约 1900 个客户，单机 SQLite WAL 仍适用。

### 4.2 AI 能力项目

- 主要实现位于 `codex/real-execution-foundation`。
- 相对该项目 main 有 74 个提交。
- 完整测试：`478/478` 通过。
- 高危依赖审计：0。
- 已实现 8 个工作站、持久任务、Worker、重试、路由和真实模型 smoke 证据。
- 该仓库当前没有配置 Git remote，不能作为生产唯一来源。
- 数据模型使用整数客户和员工 ID，与正式 CRM 不兼容。

#### 新代码实际实现边界

结论：新代码尚未实现 AI 驱动整个 16 步业务流程。

已经实现：

- 8 个工作站的 Schema、prompt、模型调用、结果校验和持久化。
- AI job 的入队、租约、重试、待复核、死信和 Worker 执行。
- 管理员 AI 路由、模型策略、健康状态和调度策略页面。
- 销售工作台可以读取并展示已经存在的 AI 评估结果。
- 全工作站 smoke 脚本可以针对一个迁移客户逐个手工入队并运行 8 个工作站。

尚未实现：

- `createCustomerEvaluator` 没有接入真实 route 或业务事件，只在测试中被调用。
- 自动调度目前只有阶段停滞时会创建 `manager_anomaly` job。
- `sales_match`、`sales_pack`、`next_action` 和 `sales_coaching` 没有接入真实业务触发链。
- AI 结果没有自动进入正式 CRM 的入库、审批、分配、认领、触达和交易流程。
- 新项目没有使用正式生产账号、权限、客户 ID、业务表和现有 AI router。
- 当前 3100 页面是独立验收壳，不是正式 CRM 中完整的 16 步产品流程。

全工作站 smoke 脚本还明确断言 `salesArtifactDelta` 全部为 0，即运行 8 个工作站时不得改变 assignment、account、activity、RFQ、quote 或 order 等销售业务对象。这个测试证明 AI 执行基础成立，但不能作为端到端业务闭环已经完成的证据。

### 4.3 生产环境

当前生产根目录：

```text
/Users/ylf/Desktop/projects/tradepulse-production/
  current -> releases/555b6e5-origin-main
  previous -> /Users/ylf/Desktop/projects/russia-crm-releases/773bbbc-assistant-router.lN9iRF
  releases/555b6e5-origin-main/
  shared/
  launchd-backups/
```

已确认：

- 本地 `http://127.0.0.1:3000/` 返回 200。
- 公网 `https://crm.newmindchen.com/` 返回 200。
- 8 个 server、tunnel、worker 和 schedule LaunchAgent 已加载。
- SQLite `PRAGMA quick_check` 返回 `ok`，journal mode 为 WAL。
- 所有主要 LaunchAgent 已统一从 `tradepulse-production/current` 启动。

需要修复：

- release 目录名是 `555b6e5-origin-main`，实际 Git HEAD 已更新为 `6eb96b1`。
- release 仍是 Git worktree，包含 `.git`，因此不是不可变发布物。
- 生产根目录缺少 `state/`。
- 当前 release 缺少 `.release-sha`。
- 当前正式代码没有可用 `/healthz`，请求返回 404。
- `previous` 指向生产根目录以外的旧 release。
- `shared/data` 约 1.8GB，混有大量历史 `.bak` 和二级 backups。
- `shared/.env` 和活动数据库当前权限为 `644`，需要收紧。

### 4.4 当前开发环境

- `/Users/ylf/Desktop/projects/russia-crm-local` 是脏工作区，本地 main 相对远端 ahead 2、behind 57，不能 reset 或直接作为新开发基线。
- `/Users/ylf/Documents/GitHub-crm仓库/russia-crm-local` 是另一份 Git clone，并管理部分生产 worktree。
- `/Users/ylf/Desktop/projects/tradepulse-ai-crm` 是独立 AI 项目。
- `/Users/ylf/Desktop/projects/tradepulse-ai-workflow` 是另一实验项目。
- 当前 `3100` 是 AI 项目验收壳，不代表最终融合产品。

## 5. 目标目录设计

### 5.1 开发环境

```text
/Users/ylf/Desktop/projects/tradepulse-development/
  repo/                              # 唯一干净 clone，只跟踪 origin/main
  worktrees/
    ai-integration/                  # codex/ai-integration
    hotfix-<name>/                   # 必要时建立
  runtime/
    ai-integration/
      .env                           # 仅开发配置
      data/
        crm.db                       # 独立开发数据库
      logs/
      reports/
      output/
      tmp/
  snapshots/
    sanitized/                       # 脱敏或专用验收快照
  artifacts/                         # 测试报告、截图和 smoke 输出
```

规则：

- `repo/main` 保持干净，不直接开发。
- 所有功能使用外置 worktree 和 `codex/*` 分支。
- 每个 worktree 使用独立 runtime，不共享数据库、日志和 `.env`。
- 开发端口从 3100 开始，其他 worktree 使用 3201 及以上端口。
- 开发数据库不得软链接到生产目录。
- 开发环境不得使用生产 Cookie、session、管理员密码或外发渠道。
- 需要真实数据测试时，只使用经过确认的只读快照或脱敏副本。

### 5.2 生产环境

```text
/Users/ylf/Desktop/projects/tradepulse-production/
  current -> releases/<12-char-sha>
  previous -> releases/<12-char-sha>
  releases/
    <12-char-sha>/                   # git archive 产物，无 .git
      .release-sha                   # 完整 40 位 SHA
      node_modules/
      data -> ../../shared/data
      logs -> ../../shared/logs
      ...
  shared/
    .env
    data/                            # 仅活动 DB、WAL、SHM 和运行状态
    logs/
    reports/
    recon-runs/
    contact-recon-runs/
    contact-recon-reports/
    output/
    backups/
    tmp/
    memory/
  state/
    repo.git/                        # 部署专用 bare repo
    state.json                       # 成功、失败和回滚 SHA
    deploy.lock/
    backups/
    test-artifacts/
  launchd-backups/
```

规则：

- release 从 `origin/main` 的完整 SHA 使用 `git archive` 生成。
- release 中禁止 `.git`、禁止 `git pull`、禁止手工编辑。
- `node_modules` 属于 release，确保旧 release 可以直接回滚。
- `.env`、数据库、日志和输出只存在于 `shared`。
- `current` 和 `previous` 都必须指向本生产根目录内的 release。
- 发布前先 `npm ci`、完整测试、语法检查和 SQLite 在线备份。
- 切换使用临时软链接加原子 rename。
- 切换后重启服务并检查本地、公网、数据库和 release SHA。
- 应用失败只回滚代码软链接；数据库不得自动恢复。

## 6. 环境安全边界

应用启动时增加强制路径保护：

- `NODE_ENV=development` 时，如果数据库或输出目录位于 `tradepulse-production`，拒绝启动。
- `NODE_ENV=production` 时，数据库必须位于 `tradepulse-production/shared/data`。
- 生产固定监听 `127.0.0.1:3000`，通过 Cloudflare Tunnel 暴露。
- 开发默认监听 `127.0.0.1:3100`，不得绑定公网。
- 生产 `.env`、数据库和备份文件权限至少为 `600`，敏感目录为 `700`。
- 日志不得写入 API Key、Cookie、Authorization、联系人原文或完整 AI prompt。
- AI 模型错误对普通用户只显示通用信息，详细错误仅管理员可见。

## 7. 现有账号与权限原样保留

本项目不建设或迁移第二套账号权限体系。

- 现有生产账号、密码、会话、角色、权限组和个人覆盖权限全部原样保留。
- 不重新初始化管理员，不批量重置密码，不重新分配权限组，不清除现有会话。
- 继续使用现有管理员界面处理新增账号、权限调整和密码重置。
- 开发和验收环境使用各自的测试账号，不与生产账号同步。
- AI 功能只接入现有权限检查和客户数据范围，不改变账号管理规则。

## 8. AI 数据适配设计

### 8.1 新增命名空间表

计划新增但不替换现有业务表：

- `crm_ai_jobs`：队列、租约、重试、待复核、死信。
- `crm_ai_station_results`：版本化工作站结果。
- `crm_ai_candidate_snapshots`：销售候选快照和临时整数编号映射。
- `crm_ai_evidence_bindings`：工作站允许引用的证据集合。
- `crm_ai_model_runs`：模型、路由、耗时、usage、成本和失败。
- `crm_ai_feedback_labels`：成交、回复、退回、停滞等结果标签。

所有表使用现有文本 customer ID 或 CRM account ID，不创建第二套客户主档。

### 8.2 ID 兼容

- 正式 CRM 的 `customer_pool.customer_id` 和 `sales_users.id` 保持文本 ID。
- `sales_match.v1` Schema 要求整数 employeeId。
- 服务器为每次工作站运行生成候选快照，将授权销售映射为一次性正整数。
- AI 只看到快照整数；结果通过快照映射回 `sales_users.id`。
- 不在快照中的 ID 直接拒绝，不保存结果。

### 8.3 过期结果保护

正式 CRM 没有新项目的 customer revision，因此使用可信上下文哈希：

- 对客户、证据、联系人、活动和候选集生成 `context_hash`。
- AI 运行开始和保存结果时分别计算。
- 哈希变化时结果进入 `needs_review` 或重新运行，禁止静默覆盖新业务状态。

### 8.4 结构化输出

每次工作站调用流程：

1. 服务端按用户权限读取可信上下文。
2. 服务端生成 evidence ID 白名单和候选 ID 白名单。
3. 使用现有 AI router 选择 Kimi、Hermes 或 DeepSeek。
4. 模型只返回 JSON。
5. AJV 校验 Schema、枚举、长度和必填字段。
6. 额外校验证据 ID 和候选 ID 没有虚构。
7. 校验通过后写入结果表和审计；失败进入重试或人工复核。

### 8.5 新客户自动补全

新客户创建采用“业务记录立即成功、AI 后台异步补全”的方式：

```text
最小客户记录
  -> 去重、域名和风险预检
  -> 官网与经营主体验证
  -> 实时网页/企业资料采集
  -> 行业、产品、需求和业务类型提取
  -> 联系人和采购入口搜索
  -> 合规检查
  -> customer_fit、标签、证据和完整度
  -> 待补查 / 人工复核 / 待分配
```

- 流水线由 Control Plane DAG 编排，页面实时显示每个节点。
- 每个生成字段保存来源、时间、置信度和版本；无证据内容不得成为已确认事实。
- AI 不静默覆盖员工确认数据，冲突进入人工复核。
- 联系人与 Recon 内容继续使用现有权限和脱敏规则。
- AI 不可用、预算耗尽或外部网页失败时，客户仍可正常查看和人工编辑。
- 自动分配不属于本阶段；阶段 2 仍由服务器规则、合法候选集和审批作最终裁决。

## 9. 8 个 AI 工作站

| 工作站 | 核心输出 | 正式 CRM 展示位置 |
|---|---|---|
| `customer_fit` | 0-100 分、A/B/C/D、原因、置信度、是否复核 | 客户池、客户详情、入库队列 |
| `contact_readiness` | ready/partial/not_ready、联系人 ID | 联系人研究、入库队列、客户详情 |
| `distribution_priority` | A/B/C/D、紧急度、阻断原因 | 待分配队列、经理审批 |
| `sales_match` | 授权候选销售排名、得分、理由 | 自动分配建议、审批弹窗 |
| `sales_pack` | 客户摘要、切入点、风险 | 已认领客户详情、首次触达区 |
| `next_action` | 下一动作、截止时间、经理介入 | 今日任务、客户时间线、提醒 |
| `manager_anomaly` | 异常类型、严重度、解释、干预建议 | 经理异常看板、通知 |
| `sales_coaching` | 优势、差距、辅导建议 | 团队能力和经理辅导页面 |

`action_proposal` 作为辅助 Schema，用于把自然语言触达结果整理成待确认活动，不属于自动写业务状态的工作站。

## 10. 原始 16 步产品闭环映射

| 步骤 | 目标 | 现有能力 | 计划增量 | 完成标准 |
|---|---|---|---|---|
| 01 | 迁移真实客户 | 正式库已有客户和证据 | 不迁第二库；做计数和完整性基线 | 正式库为唯一数据源 |
| 02 | 去重与风险阻断 | 数据质量、域名、风险筛选 | 增加候选复核和阻断原因展示 | 重复或风险客户不自动分配 |
| 03 | AI 研究补充 | Recon、联系人 Recon、证据 | 统一证据 ID 和失败任务状态 | 结果有 URL、时间和置信度 |
| 04 | 价值评分 | company_screening | 接入 `customer_fit` 并版本化 | 页面可见评分、证据和复核状态 |
| 05 | 联系就绪度 | 联系人等级和联系方式 | 接入 `contact_readiness` | 不就绪客户生成补研动作 |
| 06 | 候选销售排序 | 规则匹配国家、语言、渠道 | 接入 `sales_match` | AI 只能排序合法候选 |
| 07 | 配额与冲突校验 | 每日配额和当前负荷 | 增加幂等、冻结和冲突原因 | 规则拥有最终裁决权 |
| 08 | 自动分配/审批 | 自动/人工入库审批 | 显示 AI 摘要、低置信度转审批 | 每次决定有理由和审计 |
| 09 | 任务推送 | CRM 通知和企微基础 | 统一投递状态、重试、回执 | 渠道失败时网页仍可处理 |
| 10 | 销售认领 | claim、return、reject | 补强幂等和到期回收 | 重复点击不重复建账户 |
| 11 | 销售资料包 | 客户详情和 AI 问答 | 接入 `sales_pack` | 销售在客户页直接看到资料包 |
| 12 | 触达并记录 | CRM activities | `action_proposal` 回显后人工确认 | 外发和业务写入必须人工确认 |
| 13 | 下一步与 SLA | next_action、提醒 | 接入 `next_action` 和确定性扫描 | AI 失败时规则提醒仍工作 |
| 14 | RFQ→报价→订单 | 已有独立对象和漏斗 | 补必填校验和事件一致性 | 金额和外发由授权员工确认 |
| 15 | 经理异常监督 | 经理异常和评价基础 | 接入 `manager_anomaly` | 规则先筛选、AI 只解释和排序 |
| 16 | 结果反馈优化 | 转化和团队报表 | `sales_coaching`、版本比较、影子评估 | 新策略经理批准后发布，可回滚 |

## 11. 实施阶段

### 阶段 0：冻结方向和环境整理

目标：消除版本和数据来源歧义，不增加 AI 业务功能。

任务：

1. 确认本主计划。
2. 建立干净 `tradepulse-development`。
3. 保留脏旧仓库，不 reset、不删除。
4. 从 `origin/main` 建 `codex/ai-integration` worktree。
5. 建独立开发 runtime 和测试数据库。
6. 把生产切换为准确 SHA 命名的不可变 archive release。
7. 建立 `state`、`.release-sha`、`healthz`、内部 previous 和部署备份。
8. 收紧生产敏感文件权限。

验收门：

- 本地和公网首页 200。
- 8 个 LaunchAgent 正常。
- SQLite quick_check 为 ok。
- `/healthz` 返回活动完整 SHA 和 database=ok。
- current 和 previous 都在生产根目录内。
- release 无 `.git` 且 tracked code 不可变。
- 开发 DB 与生产 DB 路径完全分离。

预计：2-3 个工作日。

### 阶段 1：可见 AI 纵切、Control Plane 与新客户补全

目标：先证明 AI 能力进入正式 CRM，再建立可承载多客户并发的执行底座，并交付第一个自动业务闭环。

范围：`customer_fit`、AI Control Plane、统一任务中心和新客户自动补全流水线。

任务：

1. 新增 AI 命名空间迁移和 repository。
2. 接入现有 router、Schema、证据白名单和 context hash。
3. 在客户详情增加 AI 评分、理由、证据、状态和重试。
4. 在客户池增加评分筛选和状态列。
5. 增加权限、审计、失败和回退测试。
6. 建立 AI Control Plane：持久队列/DAG、独立 Worker、跨进程全局并发、速率限制、预算预占/结算和失败恢复。
7. 建立覆盖所有 AI 业务执行的统一任务中心，提供任务状态、依赖、模型尝试、token/费用、失败重试、结果与证据历史。
8. 建立新客户自动补全闭环，从最小线索异步完成官网/主体、画像、需求、联系人、合规、评分、标签和完整度。

验收门：

- 使用真实 CRM 客户上下文执行。
- 销售只能看到授权客户结果。
- 不具联系人权限时不泄露联系人字段。
- 模型虚构证据时结果被拒绝。
- AI 不可用时页面显示可重试状态，不影响 CRM 操作。
- 并发任务不丢失、不重复，跨 Worker 全局并发和每引擎速率不超过配置。
- 预算达到阈值时正确告警或阻止新调用，不影响历史任务和人工 CRM。
- 新客户页面能实时看到补全节点、结果、证据和复核状态。

预计：评分纵切已完成；Control Plane 与新客户补全新增 8-14 个工作日。

### 阶段 2：判断与分发闭环

范围：`contact_readiness`、`distribution_priority`、`sales_match`。

任务：

1. 联系就绪结果进入入库队列。
2. 不就绪客户返回补充研究，不自动分配。
3. 服务端生成销售候选快照。
4. AI 排名与现有配额、负荷和冲突规则组合。
5. 自动分配边界外进入经理审批。

验收门：

- AI 无权扩大候选销售集合。
- 规则拒绝时 AI 排名不能强制分配。
- 并发和重复请求不产生重复账户。
- 审批页面显示证据、排名、阻断和回退方案。

预计：4-6 个工作日。

### 阶段 3：销售执行闭环

范围：任务推送、认领、`sales_pack`、`action_proposal`、`next_action`。

任务：

1. 认领后异步生成销售资料包。
2. 客户页展示摘要、证据、切入点、风险和草稿。
3. 自然语言结果转活动提案，销售确认后保存。
4. 下一步建议进入今日任务和 SLA 提醒。
5. 企微投递失败保留 CRM 内通知。

验收门：

- AI 不自动发送消息。
- AI 不自动修改金额、阶段或活动事实。
- 所有业务写入都有员工确认和审计。
- 调度器重启后任务不丢失、不重复。

预计：4-6 个工作日。

### 阶段 4：经理监督和反馈优化

范围：`manager_anomaly`、`sales_coaching`、版本化评估。

任务：

1. 确定性规则筛选异常客户和漏斗事件。
2. AI 对异常做解释、排序和干预建议。
3. 按团队权限生成辅导建议。
4. 保存成交、回复、退回和停滞标签。
5. 建立模型/提示词影子评估和人工发布门。

验收门：

- 经理只能看到授权团队。
- AI 不在线自行修改规则或提示词。
- 新策略有旧版本对照、核心指标和一键回滚。

预计：4-7 个工作日。

### 阶段 5：生产试运行和正式上线

任务：

1. 在生产数据上只读影子运行。
2. 检查结果质量、成本、延迟和失败率。
3. 先开放管理员和少量销售。
4. 收集人工采纳、驳回和业务结果。
5. 达到门槛后逐步全员开放。

上线门：

- 关键测试全部通过。
- 数据库备份和代码回滚演练通过。
- 没有越权读取和联系人泄露。
- AI 失败不阻断现有 CRM 主流程。
- 模型成本和并发有明确上限。
- 经理确认产品工作流符合实际业务。

预计：5-10 个工作日，可与后半段开发部分重叠。

## 12. 生产目录整改执行计划

必须按顺序执行：

1. 记录当前 SHA、服务状态、软链接和端口。
2. 对活动数据库执行 quick_check。
3. 使用 SQLite `.backup` 创建带时间戳的在线备份并再次 quick_check。
4. 从最新 `origin/main` 解析完整目标 SHA。
5. 使用 bare deploy repo 的 `git archive` 导出到隐藏 candidate 目录。
6. 写入 `.release-sha`。
7. `npm ci`、`npm test`、Node/Zsh/Python 语法检查。
8. 将共享 runtime 路径链接到 candidate。
9. candidate 原子 rename 为 `releases/<12-char-sha>`。
10. 将当前 release 记录为生产根目录内的 `previous`。
11. 原子切换 `current`。
12. 重启 server 和 workers。
13. 检查本地、公网、healthz、SHA、数据库和日志。
14. 成功后写 `state.json`；失败立即切回 previous 并重启。

本阶段禁止：

- 删除旧 release、旧仓库或历史备份。
- 普通复制活动 WAL 数据库。
- 自动恢复旧数据库。
- 在 release 目录执行 Git checkout、pull 或手工修复。
- 同时修改 AI 业务功能。

## 13. 开发环境整改执行计划

1. 创建 `tradepulse-development/repo` 干净 clone。
2. 校验 `repo/main == origin/main` 且工作区为空。
3. 创建 `worktrees/ai-integration` 和分支 `codex/ai-integration`。
4. 创建独立 `runtime/ai-integration`。
5. 生成开发 `.env`，仅设置本地端口和独立路径，不复制生产密钥。
6. 创建独立 CRM 测试数据库并通过 schema/setup。
7. 安装锁定依赖并运行正式仓库完整测试。
8. 启动开发服务，确认不会读取生产数据库。
9. 在 README 或 `docs/development.md` 固化启动、测试和新 worktree 规则。
10. 给旧项目添加明显的只读/归档说明，但确认前不移动、不删除。

## 14. 测试策略

### 单元和契约测试

- 8 个 Schema 的合法与非法输出。
- 证据白名单和候选 ID 白名单。
- 权限、客户范围和联系人脱敏。
- context hash 过期拒绝。
- 路由超时、失败切换和错误脱敏。
- 任务幂等、租约、重试、待复核和死信。

### 集成测试

- 客户池到评分。
- 联系就绪到补研或分配。
- 销售候选到规则裁决和经理审批。
- 认领到资料包和首次触达。
- 活动到下一步和 SLA。
- RFQ 到报价和订单。
- 异常到经理干预。

### 浏览器验收

- 管理员、经理、销售三个角色。
- 桌面和移动宽度。
- 加载、空状态、失败、重试、低置信度和无权限状态。
- 页面显示真实 AI 结果而非固定演示数据。
- 不同用户不能通过 URL 或 API 查看其他客户。

### 生产检查

- SQLite quick_check。
- `/healthz` 的 release SHA 和 DB 状态。
- 本地和公网 HTTP。
- LaunchAgent 运行目录和进程状态。
- Worker 租约、积压、死信和重复执行。
- 日志中的 5xx、超时、权限拒绝和敏感信息。

## 15. 回滚策略

### 代码回滚

- `current` 原子切换到 `previous`。
- 重启 server 和 workers。
- 检查本地、公网和 healthz。

### 功能回滚

- AI 功能使用 feature flag，可按工作站关闭。
- 关闭 AI 后保留已有结果和审计，但页面回到规则/人工流程。
- 模型和提示词按版本回退，不覆盖历史结果。

### 数据库处理

- 部署前始终在线备份。
- 新迁移优先新增表和列，不删除现有业务对象。
- 生产脚本不得自动恢复数据库。
- 需要数据库恢复时停止全部写入服务，由管理员人工确认备份 SHA、时间和 quick_check 后执行。

## 16. 时间估算

在不重做现有 CRM、账号、权限和 AI 路由的前提下：

- 环境统一：2-3 个工作日。
- 第一个用户可见 AI 评分：已完成。
- AI Control Plane：4-7 个工作日。
- 新客户自动补全闭环：4-7 个工作日。
- 判断和分发闭环：4-6 个工作日。
- 销售执行闭环：4-6 个工作日。
- 经理监督和反馈：4-7 个工作日。
- 生产影子运行和验收：5-10 个工作日，可部分并行。

目标节奏：

- 正式 CRM 内的真实 AI 评分已经可见。
- 从当前约 8-14 个工作日看到多任务执行和新客户补全的完整开发效果。
- 从当前约 5-8 周达到全流程受控生产上线标准；实际取决于真实数据质量、外部 API 和人工验收。

估算不包含：

- 新建多租户 SaaS 架构。
- SQLite 迁移 PostgreSQL。
- 未提供的企微、邮件或第三方渠道审批时间。
- 大规模生产数据人工清洗。

## 17. 关键风险与控制

| 风险 | 控制方式 |
|---|---|
| 两套 CRM 继续分叉 | 正式仓库唯一化，新项目冻结为能力来源 |
| 开发误连生产 DB | 独立 runtime + 启动路径硬保护 |
| AI 虚构证据或销售 | evidence/candidate 白名单 + Schema 拒绝 |
| AI 结果过期 | context hash 保存前复核 |
| AI 失败阻断业务 | 规则和人工 fallback |
| 生产版本不明 | archive release + `.release-sha` + `/healthz` |
| 发布失败 | candidate 验证 + 在线备份 + 原子 current/previous |
| 权限泄露 | 复用现有 deny-by-default 和行级范围 |
| SQLite 并发上升 | 单机 WAL、短事务、数据库协调的全局槽位；用压测阈值决定是否迁移 PostgreSQL/Redis |
| 成本失控 | 调用前预算预占、调用后结算、四级日/月预算、80% 告警、100% 阻止和 fallback 计费 |
| 同步 AI 阻塞 Web | 所有业务 AI 任务持久入队并由独立 Worker 执行，客户创建立即返回 |
| 在线自我修改失控 | 只做离线评估，人工批准后发布新版本 |

## 18. 明确不做的事情

- 不推倒重写正式 CRM。
- 不把 `tradepulse-ai-crm` 整库部署为新的生产 CRM。
- 不迁移或重建现有账号、权限组和 AI 路由。
- 不让 AI 自动发送外联消息。
- 不让 AI 自动修改报价金额、订单或客户归属。
- 不在低置信度或风险情况下自动分配。
- 不删除当前脏仓库、旧 release 或备份，直到新流程稳定并另行确认。
- 不把通过 smoke test 等同于产品完成。

## 19. 项目完成定义

项目只有同时满足以下条件才算完成：

1. 销售从正式 CRM 登录后，可以沿客户池、分配、认领、资料包、触达、下一步、RFQ、报价、订单完成真实工作。
2. 8 个 AI 工作站在对应页面可见，带证据、置信度、版本和状态。
3. AI 失败时，规则和人工流程仍可完成业务。
4. 管理员可配置模型和查看健康状态，但密钥不暴露。
5. 经理可看到团队异常和辅导建议，销售看不到越权客户。
6. 生产版本、数据库、日志、备份和回滚路径明确且可验证。
7. 开发环境与生产完全隔离，任何人都能按文档重建开发实例。
8. 所有关键业务写入和 AI 决策有审计记录。
9. 生产试运行指标和人工验收达到约定门槛。
10. 新客户可从最小线索异步补全为有来源、有置信度、可复核的客户画像。
11. 多客户任务可排队并发执行，且并发、速率、预算和费用均可查看和控制。

## 20. 执行控制

本计划确认前：

- 不执行生产 current 切换。
- 不创建或移动正式开发目录。
- 不停止现有服务。
- 不移动历史备份。
- 不合并或部署 AI 业务代码。

计划确认后，严格从阶段 0 开始。每个阶段完成时必须更新本文档中的实际 SHA、验证结果、未完成项和下一阶段准入结论，不能跳过验收门直接继续。

## 21. 确认清单与执行台账

开始实施前，需要整体确认以下决策：

- [x] `russia-crm-local/origin/main` 是唯一正式产品源码。
- [x] `tradepulse-ai-crm` 和 `tradepulse-ai-workflow` 不再作为独立生产 CRM。
- [x] 开发根目录使用 `/Users/ylf/Desktop/projects/tradepulse-development`。
- [x] 先完成阶段 0 的生产和开发环境统一，再开始 AI 业务集成。
- [x] 生产只部署 `origin/main` 的不可变完整 SHA release。
- [x] 当前旧仓库、旧 release 和备份只保留，不在本轮删除。
- [x] 现有生产账号、密码、会话和权限配置原样保留。
- [x] 现有 Kimi、Hermes、DeepSeek AI 路由、管理员控制和运行配置原样保留。
- [x] AI 外发、金额、归属和高风险分配继续保留人工或规则最终确认。
- [x] 原始目标为约 2 周内部试用、3-5 周受控生产上线；加入完整 Control Plane 和新客户自动补全后，重估为从当前 8-14 个工作日看到闭环开发效果、约 5-8 周达到全流程受控生产标准。

执行台账：

| 阶段 | 状态 | 目标 SHA / 分支 | 验证结果 | 回滚点 | 备注 |
|---|---|---|---|---|---|
| 主计划确认 | 已确认 | 本文档 v1.0 | 用户于 2026-07-23 确认开始执行 | 不适用 | 实施受本文档约束 |
| 执行计划确认 | 已确认 | `docs/planning/tradepulse-execution-plan.md` v1.0 | 用户确认执行 E0-01 至 E0-05 | 不适用 | 不越过生产切换门 |
| 阶段 0：环境统一 | 已完成 | 生产 `2b55ed0fb7fc2c455199dd11e269cf93115ac325`；回滚 `f7bb248e91f2bfe7003dfe443e1d04f0ed1887de`；开发分支 `codex/ai-integration` | PR #15 已合并并自动部署；current、previous、state.json 一致；本地/公网健康返回目标 SHA，首页 200，数据库 WAL/quick_check=ok，候选验证 242/242，账号/权限/会话/AI router 摘要未变化；3100 独立开发实例登录、bootstrap、路径隔离和 242/242 测试通过 | `releases/f7bb248e91f2` + E0-08/E0-09 备份 | E0-01 至 E0-10 全部完成；下一步阶段 1 A1-01 `customer_fit`，尚未开始 AI 业务集成 |
| 阶段 1：评分、Control Plane 与客户补全 | 已完成 | 生产 `92e9f609`；开发集成 `codex/ai-integration` @ `35341e8` | A1-01 至 A1-08 已完成既有门禁。A1-09.1 PR #28 完成最小客户事务和 DAG；A1-09.2 PR [#30](https://github.com/mewmind-chen/russia-crm-local/pull/30) 完成 evidence/provenance、去重和 identity；A1-09.3 PR [#32](https://github.com/mewmind-chen/russia-crm-local/pull/32) 完成 legacy adapter、预算归因、事务 completion event、租约恢复与取消；A1-09.4 PR [#34](https://github.com/mewmind-chen/russia-crm-local/pull/34) 完成字段提案保护、finalize、受保护 API、任务中心投影和客户 UI；A1-09.5 PR [#36](https://github.com/mewmind-chen/russia-crm-local/pull/36) 完成三类 E2E、6 Worker/20 跨客户竞争、租约/故障矩阵和隔离开发真实模型 smoke，最终聚焦 62/62、smoke/identity 14/14、完整回归 408/408、Python 检查、GitHub CI 与独立复审通过。生产 current/health 不变，AI Station、Worker 和 enrichment flags 仍关闭且未部署 | `releases/2b55ed0fb7fc` + 部署前备份 | A1-09 已完成；下一步阶段 2 A2-01 扩展合同 |
| 阶段 2：判断分发 | 进行中 | 集成基线 `codex/ai-integration` @ `4e4619e` | A2-01 PR [#38](https://github.com/mewmind-chen/russia-crm-local/pull/38)、A2-02 PR [#44](https://github.com/mewmind-chen/russia-crm-local/pull/44)、A2-03 PR [#46](https://github.com/mewmind-chen/russia-crm-local/pull/46) 与 A2-04 PR [#49](https://github.com/mewmind-chen/russia-crm-local/pull/49) 已合并，CI `test` 通过；A2-04 新增规则最终裁决：AI 仅作建议，事务内重读有效销售、权限、负荷和配额，一致且高置信自动分配，AI 不可用确定性回退，冲突/低置信/高价值/风险/重复/跨团队进入经理审批或规则阻止，快照 token 服务端 fail-closed；聚焦 5/5、完整回归 435/435、语法/diff 检查通过；页面与完整审计尚未实现，尚未部署，生产 current/health、AI Station、Worker 和 flags 未变化 | 工作站 feature flag | A2-04 已完成；下一步 A2-05 页面与审计 |
| 阶段 3：销售执行 | 未开始 | 待填写 | 待填写 | 工作站 feature flag | 外发人工确认 |
| 阶段 4：经理与反馈 | 未开始 | 待填写 | 待填写 | 模型/提示词旧版本 | 禁止在线自我修改 |
| 阶段 5：生产试运行 | 未开始 | 待填写 | 待填写 | previous release + flags | 分批开放 |

当前总进度：38 个计划任务中已完成 23 个，剩余 15 个。A2-04 在
`codex/ai-rule-arbitration-a2-04` 基于集成分支完成规则最终裁决：AI 只作为
`chooseIntakeOwner` 建议，服务端事务内重读授权销售、负荷和配额；一致且高置信自动分配，
AI 不可用确定性回退，冲突、低置信、高价值、风险、重复和跨团队进入经理审批或规则阻止。
聚焦验收 5/5、完整回归 435/435、语法检查、`git diff --check` 和 CI 通过。证据见
`docs/evidence/a2-04-assignment-arbitration.md`。实现提交 `ea8fb8b`，PR
[#49](https://github.com/mewmind-chen/russia-crm-local/pull/49) 已合并到
`codex/ai-integration` @ `4e4619e`；本任务未执行部署。生产 current/health、previous 和
`CRM_AI_STATIONS_ENABLED=false` 未变化。下一步为阶段 2 A2-05 页面与审计，本任务完成后停止。
任何范围、目录、数据模型、上线门或时间目标的改变，都必须先修改本文档并重新确认，不能只在临时消息中改变执行方向。
