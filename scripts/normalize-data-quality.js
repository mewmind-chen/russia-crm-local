#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const apply = process.argv.includes('--apply');
const dbPath = path.join(__dirname, '..', 'data', 'crm.db');
const db = new Database(dbPath);
const changes = [];
const placeholders = new Set(['not found', 'unknown', 'n/a', 'na', 'none', '-', 'contato via site', 'n/a (formulário web)']);
const countryCodes = new Map([['俄罗斯', 'RU'], ['Россия', 'RU'], ['Russia', 'RU'], ['巴西', 'BR'], ['Brasil', 'BR'], ['Brazil', 'BR'], ['Germany', 'DE'], ['USA', 'US']]);

const columns = new Set(db.prepare('PRAGMA table_info(customer_pool)').all().map(r => r.name));
if (!columns.has('country_code') && apply) db.exec("ALTER TABLE customer_pool ADD COLUMN country_code TEXT NOT NULL DEFAULT ''");
if (!columns.has('email_raw') && apply) db.exec("ALTER TABLE customer_pool ADD COLUMN email_raw TEXT NOT NULL DEFAULT ''");

const selectColumns = columns.has('country_code') ? 'customer_id, country, country_code, email' : "customer_id, country, '' country_code, email";
for (const row of db.prepare(`SELECT ${selectColumns} FROM customer_pool`).all()) {
  const countryCode = countryCodes.get(String(row.country || '').trim()) || '';
  const emailRaw = String(row.email || '').trim();
  const email = placeholders.has(emailRaw.toLowerCase()) || (emailRaw && !emailRaw.includes('@')) ? '' : emailRaw;
  if (email !== emailRaw || countryCode !== row.country_code) changes.push({ customer_id: row.customer_id, country_code: countryCode, email_before: emailRaw, email_after: email });
}

if (apply) {
  const backup = path.join(__dirname, '..', 'data', 'backups', `crm-quality-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  db.backup(backup).then(() => {
    const update = db.prepare("UPDATE customer_pool SET country_code = ?, email_raw = CASE WHEN email_raw = '' THEN email ELSE email_raw END, email = ? WHERE customer_id = ?");
    const tx = db.transaction(rows => rows.forEach(row => update.run(row.country_code, row.email_after, row.customer_id)));
    tx(changes);
    db.prepare(`UPDATE recon_results SET evidence_count = (SELECT COUNT(*) FROM recon_evidence e WHERE e.job_id=recon_results.job_id), evidence_total_count = (SELECT COUNT(*) FROM recon_evidence e WHERE e.job_id=recon_results.job_id), evidence_unique_source_count = (SELECT COUNT(DISTINCT source_url) FROM recon_evidence e WHERE e.job_id=recon_results.job_id AND trim(source_url) != '')`).run();
    db.close();
    console.log(JSON.stringify({ applied: true, backup, changed_customers: changes.length }, null, 2));
  }).catch(error => { db.close(); throw error; });
} else {
  db.close();
  console.log(JSON.stringify({ applied: false, would_change_customers: changes.length, sample: changes.slice(0, 20) }, null, 2));
}
