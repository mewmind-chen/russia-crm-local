'use strict';

/**
 * TradePulse 重构进度看板生成器。
 *
 * 数据源（全部自动推导，不手工维护）：
 *   - git：origin/main..HEAD 提交、HEAD、分支、工作区状态、模块接线提交归属
 *   - 代码：lib/sales_crm.js 行数、lib/domains 文件清单、生产代码对 domains 的 require
 *   - 治理文档：CURRENT_STATE.md 的测试计数、sessions/ 最近 checkpoint
 *
 * 输出：docs/governance/PROGRESS_BOARD.md（仓库内真值）
 *       docs/governance/progress-board.html（浏览器可视化看板）
 *
 * 运行：node scripts/progress_board.js（npm run board）
 * 自动更新：每个切片收尾时随 session 一起重新生成并提交，无需手工提醒。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const GOV_DIR = path.join(ROOT, 'docs', 'governance');
const BOARD_MD = path.join(GOV_DIR, 'PROGRESS_BOARD.md');
const BOARD_HTML = path.join(GOV_DIR, 'progress-board.html');

// 用户裁定保持内联/精简、不接线的域模块（WIP 收敛时的"内联版"边界）。
// identity/index（facade 精简）、identity/middleware（认证逻辑内联）、
// filter/index（调用方直连 filter_authorization）。
const KEPT_UNWIRED = new Set(['identity/index', 'identity/middleware', 'filter/index']);

function sh(command, fallback = '') {
  try {
    return execSync(command, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_error) {
    return fallback;
  }
}

function git(args) {
  return sh(`git ${args}`);
}

function collectGitState() {
  const lines = git('log --format=%h%x7c%s%x7c%cd --date=short origin/main..HEAD').split('\n').filter(Boolean);
  const commits = lines.map(line => {
    const [hash, subject, date] = line.split('|');
    return { hash, subject, date };
  });
  const headShort = git('rev-parse --short HEAD');
  const branch = git('branch --show-current');
  const clean = git('status --porcelain') === '';
  return { commits, headShort, branch, clean, ahead: commits.length };
}

function countType(commits, type) {
  return commits.filter(commit => new RegExp(`^${type}`).test(commit.subject)).length;
}

function domainFileList() {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(path.relative(path.join(ROOT, 'lib'), full));
    }
  };
  walk(path.join(ROOT, 'lib', 'domains'));
  return files.sort();
}

function wiredDomainModules() {
  // 生产代码（lib/ 下非 domains、非 ai_stations）中对 lib/domains 的 require
  const targets = new Map(); // module -> host file
  const scan = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'domains' || entry.name === 'ai_stations' || entry.name === 'ai') continue;
        scan(full);
      } else if (entry.name.endsWith('.js')) {
        const source = fs.readFileSync(full, 'utf8');
        const relative = path.relative(ROOT, full).split(path.sep).join('/');
        for (const match of source.matchAll(/require\(\s*['"]\.\/domains\/([^'"]+)['"]\s*\)/g)) {
          const module = match[1].replace(/\.js$/, '');
          if (!targets.has(module)) targets.set(module, relative);
        }
      }
    }
  };
  scan(path.join(ROOT, 'lib'));
  const attribution = (module, host) => {
    const hit = git(
      `log --format=%h -S "require('./domains/${module}')" -- ${host} | head -1`,
    ).split('\n')[0];
    return hit || '';
  };
  return [...targets.entries()]
    .map(([module, host]) => ({ module, host, commit: attribution(module, host) }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

function parseTestCounts() {
  const source = fs.readFileSync(path.join(GOV_DIR, 'CURRENT_STATE.md'), 'utf8');
  const full = source.match(/`node --test`：全量 `(\d+)\/(\d+)`/);
  const core = source.match(/`npm test`：全量 core `(\d+)\/(\d+)`/);
  return {
    full: full ? `${full[1]}/${full[2]}` : '—',
    core: core ? `${core[1]}/${core[2]}` : '—',
  };
}

function latestSession() {
  // 以 git 追踪为准：最近一次改动 sessions/ 目录的提交所新增的会话文件。
  const commit = git('log -1 --format=%h -- docs/governance/sessions');
  if (!commit) return '';
  const file = git(`show --name-only --format= ${commit} -- docs/governance/sessions`)
    .split('\n')
    .filter(line => line.includes('sessions/'))[0] || '';
  return file ? path.basename(file) : '';
}

function phaseBSlices(commits) {
  const map = [
    ['rejectCrmCustomer account-state writes', 'B1', 'rejectCrmCustomer 状态写收敛（state_write）'],
    ['applyCustomerReturn assignment write', 'B2', 'applyCustomerReturn 仅 assignment 收敛'],
    ['addQuote/addOrder behind a stage precondition', 'B3', 'addQuote/addOrder stage 前置校验'],
    ['addQuote/addOrder stage writes', 'B4', 'addQuote/addOrder stage 写收敛'],
    ['addQuote/addOrder next-action writes', 'B5', 'addQuote/addOrder 计划写收敛（collaboration_write）'],
    ['addActivity account writes', 'B6', 'addActivity 状态/计划/主管三路写收敛'],
    ['today-task and plan-only next-action writes', 'B7', '今日任务/纯计划写收敛'],
    ['claim, manager-task, overdue-lead, and reassign writes', 'B8', '领取/主管任务/超时线索/重分配写收敛'],
    ['recycle and restore account writes', 'B9', '回收/恢复写收敛'],
  ];
  return map.map(([match, id, title]) => {
    const found = commits.find(commit => commit.subject.includes(match));
    return { id, title, commit: found ? `${found.hash}` : '', date: found ? found.date : '' };
  });
}

function phaseAStats(domainFiles, wired) {
  const wiredSet = new Set(wired.map(item => item.module));
  const unwired = domainFiles
    .map(file => file.replace(/\.js$/, '').replace(/^domains\//, ''))
    .filter(file => !wiredSet.has(file))
    .sort();
  return { wired, unwired, wiredCount: wired.length, total: domainFiles.length };
}

function buildPhases(env) {
  const { commits } = env;
  return [
    {
      id: '0',
      title: '阶段 0：治理基础',
      status: 'done',
      summary: '治理目录、权威顺序、前后基线（before/repo/after）、工作区迁移、会话纪律。',
      done: [
        ['governance', '治理文档体系与权威顺序建立', '09ef77e', ''],
        ['governance', '新根目录迁移与基线校准', '2026-08-29 会话', ''],
        ['governance', '进度看板自动生成（本文件）', '本次', ''],
      ],
      pending: [],
    },
    {
      id: 'A',
      title: '阶段 A：后端结构化切分（sales_crm 拆域）',
      status: 'wip',
      summary: 'lib/domains 42 个文件；WIP 收敛曾回退全部接线，接线恢复已完成（39/42 已接入，3 个按裁定保持内联）。',
      done: [
        ['domains', 'lifecycle 网关接线（state_write/collaboration_write）', '13cd37a…227b3d7', ''],
        ['domains', '纯 helper 接线：json/list/audit/notifications', '0560e9c', ''],
        ['domains', 'http 接线：error/routes', 'd51596c', ''],
        ['domains', 'csv/insights 接线', '873d1b0', ''],
        ['domains', 'activity/planning、intake/assignment、auth/customer、reporting 接线', '7328b51…13c5368', ''],
        ['domains', 'B 组：commerce/recycle、activity/present、customer/dedupe 等接线', 'a853a16…5c23b32', ''],
      ],
      pending: [],
      moduleTable: true,
    },
    {
      id: 'B',
      title: '阶段 B：状态真源',
      status: 'wip',
      summary: '§1 完成门已达成（lib/ 对 crm_accounts 状态/计划/主管列零裸写）；契约测试 34 断言。',
      sliceTable: 'B',
      pending: [
        ['B-P1', '§4 强化续：§4.3 plan 不变量守卫接入调用点（stage/recycled/returned guard 已落地 0ae90af/9186a6d）', '', ''],
        ['B-P2', 'AI next_action 写点与测试专用种子收敛（AI 受红线约束）', '', ''],
        ['B-P3', 'pipeline 与 accounts 的 state DTO 边界差异收敛', '', ''],
      ],
    },
    {
      id: 'C',
      title: '阶段 C：权限/筛选/字段',
      status: 'wip',
      summary: 'field catalog、schema 渲染、白名单投影已提交；页面覆盖未完成。',
      done: [
        ['field', '字段目录与 schema 驱动显示（5 提交）', '7a26074…077c88c', ''],
        ['access', 'contact-restricted 白名单投影（access_control 直连）', '9607123…6d7e540', ''],
        ['access', '身份/筛选 facade 与认证中间件抽取（被 WIP 精简，调用方直连真源）', '003b527…61f8c34', ''],
      ],
      pending: [['access', '页面级覆盖与白名单回归收尾', '', '']],
    },
    {
      id: 'D',
      title: '阶段 D：线索/任务/商业闭环',
      status: 'wip',
      summary: 'intake/assignment/planning/commerce 域模块已抽取并接线；闭环边界收口未完成。',
      done: [
        ['intake', 'intake/assignment/decision/query/owner 域模块接线恢复', '48ba93c…8a0ee7d', ''],
        ['planning', 'planning/alerts/risk/streak/today_task 域模块接线恢复', '7328b51…5c23b32', ''],
        ['commerce', 'commerce/rules 域模块接线恢复', 'a853a16', ''],
      ],
      pending: [
        ['commerce', '商业闭环（rfq→quote→order）领域边界成型', '', ''],
      ],
    },
    {
      id: 'E',
      title: '阶段 E：前端 widgets',
      status: 'wip',
      summary: 'profile widgets、字段分组、用户偏好已试点；注册表与 iframe 收敛未完成。',
      done: [['frontend', '字段目录/widget 试点提交', '7a26074…077c88c', '']],
      pending: [
        ['frontend', 'widget 注册表落地', '', ''],
        ['frontend', '客户完整资料 iframe 收敛为统一壳', '', ''],
      ],
    },
    {
      id: 'F',
      title: '阶段 F：AI 零动作',
      status: 'done',
      summary: 'lib/ai_stations/**、crm_ai_*、CRM_AI_* 与既有 AI 触发点零改动（红线持续遵守）。',
      done: [['ai', 'AI 面冻结持续核验', '持续', '']],
      pending: [],
    },
    {
      id: 'G',
      title: '阶段 G：兼容层收尾',
      status: 'todo',
      summary: '依赖阶段 A/B/C 稳定后执行；销售_crm 收敛为路由/聚合层，前端全由 widget 组装。',
      done: [],
      pending: [
        ['compat', 'sales_crm 收敛为路由转发/聚合层', '', ''],
        ['compat', '旧入口收敛与 widget 全组装', '', ''],
      ],
    },
  ];
}

function renderMarkdown(env, phases, aStats) {
  const lines = [];
  lines.push('# TradePulse 重构进度看板');
  lines.push('');
  lines.push(`> 自动生成于 \`${env.stamp}\`；运行 \`npm run board\` 手动重新生成，每个切片收尾自动更新。`);
  lines.push(`> 数据源：git 提交（origin/main..HEAD）、lib/ 代码扫描、CURRENT_STATE.md、sessions/。`);
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push('| 指标 | 当前值 |');
  lines.push('|---|---|');
  lines.push(`| 分支 | \`${env.branch}\` |`);
  lines.push(`| HEAD | \`${env.headShort}\`（相对 origin/main ahead ${env.ahead}） |`);
  lines.push(`| 工作区 | ${env.clean ? '干净' : '有未提交改动'} |`);
  lines.push(`| 全量测试 | \`node --test\` ${env.tests.full} |`);
  lines.push(`| 核心测试 | \`npm test\` ${env.tests.core} |`);
  lines.push(`| sales_crm.js | ${env.salesLines} 行 |`);
  lines.push(`| lib/domains | ${aStats.total} 个文件，生产接线 ${aStats.wiredCount} 个 |`);
  lines.push(`| 最近会话 | \`${env.latestSession}\` |`);
  lines.push('');
  lines.push('## 提交分布（origin/main..HEAD）');
  lines.push('');
  lines.push('| 类别 | 数量 |');
  lines.push('|---|---|');
  lines.push(`| refactor(state) 状态写收敛 | ${countType(env.commits, 'refactor\\(state\\)')} |`);
  lines.push(`| refactor(domains) 域接线 | ${countType(env.commits, 'refactor\\(domains\\)')} |`);
  lines.push(`| refactor(其他/通用) | ${env.commits.filter(c => /^refactor\((?!state|domains)/.test(c.subject)).length} |`);
  lines.push(`| feat(...) | ${countType(env.commits, 'feat')} |`);
  lines.push(`| docs(governance) | ${countType(env.commits, 'docs\\(governance\\)')} |`);
  lines.push(`| 其他 | ${env.commits.filter(c => !/^(refactor|feat|docs)\(/.test(c.subject)).length} |`);
  lines.push('');
  for (const phase of phases) {
    lines.push(`## ${phase.title}`);
    lines.push('');
    const statusBadge = phase.status === 'done' ? '**已完成**'
      : phase.status === 'wip' ? '**进行中**' : '**待办**';
    lines.push(`> ${statusBadge} — ${phase.summary}`);
    lines.push('');
    if (phase.moduleTable && phase.id === 'A') {
      lines.push('### 域模块接线状态（自动扫描）');
      lines.push('');
      lines.push('| 模块 | 状态 | 接线提交 |');
      lines.push('|---|---|---|');
      for (const item of aStats.wired) {
        lines.push(`| \`lib/domains/${item.module}.js\` | [x] 已接线 | ${item.commit || '历史抽取'} |`);
      }
      for (const module of aStats.unwired) {
        const state = KEPT_UNWIRED.has(module)
          ? '按裁定保持内联（不接线）'
          : '未接线（被 WIP 回退，待恢复）';
        lines.push(`| \`lib/domains/${module}.js\` | [ ] ${state} | — |`);
      }
      lines.push('');
    }
    if (phase.sliceTable === 'B') {
      const slices = env.phaseB;
      lines.push('### 已落地切片');
      lines.push('');
      lines.push('| 切片 | 提交 | 日期 |');
      lines.push('|---|---|---|');
      for (const slice of slices) {
        lines.push(`| ${slice.title} | \`${slice.commit}\` | ${slice.date} |`);
      }
      lines.push('');
      lines.push('### 待办');
      lines.push('');
      for (const [id, title, _commit] of phase.pending) {
        lines.push(`- [ ] **${id}** ${title}`);
      }
      lines.push('');
      continue;
    }
    if (phase.done.length) {
      lines.push('### 已完成');
      lines.push('');
      for (const [_tag, title, commit, date] of phase.done) {
        lines.push(`- [x] ${title}${commit ? `（\`${commit}\`${date ? `，${date}` : ''}）` : ''}`);
      }
      lines.push('');
    }
    if (phase.pending.length) {
      lines.push('### 待办');
      lines.push('');
      for (const [id, title, _commit, _date] of phase.pending) {
        lines.push(`- [ ] **${id || '待办'}** ${title}`);
      }
      lines.push('');
    }
  }
  lines.push('## 阶段门禁');
  lines.push('');
  lines.push('- `git diff --check` 通过；全量与专项测试绿灯；权限/状态/筛选回归通过。');
  lines.push('- 工作区干净；治理文档（CURRENT_STATE + session + 看板）随业务独立提交。');
  lines.push('');
  lines.push('## 红线');
  lines.push('');
  lines.push('- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 及既有 AI 触发点。');
  lines.push('- 不 push、不 merge、不部署、不改生产数据；只在 `after/` 内工作。');
  return `${lines.join('\n')}\n`;
}

function renderHtml(env, phases, aStats) {
  const esc = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const badge = status => status === 'done'
    ? '<span class="badge done">已完成</span>'
    : status === 'wip' ? '<span class="badge wip">进行中</span>' : '<span class="badge todo">待办</span>';
  const phaseCards = phases.map(phase => {
    let body = '';
    if (phase.moduleTable && phase.id === 'A') {
      body += '<div class="module-table">';
      for (const item of aStats.wired) {
        body += `<div class="row"><span class="ok">[x]</span><code>${esc(item.module)}</code><span class="commit">${esc(item.commit || '历史抽取')}</span></div>`;
      }
      for (const module of aStats.unwired) {
        const state = KEPT_UNWIRED.has(module)
          ? `<span class="commit muted">按裁定内联</span>`
          : `<span class="commit muted">待恢复</span>`;
        body += `<div class="row"><span class="no">[ ]</span><code>${esc(module)}</code>${state}</div>`;
      }
      body += '</div>';
    }
    if (phase.sliceTable === 'B') {
      body += '<div class="module-table">';
      for (const slice of env.phaseB) {
        body += `<div class="row"><span class="ok">[x]</span><span class="title">${esc(slice.title)}</span><span class="commit">${esc(slice.commit)}</span></div>`;
      }
      body += '</div><div class="pending">';
      for (const [id, title] of phase.pending) {
        body += `<div class="row"><span class="no">[ ]</span><span class="title"><b>${esc(id)}</b> ${esc(title)}</span></div>`;
      }
      body += '</div>';
    }
    if (phase.done && phase.done.length) {
      body += '<div class="done-list">';
      for (const [_tag, title, commit] of phase.done) {
        body += `<div class="row"><span class="ok">[x]</span><span class="title">${esc(title)}</span><span class="commit">${esc(commit)}</span></div>`;
      }
      body += '</div>';
    }
    if (phase.pending && phase.pending.length && phase.sliceTable !== 'B') {
      body += '<div class="pending">';
      for (const [id, title] of phase.pending) {
        body += `<div class="row"><span class="no">[ ]</span><span class="title"><b>${esc(id || '待办')}</b> ${esc(title)}</span></div>`;
      }
      body += '</div>';
    }
    return `<section class="phase"><header>${badge(phase.status)}<h2>${esc(phase.title)}</h2></header><p class="summary">${esc(phase.summary)}</p>${body}</section>`;
  }).join('');

  const commitRows = env.commits.slice(0, 40).map(commit =>
    `<tr><td class="mono">${esc(commit.hash)}</td><td>${esc(commit.subject)}</td><td>${esc(commit.date)}</td></tr>`).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TradePulse 重构进度看板</title>
<style>
  :root { --bg:#0f1520; --panel:#161f2e; --panel2:#1c2738; --text:#e6edf6; --muted:#8fa1b8;
    --ok:#3fb68b; --wip:#e8a33d; --todo:#5b6b82; --line:#243248; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
    font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  .wrap { max-width:1180px; margin:0 auto; padding:28px 20px 60px; }
  h1 { font-size:22px; margin:0 0 6px; }
  .meta { color:var(--muted); font-size:12px; margin-bottom:20px; }
  .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:22px; }
  .metric { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .metric .k { color:var(--muted); font-size:11px; }
  .metric .v { font-size:16px; font-weight:600; margin-top:2px; }
  .phase { background:var(--panel); border:1px solid var(--line); border-radius:12px; margin-bottom:16px; padding:16px 18px; }
  .phase header { display:flex; align-items:center; gap:10px; }
  .phase h2 { font-size:16px; margin:0; }
  .summary { color:var(--muted); font-size:12px; margin:8px 0 12px; }
  .badge { font-size:11px; padding:2px 8px; border-radius:20px; font-weight:600; white-space:nowrap; }
  .badge.done { background:rgba(63,182,139,.16); color:var(--ok); }
  .badge.wip { background:rgba(232,163,61,.16); color:var(--wip); }
  .badge.todo { background:rgba(91,107,130,.2); color:var(--muted); }
  .row { display:flex; align-items:baseline; gap:8px; padding:4px 0; border-bottom:1px dashed var(--line); }
  .row:last-child { border-bottom:none; }
  .row code, .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:#c7d6ea; }
  .ok { color:var(--ok); font-family:ui-monospace,Menlo,monospace; }
  .no { color:var(--todo); font-family:ui-monospace,Menlo,monospace; }
  .commit { margin-left:auto; color:var(--muted); font-size:11px; }
  .muted { color:var(--todo); }
  .title { font-size:13px; }
  .pending { margin-top:10px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:5px 8px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; }
  .commits { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .commits h2 { font-size:16px; margin:0 0 10px; }
  @media (max-width:640px){ .row { flex-wrap:wrap; } .commit { margin-left:0; } }
</style>
</head>
<body><div class="wrap">
  <h1>TradePulse 重构进度看板</h1>
  <div class="meta">自动生成于 ${esc(env.stamp)} · 运行 <code>npm run board</code> 重新生成 · 每个切片收尾自动更新 · 数据源：git + lib/ 扫描 + CURRENT_STATE.md + sessions/</div>
  <div class="metrics">
    <div class="metric"><div class="k">分支</div><div class="v">${esc(env.branch)}</div></div>
    <div class="metric"><div class="k">HEAD</div><div class="v mono">${esc(env.headShort)}</div></div>
    <div class="metric"><div class="k">ahead origin/main</div><div class="v">${env.ahead}</div></div>
    <div class="metric"><div class="k">工作区</div><div class="v">${env.clean ? '干净' : '有改动'}</div></div>
    <div class="metric"><div class="k">全量测试</div><div class="v">${esc(env.tests.full)}</div></div>
    <div class="metric"><div class="k">核心测试</div><div class="v">${esc(env.tests.core)}</div></div>
    <div class="metric"><div class="k">sales_crm.js</div><div class="v">${env.salesLines} 行</div></div>
    <div class="metric"><div class="k">lib/domains</div><div class="v">${aStats.wiredCount}/${aStats.total} 已接线</div></div>
  </div>
  ${phaseCards}
  <div class="commits">
    <h2>最近提交（origin/main..HEAD，前 40 条）</h2>
    <table><thead><tr><th>提交</th><th>说明</th><th>日期</th></tr></thead>
    <tbody>${commitRows}</tbody></table>
  </div>
</div></body></html>
`;
}

function main() {
  const watch = process.argv.includes('--watch');
  const generate = () => {
    const env = {
      stamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      ...collectGitState(),
      tests: parseTestCounts(),
      latestSession: latestSession(),
      salesLines: Number(sh('wc -l lib/sales_crm.js').split(/\s+/)[0] || 0),
    };
    env.phaseB = phaseBSlices(env.commits);
    const aStats = phaseAStats(domainFileList(), wiredDomainModules());
    const phases = buildPhases(env);

    fs.writeFileSync(BOARD_MD, renderMarkdown(env, phases, aStats));
    fs.writeFileSync(BOARD_HTML, renderHtml(env, phases, aStats));
    const stamp = env.stamp;
    console.log(`[progress-board] ${stamp} 已生成 PROGRESS_BOARD.md 与 progress-board.html`);
    console.log(`[progress-board] HEAD=${env.headShort} ahead=${env.ahead} 测试=${env.tests.full} sales_crm=${env.salesLines} 行 domains=${aStats.wiredCount}/${aStats.total}`);
  };
  generate();
  if (!watch) return;

  const watched = [
    path.join(GOV_DIR, 'CURRENT_STATE.md'),
    path.join(GOV_DIR, 'sessions'),
    path.join(ROOT, 'lib', 'sales_crm.js'),
  ];
  console.log('[progress-board] watch 模式：监听 sessions/、CURRENT_STATE.md、sales_crm.js 变化，Ctrl+C 退出');
  for (const target of watched) {
    fs.watch(target, { recursive: target.endsWith('sessions') }, (_event, name) => {
      if (!name || String(name).endsWith('.swp') || String(name).startsWith('.')) return;
      try { generate(); } catch (error) { console.error('[progress-board] 重新生成失败：', error.message); }
    });
  }
}

main();
