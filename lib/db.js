const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const {
  CUSTOMER_TYPE_OPTIONS,
  INDUSTRY_OPTIONS,
  BUSINESS_PRODUCT_OPTIONS,
  normalizeCustomerType,
  normalizeIndustry,
} = require('./taxonomy');
const { allocateCustomerId, installCustomerIdTriggers } = require('./customer_ids');
const { gradeReconResult } = require('./recon_grading');
const { validateReconV3, evidenceMetrics } = require('./recon_contract');
const { ratePerson, validateContactRecon, normalizeMethod } = require('./contact_quality');
const { databasePath } = require('./runtime_paths');
const {
  assertExternalCustomerAccess,
  redactContactFields,
  contactSafePoolRecord,
  contactSafeReconRecord,
} = require('./access_control');
const { markContactReadinessStale } = require('./ai_stations/contact_readiness');

const fs = require('fs');

const STATUS_OPTIONS = [
  '未分配', '已分配待联系', '已邮件联系', '已电话联系',
  '已WhatsApp/Telegram联系', '暂无回复', '已回复-有兴趣',
  '已回复-不匹配', '已询价', '已报价', '联系方式无效',
  '风险过高', '放弃跟进',
];

const STATUS_GROUPS = {
  '待联系': ['未分配', '已分配待联系'],
  '已联系': ['已邮件联系', '已电话联系', '已WhatsApp/Telegram联系'],
  '暂无回复': ['暂无回复'],
  '有兴趣/询价': ['已回复-有兴趣', '已询价'],
  '已报价': ['已报价'],
  '需确认/无效': ['联系方式无效', '风险过高', '放弃跟进'],
};

const RISK_KEYWORDS = ['军工', '航空', '国防', '航空航天', '国防电子', '合规审查', '需合规审查', '风险'];
const SANCTION_OPPORTUNITY_STATUS = 'HIT｜制裁命中，供应链替代机会信号';

const TAG_PRESETS = [
  ['客户类型', CUSTOMER_TYPE_OPTIONS, '#2563eb'],
  ['客户经营产品', BUSINESS_PRODUCT_OPTIONS, '#0f766e'],
  ['需求/采购产品', ['传感器', 'MCU/微控制器', '功率器件', '电源管理/电源模块', 'PLC/控制器', '连接器', '通信模块/无线模块', '被动元件', 'FPGA/DSP/处理器', '射频/微波', '存储/内存', 'PCB/SMT', 'LED/照明', '仪器仪表/测量'], '#7c3aed'],
  ['应用行业', INDUSTRY_OPTIONS, '#b45309'],
  ['重点场景', ['电机控制', '伺服/变频', '无人机', '航空电子', '雷达/导航', '工业自动化', '医疗设备', '汽车电子', '智能家居', '通信网络', '机床/CNC'], '#be123c'],
  ['需确认属性', ['军工', '非目标'], '#b42318'],
];

const TAG_CATEGORY_ORDER = TAG_PRESETS.map(([category]) => category);
const AUTO_TAG_CATEGORIES = new Set(TAG_CATEGORY_ORDER);

function getDb() {
  const dbPath = databasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function ensureTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
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

    CREATE TABLE IF NOT EXISTS customer_pool (
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
      notes TEXT NOT NULL DEFAULT '',
      is_test_data INTEGER NOT NULL DEFAULT 0,
      test_run_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      english TEXT NOT NULL DEFAULT '',
      russian TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '',
      product TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS recon_jobs (
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
      cancel_requested_at TEXT NOT NULL DEFAULT '',
      cancelled_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS recon_results (
      job_id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      inn TEXT NOT NULL DEFAULT '',
      rating TEXT NOT NULL DEFAULT '',
      score TEXT NOT NULL DEFAULT '',
      employees TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      current_pool TEXT NOT NULL DEFAULT '',
      risk_status TEXT NOT NULL DEFAULT '',
      website_verification TEXT NOT NULL DEFAULT '',
      verified TEXT NOT NULL DEFAULT '',
      contact_count TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      contact_title TEXT NOT NULL DEFAULT '',
      contact_classification TEXT NOT NULL DEFAULT '',
      quality_status TEXT NOT NULL DEFAULT '',
      missing_steps TEXT NOT NULL DEFAULT '',
      step5_status TEXT NOT NULL DEFAULT '',
      step5_plus_status TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      sanction_status TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT '',
      compliance_status TEXT NOT NULL DEFAULT '',
      sanctioned TEXT NOT NULL DEFAULT 'false',
      sanction_source TEXT NOT NULL DEFAULT '',
      sanction_program TEXT NOT NULL DEFAULT '',
      sanction_checked_at TEXT NOT NULL DEFAULT '',
      evidence_url TEXT NOT NULL DEFAULT '',
      opportunity_summary TEXT NOT NULL DEFAULT '',
      opportunity_do TEXT NOT NULL DEFAULT '',
      opportunity_need TEXT NOT NULL DEFAULT '',
      opportunity_sell TEXT NOT NULL DEFAULT '',
      opportunity_decision TEXT NOT NULL DEFAULT '',
      contacts_summary TEXT NOT NULL DEFAULT '',
      recommended_products TEXT NOT NULL DEFAULT '',
      outreach_angle TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '',
      evidence_count TEXT NOT NULL DEFAULT '0',
      report_path TEXT NOT NULL DEFAULT '',
      artifacts_json TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS recon_evidence (
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

    CREATE TABLE IF NOT EXISTS prospect_tasks (
      task_id TEXT PRIMARY KEY,
      created_by TEXT NOT NULL DEFAULT '',
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
    );

    CREATE TABLE IF NOT EXISTS prospect_candidates (
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

    CREATE TABLE IF NOT EXISTS prospect_sources (
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

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '',
      is_preset INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      UNIQUE(category, name)
    );

    CREATE TABLE IF NOT EXISTS customer_tags (
      customer_id TEXT NOT NULL DEFAULT '',
      tag_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (customer_id, tag_id),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS customer_tag_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      tag_name TEXT NOT NULL,
      tag_category TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('added', 'removed')),
      actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS customer_tag_history_customer_idx
      ON customer_tag_history(customer_id, created_at DESC, id DESC);
  `);
  ensureReconResultColumns(db);
  ensureReconJobColumns(db);
  ensureNormalizedReconTables(db);
  ensureContactReconTables(db);
  ensureCustomerPoolLifecycle(db);
  ensureCompanyScreeningTables(db);
  ensureReconIndexes(db);
  installCustomerIdTriggers(db);
  seedPresetTags(db);
  db.close();
}

function ensureCompanyScreeningTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_screening (
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
    CREATE INDEX IF NOT EXISTS idx_company_screening_group_score
      ON company_screening(match_group, match_score DESC);
  `);
}

function ensureReconResultColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(recon_results)').all().map(row => row.name));
  const columns = [
    ['industry', "TEXT NOT NULL DEFAULT ''"],
    ['city', "TEXT NOT NULL DEFAULT ''"],
    ['phone', "TEXT NOT NULL DEFAULT ''"],
    ['email', "TEXT NOT NULL DEFAULT ''"],
    ['inn', "TEXT NOT NULL DEFAULT ''"],
    ['rating', "TEXT NOT NULL DEFAULT ''"],
    ['employees', "TEXT NOT NULL DEFAULT ''"],
    ['description', "TEXT NOT NULL DEFAULT ''"],
    ['current_pool', "TEXT NOT NULL DEFAULT ''"],
    ['risk_status', "TEXT NOT NULL DEFAULT ''"],
    ['website_verification', "TEXT NOT NULL DEFAULT ''"],
    ['verified', "TEXT NOT NULL DEFAULT ''"],
    ['contact_count', "TEXT NOT NULL DEFAULT ''"],
    ['contact_name', "TEXT NOT NULL DEFAULT ''"],
    ['contact_title', "TEXT NOT NULL DEFAULT ''"],
    ['contact_classification', "TEXT NOT NULL DEFAULT ''"],
    ['quality_status', "TEXT NOT NULL DEFAULT ''"],
    ['missing_steps', "TEXT NOT NULL DEFAULT ''"],
    ['step5_status', "TEXT NOT NULL DEFAULT ''"],
    ['step5_plus_status', "TEXT NOT NULL DEFAULT ''"],
    ['notes', "TEXT NOT NULL DEFAULT ''"],
    ['sanction_status', "TEXT NOT NULL DEFAULT ''"],
    ['opportunity_do', "TEXT NOT NULL DEFAULT ''"],
    ['opportunity_need', "TEXT NOT NULL DEFAULT ''"],
    ['opportunity_sell', "TEXT NOT NULL DEFAULT ''"],
    ['opportunity_decision', "TEXT NOT NULL DEFAULT ''"],
    ['schema_version', "TEXT NOT NULL DEFAULT 'legacy'"],
    ['parser_mode', "TEXT NOT NULL DEFAULT 'legacy'"],
    ['result_json', "TEXT NOT NULL DEFAULT ''"],
    ['evidence_total_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['evidence_selected_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['evidence_unique_source_count', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  columns.forEach(([name, definition]) => {
    if (!existing.has(name)) {
      db.prepare(`ALTER TABLE recon_results ADD COLUMN ${name} ${definition}`).run();
    }
  });
}

function ensureReconJobColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(recon_jobs)').all().map(row => row.name));
  const columns = [
    ['schema_version', "TEXT NOT NULL DEFAULT 'legacy'"],
    ['worker_id', "TEXT NOT NULL DEFAULT ''"],
    ['attempt_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['lease_expires_at', "TEXT NOT NULL DEFAULT ''"],
    ['heartbeat_at', "TEXT NOT NULL DEFAULT ''"],
    ['validation_error', "TEXT NOT NULL DEFAULT ''"],
    ['cancel_requested_at', "TEXT NOT NULL DEFAULT ''"],
    ['cancelled_at', "TEXT NOT NULL DEFAULT ''"],
  ];
  columns.forEach(([name, definition]) => {
    if (!existing.has(name)) db.prepare(`ALTER TABLE recon_jobs ADD COLUMN ${name} ${definition}`).run();
  });
}

function ensureReconIndexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_recon_jobs_status_updated ON recon_jobs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_recon_jobs_customer_updated ON recon_jobs(customer_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_recon_evidence_job ON recon_evidence(job_id);
    CREATE INDEX IF NOT EXISTS idx_recon_results_customer ON recon_results(customer_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_sanction_checks_job_created ON sanction_checks(job_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_customer_pool_country ON customer_pool(country);
    CREATE INDEX IF NOT EXISTS idx_contact_recon_jobs_status ON contact_recon_jobs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_person_candidates_customer ON person_candidates(customer_id, contact_level);
    CREATE INDEX IF NOT EXISTS idx_person_evidence_person ON person_evidence(person_id);
  `);
}

function ensureColumns(db, table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  columns.forEach(([name, definition]) => {
    if (!existing.has(name)) db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
  });
}

function ensureCustomerPoolLifecycle(db) {
  // Existing rows stay blank: discovery dates are not CRM lifecycle evidence.
  ensureColumns(db, 'customer_pool', [
    ['created_at', "TEXT NOT NULL DEFAULT ''"],
    ['updated_at', "TEXT NOT NULL DEFAULT ''"],
  ]);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS customer_pool_lifecycle_insert
    AFTER INSERT ON customer_pool
    WHEN trim(NEW.created_at) = '' OR trim(NEW.updated_at) = ''
    BEGIN
      UPDATE customer_pool
      SET created_at = CASE
            WHEN trim(NEW.created_at) = '' THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
            ELSE NEW.created_at
          END,
          updated_at = CASE
            WHEN trim(NEW.updated_at) = '' THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
            ELSE NEW.updated_at
          END
      WHERE customer_id = NEW.customer_id;
    END;

    CREATE TRIGGER IF NOT EXISTS customer_pool_lifecycle_update
    AFTER UPDATE ON customer_pool
    WHEN NEW.updated_at = OLD.updated_at OR trim(NEW.updated_at) = ''
    BEGIN
      UPDATE customer_pool
      SET updated_at = CASE
        WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') > OLD.updated_at
          THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
        ELSE strftime('%Y-%m-%d %H:%M:%f', OLD.updated_at, '+0.001 seconds')
      END
      WHERE customer_id = NEW.customer_id;
    END;
  `);
}

function assignLegacyProspectTasks(db) {
  const hasUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_users'").get();
  if (!hasUsers) return 0;
  const configuredOwner = String(process.env.CRM_LEGACY_PROSPECT_OWNER_ID || '').trim();
  const configured = configuredOwner
    ? db.prepare('SELECT id FROM sales_users WHERE id=? AND active=1').get(configuredOwner)
    : null;
  const owner = configured || db.prepare("SELECT id FROM sales_users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").get();
  if (!owner?.id) return 0;
  return db.prepare("UPDATE prospect_tasks SET created_by=? WHERE COALESCE(created_by,'')='' ")
    .run(owner.id).changes;
}

function ensureContactReconTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS person_candidates (
      person_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, contact_recon_job_id TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '', full_name_local TEXT NOT NULL DEFAULT '', normalized_name TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
      role_category TEXT NOT NULL DEFAULT 'unknown', decision_role TEXT NOT NULL DEFAULT 'unknown',
      employment_status TEXT NOT NULL DEFAULT 'unverified', employment_confidence INTEGER NOT NULL DEFAULT 0,
      contact_level TEXT NOT NULL DEFAULT 'L0', sales_ready INTEGER NOT NULL DEFAULT 0,
      manual_review_required INTEGER NOT NULL DEFAULT 0, quality_issues_json TEXT NOT NULL DEFAULT '[]',
      first_found_at TEXT NOT NULL, last_verified_at TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS person_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT, evidence_id TEXT NOT NULL, person_id TEXT NOT NULL DEFAULT '',
      customer_id TEXT NOT NULL, contact_recon_job_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL, field_name TEXT NOT NULL, value TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL, source_title TEXT NOT NULL DEFAULT '', source_date TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL, confidence TEXT NOT NULL DEFAULT 'medium',
      supports_current_employment INTEGER NOT NULL DEFAULT 0, supports_decision_role INTEGER NOT NULL DEFAULT 0,
      UNIQUE(contact_recon_job_id, evidence_id)
    );
    CREATE TABLE IF NOT EXISTS contact_recon_jobs (
      job_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, company_name TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '', inn TEXT NOT NULL DEFAULT '', target_roles_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT 'queued', worker_id TEXT NOT NULL DEFAULT '',
      attempt_count INTEGER NOT NULL DEFAULT 0, lease_expires_at TEXT NOT NULL DEFAULT '', heartbeat_at TEXT NOT NULL DEFAULT '',
      person_count INTEGER NOT NULL DEFAULT 0, l2_count INTEGER NOT NULL DEFAULT 0, l3_count INTEGER NOT NULL DEFAULT 0,
      search_budget INTEGER NOT NULL DEFAULT 0, output_dir TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '',
      failure_reason TEXT NOT NULL DEFAULT '', validation_error TEXT NOT NULL DEFAULT '',
      cancel_requested_at TEXT NOT NULL DEFAULT '', cancelled_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS contact_recon_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      person_count INTEGER NOT NULL DEFAULT 0, l2_count INTEGER NOT NULL DEFAULT 0, l3_count INTEGER NOT NULL DEFAULT 0,
      validation_status TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS company_entry_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT, contact_recon_job_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      method_type TEXT NOT NULL, value TEXT NOT NULL, discovery_type TEXT NOT NULL DEFAULT 'company_generic',
      verification_status TEXT NOT NULL DEFAULT 'unverified', source_url TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL DEFAULT '', UNIQUE(contact_recon_job_id, method_type, value)
    );
  `);
  ensureColumns(db, 'customer_pool', [
    ['best_contact_level', "TEXT NOT NULL DEFAULT 'L0'"],
    ['best_person_id', "TEXT NOT NULL DEFAULT ''"],
    ['sales_ready_contact_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['contact_recon_status', "TEXT NOT NULL DEFAULT 'not_started'"],
    ['contact_last_checked_at', "TEXT NOT NULL DEFAULT ''"],
    ['contact_next_action', "TEXT NOT NULL DEFAULT ''"],
    ['is_test_data', 'INTEGER NOT NULL DEFAULT 0'],
    ['test_run_id', "TEXT NOT NULL DEFAULT ''"],
  ]);
  db.exec(`CREATE INDEX IF NOT EXISTS customer_pool_test_data_idx
    ON customer_pool(is_test_data,test_run_id)`);
  ensureColumns(db, 'prospect_tasks', [
    ['created_by', "TEXT NOT NULL DEFAULT ''"],
  ]);
  assignLegacyProspectTasks(db);
  ensureColumns(db, 'person_candidates', [
    ['procurement_relevance', "TEXT NOT NULL DEFAULT 'P0'"],
    ['delivery_status', "TEXT NOT NULL DEFAULT 'research_only'"],
  ]);
  ensureColumns(db, 'contact_recon_jobs', [
    ['report_path', "TEXT NOT NULL DEFAULT ''"],
    ['cancel_requested_at', "TEXT NOT NULL DEFAULT ''"],
    ['cancelled_at', "TEXT NOT NULL DEFAULT ''"],
  ]);
  ensureColumns(db, 'contacts', [
    ['person_id', "TEXT NOT NULL DEFAULT ''"],
    ['role_category', "TEXT NOT NULL DEFAULT 'unknown'"],
    ['employment_status', "TEXT NOT NULL DEFAULT 'unverified'"],
    ['employment_confidence', 'INTEGER NOT NULL DEFAULT 0'],
    ['contact_level', "TEXT NOT NULL DEFAULT 'L0'"],
    ['sales_ready', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
  ensureColumns(db, 'contact_methods', [
    ['person_id', "TEXT NOT NULL DEFAULT ''"],
    ['discovery_type', "TEXT NOT NULL DEFAULT 'manual'"],
    ['verification_status', "TEXT NOT NULL DEFAULT 'unverified'"],
    ['confidence', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_direct', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_generic', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_inferred', 'INTEGER NOT NULL DEFAULT 0'],
    ['source_date', "TEXT NOT NULL DEFAULT ''"],
    ['last_verified_at', "TEXT NOT NULL DEFAULT ''"],
    ['failure_reason', "TEXT NOT NULL DEFAULT ''"],
  ]);
}

function ensureNormalizedReconTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      contact_id TEXT PRIMARY KEY, job_id TEXT NOT NULL DEFAULT '', customer_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', department TEXT NOT NULL DEFAULT '',
      decision_role TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
      quality_status TEXT NOT NULL DEFAULT 'unverified', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contact_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      method_type TEXT NOT NULL, value TEXT NOT NULL, normalized_value TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unverified', source_url TEXT NOT NULL DEFAULT '', verified_at TEXT NOT NULL DEFAULT '',
      UNIQUE(contact_id, method_type, normalized_value)
    );
    CREATE TABLE IF NOT EXISTS website_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, http_status INTEGER, method TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '', checked_at TEXT NOT NULL DEFAULT '', details_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS company_identifiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL DEFAULT '', customer_id TEXT NOT NULL,
      identifier_type TEXT NOT NULL, identifier_value TEXT NOT NULL, country_code TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '', checked_at TEXT NOT NULL DEFAULT '',
      UNIQUE(customer_id, identifier_type, identifier_value)
    );
    CREATE TABLE IF NOT EXISTS sanction_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '', result TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'pending',
      matches_json TEXT NOT NULL DEFAULT '[]', checked_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recon_submission_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT 'legacy', parser_mode TEXT NOT NULL DEFAULT 'legacy',
      evidence_total_count INTEGER NOT NULL DEFAULT 0, validation_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function syncNormalizedRecon(db, job, resultV3) {
  if (!resultV3) return;
  const now = nowText();
  db.prepare('DELETE FROM contacts WHERE job_id = ?').run(job.job_id);
  db.prepare('DELETE FROM contact_methods WHERE contact_id NOT IN (SELECT contact_id FROM contacts)').run();
  const addContact = db.prepare(`INSERT INTO contacts
    (contact_id, job_id, customer_id, name, title, department, decision_role, source_url, quality_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const addMethod = db.prepare(`INSERT OR IGNORE INTO contact_methods
    (contact_id, customer_id, method_type, value, normalized_value, status, source_url, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  (resultV3.contacts || []).forEach((contact, index) => {
    const contactId = `${job.job_id}-C${String(index + 1).padStart(3, '0')}`;
    addContact.run(contactId, job.job_id, job.customer_id, contact.name || '', contact.title || '', contact.department || '', contact.decision_role || '', contact.source_url || '', contact.quality_status || 'unverified', now, now);
    (contact.methods || []).forEach(method => addMethod.run(contactId, job.customer_id, method.type || '', method.value || '', String(method.value || '').trim().toLowerCase(), method.status || 'unverified', method.source_url || '', method.verified_at || ''));
  });
  db.prepare('DELETE FROM website_checks WHERE job_id = ?').run(job.job_id);
  const web = resultV3.website_check || {};
  db.prepare(`INSERT INTO website_checks (job_id, customer_id, url, status, http_status, method, error_code, checked_at, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(job.job_id, job.customer_id, resultV3.company?.website || '', web.status || 'unverified', web.http_status ?? null, web.method || '', web.error_code || '', web.checked_at || '', JSON.stringify(web));
  const addIdentifier = db.prepare(`INSERT OR REPLACE INTO company_identifiers
    (job_id, customer_id, identifier_type, identifier_value, country_code, source_url, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  (resultV3.company?.identifiers || []).forEach(item => addIdentifier.run(job.job_id, job.customer_id, item.type || '', item.value || '', resultV3.company?.country_code || '', item.source_url || '', item.checked_at || ''));
  db.prepare('DELETE FROM sanction_checks WHERE job_id = ?').run(job.job_id);
  const sanction = resultV3.sanction_check || {};
  db.prepare(`INSERT INTO sanction_checks (job_id, customer_id, provider, result, review_status, matches_json, checked_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(job.job_id, job.customer_id, sanction.provider || '', sanction.result || 'unknown', sanction.review_status || 'pending', JSON.stringify(sanction.matches || []), sanction.checked_at || '', now);
}

// --- helpers ---

function nowText() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function timeTextAt(epochMs) {
  const d = new Date(epochMs);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function todayKey() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateKey(value) {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

function getStatusGroup(status) {
  const s = String(status || '').trim();
  return Object.keys(STATUS_GROUPS).find(g => STATUS_GROUPS[g].includes(s)) || '其他';
}

function detectRisk(row) {
  const fields = [
    row.customer_type, row.industry, row.reason || '', row.products,
    row.description || '', row.risk_status || '', row.notes,
    row.status, row.invalid_reason || '',
  ].join(' ');
  const reasons = RISK_KEYWORDS.filter(k => fields.includes(k));
  return {
    isRisk: reasons.length > 0 || row.status === '风险过高',
    reasons: [...new Set(reasons)],
  };
}

const PLACEHOLDER_VALUES = new Set([
  '', '-', '—', 'n/a', 'na', 'none', 'null', 'unknown',
  '未找到', '未获取', '未知', '未查到', '未提供', '待确认', '未验证',
  'не указан', 'не указано', 'нет данных', 'не найдено',
]);

function cleanIncoming(value) {
  const text = String(value || '').trim();
  return PLACEHOLDER_VALUES.has(text.toLowerCase()) ? '' : text;
}

function isNoisyOpportunitySummary(value) {
  const text = cleanIncoming(value);
  if (!text) return true;
  return /now i have|let me compile|compile (the )?(final|complete) report|已有足够数据|开始编译|开始整理完整报告|尽调报告$/i.test(text)
    || /^[^|]{1,80}\s*\|\s*(https?:\/\/|[\w.-]+\.[a-z]{2,})\s*\|\s*评分/i.test(text);
}

function cleanOpportunitySummary(value, fallback) {
  const clean = cleanIncoming(value);
  if (!isNoisyOpportunitySummary(clean)) return clean;
  return cleanIncoming(fallback);
}

function appendUniqueNote(existing, line) {
  const cleanLine = cleanIncoming(line);
  const current = String(existing || '').trim();
  if (!cleanLine) return current;
  if (current.includes(cleanLine)) return current;
  return current ? `${current}\n${cleanLine}` : cleanLine;
}

function setIfPresent(updates, params, field, value, currentValue) {
  const cleanValue = cleanIncoming(value);
  if (!cleanValue) return;
  if (String(currentValue || '').trim() === cleanValue) return;
  updates.push(`${field} = ?`);
  params.push(cleanValue);
}

function domainFromWebsite(value) {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean) return '';
  const withoutProto = clean.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return withoutProto.split('/')[0].split(':')[0];
}

function makeReconJobId() {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `RR-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function makeContactReconJobId() {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `CR-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function targetRolesForCustomer(row = {}, recon = {}) {
  const type = `${row.customer_type || ''} ${recon.customer_type || ''}`;
  const employees = Number(String(recon.employees || '').match(/\d+/)?.[0] || 0);
  if (/贸易|分销|平台/.test(type)) return ['采购负责人', '品类经理', '供应商开发经理', '产品经理', '商业总监'];
  if (employees && employees < 50) return ['总经理', '技术总监', '总工程师', '生产负责人'];
  if (employees && employees < 200) return ['采购主管', '供应负责人', '技术总监', '生产负责人'];
  if (employees >= 1000) return ['电子元器件品类采购', '采购总监', '供应链负责人', '进口替代负责人', '供应商开发经理'];
  return ['采购负责人', '供应链负责人', 'MTO负责人', '技术总监', '总工程师'];
}

function makeProspectTaskId() {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `PA-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function makeProspectCandidateId() {
  return `PC-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
}

function normalizeTagName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeTagCategory(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function seedPresetTags(db) {
  const now = nowText();
  const insert = db.prepare(`
    INSERT INTO tags (name, category, color, is_preset, created_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(category, name) DO UPDATE SET
      color = excluded.color,
      is_preset = 1
  `);
  TAG_PRESETS.forEach(([category, names, color]) => {
    names.forEach(name => insert.run(name, category, color, now));
  });
  migrateLegacyTagCategory(db, '风险属性', '需确认属性');
}

function migrateLegacyTagCategory(db, legacyCategory, targetCategory) {
  const legacyRows = db.prepare('SELECT id, name FROM tags WHERE category = ?').all(legacyCategory);
  if (!legacyRows.length) return;
  const targetByName = new Map(
    db.prepare('SELECT id, name FROM tags WHERE category = ?').all(targetCategory).map(row => [row.name, row.id])
  );
  const copyLinks = db.prepare(`
    INSERT OR IGNORE INTO customer_tags (customer_id, tag_id, created_at)
    SELECT customer_id, ?, created_at FROM customer_tags WHERE tag_id = ?
  `);
  const deleteLinks = db.prepare('DELETE FROM customer_tags WHERE tag_id = ?');
  const deleteTag = db.prepare('DELETE FROM tags WHERE id = ?');
  legacyRows.forEach(row => {
    const targetId = targetByName.get(row.name);
    if (targetId) copyLinks.run(targetId, row.id);
    deleteLinks.run(row.id);
    deleteTag.run(row.id);
  });
}

function sortTags(tags) {
  return tags.slice().sort((a, b) => {
    const ca = TAG_CATEGORY_ORDER.indexOf(a.category);
    const cb = TAG_CATEGORY_ORDER.indexOf(b.category);
    const ga = ca === -1 ? 999 : ca;
    const gb = cb === -1 ? 999 : cb;
    if (ga !== gb) return ga - gb;
    if (a.category !== b.category) return String(a.category).localeCompare(String(b.category), 'zh-CN');
    return String(a.name).localeCompare(String(b.name), 'zh-CN');
  });
}

function buildTag(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    color: row.color,
    isPreset: Boolean(row.is_preset),
    createdAt: row.created_at,
  };
}

function addTagMatch(matches, category, name) {
  if (!name) return;
  matches.add(`${category}\u0000${name}`);
}

function textHas(text, keywords) {
  const haystack = String(text || '').toLowerCase();
  return keywords.some(keyword => haystack.includes(String(keyword).toLowerCase()));
}

function inferTagsFromRecord(record = {}) {
  const matches = new Set();
  const typeText = [
    record.customer_type, record.customerType,
    record.raw_customer_type, record.rawCustomerType,
  ].join(' ');
  const industryText = [
    record.industry,
    record.raw_industry, record.rawIndustry,
    record.original_industry, record.originalIndustry,
  ].join(' ');
  const productText = [
    record.products, record.recommended_products, record.recommendedProducts,
    record.reason, record.description,
  ].join(' ');
  const reconText = [
    record.opportunity_summary, record.opportunitySummary,
    record.outreach_angle, record.outreachAngle,
    record.contacts_summary, record.contactsSummary,
    record.next_action, record.nextAction,
  ].join(' ');
  const allText = [
    record.company_name, record.companyName, record.russian_name, record.english_name,
    typeText, industryText, productText, reconText, record.notes, record.risk_status, record.status,
    record.invalid_reason,
  ].join(' ');

  const canonicalType = CUSTOMER_TYPE_OPTIONS.includes(String(record.customer_type || '').trim())
    ? String(record.customer_type || '').trim()
    : normalizeCustomerType(typeText, allText);
  const canonicalIndustry = INDUSTRY_OPTIONS.includes(String(record.industry || '').trim())
    ? String(record.industry || '').trim()
    : normalizeIndustry(industryText, allText);

  addTagMatch(matches, '客户类型', canonicalType);

  const businessRules = [
    ['电机', ['电机', '驱动器', '电力驱动', 'servo', 'привод']],
    ['无人机', ['无人机', 'uav', 'drone']],
    ['机床/CNC', ['机床', 'cnc', '数控', '主轴', '导轨', '滚珠丝杠', 'чпу', 'станк']],
    ['工业设备', ['工业设备', '工业自动化', '自动化设备', '设备制造']],
    ['通信设备', ['通信设备', '电信', '网络设备', '无线电', '通信系统']],
    ['医疗设备', ['医疗设备', '医疗电子', '超声', '呼吸机', '监护仪']],
    ['汽车电子', ['汽车电子', '车联网', '汽车', '电动车']],
    ['智能家居/IoT', ['智能家居', 'iot', '物联网']],
    ['机器人', ['机器人', 'robot']],
    ['激光/等离子设备', ['激光', '等离子', 'плазм']],
    ['暖通/制冷设备', ['暖通', '制冷', '通风', 'вентиляц', 'холодил']],
    ['包装设备', ['包装设备', '包装机', '包装线', 'упаков', 'фасов']],
    ['食品设备', ['食品设备', '食品', ' хлеб', 'пищ', 'кондитер']],
    ['输送设备', ['输送设备', '输送', 'conveyor', 'конвейер']],
    ['能源设备', ['能源设备', '电力能源', '充电站', '逆变器', '电站', 'электростанц', 'дизель']],
    ['电子设备', ['电子设备', '电子制造', '电子产品']],
    ['液压/气动设备', ['液压', '气动', 'гидравл', 'пневмат']],
    ['仪器仪表', ['仪器仪表', '测量', '计量', 'кипиа', 'измер']],
    ['焊接设备', ['焊接', 'свароч']],
    ['电气设备', ['电气设备', 'электротехническ']],
  ];
  businessRules.forEach(([name, keywords]) => {
    if (textHas(allText, keywords)) addTagMatch(matches, '客户经营产品', name);
  });

  const purchaseRules = [
    ['传感器', ['传感器', 'sensor']],
    ['MCU/微控制器', ['mcu', '微控制器', 'microcontroller']],
    ['功率器件', ['功率器件', '功率半导体', 'mosfet', 'igbt', '晶闸管', '二极管', '晶体管']],
    ['电源管理/电源模块', ['电源管理', '电源模块', 'dc-dc', '逆变器', 'ups', '电压转换']],
    ['PLC/控制器', ['plc', '控制器', '工业控制器', 'cnc控制器']],
    ['连接器', ['连接器', '互连']],
    ['通信模块/无线模块', ['通信模块', '无线通信', 'wifi', 'rs-485', 'modbus', '工业以太网']],
    ['被动元件', ['被动元件', '无源元件', '电容', '电阻', '电感']],
    ['FPGA/DSP/处理器', ['fpga', 'dsp', '处理器', 'cpu', 'soc']],
    ['射频/微波', ['射频', 'rf', '微波', 'mmic']],
    ['存储/内存', ['存储', '内存', 'ssd']],
    ['PCB/SMT', ['pcb', 'smt', '印刷电路板', '钢网', '锡膏']],
    ['LED/照明', ['led', '照明', '灯具']],
    ['仪器仪表/测量', ['仪器仪表', '测量', '计量', '分析设备']],
  ];
  purchaseRules.forEach(([name, keywords]) => {
    if (textHas([productText, reconText].join(' '), keywords)) addTagMatch(matches, '需求/采购产品', name);
  });

  addTagMatch(matches, '应用行业', canonicalIndustry);

  const sceneRules = [
    ['电机控制', ['电机控制', '电机驱动', '伺服', '变频器']],
    ['伺服/变频', ['伺服', '变频']],
    ['无人机', ['无人机', 'uav', 'drone']],
    ['航空电子', ['航空电子', '航空航天']],
    ['雷达/导航', ['雷达', '导航', 'glonass']],
    ['工业自动化', ['工业自动化', '自动化', 'scada', 'hmi']],
    ['医疗设备', ['医疗设备', '超声', '呼吸机', '监护仪']],
    ['汽车电子', ['汽车电子', '车联网']],
    ['智能家居', ['智能家居', 'iot', '物联网']],
    ['通信网络', ['通信网络', '网络设备', '通信系统']],
    ['机床/CNC', ['机床', 'cnc', '数控']],
  ];
  sceneRules.forEach(([name, keywords]) => {
    if (textHas(allText, keywords)) addTagMatch(matches, '重点场景', name);
  });

  if (textHas(allText, ['军工', '国防', '国防电子', '航空航天/国防电子'])) {
    addTagMatch(matches, '需确认属性', '军工');
  }
  if (canonicalType === '服务商/非目标' || canonicalIndustry === '非目标/其他') {
    addTagMatch(matches, '需确认属性', '非目标');
  }

  return Array.from(matches).map(value => {
    const [category, name] = value.split('\u0000');
    return { category, name };
  });
}

function autoTagCustomers(db) {
  const tagRows = db.prepare('SELECT id, category, name FROM tags WHERE is_preset = 1').all();
  const tagIdByKey = new Map(tagRows.map(row => [`${row.category}\u0000${row.name}`, row.id]));
  const existingRows = db.prepare(`
    SELECT DISTINCT ct.customer_id
    FROM customer_tags ct
    JOIN tags t ON t.id = ct.tag_id
    WHERE t.is_preset = 1
  `).all();
  const alreadyTagged = new Set(existingRows.map(row => row.customer_id));
  const records = new Map();

  db.prepare('SELECT * FROM customer_pool WHERE customer_id != ?').all('').forEach(row => records.set(row.customer_id, row));
  db.prepare('SELECT * FROM customers WHERE customer_id != ?').all('').forEach(row => {
    records.set(row.customer_id, { ...row, ...(records.get(row.customer_id) || {}) });
  });

  const insert = db.prepare('INSERT OR IGNORE INTO customer_tags (customer_id, tag_id, created_at) VALUES (?, ?, ?)');
  const now = nowText();
  let inserted = 0;
  const apply = db.transaction(() => {
    records.forEach((record, customerId) => {
      if (alreadyTagged.has(customerId)) return;
      inferTagsFromRecord(record).forEach(match => {
        const tagId = tagIdByKey.get(`${match.category}\u0000${match.name}`);
        if (!tagId) return;
        const result = insert.run(customerId, tagId, now);
        inserted += result.changes;
      });
    });
  });
  apply();
  return inserted;
}

function refreshAutoTagsForAll(db) {
  const tagRows = db.prepare('SELECT id, category, name, is_preset FROM tags').all();
  const presetRows = tagRows.filter(row => AUTO_TAG_CATEGORIES.has(row.category) && row.is_preset);
  const presetIds = presetRows.map(row => row.id);
  const tagIdByKey = new Map(presetRows.map(row => [`${row.category}\u0000${row.name}`, row.id]));
  const records = new Map();

  db.prepare('SELECT * FROM customer_pool WHERE customer_id != ?').all('').forEach(row => records.set(row.customer_id, row));
  db.prepare('SELECT * FROM customers WHERE customer_id != ?').all('').forEach(row => {
    records.set(row.customer_id, { ...row, ...(records.get(row.customer_id) || {}) });
  });

  const insert = db.prepare('INSERT OR IGNORE INTO customer_tags (customer_id, tag_id, created_at) VALUES (?, ?, ?)');
  const remove = presetIds.length
    ? db.prepare(`DELETE FROM customer_tags WHERE customer_id = ? AND tag_id IN (${presetIds.map(() => '?').join(',')})`)
    : null;
  const now = nowText();
  let inserted = 0;
  const apply = db.transaction(() => {
    records.forEach((record, customerId) => {
      if (remove) remove.run(customerId, ...presetIds);
      inferTagsFromRecord(record).forEach(match => {
        const tagId = tagIdByKey.get(`${match.category}\u0000${match.name}`);
        if (!tagId) return;
        const result = insert.run(customerId, tagId, now);
        inserted += result.changes;
      });
    });
  });
  apply();
  return inserted;
}

function refreshAutoTags() {
  const db = getDb();
  seedPresetTags(db);
  const inserted = refreshAutoTagsForAll(db);
  db.close();
  return inserted;
}

function syncAutoTagsForCustomer(db, customerId, record = {}) {
  const cleanCustomerId = String(customerId || '').trim();
  if (!cleanCustomerId) return [];

  const tagRows = db.prepare('SELECT id, category, name, is_preset FROM tags').all();
  const presetRows = tagRows.filter(row => AUTO_TAG_CATEGORIES.has(row.category) && row.is_preset);
  const presetIds = presetRows.map(row => row.id);
  const tagIdByKey = new Map(presetRows.map(row => [`${row.category}\u0000${row.name}`, row.id]));
  const desiredMatches = inferTagsFromRecord(record);
  const desiredIds = Array.from(new Set(
    desiredMatches
      .map(match => tagIdByKey.get(`${match.category}\u0000${match.name}`))
      .filter(Boolean)
  ));

  const now = nowText();
  const remove = db.prepare(
    `DELETE FROM customer_tags
     WHERE customer_id = ?
       AND tag_id IN (${presetIds.map(() => '?').join(',')})`
  );
  const insert = db.prepare('INSERT OR IGNORE INTO customer_tags (customer_id, tag_id, created_at) VALUES (?, ?, ?)');
  const apply = db.transaction(() => {
    if (presetIds.length) remove.run(cleanCustomerId, ...presetIds);
    desiredIds.forEach(tagId => insert.run(cleanCustomerId, tagId, now));
  });
  apply();
  return desiredMatches;
}

// --- initialize ---

ensureTables();

// --- read ---

function buildCustomer(row) {
  const risk = detectRisk(row);
  const nfd = dateKey(row.next_follow_date);
  const today = todayKey();
  return {
    rowNumber: 0,
    followId: row.follow_id,
    customerId: row.customer_id,
    companyName: row.company_name,
    website: row.website,
    customerType: row.customer_type,
    industry: row.industry,
    rating: row.rating,
    products: row.products,
    reason: row.reason,
    email: row.email,
    phone: row.phone,
    contact: row.contact,
    owner: row.owner,
    assignedDate: row.assigned_date,
    status: row.status || '未分配',
    firstContactDate: row.first_contact_date,
    lastFollowDate: row.last_follow_date,
    channel: row.channel,
    feedback: row.feedback,
    nextAction: row.next_action,
    nextFollowDate: row.next_follow_date,
    invalidReason: row.invalid_reason,
    notes: row.notes,
    statusGroup: getStatusGroup(row.status),
    nextFollowDateKey: nfd,
    isDueToday: nfd === today,
    isOverdue: Boolean(nfd && nfd < today),
    isRisk: risk.isRisk,
    riskReasons: risk.reasons,
  };
}

function normalizeSanctionStatus(row = {}) {
  const latestJobStatus = String(row.recon_job_status || '').trim().toLowerCase();
  const latestJobId = String(row.recon_job_id || '').trim();
  const resultJobId = String(row.recon_result_job_id || '').trim();
  if (latestJobId && (latestJobId !== resultJobId || latestJobStatus !== 'done')) return '未知';

  const reconCheckedAt = String(row.recon_sanction_checked_at || '').trim();
  const normalizedCheckedAt = String(row.normalized_sanction_checked_at || '').trim();
  let normalizedMatches = [];
  try { normalizedMatches = JSON.parse(row.sanction_check_matches_json || '[]'); } catch (_error) {}
  const hasNormalizedMatchEvidence = Array.isArray(normalizedMatches) && normalizedMatches.length > 0;
  const hasLegacySanctionEvidence = Boolean(
    String(row.recon_evidence_url || '').trim()
    || String(row.recon_sanction_source || '').trim()
  );

  const normalizedResult = String(row.sanction_check_result || '').trim().toLowerCase();
  if (normalizedResult === 'confirmed_match' && normalizedCheckedAt && hasNormalizedMatchEvidence) return '受制裁';
  if (normalizedResult === 'clear' && normalizedCheckedAt) return '未制裁';
  if (normalizedResult) return '未知';

  const sanctionStatus = String(row.recon_sanction_status || '').trim().toUpperCase();
  if (sanctionStatus === 'HIT' && reconCheckedAt && hasLegacySanctionEvidence) return '受制裁';
  if (sanctionStatus === 'CLEAR' && reconCheckedAt) return '未制裁';
  if (sanctionStatus) return '未知';

  const sanctioned = String(row.recon_sanctioned || '').trim().toLowerCase();
  const complianceStatus = String(row.recon_compliance_status || '').trim().toLowerCase();
  if (
    (['true', '1', 'yes', 'y', '是', '命中'].includes(sanctioned)
      || ['sanctioned', 'hit', 'confirmed_match'].includes(complianceStatus))
    && reconCheckedAt
    && hasLegacySanctionEvidence
  ) return '受制裁';
  if (['clear', 'passed', 'not_sanctioned'].includes(complianceStatus)
      && reconCheckedAt) return '未制裁';
  return '未知';
}

const CUSTOMER_POOL_PROFILE_SELECT = `
  SELECT p.*,
    rr.job_id AS recon_result_job_id,
    rr.sanctioned AS recon_sanctioned,
    rr.compliance_status AS recon_compliance_status,
    rr.sanction_status AS recon_sanction_status,
    rr.sanction_checked_at AS recon_sanction_checked_at,
    rr.sanction_source AS recon_sanction_source,
    rr.evidence_url AS recon_evidence_url,
    rr.updated_at AS recon_result_updated_at,
    rj.job_id AS recon_job_id,
    rj.status AS recon_job_status,
    sc.result AS sanction_check_result,
    sc.checked_at AS normalized_sanction_checked_at,
    sc.matches_json AS sanction_check_matches_json
  FROM customer_pool p
  LEFT JOIN recon_results rr ON rr.rowid = (
    SELECT latest_rr.rowid FROM recon_results latest_rr
    WHERE latest_rr.customer_id = p.customer_id
    ORDER BY latest_rr.updated_at DESC, latest_rr.rowid DESC LIMIT 1
  )
  LEFT JOIN recon_jobs rj ON rj.rowid = (
    SELECT latest_rj.rowid FROM recon_jobs latest_rj
    WHERE latest_rj.customer_id = p.customer_id
    ORDER BY latest_rj.updated_at DESC, latest_rj.rowid DESC LIMIT 1
  )
  LEFT JOIN sanction_checks sc ON sc.rowid = (
    SELECT latest_sc.rowid FROM sanction_checks latest_sc
    WHERE latest_sc.job_id = rr.job_id
    ORDER BY latest_sc.created_at DESC, latest_sc.rowid DESC LIMIT 1
  )
`;

function buildPoolCustomer(row) {
  const risk = detectRisk({ ...row, status: '' });
  return {
    customerId: row.customer_id,
    domain: row.domain,
    companyName: row.company_name,
    russianName: row.russian_name,
    englishName: row.english_name,
    country: row.country,
    city: row.city,
    website: row.website || row.domain,
    industry: row.industry,
    customerType: row.customer_type,
    description: row.description,
    products: row.products,
    rating: row.rating,
    currentPool: row.current_pool || '未分池',
    phone: row.phone,
    email: row.email,
    inn: row.inn,
    riskStatus: row.risk_status,
    sanctionStatus: normalizeSanctionStatus(row),
    websiteVerification: row.website_verification,
    contactCount: row.contact_count,
    deepReport: row.deep_report,
    sourceFile: row.source_file,
    firstFound: row.first_found,
    lastFound: row.last_found,
    searchCount: row.search_count,
    verified: row.verified,
    bestContactLevel: row.best_contact_level || 'L0',
    bestPersonId: row.best_person_id || '',
    salesReadyContactCount: Number(row.sales_ready_contact_count || 0),
    contactReconStatus: row.contact_recon_status || 'not_started',
    contactLastCheckedAt: row.contact_last_checked_at || '',
    contactNextAction: row.contact_next_action || '',
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isRisk: risk.isRisk,
    riskReasons: risk.reasons,
  };
}

function buildProspectTask(row = {}) {
  return {
    taskId: row.task_id,
    query: row.query,
    market: row.market,
    industryFocus: row.industry_focus,
    productFocus: row.product_focus,
    status: row.status,
    sourceMix: row.source_mix,
    candidateCount: Number(row.candidate_count || 0),
    promotedCount: Number(row.promoted_count || 0),
    reconCount: Number(row.recon_count || 0),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildProspectCandidate(row = {}) {
  return {
    candidateId: row.candidate_id,
    taskId: row.task_id,
    existingCustomerId: row.existing_customer_id,
    companyName: row.company_name,
    domain: row.domain,
    website: row.website,
    country: row.country,
    city: row.city,
    industry: row.industry,
    customerType: row.customer_type,
    description: row.description,
    products: row.products,
    needSignal: row.need_signal,
    sellSignal: row.sell_signal,
    contactSignal: row.contact_signal,
    decision: row.decision,
    score: Number(row.score || 0),
    status: row.status,
    sourceSummary: row.source_summary,
    promotedCustomerId: row.promoted_customer_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildProspectSource(row = {}) {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    taskId: row.task_id,
    sourceType: row.source_type,
    title: row.title,
    url: row.url,
    snippet: row.snippet,
    confidence: row.confidence,
    fetchedAt: row.fetched_at,
  };
}

function getTags(db) {
  return sortTags(db.prepare('SELECT * FROM tags ORDER BY category, name').all().map(buildTag));
}

function getCustomerTagMap(db) {
  const rows = db.prepare(`
    SELECT ct.customer_id, t.*
    FROM customer_tags ct
    JOIN tags t ON t.id = ct.tag_id
    ORDER BY t.category, t.name
  `).all();
  const map = {};
  rows.forEach(row => {
    if (!map[row.customer_id]) map[row.customer_id] = [];
    map[row.customer_id].push(buildTag(row));
  });
  Object.keys(map).forEach(customerId => {
    map[customerId] = sortTags(map[customerId]);
  });
  return map;
}

function attachTags(records, tagMap) {
  records.forEach(record => {
    record.tags = tagMap[record.customerId] || [];
  });
  return records;
}

function getTagsForCustomer(db, customerId) {
  const clean = String(customerId || '').trim();
  if (!clean) return [];
  const rows = db.prepare(`
    SELECT t.*
    FROM customer_tags ct
    JOIN tags t ON t.id = ct.tag_id
    WHERE ct.customer_id = ?
    ORDER BY t.category, t.name
  `).all(clean);
  return sortTags(rows.map(buildTag));
}

function applyCustomerTagDiff(db, customerId, desiredTagIds, actorId, timestamp = nowText()) {
  const desiredIds = new Set(desiredTagIds);
  const currentRows = db.prepare(`
    SELECT t.id,t.name,t.category
    FROM customer_tags ct
    JOIN tags t ON t.id=ct.tag_id
    WHERE ct.customer_id=?
    ORDER BY t.id
  `).all(customerId);
  const currentById = new Map(currentRows.map(row => [row.id, row]));
  const validRows = desiredTagIds.length
    ? db.prepare(`SELECT id,name,category FROM tags
        WHERE id IN (${desiredTagIds.map(() => '?').join(',')})`).all(...desiredTagIds)
    : [];
  if (validRows.length !== desiredTagIds.length) throw new Error('包含不存在的标签');
  const validById = new Map(validRows.map(row => [row.id, row]));
  const desiredRows = desiredTagIds.map(tagId => validById.get(tagId));
  const added = desiredRows.filter(row => !currentById.has(row.id));
  const removed = currentRows.filter(row => !desiredIds.has(row.id));
  const insertLink = db.prepare(
    'INSERT INTO customer_tags (customer_id,tag_id,created_at) VALUES (?,?,?)'
  );
  const deleteLink = db.prepare('DELETE FROM customer_tags WHERE customer_id=? AND tag_id=?');
  const insertHistory = db.prepare(`INSERT INTO customer_tag_history
    (customer_id,tag_id,tag_name,tag_category,action,actor_id,created_at)
    VALUES (?,?,?,?,?,?,?)`);
  for (const row of removed) {
    deleteLink.run(customerId, row.id);
    insertHistory.run(customerId, row.id, row.name, row.category, 'removed', actorId, timestamp);
  }
  for (const row of added) {
    insertLink.run(customerId, row.id, timestamp);
    insertHistory.run(customerId, row.id, row.name, row.category, 'added', actorId, timestamp);
  }
  if (added.length || removed.length) {
    db.prepare('UPDATE customer_pool SET updated_at=? WHERE customer_id=?')
      .run(timestamp, customerId);
  }
  return {
    added: added.map(row => row.id),
    removed: removed.map(row => row.id),
    unchanged: desiredRows.filter(row => currentById.has(row.id)).map(row => row.id),
  };
}

function syncCustomerTypeTag(db, input = {}) {
  const customerId = String(input.customerId || '').trim();
  const customerType = String(input.customerType || '').trim();
  if (!customerId) throw new Error('缺少客户ID');
  const rows = db.prepare(`
    SELECT t.id,t.name,t.category
    FROM customer_tags ct
    JOIN tags t ON t.id=ct.tag_id
    WHERE ct.customer_id=? AND t.category='客户类型' AND t.is_preset=1
  `).all(customerId);
  const desired = customerType
    ? db.prepare(`SELECT id,name,category FROM tags
        WHERE category='客户类型' AND name=? AND is_preset=1`).get(customerType)
    : null;
  if (customerType && !desired) throw new Error(`客户类型没有对应的预设标签：${customerType}`);
  const desiredIds = desired ? [desired.id] : [];
  const existingTypeIds = new Set(rows.map(row => row.id));
  const allCurrentIds = db.prepare('SELECT tag_id FROM customer_tags WHERE customer_id=?')
    .all(customerId).map(row => row.tag_id);
  const nextIds = allCurrentIds
    .filter(tagId => !existingTypeIds.has(tagId))
    .concat(desiredIds);
  const result = applyCustomerTagDiff(
    db,
    customerId,
    [...new Set(nextIds)],
    String(input.actorId || ''),
    input.timestamp || nowText(),
  );
  return {
    tagId: desired?.id || null,
    added: result.added,
    removed: result.removed,
  };
}

function getCustomerTagHistory(accessContext, customerId, options = {}) {
  const clean = String(customerId || '').trim();
  assertExternalCustomerAccess(accessContext, clean);
  const db = getDb();
  try {
    const requestedLimit = Number(options.limit || 200);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.trunc(requestedLimit), 500))
      : 200;
    return db.prepare(`SELECT id,customer_id customerId,tag_id tagId,tag_name tagName,
      tag_category tagCategory,action,actor_id actorId,created_at createdAt
      FROM customer_tag_history WHERE customer_id=?
      ORDER BY created_at DESC,id DESC LIMIT ?`).all(clean, limit);
  } finally { db.close(); }
}

function getStats(customers, customerPool, reconJobs) {
  const today = todayKey();
  const stats = {
    poolTotal: customerPool.length, total: customers.length,
    unassigned: 0, waiting: 0, contacted: 0, noReply: 0, interested: 0,
    quoted: 0, risk: 0, dueToday: 0, overdue: 0,
    byStatus: {}, byGroup: {}, byOwner: {}, byType: {}, byPool: {},
    reconQueued: 0, reconRunning: 0, reconDone: 0, reconFailed: 0,
  };
  Object.keys(STATUS_GROUPS).forEach(g => stats.byGroup[g] = 0);
  customerPool.forEach(c => {
    stats.byPool[c.currentPool || '未分池'] = (stats.byPool[c.currentPool || '未分池'] || 0) + 1;
  });
  customers.forEach(c => {
    stats.byStatus[c.status || '未填写'] = (stats.byStatus[c.status || '未填写'] || 0) + 1;
    stats.byGroup[c.statusGroup || '其他'] = (stats.byGroup[c.statusGroup || '其他'] || 0) + 1;
    stats.byOwner[c.owner || '未分配'] = (stats.byOwner[c.owner || '未分配'] || 0) + 1;
    stats.byType[c.customerType || '未填写'] = (stats.byType[c.customerType || '未填写'] || 0) + 1;
    if (!c.owner) stats.unassigned++;
    if (c.statusGroup === '待联系') stats.waiting++;
    if (c.statusGroup === '已联系') stats.contacted++;
    if (c.statusGroup === '暂无回复') stats.noReply++;
    if (c.statusGroup === '有兴趣/询价') stats.interested++;
    if (c.statusGroup === '已报价') stats.quoted++;
    if (c.isRisk) stats.risk++;
    if (c.nextFollowDateKey === today) stats.dueToday++;
    if (c.nextFollowDateKey && c.nextFollowDateKey < today) stats.overdue++;
  });
  reconJobs.forEach(j => {
    if (j.status === 'queued') stats.reconQueued++;
    if (j.status === 'running') stats.reconRunning++;
    if (j.status === 'done') stats.reconDone++;
    if (j.status === 'failed') stats.reconFailed++;
  });
  return stats;
}

function listProspectState(db, ownerId) {
  const cleanOwner = String(ownerId || '').trim();
  if (!cleanOwner) return { tasks: [], candidates: [], sources: [] };
  const tasks = db.prepare('SELECT * FROM prospect_tasks WHERE created_by=? ORDER BY updated_at DESC LIMIT 30').all(cleanOwner).map(buildProspectTask);
  const candidates = db.prepare(`SELECT pc.* FROM prospect_candidates pc JOIN prospect_tasks pt ON pt.task_id=pc.task_id
    WHERE pt.created_by=? ORDER BY pc.score DESC,pc.updated_at DESC LIMIT 200`).all(cleanOwner).map(buildProspectCandidate);
  const sources = db.prepare(`SELECT ps.* FROM prospect_sources ps JOIN prospect_tasks pt ON pt.task_id=ps.task_id
    WHERE pt.created_by=? ORDER BY ps.id DESC LIMIT 400`).all(cleanOwner).map(buildProspectSource);
  return { tasks, candidates, sources };
}

function getContactQualityStats(db) {
  const row = db.prepare(`
    SELECT
      COUNT(*) total_people,
      SUM(contact_level = 'L1') l1,
      SUM(contact_level = 'L2') l2,
      SUM(contact_level = 'L3') l3,
      SUM(sales_ready = 1) sales_ready,
      SUM(employment_status = 'verified_current') employment_verified
    FROM person_candidates
  `).get();
  const jobs = db.prepare(`
    SELECT
      SUM(status = 'queued') queued,
      SUM(status = 'running') running,
      SUM(status = 'done') done,
      SUM(status = 'failed') failed
    FROM contact_recon_jobs
  `).get();
  return {
    totalPeople: Number(row.total_people || 0), l1: Number(row.l1 || 0), l2: Number(row.l2 || 0), l3: Number(row.l3 || 0),
    salesReady: Number(row.sales_ready || 0), employmentVerified: Number(row.employment_verified || 0),
    queued: Number(jobs.queued || 0), running: Number(jobs.running || 0), done: Number(jobs.done || 0), failed: Number(jobs.failed || 0),
  };
}

function getInitialData(accessContext) {
  const db = getDb();
  try {
    const permissions = accessContext?.permissions || {};
    const allowedIds = [...(accessContext?.externalCustomerIds || [])];
    const placeholders = allowedIds.length ? allowedIds.map(() => '?').join(',') : "''";
    const scopeSql = `customer_id IN (${placeholders})`;
    const tagMap = getCustomerTagMap(db);
    const customers = permissions.view_customers
      ? attachTags(db.prepare(`SELECT * FROM customers WHERE ${scopeSql} ORDER BY follow_id`).all(...allowedIds).map(buildCustomer), tagMap)
      : [];
    let customerPool = permissions.view_pool
      ? attachTags(db.prepare(`${CUSTOMER_POOL_PROFILE_SELECT} WHERE p.${scopeSql}
          ORDER BY CAST(SUBSTR(p.customer_id, 4, 4) AS INTEGER) DESC`).all(...allowedIds).map(buildPoolCustomer), tagMap)
      : [];
    if (!permissions.view_contacts) customerPool = customerPool.map(contactSafePoolRecord);
    const tags = permissions.view_development ? getTags(db) : [];
    const templates = permissions.view_development
      ? db.prepare('SELECT * FROM templates ORDER BY id').all()
      : [];
    const reconJobs = permissions.view_recon
      ? db.prepare(`SELECT * FROM recon_jobs WHERE ${scopeSql} ORDER BY updated_at DESC`).all(...allowedIds)
      : [];
    let reconResults = permissions.view_recon
      ? db.prepare(`SELECT * FROM recon_results WHERE ${scopeSql} ORDER BY updated_at DESC`).all(...allowedIds)
      : [];
    if (!permissions.view_contacts) reconResults = reconResults.map(contactSafeReconRecord);
    const contactReconJobs = permissions.view_contacts
      ? db.prepare(`SELECT * FROM contact_recon_jobs WHERE ${scopeSql} ORDER BY updated_at DESC LIMIT 100`).all(...allowedIds)
      : [];
    const people = permissions.view_contacts
      ? db.prepare(`SELECT pc.*,
          (SELECT group_concat(cm.method_type || ':' || cm.value, ' / ')
           FROM contact_methods cm WHERE cm.person_id=pc.person_id) methods_summary
          FROM person_candidates pc WHERE pc.${scopeSql}
          ORDER BY sales_ready DESC, contact_level DESC, updated_at DESC LIMIT 500`).all(...allowedIds)
      : [];
    const contactQualityStats = permissions.view_contacts ? {
      totalPeople: people.length,
      l1: people.filter(row => row.contact_level === 'L1').length,
      l2: people.filter(row => row.contact_level === 'L2').length,
      l3: people.filter(row => row.contact_level === 'L3').length,
      salesReady: people.filter(row => row.sales_ready).length,
      employmentVerified: people.filter(row => row.employment_status === 'current').length,
      queued: contactReconJobs.filter(row => row.status === 'queued').length,
      running: contactReconJobs.filter(row => row.status === 'running').length,
      done: contactReconJobs.filter(row => row.status === 'done').length,
      failed: contactReconJobs.filter(row => row.status === 'failed').length,
    } : {};
    const prospect = permissions.use_prospect_agent
      ? listProspectState(db, accessContext?.user?.id)
      : { tasks: [], candidates: [], sources: [] };
    const stats = getStats(customers, customerPool, reconJobs);
    const payload = {
      ok: true, diagnostics: [],
      user: { email: accessContext?.user?.email || '', name: accessContext?.user?.name || '' },
      customers, customerPool, stats, templates,
      reconJobs, reconResults, tags,
      contactReconJobs, people, contactQualityStats,
      prospectTasks: prospect.tasks,
      prospectCandidates: prospect.candidates,
      prospectSources: prospect.sources,
      tagCategories: TAG_CATEGORY_ORDER,
      statusOptions: STATUS_OPTIONS,
      statusGroups: Object.keys(STATUS_GROUPS),
      updatedAt: nowText(),
    };
    return permissions.view_contacts ? payload : redactContactFields(payload);
  } finally {
    db.close();
  }
}

function profileEvaluationTags(db, externalCustomerId) {
  const rows = db.prepare(`SELECT e.ai_labels_json FROM crm_manager_evaluations e
    JOIN crm_accounts a ON a.id=e.customer_id
    WHERE a.external_customer_id=? AND e.subject_type='company' AND e.ai_status='completed'
    ORDER BY e.created_at DESC`).all(externalCustomerId);
  const labels = [];
  for (const row of rows) {
    let values = [];
    try { values = JSON.parse(row.ai_labels_json || '[]'); } catch (_error) {}
    for (const value of values) {
      const name = String(typeof value === 'string' ? value : value?.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!name || /@|https?:\/\/|www\./i.test(name) || (name.match(/\d/g) || []).length >= 7 || labels.includes(name)) continue;
      labels.push(name);
    }
  }
  return labels.map((name, index) => ({
    id: `ai-evaluation-${index + 1}`,
    name,
    category: 'AI评价标签',
    color: '#6f5499',
    readOnly: true,
  }));
}

function getCustomerProfileData(accessContext, customerId, options = {}) {
  const value = getDb();
  try {
    const cleanId = String(customerId || '').trim();
    if (!options.intakeReadOnly) assertExternalCustomerAccess(accessContext, cleanId);
    const permissions = accessContext?.permissions || {};
    const linkedAccount = value.prepare(`SELECT id FROM crm_accounts
      WHERE external_customer_id=? ORDER BY id LIMIT 1`).get(cleanId);
    const crmAccessible = Boolean(
      linkedAccount
      && permissions.view_customers
      && accessContext?.accountIds?.has(linkedAccount.id)
    );
    const poolRow = value.prepare(`${CUSTOMER_POOL_PROFILE_SELECT} WHERE p.customer_id=?`).get(cleanId);
    if (!poolRow) { const error = new Error('未找到对应客户资料'); error.statusCode = 404; throw error; }
    const tagMap = getCustomerTagMap(value);
    const includeProfileAI = options.includeAI !== false && !options.intakeReadOnly;
    const profileTags = [
      ...(tagMap[cleanId] || []),
      ...(includeProfileAI ? profileEvaluationTags(value, cleanId) : []),
    ];
    const pool = { ...buildPoolCustomer(poolRow), tags: profileTags };
    const customers = options.intakeReadOnly
      ? []
      : value.prepare('SELECT * FROM customers WHERE customer_id=? ORDER BY follow_id').all(cleanId)
        .map(row => ({ ...buildCustomer(row), tags: profileTags }));
    const reconJobs = permissions.view_recon
      ? value.prepare('SELECT * FROM recon_jobs WHERE customer_id=? ORDER BY updated_at DESC').all(cleanId)
      : [];
    let reconResults = permissions.view_recon
      ? value.prepare('SELECT * FROM recon_results WHERE customer_id=? ORDER BY updated_at DESC').all(cleanId)
      : [];
    if (!permissions.view_contacts) reconResults = reconResults.map(contactSafeReconRecord);
    const contactReconJobs = permissions.view_contacts
      ? value.prepare('SELECT * FROM contact_recon_jobs WHERE customer_id=? ORDER BY updated_at DESC LIMIT 100').all(cleanId)
      : [];
    const people = permissions.view_contacts
      ? value.prepare(`SELECT pc.*,
          (SELECT group_concat(cm.method_type || ':' || cm.value, ' / ') FROM contact_methods cm WHERE cm.person_id=pc.person_id) methods_summary
          FROM person_candidates pc WHERE pc.customer_id=?
          ORDER BY sales_ready DESC,contact_level DESC,updated_at DESC LIMIT 500`).all(cleanId)
      : [];
    const payload = {
      ok: true,
      diagnostics: [],
      user: { email: accessContext?.user?.email || '', name: accessContext?.user?.name || '' },
      customers,
      customerPool: [pool],
      stats: getStats(customers, [pool], reconJobs),
      templates: [],
      reconJobs,
      reconResults,
      tags: getTags(value),
      contactReconJobs,
      people,
      contactQualityStats: {},
      prospectTasks: [],
      prospectCandidates: [],
      prospectSources: [],
      tagCategories: includeProfileAI
        ? [...TAG_CATEGORY_ORDER, 'AI评价标签']
        : [...TAG_CATEGORY_ORDER],
      statusOptions: STATUS_OPTIONS,
      statusGroups: Object.keys(STATUS_GROUPS),
      profileAccess: options.intakeReadOnly
        ? {
          readOnly: true,
          source: 'intake',
          intakeItemId: String(options.intakeItemId || ''),
          inCrm: Boolean(linkedAccount),
          crmAccessible,
          status: linkedAccount ? (crmAccessible ? 'crm_accessible' : 'outside_scope') : 'not_in_crm',
        }
        : {
          readOnly: false,
          source: 'crm',
          inCrm: true,
          crmAccessible: true,
          status: 'crm_accessible',
        },
      updatedAt: nowText(),
    };
    return permissions.view_contacts ? payload : redactContactFields(payload);
  } finally {
    value.close();
  }
}

// --- write ---

function updateCustomer(followId, payload) {
  if (!followId) throw new Error('缺少跟进ID');
  const db = getDb();
  const existing = db.prepare('SELECT * FROM customers WHERE follow_id = ?').get(followId);
  if (!existing) { db.close(); throw new Error(`未找到跟进ID：${followId}`); }

  const allowed = {
    owner: 'owner', status: 'status', firstContactDate: 'first_contact_date',
    lastFollowDate: 'last_follow_date', channel: 'channel',
    feedback: 'feedback', nextAction: 'next_action',
    nextFollowDate: 'next_follow_date', invalidReason: 'invalid_reason',
    notes: 'notes',
  };

  const sets = [];
  const params = [];
  Object.keys(payload || {}).forEach(field => {
    if (!allowed[field]) return;
    let value = String(payload[field] || '').trim();
    if (field === 'status') {
      if (value && !STATUS_OPTIONS.includes(value)) throw new Error(`状态不在标准列表中：${value}`);
    }
    sets.push(`${allowed[field]} = ?`);
    params.push(value);
  });
  if (!sets.length) { db.close(); throw new Error('没有可更新字段'); }
  params.push(followId);
  db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE follow_id = ?`).run(...params);

  const row = db.prepare('SELECT * FROM customers WHERE follow_id = ?').get(followId);
  const customer = buildCustomer(row);
  customer.tags = getTagsForCustomer(db, customer.customerId);
  db.close();
  return {
    ok: true, message: '更新成功',
    customer,
    updatedAt: nowText(),
  };
}

function createTag(payload = {}) {
  const category = normalizeTagCategory(payload.category);
  const name = normalizeTagName(payload.name);
  const color = String(payload.color || '').trim() || '#475467';
  if (!category) throw new Error('缺少标签分类');
  if (!name) throw new Error('缺少标签名称');
  if (name.length > 60) throw new Error('标签名称不能超过 60 个字符');
  if (category.length > 40) throw new Error('标签分类不能超过 40 个字符');

  const db = getDb();
  const now = nowText();
  db.prepare(`
    INSERT INTO tags (name, category, color, is_preset, created_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(category, name) DO UPDATE SET
      color = CASE WHEN tags.is_preset = 1 THEN tags.color ELSE excluded.color END
  `).run(name, category, color, now);

  const tag = buildTag(db.prepare('SELECT * FROM tags WHERE category = ? AND name = ?').get(category, name));
  const tags = getTags(db);
  db.close();
  return { tag, tags, message: '标签已保存', updatedAt: nowText() };
}

function setCustomerTags(customerId, tagIds = [], options = {}) {
  const clean = String(customerId || '').trim();
  if (!clean) throw new Error('缺少客户ID');

  if (!Array.isArray(tagIds)) throw new Error('标签列表格式无效');
  const normalizedIds = tagIds.map(id => Number(id));
  if (normalizedIds.some(id => !Number.isInteger(id) || id <= 0)) throw new Error('包含无效的标签ID');
  const ids = Array.from(new Set(normalizedIds));
  if (ids.length > 100) throw new Error('每个客户最多设置 100 个标签');
  const db = getDb();
  try {
    const exists = db.prepare(`
      SELECT customer_id FROM customer_pool WHERE customer_id = ?
      UNION
      SELECT customer_id FROM customers WHERE customer_id = ?
    `).get(clean, clean);
    if (!exists) throw new Error(`未找到客户：${clean}`);
    const save = db.transaction(() => applyCustomerTagDiff(
      db, clean, ids, String(options.actorId || ''), nowText(),
    ));
    const diff = save.immediate();
    const tags = getTagsForCustomer(db, clean);
    const lifecycle = db.prepare('SELECT updated_at FROM customer_pool WHERE customer_id=?').get(clean);
    return {
      customerId: clean,
      tags,
      diff: { added: diff.added, removed: diff.removed, unchanged: diff.unchanged },
      message: '客户标签已保存',
      updatedAt: lifecycle?.updated_at || '',
    };
  } finally { db.close(); }
}

function removeCustomerTag(customerId, tagId, options = {}) {
  const clean = String(customerId || '').trim();
  const normalizedTagId = Number(tagId);
  if (!clean) throw new Error('缺少客户ID');
  if (!Number.isInteger(normalizedTagId) || normalizedTagId <= 0) throw new Error('标签ID无效');
  const db = getDb();
  try {
    const boundTag = db.prepare(`SELECT t.id,t.name,t.category,t.is_preset
      FROM customer_tags ct JOIN tags t ON t.id=ct.tag_id
      WHERE ct.customer_id=? AND t.id=?`).get(clean, normalizedTagId);
    if (!boundTag) throw new Error('客户未绑定该标签');
    const currentIds = db.prepare('SELECT tag_id FROM customer_tags WHERE customer_id=? ORDER BY tag_id')
      .all(clean).map(row => row.tag_id);
    const remove = db.transaction(() => applyCustomerTagDiff(
      db,
      clean,
      currentIds.filter(id => id !== normalizedTagId),
      String(options.actorId || ''),
      nowText(),
    ));
    const diff = remove.immediate();
    const lifecycle = db.prepare('SELECT updated_at FROM customer_pool WHERE customer_id=?').get(clean);
    return {
      customerId: clean,
      removedTagId: normalizedTagId,
      tags: getTagsForCustomer(db, clean),
      diff: { added: diff.added, removed: diff.removed, unchanged: diff.unchanged },
      message: '人工标签已移除',
      updatedAt: lifecycle?.updated_at || '',
    };
  } finally { db.close(); }
}

function createProspectTask(payload = {}, ownerId = '') {
  const query = cleanIncoming(payload.query);
  if (!query) throw new Error('缺少搜索目标');
  if (query.length > 1000) throw new Error('搜索目标不能超过 1000 字');
  const task = {
    task_id: makeProspectTaskId(),
    created_by: String(ownerId || '').trim(),
    query,
    market: cleanIncoming(payload.market) || '俄罗斯',
    industry_focus: cleanIncoming(payload.industryFocus || payload.industry_focus),
    product_focus: cleanIncoming(payload.productFocus || payload.product_focus),
    status: 'queued',
    source_mix: '',
    candidate_count: 0,
    promoted_count: 0,
    recon_count: 0,
    error: '',
    created_at: nowText(),
    updated_at: nowText(),
  };
  const db = getDb();
  db.prepare(`
    INSERT INTO prospect_tasks (
      task_id, created_by, query, market, industry_focus, product_focus, status, source_mix,
      candidate_count, promoted_count, recon_count, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...Object.values(task));
  const state = listProspectState(db, task.created_by);
  db.close();
  return { task: buildProspectTask(task), prospectState: state, message: '外贸智能体任务已创建' };
}

function getProspectTask(taskId, ownerId = '') {
  const clean = String(taskId || '').trim();
  if (!clean) throw new Error('缺少任务ID');
  const db = getDb();
  const task = db.prepare('SELECT * FROM prospect_tasks WHERE task_id = ? AND created_by = ?').get(clean, String(ownerId || '').trim());
  db.close();
  if (!task) { const error = new Error('无权访问该任务'); error.statusCode = 403; throw error; }
  return buildProspectTask(task);
}

function prospectTerms(text) {
  return Array.from(new Set(String(text || '')
    .split(/[\s,，;；、。|/()（）\[\]【】"'“”]+/)
    .map(item => item.trim())
    .filter(item => item.length >= 2 && !['客户', '公司', '俄罗斯', '外贸', '寻找', '查找', '采购', '联系'].includes(item))
  )).slice(0, 12);
}

function localProspectSearch(payload = {}, accessContext = {}) {
  const query = cleanIncoming(payload.query);
  const terms = prospectTerms([
    query,
    payload.market,
    payload.industryFocus || payload.industry_focus,
    payload.productFocus || payload.product_focus,
  ].filter(Boolean).join(' '));
  if (!terms.length) return [];
  const db = getDb();
  const likeTerms = terms.slice(0, 8).map(term => `%${term.replace(/[%_]/g, '\\$&')}%`);
  const poolClauses = likeTerms.map(() => `
    company_name LIKE ? ESCAPE '\\' OR russian_name LIKE ? ESCAPE '\\' OR english_name LIKE ? ESCAPE '\\'
    OR domain LIKE ? ESCAPE '\\' OR website LIKE ? ESCAPE '\\' OR industry LIKE ? ESCAPE '\\'
    OR customer_type LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR products LIKE ? ESCAPE '\\'
    OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\'
  `);
  const poolParams = [];
  likeTerms.forEach(term => { for (let i = 0; i < 12; i += 1) poolParams.push(term); });
  const allowedIds = [...(accessContext.externalCustomerIds || [])];
  const placeholders = allowedIds.length ? allowedIds.map(() => '?').join(',') : "''";
  const poolRows = accessContext.permissions?.view_pool && accessContext.permissions?.view_contacts ? db.prepare(`
    SELECT * FROM customer_pool
    WHERE customer_id IN (${placeholders}) AND (${poolClauses.map(c => `(${c})`).join(' OR ')})
    LIMIT 60
  `).all(...allowedIds, ...poolParams) : [];

  const reconClauses = likeTerms.map(() => `
    company_name LIKE ? ESCAPE '\\' OR website LIKE ? ESCAPE '\\' OR industry LIKE ? ESCAPE '\\'
    OR customer_type LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR opportunity_summary LIKE ? ESCAPE '\\'
    OR opportunity_do LIKE ? ESCAPE '\\' OR opportunity_need LIKE ? ESCAPE '\\'
    OR opportunity_sell LIKE ? ESCAPE '\\' OR contacts_summary LIKE ? ESCAPE '\\'
    OR outreach_angle LIKE ? ESCAPE '\\' OR next_action LIKE ? ESCAPE '\\'
  `);
  const reconParams = [];
  likeTerms.forEach(term => { for (let i = 0; i < 12; i += 1) reconParams.push(term); });
  const reconRows = accessContext.permissions?.view_recon && accessContext.permissions?.view_contacts ? db.prepare(`
    SELECT * FROM recon_results
    WHERE customer_id IN (${placeholders}) AND (${reconClauses.map(c => `(${c})`).join(' OR ')})
    LIMIT 60
  `).all(...allowedIds, ...reconParams) : [];
  db.close();

  const byDomainOrId = new Map();
  const add = (row, sourceType) => {
    const domain = domainFromWebsite(row.website || row.domain);
    const key = domain || row.customer_id || row.job_id || row.company_name;
    if (!key) return;
    const haystack = [
      row.company_name, row.russian_name, row.english_name, row.domain, row.website,
      row.industry, row.customer_type, row.description, row.products,
      row.opportunity_summary, row.opportunity_do, row.opportunity_need, row.opportunity_sell,
      row.contacts_summary, row.outreach_angle, row.next_action,
    ].join(' ').toLowerCase();
    const termHits = terms.filter(term => haystack.includes(term.toLowerCase())).length;
    const contactBoost = row.email || row.phone || row.contacts_summary ? 8 : 0;
    const reconBoost = sourceType === 'recon_result' ? 12 : 0;
    const score = Math.min(100, 34 + termHits * 9 + contactBoost + reconBoost);
    const existing = byDomainOrId.get(key);
    const merged = {
      existing_customer_id: row.customer_id || '',
      company_name: row.company_name || row.russian_name || row.english_name || '',
      domain,
      website: row.website || row.domain || '',
      country: row.country || '俄罗斯',
      city: row.city || '',
      industry: row.industry || '',
      customer_type: row.customer_type || '',
      description: row.description || row.opportunity_summary || row.opportunity_do || '',
      products: row.products || row.recommended_products || row.opportunity_sell || '',
      need_signal: row.opportunity_need || row.products || row.description || '',
      sell_signal: row.opportunity_sell || row.recommended_products || '',
      contact_signal: row.contacts_summary || [row.email, row.phone].filter(Boolean).join(' / '),
      decision: row.opportunity_decision || row.next_action || (score >= 70 ? '高匹配，建议优先复核' : '可作为候选，需补证据'),
      score,
      source_summary: sourceType === 'recon_result' ? '已有 Recon 结果命中' : '本地客户池命中',
      sources: [{
        source_type: sourceType,
        title: row.company_name || row.website || row.domain || 'CRM',
        url: row.evidence_url || row.website || row.domain || '',
        snippet: row.description || row.opportunity_summary || row.products || '',
        confidence: sourceType === 'recon_result' ? 'high' : 'medium',
      }],
    };
    if (!existing || merged.score > existing.score) byDomainOrId.set(key, merged);
    else existing.sources.push(...merged.sources);
  };
  poolRows.forEach(row => add(row, 'crm_pool'));
  reconRows.forEach(row => add(row, 'recon_result'));
  return Array.from(byDomainOrId.values()).sort((a, b) => b.score - a.score).slice(0, 50);
}

function saveProspectTaskResults(taskId, candidates = [], meta = {}, ownerId = '') {
  const cleanTaskId = String(taskId || '').trim();
  if (!cleanTaskId) throw new Error('缺少任务ID');
  const db = getDb();
  const task = db.prepare('SELECT * FROM prospect_tasks WHERE task_id = ? AND created_by = ?').get(cleanTaskId, String(ownerId || '').trim());
  if (!task) { db.close(); throw new Error(`未找到任务：${cleanTaskId}`); }
  const now = nowText();
  const insertCandidate = db.prepare(`
    INSERT INTO prospect_candidates (
      candidate_id, task_id, existing_customer_id, company_name, domain, website, country, city,
      industry, customer_type, description, products, need_signal, sell_signal, contact_signal,
      decision, score, status, source_summary, promoted_customer_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(candidate_id) DO UPDATE SET
      existing_customer_id = excluded.existing_customer_id,
      company_name = excluded.company_name,
      domain = excluded.domain,
      website = excluded.website,
      country = excluded.country,
      city = excluded.city,
      industry = excluded.industry,
      customer_type = excluded.customer_type,
      description = excluded.description,
      products = excluded.products,
      need_signal = excluded.need_signal,
      sell_signal = excluded.sell_signal,
      contact_signal = excluded.contact_signal,
      decision = excluded.decision,
      score = excluded.score,
      source_summary = excluded.source_summary,
      updated_at = excluded.updated_at
  `);
  const insertSource = db.prepare(`
    INSERT INTO prospect_sources (candidate_id, task_id, source_type, title, url, snippet, confidence, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const save = db.transaction(() => {
    db.prepare(`
      DELETE FROM prospect_sources
      WHERE task_id = ?
        AND candidate_id IN (
          SELECT candidate_id FROM prospect_candidates WHERE task_id = ? AND status = 'candidate'
        )
    `).run(cleanTaskId, cleanTaskId);
    db.prepare('DELETE FROM prospect_candidates WHERE task_id = ? AND status = ?').run(cleanTaskId, 'candidate');
    candidates.forEach(item => {
      const candidateId = item.candidate_id || item.candidateId || makeProspectCandidateId();
      const domain = domainFromWebsite(item.domain || item.website);
      const row = {
        candidate_id: candidateId,
        task_id: cleanTaskId,
        existing_customer_id: cleanIncoming(item.existing_customer_id || item.existingCustomerId),
        company_name: cleanIncoming(item.company_name || item.companyName) || domain,
        domain,
        website: cleanIncoming(item.website) || domain,
        country: cleanIncoming(item.country) || task.market || '俄罗斯',
        city: cleanIncoming(item.city),
        industry: normalizeIndustry(item.industry, [item.description, item.products, task.query].join(' ')),
        customer_type: normalizeCustomerType(item.customer_type || item.customerType, [item.description, item.products, task.query].join(' ')),
        description: cleanIncoming(item.description),
        products: cleanIncoming(item.products),
        need_signal: cleanIncoming(item.need_signal || item.needSignal),
        sell_signal: cleanIncoming(item.sell_signal || item.sellSignal),
        contact_signal: cleanIncoming(item.contact_signal || item.contactSignal),
        decision: cleanIncoming(item.decision),
        score: Math.max(0, Math.min(100, Number(item.score || 0) || 0)),
        status: cleanIncoming(item.status) || 'candidate',
        source_summary: cleanIncoming(item.source_summary || item.sourceSummary),
        promoted_customer_id: cleanIncoming(item.promoted_customer_id || item.promotedCustomerId),
        created_at: now,
        updated_at: now,
      };
      insertCandidate.run(...Object.values(row));
      (Array.isArray(item.sources) ? item.sources : []).slice(0, 8).forEach(source => {
        insertSource.run(
          candidateId,
          cleanTaskId,
          cleanIncoming(source.source_type || source.sourceType) || 'public_web',
          cleanIncoming(source.title),
          cleanIncoming(source.url),
          cleanIncoming(source.snippet),
          cleanIncoming(source.confidence) || 'medium',
          now,
        );
      });
    });
    const counts = db.prepare(`
      SELECT
        COUNT(*) AS candidate_count,
        SUM(CASE WHEN promoted_customer_id != '' THEN 1 ELSE 0 END) AS promoted_count
      FROM prospect_candidates WHERE task_id = ?
    `).get(cleanTaskId);
    db.prepare(`
      UPDATE prospect_tasks
      SET status = ?, source_mix = ?, candidate_count = ?, promoted_count = ?, error = ?, updated_at = ?
      WHERE task_id = ?
    `).run(
      meta.status || 'done',
      cleanIncoming(meta.sourceMix || meta.source_mix),
      Number(counts.candidate_count || 0),
      Number(counts.promoted_count || 0),
      cleanIncoming(meta.error),
      now,
      cleanTaskId,
    );
  });
  save();
  const state = listProspectState(db, ownerId);
  db.close();
  return { prospectState: state, message: candidates.length ? '外贸智能体候选已更新' : '未生成候选，请调整搜索目标' };
}

function markProspectTaskRunning(taskId, ownerId = '') {
  const clean = String(taskId || '').trim();
  if (!clean) throw new Error('缺少任务ID');
  const db = getDb();
  const now = nowText();
  const changed = db.prepare("UPDATE prospect_tasks SET status = 'running', error = '', updated_at = ? WHERE task_id = ? AND created_by = ?").run(now, clean, String(ownerId || '').trim());
  if (!changed.changes) { db.close(); const error = new Error('无权访问该任务'); error.statusCode = 403; throw error; }
  const state = listProspectState(db, ownerId);
  db.close();
  return { prospectState: state };
}

function markProspectTaskFailed(taskId, error, ownerId = '') {
  const clean = String(taskId || '').trim();
  if (!clean) throw new Error('缺少任务ID');
  const db = getDb();
  const now = nowText();
  db.prepare("UPDATE prospect_tasks SET status = 'failed', error = ?, updated_at = ? WHERE task_id = ? AND created_by = ?")
    .run(String(error || '').slice(0, 1000), now, clean, String(ownerId || '').trim());
  const state = listProspectState(db, ownerId);
  db.close();
  return { prospectState: state };
}

function promoteProspectCandidate(candidateId, options = {}) {
  const clean = String(candidateId || '').trim();
  if (!clean) throw new Error('缺少候选ID');
  const db = getDb();
  const candidate = db.prepare(`SELECT pc.* FROM prospect_candidates pc JOIN prospect_tasks pt ON pt.task_id=pc.task_id
    WHERE pc.candidate_id = ? AND pt.created_by = ?`).get(clean, String(options.ownerId || '').trim());
  if (!candidate) { db.close(); const error = new Error('无权访问该候选'); error.statusCode = 403; throw error; }
  let customerId = candidate.existing_customer_id || candidate.promoted_customer_id || '';
  if (customerId && options.accessContext) {
    try { assertExternalCustomerAccess(options.accessContext, customerId); }
    catch (error) { db.close(); throw error; }
  }
  const now = nowText();
  if (!customerId) {
    const domain = domainFromWebsite(candidate.website || candidate.domain);
    const existing = domain ? db.prepare('SELECT customer_id FROM customer_pool WHERE domain = ? OR website LIKE ? LIMIT 1').get(domain, `%${domain}%`) : null;
    if (existing?.customer_id) {
      customerId = existing.customer_id;
      if (options.accessContext) {
        try { assertExternalCustomerAccess(options.accessContext, customerId); }
        catch (error) { db.close(); throw error; }
      }
    } else {
      const usedIds = new Set(db.prepare('SELECT customer_id FROM customer_pool').all().map(row => row.customer_id));
      customerId = allocateCustomerId(usedIds, candidate.country || 'RU', {});
      db.prepare(`
        INSERT INTO customer_pool (
          customer_id, domain, company_name, country, city, website, industry, customer_type,
          description, products, current_pool, phone, email, website_verification, contact_count,
          source_file, first_found, last_found, search_count, verified, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '未分池', '', '', ?, ?, ?, ?, ?, '1', ?, ?)
      `).run(
        customerId,
        domain,
        candidate.company_name,
        candidate.country || '俄罗斯',
        candidate.city || '',
        candidate.website || domain,
        candidate.industry || '',
        candidate.customer_type || '',
        candidate.description || candidate.need_signal || '',
        candidate.products || candidate.sell_signal || '',
        candidate.website ? '候选官网待复核' : '',
        candidate.contact_signal ? '1' : '0',
        `prospect:${candidate.task_id}`,
        todayKey(),
        todayKey(),
        candidate.website ? '待复核' : '',
        appendUniqueNote(candidate.source_summary, candidate.decision),
      );
    }
  }
  db.prepare("UPDATE prospect_candidates SET promoted_customer_id = ?, status = 'promoted', updated_at = ? WHERE candidate_id = ?")
    .run(customerId, now, clean);
  db.prepare(`
    UPDATE prospect_tasks
    SET promoted_count = (SELECT COUNT(*) FROM prospect_candidates WHERE task_id = ? AND promoted_customer_id != ''),
        updated_at = ?
    WHERE task_id = ?
  `).run(candidate.task_id, now, candidate.task_id);
  const state = listProspectState(db, options.ownerId);
  db.close();
  const recon = options.createRecon ? createReconJob(customerId, 'pool') : null;
  return {
    customerId,
    recon,
    prospectState: state,
    message: options.createRecon ? '候选已入池并创建 Recon 任务' : '候选已加入客户池',
  };
}

function createReconJob(customerId, source, options = {}) {
  const clean = String(customerId || '').trim();
  if (!clean) throw new Error('缺少客户ID');

  const db = options.db || getDb();
  const ownsDb = !options.db;

  // find customer by multiple identifiers
  let customer = db.prepare('SELECT * FROM customers WHERE customer_id = ? OR follow_id = ?').get(clean, clean);
  if (!customer) customer = db.prepare('SELECT * FROM customer_pool WHERE customer_id = ? OR domain = ? OR website = ?').get(clean, clean, clean);
  if (!customer) { if (ownsDb) db.close(); throw new Error(`未找到客户：${clean}`); }

  const stableId = customer.customer_id || clean;

  // check for active job
  const active = db.prepare("SELECT * FROM recon_jobs WHERE customer_id = ? AND status IN ('queued','running') ORDER BY updated_at DESC LIMIT 1").get(stableId);
  if (active) {
    const result = {
      ok: true,
      message: `已有${({ queued: '排队中', running: '执行中' })[active.status] || active.status}任务`,
      job: active,
      reconState: reconState(db),
      created: false,
    };
    if (ownsDb) db.close();
    return result;
  }

  const now = nowText();
  const job = {
    job_id: makeReconJobId(),
    customer_id: stableId,
    follow_id: customer.follow_id || '',
    source: source === 'followup' ? 'followup' : 'pool',
    company_name: customer.company_name || '',
    website: customer.website || '',
    domain: customer.domain || '',
    inn: customer.inn || '',
    requested_by: String(options.requestedBy || 'local-crm'),
    requested_at: now,
    mode: 'single_customer_deep_recon',
    status: 'queued',
    started_at: '',
    finished_at: '',
    error: '',
    output_dir: '',
    updated_at: now,
  };

  const cols = Object.keys(job).join(', ');
  const placeholders = Object.keys(job).map(() => '?').join(', ');
  db.prepare(`INSERT INTO recon_jobs (${cols}) VALUES (${placeholders})`).run(...Object.values(job));

  const result = {
    ok: true,
    message: 'Russia-recon 任务已加入队列',
    job,
    reconState: reconState(db),
    created: true,
  };
  if (ownsDb) db.close();
  return result;
}

function retryReconJob(jobId) {
  const clean = String(jobId || '').trim();
  if (!clean) throw new Error('缺少任务ID');
  const db = getDb();
  const job = db.prepare('SELECT * FROM recon_jobs WHERE job_id = ?').get(clean);
  db.close();
  if (!job) throw new Error(`未找到任务：${clean}`);

  const customerRef = job.customer_id || job.follow_id || job.domain || job.website;
  if (!customerRef) throw new Error(`任务缺少可重试的客户标识：${clean}`);
  return createReconJob(customerRef, job.source || 'pool');
}

function reconState(db) {
  return {
    jobs: db.prepare('SELECT * FROM recon_jobs ORDER BY updated_at DESC').all(),
    results: db.prepare('SELECT * FROM recon_results ORDER BY updated_at DESC').all(),
  };
}

// --- recon worker ---

function listQueuedJobs(payload = {}) {
  const limit = Math.max(1, Math.min(Number(payload.limit || 5), 20));
  const staleMinutes = Math.max(10, Math.min(Number(payload.stale_minutes || 120), 1440));
  const db = getDb();
  const staleMs = staleMinutes * 60 * 1000;
  const now = Date.now();

  const jobs = db.prepare(`SELECT * FROM recon_jobs WHERE cancel_requested_at='' AND
    (status='queued' OR (status='running' AND updated_at < ?)) ORDER BY updated_at ASC LIMIT ?`)
    .all(new Date(now - staleMs).toISOString().replace('T', ' ').slice(0, 19), limit);
  db.close();
  return { jobs };
}

function claimReconJob(payload = {}) {
  const workerId = String(payload.worker_id || '').trim();
  if (!workerId) throw new Error('缺少 worker_id');
  const leaseSeconds = Math.max(60, Math.min(Number(payload.lease_seconds || 1800), 7200));
  const db = getDb();
  const claim = db.transaction(() => {
    const now = nowText();
    const job = db.prepare(`
      SELECT * FROM recon_jobs
      WHERE cancel_requested_at = '' AND (
        status = 'queued'
         OR (status = 'running' AND lease_expires_at != '' AND lease_expires_at < ?))
      ORDER BY updated_at ASC
      LIMIT 1
    `).get(now);
    if (!job) return null;
    const leaseUntil = timeTextAt(Date.now() + leaseSeconds * 1000);
    const changed = db.prepare(`
      UPDATE recon_jobs
      SET status = 'running', worker_id = ?, attempt_count = attempt_count + 1,
          started_at = CASE WHEN started_at = '' THEN ? ELSE started_at END,
          heartbeat_at = ?, lease_expires_at = ?, validation_error = '', error = '', updated_at = ?
      WHERE job_id = ? AND cancel_requested_at = ''
        AND (status = 'queued' OR (status = 'running' AND lease_expires_at < ?))
    `).run(workerId, now, now, leaseUntil, now, job.job_id, now);
    if (changed.changes !== 1) return null;
    return db.prepare('SELECT * FROM recon_jobs WHERE job_id = ?').get(job.job_id);
  });
  try {
    return { job: claim() };
  } finally {
    db.close();
  }
}

function heartbeatReconJob(payload = {}) {
  const jobId = String(payload.job_id || '').trim();
  const workerId = String(payload.worker_id || '').trim();
  if (!jobId || !workerId) throw new Error('缺少 job_id 或 worker_id');
  const leaseSeconds = Math.max(60, Math.min(Number(payload.lease_seconds || 1800), 7200));
  const db = getDb();
  try {
    const now = nowText();
    const job = db.prepare('SELECT * FROM recon_jobs WHERE job_id=? AND worker_id=?').get(jobId, workerId);
    if (job?.cancel_requested_at && job.status === 'running') {
      db.prepare(`UPDATE recon_jobs SET status='cancelled',cancelled_at=?,finished_at=?,
        lease_expires_at='',heartbeat_at=?,updated_at=?
        WHERE job_id=? AND worker_id=? AND status='running'`)
        .run(now, now, now, now, jobId, workerId);
      return { job_id: jobId, cancel_requested: true, cancelled_at: now };
    }
    const leaseUntil = timeTextAt(Date.now() + leaseSeconds * 1000);
    const outputDir = String(payload.output_dir || '').trim();
    const changed = db.prepare(`
      UPDATE recon_jobs SET heartbeat_at = ?, lease_expires_at = ?,
        output_dir = CASE WHEN ? != '' THEN ? ELSE output_dir END, updated_at = ?
      WHERE job_id = ? AND worker_id = ? AND status = 'running'
    `).run(now, leaseUntil, outputDir, outputDir, now, jobId, workerId);
    if (changed.changes !== 1) throw new Error('任务租约不存在或已转移');
    return { job_id: jobId, heartbeat_at: now, lease_expires_at: leaseUntil };
  } finally {
    db.close();
  }
}

function markJobRunning(payload = {}) {
  const jobId = String(payload.job_id || '').trim();
  if (!jobId) throw new Error('缺少 job_id');
  const db = getDb();
  const job = db.prepare('SELECT * FROM recon_jobs WHERE job_id = ?').get(jobId);
  if (!job) { db.close(); throw new Error(`未找到任务：${jobId}`); }
  if (job.status === 'done') { db.close(); throw new Error(`任务已完成：${jobId}`); }
  const now = nowText();
  db.prepare("UPDATE recon_jobs SET status = 'running', started_at = COALESCE(NULLIF(?, ''), started_at), output_dir = ?, error = '', updated_at = ? WHERE job_id = ?")
    .run(job.started_at || now, String(payload.output_dir || ''), now, jobId);
  const updated = db.prepare('SELECT * FROM recon_jobs WHERE job_id = ?').get(jobId);
  db.close();
  return { job: updated };
}

function markJobFailed(payload = {}) {
  const jobId = String(payload.job_id || '').trim();
  if (!jobId) throw new Error('缺少 job_id');
  const db = getDb();
  const job = db.prepare('SELECT * FROM recon_jobs WHERE job_id = ?').get(jobId);
  if (!job) { db.close(); throw new Error(`未找到任务：${jobId}`); }
  const now = nowText();
  db.prepare("UPDATE recon_jobs SET status = 'failed', finished_at = ?, error = ?, output_dir = ?, updated_at = ? WHERE job_id = ?")
    .run(now, String(payload.error || '').slice(0, 1500), String(payload.output_dir || '') || job.output_dir, now, jobId);
  const updated = db.prepare('SELECT * FROM recon_jobs WHERE job_id = ?').get(jobId);
  db.close();
  return { job: updated };
}

function enrichmentEventPayloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

function recordEnrichmentCompletionEvent(db, legacyTaskType, legacyTaskId, payload) {
  const installed = db.prepare(`SELECT 1 found FROM sqlite_master
    WHERE type='table' AND name='crm_ai_enrichment_events'`).get();
  if (!installed) return null;
  const link = db.prepare(`SELECT * FROM crm_ai_enrichment_node_links
    WHERE legacy_task_type=? AND legacy_task_id=?`).get(legacyTaskType, legacyTaskId);
  if (!link) return null;
  const eventKey = `${legacyTaskType}:${legacyTaskId}:completed:v1`;
  const payloadHash = enrichmentEventPayloadHash(payload);
  const existing = db.prepare('SELECT * FROM crm_ai_enrichment_events WHERE event_key=?').get(eventKey);
  if (existing) {
    if (existing.run_id !== link.run_id || existing.node_key !== link.node_key
        || existing.legacy_task_type !== legacyTaskType || existing.legacy_task_id !== legacyTaskId
        || existing.event_type !== 'completed' || existing.payload_hash !== payloadHash) {
      throw new Error('enrichment event collision');
    }
  } else {
    const at = nowText();
    db.prepare(`INSERT INTO crm_ai_enrichment_events
      (id,event_key,run_id,node_key,legacy_task_type,legacy_task_id,event_type,payload_hash,
       state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'completed',?,'pending',?,?)`).run(
      `AEE-${crypto.randomUUID()}`, eventKey, link.run_id, link.node_key,
      legacyTaskType, legacyTaskId, payloadHash, at, at,
    );
  }
  db.prepare(`UPDATE crm_ai_enrichment_node_links
    SET adapter_state='completed',completion_version=MAX(completion_version,1),updated_at=?
    WHERE id=?`).run(nowText(), link.id);
  return db.prepare('SELECT * FROM crm_ai_enrichment_events WHERE event_key=?').get(eventKey);
}

function submitReconResult(payload = {}, options = {}) {
  const jobId = String(payload.job_id || '').trim();
  if (!jobId) throw new Error('缺少 job_id');
  const db = options.db || getDb();
  const ownsDb = !options.db;
  const closeDb = () => { if (ownsDb) db.close(); };
  const job = db.prepare('SELECT * FROM recon_jobs WHERE job_id = ?').get(jobId);
  if (!job) { closeDb(); throw new Error(`未找到任务：${jobId}`); }

  const input = payload.result || {};
  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
  const validEvidence = evidence.filter(e => e && e.field_name);
  if (!validEvidence.length) { closeDb(); throw new Error('缺少证据记录'); }
  const resultV3 = payload.result_v3 && typeof payload.result_v3 === 'object' ? payload.result_v3 : null;
  if (resultV3) {
    const contractErrors = validateReconV3(resultV3, { jobId, customerId: job.customer_id });
    if (contractErrors.length) { closeDb(); throw new Error(`Recon V3校验失败：${contractErrors.join('；')}`); }
  }
  const metrics = evidenceMetrics(resultV3?.evidence || validEvidence);

  const sanctioned = ['true', '1', 'yes', 'y', '是', '命中'].includes(String(input.sanctioned || '').toLowerCase());
  const taxonomyContext = [
    input.customer_type, input.industry, input.recommended_products, input.products,
    input.opportunity_summary, input.summary, input.description, input.outreach_angle,
  ].join(' ');
  const ctype = normalizeCustomerType(input.customer_type, taxonomyContext);
  const industry = normalizeIndustry(input.industry, taxonomyContext);
  const result = {
    job_id: jobId,
    customer_id: job.customer_id,
    company_name: cleanIncoming(input.company_name) || cleanIncoming(job.company_name),
    website: cleanIncoming(input.website) || cleanIncoming(job.website),
    industry,
    customer_type: ctype,
    city: cleanIncoming(input.city),
    phone: cleanIncoming(input.phone),
    email: cleanIncoming(input.email),
    inn: cleanIncoming(input.inn),
    rating: cleanIncoming(input.rating),
    score: cleanIncoming(input.score),
    employees: cleanIncoming(input.employees),
    description: cleanIncoming(input.description),
    current_pool: cleanIncoming(input.current_pool),
    risk_status: cleanIncoming(input.risk_status),
    website_verification: cleanIncoming(input.website_verification),
    verified: cleanIncoming(input.verified),
    contact_count: cleanIncoming(input.contact_count),
    contact_name: cleanIncoming(input.contact_name),
    contact_title: cleanIncoming(input.contact_title),
    contact_classification: cleanIncoming(input.contact_classification),
    quality_status: cleanIncoming(input.quality_status),
    missing_steps: cleanIncoming(input.missing_steps),
    step5_status: cleanIncoming(input.step5_status),
    step5_plus_status: cleanIncoming(input.step5_plus_status),
    notes: cleanIncoming(input.notes),
    sanction_status: cleanIncoming(input.sanction_status),
    priority: cleanIncoming(input.priority),
    compliance_status: cleanIncoming(input.compliance_status) || (sanctioned ? 'sanctioned' : 'clear'),
    sanctioned: sanctioned ? 'true' : 'false',
    sanction_source: cleanIncoming(input.sanction_source),
    sanction_program: cleanIncoming(input.sanction_program),
    sanction_checked_at: cleanIncoming(input.sanction_checked_at || input.checked_at),
    evidence_url: cleanIncoming(input.evidence_url || input.sanction_evidence_url),
    opportunity_summary: cleanOpportunitySummary(input.opportunity_summary || input.summary, input.outreach_angle || input.next_action),
    opportunity_do: cleanIncoming(input.opportunity_do),
    opportunity_need: cleanIncoming(input.opportunity_need),
    opportunity_sell: cleanIncoming(input.opportunity_sell),
    opportunity_decision: cleanIncoming(input.opportunity_decision),
    contacts_summary: cleanIncoming(input.contacts_summary),
    recommended_products: cleanIncoming(input.recommended_products),
    outreach_angle: cleanIncoming(input.outreach_angle),
    next_action: cleanIncoming(input.next_action),
    evidence_count: String(validEvidence.length),
    schema_version: resultV3 ? '3.0' : cleanIncoming(payload.schema_version) || 'legacy',
    parser_mode: cleanIncoming(payload.parser_mode) || (resultV3 ? 'v3_envelope' : 'legacy'),
    result_json: resultV3 ? JSON.stringify(resultV3) : '',
    evidence_total_count: metrics.total,
    evidence_selected_count: metrics.selected,
    evidence_unique_source_count: metrics.uniqueSources,
    report_path: String(input.report_path || '').trim(),
    artifacts_json: typeof payload.artifacts === 'object' ? JSON.stringify(payload.artifacts) : (typeof input.artifacts === 'object' ? JSON.stringify(input.artifacts) : ''),
    updated_at: nowText(),
  };
  const previousResult = db.prepare('SELECT * FROM recon_results WHERE job_id=?').get(jobId);
  let previousResultV3 = null;
  try {
    previousResultV3 = JSON.parse(previousResult?.result_json || 'null');
  } catch (_error) {}
  const contactSnapshot = (record, v3) => JSON.stringify({
    contacts: Array.isArray(v3?.contacts) ? v3.contacts : [],
    contactsSummary: cleanIncoming(record?.contacts_summary),
    contactName: cleanIncoming(record?.contact_name),
    contactTitle: cleanIncoming(record?.contact_title),
    email: cleanIncoming(record?.email),
    phone: cleanIncoming(record?.phone),
  });
  const contactsChanged = contactSnapshot(previousResult, previousResultV3)
    !== contactSnapshot(result, resultV3);
  const grading = gradeReconResult(result, validEvidence);
  result.score = grading.score;
  result.rating = grading.rating;
  result.current_pool = grading.current_pool;
  result.priority = grading.priority;
  result.notes = appendUniqueNote(result.notes, grading.grading_note);
  if (!result.opportunity_decision) {
    result.opportunity_decision = `评分${grading.score}分，统一评级${grading.current_pool}池，建议${grading.current_pool === 'D' ? '暂不开发' : '复核后开发'}`;
  }

  try {
    db.exec('BEGIN IMMEDIATE');

  // upsert result
  const exist = db.prepare('SELECT job_id FROM recon_results WHERE job_id = ?').get(jobId);
  if (exist) {
    const cols = Object.keys(result);
    const sets = cols.map(c => `${c} = ?`).join(', ');
    db.prepare(`UPDATE recon_results SET ${sets} WHERE job_id = ?`).run(...Object.values(result), jobId);
  } else {
    const cols = Object.keys(result).join(', ');
    const ph = Object.keys(result).map(() => '?').join(', ');
    db.prepare(`INSERT INTO recon_results (${cols}) VALUES (${ph})`).run(...Object.values(result));
  }

  // insert evidence
  db.prepare('DELETE FROM recon_evidence WHERE job_id = ?').run(jobId);
  const insertEv = db.prepare("INSERT INTO recon_evidence (job_id, customer_id, field_name, value, source_url, source_title, checked_at, confidence, extractor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  validEvidence.forEach(e => {
    insertEv.run(
      jobId, job.customer_id,
      String(e.field_name || '').trim(),
      String(e.value || '').trim(),
      String(e.source_url || '').trim(),
      String(e.source_title || '').trim(),
      String(e.checked_at || nowText()).trim(),
      String(e.confidence || 'medium').trim(),
      String(e.extractor || 'local-worker').trim(),
    );
  });

  // sanction auto-evidence
  if (sanctioned && result.evidence_url && !validEvidence.some(e => e.field_name === 'sanctioned')) {
    insertEv.run(jobId, job.customer_id, 'sanctioned', 'true', result.evidence_url, result.sanction_source || 'sanctions source', result.sanction_checked_at || nowText(), 'high', 'local-worker');
  }
  const storedEvidence = db.prepare(`
    SELECT COUNT(*) total,
      COUNT(DISTINCT CASE WHEN trim(source_url) != '' THEN trim(source_url) END) unique_sources
    FROM recon_evidence WHERE job_id = ?
  `).get(jobId);
  result.evidence_count = String(storedEvidence.total);
  result.evidence_total_count = storedEvidence.total;
  result.evidence_unique_source_count = storedEvidence.unique_sources;
  db.prepare(`UPDATE recon_results SET evidence_count = ?, evidence_total_count = ?,
    evidence_selected_count = ?, evidence_unique_source_count = ? WHERE job_id = ?`)
    .run(result.evidence_count, storedEvidence.total, metrics.selected, storedEvidence.unique_sources, jobId);
  db.prepare(`INSERT INTO recon_submission_audit
    (job_id, customer_id, schema_version, parser_mode, evidence_total_count, validation_status, created_at)
    VALUES (?, ?, ?, ?, ?, 'accepted', ?)`)
    .run(jobId, job.customer_id, result.schema_version, result.parser_mode, storedEvidence.total, nowText());
  if (job.cancel_requested_at || job.status === 'cancelled') {
    const cancelledAt = nowText();
    const outputDir = String(payload.output_dir || '').trim() || job.output_dir;
    db.prepare(`UPDATE recon_jobs SET status='cancelled',cancel_requested_at=COALESCE(NULLIF(cancel_requested_at,''),?),
      cancelled_at=?,finished_at=?,lease_expires_at='',output_dir=?,updated_at=? WHERE job_id=?`)
      .run(cancelledAt, cancelledAt, cancelledAt, outputDir, cancelledAt, jobId);
    db.prepare(`UPDATE crm_ai_enrichment_node_links SET adapter_state='cancelled',
      cancel_requested_at=COALESCE(NULLIF(cancel_requested_at,''),?),updated_at=?
      WHERE legacy_task_type='recon' AND legacy_task_id=?`)
      .run(cancelledAt, cancelledAt, jobId);
    db.exec('COMMIT');
    closeDb();
    return {
      job: { ...job, status: 'cancelled', cancelled_at: cancelledAt, finished_at: cancelledAt },
      result,
      evidence_count: result.evidence_total_count,
      late_result: true,
    };
  }
  syncNormalizedRecon(db, job, resultV3);

  // --- auto-fill customer record from recon results ---
  const cid = job.customer_id;
  const prod = cleanIncoming(input.recommended_products || input.products);
  const summary = cleanOpportunitySummary(input.opportunity_summary || input.summary, input.outreach_angle || input.next_action);
  const contacts = cleanIncoming(input.contacts_summary);
  const score = cleanIncoming(input.score);
  const phoneNew = cleanIncoming(input.phone);
  const emailNew = cleanIncoming(input.email);
  const websiteNew = cleanIncoming(input.website) || cleanIncoming(job.website);
  const domainNew = domainFromWebsite(websiteNew) || cleanIncoming(job.domain);
  const city = cleanIncoming(input.city);
  const inn = cleanIncoming(input.inn);
  const rating = cleanIncoming(input.rating);
  const description = cleanIncoming(input.description);
  const russianName = cleanIncoming(input.russian_name);
  const englishName = cleanIncoming(input.english_name);
  const currentPool = cleanIncoming(input.current_pool);
  const riskStatus = cleanIncoming(input.risk_status);
  const websiteVerification = cleanIncoming(input.website_verification);
  const verified = cleanIncoming(input.verified);
  const contactCount = cleanIncoming(input.contact_count);
  const contactName = cleanIncoming(input.contact_name);
  const contactTitle = cleanIncoming(input.contact_title);
  const contactClassification = cleanIncoming(input.contact_classification);
  const qualityStatus = cleanIncoming(input.quality_status);
  const missingSteps = cleanIncoming(input.missing_steps);
  const nextAction = cleanIncoming(input.next_action);
  const contactLine = [contactName, contactTitle].filter(Boolean).join('｜') || contacts;
  const reconHeadline = cleanIncoming(summary || description);
  const reconNote = cleanIncoming(
    `[Recon ${jobId}${score ? ` ${score}分` : ''}] ${reconHeadline}`
  );
  const qualityNote = cleanIncoming(
    [qualityStatus ? `质量=${qualityStatus}` : '', missingSteps ? `缺失=${missingSteps}` : '', contactClassification ? `联系人=${contactClassification}` : '']
      .filter(Boolean)
      .join('；')
  );

  const setIfEmpty = (updates, params, field, value, emptyCheck) => {
    value = cleanIncoming(value);
    if (value && emptyCheck) {
      updates.push(field + ' = ?'); params.push(value);
    }
  };
  const appendIfNew = (updates, params, field, value, existing) => {
    value = cleanIncoming(value);
    if (value && !(existing || '').includes(value)) {
      updates.push(field + ' = ?'); params.push((existing || '') + '\n' + value);
    }
  };

  // Update customers table
  const cust = db.prepare('SELECT * FROM customers WHERE customer_id = ? OR follow_id = ?').get(cid, cid);
  if (cust) {
    const updates = [];
    const params = [];
    setIfPresent(updates, params, 'customer_type', ctype, cust.customer_type);
    setIfPresent(updates, params, 'industry', industry, cust.industry);
    setIfPresent(updates, params, 'website', websiteNew, cust.website);
    setIfPresent(updates, params, 'rating', rating, cust.rating);
    setIfPresent(updates, params, 'products', prod, cust.products);
    setIfPresent(updates, params, 'reason', summary || description, cust.reason);
    setIfPresent(updates, params, 'phone', phoneNew, cust.phone);
    setIfPresent(updates, params, 'email', emailNew, cust.email);
    setIfPresent(updates, params, 'contact', contactLine, cust.contact);
    setIfPresent(updates, params, 'next_action', nextAction, cust.next_action);

    const noteValue = appendUniqueNote(
      appendUniqueNote(cust.notes, reconNote),
      qualityNote,
    );
    if (sanctioned) {
      const sanctionLine = cleanIncoming(`[制裁机会信号] ${riskStatus || SANCTION_OPPORTUNITY_STATUS}`);
      const finalNote = appendUniqueNote(noteValue, sanctionLine);
      if (String(cust.notes || '').trim() !== finalNote) {
        updates.push('notes = ?'); params.push(finalNote);
      }
    } else if (String(cust.notes || '').trim() !== noteValue) {
      updates.push('notes = ?'); params.push(noteValue);
    }
    if (updates.length) {
      params.push(cust.follow_id);
      db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE follow_id = ?`).run(...params);
    }
  }

  // Update customer_pool table
  const pool = db.prepare('SELECT * FROM customer_pool WHERE customer_id = ?').get(cid);
  if (pool) {
    const updates = [];
    const params = [];
    setIfPresent(updates, params, 'customer_type', ctype, pool.customer_type);
    setIfPresent(updates, params, 'industry', industry, pool.industry);
    setIfPresent(updates, params, 'city', city, pool.city);
    setIfPresent(updates, params, 'inn', inn, pool.inn);
    setIfPresent(updates, params, 'russian_name', russianName, pool.russian_name);
    setIfPresent(updates, params, 'english_name', englishName, pool.english_name);
    setIfPresent(updates, params, 'website', websiteNew, pool.website);
    setIfPresent(updates, params, 'domain', domainNew, pool.domain);
    setIfPresent(updates, params, 'phone', phoneNew, pool.phone);
    setIfPresent(updates, params, 'email', emailNew, pool.email);
    setIfPresent(updates, params, 'description', description || summary, pool.description);
    setIfPresent(updates, params, 'deep_report', result.report_path, pool.deep_report);
    setIfPresent(updates, params, 'website_verification', websiteVerification, pool.website_verification);
    setIfPresent(updates, params, 'verified', verified, pool.verified);
    setIfPresent(updates, params, 'rating', rating, pool.rating);
    setIfPresent(updates, params, 'current_pool', currentPool, pool.current_pool === '未分池' ? '' : pool.current_pool);
    setIfPresent(updates, params, 'products', prod, pool.products);

    if (sanctioned) {
      setIfPresent(updates, params, 'risk_status', riskStatus || SANCTION_OPPORTUNITY_STATUS, pool.risk_status);
    } else {
      setIfPresent(updates, params, 'risk_status', riskStatus, pool.risk_status);
    }
    if (contactCount || contacts || contactName) {
      const targetCount = cleanIncoming(contactCount || (contactClassification === '未找到' ? '0' : '1'));
      setIfPresent(updates, params, 'contact_count', targetCount, pool.contact_count);
    }
    const poolNotes = appendUniqueNote(
      appendUniqueNote(pool.notes, reconNote),
      qualityNote,
    );
    if (String(pool.notes || '').trim() !== poolNotes) {
      updates.push('notes = ?'); params.push(poolNotes);
    }
    if (updates.length) {
      params.push(cid);
      db.prepare(`UPDATE customer_pool SET ${updates.join(', ')} WHERE customer_id = ?`).run(...params);
    }
  }

  const mergedPool = db.prepare('SELECT * FROM customer_pool WHERE customer_id = ?').get(cid) || {};
  const mergedCustomer = db.prepare('SELECT * FROM customers WHERE customer_id = ? OR follow_id = ?').get(cid, cid) || {};
  syncAutoTagsForCustomer(db, cid, {
    ...mergedPool,
    ...mergedCustomer,
    company_name: mergedPool.company_name || mergedCustomer.company_name || result.company_name,
    russian_name: mergedPool.russian_name || input.russian_name || '',
    english_name: mergedPool.english_name || input.english_name || '',
    customer_type: mergedPool.customer_type || mergedCustomer.customer_type || ctype,
    raw_customer_type: input.customer_type || '',
    industry: mergedPool.industry || mergedCustomer.industry || industry,
    raw_industry: input.industry || '',
    products: mergedPool.products || mergedCustomer.products || prod,
    recommended_products: result.recommended_products || prod,
    description: mergedPool.description || summary || description,
    reason: mergedCustomer.reason || summary || description,
    opportunity_summary: result.opportunity_summary || summary,
    outreach_angle: result.outreach_angle || '',
    contacts_summary: result.contacts_summary || '',
    next_action: result.next_action || '',
    notes: [summary, result.outreach_angle, result.contacts_summary, input.notes].filter(Boolean).join(' '),
    risk_status: mergedPool.risk_status || riskStatus,
    status: mergedCustomer.status || '',
    invalid_reason: mergedCustomer.invalid_reason || '',
  });

  // mark job done
  const now = nowText();
  const outputDir = String(payload.output_dir || '').trim() || job.output_dir;
  db.prepare("UPDATE recon_jobs SET status = 'done', finished_at = ?, error = '', output_dir = ?, updated_at = ? WHERE job_id = ?")
    .run(now, outputDir, now, jobId);
  recordEnrichmentCompletionEvent(db, 'recon', jobId, {
    result: payload.result || {},
    evidence: payload.evidence || [],
    result_v3: payload.result_v3 || null,
  });
  if (contactsChanged) {
    markContactReadinessStale(db, job.customer_id, 'recon_contact_changed');
  }

  db.exec('COMMIT');
  closeDb();
  return {
    job: { ...job, status: 'done', finished_at: now, output_dir: outputDir, updated_at: now },
    result,
    evidence_count: result.evidence_total_count,
  };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_rollbackError) {}
    closeDb();
    throw error;
  }
}

// --- contact recon ---

function createContactReconJob(customerId, options = {}) {
  const cleanId = String(customerId || '').trim();
  if (!cleanId) throw new Error('缺少 customer_id');
  const db = options.db || getDb();
  const ownsDb = !options.db;
  try {
    const customer = db.prepare('SELECT * FROM customer_pool WHERE customer_id = ?').get(cleanId);
    if (!customer) throw new Error(`未找到客户：${cleanId}`);
    const active = db.prepare("SELECT * FROM contact_recon_jobs WHERE customer_id = ? AND status IN ('queued','running') ORDER BY updated_at DESC LIMIT 1").get(cleanId);
    if (active) return { job: active, created: false, message: '该客户已有Contact Recon任务' };
    const recon = db.prepare('SELECT * FROM recon_results WHERE customer_id = ? ORDER BY updated_at DESC LIMIT 1').get(cleanId) || {};
    const targetRoles = Array.isArray(options.target_roles) && options.target_roles.length ? options.target_roles : targetRolesForCustomer(customer, recon);
    const now = nowText();
    const jobId = makeContactReconJobId();
    db.prepare(`INSERT INTO contact_recon_jobs
      (job_id, customer_id, company_name, website, inn, target_roles_json, status, stage, search_budget, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', 'queued', ?, ?, ?)`)
      .run(jobId, cleanId, customer.company_name, customer.website || customer.domain, customer.inn, JSON.stringify(targetRoles), Math.max(10, Math.min(Number(options.search_budget || 30), 100)), now, now);
    db.prepare("UPDATE customer_pool SET contact_recon_status = 'queued', contact_next_action = '等待联系人深挖' WHERE customer_id = ?").run(cleanId);
    return { job: db.prepare('SELECT * FROM contact_recon_jobs WHERE job_id = ?').get(jobId), created: true };
  } finally { if (ownsDb) db.close(); }
}

function claimContactReconJob(payload = {}) {
  const workerId = String(payload.worker_id || '').trim();
  if (!workerId) throw new Error('缺少 worker_id');
  const leaseSeconds = Math.max(300, Math.min(Number(payload.lease_seconds || 3600), 7200));
  const db = getDb();
  const claim = db.transaction(() => {
    const now = nowText();
    const job = db.prepare(`SELECT * FROM contact_recon_jobs
      WHERE cancel_requested_at='' AND (
        status = 'queued' OR (status = 'running' AND lease_expires_at != '' AND lease_expires_at < ?))
      ORDER BY updated_at LIMIT 1`).get(now);
    if (!job) return null;
    const leaseUntil = timeTextAt(Date.now() + leaseSeconds * 1000);
    const changed = db.prepare(`UPDATE contact_recon_jobs SET status='running', stage='researching', worker_id=?,
      attempt_count=attempt_count+1, heartbeat_at=?, lease_expires_at=?, failure_reason='', validation_error='', updated_at=?
      WHERE job_id=? AND cancel_requested_at=''
        AND (status='queued' OR (status='running' AND lease_expires_at < ?))`)
      .run(workerId, now, leaseUntil, now, job.job_id, now);
    if (changed.changes !== 1) return null;
    db.prepare("UPDATE customer_pool SET contact_recon_status='running', contact_next_action='正在寻找负责人' WHERE customer_id=?").run(job.customer_id);
    return db.prepare('SELECT * FROM contact_recon_jobs WHERE job_id=?').get(job.job_id);
  });
  try { return { job: claim() }; } finally { db.close(); }
}

function heartbeatContactReconJob(payload = {}) {
  const jobId = String(payload.job_id || '').trim();
  const workerId = String(payload.worker_id || '').trim();
  if (!jobId || !workerId) throw new Error('缺少 job_id 或 worker_id');
  const db = getDb();
  try {
    const now = nowText();
    const job = db.prepare('SELECT * FROM contact_recon_jobs WHERE job_id=? AND worker_id=?')
      .get(jobId, workerId);
    if (job?.cancel_requested_at && job.status === 'running') {
      db.prepare(`UPDATE contact_recon_jobs SET status='cancelled',stage='cancelled',cancelled_at=?,
        finished_at=?,lease_expires_at='',heartbeat_at=?,updated_at=?
        WHERE job_id=? AND worker_id=? AND status='running'`)
        .run(now, now, now, now, jobId, workerId);
      return { job_id: jobId, cancel_requested: true, cancelled_at: now };
    }
    const leaseUntil = timeTextAt(Date.now() + Math.max(300, Math.min(Number(payload.lease_seconds || 3600), 7200)) * 1000);
    const outputDir = String(payload.output_dir || '').trim();
    const changed = db.prepare(`UPDATE contact_recon_jobs SET heartbeat_at=?, lease_expires_at=?,
      output_dir=CASE WHEN ?!='' THEN ? ELSE output_dir END, stage=?, updated_at=?
      WHERE job_id=? AND worker_id=? AND status='running'`)
      .run(now, leaseUntil, outputDir, outputDir, String(payload.stage || 'researching'), now, jobId, workerId);
    if (changed.changes !== 1) throw new Error('Contact Recon任务租约不存在或已转移');
    return { job_id: jobId, heartbeat_at: now, lease_expires_at: leaseUntil };
  } finally { db.close(); }
}

function failContactReconJob(payload = {}) {
  const jobId = String(payload.job_id || '').trim();
  if (!jobId) throw new Error('缺少 job_id');
  const db = getDb();
  try {
    const job = db.prepare('SELECT * FROM contact_recon_jobs WHERE job_id=?').get(jobId);
    if (!job) throw new Error(`未找到任务：${jobId}`);
    const now = nowText();
    db.prepare("UPDATE contact_recon_jobs SET status='failed',stage='failed',failure_reason=?,output_dir=CASE WHEN ?!='' THEN ? ELSE output_dir END,finished_at=?,updated_at=? WHERE job_id=?")
      .run(String(payload.error || 'unknown').slice(0, 2000), String(payload.output_dir || ''), String(payload.output_dir || ''), now, now, jobId);
    db.prepare("UPDATE customer_pool SET contact_recon_status='failed', contact_next_action='检查失败原因后重试' WHERE customer_id=?").run(job.customer_id);
    return { job: db.prepare('SELECT * FROM contact_recon_jobs WHERE job_id=?').get(jobId) };
  } finally { db.close(); }
}

function submitContactReconResult(payload = {}, options = {}) {
  const jobId = String(payload.job_id || '').trim();
  const value = payload.result;
  if (!jobId) throw new Error('缺少 job_id');
  const db = options.db || getDb();
  const ownsDb = !options.db;
  const closeDb = () => { if (ownsDb) db.close(); };
  const job = db.prepare('SELECT * FROM contact_recon_jobs WHERE job_id=?').get(jobId);
  if (!job) { closeDb(); throw new Error(`未找到任务：${jobId}`); }
  const errors = validateContactRecon(value, { jobId, customerId: job.customer_id });
  if (errors.length) {
    db.prepare("UPDATE contact_recon_jobs SET validation_error=?,stage='validation_failed',updated_at=? WHERE job_id=?").run(errors.join('；').slice(0, 2000), nowText(), jobId);
    closeDb();
    throw new Error(`Contact Recon校验失败：${errors.join('；')}`);
  }
  const rawPeople = value.people || [];
  const personIdMap = new Map(rawPeople.map((person, index) => {
    const rawId = String(person.person_id || `P${index + 1}`);
    return [rawId, `${jobId}-${rawId}`];
  }));
  const evidence = (value.evidence || []).map(item => ({ ...item, person_id: personIdMap.get(String(item.person_id || '')) || '' }));
  const ratedPeople = rawPeople.map((person, index) => {
    const rawId = String(person.person_id || `P${index + 1}`);
    return ratePerson({ ...person, person_id: personIdMap.get(rawId) }, evidence);
  });
  const commit = db.transaction(() => {
    const now = nowText();
    const currentJob = db.prepare('SELECT * FROM contact_recon_jobs WHERE job_id=?').get(jobId);
    if (!currentJob) throw new Error(`未找到任务：${jobId}`);
    if (currentJob.cancel_requested_at || currentJob.status === 'cancelled') {
      db.prepare('DELETE FROM person_evidence WHERE contact_recon_job_id=?').run(jobId);
      const addLateEvidence = db.prepare(`INSERT INTO person_evidence
        (evidence_id,person_id,customer_id,contact_recon_job_id,evidence_type,field_name,value,
         source_url,source_title,source_date,checked_at,confidence,supports_current_employment,
         supports_decision_role)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      evidence.forEach(item => addLateEvidence.run(
        item.evidence_id, item.person_id || '', currentJob.customer_id, jobId,
        item.evidence_type || 'unknown', item.field_name || '', item.value || '',
        item.source_url, item.source_title || '', item.source_date || '',
        item.checked_at || now, item.confidence || 'medium',
        item.supports_current_employment ? 1 : 0, item.supports_decision_role ? 1 : 0,
      ));
      db.prepare(`UPDATE contact_recon_jobs SET status='cancelled',stage='cancelled',
        cancel_requested_at=COALESCE(NULLIF(cancel_requested_at,''),?),cancelled_at=?,finished_at=?,
        lease_expires_at='',result_json=?,updated_at=? WHERE job_id=?`)
        .run(now, now, now, JSON.stringify(value), now, jobId);
      db.prepare(`UPDATE crm_ai_enrichment_node_links SET adapter_state='cancelled',
        cancel_requested_at=COALESCE(NULLIF(cancel_requested_at,''),?),updated_at=?
        WHERE legacy_task_type='contact_recon' AND legacy_task_id=?`).run(now, now, jobId);
      db.prepare(`INSERT INTO contact_recon_audit
        (job_id,customer_id,person_count,l2_count,l3_count,validation_status,created_at)
        VALUES (?,?,0,0,0,'accepted',?)`).run(jobId, currentJob.customer_id, now);
      return { bestLevel: 'L0', l2: 0, l3: 0, personCount: 0, lateResult: true };
    }
    const oldPeople = db.prepare('SELECT person_id FROM person_candidates WHERE contact_recon_job_id=?').all(jobId).map(row => row.person_id);
    oldPeople.forEach(personId => db.prepare('DELETE FROM contact_methods WHERE person_id=?').run(personId));
    db.prepare('DELETE FROM person_candidates WHERE contact_recon_job_id=?').run(jobId);
    db.prepare('DELETE FROM person_evidence WHERE contact_recon_job_id=?').run(jobId);
    db.prepare('DELETE FROM company_entry_points WHERE contact_recon_job_id=?').run(jobId);
    const addPerson = db.prepare(`INSERT INTO person_candidates
      (person_id,customer_id,contact_recon_job_id,full_name,full_name_local,normalized_name,company_name,department,title,role_category,decision_role,
       employment_status,employment_confidence,contact_level,procurement_relevance,delivery_status,sales_ready,manual_review_required,quality_issues_json,first_found_at,last_verified_at,expires_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const addMethod = db.prepare(`INSERT OR REPLACE INTO contact_methods
      (contact_id,person_id,customer_id,method_type,value,normalized_value,status,discovery_type,verification_status,confidence,is_direct,is_generic,is_inferred,source_url,source_date,verified_at,last_verified_at,failure_reason)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    ratedPeople.forEach((person, personIndex) => {
      const personId = String(person.person_id || `${jobId}-P${personIndex + 1}`);
      const employment = person.employment || {};
      addPerson.run(personId, currentJob.customer_id, jobId, person.full_name || '', person.full_name_local || '', String(person.full_name || '').toLowerCase(), currentJob.company_name,
        person.department || '', person.title || '', person.role_category || 'unknown', person.decision_role || 'unknown', employment.status || 'unverified', Number(employment.confidence || 0),
        person.contact_level, person.procurement_relevance || 'P0', person.delivery_status || 'research_only', person.sales_ready ? 1 : 0, person.manual_review_required ? 1 : 0, JSON.stringify(person.quality_issues || []), now,
        person.last_verified_at || now, person.expires_at || '', now, now);
      person.methods.forEach((method, methodIndex) => addMethod.run(`${personId}-${method.type}-${methodIndex + 1}`, personId, currentJob.customer_id, method.type, method.value, method.normalized_value, method.verification_status,
        method.discovery_type, method.verification_status, Number(method.confidence || 0), method.is_direct ? 1 : 0, method.is_generic ? 1 : 0, method.is_inferred ? 1 : 0,
        method.source_url || '', method.source_date || '', method.verified_at || '', method.last_verified_at || '', method.failure_reason || ''));
    });
    const addEvidence = db.prepare(`INSERT INTO person_evidence
      (evidence_id,person_id,customer_id,contact_recon_job_id,evidence_type,field_name,value,source_url,source_title,source_date,checked_at,confidence,supports_current_employment,supports_decision_role)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    evidence.forEach(item => addEvidence.run(item.evidence_id, item.person_id || '', currentJob.customer_id, jobId, item.evidence_type || 'unknown', item.field_name || '', item.value || '', item.source_url,
      item.source_title || '', item.source_date || '', item.checked_at || now, item.confidence || 'medium', item.supports_current_employment ? 1 : 0, item.supports_decision_role ? 1 : 0));
    const addEntry = db.prepare(`INSERT OR IGNORE INTO company_entry_points
      (contact_recon_job_id,customer_id,method_type,value,discovery_type,verification_status,source_url,checked_at) VALUES (?,?,?,?,?,?,?,?)`);
    (value.company_entry_points || []).forEach(item => addEntry.run(jobId, currentJob.customer_id, item.type || '', item.value || '', item.discovery_type || 'company_generic', item.verification_status || 'unverified', item.source_url || '', item.checked_at || now));
    const rank = { L0: 0, L1: 1, L2: 2, L3: 3 };
    const best = ratedPeople.slice().sort((a, b) => rank[b.contact_level] - rank[a.contact_level])[0] || null;
    const entryCount = (value.company_entry_points || []).length;
    const bestLevel = best ? best.contact_level : (entryCount ? 'L1' : 'L0');
    const l2 = ratedPeople.filter(person => person.contact_level === 'L2').length;
    const l3 = ratedPeople.filter(person => person.contact_level === 'L3').length;
    const salesReady = ratedPeople.filter(person => person.sales_ready).length;
    const nextAction = salesReady ? '交给业务跟进' : l3 ? '已有真实入口人，继续获取采购/技术负责人' : l2 ? '人工验证推导联系方式' : bestLevel === 'L1' ? '继续深挖负责人' : '重新选择来源继续搜索';
    db.prepare(`UPDATE contact_recon_jobs SET status='done',stage='done',person_count=?,l2_count=?,l3_count=?,result_json=?,validation_error='',finished_at=?,updated_at=? WHERE job_id=?`)
      .run(ratedPeople.length, l2, l3, JSON.stringify({ ...value, people: ratedPeople }), now, now, jobId);
    db.prepare(`UPDATE customer_pool SET best_contact_level=?,best_person_id=?,sales_ready_contact_count=?,contact_recon_status='done',contact_last_checked_at=?,contact_next_action=? WHERE customer_id=?`)
      .run(bestLevel, best?.person_id || '', salesReady, now, nextAction, currentJob.customer_id);
    db.prepare(`INSERT INTO contact_recon_audit (job_id,customer_id,person_count,l2_count,l3_count,validation_status,created_at) VALUES (?,?,?,?,?,'accepted',?)`)
      .run(jobId, currentJob.customer_id, ratedPeople.length, l2, l3, now);
    recordEnrichmentCompletionEvent(db, 'contact_recon', jobId, {
      result: payload.result || {},
    });
    markContactReadinessStale(db, currentJob.customer_id, 'contact_recon_changed');
    return { bestLevel, l2, l3, personCount: ratedPeople.length };
  });
  try {
    if (typeof options.beforeCommit === 'function') options.beforeCommit();
    const summary = commit.immediate();
    return {
      job: db.prepare('SELECT * FROM contact_recon_jobs WHERE job_id=?').get(jobId),
      people: summary.lateResult ? [] : ratedPeople,
      summary,
      late_result: Boolean(summary.lateResult),
    };
  } finally { closeDb(); }
}

function getContactReconState(options = {}) {
  const db = getDb();
  try {
    const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));
    const allowedIds = [...(options.accessContext?.externalCustomerIds || [])];
    const placeholders = allowedIds.length ? allowedIds.map(() => '?').join(',') : "''";
    const jobs = db.prepare(`SELECT * FROM contact_recon_jobs WHERE customer_id IN (${placeholders})
      ORDER BY updated_at DESC LIMIT ?`).all(...allowedIds, limit);
    const people = db.prepare(`SELECT pc.*,
      (SELECT group_concat(cm.method_type || ':' || cm.value, ' / ') FROM contact_methods cm WHERE cm.person_id=pc.person_id) methods_summary
      FROM person_candidates pc WHERE pc.customer_id IN (${placeholders})
      ORDER BY sales_ready DESC, contact_level DESC, updated_at DESC LIMIT ?`).all(...allowedIds, limit);
    return {
      jobs,
      people,
      stats: {
        totalPeople: people.length,
        l1: people.filter(row => row.contact_level === 'L1').length,
        l2: people.filter(row => row.contact_level === 'L2').length,
        l3: people.filter(row => row.contact_level === 'L3').length,
        salesReady: people.filter(row => row.sales_ready).length,
        employmentVerified: people.filter(row => row.employment_status === 'current').length,
        queued: jobs.filter(row => row.status === 'queued').length,
        running: jobs.filter(row => row.status === 'running').length,
        done: jobs.filter(row => row.status === 'done').length,
        failed: jobs.filter(row => row.status === 'failed').length,
      },
    };
  } finally { db.close(); }
}

function getCustomerPeople(customerId) {
  const db = getDb();
  try {
    const people = db.prepare('SELECT * FROM person_candidates WHERE customer_id=? ORDER BY sales_ready DESC,contact_level DESC,updated_at DESC').all(customerId);
    return people.map(person => ({
      ...person,
      quality_issues: JSON.parse(person.quality_issues_json || '[]'),
      methods: db.prepare('SELECT * FROM contact_methods WHERE person_id=? ORDER BY is_direct DESC,verification_status').all(person.person_id),
      evidence: db.prepare('SELECT * FROM person_evidence WHERE person_id=? ORDER BY id').all(person.person_id),
    }));
  } finally { db.close(); }
}

module.exports = {
  ensureTables, ensureCustomerPoolLifecycle, getInitialData, getCustomerProfileData, getCustomerTagHistory,
  updateCustomer, createTag, setCustomerTags, removeCustomerTag, syncCustomerTypeTag, createReconJob,
  retryReconJob, listQueuedJobs, claimReconJob, heartbeatReconJob, markJobRunning, markJobFailed, submitReconResult,
  createProspectTask, getProspectTask, localProspectSearch, saveProspectTaskResults,
  markProspectTaskRunning, markProspectTaskFailed, promoteProspectCandidate,
  createContactReconJob, claimContactReconJob, heartbeatContactReconJob, failContactReconJob,
  submitContactReconResult, getContactReconState, getCustomerPeople,
  refreshAutoTags,
};
