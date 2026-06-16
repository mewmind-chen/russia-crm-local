#!/usr/bin/env node
/**
 * Keep customer_pool.current_pool/rating as Recon-only fields.
 *
 * - Customers without recon_results must stay current_pool=未分池 and rating=''.
 * - Customers with recon_results are synced from the latest recon result.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { installCustomerIdTriggers } = require('../lib/customer_ids');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'crm.db');
const APPLY = process.argv.includes('--apply');

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');

  const withoutRecon = db.prepare(`
    SELECT p.customer_id, p.current_pool, p.rating, p.domain, p.company_name
    FROM customer_pool p
    LEFT JOIN recon_results r ON r.customer_id = p.customer_id
    WHERE r.job_id IS NULL
      AND (
        COALESCE(p.rating, '') != ''
        OR COALESCE(p.current_pool, '') NOT IN ('', '未分池')
      )
    ORDER BY CAST(SUBSTR(p.customer_id, 4, 4) AS INTEGER) DESC
  `).all();

  const withReconNeedingSync = db.prepare(`
    WITH latest AS (
      SELECT r.*,
             ROW_NUMBER() OVER (
               PARTITION BY r.customer_id
               ORDER BY r.updated_at DESC, r.job_id DESC
             ) rn
      FROM recon_results r
    )
    SELECT p.customer_id,
           p.current_pool AS pool_current_pool,
           p.rating AS pool_rating,
           COALESCE(NULLIF(l.current_pool, ''), '未分池') AS recon_current_pool,
           COALESCE(l.rating, '') AS recon_rating,
           l.score,
           l.quality_status
    FROM customer_pool p
    JOIN latest l ON l.customer_id = p.customer_id AND l.rn = 1
    WHERE COALESCE(p.current_pool, '') != COALESCE(NULLIF(l.current_pool, ''), '未分池')
       OR COALESCE(p.rating, '') != COALESCE(l.rating, '')
    ORDER BY CAST(SUBSTR(p.customer_id, 4, 4) AS INTEGER) DESC
  `).all();

  console.log(`Reset unrecon grades ${APPLY ? '(APPLY)' : '(DRY-RUN)'}`);
  console.log('─'.repeat(60));
  console.log(`Without Recon to reset: ${withoutRecon.length}`);
  console.log(`With Recon to sync: ${withReconNeedingSync.length}`);
  console.log('\nReset samples:');
  console.table(withoutRecon.slice(0, 20));
  console.log('\nSync samples:');
  console.table(withReconNeedingSync.slice(0, 20));

  if (!APPLY) {
    db.close();
    console.log('\nDry-run only. Pass --apply to update SQLite.');
    return;
  }

  const backup = `${DB_PATH}.bak-${stamp()}-before-recon-grade-reset`;
  fs.copyFileSync(DB_PATH, backup);

  const reset = db.prepare(`
    UPDATE customer_pool
    SET current_pool = '未分池', rating = ''
    WHERE customer_id = ?
  `);
  const resetCustomer = db.prepare(`
    UPDATE customers
    SET rating = ''
    WHERE customer_id = ?
  `);
  const syncPool = db.prepare(`
    UPDATE customer_pool
    SET current_pool = ?, rating = ?
    WHERE customer_id = ?
  `);
  const syncCustomer = db.prepare(`
    UPDATE customers
    SET rating = ?
    WHERE customer_id = ?
  `);

  const writeAll = db.transaction(() => {
    db.exec(`
      DROP TRIGGER IF EXISTS trg_customer_pool_recon_grade_insert_guard;
      DROP TRIGGER IF EXISTS trg_customer_pool_recon_grade_update_guard;
    `);
    for (const row of withoutRecon) {
      reset.run(row.customer_id);
      resetCustomer.run(row.customer_id);
    }
    for (const row of withReconNeedingSync) {
      syncPool.run(row.recon_current_pool, row.recon_rating, row.customer_id);
      syncCustomer.run(row.recon_rating, row.customer_id);
    }
    installCustomerIdTriggers(db);
  });
  writeAll();

  const remaining = db.prepare(`
    SELECT COUNT(*) AS count
    FROM customer_pool p
    LEFT JOIN recon_results r ON r.customer_id = p.customer_id
    WHERE r.job_id IS NULL
      AND (
        COALESCE(p.rating, '') != ''
        OR COALESCE(p.current_pool, '') NOT IN ('', '未分池')
      )
  `).get().count;
  db.close();

  if (remaining) throw new Error(`仍有 ${remaining} 条无 Recon 客户带池子/评级`);
  console.log(`\nBackup: ${backup}`);
  console.log('Reset complete.');
}

main();
