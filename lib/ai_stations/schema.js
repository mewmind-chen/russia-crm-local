'use strict';

const AI_SCHEMA_VERSION = 10;

function ensureColumn(db, table, name, definition) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function applyAIStationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_ai_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS crm_ai_jobs (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      crm_account_id TEXT,
      station TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('queued','running','retry_wait','needs_review','succeeded','dead_letter')),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
      context_hash TEXT NOT NULL CHECK (length(trim(context_hash)) > 0),
      input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
      priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
      next_run_at TEXT NOT NULL,
      lease_owner TEXT NOT NULL DEFAULT '',
      lease_expires_at TEXT NOT NULL DEFAULT '',
      error_summary TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (customer_id) REFERENCES customer_pool(customer_id) ON DELETE RESTRICT,
      FOREIGN KEY (crm_account_id) REFERENCES crm_accounts(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_jobs_ready_idx ON crm_ai_jobs(state,next_run_at,priority DESC,created_at,id);
    CREATE INDEX IF NOT EXISTS crm_ai_jobs_lease_idx ON crm_ai_jobs(state,lease_expires_at);
    CREATE INDEX IF NOT EXISTS crm_ai_jobs_customer_idx ON crm_ai_jobs(customer_id,station,created_at DESC);

    CREATE TABLE IF NOT EXISTS crm_ai_station_results (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      crm_account_id TEXT,
      station TEXT NOT NULL,
      context_hash TEXT NOT NULL CHECK (length(trim(context_hash)) > 0),
      value_json TEXT NOT NULL CHECK (json_valid(value_json)),
      confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      review_required INTEGER NOT NULL CHECK (review_required IN (0,1)),
      engine TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      usage_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(usage_json)),
      cost REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
      generated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT,
      FOREIGN KEY (customer_id) REFERENCES customer_pool(customer_id) ON DELETE RESTRICT,
      FOREIGN KEY (crm_account_id) REFERENCES crm_accounts(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_station_results_latest_idx ON crm_ai_station_results(customer_id,station,generated_at DESC,id DESC);

    CREATE TABLE IF NOT EXISTS crm_ai_evidence_bindings (
      result_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL CHECK (length(trim(evidence_id)) > 0),
      position INTEGER NOT NULL CHECK (position >= 0),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
      created_at TEXT NOT NULL,
      PRIMARY KEY (result_id,evidence_id),
      UNIQUE (result_id,position),
      FOREIGN KEY (result_id) REFERENCES crm_ai_station_results(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS crm_ai_model_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt >= 1),
      station TEXT NOT NULL,
      engine TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('succeeded','failed','invalid_output')),
      duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
      usage_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(usage_json)),
      cost REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
      error_summary TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_model_runs_job_idx ON crm_ai_model_runs(job_id,attempt,id);
  `);

  ensureColumn(db, 'crm_ai_jobs', 'workflow_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_ai_jobs', 'parent_job_id', 'TEXT REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT');
  ensureColumn(db, 'crm_ai_jobs', 'event_type', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_ai_jobs', 'event_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_ai_jobs', 'control_state',
    "TEXT NOT NULL DEFAULT '' CHECK (control_state IN ('','blocked','cancel_requested','cancelled'))");
  ensureColumn(db, 'crm_ai_jobs', 'blocked_kind',
    "TEXT NOT NULL DEFAULT '' CHECK (blocked_kind IN ('','dependency','policy'))");
  ensureColumn(db, 'crm_ai_jobs', 'blocked_reason', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_ai_jobs', 'cancel_requested_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_ai_jobs', 'cancelled_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_ai_jobs', 'queued_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_ai_jobs', 'execution_resource', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_ai_jobs', 'fairness_at', "TEXT NOT NULL DEFAULT ''");
  db.exec(`UPDATE crm_ai_jobs SET queued_at=created_at
    WHERE queued_at='' AND state IN ('queued','retry_wait') AND control_state!='cancelled'`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_ai_job_dependencies (
      job_id TEXT NOT NULL,
      depends_on_job_id TEXT NOT NULL,
      required_state TEXT NOT NULL DEFAULT 'succeeded' CHECK (required_state IN ('succeeded','needs_review')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (job_id,depends_on_job_id),
      CHECK (job_id != depends_on_job_id),
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT,
      FOREIGN KEY (depends_on_job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_job_dependencies_parent_idx
      ON crm_ai_job_dependencies(depends_on_job_id,job_id);
    CREATE INDEX IF NOT EXISTS crm_ai_jobs_workflow_idx
      ON crm_ai_jobs(workflow_id,created_at,id);
    CREATE INDEX IF NOT EXISTS crm_ai_jobs_event_idx
      ON crm_ai_jobs(event_type,event_id,created_at,id);
    CREATE INDEX IF NOT EXISTS crm_ai_jobs_control_idx
      ON crm_ai_jobs(control_state,state,next_run_at,priority DESC,created_at,id);

    CREATE TABLE IF NOT EXISTS crm_ai_resource_slots (
      resource TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (resource,slot_id),
      UNIQUE (resource,job_id),
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_resource_slots_active_idx
      ON crm_ai_resource_slots(resource,lease_expires_at,job_id);

    CREATE TABLE IF NOT EXISTS crm_ai_resource_rate_windows (
      resource TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (resource,window_start)
    );

    CREATE TABLE IF NOT EXISTS crm_ai_customer_locks (
      customer_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL UNIQUE,
      worker_id TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_customer_locks_expiry_idx
      ON crm_ai_customer_locks(lease_expires_at,customer_id);

    CREATE TABLE IF NOT EXISTS crm_ai_dispatch_fairness (
      resource TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      last_claimed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (resource,customer_id)
    );

    CREATE TABLE IF NOT EXISTS crm_ai_budget_policies (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('company','team','user','station')),
      scope_id TEXT NOT NULL CHECK (length(trim(scope_id)) > 0),
      daily_limit_micros INTEGER NOT NULL DEFAULT 0 CHECK (daily_limit_micros >= 0),
      monthly_limit_micros INTEGER NOT NULL DEFAULT 0 CHECK (monthly_limit_micros >= 0),
      per_task_limit_micros INTEGER NOT NULL DEFAULT 0 CHECK (per_task_limit_micros >= 0),
      warning_ratio REAL NOT NULL DEFAULT 0.8 CHECK (warning_ratio > 0 AND warning_ratio < 1),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (scope_type,scope_id)
    );

    CREATE TABLE IF NOT EXISTS crm_ai_budget_reservations (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt >= 1),
      company_id TEXT NOT NULL,
      team_id TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL,
      station TEXT NOT NULL,
      reserved_micros INTEGER NOT NULL CHECK (reserved_micros >= 0),
      charged_micros INTEGER NOT NULL DEFAULT 0 CHECK (charged_micros >= 0),
      released_micros INTEGER NOT NULL DEFAULT 0 CHECK (released_micros >= 0),
      state TEXT NOT NULL CHECK (state IN ('reserved','settled','released')),
      essential INTEGER NOT NULL DEFAULT 0 CHECK (essential IN (0,1)),
      pricing_version TEXT NOT NULL,
      accounted_at TEXT NOT NULL,
      settled_at TEXT NOT NULL DEFAULT '',
      release_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (job_id,attempt),
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_budget_reservations_active_idx
      ON crm_ai_budget_reservations(state,accounted_at,company_id,team_id,actor_id,station);

    CREATE TABLE IF NOT EXISTS crm_ai_usage_ledger (
      id TEXT PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE CHECK (length(trim(event_key)) > 0),
      reservation_id TEXT,
      job_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt >= 0),
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      company_id TEXT NOT NULL,
      team_id TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL,
      station TEXT NOT NULL,
      engine TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('succeeded','failed','invalid_output','cache_hit','deduplicated')),
      input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
      output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
      total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
      usage_source TEXT NOT NULL CHECK (usage_source IN ('provider','estimated_missing','not_applicable')),
      estimated_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost_micros >= 0),
      actual_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (actual_cost_micros >= 0),
      charged_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (charged_cost_micros >= 0),
      cost_source TEXT NOT NULL CHECK (cost_source IN ('provider','estimated_usage','estimated_missing','not_billable')),
      fallback_from TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      pricing_version TEXT NOT NULL,
      accounted_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (reservation_id) REFERENCES crm_ai_budget_reservations(id) ON DELETE RESTRICT,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT,
      UNIQUE (reservation_id,sequence)
    );
    CREATE INDEX IF NOT EXISTS crm_ai_usage_ledger_scope_idx
      ON crm_ai_usage_ledger(accounted_at,company_id,team_id,actor_id,station);
    CREATE INDEX IF NOT EXISTS crm_ai_usage_ledger_job_idx
      ON crm_ai_usage_ledger(job_id,attempt,sequence);

    CREATE TABLE IF NOT EXISTS crm_ai_budget_alerts (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      period_kind TEXT NOT NULL CHECK (period_kind IN ('daily','monthly','task')),
      period_key TEXT NOT NULL,
      threshold_ratio REAL NOT NULL CHECK (threshold_ratio > 0 AND threshold_ratio <= 1),
      projected_micros INTEGER NOT NULL CHECK (projected_micros >= 0),
      limit_micros INTEGER NOT NULL CHECK (limit_micros > 0),
      created_at TEXT NOT NULL,
      UNIQUE (policy_id,period_kind,period_key,threshold_ratio),
      FOREIGN KEY (policy_id) REFERENCES crm_ai_budget_policies(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS crm_ai_interaction_runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('assistant_chat','manager_evaluation')),
      scope TEXT NOT NULL DEFAULT '',
      customer_id TEXT NOT NULL DEFAULT '',
      crm_account_id TEXT,
      actor_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('succeeded','failed')),
      engine TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
      usage_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(usage_json)),
      cost REAL NOT NULL DEFAULT 0 CHECK (cost >= 0),
      fallback_reason TEXT NOT NULL DEFAULT '',
      attempts_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attempts_json)),
      error_summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      finished_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_ai_interaction_runs_scope_idx
      ON crm_ai_interaction_runs(customer_id,actor_id,created_at DESC,id DESC);

    CREATE TABLE IF NOT EXISTS crm_ai_task_reviews (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_task_reviews_job_idx
      ON crm_ai_task_reviews(job_id,created_at,id);

    CREATE TABLE IF NOT EXISTS crm_ai_enrichment_runs (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      crm_account_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL DEFAULT '',
      trigger_source TEXT NOT NULL CHECK (trigger_source IN ('manual_create','manual_rerun','bulk_import')),
      triggered_by TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL CHECK (length(trim(input_fingerprint)) > 0),
      pipeline_version TEXT NOT NULL CHECK (length(trim(pipeline_version)) > 0),
      state TEXT NOT NULL CHECK (state IN (
        'pending_dispatch','dispatching','queued','running','succeeded',
        'needs_review','failed','skipped','cancelled'
      )),
      route_state TEXT NOT NULL DEFAULT '' CHECK (route_state IN ('','missing_info','needs_review','pending_assignment')),
      reason_code TEXT NOT NULL DEFAULT '',
      dispatch_owner TEXT NOT NULL DEFAULT '',
      dispatch_lease_expires_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      UNIQUE (customer_id,input_fingerprint,pipeline_version),
      FOREIGN KEY (customer_id) REFERENCES customer_pool(customer_id) ON DELETE RESTRICT,
      FOREIGN KEY (crm_account_id) REFERENCES crm_accounts(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_enrichment_runs_dispatch_idx
      ON crm_ai_enrichment_runs(state,dispatch_lease_expires_at,created_at,id);
    CREATE INDEX IF NOT EXISTS crm_ai_enrichment_runs_customer_idx
      ON crm_ai_enrichment_runs(customer_id,created_at DESC,id DESC);

    CREATE TABLE IF NOT EXISTS crm_ai_enrichment_node_links (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      node_key TEXT NOT NULL CHECK (length(trim(node_key)) > 0),
      ai_job_id TEXT,
      legacy_task_type TEXT NOT NULL DEFAULT '' CHECK (legacy_task_type IN ('','recon','contact_recon')),
      legacy_task_id TEXT NOT NULL DEFAULT '',
      adapter_state TEXT NOT NULL DEFAULT 'linked' CHECK (adapter_state IN (
        'linked','dispatched','waiting','completed','cancel_requested','cancelled','failed'
      )),
      completion_version INTEGER NOT NULL DEFAULT 0 CHECK (completion_version >= 0),
      cancel_requested_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (run_id,node_key),
      UNIQUE (ai_job_id),
      FOREIGN KEY (run_id) REFERENCES crm_ai_enrichment_runs(id) ON DELETE RESTRICT,
      FOREIGN KEY (ai_job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crm_ai_enrichment_node_links_legacy_idx
      ON crm_ai_enrichment_node_links(legacy_task_type,legacy_task_id)
      WHERE legacy_task_type!='' AND legacy_task_id!='';

    CREATE TABLE IF NOT EXISTS crm_ai_enrichment_events (
      id TEXT PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE CHECK (length(trim(event_key)) > 0),
      run_id TEXT NOT NULL,
      node_key TEXT NOT NULL CHECK (length(trim(node_key)) > 0),
      legacy_task_type TEXT NOT NULL CHECK (legacy_task_type IN ('recon','contact_recon')),
      legacy_task_id TEXT NOT NULL CHECK (length(trim(legacy_task_id)) > 0),
      event_type TEXT NOT NULL CHECK (event_type IN ('completed','failed','cancelled')),
      payload_hash TEXT NOT NULL CHECK (length(trim(payload_hash)) > 0),
      state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','consumed')),
      lease_owner TEXT NOT NULL DEFAULT '',
      lease_expires_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      consumed_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (run_id) REFERENCES crm_ai_enrichment_runs(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_enrichment_events_claim_idx
      ON crm_ai_enrichment_events(state,lease_expires_at,created_at,id);

    CREATE TABLE IF NOT EXISTS crm_ai_enrichment_evidence (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      node_key TEXT NOT NULL CHECK (length(trim(node_key)) > 0),
      source_url TEXT NOT NULL CHECK (length(trim(source_url)) > 0),
      source_type TEXT NOT NULL CHECK (length(trim(source_type)) > 0),
      collected_at TEXT NOT NULL CHECK (length(trim(collected_at)) > 0),
      summary TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
      confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      collector TEXT NOT NULL CHECK (length(trim(collector)) > 0),
      collector_version TEXT NOT NULL CHECK (length(trim(collector_version)) > 0),
      contact_sensitive INTEGER NOT NULL DEFAULT 0 CHECK (contact_sensitive IN (0,1)),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customer_pool(customer_id) ON DELETE RESTRICT,
      FOREIGN KEY (run_id) REFERENCES crm_ai_enrichment_runs(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_enrichment_evidence_run_idx
      ON crm_ai_enrichment_evidence(run_id,node_key,created_at,id);
    CREATE INDEX IF NOT EXISTS crm_ai_enrichment_evidence_customer_idx
      ON crm_ai_enrichment_evidence(customer_id,source_type,created_at,id);

    CREATE TABLE IF NOT EXISTS crm_ai_field_provenance (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      crm_account_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('customer_pool','crm_account')),
      target_id TEXT NOT NULL CHECK (length(trim(target_id)) > 0),
      field_name TEXT NOT NULL CHECK (length(trim(field_name)) > 0),
      value_hash TEXT NOT NULL CHECK (length(value_hash) = 64),
      source_state TEXT NOT NULL CHECK (source_state IN ('employee_confirmed','ai_provisional')),
      evidence_id TEXT,
      confirmed_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (target_type,target_id,field_name),
      CHECK (
        (source_state='ai_provisional' AND evidence_id IS NOT NULL AND confirmed_by='')
        OR (source_state='employee_confirmed' AND evidence_id IS NULL AND length(trim(confirmed_by)) > 0)
      ),
      FOREIGN KEY (customer_id) REFERENCES customer_pool(customer_id) ON DELETE RESTRICT,
      FOREIGN KEY (crm_account_id) REFERENCES crm_accounts(id) ON DELETE RESTRICT,
      FOREIGN KEY (evidence_id) REFERENCES crm_ai_enrichment_evidence(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_field_provenance_customer_idx
      ON crm_ai_field_provenance(customer_id,target_type,target_id,field_name);

    CREATE TABLE IF NOT EXISTS crm_ai_field_proposals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      crm_account_id TEXT NOT NULL,
      field_name TEXT NOT NULL CHECK (length(trim(field_name)) > 0),
      original_value_hash TEXT NOT NULL CHECK (length(original_value_hash) = 64),
      proposed_value_json TEXT NOT NULL CHECK (json_valid(proposed_value_json)),
      proposed_value_hash TEXT NOT NULL CHECK (length(proposed_value_hash) = 64),
      evidence_ids_json TEXT NOT NULL CHECK (json_valid(evidence_ids_json)),
      confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      state TEXT NOT NULL CHECK (state IN (
        'needs_review','auto_applied','accepted','rejected','superseded'
      )),
      reason_code TEXT NOT NULL DEFAULT '',
      normalization_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(normalization_json)),
      reviewed_by TEXT NOT NULL DEFAULT '',
      reviewed_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (run_id,field_name,proposed_value_hash),
      FOREIGN KEY (run_id) REFERENCES crm_ai_enrichment_runs(id) ON DELETE RESTRICT,
      FOREIGN KEY (customer_id) REFERENCES customer_pool(customer_id) ON DELETE RESTRICT,
      FOREIGN KEY (crm_account_id) REFERENCES crm_accounts(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_field_proposals_run_idx
      ON crm_ai_field_proposals(run_id,state,field_name,created_at,id);

    CREATE TRIGGER IF NOT EXISTS crm_ai_release_execution_claims
    AFTER UPDATE OF state,control_state ON crm_ai_jobs
    WHEN NEW.state != 'running' OR NEW.control_state IN ('cancelled','blocked')
    BEGIN
      DELETE FROM crm_ai_resource_slots WHERE job_id=NEW.id;
      DELETE FROM crm_ai_customer_locks WHERE job_id=NEW.id;
    END;

    CREATE TABLE IF NOT EXISTS crm_ai_action_proposal_consumptions (
      job_id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      confirmed_by TEXT NOT NULL,
      proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
      confirmed_json TEXT NOT NULL CHECK (json_valid(confirmed_json)),
      confirmed_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT,
      FOREIGN KEY (activity_id) REFERENCES crm_activities(id) ON DELETE RESTRICT,
      FOREIGN KEY (customer_id) REFERENCES crm_accounts(id) ON DELETE RESTRICT,
      FOREIGN KEY (confirmed_by) REFERENCES sales_users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_action_proposal_customer_idx
      ON crm_ai_action_proposal_consumptions(customer_id,confirmed_at DESC);
  `);
  ensureColumn(db, 'crm_ai_enrichment_runs', 'completeness', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'crm_ai_enrichment_runs', 'missing_items_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'crm_ai_enrichment_runs', 'tags_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'crm_ai_station_results', 'stale_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_ai_station_results', 'stale_reason', "TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE INDEX IF NOT EXISTS crm_ai_station_results_fresh_idx
    ON crm_ai_station_results(customer_id,station,stale_at,generated_at DESC,id DESC)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_ai_candidate_snapshots (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      customer_id TEXT NOT NULL DEFAULT '',
      station TEXT NOT NULL DEFAULT 'sales_match',
      context_hash TEXT NOT NULL CHECK (length(trim(context_hash)) > 0),
      candidate_hash TEXT NOT NULL CHECK (length(candidate_hash) = 64),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
      context_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(context_json)),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','invalidated')),
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      invalidated_at TEXT NOT NULL DEFAULT '',
      invalidated_reason TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_candidate_snapshots_lookup_idx
      ON crm_ai_candidate_snapshots(customer_id,station,status,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS crm_ai_candidate_snapshots_expiry_idx
      ON crm_ai_candidate_snapshots(status,expires_at);
    CREATE INDEX IF NOT EXISTS crm_ai_candidate_snapshots_job_idx
      ON crm_ai_candidate_snapshots(job_id) WHERE job_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS crm_ai_candidate_snapshot_items (
      snapshot_id TEXT NOT NULL,
      token INTEGER NOT NULL CHECK (token > 0),
      sales_user_id TEXT NOT NULL,
      state_hash TEXT NOT NULL CHECK (length(state_hash) = 64),
      candidate_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(candidate_json)),
      created_at TEXT NOT NULL,
      PRIMARY KEY (snapshot_id,token),
      UNIQUE (snapshot_id,sales_user_id),
      FOREIGN KEY (snapshot_id) REFERENCES crm_ai_candidate_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY (sales_user_id) REFERENCES sales_users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS crm_ai_candidate_snapshot_items_user_idx
      ON crm_ai_candidate_snapshot_items(sales_user_id,snapshot_id);
  `);
  db.exec(`UPDATE crm_ai_jobs SET fairness_at=COALESCE(NULLIF(fairness_at,''),queued_at,created_at)
    WHERE fairness_at=''`);
  const appliedAt = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO crm_ai_schema_migrations(version,applied_at) VALUES (?,?)')
    .run(8, appliedAt);
  db.prepare('INSERT OR IGNORE INTO crm_ai_schema_migrations(version,applied_at) VALUES (?,?)')
    .run(AI_SCHEMA_VERSION, appliedAt);
}

function installedVersion(db) {
  const exists = db.prepare(`SELECT 1 found FROM sqlite_master
    WHERE type='table' AND name='crm_ai_schema_migrations'`).get();
  if (!exists) return 0;
  return Number(db.prepare('SELECT MAX(version) version FROM crm_ai_schema_migrations').get()?.version || 0);
}

function installAIStationSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new Error('database is required');
  db.pragma('busy_timeout = 5000');
  if (installedVersion(db) >= AI_SCHEMA_VERSION) return;
  if (db.inTransaction) {
    if (installedVersion(db) < AI_SCHEMA_VERSION) applyAIStationSchema(db);
    return;
  }
  const migrate = db.transaction(() => {
    if (installedVersion(db) < AI_SCHEMA_VERSION) applyAIStationSchema(db);
  });
  return migrate.immediate();
}

module.exports = { AI_SCHEMA_VERSION, installAIStationSchema };
