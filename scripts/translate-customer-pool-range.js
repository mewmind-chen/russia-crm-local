#!/usr/bin/env node
/**
 * Translate customer_pool products/description into Chinese while preserving
 * original source text for CRM review.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { translateText: translate } = require('../lib/translate');

const CRM_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(CRM_ROOT, 'data', 'crm.db');
const CACHE_PATH = path.join(CRM_ROOT, 'data', '.translation-cache.json');

function parseArgs(argv) {
  const args = { from: 1, to: Number.MAX_SAFE_INTEGER, apply: false, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--from') args.from = Number(argv[++i]);
    else if (arg.startsWith('--from=')) args.from = Number(arg.slice(7));
    else if (arg === '--to') args.to = Number(argv[++i]);
    else if (arg.startsWith('--to=')) args.to = Number(arg.slice(5));
    else if (arg === '--limit') args.limit = Number(argv[++i] || 0);
    else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice(8) || 0);
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/translate-customer-pool-range.js --from 879 [--to 945] [--limit N] [--apply]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.from) || !Number.isFinite(args.to)) throw new Error('Invalid rowid range');
  return args;
}

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function backupDb() {
  const backup = `${DB_PATH}.bak-${stamp()}-before-translate-row-range`;
  fs.copyFileSync(DB_PATH, backup);
  return backup;
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
}

function hasChinese(text) {
  return /[\u3400-\u9fff]/.test(String(text || ''));
}

function hasMeaningfulSourceLanguage(text) {
  const value = String(text || '');
  return /[A-Za-zÀ-ÿА-Яа-яЁё]/.test(value);
}

function alreadyPreserved(text) {
  return /原文[:：]/.test(String(text || ''));
}

function shouldTranslate(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (alreadyPreserved(value)) return false;
  if (!hasMeaningfulSourceLanguage(value)) return false;
  return !hasChinese(value) || /[А-Яа-яЁё]/.test(value);
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function preserve(zh, original) {
  const translated = compact(zh);
  const source = compact(original);
  if (!translated || translated.toLowerCase() === source.toLowerCase()) return source;
  return `${translated}（原文：${source}）`;
}

async function translateText(text, cache) {
  const source = compact(text);
  if (cache[source]) return cache[source];
  const res = await translate(source, { to: 'zh-cn' });
  const out = compact(res.text);
  cache[source] = out;
  saveCache(cache);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cache = loadCache();
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 10000');

  const rows = db.prepare(`
    SELECT rowid, customer_id, domain, country, products, description
    FROM customer_pool
    WHERE rowid BETWEEN ? AND ?
    ORDER BY rowid
    ${args.limit > 0 ? `LIMIT ${args.limit}` : ''}
  `).all(args.from, args.to);

  const planned = [];
  for (const row of rows) {
    const update = {};
    if (shouldTranslate(row.products)) {
      const zh = await translateText(row.products, cache);
      update.products = preserve(zh, row.products);
    }
    if (shouldTranslate(row.description)) {
      const zh = await translateText(row.description, cache);
      update.description = preserve(zh, row.description);
    }
    if (/\.br$/i.test(row.domain) && row.country !== '巴西') {
      update.country = '巴西';
    }
    if (Object.keys(update).length) planned.push({ row, update });
    console.log(`${row.rowid} ${row.domain}: ${Object.keys(update).join(', ') || 'skip'}`);
  }

  console.log(`\nRows scanned: ${rows.length}`);
  console.log(`Rows to update: ${planned.length}`);
  if (!args.apply) {
    console.log('Dry-run only. Pass --apply to update SQLite.');
    db.close();
    return;
  }

  const backup = backupDb();
  const stmt = db.prepare(`
    UPDATE customer_pool
    SET products = @products,
        description = @description,
        country = @country,
        notes = @notes
    WHERE rowid = @rowid
  `);
  const write = db.transaction(() => {
    for (const item of planned) {
      const note = `[translation ${new Date().toISOString()}] products/description translated to Chinese with original preserved.`;
      stmt.run({
        rowid: item.row.rowid,
        products: item.update.products || item.row.products,
        description: item.update.description || item.row.description,
        country: item.update.country || item.row.country,
        notes: item.row.notes && !item.row.notes.includes('[translation ')
          ? `${item.row.notes}\n${note}`
          : (item.row.notes || note),
      });
    }
  });
  write();
  db.close();
  console.log(`Backup: ${backup}`);
  console.log('Translation update complete.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
