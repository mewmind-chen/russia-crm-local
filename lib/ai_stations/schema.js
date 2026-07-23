'use strict';

const AI_SCHEMA_VERSION = 1;

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
  `);
  db.prepare('INSERT OR IGNORE INTO crm_ai_schema_migrations(version,applied_at) VALUES (?,?)')
    .run(AI_SCHEMA_VERSION, new Date().toISOString());
}

function installedVersion(db) {
  const exists = db.prepare(`SELECT 1 found FROM sqlite_master
    WHERE type='table' AND name='crm_ai_schema_migrations'`).get();
  if (!exists) return 0;
  return Number(db.prepare('SELECT MAX(version) version FROM crm_ai_schema_migrations').get()?.version || 0);
}

function installAIStationSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new Error('database is required');
  if (installedVersion(db) >= AI_SCHEMA_VERSION) return;
  db.pragma('busy_timeout = 5000');
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
