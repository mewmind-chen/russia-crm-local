#!/usr/bin/env node
const {spawnSync}=require('child_process'),path=require('path');
const root=path.join(__dirname,'..'), args=process.argv.slice(2); function arg(n,f){const i=args.indexOf(n);return i>=0?args[i+1]:f;}
const classifyLimit=arg('--classification-limit','0'), contactLimit=arg('--contact-limit','50'), group=arg('--group','A'), country=arg('--country','RU'), enqueue=args.includes('--enqueue');
function run(script,extra){const r=spawnSync(process.execPath,[path.join(__dirname,script),...extra],{cwd:root,stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
run('classify-company-pool.js',['--apply',...(Number(classifyLimit)>0?['--limit',classifyLimit]:[])]);
if(enqueue)run('enqueue-contact-recon.js',['--group',group,'--country',country,'--limit',contactLimit]);
run('generate-contact-recon-reports.js',[]);
run('generate-daily-delivery.js',[]);
run('import-daily-sales-crm.js',[]);
