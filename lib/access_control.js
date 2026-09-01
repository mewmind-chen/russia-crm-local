'use strict';

const { FIELDS_CATALOG } = require('./field_catalog');

const PERMISSION_DEFINITIONS = {
  view_dashboard: '经营驾驶舱',
  view_alerts: '今日待办',
  view_notifications: '通知中心',
  view_intake: '线索池',
  view_customers: 'CRM客户全景',
  view_development: '客户开发工作台',
  view_pool: '线索池',
  view_contacts: '客户联系人线索',
  view_recon: 'Recon 情报',
  view_pipeline: '推进管道',
  view_insights: '客户经营复盘',
  view_team: '团队状态',
  view_markets: '市场策略',
  view_users: '用户与权限',
  view_all_customers: '查看团队全部客户',
  manage_intake: '管理入库与分配',
  manage_customer_recycle: '管理客户回收站',
  reject_own_customer_mismatch: '标记本人客户不对口',
  view_own_mismatch_history: '不对口记录',
  manage_manual_customer_deletion: '管理手工客户回收',
  manage_customer_contacts: '维护客户联系人',
  create_customer: '新增CRM客户',
  edit_customer: '调整客户资料与负责人',
  record_activity: '记录客户动作',
  correct_own_activity: '更正本人客户动作',
  manage_activity_corrections: '管理客户动作更正',
  record_collaboration_support: '补记协作支持',
  record_quote: '记录报价',
  record_order: '记录订单',
  manage_evaluations: '维护客户经营复盘与AI标注',
  run_recon: '发起或重试Recon',
  use_prospect_agent: '使用外贸智能体',
  use_ai_assistant: '使用AI经营助手',
  cancel_ai_tasks: '取消AI任务',
  bulk_manage_ai_tasks: '批量管理AI任务',
  manage_ai_budgets: '配置AI预算',
  review_ai_tasks: '复核AI任务',
  manage_users: '管理账号与权限',
  manage_data_maintenance: '管理数据维护',
  manage_protected_customers: '客户保护与查重',
  manage_manager_task_settings: '配置主管提醒规则',
  resolve_manager_tasks: '主管协助事项',
  export_data: '导出数据',
};

const PERMISSION_DESCRIPTIONS = {
  view_contacts: '寻找并核实客户公司的采购、老板、工程师等潜在联系人；确认后进入正式客户联系人。',
  view_alerts: '销售仅查看本人负责客户及分配给本人的线索待办；经理和管理员沿用现有团队数据范围。',
};

const ROLE_PERMISSIONS = {
  admin: Object.fromEntries(Object.keys(PERMISSION_DEFINITIONS).map(key => [key, true])),
  manager: {
    view_dashboard: true, view_notifications: true, view_intake: true, view_customers: true, view_development: true,
    view_pool: true, view_contacts: true, view_recon: true, view_pipeline: true,
    view_alerts: true, view_insights: true, view_team: true, view_markets: true,
    view_users: false, view_all_customers: true, manage_intake: true, create_customer: true,
    manage_customer_recycle: true, manage_manual_customer_deletion: false,
    reject_own_customer_mismatch: true, view_own_mismatch_history: true,
    manage_customer_contacts: true,
    edit_customer: true, record_activity: true, correct_own_activity: true,
    manage_activity_corrections: true, record_collaboration_support: true,
    record_quote: true, record_order: true,
    manage_evaluations: true, run_recon: true, use_prospect_agent: true,
    use_ai_assistant: true, cancel_ai_tasks: true, bulk_manage_ai_tasks: true,
    manage_ai_budgets: false, review_ai_tasks: true,
    manage_users: false, manage_data_maintenance: false,
    manage_protected_customers: false,
    manage_manager_task_settings: false, resolve_manager_tasks: true,
    export_data: false,
  },
  sales: {
    view_dashboard: true, view_notifications: true, view_intake: true, view_customers: true, view_development: true,
    view_pool: true, view_contacts: true, view_recon: true, view_pipeline: true,
    view_alerts: true, view_insights: false, view_team: false, view_markets: false,
    view_users: false, view_all_customers: false, manage_intake: false, create_customer: false,
    manage_customer_recycle: false, manage_manual_customer_deletion: false,
    reject_own_customer_mismatch: true, view_own_mismatch_history: true,
    manage_customer_contacts: true,
    edit_customer: false, record_activity: true, correct_own_activity: true,
    manage_activity_corrections: false, record_collaboration_support: false,
    record_quote: true, record_order: true,
    manage_evaluations: false, run_recon: false, use_prospect_agent: false,
    use_ai_assistant: false, cancel_ai_tasks: false, bulk_manage_ai_tasks: false,
    manage_ai_budgets: false, review_ai_tasks: false,
    manage_users: false, manage_data_maintenance: false,
    manage_protected_customers: false,
    manage_manager_task_settings: false, resolve_manager_tasks: false,
    export_data: false,
  },
};

const CONTACT_KEYS = new Set([
  'email', 'phone', 'contact', 'contactname', 'contacttitle', 'contactmethods',
  'methodssummary', 'fullname', 'fullnamelocal', 'title', 'personsummary',
  'contactsummary', 'contactssummary', 'contactsignal', 'contactcount',
  'salesreadycontactcount', 'contactlastcheckedat',
  'contactnextaction', 'contactreconstatus', 'bestpersonid', 'bestcontactlevel',
  'contactlevel', 'decisionrole', 'rolecategory', 'procurementrelevance',
  'employmentstatus', 'employmentconfidence', 'salesready', 'personid',
  'evidence', 'evidenceurls', 'method', 'methods', 'resultjson', 'reportpath', 'reporturl',
  'error', 'stdout', 'stderr', 'logtail', 'terminal',
  'notes', 'feedback', 'reason', 'invalidreason', 'nextaction', 'description',
  'opportunitysummary', 'opportunitydo', 'opportunityneed', 'opportunitysell',
  'opportunitydecision', 'outreachangle',
  'summary', 'outcome', 'reactionsnapshot', 'reactionlabelsnapshot',
  'detail', 'action', 'masterdescription', 'deepreport',
  'sourcefile', 'decisionreason', 'returnreason', 'lossreason', 'failurereason',
  'validationerror', 'detailjson', 'payloadjson',
  'products', 'productfocus', 'recommendedproducts', 'businesssummary',
  'evaluationtext', 'aisummary', 'ailabels', 'aiorderkeys', 'airisks',
  'aistrategy', 'aierror',
  'query', 'needsignal', 'sellsignal', 'decision', 'sourcesummary',
  'industryfocus', 'sourcemix', 'url', 'snippet',
]);

const ALERT_COPY_KEYS = new Set(['title', 'detail', 'action']);

const CONTACT_SAFE_POOL_KEYS = new Set([
  'customerid', 'domain', 'companyname', 'nickname', 'russianname', 'englishname', 'country', 'city',
  'website', 'industry', 'customertype', 'rating', 'currentpool', 'inn', 'riskstatus',
  'websiteverification', 'firstfound', 'lastfound', 'searchcount', 'verified',
  'sanctionstatus', 'createdat', 'updatedat',
  'isrisk', 'riskreasons', 'incrm', 'crmaccountid', 'ownername', 'intakestatus',
  'leadownername', 'screeningrisklevel',
]);

const CONTACT_SAFE_RECON_KEYS = new Set([
  'jobid', 'customerid', 'companyname', 'website', 'industry', 'customertype', 'city', 'inn',
  'rating', 'score', 'employees', 'currentpool', 'riskstatus', 'websiteverification', 'verified',
  'qualitystatus', 'step5status', 'step5plusstatus', 'sanctionstatus', 'priority',
  'compliancestatus', 'sanctioned', 'sanctionsource', 'sanctionprogram', 'sanctioncheckedat',
  'evidencecount', 'updatedat',
]);

// Whitelist projection for CRM account rows (list/bootstrap/pipeline/drawer sources).
// It mirrors the keys the legacy CONTACT_KEYS blacklist keeps on account rows, so
// switching a call site must not change which fields are visible. New sensitive
// account fields must be added to the field catalog; only catalog fields that are
// not contact-sensitive join the whitelist, so new display fields follow the
// catalog instead of the blacklist while sensitive ones never leak.
const CATALOG_ACCOUNT_SOURCE_KEYS = new Set(
  [].concat(FIELDS_CATALOG.crm_drawer || [], FIELDS_CATALOG.customer_profile || [])
    .map(field => String(field.sourceKey || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(key => key && !CONTACT_KEYS.has(key)),
);
const CONTACT_SAFE_ACCOUNT_KEYS = new Set([
  'id', 'externalcustomerid', 'nickname', 'priority', 'potentialvalue', 'stage', 'ownerid',
  'createdby', 'firstclaimedby', 'firstclaimedat', 'managerid', 'managerrequired',
  'managerstatus', 'lastactivityat', 'createdat', 'updatedat',
  'nextactionat', 'nextactiontimebasis',
  'intakeitemid', 'assignmentstatus', 'assignedat', 'claimdueat', 'claimedat',
  'lifecyclestatus', 'recyclekind', 'recyclereason', 'recycledby',
  'recycledat', 'previousownerid', 'establishedyear',
  'ownername', 'managername', 'creatorname', 'currentpool', 'rating', 'stagelabel',
  'customertags', 'state', 'istestdata', 'testrunid',
  // Customer-pool master fields are not contact-sensitive. The upstream
  // pool projection still redacts recon/contact fields by permission before
  // this whitelist is applied, so these aliases can remain visible to users
  // without view_contacts while preserving the old contact boundary.
  'poolcustomerid', 'pooldomain', 'poolcompanyname', 'poolnickname',
  'poolrussianname', 'poolenglishname', 'poolcountry', 'poolcity',
  'poolwebsite', 'poolindustry', 'poolcustomertype', 'poolestablishedyear',
  'pooldescription', 'poolproducts', 'poolrating', 'poolcurrentpool',
  'poolinn', 'poolriskstatus', 'poolwebsiteverification', 'pooldeepreport',
  'poolsourcefile', 'poolfirstfound', 'poollastfound', 'poolsearchcount',
  'poolverified', 'poolnotes', 'poolcreatedat', 'poolupdatedat',
  ...CATALOG_ACCOUNT_SOURCE_KEYS,
]);

// Insights evaluation rows use camelCase account keys plus evaluation metadata.
const CONTACT_SAFE_INSIGHTS_KEYS = new Set([
  'customerid', 'externalcustomerid', 'companyname', 'nickname', 'country', 'city',
  'stage', 'priority', 'ownerid', 'ownername',
  'evaluationcount', 'evaluationstatus', 'latestevaluationid', 'subjecttype',
  'subjectid', 'subjectname', 'subjecttitle', 'authorname',
  'authorid', 'aistatus', 'ailabelsjson', 'airisksjson', 'evaluatedat', 'evaluationupdatedat',
]);

// Intake item rows (intake/lead_flow pages) mirror the keys the legacy
// CONTACT_KEYS blacklist keeps on crm_intake_items rows; contact-name,
// contact-methods, decision-reason and return-reason stay hidden.
const CONTACT_SAFE_INTAKE_KEYS = new Set([
  'id', 'batchid', 'externalcustomerid', 'crmcustomerid', 'companyname',
  'country', 'website', 'industry', 'customertype', 'matchscore', 'matchgroup',
  'status', 'suggestedownerid', 'assignedownerid', 'assignedat', 'claimdueat',
  'claimedat', 'createdat', 'updatedat', 'duplicatereviewid', 'duplicatestate',
  'rejectedby', 'rejectedat', 'previousownerid', 'supplementrequirement',
  'supplementpendingjson', 'nickname', 'suggestedownername', 'assignedownername',
  // Keep non-contact customer-pool master fields after the permission-aware
  // projection/redaction step. Phone/email/contact-recon aliases are
  // intentionally excluded and remain view_contacts/view_recon gated.
  'poolcustomerid', 'pooldomain', 'poolcompanyname', 'poolnickname',
  'poolrussianname', 'poolenglishname', 'poolcountry', 'poolcity',
  'poolwebsite', 'poolindustry', 'poolcustomertype', 'poolestablishedyear',
  'pooldescription', 'poolproducts', 'poolrating', 'poolcurrentpool',
  'poolinn', 'poolriskstatus', 'poolwebsiteverification', 'pooldeepreport',
  'poolsourcefile', 'poolfirstfound', 'poollastfound', 'poolsearchcount',
  'poolverified', 'poolnotes', 'poolcreatedat', 'poolupdatedat',
]);

// Notification rows (no-view_contacts) keep identifiers/status but strip the
// title/detail copy (both are in CONTACT_KEYS, so the legacy blacklist drops
// them too; faithful mirror means the whitelist keeps exactly the same keys).
const CONTACT_SAFE_NOTIFICATION_KEYS = new Set([
  'id', 'recipientid', 'recipientname', 'customerid', 'code', 'severity',
  'status', 'createdat', 'readat', 'webdeliverystatus', 'wecomdeliverystatus',
  'wecomstatus',
]);

// Timeline events (claim/activity/rfq/quote/order) keep structural keys and
// provenance but strip the copy fields (title/summary/next_action/outcome are
// CONTACT_KEYS). provenance holds only structural ids/kinds — leak-checked.
const CONTACT_SAFE_TIMELINE_KEYS = new Set([
  'id', 'customerid', 'kind', 'eventtype', 'noplan', 'managerrequired',
  'actorname', 'occurredat', 'provenance', 'superseded', 'supersededby',
  'activityid',
]);

// Audit log rows keep provenance/user identity fields but strip action
// ('action' is a CONTACT_KEYS member, mirroring the blacklist).
const CONTACT_SAFE_AUDIT_LOG_KEYS = new Set([
  'id', 'userid', 'entitytype', 'entityid', 'createdat', 'realuserid',
  'effectiveuserid', 'impersonationcontextid', 'username', 'realusername',
  'effectiveusername',
]);

// Today-task alert rows keep business keys plus alert-copy fields; nested
// alert-copy records (reasons/otherReasons) keep the same merged key set.
const CONTACT_SAFE_ALERT_KEYS = new Set([
  'id', 'code', 'severity', 'customerid', 'companyname', 'officialcompanyname',
  'nickname', 'externalcustomerid', 'intakeitemid', 'ownerid', 'ownername',
  'assignedat', 'actionkind', 'allowedactions', 'dueat', 'stage',
  'customerpriority', 'overduehours', 'updatedat',
  'reasoncount', 'urgency', 'urgencylabel', 'maxoverduehours',
  'reasons', 'otherreasons', 'managerrequest', 'managerreply',
  'requesterid', 'requestername', 'requestedat', 'progress',
  'repliedbyid', 'repliedbyname', 'repliedat', 'result', 'originalplan',
  'contacts', ...ALERT_COPY_KEYS,
]);

// Pipeline action rows add reaction/queue fields on top of the account row shape;
// the whitelist keeps the exact keys the legacy blacklist would retain.
const CONTACT_SAFE_PIPELINE_KEYS = new Set([
  ...CONTACT_SAFE_ACCOUNT_KEYS,
  'latestreaction', 'latestprogresskey', 'latestactivitysummary',
  'rfqcount', 'quotecount', 'ordercount',
  'actionqueuekeys', 'actionqueuelabels',
]);

const LEGACY_ROUTE_POLICIES = Object.freeze({
  'GET /session/capabilities': { permissions: [] },
  'GET /initial': { permissions: ['view_development'] },
  'GET /customers': { permissions: ['view_pool'] },
  'GET /customers/:customerId/people': { permissions: ['view_contacts'] },
  'GET /contact-recon/state': { permissions: ['view_contacts'] },
  'GET /recon/results/:jobId': { permissions: ['view_recon'] },
  'GET /report': { permissions: ['view_recon', 'view_contacts'] },
  'GET /recon-monitor': { permissions: ['view_recon'] },
  'GET /quality/issues': { permissions: ['view_recon', 'view_all_customers'] },
  'GET /delivery/latest': { permissions: ['view_intake'] },
  'GET /delivery/file': { permissions: ['view_intake'] },
  'POST /assistant/chat': { permissions: ['use_ai_assistant'] },
  'GET /assistant/conversations': { permissions: ['use_ai_assistant'] },
  'POST /assistant/conversations': { permissions: ['use_ai_assistant'], blockedWhileImpersonating: true },
  'GET /assistant/conversations/:conversationId': { permissions: ['use_ai_assistant'] },
  'PATCH /assistant/conversations/:conversationId': { permissions: ['use_ai_assistant'], blockedWhileImpersonating: true },
  'GET /assistant/runtime': { permissions: ['use_ai_assistant'] },
  'PATCH /assistant/runtime': { permissions: ['manage_users'], blockedWhileImpersonating: true },
  'POST /assistant/runtime/recheck': { permissions: ['manage_users'], blockedWhileImpersonating: true },
});

const LEGACY_ACTION_POLICIES = Object.freeze({
  app: {
    updateCustomer: { permissions: ['edit_customer'] },
    createTag: { permissions: ['edit_customer'] },
    setCustomerTags: { permissions: ['edit_customer'] },
    removeCustomerTag: { permissions: ['edit_customer'] },
    createReconJob: { permissions: ['run_recon', 'view_recon'], blockedWhileImpersonating: true },
    retryReconJob: { permissions: ['run_recon', 'view_recon'], blockedWhileImpersonating: true },
    createContactReconJob: { permissions: ['run_recon', 'view_contacts'], blockedWhileImpersonating: true },
  },
  'prospect-agent': {
    createTask: { permissions: ['use_prospect_agent'] },
    rerunTask: { permissions: ['use_prospect_agent'] },
    promoteCandidate: { permissions: ['use_prospect_agent', 'edit_customer'] },
  },
});

const SALES_ROUTE_POLICIES = Object.freeze({
  'GET /bootstrap': { permissions: [] },
  'GET /filter-schema/:pageKey': { permissions: [] },
  'GET /field-schema/:pageKey': { permissions: [] },
  'GET /lists/:pageKey': { permissions: [] },
  'GET /accounts/:customerId/history': { permissions: ['view_customers'] },
  'PUT /customer-stars/:customerId': { permissions: ['view_customers'] },
  'POST /accounts/:customerId/reject': {
    anyPermissions: ['manage_customer_recycle', 'reject_own_customer_mismatch'],
  },
  'POST /accounts/:customerId/deferred-plan': {
    permissions: ['record_activity'],
  },
  'GET /manager-task-settings': { permissions: ['manage_manager_task_settings'] },
  'PATCH /manager-task-settings': {
    permissions: ['manage_manager_task_settings'],
    blockedWhileImpersonating: true,
  },
  'GET /manager-tasks': { permissions: ['resolve_manager_tasks'] },
  'POST /manager-tasks': {
    permissions: ['resolve_manager_tasks'],
    blockedWhileImpersonating: true,
  },
  'GET /manager-tasks/:taskId': { permissions: ['resolve_manager_tasks'] },
  'POST /manager-tasks/:taskId/resolve': {
    permissions: ['resolve_manager_tasks'],
  },
  'GET /manager-metrics': { permissions: ['resolve_manager_tasks'] },
  'GET /manager-metrics/drilldown': { permissions: ['resolve_manager_tasks'] },
  'GET /manager-risks': { permissions: ['resolve_manager_tasks'] },
  'GET /manager-tasks/export': {
    permissions: ['resolve_manager_tasks', 'export_data'],
  },
  'GET /team-status': { permissions: ['view_team'] },
  'POST /team-status/since-last-view': {
    permissions: ['view_team'], blockedWhileImpersonating: true,
  },
  'GET /team-status/export': { permissions: ['view_team', 'export_data'] },
  'GET /collaboration-support': { permissions: ['view_customers'] },
  'GET /collaboration-support/export': {
    permissions: ['view_customers', 'export_data'],
  },
  'POST /collaboration-support': {
    permissions: ['record_collaboration_support'], blockedWhileImpersonating: true,
  },
  'POST /collaboration-support/:eventId/supplements': {
    permissions: ['record_collaboration_support'], blockedWhileImpersonating: true,
  },
  'POST /collaboration-support/:eventId/corrections': {
    permissions: ['record_collaboration_support'], blockedWhileImpersonating: true,
  },
  'POST /collaboration-support/:eventId/revocations': {
    permissions: ['record_collaboration_support'], blockedWhileImpersonating: true,
  },
  'POST /today-tasks/actions': {
    permissions: ['view_alerts'],
  },
  'GET /accounts': { permissions: ['view_customers'] },
  'POST /notifications/:notificationId/read': { permissions: ['view_customers'] },
  'GET /intake': { permissions: ['view_intake'] },
  'GET /intake/:itemId/profile': { permissions: ['view_intake'] },
  'GET /profile/:customerId': { permissions: ['view_customers'] },
  'GET /profile/:customerId/tag-history': { permissions: ['view_customers'] },
  'PATCH /profile/:customerId/follow': { permissions: ['edit_customer'] },
  'POST /tags': { permissions: ['edit_customer'] },
  'PUT /profile/:customerId/tags': { permissions: ['edit_customer'] },
  'DELETE /profile/:customerId/tags/:tagId': { permissions: ['edit_customer'] },
  'GET /profile/:customerId/recon/:jobId': { permissions: ['view_recon'] },
  'POST /profile/:customerId/recon': { permissions: ['run_recon', 'view_recon'] },
  'POST /profile/:customerId/recon/:jobId/retry': { permissions: ['run_recon', 'view_recon'] },
  'PATCH /master/:customerId': {
    permissions: ['edit_customer'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'GET /research/pool': { permissions: ['view_pool'] },
  'GET /research/people': { permissions: ['view_contacts'] },
  'GET /research/recon': { permissions: ['view_recon'] },
  'POST /accounts': { permissions: ['create_customer'] },
  'GET /duplicate-reviews': { permissions: ['view_all_customers', 'manage_intake'] },
  'GET /duplicate-reviews/:reviewId/candidates': {
    permissions: ['view_all_customers', 'manage_intake'],
  },
  'PATCH /duplicate-reviews/:reviewId/candidate': {
    permissions: ['view_all_customers', 'manage_intake'],
    blockedWhileImpersonating: true,
  },
  'POST /duplicate-reviews/:reviewId/resolve': {
    permissions: ['view_all_customers', 'manage_intake'],
    blockedWhileImpersonating: true,
  },
  'POST /duplicate-reviews/bulk-distinct': {
    permissions: ['view_all_customers', 'manage_intake'],
    blockedWhileImpersonating: true,
  },
  'POST /duplicate-reviews/recalculate': {
    permissions: ['view_all_customers', 'manage_intake'],
    blockedWhileImpersonating: true,
  },
  'GET /protected-customer-conflicts': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'POST /protected-customer-conflicts/:conflictId/resolve': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'POST /protected-customer-conflicts/rescan': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'POST /protected-customer-conflicts/:conflictId/supplement': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'GET /protected-customers': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'GET /protected-customers/template': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'GET /protected-customers/export': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'GET /protected-customers/:externalCustomerId': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'PATCH /protected-customers/:externalCustomerId': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'POST /protected-customers/batches/preview': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'POST /protected-customers/batches/:batchId/commit': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'POST /protected-customers/:externalCustomerId/activate': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'POST /protected-customers/batches/:batchId/rollback': {
    permissions: ['manage_protected_customers'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  },
  'POST /accounts/bulk-assign': { permissions: ['view_customers', 'edit_customer', 'view_all_customers', 'manage_intake'] },
  'GET /accounts/recycle-bin': { permissions: ['manage_customer_recycle'] },
  'GET /accounts/:customerId/recycle-profile': { permissions: ['manage_customer_recycle'] },
  'POST /accounts/bulk-return': { permissions: ['manage_customer_recycle'] },
  'POST /accounts/:customerId/return': { permissions: ['manage_customer_recycle'] },
  'POST /accounts/:customerId/trash': { permissions: ['manage_manual_customer_deletion'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /accounts/:customerId/restore': { permissions: ['manage_manual_customer_deletion'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /accounts/:customerId/reassign': { permissions: ['manage_customer_recycle'] },
  'GET /mismatch-recycle/:recordKey/profile': {
    anyPermissions: ['manage_customer_recycle', 'view_own_mismatch_history'],
  },
  'POST /mismatch-recycle/:recordKey/restore': { permissions: ['manage_customer_recycle'] },
  'PATCH /accounts/:customerId': { permissions: ['edit_customer'] },
  'PATCH /customers/:externalCustomerId/nickname': { permissions: ['edit_customer'] },
  'GET /export': { permissions: ['export_data', 'view_customers'] },
  'GET /activity-customers': { permissions: ['record_activity'] },
  'GET /activity-correction-targets': {
    anyPermissions: ['correct_own_activity', 'manage_activity_corrections'],
  },
  'GET /activity-corrections': {
    anyPermissions: ['correct_own_activity', 'manage_activity_corrections'],
  },
  'POST /activity-corrections': {
    permissions: ['correct_own_activity'], blockedWhileImpersonating: true,
  },
  'GET /activity-correction-proposals': { permissions: ['manage_activity_corrections'] },
  'POST /activity-correction-proposals': {
    permissions: ['correct_own_activity'], blockedWhileImpersonating: true,
  },
  'POST /activity-correction-proposals/:proposalId/review': {
    permissions: ['manage_activity_corrections'], blockedWhileImpersonating: true,
  },
  'GET /activity-reactions': { permissions: ['record_activity'] },
  'GET /activity-reactions/admin': {
    permissions: [], realAdminOnly: true, blockedWhileImpersonating: true,
  },
  'POST /activity-reactions': {
    permissions: [], realAdminOnly: true, blockedWhileImpersonating: true,
  },
  'PATCH /activity-reactions/:reactionId': {
    permissions: [], realAdminOnly: true, blockedWhileImpersonating: true,
  },
  'PUT /activity-reactions/order': {
    permissions: [], realAdminOnly: true, blockedWhileImpersonating: true,
  },
  'DELETE /activity-reactions/:reactionId': {
    permissions: [], realAdminOnly: true, blockedWhileImpersonating: true,
  },
  'POST /activities/plan-only': { permissions: ['view_alerts', 'record_activity'] },
  'POST /activities': { permissions: ['record_activity'] },
  'POST /quotes': { permissions: ['record_quote'] },
  'POST /orders': { permissions: ['record_order'] },
  'POST /users': { permissions: ['view_users', 'manage_users'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /users/:userId/password-reset': { permissions: ['view_users', 'manage_users'], adminOnly: true, blockedWhileImpersonating: true },
  'PATCH /users/:userId': { permissions: ['view_users', 'manage_users'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /users/:userId/archive': { permissions: ['view_users', 'manage_users'], adminOnly: true, blockedWhileImpersonating: true },
  'POST /users/:userId/restore': { permissions: ['view_users', 'manage_users'], adminOnly: true, blockedWhileImpersonating: true },
  'DELETE /users/:userId': { permissions: ['view_users', 'manage_users'], adminOnly: true, blockedWhileImpersonating: true },
  'GET /permission-groups': { permissions: ['view_users'] },
  'POST /permission-groups': { permissions: ['view_users', 'manage_users'], realAdminOnly: true, blockedWhileImpersonating: true },
  'PATCH /permission-groups/:groupId': { permissions: ['view_users', 'manage_users'], realAdminOnly: true, blockedWhileImpersonating: true },
  'PUT /users/:userId/permission-overrides': { permissions: ['view_users', 'manage_users'], realAdminOnly: true, blockedWhileImpersonating: true },
  'GET /filter-permissions': { permissions: ['view_users', 'manage_users'], adminOnly: true },
  'POST /filter-permissions': { permissions: ['view_users', 'manage_users'], adminOnly: true, blockedWhileImpersonating: true },
  'PUT /filter-permissions/groups/:groupId': { permissions: ['view_users', 'manage_users'], adminOnly: true, blockedWhileImpersonating: true },
  'PUT /filter-permissions/users/:userId': { permissions: ['view_users', 'manage_users'], adminOnly: true, blockedWhileImpersonating: true },
  'PATCH /filter-permissions/definitions/:filterKey': { permissions: ['view_users', 'manage_users'], adminOnly: true, blockedWhileImpersonating: true },
  'POST /migration-review/:reviewId': { permissions: ['view_users', 'manage_users'], blockedWhileImpersonating: true },
  'POST /impersonation/start': { permissions: ['view_users', 'manage_users'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /impersonation/stop': { permissions: [], impersonationControl: true },
  'GET /data-maintenance/capabilities': { permissions: ['manage_data_maintenance'], realAdminOnly: true, blockedWhileImpersonating: true },
  'GET /data-maintenance/runs': { permissions: ['manage_data_maintenance'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /data-maintenance/preview': { permissions: ['manage_data_maintenance'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /data-maintenance/execute': { permissions: ['manage_data_maintenance'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /password': { permissions: [], blockedWhileImpersonating: true },
  'POST /intake/scan': {
    permissions: ['view_intake', 'manage_intake'], blockedWhileImpersonating: true,
  },
  'POST /intake/action': { permissions: ['view_intake'] },
  'PATCH /intake/settings': {
    permissions: ['view_intake', 'manage_intake'], blockedWhileImpersonating: true,
  },
  'POST /contacts': { permissions: ['view_contacts', 'manage_customer_contacts'] },
  'PATCH /contacts/:contactId': { permissions: ['view_contacts', 'manage_customer_contacts'] },
  'POST /contacts/:contactId/archive': { permissions: ['view_contacts', 'manage_customer_contacts'] },
  'POST /evaluations': { permissions: ['manage_evaluations'] },
  'POST /evaluations/:evaluationId/retry': { permissions: ['manage_evaluations'] },
  'GET /ai/customers/:customerId/results': { permissions: ['view_customers'] },
  'GET /ai/features': {
    permissions: ['manage_users'], realAdminOnly: true, blockedWhileImpersonating: true,
  },
  'PATCH /ai/features/:featureKey': {
    permissions: ['manage_users'], realAdminOnly: true, blockedWhileImpersonating: true,
  },
  'GET /ai/governance': {
    permissions: ['view_customers', 'view_team'],
  },
  'POST /ai/jobs/:jobId/feedback': {
    permissions: ['view_customers', 'view_team', 'review_ai_tasks'], blockedWhileImpersonating: true,
  },
  'POST /ai/governance/strategies': {
    permissions: ['view_customers', 'view_team', 'review_ai_tasks'], blockedWhileImpersonating: true,
  },
  'POST /ai/governance/strategies/:strategyId/evaluations': {
    permissions: ['view_customers', 'view_team', 'review_ai_tasks'], blockedWhileImpersonating: true,
  },
  'POST /ai/governance/strategies/:strategyId/request-publish': {
    permissions: ['view_customers', 'view_team', 'review_ai_tasks'], blockedWhileImpersonating: true,
  },
  'POST /ai/governance/strategies/:strategyId/approve': {
    permissions: ['view_customers', 'view_team', 'review_ai_tasks'], blockedWhileImpersonating: true,
  },
  'POST /ai/governance/strategies/:strategyId/rollback': {
    permissions: ['view_customers', 'view_team', 'review_ai_tasks'], blockedWhileImpersonating: true,
  },
  'GET /ai/customers/:customerId/enrichment': { permissions: ['view_customers'] },
  'GET /ai/tasks': { permissions: ['view_customers'] },
  'GET /ai/tasks/:taskId': { permissions: ['view_customers'] },
  'GET /ai/manager-anomalies': {
    permissions: ['view_customers', 'view_alerts', 'view_team'],
  },
  'POST /ai/manager-anomalies/run': {
    permissions: ['use_ai_assistant', 'view_customers', 'view_alerts', 'view_team'],
    blockedWhileImpersonating: true,
  },
  'GET /ai/sales-coaching': {
    permissions: ['view_customers', 'view_team'],
  },
  'POST /ai/sales-coaching/:salesUserId/run': {
    permissions: ['use_ai_assistant', 'view_customers', 'view_team'],
    blockedWhileImpersonating: true,
  },
  'POST /ai/customers/:customerId/stations/customer_fit/run': {
    permissions: ['use_ai_assistant', 'view_customers'], blockedWhileImpersonating: true,
  },
  'POST /ai/customers/:customerId/stations/sales_pack/run': {
    permissions: ['use_ai_assistant', 'view_customers', 'view_contacts', 'view_recon'],
    blockedWhileImpersonating: true,
  },
  'POST /ai/customers/:customerId/action-proposals': {
    permissions: ['use_ai_assistant', 'view_customers', 'record_activity'],
    blockedWhileImpersonating: true,
  },
  'POST /ai/customers/:customerId/enrichment/run': {
    permissions: ['view_customers', 'use_ai_assistant', 'run_recon', 'view_recon', 'view_contacts'],
    blockedWhileImpersonating: true,
  },
  'POST /ai/enrichment/:runId/cancel': {
    permissions: ['view_customers', 'cancel_ai_tasks'], blockedWhileImpersonating: true,
  },
  'POST /ai/proposals/:proposalId/review': {
    permissions: ['view_customers', 'edit_customer'], blockedWhileImpersonating: true,
  },
  'POST /ai/jobs/:jobId/retry': {
    permissions: ['use_ai_assistant', 'view_customers'], blockedWhileImpersonating: true,
  },
  'POST /ai/jobs/:jobId/cancel': {
    permissions: ['cancel_ai_tasks', 'view_customers'], blockedWhileImpersonating: true,
  },
  'POST /ai/jobs/:jobId/review': {
    permissions: ['review_ai_tasks', 'view_customers'], blockedWhileImpersonating: true,
  },
  'POST /ai/jobs/:jobId/next-action/adopt': {
    permissions: ['use_ai_assistant', 'view_customers', 'view_contacts', 'record_activity'],
    blockedWhileImpersonating: true,
  },
  'POST /ai/bulk/retry': {
    permissions: ['bulk_manage_ai_tasks', 'use_ai_assistant', 'view_customers'], blockedWhileImpersonating: true,
  },
  'POST /ai/bulk/cancel': {
    permissions: ['bulk_manage_ai_tasks', 'cancel_ai_tasks', 'view_customers'], blockedWhileImpersonating: true,
  },
  'GET /ai/budgets': {
    permissions: ['manage_ai_budgets'], blockedWhileImpersonating: true,
  },
  'PUT /ai/budgets/:scopeType/:scopeId': {
    permissions: ['manage_ai_budgets'], blockedWhileImpersonating: true,
  },
});

// Keep the public route-policy inventory stable for existing governance checks,
// while applying the same impersonation guard as the legacy Recon writers at
// request-resolution time for the new unified profile routes.
const SALES_IMPERSONATION_BLOCKED_KEYS = new Set([
  'POST /profile/:customerId/recon',
  'POST /profile/:customerId/recon/:jobId/retry',
]);

function json(value, fallback = {}) {
  try { return JSON.parse(value || JSON.stringify(fallback)); }
  catch (_error) { return fallback; }
}

function normalizePermissions(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.keys(PERMISSION_DEFINITIONS)
    .filter(key => Object.prototype.hasOwnProperty.call(source, key))
    .map(key => [key, Boolean(source[key])]));
}

function permissionsFor(user) {
  const source = user?.permissions && typeof user.permissions === 'object' && !Array.isArray(user.permissions)
    ? user.permissions
    : {};
  return Object.fromEntries(Object.keys(PERMISSION_DEFINITIONS).map(key => [key, Boolean(source[key])]));
}

function hasPermission(user, permission) {
  return Boolean(permissionsFor(user)[permission]);
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function assertPolicyAllowed(policy, identity) {
  if (identity?.isImpersonating && policy?.blockedWhileImpersonating) {
    const error = forbidden('身份检查期间禁止此安全操作');
    error.code = 'IMPERSONATION_ACTION_BLOCKED';
    throw error;
  }
}

function assertPermission(user, permission) {
  if (!hasPermission(user, permission)) {
    throw forbidden(`没有权限：${PERMISSION_DEFINITIONS[permission] || permission}`);
  }
}

function accountVisibilityScope(user, alias = 'a', options = {}) {
  const tableHas = options.tableHas || {};
  const includeTestData = Boolean(options.includeTestData);
  const conditions = ['1=1'];
  const params = [];
  if (tableHas.lifecycle !== false) {
    conditions.push(`COALESCE(${alias}.lifecycle_status,'active')='active'`);
  }
  if (!includeTestData && tableHas.testData !== false) {
    conditions.push(`COALESCE(${alias}.is_test_data,0)=0`);
  }
  if (hasPermission(user, 'view_all_customers')) {
    if (!hasPermission(user, 'manage_intake')) conditions.push(`${alias}.owner_id IS NOT NULL`);
    return { conditions, params };
  }
  conditions.push(`${alias}.owner_id=?`, `COALESCE(${alias}.assignment_status,'claimed')!='returned'`);
  params.push(String(user?.id || ''));
  return { conditions, params };
}

function buildAccessContext(db, user, options = {}) {
  const permissions = permissionsFor(user);
  const accountColumns = db.prepare('PRAGMA table_info(crm_accounts)').all();
  const hasLifecycle = accountColumns.some(column => column.name === 'lifecycle_status');
  const hasTestData = accountColumns.some(column => column.name === 'is_test_data');
  const visibility = accountVisibilityScope(user, 'a', {
    includeTestData: options.includeTestData,
    tableHas: { lifecycle: hasLifecycle, testData: hasTestData },
  });
  const rows = db.prepare(
    `SELECT id,external_customer_id FROM crm_accounts a
     WHERE ${visibility.conditions.join(' AND ')}`,
  ).all(...visibility.params);
  const poolColumns = db.prepare('PRAGMA table_info(customer_pool)').all();
  const poolHasTestData = poolColumns.some(column => column.name === 'is_test_data');
  const hasProtectedCustomers = Boolean(db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type='table' AND name='crm_protected_customers'`).get());
  const protectedClause = hasProtectedCustomers
    ? `NOT EXISTS(SELECT 1 FROM crm_protected_customers protected
        WHERE protected.external_customer_id=customer_pool.customer_id
          AND protected.status IN ('protected','withdrawn'))`
    : '';
  const adminMasterConditions = [
    poolHasTestData ? 'COALESCE(is_test_data,0)=0' : '',
    protectedClause,
  ].filter(Boolean);
  const adminMasterIds = user.role === 'admin'
    ? db.prepare(`SELECT customer_id FROM customer_pool
        ${adminMasterConditions.length ? `WHERE ${adminMasterConditions.join(' AND ')}` : ''}`)
      .all().map(row => row.customer_id)
    : [];
  return {
    user,
    permissions,
    canViewAllCustomers: Boolean(permissions.view_all_customers),
    accountIds: new Set(rows.map(row => row.id)),
    externalCustomerIds: new Set([
      ...rows.map(row => row.external_customer_id).filter(Boolean),
      ...adminMasterIds,
    ]),
  };
}

function assertAccountAccess(context, account) {
  if (!account || !context.accountIds.has(account.id)) throw forbidden('无权访问该客户');
}

function assertExternalCustomerAccess(context, customerId) {
  if (!context.externalCustomerIds.has(String(customerId || ''))) throw forbidden('无权访问该客户');
}

function isAlertCopyRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!String(value.code || '').trim()) return false;
  return [...ALERT_COPY_KEYS].filter(key => String(value[key] || '').trim()).length >= 2;
}

function redactContactFields(value, options = {}) {
  if (Array.isArray(value)) return value.map(child => redactContactFields(child, options));
  if (!value || typeof value !== 'object') return value;
  const preserveAlertCopy = options.preserveAlertCopy === true && isAlertCopyRecord(value);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      return !CONTACT_KEYS.has(normalizedKey)
        || (preserveAlertCopy && ALERT_COPY_KEYS.has(normalizedKey));
    })
    .map(([key, child]) => [key, redactContactFields(child, options)]));
}

function contactSafeRecord(value, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    allowedKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))));
}

function contactSafePoolRecord(value) {
  return contactSafeRecord(value, CONTACT_SAFE_POOL_KEYS);
}

function contactSafeReconRecord(value) {
  return contactSafeRecord(value, CONTACT_SAFE_RECON_KEYS);
}

function contactSafeStateRecord(value, allowedKeys) {
  if (Array.isArray(value)) return value.map(child => contactSafeStateRecord(child, allowedKeys));
  if (!value || typeof value !== 'object') return value;
  const safe = contactSafeRecord(value, allowedKeys);
  if (safe.state && typeof safe.state === 'object' && !Array.isArray(safe.state)) {
    const state = { ...safe.state };
    if (state.nextAction && typeof state.nextAction === 'object') {
      state.nextAction = { ...state.nextAction, text: '' };
    }
    safe.state = state;
  }
  return safe;
}

function contactSafeAccountRecord(value) {
  return contactSafeStateRecord(value, CONTACT_SAFE_ACCOUNT_KEYS);
}

function contactSafeIntakeRecord(value) {
  return contactSafeStateRecord(value, CONTACT_SAFE_INTAKE_KEYS);
}

function contactSafeNotificationRecord(value) {
  return contactSafeStateRecord(value, CONTACT_SAFE_NOTIFICATION_KEYS);
}

function contactSafeTimelineRecord(value) {
  return contactSafeStateRecord(value, CONTACT_SAFE_TIMELINE_KEYS);
}

function contactSafeAuditLogRecord(value) {
  return contactSafeStateRecord(value, CONTACT_SAFE_AUDIT_LOG_KEYS);
}

function contactSafePipelineRecord(value) {
  return contactSafeStateRecord(value, CONTACT_SAFE_PIPELINE_KEYS);
}

function contactSafeInsightsRecord(value) {
  return contactSafeStateRecord(value, CONTACT_SAFE_INSIGHTS_KEYS);
}

// Activity rows keep structural keys plus provenance metadata; narratives,
// outcomes, and next-action text stay hidden like the legacy blacklist.
const CONTACT_SAFE_ACTIVITY_KEYS = new Set([
  'id', 'customerid', 'userid', 'activitytype', 'channel',
  'stagebefore', 'stageafter', 'managerrequired', 'progresskey',
  'reactionoptionid', 'occurredat', 'createdat', 'noplan',
  'supersededat', 'supersededby', 'istestdata', 'username', 'actorname',
  'nextactionat', 'effective', 'activityid', 'provenance',
  'kind', 'originalactivityid', 'originalcustomerid', 'originalactivitytype',
  'replacementactivityid', 'replacementcustomerid', 'sourceactivityid',
]);

function contactSafeActivityRecord(value) {
  return contactSafeStateRecord(value, CONTACT_SAFE_ACTIVITY_KEYS);
}

// RFQ/quote/order rows share a numeric-commercial shape.
const CONTACT_SAFE_COMMERCE_KEYS = new Set([
  'id', 'customerid', 'userid', 'activityid', 'rfqid', 'quoteid',
  'reference', 'status', 'bomlines', 'expectedvalue', 'productcategory',
  'completeness', 'receivedat', 'quotedat', 'sentat', 'nextfollowat',
  'orderedat', 'createdat', 'updatedat',
  'amount', 'currency', 'grossmargin', 'lossleader', 'isrepeat',
]);

function contactSafeCommerceRecord(value) {
  return contactSafeStateRecord(value, CONTACT_SAFE_COMMERCE_KEYS);
}

function contactSafeAlertsRecord(value) {
  if (Array.isArray(value)) return value.map(child => contactSafeAlertsRecord(child));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => CONTACT_SAFE_ALERT_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')))
    .map(([key, child]) => [key, contactSafeAlertsRecord(child)]));
}

function routeKey(method, requestPath) {
  const verb = String(method || '').toUpperCase();
  const path = String(requestPath || '').split('?')[0];
  if (/^\/customers\/[^/]+\/people$/.test(path)) return `${verb} /customers/:customerId/people`;
  if (/^\/recon\/results\/[^/]+$/.test(path)) return `${verb} /recon/results/:jobId`;
  if (/^\/assistant\/conversations\/[^/]+$/.test(path)) return `${verb} /assistant/conversations/:conversationId`;
  return `${verb} ${path}`;
}

function policyForLegacyRequest(method, requestPath, action = '', payload = {}) {
  const path = String(requestPath || '').split('?')[0];
  if (String(method).toUpperCase() === 'POST' && path === '/app') {
    return LEGACY_ACTION_POLICIES.app[action] || { deny: true };
  }
  if (String(method).toUpperCase() === 'POST' && path === '/prospect-agent') {
    const policy = LEGACY_ACTION_POLICIES['prospect-agent'][action];
    if (!policy) return { deny: true };
    if (action === 'promoteCandidate' && payload.createRecon) {
      return { ...policy, permissions: [...policy.permissions, 'run_recon', 'view_recon'], blockedWhileImpersonating: true };
    }
    return policy;
  }
  return LEGACY_ROUTE_POLICIES[routeKey(method, path)] || { deny: true };
}

function salesRouteKey(method, requestPath) {
  const verb = String(method || '').toUpperCase();
  const path = String(requestPath || '').split('?')[0].replace(/^\/api\/sales-crm/, '') || '/';
  if (/^\/research\/(pool|people|recon)$/.test(path)) return `${verb} ${path}`;
  if (/^\/filter-schema\/[^/]+$/.test(path)) return `${verb} /filter-schema/:pageKey`;
  if (/^\/field-schema\/[^/]+$/.test(path)) return `${verb} /field-schema/:pageKey`;
  if (/^\/lists\/[^/]+$/.test(path)) return `${verb} /lists/:pageKey`;
  if (/^\/accounts\/[^/]+\/deferred-plan$/.test(path)) {
    return `${verb} /accounts/:customerId/deferred-plan`;
  }
  if (/^\/accounts\/[^/]+\/history$/.test(path)) {
    return `${verb} /accounts/:customerId/history`;
  }
  if (/^\/accounts\/[^/]+\/reject$/.test(path)) {
    return `${verb} /accounts/:customerId/reject`;
  }
  if (path === '/mismatch-recycle//profile'
      || /^\/mismatch-recycle\/[^/]+\/profile$/.test(path)) {
    return `${verb} /mismatch-recycle/:recordKey/profile`;
  }
  if (/^\/mismatch-recycle\/[^/]+\/restore$/.test(path)) {
    return `${verb} /mismatch-recycle/:recordKey/restore`;
  }
  if (path === '/manager-task-settings') return `${verb} /manager-task-settings`;
  if (path === '/manager-tasks/export') return `${verb} /manager-tasks/export`;
  if (/^\/manager-tasks\/[^/]+\/resolve$/.test(path)) {
    return `${verb} /manager-tasks/:taskId/resolve`;
  }
  if (/^\/manager-tasks\/[^/]+$/.test(path)) return `${verb} /manager-tasks/:taskId`;
  if (path === '/manager-tasks') return `${verb} /manager-tasks`;
  if (path === '/manager-metrics') return `${verb} /manager-metrics`;
  if (path === '/manager-metrics/drilldown') return `${verb} /manager-metrics/drilldown`;
  if (path === '/manager-risks') return `${verb} /manager-risks`;
  if (path === '/team-status/since-last-view') return `${verb} /team-status/since-last-view`;
  if (path === '/team-status/export') return `${verb} /team-status/export`;
  if (path === '/team-status') return `${verb} /team-status`;
  if (path === '/collaboration-support/export') return `${verb} /collaboration-support/export`;
  if (/^\/collaboration-support\/[^/]+\/(supplements|corrections|revocations)$/.test(path)) {
    const action = path.split('/').pop();
    return `${verb} /collaboration-support/:eventId/${action}`;
  }
  if (path === '/collaboration-support') return `${verb} /collaboration-support`;
  if (path === '/today-tasks/actions') return `${verb} /today-tasks/actions`;
  if (/^\/intake\/[^/]+\/profile$/.test(path)) return `${verb} /intake/:itemId/profile`;
  if (/^\/master\/[^/]+$/.test(path)) return `${verb} /master/:customerId`;
  if (/^\/profile\/[^/]+\/tag-history$/.test(path)) return `${verb} /profile/:customerId/tag-history`;
  if (/^\/profile\/[^/]+\/follow$/.test(path)) return `${verb} /profile/:customerId/follow`;
  if (/^\/profile\/[^/]+\/tags$/.test(path)) return `${verb} /profile/:customerId/tags`;
  if (/^\/profile\/[^/]+\/tags\/[^/]+$/.test(path)) return `${verb} /profile/:customerId/tags/:tagId`;
  if (path === '/tags') return `${verb} /tags`;
  if (/^\/profile\/[^/]+\/recon\/[^/]+$/.test(path)) return `${verb} /profile/:customerId/recon/:jobId`;
  if (/^\/profile\/[^/]+\/recon$/.test(path)) return `${verb} /profile/:customerId/recon`;
  if (/^\/profile\/[^/]+\/recon\/[^/]+\/retry$/.test(path)) return `${verb} /profile/:customerId/recon/:jobId/retry`;
  if (/^\/profile\/[^/]+$/.test(path)) return `${verb} /profile/:customerId`;
  if (/^\/customer-stars\/[^/]+$/.test(path)) return `${verb} /customer-stars/:customerId`;
  if (/^\/notifications\/[^/]+\/read$/.test(path)) return `${verb} /notifications/:notificationId/read`;
  if (path === '/accounts/bulk-assign') return `${verb} /accounts/bulk-assign`;
  if (path === '/accounts') return `${verb} /accounts`;
  if (path === '/duplicate-reviews/bulk-distinct') return `${verb} /duplicate-reviews/bulk-distinct`;
  if (path === '/duplicate-reviews/recalculate') return `${verb} /duplicate-reviews/recalculate`;
  if (/^\/duplicate-reviews\/[^/]+\/candidates$/.test(path)) {
    return `${verb} /duplicate-reviews/:reviewId/candidates`;
  }
  if (/^\/duplicate-reviews\/[^/]+\/candidate$/.test(path)) {
    return `${verb} /duplicate-reviews/:reviewId/candidate`;
  }
  if (/^\/duplicate-reviews\/[^/]+\/resolve$/.test(path)) {
    return `${verb} /duplicate-reviews/:reviewId/resolve`;
  }
  if (/^\/protected-customer-conflicts\/[^/]+\/resolve$/.test(path)) {
    return `${verb} /protected-customer-conflicts/:conflictId/resolve`;
  }
  if (/^\/protected-customer-conflicts\/[^/]+\/supplement$/.test(path)) {
    return `${verb} /protected-customer-conflicts/:conflictId/supplement`;
  }
  if (path === '/protected-customer-conflicts/rescan') {
    return `${verb} /protected-customer-conflicts/rescan`;
  }
  if (path === '/protected-customers/template') return `${verb} /protected-customers/template`;
  if (path === '/protected-customers/export') return `${verb} /protected-customers/export`;
  if (/^\/protected-customers\/batches\/[^/]+\/commit$/.test(path)) {
    return `${verb} /protected-customers/batches/:batchId/commit`;
  }
  if (/^\/protected-customers\/batches\/[^/]+\/rollback$/.test(path)) {
    return `${verb} /protected-customers/batches/:batchId/rollback`;
  }
  if (/^\/protected-customers\/[^/]+\/activate$/.test(path)) {
    return `${verb} /protected-customers/:externalCustomerId/activate`;
  }
  if (/^\/protected-customers\/[^/]+$/.test(path)) {
    return `${verb} /protected-customers/:externalCustomerId`;
  }
  if (path === '/accounts/recycle-bin') return `${verb} /accounts/recycle-bin`;
  if (/^\/accounts\/[^/]+\/recycle-profile$/.test(path)) return `${verb} /accounts/:customerId/recycle-profile`;
  if (path === '/accounts/bulk-return') return `${verb} /accounts/bulk-return`;
  if (/^\/accounts\/[^/]+\/return$/.test(path)) return `${verb} /accounts/:customerId/return`;
  if (/^\/accounts\/[^/]+\/trash$/.test(path)) return `${verb} /accounts/:customerId/trash`;
  if (/^\/accounts\/[^/]+\/restore$/.test(path)) return `${verb} /accounts/:customerId/restore`;
  if (/^\/accounts\/[^/]+\/reassign$/.test(path)) return `${verb} /accounts/:customerId/reassign`;
  if (/^\/accounts\/[^/]+$/.test(path)) return `${verb} /accounts/:customerId`;
  if (/^\/customers\/[^/]+\/nickname$/.test(path)) {
    return `${verb} /customers/:externalCustomerId/nickname`;
  }
  if (/^\/activity-correction-proposals\/[^/]+\/review$/.test(path)) {
    return `${verb} /activity-correction-proposals/:proposalId/review`;
  }
  if (path === '/activity-reactions/order') return `${verb} /activity-reactions/order`;
  if (/^\/activity-reactions\/[^/]+$/.test(path)
      && path !== '/activity-reactions/admin') {
    return `${verb} /activity-reactions/:reactionId`;
  }
  if (/^\/permission-groups\/[^/]+$/.test(path)) return `${verb} /permission-groups/:groupId`;
  if (/^\/users\/[^/]+\/password-reset$/.test(path)) return `${verb} /users/:userId/password-reset`;
  if (/^\/users\/[^/]+\/archive$/.test(path)) return `${verb} /users/:userId/archive`;
  if (/^\/users\/[^/]+\/restore$/.test(path)) return `${verb} /users/:userId/restore`;
  if (/^\/users\/[^/]+\/permission-overrides$/.test(path)) return `${verb} /users/:userId/permission-overrides`;
  if (path === '/filter-permissions') return `${verb} /filter-permissions`;
  if (/^\/filter-permissions\/groups\/[^/]+$/.test(path)) return `${verb} /filter-permissions/groups/:groupId`;
  if (/^\/filter-permissions\/users\/[^/]+$/.test(path)) return `${verb} /filter-permissions/users/:userId`;
  if (/^\/filter-permissions\/definitions\/[^/]+$/.test(path)) return `${verb} /filter-permissions/definitions/:filterKey`;
  if (/^\/users\/[^/]+$/.test(path)) return `${verb} /users/:userId`;
  if (/^\/migration-review\/[^/]+$/.test(path)) return `${verb} /migration-review/:reviewId`;
  if (/^\/evaluations\/[^/]+\/retry$/.test(path)) return `${verb} /evaluations/:evaluationId/retry`;
  if (/^\/contacts\/[^/]+\/archive$/.test(path)) return `${verb} /contacts/:contactId/archive`;
  if (/^\/contacts\/[^/]+$/.test(path)) return `${verb} /contacts/:contactId`;
  if (/^\/ai\/customers\/[^/]+\/results$/.test(path)) return `${verb} /ai/customers/:customerId/results`;
  if (/^\/ai\/features\/[^/]+$/.test(path)) return `${verb} /ai/features/:featureKey`;
  if (/^\/ai\/customers\/[^/]+\/enrichment$/.test(path)) return `${verb} /ai/customers/:customerId/enrichment`;
  if (/^\/ai\/customers\/[^/]+\/enrichment\/run$/.test(path)) {
    return `${verb} /ai/customers/:customerId/enrichment/run`;
  }
  if (/^\/ai\/customers\/[^/]+\/stations\/customer_fit\/run$/.test(path)) {
    return `${verb} /ai/customers/:customerId/stations/customer_fit/run`;
  }
  if (/^\/ai\/customers\/[^/]+\/stations\/sales_pack\/run$/.test(path)) {
    return `${verb} /ai/customers/:customerId/stations/sales_pack/run`;
  }
  if (/^\/ai\/customers\/[^/]+\/action-proposals$/.test(path)) {
    return `${verb} /ai/customers/:customerId/action-proposals`;
  }
  if (path === '/ai/manager-anomalies') return `${verb} /ai/manager-anomalies`;
  if (path === '/ai/manager-anomalies/run') return `${verb} /ai/manager-anomalies/run`;
  if (path === '/ai/sales-coaching') return `${verb} /ai/sales-coaching`;
  if (/^\/ai\/sales-coaching\/[^/]+\/run$/.test(path)) {
    return `${verb} /ai/sales-coaching/:salesUserId/run`;
  }
  if (/^\/ai\/governance\/strategies\/[^/]+\/evaluations$/.test(path)) {
    return `${verb} /ai/governance/strategies/:strategyId/evaluations`;
  }
  if (/^\/ai\/governance\/strategies\/[^/]+\/request-publish$/.test(path)) {
    return `${verb} /ai/governance/strategies/:strategyId/request-publish`;
  }
  if (/^\/ai\/governance\/strategies\/[^/]+\/approve$/.test(path)) {
    return `${verb} /ai/governance/strategies/:strategyId/approve`;
  }
  if (/^\/ai\/governance\/strategies\/[^/]+\/rollback$/.test(path)) {
    return `${verb} /ai/governance/strategies/:strategyId/rollback`;
  }
  if (/^\/ai\/tasks\/[^/]+$/.test(path)) return `${verb} /ai/tasks/:taskId`;
  if (/^\/ai\/jobs\/[^/]+\/feedback$/.test(path)) return `${verb} /ai/jobs/:jobId/feedback`;
  if (/^\/ai\/jobs\/[^/]+\/retry$/.test(path)) return `${verb} /ai/jobs/:jobId/retry`;
  if (/^\/ai\/jobs\/[^/]+\/cancel$/.test(path)) return `${verb} /ai/jobs/:jobId/cancel`;
  if (/^\/ai\/jobs\/[^/]+\/review$/.test(path)) return `${verb} /ai/jobs/:jobId/review`;
  if (/^\/ai\/jobs\/[^/]+\/next-action\/adopt$/.test(path)) {
    return `${verb} /ai/jobs/:jobId/next-action/adopt`;
  }
  if (/^\/ai\/enrichment\/[^/]+\/cancel$/.test(path)) return `${verb} /ai/enrichment/:runId/cancel`;
  if (/^\/ai\/proposals\/[^/]+\/review$/.test(path)) return `${verb} /ai/proposals/:proposalId/review`;
  if (/^\/ai\/budgets\/[^/]+\/[^/]+$/.test(path)) return `${verb} /ai/budgets/:scopeType/:scopeId`;
  return `${verb} ${path}`;
}

function policyForSalesRequest(method, requestPath) {
  const key = salesRouteKey(method, requestPath);
  const policy = SALES_ROUTE_POLICIES[key];
  if (!policy) return { deny: true };
  return SALES_IMPERSONATION_BLOCKED_KEYS.has(key)
    ? { ...policy, blockedWhileImpersonating: true }
    : policy;
}

module.exports = {
  PERMISSION_DEFINITIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  LEGACY_ROUTE_POLICIES,
  LEGACY_ACTION_POLICIES,
  SALES_ROUTE_POLICIES,
  normalizePermissions,
  permissionsFor,
  hasPermission,
  assertPermission,
  forbidden,
  assertPolicyAllowed,
  buildAccessContext,
  accountVisibilityScope,
  assertAccountAccess,
  assertExternalCustomerAccess,
  redactContactFields,
  contactSafePoolRecord,
  contactSafeReconRecord,
  contactSafeAccountRecord,
  contactSafeIntakeRecord,
  contactSafeNotificationRecord,
  contactSafeTimelineRecord,
  contactSafeAuditLogRecord,
  contactSafePipelineRecord,
  contactSafeInsightsRecord,
  contactSafeAlertsRecord,
  contactSafeActivityRecord,
  contactSafeCommerceRecord,
  policyForLegacyRequest,
  policyForSalesRequest,
};
