'use strict';

function installAIStationSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new Error('database is required');
  db.exec(`
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
}

module.exports = { installAIStationSchema };
