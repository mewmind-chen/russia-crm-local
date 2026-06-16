#!/usr/bin/env node
/**
 * Export CRM domains for Bot3 pre-search deduplication.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const CRM_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(CRM_ROOT, 'data', 'crm.db');
const DEFAULT_OUTPUT = '/Users/ylf/ai-bots/bot3/workspace/crm/crm-domain-blocklist.txt';

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output') {
      args.output = path.resolve(argv[++i]);
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = path.resolve(arg.slice('--output='.length));
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/export-domain-blocklist.js [--output ${DEFAULT_OUTPUT}]`);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function normalizeDomain(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const raw = text.includes('@') ? text.split('@').pop() : text;
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .replace(/:\d+$/, '')
    .toLowerCase();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(`
    SELECT domain, website
    FROM customer_pool
    WHERE COALESCE(domain, '') != '' OR COALESCE(website, '') != ''
  `).all();
  db.close();

  const domains = [...new Set(rows.flatMap(row => [
    normalizeDomain(row.domain),
    normalizeDomain(row.website),
  ]).filter(Boolean))].sort();

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  const header = [
    '# Russia CRM domain blocklist for Bot3 customer search',
    `# generated_at=${new Date().toISOString()}`,
    `# source=${DB_PATH}`,
    `# count=${domains.length}`,
    '',
  ].join('\n');
  fs.writeFileSync(args.output, `${header}${domains.join('\n')}\n`);

  const statsPath = path.join(path.dirname(args.output), 'crm-domain-blocklist.stats.json');
  fs.writeFileSync(statsPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: DB_PATH,
    output: args.output,
    count: domains.length,
  }, null, 2)}\n`);

  console.log(`Exported ${domains.length} CRM domains to ${args.output}`);
}

main();
