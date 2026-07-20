#!/usr/bin/env node
const fs=require('fs'),path=require('path'),os=require('os'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'), agents=path.join(os.homedir(),'Library','LaunchAgents'), logs=path.join(root,'logs');
fs.mkdirSync(agents,{recursive:true});fs.mkdirSync(logs,{recursive:true});
const node=process.execPath, python=process.env.PYTHON_BIN||path.join(os.homedir(),'.hermes','hermes-agent','venv','bin','python3');
const cloudflared=process.env.CLOUDFLARED_BIN||'/opt/homebrew/bin/cloudflared';
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const workerEnv=`<key>EnvironmentVariables</key><dict><key>HOME</key><string>${esc(os.homedir())}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>NO_PROXY</key><string>127.0.0.1,localhost,::1</string><key>no_proxy</key><string>127.0.0.1,localhost,::1</string></dict>`;
function plist(label,args,extra='') { return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array>${args.map(x=>`<string>${esc(x)}</string>`).join('')}</array>\n<key>WorkingDirectory</key><string>${esc(root)}</string>\n<key>StandardOutPath</key><string>${esc(path.join(logs,label+'.out.log'))}</string>\n<key>StandardErrorPath</key><string>${esc(path.join(logs,label+'.err.log'))}</string>\n${extra}</dict></plist>\n`; }
const services=[
 ['com.russia-crm.server',['/bin/zsh','-l','-c',`cd '${root}' && exec '${node}' server.js`],`<key>EnvironmentVariables</key><dict><key>HOME</key><string>${esc(os.homedir())}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>NODE_ENV</key><string>production</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>`],
 ['com.russia-crm.recon-worker',[python,path.join(root,'scripts','recon_agent_worker.py'),'--poll','10','--webapp-url','http://127.0.0.1:3000/api/recon'],`${workerEnv}<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>`],
 ['com.russia-crm.contact-worker-1',[python,path.join(root,'scripts','contact_recon_worker.py'),'--url','http://127.0.0.1:3000/api/contact-recon','--poll','15'],`${workerEnv}<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>`],
 ['com.russia-crm.contact-worker-2',[python,path.join(root,'scripts','contact_recon_worker.py'),'--url','http://127.0.0.1:3000/api/contact-recon','--poll','15'],`${workerEnv}<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>`],
 ['com.russia-crm.daily-enqueue',[node,path.join(root,'scripts','daily-customer-delivery.js'),'--enqueue','--group','A','--country','RU','--contact-limit','30'],'<key>StartCalendarInterval</key><array><dict><key>Hour</key><integer>0</integer><key>Minute</key><integer>30</integer></dict><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>30</integer></dict><dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict><dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>30</integer></dict></array>'],
 ['com.russia-crm.daily-report',[node,path.join(root,'scripts','generate-daily-delivery.js')],'<key>StartCalendarInterval</key><array><dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict><dict><key>Hour</key><integer>20</integer><key>Minute</key><integer>0</integer></dict></array>'],
 ['com.russia-crm.completion-notifier',[node,path.join(root,'scripts','notify-contact-recon-complete.js')],'<key>RunAtLoad</key><true/><key>StartInterval</key><integer>300</integer>'],
 ['com.russia-crm.cloudflare-tunnel',[cloudflared,'tunnel','--config',path.join(os.homedir(),'.cloudflared','config.yml'),'run','tradepulse-crm'],`<key>EnvironmentVariables</key><dict><key>HOME</key><string>${esc(os.homedir())}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>`],
];
const uid=process.getuid();
for(const label of ['com.russia-crm.contact-worker-3','com.russia-crm.report-tunnel','com.russia-crm.report-url-watcher']){
  const obsolete=path.join(agents,label+'.plist');
  spawnSync('launchctl',['bootout',`gui/${uid}`,obsolete],{stdio:'ignore'});
  try{fs.unlinkSync(obsolete)}catch{}
}
for(const [label,args,extra] of services){const file=path.join(agents,label+'.plist');fs.writeFileSync(file,plist(label,args,extra));spawnSync('launchctl',['bootout',`gui/${uid}`,file],{stdio:'ignore'});const r=spawnSync('launchctl',['bootstrap',`gui/${uid}`,file],{encoding:'utf8'});if(r.status!==0){console.error(`${label}: ${r.stderr||'bootstrap failed'}`);process.exitCode=1;}else console.log(`installed ${label}`);}
console.log(`daily reports: ${path.join(root,'reports','daily','YYYY-MM-DD')}`);
