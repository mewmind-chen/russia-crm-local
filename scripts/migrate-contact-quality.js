#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { looksLikePersonName, isGenericEmail } = require('../lib/contact_quality');
const { ensureTables } = require('../lib/db');

const apply = process.argv.includes('--apply');
ensureTables();
const dbPath = path.join(__dirname, '..', 'data', 'crm.db');
const db = new Database(dbPath);
const rows = db.prepare(`SELECT r.*, p.email pool_email, p.phone pool_phone
  FROM recon_results r JOIN customer_pool p ON p.customer_id=r.customer_id
  WHERE r.updated_at=(SELECT max(x.updated_at) FROM recon_results x WHERE x.customer_id=r.customer_id)`).all();
const changes = rows.map(row => {
  const name = looksLikePersonName(row.contact_name) ? String(row.contact_name).trim() : '';
  const email = String(row.email || row.pool_email || '').trim();
  const phone = String(row.phone || row.pool_phone || '').trim();
  const hasEntry = Boolean(email || phone);
  return {
    customer_id: row.customer_id,
    job_id: row.job_id,
    raw_name: row.contact_name || '',
    accepted_name: name,
    title: name ? String(row.contact_title || '').trim() : '',
    email,
    phone,
    email_generic: email ? isGenericEmail(email) : false,
    level: hasEntry || name ? 'L1' : 'L0',
    next_action: hasEntry || name ? '继续深挖并验证具体负责人' : '启动Contact Recon寻找负责人',
  };
});

if (!apply) {
  db.close();
  console.log(JSON.stringify({ applied: false, customers: changes.length, invalid_names_rejected: changes.filter(x => x.raw_name && !x.accepted_name).length, levels: changes.reduce((a, x) => ({ ...a, [x.level]: (a[x.level] || 0) + 1 }), {}), sample: changes.slice(0, 20) }, null, 2));
  process.exit(0);
}

const backupDir = path.join(__dirname, '..', 'data', 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backup = path.join(backupDir, `crm-before-contact-history-${Date.now()}.db`);
db.backup(backup).then(() => {
  const tx = db.transaction(items => {
    const updatePool = db.prepare(`UPDATE customer_pool SET best_contact_level=?,best_person_id=?,sales_ready_contact_count=0,
      contact_recon_status='legacy_classified',contact_last_checked_at=?,contact_next_action=? WHERE customer_id=?`);
    const addEntry = db.prepare(`INSERT OR IGNORE INTO company_entry_points
      (contact_recon_job_id,customer_id,method_type,value,discovery_type,verification_status,source_url,checked_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    const addPerson = db.prepare(`INSERT OR IGNORE INTO person_candidates
      (person_id,customer_id,contact_recon_job_id,full_name,full_name_local,normalized_name,company_name,department,title,role_category,decision_role,
       employment_status,employment_confidence,contact_level,sales_ready,manual_review_required,quality_issues_json,first_found_at,last_verified_at,expires_at,created_at,updated_at)
      SELECT ?,p.customer_id,?,?,'',?,p.company_name,'',?,'unknown','unknown','unverified',20,'L1',0,0,?,?,'','',?,? FROM customer_pool p WHERE p.customer_id=?`);
    const now = new Date().toISOString();
    items.forEach(item => {
      const personId = item.accepted_name ? `LEGACY-${item.customer_id}-${item.job_id.slice(-8)}` : '';
      updatePool.run(item.level, personId, now, item.next_action, item.customer_id);
      if (item.email) addEntry.run(`LEGACY-${item.job_id}`, item.customer_id, 'email', item.email, 'company_generic', 'unverified', '', now);
      if (item.phone) addEntry.run(`LEGACY-${item.job_id}`, item.customer_id, 'phone', item.phone, 'switchboard', 'unverified', '', now);
      if (personId) addPerson.run(personId, `LEGACY-${item.job_id}`, item.accepted_name, item.accepted_name.toLowerCase(), item.title, JSON.stringify(['legacy_single_source', 'employment_not_verified', 'no_verified_direct_contact']), now, now, now, item.customer_id);
    });
  });
  tx(changes);
  db.close();
  console.log(JSON.stringify({ applied: true, backup, customers: changes.length, invalid_names_rejected: changes.filter(x => x.raw_name && !x.accepted_name).length }, null, 2));
}).catch(error => { db.close(); console.error(error.stack || error); process.exitCode = 1; });
