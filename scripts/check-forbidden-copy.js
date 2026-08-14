'use strict';
// Issue #297 static guard: user-visible copy must not contain legacy terminology.
// Scans production sources (frontend assets, root HTML, backend lib). Test files are
// covered by the suite itself (assertions reference the new copy).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const FORBIDDEN = [
  // English eyebrows / headers
  'MANAGEMENT OVERVIEW', 'MANAGER INTERVENTION', 'PERMISSION GROUPS',
  'CUSTOMER RECYCLE BIN', 'LEAD POOL', 'CUSTOMER INTAKE',
  'CRM CUSTOMER PORTFOLIO', 'CUSTOMER PROFILE', 'CONTACT EVIDENCE',
  'PIPELINE CONTROL', 'TODAY TASKS', 'DEFERRED PLAN', 'CRM NOTIFICATIONS',
  'ACTIVITY CORRECTIONS', 'TEAM STATUS', 'MARKET INTELLIGENCE',
  'ACCESS CONTROL', 'TEAM ACCOUNTS', 'AUTHORIZED FILTERS',
  'MANAGER TASK RULES', 'AUDIT LOG', 'DUPLICATE REVIEW', 'IDENTITY REVIEW',
  'PERMISSION GROUP', 'RECON INTELLIGENCE', 'AI CONTROL PLANE',
  'MANAGER INTELLIGENCE', 'CUSTOMER IDENTITY', 'DATA MAINTENANCE',
  // Role terminology
  '提交老板', '升级老板', '老板处理', '求助老大', '需要管理者介入',
  '主管介入任务', '经理异常', '经理介入', '等待经理处理', '经理评价',
  // Correction workflow
  '审批队列', '待审批申请', '处理审批', '拒绝申请',
  // Generic buttons / labels
  '确认操作', '该销售异常',
];

const TARGETS = [
  path.join(ROOT, 'sales-assets'),
  path.join(ROOT, 'sales-crm.html'),
  path.join(ROOT, 'tradelead-v2.html'),
  path.join(ROOT, 'Index.html'),
  path.join(ROOT, 'lib'),
  path.join(ROOT, 'server.js'),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const stat = fs.statSync(dir);
  if (stat.isFile()) { out.push(dir); return out; }
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = fs.statSync(full);
    if (s.isDirectory()) {
      if (entry === 'node_modules') continue;
      walk(full, out);
    } else if (entry.endsWith('.js') || entry.endsWith('.html') || entry.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

const hits = [];
for (const target of TARGETS) {
  for (const file of walk(target)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const word of FORBIDDEN) {
        if (line.includes(word)) {
          hits.push({ file: path.relative(ROOT, file), line: index + 1, word });
        }
      }
    });
  }
}

if (hits.length) {
  console.error(`Forbidden copy found (${hits.length} hits):`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.word}`);
  }
  process.exit(1);
}
console.log('copy scan clean: no forbidden terms in production sources');
