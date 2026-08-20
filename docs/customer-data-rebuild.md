# 客户主档与线索池重建运维手册

> 关联 Issue #320 客户数据再次重建。本文档只描述操作与回滚；生产 apply 仍需用户对最终 maintenance-window preflight 的精确 manifest 与备份身份明确批准后执行。

## 1. 目标

使用 SHA-256 固定的客户重建包，清空旧客户级流程数据并重建 `customer_pool` 主档与 `crm_intake_items` 线索池，同时保留用户、权限、系统配置和 AI 系统配置。

## 2. 数据边界

### 保留（不写入）

- 用户/角色/权限：`sales_users`、`sales_sessions`、`permission_groups`、`permission_group_filter_grants`、`filter_definitions` 及权限审计/迁移表
- 线索与任务配置：`crm_intake_settings`、`crm_intake_assignment_rule_drafts/versions/state`、`crm_manager_task_settings(_audit)`
- AI 系统配置：`crm_ai_feature_flags`、`crm_ai_budget_policies`、`crm_ai_pricing_catalog`、`crm_ai_fx_rates`、`crm_ai_resource_rate_windows`、`crm_ai_strategy_versions`、`crm_ai_schema_migrations`
- 审计与部署：`crm_data_maintenance_runs`（追加本次记录）、`crm_audit_log`、`assistant_runtime_settings`
- 系统字典：`tags`（标签定义必须预先存在且全程保留；重建不新增、不修改标签字典）、`templates`、`crm_activity_reaction_options`、`crm_migration_review`
- 消息/视图：`wecom_*`、`crm_team_status_views`、`prospect_*`

### 清空（旧客户流程数据）

- 线索与分配：`crm_intake_batches/items/decisions/action_requests/assignment_previews/manual_assignment_requests/rule_rotation/rule_usage`
- 客户与活动：`crm_accounts`、`crm_account_contacts`、`crm_activities`、`crm_activity_action_requests`、`crm_activity_correction_*`
- 经理流程：`crm_manager_evaluations/tasks/interventions`、`crm_deferred_plan_events`、`crm_next_plan_events`
- 客户经理计划请求：`crm_plan_only_action_requests`（其中的幂等响应对应旧客户工作流，因此一并清空）
- 交易与通知：`crm_rfqs/quotes/orders`、`crm_notifications`、`crm_notification_deliveries`、`crm_today_task_action_requests`
- 客户级 AI 运行：`crm_ai_jobs`、`crm_ai_station_results`、`crm_ai_enrichment_*`、`crm_ai_field_*`、`crm_ai_evidence_bindings`、`crm_ai_feedback_labels`、`crm_ai_candidate_*`、`crm_ai_customer_locks`、`crm_ai_dispatch_fairness`、`crm_ai_budget_reservations/alerts`、`crm_ai_model_runs`、`crm_ai_usage_ledger` 等运行表
- 身份/研究旧数据：`crm_customer_identity_*`、`person_candidates`、`person_evidence`、`recon_jobs/results/submission_audit`、`contact_recon_jobs/audit`、`customer_assignments`、`customer_nickname_*`、`crm_duplicate_reviews`、`crm_protected_customer_*`
- 遗留与文档：`customers`（旧跟进表）、`assistant_documents`、`assistant_embeddings`、`crm_smoke_runs`、`crm_collaboration_events`、`crm_commerce_action_requests`、`crm_customer_create_requests`、`customer_tag_history`

### 替换（由重建包写入）

`customer_pool`、`company_identifiers`、`company_screening`、`contacts`、`contact_methods`、`company_entry_points`、`website_checks`、`sanction_checks`、`recon_evidence`、`customer_tags`。

> 动态保护：任何含 `customer_id / external_customer_id / crm_customer_id / intake_item_id / account_id` 或外键传递到客户表、但未进入上述分类的表，都会进入 `unclassifiedCustomerTables` 并阻断 apply。

### 重建包不变量

- `customers` 与 `excluded` 共同构成全部来源客户分区，`customerId` 格式、唯一性和 1901 条分区语义覆盖两者；只有 `customers` 是可导入父集合。
- `contacts`、`tags`、`screening`、`evidence` 和 `reviewQueue` 的每条记录都必须引用 `customers` 内的 `customerId`。任何引用 `excluded` 或未知 ID 的子记录都会在计划/写库前被拒绝；导入包中 excluded-owned 子记录必须为 0。
- `plan.json` 记录经 SHA sidecar 验证的精确 `packageSha256`，且该字段在计算 manifest 前已纳入计划。使用不同包（即使其派生计数相同）不能通过冻结 manifest 的 apply 校验。

当前运行时批准包为 `outputs/lead-rebuild/2026-08-20-rerun/approved/customer-rebuild-package.json`：1895 个可导入客户（READY 1334、REVIEW 561）、6 个 excluded、419 contacts、11566 tags、9408 evidence、0 unresolved duplicates；所有 imported child collections 对 excluded 的引用均为 0。

## 3. 命令

```bash
# 只读计划（不写库）
npm run crm:customer-rebuild -- plan \
  --database /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db \
  --package /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/approved/customer-rebuild-package.json \
  --package-sha256-file /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/approved/customer-rebuild-package.sha256 \
  --output /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/plan

# 副本演练（对生产库做 online backup，仅在副本上 apply）
npm run crm:customer-rebuild -- rehearse \
  --database /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db \
  --package /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/approved/customer-rebuild-package.json \
  --package-sha256-file /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/approved/customer-rebuild-package.sha256 \
  --output /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/rehearsal

# 生产 apply（必须先确认 preflight；--apply 为显式开关）
npm run crm:customer-rebuild -- apply \
  --database /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db \
  --package /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/approved/customer-rebuild-package.json \
  --package-sha256-file /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/approved/customer-rebuild-package.sha256 \
  --manifest /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/final-preflight/manifest.txt \
  --backup-dir /Users/ylf/Desktop/projects/tradepulse-production/shared/backups/customer-rebuild/2026-08-20-rerun \
  --actor <real_user_id> --apply

# 验证
npm run crm:customer-rebuild -- verify --database <db>
```

`apply` 前会先通过 SQLite online backup 在上述绝对备份目录生成 `crm-rebuild-*.db`。验证器要求备份是非空普通文件、link count 等于 1、与源库的 device/inode 不同，且不存在相邻 `-wal`/`-shm` 文件；随后独立以 readonly 模式验证原文件。验证器还会把仅主文件复制到独立临时目录，执行 main-file-only restore 证明，并再次要求 `quick_check=ok`、`integrity_check=ok` 和同一个 package-bound manifest，最后安全清理临时副本。只有该自包含副本的 SHA 与原备份主文件 SHA 相同才会接受。备份绝对路径、SHA-256、size、mtime、两项 SQLite 检查与仅主文件恢复证明会写入输出和 maintenance evidence；验证失败时不会以 read-write 打开源库。

生产 `--manifest` 只能使用 `/Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/2026-08-20-rerun/final-preflight/manifest.txt`：它是维护窗口内重新计划、再演练并被显式批准的最终 manifest。`2026-08-20-rerun/plan` 和 `2026-08-20-rerun/rehearsal` 仅作之前阶段证据，不得直接用于生产 apply。package SHA、精确 CLI contract、备份 provenance/完整性及 manifest 等 preflight gate 会 abort before destructive write。schema fingerprint 绑定完整 `sqlite_master` 定义，包括 table、显式 index、view 与 trigger 的名称、归属及 SQL，因此列 type/default、PK/UNIQUE/CHECK 等 DDL 漂移也会改变 manifest。apply 不接受调用者已有事务；它必须拥有一个 owned `BEGIN IMMEDIATE`，并在该事务内完成权威 source content hash/schema/manifest 比较、全部 destructive write 与 postcondition 后自行 commit 或 rollback。destructive write 开始后，保留表哈希、schema、96 表精确对账、外键、`quick_check`、`integrity_check` 或 maintenance append 等 postcondition 失败会触发 transaction rollback，撤销该次事务的全部写入。

## 4. 维护窗口与回滚

1. apply 前暂停 Web 写入入口、每日导入、通知、Recon、联系人 worker 与 AI customer worker；检查无活动写事务。
2. 记录 `current` release SHA、`/healthz`、输入包 SHA、plan manifest 和保留表哈希。
3. 若 apply 失败：事务自动回滚，恢复服务，无需手工恢复。
4. 若 apply 成功但需要回滚：停止写入口，用 apply 前生成的 `crm-rebuild-*.db`（online backup）整体替换生产库（停止服务 → 替换 → `integrity_check` → 启动 → 验证页面与计数）。
5. 回滚后旧客户流程数据恢复，但重建包数据丢失；重新导入需再次走本手册并重新获得确认。

## 5. 验收

- `plan` 无未分类客户表；`beforeCounts` 是 source database 的 current 清空/替换表计数，供人工核对，而不是包投影；`packageCounts` 与 `expectedAfterCounts` 是由重建包推导的 projection；manifest 稳定。
- `rehearse`：活动生产库 SHA/mtime 不变；演练库 `integrity_check=ok`；对账差异为 0；保留表哈希不变。
- `apply` 后：86 张清空表中仅 `crm_intake_batches=1`、`crm_intake_items=1895`，其他为 0；10 张替换表与 package projection 精确一致；approved/pending 分别为 1334/561；导入子表 customer/contact/tag/batch 孤儿为 0；`foreign_key_check` 为空；`quick_check=ok`且 `integrity_check=ok`。
