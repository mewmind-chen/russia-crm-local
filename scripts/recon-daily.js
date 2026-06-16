#!/usr/bin/env node
/**
 * Daily Russia-recon automation.
 *
 * Enqueues up to N new recon jobs per local day, then optionally runs the
 * existing worker once for up to N queued jobs. The worker keeps its original
 * Hermes model/provider behavior.
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { createReconJob } = require('../lib/db');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'crm.db');

function argValue(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function todayKey() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function numericIdSortExpr(alias = 'p') {
  return `CAST(SUBSTR(${alias}.customer_id, 4, 4) AS INTEGER)`;
}

function selectCandidates(db, limit) {
  if (limit <= 0) return [];
  return db.prepare(`
    SELECT p.customer_id, p.company_name, p.website, p.domain, p.contact_count, p.last_found
    FROM customer_pool p
    LEFT JOIN recon_results rr ON rr.customer_id = p.customer_id
    LEFT JOIN recon_jobs active
      ON active.customer_id = p.customer_id
     AND active.status IN ('queued', 'running')
    WHERE rr.job_id IS NULL
      AND active.job_id IS NULL
      AND COALESCE(NULLIF(p.website, ''), NULLIF(p.domain, '')) IS NOT NULL
      AND COALESCE(p.customer_type, '') != '服务商/非目标'
      AND COALESCE(p.industry, '') != '非目标/其他'
    ORDER BY
      CASE WHEN COALESCE(p.contact_count, '') GLOB '[0-9]*' THEN CAST(p.contact_count AS INTEGER) ELSE 0 END DESC,
      COALESCE(NULLIF(p.last_found, ''), '0000-00-00') DESC,
      ${numericIdSortExpr('p')} DESC
    LIMIT ?
  `).all(limit);
}

function countTodayJobs(db, day) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM recon_jobs
    WHERE requested_at LIKE ?
  `).get(`${day}%`).count;
}

function countQueuedToday(db, day) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM recon_jobs
    WHERE requested_at LIKE ?
      AND status IN ('queued', 'running')
  `).get(`${day}%`).count;
}

function runWorker(limit) {
  if (limit <= 0) return 0;
  const worker = path.join(ROOT, 'scripts', 'recon_agent_worker.py');
  const args = [worker, '--once', '--limit', String(limit)];
  const result = spawnSync('python3', args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  return result.status == null ? 1 : result.status;
}

function main() {
  const limit = Math.max(1, Math.min(Number(argValue('--limit', process.env.RECON_DAILY_LIMIT || '10')) || 10, 50));
  const enqueueOnly = hasFlag('--enqueue-only');
  const runWorkerFlag = hasFlag('--run-worker');
  const noRun = hasFlag('--no-run') || enqueueOnly || !runWorkerFlag;
  const dryRun = hasFlag('--dry-run');
  const jsonOut = argValue('--json-out', '');
  const day = todayKey();

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');

  const alreadyToday = countTodayJobs(db, day);
  const remaining = Math.max(0, limit - alreadyToday);
  const candidates = selectCandidates(db, remaining);
  db.close();

  console.log(`Recon daily ${day}`);
  console.log(`Daily limit: ${limit}`);
  console.log(`Already requested today: ${alreadyToday}`);
  console.log(`New jobs to enqueue: ${candidates.length}`);

  if (dryRun) {
    console.table(candidates.map(row => ({
      customer_id: row.customer_id,
      company: String(row.company_name || '').slice(0, 40),
      website: row.website || row.domain,
      contact_count: row.contact_count,
      last_found: row.last_found,
    })));
    console.log('Dry-run only. No jobs enqueued and worker not started.');
    return;
  }

  const queued = [];
  for (const row of candidates) {
    const created = createReconJob(row.customer_id, 'pool');
    const job = created.job || {};
    if (job.job_id) queued.push({ ...job, company_name: row.company_name, website: row.website, domain: row.domain });
    console.log(`  queued ${job.job_id || '(existing)'} | ${row.customer_id} | ${row.company_name}`);
  }

  const dbAfter = new Database(DB_PATH, { readonly: true });
  const runnableToday = countQueuedToday(dbAfter, day);
  const todayJobs = dbAfter.prepare(`
    SELECT *
    FROM recon_jobs
    WHERE requested_at LIKE ?
      AND status IN ('queued', 'running')
    ORDER BY requested_at ASC
    LIMIT ?
  `).all(`${day}%`, limit);
  dbAfter.close();

  if (jsonOut) {
    const outPath = path.resolve(ROOT, jsonOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({
      ok: true,
      date: day,
      daily_limit: limit,
      already_requested_today: alreadyToday,
      newly_enqueued: queued.length,
      queued_or_running_today: todayJobs,
      worker: runWorkerFlag ? 'hermes' : 'codex',
    }, null, 2), 'utf8');
    console.log(`JSON: ${outPath}`);
  }

  if (noRun) {
    console.log(`Queued/running today: ${runnableToday}`);
    console.log('Worker run skipped. Codex automation should process queued_or_running_today.');
    return;
  }

  const workerLimit = Math.min(limit, Math.max(runnableToday, candidates.length));
  if (!workerLimit) {
    console.log('No queued daily jobs to run.');
    return;
  }
  console.log(`Running worker once, limit=${workerLimit}`);
  const code = runWorker(workerLimit);
  if (code) process.exit(code);
}

main();
