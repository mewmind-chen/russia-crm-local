#!/usr/bin/env node
'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const { createAIStationWorker } = require('../lib/ai_stations/worker');
const { resolveAIStationsEnabled } = require('../lib/ai_stations/routes');
const { databasePath } = require('../lib/runtime_paths');

function integerArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function openDb() {
  const db = new Database(databasePath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

async function main() {
  if (!resolveAIStationsEnabled()) throw new Error('AI stations are disabled for this environment');
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
  const worker = createAIStationWorker({
    openDb,
    workerId: process.env.CRM_AI_WORKER_ID,
    jobStoreOptions: {
      leaseMs: integerArgument('--lease-ms', Number(process.env.CRM_AI_JOB_LEASE_MS) || 60_000),
    },
    queueHealthOptions: {
      backlogWarning: Number(process.env.CRM_AI_QUEUE_BACKLOG_WARNING) || 100,
      maxWaitMs: Number(process.env.CRM_AI_QUEUE_WAIT_WARNING_MS) || 300_000,
    },
    onQueueAlert: health => process.stderr.write(`${JSON.stringify({ event: 'ai_queue_alert', ...health })}\n`),
  });
  const result = await worker.run({
    once: process.argv.includes('--once'),
    limit: integerArgument('--limit', Number(process.env.CRM_AI_WORKER_LIMIT) || Number.MAX_SAFE_INTEGER),
    idleMs: integerArgument('--idle-ms', Number(process.env.CRM_AI_WORKER_IDLE_MS) || 1_000),
    signal: controller.signal,
  });
  if (process.argv.includes('--once')) process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(error => {
  process.stderr.write(`AI station worker failed: ${error.message}\n`);
  process.exitCode = 1;
});
