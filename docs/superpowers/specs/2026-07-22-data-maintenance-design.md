# CRM 数据维护与安全重置设计

## 背景

当前系统仍处于设计和流程优化阶段，需要反复验证“线索入库 → 分配 → 领取 → 跟进”的完整链路。现有 `scripts/reset-crm-to-undeveloped-leads.js` 可以备份数据库并删除 `crm_accounts`，但它把 `claimed` 退回 `assigned`，仍保留负责人和分配状态，不能满足“全部取消分配后重新来”的需求；直接在 SQLite 中手工执行 `DELETE` 又容易留下孤立的入库状态、通知和统计。

本设计在现有 Node.js、Express、better-sqlite3、SQLite 和浏览器原生前端上增加管理员专用的“数据维护”能力。第一版聚焦最迫切且边界清楚的“重置客户分配”，后续再扩展到研究数据清理和测试客户删除。

## 目标

1. 管理员可以预览并重置指定范围内的客户分配，让线索回到 `approved`（待分配）状态。
2. 重置时删除由这些分配产生的 CRM 经营数据，但保留客户主档、筛选结果和研究证据。
3. 每次执行前生成一致的 SQLite 备份，所有数据库修改在单一事务中完成。
4. 执行前展示精确影响范围，并要求短时有效的预览凭证和明确确认文字。
5. 维护操作只允许真实管理员执行，身份检查期间禁止预览和执行。
6. 记录不可篡改的维护运行摘要，能够回答“谁、何时、按什么条件、清了多少、备份在哪里”。

## 非目标

- 第一版不删除整个 `crm.db`。
- 第一版不删除 `sales_users`、权限组、会话、系统设置或审计日志。
- 第一版不提供任意 SQL 执行框。
- 第一版不清除 `customer_pool`、Recon、联系人研究、制裁核查或原始导入批次。
- 第一版不提供无筛选、无预览的“一键清空全部数据”。
- 第一版不支持自动恢复备份；恢复仍由服务器管理员停服后人工完成。

## 当前数据关系

### 客户经营数据

`crm_accounts` 是销售经营侧客户根记录，以下表通过 `ON DELETE CASCADE` 依附于它：

- `crm_activities`
- `crm_rfqs`
- `crm_quotes`
- `crm_orders`
- `crm_account_contacts`
- `crm_manager_evaluations`

删除目标 `crm_accounts` 可以可靠清除上述经营过程数据。`crm_notifications` 没有该外键，需要按目标 CRM 客户 ID 显式删除或关闭；第一版选择删除与目标客户直接关联的通知，保留用户级和系统级通知。

### 入库与分配数据

`crm_intake_items` 保存客户从入库到领取的状态：

`pending → approved → assigned → claimed`，另有 `returned / rejected / duplicate` 等状态。

彻底重新分配时，目标记录应恢复为：

- `status = 'approved'`
- `crm_customer_id = ''`
- `assigned_owner_id = ''`
- `suggested_owner_id = ''`
- `decision_reason = ''`
- `return_reason = ''`
- `assigned_at = ''`
- `claim_due_at = ''`
- `claimed_at = ''`
- `updated_at = 当前时间`

`match_score`、`match_group`、公司资料、联系人摘要、证据链接、`batch_id` 和创建时间全部保留。每个受影响批次的 `assigned_count` 在事务内根据剩余 `assigned / claimed` 项重新计算，不能依赖递减计数。

### 保留的研究数据

以下内容与销售分配解耦，重置分配时必须保留：

- `customer_pool` 客户主档
- `company_screening`
- `recon_jobs / recon_results / recon_evidence`
- 联系人研究及其证据表
- `assistant_documents / assistant_embeddings`
- `crm_intake_batches` 和未命中的 `crm_intake_items`
- 账号、权限组、权限覆盖、会话、系统设置和审计日志

## 第一版操作：重置客户分配

### 可选范围

管理员必须至少提供一个范围条件：

- 一个或多个 `batchId`
- 一个或多个 `ownerId`
- 一个或多个 `intakeItemId`
- 分配时间区间 `assignedFrom / assignedTo`

前端可以提供“当前全部已分配/已领取线索”的快捷选项，但请求仍需显式发送 `allAssigned: true`。服务端不接受空条件。

目标状态默认限定为 `assigned / claimed / returned`。`pending / approved / rejected / duplicate` 不参与重置。若指定 ID 中包含不可重置状态，预览返回 `skippedByStatus`，执行时仍只处理预览确认的可重置集合。

### 目标 CRM 客户识别

服务端从目标 `crm_intake_items.crm_customer_id` 和 `crm_accounts.intake_item_id` 双向解析 CRM 客户，二者必须一致。出现以下任一情况时预览标记冲突，执行返回 `409 MAINTENANCE_CONFLICT`，不做部分清理：

- 一个 intake item 对应多个 CRM 账户；
- `crm_customer_id` 指向不存在的账户；
- 账户的 `intake_item_id` 指向另一个 intake item；
- 目标账户没有可追溯的 intake item，属于手工创建客户。

手工创建的 CRM 客户不属于“重置分配”范围，未来使用独立的“删除测试客户”操作处理。

### 删除与保留矩阵

| 数据 | 第一版行为 | 原因 |
|---|---|---|
| 目标 `crm_accounts` | 删除 | 取消领取后不应继续出现在 CRM 客户全景 |
| 活动、RFQ、报价、订单 | 级联删除 | 属于本轮销售经营过程 |
| CRM 联系人、经理评价 | 级联删除 | 属于 CRM 账户副本和经营评价 |
| 目标客户通知 | 显式删除 | 没有外键级联，避免残留提醒 |
| `crm_intake_items` | 恢复为 `approved` 并清空分配字段 | 回到待分配队列 |
| `crm_intake_batches` | 保留并重算 `assigned_count` | 保留导入历史，修正统计 |
| `customer_pool` | 保留 | 客户主档和后续重新分配来源 |
| Recon、联系人研究、制裁证据 | 保留 | 研究成果可复用，避免重复成本 |
| AI 索引 | 保留 | 底层研究资料未删除 |
| 用户、权限、会话、设置 | 保留 | 与业务重置无关 |
| 通用审计日志 | 保留 | 安全追踪不可被维护操作删除 |

## 权限与安全边界

新增权限 `manage_data_maintenance`，显示名“管理数据维护”。

- 系统默认管理员组为 `true`。
- 经理和销售默认组为 `false`。
- API 同时要求有效权限和 `realAdminOnly`，不能仅通过个人权限覆盖把经理提升为数据维护管理员。
- 所有数据维护路由 `blockedWhileImpersonating: true`。
- 服务端是最终边界；隐藏菜单不能替代 API 权限校验。
- 维护运行不能删除当前或历史审计记录。

## 预览与执行协议

### `POST /api/sales-crm/data-maintenance/preview`

请求：

```json
{
  "operation": "reset_assignments",
  "filters": {
    "batchIds": ["BATCH-2026-07-22"],
    "ownerIds": [],
    "intakeItemIds": [],
    "assignedFrom": "",
    "assignedTo": "",
    "allAssigned": false
  }
}
```

响应包含：

- `previewId`：随机、不可预测、与真实管理员及当前 session 绑定；
- `expiresAt`：默认 10 分钟；
- 规范化后的操作和筛选条件；
- 目标 intake item、CRM 账户及各子表数量；
- `skippedByStatus` 和冲突列表；
- `targetFingerprint`：按稳定排序的目标 ID、状态、更新时间和计数计算的 SHA-256；
- `confirmationText`，例如 `重置 27 条客户分配`。

预览仅读取，不生成备份、不修改数据库、不写普通业务审计。可以记录一条 `previewed` 维护运行摘要，但不得把完整客户资料写入日志。

### `POST /api/sales-crm/data-maintenance/execute`

请求：

```json
{
  "previewId": "随机预览凭证",
  "confirmationText": "重置 27 条客户分配"
}
```

执行必须：

1. 校验预览存在、未过期、未使用，并属于当前真实管理员和 session。
2. 重新解析目标并计算 fingerprint；与预览不同则返回 `409 MAINTENANCE_PREVIEW_STALE`。
3. 如果存在关系冲突，返回 `409 MAINTENANCE_CONFLICT`。
4. 校验确认文字完全一致。
5. 获取进程内维护互斥锁；已有执行时返回 `409 MAINTENANCE_BUSY`。
6. 使用 SQLite online backup 生成带时间戳的完整备份。
7. 在一个 `IMMEDIATE` 事务中删除目标账户、删除目标通知、重置 intake item、重算批次统计并写维护运行结果。
8. 提交后将 preview 标记为已使用，返回备份文件名和前后计数。

执行端点不得接受新的筛选条件，防止预览内容和实际执行范围不一致。

### 查询接口

- `GET /api/sales-crm/data-maintenance/runs?limit=20`：最近维护记录。
- `GET /api/sales-crm/data-maintenance/capabilities`：备份目录可写性、数据库路径是否存在、当前是否忙碌；不返回绝对数据库路径给浏览器。

第一版不提供通过浏览器下载数据库备份，避免把完整客户数据库暴露为 Web 资源。

## 数据模型

新增 `crm_data_maintenance_runs`：

- `id`
- `operation`
- `status`：`previewed / running / completed / failed / stale`
- `filters_json`
- `target_fingerprint`
- `preview_counts_json`
- `result_counts_json`
- `backup_file`
- `error_code`
- `error_message`
- `real_user_id`
- `session_hash_prefix`（仅不可逆 hash 的短前缀，不能保存原 session）
- `preview_expires_at`
- `started_at / finished_at / created_at`

短时预览凭证保存在进程内 Map，只在表中保存其 SHA-256 hash。服务重启后所有未执行预览自然失效。`backup_file` 只保存备份目录内的文件名，不保存用户可控路径。

## 备份策略

- 默认目录：`<项目根目录>/backups/data-maintenance/`。
- 可通过 `CRM_BACKUP_DIR` 覆盖，但必须在服务启动时解析为绝对路径。
- 文件名：`crm-before-reset-assignments-<UTC时间>-<runId>.db`。
- 使用 `db.backup()` 创建一致快照，不能直接复制处于 WAL 模式的 `crm.db`。
- 备份成功后才允许进入删除事务；备份失败则整个操作失败。
- 第一版不自动删除旧备份，避免未确认保留策略前丢失恢复点。
- 响应只返回备份文件名、大小和创建时间，不返回下载 URL。

## 并发与故障处理

- 同一 Node 进程同一时间只允许一个维护执行。
- 预览期间允许正常业务写入；因此执行前必须重算 fingerprint。
- 备份完成到事务提交之间若数据库忙，使用现有 SQLite busy timeout；最终失败时事务回滚，备份保留。
- 事务失败后运行状态记为 `failed`，错误日志不得包含客户联系人详情、session 或密码。
- 进程在 `running` 状态中崩溃时，SQLite 事务自动回滚；下次启动把遗留 `running` 标记为 `failed`，并提示人工核对备份。
- 执行完成后前端必须重新加载 bootstrap 数据，不能依赖本地删除行模拟结果。

## 后台交互

在“系统”分组新增“数据维护”，仅对具有 `manage_data_maintenance` 权限的真实管理员显示。

页面第一版包含：

1. **重置客户分配**卡片：选择批次、负责人、分配时间或具体线索；支持“全部已分配/已领取”。
2. **影响预览**：分别显示线索、CRM 客户、活动、RFQ、报价、订单、联系人、评价、通知数量，并列出冲突和跳过项。
3. **确认抽屉**：明确展示“保留哪些、删除哪些”、备份说明和动态确认文字输入框。
4. **执行结果**：显示 run ID、前后数量、备份文件名和刷新按钮。
5. **最近维护记录**：显示操作者、操作、范围摘要、结果、时间和备份文件名。

危险按钮使用红色样式，但不依赖颜色传达风险。预览失效、数据变化和并发冲突使用明确错误文案并要求重新预览。

## 模块边界

新增 `lib/data_maintenance.js`，集中负责：

- schema 安装；
- 筛选条件规范化；
- 目标解析与关系一致性检查；
- 影响计数和 fingerprint；
- preview 生命周期；
- backup；
- 事务执行和运行日志。

`lib/sales_crm.js` 只注册 API、传入真实身份/session 上下文并格式化响应，不内嵌删除 SQL。现有 CLI 脚本最终改为调用同一模块，避免后台和脚本出现两套不同重置语义。

## 后续版本

后续操作必须复用同一套 preview/execute/backup/audit 框架：

- `clear_sales_progress`：保留分配和 CRM 账户，只清经营活动；需要定义账户阶段如何回退。
- `clear_research_data`：按客户或批次清理 Recon、联系人研究和 AI 索引；需要完整外键/手工级联矩阵。
- `delete_test_customers`：删除客户主档及全部衍生数据；必须增加“仅测试来源/显式客户 ID”约束。
- `restore_backup`：仅在解决停服、文件锁和恢复后校验后再考虑，不放入第一版 Web UI。

## 验收标准

1. 非管理员、缺少权限或身份检查状态调用维护 API 均返回 403，且数据库和备份目录无变化。
2. 空筛选不能预览或执行。
3. 预览不写业务表，返回准确影响计数和确认文字。
4. 预览后目标发生变化，执行返回 409 且不生成删除结果。
5. 备份失败时零业务数据变化。
6. 执行成功后目标 intake item 全部回到 `approved` 且分配字段清空。
7. 目标 CRM 账户及经营子表、直接关联通知被清除。
8. 客户主档、Recon、联系人研究、AI 索引、用户和权限数据完全保留。
9. 非目标客户和非目标批次无变化，批次统计与真实状态一致。
10. 同一 preview 只能执行一次，并发执行最多一个成功。
11. 维护运行和通用审计均能追溯真实管理员，且不记录敏感凭据。
12. 全量测试通过，生产部署前完成一次副本数据库演练和人工恢复验证。
