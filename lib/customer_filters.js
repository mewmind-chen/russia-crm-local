'use strict';

const {
  STAGES,
  STAGE_LABELS,
  isValidStage,
  isActivePipelineStage,
  hasReachedStage,
} = require('./customer_stages');
const { orderByForSort, parseSortDescriptors } = require('./list_sort');

function list(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.flatMap(item => String(item || '').split(','))
    .map(item => item.trim()).filter(Boolean))];
}

function truthy(value) {
  return value === true || value === 1 || ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

function unauthorizedFilter() {
  const error = new Error('筛选条件未获授权');
  error.statusCode = 403;
  error.code = 'FILTER_NOT_AUTHORIZED';
  return error;
}

const CUSTOMER_SORT_KEYS = Object.freeze([
  'pending_priority',
  'oldest_activity',
  'recent_progress',
  'newest',
  'company',
]);
const CUSTOMER_SORT_FIELDS = Object.freeze({
  company: "COALESCE(NULLIF(p.company_name,''),a.company_name) COLLATE NOCASE",
  company_name: "COALESCE(NULLIF(p.company_name,''),a.company_name) COLLATE NOCASE",
  country: "COALESCE(NULLIF(p.country,''),a.country) COLLATE NOCASE",
  stage: 'a.stage',
  owner: 'COALESCE(owner.name,\'\') COLLATE NOCASE',
  last_activity: "COALESCE(a.last_activity_at,'')",
  next_action: "COALESCE(a.next_action_at,'')",
  priority: 'a.priority',
  status: "COALESCE(a.lifecycle_status,a.assignment_status,'') COLLATE NOCASE",
  external_customer_id: "COALESCE(a.external_customer_id,'') COLLATE NOCASE",
  nickname: "COALESCE(p.nickname,a.nickname,'') COLLATE NOCASE",
  russian_name: "COALESCE(p.russian_name,'') COLLATE NOCASE",
  english_name: "COALESCE(p.english_name,'') COLLATE NOCASE",
  city: "COALESCE(NULLIF(p.city,''),a.city,'') COLLATE NOCASE",
  website: "COALESCE(NULLIF(p.website,''),a.website,'') COLLATE NOCASE",
  industry: "COALESCE(NULLIF(p.industry,''),a.industry,'') COLLATE NOCASE",
  customer_type: "COALESCE(NULLIF(p.customer_type,''),a.customer_type,'') COLLATE NOCASE",
  established_year: 'COALESCE(a.established_year,p.established_year,0)',
  source: "COALESCE(a.source,'') COLLATE NOCASE",
  product_focus: "COALESCE(NULLIF(p.products,''),a.product_focus,'') COLLATE NOCASE",
  manager_id: "COALESCE(a.manager_id,'') COLLATE NOCASE",
  manager_required: 'COALESCE(a.manager_required,0)',
  manager_status: "COALESCE(a.manager_status,'') COLLATE NOCASE",
  next_action_at: "COALESCE(a.next_action_at,'')",
  next_action_time_basis: "COALESCE(a.next_action_time_basis,'') COLLATE NOCASE",
  loss_reason: "COALESCE(a.loss_reason,'') COLLATE NOCASE",
  created_by: "COALESCE(a.created_by,'') COLLATE NOCASE",
  created_at: "COALESCE(a.created_at,'')",
  updated_at: "COALESCE(a.updated_at,'')",
  intake_item_id: "COALESCE(a.intake_item_id,'') COLLATE NOCASE",
  assignment_status: "COALESCE(a.assignment_status,'') COLLATE NOCASE",
  assigned_at: "COALESCE(a.assigned_at,'')",
  claim_due_at: "COALESCE(a.claim_due_at,'')",
  claimed_at: "COALESCE(a.claimed_at,'')",
  first_claimed_by: "COALESCE(a.first_claimed_by,'') COLLATE NOCASE",
  first_claimed_at: "COALESCE(a.first_claimed_at,'')",
  return_reason: "COALESCE(a.return_reason,'') COLLATE NOCASE",
  recycle_kind: "COALESCE(a.recycle_kind,'') COLLATE NOCASE",
  recycle_reason: "COALESCE(a.recycle_reason,'') COLLATE NOCASE",
  recycled_by: "COALESCE(a.recycled_by,'') COLLATE NOCASE",
  recycled_at: "COALESCE(a.recycled_at,'')",
  previous_owner_id: "COALESCE(a.previous_owner_id,'') COLLATE NOCASE",
  pool_customer_id: "COALESCE(p.customer_id,'') COLLATE NOCASE",
  pool_domain: "COALESCE(p.domain,'') COLLATE NOCASE",
  pool_company_name: "COALESCE(p.company_name,'') COLLATE NOCASE",
  pool_nickname: "COALESCE(p.nickname,'') COLLATE NOCASE",
  pool_russian_name: "COALESCE(p.russian_name,'') COLLATE NOCASE",
  pool_english_name: "COALESCE(p.english_name,'') COLLATE NOCASE",
  pool_country: "COALESCE(p.country,'') COLLATE NOCASE",
  pool_city: "COALESCE(p.city,'') COLLATE NOCASE",
  pool_website: "COALESCE(p.website,'') COLLATE NOCASE",
  pool_industry: "COALESCE(p.industry,'') COLLATE NOCASE",
  pool_customer_type: "COALESCE(p.customer_type,'') COLLATE NOCASE",
  pool_established_year: 'COALESCE(p.established_year,0)',
  pool_description: "COALESCE(p.description,'') COLLATE NOCASE",
  pool_products: "COALESCE(p.products,'') COLLATE NOCASE",
  pool_rating: "COALESCE(p.rating,'') COLLATE NOCASE",
  pool_current_pool: "COALESCE(p.current_pool,'') COLLATE NOCASE",
  pool_assigned_to: "COALESCE(p.assigned_to,'') COLLATE NOCASE",
  pool_assigned_at: "COALESCE(p.assigned_at,'')",
  pool_country_code: "COALESCE(p.country_code,'') COLLATE NOCASE",
  pool_phone: "COALESCE(p.phone,'') COLLATE NOCASE",
  pool_email: "COALESCE(p.email,'') COLLATE NOCASE",
  pool_email_raw: "COALESCE(p.email_raw,'') COLLATE NOCASE",
  pool_inn: "COALESCE(p.inn,'') COLLATE NOCASE",
  pool_risk_status: "COALESCE(p.risk_status,'') COLLATE NOCASE",
  pool_website_verification: "COALESCE(p.website_verification,'') COLLATE NOCASE",
  pool_contact_count: 'COALESCE(p.contact_count,0)',
  pool_deep_report: "COALESCE(p.deep_report,'') COLLATE NOCASE",
  pool_source_file: "COALESCE(p.source_file,'') COLLATE NOCASE",
  pool_first_found: "COALESCE(p.first_found,'')",
  pool_last_found: "COALESCE(p.last_found,'')",
  pool_search_count: 'COALESCE(p.search_count,0)',
  pool_verified: "COALESCE(p.verified,'') COLLATE NOCASE",
  pool_notes: "COALESCE(p.notes,'') COLLATE NOCASE",
  pool_created_at: "COALESCE(p.created_at,'')",
  pool_updated_at: "COALESCE(p.updated_at,'')",
  pool_best_contact_level: "COALESCE(p.best_contact_level,'') COLLATE NOCASE",
  pool_best_person_id: "COALESCE(p.best_person_id,'') COLLATE NOCASE",
  pool_sales_ready_contact_count: 'COALESCE(p.sales_ready_contact_count,0)',
  pool_contact_recon_status: "COALESCE(p.contact_recon_status,'') COLLATE NOCASE",
  pool_contact_last_checked_at: "COALESCE(p.contact_last_checked_at,'')",
  pool_contact_next_action: "COALESCE(p.contact_next_action,'') COLLATE NOCASE",
});
const CUSTOMER_POOL_CONTACT_SORT_FIELDS = new Set([
  'pool_description', 'pool_products', 'pool_phone', 'pool_email', 'pool_email_raw',
  'pool_contact_count', 'pool_best_contact_level', 'pool_best_person_id',
  'pool_sales_ready_contact_count', 'pool_contact_recon_status',
  'pool_contact_last_checked_at', 'pool_contact_next_action',
]);
const CUSTOMER_POOL_RECON_SORT_FIELDS = new Set([
  'pool_description', 'pool_products', 'pool_deep_report', 'pool_source_file', 'pool_notes',
]);

function authorizedCustomerSortFields({ canViewContacts = false, canViewRecon = false } = {}) {
  return Object.fromEntries(Object.entries(CUSTOMER_SORT_FIELDS).filter(([key]) => (
    (!CUSTOMER_POOL_CONTACT_SORT_FIELDS.has(key) || canViewContacts)
    && (!CUSTOMER_POOL_RECON_SORT_FIELDS.has(key) || canViewRecon)
  )));
}

const INTAKE_FLOW_CLAIMED = 'claimed';
const INTAKE_FLOW_CONTACTED = 'contacted';
const CONTACTED_STAGES = Object.freeze([
  'contacted', 'replied', 'connected', 'meeting', 'manager', 'rfq', 'quoted',
  'negotiating', 'won', 'repeat',
]);
const INTAKE_FLOW_VALUES = Object.freeze([INTAKE_FLOW_CLAIMED, INTAKE_FLOW_CONTACTED]);

function invalidSort() {
  const error = new Error('筛选条件格式无效');
  error.statusCode = 400;
  error.code = 'INVALID_CUSTOMER_SORT';
  return error;
}

function addMultiFilter(filters, params, column, values, options = {}) {
  const selected = list(values);
  if (!selected.length) return;
  const regular = selected.filter(value => value !== options.emptyValue);
  const clauses = [];
  if (regular.length) {
    clauses.push(`${column} IN (${regular.map(() => '?').join(',')})`);
    params.push(...regular);
  }
  if (selected.includes(options.emptyValue)) clauses.push(`COALESCE(${column},'')=''`);
  filters.push(`(${clauses.join(' OR ')})`);
}

function buildCustomerQuery(query, {
  user,
  canViewContacts = false,
  canViewInsights = false,
  canViewRecon = false,
  now = new Date(),
} = {}) {
  const filters = [];
  const params = [];
  const nowText = now.toISOString().slice(0, 19).replace('T', ' ');
  const today = nowText.slice(0, 10);
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowText = tomorrow.toISOString().slice(0, 10);

  const keywords = String(query.search || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const keyword of keywords) {
    const like = `%${escapeLike(keyword)}%`;
    const clauses = [
      'crm_search_fold(COALESCE(p.nickname,a.nickname)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.company_name,\'\'),a.company_name)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(p.russian_name) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(p.english_name) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(a.id) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(a.external_customer_id) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.country,\'\'),a.country)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.city,\'\'),a.city)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.website,\'\'),a.website)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.industry,\'\'),a.industry)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.customer_type,\'\'),a.customer_type)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(a.source) LIKE ? ESCAPE \'\\\'',
    ];
    params.push(...Array(12).fill(like));
    if (canViewInsights) {
      clauses.push(`EXISTS (SELECT 1 FROM crm_manager_evaluations e
        WHERE e.customer_id=a.id AND (crm_search_fold(e.evaluation_text) LIKE ? ESCAPE '\\'
          OR crm_search_fold(e.ai_labels_json) LIKE ? ESCAPE '\\'))`);
      params.push(like, like);
    }
    if (canViewContacts) {
      clauses.push('crm_search_fold(COALESCE(NULLIF(p.products,\'\'),a.product_focus)) LIKE ? ESCAPE \'\\\'');
      params.push(like);
      clauses.push(`EXISTS (SELECT 1 FROM crm_account_contacts c
        WHERE c.customer_id=a.id AND (crm_search_fold(c.name) LIKE ? ESCAPE '\\'
          OR crm_search_fold(c.title) LIKE ? ESCAPE '\\' OR crm_search_fold(c.phone) LIKE ? ESCAPE '\\'
          OR crm_search_fold(c.email) LIKE ? ESCAPE '\\'))`);
      params.push(...Array(4).fill(like));
    }
    filters.push(`(${clauses.join(' OR ')})`);
  }

  addMultiFilter(filters, params, "COALESCE(NULLIF(p.country,''),a.country)", query.countries ?? query.country);
  addMultiFilter(filters, params, "COALESCE(NULLIF(p.city,''),a.city)", query.cities);
  addMultiFilter(filters, params, 'a.owner_id', query.owners ?? query.owner, { emptyValue: '__unassigned__' });
  addMultiFilter(filters, params, 'a.stage', query.stages ?? query.stage);
  addMultiFilter(filters, params, 'a.priority', query.priorities ?? query.priority);
  addMultiFilter(filters, params, "COALESCE(NULLIF(p.customer_type,''),a.customer_type)", query.customerTypes);
  addMultiFilter(filters, params, "COALESCE(NULLIF(p.industry,''),a.industry)", query.industries);
  addMultiFilter(filters, params, 'a.source', query.sources);
  addMultiFilter(filters, params, 'a.created_by', query.creators);
  addMultiFilter(filters, params, 'CAST(COALESCE(a.established_year,p.established_year) AS TEXT)', query.establishedYears);

  const intakeFlow = list(query.intakeFlow ?? query.intake_flow);
  if (intakeFlow.length) {
    if (intakeFlow.some(flow => !INTAKE_FLOW_VALUES.includes(flow))) {
      throw unauthorizedFilter();
    }
    const clauses = [];
    if (intakeFlow.includes(INTAKE_FLOW_CLAIMED)) {
      clauses.push("a.intake_item_id!='' AND a.assignment_status='claimed'");
    }
    if (intakeFlow.includes(INTAKE_FLOW_CONTACTED)) {
      const placeholders = CONTACTED_STAGES.map(() => '?').join(',');
      clauses.push(`a.intake_item_id!='' AND a.stage IN (${placeholders})`);
      params.push(...CONTACTED_STAGES);
    }
    if (clauses.length) filters.push(`(${clauses.join(' OR ')})`);
  }

  const evaluationTags = list(query.evaluationTags ?? query.evaluationTag);
  if (evaluationTags.length) {
    if (!canViewInsights) throw unauthorizedFilter();
    const clauses = evaluationTags.map(() => `EXISTS (SELECT 1 FROM crm_manager_evaluations e
      WHERE e.customer_id=a.id AND e.ai_labels_json LIKE ? ESCAPE '\\')`);
    filters.push(`(${clauses.join(' OR ')})`);
    params.push(...evaluationTags.map(tag => `%${escapeLike(tag)}%`));
  }

  const quickView = String(query.quickView || 'all');
  if (quickView === 'mine') {
    filters.push('a.owner_id=?');
    params.push(user?.id || '');
  } else if (quickView === 'unassigned') {
    filters.push("COALESCE(a.owner_id,'')=''");
  } else if (quickView === 'today') {
    filters.push("a.next_action_at>=? AND a.next_action_at<?");
    params.push(`${today} 00:00:00`, `${tomorrowText} 00:00:00`);
  } else if (quickView === 'overdue') {
    filters.push("a.next_action_at!='' AND a.next_action_at<?");
    params.push(nowText);
    filters.push(`a.stage IN (${STAGES.filter(([key]) => isActivePipelineStage(key)).map(() => '?').join(',')})`);
    params.push(...STAGES.filter(([key]) => isActivePipelineStage(key)).map(([key]) => key));
  } else if (quickView === 'no_next') {
    filters.push("COALESCE(a.next_action,'')=''");
    filters.push(`a.stage IN (${STAGES.filter(([key]) => isActivePipelineStage(key)).map(() => '?').join(',')})`);
    params.push(...STAGES.filter(([key]) => isActivePipelineStage(key)).map(([key]) => key));
  } else if (quickView === 'disqualified') {
    filters.push("a.stage='disqualified'");
  }

  if (truthy(query.onlyOverdue) && quickView !== 'overdue') {
    filters.push("a.next_action_at!='' AND a.next_action_at<?");
    params.push(nowText);
    filters.push(`a.stage IN (${STAGES.filter(([key]) => isActivePipelineStage(key)).map(() => '?').join(',')})`);
    params.push(...STAGES.filter(([key]) => isActivePipelineStage(key)).map(([key]) => key));
  }

  const reached = String(query.stageReached || '');
  if (reached && isValidStage(reached)) {
    const reachedStages = STAGES.map(([key]) => key).filter(stage => hasReachedStage(stage, reached));
    filters.push(reachedStages.length ? `a.stage IN (${reachedStages.map(() => '?').join(',')})` : '0=1');
    params.push(...reachedStages);
  }

  const lastActions = list(query.lastActionBuckets);
  if (lastActions.length) {
    const clauses = [];
    for (const bucket of lastActions) {
      if (bucket === 'none') clauses.push("COALESCE(a.last_activity_at,'')=''");
      if (bucket === 'today') { clauses.push('a.last_activity_at>=?'); params.push(`${today} 00:00:00`); }
      if (bucket === '7d') { clauses.push('a.last_activity_at>=datetime(?,"-7 days")'); params.push(nowText); }
      if (bucket === '30d') { clauses.push('a.last_activity_at>=datetime(?,"-30 days")'); params.push(nowText); }
      if (bucket === 'older') { clauses.push("a.last_activity_at!='' AND a.last_activity_at<datetime(?,'-30 days')"); params.push(nowText); }
    }
    if (clauses.length) filters.push(`(${clauses.join(' OR ')})`);
  }

  const nextSteps = list(query.nextStepBuckets);
  if (nextSteps.length) {
    const clauses = [];
    for (const bucket of nextSteps) {
      if (bucket === 'none') clauses.push("COALESCE(a.next_action,'')=''");
      if (bucket === 'overdue') { clauses.push("a.next_action_at!='' AND a.next_action_at<?"); params.push(nowText); }
      if (bucket === 'today') { clauses.push('a.next_action_at>=? AND a.next_action_at<?'); params.push(`${today} 00:00:00`, `${tomorrowText} 00:00:00`); }
      if (bucket === '7d') { clauses.push('a.next_action_at>=? AND a.next_action_at<datetime(?,"+7 days")'); params.push(`${tomorrowText} 00:00:00`, nowText); }
      if (bucket === 'later') { clauses.push('a.next_action_at>=datetime(?,"+7 days")'); params.push(nowText); }
    }
    if (clauses.length) filters.push(`(${clauses.join(' OR ')})`);
  }

  if (query.createdFrom) { filters.push('a.created_at>=?'); params.push(`${query.createdFrom} 00:00:00`); }
  if (query.createdTo) {
    const end = new Date(`${query.createdTo}T00:00:00Z`);
    if (!Number.isNaN(end.getTime())) {
      end.setUTCDate(end.getUTCDate() + 1);
      filters.push('a.created_at<?');
      params.push(`${end.toISOString().slice(0, 10)} 00:00:00`);
    }
  }

  const sortFields = authorizedCustomerSortFields({ canViewContacts, canViewRecon });
  const customSort = parseSortDescriptors(query.sort, sortFields);
  if (customSort.length) {
    const custom = orderByForSort(query.sort, sortFields, { tieBreaker: 'a.id ASC' });
    return { filters, params, orderBy: custom.orderBy, orderParams: [], sort: '' };
  }
  const sort = String(query.sort || 'pending_priority');
  if (!CUSTOMER_SORT_KEYS.includes(sort)) throw invalidSort();
  const orderParams = [];
  const orderBy = {
    pending_priority: `CASE
      WHEN a.stage IN ('won','repeat','lost','disqualified') THEN 4
      WHEN COALESCE(a.next_action_at,'')!='' AND a.next_action_at<? THEN 0
      WHEN COALESCE(a.manager_required,0)=1 AND COALESCE(a.manager_status,'')!='已完成' THEN 1
      WHEN COALESCE(a.next_action,'')='' OR COALESCE(a.next_action_at,'')='' THEN 2
      ELSE 3 END ASC,
      CASE WHEN COALESCE(a.next_action_at,'')='' THEN 1 ELSE 0 END ASC,
      a.next_action_at ASC,a.id ASC`,
    oldest_activity: "CASE WHEN COALESCE(a.last_activity_at,'')='' THEN 0 ELSE 1 END ASC,a.last_activity_at ASC,a.id ASC",
    recent_progress: "CASE WHEN COALESCE(a.last_activity_at,'')='' THEN 1 ELSE 0 END ASC,a.last_activity_at DESC,a.id ASC",
    newest: 'a.created_at DESC,a.id ASC',
    company: "COALESCE(NULLIF(p.company_name,''),a.company_name) COLLATE NOCASE ASC,a.id ASC",
  }[sort];
  if (sort === 'pending_priority') orderParams.push(nowText);

  return { filters, params, orderBy, orderParams, sort };
}

function addStageLabels(customers) {
  return customers.map(row => ({ ...row, stageLabel: STAGE_LABELS[row.stage] || row.stage }));
}

module.exports = {
  CUSTOMER_SORT_KEYS,
  CUSTOMER_SORT_FIELDS,
  list,
  buildCustomerQuery,
  addStageLabels,
};
