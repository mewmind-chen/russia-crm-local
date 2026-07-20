#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
const dbPath = path.join(root, 'data', 'crm.db');
const apply = process.argv.includes('--apply');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const demoIds = Array.from({ length: 18 }, (_, index) => `CRM-${String(index + 1).padStart(4, '0')}`);
const placeholders = demoIds.map(() => '?').join(',');
const counts = {
  demoAccounts: db.prepare(`SELECT COUNT(*) n FROM crm_accounts WHERE id IN (${placeholders})`).get(...demoIds).n,
  demoActivities: db.prepare(`SELECT COUNT(*) n FROM crm_activities WHERE customer_id IN (${placeholders})`).get(...demoIds).n,
  demoRfqs: db.prepare(`SELECT COUNT(*) n FROM crm_rfqs WHERE customer_id IN (${placeholders})`).get(...demoIds).n,
  demoQuotes: db.prepare(`SELECT COUNT(*) n FROM crm_quotes WHERE customer_id IN (${placeholders})`).get(...demoIds).n,
  demoOrders: db.prepare(`SELECT COUNT(*) n FROM crm_orders WHERE customer_id IN (${placeholders})`).get(...demoIds).n,
  legacyFollowups: db.prepare('SELECT COUNT(*) n FROM customers').get().n,
};

const legacy = db.prepare(`SELECT c.*,
  (SELECT a.id FROM crm_accounts a WHERE a.external_customer_id=c.customer_id LIMIT 1) crm_id,
  (SELECT u.id FROM sales_users u WHERE lower(u.email)=lower(c.owner) OR u.name=c.owner LIMIT 1) mapped_owner
  FROM customers c`).all();
const migratable = legacy.filter(row => row.crm_id || row.mapped_owner);
const review = legacy.filter(row => !row.crm_id && !row.mapped_owner);

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', counts, migratable: migratable.length, needsReview: review.length }, null, 2));
if (!apply) {
  if (review.length) console.log('待人工匹配负责人:', review.slice(0, 20).map(row => `${row.follow_id}:${row.company_name}:${row.owner || '未分配'}`).join('\n'));
  db.close();
  process.exit(0);
}

const backupDir = path.join(root, 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `crm-before-unification-${stamp}.db`);
db.pragma('wal_checkpoint(FULL)');
db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
const tx = db.transaction(() => {
  db.exec(`CREATE TABLE IF NOT EXISTS crm_migration_review (
    id TEXT PRIMARY KEY,source_table TEXT NOT NULL,source_id TEXT NOT NULL,reason TEXT NOT NULL,
    payload_json TEXT NOT NULL,created_at TEXT NOT NULL,resolved_at TEXT NOT NULL DEFAULT ''
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS crm_audit_log (
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL DEFAULT '',action TEXT NOT NULL,
    entity_type TEXT NOT NULL,entity_id TEXT NOT NULL DEFAULT '',detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`);
  const addAccount = db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,product_focus,
     priority,potential_value,stage,owner_id,last_activity_at,next_action,next_action_at,created_at,updated_at)
    SELECT ?,p.customer_id,p.company_name,p.country,p.city,p.website,p.industry,p.customer_type,'旧跟进迁移',p.products,
      'B',0,?,?,?, ?,?,?,?
    FROM customer_pool p WHERE p.customer_id=?`);
  const addActivity = db.prepare(`INSERT OR IGNORE INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const row of migratable) {
    let crmId = row.crm_id;
    const owner = row.mapped_owner || db.prepare('SELECT owner_id FROM crm_accounts WHERE id=?').get(crmId)?.owner_id;
    if (!crmId && owner) {
      crmId = `CRM-MIG-${crypto.createHash('sha1').update(row.customer_id).digest('hex').slice(0, 10).toUpperCase()}`;
      const stage = /报价/.test(row.status) ? 'quoted' : /询价|兴趣/.test(row.status) ? 'replied' : /联系|回复/.test(row.status) ? 'contacted' : 'qualified';
      addAccount.run(crmId, stage, owner, row.last_follow_date || row.assigned_date || now,
        row.next_action || '复核旧跟进记录', row.next_follow_date ? `${row.next_follow_date} 09:00:00` : '',
        row.assigned_date || now, now, row.customer_id);
    }
    if (crmId && owner) {
      const summary = [row.feedback, row.notes, row.invalid_reason].filter(Boolean).join('；') || '由旧跟进记录迁移';
      addActivity.run(`MIG-${row.follow_id}`, crmId, owner, 'note', row.channel || '', row.status || '',
        summary, row.next_action || '', row.next_follow_date ? `${row.next_follow_date} 09:00:00` : '',
        '', row.last_follow_date ? `${row.last_follow_date} 12:00:00` : now, now);
    }
  }
  const insertReview = db.prepare("INSERT OR REPLACE INTO crm_migration_review VALUES (?,?,?,?,?,?,'')");
  for (const row of review) insertReview.run(`REVIEW-${row.follow_id}`, 'customers', row.follow_id, '旧负责人无法映射到系统用户', JSON.stringify(row), now);
  for (const table of ['crm_orders','crm_quotes','crm_rfqs','crm_activities','crm_manager_evaluations','crm_account_contacts']) {
    db.prepare(`DELETE FROM ${table} WHERE customer_id IN (${placeholders})`).run(...demoIds);
  }
  db.prepare(`DELETE FROM crm_accounts WHERE id IN (${placeholders})`).run(...demoIds);
  db.prepare(`INSERT INTO crm_audit_log (id,user_id,action,entity_type,entity_id,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(`AUD-MIG-${Date.now()}`, 'system', 'unify_migration', 'database', '',
      JSON.stringify({ counts, migrated: migratable.length, review: review.length, backupPath }), now);
  db.prepare(`UPDATE sales_users SET must_change_password=1,updated_at=?
    WHERE id IN ('USR-ADMIN','USR-MGR','USR-S01','USR-S02','USR-S03','USR-S04')`).run(now);
});
tx();
db.close();
console.log(`统一迁移完成；备份：${backupPath}`);
