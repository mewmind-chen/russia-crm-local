# 客户主档与线索池重建运维手册

> 关联 issue：#271。本文档只描述操作与回滚；生产 apply 仍需用户在最终 preflight 确认后执行。

## 1. 目标

使用 SHA-256 固定的客户重建包，清空旧客户级流程数据并重建 `customer_pool` 主档与 `crm_intake_items` 线索池，同时保留用户、权限、系统配置和 AI 系统配置。

## 2. 数据边界

### 保留（不写入）

- 用户/角色/权限：`sales_users`、`sales_sessions`、`permission_groups`、`permission_group_filter_grants`、`filter_definitions` 及权限审计/迁移表
- 线索与任务配置：`crm_intake_settings`、`crm_intake_assignment_rule_drafts/versions/state`、`crm_manager_task_settings(_audit)`
- AI 系统配置：`crm_ai_feature_flags`、`crm_ai_budget_policies`、`crm_ai_pricing_catalog`、`crm_ai_fx_rates`、`crm_ai_resource_rate_windows`、`crm_ai_strategy_versions`、`crm_ai_schema_migrations`
- 审计与部署：`crm_data_maintenance_runs`（追加本次记录）、`crm_audit_log`、`assistant_runtime_settings`
- 系统字典：`tags`（标签定义保留，重建只新增缺失标签）、`templates`、`crm_activity_reaction_options`、`crm_migration_review`
- 消息/视图：`wecom_*`、`crm_team_status_views`、`prospect_*`

### 清空（旧客户流程数据）

- 线索与分配：`crm_intake_batches/items/decisions/action_requests/assignment_previews/manual_assignment_requests/rule_rotation/rule_usage`
- 客户与活动：`crm_accounts`、`crm_account_contacts`、`crm_activities`、`crm_activity_action_requests`、`crm_activity_correction_*`
- 经理流程：`crm_manager_evaluations/tasks/interventions`、`crm_deferred_plan_events`、`crm_next_plan_events`
- 交易与通知：`crm_rfqs/quotes/orders`、`crm_notifications`、`crm_notification_deliveries`、`crm_today_task_action_requests`
- 客户级 AI 运行：`crm_ai_jobs`、`crm_ai_station_results`、`crm_ai_enrichment_*`、`crm_ai_field_*`、`crm_ai_evidence_bindings`、`crm_ai_feedback_labels`、`crm_ai_candidate_*`、`crm_ai_customer_locks`、`crm_ai_dispatch_fairness`、`crm_ai_budget_reservations/alerts`、`crm_ai_model_runs`、`crm_ai_usage_ledger` 等运行表
- 身份/研究旧数据：`crm_customer_identity_*`、`person_candidates`、`person_evidence`、`recon_jobs/results/submission_audit`、`contact_recon_jobs/audit`、`customer_assignments`、`customer_nickname_*`、`crm_duplicate_reviews`、`crm_protected_customer_*`
- 遗留与文档：`customers`（旧跟进表）、`assistant_documents`、`assistant_embeddings`、`crm_smoke_runs`、`crm_collaboration_events`、`crm_commerce_action_requests`、`crm_customer_create_requests`、`customer_tag_history`

### 替换（由重建包写入）

`customer_pool`、`company_identifiers`、`company_screening`、`contacts`、`contact_methods`、`company_entry_points`、`website_checks`、`sanction_checks`、`recon_evidence`、`customer_tags`。

> 动态保护：任何含 `customer_id / external_customer_id / crm_customer_id / intake_item_id / account_id` 或外键传递到客户表、但未进入上述分类的表，都会进入 `unclassifiedCustomerTables` 并阻断 apply。

## 3. 命令

```bash
# 只读计划（不写库）
npm run crm:customer-rebuild -- plan \
  --database /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db \
  --package /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/approved/customer-rebuild-package.json \
  --package-sha256-file /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/approved/customer-rebuild-package.sha256 \
  --output outputs/lead-rebuild/rehearsal

# 副本演练（对生产库做 online backup，仅在副本上 apply）
npm run crm:customer-rebuild -- rehearse \
  --database /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db \
  --package /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/approved/customer-rebuild-package.json \
  --package-sha256-file /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/approved/customer-rebuild-package.sha256 \
  --output /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/rehearsal

# 生产 apply（必须先确认 preflight；--apply 为显式开关）
npm run crm:customer-rebuild -- apply \
  --database /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db \
  --package /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/approved/customer-rebuild-package.json \
  --package-sha256-file /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/approved/customer-rebuild-package.sha256 \
  --manifest /Users/ylf/Desktop/projects/tradepulse-ai-crm/outputs/lead-rebuild/rehearsal/manifest.txt \
  --actor <real_user_id> --apply

# 验证
npm run crm:customer-rebuild -- verify --database <db>
```

`apply` 前会先通过 SQLite online backup 生成 `backups/customer-rebuild/crm-rebuild-*.db`，任何 manifest 不匹配、schema 漂移、保留表哈希变化、外键违规或对账失败都会回滚整个事务并中止。

## 4. 维护窗口与回滚

1. apply 前暂停 Web 写入入口、每日导入、通知、Recon、联系人 worker 与 AI customer worker；检查无活动写事务。
2. 记录 `current` release SHA、`/healthz`、输入包 SHA、plan manifest 和保留表哈希。
3. 若 apply 失败：事务自动回滚，恢复服务，无需手工恢复。
4. 若 apply 成功但需要回滚：停止写入口，用 apply 前生成的 `crm-rebuild-*.db`（online backup）整体替换生产库（停止服务 → 替换 → `integrity_check` → 启动 → 验证页面与计数）。
5. 回滚后旧客户流程数据恢复，但重建包数据丢失；重新导入需再次走本手册并重新获得确认。

## 5. 验收

- `plan` 无未分类客户表；`beforeCounts` 与包计数一致；manifest 稳定。
- `rehearse`：活动生产库 SHA/mtime 不变；演练库 `integrity_check=ok`；对账差异为 0；保留表哈希不变。
- `apply` 后：旧流程表为 0；`customer_pool` 与 `crm_intake_items` 等于包客户数；approved/pending 与包 READY/REVIEW 一致；重复 customer_id 为 0；`foreign_key_check` 为空；`quick_check=ok`。
