#!/usr/bin/env node
/**
 * Normalize CRM customer IDs to country prefix + global four-digit sequence.
 *
 * Example:
 *   row #937 from Brazil -> BR-0937
 *   row #1312 from Russia -> RU-1312
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  formatCustomerId,
  installCustomerIdTriggers,
  isCanonicalCustomerId,
  normalizeCountryPrefix,
} = require('../lib/customer_ids');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'crm.db');
const DRY_RUN = !process.argv.includes('--apply');

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function clean(value) {
  return String(value || '').trim();
}

function prefixForRow(row) {
  const country = clean(row.country);
  const domain = clean(row.domain).toLowerCase();
  const website = clean(row.website).toLowerCase();
  const oldPrefix = (clean(row.customer_id).match(/^([A-Z]{2})-/i) || [])[1] || '';
  if (country) return normalizeCountryPrefix(country, oldPrefix || 'RU');
  if (domain.endsWith('.br') || website.includes('.br/')) return 'BR';
  if (domain.endsWith('.de') || website.includes('.de/')) return 'DE';
  if (domain.endsWith('.ru') || website.includes('.ru/')) return 'RU';
  return normalizeCountryPrefix(oldPrefix, 'RU');
}

function dropCustomerIdTriggers(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_customer_pool_customer_id_insert_format;
    DROP TRIGGER IF EXISTS trg_customer_pool_customer_id_update_format;
    DROP TRIGGER IF EXISTS trg_customer_pool_customer_id_insert_serial_unique;
    DROP TRIGGER IF EXISTS trg_customer_pool_customer_id_update_serial_unique;
  `);
}

function getCustomerIdTables(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  return tables
    .map(row => row.name)
    .filter(name => db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all().some(col => col.name === 'customer_id'));
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');

  const rows = db.prepare('SELECT rowid, * FROM customer_pool ORDER BY rowid').all();
  const mapping = [];
  rows.forEach((row, index) => {
    const nextId = formatCustomerId(prefixForRow(row), index + 1);
    if (row.customer_id !== nextId) {
      mapping.push({
        rowid: row.rowid,
        old_id: row.customer_id,
        new_id: nextId,
        country: row.country,
        domain: row.domain,
        company_name: row.company_name,
      });
    }
  });

  const duplicateNewIds = mapping
    .map(item => item.new_id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateNewIds.length) {
    throw new Error(`重编号目标有重复: ${Array.from(new Set(duplicateNewIds)).join(', ')}`);
  }

  const finalIds = rows.map((row, index) => {
    const mapped = mapping.find(item => item.old_id === row.customer_id);
    return mapped ? mapped.new_id : formatCustomerId(prefixForRow(row), index + 1);
  });
  if (new Set(finalIds).size !== finalIds.length) {
    throw new Error('重编号后的 customer_id 不唯一');
  }

  console.log(`Customer ID normalize ${DRY_RUN ? '(DRY-RUN)' : '(APPLY)'}`);
  console.log('─'.repeat(60));
  console.log(`Rows: ${rows.length}`);
  console.log(`Changes: ${mapping.length}`);
  console.table(mapping.slice(0, 20).map(item => ({
    rowid: item.rowid,
    old_id: item.old_id,
    new_id: item.new_id,
    country: item.country,
    domain: item.domain,
  })));

  if (DRY_RUN) {
    db.close();
    console.log('\nDry-run only. Pass --apply to update SQLite.');
    return;
  }

  const backup = `${DB_PATH}.bak-${stamp()}-before-customer-id-normalize`;
  fs.copyFileSync(DB_PATH, backup);

  const tables = getCustomerIdTables(db);
  const updateByTable = new Map(tables.map(table => [
    table,
    db.prepare(`UPDATE ${JSON.stringify(table)} SET customer_id = ? WHERE customer_id = ?`),
  ]));

  const writeAll = db.transaction(() => {
    dropCustomerIdTriggers(db);
    for (const item of mapping) {
      for (const table of tables) {
        updateByTable.get(table).run(item.new_id, item.old_id);
      }
    }
    installCustomerIdTriggers(db);
  });
  writeAll();

  const bad = db.prepare(`
    SELECT customer_id FROM customer_pool
    WHERE customer_id NOT GLOB '[A-Z][A-Z]-[0-9][0-9][0-9][0-9]'
    LIMIT 10
  `).all();
  const duplicateSerials = db.prepare(`
    SELECT SUBSTR(customer_id, 4, 4) AS serial, COUNT(*) AS cnt
    FROM customer_pool
    GROUP BY serial
    HAVING cnt > 1
    LIMIT 10
  `).all();
  const count = db.prepare('SELECT COUNT(*) AS count FROM customer_pool').get().count;
  const maxSerial = db.prepare('SELECT MAX(CAST(SUBSTR(customer_id, 4, 4) AS INTEGER)) AS max_serial FROM customer_pool').get().max_serial;
  db.close();

  if (bad.length || duplicateSerials.length || count !== maxSerial) {
    throw new Error(`校验失败 bad=${bad.length} duplicateSerials=${duplicateSerials.length} count=${count} maxSerial=${maxSerial}`);
  }

  console.log(`\nBackup: ${backup}`);
  console.log('Normalize complete.');
}

main();
