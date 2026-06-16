#!/usr/bin/env node
/**
 * Recompute stored recon score/rating/current_pool with the unified grading
 * standard. Dry-run by default; pass --apply to write SQLite.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { gradeReconResult } = require('../lib/recon_grading');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'crm.db');
const APPLY = process.argv.includes('--apply');

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function loadEvidence(db, jobId) {
  return db.prepare('SELECT * FROM recon_evidence WHERE job_id = ? ORDER BY id').all(jobId);
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');

  const rows = db.prepare('SELECT * FROM recon_results ORDER BY updated_at DESC, job_id DESC').all();
  const changes = [];
  for (const row of rows) {
    const evidence = loadEvidence(db, row.job_id);
    const grading = gradeReconResult(row, evidence);
    const nextNotes = String(row.notes || '').includes(grading.grading_note)
      ? row.notes
      : [row.notes, grading.grading_note].filter(Boolean).join('\n');
    if (
      String(row.score || '') !== grading.score
      || String(row.rating || '') !== grading.rating
      || String(row.current_pool || '') !== grading.current_pool
      || String(row.priority || '') !== grading.priority
      || String(row.notes || '') !== String(nextNotes || '')
    ) {
      changes.push({ row, grading, nextNotes });
    }
  }

  console.log(`Recon regrade ${APPLY ? '(APPLY)' : '(DRY-RUN)'}`);
  console.log(`Results: ${rows.length}`);
  console.log(`Changes: ${changes.length}`);
  console.table(changes.slice(0, 20).map(({ row, grading }) => ({
    job_id: row.job_id,
    customer_id: row.customer_id,
    company: String(row.company_name || '').slice(0, 28),
    old_score: row.score,
    new_score: grading.score,
    old_pool: row.current_pool,
    new_pool: grading.current_pool,
    old_rating: row.rating,
    new_rating: grading.rating,
  })));

  if (!APPLY) {
    db.close();
    console.log('Dry-run only. Pass --apply to update SQLite.');
    return;
  }

  const backup = `${DB_PATH}.bak-${stamp()}-before-recon-regrade`;
  fs.copyFileSync(DB_PATH, backup);

  const updateResult = db.prepare(`
    UPDATE recon_results
    SET score = ?, rating = ?, current_pool = ?, priority = ?, notes = ?
    WHERE job_id = ?
  `);
  const updatePool = db.prepare(`
    UPDATE customer_pool
    SET rating = ?, current_pool = ?
    WHERE customer_id = ?
  `);
  const updateCustomer = db.prepare(`
    UPDATE customers
    SET rating = ?
    WHERE customer_id = ?
  `);

  const apply = db.transaction(() => {
    for (const item of changes) {
      updateResult.run(
        item.grading.score,
        item.grading.rating,
        item.grading.current_pool,
        item.grading.priority,
        item.nextNotes,
        item.row.job_id
      );
      updatePool.run(item.grading.rating, item.grading.current_pool, item.row.customer_id);
      updateCustomer.run(item.grading.rating, item.row.customer_id);
    }
  });
  apply();
  db.close();
  console.log(`Backup: ${backup}`);
  console.log('Regrade complete.');
}

main();
