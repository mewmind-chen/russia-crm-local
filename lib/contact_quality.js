const ROLE_WORDS = /^(ceo|cto|owner|director|manager|head|chief|founder|总经理|经理|负责人|采购|采购负责人|采购总监|技术总监|总工程师|генеральный директор|директор|руководитель|начальник|менеджер)$/i;
const RELEVANT_ROLES = new Set(['procurement', 'supply_chain', 'technical', 'engineering', 'production', 'commercial', 'executive']);
const GENERIC_EMAIL_PREFIXES = new Set(['info', 'sales', 'office', 'admin', 'contact', 'support', 'hello', 'mail', 'service', 'zakaz', 'order', 'buh', 'hr']);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function looksLikePersonName(value) {
  const name = clean(value);
  if (!name || name.length < 4 || name.length > 120 || ROLE_WORDS.test(name)) return false;
  if (/[|｜:：—–]/.test(name)) return false;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 5 && !words.some(word => ROLE_WORDS.test(word));
}

function isGenericEmail(value) {
  const email = clean(value).toLowerCase();
  const at = email.indexOf('@');
  if (at <= 0) return false;
  return GENERIC_EMAIL_PREFIXES.has(email.slice(0, at));
}

function normalizeMethod(method = {}) {
  const value = clean(method.value);
  const type = clean(method.type).toLowerCase();
  const inferred = Boolean(method.is_inferred) || method.discovery_type === 'pattern_inferred';
  const generic = Boolean(method.is_generic) || (type === 'email' && isGenericEmail(value)) || ['company_generic', 'switchboard'].includes(method.discovery_type);
  return {
    ...method,
    type,
    value,
    normalized_value: type === 'email' ? value.toLowerCase() : value.replace(/[\s()\-]/g, ''),
    is_inferred: inferred,
    is_generic: generic,
    is_direct: Boolean(method.is_direct) && !generic,
    source_url: clean(method.source_url),
    verification_status: clean(method.verification_status) || 'unverified',
    discovery_type: clean(method.discovery_type) || 'manual',
  };
}

function ratePerson(person = {}, evidence = []) {
  const issues = new Set(Array.isArray(person.quality_issues) ? person.quality_issues : []);
  const nameValid = looksLikePersonName(person.full_name);
  if (!nameValid) issues.add('invalid_or_missing_person_name');
  const employment = person.employment || {};
  const employmentVerified = employment.status === 'verified_current' && Number(employment.confidence || 0) >= 70;
  const employmentLikely = employmentVerified || (employment.status === 'likely_current' && Number(employment.confidence || 0) >= 50);
  if (!employmentLikely) issues.add('employment_not_verified');
  const relevantRole = RELEVANT_ROLES.has(person.role_category) && ['decision_maker', 'influencer'].includes(person.decision_role);
  if (!relevantRole) issues.add('role_not_decision_relevant');
  const methods = (person.methods || []).map(normalizeMethod).filter(method => method.value);
  const usableDirect = methods.filter(method => method.is_direct && !method.is_generic && !method.is_inferred && ['verified', 'likely_valid'].includes(method.verification_status) && method.source_url);
  const usableInferred = methods.filter(method => method.is_inferred && !method.is_generic && ['verified', 'likely_valid', 'unverified'].includes(method.verification_status));
  const companyEntry = methods.filter(method => method.is_generic || ['company_generic', 'switchboard'].includes(method.discovery_type));
  const employmentEvidence = evidence.filter(item => item.person_id === person.person_id && item.supports_current_employment && item.source_url);
  const roleEvidence = evidence.filter(item => item.person_id === person.person_id && item.supports_decision_role && item.source_url);
  let level = 'L0';
  if (nameValid && employmentVerified && relevantRole && usableDirect.length && employmentEvidence.length && roleEvidence.length) level = 'L3';
  else if (nameValid && employmentLikely && relevantRole && usableInferred.length && employmentEvidence.length) level = 'L2';
  else if (companyEntry.length || (nameValid && employmentLikely)) level = 'L1';
  if (!usableDirect.length) issues.add('no_verified_direct_contact');
  let procurementRelevance = 'P0';
  if (['procurement', 'supply_chain'].includes(person.role_category) && ['decision_maker', 'influencer'].includes(person.decision_role)) procurementRelevance = 'P3';
  else if (['technical', 'engineering', 'production', 'executive'].includes(person.role_category) && ['decision_maker', 'influencer'].includes(person.decision_role)) procurementRelevance = 'P2';
  else if (person.role_category === 'commercial' || person.decision_role === 'entry') procurementRelevance = 'P1';
  const deliverable = level === 'L3' && ['P2', 'P3'].includes(procurementRelevance);
  return {
    ...person,
    full_name: nameValid ? clean(person.full_name) : '',
    methods,
    contact_level: level,
    procurement_relevance: procurementRelevance,
    sales_ready: deliverable,
    delivery_status: deliverable ? 'sales_ready' : level === 'L3' ? 'verified_entry_only' : level === 'L2' ? 'manual_review' : 'research_only',
    manual_review_required: level === 'L2',
    quality_issues: Array.from(issues),
  };
}

function validateContactRecon(value, expected = {}) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['结果必须是对象'];
  if (value.schema_version !== 'contact-recon-v1') errors.push('schema_version必须为contact-recon-v1');
  if (!value.job_id || (expected.jobId && value.job_id !== expected.jobId)) errors.push('job_id不匹配');
  if (!value.customer_id || (expected.customerId && value.customer_id !== expected.customerId)) errors.push('customer_id不匹配');
  if (!Array.isArray(value.people)) errors.push('people必须是数组');
  if (!Array.isArray(value.evidence)) errors.push('evidence必须是数组');
  const ids = new Set();
  (value.evidence || []).forEach((item, index) => {
    if (!item?.evidence_id) errors.push(`evidence[${index}]缺少evidence_id`);
    else if (ids.has(item.evidence_id)) errors.push(`evidence_id重复:${item.evidence_id}`);
    else ids.add(item.evidence_id);
    if (!item?.source_url) errors.push(`evidence[${index}]缺少source_url`);
  });
  (value.people || []).forEach((person, index) => {
    if (!person.person_id) errors.push(`people[${index}]缺少person_id`);
    if (person.full_name && !looksLikePersonName(person.full_name)) errors.push(`people[${index}].full_name不是有效人名`);
    (person.methods || []).forEach((method, methodIndex) => {
      if (!method.value) errors.push(`people[${index}].methods[${methodIndex}]缺少value`);
      if (method.is_inferred && method.discovery_type !== 'pattern_inferred') errors.push(`people[${index}].methods[${methodIndex}]推导标记不一致`);
    });
  });
  return errors;
}

module.exports = { looksLikePersonName, isGenericEmail, normalizeMethod, ratePerson, validateContactRecon };
