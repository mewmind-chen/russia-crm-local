'use strict';

const { getDomain } = require('tldts');
const { normalizeWebsite } = require('./intake');

const DUPLICATE_RULE_VERSION = 'duplicate-v2';
const MIN_FUZZY_NAME_SCORE = 0.82;
const HIGH_FUZZY_NAME_SCORE = 0.9;

function canonicalHostname(value) {
  const website = normalizeWebsite(value);
  if (!website) return '';
  return new URL(website).hostname.toLowerCase().replace(/^www\./i, '');
}

function canonicalDomain(value) {
  const hostname = canonicalHostname(value);
  if (!hostname) return '';
  return getDomain(hostname, { allowPrivateDomains: true }) || '';
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

function hasTable(db, table) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function column(columns, alias, name) {
  return columns.has(name) ? `${alias}.${name}` : `''`;
}

function protectedStatusByCustomer(db) {
  if (!hasTable(db, 'crm_protected_customers')) return new Map();
  const columns = tableColumns(db, 'crm_protected_customers');
  const alphaNickname = columns.has('alpha_nickname') ? 'alpha_nickname' : "'' alpha_nickname";
  return new Map(db.prepare(`SELECT external_customer_id,status,${alphaNickname}
    FROM crm_protected_customers`).all()
    .map(row => [String(row.external_customer_id || ''), {
      status: String(row.status || ''),
      alphaNickname: String(row.alpha_nickname || ''),
    }]));
}

function withProtectedStatus(rows, statuses) {
  return rows.map(row => {
    const protectedCustomer = statuses.get(String(row.customer_id || ''));
    return {
      ...row,
      protected_status: protectedCustomer?.status || row.protected_status || '',
      protected_alpha_nickname: protectedCustomer?.alphaNickname || row.protected_alpha_nickname || '',
    };
  });
}

function visibleCustomerRows(rows, options = {}) {
  const includeProtected = options.includeProtected === true;
  return rows.filter(row => row.protected_status !== 'withdrawn'
      && (includeProtected || row.protected_status !== 'protected'))
    .filter(row => !options.crmOnly
      || row.crm_account_id
      || (includeProtected && row.protected_status === 'protected'))
    .map(row => includeProtected && row.protected_status === 'protected'
      ? { ...row, nickname: row.protected_alpha_nickname || row.nickname }
      : row);
}

function customerRows(db, options = {}) {
  const protectedStatuses = protectedStatusByCustomer(db);
  if (Array.isArray(options.rows)) {
    const inheritedProtectedScope = options.rows.some(row => row.protected_status === 'protected');
    return visibleCustomerRows(withProtectedStatus(options.rows, protectedStatuses), {
      ...options,
      includeProtected: options.includeProtected === true || inheritedProtectedScope,
    });
  }
  const accountColumns = tableColumns(db, 'crm_accounts');
  const activeClause = accountColumns.has('lifecycle_status')
    ? "AND COALESCE(a.lifecycle_status,'active')='active'"
    : '';
  const accountOrder = accountColumns.has('updated_at') ? 'a.updated_at DESC,' : '';
  const poolColumns = tableColumns(db, 'customer_pool');
  const accountRows = db.prepare(`SELECT
      a.id crm_account_id,a.external_customer_id customer_id,a.company_name,
      '' russian_name,'' english_name,
      ${column(accountColumns, 'a', 'nickname')} nickname,
      ${column(accountColumns, 'a', 'country')} country,
      ${column(accountColumns, 'a', 'city')} city,
      ${column(accountColumns, 'a', 'website')} website,
      ${column(accountColumns, 'a', 'industry')} industry,
      ${column(accountColumns, 'a', 'customer_type')} customer_type
    FROM crm_accounts a
    WHERE TRIM(COALESCE(a.external_customer_id,''))!='' ${activeClause}
    ORDER BY a.external_customer_id,${accountOrder}a.id`).all();
  const accountByCustomer = new Map();
  for (const account of accountRows) if (!accountByCustomer.has(account.customer_id)) {
    accountByCustomer.set(account.customer_id, account);
  }
  const rows = db.prepare(`SELECT
      p.customer_id,p.company_name,
      ${column(poolColumns, 'p', 'russian_name')} russian_name,
      ${column(poolColumns, 'p', 'english_name')} english_name,
      ${column(poolColumns, 'p', 'nickname')} nickname,
      ${column(poolColumns, 'p', 'country')} country,
      ${column(poolColumns, 'p', 'city')} city,
      ${column(poolColumns, 'p', 'website')} website,
      ${column(poolColumns, 'p', 'industry')} industry,
      ${column(poolColumns, 'p', 'customer_type')} customer_type
    FROM customer_pool p ORDER BY p.customer_id`).all().map(row => {
    const account = accountByCustomer.get(row.customer_id) || {};
    return {
      ...row,
      crm_account_id: account.crm_account_id || '',
      company_name: account.company_name || row.company_name,
      nickname: account.nickname || row.nickname,
      country: account.country || row.country,
      city: account.city || row.city,
      website: account.website || row.website,
      industry: account.industry || row.industry,
      customer_type: account.customer_type || row.customer_type,
    };
  });
  const known = new Set(rows.map(row => row.customer_id));
  for (const account of accountRows) {
    if (!known.has(account.customer_id)) {
      rows.push(account);
      known.add(account.customer_id);
    }
  }
  return visibleCustomerRows(withProtectedStatus(rows, protectedStatuses), options);
}

function loadDuplicateCustomerRows(db, options = {}) {
  return customerRows(db, options);
}

function evidence(kind, label, value) {
  return Object.freeze({ kind, label, value: String(value || '') });
}

function mappedDuplicate(row, match = {}) {
  const isProtected = row.protected_status === 'protected';
  if (isProtected) {
    return Object.freeze({
      customerId: row.customer_id,
      crmAccountId: row.crm_account_id || '',
      companyName: '',
      matchedBy: match.matchedBy,
      isProtected: true,
      ...(match.score === undefined ? {} : { score: match.score }),
    });
  }
  const summary = {
    customerId: row.customer_id,
    crmAccountId: row.crm_account_id || '',
    companyName: row.company_name || '',
    matchedBy: match.matchedBy,
    ...(match.score === undefined ? {} : { score: match.score }),
  };
  if (match.includeDetails !== true) return Object.freeze(summary);
  return Object.freeze({
    ...summary,
    nickname: row.nickname || '',
    website: row.website || '',
    country: row.country || '',
    city: row.city || '',
    industry: row.industry || '',
    customerType: row.customer_type || '',
    ruleVersion: DUPLICATE_RULE_VERSION,
    reliableEvidence: Object.freeze(match.reliableEvidence || []),
    referenceSignals: Object.freeze(match.referenceSignals || []),
  });
}

function findExactDuplicate(db, input, options = {}) {
  const inputDomain = canonicalDomain(input?.website);
  const inputName = normalizeIdentityCompanyName(input?.companyName);
  const rows = customerRows(db, options).filter(row => row.customer_id !== options.excludeCustomerId);
  if (inputDomain) {
    const domainMatch = rows.find(row => storedDomain(row.website) === inputDomain);
    if (domainMatch) return mappedDuplicate(domainMatch, {
      matchedBy: 'domain',
      includeDetails: true,
      reliableEvidence: [evidence('registrable_domain', '官网主域名完全一致', inputDomain)],
    });
  }
  if (inputName) {
    const nameMatch = rows.find(row => [row.company_name, row.russian_name, row.english_name, row.nickname]
      .some(name => normalizeIdentityCompanyName(name) === inputName));
    if (nameMatch) return mappedDuplicate(nameMatch, {
      matchedBy: 'name',
      includeDetails: true,
      reliableEvidence: [evidence('normalized_name', '公司规范名称完全一致', inputName)],
    });
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

function exactFieldEvidence(input, row) {
  const items = [];
  for (const [kind, label, inputKey, rowKey] of [
    ['country', '国家/地区一致', 'country', 'country'],
    ['city', '城市一致', 'city', 'city'],
    ['industry', '具体行业一致', 'industry', 'industry'],
    ['customer_type', '客户类型一致', 'customerType', 'customer_type'],
  ]) {
    const normalize = kind === 'country' ? normalizeCountryIdentity : normalizeCompanyName;
    const left = normalize(input?.[inputKey]);
    const right = normalize(row?.[rowKey]);
    if (left && right && left === right) items.push(evidence(kind, label, input[inputKey]));
  }
  const inputAliases = [input?.nickname, input?.russianName, input?.englishName]
    .concat(Array.isArray(input?.aliases) ? input.aliases : [])
    .map(normalizeIdentityCompanyName).filter(Boolean);
  const rowAliases = [row.nickname, row.russian_name, row.english_name]
    .map(normalizeIdentityCompanyName).filter(Boolean);
  const alias = inputAliases.find(item => rowAliases.includes(item));
  if (alias) items.push(evidence('alias', '别名完全一致', alias));
  return items;
}

function normalizeCountryIdentity(value) {
  const text = normalizeCompanyName(value);
  const aliases = {
    ru: 'russia', russia: 'russia', 'россия': 'russia', '俄罗斯': 'russia',
    br: 'brazil', brazil: 'brazil', brasil: 'brazil', '巴西': 'brazil',
    us: 'unitedstates', usa: 'unitedstates', 'unitedstates': 'unitedstates', '美国': 'unitedstates',
    de: 'germany', germany: 'germany', deutschland: 'germany', '德国': 'germany',
    kz: 'kazakhstan', kazakhstan: 'kazakhstan', '哈萨克斯坦': 'kazakhstan',
  };
  return aliases[text] || text;
}

function hasReliableSupport(nameScore, supportingEvidence) {
  const kinds = new Set(supportingEvidence.map(item => item.kind));
  const strongCount = ['country', 'city', 'industry', 'customer_type', 'alias']
    .filter(kind => kinds.has(kind)).length;
  if (nameScore >= HIGH_FUZZY_NAME_SCORE) return strongCount >= 1;
  return nameScore >= MIN_FUZZY_NAME_SCORE && strongCount >= 2;
}

function findFuzzyDuplicateCandidates(db, input, options = {}) {
  const inputName = normalizeIdentityCompanyName(input?.companyName);
  const inputDomain = canonicalDomain(input?.website);
  const threshold = Math.max(
    MIN_FUZZY_NAME_SCORE,
    Number.isFinite(options.threshold) ? options.threshold : MIN_FUZZY_NAME_SCORE,
  );
  return customerRows(db, options)
    .filter(row => row.customer_id !== options.excludeCustomerId)
    .map(row => {
      const names = [row.company_name, row.russian_name, row.english_name, row.nickname];
      const nameScore = Math.max(...names.map(name => fuzzyNameScore(inputName, name)));
      const roundedNameScore = Math.round(nameScore * 1000) / 1000;
      const reliableEvidence = exactFieldEvidence(input, row);
      const candidateCountry = normalizeCountryIdentity(row.country);
      const inputCountry = normalizeCountryIdentity(input?.country);
      const countryConflicts = inputCountry && candidateCountry && inputCountry !== candidateCountry;
      const referenceSignals = [];
      const candidateDomain = storedDomain(row.website);
      const domainScore = inputDomain && candidateDomain ? dice(inputDomain, candidateDomain) : 0;
      if (domainScore > 0) {
        referenceSignals.push(evidence(
          'domain_similarity',
          '域名字符相似（仅供参考）',
          `${Math.round(domainScore * 100)}%`,
        ));
      }
      return {
        row,
        nameScore: roundedNameScore,
        reliableEvidence,
        referenceSignals,
        eligible: !countryConflicts
          && roundedNameScore >= threshold
          && hasReliableSupport(roundedNameScore, reliableEvidence),
      };
    })
    .filter(item => item.eligible)
    .map(item => mappedDuplicate(item.row, {
      matchedBy: 'fuzzy_name',
      score: item.nameScore,
      includeDetails: true,
      reliableEvidence: item.reliableEvidence,
      referenceSignals: item.referenceSignals,
    }))
    .sort((left, right) => (right.score - left.score) || left.customerId.localeCompare(right.customerId));
}

module.exports = {
  DUPLICATE_RULE_VERSION,
  canonicalDomain,
  canonicalHostname,
  findExactDuplicate,
  findFuzzyDuplicateCandidates,
  loadDuplicateCustomerRows,
  normalizeIdentityCompanyName,
  normalizeCompanyName,
};
