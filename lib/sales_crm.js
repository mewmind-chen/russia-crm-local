const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { analyzeManagerEvaluation } = require('./sales_evaluation_ai');
const { allocateCustomerId, normalizeCountryPrefix } = require('./customer_ids');
const { getCustomerProfileData } = require('./db');
const {
  PERMISSION_DEFINITIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  permissionsFor,
  hasPermission,
  assertPermission,
  forbidden,
  assertPolicyAllowed,
  buildAccessContext,
  redactContactFields,
  contactSafePoolRecord,
  contactSafeReconRecord,
  policyForSalesRequest,
} = require('./access_control');
const {
  installPermissionGroups,
  hydrateUserPermissions,
  hydrateUsersPermissions,
  listPermissionGroups,
  createPermissionGroup,
  updatePermissionGroup,
  replaceUserOverrides,
  assertValidAdminRemains,
} = require('./permission_groups');
const {
  installImpersonationSchema,
  resolveSessionIdentity,
  startImpersonation,
  stopImpersonation,
  auditIdentity,
} = require('./impersonation');
const {
  installDataMaintenance,
  recoverInterruptedMaintenanceRuns,
  previewDataMaintenance,
  executeDataMaintenance,
  listMaintenanceRuns,
  maintenanceCapabilities,
} = require('./data_maintenance');
const { databasePath } = require('./runtime_paths');
const { registerAIStationRoutes, resolveAIStationsEnabled } = require('./ai_stations/routes');
const { resolveCustomerEnrichmentFlags } = require('./ai_stations/enrichment/flags');
const {
  featureState,
  resolveAIHardFlags,
} = require('./ai_stations/feature_flags');
const { enqueueSalesPack } = require('./ai_stations/sales_pack');
const { enqueueNextAction } = require('./ai_stations/next_action');
const {
  confirmActionProposal,
  prepareActionProposalConfirmation,
} = require('./ai_stations/action_proposal');
const {
  normalizeMinimalCustomerInput,
  createEnrichmentTrigger,
} = require('./ai_stations/enrichment/intake');
const { createEnrichmentEvidenceStore } = require('./ai_stations/enrichment/evidence');
const { findExactDuplicate } = require('./ai_stations/enrichment/dedupe');
const { markContactReadinessStale } = require('./ai_stations/contact_readiness');
const {
  ensureNotificationDeliveries,
  installNotificationDeliverySchema,
  markNotificationRead,
} = require('./crm_notifications');
const {
  STAGES,
  STAGE_INDEX,
  STAGE_LABELS,
  FOLLOW_UP_TERMINAL_STAGES,
  isValidStage,
  isFollowUpTerminalStage,
  isActivePipelineStage,
  hasReachedStage,
} = require('./customer_stages');
const { buildCustomerQuery, addStageLabels } = require('./customer_filters');
const {
  CUSTOMER_TYPE_OPTIONS,
  CUSTOMER_SOURCE_OPTIONS,
} = require('./taxonomy');
const {
  arbitrateIntakeOwner,
  authorizedSalesUser,
  authorizedSalesUsers,
  loadSalesMatchRecommendation,
} = require('./ai_stations/assignment_arbitration');

function anonymousSalesRoute(method, requestPath) {
  let route = String(requestPath || '').split('?')[0].replace(/^\/api\/sales-crm/, '') || '/';
  route = route.replace(/^\/accounts\/bulk-assign$/, '/accounts/bulk-assign')
    .replace(/^\/accounts\/recycle-bin$/, '/accounts/recycle-bin')
    .replace(/^\/accounts\/bulk-return$/, '/accounts/bulk-return')
    .replace(/^\/accounts\/[^/]+\/return$/, '/accounts/:customerId/return')
    .replace(/^\/accounts\/[^/]+\/trash$/, '/accounts/:customerId/trash')
    .replace(/^\/accounts\/[^/]+\/restore$/, '/accounts/:customerId/restore')
    .replace(/^\/accounts\/[^/]+\/reassign$/, '/accounts/:customerId/reassign')
    .replace(/^\/notifications\/[^/]+\/read$/, '/notifications/:notificationId/read')
    .replace(/^\/accounts\/[^/]+$/, '/accounts/:customerId')
    .replace(/^\/profile\/[^/]+$/, '/profile/:customerId')
    .replace(/^\/permission-groups\/[^/]+$/, '/permission-groups/:groupId')
    .replace(/^\/users\/[^/]+\/password-reset$/, '/users/:userId/password-reset')
    .replace(/^\/users\/[^/]+\/archive$/, '/users/:userId/archive')
    .replace(/^\/users\/[^/]+\/restore$/, '/users/:userId/restore')
    .replace(/^\/users\/[^/]+\/permission-overrides$/, '/users/:userId/permission-overrides')
    .replace(/^\/users\/[^/]+$/, '/users/:userId')
    .replace(/^\/migration-review\/[^/]+$/, '/migration-review/:reviewId')
    .replace(/^\/evaluations\/[^/]+\/retry$/, '/evaluations/:evaluationId/retry')
    .replace(/^\/ai\/customers\/[^/]+\/results$/, '/ai/customers/:customerId/results')
    .replace(/^\/ai\/customers\/[^/]+\/enrichment$/, '/ai/customers/:customerId/enrichment')
    .replace(/^\/ai\/customers\/[^/]+\/enrichment\/run$/, '/ai/customers/:customerId/enrichment/run')
    .replace(/^\/ai\/customers\/[^/]+\/stations\/customer_fit\/run$/, '/ai/customers/:customerId/stations/customer_fit/run')
    .replace(/^\/ai\/customers\/[^/]+\/stations\/sales_pack\/run$/, '/ai/customers/:customerId/stations/sales_pack/run')
    .replace(/^\/ai\/customers\/[^/]+\/action-proposals$/, '/ai/customers/:customerId/action-proposals')
    .replace(/^\/ai\/features\/[^/]+$/, '/ai/features/:featureKey')
    .replace(/^\/ai\/tasks\/[^/]+$/, '/ai/tasks/:taskId')
    .replace(/^\/ai\/jobs\/[^/]+\/retry$/, '/ai/jobs/:jobId/retry')
    .replace(/^\/ai\/jobs\/[^/]+\/cancel$/, '/ai/jobs/:jobId/cancel')
    .replace(/^\/ai\/jobs\/[^/]+\/review$/, '/ai/jobs/:jobId/review')
    .replace(/^\/ai\/enrichment\/[^/]+\/cancel$/, '/ai/enrichment/:runId/cancel')
    .replace(/^\/ai\/proposals\/[^/]+\/review$/, '/ai/proposals/:proposalId/review')
    .replace(/^\/ai\/budgets\/[^/]+\/[^/]+$/, '/ai/budgets/:scopeType/:scopeId');
  return `${String(method || '').toUpperCase()} ${route}`;
}

const ACTIVITY_STAGE = {
  email: 'contacted',
  call: 'contacted',
  social: 'connected',
  reply: 'replied',
  meeting: 'meeting',
  manager_join: 'manager',
  rfq: 'rfq',
  quote: 'quoted',
  negotiation: 'negotiating',
  order: 'won',
  repeat_order: 'repeat',
  lost: 'lost',
};

function db() {
  const dbPath = databasePath();
  require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
  const value = new Database(dbPath);
  value.function('crm_search_fold', { deterministic: true }, input => String(input ?? '').toLowerCase());
  value.pragma('journal_mode = WAL');
  value.pragma('foreign_keys = ON');
  return value;
}

function nowText(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function dateOffset(days, hours = 0) {
  return nowText(new Date(Date.now() + days * 86400000 + hours * 3600000));
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function json(value, fallback = []) {
  try { return JSON.parse(value || 'null') ?? fallback; } catch (_e) { return fallback; }
}

function hasTable(value, name) {
  return Boolean(value.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function parseJsonObject(value) {
  const parsed = json(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function serializeArbitrationDecision(decision = {}) {
  return {
    disposition: decision.disposition || '',
    assignable: Boolean(decision.assignable),
    managerReview: Boolean(decision.managerReview),
    userId: decision.userId || '',
    suggestedUserId: decision.suggestedUserId || '',
    deterministicUserId: decision.deterministicUserId || '',
    aiUserId: decision.aiUserId || '',
    source: decision.source || '',
    reasonCode: decision.reasonCode || '',
    reason: decision.reason || '',
    aiConfidence: Number(decision.aiConfidence || 0),
  };
}

function withoutArbitrationAI(decision = {}, fallbackReason = '') {
  const disposition = String(decision.disposition || '');
  const source = String(decision.source || '');
  const reasonCode = String(decision.reasonCode || '');
  const reason = String(decision.reason || fallbackReason || '');
  const aiInfluenced = /ai|ranking/i.test(`${source} ${reasonCode} ${reason}`);
  const safeReason = {
    blocked: '规则阻止当前自动分配',
    manager_review: '当前记录需要人工复核',
    assign: '按确定性规则与当前负荷分配',
  }[disposition] || '等待规则与人工确认';
  const deterministicUserId = String(decision.deterministicUserId || decision.userId || '');
  return {
    disposition,
    assignable: Boolean(decision.assignable),
    managerReview: Boolean(decision.managerReview),
    userId: deterministicUserId,
    suggestedUserId: deterministicUserId,
    deterministicUserId,
    source: aiInfluenced ? 'deterministic_rules' : source,
    reasonCode: aiInfluenced ? (disposition === 'manager_review' ? 'manual_review_required' : 'deterministic_fallback') : reasonCode,
    reason: aiInfluenced ? safeReason : (reason || safeReason),
  };
}

function serializeRecommendation(recommendation = {}) {
  return {
    available: Boolean(recommendation.available),
    reasonCode: recommendation.reasonCode || '',
    resultId: recommendation.resultId || '',
    jobId: recommendation.jobId || '',
    snapshotId: recommendation.snapshotId || '',
    confidence: Number(recommendation.confidence || 0),
    reviewRequired: Boolean(recommendation.reviewRequired),
    rankedCandidates: Array.isArray(recommendation.rankedCandidates)
      ? recommendation.rankedCandidates.map(candidate => ({
        userId: candidate.userId || '',
        score: Number(candidate.score || 0),
        reasons: Array.isArray(candidate.reasons) ? candidate.reasons.slice(0, 8) : [],
      }))
      : [],
  };
}

function recordIntakeDecision(value, intakeItemId, input = {}) {
  if (!hasTable(value, 'crm_intake_decisions') || !intakeItemId) return;
  const previous = value.prepare(`SELECT ai_recommendation_json,rule_decision_json,candidate_snapshot_id
    FROM crm_intake_decisions WHERE intake_item_id=? ORDER BY created_at DESC,id DESC LIMIT 1`).get(intakeItemId);
  const aiRecommendation = input.aiRecommendation || parseJsonObject(previous?.ai_recommendation_json);
  const ruleDecision = input.ruleDecision || parseJsonObject(previous?.rule_decision_json);
  const manualDecision = input.manualDecision || {};
  value.prepare(`INSERT INTO crm_intake_decisions
    (id,intake_item_id,decision_type,actor_id,candidate_snapshot_id,ai_recommendation_json,rule_decision_json,manual_decision_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id('INTDEC'),
    intakeItemId,
    input.decisionType || 'arbitration',
    input.actorId || '',
    input.candidateSnapshotId || previous?.candidate_snapshot_id || aiRecommendation.snapshotId || '',
    JSON.stringify(aiRecommendation),
    JSON.stringify(ruleDecision),
    JSON.stringify(manualDecision),
    nowText(),
  );
}

function redactAuditPayload(value) {
  if (Array.isArray(value)) return value.map(redactAuditPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /password|token|secret|credential|authorization|cookie|previewId|confirmationText/i.test(key) ? '[REDACTED]' : redactAuditPayload(item),
  ]));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function safeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: Boolean(row.active),
    archived: Boolean(row.archived_at),
    archivedAt: row.archived_at || '',
    mustChangePassword: Boolean(row.must_change_password),
    languages: json(row.languages_json),
    countries: json(row.countries_json),
    channels: json(row.channels_json),
    permissions: permissionsFor(row),
    permissionGroupId: row.permission_group_id || '',
    permissionGroupName: row.permission_group_name || '',
    permissionOverrides: row.permissionOverrides || {},
    permissionOverrideCount: Object.keys(row.permissionOverrides || {}).length,
    createdAt: row.created_at,
  };
}

function httpError(statusCode, message, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

const badRequest = message => httpError(400, message);
const notFound = message => httpError(404, message);
const conflictError = (message, code = '') => httpError(409, message, code);

function installSalesCrm() {
  const value = db();
  try {
    value.exec(`
      CREATE TABLE IF NOT EXISTS sales_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','manager','sales')),
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        languages_json TEXT NOT NULL DEFAULT '[]',
        countries_json TEXT NOT NULL DEFAULT '[]',
        channels_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sales_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES sales_users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS crm_accounts (
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
        lifecycle_status TEXT NOT NULL DEFAULT 'active',
        recycle_kind TEXT NOT NULL DEFAULT '',
        recycle_reason TEXT NOT NULL DEFAULT '',
        recycled_by TEXT NOT NULL DEFAULT '',
        recycled_at TEXT NOT NULL DEFAULT '',
        previous_owner_id TEXT NOT NULL DEFAULT '',
        is_test_data INTEGER NOT NULL DEFAULT 0,
        test_run_id TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(owner_id) REFERENCES sales_users(id)
      );
      CREATE INDEX IF NOT EXISTS crm_accounts_owner_idx ON crm_accounts(owner_id);
      CREATE INDEX IF NOT EXISTS crm_accounts_stage_idx ON crm_accounts(stage);
      CREATE INDEX IF NOT EXISTS crm_accounts_country_idx ON crm_accounts(country);
      CREATE UNIQUE INDEX IF NOT EXISTS crm_accounts_external_unique_idx
        ON crm_accounts(external_customer_id) WHERE external_customer_id!='';
      CREATE TABLE IF NOT EXISTS crm_activities (
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
        is_test_data INTEGER NOT NULL DEFAULT 0,
        test_run_id TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES sales_users(id)
      );
      CREATE INDEX IF NOT EXISTS crm_activities_customer_idx ON crm_activities(customer_id,occurred_at DESC);
      CREATE TABLE IF NOT EXISTS crm_rfqs (
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
        created_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS crm_quotes (
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
        created_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS crm_orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        quote_id TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        gross_margin REAL NOT NULL DEFAULT 0,
        is_repeat INTEGER NOT NULL DEFAULT 0,
        ordered_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS crm_commerce_action_requests (
        idempotency_key TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('quote','order')),
        customer_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed')),
        response_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS crm_commerce_action_requests_customer_idx
        ON crm_commerce_action_requests(customer_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS crm_intake_settings (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        approval_mode TEXT NOT NULL DEFAULT 'automatic',
        daily_per_sales INTEGER NOT NULL DEFAULT 5,
        claim_sla_hours INTEGER NOT NULL DEFAULT 24,
        contact_sla_hours INTEGER NOT NULL DEFAULT 48,
        match_groups_json TEXT NOT NULL DEFAULT '["A","B"]',
        countries_json TEXT NOT NULL DEFAULT '[]',
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS crm_intake_batches (
        id TEXT PRIMARY KEY,
        batch_date TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'screened-customer-pool',
        status TEXT NOT NULL DEFAULT 'scanned',
        candidate_count INTEGER NOT NULL DEFAULT 0,
        imported_count INTEGER NOT NULL DEFAULT 0,
        assigned_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL,
        finished_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS crm_intake_batches_date_idx ON crm_intake_batches(batch_date,created_at DESC);
      CREATE TABLE IF NOT EXISTS crm_intake_items (
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
        evidence_urls TEXT NOT NULL DEFAULT '',
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
        updated_at TEXT NOT NULL,
        FOREIGN KEY(batch_id) REFERENCES crm_intake_batches(id)
      );
      CREATE INDEX IF NOT EXISTS crm_intake_items_status_idx ON crm_intake_items(status,assigned_owner_id);
      CREATE TABLE IF NOT EXISTS crm_intake_action_requests (
        idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
        actor_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('claim','return','reject')),
        status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
        response_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS crm_intake_action_requests_item_idx
        ON crm_intake_action_requests(item_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS crm_account_contacts (
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
        updated_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS crm_account_contacts_customer_idx ON crm_account_contacts(customer_id);
      CREATE TABLE IF NOT EXISTS crm_manager_evaluations (
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
      CREATE INDEX IF NOT EXISTS crm_manager_evaluations_customer_idx ON crm_manager_evaluations(customer_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS crm_audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL DEFAULT '',
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS crm_audit_log_created_idx ON crm_audit_log(created_at DESC);
      CREATE TABLE IF NOT EXISTS crm_intake_decisions (
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
      CREATE INDEX IF NOT EXISTS crm_intake_decisions_item_idx
        ON crm_intake_decisions(intake_item_id,created_at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS crm_notifications (
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
      CREATE INDEX IF NOT EXISTS crm_notifications_user_idx ON crm_notifications(user_id,status,created_at DESC);
    `);
    ensureAccountIntakeColumns(value);
    ensureAccountRecycleColumns(value);
    ensureAccountOwnershipColumns(value);
    ensureSmokeTestColumns(value);
    ensureIntakeItemColumns(value);
    ensureUserPermissionColumns(value);
    installPermissionGroups(value);
    installImpersonationSchema(value);
    installDataMaintenance(value);
    recoverInterruptedMaintenanceRuns(value);
    installNotificationDeliverySchema(value);
    for (const notification of value.prepare('SELECT id FROM crm_notifications').all()) {
      ensureNotificationDeliveries(value, notification.id);
    }
    value.exec(`CREATE TABLE IF NOT EXISTS crm_migration_review (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      resolved_at TEXT NOT NULL DEFAULT ''
    )`);
    value.prepare(`INSERT OR IGNORE INTO crm_intake_settings
      (id,enabled,approval_mode,daily_per_sales,claim_sla_hours,contact_sla_hours,match_groups_json,countries_json,updated_by,updated_at)
      VALUES ('default',1,'automatic',5,24,48,'["A","B","C","D"]','[]','system',?)`).run(nowText());
    value.prepare(`UPDATE crm_intake_settings SET claim_sla_hours=24,contact_sla_hours=48,updated_at=?
      WHERE id='default' AND updated_by='system' AND claim_sla_hours=12 AND contact_sla_hours=24`).run(nowText());
    seedUsers(value);
    installPermissionGroups(value);
    if (String(process.env.CRM_SEED_DEMO_DATA || '').toLowerCase() === 'true') seedAccounts(value);
  } finally {
    value.close();
  }
}

function ensureSmokeTestColumns(value) {
  for (const [table, additions] of Object.entries({
    crm_accounts: {
      is_test_data: 'INTEGER NOT NULL DEFAULT 0',
      test_run_id: "TEXT NOT NULL DEFAULT ''",
    },
    crm_activities: {
      is_test_data: 'INTEGER NOT NULL DEFAULT 0',
      test_run_id: "TEXT NOT NULL DEFAULT ''",
    },
  })) {
    const columns = new Set(value.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    for (const [name, definition] of Object.entries(additions)) {
      if (!columns.has(name)) value.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
  value.exec(`
    CREATE INDEX IF NOT EXISTS crm_accounts_test_data_idx
      ON crm_accounts(is_test_data,test_run_id);
    CREATE INDEX IF NOT EXISTS crm_activities_test_data_idx
      ON crm_activities(is_test_data,test_run_id);
    CREATE TABLE IF NOT EXISTS crm_smoke_runs (
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
  `);
}

function ensureAccountIntakeColumns(value) {
  const columns = new Set(value.prepare('PRAGMA table_info(crm_accounts)').all().map(row => row.name));
  const additions = {
    intake_item_id: "TEXT NOT NULL DEFAULT ''",
    assignment_status: "TEXT NOT NULL DEFAULT 'claimed'",
    assigned_at: "TEXT NOT NULL DEFAULT ''",
    claim_due_at: "TEXT NOT NULL DEFAULT ''",
    claimed_at: "TEXT NOT NULL DEFAULT ''",
    return_reason: "TEXT NOT NULL DEFAULT ''",
  };
  for (const [name, definition] of Object.entries(additions)) {
    if (!columns.has(name)) value.exec(`ALTER TABLE crm_accounts ADD COLUMN ${name} ${definition}`);
  }
}

function ensureAccountRecycleColumns(value) {
  const columns = new Set(value.prepare('PRAGMA table_info(crm_accounts)').all().map(row => row.name));
  const additions = {
    lifecycle_status: "TEXT NOT NULL DEFAULT 'active'",
    recycle_kind: "TEXT NOT NULL DEFAULT ''",
    recycle_reason: "TEXT NOT NULL DEFAULT ''",
    recycled_by: "TEXT NOT NULL DEFAULT ''",
    recycled_at: "TEXT NOT NULL DEFAULT ''",
    previous_owner_id: "TEXT NOT NULL DEFAULT ''",
  };
  for (const [name, definition] of Object.entries(additions)) {
    if (!columns.has(name)) value.exec(`ALTER TABLE crm_accounts ADD COLUMN ${name} ${definition}`);
  }
  value.exec("CREATE INDEX IF NOT EXISTS crm_accounts_lifecycle_idx ON crm_accounts(lifecycle_status,recycle_kind)");
}

function ensureAccountOwnershipColumns(value) {
  const columns = value.prepare('PRAGMA table_info(crm_accounts)').all();
  if (!columns.some(row => row.name === 'created_by')) {
    value.exec("ALTER TABLE crm_accounts ADD COLUMN created_by TEXT NOT NULL DEFAULT ''");
  }
  const owner = columns.find(row => row.name === 'owner_id');
  if (!owner?.notnull) return;

  value.pragma('foreign_keys = OFF');
  try {
    value.transaction(() => {
      value.exec(`
        CREATE TABLE crm_accounts_v41 (
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
          return_reason TEXT NOT NULL DEFAULT '',
          lifecycle_status TEXT NOT NULL DEFAULT 'active',
          recycle_kind TEXT NOT NULL DEFAULT '',
          recycle_reason TEXT NOT NULL DEFAULT '',
          recycled_by TEXT NOT NULL DEFAULT '',
          recycled_at TEXT NOT NULL DEFAULT '',
          previous_owner_id TEXT NOT NULL DEFAULT '',
          FOREIGN KEY(owner_id) REFERENCES sales_users(id)
        );
        INSERT INTO crm_accounts_v41 (
          id,external_customer_id,company_name,country,city,website,industry,customer_type,source,
          product_focus,priority,potential_value,stage,owner_id,created_by,manager_id,manager_required,
          manager_status,last_activity_at,next_action,next_action_at,loss_reason,created_at,updated_at,
          intake_item_id,assignment_status,assigned_at,claim_due_at,claimed_at,return_reason,
          lifecycle_status,recycle_kind,recycle_reason,recycled_by,recycled_at,previous_owner_id
        )
        SELECT
          id,external_customer_id,company_name,country,city,website,industry,customer_type,source,
          product_focus,priority,potential_value,stage,owner_id,created_by,manager_id,manager_required,
          manager_status,last_activity_at,next_action,next_action_at,loss_reason,created_at,updated_at,
          intake_item_id,assignment_status,assigned_at,claim_due_at,claimed_at,return_reason,
          COALESCE(lifecycle_status,'active'),COALESCE(recycle_kind,''),COALESCE(recycle_reason,''),
          COALESCE(recycled_by,''),COALESCE(recycled_at,''),COALESCE(previous_owner_id,'')
        FROM crm_accounts;
        DROP TABLE crm_accounts;
        ALTER TABLE crm_accounts_v41 RENAME TO crm_accounts;
        CREATE INDEX crm_accounts_owner_idx ON crm_accounts(owner_id);
        CREATE INDEX crm_accounts_stage_idx ON crm_accounts(stage);
        CREATE INDEX crm_accounts_country_idx ON crm_accounts(country);
        CREATE UNIQUE INDEX crm_accounts_external_unique_idx
          ON crm_accounts(external_customer_id) WHERE external_customer_id!='';
      `);
    }).immediate();
  } finally {
    value.pragma('foreign_keys = ON');
  }
}

function ensureIntakeItemColumns(value) {
  const columns = new Set(value.prepare('PRAGMA table_info(crm_intake_items)').all().map(row => row.name));
  if (!columns.has('evidence_urls')) value.exec("ALTER TABLE crm_intake_items ADD COLUMN evidence_urls TEXT NOT NULL DEFAULT ''");
}

function ensureUserPermissionColumns(value) {
  const columns = new Set(value.prepare('PRAGMA table_info(sales_users)').all().map(row => row.name));
  if (!columns.has('permissions_json')) value.exec("ALTER TABLE sales_users ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{}'");
  if (!columns.has('archived_at')) value.exec("ALTER TABLE sales_users ADD COLUMN archived_at TEXT NOT NULL DEFAULT ''");
  value.prepare('UPDATE sales_users SET must_change_password=0 WHERE must_change_password!=0').run();
}

function seedUsers(value) {
  if (value.prepare('SELECT COUNT(*) n FROM sales_users').get().n) return;
  const users = [
    ['USR-ADMIN', process.env.CRM_ADMIN_EMAIL || 'admin@crm.local', '系统管理员', 'admin', process.env.CRM_ADMIN_PASSWORD || 'ChangeMe123!', ['中文', '英文'], ['全球'], ['管理介入']],
    ['USR-MGR', 'manager@crm.local', '林总', 'manager', 'Manager123!', ['中文', '英文', '俄语'], ['俄罗斯', '巴西'], ['视频会议', '商务谈判']],
    ['USR-S01', 'anna@crm.local', 'Anna 陈', 'sales', 'Sales123!', ['中文', '英文', '葡萄牙语'], ['巴西', '葡萄牙'], ['邮件', 'WhatsApp', '视频会议']],
    ['USR-S02', 'ivan@crm.local', 'Ivan 李', 'sales', 'Sales123!', ['中文', '英文', '俄语'], ['俄罗斯', '哈萨克斯坦'], ['电话', 'Telegram', '展会']],
    ['USR-S03', 'mia@crm.local', 'Mia 周', 'sales', 'Sales123!', ['中文', '英文'], ['美国', '德国'], ['邮件', 'LinkedIn']],
    ['USR-S04', 'leo@crm.local', 'Leo 王', 'sales', 'Sales123!', ['中文', '英文', '西班牙语'], ['墨西哥', '智利'], ['电话', 'WhatsApp']],
  ];
  const insert = value.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,languages_json,countries_json,channels_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?)`);
  const now = nowText();
  for (const [userId, email, name, role, password, languages, countries, channels] of users) {
    const pw = hashPassword(password);
    insert.run(userId, email.toLowerCase(), name, role, pw.hash, pw.salt, 0, JSON.stringify(languages), JSON.stringify(countries), JSON.stringify(channels), now, now);
  }
}

function seedAccounts(value) {
  if (value.prepare('SELECT COUNT(*) n FROM crm_accounts').get().n) return;
  const pool = value.prepare(`SELECT customer_id,company_name,country,city,website,industry,customer_type,products
    FROM customer_pool WHERE trim(company_name) != '' ORDER BY
    CASE WHEN trim(country) != '' THEN 0 ELSE 1 END, customer_id DESC LIMIT 24`).all();
  const fallbacks = [
    ['DEMO-BR-01', 'Aurea Automação', '巴西', '圣保罗', '工业自动化', '终端制造商', 'MCU / 连接器'],
    ['DEMO-US-01', 'Northstar Controls', '美国', '芝加哥', '工业控制', '终端制造商', '传感器 / FPGA'],
    ['DEMO-RU-01', 'Volga Instrument', '俄罗斯', '喀山', '仪器仪表', '终端制造商', '模拟IC / 电源模块'],
  ];
  while (pool.length < 18) {
    const item = fallbacks[pool.length % fallbacks.length];
    pool.push({ customer_id: `${item[0]}-${pool.length}`, company_name: `${item[1]} ${pool.length + 1}`, country: item[2], city: item[3], website: '', industry: item[4], customer_type: item[5], products: item[6] });
  }
  const stages = ['qualified', 'contacted', 'replied', 'connected', 'meeting', 'manager', 'rfq', 'quoted', 'negotiating', 'won', 'repeat', 'meeting', 'quoted', 'contacted', 'manager', 'rfq', 'qualified', 'lost'];
  const countries = ['俄罗斯', '巴西', '美国', '德国', '墨西哥', '哈萨克斯坦'];
  const owners = ['USR-S01', 'USR-S02', 'USR-S03', 'USR-S04'];
  const sources = ['公司指派', '邮件搜索', 'LinkedIn', '展会', '海关数据'];
  const insertAccount = value.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,product_focus,priority,potential_value,stage,owner_id,manager_id,manager_required,manager_status,last_activity_at,next_action,next_action_at,loss_reason,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertActivity = value.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertRfq = value.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,reference,status,bom_lines,expected_value,product_category,completeness,received_at,quoted_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertQuote = value.prepare(`INSERT INTO crm_quotes
    (id,rfq_id,customer_id,user_id,amount,currency,gross_margin,loss_leader,status,sent_at,next_follow_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertOrder = value.prepare(`INSERT INTO crm_orders
    (id,customer_id,quote_id,user_id,amount,currency,gross_margin,is_repeat,ordered_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  pool.slice(0, 18).forEach((row, index) => {
    const customerId = `CRM-${String(index + 1).padStart(4, '0')}`;
    const owner = owners[index % owners.length];
    const stage = stages[index];
    const stageIndex = STAGE_INDEX[stage];
    const created = dateOffset(-42 + index);
    const lastDays = [1, 2, 0, 5, 9, 8, 2, 4, 1, 3, 1, 12, 5, 16, 10, 1, 20, 14][index];
    const last = dateOffset(-lastDays);
    const country = row.country || countries[index % countries.length];
    const needsManager = ['meeting', 'manager', 'rfq', 'quoted', 'negotiating'].includes(stage) && index % 3 === 0;
    insertAccount.run(
      customerId, row.customer_id || '', row.company_name, country, row.city || '', row.website || '',
      row.industry || ['工业控制', '汽车电子', '医疗设备'][index % 3], row.customer_type || '终端制造商',
      sources[index % sources.length], row.products || 'IC / 连接器', ['A', 'B', 'B', 'C'][index % 4],
      12000 + index * 3700, stage, owner, 'USR-MGR', needsManager ? 1 : 0,
      needsManager ? '待介入' : '', last,
      stage === 'lost' ? '' : ['确认采购周期', '安排电话会议', '追踪BOM', '报价后回访'][index % 4],
      stage === 'lost' ? '' : dateOffset(index % 4 - 1), stage === 'lost' ? '项目暂停' : '', created, last,
    );
    const timeline = [
      ['qualified', 'note', 'qualification', '客户匹配', '已确认行业、产品及采购入口'],
      ['contacted', 'email', 'email', '已送达', '发送首封个性化开发邮件'],
      ['replied', 'reply', 'email', '有兴趣', '客户回复并希望了解供货品牌'],
      ['connected', 'social', index % 2 ? 'Telegram' : 'WhatsApp', '已添加', '建立社交媒体联系'],
      ['meeting', 'meeting', 'video', '已完成', '完成需求沟通会议'],
      ['manager', 'manager_join', 'video', '已介入', '管理者参加重点客户会议'],
      ['rfq', 'rfq', 'email', '收到BOM', '收到正式询价清单'],
      ['quoted', 'quote', 'email', '已发送', '报价已发送客户'],
      ['negotiating', 'negotiation', 'call', '谈判中', '沟通价格、交期与付款条件'],
      ['won', 'order', 'email', '首单', '客户确认首次订单'],
      ['repeat', 'repeat_order', 'email', '复购', '客户完成第二次采购'],
    ];
    timeline.filter(item => STAGE_INDEX[item[0]] <= stageIndex && item[0] !== 'lost').forEach((item, eventIndex, all) => {
      const occurred = eventIndex === all.length - 1 ? last : dateOffset(-40 + index + eventIndex * 3);
      insertActivity.run(
        `${customerId}-A${eventIndex + 1}`, customerId, owner, item[1], item[2], item[3], item[4],
        eventIndex === all.length - 1 ? ['确认采购周期', '安排下一次电话', '追踪BOM'][index % 3] : '',
        eventIndex === all.length - 1 ? dateOffset(index % 4 - 1) : '', item[0],
        item[0] === 'meeting' && needsManager ? 1 : 0, occurred, occurred,
      );
    });
    if (stageIndex >= STAGE_INDEX.rfq && stage !== 'lost') {
      const rfqId = `${customerId}-RFQ1`, received = dateOffset(-Math.max(1, lastDays + 4));
      const quotedAt = stageIndex >= STAGE_INDEX.quoted ? dateOffset(-Math.max(1, lastDays + 2)) : '';
      insertRfq.run(rfqId, customerId, owner, `RFQ-${20260700 + index}`, stageIndex >= STAGE_INDEX.quoted ? 'quoted' : 'open', 4 + index * 2, 8000 + index * 2100, ['MCU', '连接器', '传感器'][index % 3], 72 + index % 4 * 7, received, quotedAt, received);
      if (quotedAt) {
        const quoteId = `${customerId}-Q1`;
        insertQuote.run(quoteId, rfqId, customerId, owner, 7600 + index * 1900, 'USD', index % 4 === 0 ? -2.5 : 8 + index % 5, index % 4 === 0 ? 1 : 0, stageIndex >= STAGE_INDEX.won ? 'won' : 'sent', quotedAt, dateOffset(-Math.max(0, lastDays - 1)), quotedAt);
        if (stageIndex >= STAGE_INDEX.won) {
          insertOrder.run(`${customerId}-O1`, customerId, quoteId, owner, 7200 + index * 1800, 'USD', 2 + index % 5, 0, dateOffset(-Math.max(1, lastDays)), dateOffset(-Math.max(1, lastDays)));
          if (stage === 'repeat') insertOrder.run(`${customerId}-O2`, customerId, quoteId, owner, 16800, 'USD', 12, 1, last, last);
        }
      }
    }
  });
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2));
}

function sessionIdentity(req) {
  const token = parseCookies(req.headers.cookie || '').sales_session || '';
  if (!token) return null;
  const value = db();
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = value.prepare('SELECT * FROM sales_sessions WHERE token_hash=? AND expires_at>?')
      .get(tokenHash, nowText());
    if (!session) return null;
    const identity = resolveSessionIdentity(value, session, nowText());
    return identity ? { ...identity, tokenHash } : null;
  } finally { value.close(); }
}

function requireSalesUser(req, res, next) {
  const session = sessionIdentity(req);
  if (!session) return res.status(401).json({ ok: false, error: '请先登录', code: 'AUTH_REQUIRED' });
  if (session.ended) return res.status(409).json({ ok: false, error: '身份检查已结束，请刷新页面', code: 'IMPERSONATION_ENDED' });
  const user = session.effectiveUser;
  req.realUser = session.realUser;
  req.salesUser = user;
  req.impersonation = session.impersonation;
  req.sessionTokenHash = session.tokenHash;
  const value = db();
  try { req.accessContext = buildAccessContext(value, user); }
  finally { value.close(); }
  next();
}

function requireUnifiedUser(req, res, next) {
  const session = sessionIdentity(req);
  if (!session) return res.status(401).json({ ok: false, error: '请先登录' });
  if (session.ended) return res.status(409).json({ ok: false, error: '身份检查已结束，请刷新页面', code: 'IMPERSONATION_ENDED' });
  req.realUser = session.realUser;
  req.salesUser = session.effectiveUser;
  req.impersonation = session.impersonation;
  req.sessionTokenHash = session.tokenHash;
  const value = db();
  try { req.accessContext = buildAccessContext(value, session.effectiveUser); }
  finally { value.close(); }
  next();
}

function rate(numerator, denominator) {
  return denominator ? Math.round(numerator / denominator * 1000) / 10 : 0;
}

function accountScope(user) {
  return hasPermission(user, 'view_all_customers')
    ? hasPermission(user, 'manage_intake')
      ? { sql: "WHERE COALESCE(a.lifecycle_status,'active')='active' AND COALESCE(a.is_test_data,0)=0", params: [] }
      : { sql: "WHERE a.owner_id IS NOT NULL AND COALESCE(a.lifecycle_status,'active')='active' AND COALESCE(a.is_test_data,0)=0", params: [] }
    : { sql: "WHERE a.owner_id=? AND COALESCE(a.assignment_status,'claimed')!='returned' AND COALESCE(a.lifecycle_status,'active')='active' AND COALESCE(a.is_test_data,0)=0", params: [user.id] };
}

function buildAlerts(accounts, activities, rfqs, quotes) {
  const latestByCustomer = new Map();
  activities.forEach(activity => {
    if (!latestByCustomer.has(activity.customer_id)) latestByCustomer.set(activity.customer_id, activity);
  });
  const rfqByCustomer = new Map(rfqs.map(row => [row.customer_id, row]));
  const quoteByCustomer = new Map(quotes.map(row => [row.customer_id, row]));
  const now = Date.now();
  const hours = value => value ? (now - new Date(String(value).replace(' ', 'T') + 'Z').getTime()) / 3600000 : Infinity;
  const alerts = [];
  const add = (account, severity, code, title, detail, action, overdueHours = 0) => alerts.push({
    id: `${code}-${account.id}`, severity, code, title, detail, action,
    customerId: account.id, companyName: account.company_name, ownerId: account.owner_id,
    dueAt: account.next_action_at || '', stage: account.stage,
    customerPriority: account.priority || 'C',
    overdueHours: Math.max(0, Math.floor(overdueHours || 0)),
    updatedAt: account.updated_at || account.last_activity_at || account.created_at || '',
  });
  for (const account of accounts) {
    if (isFollowUpTerminalStage(account.stage)) continue;
    const last = latestByCustomer.get(account.id);
    const age = hours(account.last_activity_at || account.created_at);
    const nextAt = account.next_action_at ? new Date(String(account.next_action_at).replace(' ', 'T') + 'Z').getTime() : 0;
    const claimDue = account.claim_due_at ? new Date(String(account.claim_due_at).replace(' ', 'T') + 'Z').getTime() : 0;
    if (account.assignment_status === 'assigned' && claimDue && claimDue < now) add(account, 'critical', 'UNCLAIMED', '每日客户未按时领取', '系统推送的客户已超过领取时限', '立即领取或重新分配', (now - claimDue) / 3600000);
    if (account.intake_item_id && account.assignment_status === 'claimed' && account.stage === 'qualified' && hours(account.claimed_at || account.assigned_at) > 48) {
      add(account, 'critical', 'INTAKE_IDLE', '领取后48小时未首次触达', '销售已领取每日客户，但尚未完成邮件、电话或社媒触达', '立即完成首次触达');
    }
    if (!account.next_action) add(account, 'critical', 'NO_NEXT', '缺少下一步计划', '活跃客户没有明确的下一步动作与日期', '立即补充计划');
    if (nextAt && nextAt < now) add(account, 'critical', 'OVERDUE', '跟进任务已超期', `${account.next_action} 已超过计划时间`, '今天完成跟进', (now - nextAt) / 3600000);
    if (account.stage === 'replied' && age > 24) add(account, 'critical', 'REPLY_IDLE', '客户回复后未及时推进', `客户回复后已停滞 ${Math.floor(age)} 小时`, '立即响应客户');
    if (['meeting', 'manager'].includes(account.stage) && age > 168) add(account, 'critical', 'MEETING_NO_RFQ', '会议后7天未收到询价', '需要确认采购时间、BOM准备状态或会议质量', '销售复盘并追踪BOM');
    if (account.manager_required && account.manager_status !== '已完成') add(account, 'warning', 'MANAGER_NEEDED', '需要管理者介入', account.manager_status || '销售已发起管理者协助', '安排管理者参与');
    const rfq = rfqByCustomer.get(account.id);
    if (rfq && !rfq.quoted_at && hours(rfq.received_at) > 24) add(account, 'critical', 'RFQ_UNQUOTED', '询价超过24小时未报价', `${rfq.bom_lines} 行BOM仍未完成报价`, '立即协调采购报价');
    const quote = quoteByCustomer.get(account.id);
    if (quote && !['won', 'lost'].includes(quote.status) && hours(account.last_activity_at) > 72) add(account, 'warning', 'QUOTE_IDLE', '报价后3天未跟进', '报价已发送但没有新的有效动作', '确认客户反馈');
    if (age > 336) add(account, 'warning', 'STALE', '客户超过14天未推进', `当前停留在“${STAGE_LABELS[account.stage] || account.stage}”`, '决定继续、转交或关闭');
    if (last && last.manager_required && age > 72 && account.manager_status === '已介入') add(account, 'critical', 'POST_MANAGER_IDLE', '管理者介入后销售未承接', '管理者参与后超过3天没有销售跟进行动', '销售立即承接');
  }
  const priority = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => priority[a.severity] - priority[b.severity] || a.companyName.localeCompare(b.companyName));
}

const ALERT_REASON_ORDER = Object.freeze({
  RFQ_UNQUOTED: 10,
  MANAGER_NEEDED: 20,
  UNCLAIMED_LEAD: 30,
  UNCLAIMED: 30,
  PRIORITY_OVERDUE: 40,
  NO_NEXT: 50,
  INTAKE_IDLE: 60,
  OVERDUE: 70,
  REPLY_IDLE: 80,
  POST_MANAGER_IDLE: 81,
  MEETING_NO_RFQ: 90,
  QUOTE_IDLE: 91,
  STALE: 92,
});

function reasonOrder(alert) {
  if (alert.code === 'OVERDUE'
    && ['A', 'B'].includes(alert.customerPriority)
    && Number(alert.overdueHours || 0) >= 72) return ALERT_REASON_ORDER.PRIORITY_OVERDUE;
  return ALERT_REASON_ORDER[alert.code] || 999;
}

function urgencyFor(alert) {
  const order = reasonOrder(alert);
  if (order <= ALERT_REASON_ORDER.PRIORITY_OVERDUE) return 'immediate';
  if (['NO_NEXT', 'INTAKE_IDLE', 'OVERDUE', 'REPLY_IDLE', 'POST_MANAGER_IDLE'].includes(alert.code)) return 'today';
  return 'attention';
}

function groupAlerts(alerts) {
  const groups = new Map();
  for (const alert of alerts) {
    const key = alert.intakeItemId ? `intake:${alert.intakeItemId}` : `customer:${alert.customerId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(alert);
  }
  const urgencyOrder = { immediate: 0, today: 1, attention: 2 };
  const priorityOrder = { A: 0, B: 1, C: 2, D: 3 };
  return [...groups.values()].map(reasons => {
    const ordered = [...reasons].sort((left, right) =>
      reasonOrder(left) - reasonOrder(right)
      || Number(right.overdueHours || 0) - Number(left.overdueHours || 0)
      || String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    const primary = ordered[0];
    const urgency = urgencyFor(primary);
    return {
      ...primary,
      severity: urgency === 'immediate' ? 'critical' : urgency === 'today' ? 'today' : 'warning',
      urgency,
      urgencyLabel: urgency === 'immediate' ? '立即处理' : urgency === 'today' ? '今天完成' : '需要关注',
      reasons: ordered.map(reason => ({
        code: reason.code,
        title: reason.title,
        detail: reason.detail,
        action: reason.action,
        dueAt: reason.dueAt || '',
        overdueHours: Number(reason.overdueHours || 0),
      })),
      reasonCount: ordered.length,
      otherReasons: ordered.slice(1).map(reason => reason.title),
      maxOverdueHours: Math.max(...ordered.map(reason => Number(reason.overdueHours || 0))),
    };
  }).sort((left, right) =>
    urgencyOrder[left.urgency] - urgencyOrder[right.urgency]
    || (priorityOrder[left.customerPriority] ?? 9) - (priorityOrder[right.customerPriority] ?? 9)
    || Number(right.maxOverdueHours || 0) - Number(left.maxOverdueHours || 0)
    || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
    || String(left.companyName || '').localeCompare(String(right.companyName || ''), 'zh-CN'));
}

function buildIntakeAlerts(value, user) {
  const scoped = !hasPermission(user, 'manage_intake');
  const scope = scoped ? 'AND i.assigned_owner_id=?' : '';
  return value.prepare(`SELECT i.*,u.name owner_name FROM crm_intake_items i
    LEFT JOIN sales_users u ON u.id=i.assigned_owner_id
    WHERE i.status='assigned' AND i.claim_due_at!='' AND i.claim_due_at<? ${scope}
    ORDER BY i.claim_due_at`).all(nowText(), ...(scoped ? [user.id] : [])).map(item => ({
      id: `UNCLAIMED-LEAD-${item.id}`,
      severity: 'critical',
      code: 'UNCLAIMED_LEAD',
      title: '未开发线索超过24小时未领取',
      detail: `已分配给 ${item.owner_name || '销售'}，仍未确认领取`,
      action: '进入分配中心处理',
      customerId: '',
      companyName: item.company_name,
      ownerId: item.assigned_owner_id,
      dueAt: item.claim_due_at,
      stage: 'lead-assigned',
      intakeItemId: item.id,
      externalCustomerId: item.external_customer_id,
      country: item.country || '',
      customerPriority: item.match_group || 'C',
      overdueHours: Math.max(0, Math.floor((Date.now() - new Date(String(item.claim_due_at).replace(' ', 'T') + 'Z').getTime()) / 3600000)),
      updatedAt: item.updated_at || item.assigned_at || item.created_at || '',
    }));
}

function buildCountryReport(accounts, activities, orders) {
  const report = {};
  const hasActivity = (customerId, types) => activities.some(row => row.customer_id === customerId && types.includes(row.activity_type));
  for (const account of accounts) {
    const key = account.country || '未标注';
    const item = report[key] ||= { country: key, accounts: 0, contacted: 0, replied: 0, meetings: 0, rfqs: 0, orders: 0, repeatOrders: 0, revenue: 0, grossProfit: 0 };
    item.accounts += 1;
    if (hasActivity(account.id, ['email', 'call', 'social'])) item.contacted += 1;
    if (hasActivity(account.id, ['reply'])) item.replied += 1;
    if (hasActivity(account.id, ['meeting', 'manager_join'])) item.meetings += 1;
    if (hasActivity(account.id, ['rfq'])) item.rfqs += 1;
    const customerOrders = orders.filter(order => order.customer_id === account.id);
    if (customerOrders.length) item.orders += 1;
    if (customerOrders.some(order => order.is_repeat)) item.repeatOrders += 1;
    item.revenue += customerOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
    item.grossProfit += customerOrders.reduce((sum, order) => sum + Number(order.amount || 0) * Number(order.gross_margin || 0) / 100, 0);
  }
  return Object.values(report).map(item => ({
    ...item,
    contactRate: rate(item.contacted, item.accounts),
    replyRate: rate(item.replied, item.contacted),
    meetingRate: rate(item.meetings, item.replied),
    rfqRate: rate(item.rfqs, item.meetings || item.contacted),
    orderRate: rate(item.orders, item.rfqs),
    repeatRate: rate(item.repeatOrders, item.orders),
    valuePerAccount: Math.round(item.grossProfit / Math.max(1, item.accounts)),
    sampleStatus: item.accounts < 10 ? '样本不足' : '可参考',
  })).sort((a, b) => b.valuePerAccount - a.valuePerAccount || b.orderRate - a.orderRate);
}

function buildCohortReport(accounts, activities, orders) {
  const groups = {};
  for (const account of accounts) {
    const date = String(account.assigned_at || account.created_at || '').slice(0, 7) || '未标注';
    const item = groups[date] ||= { cohort: date, assigned: 0, contacted: 0, replied: 0, meetings: 0, rfqs: 0, ordered: 0, revenue: 0 };
    item.assigned += 1;
    if (hasReachedStage(account.stage, 'contacted')) item.contacted += 1;
    if (hasReachedStage(account.stage, 'replied')) item.replied += 1;
    if (hasReachedStage(account.stage, 'meeting')) item.meetings += 1;
    if (activities.some(row => row.customer_id === account.id && row.activity_type === 'rfq')) item.rfqs += 1;
    const customerOrders = orders.filter(row => row.customer_id === account.id);
    if (customerOrders.length) item.ordered += 1;
    item.revenue += customerOrders.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }
  return Object.values(groups).sort((a, b) => b.cohort.localeCompare(a.cohort)).map(item => ({
    ...item,
    contactRate: rate(item.contacted, item.assigned),
    replyRate: rate(item.replied, item.contacted),
    meetingRate: rate(item.meetings, item.contacted),
    rfqRate: rate(item.rfqs, item.meetings),
    orderRate: rate(item.ordered, item.rfqs),
  }));
}

function buildTeamReport(users, accounts, activities, rfqs, quotes, orders) {
  return users.filter(user => user.role === 'sales').map(user => {
    const owned = accounts.filter(row => row.owner_id === user.id);
    const customerIds = new Set(owned.map(row => row.id));
    const acts = activities.filter(row => customerIds.has(row.customer_id));
    const userRfqs = rfqs.filter(row => customerIds.has(row.customer_id));
    const userQuotes = quotes.filter(row => customerIds.has(row.customer_id));
    const userOrders = orders.filter(row => customerIds.has(row.customer_id));
    const unique = type => new Set(acts.filter(row => type.includes(row.activity_type)).map(row => row.customer_id)).size;
    const contacted = unique(['email', 'call', 'social']);
    const replied = unique(['reply']);
    const connected = unique(['social']);
    const meetings = unique(['meeting', 'manager_join']);
    const rfqCount = new Set(userRfqs.map(row => row.customer_id)).size;
    const won = new Set(userOrders.map(row => row.customer_id)).size;
    const repeated = new Set(userOrders.filter(row => row.is_repeat).map(row => row.customer_id)).size;
    const activeOwned = owned.filter(row => isActivePipelineStage(row.stage));
    const overdue = activeOwned.filter(row => row.next_action_at && new Date(String(row.next_action_at).replace(' ', 'T') + 'Z').getTime() < Date.now()).length;
    const planned = activeOwned.filter(row => row.next_action && row.next_action_at).length;
    const managerCases = owned.filter(row => row.manager_required).length;
    const managerFollowed = owned.filter(row => row.manager_required && ['rfq', 'quoted', 'negotiating', 'won', 'repeat'].includes(row.stage)).length;
    const rfqComplete = userRfqs.length ? userRfqs.reduce((sum, row) => sum + Number(row.completeness || 0), 0) / userRfqs.length : 0;
    const quoteCoverage = rate(userQuotes.length, userRfqs.length);
    const scores = {
      activation: Math.round(Math.min(100, rate(contacted, owned.length))),
      outreach: Math.round(Math.min(100, (rate(replied, contacted) * 1.7))),
      relationship: Math.round(Math.min(100, (rate(meetings, Math.max(replied, 1)) * 1.2))),
      discovery: Math.round(Math.min(100, (rate(rfqCount, Math.max(meetings, 1)) * 1.2))),
      professional: Math.round(Math.min(100, rfqComplete * 0.7 + quoteCoverage * 0.3)),
      conversion: Math.round(Math.min(100, rate(won, Math.max(rfqCount, 1)) * 1.6)),
      retention: Math.round(Math.min(100, rate(repeated, Math.max(won, 1)) * 2)),
      execution: Math.round(Math.max(0, Math.min(100, rate(planned, Math.max(owned.length, 1)) - rate(overdue, Math.max(owned.length, 1)) * 0.6))),
      collaboration: Math.round(Math.min(100, rate(managerFollowed, Math.max(managerCases, 1)) * 1.2)),
    };
    const overall = Math.round(Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.keys(scores).length);
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const countryPerformance = buildCountryReport(owned, acts, userOrders).slice(0, 2);
    const channelCounts = {};
    acts.forEach(activity => { if (activity.channel) channelCounts[activity.channel] = (channelCounts[activity.channel] || 0) + 1; });
    const channelPerformance = Object.entries(channelCounts).map(([channel, actions]) => {
      const touchedIds = new Set(acts.filter(activity => activity.channel === channel).map(activity => activity.customer_id));
      const channelReplies = new Set(acts.filter(activity => touchedIds.has(activity.customer_id) && activity.activity_type === 'reply').map(activity => activity.customer_id)).size;
      const channelRfqs = new Set(userRfqs.filter(rfq => touchedIds.has(rfq.customer_id)).map(rfq => rfq.customer_id)).size;
      return { channel, actions, customers: touchedIds.size, replyRate: rate(channelReplies, touchedIds.size), rfqRate: rate(channelRfqs, touchedIds.size) };
    }).sort((a, b) => b.rfqRate - a.rfqRate || b.replyRate - a.replyRate || b.actions - a.actions);
    const bestChannels = channelPerformance.slice(0, 2).map(item => item.channel);
    return {
      user: safeUser(user), sampleSize: owned.length, sampleStatus: owned.length < 10 ? '样本不足' : '可评估',
      overall, scores, strongest: sorted.slice(0, 2).map(([key]) => key), weakest: sorted.slice(-2).map(([key]) => key),
      metrics: { assigned: owned.length, contacted, replied, connected, meetings, rfqs: rfqCount, quotes: userQuotes.length, orders: won, repeats: repeated, overdue, planned },
      rates: { activation: rate(contacted, owned.length), reply: rate(replied, contacted), meeting: rate(meetings, replied), rfq: rate(rfqCount, meetings), order: rate(won, rfqCount), repeat: rate(repeated, won) },
      bestCountries: countryPerformance.map(row => row.country), bestChannels, channelPerformance,
      revenue: userOrders.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      grossProfit: Math.round(userOrders.reduce((sum, row) => sum + Number(row.amount || 0) * Number(row.gross_margin || 0) / 100, 0)),
    };
  }).sort((a, b) => b.overall - a.overall);
}

function normalizeCountry(value) {
  const text = String(value || '').trim().toLowerCase();
  const map = { ru: '俄罗斯', russia: '俄罗斯', br: '巴西', brazil: '巴西', us: '美国', usa: '美国', de: '德国', germany: '德国', kz: '哈萨克斯坦', kazakhstan: '哈萨克斯坦' };
  return map[text] || String(value || '').trim();
}

function chooseIntakeOwner(candidate, users, loadByOwner = {}, dailyByOwner = {}, quota = 5) {
  const country = normalizeCountry(candidate.country);
  const methods = String(candidate.contact_methods || '').toLowerCase();
  const eligible = users.filter(user => user.role === 'sales' && user.active && Number(dailyByOwner[user.id] || 0) < quota);
  const scored = eligible.map(user => {
    const countries = json(user.countries_json).map(normalizeCountry);
    const languages = json(user.languages_json);
    const channels = json(user.channels_json).map(item => String(item).toLowerCase());
    let score = 30 - Math.min(25, Number(loadByOwner[user.id] || 0) * 2);
    const reasons = [];
    if (countries.includes(country)) { score += 45; reasons.push(`国家经验：${country}`); }
    if (country === '俄罗斯' && languages.some(item => String(item).includes('俄'))) { score += 20; reasons.push('俄语能力'); }
    if (country === '巴西' && languages.some(item => String(item).includes('葡'))) { score += 20; reasons.push('葡萄牙语能力'); }
    if (country === '墨西哥' && languages.some(item => String(item).includes('西'))) { score += 20; reasons.push('西班牙语能力'); }
    const matchedChannels = channels.filter(channel => channel && methods.includes(channel.toLowerCase()));
    if (matchedChannels.length) { score += 12; reasons.push(`渠道匹配：${matchedChannels[0]}`); }
    score += Math.max(0, 10 - Number(dailyByOwner[user.id] || 0) * 2);
    return { userId: user.id, score, reason: reasons.join('；') || '按当前负荷均衡分配' };
  }).sort((a, b) => b.score - a.score || Number(loadByOwner[a.userId] || 0) - Number(loadByOwner[b.userId] || 0) || a.userId.localeCompare(b.userId));
  return scored[0] || null;
}

function activeWorkloadByOwner(value) {
  const result = {};
  const terminalStages = [...FOLLOW_UP_TERMINAL_STAGES];
  const accountRows = value.prepare(`SELECT owner_id,COUNT(*) n FROM crm_accounts
    WHERE stage NOT IN (${terminalStages.map(() => '?').join(',')}) AND COALESCE(assignment_status,'claimed')!='returned'
      AND COALESCE(lifecycle_status,'active')='active'
    GROUP BY owner_id`).all(...terminalStages);
  const assignedLeadRows = value.prepare(`SELECT assigned_owner_id owner_id,COUNT(*) n FROM crm_intake_items
    WHERE status='assigned' AND assigned_owner_id!='' GROUP BY assigned_owner_id`).all();
  for (const row of [...accountRows, ...assignedLeadRows]) {
    result[row.owner_id] = Number(result[row.owner_id] || 0) + Number(row.n || 0);
  }
  return result;
}

function arbitrateCandidate(value, candidate, users, load, daily, quota, options = {}) {
  const deterministicMatch = chooseIntakeOwner(candidate, users, load, daily, quota);
  const recommendation = options.aiEnabled === false
    ? {
      available: false,
      reasonCode: 'ai_disabled',
      confidence: 0,
      reviewRequired: false,
      rankedCandidates: [],
    }
    : loadSalesMatchRecommendation(value, candidate.external_customer_id || candidate.customer_id, {
      now: options.now,
    });
  const decision = arbitrateIntakeOwner({
    candidate,
    users,
    deterministicMatch,
    recommendation,
    riskBlocked: options.riskBlocked,
    duplicate: options.duplicate,
    crossTeam: options.crossTeam,
  });
  return {
    ...decision,
    recommendation: serializeRecommendation(recommendation),
    deterministicMatch: deterministicMatch ? {
      userId: deterministicMatch.userId || '',
      reason: deterministicMatch.reason || '',
    } : null,
  };
}

function latestStationValue(value, customerId, station) {
  if (!customerId || !hasTable(value, 'crm_ai_station_results')) return null;
  const row = value.prepare(`SELECT id,value_json,confidence,review_required,generated_at
    FROM crm_ai_station_results
    WHERE customer_id=? AND station=? AND stale_at=''
    ORDER BY generated_at DESC,id DESC LIMIT 1`).get(customerId, station);
  if (!row) return null;
  return {
    resultId: row.id,
    confidence: Number(row.confidence || 0),
    reviewRequired: Boolean(row.review_required),
    generatedAt: row.generated_at || '',
    ...parseJsonObject(row.value_json),
  };
}

function intakeSignals(value, item) {
  const fit = latestStationValue(value, item.external_customer_id, 'customer_fit');
  const readiness = latestStationValue(value, item.external_customer_id, 'contact_readiness');
  const pool = hasTable(value, 'customer_pool')
    ? value.prepare('SELECT rating,current_pool,risk_status FROM customer_pool WHERE customer_id=?')
      .get(item.external_customer_id)
    : null;
  return {
    fit: fit ? {
      resultId: fit.resultId,
      fitScore: Number(fit.fitScore ?? 0),
      grade: fit.grade || '',
      confidence: Number(fit.confidence || 0),
      reasonCodes: Array.isArray(fit.reasonCodes) ? fit.reasonCodes.slice(0, 8) : [],
      reviewRequired: Boolean(fit.reviewRequired),
      generatedAt: fit.generatedAt,
    } : null,
    readiness: readiness ? {
      resultId: readiness.resultId,
      readiness: readiness.readiness || '',
      confidence: Number(readiness.confidence || 0),
      reasonCodes: Array.isArray(readiness.reasonCodes) ? readiness.reasonCodes.slice(0, 8) : [],
      reviewRequired: Boolean(readiness.reviewRequired),
      generatedAt: readiness.generatedAt,
    } : null,
    priority: pool?.rating || pool?.current_pool || item.match_group || '',
    riskStatus: pool?.risk_status || '',
  };
}

function intakeDecisionHistory(value, itemIds) {
  if (!itemIds.length || !hasTable(value, 'crm_intake_decisions')) return new Map();
  const placeholders = itemIds.map(() => '?').join(',');
  const rows = value.prepare(`SELECT * FROM crm_intake_decisions
    WHERE intake_item_id IN (${placeholders})
    ORDER BY created_at DESC,id DESC`).all(...itemIds);
  const result = new Map();
  for (const row of rows) {
    const history = result.get(row.intake_item_id) || [];
    if (history.length >= 20) continue;
    history.push({
      id: row.id,
      type: row.decision_type,
      actorId: row.actor_id,
      candidateSnapshotId: row.candidate_snapshot_id,
      aiRecommendation: parseJsonObject(row.ai_recommendation_json),
      ruleDecision: parseJsonObject(row.rule_decision_json),
      manualDecision: parseJsonObject(row.manual_decision_json),
      createdAt: row.created_at,
    });
    result.set(row.intake_item_id, history);
  }
  return result;
}

function intakeQueryValues(value, limit = 50) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map(item => String(item || '').trim()).filter(Boolean))].slice(0, limit);
}

function intakeQueryBoolean(value) {
  const selected = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(selected)) return true;
  if (['0', 'false', 'no', 'off'].includes(selected)) return false;
  return null;
}

function intakeQueryDate(value, endOfDay = false) {
  const selected = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selected)) return '';
  return `${selected} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

function buildIntakeQueryScope(user, query = {}, options = {}) {
  const filters = ["i.status IN ('pending','approved','assigned','claimed','returned','rejected')"];
  const params = [];
  if (!hasPermission(user, 'manage_intake')) {
    filters.push('i.assigned_owner_id=?');
    params.push(user.id);
  }
  const search = String(query.search || '').trim().slice(0, 120);
  if (search) {
    filters.push(`(i.company_name LIKE ? OR i.external_customer_id LIKE ? OR i.website LIKE ?
      OR i.industry LIKE ? OR i.product_focus LIKE ? OR i.contact_name LIKE ?
      OR i.contact_title LIKE ? OR i.contact_methods LIKE ?)`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like, like);
  }
  if (options.includeStatus !== false) {
    const status = String(query.status || '').trim();
    if (status === 'unassigned') {
      filters.push("i.status IN ('pending','approved')");
    } else if (status && status !== 'all') {
      filters.push('i.status=?');
      params.push(status);
    }
  }
  const equalsFilters = [
    ['country', 'i.country'],
    ['industry', 'i.industry'],
    ['customerType', 'i.customer_type'],
    ['contactLevel', 'i.contact_level'],
  ];
  for (const [queryKey, column] of equalsFilters) {
    const selected = intakeQueryValues(query[queryKey]);
    if (!selected.length) continue;
    filters.push(`${column} IN (${selected.map(() => '?').join(',')})`);
    params.push(...selected);
  }
  const owners = intakeQueryValues(query.owner);
  if (owners.length) {
    if (owners.includes('__unassigned__')) {
      filters.push("i.assigned_owner_id=''");
    } else {
      filters.push(`i.assigned_owner_id IN (${owners.map(() => '?').join(',')})`);
      params.push(...owners);
    }
  }
  const customerTags = intakeQueryValues(query.customerTag);
  if (customerTags.length) {
    filters.push(`EXISTS (
      SELECT 1 FROM customer_tags ct JOIN tags t ON t.id=ct.tag_id
      WHERE ct.customer_id=i.external_customer_id
        AND (CAST(t.id AS TEXT) IN (${customerTags.map(() => '?').join(',')})
          OR t.name IN (${customerTags.map(() => '?').join(',')}))
    )`);
    params.push(...customerTags, ...customerTags);
  }
  const sourceBatches = intakeQueryValues(query.sourceBatch);
  if (sourceBatches.length) {
    filters.push(`EXISTS (
      SELECT 1 FROM crm_intake_batches source_batch
      WHERE source_batch.id=i.batch_id
        AND (source_batch.id IN (${sourceBatches.map(() => '?').join(',')})
          OR source_batch.source IN (${sourceBatches.map(() => '?').join(',')}))
    )`);
    params.push(...sourceBatches, ...sourceBatches);
  }
  const updatedFrom = intakeQueryDate(query.updatedFrom);
  const updatedTo = intakeQueryDate(query.updatedTo, true);
  if (updatedFrom) {
    filters.push('i.updated_at>=?');
    params.push(updatedFrom);
  }
  if (updatedTo) {
    filters.push('i.updated_at<=?');
    params.push(updatedTo);
  }
  const hasWebsite = intakeQueryBoolean(query.hasWebsite);
  if (hasWebsite === true) filters.push("TRIM(i.website)!=''");
  if (hasWebsite === false) filters.push("TRIM(i.website)=''");
  const hasNamedContact = intakeQueryBoolean(query.hasNamedContact);
  if (hasNamedContact === true) filters.push("TRIM(i.contact_name)!=''");
  if (hasNamedContact === false) filters.push("TRIM(i.contact_name)=''");
  if (intakeQueryBoolean(query.unassignedOnly) === true) filters.push("i.assigned_owner_id=''");
  return { filters, params };
}

function loadIntakeFilterOptions(value, user) {
  const { filters, params } = buildIntakeQueryScope(user, {}, { includeStatus: false });
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const distinctValues = column => value.prepare(`SELECT DISTINCT TRIM(${column}) value
    FROM crm_intake_items i ${where} AND TRIM(${column})!=''
    ORDER BY value COLLATE NOCASE`).all(...params).map(row => row.value);
  const customerTags = value.prepare(`SELECT DISTINCT t.id,t.name,t.category
    FROM crm_intake_items i
    JOIN customer_tags ct ON ct.customer_id=i.external_customer_id
    JOIN tags t ON t.id=ct.tag_id
    ${where}
    ORDER BY t.category COLLATE NOCASE,t.name COLLATE NOCASE`).all(...params);
  return {
    customerTags,
    countries: distinctValues('i.country'),
    industries: distinctValues('i.industry'),
    customerTypes: distinctValues('i.customer_type'),
  };
}

function loadIntakeState(value, user, query = {}, options = {}) {
  const settingsRow = value.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
  const settings = {
    enabled: Boolean(settingsRow.enabled),
    approvalMode: settingsRow.approval_mode,
    dailyPerSales: settingsRow.daily_per_sales,
    claimSlaHours: settingsRow.claim_sla_hours,
    contactSlaHours: settingsRow.contact_sla_hours,
    matchGroups: json(settingsRow.match_groups_json),
    countries: json(settingsRow.countries_json),
    updatedAt: settingsRow.updated_at,
  };
  const listQuery = normalizeListQuery(query);
  const scoped = !hasPermission(user, 'manage_intake');
  const { filters, params } = buildIntakeQueryScope(user, query);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const total = Number(value.prepare(`SELECT COUNT(*) total FROM crm_intake_items i ${where}`).get(...params).total || 0);
  const items = value.prepare(`SELECT i.*,u.name suggested_owner_name,a.name assigned_owner_name
    FROM crm_intake_items i
    LEFT JOIN sales_users u ON u.id=i.suggested_owner_id
    LEFT JOIN sales_users a ON a.id=i.assigned_owner_id
    ${where} ORDER BY CASE i.status
      WHEN 'assigned' THEN 0 WHEN 'claimed' THEN 1 WHEN 'returned' THEN 2
      WHEN 'pending' THEN 3 WHEN 'approved' THEN 4 ELSE 5 END,
      i.created_at DESC,i.match_score DESC LIMIT ? OFFSET ?`).all(...params, listQuery.pageSize, listQuery.offset);
  const externalIds = [...new Set(items.map(item => item.external_customer_id).filter(Boolean))];
  const customerTagsById = new Map();
  if (externalIds.length) {
    const tagRows = value.prepare(`SELECT ct.customer_id,t.id,t.name,t.category,t.color,t.is_preset
      FROM customer_tags ct JOIN tags t ON t.id=ct.tag_id
      WHERE ct.customer_id IN (${externalIds.map(() => '?').join(',')})
      ORDER BY t.category,t.name`).all(...externalIds);
    for (const row of tagRows) {
      const tags = customerTagsById.get(row.customer_id) || [];
      tags.push({
        id: row.id,
        name: row.name,
        category: row.category,
        color: row.color,
        isPreset: Boolean(row.is_preset),
      });
      customerTagsById.set(row.customer_id, tags);
    }
  }
  const historyByItem = intakeDecisionHistory(value, items.map(item => item.id));
  const ownerNames = hasTable(value, 'sales_users')
    ? new Map(value.prepare('SELECT id,name FROM sales_users').all().map(row => [row.id, row.name]))
    : new Map();
  const scopedSales = !hasPermission(user, 'manage_intake');
  for (const item of items) {
    item.customerTags = customerTagsById.get(item.external_customer_id) || [];
    const history = historyByItem.get(item.id) || [];
    const arbitration = history.find(entry => entry.type === 'arbitration') || null;
    const manual = history.find(entry => entry.type === 'manual') || null;
    history.forEach(entry => { entry.actorName = ownerNames.get(entry.actorId) || entry.actorId || '系统'; });
    if (options.includeAI !== false) item.signals = intakeSignals(value, item);
    const aiRecommendation = arbitration?.aiRecommendation || {
      available: false,
      reasonCode: 'not_recorded',
      confidence: 0,
      reviewRequired: false,
      rankedCandidates: [],
    };
    aiRecommendation.rankedCandidates = (aiRecommendation.rankedCandidates || []).map(candidate => ({
      ...candidate,
      name: ownerNames.get(candidate.userId) || candidate.userId || '',
    })).filter(candidate => !scopedSales
      || [item.assigned_owner_id, item.suggested_owner_id].filter(Boolean).includes(candidate.userId));
    history.forEach(entry => {
      entry.aiRecommendation.rankedCandidates = (entry.aiRecommendation.rankedCandidates || [])
        .filter(candidate => !scopedSales
          || [item.assigned_owner_id, item.suggested_owner_id].filter(Boolean).includes(candidate.userId));
    });
    item.arbitration = {
      ...(options.includeAI !== false ? {
        candidateSnapshotId: arbitration?.candidateSnapshotId || '',
        aiRecommendation,
      } : {}),
      ruleDecision: options.includeAI === false
        ? withoutArbitrationAI(arbitration?.ruleDecision, item.decision_reason)
        : arbitration?.ruleDecision || {
        disposition: item.status === 'pending' ? 'manager_review' : '',
        reason: item.decision_reason || '',
      },
      manualDecision: manual?.manualDecision || null,
      updatedAt: arbitration?.createdAt || '',
    };
    if (options.includeAI === false) {
      history.forEach(entry => {
        delete entry.candidateSnapshotId;
        delete entry.aiRecommendation;
        entry.ruleDecision = withoutArbitrationAI(entry.ruleDecision, item.decision_reason);
      });
      item.decision_reason = item.arbitration.ruleDecision.reason;
      delete item.suggested_owner_id;
      delete item.suggested_owner_name;
    }
    item.assignmentAudit = history;
  }
  const batches = scoped ? [] : value.prepare('SELECT * FROM crm_intake_batches ORDER BY created_at DESC LIMIT 30').all();
  const today = nowText().slice(0, 10);
  const countScope = buildIntakeQueryScope(user, query, { includeStatus: false });
  const countWhere = countScope.filters.length ? `WHERE ${countScope.filters.join(' AND ')}` : '';
  const statusRows = value.prepare(`SELECT i.status,COUNT(*) n FROM crm_intake_items i
    ${countWhere} GROUP BY i.status`).all(...countScope.params);
  const statusCounts = Object.fromEntries(statusRows.map(row => [row.status, row.n]));
  const countAnd = countWhere ? `${countWhere} AND` : 'WHERE';
  const todayImported = value.prepare(`SELECT COUNT(*) n FROM crm_intake_items i
    ${countAnd} i.created_at>=?`).get(...countScope.params, `${today} 00:00:00`).n;
  const overdueClaim = value.prepare(`SELECT COUNT(*) n FROM crm_intake_items i
    ${countAnd} i.status='assigned' AND i.claim_due_at!='' AND i.claim_due_at<?`)
    .get(...countScope.params, nowText()).n;
  const contactedWhere = scoped ? 'AND a.owner_id=?' : '';
  const contacted = value.prepare(`SELECT COUNT(*) n FROM crm_accounts a WHERE a.intake_item_id!=''
    AND a.stage IN ('contacted','replied','connected','meeting','manager','rfq','quoted','negotiating','won','repeat') ${contactedWhere}`)
    .get(...(scoped ? [user.id] : [])).n;
  const counts = status => Number(statusCounts[status] || 0);
  return {
    settings, items, batches, page: listQuery.page, pageSize: listQuery.pageSize, total,
    hasMore: listQuery.offset + items.length < total,
    filterOptions: loadIntakeFilterOptions(value, user),
    stats: {
      todayImported,
      unassigned: counts('pending') + counts('approved'),
      pending: counts('pending'),
      approved: counts('approved'),
      assigned: counts('assigned'),
      claimed: counts('claimed'),
      contacted,
      idle: counts('pending') + counts('approved') + counts('returned'),
      returned: counts('returned'),
      rejected: counts('rejected'),
      overdueClaim,
    },
  };
}

function normalizeEvaluation(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    subjectTitle: row.subject_title,
    evaluationText: row.evaluation_text,
    authorId: row.author_id,
    authorName: row.author_name,
    aiStatus: row.ai_status,
    aiSummary: row.ai_summary,
    aiLabels: json(row.ai_labels_json),
    aiOrderKeys: json(row.ai_order_keys_json),
    aiRisks: json(row.ai_risks_json),
    aiStrategy: row.ai_strategy,
    aiModel: row.ai_model,
    aiError: row.ai_error,
    aiGeneratedAt: row.ai_generated_at,
    createdAt: row.created_at,
  };
}

function withoutEvaluationAI(evaluation) {
  if (!evaluation) return evaluation;
  const {
    aiStatus,
    aiSummary,
    aiLabels,
    aiOrderKeys,
    aiRisks,
    aiStrategy,
    aiModel,
    aiError,
    aiGeneratedAt,
    ...manualEvaluation
  } = evaluation;
  return manualEvaluation;
}

function withoutEvaluationAIRow(evaluation) {
  if (!evaluation) return evaluation;
  return Object.fromEntries(
    Object.entries(evaluation).filter(([key]) => !key.startsWith('ai_')),
  );
}

function aiFeatureDisabled() {
  const error = new Error('AI feature is disabled');
  error.statusCode = 409;
  error.code = 'AI_FEATURE_DISABLED';
  return error;
}

function safeEvaluationLabel(value) {
  const label = String(typeof value === 'string' ? value : value?.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!label || /@|https?:\/\/|www\./i.test(label)) return '';
  if ((label.match(/\d/g) || []).length >= 7) return '';
  return label;
}

function loadInsights(value, accounts) {
  if (!accounts.length) return { contacts: [], evaluations: [] };
  const accountIds = accounts.map(row => row.id);
  const placeholders = accountIds.map(() => '?').join(',');
  const localContacts = value.prepare(`SELECT * FROM crm_account_contacts WHERE customer_id IN (${placeholders}) ORDER BY name`).all(...accountIds)
    .map(row => ({
      id: `local:${row.id}`, rawId: row.id, customerId: row.customer_id, name: row.name, title: row.title,
      department: row.department, phone: row.phone, email: row.email, social: row.social,
      contactLevel: '人工录入', source: 'manager',
    }));
  const accountByExternal = new Map(accounts.filter(row => row.external_customer_id).map(row => [row.external_customer_id, row.id]));
  const externalIds = [...accountByExternal.keys()];
  let externalContacts = [];
  if (externalIds.length) {
    const externalPlaceholders = externalIds.map(() => '?').join(',');
    externalContacts = value.prepare(`SELECT p.*,
      (SELECT group_concat(cm.method_type || ':' || cm.value,' / ') FROM contact_methods cm WHERE cm.person_id=p.person_id) methods
      FROM person_candidates p WHERE p.customer_id IN (${externalPlaceholders})
      ORDER BY CASE p.contact_level WHEN 'L3' THEN 0 WHEN 'L2' THEN 1 WHEN 'L1' THEN 2 ELSE 3 END,p.updated_at DESC`).all(...externalIds)
      .filter(row => row.full_name)
      .map(row => ({
        id: `person:${row.person_id}`, rawId: row.person_id, customerId: accountByExternal.get(row.customer_id),
        name: row.full_name_local || row.full_name, title: row.title || '', department: row.department || '',
        phone: '', email: '', social: row.methods || '', contactLevel: row.contact_level || 'L0', source: 'recon',
      }));
  }
  const evaluations = value.prepare(`SELECT * FROM crm_manager_evaluations WHERE customer_id IN (${placeholders}) ORDER BY created_at DESC`).all(...accountIds).map(normalizeEvaluation);
  return { contacts: [...localContacts, ...externalContacts], evaluations };
}

function createAccountContact(user, payload) {
  assertPermission(user, 'view_contacts');
  assertPermission(user, 'edit_customer');
  const value = db();
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const name = String(payload.name || '').trim();
    if (!name) throw new Error('请输入联系人姓名');
    const contactId = id('P');
    const now = nowText();
    const transaction = value.transaction(() => {
      value.prepare(`INSERT INTO crm_account_contacts
        (id,customer_id,name,title,department,phone,email,social,source_contact_id,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        contactId, account.id, name, String(payload.title || ''), String(payload.department || ''),
        String(payload.phone || ''), String(payload.email || ''), String(payload.social || ''), '', user.id, now, now,
      );
      if (account.external_customer_id) {
        markContactReadinessStale(value, account.external_customer_id, 'manual_contact_created');
      }
    });
    transaction.immediate();
    return { contactId: `local:${contactId}` };
  } finally { value.close(); }
}

async function createManagerEvaluation(user, payload, options = {}) {
  assertPermission(user, 'manage_evaluations');
  const value = db();
  let evaluationId = '';
  let evaluationInput = null;
  let aiEnabled = false;
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const subjectType = payload.subjectType === 'contact' ? 'contact' : 'company';
    const text = String(payload.evaluationText || '').trim();
    if (text.length < 8) throw new Error('评价内容至少8个字');
    evaluationId = id('EV');
    const subjectName = subjectType === 'company' ? account.company_name : String(payload.subjectName || '').trim();
    const subjectTitle = subjectType === 'company' ? '' : String(payload.subjectTitle || '').trim();
    if (subjectType === 'contact' && !subjectName) throw new Error('请选择评价联系人');
    const now = nowText();
    aiEnabled = featureState(value, options.hardFlags || resolveAIHardFlags())
      .ai_stations.effectiveEnabled;
    value.prepare(`INSERT INTO crm_manager_evaluations
      (id,customer_id,subject_type,subject_id,subject_name,subject_title,evaluation_text,author_id,author_name,ai_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      evaluationId, account.id, subjectType, String(payload.subjectId || ''), subjectName, subjectTitle,
      text, user.id, user.name, aiEnabled ? 'pending' : 'disabled', now, now,
    );
    evaluationInput = { subjectType, subjectName, subjectTitle, evaluation: text };
  } finally { value.close(); }
  if (!aiEnabled) {
    const readDb = db();
    try {
      return {
        evaluation: withoutEvaluationAI(normalizeEvaluation(
          readDb.prepare('SELECT * FROM crm_manager_evaluations WHERE id=?').get(evaluationId),
        )),
      };
    } finally { readDb.close(); }
  }
  try {
    const analysis = await analyzeManagerEvaluation(evaluationInput);
    const writeDb = db();
    try {
      writeDb.prepare(`UPDATE crm_manager_evaluations SET ai_status='completed',ai_summary=?,ai_labels_json=?,
        ai_order_keys_json=?,ai_risks_json=?,ai_strategy=?,ai_model=?,ai_error='',ai_generated_at=?,updated_at=? WHERE id=?`).run(
        analysis.summary, JSON.stringify(analysis.labels), JSON.stringify(analysis.orderKeys), JSON.stringify(analysis.risks),
        analysis.strategy, analysis.model, nowText(), nowText(), evaluationId,
      );
      return { evaluation: normalizeEvaluation(writeDb.prepare('SELECT * FROM crm_manager_evaluations WHERE id=?').get(evaluationId)) };
    } finally { writeDb.close(); }
  } catch (error) {
    const writeDb = db();
    try {
      writeDb.prepare("UPDATE crm_manager_evaluations SET ai_status='failed',ai_error=?,updated_at=? WHERE id=?")
        .run(String(error.message || error).slice(0, 500), nowText(), evaluationId);
      return { evaluation: normalizeEvaluation(writeDb.prepare('SELECT * FROM crm_manager_evaluations WHERE id=?').get(evaluationId)), aiWarning: error.message };
    } finally { writeDb.close(); }
  }
}

async function retryManagerEvaluation(user, evaluationId, options = {}) {
  assertPermission(user, 'manage_evaluations');
  const value = db();
  let row;
  try {
    if (!featureState(value, options.hardFlags || resolveAIHardFlags()).ai_stations.effectiveEnabled) {
      throw aiFeatureDisabled();
    }
    row = value.prepare('SELECT * FROM crm_manager_evaluations WHERE id=?').get(evaluationId);
    if (!row) throw inaccessibleOrMissing(user, '评价不存在');
    getAccountForUser(value, user, row.customer_id);
    value.prepare("UPDATE crm_manager_evaluations SET ai_status='pending',ai_error='',updated_at=? WHERE id=?").run(nowText(), row.id);
  } finally { value.close(); }
  return createAiResultForExisting(row);
}

async function createAiResultForExisting(row) {
  try {
    const analysis = await analyzeManagerEvaluation({
      subjectType: row.subject_type, subjectName: row.subject_name, subjectTitle: row.subject_title, evaluation: row.evaluation_text,
    });
    const value = db();
    try {
      value.prepare(`UPDATE crm_manager_evaluations SET ai_status='completed',ai_summary=?,ai_labels_json=?,
        ai_order_keys_json=?,ai_risks_json=?,ai_strategy=?,ai_model=?,ai_error='',ai_generated_at=?,updated_at=? WHERE id=?`).run(
        analysis.summary, JSON.stringify(analysis.labels), JSON.stringify(analysis.orderKeys), JSON.stringify(analysis.risks),
        analysis.strategy, analysis.model, nowText(), nowText(), row.id,
      );
      return { evaluation: normalizeEvaluation(value.prepare('SELECT * FROM crm_manager_evaluations WHERE id=?').get(row.id)) };
    } finally { value.close(); }
  } catch (error) {
    const value = db();
    try {
      value.prepare("UPDATE crm_manager_evaluations SET ai_status='failed',ai_error=?,updated_at=? WHERE id=?")
        .run(String(error.message || error).slice(0, 500), nowText(), row.id);
      return { evaluation: normalizeEvaluation(value.prepare('SELECT * FROM crm_manager_evaluations WHERE id=?').get(row.id)), aiWarning: error.message };
    } finally { value.close(); }
  }
}

function eligibleIntakeCandidates(value, settings) {
  const groups = settings.matchGroups.length ? settings.matchGroups : ['A', 'B'];
  const countries = settings.countries.map(normalizeCountry);
  const rows = value.prepare(`SELECT
      c.customer_id,p.full_name,p.full_name_local,p.title,
      COALESCE(NULLIF(p.contact_level,''),NULLIF(c.best_contact_level,''),'L0') contact_level,
      COALESCE(p.procurement_relevance,'P0') procurement_relevance,p.updated_at person_updated_at,
      c.company_name,c.country,c.website,c.industry,c.customer_type,c.products,
      s.business_summary,s.company_type,s.likely_component_needs_json,s.match_score,s.match_group,s.risk_level,s.source_urls_json evidence_urls,
      (SELECT group_concat(cm.method_type || ':' || cm.value,' / ') FROM contact_methods cm WHERE cm.person_id=p.person_id) contact_methods,
      (SELECT rr.job_id FROM recon_results rr WHERE rr.customer_id=c.customer_id ORDER BY rr.updated_at DESC LIMIT 1) recon_job_id
    FROM customer_pool c
    LEFT JOIN company_screening s ON s.customer_id=c.customer_id
    LEFT JOIN person_candidates p ON p.person_id=(
      SELECT p2.person_id FROM person_candidates p2 WHERE p2.customer_id=c.customer_id
      ORDER BY CASE p2.contact_level WHEN 'L3' THEN 0 WHEN 'L2' THEN 1 WHEN 'L1' THEN 2 ELSE 3 END,
        p2.sales_ready DESC,p2.updated_at DESC LIMIT 1
    )
    WHERE NOT EXISTS (SELECT 1 FROM crm_intake_items i WHERE i.external_customer_id=c.customer_id)
      AND NOT EXISTS (SELECT 1 FROM crm_accounts a WHERE a.external_customer_id=c.customer_id)
      AND COALESCE(c.is_test_data,0)=0
    ORDER BY CASE COALESCE(p.contact_level,c.best_contact_level,'L0') WHEN 'L3' THEN 0 WHEN 'L2' THEN 1 WHEN 'L1' THEN 2 ELSE 3 END,
      COALESCE(s.match_score,0) DESC,p.updated_at DESC`).all();
  const seen = new Set();
  return rows.filter(row => {
    if (seen.has(row.customer_id)) return false;
    seen.add(row.customer_id);
    if (!groups.includes(row.match_group || '')) return false;
    if (countries.length && !countries.includes(normalizeCountry(row.country))) return false;
    return true;
  });
}

function assignIntakeItem(value, item, ownerId, settings, reason = '') {
  if (!['pending', 'approved', 'returned'].includes(item.status)) return { assigned: false, reason: '状态不可分配' };
  const owner = authorizedSalesUser(value, ownerId);
  if (!owner) return { assigned: false, reason: '销售负责人无效' };
  const existing = value.prepare('SELECT id FROM crm_accounts WHERE external_customer_id=?').get(item.external_customer_id);
  if (existing) {
    value.prepare("UPDATE crm_intake_items SET status='duplicate',crm_customer_id=?,decision_reason='客户已在CRM',updated_at=? WHERE id=?")
      .run(existing.id, nowText(), item.id);
    return { assigned: false, reason: '客户已在CRM' };
  }
  const assignedAt = nowText();
  const claimDue = nowText(new Date(Date.now() + Number(settings.claimSlaHours || 24) * 3600000));
  value.prepare(`UPDATE crm_intake_items SET status='assigned',crm_customer_id='',assigned_owner_id=?,
    decision_reason=?,assigned_at=?,claim_due_at=?,updated_at=? WHERE id=?`)
    .run(ownerId, reason, assignedAt, claimDue, assignedAt, item.id);
  return { assigned: true, accountId: '', ownerId };
}

function createClaimedAccount(value, item, claimedAt, contactDue) {
  const existing = value.prepare('SELECT id FROM crm_accounts WHERE external_customer_id=?').get(item.external_customer_id);
  if (existing) return existing.id;
  const accountId = id('CRM');
  value.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,product_focus,priority,potential_value,stage,owner_id,created_by,manager_id,manager_required,manager_status,last_activity_at,next_action,next_action_at,loss_reason,created_at,updated_at,intake_item_id,assignment_status,assigned_at,claim_due_at,claimed_at,return_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    accountId, item.external_customer_id, item.company_name, normalizeCountry(item.country), '', item.website, item.industry,
    item.customer_type, '每日未开发线索分配', item.product_focus, Number(item.match_score || 0) >= 90 ? 'A' : 'B',
    0, 'qualified', item.assigned_owner_id, item.assigned_owner_id, 'USR-MGR', 0, '', '', '完成首次触达',
    contactDue, '', claimedAt, claimedAt, item.id, 'claimed', item.assigned_at || claimedAt, item.claim_due_at || '', claimedAt, '',
  );
  return accountId;
}

function scanDailyIntake(actor = { id: 'system', role: 'admin' }, options = {}) {
  if (actor.id !== 'system') {
    assertPermission(actor, 'view_intake');
    assertPermission(actor, 'manage_intake');
  }
  const value = db();
  try {
    const aiEnabled = featureState(value, options.hardFlags || resolveAIHardFlags())
      .ai_stations.effectiveEnabled;
    const settingsRow = value.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
    const settings = {
      enabled: Boolean(settingsRow.enabled), approvalMode: settingsRow.approval_mode,
      dailyPerSales: settingsRow.daily_per_sales, claimSlaHours: settingsRow.claim_sla_hours,
      matchGroups: json(settingsRow.match_groups_json), countries: json(settingsRow.countries_json),
    };
    if (!settings.enabled && !options.force) throw new Error('每日自动入库已停用');
    const candidates = eligibleIntakeCandidates(value, settings);
    const batchId = id('BATCH'), batchDate = nowText().slice(0, 10), createdAt = nowText();
    value.prepare(`INSERT INTO crm_intake_batches
      (id,batch_date,source,status,candidate_count,imported_count,assigned_count,skipped_count,created_by,created_at,finished_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(batchId, batchDate, 'screened-customer-pool', 'running', candidates.length, 0, 0, 0, actor.id || 'system', createdAt, '');
    let users = [];
    let load = {};
    let daily = {};
    const insert = value.prepare(`INSERT INTO crm_intake_items
      (id,batch_id,external_customer_id,crm_customer_id,company_name,country,website,industry,customer_type,product_focus,match_score,match_group,contact_name,contact_title,contact_methods,contact_level,evidence_urls,report_url,status,suggested_owner_id,assigned_owner_id,decision_reason,return_reason,assigned_at,claim_due_at,claimed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let imported = 0, assigned = 0, skipped = 0;
    const transaction = value.transaction(() => {
      users = authorizedSalesUsers(value);
      load = activeWorkloadByOwner(value);
      daily = Object.fromEntries(value.prepare(`SELECT assigned_owner_id,COUNT(*) n
        FROM crm_intake_items WHERE assigned_at>=? GROUP BY assigned_owner_id`)
        .all(`${batchDate} 00:00:00`).map(row => [row.assigned_owner_id, row.n]));
      if (settings.approvalMode === 'automatic') {
        const backlog = value.prepare("SELECT * FROM crm_intake_items WHERE status='approved' AND assigned_owner_id='' ORDER BY match_score DESC,created_at LIMIT 500").all();
        for (const item of backlog) {
          const decision = arbitrateCandidate(
            value, item, users, load, daily, Number(settings.dailyPerSales || 5), { aiEnabled },
          );
          recordIntakeDecision(value, item.id, {
            actorId: actor.id || 'system',
            aiRecommendation: decision.recommendation,
            ruleDecision: serializeArbitrationDecision(decision),
            candidateSnapshotId: decision.recommendation.snapshotId,
          });
          if (decision.disposition === 'blocked') break;
          if (decision.managerReview) {
            value.prepare("UPDATE crm_intake_items SET status='pending',suggested_owner_id=?,decision_reason=?,updated_at=? WHERE id=?")
              .run(decision.suggestedUserId, decision.reason, nowText(), item.id);
            continue;
          }
          const match = { userId: decision.userId, reason: decision.reason };
          value.prepare('UPDATE crm_intake_items SET suggested_owner_id=?,decision_reason=?,updated_at=? WHERE id=?')
            .run(match.userId, match.reason, nowText(), item.id);
          const result = assignIntakeItem(value, { ...item, suggested_owner_id: match.userId, decision_reason: match.reason }, match.userId, settings, match.reason);
          if (result.assigned) {
            assigned += 1;
            load[match.userId] = Number(load[match.userId] || 0) + 1;
            daily[match.userId] = Number(daily[match.userId] || 0) + 1;
          }
        }
      }
      for (const candidate of candidates) {
        const riskBlocked = String(candidate.risk_level || '').toLowerCase().includes('blocked');
        const decision = arbitrateCandidate(
          value,
          candidate,
          users,
          load,
          daily,
          Number(settings.dailyPerSales || 5),
          { riskBlocked, aiEnabled },
        );
        const match = decision.assignable
          ? { userId: decision.userId, reason: decision.reason }
          : null;
        const itemId = id('IN');
        const reportUrl = candidate.recon_job_id ? `/api/report?job_id=${encodeURIComponent(candidate.recon_job_id)}` : '';
        try {
          insert.run(
            itemId, batchId, candidate.customer_id, '', candidate.company_name, normalizeCountry(candidate.country), candidate.website || '',
            candidate.industry || candidate.business_summary || '', candidate.customer_type || candidate.company_type || '',
            candidate.likely_component_needs_json || candidate.products || '', Number(candidate.match_score || 0), candidate.match_group || '',
            candidate.full_name_local || candidate.full_name || '', candidate.title || '', candidate.contact_methods || '', candidate.contact_level || 'L0',
            candidate.evidence_urls || '', reportUrl,
            settings.approvalMode === 'automatic' && decision.assignable ? 'approved' : 'pending',
            decision.suggestedUserId || '', '', decision.reason,
            '', '', '', '', createdAt, createdAt,
          );
          recordIntakeDecision(value, itemId, {
            actorId: actor.id || 'system',
            aiRecommendation: decision.recommendation,
            ruleDecision: serializeArbitrationDecision(decision),
            candidateSnapshotId: decision.recommendation.snapshotId,
          });
          imported += 1;
          if (settings.approvalMode === 'automatic' && match) {
            const item = value.prepare('SELECT * FROM crm_intake_items WHERE id=?').get(itemId);
            const result = assignIntakeItem(value, item, match.userId, settings, match.reason);
            if (result.assigned) {
              assigned += 1;
              load[match.userId] = Number(load[match.userId] || 0) + 1;
              daily[match.userId] = Number(daily[match.userId] || 0) + 1;
            } else skipped += 1;
          }
        } catch (error) {
          if (String(error.message).includes('UNIQUE')) skipped += 1;
          else throw error;
        }
      }
      value.prepare(`UPDATE crm_intake_batches SET status='done',imported_count=?,assigned_count=?,skipped_count=?,finished_at=? WHERE id=?`)
        .run(imported, assigned, skipped, nowText(), batchId);
    });
    transaction();
    return { batchId, candidates: candidates.length, imported, assigned, skipped };
  } finally { value.close(); }
}

function intakeActionIdempotencyKey(user, payload) {
  const requested = String(payload.idempotencyKey || '').trim();
  if (requested) return requested.slice(0, 240);
  const action = String(payload.action || '').trim();
  const itemId = String(payload.itemId || '').trim();
  const reason = String(payload.reason || '').trim();
  return `intake:${crypto.createHash('sha256')
    .update(`${user.id}:${action}:${itemId}:${reason}`)
    .digest('hex')}`;
}

function reserveIntakeAction(value, user, payload) {
  const key = intakeActionIdempotencyKey(user, payload);
  const action = String(payload.action || '').trim();
  const itemId = String(payload.itemId || '').trim();
  let existing = value.prepare('SELECT * FROM crm_intake_action_requests WHERE idempotency_key=?').get(key);
  if (!existing) {
    const inserted = value.prepare(`INSERT OR IGNORE INTO crm_intake_action_requests
      (idempotency_key,actor_id,item_id,action,status,response_json,created_at,updated_at)
      VALUES (?,?,?,?, 'started','{}',?,?)`).run(key, user.id, itemId, action, nowText(), nowText());
    if (inserted.changes === 1) return { key, replay: null };
    existing = value.prepare('SELECT * FROM crm_intake_action_requests WHERE idempotency_key=?').get(key);
  }
  if (existing) {
    if (existing.actor_id !== user.id || existing.item_id !== itemId || existing.action !== action) {
      const error = new Error('幂等键已绑定其他入库操作');
      error.statusCode = 409;
      error.code = 'INTAKE_IDEMPOTENCY_CONFLICT';
      throw error;
    }
    if (existing.status === 'completed') {
      const response = json(existing.response_json, {});
      return { key, replay: { ...response, deduplicated: true } };
    }
    const error = new Error('相同入库操作正在处理中');
    error.statusCode = 409;
    error.code = 'INTAKE_ACTION_IN_PROGRESS';
    throw error;
  }
  throw new Error('无法建立入库操作幂等记录');
}

function completeIntakeAction(value, key, response) {
  value.prepare(`UPDATE crm_intake_action_requests
    SET status='completed',response_json=?,updated_at=? WHERE idempotency_key=? AND status='started'`)
    .run(JSON.stringify(response), nowText(), key);
  return response;
}

function clearIntakeActionReservation(value, key) {
  value.prepare("DELETE FROM crm_intake_action_requests WHERE idempotency_key=? AND status='started'").run(key);
}

function manageIntake(user, payload, options = {}) {
  assertPermission(user, 'view_intake');
  const action = String(payload.action || '');
  const selfActions = new Set(['claim', 'return', 'reject']);
  if (selfActions.has(action)) {
    if (user.role !== 'sales') {
      const error = new Error('仅销售可执行领取、退回或不对口操作');
      error.statusCode = 403;
      throw error;
    }
  } else {
    assertPermission(user, 'manage_intake');
  }
  const value = db();
  let reservation;
  try {
    const aiEnabled = featureState(value, options.hardFlags || resolveAIHardFlags())
      .ai_stations.effectiveEnabled;
    if (action === 'bulk_assign') {
      const settingsRow = value.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
      const settings = { dailyPerSales: settingsRow.daily_per_sales, claimSlaHours: settingsRow.claim_sla_hours, contactSlaHours: settingsRow.contact_sla_hours };
      const batchDate = nowText().slice(0, 10);
      const requested = Array.isArray(payload.itemIds) ? payload.itemIds.filter(Boolean) : [];
      const configuredUsers = authorizedSalesUsers(value);
      const limit = Math.max(1, Math.min(500, Number(payload.limit || configuredUsers.length * settings.dailyPerSales)));
      let items = [];
      let assignedCount = 0;
      const transaction = value.transaction(() => {
        const users = authorizedSalesUsers(value);
        const load = activeWorkloadByOwner(value);
        const daily = Object.fromEntries(value.prepare(`SELECT assigned_owner_id,COUNT(*) n
          FROM crm_intake_items WHERE assigned_at>=? GROUP BY assigned_owner_id`)
          .all(`${batchDate} 00:00:00`).map(row => [row.assigned_owner_id, row.n]));
        items = requested.length
          ? value.prepare(`SELECT * FROM crm_intake_items WHERE id IN (${requested.map(() => '?').join(',')})
              AND status IN ('pending','approved','returned') ORDER BY match_score DESC`).all(...requested)
          : value.prepare(`SELECT * FROM crm_intake_items WHERE status IN ('pending','approved','returned')
              ORDER BY match_score DESC,created_at LIMIT ?`).all(limit);
        for (const candidate of items) {
          const decision = arbitrateCandidate(
            value, candidate, users, load, daily, settings.dailyPerSales, { aiEnabled },
          );
          recordIntakeDecision(value, candidate.id, {
            actorId: user.id,
            aiRecommendation: decision.recommendation,
            ruleDecision: serializeArbitrationDecision(decision),
            candidateSnapshotId: decision.recommendation.snapshotId,
          });
          if (decision.disposition === 'blocked') break;
          if (decision.managerReview) {
            value.prepare("UPDATE crm_intake_items SET status='pending',suggested_owner_id=?,decision_reason=?,updated_at=? WHERE id=?")
              .run(decision.suggestedUserId, decision.reason, nowText(), candidate.id);
            continue;
          }
          const match = { userId: decision.userId, reason: decision.reason };
          value.prepare("UPDATE crm_intake_items SET status='approved',suggested_owner_id=?,decision_reason=?,updated_at=? WHERE id=?")
            .run(match.userId, match.reason, nowText(), candidate.id);
          const result = assignIntakeItem(value, { ...candidate, status: 'approved' }, match.userId, settings, match.reason);
          if (result.assigned) {
            assignedCount += 1;
            load[match.userId] = Number(load[match.userId] || 0) + 1;
            daily[match.userId] = Number(daily[match.userId] || 0) + 1;
          }
        }
      });
      transaction();
      return { action, assigned: assignedCount, considered: items.length };
    }
    const item = value.prepare('SELECT * FROM crm_intake_items WHERE id=?').get(String(payload.itemId || ''));
    if (!item) throw new Error('入库任务不存在');
    if (['claim', 'return', 'reject'].includes(action) && item.assigned_owner_id !== user.id) {
      const error = new Error('无权处理该入库任务'); error.statusCode = 403; throw error;
    }
    if (selfActions.has(action)) {
      reservation = reserveIntakeAction(value, user, payload);
      if (reservation.replay) return reservation.replay;
    }
    if (action === 'claim') {
      if (item.status !== 'assigned') throw new Error('该客户当前不可领取');
      const claimedAt = nowText();
      const settings = value.prepare("SELECT contact_sla_hours FROM crm_intake_settings WHERE id='default'").get();
      const contactDue = nowText(new Date(Date.now() + Number(settings.contact_sla_hours || 48) * 3600000));
      let accountId = '';
      value.transaction(() => {
        accountId = item.crm_customer_id || createClaimedAccount(value, item, claimedAt, contactDue);
        value.prepare("UPDATE crm_intake_items SET status='claimed',crm_customer_id=?,claimed_at=?,updated_at=? WHERE id=?")
          .run(accountId, claimedAt, claimedAt, item.id);
        value.prepare("UPDATE crm_accounts SET assignment_status='claimed',claimed_at=?,next_action='完成首次触达',next_action_at=?,updated_at=? WHERE id=?")
          .run(claimedAt, contactDue, claimedAt, accountId);
      })();
      recordIntakeDecision(value, item.id, {
        decisionType: 'manual',
        actorId: user.id,
        manualDecision: { action, status: 'claimed', customerId: accountId },
      });
      let salesPackJobId = '';
      try {
        const hardFlags = options.hardFlags || resolveAIHardFlags();
        const features = featureState(value, hardFlags);
        const canCreatePack = features.sales_pack.effectiveEnabled
          && ['use_ai_assistant', 'view_customers', 'view_contacts', 'view_recon']
            .every(permission => hasPermission(user, permission));
        if (canCreatePack) {
          const job = enqueueSalesPack({
            db: value,
            accessContext: buildAccessContext(value, user),
            actor: user,
            customerId: item.external_customer_id,
            eventId: item.id,
            trigger: 'customer_claimed',
          });
          salesPackJobId = job.id;
        }
      } catch (_error) {
        // Claiming a customer must remain available when AI infrastructure is degraded.
      }
      return completeIntakeAction(value, reservation.key, { action, itemId: item.id, customerId: accountId, salesPackJobId });
    }
    if (action === 'return') {
      const reason = String(payload.reason || '').trim();
      if (!reason) throw new Error('退回客户必须填写原因');
      value.prepare("UPDATE crm_intake_items SET status='returned',return_reason=?,updated_at=? WHERE id=?").run(reason, nowText(), item.id);
      value.prepare("UPDATE crm_accounts SET assignment_status='returned',return_reason=?,updated_at=? WHERE id=?").run(reason, nowText(), item.crm_customer_id);
      recordIntakeDecision(value, item.id, {
        decisionType: 'manual',
        actorId: user.id,
        manualDecision: { action, status: 'returned', reason },
      });
      return completeIntakeAction(value, reservation.key, { action, itemId: item.id });
    }
    if (action === 'reject') {
      const reason = String(payload.reason || '').trim();
      if (!reason) throw new Error('标记不对口必须填写原因');
      value.prepare("UPDATE crm_intake_items SET status='rejected',return_reason=?,updated_at=? WHERE id=?").run(reason, nowText(), item.id);
      value.prepare("UPDATE crm_accounts SET assignment_status='returned',stage='lost',loss_reason=?,return_reason=?,updated_at=? WHERE id=?").run(reason, reason, nowText(), item.crm_customer_id);
      recordIntakeDecision(value, item.id, {
        decisionType: 'manual',
        actorId: user.id,
        manualDecision: { action, status: 'rejected', reason },
      });
      return completeIntakeAction(value, reservation.key, { action, itemId: item.id });
    }
    if (['assign', 'reassign'].includes(action)) {
      const ownerId = String(payload.ownerId || item.suggested_owner_id || '');
      const owner = authorizedSalesUser(value, ownerId);
      if (!owner) throw new Error('请选择有效的销售负责人');
      const settingsRow = value.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
      const settings = { claimSlaHours: settingsRow.claim_sla_hours, contactSlaHours: settingsRow.contact_sla_hours };
      if (item.crm_customer_id) {
        const assignedAt = nowText(), claimDue = nowText(new Date(Date.now() + Number(settings.claimSlaHours || 24) * 3600000));
        value.prepare(`UPDATE crm_accounts SET owner_id=?,assignment_status='assigned',assigned_at=?,claim_due_at=?,claimed_at='',return_reason='',stage=CASE WHEN stage='lost' THEN 'qualified' ELSE stage END,loss_reason='',updated_at=? WHERE id=?`)
          .run(ownerId, assignedAt, claimDue, assignedAt, item.crm_customer_id);
        value.prepare(`UPDATE crm_intake_items SET status='assigned',assigned_owner_id=?,assigned_at=?,claim_due_at=?,claimed_at='',return_reason='',updated_at=? WHERE id=?`)
          .run(ownerId, assignedAt, claimDue, assignedAt, item.id);
        recordIntakeDecision(value, item.id, {
          decisionType: 'manual',
          actorId: user.id,
          manualDecision: { action, status: 'assigned', ownerId, reason: payload.reason || '管理者重新分配' },
        });
        return { action, itemId: item.id, ownerId };
      }
      if (item.status === 'assigned') {
        const assignedAt = nowText(), claimDue = nowText(new Date(Date.now() + Number(settings.claimSlaHours || 24) * 3600000));
        value.prepare(`UPDATE crm_intake_items SET assigned_owner_id=?,suggested_owner_id=?,assigned_at=?,
          claim_due_at=?,claimed_at='',return_reason='',decision_reason=?,updated_at=? WHERE id=?`)
          .run(ownerId, ownerId, assignedAt, claimDue, String(payload.reason || item.decision_reason || '管理者重新分配'), assignedAt, item.id);
        recordIntakeDecision(value, item.id, {
          decisionType: 'manual',
          actorId: user.id,
          manualDecision: { action, status: 'assigned', ownerId, reason: payload.reason || item.decision_reason || '管理者重新分配' },
        });
        return { action, itemId: item.id, ownerId };
      }
      const result = assignIntakeItem(value, item, ownerId, settings, String(payload.reason || item.decision_reason || '管理者分配'));
      if (!result.assigned) throw new Error(result.reason);
      recordIntakeDecision(value, item.id, {
        decisionType: 'manual',
        actorId: user.id,
        manualDecision: { action, status: 'assigned', ownerId, reason: payload.reason || item.decision_reason || '管理者分配' },
      });
      return { action, itemId: item.id, ownerId };
    }
    throw new Error('未知入库操作');
  } catch (error) {
    if (reservation?.key) clearIntakeActionReservation(value, reservation.key);
    throw error;
  } finally { value.close(); }
}

function updateIntakeSettings(user, payload) {
  assertPermission(user, 'view_intake');
  assertPermission(user, 'manage_intake');
  const mode = payload.approvalMode === 'manual' ? 'manual' : 'automatic';
  const value = db();
  try {
    value.prepare(`UPDATE crm_intake_settings SET enabled=?,approval_mode=?,daily_per_sales=?,claim_sla_hours=?,
      contact_sla_hours=?,match_groups_json=?,countries_json=?,updated_by=?,updated_at=? WHERE id='default'`).run(
      payload.enabled === false ? 0 : 1, mode, Math.max(1, Math.min(50, Number(payload.dailyPerSales || 5))),
      Math.max(1, Math.min(72, Number(payload.claimSlaHours || 12))), Math.max(1, Math.min(168, Number(payload.contactSlaHours || 24))),
      JSON.stringify(payload.matchGroups || ['A', 'B']), JSON.stringify(payload.countries || []), user.id, nowText(),
    );
    return { updated: true };
  } finally { value.close(); }
}

function normalizeListQuery(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.max(20, Math.min(200, Number.parseInt(query.pageSize || query.page_size, 10) || 100));
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    search: String(query.search || '').trim().slice(0, 120),
  };
}

function researchOwnerCondition(user, alias, params) {
  if (hasPermission(user, 'view_all_customers')) {
    if (hasPermission(user, 'manage_intake')) return '';
    return `NOT EXISTS(SELECT 1 FROM crm_accounts unassigned_account
      WHERE unassigned_account.external_customer_id=${alias}.customer_id
        AND unassigned_account.owner_id IS NULL
        AND COALESCE(unassigned_account.lifecycle_status,'active')='active')`;
  }
  params.push(user.id);
  return `EXISTS(SELECT 1 FROM crm_accounts scoped_account
    WHERE scoped_account.external_customer_id=${alias}.customer_id
      AND scoped_account.owner_id=?
      AND COALESCE(scoped_account.lifecycle_status,'active')='active'
      AND COALESCE(scoped_account.assignment_status,'claimed')!='returned')`;
}

function researchTotals(value, user, permissions) {
  const count = (from, alias, permission, extra = '') => {
    if (!permission) return 0;
    const params = [];
    const ownerCondition = researchOwnerCondition(user, alias, params);
    const where = [ownerCondition, extra].filter(Boolean).join(' AND ');
    return Number(value.prepare(`SELECT COUNT(*) total FROM ${from} ${alias}${where ? ` WHERE ${where}` : ''}`).get(...params).total || 0);
  };
  const canSeePool = permissions.view_pool;
  const canSeePeople = permissions.view_contacts;
  const canSeeRecon = permissions.view_recon;
  return {
    pool: count('customer_pool', 'p', canSeePool, 'COALESCE(p.is_test_data,0)=0'),
    poolAvailable: count('customer_pool', 'p', canSeePool, 'COALESCE(p.is_test_data,0)=0 AND NOT EXISTS(SELECT 1 FROM crm_accounts linked_account WHERE linked_account.external_customer_id=p.customer_id)'),
    people: count('person_candidates', 'pc', canSeePeople),
    recon: count('recon_results', 'r', canSeeRecon),
  };
}

function loadResearchPage(user, kind, query = {}) {
  const permissions = permissionsFor(user);
  const requiredPermission = {
    pool: permissions.view_pool,
    people: permissions.view_contacts,
    recon: permissions.view_recon,
  }[kind];
  if (!requiredPermission) {
    const error = new Error('当前账号没有该数据模块权限');
    error.statusCode = 403;
    throw error;
  }

  const value = db();
  try {
    const { page, pageSize, offset, search } = normalizeListQuery(query);
    const params = [];
    const conditions = [];
    const addLike = columns => {
      if (!search) return;
      const like = `%${search}%`;
      conditions.push(`(${columns.map(column => `${column} LIKE ?`).join(' OR ')})`);
      columns.forEach(() => params.push(like));
    };

    let from;
    let select;
    let orderBy;
    let alias;
    if (kind === 'pool') {
      alias = 'p';
      from = 'customer_pool p';
      select = `p.*,
        EXISTS(SELECT 1 FROM crm_accounts a WHERE a.external_customer_id=p.customer_id) in_crm,
        (SELECT a.id FROM crm_accounts a WHERE a.external_customer_id=p.customer_id LIMIT 1) crm_account_id,
        (SELECT u.name FROM crm_accounts a LEFT JOIN sales_users u ON u.id=a.owner_id WHERE a.external_customer_id=p.customer_id LIMIT 1) owner_name,
        (SELECT i.status FROM crm_intake_items i WHERE i.external_customer_id=p.customer_id LIMIT 1) intake_status,
        (SELECT u.name FROM crm_intake_items i LEFT JOIN sales_users u ON u.id=i.assigned_owner_id
          WHERE i.external_customer_id=p.customer_id LIMIT 1) lead_owner_name,
        (SELECT s.risk_level FROM company_screening s WHERE s.customer_id=p.customer_id LIMIT 1) screening_risk_level`;
      orderBy = 'p.last_found DESC,p.customer_id DESC';
      addLike(['p.customer_id','p.company_name','p.country','p.city','p.website','p.industry','p.customer_type','p.products']);
      conditions.push('COALESCE(p.is_test_data,0)=0');
      if (query.group) { conditions.push("COALESCE(NULLIF(p.current_pool,''),'未分池')=?"); params.push(String(query.group)); }
      if (query.crm === 'crm') conditions.push('EXISTS(SELECT 1 FROM crm_accounts linked WHERE linked.external_customer_id=p.customer_id)');
      if (query.crm === 'available') conditions.push('NOT EXISTS(SELECT 1 FROM crm_accounts linked WHERE linked.external_customer_id=p.customer_id)');
    } else if (kind === 'people') {
      alias = 'pc';
      from = 'person_candidates pc';
      select = `pc.*,
        (SELECT p.company_name FROM customer_pool p WHERE p.customer_id=pc.customer_id LIMIT 1) company_name,
        (SELECT group_concat(cm.method_type || ':' || cm.value,' / ') FROM contact_methods cm WHERE cm.person_id=pc.person_id) methods_summary`;
      orderBy = 'pc.sales_ready DESC,pc.contact_level DESC,pc.updated_at DESC';
      if (search) {
        const like = `%${search}%`;
        conditions.push(`(pc.customer_id LIKE ? OR pc.full_name LIKE ? OR pc.full_name_local LIKE ? OR pc.title LIKE ? OR pc.department LIKE ?
          OR EXISTS(SELECT 1 FROM customer_pool searched_pool WHERE searched_pool.customer_id=pc.customer_id AND searched_pool.company_name LIKE ?)
          OR EXISTS(SELECT 1 FROM contact_methods searched_method WHERE searched_method.person_id=pc.person_id AND searched_method.value LIKE ?))`);
        params.push(like, like, like, like, like, like, like);
      }
      if (query.level) { conditions.push('pc.contact_level=?'); params.push(String(query.level)); }
    } else if (kind === 'recon') {
      alias = 'r';
      from = 'recon_results r';
      select = 'r.*';
      orderBy = 'r.updated_at DESC';
      addLike(permissions.view_contacts
        ? ['r.customer_id','r.company_name','r.industry','r.customer_type','r.opportunity_summary','r.contacts_summary']
        : ['r.customer_id','r.company_name','r.industry','r.customer_type']);
    } else {
      const error = new Error('未知数据列表');
      error.statusCode = 404;
      throw error;
    }

    const ownerCondition = researchOwnerCondition(user, alias, params);
    if (ownerCondition) conditions.push(ownerCondition);
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(value.prepare(`SELECT COUNT(*) total FROM ${from}${where}`).get(...params).total || 0);
    let rows = value.prepare(`SELECT ${select} FROM ${from}${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset);
    if (!permissions.view_contacts && kind === 'pool') rows = rows.map(contactSafePoolRecord);
    if (!permissions.view_contacts && kind === 'recon') rows = rows.map(contactSafeReconRecord);
    return { rows, page, pageSize, total, hasMore: offset + rows.length < total };
  } finally { value.close(); }
}

const TIMELINE_ACTIVITY_LABELS = Object.freeze({
  email: '发送邮件',
  call: '电话开发',
  social: '社媒联系',
  reply: '客户回复',
  meeting: '视频会议',
  manager_join: '管理者介入',
  negotiation: '商务谈判',
  lost: '暂停或流失',
});

function buildCustomerTimeline(value, accounts, activities, rfqs, quotes, orders, options = {}) {
  const events = [];
  const accountIds = accounts.map(row => row.id);
  const placeholders = accountIds.length ? accountIds.map(() => '?').join(',') : "''";

  for (const account of accounts) {
    const claimedAt = account.claimed_at
      || (account.assignment_status === 'claimed' ? account.created_at : '');
    if (claimedAt) {
      events.push({
        id: `claim:${account.id}`,
        customer_id: account.id,
        kind: 'claim',
        title: '客户已认领',
        summary: '销售确认认领，客户进入执行流程',
        actor_name: account.owner_name || '',
        occurred_at: claimedAt,
      });
    }
  }

  for (const activity of activities) {
    if (['rfq', 'quote', 'order', 'repeat_order'].includes(activity.activity_type)) continue;
    events.push({
      id: `activity:${activity.id}`,
      customer_id: activity.customer_id,
      kind: 'activity',
      event_type: activity.activity_type,
      title: TIMELINE_ACTIVITY_LABELS[activity.activity_type] || activity.activity_type || '客户活动',
      summary: activity.summary || activity.outcome || '',
      next_action: activity.next_action || '',
      actor_name: activity.user_name || '',
      occurred_at: activity.occurred_at,
    });
  }

  for (const rfq of rfqs) {
    events.push({
      id: `rfq:${rfq.id}`,
      customer_id: rfq.customer_id,
      kind: 'rfq',
      title: '收到询价',
      summary: [
        rfq.reference || rfq.id,
        `${Number(rfq.bom_lines || 0)} 行 BOM`,
        `资料完整度 ${Number(rfq.completeness || 0)}%`,
      ].join(' · '),
      actor_name: '',
      occurred_at: rfq.received_at,
    });
  }

  for (const quote of quotes) {
    events.push({
      id: `quote:${quote.id}`,
      customer_id: quote.customer_id,
      kind: 'quote',
      title: '报价已人工确认并记录',
      summary: `${Number(quote.amount || 0).toLocaleString()} ${quote.currency || 'USD'} · 毛利率 ${Number(quote.gross_margin || 0)}%`,
      actor_name: '',
      occurred_at: quote.sent_at,
    });
  }

  for (const order of orders) {
    events.push({
      id: `order:${order.id}`,
      customer_id: order.customer_id,
      kind: 'order',
      title: order.is_repeat ? '复购订单已人工确认' : '订单已人工确认',
      summary: `${Number(order.amount || 0).toLocaleString()} ${order.currency || 'USD'} · 毛利率 ${Number(order.gross_margin || 0)}%`,
      actor_name: '',
      occurred_at: order.ordered_at,
    });
  }

  if (options.includeAI !== false && accountIds.length && hasTable(value, 'crm_ai_jobs')) {
    const jobs = value.prepare(`SELECT j.*,u.name actor_name
      FROM crm_ai_jobs j LEFT JOIN sales_users u ON u.id=j.created_by
      WHERE j.crm_account_id IN (${placeholders}) AND j.station='sales_pack'
        AND j.state IN ('succeeded','needs_review')
      ORDER BY j.finished_at DESC,j.updated_at DESC`).all(...accountIds);
    for (const job of jobs) {
      events.push({
        id: `sales-pack:${job.id}`,
        customer_id: job.crm_account_id,
        kind: 'sales_pack',
        title: 'AI 销售资料包已生成',
        summary: '资料包仅供人工复核，不自动外发',
        actor_name: job.actor_name || '',
        occurred_at: job.finished_at || job.updated_at,
      });
    }
  }

  if (options.includeAI !== false
      && accountIds.length && hasTable(value, 'crm_ai_next_action_consumptions')) {
    const consumptions = value.prepare(`SELECT c.*,u.name actor_name
      FROM crm_ai_next_action_consumptions c
      LEFT JOIN sales_users u ON u.id=c.confirmed_by
      WHERE c.customer_id IN (${placeholders})
      ORDER BY c.confirmed_at DESC`).all(...accountIds);
    for (const item of consumptions) {
      const confirmed = parseJsonObject(item.confirmed_json);
      events.push({
        id: `next-action:${item.job_id}`,
        customer_id: item.customer_id,
        kind: 'next_action',
        title: '下一步建议已人工采纳',
        summary: confirmed.nextAction || '',
        next_action: confirmed.nextAction || '',
        actor_name: item.actor_name || '',
        occurred_at: item.confirmed_at,
      });
    }
  }

  return events.sort((left, right) =>
    String(right.occurred_at || '').localeCompare(String(left.occurred_at || ''))
    || String(right.id).localeCompare(String(left.id)));
}

function loadPayload(user, options = {}) {
  const value = db();
  try {
    const aiEnabled = featureState(value, options.hardFlags || resolveAIHardFlags())
      .ai_stations.effectiveEnabled;
    const scope = accountScope(user);
    const accounts = addStageLabels(value.prepare(`SELECT a.*,u.name owner_name,m.name manager_name,
      creator.name creator_name,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
      COALESCE(NULLIF(p.country,''),a.country) country,
      COALESCE(NULLIF(p.city,''),a.city) city,
      COALESCE(NULLIF(p.website,''),a.website) website,
      COALESCE(NULLIF(p.industry,''),a.industry) industry,
      COALESCE(NULLIF(p.customer_type,''),a.customer_type) customer_type,
      COALESCE(NULLIF(p.products,''),a.product_focus) product_focus,
      p.description master_description,p.current_pool,p.rating,p.best_contact_level,p.contact_recon_status,
      p.deep_report,p.source_file
      FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
      LEFT JOIN sales_users u ON u.id=a.owner_id
      LEFT JOIN sales_users creator ON creator.id=a.created_by
      LEFT JOIN sales_users m ON m.id=a.manager_id ${scope.sql}
      ORDER BY CASE a.priority WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END,a.updated_at DESC`).all(...scope.params));
    const customerIds = accounts.map(row => row.id);
    const placeholders = customerIds.length ? customerIds.map(() => '?').join(',') : "''";
    const activities = value.prepare(`SELECT x.*,u.name user_name FROM crm_activities x LEFT JOIN sales_users u ON u.id=x.user_id
      WHERE x.customer_id IN (${placeholders}) AND COALESCE(x.is_test_data,0)=0 ORDER BY x.occurred_at DESC`).all(...customerIds);
    const rfqs = value.prepare(`SELECT * FROM crm_rfqs WHERE customer_id IN (${placeholders}) ORDER BY received_at DESC`).all(...customerIds);
    const quotes = value.prepare(`SELECT * FROM crm_quotes WHERE customer_id IN (${placeholders}) ORDER BY sent_at DESC`).all(...customerIds);
    const orders = value.prepare(`SELECT * FROM crm_orders WHERE customer_id IN (${placeholders}) ORDER BY ordered_at DESC`).all(...customerIds);
    const allUsers = hydrateUsersPermissions(value, value.prepare('SELECT * FROM sales_users ORDER BY role,name').all());
    const activeUsers = allUsers.filter(row => !row.archived_at);
    const archivedUsers = allUsers.filter(row => Boolean(row.archived_at));
    const alerts = groupAlerts([...buildIntakeAlerts(value, user), ...buildAlerts(accounts, activities, rfqs, quotes)]);
    const countryReport = buildCountryReport(accounts, activities, orders);
    const cohortReport = buildCohortReport(accounts, activities, orders);
    const teamReport = buildTeamReport(activeUsers, accounts, activities, rfqs, quotes, orders);
    const insights = loadInsights(value, accounts);
    const customerEvaluationTags = aiEnabled ? accounts.map(account => ({
      customerId: account.id,
      labels: [...new Set(insights.evaluations
        .filter(row => row.customerId === account.id && row.subjectType === 'company')
        .flatMap(row => row.aiLabels || [])
        .map(safeEvaluationLabel)
        .filter(Boolean))],
    })).filter(row => row.labels.length) : [];
    const auditLog = user.role === 'admin'
      ? value.prepare(`SELECT l.*,u.name user_name,ru.name real_user_name,eu.name effective_user_name
        FROM crm_audit_log l
        LEFT JOIN sales_users u ON u.id=l.user_id
        LEFT JOIN sales_users ru ON ru.id=l.real_user_id
        LEFT JOIN sales_users eu ON eu.id=l.effective_user_id
        ORDER BY l.created_at DESC LIMIT 200`).all()
      : [];
    const migrationReview = user.role === 'admin'
      ? value.prepare("SELECT * FROM crm_migration_review WHERE resolved_at='' ORDER BY created_at,source_id LIMIT 200").all()
      : [];
    const notifications = value.prepare(`SELECT n.*,recipient.name recipient_name,
      (SELECT status FROM crm_notification_deliveries d
        WHERE d.notification_id=n.id AND d.channel='web') web_delivery_status,
      (SELECT status FROM crm_notification_deliveries d
        WHERE d.notification_id=n.id AND d.channel='wecom') wecom_delivery_status
      FROM crm_notifications n
      LEFT JOIN sales_users recipient ON recipient.id=n.user_id
      WHERE (?=1 AND n.user_id!='') OR (
        n.user_id=? AND (
          n.customer_id='' OR n.customer_id IN (${placeholders}) OR n.customer_id IN (
            SELECT external_customer_id FROM crm_intake_items WHERE assigned_owner_id=?
          )
        )
      )
      ORDER BY CASE status WHEN 'unread' THEN 0 ELSE 1 END,created_at DESC LIMIT 100`)
      .all(hasPermission(user, 'view_all_customers') ? 1 : 0, user.id, ...customerIds, user.id)
      .filter(row => aiEnabled || ![
        'SALES_PACK_READY',
        'SALES_PACK_FAILED',
        'MANAGER_ANOMALY_READY',
        'SALES_COACHING_READY',
        'AI_TASK_READY',
        'AI_TASK_FAILED',
      ].includes(row.code));
    const atLeast = stage => accounts.filter(row => hasReachedStage(row.stage, stage)).length;
    const funnel = STAGES.filter(([key]) => !['new', 'lost', 'disqualified'].includes(key)).map(([key, label]) => ({ key, label, count: atLeast(key) }));
    const wonAccounts = atLeast('won');
    const summary = {
      accounts: accounts.length,
      active: accounts.filter(row => isActivePipelineStage(row.stage)).length,
      contacted: atLeast('contacted'),
      replies: atLeast('replied'),
      meetings: atLeast('meeting'),
      rfqs: rfqs.length,
      quotes: quotes.length,
      orders: orders.length,
      overdue: alerts.filter(row => row.reasons.some(reason => reason.code === 'OVERDUE')).length,
      managerNeeded: alerts.filter(row => row.reasons.some(reason => reason.code === 'MANAGER_NEEDED')).length,
      revenue: orders.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      grossProfit: Math.round(orders.reduce((sum, row) => sum + Number(row.amount || 0) * Number(row.gross_margin || 0) / 100, 0)),
      orderRate: rate(wonAccounts, Math.max(1, rfqs.length)),
    };
    const permissions = permissionsFor(user);
    const canSeeAccounts = permissions.view_customers;
    const contactSafe = payload => permissions.view_contacts ? payload : redactContactFields(payload);
    const timeline = canSeeAccounts
      ? contactSafe(buildCustomerTimeline(
        value, accounts, activities, rfqs, quotes, orders, { includeAI: aiEnabled },
      ))
      : [];
    const intake = permissions.view_intake
      ? contactSafe(loadIntakeState(value, user, {}, { includeAI: aiEnabled }))
      : { settings: {}, stats: {}, items: [], batches: [] };
    const visibleEvaluations = aiEnabled
      ? insights.evaluations
      : insights.evaluations.map(withoutEvaluationAI);
    return {
      user: safeUser(user),
      users: permissions.view_users ? activeUsers.map(safeUser) : [safeUser(user)],
      archivedUsers: permissions.view_users ? archivedUsers.map(safeUser) : [],
      ...(permissions.view_users ? { permissionGroups: listPermissionGroups(value) } : {}),
      accounts: canSeeAccounts ? contactSafe(accounts) : [],
      activities: canSeeAccounts ? contactSafe(activities) : [],
      rfqs: canSeeAccounts ? contactSafe(rfqs) : [],
      quotes: canSeeAccounts ? contactSafe(quotes) : [],
      orders: canSeeAccounts ? contactSafe(orders) : [],
      timeline,
      alerts: permissions.view_alerts ? contactSafe(alerts) : [],
      countryReport: permissions.view_markets ? contactSafe(countryReport) : [],
      cohortReport: permissions.view_markets ? contactSafe(cohortReport) : [],
      teamReport: permissions.view_team ? contactSafe(teamReport) : [],
      funnel: permissions.view_dashboard || permissions.view_pipeline ? funnel : [],
      summary: permissions.view_dashboard ? summary : {},
      intake,
      insights: permissions.view_insights ? {
        contacts: permissions.view_contacts ? insights.contacts : [],
        evaluations: permissions.view_contacts
          ? visibleEvaluations
          : redactContactFields(visibleEvaluations.filter(row => row.subjectType === 'company')),
      } : { contacts: [], evaluations: [] },
      customerEvaluationTags: canSeeAccounts ? customerEvaluationTags : [],
      customerPool: [],
      people: [],
      reconResults: [],
      researchTotals: researchTotals(value, user, permissions),
      auditLog: permissions.view_users ? contactSafe(auditLog) : [],
      migrationReview: permissions.view_users ? contactSafe(migrationReview) : [],
      notifications: contactSafe(notifications),
      permissionDefinitions: PERMISSION_DEFINITIONS,
      permissionDescriptions: PERMISSION_DESCRIPTIONS,
      rolePermissions: ROLE_PERMISSIONS,
      stages: STAGES.map(([key, label]) => ({ key, label })),
      customerOptions: {
        customerTypes: [...CUSTOMER_TYPE_OPTIONS],
        sources: [...CUSTOMER_SOURCE_OPTIONS],
      },
      generatedAt: nowText(),
    };
  } finally { value.close(); }
}

function getAccountForUser(value, user, customerId) {
  const scope = accountScope(user);
  const scopeClause = scope.sql ? `AND ${scope.sql.replace(/^WHERE\s+/i, '')}` : '';
  const account = value.prepare(`SELECT a.* FROM crm_accounts a WHERE a.id=? ${scopeClause}`)
    .get(customerId, ...scope.params);
  if (!account) throw inaccessibleOrMissing(user, '客户不存在');
  return account;
}

function inaccessibleOrMissing(user, missingMessage) {
  const fullScope = hasPermission(user, 'view_all_customers') && hasPermission(user, 'manage_intake');
  const error = new Error(fullScope ? missingMessage : '无权访问该客户');
  error.statusCode = fullScope ? 404 : 403;
  return error;
}

function advanceStage(current, proposed) {
  if (!proposed) return current;
  if (proposed === 'lost') return proposed;
  if (current === 'lost') return proposed;
  return (STAGE_INDEX[proposed] ?? -1) > (STAGE_INDEX[current] ?? -1) ? proposed : current;
}

function enqueueNextActionForEvent(value, user, account, eventType, eventId, options = {}) {
  try {
    const hardFlags = options.hardFlags || resolveAIHardFlags();
    const features = featureState(value, hardFlags);
    const allowed = features.ai_stations.effectiveEnabled
      && ['use_ai_assistant', 'view_customers', 'view_contacts', 'record_activity']
        .every(permission => hasPermission(user, permission));
    if (!allowed || !account.external_customer_id || isFollowUpTerminalStage(account.stage)) return '';
    return enqueueNextAction({
      db: value,
      accessContext: buildAccessContext(value, user),
      actor: user,
      customerId: account.external_customer_id,
      eventType,
      eventId,
    }).id;
  } catch (_error) {
    // Business events and deterministic SLA alerts must survive AI degradation.
    return '';
  }
}

const COMMERCE_CURRENCIES = new Set(['USD', 'EUR', 'CNY', 'RUB', 'GBP']);

function validateMoney(value, label) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
    throw badRequest(`${label}必须是大于0的有效金额`);
  }
  return Math.round(amount * 100) / 100;
}

function validateCurrency(value) {
  const currency = String(value || 'USD').trim().toUpperCase();
  if (!COMMERCE_CURRENCIES.has(currency)) throw badRequest('不支持的报价或订单币种');
  return currency;
}

function validateMargin(value, allowNegative) {
  const margin = Number(value || 0);
  if (!Number.isFinite(margin) || margin < (allowNegative ? -100 : 0) || margin > 100) {
    throw badRequest('毛利率必须在有效范围内');
  }
  return Math.round(margin * 10) / 10;
}

function validateRfqPayload(payload = {}) {
  const bomLines = Number(payload.bomLines || 0);
  const expectedValue = Number(payload.expectedValue || 0);
  const completeness = Number(payload.completeness || 0);
  if (!Number.isInteger(bomLines) || bomLines < 0 || bomLines > 100000) {
    throw badRequest('BOM 行数必须是有效整数');
  }
  if (!Number.isFinite(expectedValue) || expectedValue < 0 || expectedValue > 1e12) {
    throw badRequest('询价预估金额无效');
  }
  if (!Number.isInteger(completeness) || completeness < 0 || completeness > 100) {
    throw badRequest('询价资料完整度必须为0至100');
  }
}

function commerceActionIdempotencyKey(user, action, payload, customerId) {
  const requested = String(payload.idempotencyKey || payload.clientRequestId || '').trim();
  if (requested) return requested.slice(0, 240);
  const canonical = {
    actorId: user.id,
    action,
    customerId,
    rfqId: String(payload.rfqId || ''),
    quoteId: String(payload.quoteId || ''),
    amount: String(payload.amount || ''),
    currency: String(payload.currency || ''),
    grossMargin: String(payload.grossMargin || ''),
    lossLeader: Boolean(payload.lossLeader),
    isRepeat: Boolean(payload.isRepeat),
    nextFollowAt: String(payload.nextFollowAt || ''),
    nextActionAt: String(payload.nextActionAt || ''),
  };
  return `commerce:${crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

function reserveCommerceAction(value, user, action, payload, customerId) {
  const key = commerceActionIdempotencyKey(user, action, payload, customerId);
  let existing = value.prepare('SELECT * FROM crm_commerce_action_requests WHERE idempotency_key=?').get(key);
  if (!existing) {
    const inserted = value.prepare(`INSERT OR IGNORE INTO crm_commerce_action_requests
      (idempotency_key,actor_id,action,customer_id,status,response_json,created_at,updated_at)
      VALUES (?,?,?,?, 'started','{}',?,?)`).run(key, user.id, action, customerId, nowText(), nowText());
    if (inserted.changes === 1) return { key, replay: null };
    existing = value.prepare('SELECT * FROM crm_commerce_action_requests WHERE idempotency_key=?').get(key);
  }
  if (existing.actor_id !== user.id || existing.action !== action || existing.customer_id !== customerId) {
    const error = conflictError('幂等键已绑定其他报价或订单操作', 'COMMERCE_IDEMPOTENCY_CONFLICT');
    throw error;
  }
  if (existing.status === 'completed') {
    return { key, replay: { ...json(existing.response_json, {}), deduplicated: true } };
  }
  throw conflictError('相同报价或订单操作正在处理中', 'COMMERCE_ACTION_IN_PROGRESS');
}

function completeCommerceAction(value, key, response) {
  value.prepare(`UPDATE crm_commerce_action_requests
    SET status='completed',response_json=?,updated_at=? WHERE idempotency_key=? AND status='started'`)
    .run(JSON.stringify(response), nowText(), key);
}

function clearCommerceActionReservation(value, key) {
  value.prepare("DELETE FROM crm_commerce_action_requests WHERE idempotency_key=? AND status='started'").run(key);
}

function addActivity(user, payload, options = {}) {
  assertPermission(user, 'record_activity');
  const value = db();
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const aiEnabled = featureState(value, options.hardFlags || resolveAIHardFlags())
      .ai_stations.effectiveEnabled;
    if (payload.proposalJobId && !aiEnabled) throw aiFeatureDisabled();
    const activityType = String(payload.activityType || '').trim();
    if (!activityType) throw new Error('请选择本次动作');
    const occurredAt = String(payload.occurredAt || nowText());
    const proposed = String(payload.stageAfter || ACTIVITY_STAGE[activityType] || '');
    if (proposed && !isValidStage(proposed)) throw badRequest('无效的客户阶段');
    const nextStage = advanceStage(account.stage, proposed);
    const disqualified = nextStage === 'disqualified';
    const activityId = id('ACT');
    const managerRequired = Boolean(payload.managerRequired);
    const preparedProposal = prepareActionProposalConfirmation(value, {
      jobId: payload.proposalJobId,
      actorId: user.id,
      crmAccountId: account.id,
      confirmed: payload,
    });
    if (preparedProposal?.existing) {
      return { activityId: preparedProposal.activityId, deduplicated: true };
    }
    if (activityType === 'rfq') validateRfqPayload(payload);
    const transaction = value.transaction(() => {
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        activityId, account.id, user.id, activityType, String(payload.channel || ''), String(payload.outcome || ''),
        String(payload.summary || ''), disqualified ? '' : String(payload.nextAction || ''), disqualified ? '' : String(payload.nextActionAt || ''),
        nextStage, managerRequired ? 1 : 0, occurredAt, nowText(),
      );
      value.prepare(`UPDATE crm_accounts SET stage=?,last_activity_at=?,next_action=?,next_action_at=?,
        manager_required=CASE WHEN ?=1 THEN 1 ELSE manager_required END,
        manager_status=CASE WHEN ?=1 THEN '待介入' ELSE manager_status END,updated_at=? WHERE id=?`)
        .run(nextStage, occurredAt, disqualified ? '' : String(payload.nextAction || ''), disqualified ? '' : String(payload.nextActionAt || ''), managerRequired ? 1 : 0, managerRequired ? 1 : 0, nowText(), account.id);
      if (activityType === 'rfq') {
        value.prepare(`INSERT INTO crm_rfqs
          (id,customer_id,user_id,reference,status,bom_lines,expected_value,product_category,completeness,received_at,quoted_at,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id('RFQ'), account.id, user.id, String(payload.reference || ''), 'open', Number(payload.bomLines || 0),
          Number(payload.expectedValue || 0), String(payload.productCategory || ''), Number(payload.completeness || 0),
          occurredAt, '', nowText(),
        );
      }
      if (activityType === 'manager_join') {
        value.prepare(`UPDATE crm_accounts SET manager_required=0,manager_status='已介入',manager_id=?,updated_at=? WHERE id=?`)
          .run(user.role === 'sales' ? account.manager_id : user.id, nowText(), account.id);
      }
      if (activityType === 'lost') value.prepare('UPDATE crm_accounts SET loss_reason=?,next_action=\'\',next_action_at=\'\' WHERE id=?').run(String(payload.outcome || payload.summary || '未说明'), account.id);
      if (preparedProposal) {
        confirmActionProposal(value, preparedProposal, {
          activityId,
          actorId: user.id,
        });
      }
    });
    transaction();
    const currentAccount = value.prepare('SELECT * FROM crm_accounts WHERE id=?').get(account.id);
    const nextActionJobId = activityType === 'lost' ? '' : enqueueNextActionForEvent(
      value, user, currentAccount,
      activityType === 'rfq' ? 'rfq_received' : 'activity_recorded', activityId, options,
    );
    return { activityId, deduplicated: false, nextActionJobId };
  } finally { value.close(); }
}

function addQuote(user, payload, options = {}) {
  assertPermission(user, 'record_quote');
  const value = db();
  let reservation;
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const amount = validateMoney(payload.amount, '报价金额');
    const currency = validateCurrency(payload.currency);
    const grossMargin = validateMargin(payload.grossMargin, Boolean(payload.lossLeader));
    const sentAt = String(payload.sentAt || nowText());
    const rfq = payload.rfqId ? value.prepare('SELECT * FROM crm_rfqs WHERE id=? AND customer_id=?').get(payload.rfqId, account.id)
      : value.prepare('SELECT * FROM crm_rfqs WHERE customer_id=? ORDER BY received_at DESC LIMIT 1').get(account.id);
    if (!rfq) throw new Error('请先记录客户询价');
    reservation = reserveCommerceAction(value, user, 'quote', payload, account.id);
    if (reservation.replay) return reservation.replay;
    const quoteId = id('Q');
    const transaction = value.transaction(() => {
      value.prepare(`INSERT INTO crm_quotes
        (id,rfq_id,customer_id,user_id,amount,currency,gross_margin,loss_leader,status,sent_at,next_follow_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        quoteId, rfq.id, account.id, user.id, amount, currency,
        grossMargin, payload.lossLeader ? 1 : 0, 'sent', sentAt, String(payload.nextFollowAt || ''), nowText(),
      );
      value.prepare('UPDATE crm_rfqs SET status=\'quoted\',quoted_at=? WHERE id=?').run(sentAt, rfq.id);
      value.prepare(`UPDATE crm_accounts SET stage='quoted',last_activity_at=?,next_action='报价后跟进',
        next_action_at=?,updated_at=? WHERE id=?`).run(sentAt, String(payload.nextFollowAt || ''), nowText(), account.id);
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id('ACT'), account.id, user.id, 'quote', 'email', '已发送',
        `报价 ${Number(payload.amount || 0).toLocaleString()} ${String(payload.currency || 'USD')}${payload.lossLeader ? ' · 首单引流价' : ''}`,
        '报价后跟进', String(payload.nextFollowAt || ''), 'quoted', 0, sentAt, nowText(),
      );
    });
    transaction();
    const currentAccount = value.prepare('SELECT * FROM crm_accounts WHERE id=?').get(account.id);
    const nextActionJobId = enqueueNextActionForEvent(
      value, user, currentAccount, 'quote_sent', quoteId, options,
    );
    const response = { quoteId, nextActionJobId };
    completeCommerceAction(value, reservation.key, response);
    return response;
  } catch (error) {
    if (reservation?.key) clearCommerceActionReservation(value, reservation.key);
    throw error;
  } finally { value.close(); }
}

function addOrder(user, payload) {
  assertPermission(user, 'record_order');
  const value = db();
  let reservation;
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const amount = validateMoney(payload.amount, '订单金额');
    const currency = validateCurrency(payload.currency);
    const grossMargin = validateMargin(payload.grossMargin, true);
    const quoteId = String(payload.quoteId || '').trim();
    if (!quoteId) throw new Error('订单必须关联已有报价');
    const quote = value.prepare('SELECT * FROM crm_quotes WHERE id=? AND customer_id=?').get(quoteId, account.id);
    if (!quote) throw new Error('订单关联的报价不存在或不属于该客户');
    reservation = reserveCommerceAction(value, user, 'order', payload, account.id);
    if (reservation.replay) return reservation.replay;
    const orderedAt = String(payload.orderedAt || nowText());
    const repeat = Boolean(payload.isRepeat);
    const orderId = id('ORD');
    const transaction = value.transaction(() => {
      value.prepare(`INSERT INTO crm_orders
        (id,customer_id,quote_id,user_id,amount,currency,gross_margin,is_repeat,ordered_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(orderId, account.id, quoteId, user.id, amount, currency, grossMargin, repeat ? 1 : 0, orderedAt, nowText());
      value.prepare('UPDATE crm_accounts SET stage=?,last_activity_at=?,next_action=?,next_action_at=?,updated_at=? WHERE id=?')
        .run(repeat ? 'repeat' : 'won', orderedAt, repeat ? '维护复购关系' : '首单交付与复购培育', String(payload.nextActionAt || ''), nowText(), account.id);
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id('ACT'), account.id, user.id, repeat ? 'repeat_order' : 'order', 'business', repeat ? '复购' : '首单',
        `订单 ${Number(payload.amount || 0).toLocaleString()} ${String(payload.currency || 'USD')}`,
        repeat ? '维护复购关系' : '首单交付与复购培育', String(payload.nextActionAt || ''), repeat ? 'repeat' : 'won', 0, orderedAt, nowText(),
      );
    });
    transaction();
    const response = { orderId };
    completeCommerceAction(value, reservation.key, response);
    return response;
  } catch (error) {
    if (reservation?.key) clearCommerceActionReservation(value, reservation.key);
    throw error;
  } finally { value.close(); }
}

function addAccount(user, payload, options = {}) {
  assertPermission(user, 'create_customer');
  const normalized = normalizeMinimalCustomerInput(payload);
  const customerInput = { ...payload, ...normalized };
  const value = db();
  try {
    const canManageAssignment = hasPermission(user, 'view_all_customers') && hasPermission(user, 'manage_intake');
    if (user.role !== 'sales' && !canManageAssignment) {
      throw forbidden('新增客户需要管理入库与分配权限');
    }
    const requestedOwnerId = String(customerInput.ownerId || '').trim();
    const ownerId = user.role === 'sales' || !canManageAssignment ? user.id : requestedOwnerId;
    if (ownerId && (!authorizedSalesUser(value, ownerId)
        || value.prepare("SELECT COALESCE(archived_at,'') archived_at FROM sales_users WHERE id=?").get(ownerId)?.archived_at)) {
      throw badRequest('请选择有效的在职销售负责人');
    }
    const customerId = id('CRM');
    const now = nowText();
    const transaction = value.transaction(() => {
      let externalId = String(customerInput.externalCustomerId || '').trim();
      if (externalId && !value.prepare('SELECT 1 FROM customer_pool WHERE customer_id=?').get(externalId)) throw new Error('选择的客户主档不存在');
      if (!externalId) {
        const website = customerInput.website;
        const duplicate = findExactDuplicate(value, customerInput);
        if (duplicate) {
          const error = httpError(409, '客户主档已存在', 'CUSTOMER_DUPLICATE');
          error.publicDetails = { duplicate };
          throw error;
        }
        const usedIds = new Set(value.prepare('SELECT customer_id FROM customer_pool').all().map(row => row.customer_id));
        externalId = allocateCustomerId(usedIds, normalizeCountryPrefix(customerInput.country), {});
        value.prepare(`INSERT INTO customer_pool
          (customer_id,company_name,country,city,website,industry,customer_type,products,current_pool,source_file,first_found,last_found)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          externalId, customerInput.companyName, String(customerInput.country || ''), String(customerInput.city || ''),
          website, String(customerInput.industry || ''), String(customerInput.customerType || ''), String(customerInput.productFocus || ''),
          '未分池', 'CRM手工新增', now.slice(0, 10), now.slice(0, 10),
        );
      }
      value.prepare(`INSERT INTO crm_accounts
        (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,product_focus,priority,potential_value,stage,owner_id,created_by,manager_id,manager_required,manager_status,last_activity_at,next_action,next_action_at,loss_reason,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        customerId, externalId, customerInput.companyName, String(customerInput.country || ''),
        String(customerInput.city || ''), customerInput.website, String(customerInput.industry || ''), String(customerInput.customerType || ''),
        String(customerInput.source || ''), String(customerInput.productFocus || ''), String(customerInput.priority || 'B'), Number(customerInput.potentialValue || 0),
        String(customerInput.stage || 'qualified'), ownerId || null, user.id, String(customerInput.managerId || 'USR-MGR'), 0, '', '', String(customerInput.nextAction || '完成首次触达'),
        String(customerInput.nextActionAt || dateOffset(1)), '', now, now,
      );
      const provenance = createEnrichmentEvidenceStore(value);
      const confirmedFields = [
        ...(!customerInput.provisionalCompanyName
          ? [{ fieldName: 'company_name', value: customerInput.companyName }] : []),
        ...(customerInput.website ? [{ fieldName: 'website', value: customerInput.website }] : []),
        ...(String(customerInput.country || '').trim()
          ? [{ fieldName: 'country', value: String(customerInput.country).trim() }] : []),
      ];
      for (const field of confirmedFields) {
        provenance.setFieldProvenance({
          customerId: externalId,
          crmAccountId: customerId,
          targetType: 'crm_account',
          targetId: customerId,
          fieldName: field.fieldName,
          value: field.value,
          sourceState: 'employee_confirmed',
          confirmedBy: user.id,
        });
      }
      const enrichment = createEnrichmentTrigger(
        value,
        user,
        { customerId, externalCustomerId: externalId },
        customerInput,
        {
        flags: options.enrichmentFlags,
        permissionCheck: hasPermission,
        },
      );
      return { externalCustomerId: externalId, enrichment };
    });
    const result = transaction.immediate();
    return { customerId, ...result };
  } finally { value.close(); }
}

function updateAccount(user, customerId, payload) {
  assertPermission(user, 'edit_customer');
  const value = db();
  try {
    const account = getAccountForUser(value, user, customerId);
    const fields = [];
    const params = [];
    let changedOwnerId;
    const allowed = {
      source: 'source', priority: 'priority', potentialValue: 'potential_value',
      nextAction: 'next_action', nextActionAt: 'next_action_at', managerRequired: 'manager_required',
      managerStatus: 'manager_status', lossReason: 'loss_reason',
      country: 'country', city: 'city', website: 'website', industry: 'industry',
      customerType: 'customer_type', productFocus: 'product_focus',
    };
    for (const [key, column] of Object.entries(allowed)) {
      if (payload[key] === undefined) continue;
      fields.push(`${column}=?`);
      params.push(key === 'managerRequired' ? (payload[key] ? 1 : 0) : payload[key]);
    }
    if (payload.ownerId !== undefined) {
      const ownerId = String(payload.ownerId || '').trim();
      if (ownerId !== String(account.owner_id || '')) {
        if (!hasPermission(user, 'view_all_customers') || !hasPermission(user, 'manage_intake')) {
          throw forbidden('没有管理入库与分配权限');
        }
        if (ownerId && (!authorizedSalesUser(value, ownerId)
            || value.prepare("SELECT COALESCE(archived_at,'') archived_at FROM sales_users WHERE id=?").get(ownerId)?.archived_at)) {
          throw badRequest('请选择有效的在职销售负责人');
        }
        fields.push('owner_id=?');
        params.push(ownerId || null);
        fields.push('assignment_status=?', 'assigned_at=?', "return_reason=''");
        params.push(ownerId ? 'claimed' : 'unassigned', ownerId ? nowText() : '');
        changedOwnerId = ownerId;
      }
    }
    if (payload.stage !== undefined) {
      if (!isValidStage(payload.stage)) throw badRequest('无效的客户阶段');
      fields.push('stage=?');
      params.push(payload.stage);
      if (payload.stage === 'disqualified') {
        fields.push("next_action=''", "next_action_at=''");
      }
    }
    const masterAllowed = { country: 'country', city: 'city', website: 'website', industry: 'industry', customerType: 'customer_type', productFocus: 'products' };
    const masterFields = [], masterParams = [];
    for (const [key, column] of Object.entries(masterAllowed)) {
      if (payload[key] === undefined) continue;
      masterFields.push(`${column}=?`); masterParams.push(payload[key]);
    }
    if (!fields.length && !masterFields.length) return { customerId: account.id };
    const transaction = value.transaction(() => {
      if (fields.length) {
        fields.push('updated_at=?'); params.push(nowText(), account.id);
        value.prepare(`UPDATE crm_accounts SET ${fields.join(',')} WHERE id=?`).run(...params);
      }
      if (changedOwnerId !== undefined && account.intake_item_id) {
        value.prepare(`UPDATE crm_intake_items SET assigned_owner_id=?,status=?,assigned_at=?,updated_at=?
          WHERE id=?`).run(
          changedOwnerId, changedOwnerId ? 'claimed' : 'approved',
          changedOwnerId ? nowText() : '', nowText(), account.intake_item_id,
        );
      }
      if (masterFields.length && account.external_customer_id) {
        masterParams.push(account.external_customer_id);
        value.prepare(`UPDATE customer_pool SET ${masterFields.join(',')} WHERE customer_id=?`).run(...masterParams);
      }
    });
    transaction();
    return { customerId: account.id };
  } finally { value.close(); }
}

function bulkAssignAccounts(user, payload) {
  for (const permission of ['view_customers', 'edit_customer', 'view_all_customers', 'manage_intake']) {
    assertPermission(user, permission);
  }
  const customerIds = [...new Set((Array.isArray(payload.customerIds) ? payload.customerIds : [])
    .map(item => String(item || '').trim()).filter(Boolean))];
  if (!customerIds.length) throw badRequest('请选择客户');
  if (customerIds.length > 500) throw badRequest('一次最多处理500个客户');
  const ownerId = String(payload.ownerId || '').trim();
  if (!ownerId) throw badRequest('批量设置负责人必须选择有效的销售；退回客户请使用批量退回');
  const value = db();
  try {
    return value.transaction(() => {
      if (ownerId && !value.prepare("SELECT 1 FROM sales_users WHERE id=? AND role='sales' AND active=1 AND COALESCE(archived_at,'')=''").get(ownerId)) {
        throw badRequest('目标销售已停用或不存在');
      }
      const placeholders = customerIds.map(() => '?').join(',');
      const rows = value.prepare(`SELECT id FROM crm_accounts
        WHERE id IN (${placeholders}) AND COALESCE(lifecycle_status,'active')='active'`).all(...customerIds);
      if (rows.length !== customerIds.length) throw notFound('部分客户不存在');
      const context = buildAccessContext(value, user);
      if (customerIds.some(customerId => !context.accountIds.has(customerId))) throw forbidden('批量操作包含无权访问的客户');
      const now = nowText();
      value.prepare(`UPDATE crm_accounts
        SET owner_id=?,assignment_status=?,assigned_at=?,updated_at=?
        WHERE id IN (${placeholders})`).run(
        ownerId || null, ownerId ? 'claimed' : 'unassigned', ownerId ? now : '', now, ...customerIds,
      );
      value.prepare(`UPDATE crm_intake_items SET
        assigned_owner_id=?,status=?,assigned_at=?,updated_at=?
        WHERE crm_customer_id IN (${placeholders})`).run(
        ownerId, ownerId ? 'claimed' : 'approved', ownerId ? now : '', now, ...customerIds,
      );
      return { updated: customerIds.length, ownerId };
    }).immediate();
  } finally { value.close(); }
}

function recycleError(statusCode, message, code) {
  return httpError(statusCode, message, code);
}

function validateRecycleReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 2 || reason.length > 500) {
    throw recycleError(400, '退回或删除原因必须为2至500个字符', 'INVALID_RECYCLE_REASON');
  }
  return reason;
}

function recordRecycleAudit(value, user, identity, action, accountId, detail = {}) {
  const realUserId = identity?.realUserId || user.id;
  const effectiveUserId = identity?.effectiveUserId || user.id;
  value.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id('AUD'), effectiveUserId, action, 'crm_account', accountId,
    JSON.stringify(redactAuditPayload(detail)), nowText(), realUserId, effectiveUserId, identity?.contextId || '',
  );
}

function accountForReturn(value, user, customerId) {
  const fullScope = hasPermission(user, 'view_all_customers');
  const account = fullScope
    ? value.prepare('SELECT * FROM crm_accounts WHERE id=?').get(customerId)
    : value.prepare(`SELECT * FROM crm_accounts
      WHERE id=? AND (owner_id=? OR previous_owner_id=?)`).get(customerId, user.id, user.id);
  if (!account) throw recycleError(404, '客户不存在或无权访问', 'CUSTOMER_NOT_FOUND');
  return account;
}

function activeAccountForRecycle(value, user, customerId) {
  const scope = accountScope(user);
  const clause = scope.sql ? `AND ${scope.sql.replace(/^WHERE\s+/i, '')}` : '';
  const account = value.prepare(`SELECT a.* FROM crm_accounts a WHERE a.id=? ${clause}`)
    .get(customerId, ...scope.params);
  if (!account) throw recycleError(404, '客户不存在或无权访问', 'CUSTOMER_NOT_FOUND');
  return account;
}

function assertCustomerReturnEligible(account) {
  const assignmentStatus = String(account?.assignment_status || '');
  if (assignmentStatus === 'returned'
      || String(account?.lifecycle_status || 'active') !== 'active') {
    throw recycleError(
      409,
      '客户当前状态不可退回',
      'CUSTOMER_RETURN_STATE_INVALID',
    );
  }
  if (!String(account?.owner_id || '').trim()) {
    throw recycleError(
      409,
      '未分配客户不可退回',
      'CUSTOMER_RETURN_OWNER_REQUIRED',
    );
  }
  if (!['assigned', 'claimed'].includes(assignmentStatus)) {
    throw recycleError(
      409,
      '仅已分配或已领取客户可以退回',
      'CUSTOMER_RETURN_STATE_INVALID',
    );
  }
  return account;
}

function updateReturnedIntake(value, account, reason) {
  if (!account.intake_item_id && !account.id) return;
  value.prepare(`UPDATE crm_intake_items SET status='returned',assigned_owner_id='',
    suggested_owner_id='',assigned_at='',claim_due_at='',claimed_at='',
    return_reason=?,updated_at=? WHERE id=? OR crm_customer_id=?`)
    .run(reason, nowText(), account.intake_item_id || '', account.id || '');
}

function returnCustomer(user, customerId, payload = {}, identity = {}) {
  const reason = validateRecycleReason(payload.reason);
  if (user.role !== 'sales') assertPermission(user, 'manage_customer_recycle');
  const value = db();
  try {
    return value.transaction(() => {
      const account = assertCustomerReturnEligible(accountForReturn(value, user, customerId));
      if (user.role === 'sales' && account.owner_id !== user.id) {
        throw recycleError(403, '只能退回自己负责的客户', 'CUSTOMER_RECYCLE_FORBIDDEN');
      }
      const recycledAt = nowText();
      value.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='sales_return',
        recycle_reason=?,recycled_by=?,recycled_at=?,previous_owner_id=?,owner_id=NULL,
        assignment_status='returned',return_reason=?,updated_at=? WHERE id=?
        AND COALESCE(lifecycle_status,'active')='active'
        AND owner_id IS NOT NULL AND TRIM(owner_id)!=''
        AND assignment_status IN ('assigned','claimed')`).run(
        reason, user.id, recycledAt, account.owner_id || '', reason, recycledAt, account.id,
      );
      updateReturnedIntake(value, account, reason);
      recordRecycleAudit(value, user, identity, 'customer_returned', account.id, {
        recycleKind: 'sales_return', previousOwnerId: account.owner_id || '', reason,
      });
      return { customerId: account.id, recycled: true, recycleKind: 'sales_return' };
    }).immediate();
  } finally { value.close(); }
}

function bulkReturnCustomers(user, payload = {}, identity = {}) {
  assertPermission(user, 'manage_customer_recycle');
  const customerIds = [...new Set((Array.isArray(payload.customerIds) ? payload.customerIds : [])
    .map(item => String(item || '').trim()).filter(Boolean))];
  if (!customerIds.length) throw badRequest('请选择客户');
  if (customerIds.length > 500) throw badRequest('一次最多退回500个客户');
  const reason = validateRecycleReason(payload.reason);
  const value = db();
  try {
    return value.transaction(() => {
      const accounts = customerIds.map(customerId =>
        assertCustomerReturnEligible(accountForReturn(value, user, customerId)));
      const recycledAt = nowText();
      for (const account of accounts) {
        const updated = value.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='sales_return',
          recycle_reason=?,recycled_by=?,recycled_at=?,previous_owner_id=?,owner_id=NULL,
          assignment_status='returned',return_reason=?,updated_at=? WHERE id=?
          AND COALESCE(lifecycle_status,'active')='active'
          AND owner_id IS NOT NULL AND TRIM(owner_id)!=''
          AND assignment_status IN ('assigned','claimed')`).run(
          reason, user.id, recycledAt, account.owner_id || '', reason, recycledAt, account.id,
        );
        if (updated.changes !== 1) {
          throw recycleError(
            409,
            '部分客户状态已变化，请刷新后重试',
            'CUSTOMER_RETURN_STATE_INVALID',
          );
        }
        updateReturnedIntake(value, account, reason);
        recordRecycleAudit(value, user, identity, 'customer_bulk_returned', account.id, {
          recycleKind: 'sales_return', previousOwnerId: account.owner_id || '', reason, batchSize: accounts.length,
        });
      }
      return { updated: accounts.length, recycled: accounts.length };
    }).immediate();
  } finally { value.close(); }
}

function listRecycleBin(user, query = {}) {
  assertPermission(user, 'manage_customer_recycle');
  const { page, pageSize, offset, search } = normalizeListQuery(query);
  const kind = String(query.kind || 'sales_return');
  if (!['sales_return', 'manual_delete'].includes(kind)) {
    throw recycleError(400, '不支持的回收类型', 'INVALID_RECYCLE_KIND');
  }
  const value = db();
  try {
    const conditions = ["COALESCE(a.lifecycle_status,'active')='recycled'", 'a.recycle_kind=?'];
    const params = [kind];
    if (!hasPermission(user, 'view_all_customers')) {
      conditions.push('(a.previous_owner_id=? OR a.recycled_by=?)');
      params.push(user.id, user.id);
    }
    if (search) {
      const like = `%${search}%`;
      conditions.push('(a.id LIKE ? OR a.external_customer_id LIKE ? OR a.company_name LIKE ? OR a.country LIKE ?)');
      params.push(like, like, like, like);
    }
    const where = conditions.join(' AND ');
    const total = Number(value.prepare(`SELECT COUNT(*) total FROM crm_accounts a WHERE ${where}`).get(...params).total || 0);
    const rows = value.prepare(`SELECT a.id,a.external_customer_id,a.company_name,a.country,a.stage,
      a.previous_owner_id,a.recycle_kind,a.recycle_reason,a.recycled_by,a.recycled_at,
      owner.name previous_owner_name,actor.name recycled_by_name
      FROM crm_accounts a
      LEFT JOIN sales_users owner ON owner.id=a.previous_owner_id
      LEFT JOIN sales_users actor ON actor.id=a.recycled_by
      WHERE ${where} ORDER BY a.recycled_at DESC,a.id LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset)
      .map(row => ({
        customerId: row.id,
        externalCustomerId: row.external_customer_id,
        companyName: row.company_name,
        country: row.country,
        stage: row.stage,
        previousOwnerId: row.previous_owner_id || '',
        previousOwnerName: row.previous_owner_name || '未分配',
        recycleKind: row.recycle_kind,
        reason: row.recycle_reason,
        recycledBy: row.recycled_by,
        recycledByName: row.recycled_by_name || row.recycled_by,
        recycledAt: row.recycled_at,
        actions: row.recycle_kind === 'sales_return' ? ['reassign'] : ['restore'],
      }));
    return { rows, page, pageSize, total, hasMore: offset + rows.length < total, kind };
  } finally { value.close(); }
}

function trashManualCustomer(user, customerId, payload = {}, identity = {}) {
  assertPermission(user, 'manage_manual_customer_deletion');
  const reason = validateRecycleReason(payload.reason);
  const value = db();
  try {
    return value.transaction(() => {
      const account = activeAccountForRecycle(value, user, customerId);
      const source = account.external_customer_id
        ? value.prepare('SELECT source_file FROM customer_pool WHERE customer_id=?').get(account.external_customer_id)
        : null;
      if (account.intake_item_id || source?.source_file !== 'CRM手工新增') {
        throw recycleError(409, '目标不是可移入回收站的手工客户', 'MANUAL_CUSTOMER_REQUIRED');
      }
      const recycledAt = nowText();
      value.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='manual_delete',
        recycle_reason=?,recycled_by=?,recycled_at=?,previous_owner_id=?,owner_id=NULL,
        assignment_status='returned',updated_at=? WHERE id=?`).run(
        reason, user.id, recycledAt, account.owner_id || '', recycledAt, account.id,
      );
      recordRecycleAudit(value, user, identity, 'customer_trashed', account.id, {
        recycleKind: 'manual_delete', previousOwnerId: account.owner_id || '', reason,
      });
      return { customerId: account.id, recycled: true, recycleKind: 'manual_delete' };
    }).immediate();
  } finally { value.close(); }
}

function restoreManualCustomer(user, customerId, identity = {}) {
  assertPermission(user, 'manage_manual_customer_deletion');
  const value = db();
  try {
    return value.transaction(() => {
      const account = value.prepare("SELECT * FROM crm_accounts WHERE id=? AND COALESCE(lifecycle_status,'active')='recycled'").get(customerId);
      if (!account) throw recycleError(404, '客户不存在或不在回收站', 'CUSTOMER_NOT_FOUND');
      if (account.recycle_kind !== 'manual_delete') {
        throw recycleError(409, '该客户不是手工删除类型', 'RECYCLE_KIND_MISMATCH');
      }
      const owner = account.previous_owner_id
        ? value.prepare("SELECT id FROM sales_users WHERE id=? AND role='sales' AND active=1 AND COALESCE(archived_at,'')=''").get(account.previous_owner_id)
        : null;
      const ownerId = owner?.id || null;
      const restoredAt = nowText();
      value.prepare(`UPDATE crm_accounts SET lifecycle_status='active',recycle_kind='',recycle_reason='',
        recycled_by='',recycled_at='',previous_owner_id='',owner_id=?,assignment_status=?,
        return_reason='',updated_at=? WHERE id=?`).run(
        ownerId, ownerId ? 'claimed' : 'unassigned', restoredAt, account.id,
      );
      recordRecycleAudit(value, user, identity, 'customer_restored', account.id, {
        recycleKind: 'manual_delete', restoredOwnerId: ownerId || '', reason: account.recycle_reason || '',
      });
      return { customerId: account.id, restored: true, ownerId: ownerId || '' };
    }).immediate();
  } finally { value.close(); }
}

function reassignReturnedCustomer(user, customerId, payload = {}, identity = {}) {
  assertPermission(user, 'manage_customer_recycle');
  const ownerId = String(payload.ownerId || '').trim();
  if (!ownerId) throw badRequest('请选择有效的销售负责人');
  const reason = validateRecycleReason(payload.reason);
  const value = db();
  try {
    return value.transaction(() => {
      const account = value.prepare("SELECT * FROM crm_accounts WHERE id=? AND COALESCE(lifecycle_status,'active')='recycled'").get(customerId);
      if (!account) throw recycleError(404, '客户不存在或不在回收站', 'CUSTOMER_NOT_FOUND');
      if (account.recycle_kind !== 'sales_return') {
        throw recycleError(409, '该客户不是销售退回类型', 'RECYCLE_KIND_MISMATCH');
      }
      const owner = value.prepare("SELECT id FROM sales_users WHERE id=? AND role='sales' AND active=1 AND COALESCE(archived_at,'')=''").get(ownerId);
      if (!owner) throw badRequest('目标销售已停用或不存在');
      const assignedAt = nowText();
      const settings = value.prepare("SELECT claim_sla_hours FROM crm_intake_settings WHERE id='default'").get();
      const claimDue = nowText(new Date(Date.now() + Number(settings?.claim_sla_hours || 24) * 3600000));
      value.prepare(`UPDATE crm_accounts SET lifecycle_status='active',recycle_kind='',recycle_reason='',
        recycled_by='',recycled_at='',previous_owner_id='',owner_id=?,assignment_status='assigned',
        assigned_at=?,claim_due_at=?,claimed_at='',return_reason='',updated_at=? WHERE id=?`).run(
        ownerId, assignedAt, claimDue, assignedAt, account.id,
      );
      if (account.intake_item_id) {
        value.prepare(`UPDATE crm_intake_items SET status='assigned',assigned_owner_id=?,
          assigned_at=?,claim_due_at=?,claimed_at='',return_reason='',updated_at=? WHERE id=?`).run(
          ownerId, assignedAt, claimDue, assignedAt, account.intake_item_id,
        );
      }
      recordRecycleAudit(value, user, identity, 'customer_reassigned', account.id, {
        recycleKind: 'sales_return', previousOwnerId: account.previous_owner_id || '', ownerId, reason,
      });
      return { customerId: account.id, restored: true, ownerId, assignedAt, claimDueAt: claimDue };
    }).immediate();
  } finally { value.close(); }
}

const USER_REFERENCE_SPECS = [
  ['负责客户', 'crm_accounts', 'owner_id'],
  ['创建客户', 'crm_accounts', 'created_by'],
  ['管理客户', 'crm_accounts', 'manager_id'],
  ['跟进活动', 'crm_activities', 'user_id'],
  ['询价记录', 'crm_rfqs', 'user_id'],
  ['报价记录', 'crm_quotes', 'user_id'],
  ['订单记录', 'crm_orders', 'user_id'],
  ['联系人记录', 'crm_account_contacts', 'created_by'],
  ['经理评价', 'crm_manager_evaluations', 'author_id'],
  ['导入批次', 'crm_intake_batches', 'created_by'],
  ['待分配线索', 'crm_intake_items', 'assigned_owner_id'],
  ['建议分配线索', 'crm_intake_items', 'suggested_owner_id'],
  ['通知记录', 'crm_notifications', 'user_id'],
  ['审计记录', 'crm_audit_log', 'user_id'],
  ['审计记录', 'crm_audit_log', 'real_user_id'],
  ['审计记录', 'crm_audit_log', 'effective_user_id'],
  ['数据维护记录', 'crm_data_maintenance_runs', 'real_user_id'],
  ['Prospect任务', 'prospect_tasks', 'created_by'],
  ['AI运行配置', 'assistant_runtime_settings', 'updated_by'],
  ['入库配置', 'crm_intake_settings', 'updated_by'],
  ['企业微信绑定', 'wecom_user_bindings', 'crm_user_id'],
  ['企业微信任务', 'wecom_bot_tasks', 'crm_user_id'],
];

function userReferenceReasons(value, userId) {
  return USER_REFERENCE_SPECS.flatMap(([label, table, column]) => {
    const columns = value.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(item => item.name === column)) return [];
    const count = Number(value.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${column}=?`).get(userId).n || 0);
    return count ? [{ label, count }] : [];
  });
}

function archiveUser(actor, userId) {
  if (actor.role !== 'admin') throw forbidden('只有管理员可以归档用户');
  if (actor.id === userId) throw badRequest('不能归档当前账号');
  const value = db();
  try {
    return value.transaction(() => {
      const user = value.prepare('SELECT * FROM sales_users WHERE id=?').get(userId);
      if (!user) throw notFound('用户不存在');
      if (user.archived_at) return { userId, archived: true };
      const archivedAt = nowText();
      value.prepare('UPDATE sales_users SET active=0,archived_at=?,updated_at=? WHERE id=?')
        .run(archivedAt, archivedAt, userId);
      value.prepare('DELETE FROM sales_sessions WHERE user_id=?').run(userId);
      assertValidAdminRemains(value);
      return { userId, archived: true, archivedAt };
    }).immediate();
  } finally { value.close(); }
}

function restoreUser(actor, userId) {
  if (actor.role !== 'admin') throw forbidden('只有管理员可以恢复用户');
  const value = db();
  try {
    return value.transaction(() => {
      const user = value.prepare('SELECT * FROM sales_users WHERE id=?').get(userId);
      if (!user) throw notFound('用户不存在');
      if (!user.archived_at) throw badRequest('该用户未归档');
      value.prepare("UPDATE sales_users SET active=1,archived_at='',updated_at=? WHERE id=?")
        .run(nowText(), userId);
      assertValidAdminRemains(value);
      return { userId, restored: true };
    }).immediate();
  } finally { value.close(); }
}

function deleteArchivedUser(actor, userId) {
  if (actor.role !== 'admin') throw forbidden('只有管理员可以永久删除用户');
  if (actor.id === userId) throw badRequest('不能删除当前账号');
  const value = db();
  try {
    return value.transaction(() => {
      const user = value.prepare('SELECT * FROM sales_users WHERE id=?').get(userId);
      if (!user) throw notFound('用户不存在');
      if (!user.archived_at) throw badRequest('只有已归档用户可以永久删除');
      const reasons = userReferenceReasons(value, userId);
      if (reasons.length) {
        const error = httpError(409, '该用户仍有历史业务引用，不能永久删除', 'USER_REFERENCED');
        error.publicDetails = { references: reasons };
        throw error;
      }
      value.prepare('DELETE FROM sales_sessions WHERE user_id=?').run(userId);
      value.prepare('DELETE FROM user_permission_overrides WHERE user_id=?').run(userId);
      value.prepare('DELETE FROM sales_users WHERE id=?').run(userId);
      assertValidAdminRemains(value);
      return { userId, deleted: true };
    }).immediate();
  } finally { value.close(); }
}

function exportCrmData(user, query = {}, options = {}) {
  assertPermission(user, 'export_data');
  assertPermission(user, 'view_customers');
  const value = db();
  try {
    const aiEnabled = featureState(value, options.hardFlags || resolveAIHardFlags())
      .ai_stations.effectiveEnabled;
    const scope = accountScope(user);
    const filters = [scope.sql.replace(/^WHERE\s+/i, '')];
    const params = [...scope.params];
    const customerQuery = buildCustomerQuery(query, {
      user,
      canViewContacts: hasPermission(user, 'view_contacts'),
    });
    filters.push(...customerQuery.filters);
    params.push(...customerQuery.params);
    const authorizedTotal = Number(value.prepare(`SELECT COUNT(*) total FROM crm_accounts a
      ${scope.sql}`).get(...scope.params).total || 0);
    const accounts = addStageLabels(value.prepare(`SELECT a.*,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
      COALESCE(NULLIF(p.country,''),a.country) country,
      COALESCE(NULLIF(p.city,''),a.city) city,
      COALESCE(NULLIF(p.website,''),a.website) website,
      COALESCE(NULLIF(p.industry,''),a.industry) industry,
      COALESCE(NULLIF(p.customer_type,''),a.customer_type) customer_type,
      COALESCE(NULLIF(p.products,''),a.product_focus) product_focus,
      owner.name owner_name,creator.name creator_name
      FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
      LEFT JOIN sales_users owner ON owner.id=a.owner_id
      LEFT JOIN sales_users creator ON creator.id=a.created_by
      WHERE ${filters.join(' AND ')} ORDER BY ${customerQuery.orderBy}`).all(...params).map(row => ({
        ...row,
        ownerId: row.owner_id || '',
        ownerName: row.owner_name || '',
        createdById: row.created_by || '',
        createdByName: row.creator_name || '历史数据',
      })));
    const customerIds = accounts.map(row => row.id);
    const linked = table => {
      if (!customerIds.length) return [];
      const placeholders = customerIds.map(() => '?').join(',');
      return value.prepare(`SELECT * FROM ${table} WHERE customer_id IN (${placeholders}) ORDER BY customer_id`).all(...customerIds);
    };
    const users = hydrateUsersPermissions(value, value.prepare('SELECT * FROM sales_users ORDER BY role,name').all())
      .map(row => ({
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        active: Boolean(row.active),
        archived: Boolean(row.archived_at),
        permissionGroupId: row.permission_group_id || '',
        permissions: permissionsFor(row),
        createdAt: row.created_at,
      }));
    const contactsAllowed = hasPermission(user, 'view_contacts');
    const evaluations = linked('crm_manager_evaluations')
      .filter(row => contactsAllowed || row.subject_type === 'company')
      .map(row => aiEnabled ? row : withoutEvaluationAIRow(row));
    return {
      schemaVersion: 1,
      exportedAt: nowText(),
      currentTotal: accounts.length,
      authorizedTotal,
      users,
      customers: accounts,
      contacts: contactsAllowed ? linked('crm_account_contacts') : [],
      activities: linked('crm_activities'),
      rfqs: linked('crm_rfqs'),
      quotes: linked('crm_quotes'),
      orders: linked('crm_orders'),
      evaluations,
    };
  } finally { value.close(); }
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCrmCsv(user, query = {}, options = {}) {
  const value = exportCrmData(user, query, options);
  const headers = ['客户', '客户编码', '国家', '行业', '阶段', '负责人', '优先级', '潜在金额', '最近动作', '下一步'];
  const rows = value.customers.map(row => [
    row.company_name, row.external_customer_id, row.country, row.industry, row.stageLabel,
    row.ownerName, row.priority, row.potential_value, row.last_activity_at, row.next_action,
  ]);
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function createUser(actor, payload) {
  assertPermission(actor, 'view_users');
  assertPermission(actor, 'manage_users');
  if (actor.role !== 'admin') {
    const error = new Error('只有管理员可以新增用户');
    error.statusCode = 403;
    throw error;
  }
  const email = String(payload.email || '').trim().toLowerCase();
  const generatedPassword = !String(payload.password || '').trim()
    ? `Tp-${crypto.randomBytes(9).toString('base64url')}`
    : '';
  const password = String(payload.password || generatedPassword);
  const initialMustChange = generatedPassword ? 1 : 0;
  if (!email.includes('@')) throw new Error('请输入有效邮箱');
  if (password.length < 8) throw new Error('初始密码至少8位');
  if (payload.permissions !== undefined) throw badRequest('请通过权限组管理权限');
  const role = ['admin', 'manager', 'sales'].includes(payload.role) ? payload.role : 'sales';
  const value = db();
  try {
    const permissionGroupId = String(payload.permissionGroupId || '');
    if (!permissionGroupId) throw badRequest('请选择权限组');
    const group = value.prepare('SELECT id,role_key FROM permission_groups WHERE id=?').get(permissionGroupId);
    if (!group) throw notFound('权限组不存在');
    if (group.role_key !== role) throw badRequest('权限组角色与账号角色不匹配');
    const pw = hashPassword(password);
    const userId = id('USR');
    const now = nowText();
    value.transaction(() => {
      value.prepare(`INSERT INTO sales_users
        (id,email,name,role,password_hash,password_salt,active,must_change_password,languages_json,countries_json,channels_json,permission_group_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,1,${initialMustChange},?,?,?,?,?,?)`).run(
        userId, email, String(payload.name || email), role, pw.hash, pw.salt,
        JSON.stringify(payload.languages || []), JSON.stringify(payload.countries || []), JSON.stringify(payload.channels || []),
        group.id, now, now,
      );
    })();
    return { userId, temporaryPassword: generatedPassword || undefined };
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('该邮箱已经存在');
    throw error;
  } finally { value.close(); }
}

function updateUser(actor, userId, payload) {
  assertPermission(actor, 'view_users');
  assertPermission(actor, 'manage_users');
  if (actor.role !== 'admin') throw forbidden('只有管理员可以管理用户');
  const allowed = new Set(['name', 'role', 'active', 'permissionGroupId', 'languages', 'countries', 'channels']);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw badRequest(`不支持的账号字段：${key}`);
  }
  if (payload.role !== undefined && payload.permissionGroupId === undefined) {
    throw badRequest('修改角色时必须同时选择权限组');
  }
  const value = db();
  try {
    const user = value.prepare('SELECT * FROM sales_users WHERE id=?').get(userId);
    if (!user) throw notFound('用户不存在');
    if (user.archived_at) throw badRequest('请先恢复归档用户');
    const fields = [], params = [];
    for (const [key, column] of Object.entries({ name: 'name', active: 'active' })) {
      if (payload[key] === undefined) continue;
      if (key === 'active' && typeof payload[key] !== 'boolean') throw badRequest('账号状态必须为布尔值');
      fields.push(`${column}=?`);
      params.push(key === 'active' ? (payload[key] ? 1 : 0) : payload[key]);
    }
    const role = payload.role === undefined ? user.role : String(payload.role);
    if (!['admin', 'manager', 'sales'].includes(role)) throw badRequest('请选择有效角色');
    if (payload.permissionGroupId !== undefined) {
      const group = value.prepare('SELECT id,role_key FROM permission_groups WHERE id=?').get(String(payload.permissionGroupId));
      if (!group) throw notFound('权限组不存在');
      if (group.role_key !== role) throw badRequest('权限组角色与账号角色不匹配');
      fields.push('permission_group_id=?');
      params.push(group.id);
    }
    if (payload.role !== undefined) {
      fields.push('role=?');
      params.push(role);
    }
    for (const [key, column] of Object.entries({ languages: 'languages_json', countries: 'countries_json', channels: 'channels_json' })) {
      if (payload[key] === undefined) continue;
      if (!Array.isArray(payload[key])) throw badRequest(`${key}必须是数组`);
      fields.push(`${column}=?`);
      params.push(JSON.stringify(payload[key] || []));
    }
    if (!fields.length) return { userId };
    const now = nowText();
    value.transaction(() => {
      value.prepare(`UPDATE sales_users SET ${[...fields, 'updated_at=?'].join(',')} WHERE id=?`)
        .run(...params, now, userId);
      assertValidAdminRemains(value);
    })();
    return { userId };
  } finally { value.close(); }
}

function changePassword(user, payload) {
  const oldPassword = String(payload.oldPassword || '');
  const newPassword = String(payload.newPassword || '');
  if (newPassword.length < 8) throw new Error('新密码至少8位');
  const value = db();
  try {
    const row = value.prepare('SELECT * FROM sales_users WHERE id=? AND active=1').get(user.id);
    const candidate = hashPassword(oldPassword, row.password_salt).hash;
    const a = Buffer.from(candidate, 'hex'), b = Buffer.from(row.password_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('当前密码不正确');
    const pw = hashPassword(newPassword);
    value.prepare('UPDATE sales_users SET password_hash=?,password_salt=?,must_change_password=0,updated_at=? WHERE id=?')
      .run(pw.hash, pw.salt, nowText(), user.id);
    value.prepare('DELETE FROM sales_sessions WHERE user_id=?').run(user.id);
    return { changed: true };
  } finally { value.close(); }
}

function resetUserPassword(actor, userId, payload) {
  assertPermission(actor, 'view_users');
  assertPermission(actor, 'manage_users');
  if (actor.role !== 'admin') throw forbidden('只有管理员可以重置密码');
  if (actor.id === userId) throw badRequest('请使用本人修改密码功能');
  const password = String(payload.password || '');
  if (password !== String(payload.passwordConfirm || '')) throw badRequest('两次输入的新密码不一致');
  if (password.length < 8) throw badRequest('新密码至少8位');
  const value = db();
  try {
    value.transaction(() => {
      const target = value.prepare('SELECT archived_at FROM sales_users WHERE id=?').get(userId);
      if (!target) throw notFound('用户不存在');
      if (target.archived_at) throw badRequest('请先恢复归档用户');
      const pw = hashPassword(password);
      value.prepare('UPDATE sales_users SET password_hash=?,password_salt=?,must_change_password=0,updated_at=? WHERE id=?')
        .run(pw.hash, pw.salt, nowText(), userId);
      value.prepare('DELETE FROM sales_sessions WHERE user_id=?').run(userId);
    })();
    return { userId, changed: true };
  } finally { value.close(); }
}

function logRequestTiming(name, req, res, startedAt, detail = () => ({})) {
  res.on('finish', () => {
    const bytes = Number(res.getHeader('Content-Length') || 0);
    console.info(JSON.stringify({
      event: 'crm_request_timing',
      route: name,
      method: req.method,
      status: res.statusCode,
      durationMs: Math.round((Number(process.hrtime.bigint() - startedAt) / 1e6) * 10) / 10,
      responseBytes: bytes,
      ...detail(),
    }));
  });
}

function sendApiError(res, error, fallbackStatus = 400) {
  const payload = { ok: false, error: error.message };
  if (error.code) payload.code = error.code;
  if (error.publicDetails && typeof error.publicDetails === 'object') Object.assign(payload, error.publicDetails);
  return res.status(error.statusCode || fallbackStatus).json(payload);
}

function registerSalesCrm(app, options = {}) {
  installSalesCrm();
  const hardFeatureFlags = resolveAIHardFlags({
    ai_stations: options.aiStationsEnabled,
    customer_enrichment: options.customerEnrichmentEnabled,
    customer_enrichment_auto_trigger: options.customerEnrichmentAutoTriggerEnabled,
    sales_pack: options.salesPackEnabled,
    qwen_online: options.qwenOnlineEnabled,
    qwen_batch: options.qwenBatchEnabled,
  });
  const aiStationsEnabled = resolveAIStationsEnabled({ enabled: hardFeatureFlags.ai_stations });
  const enrichmentFlags = resolveCustomerEnrichmentFlags({
    enabled: hardFeatureFlags.customer_enrichment,
    autoTriggerEnabled: hardFeatureFlags.customer_enrichment_auto_trigger,
  });
  const loginAttempts = new Map();

  app.get('/sales', (_req, res) => res.redirect(302, '/'));
  app.use('/sales-assets', require('express').static(path.join(__dirname, '..', 'sales-assets')));

  app.post('/api/sales-auth/login', (req, res) => {
    const startedAt = process.hrtime.bigint();
    logRequestTiming('sales-auth/login', req, res, startedAt, () => ({ authenticated: res.statusCode < 400 }));
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const attemptKey = `${req.socket.remoteAddress || ''}:${email}`;
    const attempt = loginAttempts.get(attemptKey) || { count: 0, resetAt: 0 };
    if (attempt.resetAt > Date.now() && attempt.count >= 8) return res.status(429).json({ ok: false, error: '登录尝试过多，请15分钟后再试' });
    if (attempt.resetAt <= Date.now()) { attempt.count = 0; attempt.resetAt = Date.now() + 15 * 60000; }
    const value = db();
    try {
      const row = value.prepare('SELECT * FROM sales_users WHERE email=? AND active=1').get(email);
      if (!row) { attempt.count += 1; loginAttempts.set(attemptKey, attempt); return res.status(401).json({ ok: false, error: '邮箱或密码错误' }); }
      const candidate = hashPassword(password, row.password_salt).hash;
      const a = Buffer.from(candidate, 'hex'), b = Buffer.from(row.password_hash, 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        attempt.count += 1; loginAttempts.set(attemptKey, attempt);
        return res.status(401).json({ ok: false, error: '邮箱或密码错误' });
      }
      loginAttempts.delete(attemptKey);
      const user = hydrateUserPermissions(value, row);
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expires = nowText(new Date(Date.now() + 7 * 86400000));
      value.prepare('DELETE FROM sales_sessions WHERE expires_at<=?').run(nowText());
      value.prepare('INSERT INTO sales_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(tokenHash, user.id, expires, nowText());
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `sales_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
      res.json({ ok: true, user: safeUser(user) });
    } finally { value.close(); }
  });

  app.post('/api/sales-auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie || '').sales_session || '';
    if (token) {
      const value = db();
      try { value.prepare('DELETE FROM sales_sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex')); } finally { value.close(); }
    }
    res.setHeader('Set-Cookie', 'sales_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.use('/api/sales-crm', requireSalesUser);
  app.use('/api/sales-crm', (req, res, next) => {
    const aiRead = req.method === 'GET'
      && (req.path.startsWith('/ai/') || req.path.startsWith('/api/sales-crm/ai/'));
    if (['HEAD', 'OPTIONS'].includes(req.method) || (req.method === 'GET' && !aiRead)) return next();
    res.on('finish', () => {
      const value = db();
      try {
        const identity = auditIdentity(req);
        if (res.statusCode === 403) {
          value.prepare(`INSERT INTO crm_audit_log
            (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
            id('AUD'), identity.userId, 'permission_denied', 'sales_route', '',
            JSON.stringify({ route: anonymousSalesRoute(req.method, req.path), permission: req.deniedPermission || 'target_scope' }),
            nowText(), identity.realUserId, identity.effectiveUserId, identity.contextId,
          );
          return;
        }
        if (res.statusCode >= 400) return;
        const aiRoute = req.path.startsWith('/ai/') || req.path.startsWith('/api/sales-crm/ai/');
        const auditRoute = anonymousSalesRoute(req.method, req.path);
        value.prepare(`INSERT INTO crm_audit_log
          (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          id('AUD'), identity.userId, aiRoute ? auditRoute : `${req.method} ${req.path}`,
          aiRoute ? 'ai_station' : (req.path.split('/').filter(Boolean)[1] || 'crm'),
          aiRoute ? '' : (req.params.customerId || req.params.userId || req.body?.customerId || req.body?.itemId || ''),
          JSON.stringify(aiRoute ? { route: auditRoute } : redactAuditPayload({ params: req.params, body: req.body || {} })),
          nowText(), identity.realUserId, identity.effectiveUserId, identity.contextId,
        );
      } finally { value.close(); }
    });
    next();
  });

  app.use('/api/sales-crm', (req, res, next) => {
    const policy = policyForSalesRequest(req.method, req.path);
    if (policy.deny) {
      req.deniedPermission = 'unmapped_route';
      return res.status(403).json({ ok: false, error: '该接口未配置访问权限' });
    }
    const missing = (policy.permissions || []).find(permission => !hasPermission(req.salesUser, permission));
    if (missing) {
      req.deniedPermission = missing;
      return res.status(403).json({ ok: false, error: `没有权限：${missing}` });
    }
    if (policy.realAdminOnly && req.realUser?.role !== 'admin') {
      req.deniedPermission = 'admin_only';
      return res.status(403).json({ ok: false, error: '只有管理员可以执行此操作' });
    }
    if (policy.impersonationControl && !req.impersonation) {
      return res.status(409).json({ ok: false, error: '身份检查已结束，请刷新页面', code: 'IMPERSONATION_ENDED' });
    }
    try {
      assertPolicyAllowed(policy, { isImpersonating: Boolean(req.impersonation) });
    } catch (error) {
      req.deniedPermission = 'impersonation_blocked';
      return res.status(error.statusCode || 403).json({ ok: false, error: error.message, code: error.code });
    }
    req.accessPolicy = policy;
    return next();
  });

  app.get('/api/sales-crm/bootstrap', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming('sales-crm/bootstrap', req, res, startedAt, () => counts);
    try {
      const payload = loadPayload(req.salesUser, { hardFlags: hardFeatureFlags });
      counts = {
        accounts: payload.accounts.length,
        activities: payload.activities.length,
        intakeItems: payload.intake?.items?.length || 0,
        customerPool: payload.customerPool.length,
        people: payload.people.length,
        reconResults: payload.reconResults.length,
      };
      res.json({
        ok: true,
        ...payload,
        features: (() => {
          const value = db();
          try {
            const flags = featureState(value, hardFeatureFlags);
            return {
              aiStations: flags.ai_stations.effectiveEnabled,
              customerEnrichment: flags.customer_enrichment.effectiveEnabled,
              customerEnrichmentAutoTrigger: flags.customer_enrichment_auto_trigger.effectiveEnabled,
              salesPack: flags.sales_pack.effectiveEnabled,
            };
          } finally { value.close(); }
        })(),
        realUser: safeUser(req.realUser),
        impersonation: req.impersonation ? {
          contextId: req.impersonation.contextId,
          startedAt: req.impersonation.startedAt,
          expiresAt: req.impersonation.expiresAt,
          targetUser: safeUser(req.salesUser),
        } : null,
      });
    }
    catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });

  app.get('/api/sales-crm/profile/:customerId', (req, res) => {
    const value = db();
    try {
      const aiEnabled = featureState(value, hardFeatureFlags).ai_stations.effectiveEnabled;
      res.json(getCustomerProfileData(
        req.accessContext, req.params.customerId, { includeAI: aiEnabled },
      ));
    }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/notifications/:notificationId/read', (req, res) => {
    const value = db();
    try {
      const notification = value.prepare(`SELECT n.*,a.id account_id
        FROM crm_notifications n
        LEFT JOIN crm_accounts a ON a.id=n.customer_id
        WHERE n.id=?`).get(req.params.notificationId);
      if (!notification) return res.status(404).json({ ok: false, error: '通知不存在' });
      const aiEnabled = featureState(value, hardFeatureFlags).ai_stations.effectiveEnabled;
      if (!aiEnabled && [
        'SALES_PACK_READY',
        'SALES_PACK_FAILED',
        'MANAGER_ANOMALY_READY',
        'SALES_COACHING_READY',
        'AI_TASK_READY',
        'AI_TASK_FAILED',
      ].includes(notification.code)) {
        return res.status(404).json({ ok: false, error: '通知不存在' });
      }
      if (notification.user_id !== req.salesUser.id) {
        return res.status(403).json({ ok: false, error: '只能标记本人接收的通知' });
      }
      return res.json({ ok: true, ...markNotificationRead(value, {
        notificationId: notification.id,
        userId: req.salesUser.id,
      }) });
    } catch (error) {
      return res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    } finally { value.close(); }
  });

  app.get('/api/sales-crm/intake', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming('sales-crm/intake', req, res, startedAt, () => counts);
    try {
      const value = db();
      try {
        const aiEnabled = featureState(value, hardFeatureFlags).ai_stations.effectiveEnabled;
        const payload = loadIntakeState(
          value, req.salesUser, req.query || {}, { includeAI: aiEnabled },
        );
        counts = { page: payload.page, rows: payload.items.length, total: payload.total };
        res.json({ ok: true, ...payload });
      } finally { value.close(); }
    } catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.get('/api/sales-crm/research/:kind', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming(`sales-crm/research/${req.params.kind}`, req, res, startedAt, () => counts);
    try {
      const result = loadResearchPage(req.salesUser, req.params.kind, req.query || {});
      counts = { page: result.page, rows: result.rows.length, total: result.total };
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/sales-crm/accounts', (req, res) => {
    let runtimeEnrichmentFlags = enrichmentFlags;
    const value = db();
    try {
      const flags = featureState(value, hardFeatureFlags);
      runtimeEnrichmentFlags = {
        enabled: flags.customer_enrichment.effectiveEnabled,
        autoTriggerEnabled: flags.customer_enrichment_auto_trigger.effectiveEnabled,
      };
    } finally { value.close(); }
    try { res.json({ ok: true, ...addAccount(req.salesUser, req.body || {}, { enrichmentFlags: runtimeEnrichmentFlags }) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/accounts/bulk-assign', (req, res) => {
    try { res.json({ ok: true, ...bulkAssignAccounts(req.salesUser, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/accounts/recycle-bin', (req, res) => {
    try { res.json({ ok: true, ...listRecycleBin(req.salesUser, req.query || {}) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/accounts/bulk-return', (req, res) => {
    try {
      res.json({ ok: true, ...bulkReturnCustomers(req.salesUser, req.body || {}, {
        realUserId: req.realUser?.id, effectiveUserId: req.salesUser?.id, contextId: req.impersonation?.contextId,
      }) });
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/accounts/:customerId/return', (req, res) => {
    try {
      res.json({ ok: true, ...returnCustomer(req.salesUser, req.params.customerId, req.body || {}, {
        realUserId: req.realUser?.id, effectiveUserId: req.salesUser?.id, contextId: req.impersonation?.contextId,
      }) });
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/accounts/:customerId/trash', (req, res) => {
    try {
      res.json({ ok: true, ...trashManualCustomer(req.salesUser, req.params.customerId, req.body || {}, {
        realUserId: req.realUser?.id, effectiveUserId: req.salesUser?.id, contextId: req.impersonation?.contextId,
      }) });
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/accounts/:customerId/restore', (req, res) => {
    try {
      res.json({ ok: true, ...restoreManualCustomer(req.salesUser, req.params.customerId, {
        realUserId: req.realUser?.id, effectiveUserId: req.salesUser?.id, contextId: req.impersonation?.contextId,
      }) });
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/accounts/:customerId/reassign', (req, res) => {
    try {
      res.json({ ok: true, ...reassignReturnedCustomer(req.salesUser, req.params.customerId, req.body || {}, {
        realUserId: req.realUser?.id, effectiveUserId: req.salesUser?.id, contextId: req.impersonation?.contextId,
      }) });
    } catch (error) { sendApiError(res, error); }
  });

  app.patch('/api/sales-crm/accounts/:customerId', (req, res) => {
    try { res.json({ ok: true, ...updateAccount(req.salesUser, req.params.customerId, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/export', (req, res) => {
    try {
      if (String(req.query.format || '').toLowerCase() === 'csv') {
        const filename = `crm-customers-${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(exportCrmCsv(
          req.salesUser, req.query || {}, { hardFlags: hardFeatureFlags },
        ));
      }
      const filename = `crm-data-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(JSON.stringify(
        exportCrmData(req.salesUser, req.query || {}, { hardFlags: hardFeatureFlags }),
        null,
        2,
      ));
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/activities', (req, res) => {
    try { res.json({ ok: true, ...addActivity(req.salesUser, req.body || {}, { hardFlags: hardFeatureFlags }) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/quotes', (req, res) => {
    try { res.json({ ok: true, ...addQuote(req.salesUser, req.body || {}, { hardFlags: hardFeatureFlags }) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/orders', (req, res) => {
    try { res.json({ ok: true, ...addOrder(req.salesUser, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/impersonation/start', (req, res) => {
    const value = db();
    try {
      const context = startImpersonation(
        value, req.realUser, req.sessionTokenHash, String(req.body?.targetUserId || ''), nowText(),
      );
      const target = hydrateUserPermissions(
        value, value.prepare('SELECT * FROM sales_users WHERE id=?').get(context.targetUserId),
      );
      res.json({
        ok: true,
        impersonation: {
          contextId: context.contextId,
          startedAt: context.startedAt,
          expiresAt: context.expiresAt,
          targetUser: safeUser(target),
        },
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/impersonation/stop', (req, res) => {
    const value = db();
    try {
      stopImpersonation(value, req.realUser, req.sessionTokenHash, 'stopped', nowText());
      res.json({ ok: true, stopped: true });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/data-maintenance/capabilities', (_req, res) => {
    res.json({ ok: true, ...maintenanceCapabilities() });
  });

  app.get('/api/sales-crm/data-maintenance/runs', (req, res) => {
    const value = db();
    try { res.json({ ok: true, runs: listMaintenanceRuns(value, req.query.limit) }); }
    catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/data-maintenance/preview', (req, res) => {
    const value = db();
    try {
      const preview = previewDataMaintenance(value, req.realUser, req.sessionTokenHash, req.body || {});
      res.json({ ok: true, ...preview });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/data-maintenance/execute', async (req, res) => {
    const value = db();
    try {
      const result = await executeDataMaintenance(value, req.realUser, req.sessionTokenHash, req.body || {});
      res.json({ ok: true, ...result });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/users', (req, res) => {
    try { res.json({ ok: true, ...createUser(req.salesUser, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/users/:userId/password-reset', (req, res) => {
    try { res.json({ ok: true, ...resetUserPassword(req.salesUser, req.params.userId, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.patch('/api/sales-crm/users/:userId', (req, res) => {
    try { res.json({ ok: true, ...updateUser(req.salesUser, req.params.userId, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/users/:userId/archive', (req, res) => {
    try { res.json({ ok: true, ...archiveUser(req.salesUser, req.params.userId) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/users/:userId/restore', (req, res) => {
    try { res.json({ ok: true, ...restoreUser(req.salesUser, req.params.userId) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.delete('/api/sales-crm/users/:userId', (req, res) => {
    try { res.json({ ok: true, ...deleteArchivedUser(req.salesUser, req.params.userId) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/permission-groups', (_req, res) => {
    const value = db();
    try { res.json({ ok: true, permissionGroups: listPermissionGroups(value) }); }
    catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/permission-groups', (req, res) => {
    const value = db();
    try { res.json({ ok: true, ...createPermissionGroup(value, req.salesUser, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.patch('/api/sales-crm/permission-groups/:groupId', (req, res) => {
    const value = db();
    try { res.json({ ok: true, ...updatePermissionGroup(value, req.salesUser, req.params.groupId, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.put('/api/sales-crm/users/:userId/permission-overrides', (req, res) => {
    const value = db();
    try { res.json({ ok: true, ...replaceUserOverrides(value, req.salesUser, req.params.userId, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/migration-review/:reviewId', (req, res) => {
    try {
      assertPermission(req.salesUser, 'view_users');
      assertPermission(req.salesUser, 'manage_users');
    } catch (error) {
      return res.status(error.statusCode || 403).json({ ok: false, error: error.message });
    }
    if (req.salesUser.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可处理迁移复核' });
    const value = db();
    try {
      const review = value.prepare("SELECT * FROM crm_migration_review WHERE id=? AND resolved_at=''").get(req.params.reviewId);
      if (!review) return res.status(404).json({ ok: false, error: '复核记录不存在或已处理' });
      const ownerId = String(req.body.ownerId || '');
      if (!authorizedSalesUser(value, ownerId)) return res.status(400).json({ ok: false, error: '请选择有效销售' });
      const row = JSON.parse(review.payload_json || '{}');
      if (!row.customer_id || !value.prepare('SELECT 1 FROM customer_pool WHERE customer_id=?').get(row.customer_id)) return res.status(400).json({ ok: false, error: '旧记录缺少有效客户主档' });
      const now = nowText();
      let account = value.prepare('SELECT * FROM crm_accounts WHERE external_customer_id=?').get(row.customer_id);
      const transaction = value.transaction(() => {
        if (!account) {
          const accountId = id('CRM');
          value.prepare(`INSERT INTO crm_accounts
            (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,product_focus,
             priority,potential_value,stage,owner_id,next_action,next_action_at,created_at,updated_at)
            SELECT ?,customer_id,company_name,country,city,website,industry,customer_type,'旧跟进复核迁移',products,
              'B',0,'qualified',?,?,?, ?,? FROM customer_pool WHERE customer_id=?`).run(
            accountId, ownerId, row.next_action || '复核并继续跟进',
            row.next_follow_date ? `${row.next_follow_date} 09:00:00` : '', now, now, row.customer_id,
          );
          account = { id: accountId };
        }
        value.prepare(`INSERT OR IGNORE INTO crm_activities
          (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,occurred_at,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          `MIG-${row.follow_id}`, account.id, ownerId, 'note', row.channel || '', row.status || '',
          [row.feedback,row.notes,row.invalid_reason].filter(Boolean).join('；') || '旧跟进记录经管理员确认迁移',
          row.next_action || '', row.next_follow_date ? `${row.next_follow_date} 09:00:00` : '', '',
          row.last_follow_date ? `${row.last_follow_date} 12:00:00` : now, now,
        );
        value.prepare('UPDATE crm_migration_review SET resolved_at=? WHERE id=?').run(now, review.id);
      });
      transaction();
      res.json({ ok: true, customerId: account.id });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    } finally { value.close(); }
  });

  app.post('/api/sales-crm/password', (req, res) => {
    try {
      const result = changePassword(req.salesUser, req.body || {});
      res.setHeader('Set-Cookie', 'sales_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      res.json({ ok: true, ...result });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/intake/scan', (req, res) => {
    try {
      res.json({
        ok: true,
        ...scanDailyIntake(req.salesUser, {
          force: Boolean(req.body.force),
          hardFlags: hardFeatureFlags,
        }),
      });
    }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/intake/action', (req, res) => {
    try { res.json({ ok: true, ...manageIntake(req.salesUser, req.body || {}, { hardFlags: hardFeatureFlags }) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.patch('/api/sales-crm/intake/settings', (req, res) => {
    try { res.json({ ok: true, ...updateIntakeSettings(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/contacts', (req, res) => {
    try { res.json({ ok: true, ...createAccountContact(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/evaluations', async (req, res) => {
    try {
      res.json({
        ok: true,
        ...await createManagerEvaluation(
          req.salesUser, req.body || {}, { hardFlags: hardFeatureFlags },
        ),
      });
    }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/evaluations/:evaluationId/retry', async (req, res) => {
    try {
      res.json({
        ok: true,
        ...await retryManagerEvaluation(
          req.salesUser, req.params.evaluationId, { hardFlags: hardFeatureFlags },
        ),
      });
    } catch (error) {
      res.status(error.statusCode || 400).json({
        ok: false,
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
    }
  });

  registerAIStationRoutes(app, {
    openDb: db,
    enabled: aiStationsEnabled,
    enrichmentFlags,
    hardFlags: hardFeatureFlags,
  });
}

module.exports = {
  PERMISSION_DEFINITIONS,
  ROLE_PERMISSIONS,
  STAGES,
  STAGE_INDEX,
  ACTIVITY_STAGE,
  hashPassword,
  badRequest,
  notFound,
  installSalesCrm,
  buildAlerts,
  groupAlerts,
  buildCountryReport,
  buildCohortReport,
  buildTeamReport,
  chooseIntakeOwner,
  normalizeListQuery,
  scanDailyIntake,
  permissionsFor,
  hasPermission,
  safeUser,
  registerSalesCrm,
  requireUnifiedUser,
};
