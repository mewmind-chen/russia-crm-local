#!/usr/bin/env node
const fs=require('fs'),path=require('path'),crypto=require('crypto');const root=path.resolve(__dirname,'..'),env=path.join(root,'.env');
let text=fs.existsSync(env)?fs.readFileSync(env,'utf8'):'';let match=text.match(/^REPORT_SHARE_TOKEN=(.+)$/m);
if(!match){const token=crypto.randomBytes(24).toString('hex');text+=`${text.endsWith('\n')||!text?'':'\n'}REPORT_SHARE_TOKEN=${token}\n`;fs.writeFileSync(env,text,{mode:0o600});match=[null,token];}
console.log(JSON.stringify({configured:true,token_length:String(match[1]).trim().length}));
