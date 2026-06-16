#!/usr/bin/env node
/**
 * Import Bot3 normalized CRM leads into russia-crm-local SQLite customer_pool.
 *
 * Default mode is dry-run. Pass --apply to write to data/crm.db.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { ensureTables } = require('../lib/db');
const { normalizeCustomerType, normalizeIndustry } = require('../lib/taxonomy');
const { allocateCustomerId, installCustomerIdTriggers, normalizeCountryPrefix } = require('../lib/customer_ids');

const CRM_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(CRM_ROOT, 'data', 'crm.db');
const DEFAULT_INPUT = '/Users/ylf/ai-bots/bot3/workspace/crm/leads_master.json';

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    date: todayText(),
    apply: false,
    limit: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--input') {
      args.input = path.resolve(argv[++i]);
      continue;
    }
    if (arg.startsWith('--input=')) {
      args.input = path.resolve(arg.slice('--input='.length));
      continue;
    }
    if (arg === '--date') {
      args.date = argv[++i];
      continue;
    }
    if (arg.startsWith('--date=')) {
      args.date = arg.slice('--date='.length);
      continue;
    }
    if (arg === '--limit') {
      args.limit = Number(argv[++i] || 0);
      continue;
    }
    if (arg.startsWith('--limit=')) {
      args.limit = Number(arg.slice('--limit='.length) || 0);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  console.log(`
Usage:
  node scripts/import-bot3-crm-pipeline.js
  node scripts/import-bot3-crm-pipeline.js --apply
  node scripts/import-bot3-crm-pipeline.js --input /path/to/leads_master.json --date 2026-05-28 --apply

Default input:
  ${DEFAULT_INPUT}

Notes:
  - Dry-run by default.
  - --apply creates a timestamped crm.db backup before writing.
  - Existing rows are matched by normalized domain and updated in place.
`);
}

function todayText() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function clean(value) {
  if (value == null) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (/^(not found|n\/a|na|null|undefined|none|unknown|待确认|未找到|未提供|未验证)$/i.test(text)) return '';
  return text;
}

function normalizeDomain(value) {
  const text = clean(value);
  if (!text) return '';
  return text
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .replace(/:\d+$/, '')
    .toLowerCase();
}

function ensureWebsite(lead) {
  const site = clean(lead.website || lead.url);
  if (site && /^https?:\/\//i.test(site)) return site;
  const domain = normalizeDomain(lead.domain || site);
  return domain ? `https://${domain}` : '';
}

function countryName(country) {
  const value = clean(country).toLowerCase();
  if (value === 'brazil' || value === 'br' || value === '巴西') return '巴西';
  if (value === 'russia' || value === 'ru' || value === '俄罗斯') return '俄罗斯';
  return clean(country) || '俄罗斯';
}

function idPrefix(country) {
  return normalizeCountryPrefix(countryName(country));
}

function poolFromLead(lead) {
  if (lead.stage === 'Disqualified' || lead.grade === 'D') return 'D';
  if (lead.grade === 'S') return 'S';
  if (lead.grade === 'A') return 'A';
  if (lead.grade === 'B') return 'B';
  if (lead.grade === 'C') return 'C';
  const score = Number(lead.totalScore || 0);
  if (score >= 90) return 'S';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function ratingFromPool(pool) {
  return {
    S: '⭐⭐⭐⭐⭐',
    A: '⭐⭐⭐⭐',
    B: '⭐⭐⭐',
    C: '⭐⭐',
    D: '⭐',
  }[pool] || '';
}

function verificationFromLead(lead) {
  if (!lead.website) return '缺官网';
  if (lead.websiteStatus && lead.websiteStatus !== '待复核') return clean(lead.websiteStatus);
  if (lead.evidence || lead.sourceUrl) return '待复核｜有来源证据';
  return '待复核';
}

function contactCount(lead) {
  let count = 0;
  if (lead.email) count += String(lead.email).split(/[;,]/).filter(v => v.includes('@')).length;
  if (lead.phone) count += 1;
  return String(count);
}

function splitNames(lead) {
  const company = clean(lead.companyName || lead.company || lead.company_name || lead.name);
  const nativeName = clean(lead.nativeName);
  const hasCyrillic = /[А-Яа-яЁё]/.test(company);
  return {
    company,
    russianName: nativeName || (hasCyrillic ? company : ''),
    englishName: hasCyrillic ? '' : company,
  };
}

function notesForLead(lead, previousNotes = '') {
  const parts = [
    `[bot3-crm ${lead.lastSeenAt || ''}] score=${lead.totalScore || ''} grade=${lead.grade || ''} stage=${lead.stage || ''}`,
    lead.recommendedAction ? `推荐行动: ${lead.recommendedAction}` : '',
    lead.evidence ? `证据: ${lead.evidence}` : '',
    lead.sourceUrl ? `来源: ${lead.sourceUrl}` : '',
    Array.isArray(lead.riskFlags) && lead.riskFlags.length ? `风险: ${lead.riskFlags.join('; ')}` : '',
    Array.isArray(lead.missing) && lead.missing.length ? `缺失: ${lead.missing.join('; ')}` : '',
  ].filter(Boolean).join('\n');
  if (!previousNotes) return parts;
  if (previousNotes.includes(parts.split('\n')[0])) return previousNotes;
  return `${previousNotes}\n${parts}`;
}

function mapLead(lead, existingRow) {
  const website = ensureWebsite(lead);
  const domain = normalizeDomain(lead.domain || website);
  const names = splitNames(lead);
  const description = clean(lead.description || lead.product_description || lead.productDescription || lead.reason || lead.product_type || lead.productType);
  const context = [
    lead.buyerSegment,
    lead.industry,
    lead.subIndustry,
    lead.products,
    description,
    lead.product_description,
    Array.isArray(lead.tags) ? lead.tags.join(' ') : '',
  ].join(' ');
  const customerType = normalizeCustomerType(lead.buyerSegment || lead.customerType, context);
  const industry = normalizeIndustry(lead.industry || lead.subIndustry, context);
  const sourceFile = `bot3-crm-pipeline-${lead.lastSeenAt || lead.firstSeenAt || ''}`.replace(/-$/, '');

  return {
    customer_id: existingRow?.customer_id || '',
    domain,
    company_name: names.company,
    russian_name: names.russianName,
    english_name: names.englishName,
    country: countryName(lead.country),
    city: clean(lead.city),
    website,
    industry,
    customer_type: customerType,
    description,
    products: clean(lead.products || lead.subIndustry),
    rating: existingRow?.rating || '',
    current_pool: existingRow?.current_pool || '未分池',
    phone: clean(lead.phone),
    email: clean(lead.email).includes('@') ? clean(lead.email) : '',
    inn: existingRow?.inn || '',
    risk_status: Array.isArray(lead.riskFlags) && lead.riskFlags.length ? lead.riskFlags.join('; ') : (existingRow?.risk_status || ''),
    website_verification: verificationFromLead(lead),
    contact_count: contactCount(lead),
    deep_report: existingRow?.deep_report || '',
    source_file: sourceFile,
    first_found: existingRow?.first_found || clean(lead.firstSeenAt) || todayText(),
    last_found: clean(lead.lastSeenAt) || todayText(),
    search_count: String(Number(existingRow?.search_count || 0) + (existingRow ? 1 : 0 || 1)),
    verified: existingRow?.verified || '',
    notes: notesForLead(lead, existingRow?.notes || ''),
  };
}

function loadLeads(input, limit) {
  const parsed = JSON.parse(fs.readFileSync(input, 'utf8'));
  const leads = Array.isArray(parsed) ? parsed : parsed.leads;
  if (!Array.isArray(leads)) throw new Error('Input must be an array or { leads: [...] }');
  return limit > 0 ? leads.slice(0, limit) : leads;
}

function makeBackup() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backup = `${DB_PATH}.bak-${stamp}-before-bot3-crm-pipeline`;
  fs.copyFileSync(DB_PATH, backup);
  return backup;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.input)) throw new Error(`Input not found: ${args.input}`);
  ensureTables();

  const leads = loadLeads(args.input, args.limit);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');

  const existingByDomain = new Map(
    db.prepare("SELECT * FROM customer_pool WHERE domain != ''").all()
      .map(row => [normalizeDomain(row.domain), row])
  );
  const existingIds = new Set(db.prepare("SELECT customer_id FROM customer_pool").all().map(row => row.customer_id));
  installCustomerIdTriggers(db);
  const idCounters = {};

  const rows = [];
  let skipped = 0;
  for (const lead of leads) {
    const domain = normalizeDomain(lead.domain || lead.website);
    if (!domain) {
      skipped++;
      continue;
    }
    const existing = existingByDomain.get(domain);
    const row = mapLead(lead, existing);
    if (!existing) {
      row.customer_id = allocateCustomerId(existingIds, idPrefix(lead.country), idCounters);
    }
    row.__mode = existing ? 'update' : 'insert';
    rows.push(row);
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.__mode] = (acc[row.__mode] || 0) + 1;
    return acc;
  }, {});

  console.log(`\nBot3 CRM pipeline import ${args.apply ? '(APPLY)' : '(DRY-RUN)'}`);
  console.log('─'.repeat(60));
  console.log(`Input: ${args.input}`);
  console.log(`Leads: ${leads.length}`);
  console.log(`Insert: ${counts.insert || 0}`);
  console.log(`Update: ${counts.update || 0}`);
  console.log(`Skipped: ${skipped}`);
  console.log('\nSample:');
  for (const row of rows.slice(0, 8)) {
    console.log(`  ${row.__mode.toUpperCase()} ${row.customer_id} | ${row.domain} | ${row.country} | ${row.customer_type} | ${row.current_pool}/${row.rating} | ${row.company_name}`);
  }

  if (!args.apply) {
    db.close();
    console.log('\nDry-run only. Pass --apply to write SQLite.');
    return;
  }

  const backup = makeBackup();
  const insert = db.prepare(`
    INSERT INTO customer_pool (
      customer_id, domain, company_name, russian_name, english_name,
      country, city, website, industry, customer_type,
      description, products, rating, current_pool,
      phone, email, inn, risk_status, website_verification,
      contact_count, deep_report, source_file,
      first_found, last_found, search_count, verified, notes
    ) VALUES (
      @customer_id, @domain, @company_name, @russian_name, @english_name,
      @country, @city, @website, @industry, @customer_type,
      @description, @products, @rating, @current_pool,
      @phone, @email, @inn, @risk_status, @website_verification,
      @contact_count, @deep_report, @source_file,
      @first_found, @last_found, @search_count, @verified, @notes
    )
  `);
  const update = db.prepare(`
    UPDATE customer_pool SET
      company_name = @company_name,
      russian_name = CASE WHEN russian_name = '' THEN @russian_name ELSE russian_name END,
      english_name = CASE WHEN english_name = '' THEN @english_name ELSE english_name END,
      country = @country,
      city = COALESCE(NULLIF(@city, ''), city),
      website = COALESCE(NULLIF(@website, ''), website),
      industry = @industry,
      customer_type = @customer_type,
      description = COALESCE(NULLIF(@description, ''), description),
      products = COALESCE(NULLIF(@products, ''), products),
      phone = COALESCE(NULLIF(@phone, ''), phone),
      email = COALESCE(NULLIF(@email, ''), email),
      risk_status = COALESCE(NULLIF(@risk_status, ''), risk_status),
      website_verification = COALESCE(NULLIF(@website_verification, ''), website_verification),
      contact_count = @contact_count,
      source_file = @source_file,
      last_found = @last_found,
      search_count = @search_count,
      notes = @notes
    WHERE domain = @domain
  `);

  const writeAll = db.transaction(() => {
    for (const row of rows) {
      const payload = { ...row };
      delete payload.__mode;
      if (row.__mode === 'update') update.run(payload);
      else insert.run(payload);
    }
  });
  writeAll();
  db.close();

  console.log(`\nBackup: ${backup}`);
  console.log('Import complete.');
}

main();
