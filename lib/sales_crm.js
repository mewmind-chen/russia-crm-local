const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { analyzeManagerEvaluation } = require('./sales_evaluation_ai');
const { allocateCustomerId, normalizeCountryPrefix } = require('./customer_ids');
const {
  effectiveFieldSchema,
  listFieldPages,
} = require('./field_catalog');
const {
  installCustomerIdentityRegistry,
  identityConflictResolutionsForExternalIds,
  leadIdentityWarningsForExternalCustomerIds,
  leadIdentityWarningsForExternalIds,
} = require('./customer_identity_registry');
const {
  applyIdentitySupplement,
  assertConflictManager,
  installProtectedCustomerConflicts,
  listProtectedIdentityConflicts,
  rescanProtectedIdentityConflicts,
  resolveProtectedIdentityConflict,
  skipIdentitySupplement,
} = require('./protected_customer_conflicts');
const {
  activateProtectedCustomer,
  assertCustomerIdentityAvailable,
  assertProtectedCustomerAdmin,
  commitProtectedBatch,
  getProtectedCustomer,
  installProtectedCustomers,
  isProtectedCustomer,
  listProtectedCustomers,
  previewProtectedBatch,
  rollbackProtectedBatch,
  updateProtectedCustomer,
} = require('./protected_customers');
const {
  getCustomerProfileData,
  getCustomerTagHistory,
} = require('./db');
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
  attachCustomerStarState,
  canViewTeamStars,
  normalizeStarView,
  starFilter,
} = require('./customer_stars');
const {
  installPermissionGroups,
  hydrateUserPermissions,
  hydrateUsersPermissions,
  listPermissionGroups,
  createPermissionGroup,
  updatePermissionGroup,
  replaceUserPermissions,
  restoreUserPermissions,
  writeUserPermissionDifferences,
  assertValidAdminRemains,
} = require('./permission_groups');
const {
  installFilterAuthorization,
  getFilterPermissionVersion,
  listFilterDefinitions,
  listAvailableFilterSources,
  effectiveFilterSchemaFor,
  saveGroupFilterGrants,
  saveUserExtraFilterGrants,
  restoreUserExtraFilterGrants,
  updateFilterDefinition,
  createFilterDefinition,
  validateFilterQuery,
} = require('./filter_authorization');
const {
  buildResearchFilterScope,
  researchOwnerCondition,
  researchFilterOptions,
} = require('./research_filters');
const {
  buildIntakeFlowFilterScope,
  intakeFlowFilterOptions,
  queryIntakeFlowPage,
} = require('./intake_flow_filters');
const {
  listPipelineRows,
  listTodayTasks,
  listManagerEvaluationCustomers,
  listManagerMetricRows,
  listManagerRiskRows,
  listManagerTaskRows,
  listNotificationRows,
  listRecycleRows,
  recycleScope,
  mismatchIntakeScope,
  businessFilterOptions,
} = require('./business_page_filters');
const { applyAccountStatePatch } = require('./domains/lifecycle/state_write');
const { applyAccountPlanPatch, applyManagerStatusPatch, PLAN_TIME_BASIS } = require('./domains/lifecycle/collaboration_write');
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
const {
  DUPLICATE_RULE_VERSION,
  canonicalDomain,
  canonicalHostname,
  findExactDuplicate,
  findFuzzyDuplicateCandidates,
  loadDuplicateCustomerRows,
  normalizeCompanyName,
} = require('./ai_stations/enrichment/dedupe');
const { markContactReadinessStale } = require('./ai_stations/contact_readiness');
const {
  createActivityCorrectionNotification,
  createNotification,
  ensureNotificationDeliveries,
  installNotificationDeliverySchema,
  markNotificationRead,
} = require('./crm_notifications');
const {
  deferredPlanWritesEnabled,
  installDeferredPlanSchema,
  parseBusinessDateTime,
  recordDeferredPlan,
  recordExplicitPlan,
  resolveBusinessTimezone,
} = require('./deferred_plan');
const { loadIntakeMetrics } = require('./intake_metrics');
const {
  addActivityProvenance,
  effectiveActivityWhereClause,
  effectivePlanWhereClause,
  isEffectiveActivity,
  linkCommerceActivity,
} = require('./crm_activity_effective');
const {
  correctionWriteEnabled,
  correctActivity,
  installActivityCorrectionSchema,
  proposeActivityCorrection,
  reviewActivityCorrection,
} = require('./crm_activity_corrections');
const {
  FILTER_PAGES: ACTIVITY_CORRECTION_FILTER_PAGES,
  activityCorrectionFilterOptions,
  installActivityCorrectionFilterCatalog,
  queryActivityCorrectionProposals,
  queryActivityCorrections,
  queryCorrectionTargets,
} = require('./crm_activity_correction_filters');
const {
  evaluateManagerTriggers,
  getManagerTask,
  getManagerTaskSettings,
  installManagerTaskSchema,
  listManagerTasks,
  markManagerTasksOverdue,
  resolveManagerTask,
  updateManagerTaskSettings,
  upsertManagerTask,
} = require('./manager_tasks');
const {
  buildCustomerPlanRisk,
  buildManagerMetricDrilldown,
  buildManagerMetrics,
} = require('./manager_metrics');
const {
  buildTeamStatus,
  correctCollaborationEvent,
  exportTeamStatus,
  installTeamStatusSchema,
  listCollaborationSupport,
  readTeamStatusSinceLastView,
  recordExternalAssistance,
  revokeCollaborationEvent,
  supplementCollaborationEvent,
} = require('./team_status');
const {
  FILTER_PAGES: TEAM_STATUS_FILTER_PAGES,
  paginateTeamStatusRows,
  teamStatusFilterOptions,
} = require('./team_status_filters');
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
const { astWithoutField, overlayOptionCounts } = require('./filter_option_linkage');
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

const AI_NOTIFICATION_CODES = new Set([
  'SALES_PACK_READY', 'SALES_PACK_FAILED', 'MANAGER_ANOMALY_READY',
  'SALES_COACHING_READY', 'AI_TASK_READY', 'AI_TASK_FAILED',
]);
const SALES_PACK_NOTIFICATION_CODES = new Set(['SALES_PACK_READY', 'SALES_PACK_FAILED']);

function notificationVisibleForFeatures(code, features) {
  const value = String(code || '');
  if (!features.ai_stations.effectiveEnabled) return !AI_NOTIFICATION_CODES.has(value);
  if (!features.sales_pack.effectiveEnabled) return !SALES_PACK_NOTIFICATION_CODES.has(value);
  return true;
}

function anonymousSalesRoute(method, requestPath) {
  let route = String(requestPath || '').split('?')[0].replace(/^\/api\/sales-crm/, '') || '/';
  route = route.replace(/^\/accounts\/bulk-assign$/, '/accounts/bulk-assign')
    .replace(/^\/accounts\/recycle-bin$/, '/accounts/recycle-bin')
    .replace(/^\/accounts\/[^/]+\/recycle-profile$/, '/accounts/:customerId/recycle-profile')
    .replace(/^\/accounts\/bulk-return$/, '/accounts/bulk-return')
    .replace(/^\/accounts\/[^/]+\/return$/, '/accounts/:customerId/return')
    .replace(/^\/accounts\/[^/]+\/trash$/, '/accounts/:customerId/trash')
    .replace(/^\/accounts\/[^/]+\/restore$/, '/accounts/:customerId/restore')
    .replace(/^\/accounts\/[^/]+\/reassign$/, '/accounts/:customerId/reassign')
    .replace(/^\/duplicate-reviews\/[^/]+\/candidates$/, '/duplicate-reviews/:reviewId/candidates')
    .replace(/^\/duplicate-reviews\/[^/]+\/candidate$/, '/duplicate-reviews/:reviewId/candidate')
    .replace(/^\/duplicate-reviews\/[^/]+\/resolve$/, '/duplicate-reviews/:reviewId/resolve')
    .replace(/^\/protected-customer-conflicts\/[^/]+\/resolve$/, '/protected-customer-conflicts/:conflictId/resolve')
    .replace(/^\/protected-customer-conflicts\/[^/]+\/supplement$/, '/protected-customer-conflicts/:conflictId/supplement')
    .replace(/^\/protected-customers\/batches\/[^/]+\/commit$/, '/protected-customers/batches/:batchId/commit')
    .replace(/^\/protected-customers\/batches\/[^/]+\/rollback$/, '/protected-customers/batches/:batchId/rollback')
    .replace(/^\/protected-customers\/[^/]+\/activate$/, '/protected-customers/:externalCustomerId/activate')
    .replace(/^\/protected-customers\/(?!template$|export$)[^/]+$/, '/protected-customers/:externalCustomerId')
    .replace(/^\/notifications\/[^/]+\/read$/, '/notifications/:notificationId/read')
    .replace(/^\/intake\/[^/]+\/profile$/, '/intake/:itemId/profile')
    .replace(/^\/master\/[^/]+$/, '/master/:customerId')
    .replace(/^\/profile\/[^/]+\/tag-history$/, '/profile/:customerId/tag-history')
    .replace(/^\/filter-schema\/[^/]+$/, '/filter-schema/:pageKey')
    .replace(/^\/field-schema\/[^/]+$/, '/field-schema/:pageKey')
    .replace(/^\/accounts\/[^/]+$/, '/accounts/:customerId')
    .replace(/^\/profile\/[^/]+$/, '/profile/:customerId')
    .replace(/^\/activity-correction-proposals\/[^/]+\/review$/, '/activity-correction-proposals/:proposalId/review')
    .replace(/^\/activity-reactions\/(?!admin$|order$)[^/]+$/, '/activity-reactions/:reactionId')
    .replace(/^\/collaboration-support\/[^/]+\/(supplements|corrections|revocations)$/, '/collaboration-support/:eventId/$1')
    .replace(/^\/permission-groups\/[^/]+$/, '/permission-groups/:groupId')
    .replace(/^\/users\/[^/]+\/password-reset$/, '/users/:userId/password-reset')
    .replace(/^\/users\/[^/]+\/archive$/, '/users/:userId/archive')
    .replace(/^\/users\/[^/]+\/restore$/, '/users/:userId/restore')
    .replace(/^\/users\/[^/]+\/permission-overrides$/, '/users/:userId/permission-overrides')
    .replace(/^\/filter-permissions\/groups\/[^/]+$/, '/filter-permissions/groups/:groupId')
    .replace(/^\/filter-permissions\/users\/[^/]+$/, '/filter-permissions/users/:userId')
    .replace(/^\/filter-permissions\/definitions\/[^/]+$/, '/filter-permissions/definitions/:filterKey')
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

const PROGRESS_TYPE_MAP = Object.freeze({
  email: Object.freeze({ activityType: 'email', channel: 'email', stage: 'contacted' }),
  call: Object.freeze({ activityType: 'call', channel: 'call', stage: 'contacted' }),
  whatsapp: Object.freeze({ activityType: 'social', channel: 'WhatsApp', stage: 'connected' }),
  telegram: Object.freeze({ activityType: 'social', channel: 'Telegram', stage: 'connected' }),
  linkedin: Object.freeze({ activityType: 'social', channel: 'LinkedIn', stage: 'connected' }),
  reply: Object.freeze({ activityType: 'reply', channel: 'other', stage: 'replied' }),
  meeting: Object.freeze({ activityType: 'meeting', channel: 'video', stage: 'meeting' }),
  rfq: Object.freeze({ activityType: 'rfq', channel: 'business', stage: 'rfq' }),
  negotiation: Object.freeze({ activityType: 'negotiation', channel: 'business', stage: 'negotiating' }),
  lost: Object.freeze({ activityType: 'lost', channel: 'other', stage: 'lost' }),
});

const LEGACY_ACTIVITY_TYPES = new Set([
  'email', 'call', 'social', 'reply', 'meeting', 'manager_join', 'rfq', 'negotiation', 'lost', 'note',
]);

const LEGACY_ACTIVITY_CHANNELS = new Set([
  '', 'email', 'call', 'WhatsApp', 'Telegram', 'LinkedIn', 'video', '展会', 'business', 'other',
]);

const PIPELINE_ACTION_QUEUE_KEYS = new Set([
  '', 'due_followup', 'price_objection', 'inquiry_no_order', 'relationship_upgrade',
  'order_growth', 'pause_quote', 'manager_assistance',
]);
const INITIAL_ACTIVITY_REACTIONS = Object.freeze([
  ['REACTION-COMPLETED', '已完成', ''],
  ['REACTION-INTERESTED', '有兴趣', ''],
  ['REACTION-FOLLOW-UP', '需要跟进', 'due_followup'],
  ['REACTION-NO-ANSWER', '未接通', 'due_followup'],
  ['REACTION-NO-REPLY', '暂无回复', 'due_followup'],
  ['REACTION-REJECTED', '明确拒绝', 'pause_quote'],
  ['REACTION-PRICE-HIGH', '价格贵', 'price_objection'],
  ['REACTION-NO-RFQ', '暂无询价', 'due_followup'],
  ['REACTION-WAIT-PROJECT', '等项目', 'due_followup'],
  ['REACTION-RFQ-NO-ORDER', '持续询价未成交', 'inquiry_no_order'],
  ['REACTION-ASK-NO-BUY', '只问不买', 'inquiry_no_order'],
  ['REACTION-NEGATIVE', '态度消极', 'pause_quote'],
  ['REACTION-LOW-COOPERATION', '配合度低', 'pause_quote'],
  ['REACTION-STOP-QUOTE', '停止报价', 'pause_quote'],
  ['REACTION-NEW-CONTACT', '有新对接人', 'relationship_upgrade'],
  ['REACTION-DECISION-MAKER', '对接到决策人', 'relationship_upgrade'],
  ['REACTION-MANAGEMENT', '对接到老板/管理层', 'relationship_upgrade'],
  ['REACTION-PRICE-ACCEPTED', '价格接受', 'relationship_upgrade'],
  ['REACTION-WAIT-ORDER', '等待订单', 'order_growth'],
  ['REACTION-ORDERED', '已下单', 'order_growth'],
  ['REACTION-ORDER-GROWTH', '订单增加', 'order_growth'],
  ['REACTION-REPEAT-CHANCE', '复购机会', 'order_growth'],
  ['REACTION-NEED-MATERIAL', '需要资料', ''],
  ['REACTION-NEED-SAMPLE', '需要样品', ''],
  ['REACTION-NEED-CERT', '需要认证', ''],
  ['REACTION-NEED-TECH', '需要技术确认', ''],
  ['REACTION-NEED-QUOTE-STRATEGY', '需要报价策略', 'manager_assistance'],
]);

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

function normalizeAccountNickname(input) {
  const raw = String(input ?? '');
  if (raw === '') return '';
  const nickname = raw.trim();
  if (!nickname) throw badRequest('客户昵称不能只包含空白字符');
  if (/[\p{Cc}]/u.test(nickname)) throw badRequest('客户昵称不能包含控制字符');
  if (Array.from(nickname).length > 40) throw badRequest('客户昵称最多40个字符');
  return nickname;
}

function normalizeActivityReactionName(input) {
  const raw = String(input ?? '');
  const normalized = raw.normalize('NFKC');
  if (/[\p{Cc}\p{Cf}]/u.test(normalized)) throw badRequest('客户反应名称不能包含控制字符');
  const name = normalized.trim().replace(/\s+/g, ' ');
  if (!name) throw badRequest('客户反应名称不能为空');
  if (Array.from(name).length > 40) throw badRequest('客户反应名称最多40个字符');
  return name;
}

function activityReactionNameKey(input) {
  return normalizeActivityReactionName(input).toLocaleLowerCase('zh-CN');
}

function normalizeCustomerStarReason(value) {
  const reason = String(value || '').replace(/\s+/g, ' ').trim();
  if (/[\p{Cc}\p{Cf}]/u.test(reason)) throw badRequest('关注原因不能包含控制字符');
  if (Array.from(reason).length > 100) throw badRequest('关注原因最多100个字符');
  return reason;
}

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
        nickname TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '',
        customer_type TEXT NOT NULL DEFAULT '',
        established_year INTEGER,
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
        next_action_time_basis TEXT DEFAULT '',
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
        stage_before TEXT NOT NULL DEFAULT '',
        stage_after TEXT NOT NULL DEFAULT '',
        manager_required INTEGER NOT NULL DEFAULT 0,
        is_test_data INTEGER NOT NULL DEFAULT 0,
        test_run_id TEXT NOT NULL DEFAULT '',
        superseded_at TEXT NOT NULL DEFAULT '',
        superseded_by TEXT NOT NULL DEFAULT '',
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
        activity_id TEXT NOT NULL DEFAULT '',
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
        activity_id TEXT NOT NULL DEFAULT '',
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
        activity_id TEXT NOT NULL DEFAULT '',
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
      CREATE TABLE IF NOT EXISTS crm_today_task_action_requests (
        idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
        actor_id TEXT NOT NULL,
        action_type TEXT NOT NULL CHECK (action_type IN (
          'resolve_overdue_lead','add_next_plan','complete_manager_assistance','confirm_manager_assistance'
        )),
        target_type TEXT NOT NULL CHECK (target_type IN ('crm_intake_item','crm_account')),
        target_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
        response_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS crm_today_task_action_target_idx
        ON crm_today_task_action_requests(target_type,target_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS crm_intake_manual_assignment_requests (
        idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
        actor_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
        response_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS crm_intake_assignment_previews (
        token TEXT PRIMARY KEY CHECK (length(trim(token)) > 0),
        actor_id TEXT NOT NULL,
        item_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS crm_intake_assignment_previews_expiry_idx
        ON crm_intake_assignment_previews(expires_at);
      CREATE TABLE IF NOT EXISTS crm_customer_create_requests (
        idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
        actor_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed')),
        response_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS crm_duplicate_reviews (
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
      );
      CREATE INDEX IF NOT EXISTS crm_duplicate_reviews_status_idx
        ON crm_duplicate_reviews(status,created_at DESC);
      CREATE INDEX IF NOT EXISTS crm_duplicate_reviews_target_idx
        ON crm_duplicate_reviews(target_type,target_id);
      CREATE TABLE IF NOT EXISTS crm_account_contacts (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL DEFAULT '',
        external_customer_id TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        department TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        social TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_contact_id TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        updated_by TEXT NOT NULL DEFAULT '',
        archived_by TEXT NOT NULL DEFAULT '',
        archived_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
      CREATE TABLE IF NOT EXISTS crm_customer_stars (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        starred_at TEXT NOT NULL,
        unstarred_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        UNIQUE(customer_id,user_id)
      );
      CREATE INDEX IF NOT EXISTS crm_customer_stars_customer_idx
        ON crm_customer_stars(customer_id,active,starred_at DESC);
      CREATE INDEX IF NOT EXISTS crm_customer_stars_user_idx
        ON crm_customer_stars(user_id,active,starred_at DESC);
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
    ensureAccountEstablishedYearColumns(value);
    ensureAccountRecycleColumns(value);
    ensureAccountNicknameColumn(value);
    ensureAccountOwnershipColumns(value);
    ensureAccountNextActionTimeBasisColumn(value);
    ensureAccountContactColumns(value);
    ensureCustomerMasterNicknameSchema(value);
    installCustomerIdentityRegistry(value);
    installProtectedCustomerConflicts(value);
    installProtectedCustomers(value);
    installDeferredPlanSchema(value);
    installManagerTaskSchema(value);
    ensureExternalAccountIndex(value);
    ensureActivityProgressSchema(value);
    ensureEffectiveActivitySchema(value);
    installActivityCorrectionSchema(value);
    ensureSmokeTestColumns(value);
    ensureIntakeItemColumns(value);
    ensureDuplicateReviewColumns(value);
    ensureDuplicateReviewNeedsInfoStatus(value);
    ensureTodayTaskActionTypes(value);
    ensurePlanOnlyActionSchema(value);
    installIntakeCrmStatusSync(value);
    reconcileReturnedAccountsWithoutIntake(value);
    clearLegacyRiskAssignmentBlocks(value);
    ensureUserPermissionColumns(value);
    installPermissionGroups(value);
    ensureNotificationPermissionDefaults(value);
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
    value.prepare("UPDATE crm_intake_settings SET approval_mode='manual' WHERE id='default'").run();
    value.prepare(`UPDATE crm_intake_settings SET claim_sla_hours=24,contact_sla_hours=48,updated_at=?
      WHERE id='default' AND updated_by='system' AND claim_sla_hours=12 AND contact_sla_hours=24`).run(nowText());
    seedUsers(value);
    installPermissionGroups(value);
    installFilterAuthorization(value);
    installActivityCorrectionFilterCatalog(value);
    installTeamStatusSchema(value);
    upgradeStaleDuplicateReviews(value);
    if (String(process.env.CRM_SEED_DEMO_DATA || '').toLowerCase() === 'true') {
      seedAccounts(value);
      seedDemoIntake(value);
    }
  } finally {
    value.close();
  }
}

function ensureEffectiveActivitySchema(value) {
  const additions = {
    crm_activities: {
      superseded_at: "TEXT NOT NULL DEFAULT ''",
      superseded_by: "TEXT NOT NULL DEFAULT ''",
    },
    crm_rfqs: { activity_id: "TEXT NOT NULL DEFAULT ''" },
    crm_quotes: { activity_id: "TEXT NOT NULL DEFAULT ''" },
    crm_orders: { activity_id: "TEXT NOT NULL DEFAULT ''" },
  };
  for (const [table, columnsToAdd] of Object.entries(additions)) {
    const columns = new Set(value.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    for (const [column, definition] of Object.entries(columnsToAdd)) {
      if (!columns.has(column)) value.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  value.exec(`
    CREATE INDEX IF NOT EXISTS crm_activities_superseded_by_idx
      ON crm_activities(superseded_by);
    CREATE INDEX IF NOT EXISTS crm_rfqs_activity_idx ON crm_rfqs(activity_id);
    CREATE INDEX IF NOT EXISTS crm_quotes_activity_idx ON crm_quotes(activity_id);
    CREATE INDEX IF NOT EXISTS crm_orders_activity_idx ON crm_orders(activity_id);
  `);
}

function ensureActivityProgressSchema(value) {
  value.exec(`
    CREATE TABLE IF NOT EXISTS crm_activity_reaction_options (
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
    CREATE UNIQUE INDEX IF NOT EXISTS crm_activity_reaction_active_name_idx
      ON crm_activity_reaction_options(name_key) WHERE active=1;
    CREATE INDEX IF NOT EXISTS crm_activity_reaction_order_idx
      ON crm_activity_reaction_options(active,sort_order,id);
    CREATE TABLE IF NOT EXISTS crm_activity_action_requests (
      idempotency_key TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed')),
      response_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_activity_action_customer_idx
      ON crm_activity_action_requests(customer_id,created_at DESC);
  `);
  const reactionColumns = new Set(
    value.prepare('PRAGMA table_info(crm_activity_reaction_options)').all().map(row => row.name),
  );
  const actionQueueColumnAdded = !reactionColumns.has('action_queue_key');
  if (actionQueueColumnAdded) {
    value.exec("ALTER TABLE crm_activity_reaction_options ADD COLUMN action_queue_key TEXT NOT NULL DEFAULT ''");
  }
  const activityColumns = new Set(
    value.prepare('PRAGMA table_info(crm_activities)').all().map(row => row.name),
  );
  const additions = {
    progress_key: "TEXT NOT NULL DEFAULT ''",
    reaction_option_id: "TEXT NOT NULL DEFAULT ''",
    reaction_label_snapshot: "TEXT NOT NULL DEFAULT ''",
    stage_before: "TEXT NOT NULL DEFAULT ''",
    no_plan: "INTEGER NOT NULL DEFAULT 0",
  };
  for (const [column, definition] of Object.entries(additions)) {
    if (!activityColumns.has(column)) {
      value.exec(`ALTER TABLE crm_activities ADD COLUMN ${column} ${definition}`);
    }
  }
  value.prepare(`UPDATE crm_activities SET progress_key=CASE
    WHEN activity_type='social' AND channel='WhatsApp' THEN 'whatsapp'
    WHEN activity_type='social' AND channel='Telegram' THEN 'telegram'
    WHEN activity_type='social' AND channel='LinkedIn' THEN 'linkedin'
    ELSE activity_type END
    WHERE progress_key=''`).run();
  const insert = value.prepare(`INSERT OR IGNORE INTO crm_activity_reaction_options
    (id,name,name_key,sort_order,action_queue_key,active,created_by,updated_by,created_at,updated_at)
    VALUES (?,?,?,?,?,1,'system','system',?,?)`);
  const installedAt = nowText();
  INITIAL_ACTIVITY_REACTIONS.forEach(([reactionId, name, actionQueueKey], index) => {
    insert.run(
      reactionId,
      name,
      activityReactionNameKey(name),
      index,
      actionQueueKey,
      installedAt,
      installedAt,
    );
  });
  if (actionQueueColumnAdded) {
    const migrateDefault = value.prepare(`UPDATE crm_activity_reaction_options
      SET action_queue_key=?,updated_at=?
      WHERE id=? AND name_key=? AND action_queue_key=''`);
    INITIAL_ACTIVITY_REACTIONS.forEach(([reactionId, name, actionQueueKey]) => {
      migrateDefault.run(actionQueueKey, installedAt, reactionId, activityReactionNameKey(name));
    });
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

function ensureAccountEstablishedYearColumns(value) {
  const accountColumns = new Set(value.prepare('PRAGMA table_info(crm_accounts)').all().map(row => row.name));
  if (!accountColumns.has('established_year')) {
    value.exec('ALTER TABLE crm_accounts ADD COLUMN established_year INTEGER');
  }
  if (!hasTable(value, 'customer_pool')) return;
  const poolColumns = new Set(value.prepare('PRAGMA table_info(customer_pool)').all().map(row => row.name));
  if (!poolColumns.has('established_year')) {
    value.exec('ALTER TABLE customer_pool ADD COLUMN established_year INTEGER');
  }
}

function ensureAccountNextActionTimeBasisColumn(value) {
  const columns = new Set(value.prepare('PRAGMA table_info(crm_accounts)').all().map(row => row.name));
  if (!columns.has('next_action_time_basis')) {
    value.exec("ALTER TABLE crm_accounts ADD COLUMN next_action_time_basis TEXT DEFAULT ''");
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

function ensureAccountContactColumns(value) {
  const columns = new Set(
    value.prepare('PRAGMA table_info(crm_account_contacts)').all().map(row => row.name),
  );
  const additions = {
    external_customer_id: "TEXT NOT NULL DEFAULT ''",
    source_type: "TEXT NOT NULL DEFAULT 'manual'",
    updated_by: "TEXT NOT NULL DEFAULT ''",
    archived_by: "TEXT NOT NULL DEFAULT ''",
    archived_at: "TEXT NOT NULL DEFAULT ''",
    match_status: "TEXT NOT NULL DEFAULT 'pending' CHECK(match_status IN ('pending','match','mismatch'))",
    procurement_role: "TEXT NOT NULL DEFAULT 'pending' CHECK(procurement_role IN ('pending','yes','no'))",
    work_content: "TEXT NOT NULL DEFAULT ''",
  };
  for (const [name, definition] of Object.entries(additions)) {
    if (!columns.has(name)) {
      value.exec(`ALTER TABLE crm_account_contacts ADD COLUMN ${name} ${definition}`);
    }
  }
  value.prepare(`UPDATE crm_account_contacts SET external_customer_id=COALESCE((
      SELECT external_customer_id FROM crm_accounts
      WHERE crm_accounts.id=crm_account_contacts.customer_id
    ),'') WHERE external_customer_id=''`).run();
  value.prepare("UPDATE crm_account_contacts SET updated_by=created_by WHERE updated_by='' ").run();
  const tableSql = String(value.prepare(`SELECT sql FROM sqlite_master
    WHERE type='table' AND name='crm_account_contacts'`).get()?.sql || '');
  if (/REFERENCES\s+crm_accounts/i.test(tableSql)) {
    value.transaction(() => {
      value.exec(`DROP TABLE IF EXISTS crm_account_contacts_v2;
        CREATE TABLE crm_account_contacts_v2 (
          id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL DEFAULT '',
          external_customer_id TEXT NOT NULL,
          name TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          department TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          social TEXT NOT NULL DEFAULT '',
          match_status TEXT NOT NULL DEFAULT 'pending'
            CHECK(match_status IN ('pending','match','mismatch')),
          procurement_role TEXT NOT NULL DEFAULT 'pending'
            CHECK(procurement_role IN ('pending','yes','no')),
          work_content TEXT NOT NULL DEFAULT '',
          source_type TEXT NOT NULL DEFAULT 'manual',
          source_contact_id TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL,
          updated_by TEXT NOT NULL DEFAULT '',
          archived_by TEXT NOT NULL DEFAULT '',
          archived_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO crm_account_contacts_v2
          (id,customer_id,external_customer_id,name,title,department,phone,email,social,
           match_status,procurement_role,work_content,source_type,source_contact_id,
           created_by,updated_by,archived_by,archived_at,created_at,updated_at)
        SELECT id,customer_id,external_customer_id,name,title,department,phone,email,social,
          match_status,procurement_role,work_content,source_type,source_contact_id,
          created_by,updated_by,archived_by,archived_at,created_at,updated_at
        FROM crm_account_contacts;
        DROP TABLE crm_account_contacts;
        ALTER TABLE crm_account_contacts_v2 RENAME TO crm_account_contacts;`);
    }).immediate();
  }
  value.exec(`CREATE INDEX IF NOT EXISTS crm_account_contacts_customer_idx
    ON crm_account_contacts(customer_id)`);
  value.exec(`CREATE INDEX IF NOT EXISTS crm_account_contacts_master_idx
    ON crm_account_contacts(external_customer_id,archived_at,name)`);
}

function ensureAccountOwnershipColumns(value) {
  const columns = value.prepare('PRAGMA table_info(crm_accounts)').all();
  if (!columns.some(row => row.name === 'created_by')) {
    value.exec("ALTER TABLE crm_accounts ADD COLUMN created_by TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some(row => row.name === 'first_claimed_by')) {
    value.exec("ALTER TABLE crm_accounts ADD COLUMN first_claimed_by TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some(row => row.name === 'first_claimed_at')) {
    value.exec("ALTER TABLE crm_accounts ADD COLUMN first_claimed_at TEXT NOT NULL DEFAULT ''");
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
          nickname TEXT NOT NULL DEFAULT '',
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
          first_claimed_by TEXT NOT NULL DEFAULT '',
          first_claimed_at TEXT NOT NULL DEFAULT '',
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
          id,external_customer_id,company_name,nickname,country,city,website,industry,customer_type,source,
          product_focus,priority,potential_value,stage,owner_id,created_by,first_claimed_by,first_claimed_at,manager_id,manager_required,
          manager_status,last_activity_at,next_action,next_action_at,loss_reason,created_at,updated_at,
          intake_item_id,assignment_status,assigned_at,claim_due_at,claimed_at,return_reason,
          lifecycle_status,recycle_kind,recycle_reason,recycled_by,recycled_at,previous_owner_id
        )
        SELECT
          id,external_customer_id,company_name,nickname,country,city,website,industry,customer_type,source,
          product_focus,priority,potential_value,stage,owner_id,created_by,first_claimed_by,first_claimed_at,manager_id,manager_required,
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
      `);
    }).immediate();
  } finally {
    value.pragma('foreign_keys = ON');
  }
}

function ensureAccountNicknameColumn(value) {
  const columns = new Set(value.prepare('PRAGMA table_info(crm_accounts)').all().map(row => row.name));
  if (!columns.has('nickname')) {
    value.exec("ALTER TABLE crm_accounts ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
  }
}

function ensureCustomerMasterNicknameSchema(value) {
  if (!hasTable(value, 'customer_pool')) return;
  const poolColumns = new Set(value.prepare('PRAGMA table_info(customer_pool)').all()
    .map(row => row.name));
  if (!poolColumns.has('nickname')) {
    value.exec("ALTER TABLE customer_pool ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
  }
  value.exec(`
    CREATE TABLE IF NOT EXISTS customer_nickname_migration_audit (
      external_customer_id TEXT PRIMARY KEY,
      selected_nickname TEXT NOT NULL DEFAULT '',
      selected_account_id TEXT NOT NULL DEFAULT '',
      candidates_json TEXT NOT NULL DEFAULT '[]',
      resolution_rule TEXT NOT NULL DEFAULT '',
      had_conflict INTEGER NOT NULL DEFAULT 0,
      migrated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS customer_nickname_audit (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL,
      old_nickname TEXT NOT NULL DEFAULT '',
      new_nickname TEXT NOT NULL DEFAULT '',
      real_user_id TEXT NOT NULL DEFAULT '',
      effective_user_id TEXT NOT NULL DEFAULT '',
      impersonation_context_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS customer_nickname_audit_customer_idx
      ON customer_nickname_audit(external_customer_id,created_at DESC);
  `);

  const candidates = value.prepare(`SELECT id,external_customer_id,nickname,updated_at,created_at
    FROM crm_accounts
    WHERE TRIM(COALESCE(external_customer_id,''))!=''
      AND TRIM(COALESCE(nickname,''))!=''
    ORDER BY external_customer_id,updated_at DESC,created_at DESC,id ASC`).all();
  const grouped = new Map();
  for (const row of candidates) {
    const rows = grouped.get(row.external_customer_id) || [];
    rows.push(row);
    grouped.set(row.external_customer_id, rows);
  }
  const transaction = value.transaction(() => {
    for (const [externalCustomerId, rows] of grouped) {
      let master = value.prepare(`SELECT customer_id,company_name,nickname
        FROM customer_pool WHERE customer_id=?`).get(externalCustomerId);
      if (!master) {
        const account = value.prepare(`SELECT company_name,created_at,updated_at FROM crm_accounts
          WHERE external_customer_id=?
          ORDER BY updated_at DESC,created_at DESC,id ASC LIMIT 1`).get(externalCustomerId);
        value.prepare(`INSERT INTO customer_pool
          (customer_id,company_name,nickname,created_at,updated_at)
          VALUES (?,?,?,?,?)`).run(
          externalCustomerId,
          account?.company_name || externalCustomerId,
          '',
          account?.created_at || nowText(),
          account?.updated_at || nowText(),
        );
        master = { customer_id: externalCustomerId, company_name: account?.company_name || '', nickname: '' };
      }
      const existingMasterNickname = String(master.nickname || '').trim();
      const selected = existingMasterNickname
        ? { id: 'customer_pool', nickname: existingMasterNickname }
        : rows[0];
      const selectedNickname = String(selected?.nickname || '');
      const distinctNicknames = [...new Set(rows.map(row => String(row.nickname || '')))];
      const hadConflict = Number(
        distinctNicknames.length > 1
        || (existingMasterNickname && distinctNicknames.some(item => item !== existingMasterNickname)),
      );
      if (!existingMasterNickname && selectedNickname) {
        value.prepare('UPDATE customer_pool SET nickname=?,updated_at=? WHERE customer_id=?')
          .run(selectedNickname, nowText(), externalCustomerId);
      }
      const resolutionRule = existingMasterNickname
        ? 'existing_master_wins'
        : 'latest_updated_then_created_then_account_id';
      const inserted = value.prepare(`INSERT OR IGNORE INTO customer_nickname_migration_audit
        (external_customer_id,selected_nickname,selected_account_id,candidates_json,
         resolution_rule,had_conflict,migrated_at)
        VALUES (?,?,?,?,?,?,?)`).run(
        externalCustomerId,
        selectedNickname,
        selected.id || '',
        JSON.stringify(rows.map(row => ({
          accountId: row.id,
          nickname: row.nickname,
          updatedAt: row.updated_at,
          createdAt: row.created_at,
        }))),
        resolutionRule,
        hadConflict,
        nowText(),
      );
      if (inserted.changes && hadConflict) {
        value.prepare(`INSERT INTO crm_audit_log
          (id,user_id,action,entity_type,entity_id,detail_json,created_at)
          VALUES (?,?,?,?,?,?,?)`).run(
          id('AUD'),
          'system',
          'customer_nickname_migration_conflict',
          'customer_master',
          externalCustomerId,
          JSON.stringify({
            selectedNickname,
            selectedAccountId: selected.id || '',
            resolutionRule,
            candidates: rows.map(row => ({
              accountId: row.id,
              nickname: row.nickname,
              updatedAt: row.updated_at,
              createdAt: row.created_at,
            })),
          }),
          nowText(),
        );
      }
    }
    value.exec(`UPDATE crm_accounts
      SET nickname=COALESCE((
        SELECT p.nickname FROM customer_pool p
        WHERE p.customer_id=crm_accounts.external_customer_id
      ),'')
      WHERE TRIM(COALESCE(external_customer_id,''))!=''`);
  });
  transaction.immediate();

  value.exec(`
    CREATE TRIGGER IF NOT EXISTS customer_pool_sync_account_nickname_update
    AFTER UPDATE OF nickname ON customer_pool
    BEGIN
      UPDATE crm_accounts SET nickname=NEW.nickname
      WHERE external_customer_id=NEW.customer_id
        AND nickname IS NOT NEW.nickname;
    END;
    CREATE TRIGGER IF NOT EXISTS crm_accounts_load_master_nickname_insert
    AFTER INSERT ON crm_accounts
    WHEN TRIM(COALESCE(NEW.external_customer_id,''))!=''
    BEGIN
      UPDATE crm_accounts
      SET nickname=COALESCE((
        SELECT nickname FROM customer_pool WHERE customer_id=NEW.external_customer_id
      ),'')
      WHERE id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS crm_accounts_load_master_nickname_relink
    AFTER UPDATE OF external_customer_id ON crm_accounts
    WHEN TRIM(COALESCE(NEW.external_customer_id,''))!=''
    BEGIN
      UPDATE crm_accounts
      SET nickname=COALESCE((
        SELECT nickname FROM customer_pool WHERE customer_id=NEW.external_customer_id
      ),'')
      WHERE id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS crm_accounts_legacy_nickname_write_through
    AFTER UPDATE OF nickname ON crm_accounts
    WHEN TRIM(COALESCE(NEW.external_customer_id,''))!=''
      AND NEW.nickname IS NOT (
        SELECT nickname FROM customer_pool WHERE customer_id=NEW.external_customer_id
      )
    BEGIN
      UPDATE customer_pool SET nickname=NEW.nickname,updated_at=NEW.updated_at
      WHERE customer_id=NEW.external_customer_id;
      UPDATE crm_accounts SET nickname=NEW.nickname
      WHERE external_customer_id=NEW.external_customer_id
        AND nickname IS NOT NEW.nickname;
    END;
  `);
}

function ensureExternalAccountIndex(value) {
  const duplicate = value.prepare(`SELECT external_customer_id
    FROM crm_accounts WHERE TRIM(COALESCE(external_customer_id,''))!=''
    GROUP BY external_customer_id HAVING COUNT(*)>1 LIMIT 1`).get();
  if (duplicate) {
    value.exec(`CREATE INDEX IF NOT EXISTS crm_accounts_external_idx
      ON crm_accounts(external_customer_id)`);
    return;
  }
  value.exec(`CREATE UNIQUE INDEX IF NOT EXISTS crm_accounts_external_unique_idx
    ON crm_accounts(external_customer_id) WHERE external_customer_id!=''`);
}

function ensureIntakeItemColumns(value) {
  const columns = new Set(value.prepare('PRAGMA table_info(crm_intake_items)').all().map(row => row.name));
  const additions = {
    evidence_urls: "TEXT NOT NULL DEFAULT ''",
    duplicate_review_id: "TEXT NOT NULL DEFAULT ''",
    duplicate_state: "TEXT NOT NULL DEFAULT ''",
    rejected_by: "TEXT NOT NULL DEFAULT ''",
    rejected_at: "TEXT NOT NULL DEFAULT ''",
    previous_owner_id: "TEXT NOT NULL DEFAULT ''",
    supplement_requirement: "TEXT NOT NULL DEFAULT ''",
    supplement_pending_json: "TEXT NOT NULL DEFAULT '{}'",
  };
  for (const [name, definition] of Object.entries(additions)) {
    if (!columns.has(name)) value.exec(`ALTER TABLE crm_intake_items ADD COLUMN ${name} ${definition}`);
  }
  value.exec(`CREATE INDEX IF NOT EXISTS crm_intake_items_duplicate_idx
    ON crm_intake_items(duplicate_state,status)`);
}

function hydrateDuplicateLinkFields(value, item) {
  item.supplementRequirement = String(item.supplement_requirement || '');
  item.complementaryInfo = json(item.supplement_pending_json, {});
  if (item.duplicate_state === 'exact' && item.crm_customer_id) {
    const master = value.prepare(
      'SELECT company_name FROM crm_accounts WHERE id=?',
    ).get(item.crm_customer_id);
    if (master) item.linkedMasterName = String(master.company_name || '');
  }
}

// Applies a stored identity-conflict resolution to a hydrated intake item. Runs
// after the identityWarning/duplicate-link pass so it can override the warning.
function applyIdentityConflictResolution(item, resolutions) {
  const resolution = resolutions.get(String(item.external_customer_id || ''));
  if (!resolution) return;
  item.identityWarning = null;
  item.assignable = false;
  item.claimBlocked = true;
  item.linkedMasterName = String(resolution.linkedMasterName || '');
  item.linkedMasterExternalId = String(resolution.linkedMasterExternalId || '');
  item.supplementRequirement = String(resolution.supplementRequirement || '');
  item.complementaryInfo = resolution.complementaryInfo || null;
}

function ensureDuplicateReviewColumns(value) {
  const columns = new Set(value.prepare('PRAGMA table_info(crm_duplicate_reviews)').all().map(row => row.name));
  const additions = [
    ['created_rule_version', "TEXT NOT NULL DEFAULT 'legacy-v1'"],
    ['evaluated_rule_version', "TEXT NOT NULL DEFAULT 'legacy-v1'"],
    ['current_candidates_json', "TEXT NOT NULL DEFAULT ''"],
    ['selected_customer_id', "TEXT NOT NULL DEFAULT ''"],
    ['selected_candidate_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['selected_by', "TEXT NOT NULL DEFAULT ''"],
    ['resolution_source', "TEXT NOT NULL DEFAULT ''"],
    ['recalculated_by', "TEXT NOT NULL DEFAULT ''"],
    ['recalculated_at', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) value.exec(`ALTER TABLE crm_duplicate_reviews ADD COLUMN ${name} ${definition}`);
  }
}

function ensureDuplicateReviewNeedsInfoStatus(value) {
  const tableSql = value.prepare(`SELECT sql FROM sqlite_master
    WHERE type='table' AND name='crm_duplicate_reviews'`).get()?.sql || '';
  if (!tableSql || tableSql.includes('needs_info')) return;
  const foreignKeysEnabled = Number(value.pragma('foreign_keys', { simple: true })) === 1;
  value.pragma('foreign_keys = OFF');
  try {
    value.transaction(() => {
      value.exec(tableSql
        .replace(
          "CHECK(status IN ('pending','confirmed_same','confirmed_distinct'))",
          "CHECK(status IN ('pending','confirmed_same','confirmed_distinct','needs_info'))",
        )
        .replace(/crm_duplicate_reviews(?=[\s(])/g, 'crm_duplicate_reviews_v291')
      );
      value.exec('INSERT INTO crm_duplicate_reviews_v291 SELECT * FROM crm_duplicate_reviews');
      value.exec('DROP TABLE crm_duplicate_reviews');
      value.exec('ALTER TABLE crm_duplicate_reviews_v291 RENAME TO crm_duplicate_reviews');
      value.exec(`CREATE INDEX IF NOT EXISTS crm_duplicate_reviews_status_idx
        ON crm_duplicate_reviews(status,created_at DESC);
        CREATE INDEX IF NOT EXISTS crm_duplicate_reviews_target_idx
        ON crm_duplicate_reviews(target_type,target_id)`);
    })();
  } finally {
    value.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
  }
}

function installIntakeCrmStatusSync(value) {
  const install = () => value.exec(`
    DROP TRIGGER IF EXISTS crm_accounts_sync_intake_insert;
    DROP TRIGGER IF EXISTS crm_accounts_sync_intake_external_update;

    CREATE TRIGGER crm_accounts_sync_intake_insert
    AFTER INSERT ON crm_accounts
    WHEN TRIM(NEW.external_customer_id)!=''
      AND COALESCE(NEW.lifecycle_status,'active')='active'
      AND NEW.assignment_status='claimed'
    BEGIN
      UPDATE crm_intake_items
      SET status=CASE
            WHEN id=NEW.intake_item_id AND TRIM(COALESCE(NEW.intake_item_id,''))!=''
              THEN 'claimed'
            ELSE 'duplicate'
          END,
          crm_customer_id=NEW.id,
          suggested_owner_id=CASE WHEN id=NEW.intake_item_id THEN suggested_owner_id ELSE '' END,
          assigned_owner_id=CASE
            WHEN id=NEW.intake_item_id THEN COALESCE(NULLIF(NEW.owner_id,''),assigned_owner_id)
            ELSE ''
          END,
          assigned_at=CASE WHEN id=NEW.intake_item_id THEN assigned_at ELSE '' END,
          claim_due_at=CASE WHEN id=NEW.intake_item_id THEN claim_due_at ELSE '' END,
          claimed_at=CASE
            WHEN id=NEW.intake_item_id THEN COALESCE(
              NULLIF(NEW.claimed_at,''),
              NULLIF(claimed_at,''),
              strftime('%Y-%m-%d %H:%M:%S','now')
            )
            ELSE ''
          END,
          return_reason=CASE WHEN id=NEW.intake_item_id THEN return_reason ELSE '' END,
          duplicate_state=CASE WHEN id=NEW.intake_item_id THEN duplicate_state ELSE 'exact' END,
          duplicate_review_id=CASE WHEN id=NEW.intake_item_id THEN duplicate_review_id ELSE '' END,
          decision_reason=CASE WHEN id=NEW.intake_item_id THEN decision_reason ELSE '客户已在CRM' END,
          updated_at=strftime('%Y-%m-%d %H:%M:%S','now')
      WHERE external_customer_id=NEW.external_customer_id
        AND status IN ('pending','approved','assigned','returned');

      UPDATE crm_accounts
      SET owner_id=CASE
            WHEN TRIM(COALESCE(owner_id,''))='' THEN (
              SELECT NULLIF(i.assigned_owner_id,'') FROM crm_intake_items i
              WHERE i.id=NEW.intake_item_id
                AND i.external_customer_id=NEW.external_customer_id
                AND i.crm_customer_id=NEW.id
                AND i.status='claimed'
            )
            ELSE owner_id
          END,
          claimed_at=CASE
            WHEN TRIM(COALESCE(claimed_at,''))='' THEN COALESCE(
              (SELECT NULLIF(i.claimed_at,'') FROM crm_intake_items i
               WHERE i.id=NEW.intake_item_id
                 AND i.external_customer_id=NEW.external_customer_id
                 AND i.crm_customer_id=NEW.id
                 AND i.status='claimed'),
              strftime('%Y-%m-%d %H:%M:%S','now')
            )
            ELSE claimed_at
          END
      WHERE id=NEW.id
        AND COALESCE(lifecycle_status,'active')='active'
        AND assignment_status='claimed'
        AND EXISTS (
          SELECT 1 FROM crm_intake_items i
          WHERE i.id=NEW.intake_item_id
            AND i.external_customer_id=NEW.external_customer_id
            AND i.crm_customer_id=NEW.id
            AND i.status='claimed'
        );
    END;

    CREATE TRIGGER crm_accounts_sync_intake_external_update
    AFTER UPDATE OF external_customer_id ON crm_accounts
    WHEN OLD.external_customer_id IS NOT NEW.external_customer_id
    BEGIN
      UPDATE crm_intake_items
      SET status=CASE
            WHEN EXISTS (
              SELECT 1 FROM crm_accounts replacement
              WHERE replacement.external_customer_id=OLD.external_customer_id
                AND replacement.id!=NEW.id
                AND COALESCE(replacement.lifecycle_status,'active')='active'
                AND replacement.assignment_status='claimed'
                AND replacement.intake_item_id=crm_intake_items.id
                AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
            ) THEN 'claimed'
            ELSE 'duplicate'
          END,
          crm_customer_id=COALESCE(
            (SELECT replacement.id FROM crm_accounts replacement
             WHERE replacement.external_customer_id=OLD.external_customer_id
               AND replacement.id!=NEW.id
               AND COALESCE(replacement.lifecycle_status,'active')='active'
               AND replacement.assignment_status='claimed'
               AND replacement.intake_item_id=crm_intake_items.id
               AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
             ORDER BY replacement.id LIMIT 1),
            (SELECT replacement.id FROM crm_accounts replacement
             WHERE replacement.external_customer_id=OLD.external_customer_id
               AND replacement.id!=NEW.id
               AND COALESCE(replacement.lifecycle_status,'active')='active'
               AND replacement.assignment_status='claimed'
             ORDER BY replacement.id LIMIT 1)
          ),
          suggested_owner_id=CASE
            WHEN EXISTS (
              SELECT 1 FROM crm_accounts replacement
              WHERE replacement.external_customer_id=OLD.external_customer_id
                AND replacement.id!=NEW.id
                AND COALESCE(replacement.lifecycle_status,'active')='active'
                AND replacement.assignment_status='claimed'
                AND replacement.intake_item_id=crm_intake_items.id
                AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
            ) THEN suggested_owner_id
            ELSE ''
          END,
          assigned_owner_id=CASE
            WHEN EXISTS (
              SELECT 1 FROM crm_accounts replacement
              WHERE replacement.external_customer_id=OLD.external_customer_id
                AND replacement.id!=NEW.id
                AND COALESCE(replacement.lifecycle_status,'active')='active'
                AND replacement.assignment_status='claimed'
                AND replacement.intake_item_id=crm_intake_items.id
                AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
            ) THEN COALESCE(
              (SELECT NULLIF(replacement.owner_id,'') FROM crm_accounts replacement
               WHERE replacement.external_customer_id=OLD.external_customer_id
                 AND replacement.id!=NEW.id
                 AND COALESCE(replacement.lifecycle_status,'active')='active'
                 AND replacement.assignment_status='claimed'
                 AND replacement.intake_item_id=crm_intake_items.id
                 AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
               ORDER BY replacement.id LIMIT 1),
              assigned_owner_id
            )
            ELSE ''
          END,
          assigned_at=CASE
            WHEN EXISTS (
              SELECT 1 FROM crm_accounts replacement
              WHERE replacement.external_customer_id=OLD.external_customer_id
                AND replacement.id!=NEW.id
                AND COALESCE(replacement.lifecycle_status,'active')='active'
                AND replacement.assignment_status='claimed'
                AND replacement.intake_item_id=crm_intake_items.id
                AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
            ) THEN assigned_at
            ELSE ''
          END,
          claim_due_at=CASE
            WHEN EXISTS (
              SELECT 1 FROM crm_accounts replacement
              WHERE replacement.external_customer_id=OLD.external_customer_id
                AND replacement.id!=NEW.id
                AND COALESCE(replacement.lifecycle_status,'active')='active'
                AND replacement.assignment_status='claimed'
                AND replacement.intake_item_id=crm_intake_items.id
                AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
            ) THEN claim_due_at
            ELSE ''
          END,
          claimed_at=CASE
            WHEN EXISTS (
              SELECT 1 FROM crm_accounts replacement
              WHERE replacement.external_customer_id=OLD.external_customer_id
                AND replacement.id!=NEW.id
                AND COALESCE(replacement.lifecycle_status,'active')='active'
                AND replacement.assignment_status='claimed'
                AND replacement.intake_item_id=crm_intake_items.id
                AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
            ) THEN COALESCE(
              (SELECT NULLIF(replacement.claimed_at,'') FROM crm_accounts replacement
               WHERE replacement.external_customer_id=OLD.external_customer_id
                 AND replacement.id!=NEW.id
                 AND COALESCE(replacement.lifecycle_status,'active')='active'
                 AND replacement.assignment_status='claimed'
                 AND replacement.intake_item_id=crm_intake_items.id
                 AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
               ORDER BY replacement.id LIMIT 1),
              NULLIF(claimed_at,''),
              strftime('%Y-%m-%d %H:%M:%S','now')
            )
            ELSE ''
          END,
          return_reason=CASE
            WHEN EXISTS (
              SELECT 1 FROM crm_accounts replacement
              WHERE replacement.external_customer_id=OLD.external_customer_id
                AND replacement.id!=NEW.id
                AND COALESCE(replacement.lifecycle_status,'active')='active'
                AND replacement.assignment_status='claimed'
                AND replacement.intake_item_id=crm_intake_items.id
                AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
            ) THEN return_reason
            ELSE ''
          END,
          duplicate_state=CASE
            WHEN EXISTS (
              SELECT 1 FROM crm_accounts replacement
              WHERE replacement.external_customer_id=OLD.external_customer_id
                AND replacement.id!=NEW.id
                AND COALESCE(replacement.lifecycle_status,'active')='active'
                AND replacement.assignment_status='claimed'
                AND replacement.intake_item_id=crm_intake_items.id
                AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
            ) THEN duplicate_state
            ELSE 'exact'
          END,
          duplicate_review_id=CASE
            WHEN EXISTS (
              SELECT 1 FROM crm_accounts replacement
              WHERE replacement.external_customer_id=OLD.external_customer_id
                AND replacement.id!=NEW.id
                AND COALESCE(replacement.lifecycle_status,'active')='active'
                AND replacement.assignment_status='claimed'
                AND replacement.intake_item_id=crm_intake_items.id
                AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
            ) THEN duplicate_review_id
            ELSE ''
          END,
          decision_reason=CASE
            WHEN EXISTS (
              SELECT 1 FROM crm_accounts replacement
              WHERE replacement.external_customer_id=OLD.external_customer_id
                AND replacement.id!=NEW.id
                AND COALESCE(replacement.lifecycle_status,'active')='active'
                AND replacement.assignment_status='claimed'
                AND replacement.intake_item_id=crm_intake_items.id
                AND TRIM(COALESCE(replacement.intake_item_id,''))!=''
            ) THEN decision_reason
            ELSE '客户已在CRM'
          END,
          updated_at=strftime('%Y-%m-%d %H:%M:%S','now')
      WHERE external_customer_id=OLD.external_customer_id
        AND crm_customer_id=NEW.id
        AND status IN ('claimed','duplicate')
        AND EXISTS (
          SELECT 1 FROM crm_accounts replacement
          WHERE replacement.external_customer_id=OLD.external_customer_id
            AND replacement.id!=NEW.id
            AND COALESCE(replacement.lifecycle_status,'active')='active'
            AND replacement.assignment_status='claimed'
        );

      UPDATE crm_accounts
      SET owner_id=CASE
            WHEN TRIM(COALESCE(owner_id,''))='' THEN (
              SELECT NULLIF(i.assigned_owner_id,'') FROM crm_intake_items i
              WHERE i.id=crm_accounts.intake_item_id
                AND i.external_customer_id=crm_accounts.external_customer_id
                AND i.crm_customer_id=crm_accounts.id
                AND i.status='claimed'
            )
            ELSE owner_id
          END,
          claimed_at=CASE
            WHEN TRIM(COALESCE(claimed_at,''))='' THEN COALESCE(
              (SELECT NULLIF(i.claimed_at,'') FROM crm_intake_items i
               WHERE i.id=crm_accounts.intake_item_id
                 AND i.external_customer_id=crm_accounts.external_customer_id
                 AND i.crm_customer_id=crm_accounts.id
                 AND i.status='claimed'),
              strftime('%Y-%m-%d %H:%M:%S','now')
            )
            ELSE claimed_at
          END
      WHERE external_customer_id=OLD.external_customer_id
        AND id!=NEW.id
        AND COALESCE(lifecycle_status,'active')='active'
        AND assignment_status='claimed'
        AND EXISTS (
          SELECT 1 FROM crm_intake_items i
          WHERE i.id=crm_accounts.intake_item_id
            AND i.external_customer_id=crm_accounts.external_customer_id
            AND i.crm_customer_id=crm_accounts.id
            AND i.status='claimed'
        );

      UPDATE crm_intake_items
      SET status='returned',
          crm_customer_id='',
          suggested_owner_id='',
          assigned_owner_id='',
          assigned_at='',
          claim_due_at='',
          claimed_at='',
          return_reason='CRM客户身份已变更，原线索已退回',
          duplicate_state='',
          duplicate_review_id='',
          decision_reason='CRM客户身份已变更，原线索已退回',
          updated_at=strftime('%Y-%m-%d %H:%M:%S','now')
      WHERE external_customer_id=OLD.external_customer_id
        AND crm_customer_id=NEW.id
        AND status IN ('claimed','duplicate')
        AND NOT EXISTS (
          SELECT 1 FROM crm_accounts replacement
          WHERE replacement.external_customer_id=OLD.external_customer_id
            AND replacement.id!=NEW.id
            AND COALESCE(replacement.lifecycle_status,'active')='active'
            AND replacement.assignment_status='claimed'
        );

      UPDATE crm_intake_items
      SET status=CASE WHEN status='claimed' THEN 'returned' ELSE status END,
          crm_customer_id='',
          suggested_owner_id=CASE WHEN status='claimed' THEN '' ELSE suggested_owner_id END,
          assigned_owner_id=CASE WHEN status='claimed' THEN '' ELSE assigned_owner_id END,
          assigned_at=CASE WHEN status='claimed' THEN '' ELSE assigned_at END,
          claim_due_at=CASE WHEN status='claimed' THEN '' ELSE claim_due_at END,
          claimed_at=CASE WHEN status='claimed' THEN '' ELSE claimed_at END,
          return_reason=CASE
            WHEN status='claimed' THEN 'CRM客户身份已变更，原线索已退回'
            ELSE return_reason
          END,
          duplicate_state='',
          duplicate_review_id='',
          decision_reason=CASE
            WHEN status='claimed' THEN 'CRM客户身份已变更，原线索已退回'
            ELSE decision_reason
          END,
          updated_at=strftime('%Y-%m-%d %H:%M:%S','now')
      WHERE external_customer_id=OLD.external_customer_id
        AND crm_customer_id=NEW.id;

      UPDATE crm_intake_items
      SET status=CASE
            WHEN id=NEW.intake_item_id AND TRIM(COALESCE(NEW.intake_item_id,''))!=''
              THEN 'claimed'
            ELSE 'duplicate'
          END,
          crm_customer_id=NEW.id,
          suggested_owner_id=CASE WHEN id=NEW.intake_item_id THEN suggested_owner_id ELSE '' END,
          assigned_owner_id=CASE
            WHEN id=NEW.intake_item_id THEN COALESCE(NULLIF(NEW.owner_id,''),assigned_owner_id)
            ELSE ''
          END,
          assigned_at=CASE WHEN id=NEW.intake_item_id THEN assigned_at ELSE '' END,
          claim_due_at=CASE WHEN id=NEW.intake_item_id THEN claim_due_at ELSE '' END,
          claimed_at=CASE
            WHEN id=NEW.intake_item_id THEN COALESCE(
              NULLIF(NEW.claimed_at,''),
              NULLIF(claimed_at,''),
              strftime('%Y-%m-%d %H:%M:%S','now')
            )
            ELSE ''
          END,
          return_reason=CASE WHEN id=NEW.intake_item_id THEN return_reason ELSE '' END,
          duplicate_state=CASE WHEN id=NEW.intake_item_id THEN duplicate_state ELSE 'exact' END,
          duplicate_review_id=CASE WHEN id=NEW.intake_item_id THEN duplicate_review_id ELSE '' END,
          decision_reason=CASE WHEN id=NEW.intake_item_id THEN decision_reason ELSE '客户已在CRM' END,
          updated_at=strftime('%Y-%m-%d %H:%M:%S','now')
      WHERE external_customer_id=NEW.external_customer_id
        AND status IN ('pending','approved','assigned','returned')
        AND TRIM(NEW.external_customer_id)!=''
        AND COALESCE(NEW.lifecycle_status,'active')='active'
        AND NEW.assignment_status='claimed';

      UPDATE crm_accounts
      SET owner_id=CASE
            WHEN TRIM(COALESCE(owner_id,''))='' THEN (
              SELECT NULLIF(i.assigned_owner_id,'') FROM crm_intake_items i
              WHERE i.id=NEW.intake_item_id
                AND i.external_customer_id=NEW.external_customer_id
                AND i.crm_customer_id=NEW.id
                AND i.status='claimed'
            )
            ELSE owner_id
          END,
          claimed_at=CASE
            WHEN TRIM(COALESCE(claimed_at,''))='' THEN COALESCE(
              (SELECT NULLIF(i.claimed_at,'') FROM crm_intake_items i
               WHERE i.id=NEW.intake_item_id
                 AND i.external_customer_id=NEW.external_customer_id
                 AND i.crm_customer_id=NEW.id
                 AND i.status='claimed'),
              strftime('%Y-%m-%d %H:%M:%S','now')
            )
            ELSE claimed_at
          END
      WHERE id=NEW.id
        AND COALESCE(lifecycle_status,'active')='active'
        AND assignment_status='claimed'
        AND EXISTS (
          SELECT 1 FROM crm_intake_items i
          WHERE i.id=NEW.intake_item_id
            AND i.external_customer_id=NEW.external_customer_id
            AND i.crm_customer_id=NEW.id
            AND i.status='claimed'
        );
    END;
  `);
  if (value.inTransaction) install();
  else value.transaction(install).immediate();
}

function clearLegacyRiskAssignmentBlocks(value) {
  value.prepare(`
    UPDATE crm_intake_items
    SET decision_reason='',updated_at=?
    WHERE status IN ('pending','approved')
      AND TRIM(decision_reason) IN (
        '风险拦截：需管理员审核后分配',
        '风险或制裁信息阻断'
      )
  `).run(nowText());
}

function ensureTodayTaskActionTypes(value) {
  const tableSql = value.prepare(`SELECT sql FROM sqlite_master
    WHERE type='table' AND name='crm_today_task_action_requests'`).get()?.sql || '';
  if (!tableSql || tableSql.includes('confirm_manager_assistance')) return;
  const foreignKeysEnabled = Number(value.pragma('foreign_keys', { simple: true })) === 1;
  value.pragma('foreign_keys = OFF');
  try {
    value.transaction(() => {
      value.exec(tableSql
        .replace(
          "'resolve_overdue_lead','add_next_plan','complete_manager_assistance'",
          "'resolve_overdue_lead','add_next_plan','complete_manager_assistance','confirm_manager_assistance'",
        )
        .replace(/crm_today_task_action_requests(?=[\s(])/g, 'crm_today_task_action_requests_v291')
      );
      value.exec('INSERT INTO crm_today_task_action_requests_v291 SELECT * FROM crm_today_task_action_requests');
      value.exec('DROP TABLE crm_today_task_action_requests');
      value.exec('ALTER TABLE crm_today_task_action_requests_v291 RENAME TO crm_today_task_action_requests');
      value.exec(`CREATE INDEX IF NOT EXISTS crm_today_task_action_target_idx
        ON crm_today_task_action_requests(target_type,target_id,created_at DESC)`);
    })();
  } finally {
    value.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
  }
}

function ensurePlanOnlyActionSchema(value) {
  value.exec(`CREATE TABLE IF NOT EXISTS crm_plan_only_action_requests (
    idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
    actor_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
    response_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

function ensureNotificationPermissionDefaults(value) {
  for (const table of ['permission_groups', 'sales_users']) {
    if (!hasTable(value, table)) continue;
    const rows = value.prepare(`SELECT id,permissions_json FROM ${table}
      WHERE TRIM(COALESCE(permissions_json,''))!=''`).all();
    for (const row of rows) {
      let permissions;
      try { permissions = JSON.parse(row.permissions_json || '{}'); } catch { continue; }
      if (permissions && typeof permissions === 'object'
          && !Object.prototype.hasOwnProperty.call(permissions, 'view_notifications')) {
        permissions.view_notifications = true;
        value.prepare(`UPDATE ${table} SET permissions_json=?,updated_at=? WHERE id=?`)
          .run(JSON.stringify(permissions), nowText(), row.id);
      }
    }
  }
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

// 演示用线索池数据：让 /field-schema/intake 扫出的字段目录在 3201 预览时有内容可看。
// 仅供 CRM_SEED_DEMO_DATA=true 的开发 runtime 使用；生产路径不触发；幂等（intake 空才 seed）。
function seedDemoIntake(value) {
  if (value.prepare('SELECT COUNT(*) n FROM crm_intake_items').get().n) return;
  const batches = [{
    id: 'BATCH-DEMO-20260827', batchDate: dateOffset(-1).slice(0, 10), source: 'demo-seed',
  }, {
    id: 'BATCH-DEMO-20260828', batchDate: dateOffset(0).slice(0, 10), source: 'demo-seed',
  }];
  const insertBatch = value.prepare(`INSERT OR IGNORE INTO crm_intake_batches
    (id,batch_date,source,status,candidate_count,imported_count,assigned_count,skipped_count,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const batch of batches) {
    insertBatch.run(
      batch.id, batch.batchDate, batch.source, 'completed', 6, 6, 2, 0, 'system', nowText(),
    );
  }
  const rows = [
    // id, company, country, website, industry, customer_type, product_focus, match_score, match_group,
    // contact_name, contact_title, contact_methods, contact_level, status, suggested_owner_id, assigned_owner_id,
    // decision_reason, return_reason, assigned_at, claim_due_at, batch_id
    // 注：crm_intake_items 表无 city 列，字段目录中的 city 当前显示为空（数据源未提供）。
    ['INT-DEMO-01', 'SteelBridge Metals', '俄罗斯', 'steelbridge.com', '金属加工', '终端制造商', '不锈钢板 / 法兰', 92, 'A',
      'Oleg Petrov', '采购经理', 'oleg@steelbridge.com · WhatsApp', 'L3', 'assigned', 'USR-S01', 'USR-S01', '高匹配：同行业老客户转介绍', '', dateOffset(-1), dateOffset(1), 'BATCH-DEMO-20260827'],
    ['INT-DEMO-02', 'Northwind Logistics', '德国', 'northwind.de', '物流设备', '集成商', '输送机配件', 78, 'B',
      '', '', '', 'L0', 'assigned', 'USR-S02', 'USR-S02', '物流设备集成商', '', dateOffset(-2), dateOffset(0), 'BATCH-DEMO-20260827'],
    ['INT-DEMO-03', 'Andes Mining Supply', '巴西', 'andes.sc', '矿业设备', '经销商', '矿用传感器', 61, 'B',
      'Rafael Costa', '采购总监', 'rafael@andes.sc', 'L2', 'pending', 'USR-S03', '', '匹配度中等，等待分配', '', '', '', 'BATCH-DEMO-20260828'],
    ['INT-DEMO-04', 'Caspian Agro', '哈萨克斯坦', 'caspagro.kz', '农业设备', '终端制造商', '灌溉控制模块', 84, 'A',
      'Aigul N.', '技术负责人', 'aigul@caspagro.kz', 'L3', 'pending', 'USR-S04', '', '农业政策利好，值得跟进', '', '', '', 'BATCH-DEMO-20260828'],
    ['INT-DEMO-05', 'Monterrey Auto Parts', '墨西哥', 'mtyparts.mx', '汽车电子', '终端制造商', '连接器 / 线束', 55, 'C',
      'Carlos Diaz', '采购', 'carlos@mtyparts.mx', 'L1', 'returned', 'USR-S01', 'USR-S01', '', '价格未确认，暂缓', dateOffset(-3), '', 'BATCH-DEMO-20260827'],
    ['INT-DEMO-06', 'Volga Renewables', '俄罗斯', 'volga-rnw.ru', '新能源', '工程公司', '光伏逆变器', 71, 'B',
      '', '', '', 'L0', 'imported', 'USR-S03', '', '新能源重点项目', '', '', '', 'BATCH-DEMO-20260828'],
  ];
  const insertItem = value.prepare(`INSERT OR IGNORE INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,country,website,industry,customer_type,product_focus,
     match_score,match_group,contact_name,contact_title,contact_methods,contact_level,status,
     suggested_owner_id,assigned_owner_id,decision_reason,return_reason,assigned_at,claim_due_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const created = dateOffset(-1);
  rows.forEach((row) => {
    const [id, company, country, website, industry, customerType, productFocus,
      score, group, contactName, contactTitle, contactMethods, contactLevel, status,
      suggestedOwner, assignedOwner, decisionReason, returnReason, assignedAt, claimDueAt, batchId] = row;
    insertItem.run(
      id, batchId, `EXT-DEMO-${String(id).replace('INT-DEMO-', '')}`, company, country, website, industry,
      customerType, productFocus, score, group, contactName || '', contactTitle || '', contactMethods || '',
      contactLevel, status, suggestedOwner || '', assignedOwner || '', decisionReason || '', returnReason || '',
      assignedAt || '', claimDueAt || '', created, nowText(),
    );
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
      ? { sql: "WHERE COALESCE(a.lifecycle_status,'active')='active' AND COALESCE(a.assignment_status,'')!='returned' AND COALESCE(a.is_test_data,0)=0", params: [] }
      : { sql: "WHERE a.owner_id IS NOT NULL AND COALESCE(a.lifecycle_status,'active')='active' AND COALESCE(a.assignment_status,'')!='returned' AND COALESCE(a.is_test_data,0)=0", params: [] }
    : { sql: "WHERE a.owner_id=? AND COALESCE(a.assignment_status,'claimed')!='returned' AND COALESCE(a.lifecycle_status,'active')='active' AND COALESCE(a.is_test_data,0)=0", params: [user.id] };
}

function teamStatusAccountRows(value, user) {
  const scope = accountScope(user);
  return addStageLabels(value.prepare(`SELECT a.*,
    COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
    COALESCE(NULLIF(p.country,''),a.country) country,
    COALESCE(NULLIF(p.industry,''),a.industry) industry,
    COALESCE(NULLIF(p.customer_type,''),a.customer_type) customer_type
    FROM crm_accounts a
    LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
    ${scope.sql}
    ORDER BY a.updated_at DESC,a.id`).all(...scope.params));
}

function teamStatusScope(value, user, accounts = teamStatusAccountRows(value, user)) {
  const accountIds = new Set(accounts.map(row => String(row.id || '')).filter(Boolean));
  const externalCustomerIds = new Set(accounts
    .map(row => String(row.external_customer_id || '')).filter(Boolean));
  let salesUserIds = new Set(accounts
    .map(row => String(row.owner_id || '')).filter(Boolean));
  if (hasPermission(user, 'view_all_customers')) {
    salesUserIds = new Set(value.prepare(
      "SELECT id FROM sales_users WHERE role='sales' AND active=1 AND COALESCE(archived_at,'')=''",
    ).all().map(row => String(row.id)));
  }
  if (String(user?.role || '') === 'sales') salesUserIds = new Set([String(user.id)]);
  return { accounts, accountIds, externalCustomerIds, salesUserIds };
}

function teamStatusCapabilityData(value, scope) {
  const accountIds = [...scope.accountIds];
  const placeholders = accountIds.length ? accountIds.map(() => '?').join(',') : "''";
  const activityHistory = publicActivityRecords(addActivityProvenance(value.prepare(`SELECT x.*,u.name user_name
    FROM crm_activities x LEFT JOIN sales_users u ON u.id=x.user_id
    WHERE x.customer_id IN (${placeholders}) AND COALESCE(x.is_test_data,0)=0
    ORDER BY x.occurred_at DESC,x.id`).all(...accountIds)));
  const activities = activityHistory.filter(isEffectiveActivity);
  const activityById = new Map(activityHistory.map(row => [String(row.id || ''), row]));
  const effectiveCommerce = row => !row.activity_id
    || isEffectiveActivity(activityById.get(String(row.activity_id || '')));
  const tableRows = (table, orderBy) => value.prepare(`SELECT * FROM ${table}
    WHERE customer_id IN (${placeholders}) ORDER BY ${orderBy}`).all(...accountIds)
    .filter(effectiveCommerce);
  const users = hydrateUsersPermissions(value, value.prepare(
    "SELECT * FROM sales_users WHERE active=1 AND COALESCE(archived_at,'')='' ORDER BY role,name,id",
  ).all()).filter(row => String(row.role || '') !== 'sales'
    || scope.salesUserIds.has(String(row.id || '')));
  return {
    users,
    accounts: scope.accounts,
    activities,
    rfqs: tableRows('crm_rfqs', 'received_at DESC,id'),
    quotes: tableRows('crm_quotes', 'sent_at DESC,id'),
    orders: tableRows('crm_orders', 'ordered_at DESC,id'),
  };
}

function teamStatusFilterRaw(filters, expectedPage) {
  if (filters === undefined || filters === null || filters === '') return {};
  let parsed = filters;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); }
    catch (_error) { throw badRequest('筛选条件格式无效'); }
  }
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.filters)) {
    if (parsed.page && String(parsed.page) !== String(expectedPage)) {
      throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
    }
    parsed = parsed.filters;
  }
  if (!Array.isArray(parsed)) {
    if (!parsed || typeof parsed !== 'object') throw badRequest('筛选条件格式无效');
    return parsed;
  }
  const raw = {};
  for (const filter of parsed) {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
      throw badRequest('筛选条件格式无效');
    }
    const key = String(filter.key || '');
    if (!key || Object.prototype.hasOwnProperty.call(raw, key)) {
      throw badRequest('筛选条件格式无效');
    }
    raw[key] = Object.fromEntries(Object.entries(filter).filter(([name]) => name !== 'key'));
  }
  return raw;
}

function authorizedTeamStatusAst(value, user, page, input = {}) {
  const currentVersion = getFilterPermissionVersion(value);
  if (input.permissionVersion !== undefined
      && String(input.permissionVersion) !== String(currentVersion)) {
    throw filterVersionError();
  }
  return validateFilterQuery(value, user, page, teamStatusFilterRaw(input.filters, page));
}

function teamStatusRequest(value, user, page, input, allowedKeys) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (Object.keys(source).some(key => !allowedKeys.has(key))) {
    throw httpError(403, '请求参数未获授权', 'TEAM_STATUS_QUERY_NOT_AUTHORIZED');
  }
  const ast = authorizedTeamStatusAst(value, user, page, source);
  return { ...source, filters: ast, permissionVersion: ast.version };
}

const TEAM_STATUS_READ_KEYS = new Set([
  'range', 'filters', 'permissionVersion', 'drilldown', 'page', 'pageSize', 'page_size',
]);
const TEAM_STATUS_CURSOR_KEYS = new Set([
  'filters', 'permissionVersion',
  'fromExclusive', 'toInclusive', 'lastViewedAt', 'cursor', 'cursorTime',
  'drilldown', 'page', 'pageSize', 'page_size',
]);
const TEAM_STATUS_EXPORT_KEYS = new Set([
  'section', 'range', 'format', 'filters', 'permissionVersion',
]);
const COLLABORATION_READ_KEYS = new Set([
  'from', 'to', 'filters', 'page', 'pageSize', 'page_size', 'permissionVersion',
]);
const COLLABORATION_EXPORT_KEYS = new Set([
  'format', 'from', 'to', 'filters', 'permissionVersion',
]);

function paginateTeamProgress(result, input = {}) {
  const requested = String(input.drilldown || '').trim().toLowerCase();
  const drilldownKey = { customer: 'customers', task: 'tasks', timeline: 'timeline' }[requested];
  if (!drilldownKey || !result?.progress?.drilldown) return result;
  const rows = result.progress.drilldown[drilldownKey] || [];
  const page = paginateTeamStatusRows(rows, input, rows.length);
  return {
    ...result,
    progress: {
      ...result.progress,
      drilldown: { customers: [], tasks: [], timeline: [], [drilldownKey]: page.rows },
      pagination: {
        kind: requested, page: page.page, pageSize: page.pageSize,
        total: page.total, totalPages: Math.ceil(page.total / page.pageSize),
        authorizedTotal: page.authorizedTotal, hasMore: page.hasMore,
      },
    },
  };
}

function filterVersionError() {
  return httpError(409, '筛选权限已更新，请重新加载筛选项', 'FILTER_VERSION_CONFLICT');
}

function parseFilterEnvelope(query = {}) {
  if (!query.filters) return {};
  let parsed;
  try {
    parsed = JSON.parse(String(query.filters));
  } catch (_error) {
    throw badRequest('筛选条件格式无效');
  }
  if (Array.isArray(parsed)) {
    const result = {};
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw badRequest('筛选条件格式无效');
      const key = String(item.field || item.key || '');
      if (!key) throw badRequest('筛选条件格式无效');
      if (item.operator === 'in') {
        result[key] = { operator: 'in', values: Array.isArray(item.value) ? item.value : item.values };
      } else if (item.operator === 'between') {
        const value = item.value && typeof item.value === 'object' ? item.value : item;
        result[key] = { operator: 'between', from: value.from, to: value.to };
      } else {
        result[key] = { operator: item.operator, value: item.value };
      }
    }
    return result;
  }
  if (!parsed || typeof parsed !== 'object') throw badRequest('筛选条件格式无效');
  return parsed;
}

function authorizedFilterAst(value, user, page, query = {}) {
  const currentVersion = getFilterPermissionVersion(value);
  if (query.permissionVersion !== undefined
      && String(query.permissionVersion) !== String(currentVersion)) {
    throw filterVersionError();
  }
  return validateFilterQuery(value, user, page, parseFilterEnvelope(query));
}

function filterAstToCustomerQuery(ast, query = {}) {
  const result = {
    quickView: String(query.quickView || 'all'),
    sort: String(query.sort || 'pending_priority'),
    tagFilters: [],
  };
  if (query.onlyOverdue !== undefined) result.onlyOverdue = query.onlyOverdue;
  if (query.stageReached !== undefined) result.stageReached = query.stageReached;
  const mappings = {
    search: 'search',
    country: 'countries',
    city: 'cities',
    owner: 'owners',
    stage: 'stages',
    customer_type: 'customerTypes',
    industry: 'industries',
    priority: 'priorities',
    source: 'sources',
    creator: 'creators',
    last_action: 'lastActionBuckets',
    next_step: 'nextStepBuckets',
    established_year: 'establishedYears',
    intake_flow: 'intakeFlow',
  };
  for (const filter of ast.filters) {
    if (filter.key.startsWith('tag_')) {
      result.tagFilters.push(filter);
    } else if (filter.key === 'created_at') {
      result.createdFrom = filter.from;
      result.createdTo = filter.to;
    } else if (mappings[filter.key]) {
      result[mappings[filter.key]] = filter.values || filter.value;
    }
  }
  return result;
}

function assertAuthorizedCustomerModifiers(value, user, query = {}) {
  const allowed = new Set(effectiveFilterSchemaFor(value, user, 'customers').filters
    .map(item => item.key));
  const quickView = String(query.quickView || 'all');
  const requiredByQuickView = {
    mine: 'owner',
    unassigned: 'owner',
    today: 'next_step',
    overdue: 'next_step',
    no_next: 'next_step',
    disqualified: 'stage',
  };
  if (requiredByQuickView[quickView] && !allowed.has(requiredByQuickView[quickView])) {
    throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
  }
  if (query.stageReached && !allowed.has('stage')) {
    throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
  }
  if (query.onlyOverdue !== undefined
      && String(query.onlyOverdue || '').trim()
      && !allowed.has('next_step')) {
    throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
  }
}

function legacyCustomerFilterRawQuery(query = {}) {
  const raw = {};
  const text = String(query.search || '').trim();
  if (text) raw.search = { operator: 'contains', value: text };
  const mappings = {
    country: query.countries ?? query.country,
    owner: query.owners ?? query.owner,
    stage: query.stages ?? query.stage,
    customer_type: query.customerTypes,
    industry: query.industries,
    priority: query.priorities ?? query.priority,
    source: query.sources,
    creator: query.creators,
    last_action: query.lastActionBuckets,
    next_step: query.nextStepBuckets,
    established_year: query.establishedYears,
  };
  for (const [key, candidate] of Object.entries(mappings)) {
    const values = Array.isArray(candidate)
      ? candidate.map(String).map(item => item.trim()).filter(Boolean)
      : String(candidate || '').split(',').map(item => item.trim()).filter(Boolean);
    if (values.length) raw[key] = { operator: 'in', values: [...new Set(values)] };
  }
  if (query.createdFrom && query.createdTo) {
    raw.created_at = {
      operator: 'between',
      from: String(query.createdFrom),
      to: String(query.createdTo),
    };
  }
  return raw;
}

function assertUnambiguousCustomerFilterQuery(query = {}) {
  const evaluationTags = intakeQueryValues(query.evaluationTags ?? query.evaluationTag);
  if (evaluationTags.length) {
    throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
  }
  if (query.filters && Object.keys(legacyCustomerFilterRawQuery(query)).length) {
    throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
  }
}

function customerLinkageClause(value, user, ast, fieldKey) {
  const remaining = astWithoutField(ast, fieldKey);
  if (!remaining.filters?.length) return { sql: '', params: [] };
  const customerInput = filterAstToCustomerQuery(remaining);
  const customerQuery = buildCustomerQuery(customerInput, {
    user,
    canViewContacts: hasPermission(user, 'view_contacts'),
    canViewInsights: hasPermission(user, 'view_insights'),
  });
  const filters = [...customerQuery.filters];
  const params = [...customerQuery.params];
  addAuthorizedTagFilters(
    filters,
    params,
    customerInput.tagFilters,
    effectiveFilterSchemaFor(value, user, remaining.page || 'customers').filters,
  );
  if (!filters.length) return { sql: '', params: [] };
  return { sql: `AND ${filters.join(' AND ')}`, params };
}

function filterOptionsCatalog(value, user, definition, extra = { sql: '', params: [] }) {
  const scope = accountScope(user);
  const baseFrom = `FROM crm_accounts a
    LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id`;
  const grouped = (expression, labelExpression = expression, joins = '') => value.prepare(`SELECT
      CAST(${expression} AS TEXT) value,CAST(${labelExpression} AS TEXT) label,COUNT(DISTINCT a.id) count
      ${baseFrom} ${joins} ${scope.sql}
        ${extra.sql}
        AND TRIM(COALESCE(CAST(${expression} AS TEXT),''))!=''
      GROUP BY ${expression},${labelExpression}
      ORDER BY label COLLATE NOCASE`).all(...scope.params, ...extra.params).map(row => ({
    value: String(row.value),
    label: String(row.label || row.value),
    count: Number(row.count || 0),
  }));
  if (definition.key === 'country') {
    return grouped("COALESCE(NULLIF(p.country,''),a.country)");
  }
  if (definition.key === 'city') {
    return grouped("COALESCE(NULLIF(p.city,''),a.city)");
  }
  if (definition.key === 'industry') {
    return grouped("COALESCE(NULLIF(p.industry,''),a.industry)");
  }
  if (definition.key === 'customer_type') {
    return grouped("COALESCE(NULLIF(p.customer_type,''),a.customer_type)");
  }
  if (definition.key === 'owner') {
    return grouped(
      "COALESCE(NULLIF(a.owner_id,''),'__unassigned__')",
      "COALESCE(NULLIF(owner.name,''),'未分配')",
      'LEFT JOIN sales_users owner ON owner.id=a.owner_id',
    );
  }
  if (definition.key === 'creator') {
    return grouped(
      "COALESCE(NULLIF(a.created_by,''),'__legacy__')",
      `CASE WHEN a.created_by='system' THEN '系统导入'
        ELSE COALESCE(NULLIF(creator.name,''),'历史数据/未知') END`,
      'LEFT JOIN sales_users creator ON creator.id=a.created_by',
    );
  }
  if (definition.key === 'stage') {
    const counts = new Map(grouped('a.stage').map(option => [option.value, option.count]));
    return STAGES.map(([stage, label]) => ({
      value: stage,
      label,
      count: Number(counts.get(stage) || 0),
    }));
  }
  if (definition.key === 'priority') return grouped('a.priority');
  if (definition.key === 'source') return grouped('a.source');
  if (definition.key === 'established_year') return grouped('COALESCE(a.established_year,p.established_year)');
  if (definition.key === 'intake_flow') {
    return [
      { value: 'claimed', label: '销售已领取 / CRM' },
      { value: 'contacted', label: '当前触达' },
    ];
  }
  if (definition.key === 'last_action') {
    return [
      ['today', '今天'], ['7d', '近 7 天'], ['30d', '近 30 天'],
      ['older', '30 天前'], ['none', '从未记录'],
    ].map(([optionValue, label]) => ({ value: optionValue, label }));
  }
  if (definition.key === 'next_step') {
    return [
      ['overdue', '已超期'], ['today', '今天'], ['7d', '未来 7 天'],
      ['later', '7 天以后'], ['none', '未填写'],
    ].map(([optionValue, label]) => ({ value: optionValue, label }));
  }
  if (definition.type === 'tag_multi') {
    return value.prepare(`SELECT CAST(t.id AS TEXT) value,t.name label,COUNT(DISTINCT a.id) count
      FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
      JOIN customer_tags ct ON ct.customer_id=a.external_customer_id
      JOIN tags t ON t.id=ct.tag_id
      ${scope.sql} ${extra.sql} AND t.category=?
      GROUP BY t.id,t.name ORDER BY t.name COLLATE NOCASE`)
      .all(...scope.params, ...extra.params, definition.tagCategory)
      .map(row => ({
        value: String(row.value),
        label: String(row.label || row.value),
        count: Number(row.count || 0),
      }));
  }
  return [];
}

function filterOptionsFor(value, user, definition, ast = { filters: [] }) {
  const extra = customerLinkageClause(value, user, ast, definition.key);
  const catalog = filterOptionsCatalog(value, user, definition);
  if (!extra.sql || ['intake_flow', 'last_action', 'next_step'].includes(definition.key)) {
    return catalog;
  }
  return overlayOptionCounts(catalog, filterOptionsCatalog(value, user, definition, extra));
}

function authorizedFilterSchema(value, user, page, options = {}) {
  const effective = effectiveFilterSchemaFor(value, user, page);
  const linkageAst = options.linkageAst || { page, filters: [] };
  const researchOptions = ['contacts', 'recon'].includes(page)
    ? researchFilterOptions(value, user, page, effective.filters, linkageAst)
    : null;
  const intakeOptions = ['intake', 'lead_flow'].includes(page)
    ? intakeFlowFilterOptions(value, user, page, effective.filters, linkageAst)
    : null;
  const businessOptions = [
    'pipeline', 'alerts', 'insights', 'recycle_bin',
    'manager_tasks', 'manager_risks', 'manager_metrics', 'notifications',
  ].includes(page)
    ? businessFilterOptions(value, user, page, effective.filters, options)
    : null;
  const correctionOptions = Object.values(ACTIVITY_CORRECTION_FILTER_PAGES).includes(page)
    ? activityCorrectionFilterOptions(value, user, page, effective.filters, options)
    : null;
  const teamStatusOptions = Object.values(TEAM_STATUS_FILTER_PAGES).includes(page)
    ? teamStatusFilterOptions(value, user, page, effective.filters)
    : null;
  const pageOptions = researchOptions || intakeOptions || businessOptions || correctionOptions
    || teamStatusOptions;
  const fields = effective.filters.map(definition => {
    const type = definition.type === 'text'
      ? 'search'
      : definition.type === 'tag_multi'
        ? 'tag'
        : definition.type === 'multi'
          ? 'facet'
          : 'date_range';
    const placement = definition.type === 'text'
      ? 'search'
      : definition.type === 'tag_multi'
        ? 'tag'
        : definition.displayMode === 'horizontal'
          ? 'facet'
          : 'more';
    const field = {
      key: definition.key,
      label: definition.label,
      type,
      operator: definition.operators[0],
      placement,
      multi: ['multi', 'tag_multi'].includes(definition.type),
      sensitive: definition.sensitive,
      options: pageOptions
        ? pageOptions[definition.key]
          || (teamStatusOptions ? filterOptionsFor(value, user, definition, linkageAst) : [])
        : filterOptionsFor(value, user, definition, linkageAst),
    };
    if (definition.key === 'search') {
      const ranges = page === 'contacts'
        ? ['客户', '联系人', '职位', '部门', '联系方式']
        : page === 'recon'
          ? ['客户', '企业', '行业', '客户类型']
          : ['企业', '网站', '行业'];
      if (['customers', 'intake', 'lead_flow', 'recycle_bin', 'pipeline', 'contacts', 'recon'].includes(page)) {
        ranges.unshift('客户昵称');
      }
      if (!['contacts', 'recon'].includes(page) && hasPermission(user, 'view_contacts')) {
        ranges.push('产品', '联系人');
      }
      if (page === 'recon' && hasPermission(user, 'view_contacts')) ranges.push('机会', '联系人');
      if (!['contacts', 'recon'].includes(page) && hasPermission(user, 'view_insights')) {
        ranges.push('评价');
      }
      field.placeholder = `搜索${ranges.join('、')}`;
    }
    return field;
  });
  return {
    pageKey: page,
    schemaVersion: 'issue116-v1',
    permissionVersion: String(effective.version),
    fields,
  };
}

function loadAuthorizedBusinessPage(user, pageKey, query = {}, options = {}) {
  const page = String(pageKey || '');
  if (![
    'intake', 'lead_flow', 'pipeline', 'alerts', 'insights', 'recycle_bin',
    'manager_tasks', 'manager_risks', 'manager_metrics', 'notifications',
  ].includes(page)) {
    throw httpError(404, '未知数据列表', 'BUSINESS_PAGE_NOT_FOUND');
  }
  const allowedQueryKeys = new Set([
    'page', 'pageSize', 'page_size', 'permissionVersion', 'filters',
  ]);
  if (page === 'alerts') allowedQueryKeys.add('urgency');
  if (page === 'pipeline') {
    allowedQueryKeys.add('actionQueue');
    allowedQueryKeys.add('starView');
  }
  if (Object.keys(query).some(key => !allowedQueryKeys.has(key))) {
    throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
  }
  const listQuery = {
    ...query,
    pageSize: Number.parseInt(query.pageSize || query.page_size, 10) === 100 ? 100 : 50,
  };
  const value = db();
  try {
    let runtimeOptions = {};
    if (['insights', 'notifications'].includes(page)) {
      const features = featureState(value, options.hardFlags || resolveAIHardFlags());
      runtimeOptions = {
        aiEnabled: features.ai_stations.effectiveEnabled,
        ...(page === 'notifications'
          ? { salesPackEnabled: features.sales_pack.effectiveEnabled }
          : {}),
      };
    }
    const ast = authorizedFilterAst(value, user, page, listQuery);
    let result;
    if (page === 'intake' || page === 'lead_flow') {
      const intake = queryIntakeFlowPage(value, user, page, ast, listQuery);
      enrichIntakeMasterDetails(value, intake.items);
      const warningByExternalId = leadIdentityWarningsForExternalCustomerIds(
        value, intake.items.map(item => item.external_customer_id),
      );
      const identityResolutions = identityConflictResolutionsForExternalIds(
        value, intake.items.map(item => item.external_customer_id),
      );
      const developmentByItem = intakeDevelopmentHistory(value, intake.items);
      intake.items.forEach(item => {
        applyManualAssignmentEligibility(value, item);
        if (item.duplicate_state === 'review') {
          item.claimBlocked = true;
          if (user.role === 'sales' || !hasPermission(user, 'manage_intake')) {
            item.reviewVagueHint = '该客户需要管理员确认，确认后可继续领取。';
          }
        }
        const developmentHistory = developmentByItem.get(item.id) || null;
        item.developmentTimeline = developmentHistory?.timeline || [];
        if (developmentHistory) delete developmentHistory.timeline;
        item.developmentHistory = developmentHistory;
        item.identityWarning = warningByExternalId.get(item.external_customer_id) || null;
        const reusesReturnedAccount = Boolean(reusableReturnedAccountForIntake(
          intakeAccountsByExternalId(value, item), item,
        ));
        if (item.identityWarning && !reusesReturnedAccount) {
          item.assignable = false;
          item.assignmentBlockReason = IDENTITY_REVIEW_BLOCK_REASON;
          item.claimBlocked = true;
          if (user.role === 'sales' || !hasPermission(user, 'manage_intake')) {
            item.reviewVagueHint = '该客户需要管理员确认，确认后可继续领取。';
          }
        }
        item.can_edit_nickname = Boolean(
          hasPermission(user, 'edit_customer')
          && canAccessCustomerMaster(value, user, item.external_customer_id),
        );
        hydrateDuplicateLinkFields(value, item);
        applyIdentityConflictResolution(item, identityResolutions);
      });
      result = { ...intake, rows: intake.items };
      delete result.items;
    } else if (page === 'pipeline') {
      result = listPipelineRows(value, user, ast, {
        ...listQuery,
        actionQueue: String(query.actionQueue || ''),
        starView: String(query.starView || 'all'),
      });
    } else if (page === 'alerts') {
      result = listTodayTasks(value, user, ast, listQuery, {
        urgency: String(query.urgency || ''),
      });
    } else if (page === 'insights') {
      result = listManagerEvaluationCustomers(value, user, ast, listQuery, runtimeOptions);
    } else if (page === 'manager_tasks') {
      result = listManagerTaskRows(value, user, ast, listQuery);
    } else if (page === 'manager_risks') {
      result = listManagerRiskRows(value, user, ast, listQuery);
    } else if (page === 'manager_metrics') {
      result = listManagerMetricRows(value, user, ast, listQuery, {
        settings: getManagerTaskSettings(value),
      });
    } else if (page === 'notifications') {
      result = listNotificationRows(value, user, ast, listQuery, runtimeOptions);
    } else {
      result = listRecycleRows(value, user, ast, {
        ...listQuery,
        isImpersonating: Boolean(options.isImpersonating),
      });
    }
    return {
      ...result,
      totalPages: Number(result.totalPages ?? Math.ceil(Number(result.total || 0) / listQuery.pageSize)),
      schema: authorizedFilterSchema(value, user, page, runtimeOptions),
    };
  } finally { value.close(); }
}

function allowedCustomerTagCategories(value, user) {
  return new Set(effectiveFilterSchemaFor(value, user, 'customers').filters
    .filter(item => item.type === 'tag_multi' && item.tagCategory)
    .map(item => item.tagCategory));
}

function redactUnauthorizedProfileTags(value, user, payload) {
  const allowed = allowedCustomerTagCategories(value, user);
  if (hasPermission(user, 'view_insights')) allowed.add('AI评价标签');
  const keep = tag => allowed.has(String(tag?.category || ''));
  const result = { ...payload };
  result.customerPool = (payload.customerPool || []).map(item => ({
    ...item,
    tags: (item.tags || []).filter(keep),
  }));
  result.customers = (payload.customers || []).map(item => ({
    ...item,
    tags: (item.tags || []).filter(keep),
  }));
  result.tags = (payload.tags || []).filter(keep);
  result.tagCategories = (payload.tagCategories || []).filter(category => allowed.has(String(category)));
  return result;
}

function assertAuthorizedIntakeTagQuery(value, user, query = {}) {
  const selected = intakeQueryValues(query.customerTag);
  if (!selected.length) return;
  const allowed = allowedCustomerTagCategories(value, user);
  if (!allowed.size) throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
  const rows = value.prepare(`SELECT DISTINCT category FROM tags
    WHERE CAST(id AS TEXT) IN (${selected.map(() => '?').join(',')})
      OR name IN (${selected.map(() => '?').join(',')})`).all(...selected, ...selected);
  if (!rows.length || rows.some(row => !allowed.has(row.category))) {
    throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
  }
}

function addAuthorizedTagFilters(filters, params, tagFilters, definitions) {
  const definitionMap = new Map(definitions.map(item => [item.key, item]));
  for (const tagFilter of tagFilters || []) {
    const definition = definitionMap.get(tagFilter.key);
    if (!definition?.tagCategory || !tagFilter.values?.length) continue;
    const values = tagFilter.values.map(String);
    filters.push(`EXISTS (
      SELECT 1 FROM customer_tags scoped_tag_link
      JOIN tags scoped_tag ON scoped_tag.id=scoped_tag_link.tag_id
      WHERE scoped_tag_link.customer_id=a.external_customer_id
        AND scoped_tag.category=?
        AND (CAST(scoped_tag.id AS TEXT) IN (${values.map(() => '?').join(',')})
          OR scoped_tag.name IN (${values.map(() => '?').join(',')}))
    )`);
    params.push(definition.tagCategory, ...values, ...values);
  }
}

function crmAccountProjection(value, alias = 'a') {
  return value.prepare('PRAGMA table_info(crm_accounts)').all()
    .map(column => String(column.name || ''))
    .filter(column => column && column !== 'potential_value')
    .map(column => `${alias}."${column.replace(/"/g, '""')}"`)
    .join(',');
}

function listCustomerAccounts(user, query = {}) {
  assertPermission(user, 'view_customers');
  const value = db();
  try {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const pageSize = Number.parseInt(query.pageSize || query.page_size, 10) === 100 ? 100 : 50;
    const offset = (page - 1) * pageSize;
    const ast = authorizedFilterAst(value, user, 'customers', query);
    assertAuthorizedCustomerModifiers(value, user, query);
    const schema = authorizedFilterSchema(value, user, 'customers');
    const customerInput = filterAstToCustomerQuery(ast, query);
    const starView = normalizeStarView(query.starView || 'all', user);
    const quickView = String(customerInput.quickView || 'all');
    if (!['all', 'mine', 'unassigned', 'today', 'overdue', 'no_next', 'disqualified'].includes(quickView)) {
      throw badRequest('筛选条件格式无效');
    }
    const customerQuery = buildCustomerQuery(customerInput, {
      user,
      canViewContacts: hasPermission(user, 'view_contacts'),
      canViewInsights: hasPermission(user, 'view_insights'),
    });
    const scope = accountScope(user);
    const filters = [scope.sql.replace(/^WHERE\s+/i, ''), ...customerQuery.filters];
    const params = [...scope.params, ...customerQuery.params];
    const selectedStars = starFilter(starView, user);
    if (selectedStars.sql) {
      filters.push(selectedStars.sql);
      params.push(...selectedStars.params);
    }
    addAuthorizedTagFilters(filters, params, customerInput.tagFilters, effectiveFilterSchemaFor(
      value, user, 'customers',
    ).filters);
    const from = `FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
      LEFT JOIN sales_users owner ON owner.id=a.owner_id
      LEFT JOIN sales_users creator ON creator.id=a.created_by`;
    const where = `WHERE ${filters.join(' AND ')}`;
    const total = Number(value.prepare(`SELECT COUNT(DISTINCT a.id) total ${from} ${where}`)
      .get(...params).total || 0);
    const authorizedTotal = Number(value.prepare(`SELECT COUNT(*) total FROM crm_accounts a ${scope.sql}`)
      .get(...scope.params).total || 0);
    let rows = addStageLabels(value.prepare(`SELECT DISTINCT ${crmAccountProjection(value)},
      COALESCE(p.nickname,a.nickname,'') nickname,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
      COALESCE(p.russian_name,'') russian_name,
      COALESCE(p.english_name,'') english_name,
      COALESCE(NULLIF(p.country,''),a.country) country,
      COALESCE(NULLIF(p.city,''),a.city) city,
      COALESCE(NULLIF(p.website,''),a.website) website,
      COALESCE(NULLIF(p.industry,''),a.industry) industry,
      COALESCE(NULLIF(p.customer_type,''),a.customer_type) customer_type,
      COALESCE(NULLIF(p.products,''),a.product_focus) product_focus,
      COALESCE(p.established_year,a.established_year) established_year,
      p.description master_description,p.current_pool,p.rating,p.best_contact_level,
      p.contact_recon_status,p.deep_report,p.source_file,
      owner.name owner_name,creator.name creator_name
      ${from} ${where}
      ORDER BY ${customerQuery.orderBy} LIMIT ? OFFSET ?`).all(
      ...params, ...customerQuery.orderParams, pageSize, offset,
    ));
    const allowedTagCategories = allowedCustomerTagCategories(value, user);
    const byExternalId = new Map(rows.map(row => [row.external_customer_id, row]));
    if (byExternalId.size && allowedTagCategories.size) {
      const externalIds = [...byExternalId.keys()].filter(Boolean);
      if (externalIds.length) {
        const tagRows = value.prepare(`SELECT ct.customer_id,t.id,t.name,t.category,t.color,t.is_preset
          FROM customer_tags ct JOIN tags t ON t.id=ct.tag_id
          WHERE ct.customer_id IN (${externalIds.map(() => '?').join(',')})
            AND t.category IN (${[...allowedTagCategories].map(() => '?').join(',')})
          ORDER BY t.category,t.name,t.id`).all(...externalIds, ...allowedTagCategories);
        for (const row of tagRows) {
          const account = byExternalId.get(row.customer_id);
          if (!account) continue;
          account.customerTags ||= [];
          account.customerTags.push({
            id: row.id,
            name: row.name,
            category: row.category,
            color: row.color,
            isPreset: Boolean(row.is_preset),
          });
        }
      }
    }
    rows.forEach(row => { row.customerTags ||= []; });
    const contactSafeRows = hasPermission(user, 'view_contacts')
      ? rows
      : redactContactFields(rows);
    const safeRows = attachCustomerStarState(value, user, contactSafeRows);
    return {
      rows: safeRows,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      authorizedTotal,
      hasMore: offset + rows.length < total,
      schema,
      starView,
      canViewTeamStars: canViewTeamStars(user),
    };
  } finally { value.close(); }
}

function setCustomerStar(user, customerId, payload = {}, identity = {}) {
  assertPermission(user, 'view_customers');
  if (typeof payload.active !== 'boolean') throw badRequest('请选择加星或取消星标');
  const cleanCustomerId = String(customerId || '').trim();
  const reason = payload.active ? normalizeCustomerStarReason(payload.reason) : '';
  const value = db();
  try {
    return value.transaction(() => {
      const scope = accountScope(user);
      const account = value.prepare(`SELECT a.id FROM crm_accounts a ${scope.sql} AND a.id=?`)
        .get(...scope.params, cleanCustomerId);
      if (!account) throw forbidden('当前客户不在可见范围内');
      const current = value.prepare(`SELECT * FROM crm_customer_stars
        WHERE customer_id=? AND user_id=?`).get(cleanCustomerId, user.id);
      if ((!payload.active && !current?.active)
          || (payload.active && current?.active && String(current.reason || '') === reason)) {
        const [starState] = attachCustomerStarState(value, user, [{ id: cleanCustomerId }]);
        return { customerId: cleanCustomerId, starState, unchanged: true };
      }
      const at = nowText();
      if (payload.active) {
        if (current) {
          value.prepare(`UPDATE crm_customer_stars SET reason=?,active=1,starred_at=?,
            unstarred_at='',updated_at=? WHERE id=?`)
            .run(reason, current.active ? current.starred_at : at, at, current.id);
        } else {
          value.prepare(`INSERT INTO crm_customer_stars
            (id,customer_id,user_id,reason,active,starred_at,unstarred_at,updated_at)
            VALUES (?,?,?,?,1,?,'',?)`).run(id('STAR'), cleanCustomerId, user.id, reason, at, at);
        }
      } else if (current?.active) {
        value.prepare(`UPDATE crm_customer_stars SET active=0,unstarred_at=?,updated_at=?
          WHERE id=?`).run(at, at, current.id);
      }
      const realUserId = identity.realUserId || user.id;
      const effectiveUserId = identity.effectiveUserId || user.id;
      value.prepare(`INSERT INTO crm_audit_log
        (id,user_id,action,entity_type,entity_id,detail_json,created_at,
         real_user_id,effective_user_id,impersonation_context_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        id('AUD'), effectiveUserId,
        payload.active ? (current?.active ? 'customer_star_updated' : 'customer_star_added') : 'customer_star_removed',
        'customer_star', cleanCustomerId,
        JSON.stringify(redactAuditPayload({ reason, previousReason: current?.reason || '' })), at,
        realUserId, effectiveUserId, identity.contextId || '',
      );
      const [starState] = attachCustomerStarState(value, user, [{ id: cleanCustomerId }]);
      return { customerId: cleanCustomerId, starState };
    })();
  } finally { value.close(); }
}

function filterPermissionAdminState(value) {
  const definitions = listFilterDefinitions(value);
  const groupRows = value.prepare(`SELECT group_id,filter_key
    FROM permission_group_filter_grants ORDER BY group_id,filter_key`).all();
  const userRows = value.prepare(`SELECT user_id,filter_key
    FROM user_filter_extra_grants ORDER BY user_id,filter_key`).all();
  const grantsByGroup = {};
  const extrasByUser = {};
  groupRows.forEach(row => { (grantsByGroup[row.group_id] ||= []).push(row.filter_key); });
  userRows.forEach(row => { (extrasByUser[row.user_id] ||= []).push(row.filter_key); });
  const users = hydrateUsersPermissions(value, value.prepare(
    "SELECT * FROM sales_users WHERE archived_at='' OR archived_at IS NULL ORDER BY role,name",
  ).all()).map(user => ({
    id: user.id,
    name: user.name,
    role: user.role,
    permissionGroupId: user.permission_group_id || '',
    permissionGroupName: user.permission_group_name || '',
    permissions: permissionsFor(user),
    extraFilterGrants: extrasByUser[user.id] || [],
  }));
  return {
    version: getFilterPermissionVersion(value),
    definitions,
    availableSources: listAvailableFilterSources(value),
    permissionGroups: listPermissionGroups(value).map(group => ({
      ...group,
      filterGrants: grantsByGroup[group.id] || [],
    })),
    users,
    audit: value.prepare(`SELECT * FROM filter_permission_audit
      ORDER BY created_at DESC,rowid DESC LIMIT 100`).all().map(row => ({
      ...row,
      before: json(row.before_json, {}),
      after: json(row.after_json, {}),
    })),
  };
}

function noPlanStreakForActivities(activities) {
  const rows = (Array.isArray(activities) ? activities : [])
    .filter(row => isEffectiveActivity(row) && !Number(row.is_test_data || 0))
    .sort((left, right) =>
      String(right.occurred_at || '').localeCompare(String(left.occurred_at || ''))
      || String(right.id || '').localeCompare(String(left.id || ''))
      || String(right.created_at || '').localeCompare(String(left.created_at || ''))
    );
  let count = 0;
  let streakStartId = '';
  for (const row of rows) {
    if (!Number(row.no_plan || row.noPlan || 0)) break;
    count += 1;
    streakStartId = String(row.id || '');
  }
  return { count, streakStartId };
}

function buildAlerts(accounts, activities, rfqs, quotes, planEvents = [], managerTasks = []) {
  const latestByCustomer = new Map();
  const managerRequestByCustomer = new Map();
  const latestPlanByCustomer = new Map();
  for (const event of planEvents) {
    const current = latestPlanByCustomer.get(event.customer_id);
    if (!current || String(event.created_at).localeCompare(String(current.created_at)) > 0
        || (event.created_at === current.created_at
          && String(event.id).localeCompare(String(current.id)) > 0)) {
      latestPlanByCustomer.set(event.customer_id, event);
    }
  }
  activities.forEach(activity => {
    if (!latestByCustomer.has(activity.customer_id)) latestByCustomer.set(activity.customer_id, activity);
    if ((activity.manager_required || activity.managerRequired)
        && !managerRequestByCustomer.has(activity.customer_id)) {
      managerRequestByCustomer.set(activity.customer_id, {
        requesterId: activity.user_id || '',
        requesterName: activity.user_name || activity.actor_name || activity.user_id || '',
        requestedAt: activity.occurred_at || '',
        reason: activity.summary || activity.outcome || '',
        progress: activity.progress_key || activity.progressType || activity.activity_type || '',
      });
    }
  });
  const managerReplyByCustomer = new Map();
  activities.forEach(activity => {
    if ((activity.progress_key || activity.progressType || '') !== 'manager_join') return;
    if ((activity.outcome || activity.reaction_label_snapshot || '') !== '已回复') return;
    if (!managerReplyByCustomer.has(activity.customer_id)) {
      managerReplyByCustomer.set(activity.customer_id, {
        repliedById: activity.user_id || '',
        repliedByName: activity.user_name || activity.actor_name || activity.user_id || '',
        repliedAt: activity.occurred_at || '',
        result: activity.summary || activity.outcome || '',
      });
    }
  });
  const managerTaskByCustomer = new Map();
  managerTasks.forEach(task => {
    if (task.reason === 'manager_assistance' && task.customerId) {
      managerTaskByCustomer.set(String(task.customerId), task);
    }
  });
  const accountIdByExternalId = new Map(accounts.map(account =>
    [String(account.external_customer_id || ''), String(account.id || '')]));
  for (const [customerId, task] of managerTaskByCustomer) {
    const accountId = accountIdByExternalId.get(String(customerId)) || String(customerId);
    const fromActivity = managerRequestByCustomer.get(accountId) || {};
    managerRequestByCustomer.set(accountId, {
      requesterId: fromActivity.requesterId || task.actorIdSnapshot || '',
      requesterName: fromActivity.requesterName || '',
      requestedAt: fromActivity.requestedAt || task.triggeredAt || '',
      reason: task.evidence?.requestReason || fromActivity.reason || '',
      progress: fromActivity.progress || '',
      originalPlan: task.evidence?.originalPlan || '',
      contacts: Array.isArray(task.evidence?.contacts) ? task.evidence.contacts : [],
      dueAt: task.dueAt || task.evidence?.dueAt || '',
    });
  }
  const noPlanStreakByCustomer = new Map();
  for (const activity of activities) {
    const customerId = String(activity.customer_id || '');
    if (!customerId) continue;
    if (!noPlanStreakByCustomer.has(customerId)) noPlanStreakByCustomer.set(customerId, []);
    noPlanStreakByCustomer.get(customerId).push(activity);
  }
  for (const [customerId, rows] of noPlanStreakByCustomer) {
    noPlanStreakByCustomer.set(customerId, noPlanStreakForActivities(rows));
  }
  const rfqByCustomer = new Map(rfqs.map(row => [row.customer_id, row]));
  const quoteByCustomer = new Map(quotes.map(row => [row.customer_id, row]));
  const now = Date.now();
  const hours = value => value ? (now - new Date(String(value).replace(' ', 'T') + 'Z').getTime()) / 3600000 : Infinity;
  const alerts = [];
  const add = (account, severity, code, title, detail, action, overdueHours = 0, extra = {}) => {
    const actionContract = {
      UNCLAIMED: {
        actionKind: 'resolve_overdue_lead',
        allowedActions: ['reassign', 'return_to_pool'],
      },
      NO_NEXT: {
        actionKind: 'add_next_plan',
        allowedActions: ['add_next_plan'],
      },
      NO_NEXT_DEFERRED: {
        actionKind: 'add_next_plan',
        allowedActions: ['add_next_plan'],
      },
      MANAGER_NEEDED: {
        actionKind: 'complete_manager_assistance',
        allowedActions: ['complete_manager_assistance'],
      },
      MANAGER_REPLIED: {
        actionKind: 'confirm_manager_assistance',
        allowedActions: ['confirm_manager_assistance'],
      },
      RFQ_UNQUOTED: {
        actionKind: 'record_quote',
        allowedActions: ['record_quote'],
      },
      INTAKE_IDLE: {
        actionKind: 'record_activity',
        allowedActions: ['record_activity'],
      },
      OVERDUE: {
        actionKind: 'record_activity',
        allowedActions: ['record_activity'],
      },
      REPLY_IDLE: {
        actionKind: 'record_activity',
        allowedActions: ['record_activity'],
      },
      POST_MANAGER_IDLE: {
        actionKind: 'record_activity',
        allowedActions: ['record_activity'],
      },
      MEETING_NO_RFQ: {
        actionKind: 'record_activity',
        allowedActions: ['record_activity'],
      },
      QUOTE_IDLE: {
        actionKind: 'record_activity',
        allowedActions: ['record_activity'],
      },
      STALE: {
        actionKind: 'record_activity',
        allowedActions: ['record_activity'],
      },
    }[code] || { actionKind: '', allowedActions: [] };
    alerts.push({
      id: `${code}-${account.id}`, severity, code, title, detail, action,
      customerId: account.id, companyName: account.nickname || account.company_name,
      externalCustomerId: account.external_customer_id || '',
      officialCompanyName: account.company_name, nickname: account.nickname || '',
      intakeItemId: code === 'UNCLAIMED' ? account.intake_item_id || '' : '',
      ownerId: account.owner_id,
      ownerName: account.owner_name || '',
      assignedAt: account.assigned_at || '',
      managerRequest: ['MANAGER_NEEDED', 'MANAGER_REPLIED'].includes(code)
        ? managerRequestByCustomer.get(account.id) || null
        : null,
      ...actionContract,
      dueAt: account.next_action_at || '', stage: account.stage,
      customerPriority: account.priority || 'C',
      overdueHours: Math.max(0, Math.floor(overdueHours || 0)),
      updatedAt: account.updated_at || account.last_activity_at || account.created_at || '',
      ...extra,
    });
  };
  for (const account of accounts) {
    if (isFollowUpTerminalStage(account.stage)) continue;
    const last = latestByCustomer.get(account.id);
    const currentPlan = latestPlanByCustomer.get(account.external_customer_id || account.id);
    const age = hours(account.last_activity_at || account.created_at);
    const nextAt = account.next_action_at ? new Date(String(account.next_action_at).replace(' ', 'T') + 'Z').getTime() : 0;
    const claimDue = account.claim_due_at ? new Date(String(account.claim_due_at).replace(' ', 'T') + 'Z').getTime() : 0;
    if (account.assignment_status === 'assigned' && claimDue && claimDue < now) add(account, 'critical', 'UNCLAIMED', '每日客户未按时领取', '系统推送的客户已超过领取时限', '立即领取或重新分配', (now - claimDue) / 3600000);
    if (account.intake_item_id && account.assignment_status === 'claimed' && account.stage === 'qualified' && hours(account.claimed_at || account.assigned_at) > 48) {
      add(account, 'critical', 'INTAKE_IDLE', '领取后48小时未首次触达', '销售已领取每日客户，但尚未完成邮件、电话或社媒触达', '立即完成首次触达');
    }
    if (!account.next_action || !account.next_action_at) {
      if (currentPlan?.type === 'deferred') {
        const reviewAt = new Date(`${String(currentPlan.review_at).replace(' ', 'T')}Z`).getTime();
        if (Number.isFinite(reviewAt) && reviewAt <= now) {
          add(
            { ...account, next_action_at: currentPlan.review_at },
            'critical',
            'NO_NEXT_DEFERRED',
            '下一步计划仍未确定',
            currentPlan.reason || '已到再次复查时间，请确认真实下一步',
            '填写计划或再次设置复查时间',
            (now - reviewAt) / 3600000,
          );
        }
      } else {
        add(account, 'critical', 'NO_NEXT', '缺少下一步计划', '活跃客户没有明确的下一步动作与日期', '立即补充计划');
      }
    }
    if (nextAt && nextAt < now) add(account, 'critical', 'OVERDUE', '跟进任务已超期', `${account.next_action} 已超过计划时间`, '今天完成跟进', (now - nextAt) / 3600000);
    if (account.stage === 'replied' && age > 24) add(account, 'critical', 'REPLY_IDLE', '客户回复后未及时推进', `客户回复后已停滞 ${Math.floor(age)} 小时`, '立即响应客户');
    if (['meeting', 'manager'].includes(account.stage) && age > 168) add(account, 'critical', 'MEETING_NO_RFQ', '会议后7天未收到询价', '需要确认采购时间、BOM准备状态或会议质量', '销售复盘并追踪BOM');
    if (account.manager_required && account.manager_status === '待介入') add(account, 'warning', 'MANAGER_NEEDED', '需要主管协助', account.manager_status || '销售已发起主管协助', '安排主管参与');
    if (account.manager_required && account.manager_status === '已回复') {
      const reply = managerReplyByCustomer.get(account.id) || null;
      add(account, 'critical', 'MANAGER_REPLIED',
        '主管已回复，待销售确认并制定下一步计划',
        reply?.result || '主管已完成处理，请确认回执并制定下一步计划',
        '制定下一步计划并完成协助闭环', 0, { managerReply: reply });
    }
    const rfq = rfqByCustomer.get(account.id);
    if (rfq && !rfq.quoted_at && hours(rfq.received_at) > 24) add(account, 'critical', 'RFQ_UNQUOTED', '询价超过24小时未报价', `${rfq.bom_lines} 行BOM仍未完成报价`, '立即协调采购报价');
    const quote = quoteByCustomer.get(account.id);
    if (quote && !['won', 'lost'].includes(quote.status) && hours(account.last_activity_at) > 72) add(account, 'warning', 'QUOTE_IDLE', '报价后3天未跟进', '报价已发送但没有新的有效动作', '确认客户反馈');
    if (age > 336) add(account, 'warning', 'STALE', '客户超过14天未推进', `当前停留在“${STAGE_LABELS[account.stage] || account.stage}”`, '记录继续推进或关闭结果');
    if (last && last.manager_required && age > 72 && account.manager_status === '已介入') add(account, 'critical', 'POST_MANAGER_IDLE', '管理者介入后销售未承接', '管理者参与后超过3天没有销售跟进行动', '销售立即承接');
    const noPlanStreak = noPlanStreakByCustomer.get(account.id);
    if (noPlanStreak && Number(noPlanStreak.count) >= 3) {
      const customerLabel = account.nickname || account.company_name || '客户';
      const ownerLabel = account.owner_name || '未分配';
      add(
        account,
        'warning',
        'NO_PLAN_STREAK',
        `连续 ${noPlanStreak.count} 次暂无计划`,
        `${customerLabel} · 当前负责人 ${ownerLabel} · 已连续 ${noPlanStreak.count} 次暂无计划 · 建议主管协助并形成明确下一步`,
        '主管协助并形成明确下一步',
        0,
        { noPlanStreak: Number(noPlanStreak.count) },
      );
    }
  }
  const priority = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => priority[a.severity] - priority[b.severity] || a.companyName.localeCompare(b.companyName));
}

function filterTodayTaskAlertsForUser(alerts, user) {
  if (!user?.role) return alerts;
  const canSeeManagerReasons = ['admin', 'manager'].includes(String(user.role))
    && hasPermission(user, 'resolve_manager_tasks')
    && hasPermission(user, 'view_team')
    && hasPermission(user, 'view_alerts');
  if (canSeeManagerReasons) {
    return (Array.isArray(alerts) ? alerts : []).filter(alert => alert.code !== 'MANAGER_REPLIED');
  }
  return (Array.isArray(alerts) ? alerts : []).filter(alert =>
    alert.code !== 'MANAGER_NEEDED'
    && (alert.code !== 'MANAGER_REPLIED' || alert.ownerId === user.id));
}

const ALERT_REASON_ORDER = Object.freeze({
  RFQ_UNQUOTED: 10,
  MANAGER_NEEDED: 20,
  MANAGER_REPLIED: 25,
  UNCLAIMED_LEAD: 30,
  UNCLAIMED: 30,
  PRIORITY_OVERDUE: 40,
  NO_NEXT_DEFERRED: 45,
  NO_PLAN_STREAK: 46,
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
  if (['NO_NEXT_DEFERRED', 'NO_NEXT', 'INTAKE_IDLE', 'OVERDUE', 'REPLY_IDLE', 'POST_MANAGER_IDLE'].includes(alert.code)) return 'today';
  return 'attention';
}

function groupAlerts(alerts) {
  const customerIdsByExternalId = new Map();
  for (const alert of alerts) {
    if (!alert.externalCustomerId || !alert.customerId) continue;
    const customerIds = customerIdsByExternalId.get(alert.externalCustomerId) || new Set();
    customerIds.add(alert.customerId);
    customerIdsByExternalId.set(alert.externalCustomerId, customerIds);
  }
  const groups = new Map();
  for (const alert of alerts) {
    const externalCustomerIds = customerIdsByExternalId.get(alert.externalCustomerId);
    const unambiguousExternalId = alert.externalCustomerId && (!externalCustomerIds || externalCustomerIds.size <= 1);
    const key = unambiguousExternalId
      ? `external:${alert.externalCustomerId}`
      : alert.customerId
        ? `customer:${alert.customerId}`
        : alert.intakeItemId
          ? `intake:${alert.intakeItemId}`
          : `alert:${alert.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(alert);
  }
  const urgencyOrder = { immediate: 0, today: 1, attention: 2 };
  const priorityOrder = { A: 0, B: 1, C: 2, D: 3 };
  return [...groups.values()].map(reasons => {
    const semanticReasons = [];
    const overdueClaimIndex = new Map();
    for (const reason of reasons) {
      const isOverdueClaim = ['UNCLAIMED', 'UNCLAIMED_LEAD'].includes(reason.code)
        && reason.intakeItemId;
      if (!isOverdueClaim) {
        semanticReasons.push(reason);
        continue;
      }
      const semanticKey = String(reason.intakeItemId);
      const existingIndex = overdueClaimIndex.get(semanticKey);
      if (existingIndex === undefined) {
        overdueClaimIndex.set(semanticKey, semanticReasons.length);
        semanticReasons.push(reason);
        continue;
      }
      const existing = semanticReasons[existingIndex];
      const preferred = reason.code === 'UNCLAIMED_LEAD' ? reason : existing;
      const companion = preferred === reason ? existing : reason;
      semanticReasons[existingIndex] = {
        ...companion,
        ...preferred,
        customerId: preferred.customerId || companion.customerId || '',
        externalCustomerId: preferred.externalCustomerId || companion.externalCustomerId || '',
        intakeItemId: preferred.intakeItemId || companion.intakeItemId || '',
        overdueHours: Math.max(
          Number(existing.overdueHours || 0),
          Number(reason.overdueHours || 0),
        ),
      };
    }
    const ordered = semanticReasons.sort((left, right) =>
      reasonOrder(left) - reasonOrder(right)
      || Number(right.overdueHours || 0) - Number(left.overdueHours || 0)
      || String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    const primary = ordered[0];
    const urgency = urgencyFor(primary);
    return {
      ...primary,
      externalCustomerId: ordered.find(reason => reason.externalCustomerId)?.externalCustomerId || '',
      intakeItemId: ordered.find(reason => reason.intakeItemId)?.intakeItemId || '',
      customerId: ordered.find(reason => reason.customerId)?.customerId || '',
      severity: urgency === 'immediate' ? 'critical' : urgency === 'today' ? 'today' : 'warning',
      urgency,
      urgencyLabel: urgency === 'immediate' ? '立即处理' : urgency === 'today' ? '今天完成' : '需要关注',
      reasons: ordered.map(reason => ({
        code: reason.code,
        title: reason.title,
        detail: reason.detail,
        action: reason.action,
        actionKind: reason.actionKind || '',
        allowedActions: reason.allowedActions || [],
        assignedAt: reason.assignedAt || '',
        ownerName: reason.ownerName || '',
        managerRequest: reason.managerRequest || null,
        dueAt: reason.dueAt || '',
        overdueHours: Number(reason.overdueHours || 0),
        noPlanStreak: Number(reason.noPlanStreak || 0),
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
    || String(left.companyName || '').localeCompare(String(right.companyName || ''), 'zh-CN')
    || String(left.customerId || '').localeCompare(String(right.customerId || ''))
    || String(left.intakeItemId || '').localeCompare(String(right.intakeItemId || ''))
    || String(left.id || '').localeCompare(String(right.id || '')));
}

function authorizeTodayTaskActions(alerts, user) {
  const allowed = actionKind => {
    if (actionKind === 'resolve_overdue_lead') {
      return ['admin', 'manager'].includes(String(user?.role || ''))
        && hasPermission(user, 'manage_intake');
    }
    if (actionKind === 'add_next_plan') return hasPermission(user, 'record_activity');
    if (actionKind === 'record_activity') return hasPermission(user, 'record_activity');
    if (actionKind === 'record_quote') return hasPermission(user, 'record_quote');
    if (actionKind === 'complete_manager_assistance') {
      return ['admin', 'manager'].includes(String(user?.role || ''))
        && hasPermission(user, 'view_team')
        && hasPermission(user, 'view_alerts');
    }
    if (actionKind === 'confirm_manager_assistance') {
      return hasPermission(user, 'view_alerts') && hasPermission(user, 'record_activity');
    }
    return false;
  };
  return alerts.map(alert => ({
    ...alert,
    allowedActions: allowed(alert.actionKind) ? alert.allowedActions : [],
    reasons: (alert.reasons || []).map(reason => ({
      ...reason,
      allowedActions: allowed(reason.actionKind) ? reason.allowedActions : [],
    })),
  }));
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
    ownerName: item.owner_name || '',
    assignedAt: item.assigned_at || '',
    actionKind: 'resolve_overdue_lead',
    allowedActions: ['reassign', 'return_to_pool'],
    managerRequest: null,
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

// 退回线索若关联已存在的 CRM 账户(含回收站账户),汇总其开发历史摘要,
// 让重新分配/领取前能看到“这家企业曾被开发过”及触达进展。
function intakeDevelopmentHistory(value, items) {
  const result = new Map();
  const accountIds = [...new Set(items
    .map(item => String(item.crm_customer_id || '').trim())
    .filter(Boolean))];
  if (!accountIds.length) return result;
  const placeholders = accountIds.map(() => '?').join(',');
  const rows = value.prepare(`SELECT a.*,
    (SELECT COUNT(*) FROM crm_activities x WHERE x.customer_id=a.id AND COALESCE(x.is_test_data,0)=0) activity_count,
    (SELECT COUNT(*) FROM crm_rfqs x WHERE x.customer_id=a.id) rfq_count,
    (SELECT COUNT(*) FROM crm_quotes x WHERE x.customer_id=a.id) quote_count,
    (SELECT COUNT(*) FROM crm_orders x WHERE x.customer_id=a.id) order_count,
    (SELECT x.occurred_at FROM crm_activities x WHERE x.customer_id=a.id AND COALESCE(x.is_test_data,0)=0
      ORDER BY x.occurred_at DESC LIMIT 1) last_activity_at,
    (SELECT x.activity_type FROM crm_activities x WHERE x.customer_id=a.id AND COALESCE(x.is_test_data,0)=0
      ORDER BY x.occurred_at DESC LIMIT 1) last_activity_type,
    (SELECT x.summary FROM crm_activities x WHERE x.customer_id=a.id AND COALESCE(x.is_test_data,0)=0
      ORDER BY x.occurred_at DESC LIMIT 1) last_activity_summary
    FROM crm_accounts a WHERE a.id IN (${placeholders})`).all(...accountIds);
  const byAccount = new Map(rows.map(row => [row.id, row]));
  for (const item of items) {
    const account = byAccount.get(String(item.crm_customer_id || '').trim());
    if (!account) continue;
    result.set(item.id, {
      accountId: account.id,
      companyName: account.company_name || '',
      stage: account.stage || '',
      recycled: String(account.lifecycle_status || 'active') === 'recycled',
      previousOwnerId: account.previous_owner_id || '',
      activityCount: Number(account.activity_count || 0),
      rfqCount: Number(account.rfq_count || 0),
      quoteCount: Number(account.quote_count || 0),
      orderCount: Number(account.order_count || 0),
      lastActivityAt: account.last_activity_at || '',
      lastActivityType: account.last_activity_type || '',
      lastActivitySummary: account.last_activity_summary || '',
      timeline: buildAccountDevelopmentHistory(value, account).slice(0, 30),
    });
  }
  return result;
}

function enrichIntakeMasterDetails(value, items) {
  const externalIds = [...new Set(items.map(item => String(item.external_customer_id || ''))
    .filter(Boolean))];
  const poolColumns = new Set(value.prepare('PRAGMA table_info(customer_pool)').all()
    .map(column => column.name));
  const requested = [
    ['established_year', 'established_year'],
    ['description', 'master_description'],
    ['products', 'master_products'],
    ['deep_report', 'deep_report'],
    ['source_file', 'source_file'],
    ['updated_at', 'master_updated_at'],
  ];
  const byExternalId = new Map();
  if (externalIds.length) {
    const projection = requested
      .map(([column, alias]) => poolColumns.has(column) ? `p.${column} ${alias}` : `'' ${alias}`)
      .join(',');
    const rows = value.prepare(`SELECT p.customer_id,${projection} FROM customer_pool p
      WHERE p.customer_id IN (${externalIds.map(() => '?').join(',')})`).all(...externalIds);
    rows.forEach(row => byExternalId.set(row.customer_id, row));
  }
  const batchIds = [...new Set(items.map(item => String(item.batch_id || '')).filter(Boolean))];
  const batchSources = batchIds.length
    ? new Map(value.prepare(`SELECT id,source FROM crm_intake_batches
      WHERE id IN (${batchIds.map(() => '?').join(',')})`).all(...batchIds)
      .map(row => [row.id, row.source || '']))
    : new Map();
  items.forEach(item => {
    Object.assign(item, byExternalId.get(item.external_customer_id) || {});
    item.batch_source = batchSources.get(item.batch_id) || '';
  });
  return items;
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
  const filters = ["i.status IN ('pending','approved','assigned','claimed','returned','rejected','duplicate')"];
  const params = [];
  if (user?.role === 'sales' || !hasPermission(user, 'manage_intake')) {
    filters.push("i.status!='duplicate'");
    filters.push('i.assigned_owner_id=?');
    params.push(user.id);
  }
  const search = String(query.search || '').trim().slice(0, 120);
  if (search) {
    const searchableColumns = [
      'i.company_name', 'i.external_customer_id', 'i.website', 'i.industry', 'i.product_focus',
      `(SELECT p.nickname FROM customer_pool p
        WHERE p.customer_id=i.external_customer_id LIMIT 1)`,
      `(SELECT p.company_name FROM customer_pool p
        WHERE p.customer_id=i.external_customer_id LIMIT 1)`,
    ];
    if (hasPermission(user, 'view_contacts')) {
      searchableColumns.push('i.contact_name', 'i.contact_title', 'i.contact_methods');
    }
    filters.push(`(${searchableColumns.map(column => `${column} LIKE ?`).join(' OR ')})`);
    const like = `%${search}%`;
    params.push(...searchableColumns.map(() => like));
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
  ];
  const contactLevels = intakeQueryValues(query.contactLevel);
  if (contactLevels.length) {
    if (!hasPermission(user, 'view_contacts')) {
      throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
    }
    equalsFilters.push(['contactLevel', 'i.contact_level']);
  }
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
  if (hasNamedContact !== null && !hasPermission(user, 'view_contacts')) {
    throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
  }
  if (hasNamedContact === true) filters.push("TRIM(i.contact_name)!=''");
  if (hasNamedContact === false) filters.push("TRIM(i.contact_name)=''");
  if (intakeQueryBoolean(query.unassignedOnly) === true) filters.push("i.assigned_owner_id=''");
  return { filters, params };
}

function loadIntakeFilterOptions(value, user) {
  const { filters, params } = buildIntakeQueryScope(user, {}, { includeStatus: false });
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const allowedTagCategories = [...allowedCustomerTagCategories(value, user)];
  const distinctValues = column => value.prepare(`SELECT DISTINCT TRIM(${column}) value
    FROM crm_intake_items i ${where} AND TRIM(${column})!=''
    ORDER BY value COLLATE NOCASE`).all(...params).map(row => row.value);
  const customerTags = allowedTagCategories.length
    ? value.prepare(`SELECT DISTINCT t.id,t.name,t.category
      FROM crm_intake_items i
      JOIN customer_tags ct ON ct.customer_id=i.external_customer_id
      JOIN tags t ON t.id=ct.tag_id
      ${where} AND t.category IN (${allowedTagCategories.map(() => '?').join(',')})
      ORDER BY t.category COLLATE NOCASE,t.name COLLATE NOCASE`)
      .all(...params, ...allowedTagCategories)
    : [];
  return {
    customerTags,
    countries: distinctValues('i.country'),
    industries: distinctValues('i.industry'),
    customerTypes: distinctValues('i.customer_type'),
    ...(hasPermission(user, 'view_contacts') ? {
      contactLevels: distinctValues('i.contact_level'),
    } : {}),
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
  const scoped = user?.role === 'sales' || !hasPermission(user, 'manage_intake');
  assertAuthorizedIntakeTagQuery(value, user, query);
  const { filters, params } = buildIntakeQueryScope(user, query);
  if (scoped) {
    filters.push(`(i.status='assigned' OR (
      i.duplicate_state='review' AND i.duplicate_review_id IN (
        SELECT id FROM crm_duplicate_reviews WHERE submitted_by=?
      )
    ))`);
    params.push(user.id);
  } else {
    filters.push("i.status IN ('pending','approved','assigned','returned')");
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const total = Number(value.prepare(`SELECT COUNT(*) total FROM crm_intake_items i ${where}`).get(...params).total || 0);
  const items = value.prepare(`SELECT i.*,u.name suggested_owner_name,a.name assigned_owner_name,
    p.established_year,p.description master_description,p.products master_products,
    p.deep_report,p.source_file,p.updated_at master_updated_at,b.source batch_source,
    COALESCE((SELECT p.nickname FROM customer_pool p
      WHERE p.customer_id=i.external_customer_id LIMIT 1),'') nickname,
    COALESCE(NULLIF((SELECT p.company_name FROM customer_pool p
      WHERE p.customer_id=i.external_customer_id LIMIT 1),''),i.company_name) company_name,
    EXISTS(SELECT 1 FROM crm_accounts linked_account
      WHERE linked_account.external_customer_id=i.external_customer_id) in_crm,
    (SELECT linked_account.assignment_status FROM crm_accounts linked_account
      WHERE linked_account.external_customer_id=i.external_customer_id
      ORDER BY linked_account.updated_at DESC,linked_account.created_at DESC LIMIT 1) crm_assignment_status,
    (SELECT linked_account.stage FROM crm_accounts linked_account
      WHERE linked_account.external_customer_id=i.external_customer_id
      ORDER BY linked_account.updated_at DESC,linked_account.created_at DESC LIMIT 1) crm_stage
    FROM crm_intake_items i
    LEFT JOIN crm_intake_batches b ON b.id=i.batch_id
    LEFT JOIN customer_pool p ON p.customer_id=i.external_customer_id
    LEFT JOIN sales_users u ON u.id=i.suggested_owner_id
    LEFT JOIN sales_users a ON a.id=i.assigned_owner_id
    ${where} ORDER BY CASE i.status
      WHEN 'assigned' THEN 0 WHEN 'claimed' THEN 1 WHEN 'returned' THEN 2
      WHEN 'pending' THEN 3 WHEN 'approved' THEN 4 ELSE 5 END,
      i.created_at DESC,i.match_score DESC,i.id ASC LIMIT ? OFFSET ?`).all(...params, listQuery.pageSize, listQuery.offset);
  const externalIds = [...new Set(items.map(item => item.external_customer_id).filter(Boolean))];
  const identityWarnings = leadIdentityWarningsForExternalCustomerIds(value, externalIds);
  const identityResolutions = identityConflictResolutionsForExternalIds(value, externalIds);
  const customerTagsById = new Map();
  const allowedTagCategories = [...allowedCustomerTagCategories(value, user)];
  if (externalIds.length && allowedTagCategories.length) {
    const tagRows = value.prepare(`SELECT ct.customer_id,t.id,t.name,t.category,t.color,t.is_preset
      FROM customer_tags ct JOIN tags t ON t.id=ct.tag_id
      WHERE ct.customer_id IN (${externalIds.map(() => '?').join(',')})
        AND t.category IN (${allowedTagCategories.map(() => '?').join(',')})
      ORDER BY t.category,t.name`).all(...externalIds, ...allowedTagCategories);
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
  const developmentHistoryByItem = intakeDevelopmentHistory(value, items);
  const ownerNames = hasTable(value, 'sales_users')
    ? new Map(value.prepare('SELECT id,name FROM sales_users').all().map(row => [row.id, row.name]))
    : new Map();
  const canViewAssignmentDecisions = user?.role !== 'sales' && hasPermission(user, 'manage_intake');
  for (const item of items) {
    applyManualAssignmentEligibility(value, item);
    if (item.duplicate_state === 'review') item.claimBlocked = true;
    const developmentHistory = developmentHistoryByItem.get(item.id) || null;
    item.developmentTimeline = developmentHistory?.timeline || [];
    if (developmentHistory) delete developmentHistory.timeline;
    item.developmentHistory = developmentHistory;
    item.identityWarning = identityWarnings.get(item.external_customer_id) || null;
    const reusesReturnedAccount = Boolean(reusableReturnedAccountForIntake(
      intakeAccountsByExternalId(value, item), item,
    ));
    if (item.identityWarning && !reusesReturnedAccount) {
      item.assignable = false;
      item.assignmentBlockReason = IDENTITY_REVIEW_BLOCK_REASON;
      item.claimBlocked = true;
    }
    item.can_edit_nickname = Boolean(
      hasPermission(user, 'edit_customer')
      && canAccessCustomerMaster(value, user, item.external_customer_id),
    );
    hydrateDuplicateLinkFields(value, item);
    applyIdentityConflictResolution(item, identityResolutions);
    item.customerTags = customerTagsById.get(item.external_customer_id) || [];
    if (options.includeAI !== false) item.signals = intakeSignals(value, item);
    if (!canViewAssignmentDecisions) {
      item.reviewVagueHint = item.duplicate_state === 'review' || item.identityWarning
        ? '该客户需要管理员确认，确认后可继续领取。'
        : '';
      delete item.suggested_owner_id;
      delete item.suggested_owner_name;
      delete item.decision_reason;
      continue;
    }
    const history = historyByItem.get(item.id) || [];
    const arbitration = history.find(entry => entry.type === 'arbitration') || null;
    const manual = history.find(entry => entry.type === 'manual') || null;
    history.forEach(entry => { entry.actorName = ownerNames.get(entry.actorId) || entry.actorId || '系统'; });
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
    }));
    history.forEach(entry => {
      entry.aiRecommendation.rankedCandidates = (entry.aiRecommendation.rankedCandidates || [])
        .map(candidate => ({
          ...candidate,
          name: ownerNames.get(candidate.userId) || candidate.userId || '',
        }));
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
  const countScope = buildIntakeQueryScope(user, query, { includeStatus: false });
  const countWhere = countScope.filters.length ? `WHERE ${countScope.filters.join(' AND ')}` : '';
  const statusRows = value.prepare(`SELECT i.status,COUNT(*) n FROM crm_intake_items i
    ${countWhere} GROUP BY i.status`).all(...countScope.params);
  const statusCounts = Object.fromEntries(statusRows.map(row => [row.status, row.n]));
  const countAnd = countWhere ? `${countWhere} AND` : 'WHERE';
  const metrics = loadIntakeMetrics(value, user, countScope, {
    ...(options.now === undefined ? {} : { now: options.now }),
    timezone: resolveBusinessTimezone(),
  });
  const overdueClaim = value.prepare(`SELECT COUNT(*) n FROM crm_intake_items i
    ${countAnd} i.status='assigned' AND i.claim_due_at!='' AND i.claim_due_at<?`)
    .get(...countScope.params, nowText()).n;
  const contactedWhere = scoped ? 'AND a.owner_id=?' : '';
  const contacted = value.prepare(`SELECT COUNT(*) n FROM crm_accounts a WHERE a.intake_item_id!=''
    AND COALESCE(a.lifecycle_status,'active')='active'
    AND COALESCE(a.assignment_status,'')!='returned' AND COALESCE(a.is_test_data,0)=0
    AND a.stage IN ('contacted','replied','connected','meeting','manager','rfq','quoted','negotiating','won','repeat') ${contactedWhere}`)
    .get(...(scoped ? [user.id] : [])).n;
  const counts = status => Number(statusCounts[status] || 0);
  const visibleSettings = !canViewAssignmentDecisions ? {
    claimSlaHours: settings.claimSlaHours,
    contactSlaHours: settings.contactSlaHours,
  } : settings;
  return {
    settings: visibleSettings, items, batches, page: listQuery.page, pageSize: listQuery.pageSize, total,
    totalPages: Math.ceil(total / listQuery.pageSize),
    hasMore: listQuery.offset + items.length < total,
    filterOptions: loadIntakeFilterOptions(value, user),
    stats: {
      todayImported: metrics.todayImported,
      todayAssigned: metrics.todayAssigned,
      businessDate: metrics.businessDate,
      unassigned: counts('pending') + counts('approved'),
      pending: counts('pending'),
      approved: counts('approved'),
      assigned: metrics.assigned,
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
  const localContacts = value.prepare(`SELECT * FROM crm_account_contacts
      WHERE customer_id IN (${placeholders}) AND archived_at='' ORDER BY name`).all(...accountIds)
    .map(row => ({
      id: `local:${row.id}`, rawId: row.id, customerId: row.customer_id, name: row.name, title: row.title,
      department: row.department, phone: row.phone, email: row.email, social: row.social,
      contactLevel: '人工录入', source: 'manual', sourceLabel: '人工录入',
      createdBy: row.created_by, updatedBy: row.updated_by || row.created_by,
      createdAt: row.created_at, updatedAt: row.updated_at,
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
        phone: '', email: '', social: row.methods || '', contactLevel: row.contact_level || 'L0',
        source: 'recon', sourceLabel: '联系人研究', createdAt: row.created_at, updatedAt: row.updated_at,
      }));
  }
  const evaluations = value.prepare(`SELECT * FROM crm_manager_evaluations WHERE customer_id IN (${placeholders}) ORDER BY created_at DESC`).all(...accountIds).map(normalizeEvaluation);
  return { contacts: [...localContacts, ...externalContacts], evaluations };
}

function cleanContactFields(payload = {}) {
  return {
    name: String(payload.name || '').trim().slice(0, 160),
    title: String(payload.title || '').trim().slice(0, 160),
    department: String(payload.department || '').trim().slice(0, 160),
    phone: String(payload.phone || '').trim().slice(0, 200),
    email: String(payload.email || '').trim().slice(0, 320),
    social: String(payload.social || '').trim().slice(0, 1000),
    matchStatus: ['pending', 'match', 'mismatch'].includes(String(payload.matchStatus || ''))
      ? String(payload.matchStatus)
      : 'pending',
    procurementRole: ['pending', 'yes', 'no'].includes(String(payload.procurementRole || ''))
      ? String(payload.procurementRole)
      : 'pending',
    workContent: String(payload.workContent || '').trim().slice(0, 240),
  };
}

const CONTACT_MATCH_STATUS_LABELS = Object.freeze({
  pending: '待确认',
  match: '对口',
  mismatch: '不对口',
});
const CONTACT_PROCUREMENT_ROLE_LABELS = Object.freeze({
  pending: '待确认',
  yes: '负责采购',
  no: '不负责采购',
});

function publicAccountContact(row) {
  return {
    id: `local:${row.id}`,
    rawId: row.id,
    customerId: row.customer_id,
    externalCustomerId: row.external_customer_id || '',
    name: row.name,
    title: row.title,
    department: row.department,
    phone: row.phone,
    email: row.email,
    social: row.social,
    matchStatus: row.match_status,
    matchStatusLabel: CONTACT_MATCH_STATUS_LABELS[row.match_status] || '待确认',
    procurementRole: row.procurement_role,
    procurementRoleLabel: CONTACT_PROCUREMENT_ROLE_LABELS[row.procurement_role] || '待确认',
    workContent: row.work_content,
    source: row.source_type || 'manual',
    sourceLabel: row.source_type === 'recon' ? '联系人研究' : '人工录入',
    createdBy: row.created_by,
    updatedBy: row.updated_by || row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at || '',
  };
}

function recordContactAudit(value, user, identity, action, contact, changes = {}) {
  const realUserId = identity?.realUserId || user.id;
  const effectiveUserId = identity?.effectiveUserId || user.id;
  value.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at,
     real_user_id,effective_user_id,impersonation_context_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id('AUD'), effectiveUserId, action, 'customer_contact', contact.id,
    JSON.stringify(redactAuditPayload({
      customerId: contact.customer_id,
      externalCustomerId: contact.external_customer_id || '',
      changedFields: Object.keys(changes).sort(),
    })), nowText(), realUserId, effectiveUserId, identity?.contextId || '',
  );
}

function contactSubjectForUser(value, user, payload = {}) {
  const accountId = String(payload.customerId || '').trim();
  if (accountId) {
    const account = getAccountForUser(value, user, accountId);
    return { accountId: account.id, externalCustomerId: account.external_customer_id || '' };
  }
  const externalCustomerId = String(payload.externalCustomerId || '').trim();
  if (!externalCustomerId) throw badRequest('缺少客户编号');
  if (!canAccessCustomerMaster(value, user, externalCustomerId)) {
    throw inaccessibleOrMissing(user, '客户不存在');
  }
  return { accountId: '', externalCustomerId };
}

function assertContactMaintenance(user) {
  assertPermission(user, 'view_contacts');
  assertPermission(user, 'manage_customer_contacts');
}

function createAccountContact(user, payload, identity = {}) {
  assertContactMaintenance(user);
  const value = db();
  try {
    const subject = contactSubjectForUser(value, user, payload);
    const fields = cleanContactFields(payload);
    if (!fields.name) throw badRequest('请输入联系人姓名');
    const contactId = id('P');
    const now = nowText();
    const transaction = value.transaction(() => {
      value.prepare(`INSERT INTO crm_account_contacts
        (id,customer_id,external_customer_id,name,title,department,phone,email,social,
         match_status,procurement_role,work_content,
         source_type,source_contact_id,created_by,updated_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'manual','',?,?,?,?)`).run(
        contactId, subject.accountId, subject.externalCustomerId, fields.name, fields.title,
        fields.department, fields.phone, fields.email, fields.social,
        fields.matchStatus, fields.procurementRole, fields.workContent,
        user.id, user.id, now, now,
      );
      recordContactAudit(value, user, identity, 'customer_contact_created', {
        id: contactId, customer_id: subject.accountId,
        external_customer_id: subject.externalCustomerId,
      }, fields);
      if (subject.externalCustomerId) {
        markContactReadinessStale(value, subject.externalCustomerId, 'manual_contact_created');
      }
    });
    transaction.immediate();
    return {
      contactId: `local:${contactId}`,
      contact: publicAccountContact(value.prepare('SELECT * FROM crm_account_contacts WHERE id=?').get(contactId)),
    };
  } finally { value.close(); }
}

function editableContactForUser(value, user, contactId) {
  const rawId = String(contactId || '').replace(/^local:/, '').trim();
  const contact = value.prepare('SELECT * FROM crm_account_contacts WHERE id=?').get(rawId);
  if (!contact) throw notFound('联系人不存在');
  if (contact.customer_id) {
    getAccountForUser(value, user, contact.customer_id);
  } else if (!contact.external_customer_id
      || !canAccessCustomerMaster(value, user, contact.external_customer_id)) {
    throw inaccessibleOrMissing(user, '客户不存在');
  }
  return contact;
}

function updateAccountContact(user, contactId, payload, identity = {}) {
  assertContactMaintenance(user);
  const value = db();
  try {
    const contact = editableContactForUser(value, user, contactId);
    if (contact.archived_at) throw httpError(409, '联系人已归档', 'CONTACT_ARCHIVED');
    const fields = cleanContactFields({
      name: contact.name,
      title: contact.title,
      department: contact.department,
      phone: contact.phone,
      email: contact.email,
      social: contact.social,
      matchStatus: contact.match_status,
      procurementRole: contact.procurement_role,
      workContent: contact.work_content,
      ...payload,
    });
    if (!fields.name) throw badRequest('请输入联系人姓名');
    const changed = Object.fromEntries(Object.entries(fields).filter(([key, next]) => String(contact[key] || '') !== next));
    if (Object.keys(changed).length) {
      const updatedAt = nowText();
      value.transaction(() => {
        value.prepare(`UPDATE crm_account_contacts SET name=?,title=?,department=?,phone=?,email=?,social=?,
          match_status=?,procurement_role=?,work_content=?,
          updated_by=?,updated_at=? WHERE id=?`).run(
          fields.name, fields.title, fields.department, fields.phone, fields.email, fields.social,
          fields.matchStatus, fields.procurementRole, fields.workContent,
          user.id, updatedAt, contact.id,
        );
        recordContactAudit(value, user, identity, 'customer_contact_updated', contact, changed);
        if (contact.external_customer_id) {
          markContactReadinessStale(value, contact.external_customer_id, 'manual_contact_updated');
        }
      }).immediate();
    }
    return { contact: publicAccountContact(value.prepare('SELECT * FROM crm_account_contacts WHERE id=?').get(contact.id)) };
  } finally { value.close(); }
}

function archiveAccountContact(user, contactId, identity = {}) {
  assertContactMaintenance(user);
  const value = db();
  try {
    const contact = editableContactForUser(value, user, contactId);
    if (!contact.archived_at) {
      const archivedAt = nowText();
      value.transaction(() => {
        value.prepare(`UPDATE crm_account_contacts SET archived_by=?,archived_at=?,updated_by=?,updated_at=?
          WHERE id=?`).run(user.id, archivedAt, user.id, archivedAt, contact.id);
        recordContactAudit(value, user, identity, 'customer_contact_archived', contact, { archivedAt });
        if (contact.external_customer_id) {
          markContactReadinessStale(value, contact.external_customer_id, 'manual_contact_archived');
        }
      }).immediate();
    }
    return { contactId: `local:${contact.id}`, archived: true };
  } finally { value.close(); }
}

function profileContacts(value, user, externalCustomerId) {
  if (!hasPermission(user, 'view_contacts')) return [];
  const account = value.prepare('SELECT id FROM crm_accounts WHERE external_customer_id=? ORDER BY id LIMIT 1')
    .get(externalCustomerId);
  const accountFallback = account ? 'OR customer_id=?' : '';
  const local = value.prepare(`SELECT * FROM crm_account_contacts
      WHERE (external_customer_id=? ${accountFallback}) AND archived_at=''
      ORDER BY CASE match_status WHEN 'match' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        CASE procurement_role WHEN 'yes' THEN 0 ELSE 1 END,
        updated_at DESC,id DESC`)
    .all(externalCustomerId, ...(account ? [account.id] : []))
    .map(publicAccountContact);
  const recon = value.prepare(`SELECT p.*,
      (SELECT group_concat(cm.method_type || ':' || cm.value,' / ')
       FROM contact_methods cm WHERE cm.person_id=p.person_id) methods
    FROM person_candidates p WHERE p.customer_id=? AND TRIM(p.full_name)!=''
    ORDER BY p.sales_ready DESC,p.contact_level DESC,p.updated_at DESC`).all(externalCustomerId)
    .map(row => ({
      id: `person:${row.person_id}`, rawId: row.person_id,
      externalCustomerId, name: row.full_name_local || row.full_name,
      title: row.title || '', department: row.department || '', phone: '', email: '',
      social: row.methods || '', contactLevel: row.contact_level || 'L0',
      source: 'recon', sourceLabel: '联系人研究', createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  return [...local, ...recon];
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
    let subjectName = subjectType === 'company' ? account.company_name : '';
    let subjectTitle = '';
    let subjectId = '';
    if (subjectType === 'contact') {
      const submittedSubjectId = String(payload.subjectId || '').trim();
      if (submittedSubjectId.startsWith('local:')) {
        const rawId = submittedSubjectId.slice('local:'.length).trim();
        const contact = value.prepare(`SELECT id,name,title FROM crm_account_contacts
          WHERE id=? AND customer_id=? AND archived_at='' LIMIT 1`).get(rawId, account.id);
        if (!contact) throw badRequest('联系人不存在或不属于当前客户');
        subjectId = `local:${contact.id}`;
        subjectName = contact.name;
        subjectTitle = contact.title || '';
      } else if (submittedSubjectId.startsWith('person:')) {
        const personId = submittedSubjectId.slice('person:'.length).trim();
        const person = value.prepare(`SELECT person_id,full_name,full_name_local,title FROM person_candidates
          WHERE person_id=? AND customer_id=? LIMIT 1`).get(personId, account.external_customer_id || '');
        if (!person) throw badRequest('联系人候选不存在或不属于当前客户');
        subjectId = `person:${person.person_id}`;
        subjectName = person.full_name_local || person.full_name || '';
        subjectTitle = person.title || '';
      } else {
        throw badRequest('请选择有效的评价联系人');
      }
    }
    const now = nowText();
    aiEnabled = featureState(value, options.hardFlags || resolveAIHardFlags())
      .ai_stations.effectiveEnabled;
    value.prepare(`INSERT INTO crm_manager_evaluations
      (id,customer_id,subject_type,subject_id,subject_name,subject_title,evaluation_text,author_id,author_name,ai_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      evaluationId, account.id, subjectType, subjectId, subjectName, subjectTitle,
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
      AND NOT EXISTS (SELECT 1 FROM crm_protected_customers protected
        WHERE protected.external_customer_id=c.customer_id
          AND protected.status IN ('protected','withdrawn'))
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

function isReturnedAccountForIntake(account, item) {
  if (!account || !isCurrentIntakeAccount(account, item)) return false;
  if (String(account.lifecycle_status || 'active') === 'recycled'
      && String(account.recycle_kind || '') === 'sales_return') return true;
  return String(account.lifecycle_status || 'active') === 'active'
    && String(account.assignment_status || '') === 'returned';
}

function isCurrentIntakeAccount(account, item) {
  return (String(account?.intake_item_id || '').trim() !== ''
      && String(account.intake_item_id) === String(item.id))
    || (String(item?.crm_customer_id || '').trim() !== ''
      && String(item.crm_customer_id) === String(account?.id));
}

function intakeAccountsByExternalId(value, item) {
  return value.prepare(`SELECT id,external_customer_id,lifecycle_status,recycle_kind,intake_item_id,assignment_status
    FROM crm_accounts WHERE external_customer_id=? OR id=? OR intake_item_id=?
    ORDER BY CASE WHEN id=? THEN 0 WHEN intake_item_id=? THEN 1
      WHEN COALESCE(lifecycle_status,'active')='active' THEN 2 ELSE 3 END,
      updated_at DESC,id DESC`).all(
    item.external_customer_id,
    String(item.crm_customer_id || ''),
    String(item.id || ''),
    String(item.crm_customer_id || ''),
    String(item.id || ''),
  );
}

function reusableReturnedAccountForIntake(accounts, item) {
  const linked = accounts.find(account => isReturnedAccountForIntake(account, item));
  if (linked) return linked;
  if (String(item.crm_customer_id || '').trim() || !String(item.external_customer_id || '').trim()) {
    return null;
  }
  const externalMatches = accounts.filter(account =>
    String(account.external_customer_id || '') === String(item.external_customer_id));
  if (externalMatches.length !== 1) return null;
  const account = externalMatches[0];
  return String(account.lifecycle_status || 'active') === 'recycled'
    && String(account.recycle_kind || '') === 'sales_return'
    ? account
    : null;
}

function assignIntakeItem(value, item, ownerId, settings, reason = '') {
  const existingAccounts = intakeAccountsByExternalId(value, item);
  const reusable = reusableReturnedAccountForIntake(existingAccounts, item);
  const assignableStatus = ['pending', 'approved', 'assigned', 'returned'].includes(item.status)
    || (item.status === 'duplicate' && Boolean(reusable));
  if (!assignableStatus) return { assigned: false, reason: '状态不可分配' };
  const owner = authorizedSalesUser(value, ownerId);
  if (!owner) return { assigned: false, reason: '销售负责人无效' };
  const blocking = existingAccounts.find(account => account.id !== reusable?.id);
  if (blocking || (item.crm_customer_id && !reusable)) {
    const existing = blocking || existingAccounts.find(account => account.id === item.crm_customer_id);
    value.prepare("UPDATE crm_intake_items SET status='duplicate',crm_customer_id=?,decision_reason='客户已在CRM',updated_at=? WHERE id=?")
      .run(existing?.id || item.crm_customer_id || '', nowText(), item.id);
    return { assigned: false, reason: '客户已在CRM' };
  }
  if (!reusable && item.duplicate_state === 'review') {
    return { assigned: false, reason: IDENTITY_REVIEW_BLOCK_REASON };
  }
  if (!reusable && item.duplicate_state !== 'cleared') {
    const duplicateInput = {
      companyName: item.company_name,
      website: item.website,
      country: item.country,
      industry: item.industry,
      customerType: item.customer_type,
      productFocus: item.product_focus,
    };
    const exact = findExactDuplicate(value, duplicateInput, {
      crmOnly: true,
      includeProtected: true,
      rows: settings.duplicateRows,
      excludeCustomerId: item.external_customer_id,
    });
    if (exact) {
      const duplicateReason = exact.isProtected ? '已有跟进人' : '客户已在CRM';
      value.prepare(`UPDATE crm_intake_items SET status='duplicate',crm_customer_id=?,
        duplicate_state='exact',decision_reason=?,updated_at=? WHERE id=?`)
        .run(exact.crmAccountId || '', duplicateReason, nowText(), item.id);
      return { assigned: false, reason: duplicateReason };
    }
    const fuzzy = findFuzzyDuplicateCandidates(value, duplicateInput, {
      crmOnly: true,
      includeProtected: true,
      rows: settings.duplicateRows,
      excludeCustomerId: item.external_customer_id,
      threshold: 0.72,
    });
    if (fuzzy.length) {
      const review = createDuplicateReview(value, { id: 'system' }, duplicateInput, fuzzy, {
        type: 'intake_item', id: item.id,
      });
      value.prepare(`UPDATE crm_intake_items SET status='pending',assigned_owner_id='',
        duplicate_state='review',duplicate_review_id=?,decision_reason='资料已提交管理层核验',updated_at=?
        WHERE id=?`).run(review.id, nowText(), item.id);
      return { assigned: false, reason: IDENTITY_REVIEW_BLOCK_REASON };
    }
  }
  const assignedAt = nowText();
  const claimDue = nowText(new Date(Date.now() + Number(settings.claimSlaHours || 24) * 3600000));
  value.prepare(`UPDATE crm_intake_items SET status='assigned',crm_customer_id=?,assigned_owner_id=?,
    duplicate_state=?,duplicate_review_id=?,decision_reason=?,assigned_at=?,claim_due_at=?,updated_at=?
    WHERE id=?`).run(
    reusable?.id || '', ownerId,
    reusable ? 'cleared' : item.duplicate_state,
    reusable ? '' : item.duplicate_review_id,
    reason, assignedAt, claimDue, assignedAt, item.id,
  );
  return { assigned: true, accountId: '', ownerId };
}

function createClaimedAccount(value, item, claimedAt, contactDue, claimerId = '') {
  const existingAccounts = intakeAccountsByExternalId(value, item);
  const linked = existingAccounts.find(account => isCurrentIntakeAccount(account, item));
  const existing = linked && (
    String(linked.lifecycle_status || 'active') === 'active'
      || isReturnedAccountForIntake(linked, item)
  ) ? linked : null;
  const blocking = existingAccounts.find(account => account.id !== linked?.id)
    || (linked && !existing ? linked : null);
  if (blocking || (item.crm_customer_id && !existing)) {
    if (blocking && String(blocking.lifecycle_status || 'active') === 'recycled'
        && String(blocking.recycle_kind || '') === 'manual_delete') {
      throw conflictError(
        '该线索关联的是手工删除客户，不能通过领取自动恢复',
        'INTAKE_ACCOUNT_RESTORE_FORBIDDEN',
      );
    }
    throw conflictError('该线索已有跟进客户，无法领取', 'CUSTOMER_DUPLICATE');
  }
  if (existing) {
    // 只恢复与当前 intake 关联的销售退回账户,保留全部开发历史。
    applyAccountStatePatch(value, existing.id, {
      lifecycleStatus: 'active',
      ownerId: item.assigned_owner_id || '',
      assignmentStatus: 'claimed',
      updatedAt: claimedAt,
    });
    value.prepare(`UPDATE crm_accounts SET recycle_kind='',recycle_reason='',
      recycled_by='',recycled_at='',previous_owner_id='',intake_item_id=?,assigned_at=?,
      claim_due_at=?,claimed_at=?,return_reason='' WHERE id=?`)
      .run(item.id, item.assigned_at || claimedAt, item.claim_due_at || '', claimedAt, existing.id);
    if (claimerId) {
      value.prepare(`UPDATE crm_accounts SET
        first_claimed_by=COALESCE(NULLIF(first_claimed_by,''),?),
        first_claimed_at=COALESCE(NULLIF(first_claimed_at,''),?)
        WHERE id=?`).run(claimerId, claimedAt, existing.id);
    }
    return existing.id;
  }
  const accountId = id('CRM');
  value.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,product_focus,priority,potential_value,stage,owner_id,created_by,first_claimed_by,first_claimed_at,manager_id,manager_required,manager_status,last_activity_at,next_action,next_action_at,next_action_time_basis,loss_reason,created_at,updated_at,intake_item_id,assignment_status,assigned_at,claim_due_at,claimed_at,return_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    accountId, item.external_customer_id, item.company_name, normalizeCountry(item.country), '', item.website, item.industry,
    item.customer_type, '每日未开发线索分配', item.product_focus, Number(item.match_score || 0) >= 90 ? 'A' : 'B',
    0, 'qualified', item.assigned_owner_id, String(item.created_by || '').trim() || 'system', claimerId, claimedAt, 'USR-MGR', 0, '', '', '完成首次触达',
    contactDue, 'utc', '', claimedAt, claimedAt, item.id, 'claimed', item.assigned_at || claimedAt,
    item.claim_due_at || '', claimedAt, '',
  );
  protectOpenIntakeForAccount(value, { id: item.assigned_owner_id || 'system' }, accountId, item.external_customer_id);
  return accountId;
}

function scanDailyIntake(actor = { id: 'system', role: 'admin' }, options = {}) {
  if (actor.id !== 'system') {
    if (actor.role === 'sales') {
      throw httpError(403, '当前账号无权管理线索分配', 'INTAKE_MANAGEMENT_FORBIDDEN');
    }
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
    const duplicateRows = loadDuplicateCustomerRows(value, { crmOnly: true, includeProtected: true });
    settings.duplicateRows = duplicateRows;
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
        const exactDuplicate = findExactDuplicate(value, candidate, {
          crmOnly: true,
          includeProtected: true,
          rows: duplicateRows,
          excludeCustomerId: candidate.customer_id,
        });
        const fuzzyDuplicates = exactDuplicate ? [] : findFuzzyDuplicateCandidates(value, candidate, {
          crmOnly: true,
          includeProtected: true,
          rows: duplicateRows,
          excludeCustomerId: candidate.customer_id,
          threshold: 0.72,
        });
        const duplicateProtected = Boolean(exactDuplicate || fuzzyDuplicates.length);
        const riskBlocked = String(candidate.risk_level || '').toLowerCase().includes('blocked');
        const automatic = settings.approvalMode === 'automatic';
        const decision = automatic && !duplicateProtected
          ? arbitrateCandidate(
            value,
            candidate,
            users,
            load,
            daily,
            Number(settings.dailyPerSales || 5),
            { riskBlocked, aiEnabled },
          )
          : {
            assignable: false,
            suggestedUserId: '',
            reason: riskBlocked ? '风险或制裁信息阻断' : '等待管理者手动分配',
          };
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
            exactDuplicate ? 'duplicate' : (automatic && decision.assignable ? 'approved' : 'pending'),
            duplicateProtected ? '' : (decision.suggestedUserId || ''), '',
            exactDuplicate
              ? (exactDuplicate.isProtected ? '已有跟进人' : '客户已在CRM')
              : (fuzzyDuplicates.length ? '资料已提交管理层核验' : decision.reason),
            '', '', '', '', createdAt, createdAt,
          );
          if (exactDuplicate) {
            value.prepare(`UPDATE crm_intake_items SET crm_customer_id=?,duplicate_state='exact',updated_at=? WHERE id=?`)
              .run(exactDuplicate.crmAccountId || '', nowText(), itemId);
            recordDuplicateAudit(value, actor.id || 'system', 'duplicate_intake_blocked', itemId, {
              matchedBy: exactDuplicate.matchedBy,
              ...(exactDuplicate.isProtected ? {} : { existingCustomerId: exactDuplicate.customerId }),
            });
          } else if (fuzzyDuplicates.length) {
            const review = createDuplicateReview(
              value,
              actor,
              {
                companyName: candidate.company_name,
                website: candidate.website,
                country: candidate.country,
                industry: candidate.industry,
                customerType: candidate.customer_type,
                productFocus: candidate.products,
              },
              fuzzyDuplicates,
              { type: 'intake_item', id: itemId },
            );
            value.prepare(`UPDATE crm_intake_items
              SET duplicate_state='review',duplicate_review_id=?,updated_at=? WHERE id=?`)
              .run(review.id, nowText(), itemId);
          } else if (automatic) {
            recordIntakeDecision(value, itemId, {
              actorId: actor.id || 'system',
              aiRecommendation: decision.recommendation,
              ruleDecision: serializeArbitrationDecision(decision),
              candidateSnapshotId: decision.recommendation.snapshotId,
            });
          }
          imported += 1;
          if (automatic && match && !duplicateProtected) {
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

function manualAssignmentRequestHash(user, payload) {
  const signature = {
    actorId: user.id,
    itemIds: Array.isArray(payload.itemIds) ? payload.itemIds : [],
    filterScope: payload.filterScope || null,
    allFiltered: Boolean(payload.allFiltered),
    ownerId: String(payload.ownerId || ''),
    amount: Number(payload.amount || 0),
    previewToken: String(payload.previewToken || ''),
  };
  return crypto.createHash('sha256').update(JSON.stringify(signature)).digest('hex');
}

function reserveManualAssignment(value, user, payload) {
  const key = String(payload.idempotencyKey || '').trim().slice(0, 240);
  if (!key) throw httpError(400, '缺少分配请求标识', 'ASSIGNMENT_IDEMPOTENCY_REQUIRED');
  const requestHash = manualAssignmentRequestHash(user, payload);
  let existing = value.prepare(`SELECT * FROM crm_intake_manual_assignment_requests
    WHERE idempotency_key=?`).get(key);
  if (!existing) {
    const inserted = value.prepare(`INSERT OR IGNORE INTO crm_intake_manual_assignment_requests
      (idempotency_key,actor_id,request_hash,status,response_json,created_at,updated_at)
      VALUES (?,?,?,'started','{}',?,?)`).run(
      key,
      user.id,
      requestHash,
      nowText(),
      nowText(),
    );
    if (inserted.changes === 1) return { key, replay: null };
    existing = value.prepare(`SELECT * FROM crm_intake_manual_assignment_requests
      WHERE idempotency_key=?`).get(key);
  }
  if (existing.actor_id !== user.id || existing.request_hash !== requestHash) {
    throw httpError(409, '幂等键已绑定其他分配操作', 'INTAKE_IDEMPOTENCY_CONFLICT');
  }
  if (existing.status === 'completed') {
    return { key, replay: { ...json(existing.response_json, {}), deduplicated: true } };
  }
  throw httpError(409, '相同分配操作正在处理中', 'INTAKE_ACTION_IN_PROGRESS');
}

function completeManualAssignment(value, key, response) {
  value.prepare(`UPDATE crm_intake_manual_assignment_requests
    SET status='completed',response_json=?,updated_at=?
    WHERE idempotency_key=? AND status='started'`).run(
    JSON.stringify(response),
    nowText(),
    key,
  );
  return response;
}

function clearManualAssignmentReservation(value, key) {
  value.prepare(`DELETE FROM crm_intake_manual_assignment_requests
    WHERE idempotency_key=? AND status='started'`).run(key);
}

const MANUAL_ASSIGNABLE_STATUSES = Object.freeze(['pending', 'approved', 'returned']);

// Single business-copy source for "suspected duplicate name, awaiting admin confirmation".
const IDENTITY_REVIEW_BLOCK_REASON = '疑似重名，等待管理员确认';

function manualAssignmentBlockReason(value, item, identityWarnings) {
  const existingAccounts = intakeAccountsByExternalId(value, item);
  const reusable = reusableReturnedAccountForIntake(existingAccounts, item);
  if (existingAccounts.some(account => account.id !== reusable?.id)) return '客户已在 CRM';
  if (reusable) return '';
  if (item.duplicate_state === 'review') return IDENTITY_REVIEW_BLOCK_REASON;
  if (item.duplicate_state === 'exact') return '客户已在 CRM';
  const assignableStatus = MANUAL_ASSIGNABLE_STATUSES.includes(String(item.status || ''))
    || (item.status === 'duplicate' && Boolean(reusable));
  if (!assignableStatus) return '状态不可分配';
  if (item.crm_customer_id) return '客户已在 CRM';
  if (identityWarnings && identityWarnings.has(String(item.external_customer_id || ''))) {
    return IDENTITY_REVIEW_BLOCK_REASON;
  }
  return '';
}

function applyManualAssignmentEligibility(value, item) {
  const assignmentBlockReason = manualAssignmentBlockReason(value, item);
  item.assignable = !assignmentBlockReason;
  item.assignmentBlockReason = item.assignable ? '' : assignmentBlockReason;
  return item;
}

function createManualAssignmentPreview(value, user, itemIds) {
  const token = crypto.randomBytes(24).toString('hex');
  const createdAt = nowText();
  const expiresAt = nowText(new Date(Date.now() + 15 * 60 * 1000));
  value.prepare('DELETE FROM crm_intake_assignment_previews WHERE expires_at<?').run(createdAt);
  value.prepare(`INSERT INTO crm_intake_assignment_previews
    (token,actor_id,item_ids_json,created_at,expires_at) VALUES (?,?,?,?,?)`)
    .run(token, user.id, JSON.stringify(itemIds), createdAt, expiresAt);
  return token;
}

function manualAssignmentPreviewSnapshot(value, user, payload) {
  const token = String(payload.previewToken || '').trim();
  if (!token) return null;
  const row = value.prepare(`SELECT * FROM crm_intake_assignment_previews
    WHERE token=? AND actor_id=?`).get(token, user.id);
  if (!row || row.expires_at < nowText()) {
    throw httpError(409, '分配预览已过期，请重新预览', 'ASSIGNMENT_PREVIEW_EXPIRED');
  }
  return {
    token,
    itemIds: [...new Set(json(row.item_ids_json, []).map(itemId => String(itemId || '')).filter(Boolean))],
  };
}

function manualAssignmentRequiresPreview(payload = {}) {
  const itemIds = Array.isArray(payload.itemIds)
    ? payload.itemIds.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  if (itemIds.length) return false;
  const filterScope = payload.filterScope && typeof payload.filterScope === 'object'
    ? payload.filterScope
    : {};
  const rawFilters = filterScope.filters && typeof filterScope.filters === 'object'
    && !Array.isArray(filterScope.filters)
    ? filterScope.filters
    : {};
  return Boolean(payload.allFiltered || Object.keys(rawFilters).length);
}

function manualAssignmentScope(value, user, payload = {}) {
  const previewSnapshot = manualAssignmentPreviewSnapshot(value, user, payload);
  const requestedIds = previewSnapshot?.itemIds || (Array.isArray(payload.itemIds)
    ? [...new Set(payload.itemIds.map(item => String(item || '').trim()).filter(Boolean))]
    : []);

  let rows;
  let missingIds = [];
  let scopeType;
  let scopeTotal;
  if (previewSnapshot || requestedIds.length) {
    scopeType = previewSnapshot ? 'filter' : 'selection';
    scopeTotal = requestedIds.length;
    if (requestedIds.length) {
      const placeholders = requestedIds.map(() => '?').join(',');
      const accessScope = previewSnapshot
        ? buildIntakeQueryScope(user, {}, { includeStatus: false })
        : { filters: [], params: [] };
      const accessWhere = accessScope.filters.length
        ? ` AND ${accessScope.filters.join(' AND ')}`
        : '';
      const byId = new Map(value.prepare(`SELECT i.* FROM crm_intake_items i
        WHERE i.id IN (${placeholders})${accessWhere}`)
        .all(...requestedIds, ...accessScope.params).map(item => [item.id, item]));
      rows = requestedIds.map(itemId => byId.get(itemId)).filter(Boolean);
      missingIds = requestedIds.filter(itemId => !byId.has(itemId));
    } else {
      rows = [];
    }
  } else {
    const filterScope = payload.filterScope && typeof payload.filterScope === 'object'
      ? payload.filterScope
      : {};
    const rawFilters = filterScope.filters && typeof filterScope.filters === 'object'
      && !Array.isArray(filterScope.filters)
      ? filterScope.filters
      : {};
    if (!payload.allFiltered && !Object.keys(rawFilters).length) {
      throw httpError(400, '请先勾选线索或设置至少一个筛选条件', 'ASSIGNMENT_SCOPE_REQUIRED');
    }
    const ast = authorizedFilterAst(value, user, 'intake', {
      permissionVersion: String(filterScope.permissionVersion || ''),
      filters: JSON.stringify(rawFilters),
    });
    if (!payload.allFiltered && !ast.filters.length) {
      throw httpError(400, '请先设置至少一个筛选条件', 'ASSIGNMENT_SCOPE_REQUIRED');
    }
    const scope = buildIntakeFlowFilterScope(user, 'intake', ast);
    const where = scope.where;
    const params = scope.params;
    scopeType = 'filter';
    scopeTotal = Number(value.prepare(`SELECT COUNT(*) total FROM ${scope.from}${where}`)
      .get(...params).total || 0);
    rows = value.prepare(`SELECT i.* FROM ${scope.from}${where}
      ORDER BY CASE i.status WHEN 'returned' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        i.created_at DESC,i.id ASC`)
      .all(...params);
  }

  const eligible = [];
  const missingCount = Math.max(0, scopeTotal - rows.length);
  const blockedReasons = missingCount ? { '线索不存在或不在当前权限范围': missingCount } : {};
  const blockedItems = missingIds.map(itemId => ({
    itemId,
    reason: '线索不存在或不在当前权限范围',
  }));
  let ineligible = missingCount;
  const identityWarnings = leadIdentityWarningsForExternalIds(
    value, rows.map(item => item.external_customer_id),
  );
  for (const item of rows) {
    const reason = manualAssignmentBlockReason(value, item, identityWarnings);
    if (reason) {
      ineligible += 1;
      blockedReasons[reason] = Number(blockedReasons[reason] || 0) + 1;
      blockedItems.push({ itemId: item.id, reason });
    } else {
      eligible.push(item);
    }
  }
  return {
    scopeType,
    scopeTotal,
    eligible,
    eligibleCount: eligible.length,
    blockedCount: ineligible,
    blockedReasons,
    blockedItems,
    itemIds: rows.map(item => item.id),
    previewToken: previewSnapshot?.token || '',
  };
}

function previewManualAssignment(value, user, payload = {}) {
  const scope = manualAssignmentScope(value, user, payload);
  const previewToken = scope.scopeType === 'filter'
    ? createManualAssignmentPreview(value, user, scope.itemIds)
    : '';
  return {
    action: 'manual_assign_preview',
    scopeType: scope.scopeType,
    scopeTotal: scope.scopeTotal,
    eligibleCount: scope.eligibleCount,
    blockedCount: scope.blockedCount,
    blockedReasons: scope.blockedReasons,
    sales: authorizedSalesUsers(value).map(owner => ({ id: owner.id, name: owner.name })),
    previewToken,
  };
}

function recordIntakeMismatchAudit(value, user, identity, action, itemId, detail) {
  const realUserId = identity?.realUserId || user.id;
  const effectiveUserId = identity?.effectiveUserId || user.id;
  value.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at,
     real_user_id,effective_user_id,impersonation_context_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id('AUD'), effectiveUserId, action, 'crm_intake_item', itemId,
    JSON.stringify(redactAuditPayload(detail)), nowText(), realUserId, effectiveUserId,
    identity?.contextId || '',
  );
}

function manageIntake(user, payload, options = {}) {
  assertPermission(user, 'view_intake');
  const action = String(payload.action || '');
  const selfActions = new Set(['claim', 'return']);
  if (selfActions.has(action)) {
    if (user.role !== 'sales') {
      const error = new Error('仅销售可执行领取或退回操作');
      error.statusCode = 403;
      throw error;
    }
  } else if (action === 'reject') {
    if (user.role === 'sales') assertPermission(user, 'reject_own_customer_mismatch');
    else assertPermission(user, 'manage_intake');
  } else {
    if (user.role === 'sales') {
      throw httpError(403, '当前账号无权管理线索分配', 'INTAKE_MANAGEMENT_FORBIDDEN');
    }
    assertPermission(user, 'manage_intake');
  }
  const value = db();
  let reservation;
  try {
    if (action === 'manual_assign_preview') {
      return previewManualAssignment(value, user, payload);
    }
    if (action === 'manual_assign') {
      if (manualAssignmentRequiresPreview(payload) && !String(payload.previewToken || '').trim()) {
        throw conflictError(
          '筛选范围已变化或未预览，请重新预览后分配',
          'ASSIGNMENT_PREVIEW_REQUIRED',
        );
      }
      reservation = reserveManualAssignment(value, user, payload);
      if (reservation.replay) return reservation.replay;
      const ownerId = String(payload.ownerId || '').trim();
      const amount = Number(payload.amount);
      if (!Number.isSafeInteger(amount) || amount < 1) {
        throw httpError(400, '分配数量必须是正整数', 'INVALID_ASSIGNMENT_AMOUNT');
      }
      let response;
      const transaction = value.transaction(() => {
        const owner = authorizedSalesUser(value, ownerId);
        if (!owner) throw httpError(400, '请选择有效的销售负责人', 'INVALID_ASSIGNMENT_OWNER');
        const scope = manualAssignmentScope(value, user, payload);
        const maximumAmount = scope.scopeTotal;
        if (amount > maximumAmount) {
          throw httpError(
            400,
            `当前范围最多可处理 ${maximumAmount} 条线索`,
            'ASSIGNMENT_AMOUNT_EXCEEDS_SCOPE',
          );
        }
        const settingsRow = value.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
        const settings = {
          claimSlaHours: settingsRow.claim_sla_hours,
          contactSlaHours: settingsRow.contact_sla_hours,
          duplicateRows: loadDuplicateCustomerRows(value, { crmOnly: true, includeProtected: true }),
        };
        const assignedIds = [];
        const runtimeBlockedReasons = { ...scope.blockedReasons };
        let runtimeBlocked = scope.blockedCount;
        const results = scope.blockedItems.map(item => ({ ...item, ok: false }));
        for (const item of scope.eligible.slice(0, amount)) {
          const auditReason = item.assigned_owner_id ? '管理员重新分配' : '管理员指定分配';
          const result = assignIntakeItem(value, item, ownerId, settings, auditReason);
          if (!result.assigned) {
            const reason = String(result.reason || '状态已变化，无法分配');
            runtimeBlocked += 1;
            runtimeBlockedReasons[reason] = Number(runtimeBlockedReasons[reason] || 0) + 1;
            results.push({ itemId: item.id, ok: false, reason });
            continue;
          }
          assignedIds.push(item.id);
          results.push({ itemId: item.id, ok: true, reason: '' });
          recordIntakeDecision(value, item.id, {
            decisionType: 'manual',
            actorId: user.id,
            manualDecision: {
              action: 'manual_assign',
              status: 'assigned',
              ownerId,
              previousOwnerId: item.assigned_owner_id || '',
              reason: auditReason,
            },
          });
        }
        response = {
          action,
          scopeType: scope.scopeType,
          ownerId,
          requested: amount,
          assigned: assignedIds.length,
          assignedIds,
          failed: runtimeBlocked,
          results,
          considered: scope.scopeTotal,
          blocked: runtimeBlocked,
          blockedReasons: runtimeBlockedReasons,
          unprocessed: Math.max(0, scope.eligibleCount - Math.min(amount, scope.eligibleCount)),
        };
        if (scope.previewToken) {
          value.prepare('DELETE FROM crm_intake_assignment_previews WHERE token=? AND actor_id=?')
            .run(scope.previewToken, user.id);
        }
      });
      transaction.immediate();
      return completeManualAssignment(value, reservation.key, response);
    }
    if (selfActions.has(action) || action === 'reject') {
      reservation = reserveIntakeAction(value, user, payload);
      if (reservation.replay) return reservation.replay;
    }
    const item = value.prepare('SELECT * FROM crm_intake_items WHERE id=?').get(String(payload.itemId || ''));
    if (!item) throw new Error('入库任务不存在');
    const rejectedByCurrentSales = action === 'reject' && user.role === 'sales'
      && item.status === 'rejected' && item.previous_owner_id === user.id;
    if ((selfActions.has(action) || (action === 'reject' && user.role === 'sales'))
        && item.assigned_owner_id !== user.id && !rejectedByCurrentSales) {
      const error = new Error('无权处理该入库任务'); error.statusCode = 403; throw error;
    }
    if (action === 'claim') {
      if (item.status !== 'assigned') throw new Error('该客户当前不可领取');
      if (leadIdentityWarningsForExternalCustomerIds(value, [item.external_customer_id])
        .has(item.external_customer_id)) {
        throw conflictError(
          '该线索名称待管理员核验，确认后才能领取。',
          'LEAD_IDENTITY_REVIEW_REQUIRED',
        );
      }
      if (item.duplicate_state === 'review') {
        throw conflictError('资料已提交管理层核验。', 'DUPLICATE_REVIEW_REQUIRED');
      }
      if (item.duplicate_state !== 'cleared') {
        const poolIdentity = value.prepare(`SELECT city,nickname,russian_name,english_name
          FROM customer_pool WHERE customer_id=?`).get(item.external_customer_id) || {};
        const duplicateInput = {
          companyName: item.company_name,
          website: item.website,
          country: item.country,
          city: poolIdentity.city || '',
          industry: item.industry,
          customerType: item.customer_type,
          nickname: poolIdentity.nickname || '',
          russianName: poolIdentity.russian_name || '',
          englishName: poolIdentity.english_name || '',
          aliases: [poolIdentity.nickname, poolIdentity.russian_name, poolIdentity.english_name]
            .filter(Boolean),
        };
        const exact = findExactDuplicate(value, duplicateInput, {
          crmOnly: true,
          includeProtected: true,
          excludeCustomerId: item.external_customer_id,
        });
        const fuzzy = exact ? [] : findFuzzyDuplicateCandidates(value, duplicateInput, {
          crmOnly: true,
          includeProtected: true,
          excludeCustomerId: item.external_customer_id,
          threshold: 0.72,
        });
        if (exact) {
          const duplicateReason = exact.isProtected ? '已有跟进人' : '客户已在CRM';
          value.prepare(`UPDATE crm_intake_items SET status='duplicate',crm_customer_id=?,
            duplicate_state='exact',assigned_owner_id='',decision_reason=?,updated_at=? WHERE id=?`)
            .run(exact.crmAccountId || '', duplicateReason, nowText(), item.id);
          throw conflictError('该线索已有跟进人，无法领取。', 'CUSTOMER_DUPLICATE');
        }
        if (fuzzy.length) {
          const review = createDuplicateReview(value, user, duplicateInput, fuzzy, {
            type: 'intake_item', id: item.id,
          });
          value.prepare(`UPDATE crm_intake_items SET status='pending',assigned_owner_id='',
            duplicate_state='review',duplicate_review_id=?,decision_reason='资料已提交管理层核验',updated_at=?
            WHERE id=?`).run(review.id, nowText(), item.id);
          throw conflictError('资料已提交管理层核验。', 'DUPLICATE_REVIEW_REQUIRED');
        }
      }
      const claimedAt = nowText();
      const settings = value.prepare("SELECT contact_sla_hours FROM crm_intake_settings WHERE id='default'").get();
      const contactDue = nowText(new Date(Date.now() + Number(settings.contact_sla_hours || 48) * 3600000));
      let accountId = '';
      value.transaction(() => {
        accountId = createClaimedAccount(value, item, claimedAt, contactDue, user.id);
        value.prepare("UPDATE crm_intake_items SET status='claimed',crm_customer_id=?,claimed_at=?,updated_at=? WHERE id=?")
          .run(accountId, claimedAt, claimedAt, item.id);
        applyAccountStatePatch(value, accountId, {
          assignmentStatus: 'claimed',
          updatedAt: claimedAt,
        });
        applyAccountPlanPatch(value, accountId, {
          nextAction: '完成首次触达',
          nextActionAt: contactDue,
          timeBasis: PLAN_TIME_BASIS,
          updatedAt: claimedAt,
        });
        value.prepare(`UPDATE crm_accounts SET claimed_at=? WHERE id=?`)
          .run(claimedAt, accountId);
      }).immediate();
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
      if (item.crm_customer_id) {
        throw conflictError(
          '客户已进入 CRM，请在客户资料使用“标记不对口”',
          'INTAKE_CLAIMED_REQUIRES_CRM_RETURN',
        );
      }
      const reason = String(payload.reason || '').trim();
      if (!reason) throw new Error('退回客户必须填写原因');
      value.prepare(`UPDATE crm_intake_items SET status='returned',assigned_owner_id='',
        suggested_owner_id='',assigned_at='',claim_due_at='',claimed_at='',
        return_reason=?,updated_at=? WHERE id=?`).run(reason, nowText(), item.id);
      // 该分支的守卫保证 item.crm_customer_id 为空：原直写 UPDATE 恒匹配 0 行，
      // 现以相同条件守卫网关调用，保持"静默空操作"语义不变。
      if (item.crm_customer_id) {
        applyAccountStatePatch(value, item.crm_customer_id, {
          assignmentStatus: 'returned',
          updatedAt: nowText(),
        });
        value.prepare("UPDATE crm_accounts SET return_reason=? WHERE id=?").run(reason, item.crm_customer_id);
      }
      recordIntakeDecision(value, item.id, {
        decisionType: 'manual',
        actorId: user.id,
        manualDecision: { action, status: 'returned', reason },
      });
      return completeIntakeAction(value, reservation.key, { action, itemId: item.id });
    }
    if (action === 'reject') {
      if (item.crm_customer_id) {
        throw conflictError(
          '客户已进入 CRM，请使用 CRM 正式退回流程',
          'INTAKE_CLAIMED_REQUIRES_CRM_RETURN',
        );
      }
      const reason = String(payload.reason || '').trim();
      if (!reason) throw new Error('标记不对口必须填写原因');
      const rejectedAt = nowText();
      value.transaction(() => {
        const changed = value.prepare(`UPDATE crm_intake_items
          SET status='rejected',previous_owner_id=assigned_owner_id,assigned_owner_id='',
            rejected_by=?,rejected_at=?,return_reason=?,updated_at=?
          WHERE id=? AND status='assigned' AND COALESCE(crm_customer_id,'')=''`).run(
          user.id, rejectedAt, reason, rejectedAt, item.id,
        );
        if (changed.changes !== 1) {
          throw httpError(409, '线索状态已变化', 'INTAKE_REJECT_STATE_INVALID');
        }
        recordIntakeDecision(value, item.id, {
          decisionType: 'manual',
          actorId: user.id,
          manualDecision: {
            action, status: 'rejected', reason, previousOwnerId: item.assigned_owner_id || '',
          },
        });
        recordIntakeMismatchAudit(value, user, options.identity, 'intake_mismatch_rejected', item.id, {
          reason, previousOwnerId: item.assigned_owner_id || '',
        });
      }).immediate();
      return completeIntakeAction(value, reservation.key, { action, itemId: item.id });
    }
    if (action === 'unassign') {
      let response;
      value.transaction(() => {
        const current = value.prepare('SELECT * FROM crm_intake_items WHERE id=?').get(item.id);
        if (current.status === 'claimed' || current.crm_customer_id) {
          throw conflictError(
            '客户已领取并进入 CRM，请使用 CRM 正式退回流程',
            'INTAKE_CLAIMED_REQUIRES_CRM_RETURN',
          );
        }
        if (current.status !== 'assigned') {
          throw conflictError('仅待领取线索可以取消分配', 'INTAKE_UNASSIGN_INVALID_STATE');
        }
        const previousOwnerId = current.assigned_owner_id || '';
        const updatedAt = nowText();
        const updated = value.prepare(`UPDATE crm_intake_items SET status='pending',assigned_owner_id='',
          assigned_at='',claim_due_at='',claimed_at='',return_reason='',
          decision_reason='管理员取消分配',updated_at=?
          WHERE id=? AND status='assigned' AND COALESCE(crm_customer_id,'')=''`)
          .run(updatedAt, current.id);
        if (updated.changes !== 1) {
          throw conflictError('线索状态已变化，请刷新后重试', 'INTAKE_UNASSIGN_STATE_CHANGED');
        }
        recordIntakeDecision(value, current.id, {
          decisionType: 'manual',
          actorId: user.id,
          manualDecision: {
            action: 'unassign',
            status: 'pending',
            ownerId: '',
            previousOwnerId,
            reason: '管理员取消分配',
          },
        });
        response = { action, itemId: current.id, previousOwnerId };
      }).immediate();
      return response;
    }
    if (['assign', 'reassign'].includes(action)) {
      let response;
      value.transaction(() => {
        const current = value.prepare('SELECT * FROM crm_intake_items WHERE id=?').get(item.id);
        const ownerId = String(payload.ownerId || current.suggested_owner_id || '');
        const owner = authorizedSalesUser(value, ownerId);
        if (!owner) throw new Error('请选择有效的销售负责人');
        const linkedReturnedAccount = current.crm_customer_id
          && intakeAccountsByExternalId(value, current)
            .some(account => isReturnedAccountForIntake(account, current));
        if (current.status === 'claimed'
            || (current.crm_customer_id && !linkedReturnedAccount)) {
          throw conflictError(
            '客户已领取并进入 CRM，请在 CRM 客户全景中处理负责人变更',
            'INTAKE_CLAIMED_REQUIRES_CRM_WORKFLOW',
          );
        }
        if (current.status === 'assigned' && ownerId === String(current.assigned_owner_id || '')) {
          throw conflictError('目标销售已是当前负责人，无需重新分配', 'INTAKE_ASSIGNMENT_UNCHANGED');
        }
        const settingsRow = value.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
        const settings = {
          claimSlaHours: settingsRow.claim_sla_hours,
          contactSlaHours: settingsRow.contact_sla_hours,
        };
        const isReassign = ['assigned', 'returned'].includes(current.status)
          || Boolean(current.assigned_owner_id);
        const auditReason = isReassign ? '管理员重新分配' : '管理员指定分配';
        const result = assignIntakeItem(value, current, ownerId, settings, auditReason);
        if (!result.assigned) throw new Error(result.reason);
        recordIntakeDecision(value, current.id, {
          decisionType: 'manual',
          actorId: user.id,
          manualDecision: {
            action: isReassign ? 'reassign' : action, status: 'assigned', ownerId,
            previousOwnerId: current.assigned_owner_id || '',
            reason: auditReason,
          },
        });
        response = { action, itemId: current.id, ownerId, reason: auditReason };
      }).immediate();
      return response;
    }
    throw new Error('未知入库操作');
  } catch (error) {
    if (reservation?.key) {
      if (action === 'manual_assign') clearManualAssignmentReservation(value, reservation.key);
      else clearIntakeActionReservation(value, reservation.key);
    }
    throw error;
  } finally { value.close(); }
}

const TODAY_TASK_ACTION_TYPES = new Set([
  'resolve_overdue_lead',
  'add_next_plan',
  'complete_manager_assistance',
  'confirm_manager_assistance',
]);

function todayTaskError(statusCode, message, code = 'TODAY_TASK_INVALID') {
  return httpError(statusCode, message, code);
}

function assertTodayTaskManager(user, permissions) {
  if (!['admin', 'manager'].includes(String(user?.role || ''))) {
    throw todayTaskError(403, '只有管理员或经理可以执行此操作', 'TODAY_TASK_FORBIDDEN');
  }
  for (const permission of permissions) {
    if (!hasPermission(user, permission)) {
      throw todayTaskError(403, `没有权限：${PERMISSION_DEFINITIONS[permission] || permission}`, 'TODAY_TASK_FORBIDDEN');
    }
  }
}

function normalizeTodayTaskDate(input) {
  return parseBusinessDateTime(input);
}

function recordExplicitPlanIfEnabled(
  value,
  account,
  actorId,
  nextAction,
  nextActionAt,
  source,
  sourceEventId = '',
) {
  if (!deferredPlanWritesEnabled()) return null;
  return recordExplicitPlan(value, {
    customerId: account.external_customer_id || account.id,
    actorId,
    ownerIdSnapshot: account.owner_id || '',
    nextAction,
    nextAt: `${String(nextActionAt).replace(' ', 'T')}Z`,
    source,
    sourceEventId,
  });
}

function deferAccountPlan(user, customerId, payload = {}, identity = {}) {
  assertPermission(user, 'record_activity');
  const sourceEventId = String(payload.idempotencyKey || '').trim();
  if (!sourceEventId || sourceEventId.length > 240) {
    throw badRequest('必须提供有效的幂等键');
  }
  const value = db();
  try {
    const account = getAccountForUser(value, user, String(customerId || '').trim());
    if (isFollowUpTerminalStage(account.stage)) {
      throw conflictError('该客户已处于无需跟进的终止阶段', 'DEFERRED_PLAN_TERMINAL_STAGE');
    }
    const transaction = value.transaction(() => {
      const existing = value.prepare(`SELECT id FROM crm_deferred_plan_events
        WHERE source='manual_deferred' AND source_event_id=?`).get(sourceEventId);
      const event = recordDeferredPlan(value, {
        customerId: account.external_customer_id || account.id,
        actorId: user.id,
        ownerIdSnapshot: account.owner_id || '',
        reviewAt: payload.reviewAt,
        reason: payload.reason,
        source: 'manual_deferred',
        sourceEventId,
      });
      if (existing) {
        return {
          customerId: account.id,
          eventId: event.id,
          reviewAt: event.reviewAt,
          deduplicated: true,
        };
      }
      const changedAt = nowText();
      applyAccountPlanPatch(value, account.id, {
        nextAction: '',
        nextActionAt: '',
        timeBasis: '',
        updatedAt: changedAt,
      });
      value.prepare(`INSERT INTO crm_audit_log
        (id,user_id,action,entity_type,entity_id,detail_json,created_at,
         real_user_id,effective_user_id,impersonation_context_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        id('AUD'), identity.effectiveUserId || user.id, 'customer_plan_deferred',
        'crm_account', account.id, JSON.stringify({
          eventId: event.id,
          reviewAt: event.reviewAt,
          source: event.source,
        }), changedAt,
        identity.realUserId || user.id,
        identity.effectiveUserId || user.id,
        identity.contextId || '',
      );
      return {
        customerId: account.id,
        eventId: event.id,
        reviewAt: event.reviewAt,
        deduplicated: false,
      };
    });
    return transaction.immediate();
  } finally { value.close(); }
}

function scopedManagerAccount(value, user, customerId) {
  const selected = String(customerId || '').trim();
  const scope = accountScope(user);
  const account = value.prepare(`SELECT a.* FROM crm_accounts a
    WHERE (a.id=? OR a.external_customer_id=?)
      AND ${scope.sql.replace(/^WHERE\s+/i, '')}
    ORDER BY CASE WHEN a.id=? THEN 0 ELSE 1 END LIMIT 1`)
    .get(selected, selected, ...scope.params, selected);
  if (!account) throw inaccessibleOrMissing(user, '客户不存在');
  return account;
}

function assertManagerTaskRole(user) {
  if (!['admin', 'manager'].includes(String(user?.role || ''))) {
    throw forbidden('只有管理员或主管可以访问主管任务');
  }
}

function assertManagerSettingsAdmin(user) {
  if (String(user?.role || '') !== 'admin') {
    throw forbidden('只有管理员可以配置主管提醒规则');
  }
}

function managerTaskAccount(value, user, taskId, options = {}) {
  assertManagerTaskRole(user);
  const task = getManagerTask(value, taskId);
  if (!task) throw httpError(404, '主管任务不存在', 'MANAGER_TASK_NOT_FOUND');
  let account = null;
  let riskAvailable = false;
  try {
    account = scopedManagerAccount(value, user, task.customerId);
    riskAvailable = true;
  } catch (error) {
    if (!options.allowReadOnlyFallback) throw error;
    const isRecipient = (task.recipientIds || []).includes(String(user.id || ''));
    if (user.role !== 'admin' && !isRecipient) throw error;
    const selected = String(task.customerId || '').trim();
    account = value.prepare(`SELECT a.* FROM crm_accounts a
      WHERE (a.id=? OR a.external_customer_id=?) AND COALESCE(a.is_test_data,0)=0
      ORDER BY CASE WHEN a.id=? THEN 0 ELSE 1 END LIMIT 1`)
      .get(selected, selected, selected);
    if (account) account.source_type = 'account';
    if (!account) {
      const intake = value.prepare(`SELECT i.*,
        COALESCE(NULLIF(p.company_name,''),i.company_name) resolved_company_name
        FROM crm_intake_items i
        LEFT JOIN customer_pool p ON p.customer_id=i.external_customer_id
        WHERE i.id=? OR i.external_customer_id=?
        ORDER BY CASE WHEN i.id=? THEN 0 ELSE 1 END LIMIT 1`)
        .get(selected, selected, selected);
      if (intake) {
        account = {
          id: '',
          external_customer_id: intake.external_customer_id || selected,
          company_name: intake.resolved_company_name || intake.company_name || selected,
          owner_id: intake.assigned_owner_id || intake.previous_owner_id || '',
          stage: 'intake',
          source_type: 'intake',
          intake_item_id: intake.id,
        };
      }
    }
    if (!account) throw inaccessibleOrMissing(user, '客户不存在');
  }
  return { task, account, riskAvailable };
}

function emptyCustomerPlanRisk(task, account) {
  return {
    customerId: String(account.external_customer_id || task.customerId || ''),
    accountId: String(account.id || ''),
    currentOwnerId: String(account.owner_id || ''),
    state: 'none',
    currentConsecutiveDeferredCount: 0,
    cumulativeDeferredCount: 0,
    unplannedDurationDays: 0,
    thresholdAt: '',
    history: [],
  };
}

function scopedManagerTasks(value, user, options = {}) {
  assertManagerTaskRole(user);
  markManagerTasksOverdue(value);
  const scope = accountScope(user);
  const visibleCustomerIds = new Set(value.prepare(`SELECT a.id,a.external_customer_id
    FROM crm_accounts a ${scope.sql}`).all(...scope.params)
    .flatMap(row => [String(row.id || ''), String(row.external_customer_id || '')]).filter(Boolean));
  return listManagerTasks(value, options).filter(task => visibleCustomerIds.has(task.customerId));
}

function scopedManagerTasksForTodayAlerts(value, user) {
  if (!['admin', 'manager'].includes(String(user?.role || ''))) return [];
  return scopedManagerTasks(value, user, { limit: 100 });
}

function eligibleManagerRecipient(value, recipientId) {
  const recipient = hydrateUserPermissions(
    value,
    value.prepare("SELECT * FROM sales_users WHERE id=? AND active=1 AND COALESCE(archived_at,'')='' ")
      .get(String(recipientId || '').trim()),
  );
  if (!recipient || !['admin', 'manager'].includes(recipient.role)
      || !hasPermission(recipient, 'resolve_manager_tasks')) {
    return null;
  }
  return recipient;
}

function managerRecipient(value, recipientId) {
  const recipient = eligibleManagerRecipient(value, recipientId);
  if (!recipient) {
    throw badRequest('提醒接收人必须是在职且有主管任务权限的管理员或主管');
  }
  return recipient;
}

function validateManagerRecipients(value, recipientIds = []) {
  return [...new Set(recipientIds.map(item => String(item || '').trim()).filter(Boolean))]
    .map(recipientId => managerRecipient(value, recipientId));
}

function canRecipientAccessAccount(value, recipient, account) {
  try {
    scopedManagerAccount(value, recipient, account.id);
    return true;
  } catch (_error) {
    return false;
  }
}

function notifyManagerTaskRecipients(value, task, account) {
  const recipients = task.recipientIds.map(recipientId =>
    eligibleManagerRecipient(value, recipientId)).filter(Boolean)
    .filter(recipient => canRecipientAccessAccount(value, recipient, account));
  for (const recipient of recipients) {
    createNotification(value, {
      userId: recipient.id,
      customerId: task.customerId,
      code: 'MANAGER_TASK_CREATED',
      severity: task.status === 'overdue' ? 'critical' : 'warning',
      title: '有新的主管任务待处理',
      detail: account.company_name || task.customerId,
      dedupeKey: `manager-task:${task.id}:${recipient.id}`,
    }, { wecomEnabled: false });
  }
  return recipients.map(recipient => recipient.id);
}

function managerAssistanceRecipientIds(value, account) {
  return hydrateUsersPermissions(value, value.prepare(
    "SELECT * FROM sales_users WHERE role IN ('admin','manager') AND active=1 "
    + "AND COALESCE(archived_at,'')='' ORDER BY id",
  ).all()).filter(recipient =>
    hasPermission(recipient, 'resolve_manager_tasks')
    && hasPermission(recipient, 'view_team')
    && hasPermission(recipient, 'view_alerts')
    && canRecipientAccessAccount(value, recipient, account))
    .map(recipient => recipient.id);
}

function notifyManagerTaskEscalation(value, task, account) {
  const admins = hydrateUsersPermissions(value, value.prepare(
    "SELECT * FROM sales_users WHERE role='admin' AND active=1 AND COALESCE(archived_at,'')='' ORDER BY id",
  ).all()).filter(admin => hasPermission(admin, 'resolve_manager_tasks')
    && canRecipientAccessAccount(value, admin, account));
  for (const admin of admins) {
    createNotification(value, {
      userId: admin.id,
      customerId: task.customerId,
      code: 'MANAGER_TASK_ESCALATED',
      severity: 'critical',
      title: '主管协助事项已升级为经营决策事项',
      detail: account.company_name || task.customerId,
      dedupeKey: `manager-task-escalated:${task.id}:${admin.id}`,
    }, { wecomEnabled: false });
  }
}

function notifyNoPlanStreak(value, account) {
  if (!account?.id) return;
  const streak = noPlanStreakForActivities(value.prepare(
    `SELECT id,occurred_at,created_at,no_plan,superseded_at,is_test_data
     FROM crm_activities WHERE customer_id=? ORDER BY occurred_at DESC,id DESC`,
  ).all(account.id));
  if (Number(streak.count) < 3 || !streak.streakStartId) return;
  const customerLabel = account.nickname || account.company_name || '客户';
  const ownerName = value.prepare('SELECT name FROM sales_users WHERE id=?')
    .get(String(account.owner_id || ''))?.name || '';
  const recipients = hydrateUsersPermissions(value, value.prepare(
    "SELECT * FROM sales_users WHERE role IN ('admin','manager') AND active=1 "
    + "AND COALESCE(archived_at,'')='' ORDER BY id",
  ).all()).filter(user =>
    hasPermission(user, 'view_alerts')
    && hasPermission(user, 'resolve_manager_tasks')
    && canRecipientAccessAccount(value, user, account));
  const detail = `${customerLabel} · 当前负责人 ${ownerName || '未分配'}`
    + ` · 已连续 ${streak.count} 次暂无计划 · 建议主管协助并形成明确下一步`;
  for (const recipient of recipients) {
    createNotification(value, {
      userId: recipient.id,
      customerId: account.id,
      code: 'NO_PLAN_STREAK',
      severity: 'warning',
      title: `连续 ${streak.count} 次暂无计划`,
      detail,
      dedupeKey: `no-plan-streak:${account.id}:${streak.streakStartId}:${recipient.id}`,
    }, { wecomEnabled: false });
  }
}

function scanManagerTasks(user, payload = {}) {
  assertManagerTaskRole(user);
  const value = db();
  try {
    const account = scopedManagerAccount(value, user, payload.customerId);
    return value.transaction(() => {
      const triggers = evaluateManagerTriggers(
        value,
        account.external_customer_id || account.id,
      );
      const tasks = triggers.map(trigger => {
        const task = upsertManagerTask(value, trigger);
        notifyManagerTaskRecipients(value, task, account);
        return task;
      });
      return { tasks, evaluatedReasons: triggers.map(trigger => trigger.reason) };
    }).immediate();
  } finally { value.close(); }
}

function updateManagerSettings(user, payload = {}) {
  assertManagerSettingsAdmin(user);
  const value = db();
  try {
    validateManagerRecipients(value, payload.recipientIds ?? payload.patch?.recipientIds ?? []);
    return updateManagerTaskSettings(value, {
      actorId: user.id,
      expectedVersion: payload.expectedVersion,
      patch: payload.patch || payload,
    });
  } finally { value.close(); }
}

function managerTaskChange(value, actor, task, account, action = {}) {
  const type = String(action.type || '').trim();
  const at = nowText();
  if (type === 'plan_formed' || type === 'manager_advice') {
    if (!hasPermission(actor, 'edit_customer')) throw forbidden('没有编辑客户资料权限');
    if (type === 'manager_advice' && !hasPermission(actor, 'record_activity')) {
      throw forbidden('没有记录客户进展权限');
    }
    const nextAction = String(action.nextAction || '').trim();
    if (!nextAction) throw badRequest('请填写明确的下一步计划');
    const nextActionAt = parseBusinessDateTime(action.nextActionAt);
    const before = {
      nextAction: account.next_action || '',
      nextActionAt: account.next_action_at || '',
    };
    if (before.nextAction === nextAction && before.nextActionAt === nextActionAt) {
      return { changed: false };
    }
    applyAccountPlanPatch(value, account.id, {
      nextAction,
      nextActionAt,
      timeBasis: PLAN_TIME_BASIS,
      updatedAt: at,
    });
    const sourceEventId = `manager-task:${task.id}:${String(action.idempotencyKey || '').trim()}`;
    recordExplicitPlan(value, {
      customerId: account.external_customer_id || account.id,
      actorId: actor.id,
      ownerIdSnapshot: account.owner_id || '',
      nextAction,
      nextAt: `${nextActionAt.replace(' ', 'T')}Z`,
      source: type === 'manager_advice' ? 'manager_advice' : 'manager_task',
      sourceEventId,
    });
    if (type === 'manager_advice') {
      const note = String(action.note || '').trim();
      if (!note) throw badRequest('请填写主管建议');
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,summary,next_action,next_action_at,
         stage_before,stage_after,occurred_at,created_at)
        VALUES (?,?,?,'manager_advice',?,?,?,?,?,?,?)`).run(
        id('ACT'), account.id, actor.id, note, nextAction, nextActionAt,
        account.stage, account.stage, at, at,
      );
    }
    return {
      changed: true,
      entityType: 'crm_account_plan',
      entityId: account.id,
      before,
      after: { nextAction, nextActionAt },
    };
  }
  if (type === 'terminal_stage') {
    if (!hasPermission(actor, 'edit_customer')) throw forbidden('没有编辑客户资料权限');
    const stage = String(action.stage || '').trim();
    if (stage !== 'lost') throw badRequest('不对口请使用专用“标记不对口”流程');
    if (account.stage === stage) return { changed: false };
    const before = { stage: account.stage, nextAction: account.next_action || '', nextActionAt: account.next_action_at || '' };
    applyAccountStatePatch(value, account.id, { stage, updatedAt: at });
    applyAccountPlanPatch(value, account.id, {
      nextAction: '',
      nextActionAt: '',
      timeBasis: '',
      updatedAt: at,
    });
    value.prepare(`UPDATE crm_accounts SET loss_reason=? WHERE id=?`)
      .run(String(action.note || '').trim(), account.id);
    return {
      changed: true,
      entityType: 'crm_account',
      entityId: account.id,
      before,
      after: { stage, nextAction: '', nextActionAt: '' },
    };
  }
  if (type === 'reassigned') {
    if (!hasPermission(actor, 'manage_intake')) throw forbidden('没有管理入库与分配权限');
    const ownerId = String(action.ownerId || '').trim();
    if (!ownerId || ownerId === String(account.owner_id || '')
        || !authorizedSalesUser(value, ownerId)) {
      throw badRequest('请选择不同的在职销售负责人');
    }
    const before = { ownerId: account.owner_id || '' };
    applyAccountStatePatch(value, account.id, {
      ownerId,
      assignmentStatus: 'claimed',
      updatedAt: at,
    });
    value.prepare(`UPDATE crm_accounts SET assigned_at=? WHERE id=?`).run(at, account.id);
    if (account.intake_item_id) {
      value.prepare(`UPDATE crm_intake_items SET assigned_owner_id=?,status='claimed',
        assigned_at=?,updated_at=? WHERE id=?`).run(ownerId, at, at, account.intake_item_id);
    }
    return {
      changed: true,
      entityType: 'crm_account_owner',
      entityId: account.id,
      before,
      after: { ownerId },
    };
  }
  return null;
}

function resolveManagerTaskAction(user, taskId, payload = {}, identity = {}) {
  const value = db();
  try {
    return value.transaction(() => {
      const { task, account } = managerTaskAccount(value, user, taskId);
      if (String(payload.type || '').trim() === 'terminal_stage'
          && String(payload.stage || '').trim() !== 'lost') {
        throw badRequest('不对口请使用专用“标记不对口”流程');
      }
      const before = {
        taskStatus: task.status,
        account: {
          ownerId: account.owner_id || '',
          stage: account.stage || '',
          nextAction: account.next_action || '',
          nextActionAt: account.next_action_at || '',
        },
      };
      const result = resolveManagerTask(value, user, task.id, {
        ...payload,
        apply: (transactionDb, currentTask) => managerTaskChange(
          transactionDb, user, currentTask, account, payload,
        ),
      });
      if (result.task.status === 'escalated' && !result.deduplicated) {
        notifyManagerTaskEscalation(value, result.task, account);
      }
      if (!result.deduplicated) {
        const currentAccount = value.prepare(`SELECT owner_id,stage,next_action,next_action_at
          FROM crm_accounts WHERE id=?`).get(account.id) || {};
        const realUserId = identity.realUserId || user.id;
        const effectiveUserId = identity.effectiveUserId || user.id;
        value.prepare(`INSERT INTO crm_audit_log
          (id,user_id,action,entity_type,entity_id,detail_json,created_at,
           real_user_id,effective_user_id,impersonation_context_id)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          id('AUD'),
          effectiveUserId,
          'manager_task_resolved',
          'crm_manager_task',
          task.id,
          JSON.stringify(redactAuditPayload({
            actionType: String(payload.type || ''),
            interventionId: result.interventionId,
            before,
            after: {
              taskStatus: result.task.status,
              account: {
                ownerId: currentAccount.owner_id || '',
                stage: currentAccount.stage || '',
                nextAction: currentAccount.next_action || '',
                nextActionAt: currentAccount.next_action_at || '',
              },
            },
            result: result.task.result || {},
          })),
          nowText(),
          realUserId,
          effectiveUserId,
          identity.contextId || '',
        );
      }
      return result;
    }).immediate();
  } finally { value.close(); }
}

function todayTaskRequestSpec(payload = {}) {
  const actionType = String(payload.actionType || '').trim();
  if (!TODAY_TASK_ACTION_TYPES.has(actionType)) {
    throw todayTaskError(400, '不支持的今日待办操作');
  }
  const targetType = actionType === 'resolve_overdue_lead' ? 'crm_intake_item' : 'crm_account';
  const targetId = String(
    targetType === 'crm_intake_item' ? payload.intakeItemId : payload.customerId,
  ).trim();
  if (!targetId) throw todayTaskError(400, '今日待办目标不能为空');
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 240) {
    throw todayTaskError(400, '必须提供有效的幂等键');
  }
  const canonical = actionType === 'resolve_overdue_lead'
    ? {
      actionType,
      intakeItemId: targetId,
      resolution: String(payload.resolution || '').trim(),
      ownerId: String(payload.ownerId || '').trim(),
    }
    : actionType === 'add_next_plan'
      ? {
        actionType,
        customerId: targetId,
        nextAction: String(payload.nextAction || '').trim(),
        nextActionAt: String(payload.nextActionAt || '').trim(),
      }
      : {
        actionType,
        customerId: targetId,
        result: String(payload.result || '').trim(),
      };
  return {
    actionType,
    targetType,
    targetId,
    idempotencyKey,
    requestHash: crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
  };
}

function reserveTodayTaskAction(value, user, spec) {
  let existing = value.prepare(
    'SELECT * FROM crm_today_task_action_requests WHERE idempotency_key=?',
  ).get(spec.idempotencyKey);
  if (!existing) {
    const at = nowText();
    const inserted = value.prepare(`INSERT OR IGNORE INTO crm_today_task_action_requests
      (idempotency_key,actor_id,action_type,target_type,target_id,request_hash,
       status,response_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'started','{}',?,?)`).run(
      spec.idempotencyKey,
      user.id,
      spec.actionType,
      spec.targetType,
      spec.targetId,
      spec.requestHash,
      at,
      at,
    );
    if (inserted.changes === 1) return { replay: null };
    existing = value.prepare(
      'SELECT * FROM crm_today_task_action_requests WHERE idempotency_key=?',
    ).get(spec.idempotencyKey);
  }
  if (!existing
      || existing.actor_id !== user.id
      || existing.action_type !== spec.actionType
      || existing.target_type !== spec.targetType
      || existing.target_id !== spec.targetId
      || existing.request_hash !== spec.requestHash) {
    throw todayTaskError(
      409,
      '幂等键已绑定其他今日待办操作',
      'TODAY_TASK_IDEMPOTENCY_CONFLICT',
    );
  }
  if (existing.status === 'completed') {
    return { replay: { ...json(existing.response_json, {}), deduplicated: true } };
  }
  throw todayTaskError(
    409,
    '相同今日待办操作正在处理中',
    'TODAY_TASK_ACTION_IN_PROGRESS',
  );
}

function completeTodayTaskAction(value, spec, response) {
  const updated = value.prepare(`UPDATE crm_today_task_action_requests
    SET status='completed',response_json=?,updated_at=?
    WHERE idempotency_key=? AND status='started'`).run(
    JSON.stringify(response),
    nowText(),
    spec.idempotencyKey,
  );
  if (updated.changes !== 1) {
    throw todayTaskError(409, '今日待办操作状态已变化', 'TODAY_TASK_ACTION_IN_PROGRESS');
  }
  return response;
}

function recordTodayTaskAudit(value, user, identity, action, entityType, entityId, detail) {
  const effectiveUserId = identity?.effectiveUserId || user.id;
  value.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at,
     real_user_id,effective_user_id,impersonation_context_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id('AUD'),
    effectiveUserId,
    action,
    entityType,
    entityId,
    JSON.stringify(redactAuditPayload(detail)),
    nowText(),
    identity?.realUserId || user.id,
    effectiveUserId,
    identity?.contextId || '',
  );
}

function latestManagerRequest(value, customerId) {
  const row = value.prepare(`SELECT x.user_id requester_id,u.name requester_name,
      x.occurred_at requested_at,x.summary,x.outcome,x.progress_key,x.activity_type
    FROM crm_activities x
    LEFT JOIN sales_users u ON u.id=x.user_id
    WHERE x.customer_id=? AND x.manager_required=1
      AND ${effectiveActivityWhereClause(value, 'x')}
    ORDER BY x.occurred_at DESC,x.created_at DESC,x.id DESC LIMIT 1`).get(customerId);
  if (!row) return null;
  return {
    requesterId: row.requester_id || '',
    requesterName: row.requester_name || row.requester_id || '',
    requestedAt: row.requested_at || '',
    reason: row.summary || row.outcome || '',
    progress: row.progress_key || row.activity_type || '',
  };
}

function resolveOverdueLeadTodayTask(value, user, payload, spec, identity) {
  assertTodayTaskManager(user, ['manage_intake']);
  const resolution = String(payload.resolution || '').trim();
  if (!['reassign', 'return_to_pool'].includes(resolution)) {
    throw todayTaskError(400, '请选择重新分配或退回线索池');
  }
  const item = value.prepare('SELECT * FROM crm_intake_items WHERE id=?').get(spec.targetId);
  const actionAt = nowText();
  if (!item
      || item.status !== 'assigned'
      || !item.claim_due_at
      || item.claim_due_at >= actionAt) {
    throw todayTaskError(409, '该超时线索已处理或状态已变化', 'TODAY_TASK_STALE');
  }
  const previousOwnerId = String(item.assigned_owner_id || '');
  const linkedAccount = value.prepare(`SELECT id FROM crm_accounts
    WHERE id=? OR intake_item_id=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`)
    .get(item.crm_customer_id || '', item.id, item.crm_customer_id || '');
  const linkedAccountId = linkedAccount?.id || '';
  let ownerId = '';
  let claimDueAt = '';
  let reason = '超过24小时未领取';
  if (resolution === 'reassign') {
    ownerId = String(payload.ownerId || '').trim();
    const owner = authorizedSalesUser(value, ownerId);
    if (!owner) {
      throw todayTaskError(400, '请选择有效的在职销售负责人');
    }
    if (ownerId === previousOwnerId) {
      throw todayTaskError(400, '请重新分配给其他在职销售');
    }
    const settings = value.prepare(
      "SELECT claim_sla_hours FROM crm_intake_settings WHERE id='default'",
    ).get();
    claimDueAt = nowText(new Date(Date.now() + Number(settings?.claim_sla_hours || 24) * 3600000));
    reason = '超过24小时未领取后重新分配';
    value.prepare(`UPDATE crm_intake_items SET status='assigned',assigned_owner_id=?,
      suggested_owner_id=?,decision_reason=?,return_reason='',assigned_at=?,claim_due_at=?,
      claimed_at='',updated_at=? WHERE id=?`).run(
      ownerId,
      ownerId,
      reason,
      actionAt,
      claimDueAt,
      actionAt,
      item.id,
    );
    if (linkedAccountId) {
      applyAccountStatePatch(value, linkedAccountId, {
        ownerId,
        assignmentStatus: 'assigned',
        updatedAt: actionAt,
      });
      value.prepare(`UPDATE crm_accounts SET assigned_at=?,claim_due_at=?,claimed_at='',return_reason=''
        WHERE id=?`).run(
        actionAt,
        claimDueAt,
        linkedAccountId,
      );
    }
  } else {
    value.prepare(`UPDATE crm_intake_items SET status='returned',assigned_owner_id='',
      suggested_owner_id='',decision_reason=?,return_reason=?,assigned_at='',claim_due_at='',
      claimed_at='',updated_at=? WHERE id=?`).run(reason, reason, actionAt, item.id);
    if (linkedAccountId) {
      applyAccountStatePatch(value, linkedAccountId, {
        ownerId: null,
        assignmentStatus: 'returned',
        updatedAt: actionAt,
      });
      value.prepare(`UPDATE crm_accounts SET previous_owner_id=?,assigned_at='',claim_due_at='',
        claimed_at='',return_reason=? WHERE id=?`).run(
        previousOwnerId,
        reason,
        linkedAccountId,
      );
    }
  }
  const detail = {
    resolution,
    method: resolution,
    previousOwnerId,
    previousClaimDueAt: item.claim_due_at || '',
    actorId: user.id,
    ownerId,
    assignedAt: resolution === 'reassign' ? actionAt : '',
    claimDueAt,
    actionAt,
    handledAt: actionAt,
    reason,
  };
  recordIntakeDecision(value, item.id, {
    decisionType: 'manual',
    actorId: user.id,
    manualDecision: {
      action: 'resolve_overdue_lead',
      status: resolution === 'reassign' ? 'assigned' : 'returned',
      ...detail,
    },
  });
  recordTodayTaskAudit(
    value,
    user,
    identity,
    'today_task_overdue_lead_resolved',
    'crm_intake_item',
    item.id,
    detail,
  );
  return {
    actionType: spec.actionType,
    intakeItemId: item.id,
    resolution,
    previousOwnerId,
    previousClaimDueAt: item.claim_due_at || '',
    ownerId,
    assignedAt: resolution === 'reassign' ? actionAt : '',
    claimDueAt,
    handledAt: actionAt,
  };
}

function addNextPlanTodayTask(value, user, payload, spec, identity) {
  assertPermission(user, 'view_alerts');
  assertPermission(user, 'record_activity');
  const account = getAccountForUser(value, user, spec.targetId);
  if (String(account.next_action || '').trim() && String(account.next_action_at || '').trim()) {
    throw todayTaskError(409, '该客户已补充下一步计划', 'TODAY_TASK_STALE');
  }
  const nextAction = String(payload.nextAction || '').trim();
  if (!nextAction) throw todayTaskError(400, '下一步动作不能为空');
  if (Array.from(nextAction).length > 1000) {
    throw todayTaskError(400, '下一步动作最多1000个字符');
  }
  const nextActionAt = normalizeTodayTaskDate(payload.nextActionAt);
  const changedAt = nowText();
  applyAccountPlanPatch(value, account.id, {
    nextAction,
    nextActionAt,
    timeBasis: PLAN_TIME_BASIS,
    updatedAt: changedAt,
  });
  recordExplicitPlanIfEnabled(
    value, account, user.id, nextAction, nextActionAt, 'today_task', spec.idempotencyKey,
  );
  const delegated = String(account.owner_id || '') !== String(user.id || '');
  recordTodayTaskAudit(
    value,
    user,
    identity,
    'today_task_next_plan_added',
    'crm_account',
    account.id,
    {
      ownerId: account.owner_id || '',
      actorId: user.id,
      delegated,
      nextAction,
      nextActionAt,
      changedAt,
    },
  );
  return {
    actionType: spec.actionType,
    customerId: account.id,
    nextAction,
    nextActionAt,
    delegated,
  };
}

function completeManagerAssistanceTodayTask(value, user, payload, spec, identity) {
  assertTodayTaskManager(user, ['view_team', 'view_alerts']);
  const account = getAccountForUser(value, user, spec.targetId);
  if (!account.manager_required || account.manager_status !== '待介入') {
    throw todayTaskError(409, '该管理协助待办已完成或状态已变化', 'TODAY_TASK_STALE');
  }
  const result = String(payload.result || '').trim();
  if (!result) throw todayTaskError(400, '主管处理意见不能为空');
  if (Array.from(result).length > 2000) {
    throw todayTaskError(400, '主管处理意见最多2000个字符');
  }
  const repliedAt = nowText();
  const activityId = id('ACT');
  value.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,
     stage_before,stage_after,manager_required,progress_key,reaction_option_id,
     reaction_label_snapshot,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    activityId,
    account.id,
    user.id,
    'manager_join',
    '',
    '已回复',
    result,
    account.next_action || '',
    account.next_action_at || '',
    account.stage,
    account.stage,
    0,
    'manager_join',
    '',
    '已回复',
    repliedAt,
    repliedAt,
  );
  applyManagerStatusPatch(value, account.id, {
    status: '已回复',
    managerId: user.id,
    updatedAt: repliedAt,
  });
  value.prepare(`UPDATE crm_accounts SET last_activity_at=? WHERE id=?`).run(
    repliedAt,
    account.id,
  );
  const taskResult = { action: 'manager_replied', result, activityId, repliedAt };
  value.prepare(`UPDATE crm_manager_tasks SET result_json=?,updated_at=?
    WHERE customer_id=? AND reason='manager_assistance'
      AND status IN ('open','overdue','escalated')
    ORDER BY triggered_at DESC,id DESC LIMIT 1`).run(
    JSON.stringify(taskResult), repliedAt,
    account.external_customer_id || account.id,
  );
  const request = latestManagerRequest(value, account.id);
  recordTodayTaskAudit(
    value,
    user,
    identity,
    'today_task_manager_assistance_replied',
    'crm_account',
    account.id,
    {
      requesterId: request?.requesterId || '',
      requestedAt: request?.requestedAt || account.updated_at || '',
      requestReason: request?.reason || account.manager_status || '',
      requestProgress: request?.progress || '',
      handlerId: user.id,
      result,
      repliedAt,
      activityId,
    },
  );
  return {
    actionType: spec.actionType,
    customerId: account.id,
    activityId,
    repliedAt,
  };
}

function confirmManagerAssistanceTodayTask(value, user, payload, spec, identity) {
  assertPermission(user, 'view_alerts');
  assertPermission(user, 'record_activity');
  const account = getAccountForUser(value, user, spec.targetId);
  if (!account.manager_required || account.manager_status !== '已回复') {
    throw todayTaskError(409, '该主管协助回执已处理或状态已变化', 'TODAY_TASK_STALE');
  }
  const nextAction = String(payload.nextAction || '').trim();
  if (!nextAction) throw todayTaskError(400, '下一步动作不能为空');
  if (Array.from(nextAction).length > 1000) {
    throw todayTaskError(400, '下一步动作最多1000个字符');
  }
  const nextActionAt = normalizeTodayTaskDate(payload.nextActionAt);
  const changedAt = nowText();
  applyAccountPlanPatch(value, account.id, {
    nextAction,
    nextActionAt,
    timeBasis: PLAN_TIME_BASIS,
    updatedAt: changedAt,
  });
  applyManagerStatusPatch(value, account.id, {
    required: 0,
    status: '已完成',
    updatedAt: changedAt,
  });
  recordExplicitPlanIfEnabled(
    value, account, user.id, nextAction, nextActionAt, 'manager_receipt', spec.idempotencyKey,
  );
  value.prepare(`UPDATE crm_manager_tasks SET status='completed',
    result_json=?,resolved_by=?,resolved_at=?,updated_at=?
    WHERE customer_id=? AND reason='manager_assistance'
      AND status IN ('open','overdue','escalated')
    ORDER BY triggered_at DESC,id DESC LIMIT 1`).run(
    JSON.stringify({ action: 'sales_plan_confirmed', nextAction, nextActionAt, confirmedAt: changedAt }),
    user.id, changedAt, changedAt, account.external_customer_id || account.id,
  );
  recordTodayTaskAudit(
    value, user, identity,
    'today_task_manager_assistance_confirmed',
    'crm_account', account.id,
    { nextAction, nextActionAt, changedAt },
  );
  return { actionType: spec.actionType, customerId: account.id, nextAction, nextActionAt };
}

function executeTodayTaskAction(user, payload = {}, identity = {}) {
  assertPermission(user, 'view_alerts');
  const spec = todayTaskRequestSpec(payload);
  const value = db();
  try {
    const transaction = value.transaction(() => {
      const reservation = reserveTodayTaskAction(value, user, spec);
      if (reservation.replay) return reservation.replay;
      let response;
      if (spec.actionType === 'resolve_overdue_lead') {
        response = resolveOverdueLeadTodayTask(value, user, payload, spec, identity);
      } else if (spec.actionType === 'add_next_plan') {
        response = addNextPlanTodayTask(value, user, payload, spec, identity);
      } else if (spec.actionType === 'confirm_manager_assistance') {
        response = confirmManagerAssistanceTodayTask(value, user, payload, spec, identity);
      } else {
        response = completeManagerAssistanceTodayTask(value, user, payload, spec, identity);
      }
      return completeTodayTaskAction(value, spec, { ...response, deduplicated: false });
    });
    return transaction.immediate();
  } finally {
    value.close();
  }
}

function updateIntakeSettings(user, payload) {
  if (user.role === 'sales') {
    throw httpError(403, '当前账号无权管理线索分配', 'INTAKE_MANAGEMENT_FORBIDDEN');
  }
  assertPermission(user, 'view_intake');
  assertPermission(user, 'manage_intake');
  const value = db();
  try {
    value.prepare(`UPDATE crm_intake_settings SET enabled=?,approval_mode='manual',claim_sla_hours=?,
      contact_sla_hours=?,match_groups_json=?,countries_json=?,updated_by=?,updated_at=? WHERE id='default'`).run(
      payload.enabled === false ? 0 : 1,
      Math.max(1, Math.min(72, Number(payload.claimSlaHours || 12))), Math.max(1, Math.min(168, Number(payload.contactSlaHours || 24))),
      JSON.stringify(payload.matchGroups || ['A', 'B']), JSON.stringify(payload.countries || []), user.id, nowText(),
    );
    return { updated: true };
  } finally { value.close(); }
}

function normalizeListQuery(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Number.parseInt(query.pageSize || query.page_size, 10) === 100 ? 100 : 50;
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    search: String(query.search || '').trim().slice(0, 120),
  };
}

function researchPoolCondition(user, alias, params) {
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
  const count = (from, alias, permission, extra = '', scope = researchOwnerCondition) => {
    if (!permission) return 0;
    const params = [];
    const ownerCondition = scope(user, alias, params);
    const where = [ownerCondition, extra].filter(Boolean).join(' AND ');
    return Number(value.prepare(`SELECT COUNT(*) total FROM ${from} ${alias}${where ? ` WHERE ${where}` : ''}`).get(...params).total || 0);
  };
  const canSeePool = permissions.view_pool;
  const canSeePeople = permissions.view_contacts;
  const canSeeRecon = permissions.view_recon;
  return {
    ...(canSeePool ? {
      pool: count(
      'customer_pool', 'p', canSeePool,
      `COALESCE(p.is_test_data,0)=0
        AND NOT EXISTS(SELECT 1 FROM crm_protected_customers protected
          WHERE protected.external_customer_id=p.customer_id
            AND protected.status IN ('protected','withdrawn'))`,
      researchPoolCondition,
      ),
      poolAvailable: count(
      'customer_pool',
      'p',
      canSeePool,
      `COALESCE(p.is_test_data,0)=0
        AND NOT EXISTS(SELECT 1 FROM crm_accounts linked_account WHERE linked_account.external_customer_id=p.customer_id)
        AND NOT EXISTS(SELECT 1 FROM crm_protected_customers protected
          WHERE protected.external_customer_id=p.customer_id
            AND protected.status IN ('protected','withdrawn'))`,
      researchPoolCondition,
      ),
    } : {}),
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
    if (kind === 'people' || kind === 'recon') {
      const allowedQueryKeys = new Set([
        'page', 'pageSize', 'page_size', 'permissionVersion', 'filters',
      ]);
      if (Object.keys(query).some(key => !allowedQueryKeys.has(key))) {
        throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
      }
      const pageKey = kind === 'people' ? 'contacts' : 'recon';
      const { page, pageSize, offset } = normalizeListQuery({ ...query, search: '' });
      const ast = authorizedFilterAst(value, user, pageKey, query);
      const scope = buildResearchFilterScope(user, pageKey, ast);
      const schema = authorizedFilterSchema(value, user, pageKey);
      const select = kind === 'people'
        ? `pc.*,
          (SELECT p.company_name FROM customer_pool p WHERE p.customer_id=pc.customer_id LIMIT 1) company_name,
          (SELECT group_concat(cm.method_type || ':' || cm.value,' / ')
            FROM contact_methods cm WHERE cm.person_id=pc.person_id) methods_summary`
        : 'r.*';
      const orderBy = kind === 'people'
        ? 'pc.sales_ready DESC,pc.contact_level DESC,pc.updated_at DESC,pc.person_id ASC'
        : 'r.updated_at DESC,r.job_id ASC';
      const total = Number(value.prepare(`SELECT COUNT(*) total
        FROM ${scope.from}${scope.where}`).get(...scope.params).total || 0);
      let rows = value.prepare(`SELECT ${select} FROM ${scope.from}${scope.where}
        ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
        .all(...scope.params, pageSize, offset);
      if (!permissions.view_contacts && kind === 'recon') {
        rows = rows.map(contactSafeReconRecord);
      }
      return {
        rows,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        hasMore: offset + rows.length < total,
        schema,
      };
    }

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
      addLike(permissions.view_contacts
        ? ['p.customer_id','p.nickname','p.company_name','p.country','p.city','p.website','p.industry','p.customer_type','p.products']
        : ['p.customer_id','p.nickname','p.company_name','p.country','p.city','p.website','p.industry','p.customer_type']);
      conditions.push('COALESCE(p.is_test_data,0)=0');
      conditions.push(`NOT EXISTS(SELECT 1 FROM crm_protected_customers protected
        WHERE protected.external_customer_id=p.customer_id
          AND protected.status IN ('protected','withdrawn'))`);
      if (query.group) { conditions.push("COALESCE(NULLIF(p.current_pool,''),'未分池')=?"); params.push(String(query.group)); }
      if (query.crm === 'crm') conditions.push('EXISTS(SELECT 1 FROM crm_accounts linked WHERE linked.external_customer_id=p.customer_id)');
      if (query.crm === 'available') conditions.push('NOT EXISTS(SELECT 1 FROM crm_accounts linked WHERE linked.external_customer_id=p.customer_id)');
    } else if (kind === 'people') {
      alias = 'pc';
      from = 'person_candidates pc';
      select = `pc.*,
        (SELECT p.company_name FROM customer_pool p WHERE p.customer_id=pc.customer_id LIMIT 1) company_name,
        (SELECT group_concat(cm.method_type || ':' || cm.value,' / ') FROM contact_methods cm WHERE cm.person_id=pc.person_id) methods_summary`;
      orderBy = 'pc.sales_ready DESC,pc.contact_level DESC,pc.updated_at DESC,pc.person_id ASC';
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
      orderBy = 'r.updated_at DESC,r.job_id ASC';
      addLike(permissions.view_contacts
        ? ['r.customer_id','r.company_name','r.industry','r.customer_type','r.opportunity_summary','r.contacts_summary']
        : ['r.customer_id','r.company_name','r.industry','r.customer_type']);
    } else {
      const error = new Error('未知数据列表');
      error.statusCode = 404;
      throw error;
    }

    const ownerCondition = researchPoolCondition(user, alias, params);
    if (ownerCondition) conditions.push(ownerCondition);
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(value.prepare(`SELECT COUNT(*) total FROM ${from}${where}`).get(...params).total || 0);
    let rows = value.prepare(`SELECT ${select} FROM ${from}${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset);
    if (!permissions.view_contacts && kind === 'pool') rows = rows.map(contactSafePoolRecord);
    if (!permissions.view_contacts && kind === 'recon') rows = rows.map(contactSafeReconRecord);
    return {
      rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize),
      hasMore: offset + rows.length < total,
    };
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

const TIMELINE_EVENT_LABELS = Object.freeze({
  claim: {
    title: '领取客户',
    summary: actor => (actor ? `${actor}领取该线索并进入 CRM` : '领取该线索并进入 CRM'),
  },
  assign: {
    title: '分配线索',
    summary: (actor, detail, names) => `${actor}将线索分配给 ${names.get(detail.ownerId) || '销售'}`,
  },
  reassign: {
    title: '重新分配',
    summary: (actor, detail, names) => `${actor}将客户重新分配给 ${names.get(detail.ownerId) || '销售'}`,
  },
  unassign: {
    title: '取消分配',
    summary: actor => `${actor}取消分配，线索恢复为待分配`,
  },
  return: {
    title: '退回线索池',
    summary: actor => `${actor}将客户退回线索池`,
  },
  sales_return: {
    title: '退回线索池',
    summary: actor => `${actor}将客户退回线索池`,
  },
  reject: {
    title: '标记不对口',
    summary: actor => `${actor}将客户标记为不对口`,
  },
  manual_delete: {
    title: '移入客户回收站',
    summary: actor => `${actor}将客户移入回收站`,
  },
  restore: {
    title: '恢复客户',
    summary: actor => `${actor}恢复该客户`,
  },
  nickname_update: {
    title: '修改客户昵称',
    summary: actor => `${actor}修改了客户昵称`,
  },
});

const TIMELINE_AUDIT_ACTIONS = Object.freeze({
  customer_nickname_updated: 'nickname_update',
  customer_reassigned: 'reassign',
  customer_returned: 'sales_return',
  customer_bulk_returned: 'sales_return',
  customer_restored: 'restore',
  customer_trashed: 'manual_delete',
});

const INTAKE_DECISION_EVENT_ACTIONS = Object.freeze({
  assign: 'assign',
  manual_assign: 'assign',
  reassign: 'reassign',
  unassign: 'unassign',
  return: 'return',
  reject: 'reject',
});

function creatorDisplayName(row) {
  if (String(row?.created_by || '') === 'system') return '系统导入';
  if (row?.creator_name) return row.creator_name;
  return '历史数据/未知';
}

const ACCOUNT_FIELD_LABELS = Object.freeze({
  nickname: '昵称',
  companyName: '公司名称',
  russianName: '本地名称/别名',
  englishName: '英文名称',
  country: '国家',
  city: '城市',
  website: '官网',
  industry: '行业',
  customerType: '客户类型',
  description: '企业简介',
  productFocus: '产品',
  rating: '评级',
  establishedYear: '成立年份',
  priority: '优先级',
  stage: '阶段',
  ownerId: '负责人',
  source: '来源',
});

function changedFieldLabels(changed, key) {
  const result = {};
  for (const [field, change] of Object.entries(changed || {})) {
    result[ACCOUNT_FIELD_LABELS[field] || field] = key === 'from' ? change.from : change.to;
  }
  return result;
}

function buildAccountHistory(value, account) {
  const events = [];
  const ownerNames = hasTable(value, 'sales_users')
    ? new Map(value.prepare('SELECT id,name FROM sales_users').all().map(row => [row.id, row.name]))
    : new Map();
  if (String(account.created_by || '') === 'system') {
    events.push({
      id: `system-import:${account.id}`,
      customer_id: account.id,
      kind: 'system_import',
      title: '系统导入建档',
      summary: '系统导入创建客户主档',
      actorId: 'system',
      actorName: '系统',
      occurredAt: account.created_at,
      before: null,
      after: null,
    });
  } else if (String(account.created_by || '').trim()) {
    events.push({
      id: `manual-create:${account.id}`,
      customer_id: account.id,
      kind: 'manual_create',
      title: '手工创建客户',
      summary: `${ownerNames.get(account.created_by) || '历史数据/未知'}创建该客户`,
      actorId: account.created_by,
      actorName: ownerNames.get(account.created_by) || '历史数据/未知',
      occurredAt: account.created_at,
      before: null,
      after: null,
    });
  } else {
    events.push({
      id: `unknown-create:${account.id}`,
      customer_id: account.id,
      kind: 'system_import',
      title: '历史建档',
      summary: '创建人未知',
      actorId: '',
      actorName: '历史数据/未知',
      occurredAt: account.created_at,
      before: null,
      after: null,
    });
  }
  const claimedAt = account.claimed_at
    || account.first_claimed_at
    || (account.assignment_status === 'claimed' ? account.created_at : '');
  if (claimedAt) {
    const claimerId = account.first_claimed_by || account.owner_id || '';
    const claimerName = ownerNames.get(claimerId) || '';
    events.push({
      id: `claim:${account.id}`,
      customer_id: account.id,
      kind: 'claim',
      title: '领取客户',
      summary: `${claimerName || '销售'}领取该线索并进入 CRM`,
      actorId: claimerId,
      actorName: claimerName,
      occurredAt: claimedAt,
      before: null,
      after: null,
    });
  }
  if (String(account.intake_item_id || '').trim() && hasTable(value, 'crm_intake_decisions')) {
    const decisions = value.prepare(`SELECT d.*,u.name actor_name
      FROM crm_intake_decisions d
      LEFT JOIN sales_users u ON u.id=d.actor_id
      WHERE d.intake_item_id=? AND d.decision_type='manual'
      ORDER BY d.created_at ASC,d.id ASC`).all(account.intake_item_id);
    for (const decision of decisions) {
      const manual = parseJsonObject(decision.manual_decision_json) || {};
      const kind = INTAKE_DECISION_EVENT_ACTIONS[String(manual.action || '')];
      const mapping = kind ? TIMELINE_EVENT_LABELS[kind] : null;
      if (!mapping) continue;
      events.push({
        id: `intake-decision:${decision.id}`,
        customer_id: account.id,
        kind,
        title: mapping.title,
        summary: mapping.summary(decision.actor_name || '', manual, ownerNames),
        actorId: decision.actor_id || '',
        actorName: decision.actor_name || '',
        occurredAt: decision.created_at,
        before: null,
        after: null,
      });
    }
  }
  if (hasTable(value, 'crm_audit_log')) {
    const auditActions = [...Object.keys(TIMELINE_AUDIT_ACTIONS), 'customer_master_updated'];
    const placeholders = auditActions.map(() => '?').join(',');
    const audits = value.prepare(`SELECT l.*,u.name actor_name
      FROM crm_audit_log l
      LEFT JOIN sales_users u ON u.id=l.effective_user_id
      WHERE l.entity_type='crm_account' AND l.entity_id=? AND l.action IN (${placeholders})
      ORDER BY l.created_at ASC,l.id ASC`).all(account.id, ...auditActions);
    for (const audit of audits) {
      const detail = parseJsonObject(audit.detail_json);
      const actorId = audit.effective_user_id || audit.user_id || '';
      const actorName = audit.actor_name || ownerNames.get(actorId) || actorId || '';
      if (audit.action === 'customer_master_updated') {
        events.push({
          id: `audit:${audit.id}`,
          customer_id: account.id,
          kind: 'master_updated',
          title: '修改客户资料',
          summary: `${actorName}修改了客户资料`,
          actorId,
          actorName,
          occurredAt: audit.created_at,
          before: changedFieldLabels(detail.changed, 'from'),
          after: changedFieldLabels(detail.changed, 'to'),
        });
        continue;
      }
      const kind = TIMELINE_AUDIT_ACTIONS[audit.action];
      const mapping = kind ? TIMELINE_EVENT_LABELS[kind] : null;
      if (!mapping) continue;
      const nicknameChange = audit.action === 'customer_nickname_updated';
      events.push({
        id: `audit:${audit.id}`,
        customer_id: account.id,
        kind,
        title: mapping.title,
        summary: mapping.summary(actorName, detail, ownerNames),
        actorId,
        actorName,
        occurredAt: audit.created_at,
        before: nicknameChange ? { 昵称: detail.oldNickname } : null,
        after: nicknameChange ? { 昵称: detail.newNickname } : null,
      });
    }
  }
  return events.sort((left, right) =>
    String(right.occurred_at || '').localeCompare(String(left.occurred_at || ''))
    || String(right.id).localeCompare(String(left.id))).slice(0, 200);
}

function buildCustomerTimeline(value, accounts, activities, rfqs, quotes, orders, options = {}) {
  const events = [];
  const activityById = new Map(activities.map(row => [String(row.id || ''), row]));
  const accountIds = accounts.map(row => row.id);
  const placeholders = accountIds.length ? accountIds.map(() => '?').join(',') : "''";
  const ownerNames = hasTable(value, 'sales_users')
    ? new Map(value.prepare('SELECT id,name FROM sales_users').all().map(row => [row.id, row.name]))
    : new Map();

  for (const account of accounts) {
    const claimedAt = account.claimed_at
      || (account.assignment_status === 'claimed' ? account.created_at : '');
    if (claimedAt) {
      events.push({
        id: `claim:${account.id}`,
        customer_id: account.id,
        kind: 'claim',
        title: '领取客户',
        summary: `${account.owner_name || ''}领取该线索并进入 CRM`.replace(/^ +/, ''),
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
      no_plan: Number(activity.no_plan || activity.noPlan || 0),
      manager_required: Number(activity.manager_required || activity.managerRequired || 0),
      outcome: activity.outcome || activity.reaction_label_snapshot || '',
      actor_name: activity.user_name || '',
      occurred_at: activity.occurred_at,
      provenance: activity.provenance || null,
      superseded: !isEffectiveActivity(activity),
      superseded_by: activity.supersededBy || '',
    });
  }

  for (const rfq of rfqs) {
    const linkedActivity = activityById.get(String(rfq.activity_id || ''));
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
      activity_id: rfq.activity_id || '',
      provenance: linkedActivity?.provenance || null,
      superseded: linkedActivity ? !isEffectiveActivity(linkedActivity) : false,
    });
  }

  for (const quote of quotes) {
    const linkedActivity = activityById.get(String(quote.activity_id || ''));
    events.push({
      id: `quote:${quote.id}`,
      customer_id: quote.customer_id,
      kind: 'quote',
      title: '报价已人工确认并记录',
      summary: `${Number(quote.amount || 0).toLocaleString()} ${quote.currency || 'USD'} · 毛利率 ${Number(quote.gross_margin || 0)}%`,
      actor_name: '',
      occurred_at: quote.sent_at,
      activity_id: quote.activity_id || '',
      provenance: linkedActivity?.provenance || null,
      superseded: linkedActivity ? !isEffectiveActivity(linkedActivity) : false,
    });
  }

  for (const order of orders) {
    const linkedActivity = activityById.get(String(order.activity_id || ''));
    events.push({
      id: `order:${order.id}`,
      customer_id: order.customer_id,
      kind: 'order',
      title: order.is_repeat ? '复购订单已人工确认' : '订单已人工确认',
      summary: `${Number(order.amount || 0).toLocaleString()} ${order.currency || 'USD'} · 毛利率 ${Number(order.gross_margin || 0)}%`,
      actor_name: '',
      occurred_at: order.ordered_at,
      activity_id: order.activity_id || '',
      provenance: linkedActivity?.provenance || null,
      superseded: linkedActivity ? !isEffectiveActivity(linkedActivity) : false,
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

  if (accountIds.length && hasTable(value, 'crm_audit_log')) {
    const planAudits = value.prepare(`SELECT l.*,u.name actor_name
      FROM crm_audit_log l
      LEFT JOIN sales_users u ON u.id=l.user_id
      WHERE l.entity_type='crm_account'
        AND l.entity_id IN (${placeholders})
        AND l.action='today_task_next_plan_added'
      ORDER BY l.created_at DESC,l.id DESC`).all(...accountIds);
    for (const audit of planAudits) {
      const detail = parseJsonObject(audit.detail_json);
      events.push({
        id: `next-plan:${audit.id}`,
        customer_id: audit.entity_id,
        kind: 'next_plan',
        title: detail.delegated ? '管理者代录下一步计划' : '已补充下一步计划',
        summary: detail.nextAction || '',
        next_action: detail.nextAction || '',
        next_action_at: detail.nextActionAt || '',
        actor_name: audit.actor_name || audit.user_id || '',
        occurred_at: audit.created_at,
      });
    }

    const auditActions = Object.keys(TIMELINE_AUDIT_ACTIONS);
    const auditActionPlaceholders = auditActions.map(() => '?').join(',');
    const lifecycleAudits = value.prepare(`SELECT l.*,u.name actor_name
      FROM crm_audit_log l
      LEFT JOIN sales_users u ON u.id=l.effective_user_id
      WHERE l.entity_type='crm_account'
        AND l.entity_id IN (${placeholders})
        AND l.action IN (${auditActionPlaceholders})
      ORDER BY l.created_at ASC,l.id ASC`).all(...accountIds, ...auditActions);
    for (const audit of lifecycleAudits) {
      const kind = TIMELINE_AUDIT_ACTIONS[audit.action];
      const mapping = TIMELINE_EVENT_LABELS[kind];
      if (!mapping) continue;
      const detail = parseJsonObject(audit.detail_json);
      events.push({
        id: `audit:${audit.id}`,
        customer_id: audit.entity_id,
        kind,
        title: mapping.title,
        summary: mapping.summary(
          audit.actor_name || audit.effective_user_id || audit.user_id || '',
          detail,
          ownerNames,
        ),
        actor_name: audit.actor_name || '',
        occurred_at: audit.created_at,
      });
    }
  }

  const intakeItemIds = accounts.map(account => String(account.intake_item_id || '').trim()).filter(Boolean);
  if (intakeItemIds.length && hasTable(value, 'crm_intake_decisions')) {
    const intakePlaceholders = intakeItemIds.map(() => '?').join(',');
    const accountByIntakeItem = new Map(
      accounts.filter(account => String(account.intake_item_id || '').trim())
        .map(account => [String(account.intake_item_id).trim(), account.id]),
    );
    const decisions = value.prepare(`SELECT d.*,u.name actor_name
      FROM crm_intake_decisions d
      LEFT JOIN sales_users u ON u.id=d.actor_id
      WHERE d.intake_item_id IN (${intakePlaceholders})
        AND d.decision_type='manual'
      ORDER BY d.created_at ASC,d.id ASC`).all(...intakeItemIds);
    for (const decision of decisions) {
      const manual = parseJsonObject(decision.manual_decision_json) || {};
      const kind = INTAKE_DECISION_EVENT_ACTIONS[String(manual.action || '')];
      const mapping = kind ? TIMELINE_EVENT_LABELS[kind] : null;
      if (!mapping) continue;
      events.push({
        id: `intake-decision:${decision.id}`,
        customer_id: accountByIntakeItem.get(decision.intake_item_id) || '',
        kind,
        title: mapping.title,
        summary: mapping.summary(decision.actor_name || '', manual, ownerNames),
        actor_name: decision.actor_name || '',
        occurred_at: decision.created_at,
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
    const features = featureState(value, options.hardFlags || resolveAIHardFlags());
    const aiEnabled = features.ai_stations.effectiveEnabled;
    const scope = accountScope(user);
    let accounts = addStageLabels(value.prepare(`SELECT a.*,u.name owner_name,m.name manager_name,
      creator.name creator_name,
      COALESCE(p.nickname,a.nickname,'') nickname,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
      COALESCE(NULLIF(p.country,''),a.country) country,
      COALESCE(NULLIF(p.city,''),a.city) city,
      COALESCE(NULLIF(p.website,''),a.website) website,
      COALESCE(NULLIF(p.industry,''),a.industry) industry,
      COALESCE(NULLIF(p.customer_type,''),a.customer_type) customer_type,
      COALESCE(NULLIF(p.products,''),a.product_focus) product_focus,
      COALESCE(p.established_year,a.established_year) established_year,
      p.description master_description,p.current_pool,p.rating,p.best_contact_level,p.contact_recon_status,
      p.deep_report,p.source_file
      FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
      LEFT JOIN sales_users u ON u.id=a.owner_id
      LEFT JOIN sales_users creator ON creator.id=a.created_by
      LEFT JOIN sales_users m ON m.id=a.manager_id ${scope.sql}
      ORDER BY CASE a.priority WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END,a.updated_at DESC`).all(...scope.params));
    const externalIds = [...new Set(accounts.map(account => account.external_customer_id).filter(Boolean))];
    const tagsByCustomer = new Map();
    const bootstrapTagCategories = [...allowedCustomerTagCategories(value, user)];
    for (let offset = 0; bootstrapTagCategories.length && offset < externalIds.length; offset += 500) {
      const batch = externalIds.slice(offset, offset + 500);
      const tagRows = value.prepare(`SELECT ct.customer_id,t.id,t.name,t.category,t.color,t.is_preset
        FROM customer_tags ct JOIN tags t ON t.id=ct.tag_id
        WHERE ct.customer_id IN (${batch.map(() => '?').join(',')})
          AND t.category IN (${bootstrapTagCategories.map(() => '?').join(',')})
        ORDER BY t.category,t.name,t.id`).all(...batch, ...bootstrapTagCategories);
      for (const row of tagRows) {
        const tags = tagsByCustomer.get(row.customer_id) || [];
        tags.push({
          id: row.id,
          name: row.name,
          category: row.category,
          color: row.color,
          isPreset: Boolean(row.is_preset),
        });
        tagsByCustomer.set(row.customer_id, tags);
      }
    }
    accounts.forEach(account => {
      account.customerTags = tagsByCustomer.get(account.external_customer_id) || [];
    });
    accounts = attachCustomerStarState(value, user, accounts);
    const customerIds = accounts.map(row => row.id);
    const placeholders = customerIds.length ? customerIds.map(() => '?').join(',') : "''";
    const activityHistory = publicActivityRecords(addActivityProvenance(value.prepare(`SELECT x.*,u.name user_name FROM crm_activities x LEFT JOIN sales_users u ON u.id=x.user_id
      WHERE x.customer_id IN (${placeholders}) AND COALESCE(x.is_test_data,0)=0 ORDER BY x.occurred_at DESC`)
      .all(...customerIds)));
    const effectiveActivities = activityHistory.filter(isEffectiveActivity);
    const rfqs = value.prepare(`SELECT * FROM crm_rfqs WHERE customer_id IN (${placeholders}) ORDER BY received_at DESC`).all(...customerIds);
    const quotes = value.prepare(`SELECT * FROM crm_quotes WHERE customer_id IN (${placeholders}) ORDER BY sent_at DESC`).all(...customerIds);
    const orders = value.prepare(`SELECT * FROM crm_orders WHERE customer_id IN (${placeholders}) ORDER BY ordered_at DESC`).all(...customerIds);
    const activityById = new Map(activityHistory.map(row => [String(row.id || ''), row]));
    const effectiveCommerce = row => !row.activity_id
      || isEffectiveActivity(activityById.get(String(row.activity_id || '')));
    const effectiveRfqs = rfqs.filter(effectiveCommerce);
    const effectiveQuotes = quotes.filter(effectiveCommerce);
    const effectiveOrders = orders.filter(effectiveCommerce);
    const planCustomerIds = [...new Set(accounts.map(account => account.external_customer_id || account.id))];
    const planPlaceholders = planCustomerIds.length ? planCustomerIds.map(() => '?').join(',') : "''";
    const planEvents = value.prepare(`SELECT 'deferred' type,id,customer_id,review_at,reason,created_at
      FROM crm_deferred_plan_events d WHERE customer_id IN (${planPlaceholders})
        AND ${effectivePlanWhereClause(value, 'crm_deferred_plan_events', 'd')}
      UNION ALL
      SELECT 'explicit' type,id,customer_id,'' review_at,'' reason,created_at
      FROM crm_next_plan_events e WHERE customer_id IN (${planPlaceholders})
        AND ${effectivePlanWhereClause(value, 'crm_next_plan_events', 'e')}`)
      .all(...planCustomerIds, ...planCustomerIds);
    const allUsers = hydrateUsersPermissions(value, value.prepare('SELECT * FROM sales_users ORDER BY role,name').all());
    const activeUsers = allUsers.filter(row => !row.archived_at);
    const archivedUsers = allUsers.filter(row => Boolean(row.archived_at));
    const hasManagerTaskRole = ['admin', 'manager'].includes(String(user.role || ''));
    const managerTasks = hasManagerTaskRole && hasPermission(user, 'resolve_manager_tasks')
      ? scopedManagerTasks(value, user, { limit: 100 })
      : [];
    const alerts = authorizeTodayTaskActions(
      groupAlerts(filterTodayTaskAlertsForUser([
        ...buildIntakeAlerts(value, user),
        ...buildAlerts(accounts, effectiveActivities, effectiveRfqs, effectiveQuotes, planEvents, managerTasks),
      ], user)),
      user,
    );
    const countryReport = buildCountryReport(accounts, effectiveActivities, effectiveOrders);
    const cohortReport = buildCohortReport(accounts, effectiveActivities, effectiveOrders);
    const teamReport = buildTeamReport(
      activeUsers, accounts, effectiveActivities, effectiveRfqs, effectiveQuotes, effectiveOrders,
    );
    const insights = loadInsights(value, accounts);
    const customerEvaluationTags = aiEnabled && hasPermission(user, 'view_insights') ? accounts.map(account => ({
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
    const canViewIntakeNotifications = hasPermission(user, 'view_intake');
    const intakeNotificationScope = canViewIntakeNotifications
      ? ` OR n.customer_id IN (
            SELECT external_customer_id FROM crm_intake_items WHERE assigned_owner_id=?
          )`
      : '';
    const notifications = value.prepare(`SELECT n.*,recipient.name recipient_name,
      (SELECT status FROM crm_notification_deliveries d
        WHERE d.notification_id=n.id AND d.channel='web') web_delivery_status,
      (SELECT status FROM crm_notification_deliveries d
        WHERE d.notification_id=n.id AND d.channel='wecom') wecom_delivery_status
      FROM crm_notifications n
      LEFT JOIN sales_users recipient ON recipient.id=n.user_id
      WHERE (n.user_id='' OR n.user_id=?) AND (
          n.customer_id='' OR n.customer_id IN (${placeholders})
          OR n.customer_id IN (${planPlaceholders})${intakeNotificationScope}
      )
      ORDER BY CASE status WHEN 'unread' THEN 0 ELSE 1 END,created_at DESC LIMIT 100`)
      .all(
        user.id,
        ...customerIds,
        ...planCustomerIds,
        ...(canViewIntakeNotifications ? [user.id] : []),
      )
      .filter(row => notificationVisibleForFeatures(row.code, features));
    const atLeast = stage => accounts.filter(row => hasReachedStage(row.stage, stage)).length;
    const funnel = STAGES.filter(([key]) => !['new', 'lost', 'disqualified'].includes(key)).map(([key, label]) => ({ key, label, count: atLeast(key) }));
    const wonAccounts = atLeast('won');
    const summary = {
      accounts: accounts.length,
      active: accounts.filter(row => isActivePipelineStage(row.stage)).length,
      contacted: atLeast('contacted'),
      replies: atLeast('replied'),
      meetings: atLeast('meeting'),
      rfqs: effectiveRfqs.length,
      quotes: effectiveQuotes.length,
      orders: effectiveOrders.length,
      overdue: alerts.filter(row => row.reasons.some(reason => reason.code === 'OVERDUE')).length,
      managerNeeded: alerts.filter(row => row.reasons.some(reason => reason.code === 'MANAGER_NEEDED')).length,
      revenue: effectiveOrders.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      grossProfit: Math.round(effectiveOrders.reduce((sum, row) => sum + Number(row.amount || 0) * Number(row.gross_margin || 0) / 100, 0)),
      orderRate: rate(wonAccounts, Math.max(1, effectiveRfqs.length)),
    };
    const permissions = permissionsFor(user);
    const canSeeAccounts = permissions.view_customers;
    const contactSafe = payload => permissions.view_contacts ? payload : redactContactFields(payload);
    const contactSafeAlerts = payload => permissions.view_contacts
      ? payload
      : redactContactFields(payload, { preserveAlertCopy: true });
    const timeline = canSeeAccounts
      ? contactSafe(buildCustomerTimeline(
        value, accounts, activityHistory, rfqs, quotes, orders, { includeAI: aiEnabled },
      ))
      : [];
    const intake = permissions.view_intake
      ? contactSafe(loadIntakeState(value, user, {}, { includeAI: aiEnabled }))
      : { settings: {}, stats: {}, items: [], batches: [] };
    const visibleEvaluations = aiEnabled
      ? insights.evaluations
      : insights.evaluations.map(withoutEvaluationAI);
    const managerMetrics = hasManagerTaskRole && permissions.resolve_manager_tasks
      ? buildManagerMetrics(value, {
        user,
        rangeDays: 30,
        settings: getManagerTaskSettings(value),
      })
      : null;
    const scopedResearchTotals = researchTotals(value, user, permissions);
    const notificationNavigationSummary = permissions.view_notifications
      ? listNotificationRows(value, user, { page: 'notifications', filters: [] }, {
        page: 1,
        pageSize: 50,
      }, {
        aiEnabled,
        salesPackEnabled: features.sales_pack.effectiveEnabled,
      }).summary
      : { unread: 0 };
    const recycleBinTotal = permissions.manage_customer_recycle
        || permissions.view_own_mismatch_history
      ? listRecycleRows(value, user, { page: 'recycle_bin', filters: [] }, {
        page: 1,
        pageSize: 50,
        isImpersonating: false,
      }).authorizedTotal
      : 0;
    return {
      user: safeUser(user),
      users: permissions.view_users ? activeUsers.map(safeUser) : [safeUser(user)],
      assignmentCandidates: permissions.manage_customer_recycle
        ? activeUsers
          .filter(row => row.role === 'sales' && row.active && !row.archived_at)
          .map(row => ({ id: row.id, name: row.name }))
        : [],
      todayTaskAssignmentCandidates: permissions.manage_intake
        ? activeUsers
          .filter(row => row.role === 'sales' && row.active && !row.archived_at)
          .map(row => ({ id: row.id, name: row.name }))
        : [],
      archivedUsers: permissions.view_users ? archivedUsers.map(safeUser) : [],
      ...(permissions.view_users ? { permissionGroups: listPermissionGroups(value) } : {}),
      accounts: canSeeAccounts
        ? attachCustomerStarState(value, user, contactSafe(accounts))
        : [],
      activities: canSeeAccounts ? contactSafe(activityHistory) : [],
      rfqs: canSeeAccounts ? contactSafe(rfqs) : [],
      quotes: canSeeAccounts ? contactSafe(quotes) : [],
      orders: canSeeAccounts ? contactSafe(orders) : [],
      timeline,
      alerts: permissions.view_alerts ? contactSafeAlerts(alerts) : [],
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
      researchTotals: scopedResearchTotals,
      navigationCounts: {
        customers: accounts.length,
        alerts: alerts.length,
        notificationsUnread: Number(notificationNavigationSummary.unread || 0),
        insights: visibleEvaluations.length,
        people: scopedResearchTotals.people || 0,
        recycleBin: recycleBinTotal,
      },
      auditLog: permissions.view_users ? contactSafe(auditLog) : [],
      migrationReview: permissions.view_users ? contactSafe(migrationReview) : [],
      notifications: permissions.view_notifications ? contactSafe(notifications) : [],
      managerTasks,
      managerMetrics,
      managerTaskSettings: user.role === 'admin' && permissions.manage_manager_task_settings
        ? getManagerTaskSettings(value)
        : null,
      permissionDefinitions: PERMISSION_DEFINITIONS,
      permissionDescriptions: PERMISSION_DESCRIPTIONS,
      rolePermissions: ROLE_PERMISSIONS,
      stages: STAGES.map(([key, label]) => ({ key, label })),
      customerOptions: {
        customerTypes: [...CUSTOMER_TYPE_OPTIONS],
        sources: [...CUSTOMER_SOURCE_OPTIONS],
      },
      businessTimezone: resolveBusinessTimezone(),
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

function getHistoryAccountForUser(value, user, customerId) {
  if (hasPermission(user, 'view_all_customers') && hasPermission(user, 'manage_intake')) {
    return value.prepare('SELECT * FROM crm_accounts WHERE id=?').get(customerId);
  }
  return value.prepare(`SELECT * FROM crm_accounts WHERE id=? AND (
    owner_id=?
    OR (COALESCE(lifecycle_status,'active')='recycled' AND previous_owner_id=?)
  )`).get(customerId, user.id, user.id);
}

function historyAccountSummary(account) {
  return {
    companyName: String(account.company_name || '').trim(),
    nickname: String(account.nickname || '').trim(),
    externalCustomerId: String(account.external_customer_id || ''),
    country: String(account.country || ''),
    stageLabel: STAGE_LABELS[account.stage] || account.stage || '',
    status: account.assignment_status === 'returned'
      ? '已退回线索池'
      : account.lifecycle_status === 'recycled' ? '历史客户' : 'CRM 客户',
  };
}

function buildAccountDevelopmentHistory(value, account) {
  const ownerId = String(account.owner_id || account.previous_owner_id || '');
  const ownerName = ownerId
    ? String(value.prepare('SELECT name FROM sales_users WHERE id=?').get(ownerId)?.name || '')
    : '';
  const activityHistory = publicActivityRecords(addActivityProvenance(value.prepare(`SELECT x.*,u.name user_name
    FROM crm_activities x LEFT JOIN sales_users u ON u.id=x.user_id
    WHERE x.customer_id=? AND COALESCE(x.is_test_data,0)=0 ORDER BY x.occurred_at DESC`)
    .all(account.id)));
  const rfqs = value.prepare('SELECT * FROM crm_rfqs WHERE customer_id=? ORDER BY received_at DESC').all(account.id);
  const quotes = value.prepare('SELECT * FROM crm_quotes WHERE customer_id=? ORDER BY sent_at DESC').all(account.id);
  const orders = value.prepare('SELECT * FROM crm_orders WHERE customer_id=? ORDER BY ordered_at DESC').all(account.id);
  const activityById = new Map(activityHistory.map(row => [String(row.id || ''), row]));
  const effectiveCommerce = row => !row.activity_id
    || isEffectiveActivity(activityById.get(String(row.activity_id || '')));
  const activityTimeline = buildCustomerTimeline(
    value,
    [{ ...account, owner_name: ownerName }],
    activityHistory,
    rfqs.filter(effectiveCommerce),
    quotes.filter(effectiveCommerce),
    orders.filter(effectiveCommerce),
    { includeAI: false },
  );
  const lifecycleTimeline = buildAccountHistory(value, account);
  const byId = new Map();
  [...activityTimeline, ...lifecycleTimeline].forEach(event => {
    const key = String(event.id || `${event.kind || 'event'}:${event.occurred_at || ''}`);
    byId.set(key, event);
  });
  return [...byId.values()].sort((left, right) =>
    String(right.occurred_at || '').localeCompare(String(left.occurred_at || ''))
    || String(right.id || '').localeCompare(String(left.id || ''))).slice(0, 200);
}

function canAccessCustomerMaster(value, user, externalCustomerId) {
  const cleanId = String(externalCustomerId || '').trim();
  if (!cleanId) return false;
  if (!value.prepare('SELECT 1 FROM customer_pool WHERE customer_id=?').get(cleanId)) return false;
  if (isProtectedCustomer(value, cleanId)) return false;
  if (hasPermission(user, 'view_all_customers') && hasPermission(user, 'manage_intake')) {
    return true;
  }
  const scope = accountScope(user);
  const scopeClause = scope.sql ? `AND ${scope.sql.replace(/^WHERE\s+/i, '')}` : '';
  if (value.prepare(`SELECT 1 FROM crm_accounts a
      WHERE a.external_customer_id=? ${scopeClause} LIMIT 1`)
    .get(cleanId, ...scope.params)) return true;
  if (hasPermission(user, 'manage_customer_recycle')) {
    const recycleScope = hasPermission(user, 'view_all_customers')
      ? { sql: '', params: [] }
      : { sql: 'AND (previous_owner_id=? OR recycled_by=?)', params: [user.id, user.id] };
    if (value.prepare(`SELECT 1 FROM crm_accounts
        WHERE external_customer_id=?
          AND COALESCE(lifecycle_status,'active')='recycled'
          ${recycleScope.sql} LIMIT 1`).get(cleanId, ...recycleScope.params)) return true;
  }
  if (hasPermission(user, 'manage_intake')) {
    return Boolean(value.prepare(`SELECT 1 FROM crm_intake_items
      WHERE external_customer_id=?
        AND status IN ('pending','approved','assigned','claimed','returned','rejected','duplicate')
      LIMIT 1`).get(cleanId));
  }
  return Boolean(value.prepare(`SELECT 1 FROM crm_intake_items
    WHERE external_customer_id=? AND assigned_owner_id=?
      AND status IN ('assigned','claimed','returned')
    LIMIT 1`).get(cleanId, user.id));
}

function assertCustomerMasterAccess(value, user, externalCustomerId) {
  const cleanId = String(externalCustomerId || '').trim();
  if (!cleanId) throw badRequest('缺少客户主档编号');
  const customer = value.prepare(`SELECT customer_id,company_name,nickname
    FROM customer_pool WHERE customer_id=?`).get(cleanId);
  if (!customer) {
    if (hasPermission(user, 'view_all_customers') && hasPermission(user, 'manage_intake')) {
      throw notFound('客户主档不存在');
    }
    throw forbidden('无权访问该客户');
  }
  if (!canAccessCustomerMaster(value, user, cleanId)) throw forbidden('无权访问该客户');
  return customer;
}

function recordCustomerNicknameAudit(
  value,
  user,
  identity,
  externalCustomerId,
  change,
  legacyAccountId = '',
) {
  const realUserId = identity?.realUserId || user.id;
  const effectiveUserId = identity?.effectiveUserId || user.id;
  const contextId = identity?.contextId || '';
  const createdAt = nowText();
  value.prepare(`INSERT INTO customer_nickname_audit
    (id,external_customer_id,old_nickname,new_nickname,real_user_id,
     effective_user_id,impersonation_context_id,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    id('NICKAUD'),
    externalCustomerId,
    change.oldNickname,
    change.newNickname,
    realUserId,
    effectiveUserId,
    contextId,
    createdAt,
  );
  value.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at,
     real_user_id,effective_user_id,impersonation_context_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id('AUD'),
    effectiveUserId,
    'customer_nickname_updated',
    'customer_master',
    externalCustomerId,
    JSON.stringify(redactAuditPayload(change)),
    createdAt,
    realUserId,
    effectiveUserId,
    contextId,
  );
  if (legacyAccountId) {
    value.prepare(`INSERT INTO crm_audit_log
      (id,user_id,action,entity_type,entity_id,detail_json,created_at,
       real_user_id,effective_user_id,impersonation_context_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      id('AUD'),
      effectiveUserId,
      'customer_nickname_updated',
      'crm_account',
      legacyAccountId,
      JSON.stringify(redactAuditPayload(change)),
      createdAt,
      realUserId,
      effectiveUserId,
      contextId,
    );
  }
}

function updateCustomerNickname(user, externalCustomerId, payload, identity = {}) {
  assertPermission(user, 'edit_customer');
  if (!payload || payload.nickname === undefined) throw badRequest('缺少客户昵称');
  const nickname = normalizeAccountNickname(payload?.nickname);
  const value = db();
  try {
    const customer = assertCustomerMasterAccess(value, user, externalCustomerId);
    const oldNickname = String(customer.nickname || '');
    if (nickname === oldNickname) {
      return {
        customer: {
          externalCustomerId: customer.customer_id,
          nickname,
          companyName: customer.company_name,
        },
      };
    }
    value.transaction(() => {
      try {
        assertCustomerIdentityAvailable(value, {
          externalCustomerId: customer.customer_id,
          name: nickname,
          source: 'crm_current_nickname',
          actorId: user.id,
        });
      } catch (error) {
        if (error?.code === 'CUSTOMER_IDENTITY_REVIEW_REQUIRED') {
          throw conflictError('该昵称已被其他客户使用，请更换昵称', 'CUSTOMER_NICKNAME_TAKEN');
        }
        throw error;
      }
      value.prepare('UPDATE customer_pool SET nickname=?,updated_at=? WHERE customer_id=?')
        .run(nickname, nowText(), customer.customer_id);
      recordCustomerNicknameAudit(value, user, identity, customer.customer_id, {
        oldNickname,
        newNickname: nickname,
      });
    }).immediate();
    return {
      customer: {
        externalCustomerId: customer.customer_id,
        nickname,
        companyName: customer.company_name,
      },
    };
  } finally { value.close(); }
}

function inaccessibleOrMissing(user, missingMessage) {
  const fullScope = hasPermission(user, 'view_all_customers') && hasPermission(user, 'manage_intake');
  const error = new Error(fullScope ? missingMessage : '无权访问该客户');
  error.statusCode = fullScope ? 404 : 403;
  return error;
}

function escapeActivitySearchLike(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

function searchActivityCustomers(user, query = {}) {
  assertPermission(user, 'record_activity');
  const search = String(query.q || '').trim();
  if (Array.from(search).length > 120) throw badRequest('客户搜索内容最多120个字符');
  const limit = Math.max(1, Math.min(50, Number.parseInt(query.limit, 10) || 20));
  const value = db();
  try {
    const scope = accountScope(user);
    const params = [...scope.params];
    const conditions = [];
    for (const keyword of search.toLowerCase().split(/\s+/).filter(Boolean)) {
      const like = `%${escapeActivitySearchLike(keyword)}%`;
      conditions.push(`(
        crm_search_fold(COALESCE(p.nickname,a.nickname,'')) LIKE ? ESCAPE '\\'
        OR crm_search_fold(COALESCE(NULLIF(p.company_name,''),a.company_name)) LIKE ? ESCAPE '\\'
        OR crm_search_fold(a.id) LIKE ? ESCAPE '\\'
        OR crm_search_fold(a.external_customer_id) LIKE ? ESCAPE '\\'
      )`);
      params.push(like, like, like, like);
    }
    const rows = value.prepare(`SELECT
      a.id,
      a.external_customer_id,
      COALESCE(p.nickname,a.nickname,'') nickname,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
      COALESCE(a.owner_id,'') owner_id,
      COALESCE(owner.name,'') owner_name,
      a.stage
      FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
      LEFT JOIN sales_users owner ON owner.id=a.owner_id
      ${scope.sql}
      ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}
      ORDER BY CASE WHEN TRIM(COALESCE(p.nickname,a.nickname,''))!='' THEN 0 ELSE 1 END,
        COALESCE(p.nickname,a.nickname,''),COALESCE(NULLIF(p.company_name,''),a.company_name),a.id
      LIMIT ?`).all(...params, limit);
    return {
      customers: rows.map(row => ({
        id: row.id,
        externalCustomerId: row.external_customer_id || '',
        nickname: row.nickname || '',
        companyName: row.company_name || '',
        ownerId: row.owner_id || '',
        ownerName: row.owner_name || '',
        stage: row.stage || '',
      })),
    };
  } finally { value.close(); }
}

function correctionRecipientHasScope(value, user, accountIds) {
  const scope = accountScope(user);
  return accountIds.every(accountId => Boolean(value.prepare(`SELECT 1 FROM crm_accounts a
    ${scope.sql} AND a.id=? LIMIT 1`).get(...scope.params, accountId)));
}

function enqueueActivityCorrectionNotifications(value, event = {}) {
  const source = event.source || {};
  const target = event.target || {};
  const accountIds = [String(source.id || ''), String(target.id || '')];
  if (accountIds.some(accountId => !accountId)) return [];
  const sourceStableId = String(source.external_customer_id || source.id);
  const targetStableId = String(target.external_customer_id || target.id);
  const operatorId = String(event.reviewerId || event.actorId || '');
  const operator = operatorId
    ? value.prepare('SELECT name FROM sales_users WHERE id=?').get(operatorId)
    : null;
  const operatorName = String(operator?.name || operatorId || '未知操作人');
  const reason = String(event.reason || '').trim() || '未填写更正原因';
  const users = hydrateUsersPermissions(value, value.prepare(`SELECT * FROM sales_users
    WHERE active=1 AND role IN ('admin','manager') ORDER BY role,id`).all());
  const recipients = users.filter(user => hasPermission(user, 'manage_activity_corrections')
    && correctionRecipientHasScope(value, user, accountIds)
    && String(user.id) !== String(event.actorId || '')
    && String(user.id) !== String(event.reviewerId || ''));
  const notificationType = event.decision
    ? `review_${event.decision}`
    : (event.correctionId ? 'completed' : 'review_requested');
  const title = event.decision === 'rejected'
    ? '跟进记录更正申请已拒绝'
    : (event.correctionId ? '跟进记录归属已更正' : '跟进记录更正待审批');
  return recipients.map(recipient => createActivityCorrectionNotification(value, {
    ...(event.correctionId
      ? { correctionId: event.correctionId }
      : { proposalId: event.proposalId }),
    recipientId: recipient.id,
    notificationType,
    sourceCustomerId: sourceStableId,
    targetCustomerId: targetStableId,
    code: event.correctionId ? 'ACTIVITY_CORRECTION_COMPLETED' : 'ACTIVITY_CORRECTION_REVIEW',
    severity: event.decision === 'rejected' ? 'warning' : 'info',
    title,
    detail: `操作人：${operatorName}；来源客户：${sourceStableId}；目标客户：${targetStableId}；更正原因：${reason}`,
  }, { at: event.at }));
}

function assertActivityCorrectionQuery(query = {}, options = {}) {
  const allowed = new Set([
    'page', 'pageSize', 'page_size', 'permissionVersion', 'filters',
    ...(options.allowExclude ? ['excludeCustomerId'] : []),
  ]);
  if (Object.keys(query).some(key => !allowed.has(key))) {
    throw httpError(403, '筛选条件未获授权', 'FILTER_NOT_AUTHORIZED');
  }
}

function publicActivityReaction(row) {
  return {
    id: row.id,
    name: row.name,
    actionQueueKey: row.action_queue_key || '',
    sortOrder: Number(row.sort_order || 0),
    active: Boolean(row.active),
  };
}

function normalizeActivityActionQueueKey(value) {
  const key = String(value || '').trim();
  if (!PIPELINE_ACTION_QUEUE_KEYS.has(key)) throw badRequest('请选择有效的行动队列');
  return key;
}

function scopedActivityProvenance(row, visibleActivityIds) {
  const provenance = row.provenance ? { ...row.provenance } : null;
  if (!provenance) return null;
  if (provenance.kind === 'superseded_original') {
    const replacementId = String(provenance.replacementActivityId || row.superseded_by || '');
    if (replacementId && !visibleActivityIds.has(replacementId)) {
      provenance.replacementActivityId = '';
      provenance.replacementCustomerId = '';
    }
  }
  if (provenance.kind === 'replacement') {
    const originalId = String(provenance.originalActivityId || '');
    if (originalId && !visibleActivityIds.has(originalId)) {
      provenance.originalActivityId = '';
      provenance.originalCustomerId = '';
    }
  }
  return provenance;
}

function publicActivityRecord(row, visibleActivityIds = new Set()) {
  const {
    superseded_by: _supersededBy,
    provenance: _provenance,
    ...publicRow
  } = row;
  const replacementId = String(row.superseded_by || '');
  const replacementVisible = !replacementId || visibleActivityIds.has(replacementId);
  return {
    ...publicRow,
    externalCustomerId: row.external_customer_id || '',
    progressType: row.progress_key || legacyProgressKey(row.activity_type, row.channel) || '',
    activityType: row.activity_type || '',
    reactionOptionId: row.reaction_option_id || '',
    reactionSnapshot: row.reaction_label_snapshot || row.outcome || '',
    nextAction: row.next_action || '',
    nextActionAt: row.next_action_at || '',
    managerRequired: Boolean(row.manager_required),
    noPlan: Boolean(row.no_plan),
    supersededAt: row.superseded_at || '',
    supersededBy: replacementVisible ? replacementId : '',
    effective: isEffectiveActivity(row),
    provenance: scopedActivityProvenance(row, visibleActivityIds),
  };
}

function publicActivityRecords(rows) {
  const visibleActivityIds = new Set(rows.map(row => String(row.id || '')).filter(Boolean));
  return rows.map(row => publicActivityRecord(row, visibleActivityIds));
}

function assertActivityReactionAdmin(user) {
  if (user?.role !== 'admin') throw forbidden('只有管理员可以管理客户反应选项');
}

function listActivityReactions(user, { includeInactive = false } = {}) {
  if (includeInactive) assertActivityReactionAdmin(user);
  else assertPermission(user, 'record_activity');
  const value = db();
  try {
    const rows = value.prepare(`SELECT * FROM crm_activity_reaction_options
      ${includeInactive ? '' : 'WHERE active=1'}
      ORDER BY active DESC,sort_order,id`).all();
    return { reactions: rows.map(publicActivityReaction) };
  } finally { value.close(); }
}

function writeActivityReactionAudit(value, actor, identity, action, reactionId, detail) {
  const realUserId = identity?.realUserId || actor.id;
  const effectiveUserId = identity?.effectiveUserId || actor.id;
  value.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at,
     real_user_id,effective_user_id,impersonation_context_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id('AUD'),
    effectiveUserId,
    action,
    'activity_reaction_option',
    reactionId,
    JSON.stringify(redactAuditPayload(detail)),
    nowText(),
    realUserId,
    effectiveUserId,
    identity?.contextId || '',
  );
}

function assertUniqueActiveReaction(value, nameKey, excludedId = '') {
  const duplicate = value.prepare(`SELECT id FROM crm_activity_reaction_options
    WHERE active=1 AND name_key=? AND id!=? LIMIT 1`).get(nameKey, excludedId);
  if (duplicate) throw conflictError('客户反应名称已存在', 'ACTIVITY_REACTION_DUPLICATE');
}

function createActivityReaction(actor, payload, identity = {}) {
  assertActivityReactionAdmin(actor);
  const name = normalizeActivityReactionName(payload?.name);
  const nameKey = activityReactionNameKey(name);
  const actionQueueKey = normalizeActivityActionQueueKey(payload?.actionQueueKey);
  const value = db();
  try {
    return value.transaction(() => {
      assertUniqueActiveReaction(value, nameKey);
      const reactionId = `REACTION-${crypto.randomUUID()}`;
      const sortOrder = Number(value.prepare(`SELECT COALESCE(MAX(sort_order),-1)+1 next_sort
        FROM crm_activity_reaction_options WHERE active=1`).get().next_sort || 0);
      const at = nowText();
      value.prepare(`INSERT INTO crm_activity_reaction_options
        (id,name,name_key,sort_order,action_queue_key,active,created_by,updated_by,created_at,updated_at)
        VALUES (?,?,?,?,?,1,?,?,?,?)`).run(
        reactionId, name, nameKey, sortOrder, actionQueueKey, actor.id, actor.id, at, at,
      );
      writeActivityReactionAudit(value, actor, identity, 'activity_reaction_created', reactionId, {
        name, sortOrder, actionQueueKey,
      });
      return { reaction: publicActivityReaction(value.prepare(
        'SELECT * FROM crm_activity_reaction_options WHERE id=?',
      ).get(reactionId)) };
    }).immediate();
  } finally { value.close(); }
}

function renameActivityReaction(actor, reactionId, payload, identity = {}) {
  assertActivityReactionAdmin(actor);
  const name = normalizeActivityReactionName(payload?.name);
  const nameKey = activityReactionNameKey(name);
  const cleanId = String(reactionId || '').trim();
  const value = db();
  try {
    return value.transaction(() => {
      const current = value.prepare(`SELECT * FROM crm_activity_reaction_options
        WHERE id=? AND active=1`).get(cleanId);
      if (!current) throw notFound('客户反应选项不存在或已移除');
      const actionQueueKey = payload?.actionQueueKey === undefined
        ? String(current.action_queue_key || '')
        : normalizeActivityActionQueueKey(payload.actionQueueKey);
      assertUniqueActiveReaction(value, nameKey, cleanId);
      if (current.name === name && String(current.action_queue_key || '') === actionQueueKey) {
        return { reaction: publicActivityReaction(current), unchanged: true };
      }
      value.prepare(`UPDATE crm_activity_reaction_options
        SET name=?,name_key=?,action_queue_key=?,updated_by=?,updated_at=? WHERE id=? AND active=1`)
        .run(name, nameKey, actionQueueKey, actor.id, nowText(), cleanId);
      writeActivityReactionAudit(value, actor, identity, 'activity_reaction_renamed', cleanId, {
        oldName: current.name, newName: name,
        oldActionQueueKey: current.action_queue_key || '', actionQueueKey,
      });
      return { reaction: publicActivityReaction(value.prepare(
        'SELECT * FROM crm_activity_reaction_options WHERE id=?',
      ).get(cleanId)), unchanged: false };
    }).immediate();
  } finally { value.close(); }
}

function reorderActivityReactions(actor, payload, identity = {}) {
  assertActivityReactionAdmin(actor);
  if (!Array.isArray(payload?.ids)) throw badRequest('客户反应排序必须提供完整ID数组');
  const ids = payload.ids.map(item => String(item || '').trim());
  if (ids.some(item => !item) || new Set(ids).size !== ids.length) {
    throw badRequest('客户反应排序ID不能为空或重复');
  }
  const value = db();
  try {
    return value.transaction(() => {
      const active = value.prepare(`SELECT id FROM crm_activity_reaction_options
        WHERE active=1 ORDER BY sort_order,id`).all().map(row => row.id);
      if (active.length !== ids.length || active.some(reactionId => !ids.includes(reactionId))) {
        throw badRequest('客户反应选项已变化，请刷新后重试');
      }
      const update = value.prepare(`UPDATE crm_activity_reaction_options
        SET sort_order=?,updated_by=?,updated_at=? WHERE id=? AND active=1`);
      ids.forEach((reactionId, index) => update.run(
        index, actor.id, nowText(), reactionId,
      ));
      writeActivityReactionAudit(value, actor, identity, 'activity_reaction_reordered', '', {
        before: active, after: ids,
      });
      return {
        reactions: value.prepare(`SELECT * FROM crm_activity_reaction_options
          WHERE active=1 ORDER BY sort_order,id`).all().map(publicActivityReaction),
      };
    }).immediate();
  } finally { value.close(); }
}

function removeActivityReaction(actor, reactionId, identity = {}) {
  assertActivityReactionAdmin(actor);
  const cleanId = String(reactionId || '').trim();
  const value = db();
  try {
    return value.transaction(() => {
      const current = value.prepare(`SELECT * FROM crm_activity_reaction_options
        WHERE id=?`).get(cleanId);
      if (!current) throw notFound('客户反应选项不存在');
      if (!current.active) return { reaction: publicActivityReaction(current), removed: false };
      const at = nowText();
      value.prepare(`UPDATE crm_activity_reaction_options
        SET active=0,removed_at=?,updated_by=?,updated_at=? WHERE id=? AND active=1`)
        .run(at, actor.id, at, cleanId);
      writeActivityReactionAudit(value, actor, identity, 'activity_reaction_removed', cleanId, {
        name: current.name, sortOrder: current.sort_order,
      });
      return {
        reaction: publicActivityReaction(value.prepare(
          'SELECT * FROM crm_activity_reaction_options WHERE id=?',
        ).get(cleanId)),
        removed: true,
      };
    }).immediate();
  } finally { value.close(); }
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

function legacyProgressKey(activityType, channel) {
  if (activityType !== 'social') return activityType;
  return {
    WhatsApp: 'whatsapp',
    Telegram: 'telegram',
    LinkedIn: 'linkedin',
  }[channel] || 'social';
}

function resolveActivityRequestSpec(payload = {}) {
  const requestedProgressType = String(payload.progressType || '').trim().toLowerCase();
  if (requestedProgressType) {
    const progress = PROGRESS_TYPE_MAP[requestedProgressType];
    if (!progress) throw badRequest('不支持的本次进展类型');
    return {
      progressKey: requestedProgressType,
      activityType: progress.activityType,
      channel: progress.channel,
      proposedStage: progress.stage,
      legacy: false,
    };
  }
  const activityType = String(payload.activityType || '').trim();
  if (!LEGACY_ACTIVITY_TYPES.has(activityType)) throw badRequest('请选择有效的本次进展');
  const channel = String(payload.channel || '').trim();
  if (!LEGACY_ACTIVITY_CHANNELS.has(channel)) throw badRequest('不支持的进展渠道');
  return {
    progressKey: legacyProgressKey(activityType, channel),
    activityType,
    channel,
    proposedStage: ACTIVITY_STAGE[activityType] || '',
    legacy: true,
  };
}

function strictManagerRequired(value) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw badRequest('经理协助状态必须是布尔值');
  return value;
}

function resolveActivityReaction(value, payload = {}) {
  const reactionOptionId = String(payload.reactionOptionId || '').trim();
  const legacyOutcome = String(payload.outcome || '').trim();
  const customReaction = String(payload.reactionCustom || '').trim();
  if (customReaction) {
    if (reactionOptionId || legacyOutcome) throw badRequest('自定义客户反应不能与标准选项同时提交');
    return { id: '', name: normalizeActivityReactionName(customReaction) };
  }
  let reaction;
  if (reactionOptionId) {
    reaction = value.prepare(`SELECT * FROM crm_activity_reaction_options
      WHERE id=? AND active=1`).get(reactionOptionId);
    if (!reaction) {
      throw conflictError('客户反应选项已失效，请刷新后重试', 'ACTIVITY_REACTION_STALE');
    }
  }
  if (legacyOutcome) {
    const nameKey = activityReactionNameKey(legacyOutcome);
    const matched = value.prepare(`SELECT * FROM crm_activity_reaction_options
      WHERE name_key=? AND active=1`).get(nameKey);
    if (!matched) throw badRequest('请选择有效的客户反应');
    if (reaction && reaction.id !== matched.id) throw badRequest('客户反应选项与文字不一致');
    reaction = matched;
  }
  return reaction
    ? { id: reaction.id, name: reaction.name }
    : { id: '', name: '' };
}

function activityActionRequest(value, user, payload, customerId) {
  const requested = String(
    payload.idempotencyKey || (payload.proposalJobId ? `proposal:${payload.proposalJobId}` : ''),
  ).trim().slice(0, 240);
  if (!requested) return null;
  const canonical = {
    customerId,
    progressType: String(payload.progressType || ''),
    activityType: String(payload.activityType || ''),
    channel: String(payload.channel || ''),
    reactionOptionId: String(payload.reactionOptionId || ''),
    reactionCustom: String(payload.reactionCustom || ''),
    outcome: String(payload.outcome || ''),
    summary: String(payload.summary || ''),
    nextAction: String(payload.nextAction || ''),
    nextActionAt: String(payload.nextActionAt || ''),
    occurredAt: String(payload.occurredAt || ''),
    managerRequired: Boolean(payload.managerRequired),
    noPlan: Boolean(payload.noPlan),
    reference: String(payload.reference || ''),
    bomLines: String(payload.bomLines || ''),
    expectedValue: String(payload.expectedValue || ''),
    productCategory: String(payload.productCategory || ''),
    completeness: String(payload.completeness || ''),
    proposalJobId: String(payload.proposalJobId || ''),
  };
  const requestHash = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  let existing = value.prepare(
    'SELECT * FROM crm_activity_action_requests WHERE idempotency_key=?',
  ).get(requested);
  if (!existing) {
    const at = nowText();
    const inserted = value.prepare(`INSERT OR IGNORE INTO crm_activity_action_requests
      (idempotency_key,actor_id,customer_id,request_hash,status,response_json,created_at,updated_at)
      VALUES (?,?,?,?,'started','{}',?,?)`)
      .run(requested, user.id, customerId, requestHash, at, at);
    if (inserted.changes === 1) return { key: requested, replay: null };
    existing = value.prepare(
      'SELECT * FROM crm_activity_action_requests WHERE idempotency_key=?',
    ).get(requested);
  }
  if (existing.actor_id !== user.id || existing.customer_id !== customerId
      || existing.request_hash !== requestHash) {
    throw conflictError('幂等键已绑定其他进展记录', 'ACTIVITY_IDEMPOTENCY_CONFLICT');
  }
  if (existing.status === 'completed') {
    return {
      key: requested,
      replay: { ...json(existing.response_json, {}), deduplicated: true },
    };
  }
  throw conflictError('相同进展记录正在处理中', 'ACTIVITY_ACTION_IN_PROGRESS');
}

function completeActivityAction(value, reservation, response) {
  if (!reservation?.key) return;
  value.prepare(`UPDATE crm_activity_action_requests
    SET status='completed',response_json=?,updated_at=?
    WHERE idempotency_key=? AND status='started'`)
    .run(JSON.stringify(response), nowText(), reservation.key);
}

function addActivity(user, payload, options = {}) {
  assertPermission(user, 'record_activity');
  const value = db();
  try {
    const aiEnabled = featureState(value, options.hardFlags || resolveAIHardFlags())
      .ai_stations.effectiveEnabled;
    if (payload.proposalJobId && !aiEnabled) throw aiFeatureDisabled();
    const spec = resolveActivityRequestSpec(payload);
    if (spec.activityType === 'manager_join') {
      throw todayTaskError(
        409,
        '请从今日待办完成管理者协助',
        'TODAY_TASK_ACTION_REQUIRED',
      );
    }
    const stopsFollowUp = spec.activityType === 'lost';
    const noPlan = Boolean(payload.noPlan);
    const managerRequired = strictManagerRequired(payload.managerRequired);
    const nextAction = stopsFollowUp || noPlan ? '' : String(payload.nextAction || '').trim();
    const nextActionAt = stopsFollowUp || noPlan
      ? ''
      : (payload.nextActionAt ? parseBusinessDateTime(payload.nextActionAt) : '');
    if (!stopsFollowUp && !noPlan && !managerRequired && Boolean(nextAction) !== Boolean(nextActionAt)) {
      throw badRequest('下一步计划和计划时间必须同时填写');
    }
    const occurredAt = String(payload.occurredAt || nowText());
    const activityId = id('ACT');
    const rfqId = spec.activityType === 'rfq' ? id('RFQ') : '';
    if (noPlan && !String(payload.summary || '').trim()) {
      throw badRequest('暂无计划必须填写原因');
    }
    if (managerRequired && !String(payload.summary || '').trim()) {
      throw badRequest('请求主管协助必须填写申请原因');
    }
    const transaction = value.transaction(() => {
      const account = getAccountForUser(value, user, String(payload.customerId || ''));
      const assistanceContacts = managerRequired
        ? value.prepare(`SELECT name,title,department,match_status FROM crm_account_contacts
            WHERE customer_id=? AND COALESCE(archived_at,'')=''
            ORDER BY created_at ASC,id ASC`).all(account.id)
          .map(row => ({
            name: String(row.name || '').trim(),
            title: String(row.title || '').trim(),
            department: String(row.department || '').trim(),
            matchStatus: String(row.match_status || 'pending'),
          }))
        : [];
      const reservation = activityActionRequest(value, user, payload, account.id);
      if (reservation?.replay) return reservation.replay;
      const reaction = resolveActivityReaction(value, payload);
      const preparedProposal = prepareActionProposalConfirmation(value, {
        jobId: payload.proposalJobId,
        actorId: user.id,
        crmAccountId: account.id,
        confirmed: {
          ...payload,
          activityType: spec.activityType,
          channel: spec.channel,
          outcome: reaction.name,
        },
      });
      if (preparedProposal?.existing) {
        const existing = value.prepare(`SELECT id,customer_id,progress_key,stage_before,stage_after,
          reaction_option_id,reaction_label_snapshot FROM crm_activities WHERE id=?`)
          .get(preparedProposal.activityId);
        const replay = {
          activityId: preparedProposal.activityId,
          deduplicated: true,
          stageBefore: existing?.stage_before || account.stage,
          stageAfter: existing?.stage_after || account.stage,
          stageChanged: (existing?.stage_before || account.stage)
            !== (existing?.stage_after || account.stage),
          progressType: existing?.progress_key || spec.progressKey,
          reactionOptionId: existing?.reaction_option_id || '',
          reactionLabelSnapshot: existing?.reaction_label_snapshot || '',
          customerId: existing?.customer_id || account.id,
        };
        completeActivityAction(value, reservation, replay);
        return replay;
      }
      if (spec.activityType === 'rfq') validateRfqPayload(payload);
      const nextStage = advanceStage(account.stage, spec.proposedStage);
      const terminal = ['lost', 'disqualified'].includes(nextStage);
      if (['lost', 'disqualified'].includes(account.stage)
          && isActivePipelineStage(nextStage)
          && !noPlan && (!nextAction || !nextActionAt)) {
        throw badRequest('重新激活客户必须填写下一步计划和计划时间');
      }
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,
         stage_before,stage_after,manager_required,progress_key,reaction_option_id,reaction_label_snapshot,
         occurred_at,created_at,no_plan)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        activityId, account.id, user.id, spec.activityType, spec.channel, reaction.name,
        String(payload.summary || ''), terminal ? '' : nextAction, terminal ? '' : nextActionAt,
        account.stage, nextStage, managerRequired ? 1 : 0, spec.progressKey, reaction.id, reaction.name,
        occurredAt, nowText(), noPlan ? 1 : 0,
      );
      const updatedAt = nowText();
      applyAccountStatePatch(value, account.id, { stage: nextStage, updatedAt });
      const planNextAction = managerRequired
        ? String(account.next_action || '')
        : (terminal ? '' : nextAction);
      const planNextActionAt = managerRequired
        ? String(account.next_action_at || '')
        : (terminal ? '' : nextActionAt);
      const planTimeBasis = managerRequired
        ? String(account.next_action_time_basis || '')
        : (terminal || !nextActionAt ? '' : 'utc');
      applyAccountPlanPatch(value, account.id, {
        nextAction: planNextAction,
        nextActionAt: planNextActionAt,
        timeBasis: planTimeBasis,
        updatedAt,
      });
      if (managerRequired) {
        applyManagerStatusPatch(value, account.id, {
          required: 1,
          status: '待介入',
          updatedAt,
        });
      }
      value.prepare(`UPDATE crm_accounts SET last_activity_at=? WHERE id=?`)
        .run(occurredAt, account.id);
      if (managerRequired) {
        const assistanceTask = upsertManagerTask(value, {
          idempotencyKey: `manager-assistance:${activityId}`,
          customerId: account.external_customer_id || account.id,
          reason: 'manager_assistance',
          actorIdSnapshot: user.id,
          ownerIdSnapshot: account.owner_id || '',
          recipientIds: managerAssistanceRecipientIds(value, account),
          evidence: {
            activityId,
            requestReason: String(payload.summary || ''),
            originalPlan: terminal ? '' : nextAction,
            contacts: assistanceContacts,
            requestedAt: occurredAt,
            nextAction: terminal ? '' : nextAction,
            nextActionAt: terminal ? '' : nextActionAt,
            progressType: spec.progressKey,
            dueAt: dateOffset(3),
          },
          evaluatedAt: occurredAt,
          triggeredAt: occurredAt,
          dueAt: dateOffset(3),
          createdAt: nowText(),
        });
        notifyManagerTaskRecipients(value, assistanceTask, account);
      }
      if (!terminal && nextAction && nextActionAt) {
        recordExplicitPlanIfEnabled(
          value, account, user.id, nextAction, nextActionAt, 'activity', activityId,
        );
      }
      if (spec.activityType === 'rfq') {
        value.prepare(`INSERT INTO crm_rfqs
          (id,customer_id,user_id,activity_id,reference,status,bom_lines,expected_value,product_category,completeness,received_at,quoted_at,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          rfqId, account.id, user.id, activityId, String(payload.reference || ''), 'open', Number(payload.bomLines || 0),
          Number(payload.expectedValue || 0), String(payload.productCategory || ''), Number(payload.completeness || 0),
          occurredAt, '', nowText(),
        );
        linkCommerceActivity(value, { activityId, entityType: 'rfq', entityId: rfqId });
      }
      if (spec.activityType === 'manager_join') {
        applyManagerStatusPatch(value, account.id, {
          required: 0,
          status: '已介入',
          managerId: user.role === 'sales' ? account.manager_id : user.id,
          updatedAt: nowText(),
        });
      }
      if (spec.activityType === 'lost') {
        applyAccountPlanPatch(value, account.id, {
          nextAction: '',
          nextActionAt: '',
          timeBasis: '',
        });
        value.prepare(`UPDATE crm_accounts SET loss_reason=? WHERE id=?`)
          .run(reaction.name || String(payload.summary || '未说明'), account.id);
      }
      if (preparedProposal) {
        confirmActionProposal(value, preparedProposal, {
          activityId,
          actorId: user.id,
        });
      }
      const response = {
        activityId,
        customerId: account.id,
        deduplicated: false,
        stageBefore: account.stage,
        stageAfter: nextStage,
        stageChanged: account.stage !== nextStage,
        progressType: spec.progressKey,
        reactionOptionId: reaction.id,
        reactionLabelSnapshot: reaction.name,
        noPlan,
      };
      completeActivityAction(value, reservation, response);
      return response;
    });
    const saved = transaction.immediate();
    if (saved.deduplicated) return { ...saved, nextActionJobId: '' };
    const currentAccount = value.prepare('SELECT * FROM crm_accounts WHERE id=?').get(saved.customerId);
    if (noPlan) {
      try { notifyNoPlanStreak(value, currentAccount); } catch (_error) { /* 进展已保存，提醒失败不阻塞业务 */ }
    }
    const nextActionJobId = spec.activityType === 'lost' ? '' : enqueueNextActionForEvent(
      value, user, currentAccount,
      spec.activityType === 'rfq' ? 'rfq_received' : 'activity_recorded', activityId, options,
    );
    return { ...saved, nextActionJobId };
  } finally { value.close(); }
}

function planOnlyActivity(user, payload, identity = {}) {
  assertPermission(user, 'view_alerts');
  assertPermission(user, 'record_activity');
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 240) throw badRequest('必须提供有效的幂等键');
  const nextAction = String(payload.nextAction || '').trim();
  if (!nextAction) throw badRequest('下一步动作不能为空');
  if (Array.from(nextAction).length > 1000) throw badRequest('下一步动作最多1000个字符');
  const nextActionAt = normalizeTodayTaskDate(payload.nextActionAt);
  const note = String(payload.note || '').trim().slice(0, 1000);
  const value = db();
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const canonical = { customerId: account.id, nextAction, nextActionAt, note, idempotencyKey };
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    const changedAt = nowText();
    const existing = value.prepare(
      'SELECT * FROM crm_plan_only_action_requests WHERE idempotency_key=?',
    ).get(idempotencyKey);
    if (existing) {
      if (existing.actor_id !== user.id || existing.customer_id !== account.id
          || existing.request_hash !== requestHash) {
        throw conflictError('幂等键已绑定其他计划保存', 'PLAN_ONLY_IDEMPOTENCY_CONFLICT');
      }
      if (existing.status === 'completed') {
        return { ...json(existing.response_json, {}), deduplicated: true };
      }
      throw conflictError('相同计划保存正在处理中', 'PLAN_ONLY_IN_PROGRESS');
    }
    value.prepare(`INSERT INTO crm_plan_only_action_requests
      (idempotency_key,actor_id,customer_id,request_hash,status,response_json,created_at,updated_at)
      VALUES (?,?,?,?,'started','{}',?,?)`)
      .run(idempotencyKey, user.id, account.id, requestHash, changedAt, changedAt);
    applyAccountPlanPatch(value, account.id, {
      nextAction,
      nextActionAt,
      timeBasis: PLAN_TIME_BASIS,
      updatedAt: changedAt,
    });
    recordExplicitPlanIfEnabled(value, account, user.id, nextAction, nextActionAt, 'plan_only', idempotencyKey);
    recordTodayTaskAudit(
      value, user, identity, 'activity_plan_only_saved', 'crm_account', account.id,
      { note, nextAction, nextActionAt, changedAt },
    );
    const response = { customerId: account.id, nextAction, nextActionAt, deduplicated: false };
    value.prepare(`UPDATE crm_plan_only_action_requests
      SET status='completed',response_json=?,updated_at=? WHERE idempotency_key=?`)
      .run(JSON.stringify(response), nowText(), idempotencyKey);
    return response;
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
    const nextFollowAt = parseBusinessDateTime(payload.nextFollowAt);
    const sentAt = String(payload.sentAt || nowText());
    const rfq = payload.rfqId ? value.prepare('SELECT * FROM crm_rfqs WHERE id=? AND customer_id=?').get(payload.rfqId, account.id)
      : value.prepare('SELECT * FROM crm_rfqs WHERE customer_id=? ORDER BY received_at DESC LIMIT 1').get(account.id);
    if (!rfq) throw new Error('请先记录客户询价');
    reservation = reserveCommerceAction(value, user, 'quote', payload, account.id);
    if (reservation.replay) return reservation.replay;
    const quoteStageIndex = STAGE_INDEX[String(account.stage || '').trim()];
    if (quoteStageIndex === undefined || quoteStageIndex > STAGE_INDEX.quoted) {
      throw conflictError('客户当前阶段不可记录报价', 'STAGE_PRECONDITION_VIOLATION');
    }
    const quoteId = id('Q');
    const activityId = id('ACT');
    const transaction = value.transaction(() => {
      value.prepare(`INSERT INTO crm_quotes
        (id,rfq_id,customer_id,user_id,activity_id,amount,currency,gross_margin,loss_leader,status,sent_at,next_follow_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        quoteId, rfq.id, account.id, user.id, activityId, amount, currency,
        grossMargin, payload.lossLeader ? 1 : 0, 'sent', sentAt, nextFollowAt, nowText(),
      );
      value.prepare('UPDATE crm_rfqs SET status=\'quoted\',quoted_at=? WHERE id=?').run(sentAt, rfq.id);
      const updatedAt = nowText();
      applyAccountStatePatch(value, account.id, { stage: 'quoted', updatedAt });
      applyAccountPlanPatch(value, account.id, {
        nextAction: '报价后跟进',
        nextActionAt: nextFollowAt,
        timeBasis: PLAN_TIME_BASIS,
        updatedAt,
      });
      value.prepare(`UPDATE crm_accounts SET last_activity_at=? WHERE id=?`)
        .run(sentAt, account.id);
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        activityId, account.id, user.id, 'quote', 'email', '已发送',
        `报价 ${Number(payload.amount || 0).toLocaleString()} ${String(payload.currency || 'USD')}${payload.lossLeader ? ' · 首单引流价' : ''}`,
        '报价后跟进', nextFollowAt, 'quoted', 0, sentAt, nowText(),
      );
      linkCommerceActivity(value, { activityId, entityType: 'quote', entityId: quoteId });
      recordExplicitPlanIfEnabled(
        value, account, user.id, '报价后跟进', nextFollowAt, 'quote', quoteId,
      );
    });
    transaction();
    const currentAccount = value.prepare('SELECT * FROM crm_accounts WHERE id=?').get(account.id);
    const nextActionJobId = enqueueNextActionForEvent(
      value, user, currentAccount, 'quote_sent', quoteId, options,
    );
    const response = { quoteId, activityId, nextActionJobId };
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
    const nextActionAt = parseBusinessDateTime(payload.nextActionAt);
    const quoteId = String(payload.quoteId || '').trim();
    if (!quoteId) throw new Error('订单必须关联已有报价');
    const quote = value.prepare('SELECT * FROM crm_quotes WHERE id=? AND customer_id=?').get(quoteId, account.id);
    if (!quote) throw new Error('订单关联的报价不存在或不属于该客户');
    reservation = reserveCommerceAction(value, user, 'order', payload, account.id);
    if (reservation.replay) return reservation.replay;
    const repeat = Boolean(payload.isRepeat);
    if (!repeat) {
      const orderStageIndex = STAGE_INDEX[String(account.stage || '').trim()];
      if (orderStageIndex === undefined || orderStageIndex > STAGE_INDEX.won) {
        throw conflictError('客户当前阶段不可记录首单', 'STAGE_PRECONDITION_VIOLATION');
      }
    }
    const orderedAt = String(payload.orderedAt || nowText());
    const orderId = id('ORD');
    const activityId = id('ACT');
    const transaction = value.transaction(() => {
      value.prepare(`INSERT INTO crm_orders
        (id,customer_id,quote_id,user_id,activity_id,amount,currency,gross_margin,is_repeat,ordered_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(orderId, account.id, quoteId, user.id, activityId, amount, currency, grossMargin, repeat ? 1 : 0, orderedAt, nowText());
      const updatedAt = nowText();
      applyAccountStatePatch(value, account.id, { stage: repeat ? 'repeat' : 'won', updatedAt });
      applyAccountPlanPatch(value, account.id, {
        nextAction: repeat ? '维护复购关系' : '首单交付与复购培育',
        nextActionAt,
        timeBasis: PLAN_TIME_BASIS,
        updatedAt,
      });
      value.prepare(`UPDATE crm_accounts SET last_activity_at=? WHERE id=?`)
        .run(orderedAt, account.id);
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        activityId, account.id, user.id, repeat ? 'repeat_order' : 'order', 'business', repeat ? '复购' : '首单',
        `订单 ${Number(payload.amount || 0).toLocaleString()} ${String(payload.currency || 'USD')}`,
        repeat ? '维护复购关系' : '首单交付与复购培育', nextActionAt, repeat ? 'repeat' : 'won', 0, orderedAt, nowText(),
      );
      linkCommerceActivity(value, { activityId, entityType: 'order', entityId: orderId });
      recordExplicitPlanIfEnabled(
        value,
        account,
        user.id,
        repeat ? '维护复购关系' : '首单交付与复购培育',
        nextActionAt,
        'order',
        orderId,
      );
    });
    transaction();
    const response = { orderId, activityId };
    completeCommerceAction(value, reservation.key, response);
    return response;
  } catch (error) {
    if (reservation?.key) clearCommerceActionReservation(value, reservation.key);
    throw error;
  } finally { value.close(); }
}

function duplicateFingerprint(input = {}, ruleVersion = DUPLICATE_RULE_VERSION) {
  let domain = '';
  try {
    domain = ruleVersion === DUPLICATE_RULE_VERSION
      ? canonicalDomain(input.website)
      : canonicalHostname(input.website);
  } catch (_error) {}
  const identity = {
    companyName: normalizeCompanyName(input.companyName),
    domain,
    country: normalizeCountry(input.country),
  };
  // Legacy approvals retain their original fingerprint contract; v2 approvals bind every fuzzy gate field.
  if (ruleVersion === DUPLICATE_RULE_VERSION) Object.assign(identity, {
    city: normalizeCompanyName(input.city),
    industry: normalizeCompanyName(input.industry),
    customerType: normalizeCompanyName(input.customerType),
    aliases: [input.nickname, input.russianName, input.englishName]
      .concat(Array.isArray(input.aliases) ? input.aliases : [])
      .map(normalizeCompanyName).filter(Boolean).sort(),
  });
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function customerCreateRequestHash(user, payload = {}) {
  const copy = { ...payload };
  delete copy.idempotencyKey;
  return crypto.createHash('sha256').update(JSON.stringify({ actorId: user.id, payload: copy })).digest('hex');
}

function reserveCustomerCreate(value, user, payload = {}) {
  const key = String(payload.idempotencyKey || '').trim().slice(0, 240);
  if (!key) return { key: '', replay: null };
  const requestHash = customerCreateRequestHash(user, payload);
  let existing = value.prepare('SELECT * FROM crm_customer_create_requests WHERE idempotency_key=?').get(key);
  if (!existing) {
    const inserted = value.prepare(`INSERT OR IGNORE INTO crm_customer_create_requests
      (idempotency_key,actor_id,request_hash,status,response_json,created_at,updated_at)
      VALUES (?,?,?,'started','{}',?,?)`).run(key, user.id, requestHash, nowText(), nowText());
    if (inserted.changes === 1) return { key, replay: null };
    existing = value.prepare('SELECT * FROM crm_customer_create_requests WHERE idempotency_key=?').get(key);
  }
  if (existing.actor_id !== user.id || existing.request_hash !== requestHash) {
    throw conflictError('幂等键已绑定其他新增客户操作', 'CUSTOMER_CREATE_IDEMPOTENCY_CONFLICT');
  }
  if (existing.status === 'completed') {
    return { key, replay: { ...json(existing.response_json, {}), deduplicated: true } };
  }
  throw conflictError('相同新增客户操作正在处理', 'CUSTOMER_CREATE_IN_PROGRESS');
}

function completeCustomerCreate(value, key, response) {
  if (!key) return response;
  value.prepare(`UPDATE crm_customer_create_requests
    SET status='completed',response_json=?,updated_at=? WHERE idempotency_key=? AND status='started'`)
    .run(JSON.stringify(response), nowText(), key);
  return response;
}

function clearCustomerCreateReservation(value, key) {
  if (!key) return;
  value.prepare("DELETE FROM crm_customer_create_requests WHERE idempotency_key=? AND status='started'").run(key);
}

function recordDuplicateAudit(value, actor, action, entityId, detail = {}, identity = {}) {
  const actorId = typeof actor === 'string' ? actor : actor?.id || '';
  const realUserId = identity.realUserId || actorId;
  const effectiveUserId = identity.effectiveUserId || actorId;
  value.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at,
     real_user_id,effective_user_id,impersonation_context_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id('AUD'), effectiveUserId, action, 'duplicate_review', entityId || '',
    JSON.stringify(redactAuditPayload(detail)), nowText(), realUserId, effectiveUserId,
    identity.contextId || '',
  );
}

function identityConflictNote(input) {
  if (typeof input === 'string') return input.trim();
  if (input && typeof input === 'object' && !Array.isArray(input)
      && typeof input.reason === 'string') return input.reason.trim();
  return '';
}

// Writes one timeline note on the linked master after a link_existing resolution.
// The master's stage/owner/next_action are left untouched; only a crm_activities
// row is appended.
function recordIdentityLinkTimeline(value, user, { leadExternalCustomerId, masterExternalCustomerId, note = '' }) {
  const account = value.prepare(`SELECT id,stage FROM crm_accounts
    WHERE external_customer_id=? ORDER BY updated_at DESC,id DESC LIMIT 1`)
    .get(masterExternalCustomerId);
  if (!account) return null;
  const stage = String(account.stage || '');
  const reason = String(note || '').trim();
  const summary = `确认与线索 ${String(leadExternalCustomerId || '')} 为同一客户并已关联${reason ? `：${reason}` : ''}`;
  const activityId = id('ACT');
  const at = nowText();
  value.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,
     stage_before,stage_after,manager_required,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    activityId, account.id, String(user?.id || ''), 'note', '', '', summary, '', '',
    stage, stage, 0, at, at,
  );
  return { activityId, customerId: account.id };
}

function supplementIdentityConflict(value, user, { conflictId, action }) {
  assertConflictManager(user);
  const normalizedAction = String(action || '').trim();
  if (!['apply', 'skip'].includes(normalizedAction)) {
    throw httpError(422, '补充资料动作无效', 'PROTECTED_IDENTITY_SUPPLEMENT_ACTION_INVALID');
  }
  const row = value.prepare(`SELECT status,decision,target_external_customer_id,
      latest_external_customer_ids_json
    FROM crm_customer_identity_conflicts WHERE conflict_id=?`).get(conflictId);
  if (!row) {
    throw httpError(404, '身份冲突不存在或已不可用', 'PROTECTED_IDENTITY_CONFLICT_NOT_FOUND');
  }
  const masterExternalCustomerId = String(row.target_external_customer_id || '');
  if (row.status !== 'resolved' || row.decision !== 'link_existing' || !masterExternalCustomerId) {
    throw httpError(409, '该冲突尚未关联到主客户，无法补充资料',
      'PROTECTED_IDENTITY_SUPPLEMENT_INVALID');
  }
  const linkedIds = json(row.latest_external_customer_ids_json, []);
  const leadExternalCustomerId = linkedIds.find(id => id !== masterExternalCustomerId) || '';
  if (!leadExternalCustomerId) {
    throw httpError(409, '该冲突缺少可补充资料的线索编号',
      'PROTECTED_IDENTITY_SUPPLEMENT_LEAD_MISSING');
  }
  if (normalizedAction === 'skip') {
    return skipIdentitySupplement(value, user, {
      leadExternalCustomerId, masterExternalCustomerId,
    });
  }
  const lead = value.prepare(`SELECT contact_name,website,industry FROM crm_intake_items
    WHERE external_customer_id=? ORDER BY updated_at DESC,id DESC LIMIT 1`)
    .get(leadExternalCustomerId);
  const fields = {};
  if (lead) {
    const contact = String(lead.contact_name || '').trim();
    const website = String(lead.website || '').trim();
    const industry = String(lead.industry || '').trim();
    if (contact) fields.contact = contact;
    if (website) fields.website = website;
    if (industry) fields.industry = industry;
  }
  return applyIdentitySupplement(value, user, {
    leadExternalCustomerId, masterExternalCustomerId, fields,
  });
}

function createDuplicateReview(value, user, input, candidates, target = {}, identity = {}) {
  const fingerprint = duplicateFingerprint(input, DUPLICATE_RULE_VERSION);
  const targetType = target.type || 'manual_customer';
  const targetId = String(target.id || '');
  const previous = value.prepare(`SELECT * FROM crm_duplicate_reviews
    WHERE target_type=? AND target_id=? AND submitted_by=? AND fingerprint=? AND status='pending'
    ORDER BY created_at DESC LIMIT 1`).get(targetType, targetId, user.id || '', fingerprint);
  if (previous) return previous;
  const reviewId = id('DUPREV');
  const at = nowText();
  const safeInput = {
    companyName: String(input.companyName || ''), website: String(input.website || ''),
    country: String(input.country || ''), city: String(input.city || ''),
    industry: String(input.industry || ''), customerType: String(input.customerType || ''),
    source: String(input.source || ''), productFocus: String(input.productFocus || ''),
    priority: String(input.priority || 'B'),
    ownerId: String(input.ownerId || ''), nextAction: String(input.nextAction || ''),
    nextActionAt: String(input.nextActionAt || ''), provisionalCompanyName: Boolean(input.provisionalCompanyName),
  };
  const safeCandidates = candidates.slice(0, 10).map(candidate => candidate.isProtected
    ? {}
    : candidate);
  const selected = safeCandidates.find(candidate => candidate.customerId) || {};
  value.prepare(`INSERT INTO crm_duplicate_reviews
    (id,target_type,target_id,fingerprint,submitted_by,input_json,candidates_json,status,
     created_rule_version,evaluated_rule_version,current_candidates_json,
     selected_customer_id,selected_candidate_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?)`).run(
    reviewId, targetType, targetId, fingerprint, user.id || '', JSON.stringify(safeInput),
    JSON.stringify(safeCandidates), DUPLICATE_RULE_VERSION, DUPLICATE_RULE_VERSION,
    JSON.stringify(safeCandidates), selected.customerId || '', JSON.stringify(selected), at, at,
  );
  recordDuplicateAudit(value, user, 'duplicate_review_submitted', reviewId, {
    targetType, targetId, candidateCount: candidates.length, fingerprint,
    ruleVersion: DUPLICATE_RULE_VERSION,
  }, identity);
  return value.prepare('SELECT * FROM crm_duplicate_reviews WHERE id=?').get(reviewId);
}

function exactDuplicateError(value, user, duplicate) {
  const account = duplicate.crmAccountId
    ? value.prepare('SELECT id,owner_id,stage,assignment_status FROM crm_accounts WHERE id=?').get(duplicate.crmAccountId)
    : value.prepare(`SELECT id,owner_id,stage,assignment_status FROM crm_accounts
      WHERE external_customer_id=? AND COALESCE(lifecycle_status,'active')='active'
      ORDER BY updated_at DESC,id LIMIT 1`).get(duplicate.customerId);
  let message = '该客户已有跟进人，无法重复新增。';
  let publicDetails = {};
  if (duplicate.isProtected) {
    message = '该客户已有跟进人，无法重复新增。';
  } else if (account?.owner_id === user.id) {
    message = '该客户已在你的客户列表';
    publicDetails = { existingCustomerId: account.id, canOpenExistingCustomer: true };
  } else if (hasPermission(user, 'view_all_customers') && hasPermission(user, 'manage_intake')) {
    message = '客户主档已存在';
    publicDetails = { duplicate: {
      customerId: duplicate.customerId,
      crmAccountId: duplicate.crmAccountId,
      companyName: duplicate.companyName,
      matchedBy: duplicate.matchedBy,
    } };
  }
  const error = conflictError(message, 'CUSTOMER_DUPLICATE');
  error.publicDetails = publicDetails;
  return error;
}

function approvedDuplicateReview(value, reviewId, input, user) {
  let review = reviewId
    ? value.prepare("SELECT * FROM crm_duplicate_reviews WHERE id=? AND target_type='manual_customer'")
      .get(String(reviewId))
    : null;
  if (!reviewId) {
    review = value.prepare(`SELECT * FROM crm_duplicate_reviews
      WHERE target_type='manual_customer' AND submitted_by=? AND status='confirmed_distinct'
      ORDER BY reviewed_at DESC,id DESC`).all(user.id)
      .find(row => row.fingerprint === duplicateFingerprint(
        input, row.created_rule_version || 'legacy-v1',
      ));
  }
  if (!reviewId && !review) return null;
  const fingerprint = duplicateFingerprint(input, review?.created_rule_version || 'legacy-v1');
  if (!review || review.submitted_by !== user.id || review.status !== 'confirmed_distinct'
      || review.fingerprint !== fingerprint) {
    throw conflictError('查重核验未放行或提交资料已变更', 'DUPLICATE_REVIEW_REQUIRED');
  }
  return review;
}

function assertDuplicateReviewManager(user) {
  assertPermission(user, 'view_all_customers');
  assertPermission(user, 'manage_intake');
}

function duplicateCandidateCatalog(value) {
  const accounts = value.prepare(`SELECT a.id,a.external_customer_id,a.company_name,a.nickname,a.website,
      a.country,a.city,a.industry,a.customer_type,a.owner_id,a.stage,a.assignment_status,u.name owner_name
    FROM crm_accounts a LEFT JOIN sales_users u ON u.id=a.owner_id
    WHERE COALESCE(a.lifecycle_status,'active')='active'
      AND TRIM(COALESCE(a.external_customer_id,''))!=''
    ORDER BY a.updated_at DESC,a.id`).all();
  const accountById = new Map(accounts.map(row => [row.id, row]));
  const accountByCustomer = new Map();
  for (const row of accounts) if (!accountByCustomer.has(row.external_customer_id)) {
    accountByCustomer.set(row.external_customer_id, row);
  }
  return loadDuplicateCustomerRows(value, { crmOnly: true }).map(row => {
    const account = accountById.get(row.crm_account_id) || accountByCustomer.get(row.customer_id) || {};
    return {
      customerId: row.customer_id || '',
      crmAccountId: account.id || row.crm_account_id || '',
      companyName: row.company_name || account.company_name || '',
      nickname: row.nickname || account.nickname || '',
      website: row.website || account.website || '',
      country: row.country || account.country || '',
      city: row.city || account.city || '',
      industry: row.industry || account.industry || '',
      customerType: row.customer_type || account.customer_type || '',
      ownerId: account.owner_id || '',
      ownerName: account.owner_name || '',
      customerStage: account.stage || '',
      assignmentStatus: account.assignment_status || '',
    };
  });
}

function hydrateDuplicateCandidate(candidate, catalog) {
  const live = catalog.find(item => item.customerId === candidate.customerId
      || (candidate.crmAccountId && item.crmAccountId === candidate.crmAccountId)) || {};
  return {
    customerId: live.customerId || candidate.customerId || '',
    crmAccountId: live.crmAccountId || candidate.crmAccountId || '',
    companyName: live.companyName || candidate.companyName || '',
    nickname: live.nickname || candidate.nickname || '',
    website: live.website || candidate.website || '',
    country: live.country || candidate.country || '',
    city: live.city || candidate.city || '',
    industry: live.industry || candidate.industry || '',
    customerType: live.customerType || candidate.customerType || '',
    ownerId: live.ownerId || '',
    ownerName: live.ownerName || '',
    customerStage: live.customerStage || '',
    assignmentStatus: live.assignmentStatus || '',
    matchedBy: candidate.matchedBy || '',
    score: Number(candidate.score || 0),
    ruleVersion: candidate.ruleVersion || '',
    reliableEvidence: Array.isArray(candidate.reliableEvidence) ? candidate.reliableEvidence : [],
    referenceSignals: Array.isArray(candidate.referenceSignals) ? candidate.referenceSignals : [],
  };
}

function reviewCandidateRows(row) {
  return json(row.current_candidates_json || row.candidates_json, [])
    .filter(candidate => candidate && candidate.customerId);
}

function reviewHasProtectedExact(row) {
  return json(row.current_candidates_json || '', [])
    .some(candidate => candidate?.isProtected === true && candidate?.exact === true);
}

function publicDuplicateReview(value, row, catalog = duplicateCandidateCatalog(value), users = null) {
  const candidates = reviewCandidateRows(row).map(candidate => hydrateDuplicateCandidate(candidate, catalog));
  const selectedSnapshot = parseJsonObject(row.selected_candidate_json);
  const selectedCandidate = hydrateDuplicateCandidate(
    selectedSnapshot.customerId
      ? selectedSnapshot
      : candidates.find(item => item.customerId === row.selected_customer_id) || candidates[0] || {},
    catalog,
  );
  const userNames = users || new Map(value.prepare('SELECT id,name FROM sales_users').all()
    .map(user => [user.id, user.name]));
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    submittedBy: row.submitted_by,
    submittedByName: userNames.get(row.submitted_by) || row.submitted_by || '',
    input: parseJsonObject(row.input_json),
    candidates,
    selectedCandidate: selectedCandidate.customerId ? selectedCandidate : null,
    protectedExact: reviewHasProtectedExact(row),
    status: row.status,
    resolutionNote: row.resolution_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAccountId: row.created_account_id,
    createdExternalCustomerId: row.created_external_customer_id,
    createdRuleVersion: row.created_rule_version || 'legacy-v1',
    evaluatedRuleVersion: row.evaluated_rule_version || 'legacy-v1',
    resolutionSource: row.resolution_source || '',
    recalculatedBy: row.recalculated_by || '',
    recalculatedAt: row.recalculated_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listDuplicateReviews(user, query = {}) {
  assertDuplicateReviewManager(user);
  const status = String(query.status || 'pending');
  if (!['pending', 'confirmed_same', 'confirmed_distinct', 'needs_info', 'all'].includes(status)) {
    throw badRequest('无效的查重核验状态');
  }
  const value = db();
  try {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || query.limit || 50)));
    const where = status === 'all' ? '' : 'WHERE status=?';
    const params = status === 'all' ? [] : [status];
    const total = value.prepare(`SELECT COUNT(*) count FROM crm_duplicate_reviews ${where}`).get(...params).count;
    const rows = value.prepare(`SELECT * FROM crm_duplicate_reviews ${where}
      ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
    const catalog = duplicateCandidateCatalog(value);
    const users = new Map(value.prepare('SELECT id,name FROM sales_users').all().map(row => [row.id, row.name]));
    return {
      reviews: rows.map(row => publicDuplicateReview(value, row, catalog, users)),
      total, page, pageSize, totalPages: Math.ceil(total / pageSize),
    };
  } finally { value.close(); }
}

function duplicateCandidateSearch(user, reviewId, query = {}) {
  assertDuplicateReviewManager(user);
  const search = normalizeCompanyName(query.q || query.query).slice(0, 160);
  if (search.length < 2) return { candidates: [] };
  const value = db();
  try {
    const review = value.prepare('SELECT id FROM crm_duplicate_reviews WHERE id=? AND status=\'pending\'')
      .get(String(reviewId || ''));
    if (!review) throw notFound('待处理查重核验不存在');
    const candidates = duplicateCandidateCatalog(value).filter(candidate => [
      candidate.customerId, candidate.crmAccountId, candidate.companyName, candidate.nickname, candidate.website,
    ].some(field => normalizeCompanyName(field).includes(search))).slice(0, 20);
    return { candidates };
  } finally { value.close(); }
}

function replaceDuplicateReviewCandidate(user, reviewId, payload = {}, identity = {}) {
  assertDuplicateReviewManager(user);
  const candidateCustomerId = String(payload.customerId || payload.candidateCustomerId || '').trim();
  if (!candidateCustomerId) throw badRequest('请选择疑似已有客户');
  const value = db();
  try {
    return value.transaction(() => {
      const row = value.prepare("SELECT * FROM crm_duplicate_reviews WHERE id=? AND status='pending'")
        .get(String(reviewId || ''));
      if (!row) throw notFound('待处理查重核验不存在');
      if (reviewHasProtectedExact(row)) {
        throw conflictError('该记录精确命中保护客户，不能更换候选', 'DUPLICATE_PROTECTED_EXACT');
      }
      const catalog = duplicateCandidateCatalog(value);
      const selected = catalog.find(candidate => candidate.customerId === candidateCustomerId);
      if (!selected) throw badRequest('疑似已有客户不存在或当前不可用');
      const before = row.selected_customer_id || reviewCandidateRows(row)[0]?.customerId || '';
      const at = nowText();
      value.prepare(`UPDATE crm_duplicate_reviews
        SET selected_customer_id=?,selected_candidate_json=?,selected_by=?,updated_at=?
        WHERE id=? AND status='pending'`)
        .run(selected.customerId, JSON.stringify(selected), user.id, at, row.id);
      if (before !== selected.customerId) {
        recordDuplicateAudit(value, user, 'duplicate_review_candidate_changed', row.id, {
          beforeCustomerId: before, afterCustomerId: selected.customerId,
          ruleVersion: row.evaluated_rule_version || 'legacy-v1',
        }, identity);
      }
      return { review: publicDuplicateReview(
        value, value.prepare('SELECT * FROM crm_duplicate_reviews WHERE id=?').get(row.id), catalog,
      ), deduplicated: before === selected.customerId };
    }).immediate();
  } finally { value.close(); }
}

function recordDuplicateLinkTimeline(value, user, row, selected, note, at) {
  const intakeRow = value.prepare('SELECT * FROM crm_intake_items WHERE id=?').get(row.target_id);
  const master = value.prepare('SELECT * FROM crm_accounts WHERE id=?').get(selected.crmAccountId);
  if (!intakeRow || !master) return;
  const activityId = id('ACT');
  value.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,
     stage_before,stage_after,manager_required,progress_key,reaction_option_id,
     reaction_label_snapshot,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    activityId, master.id, user.id, 'note', '', '',
    `确认与线索 ${intakeRow.external_customer_id} 为同一客户并已关联${note ? `：${note}` : ''}`,
    '', '', master.stage, master.stage, 0, 'note', '', '', at, at);
  const pending = {};
  if (String(intakeRow.contact_name || '').trim()) {
    const masterContacts = value.prepare(
      "SELECT COUNT(*) n FROM crm_account_contacts WHERE customer_id=? AND COALESCE(archived_at,'')=''",
    ).get(master.id).n;
    if (!masterContacts) pending.contact = true;
  }
  if (String(intakeRow.website || '').trim() && String(intakeRow.website).trim() !== String(master.website || '').trim()) {
    pending.website = true;
  }
  if (String(intakeRow.industry || '').trim() && !String(master.industry || '').trim()) {
    pending.industry = true;
  }
  value.prepare(
    'UPDATE crm_intake_items SET supplement_pending_json=? WHERE id=?',
  ).run(JSON.stringify(pending), row.target_id);
}

function resolveDuplicateReviewRow(value, user, row, resolution, payload = {}, identity = {}, source = 'manual') {
  if (row.status !== 'pending') {
    if (row.status !== resolution) {
      throw conflictError('该查重核验已有其他结论', 'DUPLICATE_REVIEW_ALREADY_RESOLVED');
    }
    return { deduplicated: true, selected: null };
  }
  if (reviewHasProtectedExact(row)) {
    throw conflictError('该记录精确命中保护客户，不能人工放行', 'DUPLICATE_PROTECTED_EXACT');
  }
  const catalog = duplicateCandidateCatalog(value);
  let selected = null;
  if (resolution === 'confirmed_same') {
    const candidateCustomerId = String(payload.candidateCustomerId || '').trim();
    if (!candidateCustomerId) throw badRequest('确认同一客户时必须明确选择候选客户');
    const selectedCustomerId = row.selected_customer_id || reviewCandidateRows(row)[0]?.customerId || '';
    if (candidateCustomerId !== selectedCustomerId) {
      throw conflictError('疑似客户已变更，请刷新后重新确认', 'DUPLICATE_CANDIDATE_CHANGED');
    }
    selected = catalog.find(candidate => candidate.customerId === candidateCustomerId);
    if (!selected) throw conflictError('所选客户当前不可用，请重新搜索候选', 'DUPLICATE_CANDIDATE_STALE');
  }
  const at = nowText();
  const note = String(payload.note || '').trim().slice(0, 500);
  const updated = value.prepare(`UPDATE crm_duplicate_reviews
    SET status=?,resolution_note=?,reviewed_by=?,reviewed_at=?,resolution_source=?,
      selected_customer_id=?,selected_candidate_json=?,updated_at=?
    WHERE id=? AND status='pending'`).run(
    resolution, note, user.id, at, source, selected?.customerId || row.selected_customer_id || '',
    selected ? JSON.stringify(selected) : row.selected_candidate_json, at, row.id,
  );
  if (updated.changes !== 1) throw conflictError('该查重核验已被其他操作处理', 'DUPLICATE_REVIEW_STALE');
  if (row.target_type === 'intake_item' && row.target_id) {
    const intakeUpdate = resolution === 'confirmed_same'
      ? value.prepare(`UPDATE crm_intake_items SET status='duplicate',crm_customer_id=?,
          duplicate_state='exact',assigned_owner_id='',suggested_owner_id='',
          decision_reason='管理层已确认为同一客户',updated_at=?
        WHERE id=? AND duplicate_review_id=? AND duplicate_state='review'`)
        .run(selected.crmAccountId || '', at, row.target_id, row.id)
      : resolution === 'needs_info'
        ? value.prepare(`UPDATE crm_intake_items SET decision_reason='管理员要求补充资料后再判断',supplement_requirement=?,updated_at=?
          WHERE id=? AND duplicate_review_id=? AND duplicate_state='review'`)
          .run(note, at, row.target_id, row.id)
        : value.prepare(`UPDATE crm_intake_items SET status='approved',duplicate_state='cleared',
          assigned_owner_id='',suggested_owner_id='',decision_reason='查重核验已放行',updated_at=?
        WHERE id=? AND duplicate_review_id=? AND duplicate_state='review'`)
          .run(at, row.target_id, row.id);
    if (intakeUpdate.changes !== 1) {
      throw conflictError('关联线索状态已变化，请刷新后重试', 'DUPLICATE_REVIEW_TARGET_STALE');
    }
    if (resolution === 'confirmed_same' && selected?.crmAccountId && row.target_type === 'intake_item') {
      recordDuplicateLinkTimeline(value, user, row, selected, note, at);
    }
  }
  recordDuplicateAudit(value, user, 'duplicate_review_resolved', row.id, {
    resolution, source, targetType: row.target_type, targetId: row.target_id,
    selectedCustomerId: selected?.customerId || '', note,
    ruleVersion: row.evaluated_rule_version || 'legacy-v1',
  }, identity);
  return { deduplicated: false, selected };
}

function resolveDuplicateReview(user, reviewId, payload = {}, identity = {}) {
  assertDuplicateReviewManager(user);
  const resolution = String(payload.resolution || payload.action || '');
  if (!['confirmed_same', 'confirmed_distinct', 'needs_info'].includes(resolution)) {
    throw badRequest('请选择“确认同一客户”“确认不是同一客户”或“信息不足，要求补充”');
  }
  if (resolution === 'needs_info' && !String(payload.note || '').trim()) {
    throw badRequest('信息不足时必须填写需要补充的内容');
  }
  const value = db();
  try {
    return value.transaction(() => {
      const row = value.prepare('SELECT * FROM crm_duplicate_reviews WHERE id=?').get(String(reviewId || ''));
      if (!row) throw notFound('查重核验记录不存在');
      const result = resolveDuplicateReviewRow(value, user, row, resolution, payload, identity);
      return {
        review: publicDuplicateReview(value,
          value.prepare('SELECT * FROM crm_duplicate_reviews WHERE id=?').get(row.id)),
        deduplicated: result.deduplicated,
      };
    }).immediate();
  } finally { value.close(); }
}

function bulkResolveDuplicateDistinct(user, payload = {}, identity = {}) {
  assertDuplicateReviewManager(user);
  if (payload.resolution && payload.resolution !== 'confirmed_distinct') {
    throw badRequest('批量操作只允许确认不是同一客户');
  }
  const reviewIds = [...new Set((Array.isArray(payload.reviewIds) ? payload.reviewIds : [])
    .map(value => String(value || '').trim()).filter(Boolean))];
  if (!reviewIds.length || reviewIds.length > 100) throw badRequest('请选择1至100条待核验记录');
  const value = db();
  try {
    return value.transaction(() => {
      const rows = reviewIds.map(reviewId => {
        const row = value.prepare('SELECT * FROM crm_duplicate_reviews WHERE id=?').get(reviewId);
        if (!row) throw notFound(`查重核验记录不存在：${reviewId}`);
        if (!['pending', 'confirmed_distinct'].includes(row.status)) {
          throw conflictError('批次包含已确认同一客户的记录', 'DUPLICATE_BULK_CONFLICT');
        }
        return row;
      });
      const batchId = id('DUPBATCH');
      let resolvedCount = 0;
      for (const row of rows) {
        const result = resolveDuplicateReviewRow(value, user, row, 'confirmed_distinct', {
          note: payload.note || '批量确认不是同一客户',
        }, identity, 'bulk_distinct');
        if (!result.deduplicated) resolvedCount += 1;
      }
      recordDuplicateAudit(value, user, 'duplicate_review_bulk_distinct', batchId, {
        reviewIds, resolvedCount, ruleVersion: DUPLICATE_RULE_VERSION,
      }, identity);
      return { batchId, reviewIds, resolvedCount, deduplicatedCount: rows.length - resolvedCount };
    }).immediate();
  } finally { value.close(); }
}

function recalculateDuplicateReviewRows(value, user, rows, identity = {}, options = {}) {
  const source = options.source || 'rule_recalculation';
  const auditPrefix = options.auditPrefix || 'duplicate_review_recalculated';
  const runId = id(options.runIdPrefix || 'DUPRECALC');
  let releasedCount = 0;
  let retainedCount = 0;
  let exactCount = 0;
  for (const row of rows) {
    const input = parseJsonObject(row.input_json);
    const excludeCustomerId = row.target_type === 'intake_item'
      ? value.prepare('SELECT external_customer_id FROM crm_intake_items WHERE id=?').get(row.target_id)
        ?.external_customer_id || ''
      : '';
    const matchOptions = { crmOnly: true, includeProtected: true, excludeCustomerId };
    const exact = findExactDuplicate(value, input, matchOptions);
    const candidates = exact ? [exact] : findFuzzyDuplicateCandidates(value, input, {
      ...matchOptions,
    });
    const safeCandidates = candidates.filter(candidate => !candidate.isProtected);
    const protectedExact = Boolean(exact?.isProtected);
    const manualSelection = !protectedExact && Boolean(row.selected_by && row.selected_customer_id);
    const selected = protectedExact
      ? {}
      : manualSelection ? parseJsonObject(row.selected_candidate_json) : safeCandidates[0] || {};
    const nextCandidates = protectedExact
      ? [{ isProtected: true, exact: true, matchedBy: exact.matchedBy, ruleVersion: DUPLICATE_RULE_VERSION }]
      : manualSelection
        ? json(row.current_candidates_json || row.candidates_json, [])
        : safeCandidates;
    const at = nowText();
    value.prepare(`UPDATE crm_duplicate_reviews
      SET current_candidates_json=?,selected_customer_id=?,selected_candidate_json=?,
        evaluated_rule_version=?,recalculated_by=?,recalculated_at=?,updated_at=?
      WHERE id=? AND status='pending'`).run(
      JSON.stringify(nextCandidates), selected.customerId || '', JSON.stringify(selected),
      DUPLICATE_RULE_VERSION, user.id, at, at, row.id,
    );
    if (!safeCandidates.length && !manualSelection && !protectedExact) {
      const current = value.prepare('SELECT * FROM crm_duplicate_reviews WHERE id=?').get(row.id);
      resolveDuplicateReviewRow(value, user, current, 'confirmed_distinct', {
        note: `按规则 ${DUPLICATE_RULE_VERSION} 重新计算后无可靠候选`,
      }, identity, source);
      releasedCount += 1;
      recordDuplicateAudit(value, user, `${auditPrefix}_released`, row.id, {
        runId, previousRuleVersion: row.evaluated_rule_version || 'legacy-v1',
        ruleVersion: DUPLICATE_RULE_VERSION,
      }, identity);
    } else {
      if (exact) exactCount += 1;
      retainedCount += 1;
      recordDuplicateAudit(value, user, `${auditPrefix}_retained`, row.id, {
        runId, candidateCount: nextCandidates.length, exact: Boolean(exact), protectedExact,
        manualSelectionPreserved: manualSelection,
        previousCandidateIds: reviewCandidateRows(row).map(candidate => candidate.customerId),
        candidateIds: nextCandidates.filter(candidate => !candidate.isProtected)
          .map(candidate => candidate.customerId),
        previousRuleVersion: row.evaluated_rule_version || 'legacy-v1',
        ruleVersion: DUPLICATE_RULE_VERSION,
      }, identity);
    }
  }
  recordDuplicateAudit(value, user, `${auditPrefix}_completed`, runId, {
    examinedCount: rows.length, releasedCount, retainedCount, exactCount,
    ruleVersion: DUPLICATE_RULE_VERSION,
  }, identity);
  return { runId, examinedCount: rows.length, releasedCount, retainedCount, exactCount };
}

function upgradeStaleDuplicateReviews(value) {
  const rows = value.prepare(`SELECT r.* FROM crm_duplicate_reviews r
    JOIN crm_intake_items i ON i.id=r.target_id
      AND i.duplicate_review_id=r.id
      AND i.status='pending'
      AND i.duplicate_state='review'
    WHERE r.status='pending'
      AND r.target_type='intake_item'
      AND r.evaluated_rule_version!=?
    ORDER BY r.created_at,r.id`).all(DUPLICATE_RULE_VERSION);
  if (!rows.length) return {
    runId: '', examinedCount: 0, releasedCount: 0, retainedCount: 0, exactCount: 0,
  };
  const system = { id: 'system' };
  const identity = { realUserId: 'system', effectiveUserId: 'system' };
  return value.transaction(() => recalculateDuplicateReviewRows(
    value,
    system,
    rows,
    identity,
    {
      source: 'rule_upgrade',
      auditPrefix: 'duplicate_review_rule_upgrade',
      runIdPrefix: 'DUPUPGRADE',
    },
  )).immediate();
}

function recalculateDuplicateReviews(user, payload = {}, identity = {}) {
  assertDuplicateReviewManager(user);
  const hasRequestedIds = Object.prototype.hasOwnProperty.call(payload, 'reviewIds');
  if (hasRequestedIds && !Array.isArray(payload.reviewIds)) {
    throw badRequest('reviewIds 必须是查重核验 ID 数组');
  }
  const requestedIds = hasRequestedIds
    ? payload.reviewIds.map(value => String(value || '').trim())
    : [];
  if (hasRequestedIds && (!requestedIds.length || requestedIds.length > 100
      || requestedIds.some(value => !value)
      || new Set(requestedIds).size !== requestedIds.length)) {
    throw badRequest('reviewIds 必须包含1至100个不重复的有效 ID');
  }
  const requested = new Set(requestedIds);
  const value = db();
  try {
    return value.transaction(() => {
      let rows;
      if (requested.size) {
        rows = [...requested].map(reviewId => {
          const row = value.prepare('SELECT * FROM crm_duplicate_reviews WHERE id=?').get(reviewId);
          if (!row) throw notFound(`查重核验记录不存在：${reviewId}`);
          if (row.status !== 'pending') {
            throw conflictError('查重核验记录已处理，请刷新后重试', 'DUPLICATE_REVIEW_STALE');
          }
          return row;
        }).sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
      } else {
        rows = value.prepare("SELECT * FROM crm_duplicate_reviews WHERE status='pending' ORDER BY created_at,id").all();
      }
      return recalculateDuplicateReviewRows(value, user, rows, identity);
    }).immediate();
  } finally { value.close(); }
}

function protectOpenIntakeForAccount(value, actor, accountId, externalCustomerId) {
  const identityRows = loadDuplicateCustomerRows(value, { crmOnly: true })
    .filter(row => row.crm_account_id === accountId);
  if (!identityRows.length) return;
  const items = value.prepare(`SELECT * FROM crm_intake_items
    WHERE status IN ('pending','approved','assigned','returned')
      AND external_customer_id!=? AND duplicate_state!='cleared'`).all(externalCustomerId || '');
  for (const item of items) {
    const input = {
      companyName: item.company_name,
      website: item.website,
      country: item.country,
      industry: item.industry,
      customerType: item.customer_type,
      productFocus: item.product_focus,
    };
    const exact = findExactDuplicate(value, input, {
      rows: identityRows,
      excludeCustomerId: item.external_customer_id,
    });
    if (exact) {
      value.prepare(`UPDATE crm_intake_items SET status='duplicate',crm_customer_id=?,
        duplicate_state='exact',assigned_owner_id='',suggested_owner_id='',
        decision_reason='客户已在CRM',updated_at=? WHERE id=?`)
        .run(accountId, nowText(), item.id);
      recordDuplicateAudit(value, actor.id || 'system', 'duplicate_intake_blocked', item.id, {
        matchedBy: exact.matchedBy,
        existingCustomerId: externalCustomerId,
      });
      continue;
    }
    const fuzzy = findFuzzyDuplicateCandidates(value, input, {
      rows: identityRows,
      excludeCustomerId: item.external_customer_id,
      threshold: 0.72,
    });
    if (!fuzzy.length) continue;
    const review = createDuplicateReview(value, actor, input, fuzzy, {
      type: 'intake_item', id: item.id,
    });
    value.prepare(`UPDATE crm_intake_items SET status='pending',assigned_owner_id='',suggested_owner_id='',
      duplicate_state='review',duplicate_review_id=?,decision_reason='资料已提交管理层核验',updated_at=?
      WHERE id=?`).run(review.id, nowText(), item.id);
  }
}

function normalizeEstablishedYear(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const year = Number(text);
  const currentYear = new Date().getFullYear();
  if (!/^\d{4}$/.test(text) || !Number.isInteger(year) || year < 1000 || year > currentYear) {
    throw badRequest(`成立年份必须是1000年至${currentYear}之间的四位年份`);
  }
  return year;
}

function addAccount(user, payload, options = {}) {
  assertPermission(user, 'create_customer');
  const creatorId = String(options.auditIdentity?.realUserId || user.id || '').trim()
    || String(user.id || '').trim();
  const normalized = normalizeMinimalCustomerInput(payload);
  const customerInput = { ...payload, ...normalized };
  const initialStage = String(customerInput.stage || 'qualified').trim();
  if (!isValidStage(initialStage)) throw badRequest('无效的客户阶段');
  if (initialStage === 'disqualified') throw badRequest('请使用“标记不对口”操作');
  const stopsFollowUp = ['lost', 'disqualified'].includes(initialStage);
  const requestedNextActionAt = String(customerInput.nextActionAt || '').trim();
  const initialNextAction = stopsFollowUp
    ? ''
    : String(customerInput.nextAction || '完成首次触达').trim();
  const initialNextActionAt = stopsFollowUp
    ? ''
    : requestedNextActionAt
      ? parseBusinessDateTime(requestedNextActionAt)
      : dateOffset(1);
  const value = db();
  let reservation;
  let approvedReviewId = '';
  try {
    reservation = reserveCustomerCreate(value, user, customerInput);
    if (reservation.replay) return reservation.replay;
    const canManageAssignment = hasPermission(user, 'view_all_customers') && hasPermission(user, 'manage_intake');
    if (user.role !== 'sales' && !canManageAssignment) {
      throw forbidden('新增客户需要管理入库与分配权限');
    }
    const requestedOwnerId = String(customerInput.ownerId || '').trim();
    const ownerId = user.role === 'sales' || !canManageAssignment
      ? user.id
      : requestedOwnerId === '__unassigned__' ? '' : requestedOwnerId;
    const establishedYear = normalizeEstablishedYear(customerInput.establishedYear);
    if (ownerId && (!authorizedSalesUser(value, ownerId)
        || value.prepare("SELECT COALESCE(archived_at,'') archived_at FROM sales_users WHERE id=?").get(ownerId)?.archived_at)) {
      throw badRequest('请选择有效的在职销售负责人');
    }
    const customerId = id('CRM');
    const now = nowText();
    const transaction = value.transaction(() => {
      let externalId = String(customerInput.externalCustomerId || '').trim();
      if (externalId && !value.prepare('SELECT 1 FROM customer_pool WHERE customer_id=?').get(externalId)) throw new Error('选择的客户主档不存在');
      if (externalId && isProtectedCustomer(value, externalId)) {
        throw conflictError('该客户已有跟进人，无法重复新增。', 'CUSTOMER_DUPLICATE');
      }
      if (externalId) {
        const existingAccount = value.prepare(`SELECT id FROM crm_accounts
          WHERE external_customer_id=? AND COALESCE(lifecycle_status,'active')='active'
          ORDER BY updated_at DESC,id LIMIT 1`).get(externalId);
        if (existingAccount) {
          const master = value.prepare('SELECT company_name,website FROM customer_pool WHERE customer_id=?').get(externalId) || {};
          throw exactDuplicateError(value, user, {
            customerId: externalId,
            crmAccountId: existingAccount.id,
            companyName: master.company_name || customerInput.companyName,
            matchedBy: 'stable_id',
          });
        }
      }
      if (!externalId) {
        const website = customerInput.website;
        const duplicate = findExactDuplicate(value, customerInput, { includeProtected: true });
        if (duplicate?.crmAccountId || duplicate?.isProtected) throw exactDuplicateError(value, user, duplicate);
        const approvedReview = approvedDuplicateReview(
          value,
          String(customerInput.duplicateReviewId || ''),
          customerInput,
          user,
        );
        if (!approvedReview) {
          const fuzzyCandidates = findFuzzyDuplicateCandidates(value, customerInput, {
            crmOnly: true,
            includeProtected: true,
            threshold: 0.72,
          }).filter(candidate => !duplicate || candidate.customerId !== duplicate.customerId);
          if (fuzzyCandidates.length) {
            const review = createDuplicateReview(
              value,
              user,
              { ...customerInput, ownerId },
              fuzzyCandidates,
              {},
              options.auditIdentity || {},
            );
            return {
              reviewRequired: true,
              reviewId: review.id,
              message: '该客户需要管理员确认，确认后可继续领取。',
            };
          }
        } else {
          approvedReviewId = approvedReview.id;
        }
        if (duplicate && !duplicate.crmAccountId) externalId = duplicate.customerId;
      }
      if (!externalId) {
        const website = customerInput.website;
        const usedIds = new Set(value.prepare('SELECT customer_id FROM customer_pool').all().map(row => row.customer_id));
        externalId = allocateCustomerId(usedIds, normalizeCountryPrefix(customerInput.country), {});
        value.prepare(`INSERT INTO customer_pool
          (customer_id,company_name,russian_name,english_name,country,city,website,industry,customer_type,products,established_year,current_pool,source_file,first_found,last_found)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          externalId, customerInput.companyName, String(customerInput.russianName || '').trim(),
          String(customerInput.englishName || '').trim(), String(customerInput.country || ''), String(customerInput.city || ''),
          website, String(customerInput.industry || ''), String(customerInput.customerType || ''), String(customerInput.productFocus || ''),
          establishedYear, '未分池', 'CRM手工新增', now.slice(0, 10), now.slice(0, 10),
        );
      } else if (customerInput.establishedYear !== undefined) {
        value.prepare('UPDATE customer_pool SET established_year=?,updated_at=? WHERE customer_id=?')
          .run(establishedYear, now, externalId);
      }
      assertCustomerIdentityAvailable(value, {
        externalCustomerId: externalId,
        name: customerInput.companyName,
        source: 'crm_manual_company_name',
        actorId: user.id,
      });
      value.prepare(`INSERT INTO crm_accounts
        (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,product_focus,priority,potential_value,established_year,stage,owner_id,created_by,manager_id,manager_required,manager_status,last_activity_at,next_action,next_action_at,next_action_time_basis,loss_reason,created_at,updated_at,assignment_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        customerId, externalId, customerInput.companyName, String(customerInput.country || ''),
        String(customerInput.city || ''), customerInput.website, String(customerInput.industry || ''), String(customerInput.customerType || ''),
        String(customerInput.source || ''), String(customerInput.productFocus || ''), String(customerInput.priority || 'B'), 0,
        establishedYear, initialStage, ownerId || null, creatorId, String(customerInput.managerId || 'USR-MGR'), 0, '', '', initialNextAction,
        initialNextActionAt, stopsFollowUp ? '' : 'utc', '', now, now, ownerId ? 'claimed' : 'unassigned',
      );
      if (!stopsFollowUp) {
        recordExplicitPlanIfEnabled(value, {
          id: customerId,
          external_customer_id: externalId,
          owner_id: ownerId,
        }, user.id, initialNextAction, initialNextActionAt, 'account_create',
        reservation.key || customerId);
      }
      protectOpenIntakeForAccount(value, user, customerId, externalId);
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
      if (approvedReviewId) {
        value.prepare(`UPDATE crm_duplicate_reviews
          SET created_account_id=?,created_external_customer_id=?,updated_at=? WHERE id=?`)
          .run(customerId, externalId, nowText(), approvedReviewId);
      }
      return { externalCustomerId: externalId, enrichment };
    });
    const result = transaction.immediate();
    const response = result.reviewRequired ? result : { customerId, ...result };
    return completeCustomerCreate(value, reservation.key, response);
  } catch (error) {
    clearCustomerCreateReservation(value, reservation?.key);
    if (error.code === 'CUSTOMER_DUPLICATE') {
      recordDuplicateAudit(value, user, 'duplicate_create_blocked', error.publicDetails?.existingCustomerId || '', {
        matchedOwnCustomer: Boolean(error.publicDetails?.canOpenExistingCustomer),
        matchedBy: error.publicDetails?.duplicate?.matchedBy || 'protected_identity',
      }, options.auditIdentity || {});
    }
    throw error;
  } finally { value.close(); }
}

function updateAccount(user, customerId, payload, identity = {}) {
  assertPermission(user, 'edit_customer');
  const value = db();
  try {
    const account = getAccountForUser(value, user, customerId);
    if (payload.stage !== undefined && !isValidStage(payload.stage)) {
      throw badRequest('无效的客户阶段');
    }
    if (String(payload.stage || '') === 'disqualified') {
      throw badRequest('请使用“标记不对口”操作');
    }
    const stopsFollowUp = ['lost', 'disqualified'].includes(String(payload.stage || ''));
    const reactivating = ['lost', 'disqualified'].includes(String(account.stage || ''))
      && payload.stage !== undefined
      && !stopsFollowUp;
    if (reactivating && (!String(payload.nextAction || '').trim()
        || !String(payload.nextActionAt || '').trim())) {
      throw badRequest('重新激活客户必须填写下一步计划和计划时间');
    }
    const touchesPlan = payload.nextAction !== undefined || payload.nextActionAt !== undefined;
    const nextAction = payload.nextAction === undefined
      ? String(account.next_action || '').trim()
      : String(payload.nextAction || '').trim();
    let nextActionAt = payload.nextActionAt === undefined
      ? String(account.next_action_at || '').trim()
      : String(payload.nextActionAt || '').trim();
    if (!stopsFollowUp && touchesPlan) {
      if (Boolean(nextAction) !== Boolean(nextActionAt)) {
        throw badRequest('下一步计划和计划时间必须同时填写');
      }
      if (nextActionAt) {
        nextActionAt = payload.nextActionAt === undefined
          ? parseBusinessDateTime(String(account.next_action_time_basis || '') === 'utc'
            ? `${nextActionAt.replace(' ', 'T')}Z`
            : nextActionAt)
          : parseBusinessDateTime(nextActionAt);
      }
    }
    const planChanged = !stopsFollowUp && touchesPlan && nextAction && nextActionAt
      && (nextAction !== String(account.next_action || '').trim()
        || nextActionAt !== String(account.next_action_at || '').trim());
    const fields = [];
    const params = [];
    let changedOwnerId;
    let nicknameChange = null;
    if (payload.nickname !== undefined) {
      const nickname = normalizeAccountNickname(payload.nickname);
      if (!account.external_customer_id) throw conflictError('该客户未关联客户主档');
      const master = assertCustomerMasterAccess(value, user, account.external_customer_id);
      if (nickname !== String(master.nickname || '')) {
        nicknameChange = {
          externalCustomerId: account.external_customer_id,
          oldNickname: master.nickname || '',
          newNickname: nickname,
        };
      }
    }
    const allowed = {
      source: 'source', priority: 'priority',
      establishedYear: 'established_year',
      nextAction: 'next_action', nextActionAt: 'next_action_at', managerRequired: 'manager_required',
      managerStatus: 'manager_status', lossReason: 'loss_reason',
      country: 'country', city: 'city', website: 'website', industry: 'industry',
      productFocus: 'product_focus',
    };
    const establishedYear = payload.establishedYear === undefined
      ? undefined
      : normalizeEstablishedYear(payload.establishedYear);
    let unassignReason = '';
    for (const [key, column] of Object.entries(allowed)) {
      if (payload[key] === undefined) continue;
      if (stopsFollowUp && ['nextAction', 'nextActionAt'].includes(key)) continue;
      fields.push(`${column}=?`);
      params.push(key === 'managerRequired'
        ? (payload[key] ? 1 : 0)
        : key === 'establishedYear' ? establishedYear
          : key === 'nextAction' ? nextAction
            : key === 'nextActionAt' ? nextActionAt : payload[key]);
    }
    if (!stopsFollowUp && touchesPlan) {
      if (payload.nextActionAt === undefined
          && nextActionAt !== String(account.next_action_at || '').trim()) {
        fields.push('next_action_at=?');
        params.push(nextActionAt);
      }
      fields.push('next_action_time_basis=?');
      params.push(nextAction && nextActionAt ? 'utc' : '');
    }
    if (payload.ownerId !== undefined) {
      const requestedOwnerId = String(payload.ownerId || '').trim();
      const ownerId = requestedOwnerId === '__unassigned__' ? '' : requestedOwnerId;
      if (ownerId !== String(account.owner_id || '')) {
        if (!hasPermission(user, 'view_all_customers') || !hasPermission(user, 'manage_intake')) {
          throw forbidden('没有管理入库与分配权限');
        }
        if (ownerId && (!authorizedSalesUser(value, ownerId)
            || value.prepare("SELECT COALESCE(archived_at,'') archived_at FROM sales_users WHERE id=?").get(ownerId)?.archived_at)) {
          throw badRequest('请选择有效的在职销售负责人');
        }
        if (!ownerId) {
          if (payload.unassignConfirmed !== true) throw badRequest('请确认将客户放入CRM未分配范围');
          unassignReason = String(payload.unassignReason || '').trim();
          if (unassignReason.length < 2 || unassignReason.length > 500) {
            throw badRequest('转入CRM未分配范围必须填写2至500个字符的原因');
          }
        }
        fields.push('owner_id=?');
        params.push(ownerId || null);
        fields.push('assignment_status=?', 'assigned_at=?', "return_reason=''");
        params.push(ownerId ? 'claimed' : 'unassigned', ownerId ? nowText() : '');
        changedOwnerId = ownerId;
      }
    }
    if (payload.stage !== undefined) {
      fields.push('stage=?');
      params.push(payload.stage);
      if (stopsFollowUp) {
        fields.push("next_action=''", "next_action_at=''", "next_action_time_basis=''");
      }
    }
    const masterAllowed = {
      country: 'country', city: 'city', website: 'website', industry: 'industry', productFocus: 'products',
      establishedYear: 'established_year',
    };
    const masterFields = [], masterParams = [];
    for (const [key, column] of Object.entries(masterAllowed)) {
      if (payload[key] === undefined) continue;
      masterFields.push(`${column}=?`);
      masterParams.push(key === 'establishedYear' ? establishedYear : payload[key]);
    }
    const currentCustomerType = String(account.customer_type || '').trim();
    const hasCustomerType = payload.customerType !== undefined;
    const customerType = hasCustomerType ? String(payload.customerType || '').trim() : currentCustomerType;
    const changedCustomerType = hasCustomerType && customerType !== currentCustomerType;
    if (changedCustomerType && customerType && !CUSTOMER_TYPE_OPTIONS.includes(customerType)) {
      throw badRequest('无效的客户类型');
    }
    if (hasCustomerType) {
      fields.push('customer_type=?');
      params.push(customerType);
      masterFields.push('customer_type=?');
      masterParams.push(customerType);
    }
    if (!fields.length && !masterFields.length && !nicknameChange) {
      return { customerId: account.id, nickname: account.nickname || '' };
    }
    const transaction = value.transaction(() => {
      if (nicknameChange) {
        try {
          assertCustomerIdentityAvailable(value, {
            externalCustomerId: nicknameChange.externalCustomerId,
            name: nicknameChange.newNickname,
            source: 'crm_current_nickname',
            actorId: user.id,
          });
        } catch (error) {
          if (error?.code === 'CUSTOMER_IDENTITY_REVIEW_REQUIRED') {
            throw conflictError('该昵称已被其他客户使用，请更换昵称', 'CUSTOMER_NICKNAME_TAKEN');
          }
          throw error;
        }
        value.prepare('UPDATE customer_pool SET nickname=?,updated_at=? WHERE customer_id=?')
          .run(nicknameChange.newNickname, nowText(), nicknameChange.externalCustomerId);
      }
      if (fields.length) {
        fields.push('updated_at=?'); params.push(nowText(), account.id);
        value.prepare(`UPDATE crm_accounts SET ${fields.join(',')} WHERE id=?`).run(...params);
      }
      if (planChanged) {
        recordExplicitPlanIfEnabled(value, {
          ...account,
          owner_id: changedOwnerId === undefined ? account.owner_id : changedOwnerId,
        }, user.id, nextAction, nextActionAt,
        reactivating ? 'account_reactivation' : 'account_edit', '');
      }
      if (changedOwnerId !== undefined && account.intake_item_id) {
        value.prepare(`UPDATE crm_intake_items SET assigned_owner_id=?,status=?,assigned_at=?,updated_at=?
          WHERE id=?`).run(
          changedOwnerId, changedOwnerId ? 'claimed' : 'approved',
          changedOwnerId ? nowText() : '', nowText(), account.intake_item_id,
        );
      }
      if (changedOwnerId === '' && unassignReason) {
        value.prepare(`INSERT INTO crm_audit_log
          (id,user_id,action,entity_type,entity_id,detail_json,created_at,
           real_user_id,effective_user_id,impersonation_context_id)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          id('AUD'), identity.effectiveUserId || user.id, 'customer_unassigned', 'crm_account', account.id,
          JSON.stringify({ previousOwnerId: account.owner_id || '', reason: unassignReason }), nowText(),
          identity.realUserId || user.id, identity.effectiveUserId || user.id, identity.contextId || '',
        );
      }
      if (masterFields.length && account.external_customer_id) {
        masterParams.push(account.external_customer_id);
        value.prepare(`UPDATE customer_pool SET ${masterFields.join(',')} WHERE customer_id=?`).run(...masterParams);
      } else if (fields.length && account.external_customer_id) {
        value.prepare('UPDATE customer_pool SET updated_at=? WHERE customer_id=?')
          .run(nowText(), account.external_customer_id);
      }
      if (nicknameChange) {
        recordCustomerNicknameAudit(
          value,
          user,
          identity,
          nicknameChange.externalCustomerId,
          {
            oldNickname: nicknameChange.oldNickname,
            newNickname: nicknameChange.newNickname,
          },
          account.id,
        );
      }
      if (hasCustomerType && account.external_customer_id) {
        value.prepare('UPDATE customers SET customer_type=? WHERE customer_id=?').run(
          customerType,
          account.external_customer_id,
        );
      }
      if (changedCustomerType) {
        const effectiveUserId = identity.effectiveUserId || user.id;
        value.prepare(`INSERT INTO crm_audit_log
          (id,user_id,action,entity_type,entity_id,detail_json,created_at,
           real_user_id,effective_user_id,impersonation_context_id)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          id('AUD'), effectiveUserId, 'customer_type_changed', 'crm_account', account.id,
          JSON.stringify({
            oldCustomerType: String(account.customer_type || ''),
            newCustomerType: customerType,
            tagId: null,
          }),
          nowText(), identity.realUserId || user.id, effectiveUserId, identity.contextId || '',
        );
      }
    });
    transaction.immediate();
    return { customerId: account.id, nickname: nicknameChange?.newNickname ?? account.nickname ?? '' };
  } finally { value.close(); }
}

function updateCustomerMaster(user, customerId, payload, identity = {}) {
  assertPermission(user, 'edit_customer');
  if (user.role !== 'admin') throw forbidden('只有管理员可以直接编辑客户主档');
  const cleanId = String(customerId || '').trim();
  const value = db();
  try {
    const existing = value.prepare('SELECT * FROM customer_pool WHERE customer_id=?').get(cleanId);
    if (!existing) throw httpError(404, '客户主档不存在');
    if (isProtectedCustomer(value, cleanId)) throw forbidden('无权访问该客户');
    const allowed = {
      companyName: 'company_name',
      russianName: 'russian_name',
      englishName: 'english_name',
      country: 'country',
      city: 'city',
      website: 'website',
      industry: 'industry',
      customerType: 'customer_type',
      description: 'description',
      productFocus: 'products',
      rating: 'rating',
      establishedYear: 'established_year',
    };
    const fields = [];
    const params = [];
    const changed = {};
    for (const [key, column] of Object.entries(allowed)) {
      if (payload[key] === undefined) continue;
      const next = String(payload[key] || '').trim();
      const normalized = key === 'establishedYear' ? normalizeEstablishedYear(next) : next;
      if (key === 'customerType' && next && !CUSTOMER_TYPE_OPTIONS.includes(next)) {
        throw badRequest('无效的客户类型');
      }
      if (String(normalized ?? '') === String(existing[column] ?? '')) continue;
      fields.push(`${column}=?`);
      params.push(normalized);
      changed[key] = { from: String(existing[column] || ''), to: String(normalized ?? '') };
    }
    if (!fields.length) return { customerId: cleanId, changed: false };
    const updatedAt = nowText();
    fields.push('updated_at=?');
    params.push(updatedAt, cleanId);
    const transaction = value.transaction(() => {
      for (const key of ['companyName', 'russianName', 'englishName']) {
        if (!changed[key]?.to) continue;
        assertCustomerIdentityAvailable(value, {
          externalCustomerId: cleanId,
          name: changed[key].to,
          source: `crm_master_${key}`,
          actorId: user.id,
        });
      }
      value.prepare(`UPDATE customer_pool SET ${fields.join(',')} WHERE customer_id=?`).run(...params);
      value.prepare(`INSERT INTO crm_audit_log
        (id,user_id,action,entity_type,entity_id,detail_json,created_at,
         real_user_id,effective_user_id,impersonation_context_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        id('AUD'), identity.effectiveUserId || user.id, 'customer_master_updated',
        'customer_master', cleanId, JSON.stringify({ changed }), updatedAt,
        identity.realUserId || user.id, identity.effectiveUserId || user.id,
        identity.contextId || '',
      );
      const reopened = value.prepare(`UPDATE crm_duplicate_reviews
        SET status='pending',resolution_note='',reviewed_by='',reviewed_at='',
          resolution_source='',updated_at=?
        WHERE status='needs_info' AND id IN (
          SELECT duplicate_review_id FROM crm_intake_items
          WHERE external_customer_id=? AND TRIM(duplicate_review_id)!=''
        )`).run(updatedAt, cleanId);
      if (reopened.changes) {
        value.prepare(`UPDATE crm_intake_items SET decision_reason='资料已更新，重新进入管理层核验',updated_at=?
          WHERE external_customer_id=? AND duplicate_state='review'`).run(updatedAt, cleanId);
        value.prepare(`INSERT INTO crm_audit_log
          (id,user_id,action,entity_type,entity_id,detail_json,created_at,
           real_user_id,effective_user_id,impersonation_context_id)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          id('AUD'), identity.effectiveUserId || user.id, 'duplicate_review_reopened',
          'customer_master', cleanId, JSON.stringify({ reopenedCount: reopened.changes }),
          updatedAt, identity.realUserId || user.id, identity.effectiveUserId || user.id,
          identity.contextId || '',
        );
      }
    });
    transaction.immediate();
    return { customerId: cleanId, changed: true, updatedAt };
  } finally { value.close(); }
}

function resolveBulkCustomerIds(value, user, payload = {}) {
  const hasExplicitIds = Array.isArray(payload.customerIds);
  const hasFilterScope = payload.filterScope !== undefined && payload.filterScope !== null;
  if (hasExplicitIds === hasFilterScope) {
    throw badRequest('请在明确客户与全部筛选结果中选择一种批量范围');
  }
  if (hasExplicitIds) {
    const ids = [...new Set(payload.customerIds
      .map(item => String(item || '').trim()).filter(Boolean))];
    if (!ids.length) throw badRequest('请选择客户');
    if (ids.length > 500) throw badRequest('一次最多处理500个客户');
    return ids;
  }

  assertPermission(user, 'view_customers');
  const filterScope = payload.filterScope;
  if (!filterScope || typeof filterScope !== 'object' || Array.isArray(filterScope)
      || filterScope.permissionVersion === undefined
      || !filterScope.filters || typeof filterScope.filters !== 'object'
      || Array.isArray(filterScope.filters)) {
    throw badRequest('筛选范围格式无效');
  }
  const ast = authorizedFilterAst(value, user, 'customers', {
    permissionVersion: filterScope.permissionVersion,
    filters: JSON.stringify(filterScope.filters),
  });
  const customerInput = filterAstToCustomerQuery(ast, { sort: 'company' });
  const customerQuery = buildCustomerQuery(customerInput, {
    user,
    canViewContacts: hasPermission(user, 'view_contacts'),
    canViewInsights: hasPermission(user, 'view_insights'),
  });
  const scope = accountScope(user);
  const filters = [scope.sql.replace(/^WHERE\s+/i, ''), ...customerQuery.filters];
  const params = [...scope.params, ...customerQuery.params];
  addAuthorizedTagFilters(
    filters,
    params,
    customerInput.tagFilters,
    effectiveFilterSchemaFor(value, user, 'customers').filters,
  );
  const rows = value.prepare(`SELECT DISTINCT a.id FROM crm_accounts a
    LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
    WHERE ${filters.join(' AND ')} ORDER BY a.id ASC LIMIT 501`).all(...params);
  if (rows.length > 500) throw badRequest('筛选结果超过500个客户，请继续缩小筛选范围');
  if (!rows.length) throw badRequest('当前筛选结果中没有可操作客户');
  return rows.map(row => row.id);
}

function bulkAssignAccounts(user, payload, identity = {}) {
  for (const permission of ['view_customers', 'edit_customer', 'view_all_customers', 'manage_intake']) {
    assertPermission(user, permission);
  }
  const ownerId = String(payload.ownerId || '').trim();
  if (!ownerId) throw badRequest('批量设置负责人必须选择有效的销售；退回客户请使用批量退回');
  const value = db();
  try {
    return value.transaction(() => {
      const customerIds = resolveBulkCustomerIds(value, user, payload);
      if (ownerId && !value.prepare("SELECT 1 FROM sales_users WHERE id=? AND role='sales' AND active=1 AND COALESCE(archived_at,'')=''").get(ownerId)) {
        throw badRequest('目标销售已停用或不存在');
      }
      const placeholders = customerIds.map(() => '?').join(',');
      const rows = value.prepare(`SELECT id,external_customer_id,owner_id FROM crm_accounts
        WHERE id IN (${placeholders}) AND COALESCE(lifecycle_status,'active')='active'`).all(...customerIds);
      if (rows.length !== customerIds.length) throw notFound('部分客户不存在');
      const context = buildAccessContext(value, user);
      if (customerIds.some(customerId => !context.accountIds.has(customerId))) throw forbidden('批量操作包含无权访问的客户');
      for (const row of rows) {
        assertExternalCustomerIdentitiesAvailable(
          value, user, row.external_customer_id, 'crm_bulk_assign',
        );
      }
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
      for (const row of rows) {
        recordRecycleAudit(value, user, identity, 'customer_bulk_assigned', row.id, {
          previousOwnerId: row.owner_id || '', ownerId, batchSize: rows.length,
        });
      }
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
  if (!account) {
    throw fullScope
      ? recycleError(404, '客户不存在', 'CUSTOMER_NOT_FOUND')
      : recycleError(403, '无权退回该客户', 'CUSTOMER_RECYCLE_FORBIDDEN');
  }
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

function activeAccountForMismatch(value, user, customerId) {
  if (hasPermission(user, 'manage_customer_recycle')) {
    return activeAccountForRecycle(value, user, customerId);
  }
  assertPermission(user, 'reject_own_customer_mismatch');
  const account = value.prepare(`SELECT * FROM crm_accounts
    WHERE id=? AND owner_id=? AND COALESCE(lifecycle_status,'active')='active'`).get(
    customerId, user.id,
  );
  if (account) return account;
  if (value.prepare('SELECT 1 FROM crm_accounts WHERE id=?').get(customerId)) {
    throw recycleError(403, '无权标记该客户不对口', 'CUSTOMER_RECYCLE_FORBIDDEN');
  }
  throw recycleError(404, '客户不存在', 'CUSTOMER_NOT_FOUND');
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
  return account;
}

function manualReturnBatchId(at) {
  return `BATCH-MANUAL-RETURN-${at.slice(0, 10).replaceAll('-', '')}`;
}

function createReturnedIntake(value, account, reason, previousOwnerId, updatedAt) {
  const externalCustomerId = String(account.external_customer_id || '').trim();
  if (!externalCustomerId) {
    throw recycleError(409, '客户缺少外部编号，无法退回线索池', 'CUSTOMER_RETURN_INTAKE_ID_MISSING');
  }
  const batchId = manualReturnBatchId(updatedAt);
  value.prepare(`INSERT OR IGNORE INTO crm_intake_batches
    (id,batch_date,source,status,candidate_count,imported_count,assigned_count,skipped_count,
     created_by,created_at,finished_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    batchId, updatedAt.slice(0, 10), 'crm-manual-return', 'completed', 0, 0, 0, 0,
    'system', updatedAt, updatedAt,
  );
  const intakeItemId = id('IN');
  value.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,crm_customer_id,company_name,country,website,industry,
     customer_type,product_focus,status,suggested_owner_id,assigned_owner_id,return_reason,
     assigned_at,claim_due_at,claimed_at,created_at,updated_at,previous_owner_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    intakeItemId, batchId, externalCustomerId, account.id, account.company_name,
    account.country || '', account.website || '', account.industry || '',
    account.customer_type || '', account.product_focus || '', 'returned', '', '', reason,
    '', '', '', updatedAt, updatedAt, previousOwnerId,
  );
  value.prepare(`UPDATE crm_intake_batches SET imported_count=imported_count+1
    WHERE id=?`).run(batchId);
  return intakeItemId;
}

function ensureReturnedIntake(value, account, reason, previousOwnerId, updatedAt, strict = true) {
  let intake = value.prepare(`SELECT * FROM crm_intake_items
    WHERE id=? OR crm_customer_id=?
    ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,created_at DESC LIMIT 1`).get(
    account.intake_item_id || '', account.id || '', account.intake_item_id || '',
  );
  if (!intake && account.external_customer_id) {
    intake = value.prepare('SELECT * FROM crm_intake_items WHERE external_customer_id=?')
      .get(account.external_customer_id);
    if (intake && intake.crm_customer_id && intake.crm_customer_id !== account.id) {
      if (!strict) return '';
      throw recycleError(409, '该客户的线索池记录已关联其他客户', 'CUSTOMER_RETURN_INTAKE_CONFLICT');
    }
  }
  const intakeItemId = intake?.id || createReturnedIntake(
    value, account, reason, previousOwnerId, updatedAt,
  );
  value.prepare(`UPDATE crm_intake_items SET status='returned',crm_customer_id=?,
    assigned_owner_id='',previous_owner_id=?,suggested_owner_id='',assigned_at='',
    claim_due_at='',claimed_at='',return_reason=?,updated_at=? WHERE id=?`).run(
    account.id, previousOwnerId, reason, updatedAt, intakeItemId,
  );
  value.prepare('UPDATE crm_accounts SET intake_item_id=? WHERE id=?')
    .run(intakeItemId, account.id);
  return intakeItemId;
}

function reconcileReturnedAccountsWithoutIntake(value) {
  const accounts = value.prepare(`SELECT a.* FROM crm_accounts a
    WHERE COALESCE(a.lifecycle_status,'active')='active'
      AND a.assignment_status='returned'
      AND TRIM(COALESCE(a.external_customer_id,''))!=''
      AND NOT EXISTS (
        SELECT 1 FROM crm_intake_items i
        WHERE i.id=COALESCE(a.intake_item_id,'') OR i.crm_customer_id=a.id
      )`).all();
  for (const account of accounts) {
    value.transaction(() => {
      const repairedAt = nowText();
      const intakeItemId = ensureReturnedIntake(
        value, account, account.return_reason || '历史退回线索补建',
        account.previous_owner_id || '', repairedAt, false,
      );
      if (!intakeItemId) return;
      value.prepare(`INSERT INTO crm_audit_log
        (id,user_id,action,entity_type,entity_id,detail_json,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(
        id('AUD'), 'system', 'customer_return_intake_backfilled', 'crm_account', account.id,
        JSON.stringify({ intakeItemId, externalCustomerId: account.external_customer_id }), repairedAt,
      );
    }).immediate();
  }
}

function applyCustomerReturn(value, user, identity, account, reason, action, batchSize = null) {
  assertCustomerReturnEligible(account);
  const updatedAt = nowText();
  const applied = applyAccountStatePatch(value, account.id, {
    assignmentStatus: 'returned',
    ownerId: null,
    updatedAt,
  });
  if (!applied.changed) {
    throw recycleError(
      409,
      '客户状态已变化，请刷新后重试',
      'CUSTOMER_RETURN_STATE_INVALID',
    );
  }
  value.prepare(`UPDATE crm_accounts SET recycle_kind='',recycle_reason='',recycled_by='',recycled_at='',
    previous_owner_id=?,return_reason=? WHERE id=?`).run(account.owner_id || '', reason, account.id);
  const intakeItemId = ensureReturnedIntake(
    value, account, reason, account.owner_id || '', updatedAt,
  );
  recordRecycleAudit(value, user, identity, action, account.id, {
    recycleKind: 'sales_return',
    returnedToPool: true,
    previousOwnerId: account.owner_id || '',
    intakeItemId,
    intakeStatus: 'returned',
    reason,
    ...(Number.isInteger(batchSize) ? { batchSize } : {}),
  });
  return intakeItemId;
}

function returnCustomer(user, customerId, payload = {}, identity = {}) {
  const reason = validateRecycleReason(payload.reason);
  assertPermission(user, 'manage_customer_recycle');
  const value = db();
  try {
    return value.transaction(() => {
      const account = assertCustomerReturnEligible(accountForReturn(value, user, customerId));
      const intakeItemId = applyCustomerReturn(
        value, user, identity, account, reason, 'customer_returned',
      );
      return { customerId: account.id, returnedToPool: true, intakeItemId };
    }).immediate();
  } finally { value.close(); }
}

function bulkReturnCustomers(user, payload = {}, identity = {}) {
  assertPermission(user, 'manage_customer_recycle');
  const reason = validateRecycleReason(payload.reason);
  const value = db();
  try {
    return value.transaction(() => {
      const customerIds = resolveBulkCustomerIds(value, user, payload);
      const accounts = customerIds.map(customerId =>
        assertCustomerReturnEligible(accountForReturn(value, user, customerId)));
      for (const account of accounts) {
        applyCustomerReturn(
          value, user, identity, account, reason, 'customer_bulk_returned', accounts.length,
        );
      }
      return { updated: accounts.length, returnedToPool: true };
    }).immediate();
  } finally { value.close(); }
}

function rejectCrmCustomer(user, customerId, payload = {}, identity = {}) {
  if (!hasPermission(user, 'manage_customer_recycle')) {
    assertPermission(user, 'reject_own_customer_mismatch');
  }
  const reason = String(payload.reason || '').trim();
  if (!reason) throw badRequest('标记不对口必须填写原因');
  const value = db();
  try {
    return value.transaction(() => {
      const account = activeAccountForMismatch(value, user, customerId);
      if (String(account.assignment_status || '') === 'returned'
          || String(account.lifecycle_status || 'active') !== 'active') {
        throw recycleError(409, '客户当前状态不可标记不对口', 'CUSTOMER_REJECT_STATE_INVALID');
      }
      const updatedAt = nowText();
      const applied = applyAccountStatePatch(value, account.id, {
        stage: 'lost',
        lifecycleStatus: 'recycled',
        assignmentStatus: 'returned',
        ownerId: null,
        updatedAt,
      });
      if (!applied.changed) {
        throw recycleError(409, '客户状态已变化，请刷新后重试', 'CUSTOMER_REJECT_STATE_INVALID');
      }
      value.prepare(`UPDATE crm_accounts SET recycle_kind='mismatch',recycle_reason=?,recycled_by=?,
        recycled_at=?,previous_owner_id=?,loss_reason=?,return_reason=? WHERE id=?`).run(
        reason, user.id, updatedAt, account.owner_id || '', reason, reason, account.id,
      );
      value.prepare(`UPDATE crm_intake_items SET status='rejected',assigned_owner_id='',
        suggested_owner_id='',assigned_at='',claim_due_at='',claimed_at='',return_reason=?,updated_at=?
        WHERE id=? OR crm_customer_id=?`).run(
        reason, updatedAt, account.intake_item_id || '', account.id || '',
      );
      recordRecycleAudit(value, user, identity, 'customer_rejected', account.id, {
        recycleKind: 'mismatch',
        previousOwnerId: account.owner_id || '',
        reason,
      });
      return { customerId: account.id, recycleKind: 'mismatch' };
    }).immediate();
  } finally { value.close(); }
}

function restoreMismatchRecord(user, recordKey, payload = {}, identity = {}) {
  assertPermission(user, 'manage_customer_recycle');
  const reason = validateRecycleReason(payload.reason);
  const [sourceType, recordId, ...extra] = String(recordKey || '').split(':');
  if (sourceType !== 'intake' || !recordId || extra.length) {
    throw recycleError(400, '不支持的不对口记录', 'INVALID_MISMATCH_RECORD_KEY');
  }
  const value = db();
  try {
    return value.transaction(() => {
      const scope = hasPermission(user, 'view_all_customers')
        ? { sql: '', params: [] }
        : {
          sql: 'AND (previous_owner_id=? OR rejected_by=?)',
          params: [user.id, user.id],
        };
      const item = value.prepare(`SELECT * FROM crm_intake_items
        WHERE id=? AND status='rejected' AND COALESCE(crm_customer_id,'')='' ${scope.sql}`)
        .get(recordId, ...scope.params);
      if (!item) {
        throw recycleError(404, '不对口记录不存在或无权访问', 'MISMATCH_RECORD_NOT_FOUND');
      }
      const restoredAt = nowText();
      const changed = value.prepare(`UPDATE crm_intake_items SET status='approved',
        assigned_owner_id='',suggested_owner_id='',assigned_at='',claim_due_at='',claimed_at='',
        rejected_by='',rejected_at='',previous_owner_id='',return_reason='',
        decision_reason=?,updated_at=? WHERE id=? AND status='rejected'`).run(
        `不对口记录已恢复：${reason}`, restoredAt, item.id,
      );
      if (changed.changes !== 1) {
        throw recycleError(409, '不对口记录状态已变化', 'MISMATCH_RESTORE_STATE_INVALID');
      }
      recordIntakeMismatchAudit(value, user, identity, 'intake_mismatch_restored', item.id, {
        sourceType: 'intake', intakeItemId: item.id,
        externalCustomerId: item.external_customer_id || '', reason,
      });
      return { recordKey: `intake:${item.id}`, restored: true, status: 'approved' };
    }).immediate();
  } finally { value.close(); }
}

function listRecycleBin(user, query = {}, options = {}) {
  assertPermission(user, 'manage_customer_recycle');
  const { page, pageSize, offset, search } = normalizeListQuery(query);
  const kind = String(query.kind || 'mismatch');
  if (!['sales_return', 'manual_delete', 'mismatch'].includes(kind)) {
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
      conditions.push(`(a.id LIKE ? OR a.external_customer_id LIKE ?
        OR COALESCE(p.nickname,a.nickname,'') LIKE ?
        OR COALESCE(NULLIF(p.company_name,''),a.company_name) LIKE ? OR a.country LIKE ?)`);
      params.push(like, like, like, like, like);
    }
    const where = conditions.join(' AND ');
    const total = Number(value.prepare(`SELECT COUNT(*) total FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
      WHERE ${where}`).get(...params).total || 0);
    const canRestore = user.role === 'admin'
      && hasPermission(user, 'manage_manual_customer_deletion')
      && !options.isImpersonating;
    const rows = value.prepare(`SELECT a.id,a.external_customer_id,
      COALESCE(p.nickname,a.nickname,'') nickname,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,a.country,a.stage,
      a.previous_owner_id,a.recycle_kind,a.recycle_reason,a.recycled_by,a.recycled_at,
      owner.name previous_owner_name,actor.name recycled_by_name
      FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
      LEFT JOIN sales_users owner ON owner.id=a.previous_owner_id
      LEFT JOIN sales_users actor ON actor.id=a.recycled_by
      WHERE ${where} ORDER BY a.recycled_at DESC,a.id LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset)
      .map(row => ({
        customerId: row.id,
        externalCustomerId: row.external_customer_id,
        nickname: row.nickname || '',
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
        actions: row.recycle_kind === 'sales_return'
          ? ['reassign']
          : (canRestore ? ['restore'] : []),
      }));
    return {
      rows, page, pageSize, total, totalPages: Math.ceil(total / pageSize),
      hasMore: offset + rows.length < total, kind,
    };
  } finally { value.close(); }
}

function parseMismatchRecordKey(recordKey) {
  const decoded = String(recordKey || '').trim();
  const parts = decoded.split(':');
  if (parts.length !== 2 || !['account', 'intake'].includes(parts[0]) || !parts[1]) {
    throw mismatchRecordNotFound();
  }
  return { sourceType: parts[0], sourceId: parts[1], recordKey: decoded };
}

function mismatchRecordNotFound() {
  return recycleError(404, '不对口记录不存在', 'MISMATCH_RECORD_NOT_FOUND');
}

function findRecycleAccount(value, user, customerId, options = {}) {
  const cleanId = String(customerId || '').trim();
  const conditions = ['a.id=?'];
  const params = [cleanId];
  if (options.mismatchOnly) {
    const scope = recycleScope(user, 'a');
    conditions.push(...scope.conditions, "a.recycle_kind='mismatch'");
    params.push(...scope.params);
  } else {
    conditions.push("COALESCE(a.lifecycle_status,'active')='recycled'");
    if (!hasPermission(user, 'view_all_customers')) {
      conditions.push('(a.previous_owner_id=? OR a.recycled_by=?)');
      params.push(user.id, user.id);
    }
  }
  return value.prepare(`SELECT a.*,u.name owner_name,m.name manager_name,
      creator.name creator_name,
      COALESCE(p.nickname,a.nickname,'') nickname,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
      COALESCE(NULLIF(p.country,''),a.country) country,
      COALESCE(NULLIF(p.city,''),a.city) city,
      COALESCE(NULLIF(p.website,''),a.website) website,
      COALESCE(NULLIF(p.industry,''),a.industry) industry,
      COALESCE(NULLIF(p.customer_type,''),a.customer_type) customer_type,
      COALESCE(NULLIF(p.products,''),a.product_focus) product_focus,
      COALESCE(p.established_year,a.established_year) established_year,
      p.description master_description,p.current_pool,p.rating,p.best_contact_level,
      p.contact_recon_status,p.deep_report,p.source_file,
      previous_owner.name previous_owner_name,recycler.name recycled_by_name
      FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
      LEFT JOIN sales_users u ON u.id=a.owner_id
      LEFT JOIN sales_users creator ON creator.id=a.created_by
      LEFT JOIN sales_users m ON m.id=a.manager_id
      LEFT JOIN sales_users previous_owner ON previous_owner.id=a.previous_owner_id
      LEFT JOIN sales_users recycler ON recycler.id=a.recycled_by
      WHERE ${conditions.join(' AND ')} LIMIT 1`).get(...params);
}

function buildRecycleAccountProfile(value, user, sourceAccount, options = {}) {
    const account = addStageLabels([sourceAccount])[0];

    const aiEnabled = featureState(value, options.hardFlags || resolveAIHardFlags())
      .ai_stations.effectiveEnabled;
    let masterProfile = {
      ok: true,
      customerPool: [],
      customers: [],
      reconJobs: [],
      reconResults: [],
      contactReconJobs: [],
      people: [],
    };
    if (account.external_customer_id) {
      const accessContext = buildAccessContext(value, user);
      accessContext.externalCustomerIds.add(account.external_customer_id);
      masterProfile = getCustomerProfileData(accessContext, account.external_customer_id, {
        includeAI: aiEnabled,
        recycleReadOnly: true,
        recycleAccountId: account.id,
        canEditNickname: hasPermission(user, 'edit_customer')
          && canAccessCustomerMaster(value, user, account.external_customer_id),
      });
    }

    const activities = publicActivityRecords(addActivityProvenance(value.prepare(`SELECT x.*,u.name user_name
      FROM crm_activities x LEFT JOIN sales_users u ON u.id=x.user_id
      WHERE x.customer_id=? AND COALESCE(x.is_test_data,0)=0
      ORDER BY x.occurred_at DESC`).all(account.id)));
    const rfqs = value.prepare(`SELECT * FROM crm_rfqs
      WHERE customer_id=? ORDER BY received_at DESC`).all(account.id);
    const quotes = value.prepare(`SELECT * FROM crm_quotes
      WHERE customer_id=? ORDER BY sent_at DESC`).all(account.id);
    const orders = value.prepare(`SELECT * FROM crm_orders
      WHERE customer_id=? ORDER BY ordered_at DESC`).all(account.id);
    const loadedInsights = loadInsights(value, [account]);
    const evaluations = aiEnabled
      ? loadedInsights.evaluations
      : loadedInsights.evaluations.map(withoutEvaluationAI);
    const auditEntityIds = [account.id, account.external_customer_id].filter(Boolean);
    const auditLog = auditEntityIds.length
      ? value.prepare(`SELECT l.id,l.user_id,l.action,l.entity_type,l.entity_id,
          l.created_at,l.real_user_id,l.effective_user_id,l.impersonation_context_id,
          u.name user_name,ru.name real_user_name,eu.name effective_user_name
        FROM crm_audit_log l
        LEFT JOIN sales_users u ON u.id=l.user_id
        LEFT JOIN sales_users ru ON ru.id=l.real_user_id
        LEFT JOIN sales_users eu ON eu.id=l.effective_user_id
        WHERE l.entity_id IN (${auditEntityIds.map(() => '?').join(',')})
        ORDER BY l.created_at DESC,l.id DESC`).all(...auditEntityIds)
      : [];
    const canRestore = account.recycle_kind === 'manual_delete'
      && user.role === 'admin'
      && hasPermission(user, 'manage_manual_customer_deletion')
      && !options.isImpersonating;
    const canReassign = ['sales_return', 'mismatch'].includes(account.recycle_kind);
    const payload = {
      ...masterProfile,
      ok: true,
      account,
      activities,
      rfqs,
      quotes,
      orders,
      timeline: buildCustomerTimeline(
        value, [account], activities, rfqs, quotes, orders, { includeAI: aiEnabled },
      ),
      insights: {
        contacts: hasPermission(user, 'view_contacts') ? loadedInsights.contacts : [],
        evaluations: hasPermission(user, 'view_insights') ? evaluations : [],
      },
      auditLog,
      recycle: {
        kind: account.recycle_kind,
        reason: account.recycle_reason,
        previousOwnerId: account.previous_owner_id || '',
        previousOwnerName: account.previous_owner_name || '未分配',
        recycledBy: account.recycled_by || '',
        recycledByName: account.recycled_by_name || account.recycled_by || '',
        recycledAt: account.recycled_at,
      },
      profileAccess: {
        readOnly: true,
        source: 'recycle',
        status: 'recycled',
        inCrm: true,
        crmAccessible: false,
        accountId: account.id,
        canEditNickname: hasPermission(user, 'edit_customer')
          && canAccessCustomerMaster(value, user, account.external_customer_id),
      },
      actions: [
        ...(canReassign ? ['reassign'] : []),
        ...(canRestore ? ['restore'] : []),
      ],
    };
    return hasPermission(user, 'view_contacts') ? payload : redactContactFields(payload);
}

function loadRecycleProfile(user, customerId, options = {}) {
  assertPermission(user, 'manage_customer_recycle');
  const fullScope = hasPermission(user, 'view_all_customers');
  const value = db();
  try {
    const account = findRecycleAccount(value, user, customerId);
    if (!account) {
      throw fullScope
        ? recycleError(404, '回收客户不存在', 'RECYCLED_CUSTOMER_NOT_FOUND')
        : recycleError(403, '无权访问该回收客户', 'RECYCLED_CUSTOMER_FORBIDDEN');
    }
    return buildRecycleAccountProfile(value, user, account, options);
  } finally { value.close(); }
}

function mismatchAccountDto(value, user, parsed, account, options = {}) {
  const canViewContacts = hasPermission(user, 'view_contacts');
  const baseProfile = redactUnauthorizedProfileTags(
    value,
    user,
    buildRecycleAccountProfile(value, user, account, options),
  );
  const externalCustomerId = String(account.external_customer_id || '');
  const recycle = baseProfile.recycle || {};
  return {
    ok: true,
    recordKey: parsed.recordKey,
    sourceType: 'account',
    customer: {
      accountId: String(account.id || ''),
      intakeItemId: '',
      externalCustomerId,
      nickname: String(account.nickname || ''),
      companyName: String(account.company_name || ''),
      country: String(account.country || ''),
      city: String(account.city || ''),
      website: String(account.website || ''),
      industry: String(account.industry || ''),
      customerType: String(account.customer_type || ''),
      products: canViewContacts ? String(account.product_focus || '') : '',
      description: canViewContacts ? String(account.master_description || '') : '',
    },
    recycle: {
      kind: String(recycle.kind || account.recycle_kind || ''),
      reason: canViewContacts ? String(recycle.reason || '') : '',
      previousOwnerId: String(recycle.previousOwnerId || account.previous_owner_id || ''),
      previousOwnerName: String(recycle.previousOwnerName || account.previous_owner_name || '未分配'),
      recycledBy: String(recycle.recycledBy || account.recycled_by || ''),
      recycledByName: String(
        recycle.recycledByName || account.recycled_by_name || account.recycled_by || '',
      ),
      recycledAt: String(recycle.recycledAt || account.recycled_at || ''),
    },
    profile: {
      customerPool: baseProfile.customerPool || [],
      customers: baseProfile.customers || [],
      reconJobs: baseProfile.reconJobs || [],
      reconResults: baseProfile.reconResults || [],
      contactReconJobs: baseProfile.contactReconJobs || [],
      people: baseProfile.people || [],
      accountContacts: externalCustomerId ? profileContacts(value, user, externalCustomerId) : [],
    },
    history: {
      activities: baseProfile.activities || [],
      rfqs: baseProfile.rfqs || [],
      quotes: baseProfile.quotes || [],
      orders: baseProfile.orders || [],
      timeline: baseProfile.timeline || [],
      evaluations: baseProfile.insights?.evaluations || [],
      auditLog: baseProfile.auditLog || [],
    },
    actions: user.role !== 'sales' && hasPermission(user, 'manage_customer_recycle')
      ? (baseProfile.actions || [])
      : [],
  };
}

function mismatchIntakeDto(value, user, parsed, item, options = {}) {
  const canViewContacts = hasPermission(user, 'view_contacts');
  const externalCustomerId = String(item.external_customer_id || '');
  const accessContext = buildAccessContext(value, user);
  accessContext.externalCustomerIds.add(externalCustomerId);
  const aiEnabled = featureState(value, options.hardFlags || resolveAIHardFlags())
    .ai_stations.effectiveEnabled;
  const baseProfile = redactUnauthorizedProfileTags(
    value,
    user,
    getCustomerProfileData(accessContext, externalCustomerId, {
      includeAI: aiEnabled,
      intakeReadOnly: true,
      intakeItemId: item.id,
      canEditNickname: false,
    }),
  );
  return {
    ok: true,
    recordKey: parsed.recordKey,
    sourceType: 'intake',
    customer: {
      accountId: '',
      intakeItemId: String(item.id || ''),
      externalCustomerId,
      nickname: String(item.nickname || ''),
      companyName: String(item.master_company_name || item.company_name || ''),
      country: String(item.master_country || item.country || ''),
      city: String(item.city || ''),
      website: String(item.master_website || item.website || ''),
      industry: String(item.master_industry || item.industry || ''),
      customerType: String(item.master_customer_type || item.customer_type || ''),
      products: canViewContacts ? String(item.master_products || item.product_focus || '') : '',
      description: canViewContacts ? String(item.master_description || '') : '',
    },
    recycle: {
      kind: 'mismatch',
      reason: canViewContacts ? String(item.return_reason || '') : '',
      previousOwnerId: String(item.previous_owner_id || ''),
      previousOwnerName: String(item.previous_owner_name || '未分配'),
      recycledBy: String(item.rejected_by || ''),
      recycledByName: String(item.rejected_by_name || item.rejected_by || ''),
      recycledAt: String(item.rejected_at || ''),
    },
    profile: {
      customerPool: baseProfile.customerPool || [],
      customers: baseProfile.customers || [],
      reconJobs: baseProfile.reconJobs || [],
      reconResults: baseProfile.reconResults || [],
      contactReconJobs: baseProfile.contactReconJobs || [],
      people: baseProfile.people || [],
      accountContacts: externalCustomerId ? profileContacts(value, user, externalCustomerId) : [],
    },
    history: {
      activities: [],
      rfqs: [],
      quotes: [],
      orders: [],
      timeline: [],
      evaluations: [],
      auditLog: [],
    },
    actions: user.role !== 'sales' && hasPermission(user, 'manage_customer_recycle')
      ? ['restore']
      : [],
  };
}

function loadMismatchRecordProfile(user, recordKey, options = {}) {
  const parsed = parseMismatchRecordKey(recordKey);
  const value = db();
  try {
    if (parsed.sourceType === 'intake') {
      const scope = mismatchIntakeScope(user, 'i');
      const item = value.prepare(`SELECT i.*,
          p.nickname,p.company_name master_company_name,p.country master_country,p.city,
          p.website master_website,p.industry master_industry,
          p.customer_type master_customer_type,p.products master_products,
          p.description master_description,
          previous_owner.name previous_owner_name,rejected_by.name rejected_by_name
        FROM crm_intake_items i
        LEFT JOIN customer_pool p ON p.customer_id=i.external_customer_id
        LEFT JOIN sales_users previous_owner ON previous_owner.id=i.previous_owner_id
        LEFT JOIN sales_users rejected_by ON rejected_by.id=i.rejected_by
        WHERE i.id=? AND ${scope.conditions.join(' AND ')} LIMIT 1`)
        .get(parsed.sourceId, ...scope.params);
      if (!item) {
        const exists = value.prepare(`SELECT id FROM crm_intake_items
          WHERE id=? AND status='rejected' AND COALESCE(crm_customer_id,'')=''
            AND COALESCE(rejected_at,'')!='' LIMIT 1`).get(parsed.sourceId);
        throw exists
          ? recycleError(403, '无权访问该不对口记录', 'MISMATCH_RECORD_FORBIDDEN')
          : mismatchRecordNotFound();
      }
      return mismatchIntakeDto(value, user, parsed, item, options);
    }
    const account = findRecycleAccount(value, user, parsed.sourceId, { mismatchOnly: true });
    if (!account) {
      const exists = value.prepare(`SELECT id FROM crm_accounts
        WHERE id=? AND COALESCE(lifecycle_status,'active')='recycled'
          AND recycle_kind='mismatch' LIMIT 1`).get(parsed.sourceId);
      throw exists
        ? recycleError(403, '无权访问该不对口记录', 'MISMATCH_RECORD_FORBIDDEN')
        : mismatchRecordNotFound();
    }
    return mismatchAccountDto(value, user, parsed, account, options);
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
      applyAccountStatePatch(value, account.id, {
        lifecycleStatus: 'recycled',
        assignmentStatus: 'returned',
        ownerId: null,
        updatedAt: recycledAt,
      });
      value.prepare(`UPDATE crm_accounts SET recycle_kind='manual_delete',recycle_reason=?,
        recycled_by=?,recycled_at=?,previous_owner_id=? WHERE id=?`).run(
        reason, user.id, recycledAt, account.owner_id || '', account.id,
      );
      recordRecycleAudit(value, user, identity, 'customer_trashed', account.id, {
        recycleKind: 'manual_delete', previousOwnerId: account.owner_id || '', reason,
      });
      return { customerId: account.id, recycled: true, recycleKind: 'manual_delete' };
    }).immediate();
  } finally { value.close(); }
}

function assertExternalCustomerIdentitiesAvailable(value, user, externalCustomerId, source) {
  const cleanId = String(externalCustomerId || '').trim();
  if (!cleanId) return;
  if (isProtectedCustomer(value, cleanId)) {
    throw conflictError('客户身份需要管理员核验后才能继续', 'CUSTOMER_IDENTITY_REVIEW_REQUIRED');
  }
  const master = value.prepare(`SELECT company_name,nickname,russian_name,english_name
    FROM customer_pool WHERE customer_id=?`).get(cleanId);
  if (!master) return;
  for (const name of [master.company_name, master.nickname, master.russian_name, master.english_name]) {
    if (!String(name || '').trim()) continue;
    assertCustomerIdentityAvailable(value, {
      externalCustomerId: cleanId,
      name,
      source,
      actorId: user.id,
    });
  }
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
      assertExternalCustomerIdentitiesAvailable(
        value, user, account.external_customer_id, 'crm_restore',
      );
      const owner = account.previous_owner_id
        ? value.prepare("SELECT id FROM sales_users WHERE id=? AND role='sales' AND active=1 AND COALESCE(archived_at,'')=''").get(account.previous_owner_id)
        : null;
      const ownerId = owner?.id || null;
      const restoredAt = nowText();
      applyAccountStatePatch(value, account.id, {
        lifecycleStatus: 'active',
        ownerId,
        assignmentStatus: ownerId ? 'claimed' : 'unassigned',
        updatedAt: restoredAt,
      });
      value.prepare(`UPDATE crm_accounts SET recycle_kind='',recycle_reason='',recycled_by='',
        recycled_at='',previous_owner_id='',return_reason='' WHERE id=?`).run(account.id);
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
  const fullScope = hasPermission(user, 'view_all_customers');
  const value = db();
  try {
    return value.transaction(() => {
      const scopeClause = fullScope
        ? ''
        : 'AND (previous_owner_id=? OR recycled_by=?)';
      const scopeParams = fullScope ? [] : [user.id, user.id];
      const account = value.prepare(`SELECT * FROM crm_accounts
        WHERE id=? AND COALESCE(lifecycle_status,'active')='recycled'
        ${scopeClause}`).get(customerId, ...scopeParams);
      if (!account) {
        throw fullScope
          ? recycleError(404, '客户不存在或不在回收站', 'CUSTOMER_NOT_FOUND')
          : recycleError(403, '无权重新分配该回收客户', 'CUSTOMER_RECYCLE_FORBIDDEN');
      }
      if (!['sales_return', 'mismatch'].includes(account.recycle_kind)) {
        throw recycleError(409, '该客户不是可重新分配类型', 'RECYCLE_KIND_MISMATCH');
      }
      assertExternalCustomerIdentitiesAvailable(
        value, user, account.external_customer_id, 'crm_reassign',
      );
      const owner = value.prepare("SELECT id FROM sales_users WHERE id=? AND role='sales' AND active=1 AND COALESCE(archived_at,'')=''").get(ownerId);
      if (!owner) throw badRequest('目标销售已停用或不存在');
      const assignedAt = nowText();
      const settings = value.prepare("SELECT claim_sla_hours FROM crm_intake_settings WHERE id='default'").get();
      const claimDue = nowText(new Date(Date.now() + Number(settings?.claim_sla_hours || 24) * 3600000));
      applyAccountStatePatch(value, account.id, {
        lifecycleStatus: 'active',
        ownerId,
        assignmentStatus: 'assigned',
        updatedAt: assignedAt,
      });
      value.prepare(`UPDATE crm_accounts SET recycle_kind='',recycle_reason='',
        recycled_by='',recycled_at='',previous_owner_id='',assigned_at=?,claim_due_at=?,
        claimed_at='',return_reason='' WHERE id=?`).run(
        assignedAt, claimDue, account.id,
      );
      if (account.intake_item_id) {
        value.prepare(`UPDATE crm_intake_items SET status='assigned',assigned_owner_id=?,
          assigned_at=?,claim_due_at=?,claimed_at='',return_reason='',updated_at=? WHERE id=?`).run(
          ownerId, assignedAt, claimDue, assignedAt, account.intake_item_id,
        );
      }
      recordRecycleAudit(value, user, identity, 'customer_reassigned', account.id, {
        recycleKind: account.recycle_kind, previousOwnerId: account.previous_owner_id || '', ownerId, reason,
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
  ['联系人修改记录', 'crm_account_contacts', 'updated_by'],
  ['联系人归档记录', 'crm_account_contacts', 'archived_by'],
  ['客户经营复盘', 'crm_manager_evaluations', 'author_id'],
  ['客户星标', 'crm_customer_stars', 'user_id'],
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
    assertUnambiguousCustomerFilterQuery(query);
    const ast = query.filters
      ? authorizedFilterAst(value, user, 'customers', query)
      : validateFilterQuery(value, user, 'customers', legacyCustomerFilterRawQuery(query));
    assertAuthorizedCustomerModifiers(value, user, query);
    const authorizedQuery = filterAstToCustomerQuery(ast, query);
    const customerQuery = buildCustomerQuery(authorizedQuery, {
      user,
      canViewContacts: hasPermission(user, 'view_contacts'),
      canViewInsights: hasPermission(user, 'view_insights'),
    });
    filters.push(...customerQuery.filters);
    params.push(...customerQuery.params);
    const starView = normalizeStarView(query.starView || 'all', user);
    const selectedStars = starFilter(starView, user);
    if (selectedStars.sql) {
      filters.push(selectedStars.sql);
      params.push(...selectedStars.params);
    }
    addAuthorizedTagFilters(
      filters,
      params,
      authorizedQuery.tagFilters,
      effectiveFilterSchemaFor(value, user, 'customers').filters,
    );
    const authorizedTotal = Number(value.prepare(`SELECT COUNT(*) total FROM crm_accounts a
      ${scope.sql}`).get(...scope.params).total || 0);
    const accounts = addStageLabels(value.prepare(`SELECT ${crmAccountProjection(value)},
      COALESCE(p.nickname,a.nickname,'') nickname,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
      COALESCE(p.russian_name,'') russian_name,
      COALESCE(p.english_name,'') english_name,
      COALESCE(NULLIF(p.country,''),a.country) country,
      COALESCE(NULLIF(p.city,''),a.city) city,
      COALESCE(NULLIF(p.website,''),a.website) website,
      COALESCE(NULLIF(p.industry,''),a.industry) industry,
      COALESCE(NULLIF(p.customer_type,''),a.customer_type) customer_type,
      COALESCE(NULLIF(p.products,''),a.product_focus) product_focus,
      COALESCE(p.established_year,a.established_year) established_year,
      owner.name owner_name,creator.name creator_name
      FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
      LEFT JOIN sales_users owner ON owner.id=a.owner_id
      LEFT JOIN sales_users creator ON creator.id=a.created_by
      WHERE ${filters.join(' AND ')} ORDER BY ${customerQuery.orderBy}`).all(
      ...params, ...customerQuery.orderParams,
    ).map(row => ({
        ...row,
        ownerId: row.owner_id || '',
        ownerName: row.owner_name || '',
        createdById: row.created_by || '',
        createdByName: creatorDisplayName(row),
      })));
    const customerIds = accounts.map(row => row.id);
    const linked = table => {
      if (!customerIds.length) return [];
      const placeholders = customerIds.map(() => '?').join(',');
      return value.prepare(`SELECT * FROM ${table} WHERE customer_id IN (${placeholders}) ORDER BY customer_id`).all(...customerIds);
    };
    const activities = customerIds.length
      ? publicActivityRecords(addActivityProvenance(value.prepare(`SELECT x.*,
          a.external_customer_id,
          COALESCE(NULLIF(a.external_customer_id,''),a.id) customer_number,
          COALESCE(p.nickname,a.nickname,'') customer_nickname,
          COALESCE(NULLIF(p.company_name,''),a.company_name) customer_company_name,
          COALESCE(owner.name,'') owner_name,
          COALESCE(actor.name,'') user_name
        FROM crm_activities x
        JOIN crm_accounts a ON a.id=x.customer_id
        LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
        LEFT JOIN sales_users owner ON owner.id=a.owner_id
        LEFT JOIN sales_users actor ON actor.id=x.user_id
        WHERE x.customer_id IN (${customerIds.map(() => '?').join(',')})
        ORDER BY x.occurred_at DESC,x.id`).all(...customerIds)))
      : [];
    const visibleCustomerIds = new Set(customerIds.map(String));
    const correctionRows = customerIds.length && hasTable(value, 'crm_activity_corrections')
      ? value.prepare(`SELECT * FROM crm_activity_corrections
        WHERE source_customer_id IN (${customerIds.map(() => '?').join(',')})
          AND target_customer_id IN (${customerIds.map(() => '?').join(',')})
        ORDER BY created_at,id`).all(...customerIds, ...customerIds)
      : [];
    const proposalRows = customerIds.length && hasTable(value, 'crm_activity_correction_proposals')
      ? value.prepare(`SELECT * FROM crm_activity_correction_proposals
        WHERE source_customer_id IN (${customerIds.map(() => '?').join(',')})
          AND target_customer_id IN (${customerIds.map(() => '?').join(',')})
        ORDER BY created_at,id`).all(...customerIds, ...customerIds)
      : [];
    const canReviewCorrections = hasPermission(user, 'manage_activity_corrections');
    const corrections = correctionRows.map(row => {
      const sourceVisible = visibleCustomerIds.has(String(row.source_customer_id));
      const targetVisible = visibleCustomerIds.has(String(row.target_customer_id));
      const bothVisible = sourceVisible && targetVisible;
      return {
        correctionId: row.id,
        status: 'completed',
        effective: true,
        originalActivityId: sourceVisible ? row.original_activity_id : '',
        replacementActivityId: targetVisible ? row.replacement_activity_id : '',
        sourceCustomerId: sourceVisible
          ? (row.source_external_customer_id || row.source_customer_id)
          : '',
        targetCustomerId: targetVisible
          ? (row.target_external_customer_id || row.target_customer_id)
          : '',
        actorId: bothVisible ? row.actor_id : '',
        reviewerId: bothVisible && canReviewCorrections ? row.reviewer_id : '',
        proposalId: bothVisible ? row.proposal_id : '',
        reason: bothVisible ? row.reason : '',
        milestoneType: bothVisible ? row.milestone_type : '',
        milestoneSourceId: sourceVisible ? row.milestone_source_id : '',
        milestoneTargetId: targetVisible ? row.milestone_target_id : '',
        createdAt: row.created_at,
      };
    });
    const correctionByActivity = new Map();
    for (const correction of corrections) {
      if (correction.originalActivityId) correctionByActivity.set(correction.originalActivityId, correction);
      if (correction.replacementActivityId) correctionByActivity.set(correction.replacementActivityId, correction);
    }
    const visibleActivityIds = new Set(activities.map(activity => String(activity.id || '')));
    const exportedActivities = activities.map(activity => {
      const scopedActivity = activity.supersededBy
          && !visibleActivityIds.has(String(activity.supersededBy))
        ? {
            ...activity,
            supersededBy: '',
            provenance: activity.provenance ? {
              ...activity.provenance,
              replacementActivityId: '',
              replacementCustomerId: '',
            } : null,
          }
        : activity;
      const correction = correctionByActivity.get(String(activity.id || ''));
      return correction ? {
        ...scopedActivity,
        correctionId: correction.correctionId,
        correctionStatus: correction.status,
        originalActivityId: correction.originalActivityId,
        replacementActivityId: correction.replacementActivityId,
        proposalId: correction.proposalId,
        reviewerId: correction.reviewerId,
        correctionReason: correction.reason,
      } : scopedActivity;
    });
    const correctionProposals = proposalRows.map(row => {
      const sourceVisible = visibleCustomerIds.has(String(row.source_customer_id));
      const targetVisible = visibleCustomerIds.has(String(row.target_customer_id));
      const bothVisible = sourceVisible && targetVisible;
      return {
        proposalId: row.id,
        status: row.status,
        version: Number(row.version || 0),
        originalActivityId: sourceVisible ? row.original_activity_id : '',
        sourceCustomerId: sourceVisible
          ? (row.source_external_customer_id || row.source_customer_id)
          : '',
        targetCustomerId: targetVisible
          ? (row.target_external_customer_id || row.target_customer_id)
          : '',
        requesterId: bothVisible ? row.requester_id : '',
        reviewerId: bothVisible && canReviewCorrections ? row.reviewer_id : '',
        correctionId: bothVisible ? row.correction_id : '',
        reason: bothVisible ? row.reason : '',
        reviewReason: bothVisible && canReviewCorrections ? row.review_reason : '',
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at || '',
      };
    });
    const users = hasPermission(user, 'view_users')
      ? hydrateUsersPermissions(value, value.prepare('SELECT * FROM sales_users ORDER BY role,name').all())
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
        }))
      : [];
    const contactsAllowed = hasPermission(user, 'view_contacts');
    const evaluations = hasPermission(user, 'view_insights')
      ? linked('crm_manager_evaluations')
        .filter(row => contactsAllowed || row.subject_type === 'company')
        .map(row => aiEnabled ? row : withoutEvaluationAIRow(row))
      : [];
    const payload = {
      schemaVersion: 3,
      exportedAt: nowText(),
      currentTotal: accounts.length,
      authorizedTotal,
      users,
      customers: accounts,
      contacts: contactsAllowed ? linked('crm_account_contacts') : [],
      activities: exportedActivities,
      activityCorrections: corrections,
      activityCorrectionProposals: correctionProposals,
      rfqs: linked('crm_rfqs'),
      quotes: linked('crm_quotes'),
      orders: linked('crm_orders'),
      evaluations,
    };
    return contactsAllowed ? payload : redactContactFields(payload);
  } finally { value.close(); }
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCrmCsv(user, query = {}, options = {}) {
  const value = exportCrmData(user, query, options);
  if (String(query.dataset || '').toLowerCase() === 'activities') {
    const headers = [
      '客户昵称', '正式名称', '客户编号', '本次进展', '活动类型', '渠道', '客户反应选项ID',
      '客户反应', '进展内容', '下一步计划', '下次跟进时间', '需要经理协助', '记录人', '发生时间',
      '更正ID', '更正状态', '原活动ID', '替代活动ID', '审批申请ID', '审批人ID', '有效状态', '更正原因',
    ];
    const rows = value.activities.map(row => [
      row.customer_nickname,
      row.customer_company_name,
      row.customer_number || row.external_customer_id || row.customer_id,
      row.progress_key || legacyProgressKey(row.activity_type, row.channel),
      row.activity_type,
      row.channel,
      row.reaction_option_id,
      row.reaction_label_snapshot || row.outcome,
      row.summary,
      row.next_action,
      row.next_action_at,
      row.manager_required ? '是' : '否',
      row.user_name || row.user_id,
      row.occurred_at,
      row.correctionId || '',
      row.correctionStatus || '',
      row.originalActivityId || '',
      row.replacementActivityId || '',
      row.proposalId || '',
      row.reviewerId || '',
      row.effective ? '是' : '否',
      row.correctionReason || '',
    ]);
    return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }
  const headers = ['昵称', '正式名称', '本地名称/别名', '英文名称', '客户编码', '国家', '行业', '阶段', '负责人', '优先级', '成立年份', '最近动作', '下一步'];
  const rows = value.customers.map(row => [
    row.nickname, row.company_name, row.russian_name, row.english_name, row.external_customer_id, row.country, row.industry, row.stageLabel,
    row.ownerName, row.priority, row.established_year || '', row.last_activity_at, row.next_action,
  ]);
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function protectedCustomerCsv(headers, rows) {
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
      if (payload.permissions !== undefined) {
        writeUserPermissionDifferences(value, userId, payload.permissions);
      }
      value.prepare(`INSERT INTO crm_audit_log
        (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        id('AUD'), actor.id, 'user_created', 'sales_user', userId,
        JSON.stringify({ role, permissionGroupId: group.id, personalPermissionCount:
          Number(value.prepare('SELECT COUNT(*) n FROM user_permission_overrides WHERE user_id=?').get(userId).n || 0) }),
        now, actor.id, actor.id, '',
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
    let permissionGroupChanged = false;
    let nextPermissionGroupId = user.permission_group_id || '';
    if (payload.permissionGroupId !== undefined) {
      const group = value.prepare('SELECT id,role_key FROM permission_groups WHERE id=?').get(String(payload.permissionGroupId));
      if (!group) throw notFound('权限组不存在');
      if (group.role_key !== role) throw badRequest('权限组角色与账号角色不匹配');
      fields.push('permission_group_id=?');
      params.push(group.id);
      nextPermissionGroupId = group.id;
      permissionGroupChanged = group.id !== user.permission_group_id;
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
      if (permissionGroupChanged) {
        const cleared = value.prepare('DELETE FROM user_permission_overrides WHERE user_id=?').run(userId).changes;
        value.prepare(`INSERT INTO crm_audit_log
          (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          id('AUD'), actor.id, 'user_permission_group_changed', 'sales_user', userId,
          JSON.stringify({
            previousPermissionGroupId: user.permission_group_id || '',
            permissionGroupId: nextPermissionGroupId,
            clearedPersonalPermissionCount: Number(cleared || 0),
          }),
          now, actor.id, actor.id, '',
        );
      }
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
  res.locals.auditErrorCode = error.code || '';
  return res.status(error.statusCode || fallbackStatus).json(payload);
}

function sendProtectedConflictError(res, error) {
  const statusCode = Number(error.statusCode);
  if (statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({
      ok: false,
      error: String(error.message || '身份冲突操作失败'),
      ...(error.code ? { code: String(error.code) } : {}),
    });
  }
  return res.status(500).json({
    ok: false,
    error: '身份冲突操作失败',
    code: 'PROTECTED_IDENTITY_CONFLICT_OPERATION_FAILED',
  });
}

function sendProtectedCustomerError(res, error) {
  const statusCode = Number(error.statusCode);
  if (statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({
      ok: false,
      error: String(error.message || '合作客户保护操作失败'),
      ...(error.code ? { code: String(error.code) } : {}),
    });
  }
  return res.status(500).json({
    ok: false,
    error: '合作客户保护操作失败',
    code: 'PROTECTED_CUSTOMER_OPERATION_FAILED',
  });
}

function listPage(input = {}, fallback = 50) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(
    input.pageSize || input.page_size, 10,
  ) || fallback));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function paginateProtectedCustomers(result, input = {}) {
  const pagination = listPage(input);
  const rows = result.items || [];
  const items = rows.slice(pagination.offset, pagination.offset + pagination.pageSize);
  return {
    ...result,
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total: rows.length,
    totalPages: Math.ceil(rows.length / pagination.pageSize),
    hasMore: pagination.offset + items.length < rows.length,
  };
}

function listProtectedConflictsPage(value, user, input = {}) {
  const pagination = listPage(input);
  const internalPageSize = 20;
  const firstInternalPage = Math.floor(pagination.offset / internalPageSize) + 1;
  const endOffset = pagination.offset + pagination.pageSize;
  const lastInternalPage = Math.max(firstInternalPage, Math.ceil(endOffset / internalPageSize));
  const pages = [];
  for (let page = firstInternalPage; page <= lastInternalPage; page += 1) {
    const result = listProtectedIdentityConflicts(value, user, {
      status: input.status, query: input.query, page,
    });
    pages.push(result);
    if (page >= Math.max(1, Number(result.totalPages || 0))) break;
  }
  const base = pages[0] || listProtectedIdentityConflicts(value, user, {
    status: input.status, query: input.query, page: 1,
  });
  const relativeOffset = pagination.offset - ((firstInternalPage - 1) * internalPageSize);
  const items = pages.flatMap(result => result.items || [])
    .slice(relativeOffset, relativeOffset + pagination.pageSize);
  return {
    ...base,
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: Math.ceil(Number(base.total || 0) / pagination.pageSize),
    hasMore: pagination.offset + items.length < Number(base.total || 0),
  };
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
  const activityCorrectionEnv = {
    CRM_ACTIVITY_CORRECTIONS_ENABLED: options.activityCorrectionsEnabled === undefined
      ? process.env.CRM_ACTIVITY_CORRECTIONS_ENABLED
      : options.activityCorrectionsEnabled,
  };
  const activityCorrectionOptions = req => ({
    env: activityCorrectionEnv,
    auditIdentity: auditIdentity(req),
    enqueueNotifications: enqueueActivityCorrectionNotifications,
  });
  const teamStatusEnv = {
    CRM_TEAM_STATUS_WRITES_ENABLED: options.teamStatusWritesEnabled === undefined
      ? process.env.CRM_TEAM_STATUS_WRITES_ENABLED
      : options.teamStatusWritesEnabled,
  };
  const teamStatusOptions = (value, req) => {
    const scope = teamStatusScope(value, req.salesUser);
    const features = featureState(value, hardFeatureFlags);
    return {
      env: teamStatusEnv,
      auditIdentity: auditIdentity(req),
      includeAI: features.ai_stations.effectiveEnabled,
      permissionVersion: getFilterPermissionVersion(value),
      resolveScope: () => scope,
      authorizeFilters: (user, ast, context = {}) => validateFilterQuery(
        value,
        user,
        context.page || ast.page,
        teamStatusFilterRaw(ast, context.page || ast.page),
      ),
      buildCapability: context => {
        const data = teamStatusCapabilityData(value, context.scope);
        return buildTeamReport(
          data.users, data.accounts, data.activities, data.rfqs, data.quotes, data.orders,
        );
      },
    };
  };
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

  app.use('/api/sales-crm/protected-customer-conflicts', (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  app.use('/api/sales-crm/protected-customers', (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  app.use('/api/sales-crm', requireSalesUser);
  app.use('/api/sales-crm', (req, res, next) => {
    const aiRead = req.method === 'GET'
      && (req.path.startsWith('/ai/') || req.path.startsWith('/api/sales-crm/ai/'));
    if (['HEAD', 'OPTIONS'].includes(req.method) || (req.method === 'GET' && !aiRead)) return next();
    res.on('finish', () => {
      let value;
      try {
        value = db();
        const identity = auditIdentity(req);
        const auditRoute = anonymousSalesRoute(req.method, req.path);
        const isImpersonating = Boolean(req.impersonation);
        const auditEntityCandidate = req.params?.customerId || req.params?.taskId || req.params?.userId
          || req.body?.customerId || req.body?.itemId || req.body?.intakeItemId || '';
        const auditEntityId = ['string', 'number'].includes(typeof auditEntityCandidate)
          ? String(auditEntityCandidate).trim().slice(0, 240)
          : '';
        if (res.statusCode === 403) {
          value.prepare(`INSERT INTO crm_audit_log
            (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
            id('AUD'), identity.userId, 'permission_denied', 'sales_route', auditEntityId,
            JSON.stringify({
              route: auditRoute,
              result: 'rejected',
              statusCode: res.statusCode,
              ...(res.locals.auditErrorCode ? { code: res.locals.auditErrorCode } : {}),
              permission: req.deniedPermission || 'target_scope',
            }),
            nowText(), identity.realUserId, identity.effectiveUserId, identity.contextId,
          );
          return;
        }
        if (res.statusCode >= 400) {
          if (!isImpersonating) return;
          value.prepare(`INSERT INTO crm_audit_log
            (id,user_id,action,entity_type,entity_id,detail_json,created_at,
             real_user_id,effective_user_id,impersonation_context_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
            id('AUD'), identity.userId, 'request_rejected', 'sales_route', auditEntityId,
            JSON.stringify({
              route: auditRoute,
              result: 'rejected',
              statusCode: res.statusCode,
              ...(res.locals.auditErrorCode ? { code: res.locals.auditErrorCode } : {}),
            }),
            nowText(), identity.realUserId, identity.effectiveUserId, identity.contextId,
          );
          return;
        }
        const aiRoute = req.path.startsWith('/ai/') || req.path.startsWith('/api/sales-crm/ai/');
        const protectedConflictRoute = req.path.startsWith('/protected-customer-conflicts')
          || req.path.startsWith('/api/sales-crm/protected-customer-conflicts');
        const protectedCustomerRoute = req.path.startsWith('/protected-customers')
          || req.path.startsWith('/api/sales-crm/protected-customers');
        const collaborationRoute = req.path.startsWith('/collaboration-support')
          || req.path.startsWith('/api/sales-crm/collaboration-support');
        const anonymousRoute = aiRoute || protectedConflictRoute || protectedCustomerRoute
          || collaborationRoute;
        value.prepare(`INSERT INTO crm_audit_log
          (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          id('AUD'), identity.userId, anonymousRoute ? auditRoute : `${req.method} ${req.path}`,
          aiRoute
            ? 'ai_station'
            : (protectedConflictRoute
              ? 'protected_customer_identity'
              : (protectedCustomerRoute
                ? 'protected_customer_lifecycle'
                : (collaborationRoute
                  ? 'collaboration_route'
                  : (req.path.split('/').filter(Boolean)[1] || 'crm')))),
          anonymousRoute ? '' : auditEntityId,
          JSON.stringify(isImpersonating
            ? { route: auditRoute, result: 'success', statusCode: res.statusCode }
            : (anonymousRoute
              ? { route: auditRoute }
              : redactAuditPayload({ params: req.params, body: req.body || {} }))),
          nowText(), identity.realUserId, identity.effectiveUserId, identity.contextId,
        );
      } catch (error) {
        console.error(JSON.stringify({
          event: 'crm_audit_write_failed',
          route: anonymousSalesRoute(req.method, req.path),
          statusCode: res.statusCode,
          errorCode: String(error?.code || 'AUDIT_WRITE_FAILED'),
        }));
      } finally {
        if (value) value.close();
      }
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
    const anyPermissions = policy.anyPermissions || [];
    if (anyPermissions.length && !anyPermissions.some(permission => hasPermission(req.salesUser, permission))) {
      req.deniedPermission = anyPermissions.join('|');
      return res.status(403).json({ ok: false, error: `没有权限：${anyPermissions.join(' 或 ')}` });
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
      res.locals.auditErrorCode = error.code || '';
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

  app.get('/api/sales-crm/filter-schema/:pageKey', (req, res) => {
    const value = db();
    try {
      const pageKey = String(req.params.pageKey || '');
      const features = pageKey === 'notifications'
        ? featureState(value, hardFeatureFlags)
        : null;
      const runtimeOptions = features
        ? {
          aiEnabled: features.ai_stations.effectiveEnabled,
          salesPackEnabled: features.sales_pack.effectiveEnabled,
        }
        : {};
      if (req.query?.filters) {
        runtimeOptions.linkageAst = authorizedFilterAst(
          value, req.salesUser, pageKey, req.query,
        );
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        schema: authorizedFilterSchema(value, req.salesUser, pageKey, runtimeOptions),
      });
    } catch (error) {
      sendApiError(res, error);
    } finally { value.close(); }
  });

  app.get('/api/sales-crm/team-status', (req, res) => {
    const value = db();
    try {
      const input = teamStatusRequest(
        value,
        req.salesUser,
        TEAM_STATUS_FILTER_PAGES.progress,
        req.query || {},
        TEAM_STATUS_READ_KEYS,
      );
      const result = paginateTeamProgress(
        buildTeamStatus(value, req.salesUser, input, teamStatusOptions(value, req)),
        input,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...result,
        schemas: {
          progress: authorizedFilterSchema(
            value, req.salesUser, TEAM_STATUS_FILTER_PAGES.progress,
          ),
          collaboration: authorizedFilterSchema(
            value, req.salesUser, TEAM_STATUS_FILTER_PAGES.collaboration,
          ),
        },
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/team-status/since-last-view', (req, res) => {
    const value = db();
    try {
      const input = teamStatusRequest(
        value,
        req.salesUser,
        TEAM_STATUS_FILTER_PAGES.progress,
        req.body || {},
        TEAM_STATUS_CURSOR_KEYS,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      const result = paginateTeamProgress(readTeamStatusSinceLastView(
        value, req.salesUser, input, teamStatusOptions(value, req),
      ), input);
      res.json({
        ok: true,
        ...result,
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/team-status/export', (req, res) => {
    const value = db();
    try {
      const section = String(req.query?.section || 'progress').toLowerCase();
      const filterPage = section === 'collaboration'
        ? TEAM_STATUS_FILTER_PAGES.collaboration
        : TEAM_STATUS_FILTER_PAGES.progress;
      const input = teamStatusRequest(
        value,
        req.salesUser,
        filterPage,
        req.query || {},
        TEAM_STATUS_EXPORT_KEYS,
      );
      const exported = exportTeamStatus(
        value, req.salesUser, input, teamStatusOptions(value, req),
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', exported.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
      res.send(exported.content);
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/collaboration-support', (req, res) => {
    const value = db();
    try {
      const input = teamStatusRequest(
        value,
        req.salesUser,
        TEAM_STATUS_FILTER_PAGES.collaboration,
        req.query || {},
        COLLABORATION_READ_KEYS,
      );
      const result = listCollaborationSupport(
        value, req.salesUser, input, teamStatusOptions(value, req),
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...result,
        schema: authorizedFilterSchema(
          value, req.salesUser, TEAM_STATUS_FILTER_PAGES.collaboration,
        ),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/collaboration-support/export', (req, res) => {
    const value = db();
    try {
      const input = teamStatusRequest(
        value,
        req.salesUser,
        TEAM_STATUS_FILTER_PAGES.collaboration,
        req.query || {},
        COLLABORATION_EXPORT_KEYS,
      );
      const exported = exportTeamStatus(value, req.salesUser, {
        ...input,
        section: 'collaboration',
      }, teamStatusOptions(value, req));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', exported.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
      res.send(exported.content);
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/collaboration-support', (req, res) => {
    const value = db();
    try {
      const event = recordExternalAssistance(
        value, req.salesUser, req.body || {}, teamStatusOptions(value, req),
      );
      res.status(event.deduplicated ? 200 : 201).json({ ok: true, event });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  const appendCollaborationEvent = (operation, action) => (req, res) => {
    const value = db();
    try {
      const event = operation(
        value,
        req.salesUser,
        req.params.eventId,
        req.body || {},
        teamStatusOptions(value, req),
      );
      res.status(event.deduplicated ? 200 : 201).json({ ok: true, event, action });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  };

  app.post('/api/sales-crm/collaboration-support/:eventId/supplements',
    appendCollaborationEvent(supplementCollaborationEvent, 'supplement'));
  app.post('/api/sales-crm/collaboration-support/:eventId/corrections',
    appendCollaborationEvent(correctCollaborationEvent, 'correction'));
  app.post('/api/sales-crm/collaboration-support/:eventId/revocations',
    appendCollaborationEvent(revokeCollaborationEvent, 'revocation'));

  app.get('/api/sales-crm/lists/:pageKey', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming(`sales-crm/lists/${req.params.pageKey}`, req, res, startedAt, () => counts);
    try {
      const payload = loadAuthorizedBusinessPage(
        req.salesUser,
        req.params.pageKey,
        req.query || {},
        {
          isImpersonating: Boolean(req.impersonation),
          hardFlags: hardFeatureFlags,
        },
      );
      counts = { page: payload.page, rows: payload.rows.length, total: payload.total };
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...payload });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.post('/api/sales-crm/today-tasks/actions', (req, res) => {
    try {
      res.json({
        ok: true,
        ...executeTodayTaskAction(
          req.salesUser,
          req.body || {},
          auditIdentity(req),
        ),
      });
    } catch (error) {
      sendApiError(res, error, 500);
    }
  });

  app.get('/api/sales-crm/accounts', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming('sales-crm/accounts', req, res, startedAt, () => counts);
    try {
      const payload = listCustomerAccounts(req.salesUser, req.query || {});
      counts = { page: payload.page, rows: payload.rows.length, total: payload.total };
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...payload });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.put('/api/sales-crm/customer-stars/:customerId', (req, res) => {
    try {
      res.json({
        ok: true,
        ...setCustomerStar(
          req.salesUser,
          req.params.customerId,
          req.body || {},
          auditIdentity(req),
        ),
      });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  app.get('/api/sales-crm/field-schema/:pageKey', (req, res) => {
    const pageKey = String(req.params.pageKey || '').trim();
    if (!listFieldPages().includes(pageKey)) {
      return sendApiError(res, httpError(404, '未知字段目录', 'FIELD_SCHEMA_NOT_FOUND'));
    }
    const value = db();
    try {
      const features = featureState(value, hardFeatureFlags);
      const schema = effectiveFieldSchema({
        pageKey,
        user: req.salesUser,
        permissions: req.salesUser?.permissions || {},
        features: { ai_stations: features.ai_stations.effectiveEnabled },
      });
      res.json({ ok: true, schema });
    } catch (error) {
      sendApiError(res, error);
    } finally {
      value.close();
    }
  });

  app.get('/api/sales-crm/profile/:customerId', (req, res) => {
    const value = db();
    try {
      const aiEnabled = featureState(value, hardFeatureFlags).ai_stations.effectiveEnabled;
      const payload = getCustomerProfileData(
        req.accessContext, req.params.customerId, {
          includeAI: aiEnabled,
          canEditNickname: hasPermission(req.salesUser, 'edit_customer')
            && canAccessCustomerMaster(value, req.salesUser, req.params.customerId),
        },
      );
      payload.accountContacts = profileContacts(value, req.salesUser, req.params.customerId);
      payload.contactAccess = {
        canView: hasPermission(req.salesUser, 'view_contacts'),
        canMaintain: hasPermission(req.salesUser, 'manage_customer_contacts')
          && canAccessCustomerMaster(value, req.salesUser, req.params.customerId),
      };
      const profileAccountId = String(payload.profileAccess?.accountId || '').trim();
      const profileAccount = profileAccountId
        ? value.prepare('SELECT id,external_customer_id FROM crm_accounts WHERE id=? LIMIT 1').get(profileAccountId)
        : null;
      const profileInsights = profileAccount ? loadInsights(value, [profileAccount]) : { contacts: [], evaluations: [] };
      payload.insightAccess = {
        canView: hasPermission(req.salesUser, 'view_insights') && Boolean(profileAccount),
        canManage: hasPermission(req.salesUser, 'manage_evaluations')
          && Boolean(profileAccount)
          && Boolean(payload.profileAccess?.crmAccessible),
      };
      payload.insights = {
        contacts: hasPermission(req.salesUser, 'view_contacts') ? profileInsights.contacts : [],
        evaluations: hasPermission(req.salesUser, 'view_insights')
          ? (aiEnabled ? profileInsights.evaluations : profileInsights.evaluations.map(withoutEvaluationAI))
          : [],
      };
      res.json(redactUnauthorizedProfileTags(value, req.salesUser, payload));
    }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/intake/:itemId/profile', (req, res) => {
    const value = db();
    try {
      const scope = buildIntakeQueryScope(req.salesUser, {}, { includeStatus: false });
      scope.filters.push('i.id=?');
      scope.params.push(String(req.params.itemId || '').trim());
      const item = value.prepare(`SELECT i.* FROM crm_intake_items i
        WHERE ${scope.filters.join(' AND ')} LIMIT 1`).get(...scope.params);
      if (!item) throw inaccessibleOrMissing(req.salesUser, '线索不存在');
      if (!item.external_customer_id) {
        const error = new Error('该线索未关联客户主档');
        error.statusCode = 409;
        throw error;
      }
      const aiEnabled = featureState(value, hardFeatureFlags).ai_stations.effectiveEnabled;
      const payload = getCustomerProfileData(req.accessContext, item.external_customer_id, {
        includeAI: aiEnabled,
        intakeReadOnly: true,
        intakeItemId: item.id,
        canEditNickname: hasPermission(req.salesUser, 'edit_customer')
          && canAccessCustomerMaster(value, req.salesUser, item.external_customer_id),
      });
      payload.identityWarning = leadIdentityWarningsForExternalCustomerIds(
        value,
        [item.external_customer_id],
      ).get(item.external_customer_id) || null;
      payload.accountContacts = profileContacts(value, req.salesUser, item.external_customer_id);
      payload.contactAccess = {
        canView: hasPermission(req.salesUser, 'view_contacts'),
        canMaintain: hasPermission(req.salesUser, 'manage_customer_contacts')
          && canAccessCustomerMaster(value, req.salesUser, item.external_customer_id),
      };
      res.json(redactUnauthorizedProfileTags(value, req.salesUser, payload));
    } catch (error) {
      sendApiError(res, error);
    } finally { value.close(); }
  });

  app.get('/api/sales-crm/profile/:customerId/tag-history', (req, res) => {
    const value = db();
    try {
      const allowed = allowedCustomerTagCategories(value, req.salesUser);
      res.json({
        ok: true,
        customerId: req.params.customerId,
        history: getCustomerTagHistory(
          req.accessContext, req.params.customerId, req.query || {},
        ).filter(item => allowed.has(item.tagCategory)),
      });
    } catch (error) {
      sendApiError(res, error);
    } finally { value.close(); }
  });

  app.post('/api/sales-crm/notifications/:notificationId/read', (req, res) => {
    const value = db();
    try {
      const notification = value.prepare(`SELECT n.*,a.id account_id
        FROM crm_notifications n
        LEFT JOIN crm_accounts a ON a.id=n.customer_id
        WHERE n.id=?`).get(req.params.notificationId);
      if (!notification) return res.status(404).json({ ok: false, error: '通知不存在' });
      const features = featureState(value, hardFeatureFlags);
      if (!notificationVisibleForFeatures(notification.code, features)) {
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
        const safePayload = hasPermission(req.salesUser, 'view_contacts')
          ? payload
          : redactContactFields(payload);
        res.json({ ok: true, ...safePayload });
      } finally { value.close(); }
    } catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/research/:kind', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming(`sales-crm/research/${req.params.kind}`, req, res, startedAt, () => counts);
    try {
      const result = loadResearchPage(req.salesUser, req.params.kind, req.query || {});
      counts = { page: result.page, rows: result.rows.length, total: result.total };
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...result });
    } catch (error) {
      sendApiError(res, error);
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
    try {
      const result = addAccount(req.salesUser, req.body || {}, {
        enrichmentFlags: runtimeEnrichmentFlags,
        auditIdentity: auditIdentity(req),
      });
      const publicResult = result.reviewRequired && req.salesUser.role === 'sales'
        ? { accepted: true, message: '该客户需要管理员确认，确认后可继续领取。' }
        : result;
      res.status(result.reviewRequired ? 202 : 200).json({ ok: true, ...publicResult });
    }
    catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/duplicate-reviews', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...listDuplicateReviews(req.salesUser, req.query || {}) });
    } catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/duplicate-reviews/:reviewId/candidates', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...duplicateCandidateSearch(req.salesUser, req.params.reviewId, req.query || {}),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.patch('/api/sales-crm/duplicate-reviews/:reviewId/candidate', (req, res) => {
    try {
      res.json({
        ok: true,
        ...replaceDuplicateReviewCandidate(
          req.salesUser, req.params.reviewId, req.body || {}, auditIdentity(req),
        ),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/duplicate-reviews/:reviewId/resolve', (req, res) => {
    try {
      res.json({
        ok: true,
        ...resolveDuplicateReview(
          req.salesUser, req.params.reviewId, req.body || {}, auditIdentity(req),
        ),
      });
    }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/duplicate-reviews/bulk-distinct', (req, res) => {
    try {
      res.json({
        ok: true,
        ...bulkResolveDuplicateDistinct(req.salesUser, req.body || {}, auditIdentity(req)),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/duplicate-reviews/recalculate', (req, res) => {
    try {
      res.json({
        ok: true,
        ...recalculateDuplicateReviews(req.salesUser, req.body || {}, auditIdentity(req)),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/accounts/bulk-assign', (req, res) => {
    try {
      res.json({ ok: true, ...bulkAssignAccounts(req.salesUser, req.body || {}, {
        realUserId: req.realUser?.id, effectiveUserId: req.salesUser?.id, contextId: req.impersonation?.contextId,
      }) });
    }
    catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/accounts/:customerId/history', (req, res) => {
    const value = db();
    try {
      const account = getHistoryAccountForUser(value, req.salesUser, req.params.customerId);
      if (!account) throw inaccessibleOrMissing(req.salesUser, '客户不存在');
      res.json({
        ok: true,
        timeline: buildAccountDevelopmentHistory(value, account),
        account: historyAccountSummary(account),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/accounts/recycle-bin', (req, res) => {
    try {
      res.json({
        ok: true,
        ...listRecycleBin(req.salesUser, req.query || {}, {
          isImpersonating: Boolean(req.impersonation),
        }),
      });
    }
    catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/accounts/:customerId/recycle-profile', (req, res) => {
    const value = db();
    try {
      const payload = loadRecycleProfile(req.salesUser, req.params.customerId, {
        hardFlags: hardFeatureFlags,
        isImpersonating: Boolean(req.impersonation),
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(redactUnauthorizedProfileTags(value, req.salesUser, payload));
    } catch (error) {
      sendApiError(res, error);
    } finally { value.close(); }
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

  app.post('/api/sales-crm/accounts/:customerId/reject', (req, res) => {
    try {
      res.json({ ok: true, ...rejectCrmCustomer(req.salesUser, req.params.customerId, req.body || {}, auditIdentity(req)) });
    } catch (error) { sendApiError(res, error); }
  });

  const sendMismatchProfileNotFound = res => {
    res.setHeader('Cache-Control', 'private, no-store');
    return sendApiError(res, mismatchRecordNotFound());
  };
  app.get('/api/sales-crm/mismatch-recycle//profile', (_req, res) => (
    sendMismatchProfileNotFound(res)
  ));
  app.get('/api/sales-crm/mismatch-recycle/:recordKey/profile', (req, res) => {
    try {
      const payload = loadMismatchRecordProfile(req.salesUser, req.params.recordKey, {
        hardFlags: hardFeatureFlags,
        isImpersonating: Boolean(req.impersonation),
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(payload);
    } catch (error) { sendApiError(res, error); }
  });
  app.use((error, req, res, next) => {
    const rawPath = String(req.originalUrl || '').split('?')[0];
    const malformedMismatchProfile = req.method === 'GET'
      && /^\/api\/sales-crm\/mismatch-recycle\/[^/]+\/profile$/.test(rawPath)
      && error instanceof URIError;
    if (!malformedMismatchProfile) return next(error);
    return sendMismatchProfileNotFound(res);
  });

  app.post('/api/sales-crm/mismatch-recycle/:recordKey/restore', (req, res) => {
    try {
      res.json({
        ok: true,
        ...restoreMismatchRecord(
          req.salesUser, req.params.recordKey, req.body || {}, auditIdentity(req),
        ),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.patch('/api/sales-crm/accounts/:customerId', (req, res) => {
    try {
      const identity = auditIdentity(req);
      res.json({
        ok: true,
        ...updateAccount(req.salesUser, req.params.customerId, req.body || {}, identity),
      });
    }
    catch (error) { sendApiError(res, error); }
  });

  app.patch('/api/sales-crm/customers/:externalCustomerId/nickname', (req, res) => {
    try {
      res.json({
        ok: true,
        ...updateCustomerNickname(
          req.salesUser,
          req.params.externalCustomerId,
          req.body || {},
          auditIdentity(req),
        ),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.patch('/api/sales-crm/master/:customerId', (req, res) => {
    try {
      res.json({
        ok: true,
        ...updateCustomerMaster(
          req.salesUser,
          req.params.customerId,
          req.body || {},
          auditIdentity(req),
        ),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/activity-customers', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...searchActivityCustomers(req.salesUser, req.query || {}) });
    } catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/activity-correction-targets', (req, res) => {
    const value = db();
    try {
      assertActivityCorrectionQuery(req.query || {}, { allowExclude: true });
      const ast = authorizedFilterAst(
        value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.targets, req.query || {},
      );
      const result = queryCorrectionTargets(value, req.salesUser, ast, req.query || {});
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        writeEnabled: correctionWriteEnabled(activityCorrectionEnv),
        ...result,
        customers: result.rows,
        schema: authorizedFilterSchema(
          value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.targets,
          { excludeCustomerId: req.query?.excludeCustomerId },
        ),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/activity-corrections', (req, res) => {
    const value = db();
    try {
      assertActivityCorrectionQuery(req.query || {});
      const ast = authorizedFilterAst(
        value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.corrections, req.query || {},
      );
      const result = queryActivityCorrections(value, req.salesUser, ast, req.query || {});
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        writeEnabled: correctionWriteEnabled(activityCorrectionEnv),
        ...result,
        corrections: result.rows,
        schema: authorizedFilterSchema(
          value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.corrections,
        ),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/activity-corrections', (req, res) => {
    const value = db();
    try {
      const options = activityCorrectionOptions(req);
      try {
        return res.json({
          ok: true,
          correction: correctActivity(value, req.salesUser, req.body || {}, options),
        });
      } catch (error) {
        if (error.code !== 'REQUIRES_APPROVAL') throw error;
        const proposal = proposeActivityCorrection(value, req.salesUser, req.body || {}, {
          ...options,
          reasonCodeOverride: error.details?.reasonCode || '',
        });
        return res.status(202).json({ ok: true, proposal });
      }
    } catch (error) { return sendApiError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/activity-correction-proposals', (req, res) => {
    const value = db();
    try {
      assertActivityCorrectionQuery(req.query || {});
      const ast = authorizedFilterAst(
        value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.proposals, req.query || {},
      );
      const result = queryActivityCorrectionProposals(
        value, req.salesUser, ast, req.query || {},
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        writeEnabled: correctionWriteEnabled(activityCorrectionEnv),
        ...result,
        proposals: result.rows,
        schema: authorizedFilterSchema(
          value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.proposals,
        ),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/activity-correction-proposals', (req, res) => {
    const value = db();
    try {
      const proposal = proposeActivityCorrection(
        value, req.salesUser, req.body || {}, activityCorrectionOptions(req),
      );
      res.status(proposal.deduplicated ? 200 : 202).json({ ok: true, proposal });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/activity-correction-proposals/:proposalId/review', (req, res) => {
    const value = db();
    try {
      res.json({
        ok: true,
        result: reviewActivityCorrection(value, req.salesUser, {
          ...(req.body || {}),
          proposalId: req.params.proposalId,
        }, activityCorrectionOptions(req)),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/activity-reactions', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...listActivityReactions(req.salesUser) });
    } catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/activity-reactions/admin', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...listActivityReactions(req.realUser, { includeInactive: true }) });
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/activity-reactions', (req, res) => {
    try {
      res.json({
        ok: true,
        ...createActivityReaction(req.realUser, req.body || {}, auditIdentity(req)),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.patch('/api/sales-crm/activity-reactions/:reactionId', (req, res) => {
    try {
      res.json({
        ok: true,
        ...renameActivityReaction(
          req.realUser, req.params.reactionId, req.body || {}, auditIdentity(req),
        ),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.put('/api/sales-crm/activity-reactions/order', (req, res) => {
    try {
      res.json({
        ok: true,
        ...reorderActivityReactions(req.realUser, req.body || {}, auditIdentity(req)),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.delete('/api/sales-crm/activity-reactions/:reactionId', (req, res) => {
    try {
      res.json({
        ok: true,
        ...removeActivityReaction(req.realUser, req.params.reactionId, auditIdentity(req)),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/export', (req, res) => {
    try {
      if (String(req.query.format || '').toLowerCase() === 'csv') {
        const dataset = String(req.query.dataset || '').toLowerCase();
        const filename = `crm-${dataset === 'activities' ? 'activities' : 'customers'}-${new Date().toISOString().slice(0, 10)}.csv`;
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

  app.post('/api/sales-crm/activities/plan-only', (req, res) => {
    try {
      res.json({ ok: true, ...planOnlyActivity(req.salesUser, req.body || {}, auditIdentity(req)) });
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/activities', (req, res) => {
    try { res.json({ ok: true, ...addActivity(req.salesUser, req.body || {}, { hardFlags: hardFeatureFlags }) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/accounts/:customerId/deferred-plan', (req, res) => {
    try {
      res.json({
        ok: true,
        ...deferAccountPlan(req.salesUser, req.params.customerId, req.body || {}, {
          realUserId: req.realUser?.id || req.salesUser.id,
          effectiveUserId: req.salesUser.id,
          contextId: req.impersonation?.contextId || '',
        }),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/manager-task-settings', (req, res) => {
    const value = db();
    try {
      assertManagerSettingsAdmin(req.salesUser);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, settings: getManagerTaskSettings(value) });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.patch('/api/sales-crm/manager-task-settings', (req, res) => {
    try {
      res.json({ ok: true, settings: updateManagerSettings(req.salesUser, req.body || {}) });
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/manager-tasks', (req, res) => {
    try {
      res.json({ ok: true, ...scanManagerTasks(req.salesUser, req.body || {}) });
    } catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/manager-tasks', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...loadAuthorizedBusinessPage(req.salesUser, 'manager_tasks', req.query || {}),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/manager-tasks/export', (req, res) => {
    try {
      const rows = [];
      for (let page = 1; ; page += 1) {
        const result = loadAuthorizedBusinessPage(req.salesUser, 'manager_tasks', {
          ...req.query,
          page: String(page),
          pageSize: '100',
        });
        rows.push(...result.rows);
        if (!result.hasMore) break;
      }
      const headers = ['任务ID', '客户编号', '客户名称', '当前负责人', '原因', '状态', '触发时间', '到期时间', '完结时间'];
      const reasonLabels = {
        consecutive_deferred: '连续暂未确定',
        first_contact_silence: '首次触达后沉默',
        planned_action_overdue: '计划动作超时',
        manager_assistance: '销售请求经理协助',
      };
      const body = rows.map(row => [
        row.id, row.customerId, row.companyName, row.ownerName || row.ownerId,
        reasonLabels[row.reason] || row.reason, row.status, row.triggeredAt, row.dueAt, row.resolvedAt,
      ]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="crm-manager-tasks-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(`\uFEFF${[headers, ...body].map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`);
    } catch (error) { return sendApiError(res, error); }
  });

  app.get('/api/sales-crm/manager-tasks/:taskId', (req, res) => {
    const value = db();
    try {
      const { task, account, riskAvailable } = managerTaskAccount(
        value, req.salesUser, req.params.taskId, { allowReadOnlyFallback: true },
      );
      const interventions = value.prepare(`SELECT id,task_id,actor_id,action,note,difficulty,
        business_change_json,result_json,created_at FROM crm_manager_interventions
        WHERE task_id=? ORDER BY created_at,id`).all(task.id).map(row => ({
        ...row,
        businessChange: json(row.business_change_json, {}),
        result: json(row.result_json, {}),
      }));
      const customerAssistanceHistory = value.prepare(`SELECT id,status,triggered_at,resolved_at,
        evidence_json,result_json FROM crm_manager_tasks
        WHERE customer_id=? AND reason='manager_assistance'
        ORDER BY triggered_at DESC,id DESC`).all(task.customerId).map(row => {
        const evidence = json(row.evidence_json, {});
        const result = json(row.result_json, {});
        const replied = result.action === 'manager_replied';
        const confirmed = result.action === 'sales_plan_confirmed';
        return {
          taskId: row.id,
          status: row.status,
          requestedAt: evidence.requestedAt || row.triggered_at || '',
          requestReason: evidence.requestReason || evidence.summary || '',
          originalPlan: evidence.originalPlan || '',
          replyText: replied ? String(result.result || '') : '',
          repliedAt: replied ? String(result.repliedAt || '') : '',
          confirmed,
          confirmedAt: confirmed ? String(result.confirmedAt || '') : '',
          nextAction: confirmed ? String(result.nextAction || '') : '',
          resolvedAt: row.resolved_at || '',
        };
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        task,
        account: {
          id: account.id,
          externalCustomerId: account.external_customer_id || '',
          companyName: account.company_name,
          ownerId: account.owner_id || '',
          stage: account.stage,
          sourceType: account.source_type || 'account',
          intakeItemId: account.intake_item_id || '',
        },
        interventions,
        customerAssistanceHistory,
        risk: riskAvailable
          ? buildCustomerPlanRisk(value, {
            user: req.salesUser,
            customerId: task.customerId,
          })
          : emptyCustomerPlanRisk(task, account),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/manager-tasks/:taskId/resolve', (req, res) => {
    try {
      res.json({
        ok: true,
        ...resolveManagerTaskAction(
          req.salesUser,
          req.params.taskId,
          req.body || {},
          auditIdentity(req),
        ),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/manager-metrics', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...loadAuthorizedBusinessPage(req.salesUser, 'manager_metrics', req.query || {}),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/manager-metrics/drilldown', (req, res) => {
    const value = db();
    try {
      assertPermission(req.salesUser, 'resolve_manager_tasks');
      if (!['admin', 'manager'].includes(String(req.salesUser?.role || ''))) throw forbidden('当前账号无权查看团队统计明细');
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...buildManagerMetricDrilldown(value, {
          user: req.salesUser,
          actorId: req.query.actorId,
          kind: req.query.kind,
          rangeDays: req.query.rangeDays,
          settings: getManagerTaskSettings(value),
          page: req.query.page,
          pageSize: req.query.pageSize,
        }),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/manager-risks', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...loadAuthorizedBusinessPage(req.salesUser, 'manager_risks', req.query || {}),
      });
    } catch (error) { sendApiError(res, error); }
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

  app.get('/api/sales-crm/protected-customer-conflicts', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const result = listProtectedConflictsPage(value, {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      }, {
        status: req.query.status,
        query: req.query.query,
        page: req.query.page,
        pageSize: req.query.pageSize || req.query.page_size,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendProtectedConflictError(res, error);
    } finally {
      value.close();
    }
  });

  app.post('/api/sales-crm/protected-customer-conflicts/rescan', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const conflictUser = {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      };
      const input = {
        status: req.body?.status,
        query: req.body?.query,
        page: req.body?.page,
        pageSize: req.body?.pageSize || req.body?.page_size,
      };
      const rescanResult = rescanProtectedIdentityConflicts(value, conflictUser, input);
      const result = listProtectedConflictsPage(value, conflictUser, input);
      return res.json({ ok: true, ...rescanResult, ...result });
    } catch (error) {
      return sendProtectedConflictError(res, error);
    } finally {
      value.close();
    }
  });

  app.post('/api/sales-crm/protected-customer-conflicts/:conflictId/resolve', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const conflictUser = {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      };
      const result = resolveProtectedIdentityConflict(value, conflictUser, {
        conflictId: req.params.conflictId,
        decision: req.body?.decision,
        targetExternalCustomerId: req.body?.targetExternalCustomerId,
        details: req.body?.details ?? req.body?.reason,
        expectedVersion: req.body?.expectedVersion,
      });
      if (result.status === 'resolved' && result.decision === 'link_existing'
          && !result.idempotent) {
        const conflictRow = value.prepare(`SELECT latest_external_customer_ids_json
          FROM crm_customer_identity_conflicts WHERE conflict_id=?`).get(req.params.conflictId);
        const linkedIds = json(conflictRow?.latest_external_customer_ids_json, []);
        const masterExternalCustomerId = String(result.targetExternalCustomerId || '');
        const leadExternalCustomerId = linkedIds
          .find(id => id !== masterExternalCustomerId) || '';
        if (leadExternalCustomerId && masterExternalCustomerId) {
          recordIdentityLinkTimeline(value, conflictUser, {
            leadExternalCustomerId,
            masterExternalCustomerId,
            note: identityConflictNote(req.body?.details ?? req.body?.reason),
          });
        }
      }
      return res.json({ ok: true, resolution: result });
    } catch (error) {
      return sendProtectedConflictError(res, error);
    } finally {
      value.close();
    }
  });

  app.post('/api/sales-crm/protected-customer-conflicts/:conflictId/supplement', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const conflictUser = {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      };
      const result = supplementIdentityConflict(value, conflictUser, {
        conflictId: req.params.conflictId,
        action: req.body?.action,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendProtectedConflictError(res, error);
    } finally {
      value.close();
    }
  });

  app.get('/api/sales-crm/protected-customers', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const result = paginateProtectedCustomers(listProtectedCustomers(value, {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      }, {
        status: req.query.status,
        query: req.query.query,
      }), req.query || {});
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendProtectedCustomerError(res, error);
    } finally {
      value.close();
    }
  });

  app.get('/api/sales-crm/protected-customers/template', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      assertProtectedCustomerAdmin({
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="protected-customer-template.csv"');
      return res.send(protectedCustomerCsv([
        'alphaNickname', 'companyName', 'country', 'city', 'website', 'industry',
        'customerType', 'productFocus',
      ], []));
    } catch (error) {
      return sendProtectedCustomerError(res, error);
    }
  });

  app.get('/api/sales-crm/protected-customers/export', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const result = listProtectedCustomers(value, {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      }, {
        status: req.query.status || 'all',
        query: req.query.query,
      });
      const headers = [
        'externalCustomerId', 'alphaNickname', 'crmNickname', 'companyName', 'status',
        'country', 'city', 'batchId', 'createdAt', 'activatedAt',
      ];
      const rows = result.items.map(item => headers.map(header => item[header]));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="protected-customer-mapping.csv"');
      return res.send(protectedCustomerCsv(headers, rows));
    } catch (error) {
      return sendProtectedCustomerError(res, error);
    } finally {
      value.close();
    }
  });

  app.post('/api/sales-crm/protected-customers/batches/preview', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const result = previewProtectedBatch(value, {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      }, req.body?.rows, {
        idempotencyKey: req.body?.idempotencyKey,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendProtectedCustomerError(res, error);
    } finally {
      value.close();
    }
  });

  app.post('/api/sales-crm/protected-customers/batches/:batchId/commit', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const result = commitProtectedBatch(value, {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      }, req.params.batchId, {
        idempotencyKey: req.body?.idempotencyKey,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendProtectedCustomerError(res, error);
    } finally {
      value.close();
    }
  });

  app.post('/api/sales-crm/protected-customers/:externalCustomerId/activate', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const result = activateProtectedCustomer(value, {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      }, req.params.externalCustomerId, req.body || {});
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendProtectedCustomerError(res, error);
    } finally {
      value.close();
    }
  });

  app.post('/api/sales-crm/protected-customers/batches/:batchId/rollback', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const result = rollbackProtectedBatch(value, {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      }, req.params.batchId, {
        idempotencyKey: req.body?.idempotencyKey,
        reason: req.body?.reason,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendProtectedCustomerError(res, error);
    } finally {
      value.close();
    }
  });

  app.get('/api/sales-crm/protected-customers/:externalCustomerId', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const result = getProtectedCustomer(value, {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      }, req.params.externalCustomerId);
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendProtectedCustomerError(res, error);
    } finally {
      value.close();
    }
  });

  app.patch('/api/sales-crm/protected-customers/:externalCustomerId', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const value = db();
    try {
      const result = updateProtectedCustomer(value, {
        ...req.salesUser,
        isImpersonating: Boolean(req.impersonation),
      }, req.params.externalCustomerId, req.body || {});
      return res.json({ ok: true, ...result });
    } catch (error) {
      return sendProtectedCustomerError(res, error);
    } finally {
      value.close();
    }
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
    try {
      const body = req.body || {};
      const unsupported = Object.keys(body).find(key => !['permissions', 'restoreDefault'].includes(key));
      if (unsupported) throw badRequest(`不支持的个人权限字段：${unsupported}`);
      if (body.restoreDefault === true) {
        res.json({ ok: true, ...restoreUserPermissions(value, req.salesUser, req.params.userId) });
        return;
      }
      res.json({ ok: true, ...replaceUserPermissions(value, req.salesUser, req.params.userId, body.permissions) });
    }
    catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/filter-permissions', (req, res) => {
    const value = db();
    try {
      assertPermission(req.salesUser, 'view_users');
      assertPermission(req.salesUser, 'manage_users');
      if (req.salesUser.role !== 'admin') {
        throw httpError(403, '只有管理员可以管理筛选权限', 'FILTER_ADMIN_REQUIRED');
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...filterPermissionAdminState(value) });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/filter-permissions', (req, res) => {
    const value = db();
    try {
      const body = req.body || {};
      const candidate = body.definition && typeof body.definition === 'object'
        && !Array.isArray(body.definition)
        ? body.definition
        : Object.fromEntries(Object.entries(body).filter(([key]) =>
          !['note', 'expectedVersion'].includes(key)));
      res.json({
        ok: true,
        ...createFilterDefinition(value, req.salesUser, candidate, {
          note: body.note,
          expectedVersion: body.expectedVersion,
        }),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.put('/api/sales-crm/filter-permissions/groups/:groupId', (req, res) => {
    const value = db();
    try {
      const body = req.body || {};
      res.json({
        ok: true,
        ...saveGroupFilterGrants(
          value,
          req.salesUser,
          req.params.groupId,
          Array.isArray(body.filterKeys) ? body.filterKeys : [],
          {
            note: body.note,
            expectedVersion: body.expectedVersion,
          },
        ),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.put('/api/sales-crm/filter-permissions/users/:userId', (req, res) => {
    const value = db();
    try {
      const body = req.body || {};
      const options = {
        note: body.note,
        expectedVersion: body.expectedVersion,
      };
      const result = body.restore === true
        ? restoreUserExtraFilterGrants(
          value, req.salesUser, req.params.userId, options,
        )
        : saveUserExtraFilterGrants(
          value,
          req.salesUser,
          req.params.userId,
          Array.isArray(body.filterKeys) ? body.filterKeys : [],
          options,
        );
      res.json({ ok: true, ...result });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.patch('/api/sales-crm/filter-permissions/definitions/:filterKey', (req, res) => {
    const value = db();
    try {
      const body = req.body || {};
      const patch = body.patch && typeof body.patch === 'object'
        ? body.patch
        : Object.fromEntries(Object.entries(body).filter(([key]) =>
          !['note', 'expectedVersion'].includes(key)));
      res.json({
        ok: true,
        ...updateFilterDefinition(
          value,
          req.salesUser,
          req.params.filterKey,
          patch,
          {
            note: body.note,
            expectedVersion: body.expectedVersion,
          },
        ),
      });
    } catch (error) { sendApiError(res, error); }
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
    try {
      res.json({
        ok: true,
        ...manageIntake(req.salesUser, req.body || {}, {
          hardFlags: hardFeatureFlags,
          identity: auditIdentity(req),
        }),
      });
    }
    catch (error) { sendApiError(res, error); }
  });

  app.patch('/api/sales-crm/intake/settings', (req, res) => {
    try { res.json({ ok: true, ...updateIntakeSettings(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/contacts', (req, res) => {
    try { res.json({ ok: true, ...createAccountContact(req.salesUser, req.body || {}, auditIdentity(req)) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.patch('/api/sales-crm/contacts/:contactId', (req, res) => {
    try {
      res.json({
        ok: true,
        ...updateAccountContact(
          req.salesUser, req.params.contactId, req.body || {}, auditIdentity(req),
        ),
      });
    } catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/contacts/:contactId/archive', (req, res) => {
    try {
      res.json({
        ok: true,
        ...archiveAccountContact(req.salesUser, req.params.contactId, auditIdentity(req)),
      });
    } catch (error) { sendApiError(res, error); }
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

  app.use('/api/sales-crm/ai/tasks', (req, res, next) => {
    if (req.method !== 'GET' || req.path !== '/') return next();
    req.query.pageSize = String(req.query.pageSize || req.query.page_size || 50);
    const sendJson = res.json.bind(res);
    res.json = payload => {
      if (!payload || !Array.isArray(payload.items)) return sendJson(payload);
      const page = Math.max(1, Number(payload.page || 1));
      const pageSize = Math.max(1, Number(payload.pageSize || 50));
      return sendJson({
        ...payload,
        totalPages: Math.ceil(Number(payload.total || 0) / pageSize),
        hasMore: ((page - 1) * pageSize) + payload.items.length < Number(payload.total || 0),
      });
    };
    return next();
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
  filterTodayTaskAlertsForUser,
  groupAlerts,
  buildCountryReport,
  buildCohortReport,
  buildTeamReport,
  chooseIntakeOwner,
  normalizeListQuery,
  scopedManagerTasksForTodayAlerts,
  scanDailyIntake,
  permissionsFor,
  hasPermission,
  safeUser,
  registerSalesCrm,
  requireUnifiedUser,
};
