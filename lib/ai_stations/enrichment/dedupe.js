'use strict';

const { normalizeWebsite } = require('./intake');

function canonicalDomain(value) {
  const website = normalizeWebsite(value);
  if (!website) return '';
  return new URL(website).hostname.replace(/^www\./i, '');
}

function storedDomain(value) {
  try { return canonicalDomain(value); }
  catch (_error) { return ''; }
}

function normalizeCompanyName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function customerRows(db) {
  return db.prepare(`SELECT p.customer_id,p.company_name,p.website,
      (SELECT a.id FROM crm_accounts a WHERE a.external_customer_id=p.customer_id ORDER BY a.id LIMIT 1) crm_account_id
    FROM customer_pool p ORDER BY p.customer_id`).all();
}

function mappedDuplicate(row, matchedBy, score) {
  return Object.freeze({
    customerId: row.customer_id,
    crmAccountId: row.crm_account_id || '',
    companyName: row.company_name,
    matchedBy,
    ...(score === undefined ? {} : { score }),
  });
}

function findExactDuplicate(db, input, options = {}) {
  const inputDomain = canonicalDomain(input?.website);
  const inputName = normalizeCompanyName(input?.companyName);
  const rows = customerRows(db).filter(row => row.customer_id !== options.excludeCustomerId);
  if (inputDomain) {
    const domainMatch = rows.find(row => storedDomain(row.website) === inputDomain);
    if (domainMatch) return mappedDuplicate(domainMatch, 'domain');
  }
  if (inputName) {
    const nameMatch = rows.find(row => normalizeCompanyName(row.company_name) === inputName);
    if (nameMatch) return mappedDuplicate(nameMatch, 'name');
  }
  return null;
}

function bigrams(value) {
  const compact = String(value || '').replace(/\s+/g, '');
  if (!compact) return new Set();
  if (compact.length === 1) return new Set([compact]);
  return new Set(Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2)));
}

function dice(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function findFuzzyDuplicateCandidates(db, input, options = {}) {
  const inputName = normalizeCompanyName(input?.companyName);
  const inputDomain = canonicalDomain(input?.website);
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.7;
  return customerRows(db)
    .filter(row => row.customer_id !== options.excludeCustomerId)
    .map(row => {
      const nameScore = dice(inputName, normalizeCompanyName(row.company_name));
      const domainScore = dice(inputDomain, storedDomain(row.website));
      return mappedDuplicate(row, nameScore >= domainScore ? 'fuzzy_name' : 'fuzzy_domain',
        Math.round(Math.max(nameScore, domainScore) * 1000) / 1000);
    })
    .filter(row => row.score >= threshold)
    .sort((left, right) => (right.score - left.score) || left.customerId.localeCompare(right.customerId));
}

module.exports = {
  canonicalDomain,
  findExactDuplicate,
  findFuzzyDuplicateCandidates,
  normalizeCompanyName,
};
