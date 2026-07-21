require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const {
  getInitialData, updateCustomer, createTag, setCustomerTags, createReconJob,
  retryReconJob, listQueuedJobs, claimReconJob, heartbeatReconJob, markJobRunning, markJobFailed, submitReconResult,
  createProspectTask, promoteProspectCandidate,
  createContactReconJob, claimContactReconJob, heartbeatContactReconJob, failContactReconJob,
  submitContactReconResult, getContactReconState, getCustomerPeople,
} = require('./lib/db');
const { answerAssistantQuestion } = require('./lib/assistant');
const { runProspectTask } = require('./lib/prospect_agent');
const { registerSalesCrm, requireUnifiedUser, hasPermission, safeUser } = require('./lib/sales_crm');
const { policyForLegacyRequest, assertExternalCustomerAccess } = require('./lib/access_control');

function databasePath() {
  return path.resolve(process.env.CRM_DB_PATH || path.join(__dirname, 'data', 'crm.db'));
}

function createApp() {
const app = express();
app.use(express.json({ limit: '2mb' }));
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = String(req.get('origin') || '');
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.get('host')) return res.status(403).json({ ok: false, error: '请求来源校验失败' });
  } catch (_error) {
    return res.status(403).json({ ok: false, error: '请求来源校验失败' });
  }
  next();
});
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'sales-crm.html')));
if (String(process.env.CRM_ENABLE_LEGACY || '').toLowerCase() === 'true') {
  app.get('/legacy', (_req, res) => res.sendFile(path.join(__dirname, 'Index.html')));
}
if (String(process.env.CRM_ENABLE_LEGACY || '').toLowerCase() === 'true') {
  app.get('/tradelead-v2.html', (_req, res) => res.sendFile(path.join(__dirname, 'tradelead-v2.html')));
}
app.use('/shared-assets', express.static(path.join(__dirname, 'shared-assets')));
registerSalesCrm(app);
app.get('/api/session/capabilities', requireUnifiedUser, (req, res) => {
  const permissions = req.accessContext.permissions;
  const modules = [
    ['intake', 'view_intake'],
    ['customers', 'view_customers'],
    ['pool', 'view_pool'],
    ['contacts', 'view_contacts'],
    ['recon', 'view_recon'],
    ['prospect', 'use_prospect_agent'],
    ['assistant', 'use_ai_assistant'],
  ].filter(([, permission]) => permissions[permission]).map(([key]) => key);
  res.json({
    ok: true,
    user: safeUser(req.salesUser),
    permissions,
    canViewAllCustomers: req.accessContext.canViewAllCustomers,
    modules,
  });
});
app.get('/development-workbench', requireUnifiedUser, (req, res) => {
  if (!hasPermission(req.salesUser, 'view_development')) return res.status(403).send('当前账号没有客户开发工作台权限');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.sendFile(path.join(__dirname, 'Index.html'));
});
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/sales-auth/') || req.path.startsWith('/sales-crm/')
    || req.path === '/recon' || req.path === '/contact-recon') return next();
  return requireUnifiedUser(req, res, () => {
    const action = String(req.body?.action || '');
    const policy = policyForLegacyRequest(req.method, req.path, action);
    if (policy.deny) {
      auditDeniedWrite(req, action);
      return res.status(403).json({ ok: false, error: '该接口未配置访问权限' });
    }
    const missing = (policy.permissions || []).find(permission => !req.accessContext.permissions[permission]);
    if (missing) {
      auditDeniedWrite(req, action);
      return res.status(403).json({ ok: false, error: `没有权限：${missing}` });
    }
    req.accessPolicy = policy;
    return next();
  });
});

app.get('/share/report/:token/:jobId', (req, res) => {
  const expected = String(process.env.REPORT_SHARE_TOKEN || '');
  const supplied = String(req.params.token || '');
  if (!expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(404).send('Not found');
  const jobId = String(req.params.jobId || '').trim();
  const db = new Database(databasePath(), { readonly: true });
  const row = db.prepare('SELECT report_path FROM recon_results WHERE job_id=?').get(jobId); db.close();
  if (!row?.report_path) return res.status(404).send('报告不存在');
  const reportRoot = path.resolve(process.env.RECON_OUTPUT_DIR || path.join(__dirname, 'recon-runs'));
  const reportPath = path.resolve(row.report_path);
  if (!reportPath.startsWith(`${reportRoot}${path.sep}`) || !fs.existsSync(reportPath) || !/\.html?$/i.test(reportPath)) return res.status(404).send('报告不可用');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(reportPath);
});

app.get('/share/contact-report/:token/:jobId', (req, res) => {
  const expected = String(process.env.REPORT_SHARE_TOKEN || ''), supplied = String(req.params.token || '');
  if (!expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(404).send('Not found');
  const db = new Database(databasePath(), { readonly: true });
  const row = db.prepare('SELECT report_path FROM contact_recon_jobs WHERE job_id=? AND status=\'done\'').get(String(req.params.jobId || '')); db.close();
  const root = path.resolve(path.join(__dirname, 'contact-recon-reports')), reportPath = path.resolve(row?.report_path || '');
  if (!row?.report_path || !reportPath.startsWith(`${root}${path.sep}`) || !fs.existsSync(reportPath)) return res.status(404).send('报告不存在');
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.sendFile(reportPath);
});

app.get('/api/delivery/latest', (_req, res) => {
  const root = path.join(__dirname, 'reports', 'daily');
  try {
    const dates = fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(x.name)).map(x => x.name).sort().reverse();
    const date = dates[0] || '';
    if (!date) return res.json({ ok: true, date: '', manifest: {}, files: [] });
    const dir = path.join(root, date), manifestPath = path.join(dir, 'manifest.json');
    const files = fs.readdirSync(dir).filter(x => /\.(csv|md|json)$/i.test(x)).sort();
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
    res.json({ ok: true, date, manifest, files: files.map(name => ({ name, url: `/api/delivery/file?date=${encodeURIComponent(date)}&name=${encodeURIComponent(name)}` })) });
  } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.get('/api/delivery/file', (req, res) => {
  const date = String(req.query.date || ''), name = String(req.query.name || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[\w.-]+\.(csv|md|json)$/i.test(name)) return res.status(400).send('invalid file');
  const file = path.join(__dirname, 'reports', 'daily', date, name);
  if (!fs.existsSync(file)) return res.status(404).send('not found');
  res.download(file, name);
});

const DB_PATH = databasePath();
const RECON_LOG_PATH = path.join(__dirname, 'logs', 'recon_worker.log');
const ASSISTANT_LOG_PATH = path.join(__dirname, 'logs', 'assistant.log');

function truncateLogValue(value, limit = 4000) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit)}...<truncated ${text.length - limit} chars>` : text;
}

function compactAssistantPayload(body = {}) {
  return {
    message: truncateLogValue(body.message, 2000),
    cursor: body.cursor || '',
    sessionId: body.sessionId || '',
    context: body.context || {},
    history: Array.isArray(body.history)
      ? body.history.slice(-8).map(item => ({
        role: item && item.role,
        content: truncateLogValue(item && item.content, 1200),
      }))
      : [],
  };
}

function compactAssistantResult(result = {}) {
  return {
    ok: result.ok !== false,
    retrievalMode: result.retrievalMode || '',
    model: result.model || '',
    engine: result.engine || '',
    guardrails: result.guardrails || null,
    fallbackReason: result.fallbackReason || '',
    sessionId: result.sessionId || '',
    answer: truncateLogValue(result.answer, 6000),
    nextCursor: result.nextCursor || '',
    resultSets: result.resultSets || [],
    sources: (result.sources || []).slice(0, 30),
    matchedCustomers: (result.matchedCustomers || []).slice(0, 30),
    actions: result.actions || [],
    usage: result.usage || null,
  };
}

function logAssistantChat(entry) {
  try {
    fs.mkdirSync(path.dirname(ASSISTANT_LOG_PATH), { recursive: true });
    fs.appendFileSync(ASSISTANT_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (e) {
    console.error(`assistant log write failed: ${e.message}`);
  }
}

function getDb() {
  return new Database(DB_PATH);
}

function externalCustomerForFollowId(followId) {
  const value = getDb();
  try { return value.prepare('SELECT customer_id FROM customers WHERE follow_id=?').get(String(followId || ''))?.customer_id || ''; }
  finally { value.close(); }
}

function externalCustomerForJob(table, jobId) {
  const allowedTables = new Set(['recon_jobs', 'recon_results', 'contact_recon_jobs']);
  if (!allowedTables.has(table)) throw new Error('不支持的任务类型');
  const value = getDb();
  try { return value.prepare(`SELECT customer_id FROM ${table} WHERE job_id=?`).get(String(jobId || ''))?.customer_id || ''; }
  finally { value.close(); }
}

function assertRequestCustomer(req, customerId) {
  assertExternalCustomerAccess(req.accessContext, String(customerId || ''));
}

function auditDeniedWrite(req, action = '') {
  if (!req.salesUser || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const value = getDb();
  try {
    value.prepare(`INSERT INTO crm_audit_log
      (id,user_id,action,entity_type,entity_id,detail_json,created_at)
      VALUES (?,?,?,?,?,?,datetime('now'))`).run(
        crypto.randomUUID(), req.salesUser.id, 'permission_denied', 'legacy_api', '',
        JSON.stringify({ route: req.path, action: String(action || '') }),
      );
  } catch (error) {
    console.error(`denied write audit failed: ${error.message}`);
  } finally {
    value.close();
  }
}

function safeStat(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      exists: true,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      path: filePath,
    };
  } catch (_e) {
    return {
      exists: false,
      size: 0,
      mtime: '',
      path: filePath,
    };
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    return null;
  }
}

function parseDbTime(text) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const iso = clean.replace(' ', 'T');
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function minutesSince(text) {
  const parsed = parseDbTime(text);
  if (!parsed) return null;
  return Math.max(0, Math.round((Date.now() - parsed.getTime()) / 60000));
}

function deriveReconStage(job, result, artifacts, hasActiveHermes = false) {
  if (job.status === 'failed') return 'failed';
  if (job.status === 'queued') return 'queued';
  if (artifacts.report_html.exists || artifacts.report_md.exists || result?.report_path) return 'report_ready';
  if (artifacts.hermes_stdout.exists || artifacts.hermes_stderr.exists) return 'agent_running';
  if (artifacts.prompt.exists) {
    if (job.status === 'running' && hasActiveHermes) return 'agent_running';
    return job.status === 'running' ? 'prompt_ready' : 'queued';
  }
  if (job.status === 'running') return 'worker_claimed';
  if (job.status === 'done') return 'report_ready';
  return 'unknown';
}

function stageLabel(stage) {
  return {
    queued: '排队中',
    worker_claimed: '已领取',
    prompt_ready: 'Prompt已写入',
    agent_running: 'Hermes执行中',
    report_ready: '报告已生成',
    failed: '执行失败',
    unknown: '未知状态',
  }[stage] || stage || '未知状态';
}

function listPsRows() {
  try {
    const output = execFileSync('ps', ['-axo', 'pid=,etime=,command='], { encoding: 'utf8' });
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const match = line.match(/^(\d+)\s+(\S+)\s+(.*)$/);
        if (!match) return null;
        return {
          pid: Number(match[1]),
          etime: match[2],
          command: match[3],
        };
      })
      .filter(Boolean)
      .filter(row => !String(row.command || '').includes('ps -axo') && !String(row.command || '').includes(' rg '));
  } catch (_e) {
    return [];
  }
}

function listReconWorkers() {
  return listPsRows().filter(row => row.command.includes('recon_agent_worker.py --poll'));
}

function parseHermesProcess(row) {
  const command = String(row.command || '');
  const type = command.includes('gateway run --replace')
    ? 'gateway'
    : command.includes('hermes chat --query')
      ? 'chat'
      : 'hermes';
  const customerId = (command.match(/customer_id:\s*([A-Z]{2}-\d{4,}|RU-\d{4,})/) || [])[1] || '';
  const companyName = (command.match(/company_name:\s*([^\n\\]+)/) || [])[1]?.trim() || '';
  let preview = command;
  if (type === 'chat') {
    const idx = command.indexOf('hermes chat --query');
    preview = idx >= 0 ? command.slice(idx, idx + 240) : command.slice(0, 240);
  }
  return {
    pid: row.pid,
    etime: row.etime,
    type,
    customer_id: customerId,
    company_name: companyName,
    command,
    preview,
  };
}

function listHermesProcesses() {
  return listPsRows()
    .filter(row => row.command.includes('hermes chat --query') || row.command.includes('hermes_cli.main gateway run --replace'))
    .map(parseHermesProcess);
}

function hermesMatchesJob(proc, job) {
  const procCustomer = String(proc.customer_id || '').trim();
  const jobCustomer = String(job.customer_id || '').trim();
  if (procCustomer && jobCustomer && procCustomer === jobCustomer) return true;

  const procCompany = String(proc.company_name || '').trim().toLowerCase();
  const jobCompany = String(job.company_name || '').trim().toLowerCase();
  if (procCompany && jobCompany && procCompany === jobCompany) return true;

  const jobId = String(job.job_id || '').trim();
  const command = String(proc.command || '');
  return !!(jobId && command.includes(jobId));
}

function readLogTail(filePath, maxLines = 20) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch (_e) {
    return [];
  }
}

function readFileTail(filePath, maxLines = 40) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.split(/\r?\n/).slice(-maxLines);
  } catch (_e) {
    return [];
  }
}

function latestArtifactAt(artifacts) {
  const mtimes = Object.values(artifacts).map(item => item.mtime).filter(Boolean).sort();
  return mtimes.length ? mtimes[mtimes.length - 1] : '';
}

function selectHermesTerminal(enrichedJobs) {
  const preferred = enrichedJobs.find(job => job.status === 'running' && job.artifacts?.hermes_stdout?.exists)
    || enrichedJobs.find(job => job.status === 'running' && job.artifacts?.prompt?.exists)
    || enrichedJobs.find(job => job.artifacts?.hermes_stdout?.exists || job.artifacts?.hermes_stderr?.exists)
    || null;
  if (!preferred) {
    return {
      title: 'Hermes 终端',
      source: '',
      lines: ['暂无 Hermes stdout/stderr 产物。'],
    };
  }
  const lines = [];
  const stdoutPath = preferred.artifacts?.hermes_stdout?.path;
  const stderrPath = preferred.artifacts?.hermes_stderr?.path;
  if (stdoutPath && preferred.artifacts.hermes_stdout.exists) {
    lines.push(`[stdout] ${stdoutPath}`);
    lines.push(...readFileTail(stdoutPath, 32));
  } else {
    lines.push('[stdout] 尚未生成 hermes_stdout.txt');
  }
  if (stderrPath && preferred.artifacts.hermes_stderr.exists) {
    const stderrLines = readFileTail(stderrPath, 12).filter(Boolean);
    if (stderrLines.length) {
      lines.push('');
      lines.push(`[stderr] ${stderrPath}`);
      lines.push(...stderrLines);
    }
  }
  return {
    title: `Hermes 终端 · ${preferred.company_name || preferred.customer_id || preferred.job_id}`,
    source: preferred.job_id,
    lines: lines.filter(line => line !== undefined),
  };
}

function buildReconMonitorPayload(accessContext) {
  const db = getDb();
  const allowedIds = [...(accessContext?.externalCustomerIds || [])];
  const placeholders = allowedIds.length ? allowedIds.map(() => '?').join(',') : "''";
  const jobs = db.prepare(`SELECT * FROM recon_jobs WHERE customer_id IN (${placeholders}) ORDER BY updated_at DESC`).all(...allowedIds);
  const results = db.prepare(`SELECT * FROM recon_results WHERE customer_id IN (${placeholders}) ORDER BY updated_at DESC`).all(...allowedIds);
  db.close();

  const fullScope = Boolean(accessContext?.canViewAllCustomers);
  const workerProcesses = fullScope ? listReconWorkers() : [];
  const hermesProcesses = fullScope ? listHermesProcesses() : [];
  const resultsByJob = new Map(results.map(row => [row.job_id, row]));
  const enrichedJobs = jobs.map(job => {
    const outputDir = String(job.output_dir || '').trim();
    const result = resultsByJob.get(job.job_id) || null;
    const artifacts = outputDir ? {
      prompt: safeStat(path.join(outputDir, 'prompt.txt')),
      capabilities_json: safeStat(path.join(outputDir, 'capabilities.json')),
      hermes_stdout: safeStat(path.join(outputDir, 'hermes_stdout.txt')),
      hermes_stderr: safeStat(path.join(outputDir, 'hermes_stderr.log')),
      report_md: safeStat(path.join(outputDir, 'report.md')),
      report_html: safeStat(path.join(outputDir, 'report.html')),
    } : {
      prompt: { exists: false, size: 0, mtime: '', path: '' },
      capabilities_json: { exists: false, size: 0, mtime: '', path: '' },
      hermes_stdout: { exists: false, size: 0, mtime: '', path: '' },
      hermes_stderr: { exists: false, size: 0, mtime: '', path: '' },
      report_md: { exists: false, size: 0, mtime: '', path: '' },
      report_html: { exists: false, size: 0, mtime: '', path: '' },
    };
    const capabilities = artifacts.capabilities_json.exists ? safeReadJson(artifacts.capabilities_json.path) : null;
    const matchedHermes = hermesProcesses.filter(proc => hermesMatchesJob(proc, job));
    const hasActiveHermes = matchedHermes.some(proc => proc.type === 'chat');
    const stage = deriveReconStage(job, result, artifacts, hasActiveHermes);
    const staleMinutes = job.status === 'running' ? minutesSince(job.updated_at) : null;
    return {
      ...job,
      result,
      has_result: Boolean(result),
      stage,
      stage_label: stageLabel(stage),
      has_active_hermes: hasActiveHermes,
      hermes_pids: matchedHermes.map(proc => proc.pid),
      capabilities,
      stale: job.status === 'running' && staleMinutes !== null && staleMinutes >= 10,
      stale_minutes: staleMinutes,
      artifacts,
      latest_artifact_at: latestArtifactAt(artifacts),
      report_url: result?.report_path ? `/api/report?job_id=${encodeURIComponent(job.job_id)}` : '',
    };
  });
  const capabilityJob = enrichedJobs.find(job => job.status === 'running' && job.capabilities) || enrichedJobs.find(job => job.capabilities) || null;
  const capabilitySnapshot = capabilityJob ? capabilityJob.capabilities : null;
  const summary = {
    queued: jobs.filter(job => job.status === 'queued').length,
    running: jobs.filter(job => job.status === 'running').length,
    done: jobs.filter(job => job.status === 'done').length,
    failed: jobs.filter(job => job.status === 'failed').length,
    stale_running: enrichedJobs.filter(job => job.stale).length,
    workers: workerProcesses.length,
    hermes: hermesProcesses.length,
  };

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    summary,
    workers: workerProcesses.map(({ pid, etime }) => ({ pid, etime })),
    hermesProcesses: hermesProcesses.map(({ pid, etime, type, customer_id, company_name, preview }) => ({ pid, etime, type, customer_id, company_name, preview })),
    jobs: enrichedJobs.slice(0, 30),
    capabilitySnapshot,
    capabilitySource: capabilityJob ? capabilityJob.job_id : '',
    logTail: fullScope ? readLogTail(RECON_LOG_PATH, 24) : [],
    terminal: selectHermesTerminal(enrichedJobs),
  };
}

// --- /api/initial ---

app.get('/api/initial', (req, res) => {
  try {
    const data = getInitialData(req.accessContext);
    res.json(data);
  } catch (e) {
    res.json({
      ok: false,
      diagnostics: [e.message],
      customers: [], customerPool: [], templates: [], reconJobs: [], reconResults: [],
      stats: {
        poolTotal: 0, total: 0, unassigned: 0, waiting: 0, contacted: 0,
        noReply: 0, interested: 0, quoted: 0, risk: 0, dueToday: 0, overdue: 0,
        byStatus: {}, byGroup: {}, byOwner: {}, byType: {}, byPool: {},
        reconQueued: 0, reconRunning: 0, reconDone: 0, reconFailed: 0,
      },
      user: { email: 'local-crm', name: 'local-crm' },
      statusOptions: [],
      statusGroups: [],
      updatedAt: new Date().toISOString(),
    });
  }
});

function pagination(query) {
  const page = Math.max(1, Number(query.page || 1) || 1);
  const pageSize = Math.max(1, Math.min(Number(query.page_size || 50) || 50, 200));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

app.get('/api/customers', (req, res) => {
  const db = getDb();
  try {
    const { page, pageSize, offset } = pagination(req.query);
    const search = String(req.query.search || '').trim();
    const like = `%${search}%`;
    const allowedIds = [...req.accessContext.externalCustomerIds];
    const placeholders = allowedIds.length ? allowedIds.map(() => '?').join(',') : "''";
    const clauses = [`customer_id IN (${placeholders})`];
    const params = [...allowedIds];
    if (search) {
      clauses.push('(company_name LIKE ? OR customer_id LIKE ? OR website LIKE ?)');
      params.push(like, like, like);
    }
    const where = `WHERE ${clauses.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) total FROM customer_pool ${where}`).get(...params).total;
    const rows = db.prepare(`SELECT * FROM customer_pool ${where} ORDER BY customer_id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    res.json({ ok: true, page, pageSize, total, rows });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    db.close();
  }
});

app.get('/api/recon/results/:jobId', (req, res) => {
  const db = getDb();
  try {
    const result = db.prepare('SELECT * FROM recon_results WHERE job_id = ?').get(req.params.jobId);
    if (!result) return res.status(404).json({ ok: false, error: '未找到Recon结果' });
    assertRequestCustomer(req, result.customer_id);
    const evidence = db.prepare('SELECT * FROM recon_evidence WHERE job_id = ? ORDER BY id').all(req.params.jobId);
    let resultV3 = null;
    try { resultV3 = result.result_json ? JSON.parse(result.result_json) : null; } catch (_e) {}
    res.json({ ok: true, result, resultV3, evidence });
  } finally {
    db.close();
  }
});

app.get('/api/quality/issues', (_req, res) => {
  const db = getDb();
  try {
    const value = sql => Number(Object.values(db.prepare(sql).get())[0] || 0);
    res.json({ ok: true, issues: [
      { code: 'invalid_email', severity: 'error', count: value("SELECT COUNT(*) n FROM customer_pool WHERE trim(email) != '' AND email NOT LIKE '%@%'") },
      { code: 'missing_owner', severity: 'error', count: value("SELECT COUNT(*) n FROM customers WHERE status NOT IN ('放弃跟进','风险过高','联系方式无效') AND trim(owner) = ''") },
      { code: 'missing_next_action', severity: 'error', count: value("SELECT COUNT(*) n FROM customers WHERE status NOT IN ('放弃跟进','风险过高','联系方式无效') AND trim(next_action) = ''") },
      { code: 'missing_next_follow_date', severity: 'error', count: value("SELECT COUNT(*) n FROM customers WHERE status NOT IN ('放弃跟进','风险过高','联系方式无效') AND trim(next_follow_date) = ''") },
      { code: 'evidence_count_mismatch', severity: 'error', count: value("SELECT COUNT(*) n FROM recon_results r WHERE CAST(r.evidence_count AS INTEGER) != (SELECT COUNT(*) FROM recon_evidence e WHERE e.job_id=r.job_id)") },
      { code: 'missing_sanction_checked_at', severity: 'warning', count: value("SELECT COUNT(*) n FROM recon_results WHERE trim(sanction_checked_at) = ''") },
    ] });
  } finally {
    db.close();
  }
});

// --- /api/app ---

app.post('/api/app', (req, res) => {
  const { action } = req.body;
  try {
    if (action === 'updateCustomer') {
      assertRequestCustomer(req, externalCustomerForFollowId(req.body.followId));
      const r = updateCustomer(req.body.followId, req.body.payload);
      return res.json({ ok: true, action, ...r });
    }
    if (action === 'createTag') {
      const r = createTag(req.body.payload || req.body);
      return res.json({ ok: true, action, ...r });
    }
    if (action === 'setCustomerTags') {
      assertRequestCustomer(req, req.body.customerId);
      const r = setCustomerTags(req.body.customerId, req.body.tagIds);
      return res.json({ ok: true, action, ...r });
    }
    if (action === 'createReconJob') {
      assertRequestCustomer(req, req.body.customerId);
      const r = createReconJob(req.body.customerId, req.body.source);
      return res.json({ ok: true, action, ...r });
    }
    if (action === 'retryReconJob') {
      assertRequestCustomer(req, externalCustomerForJob('recon_jobs', req.body.jobId));
      const r = retryReconJob(req.body.jobId);
      return res.json({ ok: true, action, ...r });
    }
    if (action === 'createContactReconJob') {
      assertRequestCustomer(req, req.body.customerId);
      const r = createContactReconJob(req.body.customerId, req.body.options || {});
      return res.json({ ok: true, action, ...r });
    }
    throw new Error(`未知 action：${action}`);
  } catch (e) {
    if (e.statusCode === 403) auditDeniedWrite(req, action);
    res.status(e.statusCode || 400).json({ ok: false, error: e.message });
  }
});

// --- /api/prospect-agent ---

app.post('/api/prospect-agent', async (req, res) => {
  const { action } = req.body || {};
  try {
    if (action === 'createTask') {
      const created = createProspectTask(req.body.payload || req.body);
      const executed = await runProspectTask(created.task.taskId);
      return res.json({ ok: true, action, task: created.task, ...executed });
    }
    if (action === 'rerunTask') {
      const taskId = String(req.body.taskId || '').trim();
      if (!taskId) throw new Error('缺少任务ID');
      const executed = await runProspectTask(taskId);
      return res.json({ ok: true, action, ...executed });
    }
    if (action === 'promoteCandidate') {
      const r = promoteProspectCandidate(req.body.candidateId, { createRecon: Boolean(req.body.createRecon) });
      return res.json({ ok: true, action, ...r });
    }
    throw new Error(`未知 prospect action：${action}`);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
});

// --- /api/recon ---

app.post('/api/recon', (req, res) => {
  const token = process.env.RECON_WORKER_TOKEN;
  if (!token || req.body.token !== token) {
    return res.status(401).json({ ok: false, error: 'worker token 校验失败' });
  }
  const handlers = { listQueuedJobs, claimReconJob, heartbeatReconJob, markJobRunning, markJobFailed, submitReconResult };
  try {
    const { action } = req.body;
    if (!handlers[action]) throw new Error(`未知 action：${action}`);
    res.json({ ok: true, action, ...handlers[action](req.body) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/contact-recon', (req, res) => {
  const token = process.env.RECON_WORKER_TOKEN;
  if (!token || req.body.token !== token) return res.status(401).json({ ok: false, error: 'worker token 校验失败' });
  const handlers = { claimContactReconJob, heartbeatContactReconJob, failContactReconJob, submitContactReconResult };
  try {
    const { action } = req.body;
    if (!handlers[action]) throw new Error(`未知 contact recon action：${action}`);
    res.json({ ok: true, action, ...handlers[action](req.body) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/contact-recon/state', (req, res) => {
  try { res.json({ ok: true, ...getContactReconState({ limit: req.query.limit, accessContext: req.accessContext }) }); }
  catch (e) { res.status(e.statusCode || 500).json({ ok: false, error: e.message }); }
});

app.get('/api/customers/:customerId/people', (req, res) => {
  try {
    assertRequestCustomer(req, req.params.customerId);
    res.json({ ok: true, customerId: req.params.customerId, people: getCustomerPeople(req.params.customerId) });
  }
  catch (e) { res.status(e.statusCode || 500).json({ ok: false, error: e.message }); }
});

// --- /api/assistant ---

app.post('/api/assistant/chat', async (req, res) => {
  const startedAt = Date.now();
  const requestId = `asst-${startedAt.toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  const input = compactAssistantPayload(req.body || {});
  try {
    const result = await answerAssistantQuestion(req.body || {});
    logAssistantChat({
      ts: new Date().toISOString(),
      requestId,
      status: 'ok',
      durationMs: Date.now() - startedAt,
      input,
      output: compactAssistantResult(result),
    });
    res.json(result);
  } catch (e) {
    logAssistantChat({
      ts: new Date().toISOString(),
      requestId,
      status: 'error',
      durationMs: Date.now() - startedAt,
      input,
      error: {
        message: e.message || String(e),
        statusCode: e.statusCode || 500,
        stack: truncateLogValue(e.stack, 3000),
      },
    });
    res.status(e.statusCode || 500).json({
      ok: false,
      error: e.message || String(e),
    });
  }
});

// --- /api/report ---

app.get('/api/report', (req, res) => {
  const jobId = String(req.query.job_id || '').trim();
  if (!jobId) {
    res.status(400).send('缺少 job_id');
    return;
  }

  try {
    const Database = require('better-sqlite3');
    const db = new Database(databasePath());
    const row = db.prepare('SELECT job_id, customer_id, company_name, report_path FROM recon_results WHERE job_id = ?').get(jobId);
    db.close();

    if (!row) {
      res.status(404).send('未找到报告');
      return;
    }
    assertRequestCustomer(req, row.customer_id);
    if (!row.report_path) return res.status(404).send('未找到报告');

    const reportRoot = path.resolve(process.env.RECON_OUTPUT_DIR || path.join(__dirname, 'recon-runs'));
    const reportPath = path.resolve(row.report_path);
    if (reportPath !== reportRoot && !reportPath.startsWith(`${reportRoot}${path.sep}`)) {
      res.status(403).send('报告路径不在允许目录');
      return;
    }
    let report = '';
    if (fs.existsSync(reportPath)) {
      report = fs.readFileSync(reportPath, 'utf8');
    } else {
      res.status(404).send('报告文件不存在: ' + reportPath);
      return;
    }

    const lowerPath = String(reportPath).toLowerCase();
    if (lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    } else if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    } else {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.send(report);
  } catch (e) {
    res.status(e.statusCode || 500).send(e.statusCode === 403 ? '无权访问该报告' : '读取报告失败: ' + (e.message || String(e)));
  }
});

app.get('/api/recon-monitor', (req, res) => {
  try {
    res.json(buildReconMonitorPayload(req.accessContext));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

return app;
}

function startServer({ port = process.env.PORT || 3000, host = process.env.HOST || '127.0.0.1' } = {}) {
  const app = createApp();
  return app.listen(port, host, () => {
    console.log(`✅ Russia CRM running at http://localhost:${port}`);
    console.log(`   LAN access: http://${host === '0.0.0.0' ? '你的IP' : host}:${port}`);
  });
}

if (require.main === module) startServer();

module.exports = { createApp, startServer, databasePath };
