'use strict';

const {
  assertExternalCustomerAccess,
  forbidden,
} = require('../access_control');
const { canonicalize, contextHash, createEvidenceCollector } = require('./evidence');

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || ''); } catch (_error) { return fallback; }
}

function list(value, max = 30) {
  const parsed = parseJson(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(item => text(typeof item === 'string' ? item : JSON.stringify(item), 500)).filter(Boolean).slice(0, max);
}

function errorWithStatus(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function mapPool(row, canViewContacts) {
  const result = {
    customerId: text(row.customer_id, 160),
    domain: text(row.domain, 300),
    companyName: text(row.company_name, 300),
    russianName: text(row.russian_name, 300),
    englishName: text(row.english_name, 300),
    country: text(row.country, 100),
    city: text(row.city, 120),
    website: text(row.website, 1000),
    industry: text(row.industry, 300),
    customerType: text(row.customer_type, 160),
    description: canViewContacts ? text(row.description, 4000) : '',
    products: text(row.products, 2000),
    rating: text(row.rating, 80),
    currentPool: text(row.current_pool, 80),
    inn: text(row.inn, 120),
    riskStatus: text(row.risk_status, 120),
    websiteVerification: text(row.website_verification, 120),
    firstFound: text(row.first_found, 80),
    lastFound: text(row.last_found, 80),
    searchCount: text(row.search_count, 40),
    verified: text(row.verified, 80),
  };
  if (canViewContacts) {
    result.contactCount = text(row.contact_count, 40);
    result.notes = text(row.notes, 2000);
  }
  return result;
}

function mapScreening(row, canViewContacts = true) {
  if (!row) return null;
  return {
    businessSummary: canViewContacts ? text(row.business_summary, 4000) : '',
    companyType: text(row.company_type, 160),
    productCategories: list(row.product_categories_json),
    likelyComponentNeeds: list(row.likely_component_needs_json),
    matchScore: Number.isFinite(Number(row.match_score)) ? Number(row.match_score) : 0,
    matchGroup: text(row.match_group, 40),
    matchReasons: list(row.match_reasons_json),
    riskLevel: text(row.risk_level, 80),
    riskReasons: list(row.risk_reasons_json),
    classificationConfidence: Number.isFinite(Number(row.classification_confidence)) ? Number(row.classification_confidence) : 0,
    sourceUrls: list(row.source_urls_json, 20),
    screeningStatus: text(row.screening_status, 80),
    checkedAt: text(row.checked_at, 80),
    nextReviewAt: text(row.next_review_at, 80),
  };
}

function mapAccount(row) {
  if (!row) return null;
  return {
    id: text(row.id, 160),
    externalCustomerId: text(row.external_customer_id, 160),
    companyName: text(row.company_name, 300),
    country: text(row.country, 100),
    city: text(row.city, 120),
    website: text(row.website, 1000),
    industry: text(row.industry, 300),
    customerType: text(row.customer_type, 160),
    source: text(row.source, 120),
    productFocus: text(row.product_focus, 1000),
    priority: text(row.priority, 40),
    potentialValue: Number.isFinite(Number(row.potential_value)) ? Number(row.potential_value) : 0,
    stage: text(row.stage, 80),
    assignmentStatus: text(row.assignment_status, 80),
    lastActivityAt: text(row.last_activity_at, 80),
    nextAction: text(row.next_action, 1000),
    nextActionAt: text(row.next_action_at, 80),
    managerRequired: bool(row.manager_required),
    managerStatus: text(row.manager_status, 120),
    createdAt: text(row.created_at, 80),
    updatedAt: text(row.updated_at, 80),
  };
}

function mapRecon(row, canViewContacts) {
  if (!row) return null;
  const result = {
    jobId: text(row.job_id, 160),
    customerId: text(row.customer_id, 160),
    companyName: text(row.company_name, 300),
    website: text(row.website, 1000),
    industry: text(row.industry, 300),
    customerType: text(row.customer_type, 160),
    city: text(row.city, 120),
    inn: text(row.inn, 120),
    rating: text(row.rating, 80),
    score: text(row.score, 40),
    employees: text(row.employees, 80),
    description: canViewContacts ? text(row.description, 4000) : '',
    currentPool: text(row.current_pool, 80),
    riskStatus: text(row.risk_status, 120),
    websiteVerification: text(row.website_verification, 120),
    verified: text(row.verified, 80),
    qualityStatus: text(row.quality_status, 120),
    missingSteps: canViewContacts ? text(row.missing_steps, 1000) : '',
    step5Status: text(row.step5_status, 80),
    step5PlusStatus: text(row.step5_plus_status, 80),
    sanctionStatus: text(row.sanction_status, 120),
    priority: text(row.priority, 40),
    complianceStatus: text(row.compliance_status, 120),
    sanctioned: bool(row.sanctioned),
    evidenceCount: text(row.evidence_count, 40),
    updatedAt: text(row.updated_at, 80),
  };
  if (canViewContacts) {
    result.contactName = text(row.contact_name, 300);
    result.contactTitle = text(row.contact_title, 300);
    result.contactClassification = text(row.contact_classification, 160);
    result.contactsSummary = text(row.contacts_summary, 2000);
    result.opportunitySummary = text(row.opportunity_summary, 3000);
    result.opportunityDo = text(row.opportunity_do, 2000);
    result.opportunityNeed = text(row.opportunity_need, 2000);
    result.opportunitySell = text(row.opportunity_sell, 2000);
    result.opportunityDecision = text(row.opportunity_decision, 2000);
    result.recommendedProducts = text(row.recommended_products, 1000);
    result.outreachAngle = text(row.outreach_angle, 2000);
    result.nextAction = text(row.next_action, 1000);
  }
  return result;
}

function mapPerson(row, methods) {
  return {
    personId: text(row.person_id, 160),
    customerId: text(row.customer_id, 160),
    fullName: text(row.full_name, 300),
    fullNameLocal: text(row.full_name_local, 300),
    department: text(row.department, 200),
    title: text(row.title, 300),
    roleCategory: text(row.role_category, 120),
    decisionRole: text(row.decision_role, 120),
    employmentStatus: text(row.employment_status, 100),
    employmentConfidence: Number(row.employment_confidence) || 0,
    contactLevel: text(row.contact_level, 40),
    salesReady: bool(row.sales_ready),
    lastVerifiedAt: text(row.last_verified_at, 80),
    updatedAt: text(row.updated_at, 80),
    methods: methods.map(method => ({
      type: text(method.method_type, 80),
      value: text(method.value, 500),
      status: text(method.status, 80),
      verificationStatus: text(method.verification_status, 80),
      confidence: Number(method.confidence) || 0,
      sourceUrl: text(method.source_url, 1000),
      lastVerifiedAt: text(method.last_verified_at || method.verified_at, 80),
    })),
  };
}

function mapActivity(row, canViewContacts) {
  const result = {
    id: text(row.id, 160),
    activityType: text(row.activity_type, 100),
    channel: text(row.channel, 100),
    stageAfter: text(row.stage_after, 80),
    managerRequired: bool(row.manager_required),
    occurredAt: text(row.occurred_at, 80),
  };
  if (canViewContacts) {
    result.outcome = text(row.outcome, 500);
    result.summary = text(row.summary, 2000);
    result.nextAction = text(row.next_action, 1000);
    result.nextActionAt = text(row.next_action_at, 80);
  }
  return result;
}

function addEvidence(evidence, sourceTable, sourceId, row, fields, defaults = {}) {
  fields.forEach(([field, value, meta = {}]) => {
    const id = evidence.add({ sourceTable, sourceId, field, value, ...defaults, ...meta });
    if (id) row.evidenceIds.push(id);
  });
}

function buildCustomerContext(db, accessContext, customerId, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('database is required');
  const cleanId = text(customerId, 160);
  if (!cleanId) throw errorWithStatus('customerId is required', 400);
  assertExternalCustomerAccess(accessContext, cleanId);

  const permissions = accessContext?.permissions || {};
  const canViewContacts = Boolean(permissions.view_contacts);
  const canViewRecon = Boolean(permissions.view_recon);
  const canViewCustomers = Boolean(permissions.view_customers);
  const evidence = createEvidenceCollector({ maxEvidence: options.maxEvidence });
  const poolRow = db.prepare('SELECT * FROM customer_pool WHERE customer_id=?').get(cleanId);
  const accountRows = db.prepare('SELECT * FROM crm_accounts WHERE external_customer_id=? ORDER BY updated_at DESC,id').all(cleanId);
  const allowedAccountIds = accessContext?.accountIds instanceof Set ? accessContext.accountIds : null;
  const accountRow = accountRows.find(row => !allowedAccountIds || allowedAccountIds.has(row.id)) || null;
  if (accountRows.length && !accountRow) throw forbidden('无权访问该客户');
  if (!poolRow && !accountRow) throw errorWithStatus('customer not found', 404);

  const pool = mapPool(poolRow || {
    customer_id: cleanId,
    company_name: accountRow.company_name,
    country: accountRow.country,
    city: accountRow.city,
    website: accountRow.website,
    industry: accountRow.industry,
    customer_type: accountRow.customer_type,
    products: accountRow.product_focus,
    current_pool: 'crm',
    verified: 'crm_account',
  }, canViewContacts);
  const screening = db.prepare('SELECT * FROM company_screening WHERE customer_id=?').get(cleanId) || null;
  const reconRow = canViewRecon
    ? db.prepare('SELECT * FROM recon_results WHERE customer_id=? ORDER BY updated_at DESC,job_id DESC LIMIT 1').get(cleanId)
    : null;
  const recon = mapRecon(reconRow, canViewContacts);
  const people = canViewContacts
    ? db.prepare('SELECT * FROM person_candidates WHERE customer_id=? ORDER BY sales_ready DESC,contact_level DESC,updated_at DESC,person_id LIMIT 100').all(cleanId)
    : [];
  const mappedPeople = people.map(person => {
    const methods = db.prepare('SELECT * FROM contact_methods WHERE person_id=? ORDER BY id').all(person.person_id);
    return mapPerson(person, methods);
  });
  const personEvidence = canViewContacts
    ? db.prepare('SELECT * FROM person_evidence WHERE customer_id=? ORDER BY checked_at DESC,id DESC LIMIT 300').all(cleanId)
    : [];
  const reconEvidence = canViewRecon && canViewContacts && reconRow
    ? db.prepare('SELECT * FROM recon_evidence WHERE job_id=? AND customer_id=? ORDER BY id').all(reconRow.job_id, cleanId)
    : [];
  const activities = accountRow && canViewCustomers
    ? db.prepare('SELECT * FROM crm_activities WHERE customer_id=? ORDER BY occurred_at DESC,id DESC LIMIT 30').all(accountRow.id)
      .map(row => mapActivity(row, canViewContacts))
    : [];

  const context = {
    station: text(options.station || 'customer_fit', 80),
    customerId: cleanId,
    crmAccountId: accountRow ? text(accountRow.id, 160) : null,
    customerPool: pool,
    companyScreening: mapScreening(screening, canViewContacts),
    crmAccount: mapAccount(accountRow),
    latestRecon: recon,
    people: mappedPeople,
    activities,
    evidenceIds: [],
    permissions: {
      viewCustomers: canViewCustomers,
      viewContacts: canViewContacts,
      viewRecon: canViewRecon,
    },
  };

  addEvidence(evidence, 'customer_pool', cleanId, context, [
    ['company_name', pool.companyName], ['industry', pool.industry], ['products', pool.products],
    ['country', pool.country], ['website', pool.website], ['description', canViewContacts ? pool.description : ''],
    ['risk_status', pool.riskStatus],
  ]);
  if (screening) addEvidence(evidence, 'company_screening', cleanId, context, [
    ['business_summary', canViewContacts ? screening.business_summary : ''], ['match_score', screening.match_score, { checkedAt: screening.checked_at }],
    ['match_group', screening.match_group, { checkedAt: screening.checked_at }],
    ['likely_component_needs', list(screening.likely_component_needs_json).join(', '), { checkedAt: screening.checked_at }],
    ['risk_level', screening.risk_level, { checkedAt: screening.checked_at }],
  ]);
  if (reconRow) addEvidence(evidence, 'recon_results', reconRow.job_id, context, [
    ['description', canViewContacts ? reconRow.description : ''], ['score', reconRow.score], ['quality_status', reconRow.quality_status],
    ['risk_status', reconRow.risk_status], ['opportunity_summary', canViewContacts ? reconRow.opportunity_summary : ''],
  ], { checkedAt: reconRow.updated_at });
  reconEvidence.forEach(row => addEvidence(evidence, 'recon_evidence', `${row.job_id}:${row.id}`, context, [
    ['value', row.value, { sourceUrl: row.source_url, sourceTitle: row.source_title, checkedAt: row.checked_at, confidence: row.confidence }],
  ]));
  personEvidence.forEach(row => addEvidence(evidence, 'person_evidence', `${row.contact_recon_job_id}:${row.evidence_id}`, context, [
    ['value', row.value, { sourceUrl: row.source_url, sourceTitle: row.source_title, checkedAt: row.checked_at, confidence: row.confidence }],
  ]));

  context.evidenceIds = evidence.ids();
  const hashInput = canonicalize({ ...context, evidenceIds: undefined });
  return Object.freeze({
    context: Object.freeze(context),
    evidence: evidence.all(),
    evidenceIds: evidence.ids(),
    contextHash: contextHash(hashInput),
  });
}

module.exports = { buildCustomerContext, mapPool, mapScreening, mapAccount, mapRecon };
