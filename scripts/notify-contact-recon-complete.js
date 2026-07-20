#!/usr/bin/env node
const fs=require('fs'),path=require('path'),Database=require('better-sqlite3'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),dbPath=path.join(root,'data','crm.db'),statePath=path.join(root,'data','.contact-recon-notification.json');
const hermes=process.env.HERMES_BIN||path.join(process.env.HOME,'.hermes','hermes-agent','venv','bin','hermes');
const dryRun=process.argv.includes('--dry-run'),force=process.argv.includes('--force');
const db=new Database(dbPath,{readonly:true});
const queue=db.prepare(`SELECT SUM(status='queued') queued,SUM(status='running') running,SUM(status='done') done,SUM(status='failed') failed,MAX(created_at) latest_created,MAX(CASE WHEN status IN ('done','failed') THEN finished_at ELSE '' END) latest_finished FROM contact_recon_jobs`).get();
const people=db.prepare(`SELECT SUM(contact_level='L3' AND sales_ready=1) l3,SUM(contact_level='L2') l2,COUNT(*) people FROM person_candidates`).get();
const latestBatch=db.prepare(`SELECT substr(created_at,1,13) batch_hour,COUNT(*) total,SUM(status='done') done,SUM(status='failed') failed FROM contact_recon_jobs GROUP BY substr(created_at,1,13) ORDER BY batch_hour DESC LIMIT 1`).get()||{};db.close();
const active=Number(queue.queued||0)+Number(queue.running||0);if(active>0){console.log(JSON.stringify({notified:false,reason:'jobs_active',queued:Number(queue.queued||0),running:Number(queue.running||0)}));process.exit(0);}
let previous={};try{previous=JSON.parse(fs.readFileSync(statePath,'utf8'))}catch{}
const fingerprint=`${queue.latest_created||''}|${queue.latest_finished||''}|${queue.done||0}|${queue.failed||0}`;
if(!force&&previous.fingerprint===fingerprint){console.log(JSON.stringify({notified:false,reason:'already_notified',fingerprint}));process.exit(0);}
spawnSync(process.execPath,[path.join(__dirname,'generate-contact-recon-reports.js')],{cwd:root,encoding:'utf8'});
const report=spawnSync(process.execPath,[path.join(__dirname,'generate-daily-delivery.js')],{cwd:root,encoding:'utf8'});
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const reportDir=path.join(root,'reports','daily',date);
const salesFile=path.join(reportDir,'01-sales-ready-L3.csv'), failedFile=path.join(reportDir,'04-failed-and-retry.csv');
const message=[
  '🟢 Russia CRM 客户处理批次已完成',
  `最新批次：${latestBatch.batch_hour||'-'}:00，${Number(latestBatch.total||0)} 家`,
  `队列：已完成 ${Number(queue.done||0)} / 失败 ${Number(queue.failed||0)} / 排队 0 / 运行 0`,
  `联系人：L3可立即对接 ${Number(people.l3||0)} / L2待确认 ${Number(people.l2||0)}`,
  '交付文件：已附加 01-sales-ready-L3.csv，可直接下载或转发给销售',
  Number(queue.failed||0)>0?'失败明细：已附加 04-failed-and-retry.csv':'失败任务：0',
].join('\n');
if(dryRun){console.log(JSON.stringify({notified:false,dry_run:true,message,report_ok:report.status===0},null,2));process.exit(0);}
const sent=spawnSync(hermes,['send','--to','feishu','--subject','[Russia CRM 完成通知]',message,'--json'],{cwd:root,encoding:'utf8'});
if(sent.status!==0){console.error(sent.stderr||sent.stdout||'Feishu send failed');process.exit(sent.status||1);}
const attachmentResults=[];
for(const file of [salesFile,...(Number(queue.failed||0)>0?[failedFile]:[])]){
  if(!fs.existsSync(file))continue;
  const uploaded=spawnSync(hermes,['send','--to','feishu',`MEDIA:${file}`,'--json'],{cwd:root,encoding:'utf8'});
  attachmentResults.push({file:path.basename(file),success:uploaded.status===0,result:(uploaded.stdout||uploaded.stderr||'').trim().slice(0,2000)});
}
const notificationState={fingerprint,notified_at:new Date().toISOString(),result:sent.stdout.trim(),attachments:attachmentResults};
fs.writeFileSync(statePath,JSON.stringify(notificationState,null,2));
console.log(JSON.stringify({notified:true,fingerprint,result:sent.stdout.trim(),attachments:attachmentResults}));
