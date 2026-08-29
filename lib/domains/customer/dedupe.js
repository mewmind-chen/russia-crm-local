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

module.exports = Object.freeze({
  duplicateFingerprint,
});
