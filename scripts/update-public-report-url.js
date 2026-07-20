#!/usr/bin/env node
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');const root=path.resolve(__dirname,'..'),log=path.join(root,'logs','report-tunnel.log'),target=path.join(root,'data','public-report-base-url.txt');
if(!fs.existsSync(log))process.exit(0);const text=fs.readFileSync(log,'utf8'),matches=[...text.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi)];if(!matches.length)process.exit(0);const url=matches[matches.length-1][0],old=fs.existsSync(target)?fs.readFileSync(target,'utf8').trim():'';
if(url!==old){fs.writeFileSync(target,url+'\n');spawnSync(process.execPath,[path.join(__dirname,'generate-daily-delivery.js')],{cwd:root,stdio:'ignore'});console.log(JSON.stringify({updated:true,url}));}else console.log(JSON.stringify({updated:false,url}));
