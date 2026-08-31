# A1-09 新客户自动补全闭环设计

> **历史资料（已冻结）**：本文记录 2026-07-24 的设计上下文，不是当前进度、基线或执行指令。当前判断以 `docs/governance/README.md` 为准。

**日期：** 2026-07-24

**状态：** 已确认，待规格审阅

**基础分支：** `codex/ai-integration` @ `1230c2bbfe8aafbbf939b0151999b8d27397f9f7`

**关联计划：** `docs/archive/planning-2026-07-25/tradepulse-execution-plan.md` A1-09、`docs/archive/planning-2026-07-25/tradepulse-unified-master-plan.md`

## 1. 背景

A1-08 已提供持久队列、DAG、独立 Worker、跨进程全局并发、每客户串行、租约恢复、预算、任务中心、权限复验、审计和降级能力。现有系统同时保留两套成熟的专用研究执行链：

- `recon_jobs` 与 `scripts/recon_agent_worker.py`
- `contact_recon_jobs` 与 `scripts/contact_recon_worker.py`

A1-09 的目标是在不迁移上述专用 Worker 的前提下，让销售只提供公司名、官网或最小线索即可立即创建客户，再由 A1-08 在后台编排官网/主体核验、Recon、联系人、评分、标签、完整度、证据和人工复核。

## 2. 已确认决策

1. 采用“混合编排适配层”：
   - A1-08 负责 DAG、权限、预算、取消、状态和任务中心。
   - 现有 Recon/Contact Worker 继续执行实际搜索。
   - 持久适配层关联 A1-08 job 与旧任务，并在旧任务提交结果时唤醒后续节点。
2. 自动补全不使用系统身份绕过用户权限：
   - 最小客户创建只要求 `create_customer`。
   - 自动补全还要求创建人具备全部 AI、Recon、客户查看和联系人权限。
   - 权限不足时只创建最小客户，并记录明确的未启动原因。
3. 保留现有负责人规则：
   - 销售创建时默认归属自己。
   - 管理员或经理创建时明确选择负责人。
   - AI 不修改 `owner_id`。
   - `pending_assignment` 仅为阶段 2 的业务路由建议。
4. A1-09 拆为五个可独立验收和合并的子任务。
5. 生产不开启新功能、不读取生产 provider 密钥，也不在 A1-09 开发阶段部署生产。

## 3. 目标与非目标

### 3.1 目标

- 公司名或官网至少填写一项即可立即创建最小客户。
- 通过持久触发记录保证创建请求不等待 Router、模型、网页或 Worker。
- 使用 A1-08 DAG 编排确定性预检、旧 Worker 任务及模型节点。
- 同客户、同输入上下文重复触发时幂等去重。
- 每个建议字段具有来源、采集时间、置信度和生成版本。
- AI 不静默覆盖员工确认字段。
- 客户页和任务中心可查看流程、节点、证据、失败、取消和人工复核状态。
- AI、预算、网页或旧 Worker 不可用时，最小客户仍可查看和编辑。

### 3.2 非目标

- 不把 Recon/Contact Worker 迁移为 A1-08 原生 executor。
- 不自动外发消息。
- 不自动改变负责人、分池或审批结论。
- 不在 A1-09 实现阶段 2 的评分裁决与自动分配。
- 不把无证据推断写成已确认事实。
- 不以高频轮询旧任务状态作为正常完成机制。

## 4. 总体架构

### 4.1 创建路径

`POST /api/sales-crm/accounts` 接受：

- `companyName`
- `website`
- 或二者同时提供

国家字段不再强制。只有官网时，服务端从规范化域名生成临时显示名，并标记为未确认来源。

创建事务完成三项写入：

1. `customer_pool` 最小记录
2. `crm_accounts` 最小记录
3. 持久补全触发记录

事务不调用 Router、模型、网页或外部 Worker。接口提交后立即返回客户 ID、外部客户 ID和补全摘要。

精确域名或标准化名称重复在创建事务前同步识别，并返回现有客户，不创建第二条记录。模糊重复留给后台预检和人工复核。

### 4.2 启动门

创建服务先根据当前 actor 计算一次启动门：

- 条件满足时，触发记录写为待调度。
- 条件不满足时，触发记录直接写为 `skipped` 和稳定原因码，创建响应可立即显示未启动原因。

调度器读取待调度记录后，再按当前状态重新验证：

- `CRM_AI_CUSTOMER_ENRICHMENT_ENABLED`
- `CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED`
- 创建用户仍有效
- 创建用户仍能查看目标客户
- `use_ai_assistant`
- `run_recon`
- `view_recon`
- `view_contacts`

任一条件不满足时不创建 DAG，触发记录进入 `skipped`，并保存稳定原因码。客户创建不回滚。两次检查之间权限被撤销时，以调度时复验结果为准。

### 4.3 DAG

初始 DAG 为：

1. `intake_precheck`
   - 输入规范化
   - 精确及模糊去重
   - 风险预检
2. `identity_verify`
   - 官网候选
   - 经营主体、国家和基础信息核验
3. `recon_dispatch`
   - 创建或复用 `recon_jobs`
4. `recon_collect`
   - 接收 Recon 完成通知
   - 将结果和证据归一化
5. `contact_dispatch`
   - 创建或复用 `contact_recon_jobs`
6. `contact_collect`
   - 接收 Contact Recon 完成通知
   - 将联系人候选和证据归一化
7. `customer_fit`
   - 复用 A1-01 `customer_fit`
   - 生成评分、标签、完整度和待补项
8. `enrichment_finalize`
   - 生成字段提案
   - 检测冲突
   - 计算最终路由

依赖关系由 A1-08 workflow、`parent_job_id` 和 `depends_on` 表达。同客户仍受 A1-08 客户锁保护。

### 4.4 旧 Worker 适配

适配层持久保存：

- enrichment run
- DAG node
- A1-08 job
- legacy task type
- legacy task ID
- 当前适配状态
- 完成/取消版本

`submitReconResult` 和 `submitContactReconResult` 在提交旧任务结果的同一个数据库事务内写入持久完成事件。事务提交后尝试立即通知 DAG；独立事件消费器也会恢复处理尚未消费的完成事件，避免进程在提交结果和通知之间崩溃时丢失唤醒。通知处理器幂等唤醒对应 collect 节点，重复通知不重复创建结果或推进 DAG。

取消采用协作式传播：

- 未派发节点直接跳过。
- 已派发的旧任务写入取消请求。
- 旧 Worker 在安全点检查取消请求。
- 取消后的迟到结果只保存为证据，不进入字段自动合并。

## 5. 持久数据

### 5.1 Enrichment run

`crm_ai_enrichment_runs` 至少保存：

- `id`
- `customer_id`
- `crm_account_id`
- `workflow_id`
- `trigger_source`
- `triggered_by`
- `input_fingerprint`
- `state`
- `route_state`
- `reason_code`
- `created_at`
- `updated_at`
- `finished_at`

同客户、同输入指纹、同生成版本只能存在一个活动 run。

### 5.2 Node link

`crm_ai_enrichment_node_links` 至少保存：

- `run_id`
- `node_key`
- `ai_job_id`
- `legacy_task_type`
- `legacy_task_id`
- `adapter_state`
- `completion_version`
- `cancel_requested_at`
- 时间戳

`ai_job_id` 与 legacy task identity 均建立唯一约束，防止竞争调度器重复派发。

### 5.3 Evidence

`crm_ai_enrichment_evidence` 至少保存：

- 来源 URL
- 来源类型
- 采集时间
- 内容摘要
- 内容哈希
- 置信度
- 采集器及版本
- 关联客户、run 和 node

原始敏感内容不写入审计摘要。联系人证据按 `view_contacts` 脱敏。

### 5.4 Durable completion event

`crm_ai_enrichment_events` 至少保存：

- `event_key`
- `run_id`
- `node_key`
- `legacy_task_type`
- `legacy_task_id`
- `event_type`
- `payload_hash`
- `created_at`
- `consumed_at`

`event_key` 唯一。旧任务结果和完成事件必须在同一数据库事务内提交。事件消费使用租约和幂等更新，崩溃后可以重新领取。

### 5.5 Field proposal

`crm_ai_field_proposals` 至少保存：

- 目标实体和字段
- 原值及原值哈希
- 建议值
- 证据引用
- 置信度
- 生成器及版本
- `pending/auto_applied/conflict/accepted/rejected/superseded`
- 复核人、理由和时间

## 6. 字段合并规则

1. URL 跟踪参数移除、域名小写化等机械规范化可直接应用，并写审计。
2. 当前字段为空、证据有效且置信度达到门槛时，可写入规范字段，但来源标记为 `ai_provisional`。
3. 员工输入或确认过的字段不自动覆盖。
4. 建议值与员工确认值不同，或可靠来源互相冲突时，提案进入 `conflict`，run 进入 `needs_review`。
5. 无证据、证据过期、置信度不足或主体不确定时，不写规范字段，只生成待补项。
6. 人工确认在一个事务内更新规范字段、来源状态和审计。
7. 人工驳回保留建议、原值和理由。
8. 上下文变化后生成新版本；旧提案标记为 `superseded`。

最终路由只允许：

- `missing_info`
- `needs_review`
- `pending_assignment`

路由不修改 `owner_id`。

## 7. 权限与审计

### 7.1 权限

- 最小客户创建：`create_customer`
- 自动或人工补全启动：
  - `view_customers`
  - `use_ai_assistant`
  - `run_recon`
  - `view_recon`
  - `view_contacts`
- 字段提案确认/驳回：上述查看权限加 `edit_customer`

每个节点执行前都重新加载用户、权限和客户范围。权限被撤销或客户移出范围时停止后续节点，记录 `permission_revoked`，不自动以系统身份继续。

### 7.2 审计

审计记录：

- 创建和触发来源
- 启动门判断
- DAG 创建、派发、完成、重试、取消
- 提案自动应用、人工确认、驳回和冲突
- 权限、预算和 feature flag 阻断

审计不记录 Cookie、provider 密钥、完整 prompt、完整联系人字段或未经脱敏的错误正文。

## 8. Feature flags

- `CRM_AI_CUSTOMER_ENRICHMENT_ENABLED`
- `CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED`

生产默认关闭。关闭时：

- 客户创建、查看和人工编辑保持可用。
- 新补全 run 不启动。
- 已有数据仍可按权限读取。

Recon、Contact、Router 和 AI Worker 继续受各自既有开关控制。

## 9. 状态和异常

对外节点状态统一投影为：

- `queued`
- `running`
- `succeeded`
- `needs_review`
- `failed`
- `skipped`

稳定原因码至少包括：

- `missing_permissions`
- `feature_disabled`
- `exact_duplicate`
- `possible_duplicate`
- `identity_uncertain`
- `no_public_contacts`
- `evidence_conflict`
- `budget_blocked`
- `permission_revoked`
- `cancelled`
- `provider_rate_limited`
- `provider_timeout`
- `worker_failed`
- `model_failed`

行为约定：

- 精确重复同步返回已有客户。
- 模糊重复、主体不确定或证据冲突进入 `needs_review`。
- 无公开联系人属于成功结果，不使整条流程失败。
- 预算不足时不调用外部能力，已有结果保留。
- 429、超时和临时网络错误沿用 A1-08 退避、租约及 fallback。
- 永久失败进入 `failed/dead_letter`，允许具备权限的用户显式重试。
- 旧 Worker 无精确 usage 时，使用 A1-08 `estimated_missing` 保守计费。

## 10. API 与页面

### 10.1 API

新增或扩展：

- 创建客户响应中的 `enrichment` 摘要
- 获取客户最新补全 run 与节点状态
- 显式启动重新补全
- 取消补全 run
- 获取字段提案与证据
- 确认或驳回字段提案

接口沿用现有销售认证、访问控制、客户行级范围和匿名化审计。

### 10.2 客户页

客户页增加：

- 补全步骤状态条
- 当前失败或跳过原因
- 重试与取消入口
- 公司画像
- 产品和潜在需求
- 联系人候选
- `customer_fit`
- 自动标签
- 完整度和待补项
- 字段证据
- AI provisional 标识
- 冲突前后值及确认/驳回操作

任务中心显示补全 workflow 和子节点，并可跳转客户。联系人数据继续按权限脱敏。

## 11. 测试与验收

### 11.1 单元测试

- 公司名/官网输入规范化
- 精确及模糊去重
- 输入指纹与幂等键
- 证据约束
- 字段合并及冲突
- 状态投影
- 联系人及错误脱敏

### 11.2 集成测试

端到端覆盖：

- 只有公司名
- 只有官网
- 资料不完整的已有客户
- 权限不足
- feature flag 关闭
- 精确重复
- 模糊重复
- 官网不确定
- 无公开联系人
- 员工字段冲突
- 预算阻断
- 429 和超时
- Worker 租约恢复
- 模型永久失败
- 取消后的迟到结果

### 11.3 并发与权限

- 多调度器竞争同一触发记录
- 重复完成通知
- 同客户串行
- 20 个跨客户补全流程不丢失、不重复
- 管理员、经理、销售三角色客户范围
- 联系人脱敏
- 提案确认/驳回权限

### 11.4 验收门

1. A1-09 专项测试通过。
2. 完整旧 CRM 回归通过。
3. GitHub CI 通过。
4. 开发环境真实模型 smoke 通过。
5. 不读取生产密钥。
6. 不部署生产。
7. 生产新 flags 保持关闭。

## 12. 分批交付与工期

### A1-09.1 创建、权限门、持久触发和 DAG 骨架

预计 0.5–1 个工作日。

### A1-09.2 去重、官网/主体与证据模型

预计 1–1.5 个工作日。

### A1-09.3 Recon/Contact 适配和完成唤醒

预计 1–2 个工作日。

### A1-09.4 提案合并、复核与客户页面

预计 1–1.5 个工作日。

### A1-09.5 端到端、并发、真实 smoke 和完整回归

预计 0.5–1 个工作日。

总工期预计 4–7 个工作日。每个子任务均执行：

1. 独立代码分支
2. 测试与证据
3. GitHub 代码 PR 合并到 `codex/ai-integration`
4. 独立权威计划文档更新
5. GitHub 文档 PR 合并
6. 汇报完成进度和下一项

## 13. 回滚和生产边界

- 所有新入口由独立 flags 关闭。
- 数据表采用前向兼容迁移，不删除既有 Recon、Contact 或 A1-08 数据。
- 关闭自动触发后，最小客户创建仍可用。
- 关闭总开关后，已生成结果只读可见，不继续执行。
- A1-09 完成只代表开发闭环具备申请生产影子运行的条件，不自动授权部署。
