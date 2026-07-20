#!/usr/bin/env node
const Database = require('better-sqlite3');
const path = require('path');
const { ensureTables, createContactReconJob } = require('../lib/db');
ensureTables();
const args=process.argv.slice(2), apply=!args.includes('--dry-run');
function arg(name, fallback){const i=args.indexOf(name);return i>=0?args[i+1]:fallback;}
const group=String(arg('--group','A')).toUpperCase(), country=String(arg('--country','RU')).toUpperCase(), limit=Math.max(1,Number(arg('--limit','50'))), includeReviewed=args.includes('--include-completed');
const db=new Database(path.join(__dirname,'..','data','crm.db'));
const rows=db.prepare(`SELECT s.*,p.company_name,p.website,p.industry,p.customer_type,p.best_contact_level,p.contact_recon_status
 FROM company_screening s JOIN customer_pool p ON p.customer_id=s.customer_id
 WHERE s.match_group=? AND s.risk_level!='blocked' AND (?='ALL' OR upper(p.country_code)=? OR (?='RU' AND p.country='俄罗斯'))
 AND (?=1 OR p.best_contact_level!='L3')
 AND (?=1 OR NOT EXISTS (SELECT 1 FROM contact_recon_jobs completed WHERE completed.customer_id=p.customer_id AND completed.status='done'))
 AND NOT EXISTS (SELECT 1 FROM contact_recon_jobs j WHERE j.customer_id=p.customer_id AND j.status IN ('queued','running'))
 ORDER BY s.match_score DESC,s.classification_confidence DESC,p.customer_id LIMIT ?`).all(group,country,country,country,includeReviewed?1:0,includeReviewed?1:0,limit);
db.close();
if(!apply){console.log(JSON.stringify({dry_run:true,group,country,limit,candidates:rows.map(x=>({customer_id:x.customer_id,company_name:x.company_name,score:x.match_score,type:x.company_type}))},null,2));process.exit(0);}
const results=[]; for(const row of rows){try{const r=createContactReconJob(row.customer_id,{target_roles:['采购负责人','供应链负责人','技术选型负责人','产品经理','商业负责人','总经理']});results.push({customer_id:row.customer_id,job_id:r.job.job_id,created:r.created});}catch(error){results.push({customer_id:row.customer_id,error:error.message});}}
console.log(JSON.stringify({queued:results.filter(x=>x.created).length,total:results.length,results},null,2));
