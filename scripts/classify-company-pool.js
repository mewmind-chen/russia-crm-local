#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');
const { ensureTables } = require('../lib/db');
const { classifyCompany } = require('../lib/company_screening');

ensureTables();
const db = new Database(path.join(__dirname, '..', 'data', 'crm.db'));
const args = process.argv.slice(2), apply = args.includes('--apply');
const limitArg = args.indexOf('--limit'), limit = limitArg >= 0 ? Math.max(1, Number(args[limitArg + 1] || 0)) : 0;
const all = db.prepare(`SELECT * FROM customer_pool ORDER BY customer_id`).all();
const rows = limit ? all.slice(0, limit) : all;
const classified = rows.map(row => ({ customer_id: row.customer_id, ...classifyCompany(row) }));
const groups = classified.reduce((acc, row) => { acc[row.match_group] = (acc[row.match_group] || 0) + 1; return acc; }, {});
if (!apply) { console.log(JSON.stringify({ applied:false,total:classified.length,groups,sample:classified.slice(0,10)},null,2)); db.close(); process.exit(0); }
const now = new Date().toISOString(), review = new Date(Date.now() + 30*86400000).toISOString();
const upsert = db.prepare(`INSERT INTO company_screening
  (customer_id,business_summary,company_type,product_categories_json,likely_component_needs_json,match_score,match_group,match_reasons_json,risk_level,risk_reasons_json,classification_confidence,source_urls_json,screening_status,checked_at,next_review_at,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET
  business_summary=excluded.business_summary,company_type=excluded.company_type,product_categories_json=excluded.product_categories_json,
  likely_component_needs_json=excluded.likely_component_needs_json,match_score=excluded.match_score,match_group=excluded.match_group,
  match_reasons_json=excluded.match_reasons_json,risk_level=excluded.risk_level,risk_reasons_json=excluded.risk_reasons_json,
  classification_confidence=excluded.classification_confidence,source_urls_json=excluded.source_urls_json,screening_status=excluded.screening_status,
  checked_at=excluded.checked_at,next_review_at=excluded.next_review_at,updated_at=excluded.updated_at`);
const tx = db.transaction(items => items.forEach(x => upsert.run(x.customer_id,x.business_summary,x.company_type,JSON.stringify(x.product_categories),JSON.stringify(x.likely_component_needs),x.match_score,x.match_group,JSON.stringify(x.match_reasons),x.risk_level,JSON.stringify(x.risk_reasons),x.classification_confidence,JSON.stringify(x.source_urls),'classified',now,review,now,now)));
tx(classified); db.close(); console.log(JSON.stringify({applied:true,total:classified.length,groups},null,2));
