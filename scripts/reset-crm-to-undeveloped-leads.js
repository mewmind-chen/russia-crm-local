#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'data', 'crm.db');
const backupDir = path.join(root, 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `crm-before-lead-reset-${stamp}.db`);

async function main() {
  fs.mkdirSync(backupDir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  await db.backup(backupPath);
  const before = {
    leads: db.prepare('SELECT COUNT(*) n FROM customer_pool').get().n,
    accounts: db.prepare('SELECT COUNT(*) n FROM crm_accounts').get().n,
    assigned: db.prepare("SELECT COUNT(*) n FROM crm_intake_items WHERE status='assigned'").get().n,
  };

  db.transaction(() => {
    db.prepare('DELETE FROM crm_accounts').run();
    db.prepare(`UPDATE crm_intake_items
      SET crm_customer_id='',
          status=CASE WHEN status='claimed' THEN 'assigned' ELSE status END,
          claimed_at='',
          updated_at=?
    `).run(new Date().toISOString().slice(0, 19).replace('T', ' '));
    db.prepare(`UPDATE crm_intake_settings
      SET match_groups_json='["A","B","C","D"]',updated_by='system-lead-reset',updated_at=?
      WHERE id='default'`).run(new Date().toISOString().slice(0, 19).replace('T', ' '));
  })();

  const after = {
    leads: db.prepare('SELECT COUNT(*) n FROM customer_pool').get().n,
    accounts: db.prepare('SELECT COUNT(*) n FROM crm_accounts').get().n,
    assigned: db.prepare("SELECT COUNT(*) n FROM crm_intake_items WHERE status='assigned'").get().n,
  };
  db.close();
  console.log(JSON.stringify({ ok: true, backupPath, before, after }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
