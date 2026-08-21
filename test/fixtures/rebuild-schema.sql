CREATE TABLE assistant_conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      client_message_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '[]',
      matched_customers_json TEXT NOT NULL DEFAULT '[]',
      actions_json TEXT NOT NULL DEFAULT '[]',
      result_sets_json TEXT NOT NULL DEFAULT '[]',
      context_json TEXT NOT NULL DEFAULT '{}',
      retrieval_mode TEXT NOT NULL DEFAULT '',
      engine TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      usage_json TEXT NOT NULL DEFAULT '{}',
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES assistant_conversations(id) ON DELETE CASCADE,
      UNIQUE(conversation_id,sequence_no)
    );

CREATE TABLE assistant_conversations (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
      favorite INTEGER NOT NULL DEFAULT 0,
      scope_json TEXT NOT NULL DEFAULT '{}',
      native_session_id TEXT NOT NULL DEFAULT '',
      native_session_engine TEXT NOT NULL DEFAULT '',
      rolling_summary TEXT NOT NULL DEFAULT '',
      summary_message_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT NOT NULL DEFAULT '',
      archived_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE assistant_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_key TEXT NOT NULL UNIQUE,
      doc_type TEXT NOT NULL DEFAULT '',
      source_table TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      customer_id TEXT NOT NULL DEFAULT '',
      follow_id TEXT NOT NULL DEFAULT '',
      job_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE assistant_embeddings (
      document_id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      dimensions INTEGER NOT NULL DEFAULT 0,
      embedding BLOB NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (document_id) REFERENCES assistant_documents(id) ON DELETE CASCADE
    );

CREATE TABLE assistant_runtime_settings (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'auto',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE company_entry_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT, contact_recon_job_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      method_type TEXT NOT NULL, value TEXT NOT NULL, discovery_type TEXT NOT NULL DEFAULT 'company_generic',
      verification_status TEXT NOT NULL DEFAULT 'unverified', source_url TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL DEFAULT '', UNIQUE(contact_recon_job_id, method_type, value)
    );

CREATE TABLE company_identifiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL DEFAULT '', customer_id TEXT NOT NULL,
      identifier_type TEXT NOT NULL, identifier_value TEXT NOT NULL, country_code TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '', checked_at TEXT NOT NULL DEFAULT '',
      UNIQUE(customer_id, identifier_type, identifier_value)
    );

CREATE TABLE company_screening (
      customer_id TEXT PRIMARY KEY,
      business_summary TEXT NOT NULL DEFAULT '',
      company_type TEXT NOT NULL DEFAULT 'unknown',
      product_categories_json TEXT NOT NULL DEFAULT '[]',
      likely_component_needs_json TEXT NOT NULL DEFAULT '[]',
      match_score INTEGER NOT NULL DEFAULT 0,
      match_group TEXT NOT NULL DEFAULT 'C',
      match_reasons_json TEXT NOT NULL DEFAULT '[]',
      risk_level TEXT NOT NULL DEFAULT 'unknown',
      risk_reasons_json TEXT NOT NULL DEFAULT '[]',
      classification_confidence INTEGER NOT NULL DEFAULT 0,
      source_urls_json TEXT NOT NULL DEFAULT '[]',
      screening_status TEXT NOT NULL DEFAULT 'classified',
      checked_at TEXT NOT NULL DEFAULT '',
      next_review_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE contact_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      method_type TEXT NOT NULL, value TEXT NOT NULL, normalized_value TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unverified', source_url TEXT NOT NULL DEFAULT '', verified_at TEXT NOT NULL DEFAULT '', person_id TEXT NOT NULL DEFAULT '', discovery_type TEXT NOT NULL DEFAULT 'manual', verification_status TEXT NOT NULL DEFAULT 'unverified', confidence INTEGER NOT NULL DEFAULT 0, is_direct INTEGER NOT NULL DEFAULT 0, is_generic INTEGER NOT NULL DEFAULT 0, is_inferred INTEGER NOT NULL DEFAULT 0, source_date TEXT NOT NULL DEFAULT '', last_verified_at TEXT NOT NULL DEFAULT '', failure_reason TEXT NOT NULL DEFAULT '',
      UNIQUE(contact_id, method_type, normalized_value)
    );

CREATE TABLE contact_recon_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      person_count INTEGER NOT NULL DEFAULT 0, l2_count INTEGER NOT NULL DEFAULT 0, l3_count INTEGER NOT NULL DEFAULT 0,
      validation_status TEXT NOT NULL, created_at TEXT NOT NULL
    );

CREATE TABLE contact_recon_jobs (
      job_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, company_name TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '', inn TEXT NOT NULL DEFAULT '', target_roles_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT 'queued', worker_id TEXT NOT NULL DEFAULT '',
      attempt_count INTEGER NOT NULL DEFAULT 0, lease_expires_at TEXT NOT NULL DEFAULT '', heartbeat_at TEXT NOT NULL DEFAULT '',
      person_count INTEGER NOT NULL DEFAULT 0, l2_count INTEGER NOT NULL DEFAULT 0, l3_count INTEGER NOT NULL DEFAULT 0,
      search_budget INTEGER NOT NULL DEFAULT 0, output_dir TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '',
      failure_reason TEXT NOT NULL DEFAULT '', validation_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT ''
    , report_path TEXT NOT NULL DEFAULT '', cancel_requested_at TEXT NOT NULL DEFAULT '', cancelled_at TEXT NOT NULL DEFAULT '');

CREATE TABLE contacts (
      contact_id TEXT PRIMARY KEY, job_id TEXT NOT NULL DEFAULT '', customer_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      decision_role TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
      quality_status TEXT NOT NULL DEFAULT 'unverified', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    , person_id TEXT NOT NULL DEFAULT '', role_category TEXT NOT NULL DEFAULT 'unknown', employment_status TEXT NOT NULL DEFAULT 'unverified', employment_confidence INTEGER NOT NULL DEFAULT 0, contact_level TEXT NOT NULL DEFAULT 'L0', sales_ready INTEGER NOT NULL DEFAULT 0);

CREATE TABLE crm_account_contacts (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        department TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        social TEXT NOT NULL DEFAULT '',
        source_contact_id TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, external_customer_id TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'manual', updated_by TEXT NOT NULL DEFAULT '', archived_by TEXT NOT NULL DEFAULT '', archived_at TEXT NOT NULL DEFAULT '', match_status TEXT NOT NULL DEFAULT 'pending' CHECK(match_status IN ('pending','match','mismatch')), procurement_role TEXT NOT NULL DEFAULT 'pending' CHECK(procurement_role IN ('pending','yes','no')), work_content TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );

CREATE TABLE "crm_accounts" (
          id TEXT PRIMARY KEY,
          external_customer_id TEXT NOT NULL DEFAULT '',
          company_name TEXT NOT NULL,
          country TEXT NOT NULL DEFAULT '',
          city TEXT NOT NULL DEFAULT '',
          website TEXT NOT NULL DEFAULT '',
          industry TEXT NOT NULL DEFAULT '',
          customer_type TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT '',
          product_focus TEXT NOT NULL DEFAULT '',
          priority TEXT NOT NULL DEFAULT 'B',
          potential_value REAL NOT NULL DEFAULT 0,
          stage TEXT NOT NULL DEFAULT 'new',
          owner_id TEXT,
          created_by TEXT NOT NULL DEFAULT '',
          manager_id TEXT NOT NULL DEFAULT '',
          manager_required INTEGER NOT NULL DEFAULT 0,
          manager_status TEXT NOT NULL DEFAULT '',
          last_activity_at TEXT NOT NULL DEFAULT '',
          next_action TEXT NOT NULL DEFAULT '',
          next_action_at TEXT NOT NULL DEFAULT '',
          loss_reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          intake_item_id TEXT NOT NULL DEFAULT '',
          assignment_status TEXT NOT NULL DEFAULT 'claimed',
          assigned_at TEXT NOT NULL DEFAULT '',
          claim_due_at TEXT NOT NULL DEFAULT '',
          claimed_at TEXT NOT NULL DEFAULT '',
          return_reason TEXT NOT NULL DEFAULT '', lifecycle_status TEXT NOT NULL DEFAULT 'active', recycle_kind TEXT NOT NULL DEFAULT '', recycle_reason TEXT NOT NULL DEFAULT '', recycled_by TEXT NOT NULL DEFAULT '', recycled_at TEXT NOT NULL DEFAULT '', previous_owner_id TEXT NOT NULL DEFAULT '', is_test_data INTEGER NOT NULL DEFAULT 0, test_run_id TEXT NOT NULL DEFAULT '', nickname TEXT NOT NULL DEFAULT '', established_year INTEGER, next_action_time_basis TEXT DEFAULT '', first_claimed_by TEXT NOT NULL DEFAULT '', first_claimed_at TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(owner_id) REFERENCES sales_users(id)
        );

CREATE TABLE crm_activities (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT '',
        outcome TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT '',
        next_action_at TEXT NOT NULL DEFAULT '',
        stage_after TEXT NOT NULL DEFAULT '',
        manager_required INTEGER NOT NULL DEFAULT 0,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL, is_test_data INTEGER NOT NULL DEFAULT 0, test_run_id TEXT NOT NULL DEFAULT '', progress_key TEXT NOT NULL DEFAULT '', reaction_option_id TEXT NOT NULL DEFAULT '', reaction_label_snapshot TEXT NOT NULL DEFAULT '', stage_before TEXT NOT NULL DEFAULT '', superseded_at TEXT NOT NULL DEFAULT '', superseded_by TEXT NOT NULL DEFAULT '', no_plan INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES sales_users(id)
      );

CREATE TABLE crm_activity_action_requests (
      idempotency_key TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed')),
      response_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE crm_activity_correction_decisions (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE CHECK(length(trim(idempotency_key)) > 0),
      request_hash TEXT NOT NULL CHECK(length(trim(request_hash)) > 0),
      proposal_id TEXT NOT NULL UNIQUE,
      reviewer_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
      reason TEXT NOT NULL DEFAULT '',
      expected_version INTEGER NOT NULL,
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

CREATE TABLE crm_activity_correction_locks (
      activity_id TEXT PRIMARY KEY,
      locked_by TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      locked_at TEXT NOT NULL
    );

CREATE TABLE crm_activity_correction_notification_relations (
      id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL UNIQUE,
      correction_id TEXT NOT NULL DEFAULT '',
      proposal_id TEXT NOT NULL DEFAULT '',
      recipient_id TEXT NOT NULL CHECK (length(trim(recipient_id)) > 0),
      notification_type TEXT NOT NULL CHECK (length(trim(notification_type)) > 0),
      source_customer_id TEXT NOT NULL CHECK (length(trim(source_customer_id)) > 0),
      target_customer_id TEXT NOT NULL CHECK (length(trim(target_customer_id)) > 0),
      created_at TEXT NOT NULL,
      CHECK (
        (correction_id <> '' AND proposal_id = '')
        OR (correction_id = '' AND proposal_id <> '')
      ),
      UNIQUE (correction_id, proposal_id, recipient_id, notification_type),
      FOREIGN KEY (notification_id) REFERENCES crm_notifications(id) ON DELETE CASCADE
    );

CREATE TABLE crm_activity_correction_proposals (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE CHECK(length(trim(idempotency_key)) > 0),
      request_hash TEXT NOT NULL CHECK(length(trim(request_hash)) > 0),
      original_activity_id TEXT NOT NULL,
      source_customer_id TEXT NOT NULL,
      target_customer_id TEXT NOT NULL,
      source_external_customer_id TEXT NOT NULL DEFAULT '',
      target_external_customer_id TEXT NOT NULL DEFAULT '',
      requester_id TEXT NOT NULL,
      original_creator_id TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
      reason_code TEXT NOT NULL,
      mapping_evidence_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      reviewer_id TEXT NOT NULL DEFAULT '',
      review_reason TEXT NOT NULL DEFAULT '',
      correction_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

CREATE TABLE crm_activity_corrections (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE CHECK(length(trim(idempotency_key)) > 0),
      request_hash TEXT NOT NULL CHECK(length(trim(request_hash)) > 0),
      original_activity_id TEXT NOT NULL UNIQUE,
      replacement_activity_id TEXT NOT NULL UNIQUE,
      source_customer_id TEXT NOT NULL,
      target_customer_id TEXT NOT NULL,
      source_external_customer_id TEXT NOT NULL DEFAULT '',
      target_external_customer_id TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL,
      original_creator_id TEXT NOT NULL DEFAULT '',
      reviewer_id TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL CHECK(length(trim(reason)) > 0),
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status='completed'),
      proposal_id TEXT NOT NULL DEFAULT '',
      milestone_type TEXT NOT NULL DEFAULT '',
      milestone_source_id TEXT NOT NULL DEFAULT '',
      milestone_target_id TEXT NOT NULL DEFAULT '',
      mapping_evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT '',
      decision_reason TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE crm_activity_reaction_options (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      action_queue_key TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_by TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      removed_at TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE crm_ai_action_proposal_consumptions (
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

CREATE TABLE crm_ai_batch_items (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      provider_item_id TEXT NOT NULL DEFAULT '',
      custom_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN (
        'reserved','submitted','succeeded','review_required','failed','stale',
        'requeued','expired','cancelled','missing_usage','dead_letter'
      )),
      station TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      context_hash TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_ids_json)),
      idempotency_key TEXT NOT NULL UNIQUE,
      reservation_id TEXT NOT NULL DEFAULT '',
      reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
      usage_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(usage_json)),
      original_cost REAL,
      original_currency TEXT NOT NULL DEFAULT '',
      converted_cost_usd REAL,
      pricing_version TEXT NOT NULL,
      fx_version TEXT NOT NULL,
      response_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(response_json)),
      error_summary TEXT NOT NULL DEFAULT '',
      submitted_at TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (run_id,job_id),
      UNIQUE (run_id,custom_id),
      FOREIGN KEY (run_id) REFERENCES crm_ai_batch_runs(id) ON DELETE RESTRICT,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_batch_runs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'qwen',
      provider_batch_id TEXT NOT NULL DEFAULT '',
      provider_input_file_id TEXT NOT NULL DEFAULT '',
      provider_output_file_id TEXT NOT NULL DEFAULT '',
      provider_error_file_id TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL CHECK (state IN (
        'reserving','submitted','running','importing','succeeded','review_required',
        'partial_failed','expired','cancel_requested','cancelled','dead_letter'
      )),
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      pricing_version TEXT NOT NULL,
      fx_version TEXT NOT NULL,
      schedule TEXT NOT NULL,
      timezone TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
      error_summary TEXT NOT NULL DEFAULT '',
      submitted_at TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE crm_ai_budget_alerts (
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

CREATE TABLE crm_ai_budget_policies (
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

CREATE TABLE crm_ai_budget_reservations (
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

CREATE TABLE crm_ai_candidate_snapshot_items (
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

CREATE TABLE crm_ai_candidate_snapshots (
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

CREATE TABLE crm_ai_customer_locks (
      customer_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL UNIQUE,
      worker_id TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_dispatch_fairness (
      resource TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      last_claimed_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (resource,customer_id)
    );

CREATE TABLE crm_ai_enrichment_events (
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

CREATE TABLE crm_ai_enrichment_evidence (
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

CREATE TABLE crm_ai_enrichment_node_links (
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

CREATE TABLE crm_ai_enrichment_runs (
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
      finished_at TEXT NOT NULL DEFAULT '', completeness INTEGER NOT NULL DEFAULT 0, missing_items_json TEXT NOT NULL DEFAULT '[]', tags_json TEXT NOT NULL DEFAULT '[]',
      UNIQUE (customer_id,input_fingerprint,pipeline_version),
      FOREIGN KEY (customer_id) REFERENCES customer_pool(customer_id) ON DELETE RESTRICT,
      FOREIGN KEY (crm_account_id) REFERENCES crm_accounts(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_evidence_bindings (
      result_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL CHECK (length(trim(evidence_id)) > 0),
      position INTEGER NOT NULL CHECK (position >= 0),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
      created_at TEXT NOT NULL,
      PRIMARY KEY (result_id,evidence_id),
      UNIQUE (result_id,position),
      FOREIGN KEY (result_id) REFERENCES crm_ai_station_results(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_feature_flags (
      feature_key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE crm_ai_feedback_labels (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      result_id TEXT,
      customer_id TEXT NOT NULL,
      station TEXT NOT NULL,
      label TEXT NOT NULL CHECK (label IN ('won','replied','returned','stalled','human_rejected')),
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT,
      FOREIGN KEY (result_id) REFERENCES crm_ai_station_results(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_field_proposals (
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

CREATE TABLE crm_ai_field_provenance (
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

CREATE TABLE crm_ai_fx_rates (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL UNIQUE,
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      rate REAL NOT NULL CHECK (rate > 0),
      effective_from TEXT NOT NULL,
      effective_to TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

CREATE TABLE crm_ai_interaction_runs (
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

CREATE TABLE crm_ai_job_dependencies (
      job_id TEXT NOT NULL,
      depends_on_job_id TEXT NOT NULL,
      required_state TEXT NOT NULL DEFAULT 'succeeded' CHECK (required_state IN ('succeeded','needs_review')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (job_id,depends_on_job_id),
      CHECK (job_id != depends_on_job_id),
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT,
      FOREIGN KEY (depends_on_job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_jobs (
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
      finished_at TEXT NOT NULL DEFAULT '', workflow_id TEXT NOT NULL DEFAULT '', parent_job_id TEXT REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT, event_type TEXT NOT NULL DEFAULT '', event_id TEXT NOT NULL DEFAULT '', control_state TEXT NOT NULL DEFAULT '' CHECK (control_state IN ('','blocked','cancel_requested','cancelled')), blocked_kind TEXT NOT NULL DEFAULT '' CHECK (blocked_kind IN ('','dependency','policy')), blocked_reason TEXT NOT NULL DEFAULT '', cancel_requested_at TEXT NOT NULL DEFAULT '', cancelled_at TEXT NOT NULL DEFAULT '', queued_at TEXT NOT NULL DEFAULT '', execution_resource TEXT NOT NULL DEFAULT '', fairness_at TEXT NOT NULL DEFAULT '', execution_mode TEXT NOT NULL DEFAULT 'online' CHECK (execution_mode IN ('online','batch_eligible')), batch_not_before TEXT NOT NULL DEFAULT '', stale_requeue_count INTEGER NOT NULL DEFAULT 0 CHECK (stale_requeue_count >= 0), decision_trace_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(decision_trace_json)), trigger_source TEXT NOT NULL DEFAULT 'legacy_unknown' CHECK (
    trigger_source IN (
      'manual','business_event','workflow','schedule','api','migration','release_validation','legacy_unknown'
    )
  ), trigger_actor_id TEXT NOT NULL DEFAULT '', trigger_reason TEXT NOT NULL DEFAULT '', triggered_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (customer_id) REFERENCES customer_pool(customer_id) ON DELETE RESTRICT,
      FOREIGN KEY (crm_account_id) REFERENCES crm_accounts(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_model_runs (
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
      finished_at TEXT NOT NULL, request_id TEXT NOT NULL DEFAULT '', trace_id TEXT NOT NULL DEFAULT '', finish_reason TEXT NOT NULL DEFAULT '', original_cost REAL, original_currency TEXT NOT NULL DEFAULT '', pricing_version TEXT NOT NULL DEFAULT '', fx_version TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_next_action_consumptions (
      job_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      confirmed_by TEXT NOT NULL,
      proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
      confirmed_json TEXT NOT NULL CHECK (json_valid(confirmed_json)),
      confirmed_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT,
      FOREIGN KEY (customer_id) REFERENCES crm_accounts(id) ON DELETE RESTRICT,
      FOREIGN KEY (confirmed_by) REFERENCES sales_users(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_pricing_catalog (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      execution_type TEXT NOT NULL CHECK (execution_type IN ('online','batch')),
      currency TEXT NOT NULL CHECK (currency IN ('CNY','USD')),
      input_per_million REAL NOT NULL CHECK (input_per_million >= 0),
      output_per_million REAL NOT NULL CHECK (output_per_million >= 0),
      effective_from TEXT NOT NULL,
      effective_to TEXT NOT NULL DEFAULT '',
      promotion_ends_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE (version,provider,model,execution_type)
    );

CREATE TABLE crm_ai_resource_rate_windows (
      resource TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (resource,window_start)
    );

CREATE TABLE crm_ai_resource_slots (
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

CREATE TABLE crm_ai_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

CREATE TABLE crm_ai_shadow_evaluations (
      id TEXT PRIMARY KEY,
      strategy_version_id TEXT NOT NULL,
      baseline_version_id TEXT,
      job_id TEXT,
      result_id TEXT,
      metrics_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),
      outcome TEXT NOT NULL CHECK (outcome IN ('better','same','worse','inconclusive')),
      evaluated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (strategy_version_id) REFERENCES crm_ai_strategy_versions(id) ON DELETE RESTRICT,
      FOREIGN KEY (baseline_version_id) REFERENCES crm_ai_strategy_versions(id) ON DELETE RESTRICT,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT,
      FOREIGN KEY (result_id) REFERENCES crm_ai_station_results(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_station_results (
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
      created_at TEXT NOT NULL, stale_at TEXT NOT NULL DEFAULT '', stale_reason TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT,
      FOREIGN KEY (customer_id) REFERENCES customer_pool(customer_id) ON DELETE RESTRICT,
      FOREIGN KEY (crm_account_id) REFERENCES crm_accounts(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_strategy_versions (
      id TEXT PRIMARY KEY,
      strategy_key TEXT NOT NULL,
      version TEXT NOT NULL,
      station TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
      status TEXT NOT NULL CHECK (status IN ('shadow','pending_approval','published','retired')),
      supersedes_id TEXT,
      created_by TEXT NOT NULL,
      approved_by TEXT NOT NULL DEFAULT '',
      approval_role TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      approval_requested_at TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      retired_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE (strategy_key,version),
      FOREIGN KEY (supersedes_id) REFERENCES crm_ai_strategy_versions(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_task_reviews (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES crm_ai_jobs(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_ai_usage_ledger (
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

CREATE TABLE crm_customer_stars (
    id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,user_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    starred_at TEXT NOT NULL,unstarred_at TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,
    UNIQUE(customer_id,user_id)
  );

CREATE TABLE crm_audit_log (
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL DEFAULT '',action TEXT NOT NULL,
    entity_type TEXT NOT NULL,entity_id TEXT NOT NULL DEFAULT '',detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  , real_user_id TEXT NOT NULL DEFAULT '', effective_user_id TEXT NOT NULL DEFAULT '', impersonation_context_id TEXT NOT NULL DEFAULT '');

CREATE TABLE crm_collaboration_events (
      id TEXT PRIMARY KEY,
      root_event_id TEXT NOT NULL CHECK(length(trim(root_event_id)) > 0),
      supersedes_event_id TEXT NOT NULL DEFAULT '',
      relation_type TEXT NOT NULL
        CHECK(relation_type IN ('original','supplement','correction','revocation')),
      idempotency_key TEXT NOT NULL UNIQUE CHECK(length(trim(idempotency_key)) > 0),
      request_hash TEXT NOT NULL CHECK(length(trim(request_hash)) > 0),
      sales_user_id TEXT NOT NULL CHECK(length(trim(sales_user_id)) > 0),
      customer_id TEXT NOT NULL DEFAULT '',
      problem TEXT NOT NULL DEFAULT '',
      suggestion TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      next_step TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'unresolved'
        CHECK(status IN ('unresolved','resolved','escalated','revoked')),
      actor_id TEXT NOT NULL CHECK(length(trim(actor_id)) > 0),
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source='manual'),
      before_json TEXT NOT NULL DEFAULT '{}',
      after_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

CREATE TABLE crm_commerce_action_requests (
        idempotency_key TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('quote','order')),
        customer_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed')),
        response_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE crm_customer_create_requests (
        idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
        actor_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed')),
        response_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE crm_customer_identity_audit (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      normalized_name TEXT NOT NULL DEFAULT '',
      external_customer_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

CREATE TABLE crm_customer_identity_conflict_audit (
      id TEXT PRIMARY KEY,
      conflict_id TEXT NOT NULL,
      request_hash TEXT NOT NULL UNIQUE,
      actor_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      target_external_customer_id TEXT NOT NULL DEFAULT '',
      expected_version TEXT NOT NULL,
      source_version TEXT NOT NULL,
      details_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conflict_id) REFERENCES crm_customer_identity_conflicts(conflict_id)
    );

CREATE TABLE crm_customer_identity_conflicts (
      conflict_id TEXT PRIMARY KEY,
      normalized_name TEXT NOT NULL,
      source_expected_version TEXT NOT NULL,
      latest_source_version TEXT NOT NULL,
      expected_version TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      latest_evidence_json TEXT NOT NULL,
      external_customer_ids_json TEXT NOT NULL,
      latest_external_customer_ids_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','retry','resolved')),
      decision TEXT NOT NULL DEFAULT '',
      target_external_customer_id TEXT NOT NULL DEFAULT '',
      details_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      resolved_source_version TEXT NOT NULL DEFAULT '',
      resolved_by TEXT NOT NULL DEFAULT '',
      resolved_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE crm_customer_identity_migration_reports (
      id TEXT PRIMARY KEY,
      scanned_at TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      conflicts_json TEXT NOT NULL DEFAULT '[]',
      unresolved INTEGER NOT NULL DEFAULT 0 CHECK(unresolved >= 0)
    );

CREATE TABLE crm_customer_identity_name_tombstones (
      normalized_name TEXT PRIMARY KEY,
      origin_conflict_id TEXT NOT NULL,
      origin_source_version TEXT NOT NULL,
      origin_audit_id TEXT NOT NULL,
      anchor_external_customer_id TEXT NOT NULL,
      resolution_audit_id TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      released_by TEXT NOT NULL DEFAULT '',
      released_at TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE crm_customer_identity_registry (
      normalized_name TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL,
      source TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE crm_data_maintenance_runs (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      target_fingerprint TEXT NOT NULL DEFAULT '',
      preview_counts_json TEXT NOT NULL DEFAULT '{}',
      result_counts_json TEXT NOT NULL DEFAULT '{}',
      backup_file TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      real_user_id TEXT NOT NULL DEFAULT '',
      session_hash_prefix TEXT NOT NULL DEFAULT '',
      preview_token_hash TEXT NOT NULL DEFAULT '',
      preview_expires_at TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

CREATE TABLE crm_deferred_plan_events (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL CHECK(length(trim(customer_id)) > 0),
      actor_id TEXT NOT NULL CHECK(length(trim(actor_id)) > 0),
      owner_id_snapshot TEXT NOT NULL DEFAULT '',
      review_at TEXT NOT NULL CHECK(length(trim(review_at)) > 0),
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL CHECK(length(trim(source)) > 0),
      source_event_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0)
    );

CREATE TABLE crm_duplicate_reviews (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL DEFAULT '',
        fingerprint TEXT NOT NULL,
        submitted_by TEXT NOT NULL DEFAULT '',
        input_json TEXT NOT NULL DEFAULT '{}',
        candidates_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','confirmed_same','confirmed_distinct')),
        resolution_note TEXT NOT NULL DEFAULT '',
        reviewed_by TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT NOT NULL DEFAULT '',
        created_account_id TEXT NOT NULL DEFAULT '',
        created_external_customer_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      , created_rule_version TEXT NOT NULL DEFAULT 'legacy-v1', evaluated_rule_version TEXT NOT NULL DEFAULT 'legacy-v1', current_candidates_json TEXT NOT NULL DEFAULT '', selected_customer_id TEXT NOT NULL DEFAULT '', selected_candidate_json TEXT NOT NULL DEFAULT '{}', selected_by TEXT NOT NULL DEFAULT '', resolution_source TEXT NOT NULL DEFAULT '', recalculated_by TEXT NOT NULL DEFAULT '', recalculated_at TEXT NOT NULL DEFAULT '');

CREATE TABLE crm_intake_action_requests (
        idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
        actor_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('claim','return','reject')),
        status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
        response_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE crm_intake_assignment_previews (
        token TEXT PRIMARY KEY CHECK (length(trim(token)) > 0),
        actor_id TEXT NOT NULL,
        item_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

CREATE TABLE crm_intake_assignment_rule_drafts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL,
      conditions_json TEXT NOT NULL,
      target_mode TEXT NOT NULL CHECK(target_mode IN ('selected','all_authorized')),
      sales_user_ids_json TEXT NOT NULL DEFAULT '[]',
      strategy TEXT NOT NULL CHECK(strategy IN ('balanced','round_robin','fixed_priority')),
      daily_quota INTEGER,
      is_system_default INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

CREATE TABLE crm_intake_assignment_rule_rotation (
      rule_id TEXT NOT NULL,
      rule_version_id TEXT NOT NULL,
      cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor>=0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(rule_id,rule_version_id)
    );

CREATE TABLE crm_intake_assignment_rule_state (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 1,
      draft_revision INTEGER NOT NULL DEFAULT 0,
      published_version_id TEXT NOT NULL DEFAULT '',
      next_version_number INTEGER NOT NULL DEFAULT 1,
      migrated_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

CREATE TABLE crm_intake_assignment_rule_usage (
      rule_id TEXT NOT NULL,
      rule_version_id TEXT NOT NULL,
      sales_user_id TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      assigned_count INTEGER NOT NULL DEFAULT 0 CHECK(assigned_count>=0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(rule_id,rule_version_id,sales_user_id,usage_date)
    );

CREATE TABLE crm_intake_assignment_rule_versions (
      id TEXT PRIMARY KEY,
      version_number INTEGER NOT NULL UNIQUE,
      rules_json TEXT NOT NULL,
      change_summary_json TEXT NOT NULL DEFAULT '{}',
      published_by TEXT NOT NULL,
      published_at TEXT NOT NULL,
      restored_from_version_id TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE crm_intake_batches (
        id TEXT PRIMARY KEY,
        batch_date TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'L3-sales-ready',
        status TEXT NOT NULL DEFAULT 'scanned',
        candidate_count INTEGER NOT NULL DEFAULT 0,
        imported_count INTEGER NOT NULL DEFAULT 0,
        assigned_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL,
        finished_at TEXT NOT NULL DEFAULT ''
      );

CREATE TABLE crm_intake_decisions (
        id TEXT PRIMARY KEY,
        intake_item_id TEXT NOT NULL,
        decision_type TEXT NOT NULL DEFAULT 'arbitration',
        actor_id TEXT NOT NULL DEFAULT '',
        candidate_snapshot_id TEXT NOT NULL DEFAULT '',
        ai_recommendation_json TEXT NOT NULL DEFAULT '{}',
        rule_decision_json TEXT NOT NULL DEFAULT '{}',
        manual_decision_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

CREATE TABLE crm_intake_items (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        external_customer_id TEXT NOT NULL UNIQUE,
        crm_customer_id TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '',
        customer_type TEXT NOT NULL DEFAULT '',
        product_focus TEXT NOT NULL DEFAULT '',
        match_score INTEGER NOT NULL DEFAULT 0,
        match_group TEXT NOT NULL DEFAULT '',
        contact_name TEXT NOT NULL DEFAULT '',
        contact_title TEXT NOT NULL DEFAULT '',
        contact_methods TEXT NOT NULL DEFAULT '',
        contact_level TEXT NOT NULL DEFAULT 'L3',
        report_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        suggested_owner_id TEXT NOT NULL DEFAULT '',
        assigned_owner_id TEXT NOT NULL DEFAULT '',
        decision_reason TEXT NOT NULL DEFAULT '',
        return_reason TEXT NOT NULL DEFAULT '',
        assigned_at TEXT NOT NULL DEFAULT '',
        claim_due_at TEXT NOT NULL DEFAULT '',
        claimed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, evidence_urls TEXT NOT NULL DEFAULT '', duplicate_review_id TEXT NOT NULL DEFAULT '', duplicate_state TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(batch_id) REFERENCES crm_intake_batches(id)
      );

CREATE TABLE crm_intake_manual_assignment_requests (
        idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
        actor_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
        response_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE crm_intake_settings (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        approval_mode TEXT NOT NULL DEFAULT 'automatic',
        daily_per_sales INTEGER NOT NULL DEFAULT 5,
        claim_sla_hours INTEGER NOT NULL DEFAULT 12,
        contact_sla_hours INTEGER NOT NULL DEFAULT 24,
        match_groups_json TEXT NOT NULL DEFAULT '["A","B"]',
        countries_json TEXT NOT NULL DEFAULT '[]',
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

CREATE TABLE crm_manager_evaluations (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        subject_type TEXT NOT NULL CHECK(subject_type IN ('company','contact')),
        subject_id TEXT NOT NULL DEFAULT '',
        subject_name TEXT NOT NULL DEFAULT '',
        subject_title TEXT NOT NULL DEFAULT '',
        evaluation_text TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        ai_status TEXT NOT NULL DEFAULT 'pending',
        ai_summary TEXT NOT NULL DEFAULT '',
        ai_labels_json TEXT NOT NULL DEFAULT '[]',
        ai_order_keys_json TEXT NOT NULL DEFAULT '[]',
        ai_risks_json TEXT NOT NULL DEFAULT '[]',
        ai_strategy TEXT NOT NULL DEFAULT '',
        ai_model TEXT NOT NULL DEFAULT '',
        ai_error TEXT NOT NULL DEFAULT '',
        ai_generated_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );

CREATE TABLE crm_manager_interventions (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      task_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN (
        'plan_formed','terminal_stage','reassigned','manager_advice',
        'escalate_owner','marked_overdue'
      )),
      note TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT '',
      request_hash TEXT NOT NULL DEFAULT '',
      business_change_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES crm_manager_tasks(id) ON DELETE RESTRICT
    );

CREATE TABLE crm_manager_task_settings (
      id TEXT PRIMARY KEY CHECK(id='default'),
      version INTEGER NOT NULL CHECK(version >= 1),
      consecutive_deferred_enabled INTEGER NOT NULL CHECK(consecutive_deferred_enabled IN (0,1)),
      consecutive_deferred_count INTEGER NOT NULL CHECK(consecutive_deferred_count >= 1),
      first_contact_silence_enabled INTEGER NOT NULL CHECK(first_contact_silence_enabled IN (0,1)),
      first_contact_silence_days INTEGER NOT NULL CHECK(first_contact_silence_days >= 1),
      planned_action_overdue_enabled INTEGER NOT NULL CHECK(planned_action_overdue_enabled IN (0,1)),
      planned_action_overdue_hours INTEGER NOT NULL CHECK(planned_action_overdue_hours >= 1),
      sales_anomaly_enabled INTEGER NOT NULL CHECK(sales_anomaly_enabled IN (0,1)),
      min_active_customers INTEGER NOT NULL CHECK(min_active_customers >= 1),
      min_anomalous_customers INTEGER NOT NULL CHECK(min_anomalous_customers >= 1),
      anomaly_ratio_percent REAL NOT NULL CHECK(anomaly_ratio_percent > 0 AND anomaly_ratio_percent <= 100),
      recipient_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

CREATE TABLE crm_manager_task_settings_audit (
      id TEXT PRIMARY KEY,
      settings_version INTEGER NOT NULL UNIQUE,
      actor_id TEXT NOT NULL,
      previous_json TEXT NOT NULL,
      next_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE "crm_manager_tasks" (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL CHECK(length(trim(customer_id)) > 0),
    reason TEXT NOT NULL CHECK(reason IN (
      'consecutive_deferred','first_contact_silence','planned_action_overdue','manager_assistance'
    )),
    status TEXT NOT NULL DEFAULT 'open'
      CHECK(status IN ('open','completed','overdue','escalated')),
    actor_id_snapshot TEXT NOT NULL DEFAULT '',
    owner_id_snapshot TEXT NOT NULL DEFAULT '',
    recipient_ids_json TEXT NOT NULL DEFAULT '[]',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    completion_condition TEXT NOT NULL,
    settings_version INTEGER NOT NULL CHECK(settings_version >= 1),
    threshold_snapshot_json TEXT NOT NULL,
    evaluated_at TEXT NOT NULL,
    triggered_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    result_json TEXT NOT NULL DEFAULT '{}',
    resolved_by TEXT NOT NULL DEFAULT '',
    resolved_at TEXT NOT NULL DEFAULT '',
    escalated_by TEXT NOT NULL DEFAULT '',
    escalated_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE TABLE crm_migration_review (
    id TEXT PRIMARY KEY,source_table TEXT NOT NULL,source_id TEXT NOT NULL,reason TEXT NOT NULL,
    payload_json TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT NOT NULL DEFAULT ''
  );

CREATE TABLE crm_next_plan_events (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL CHECK(length(trim(customer_id)) > 0),
      actor_id TEXT NOT NULL CHECK(length(trim(actor_id)) > 0),
      owner_id_snapshot TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL CHECK(length(trim(next_action)) > 0),
      next_action_at TEXT NOT NULL CHECK(length(trim(next_action_at)) > 0),
      source TEXT NOT NULL CHECK(length(trim(source)) > 0),
      source_event_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0)
    );

CREATE TABLE crm_plan_only_action_requests (
  idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
  actor_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
  response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE crm_notification_deliveries (
      id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('web','wecom')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','sending','sent','failed','disabled')),
      idempotency_key TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) > 0),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      lease_owner TEXT NOT NULL DEFAULT '',
      lease_expires_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      delivered_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (notification_id, channel),
      FOREIGN KEY (notification_id) REFERENCES crm_notifications(id) ON DELETE CASCADE
    );

CREATE TABLE crm_notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        customer_id TEXT NOT NULL DEFAULT '',
        code TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'unread',
        dedupe_key TEXT NOT NULL UNIQUE,
        wecom_status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        read_at TEXT NOT NULL DEFAULT ''
      );

CREATE TABLE crm_orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        quote_id TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        gross_margin REAL NOT NULL DEFAULT 0,
        is_repeat INTEGER NOT NULL DEFAULT 0,
        ordered_at TEXT NOT NULL,
        created_at TEXT NOT NULL, activity_id TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );

CREATE TABLE crm_protected_customer_action_requests (
      actor_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('commit','activate','rollback')),
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed')),
      response_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(actor_id,idempotency_key)
    );

CREATE TABLE crm_protected_customer_audit (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      batch_id TEXT NOT NULL DEFAULT '',
      row_id TEXT NOT NULL DEFAULT '',
      external_customer_id TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

CREATE TABLE crm_protected_customer_batch_rows (
      row_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      row_number INTEGER NOT NULL,
      input_version TEXT NOT NULL,
      alpha_nickname TEXT NOT NULL DEFAULT '',
      normalized_name TEXT NOT NULL DEFAULT '',
      external_customer_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'ready'
        CHECK(status IN ('ready','imported','rejected','rolled_back')),
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(batch_id,row_number),
      FOREIGN KEY(batch_id) REFERENCES crm_protected_customer_batches(batch_id)
    );

CREATE TABLE crm_protected_customer_batches (
      batch_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      input_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'previewed'
        CHECK(status IN ('previewed','committing','committed','rolled_back')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      committed_at TEXT NOT NULL DEFAULT '',
      rolled_back_at TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE crm_protected_customers (
      external_customer_id TEXT PRIMARY KEY,
      normalized_name TEXT NOT NULL,
      alpha_nickname TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'protected'
        CHECK(status IN ('protected','activated','withdrawn')),
      activated_account_id TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      activated_by TEXT NOT NULL DEFAULT '',
      activated_at TEXT NOT NULL DEFAULT '',
      withdrawn_by TEXT NOT NULL DEFAULT '',
      withdrawn_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(batch_id) REFERENCES crm_protected_customer_batches(batch_id)
    );

CREATE TABLE crm_quotes (
        id TEXT PRIMARY KEY,
        rfq_id TEXT NOT NULL DEFAULT '',
        customer_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        gross_margin REAL NOT NULL DEFAULT 0,
        loss_leader INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'sent',
        sent_at TEXT NOT NULL,
        next_follow_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, activity_id TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );

CREATE TABLE crm_rfqs (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        reference TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        bom_lines INTEGER NOT NULL DEFAULT 0,
        expected_value REAL NOT NULL DEFAULT 0,
        product_category TEXT NOT NULL DEFAULT '',
        completeness INTEGER NOT NULL DEFAULT 0,
        received_at TEXT NOT NULL,
        quoted_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, activity_id TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );

CREATE TABLE crm_smoke_runs (
      run_id TEXT PRIMARY KEY,
      smoke_type TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      activity_id TEXT NOT NULL DEFAULT '',
      ai_job_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('prepared','queued','cleaned','preserved','failed')),
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      expected_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      cleaned_at TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE crm_team_status_views (
      user_id TEXT NOT NULL CHECK(length(trim(user_id)) > 0),
      view_key TEXT NOT NULL CHECK(length(trim(view_key)) > 0),
      last_viewed_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,view_key)
    );

CREATE TABLE crm_today_task_action_requests (
        idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
        actor_id TEXT NOT NULL,
        action_type TEXT NOT NULL CHECK (action_type IN (
          'resolve_overdue_lead','add_next_plan','complete_manager_assistance'
        )),
        target_type TEXT NOT NULL CHECK (target_type IN ('crm_intake_item','crm_account')),
        target_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
        response_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE customer_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  assigned_to TEXT NOT NULL,
  assigned_by TEXT DEFAULT 'claw',
  assigned_at TEXT DEFAULT (datetime('now','+8 hours')),
  status TEXT DEFAULT 'pending',
  notes TEXT DEFAULT ''
);

CREATE TABLE customer_nickname_audit (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL,
      old_nickname TEXT NOT NULL DEFAULT '',
      new_nickname TEXT NOT NULL DEFAULT '',
      real_user_id TEXT NOT NULL DEFAULT '',
      effective_user_id TEXT NOT NULL DEFAULT '',
      impersonation_context_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE customer_nickname_migration_audit (
      external_customer_id TEXT PRIMARY KEY,
      selected_nickname TEXT NOT NULL DEFAULT '',
      selected_account_id TEXT NOT NULL DEFAULT '',
      candidates_json TEXT NOT NULL DEFAULT '[]',
      resolution_rule TEXT NOT NULL DEFAULT '',
      had_conflict INTEGER NOT NULL DEFAULT 0,
      migrated_at TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      domain TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      russian_name TEXT NOT NULL DEFAULT '',
      english_name TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      products TEXT NOT NULL DEFAULT '',
      rating TEXT NOT NULL DEFAULT '',
      current_pool TEXT NOT NULL DEFAULT '未分池',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      inn TEXT NOT NULL DEFAULT '',
      risk_status TEXT NOT NULL DEFAULT '',
      website_verification TEXT NOT NULL DEFAULT '',
      contact_count TEXT NOT NULL DEFAULT '0',
      deep_report TEXT NOT NULL DEFAULT '',
      source_file TEXT NOT NULL DEFAULT '',
      first_found TEXT NOT NULL DEFAULT '',
      last_found TEXT NOT NULL DEFAULT '',
      search_count TEXT NOT NULL DEFAULT '0',
      verified TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT ''
    , assigned_to TEXT DEFAULT "", assigned_at TEXT DEFAULT "", country_code TEXT NOT NULL DEFAULT '', email_raw TEXT NOT NULL DEFAULT '', best_contact_level TEXT NOT NULL DEFAULT 'L0', best_person_id TEXT NOT NULL DEFAULT '', sales_ready_contact_count INTEGER NOT NULL DEFAULT 0, contact_recon_status TEXT NOT NULL DEFAULT 'not_started', contact_last_checked_at TEXT NOT NULL DEFAULT '', contact_next_action TEXT NOT NULL DEFAULT '', is_test_data INTEGER NOT NULL DEFAULT 0, test_run_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', nickname TEXT NOT NULL DEFAULT '', established_year INTEGER);

CREATE TABLE customer_tag_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      tag_name TEXT NOT NULL,
      tag_category TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('added', 'removed')),
      actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE customer_tags (
      customer_id TEXT NOT NULL DEFAULT '',
      tag_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (customer_id, tag_id),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

CREATE TABLE customers (
      follow_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      rating TEXT NOT NULL DEFAULT '',
      products TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '',
      assigned_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '未分配',
      first_contact_date TEXT NOT NULL DEFAULT '',
      last_follow_date TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT '',
      feedback TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      next_follow_date TEXT NOT NULL DEFAULT '',
      invalid_reason TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE filter_catalog_migrations (
        migration_key TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

CREATE TABLE filter_definitions (
        filter_key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        field_type TEXT NOT NULL CHECK(field_type IN ('text','multi','date_range','tag_multi')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        sensitive INTEGER NOT NULL DEFAULT 0 CHECK(sensitive IN (0,1)),
        operators_json TEXT NOT NULL,
        display_mode TEXT NOT NULL CHECK(display_mode IN ('horizontal','more','date_range')),
        displayed INTEGER NOT NULL DEFAULT 1 CHECK(displayed IN (0,1)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        required_permissions_json TEXT NOT NULL DEFAULT '[]',
        pages_json TEXT NOT NULL DEFAULT '[]',
        tag_category TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE filter_permission_audit (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        action TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

CREATE TABLE filter_permission_state (
        id INTEGER PRIMARY KEY CHECK(id=1),
        version INTEGER NOT NULL CHECK(version>=1),
        updated_at TEXT NOT NULL
      );

CREATE TABLE permission_group_filter_grants (
        group_id TEXT NOT NULL,
        filter_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(group_id,filter_key),
        FOREIGN KEY(group_id) REFERENCES permission_groups(id) ON DELETE CASCADE,
        FOREIGN KEY(filter_key) REFERENCES filter_definitions(filter_key) ON DELETE CASCADE
      );

CREATE TABLE permission_group_migrations (
        migration_key TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

CREATE TABLE permission_groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
        role_key TEXT NOT NULL CHECK(role_key IN ('admin','manager','sales')),
        permissions_json TEXT NOT NULL, system_key TEXT UNIQUE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );

CREATE TABLE person_candidates (
      person_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, contact_recon_job_id TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '', full_name_local TEXT NOT NULL DEFAULT '', normalized_name TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
      role_category TEXT NOT NULL DEFAULT 'unknown', decision_role TEXT NOT NULL DEFAULT 'unknown',
      employment_status TEXT NOT NULL DEFAULT 'unverified', employment_confidence INTEGER NOT NULL DEFAULT 0,
      contact_level TEXT NOT NULL DEFAULT 'L0', sales_ready INTEGER NOT NULL DEFAULT 0,
      manual_review_required INTEGER NOT NULL DEFAULT 0, quality_issues_json TEXT NOT NULL DEFAULT '[]',
      first_found_at TEXT NOT NULL, last_verified_at TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    , procurement_relevance TEXT NOT NULL DEFAULT 'P0', delivery_status TEXT NOT NULL DEFAULT 'research_only');

CREATE TABLE person_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT, evidence_id TEXT NOT NULL, person_id TEXT NOT NULL DEFAULT '',
      customer_id TEXT NOT NULL, contact_recon_job_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL, field_name TEXT NOT NULL, value TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL, source_title TEXT NOT NULL DEFAULT '', source_date TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL, confidence TEXT NOT NULL DEFAULT 'medium',
      supports_current_employment INTEGER NOT NULL DEFAULT 0, supports_decision_role INTEGER NOT NULL DEFAULT 0,
      UNIQUE(contact_recon_job_id, evidence_id)
    );

CREATE TABLE prospect_candidates (
      candidate_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL DEFAULT '',
      existing_customer_id TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      products TEXT NOT NULL DEFAULT '',
      need_signal TEXT NOT NULL DEFAULT '',
      sell_signal TEXT NOT NULL DEFAULT '',
      contact_signal TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'candidate',
      source_summary TEXT NOT NULL DEFAULT '',
      promoted_customer_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE prospect_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT NOT NULL DEFAULT '',
      task_id TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT 'medium',
      fetched_at TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE prospect_tasks (
      task_id TEXT PRIMARY KEY,
      query TEXT NOT NULL DEFAULT '',
      market TEXT NOT NULL DEFAULT '俄罗斯',
      industry_focus TEXT NOT NULL DEFAULT '',
      product_focus TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      source_mix TEXT NOT NULL DEFAULT '',
      candidate_count INTEGER NOT NULL DEFAULT 0,
      promoted_count INTEGER NOT NULL DEFAULT 0,
      recon_count INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    , created_by TEXT NOT NULL DEFAULT '');

CREATE TABLE recon_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL DEFAULT '',
      customer_id TEXT NOT NULL DEFAULT '',
      field_name TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      source_title TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL DEFAULT '',
      confidence TEXT NOT NULL DEFAULT 'medium',
      extractor TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE recon_jobs (
      job_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL DEFAULT '',
      follow_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL DEFAULT '',
      inn TEXT NOT NULL DEFAULT '',
      requested_by TEXT NOT NULL DEFAULT '',
      requested_at TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      started_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      output_dir TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    , schema_version TEXT NOT NULL DEFAULT 'legacy', worker_id TEXT NOT NULL DEFAULT '', attempt_count INTEGER NOT NULL DEFAULT 0, lease_expires_at TEXT NOT NULL DEFAULT '', heartbeat_at TEXT NOT NULL DEFAULT '', validation_error TEXT NOT NULL DEFAULT '', cancel_requested_at TEXT NOT NULL DEFAULT '', cancelled_at TEXT NOT NULL DEFAULT '');

CREATE TABLE recon_results (
      job_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '',
      score TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT '',
      compliance_status TEXT NOT NULL DEFAULT '',
      sanctioned TEXT NOT NULL DEFAULT 'false',
      sanction_source TEXT NOT NULL DEFAULT '',
      sanction_program TEXT NOT NULL DEFAULT '',
      sanction_checked_at TEXT NOT NULL DEFAULT '',
      evidence_url TEXT NOT NULL DEFAULT '',
      opportunity_summary TEXT NOT NULL DEFAULT '',
      contacts_summary TEXT NOT NULL DEFAULT '',
      recommended_products TEXT NOT NULL DEFAULT '',
      outreach_angle TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      evidence_count TEXT NOT NULL DEFAULT '0',
      report_path TEXT NOT NULL DEFAULT '',
      artifacts_json TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    , industry TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', inn TEXT NOT NULL DEFAULT '', rating TEXT NOT NULL DEFAULT '', employees TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', current_pool TEXT NOT NULL DEFAULT '', risk_status TEXT NOT NULL DEFAULT '', website_verification TEXT NOT NULL DEFAULT '', verified TEXT NOT NULL DEFAULT '', contact_count TEXT NOT NULL DEFAULT '', contact_name TEXT NOT NULL DEFAULT '', contact_title TEXT NOT NULL DEFAULT '', contact_classification TEXT NOT NULL DEFAULT '', quality_status TEXT NOT NULL DEFAULT '', missing_steps TEXT NOT NULL DEFAULT '', step5_status TEXT NOT NULL DEFAULT '', step5_plus_status TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', sanction_status TEXT NOT NULL DEFAULT '', opportunity_do TEXT NOT NULL DEFAULT '', opportunity_need TEXT NOT NULL DEFAULT '', opportunity_sell TEXT NOT NULL DEFAULT '', opportunity_decision TEXT NOT NULL DEFAULT '', schema_version TEXT NOT NULL DEFAULT 'legacy', parser_mode TEXT NOT NULL DEFAULT 'legacy', result_json TEXT NOT NULL DEFAULT '', evidence_total_count INTEGER NOT NULL DEFAULT 0, evidence_selected_count INTEGER NOT NULL DEFAULT 0, evidence_unique_source_count INTEGER NOT NULL DEFAULT 0);

CREATE TABLE recon_submission_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT 'legacy', parser_mode TEXT NOT NULL DEFAULT 'legacy',
      evidence_total_count INTEGER NOT NULL DEFAULT 0, validation_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

CREATE TABLE sales_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL, impersonated_user_id TEXT NOT NULL DEFAULT '', impersonation_started_at TEXT NOT NULL DEFAULT '', impersonation_expires_at TEXT NOT NULL DEFAULT '', impersonation_context_id TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(user_id) REFERENCES sales_users(id) ON DELETE CASCADE
      );

CREATE TABLE sales_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','manager','sales')),
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        languages_json TEXT NOT NULL DEFAULT '[]',
        countries_json TEXT NOT NULL DEFAULT '[]',
        channels_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      , permissions_json TEXT NOT NULL DEFAULT '{}', permission_group_id TEXT NOT NULL DEFAULT '', archived_at TEXT NOT NULL DEFAULT '');

CREATE TABLE sanction_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '', result TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'pending',
      matches_json TEXT NOT NULL DEFAULT '[]', checked_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );

CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      is_preset INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      UNIQUE(category, name)
    );

CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      english TEXT NOT NULL DEFAULT '',
      russian TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT ''
    );

CREATE TABLE user_filter_extra_grants (
        user_id TEXT NOT NULL,
        filter_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id,filter_key),
        FOREIGN KEY(user_id) REFERENCES sales_users(id) ON DELETE CASCADE,
        FOREIGN KEY(filter_key) REFERENCES filter_definitions(filter_key) ON DELETE CASCADE
      );

CREATE TABLE user_permission_overrides (
        user_id TEXT NOT NULL, permission_key TEXT NOT NULL,
        effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(user_id, permission_key),
        FOREIGN KEY(user_id) REFERENCES sales_users(id) ON DELETE CASCADE
      );

CREATE TABLE website_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, http_status INTEGER, method TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '', checked_at TEXT NOT NULL DEFAULT '', details_json TEXT NOT NULL DEFAULT '{}'
    );

CREATE TABLE wecom_bot_audit_log (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL DEFAULT '',
        actor_id TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

CREATE TABLE wecom_bot_tasks (
        task_id TEXT PRIMARY KEY,
        external_message_id TEXT NOT NULL UNIQUE,
        wecom_user_id TEXT NOT NULL DEFAULT '',
        crm_user_id TEXT NOT NULL DEFAULT '',
        conversation_id TEXT NOT NULL DEFAULT '',
        message_type TEXT NOT NULL DEFAULT 'text',
        raw_text TEXT NOT NULL DEFAULT '',
        intent TEXT NOT NULL DEFAULT 'UNKNOWN',
        parameters_json TEXT NOT NULL DEFAULT '{}',
        risk_level TEXT NOT NULL DEFAULT 'low',
        status TEXT NOT NULL DEFAULT 'queued',
        confirmation_required INTEGER NOT NULL DEFAULT 0,
        confirmed_by TEXT NOT NULL DEFAULT '',
        confirmed_at TEXT NOT NULL DEFAULT '',
        result_json TEXT NOT NULL DEFAULT '{}',
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT NOT NULL DEFAULT ''
      );

CREATE TABLE wecom_user_bindings (
        wecom_user_id TEXT PRIMARY KEY,
        crm_user_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        bound_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(crm_user_id) REFERENCES sales_users(id)
      );
