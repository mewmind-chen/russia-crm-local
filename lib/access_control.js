const PERMISSION_DEFINITIONS = {
  view_dashboard: '经营驾驶舱',
  view_intake: '未开发线索分配',
  view_customers: 'CRM客户全景',
  view_development: '客户开发工作台',
  view_pool: '未开发线索池',
  view_contacts: '负责人线索',
  view_recon: 'Recon情报',
  view_pipeline: '推进管道',
  view_alerts: '异常与介入',
  view_insights: '经理评价',
  view_team: '销售能力',
  view_markets: '市场策略',
  view_users: '用户与权限',
  view_all_customers: '查看团队全部客户',
  manage_intake: '管理入库与分配',
  create_customer: '新增CRM客户',
  edit_customer: '调整客户资料与负责人',
  record_activity: '记录客户动作',
  record_quote: '记录报价',
  record_order: '记录订单',
  manage_evaluations: '维护经理评价与AI标注',
  run_recon: '发起或重试Recon',
  use_prospect_agent: '使用外贸智能体',
  use_ai_assistant: '使用AI经营助手',
  cancel_ai_tasks: '取消AI任务',
  bulk_manage_ai_tasks: '批量管理AI任务',
  manage_ai_budgets: '配置AI预算',
  review_ai_tasks: '复核AI任务',
  manage_users: '管理账号与权限',
  manage_data_maintenance: '管理数据维护',
};

const ROLE_PERMISSIONS = {
  admin: Object.fromEntries(Object.keys(PERMISSION_DEFINITIONS).map(key => [key, true])),
  manager: {
    view_dashboard: true, view_intake: true, view_customers: true, view_development: true,
    view_pool: true, view_contacts: true, view_recon: true, view_pipeline: true,
    view_alerts: true, view_insights: true, view_team: true, view_markets: true,
    view_users: false, view_all_customers: true, manage_intake: true, create_customer: true,
    edit_customer: true, record_activity: true, record_quote: true, record_order: true,
    manage_evaluations: true, run_recon: true, use_prospect_agent: true,
    use_ai_assistant: true, cancel_ai_tasks: true, bulk_manage_ai_tasks: true,
    manage_ai_budgets: false, review_ai_tasks: true,
    manage_users: false, manage_data_maintenance: false,
  },
  sales: {
    view_dashboard: true, view_intake: true, view_customers: true, view_development: true,
    view_pool: true, view_contacts: true, view_recon: true, view_pipeline: true,
    view_alerts: false, view_insights: false, view_team: false, view_markets: false,
    view_users: false, view_all_customers: false, manage_intake: false, create_customer: false,
    edit_customer: false, record_activity: true, record_quote: true, record_order: true,
    manage_evaluations: false, run_recon: false, use_prospect_agent: false,
    use_ai_assistant: false, cancel_ai_tasks: false, bulk_manage_ai_tasks: false,
    manage_ai_budgets: false, review_ai_tasks: false,
    manage_users: false, manage_data_maintenance: false,
  },
};

const CONTACT_KEYS = new Set([
  'email', 'phone', 'contact', 'contactname', 'contacttitle', 'contactmethods',
  'methodssummary', 'fullname', 'fullnamelocal', 'title', 'personsummary',
  'contactsummary', 'contactssummary', 'contactsignal', 'contactcount',
  'contactnextaction', 'contactreconstatus', 'bestpersonid', 'bestcontactlevel',
  'contactlevel', 'decisionrole', 'rolecategory', 'procurementrelevance',
  'employmentstatus', 'employmentconfidence', 'salesready', 'personid',
  'evidence', 'evidenceurls', 'method', 'methods', 'resultjson', 'reportpath', 'reporturl',
  'error', 'stdout', 'stderr', 'logtail', 'terminal',
  'notes', 'feedback', 'reason', 'invalidreason', 'nextaction', 'description',
  'opportunitysummary', 'opportunitydo', 'opportunityneed', 'opportunitysell',
  'opportunitydecision', 'outreachangle',
  'summary', 'outcome', 'detail', 'action', 'masterdescription', 'deepreport',
  'sourcefile', 'decisionreason', 'returnreason', 'lossreason', 'failurereason',
  'validationerror', 'detailjson', 'payloadjson',
  'products', 'productfocus', 'recommendedproducts', 'businesssummary',
  'evaluationtext', 'aisummary', 'ailabels', 'aiorderkeys', 'airisks',
  'aistrategy', 'aierror',
  'query', 'needsignal', 'sellsignal', 'decision', 'sourcesummary',
  'industryfocus', 'sourcemix', 'url', 'snippet',
]);

const CONTACT_SAFE_POOL_KEYS = new Set([
  'customerid', 'domain', 'companyname', 'russianname', 'englishname', 'country', 'city',
  'website', 'industry', 'customertype', 'rating', 'currentpool', 'inn', 'riskstatus',
  'websiteverification', 'firstfound', 'lastfound', 'searchcount', 'verified',
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
  'GET /assistant/runtime': { permissions: ['use_ai_assistant'] },
  'PATCH /assistant/runtime': { permissions: ['manage_users'] },
  'POST /assistant/runtime/recheck': { permissions: ['manage_users'] },
});

const LEGACY_ACTION_POLICIES = Object.freeze({
  app: {
    updateCustomer: { permissions: ['edit_customer'] },
    createTag: { permissions: ['edit_customer'] },
    setCustomerTags: { permissions: ['edit_customer'] },
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
  'GET /profile/:customerId': { permissions: ['view_customers'] },
  'GET /research/pool': { permissions: ['view_pool'] },
  'GET /research/people': { permissions: ['view_contacts'] },
  'GET /research/recon': { permissions: ['view_recon'] },
  'POST /accounts': { permissions: ['create_customer'] },
  'PATCH /accounts/:customerId': { permissions: ['edit_customer'] },
  'POST /activities': { permissions: ['record_activity'] },
  'POST /quotes': { permissions: ['record_quote'] },
  'POST /orders': { permissions: ['record_order'] },
  'POST /users': { permissions: ['view_users', 'manage_users'], blockedWhileImpersonating: true },
  'POST /users/:userId/password-reset': { permissions: ['view_users', 'manage_users'], adminOnly: true, blockedWhileImpersonating: true },
  'PATCH /users/:userId': { permissions: ['view_users', 'manage_users'], blockedWhileImpersonating: true },
  'GET /permission-groups': { permissions: ['view_users'] },
  'POST /permission-groups': { permissions: ['view_users', 'manage_users'], blockedWhileImpersonating: true },
  'PATCH /permission-groups/:groupId': { permissions: ['view_users', 'manage_users'], blockedWhileImpersonating: true },
  'PUT /users/:userId/permission-overrides': { permissions: ['view_users', 'manage_users'], blockedWhileImpersonating: true },
  'POST /migration-review/:reviewId': { permissions: ['view_users', 'manage_users'], blockedWhileImpersonating: true },
  'POST /impersonation/start': { permissions: ['view_users', 'manage_users'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /impersonation/stop': { permissions: [], impersonationControl: true },
  'GET /data-maintenance/capabilities': { permissions: ['manage_data_maintenance'], realAdminOnly: true, blockedWhileImpersonating: true },
  'GET /data-maintenance/runs': { permissions: ['manage_data_maintenance'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /data-maintenance/preview': { permissions: ['manage_data_maintenance'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /data-maintenance/execute': { permissions: ['manage_data_maintenance'], realAdminOnly: true, blockedWhileImpersonating: true },
  'POST /password': { permissions: [], blockedWhileImpersonating: true },
  'POST /intake/scan': { permissions: ['view_intake', 'manage_intake'] },
  'POST /intake/action': { permissions: ['view_intake'] },
  'PATCH /intake/settings': { permissions: ['view_intake', 'manage_intake'] },
  'POST /contacts': { permissions: ['view_contacts', 'edit_customer'] },
  'POST /evaluations': { permissions: ['manage_evaluations'] },
  'POST /evaluations/:evaluationId/retry': { permissions: ['manage_evaluations'] },
  'GET /ai/customers/:customerId/results': { permissions: ['view_customers'] },
  'GET /ai/customers/:customerId/enrichment': { permissions: ['view_customers'] },
  'GET /ai/tasks': { permissions: ['view_customers'] },
  'GET /ai/tasks/:taskId': { permissions: ['view_customers'] },
  'POST /ai/customers/:customerId/stations/customer_fit/run': {
    permissions: ['use_ai_assistant', 'view_customers'], blockedWhileImpersonating: true,
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
    const error = forbidden('身份检查期间不能执行此操作');
    error.code = 'IMPERSONATION_ACTION_BLOCKED';
    throw error;
  }
}

function assertPermission(user, permission) {
  if (!hasPermission(user, permission)) {
    throw forbidden(`没有权限：${PERMISSION_DEFINITIONS[permission] || permission}`);
  }
}

function buildAccessContext(db, user) {
  const permissions = permissionsFor(user);
  const rows = permissions.view_all_customers
    ? db.prepare('SELECT id,external_customer_id FROM crm_accounts').all()
    : db.prepare(`SELECT id,external_customer_id FROM crm_accounts
        WHERE owner_id=? AND COALESCE(assignment_status,'')!='returned'`).all(user.id);
  return {
    user,
    permissions,
    canViewAllCustomers: Boolean(permissions.view_all_customers),
    accountIds: new Set(rows.map(row => row.id)),
    externalCustomerIds: new Set(rows.map(row => row.external_customer_id).filter(Boolean)),
  };
}

function assertAccountAccess(context, account) {
  if (!account || !context.accountIds.has(account.id)) throw forbidden('无权访问该客户');
}

function assertExternalCustomerAccess(context, customerId) {
  if (!context.externalCustomerIds.has(String(customerId || ''))) throw forbidden('无权访问该客户');
}

function redactContactFields(value) {
  if (Array.isArray(value)) return value.map(redactContactFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !CONTACT_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')))
    .map(([key, child]) => [key, redactContactFields(child)]));
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

function routeKey(method, requestPath) {
  const verb = String(method || '').toUpperCase();
  const path = String(requestPath || '').split('?')[0];
  if (/^\/customers\/[^/]+\/people$/.test(path)) return `${verb} /customers/:customerId/people`;
  if (/^\/recon\/results\/[^/]+$/.test(path)) return `${verb} /recon/results/:jobId`;
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
  if (/^\/profile\/[^/]+$/.test(path)) return `${verb} /profile/:customerId`;
  if (/^\/accounts\/[^/]+$/.test(path)) return `${verb} /accounts/:customerId`;
  if (/^\/permission-groups\/[^/]+$/.test(path)) return `${verb} /permission-groups/:groupId`;
  if (/^\/users\/[^/]+\/password-reset$/.test(path)) return `${verb} /users/:userId/password-reset`;
  if (/^\/users\/[^/]+\/permission-overrides$/.test(path)) return `${verb} /users/:userId/permission-overrides`;
  if (/^\/users\/[^/]+$/.test(path)) return `${verb} /users/:userId`;
  if (/^\/migration-review\/[^/]+$/.test(path)) return `${verb} /migration-review/:reviewId`;
  if (/^\/evaluations\/[^/]+\/retry$/.test(path)) return `${verb} /evaluations/:evaluationId/retry`;
  if (/^\/ai\/customers\/[^/]+\/results$/.test(path)) return `${verb} /ai/customers/:customerId/results`;
  if (/^\/ai\/customers\/[^/]+\/enrichment$/.test(path)) return `${verb} /ai/customers/:customerId/enrichment`;
  if (/^\/ai\/customers\/[^/]+\/enrichment\/run$/.test(path)) {
    return `${verb} /ai/customers/:customerId/enrichment/run`;
  }
  if (/^\/ai\/customers\/[^/]+\/stations\/customer_fit\/run$/.test(path)) {
    return `${verb} /ai/customers/:customerId/stations/customer_fit/run`;
  }
  if (/^\/ai\/tasks\/[^/]+$/.test(path)) return `${verb} /ai/tasks/:taskId`;
  if (/^\/ai\/jobs\/[^/]+\/retry$/.test(path)) return `${verb} /ai/jobs/:jobId/retry`;
  if (/^\/ai\/jobs\/[^/]+\/cancel$/.test(path)) return `${verb} /ai/jobs/:jobId/cancel`;
  if (/^\/ai\/jobs\/[^/]+\/review$/.test(path)) return `${verb} /ai/jobs/:jobId/review`;
  if (/^\/ai\/enrichment\/[^/]+\/cancel$/.test(path)) return `${verb} /ai/enrichment/:runId/cancel`;
  if (/^\/ai\/proposals\/[^/]+\/review$/.test(path)) return `${verb} /ai/proposals/:proposalId/review`;
  if (/^\/ai\/budgets\/[^/]+\/[^/]+$/.test(path)) return `${verb} /ai/budgets/:scopeType/:scopeId`;
  return `${verb} ${path}`;
}

function policyForSalesRequest(method, requestPath) {
  return SALES_ROUTE_POLICIES[salesRouteKey(method, requestPath)] || { deny: true };
}

module.exports = {
  PERMISSION_DEFINITIONS,
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
  assertAccountAccess,
  assertExternalCustomerAccess,
  redactContactFields,
  contactSafePoolRecord,
  contactSafeReconRecord,
  policyForLegacyRequest,
  policyForSalesRequest,
};
