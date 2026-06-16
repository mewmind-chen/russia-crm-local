require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { execFileSync } = require('child_process');

const {
  getInitialData, updateCustomer, createTag, setCustomerTags, createReconJob,
  retryReconJob, listQueuedJobs, markJobRunning, markJobFailed, submitReconResult,
  createProspectTask, promoteProspectCandidate,
} = require('./lib/db');
const { answerAssistantQuestion } = require('./lib/assistant');
const { runProspectTask } = require('./lib/prospect_agent');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

const DB_PATH = path.join(__dirname, 'data', 'crm.db');
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

function buildReconMonitorPayload() {
  const db = getDb();
  const jobs = db.prepare('SELECT * FROM recon_jobs ORDER BY updated_at DESC').all();
  const results = db.prepare('SELECT * FROM recon_results ORDER BY updated_at DESC').all();
  db.close();

  const workerProcesses = listReconWorkers();
  const hermesProcesses = listHermesProcesses();
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
    workers: workerProcesses,
    hermesProcesses,
    jobs: enrichedJobs.slice(0, 30),
    capabilitySnapshot,
    capabilitySource: capabilityJob ? capabilityJob.job_id : '',
    logTail: readLogTail(RECON_LOG_PATH, 24),
    terminal: selectHermesTerminal(enrichedJobs),
  };
}

// --- /api/initial ---

app.get('/api/initial', (_req, res) => {
  try {
    const data = getInitialData();
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

// --- /api/app ---

app.post('/api/app', (req, res) => {
  const { action } = req.body;
  try {
    if (action === 'updateCustomer') {
      const r = updateCustomer(req.body.followId, req.body.payload);
      return res.json({ ok: true, action, ...r });
    }
    if (action === 'createTag') {
      const r = createTag(req.body.payload || req.body);
      return res.json({ ok: true, action, ...r });
    }
    if (action === 'setCustomerTags') {
      const r = setCustomerTags(req.body.customerId, req.body.tagIds);
      return res.json({ ok: true, action, ...r });
    }
    if (action === 'createReconJob') {
      const r = createReconJob(req.body.customerId, req.body.source);
      return res.json({ ok: true, action, ...r });
    }
    if (action === 'retryReconJob') {
      const r = retryReconJob(req.body.jobId);
      return res.json({ ok: true, action, ...r });
    }
    throw new Error(`未知 action：${action}`);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
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
  const handlers = { listQueuedJobs, markJobRunning, markJobFailed, submitReconResult };
  try {
    const { action } = req.body;
    if (!handlers[action]) throw new Error(`未知 action：${action}`);
    res.json({ ok: true, action, ...handlers[action](req.body) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
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
    const db = new Database(path.join(__dirname, 'data', 'crm.db'));
    const row = db.prepare('SELECT job_id, company_name, report_path FROM recon_results WHERE job_id = ?').get(jobId);
    db.close();

    if (!row || !row.report_path) {
      res.status(404).send('未找到报告');
      return;
    }

    const reportPath = row.report_path;
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
    res.status(500).send('读取报告失败: ' + (e.message || String(e)));
  }
});

app.get('/api/recon-monitor', (_req, res) => {
  try {
    res.json(buildReconMonitorPayload());
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`✅ Russia CRM running at http://localhost:${PORT}`);
  console.log(`   LAN access: http://${HOST === '0.0.0.0' ? '你的IP' : HOST}:${PORT}`);
});
