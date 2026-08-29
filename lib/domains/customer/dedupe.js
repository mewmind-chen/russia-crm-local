'use strict';

// Duplicate customer fingerprinting. The v2 contract binds every fuzzy gate
// field (city, industry, customer type, aliases) while legacy approvals keep
// their original company/domain/country fingerprint.

const crypto = require('crypto');
const {
  DUPLICATE_RULE_VERSION,
  canonicalDomain,
  canonicalHostname,
  normalizeCompanyName,
} = require('../../ai_stations/enrichment/dedupe');
const { normalizeCountry } = require('./normalize');

function json(value, fallback = []) {
  try { return JSON.parse(value || 'null') ?? fallback; } catch (_e) { return fallback; }
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

module.exports = Object.freeze({
  duplicateFingerprint,
  hydrateDuplicateCandidate,
  reviewCandidateRows,
  reviewHasProtectedExact,
});
