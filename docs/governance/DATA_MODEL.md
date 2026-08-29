# TradePulse 数据模型（初始取证版）

更新时间：2026-08-27
状态：表级初稿；字段级关系、所有写入路径和最终真源待继续验证

## 数据分层

当前系统存在三套明显的数据层：

1. **旧/兼容层**：`customers`、`customer_pool`、`recon_*` 等基础表。
2. **统一 CRM 层**：`crm_accounts`、`crm_activities`、`crm_intake_*`、`crm_audit_log` 等。
3. **AI/治理层**：`crm_ai_*`、筛选授权表、迁移和质量记录。

不能仅根据表名判定哪一层是最终真源；需要结合读写路径、迁移脚本和生产数据继续验证。

## 核心实体关系（当前可确认部分）

```text
sales_users
  ├── sales_sessions
  ├── crm_accounts.owner_id
  ├── crm_activities.user_id
  ├── crm_audit_log.user_id
  └── crm_intake_items.assigned_owner_id / suggested_owner_id

customer_pool
  ├── crm_intake_items.external_customer_id
  ├── crm_accounts.external_customer_id
  ├── recon_jobs.customer_id
  └── company_screening.customer_id

crm_intake_batches
  └── crm_intake_items.batch_id
        └── crm_accounts.intake_item_id / crm_intake_items.crm_customer_id

crm_accounts
  ├── crm_activities.customer_id
  ├── crm_rfqs.customer_id
  ├── crm_quotes.customer_id
  ├── crm_orders.customer_id
  ├── crm_manager_evaluations.customer_id
  ├── crm_account_contacts.customer_id
  └── crm_notifications.customer_id

recon_jobs
  ├── recon_results.job_id
  └── recon_evidence.job_id

contact_recon_jobs
  ├── person_candidates.contact_recon_job_id
  ├── person_evidence.contact_recon_job_id
  └── contact_methods.person_id
```

## 关键表初稿

| 表 | 业务含义 | 当前关键字段 | 初步状态 |
|---|---|---|---|
| `customers` | 旧客户/跟进记录 | `follow_id`、`customer_id`、`status`、`owner`、`next_follow_date` | 兼容/历史来源，待确认是否仍被业务读取 |
| `customer_pool` | 企业线索池/外部客户档案 | `customer_id`、`domain`、`company_name`、`current_pool`、质量和 Recon 字段 | 线索和企业基础资料的重要来源 |
| `crm_accounts` | 统一 CRM 客户账户 | `id`、`external_customer_id`、`owner_id`、`stage`、`assignment_status`、`lifecycle_status` | 当前 CRM 主要业务表 |
| `crm_activities` | 客户开发活动和下一步信息 | `customer_id`、`activity_type`、`stage_after`、`occurred_at` | 历史动作与计划混合，需状态机分析 |
| `crm_intake_batches` | 每日入库批次 | `batch_date`、统计字段 | 批次聚合 |
| `crm_intake_items` | 具体线索入库和分配项 | `external_customer_id`、`status`、`assigned_owner_id`、`crm_customer_id` | 线索分配/领取流程核心 |
| `crm_audit_log` | 统一 CRM 操作审计 | `user_id`、`action`、`entity_type`、`entity_id`、`detail_json` | 审计记录，不能删除或覆盖 |
| `crm_manager_evaluations` | 企业/联系人经理评价及 AI 标注 | `customer_id`、`subject_type`、`evaluation_text`、AI 字段 | 人工原文与 AI 结果分开 |
| `recon_jobs` | 企业调研任务 | `job_id`、`customer_id`、`status`、`output_dir` | Worker 驱动 |
| `recon_results` | 企业调研结果 | `job_id`、结构化结论、证据和报告 | V3/legacy 兼容并存 |
| `recon_evidence` | 企业调研证据 | `job_id`、`field_name`、`source_url`、`confidence` | 证据明细 |
| `person_candidates` | 联系人候选 | `person_id`、`contact_recon_job_id`、就业和等级 | 联系人 Recon 结果 |
| `contact_methods` | 联系方式 | `person_id`、类型、验证和直接性字段 | 敏感信息 |
| `filter_definitions` | 筛选字段定义 | `filter_key`、字段类型、页面、敏感和权限要求 | 服务端授权 schema |
| `permission_group_filter_grants` | 权限组筛选授权 | `group_id`、`filter_key` | 组级授权 |
| `user_filter_extra_grants` | 用户额外筛选授权 | `user_id`、`filter_key` | 只能追加，需版本化 |
| `filter_permission_audit` | 筛选授权审计 | 前后 JSON、版本和操作者 | 权限变更审计 |
| `crm_ai_jobs` | AI Station 持久任务 | 状态、租约、依赖、资源和结果关联 | AI 调度核心 |

## 已确认的 ID 关系

- `crm_accounts.id` 是统一 CRM 内部客户 ID。
- `crm_accounts.external_customer_id` 与 `customer_pool.customer_id`、`crm_intake_items.external_customer_id` 对接。
- `crm_intake_items.crm_customer_id` 指向已创建的 CRM 客户账户。
- `crm_activities.customer_id` 指向 `crm_accounts.id`，存在外键级约束。
- `crm_accounts.external_customer_id` 有非空唯一索引，表明同一外部客户不允许同时建立多个有效账户记录；退回/重新进入的具体语义仍需继续验证。

## 当前确认的状态投影关系

- 客户列表主要从 `crm_accounts` 读取当前账户，并通过 `customer_pool` 补充企业主档字段。
- `crm_accounts.stage` 用于列表、漏斗、Dashboard、动作台和部分统计；活动历史不会在读取时完整重算阶段。
- `crm_accounts.lifecycle_status='active'` 与 `assignment_status!='returned'` 是普通客户范围的重要过滤条件。
- 入库列表以 `crm_intake_items.status` 为主要状态；已创建 CRM 账户通过 `crm_customer_id` 和外部客户编号关联。
- 统计部分同时使用账户阶段、活动类型、RFQ、报价和订单事实，说明不同指标存在“当前投影”和“事实事件”两种来源。

## 数据风险和待确认项

- `customers.customer_id`、`customer_pool.customer_id`、`crm_accounts.id` 三种 ID 的生命周期和映射必须进一步固化。
- `crm_accounts.stage`、`lifecycle_status`、`assignment_status`、`recycle_kind` 是不同维度，但当前部分查询组合使用，需建立明确状态模型。
- `crm_activities.stage_after` 是活动后的阶段快照，不应直接当成当前阶段；需要核对所有写入和展示逻辑。
- 旧数据迁移通过 `crm_migration_review` 保留无法判断的记录，迁移脚本不能被新系统隐式替代。
- 测试中存在按场景创建局部 schema 的 fixture，不能直接代表生产完整 schema。

## 证据来源

- `lib/db.js`
- `lib/sales_crm.js`
- `lib/filter_authorization.js`
- `README.md`
- `docs/development.md`
- 相关集成测试和迁移脚本
