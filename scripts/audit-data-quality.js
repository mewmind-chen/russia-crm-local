#!/usr/bin/env node
const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'data', 'crm.db'), { readonly: true });
const one = (sql, params = []) => db.prepare(sql).get(...params);
const scalar = sql => Number(Object.values(one(sql))[0] || 0);
const totalPool = scalar('SELECT COUNT(*) FROM customer_pool');
const totalRecon = scalar('SELECT COUNT(*) FROM recon_results');
const totalPeople = scalar('SELECT COUNT(*) FROM person_candidates');
const issues = [
  ['pool_missing_company', scalar("SELECT COUNT(*) FROM customer_pool WHERE trim(company_name) = ''"), 'warning'],
  ['pool_missing_direct_contact', scalar("SELECT COUNT(*) FROM customer_pool WHERE trim(email) = '' AND trim(phone) = ''"), 'warning'],
  ['pool_invalid_email_value', scalar("SELECT COUNT(*) FROM customer_pool WHERE trim(email) != '' AND email NOT LIKE '%@%'"), 'error'],
  ['pool_country_not_normalized', scalar("SELECT COUNT(*) FROM customer_pool WHERE country_code NOT GLOB '[A-Z][A-Z]'"), 'warning'],
  ['active_followup_missing_owner', scalar("SELECT COUNT(*) FROM customers WHERE status NOT IN ('放弃跟进','风险过高','联系方式无效') AND trim(owner) = ''"), 'error'],
  ['active_followup_missing_next_action', scalar("SELECT COUNT(*) FROM customers WHERE status NOT IN ('放弃跟进','风险过高','联系方式无效') AND trim(next_action) = ''"), 'error'],
  ['active_followup_missing_next_date', scalar("SELECT COUNT(*) FROM customers WHERE status NOT IN ('放弃跟进','风险过高','联系方式无效') AND trim(next_follow_date) = ''"), 'error'],
  ['done_job_missing_result', scalar("SELECT COUNT(*) FROM recon_jobs j LEFT JOIN recon_results r ON r.job_id=j.job_id WHERE j.status='done' AND r.job_id IS NULL"), 'error'],
  ['recon_evidence_count_mismatch', scalar("SELECT COUNT(*) FROM recon_results r WHERE CAST(r.evidence_count AS INTEGER) != (SELECT COUNT(*) FROM recon_evidence e WHERE e.job_id=r.job_id)"), 'error'],
  ['recon_missing_sanction_checked_at', scalar("SELECT COUNT(*) FROM recon_results WHERE trim(sanction_checked_at) = ''"), 'warning'],
  ['evidence_missing_source_url', scalar("SELECT COUNT(*) FROM recon_evidence WHERE trim(source_url) = ''"), 'warning'],
  ['report_file_missing', 0, 'error'],
  ['contact_l3_missing_direct_method', scalar("SELECT COUNT(*) FROM person_candidates p WHERE p.contact_level='L3' AND NOT EXISTS (SELECT 1 FROM contact_methods m WHERE m.person_id=p.person_id AND m.is_direct=1 AND m.is_generic=0 AND m.is_inferred=0 AND m.verification_status IN ('verified','likely_valid') AND trim(m.source_url)!='')"), 'error'],
  ['contact_sales_ready_not_l3', scalar("SELECT COUNT(*) FROM person_candidates WHERE sales_ready=1 AND contact_level!='L3'"), 'error'],
  ['contact_person_without_employment_evidence', scalar("SELECT COUNT(*) FROM person_candidates p WHERE p.employment_status='verified_current' AND NOT EXISTS (SELECT 1 FROM person_evidence e WHERE e.person_id=p.person_id AND e.supports_current_employment=1 AND trim(e.source_url)!='')"), 'error'],
  ['contact_only_l0_l1', scalar("SELECT COUNT(*) FROM customer_pool WHERE best_contact_level IN ('L0','L1')"), 'warning'],
];

const reportPaths = db.prepare("SELECT job_id, report_path FROM recon_results WHERE trim(report_path) != ''").all();
const fs = require('fs');
issues.find(item => item[0] === 'report_file_missing')[1] = reportPaths.filter(row => !fs.existsSync(row.report_path)).length;
const integrity = db.pragma('quick_check', { simple: true });
db.close();

const report = {
  generated_at: new Date().toISOString(),
  database_integrity: integrity,
  totals: { customer_pool: totalPool, recon_results: totalRecon, person_candidates: totalPeople },
  issues: issues.map(([code, count, severity]) => ({ code, count, severity })),
};
report.summary = {
  errors: report.issues.filter(i => i.severity === 'error' && i.count > 0).length,
  warnings: report.issues.filter(i => i.severity === 'warning' && i.count > 0).length,
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = integrity !== 'ok' ? 2 : (process.argv.includes('--strict') && report.summary.errors > 0 ? 1 : 0);
