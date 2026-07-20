#!/usr/bin/env node
require('dotenv').config();
const fs=require('fs'),path=require('path'),Database=require('better-sqlite3');
const {ensureTables}=require('../lib/db'); ensureTables();
const args=process.argv.slice(2); function arg(n,f){const i=args.indexOf(n);return i>=0?args[i+1]:f;}
const date=arg('--date',new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
const out=path.resolve(arg('--output',path.join('reports','daily',date)));fs.mkdirSync(out,{recursive:true});
const db=new Database(path.join(__dirname,'..','data','crm.db'));
const people=db.prepare(`SELECT p.customer_id,c.company_name,c.website,s.business_summary,s.company_type,s.likely_component_needs_json,s.match_score,s.match_group,s.risk_level,
 p.full_name,p.full_name_local,p.title,p.department,p.role_category,p.decision_role,p.contact_level,p.procurement_relevance,p.delivery_status,p.sales_ready,p.employment_status,p.last_verified_at,
 (SELECT group_concat(method_type||':'||value,' | ') FROM contact_methods m WHERE m.person_id=p.person_id) contact_methods,
 (SELECT group_concat(source_url,' | ') FROM (SELECT DISTINCT source_url FROM person_evidence e WHERE e.person_id=p.person_id)) evidence_urls,
 (SELECT job_id FROM contact_recon_jobs j WHERE j.job_id=p.contact_recon_job_id AND j.report_path!='') contact_report_job_id,
 (SELECT job_id FROM recon_results r WHERE r.customer_id=p.customer_id AND r.report_path!='' ORDER BY r.updated_at DESC LIMIT 1) report_job_id
 FROM person_candidates p JOIN customer_pool c ON c.customer_id=p.customer_id LEFT JOIN company_screening s ON s.customer_id=p.customer_id
 ORDER BY p.contact_level DESC,COALESCE(s.match_score,0) DESC`).all();
const screening=db.prepare(`SELECT s.*,p.company_name,p.website,p.industry,p.customer_type,p.best_contact_level FROM company_screening s JOIN customer_pool p ON p.customer_id=s.customer_id ORDER BY s.match_score DESC`).all();
const jobs=db.prepare(`SELECT j.*,p.company_name FROM contact_recon_jobs j JOIN customer_pool p ON p.customer_id=j.customer_id WHERE substr(j.updated_at,1,10)=? ORDER BY j.updated_at DESC`).all(date);
db.close();
let publicBase=String(process.env.PUBLIC_REPORT_BASE_URL||'').replace(/\/$/,'');
try{if(!publicBase)publicBase=fs.readFileSync(path.join(__dirname,'..','data','public-report-base-url.txt'),'utf8').trim().replace(/\/$/,'')}catch{}
const shareToken=String(process.env.REPORT_SHARE_TOKEN||'');
people.forEach(row=>{row.report_url=publicBase&&shareToken?(row.contact_report_job_id?`${publicBase}/share/contact-report/${encodeURIComponent(shareToken)}/${encodeURIComponent(row.contact_report_job_id)}`:row.report_job_id?`${publicBase}/share/report/${encodeURIComponent(shareToken)}/${encodeURIComponent(row.report_job_id)}`:''):''});
const esc=v=>{const s=Array.isArray(v)?v.join(' | '):String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s};
function csv(file,rows,cols){fs.writeFileSync(path.join(out,file),[cols.join(','),...rows.map(r=>cols.map(c=>esc(r[c])).join(','))].join('\n')+'\n');}
const cols=['customer_id','company_name','website','business_summary','company_type','likely_component_needs_json','match_score','match_group','risk_level','full_name','full_name_local','title','department','role_category','decision_role','contact_level','procurement_relevance','delivery_status','contact_methods','employment_status','last_verified_at','evidence_urls','report_url'];
csv('01-sales-ready-L3.csv',people.filter(x=>x.contact_level==='L3'&&x.sales_ready),cols);
csv('02-manual-review-L2.csv',people.filter(x=>x.contact_level==='L2'),cols);
csv('03-company-screening.csv',screening,['customer_id','company_name','website','business_summary','company_type','product_categories_json','likely_component_needs_json','match_score','match_group','match_reasons_json','risk_level','risk_reasons_json','classification_confidence','source_urls_json','checked_at']);
csv('04-failed-and-retry.csv',jobs.filter(x=>x.status==='failed'),['job_id','customer_id','company_name','status','attempt_count','failure_reason','validation_error','updated_at']);
const stats={date,screened:screening.length,groups:screening.reduce((a,x)=>(a[x.match_group]=(a[x.match_group]||0)+1,a),{}),l3:people.filter(x=>x.contact_level==='L3'&&x.sales_ready).length,l2:people.filter(x=>x.contact_level==='L2').length,jobs_today:jobs.length,failed_today:jobs.filter(x=>x.status==='failed').length,remaining:screening.filter(x=>!['L2','L3'].includes(x.best_contact_level)).length};
fs.writeFileSync(path.join(out,'05-daily-summary.md'),`# 每日客户交付汇总 ${date}\n\n- 已完成公司初判：${stats.screened}\n- 分组：${JSON.stringify(stats.groups)}\n- 累计 L3 可立即对接：${stats.l3}\n- 累计 L2 待人工验证：${stats.l2}\n- 今日 Contact Recon 任务：${stats.jobs_today}\n- 今日失败：${stats.failed_today}\n\n> 只有 01-sales-ready-L3.csv 可以直接交给销售；交易前仍需执行公司合规筛查。\n`);
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(stats,null,2)); console.log(JSON.stringify({output:out,...stats},null,2));
