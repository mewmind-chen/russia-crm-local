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

function normalizeIdentityCompanyName(value) {
  const tokens = normalizeCompanyName(value).split(' ').filter(Boolean);
  const legalSuffixes = new Set([
    'llc', 'ltd', 'limited', 'inc', 'incorporated', 'corp', 'corporation', 'company', 'co',
    'gmbh', 'ag', 'sa', 'sas', 'sarl', 'bv', 'nv', 'plc', 'pte', 'spa', 'srl', 'oy', 'ab',
    'ооо', 'ао', 'пао', 'зао', 'оао', 'ип', 'нпо',
    '有限公司', '股份有限公司', '集团',
  ]);
  while (tokens.length > 1 && legalSuffixes.has(tokens[0])) tokens.shift();
  while (tokens.length > 1 && legalSuffixes.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

function customerRows(db, options = {}) {
  if (Array.isArray(options.rows)) return options.rows;
  const accountColumns = new Set(db.prepare('PRAGMA table_info(crm_accounts)').all().map(row => row.name));
  const activeClause = accountColumns.has('lifecycle_status')
    ? "AND COALESCE(a.lifecycle_status,'active')='active'"
    : '';
  const accountNickname = accountColumns.has('nickname') ? 'a.nickname' : "'' nickname";
  const poolColumns = new Set(db.prepare('PRAGMA table_info(customer_pool)').all().map(row => row.name));
  const aliases = ['russian_name', 'english_name', 'nickname']
    .filter(column => poolColumns.has(column))
    .map(column => `p.${column}`);
  const rows = db.prepare(`SELECT p.customer_id,p.company_name,p.website,
      ${aliases.length ? `${aliases.join(',')},` : ''}
      (SELECT a.id FROM crm_accounts a WHERE a.external_customer_id=p.customer_id ${activeClause}
        ORDER BY a.id LIMIT 1) crm_account_id
    FROM customer_pool p ORDER BY p.customer_id`).all();
  const known = new Set(rows.map(row => row.customer_id));
  for (const account of db.prepare(`SELECT a.id crm_account_id,a.external_customer_id customer_id,
      a.company_name,a.website,${accountNickname}
    FROM crm_accounts a
    WHERE TRIM(COALESCE(a.external_customer_id,''))!='' ${activeClause}
    ORDER BY a.external_customer_id,a.id`).all()) {
    if (!known.has(account.customer_id)) {
      rows.push({ ...account, russian_name: '', english_name: '' });
      known.add(account.customer_id);
    }
  }
  return options.crmOnly ? rows.filter(row => row.crm_account_id) : rows;
}

function loadDuplicateCustomerRows(db, options = {}) {
  return customerRows(db, options);
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
  const inputName = normalizeIdentityCompanyName(input?.companyName);
  const rows = customerRows(db, options).filter(row => row.customer_id !== options.excludeCustomerId);
  if (inputDomain) {
    const domainMatch = rows.find(row => storedDomain(row.website) === inputDomain);
    if (domainMatch) return mappedDuplicate(domainMatch, 'domain');
  }
  if (inputName) {
    const nameMatch = rows.find(row => [row.company_name, row.russian_name, row.english_name, row.nickname]
      .some(name => normalizeIdentityCompanyName(name) === inputName));
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

function fuzzyNameScore(left, right) {
  const normalizedLeft = normalizeIdentityCompanyName(left);
  const normalizedRight = normalizeIdentityCompanyName(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  const compactScore = dice(normalizedLeft, normalizedRight);
  const leftTokens = normalizedLeft.split(' ').filter(Boolean);
  const rightTokens = normalizedRight.split(' ').filter(Boolean);
  const tokenCountPenalty = Math.min(leftTokens.length, rightTokens.length) / Math.max(leftTokens.length, rightTokens.length);
  return compactScore * tokenCountPenalty;
}

function findFuzzyDuplicateCandidates(db, input, options = {}) {
  const inputName = normalizeIdentityCompanyName(input?.companyName);
  const inputDomain = canonicalDomain(input?.website);
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.7;
  return customerRows(db, options)
    .filter(row => row.customer_id !== options.excludeCustomerId)
    .map(row => {
      const nameScore = Math.max(...[row.company_name, row.russian_name, row.english_name, row.nickname]
        .map(name => fuzzyNameScore(inputName, name)));
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
  loadDuplicateCustomerRows,
  normalizeIdentityCompanyName,
  normalizeCompanyName,
};
