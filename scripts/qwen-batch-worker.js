#!/usr/bin/env node
'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const os = require('node:os');
const { buildAccessContext, hasPermission, assertExternalCustomerAccess } = require('../lib/access_control');
const { hydrateUserPermissions } = require('../lib/permission_groups');
const { databasePath } = require('../lib/runtime_paths');
const { createAIBudgetStore } = require('../lib/ai_stations/budgets');
const { validateStationOutput } = require('../lib/ai_stations/contracts');
const {
  buildStationContext,
  parseOutput,
  stationMessages,
  stationValidationContext,
} = require('../lib/ai_stations/executor');
const { featureState, resolveAIHardFlags } = require('../lib/ai_stations/feature_flags');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { renderPrompt, getStation } = require('../lib/ai_stations/prompt_registry');
const {
  batchConfigurationFromEnvironment,
  createPricingStore,
  createQwenBatchCoordinator,
  createQwenBatchProvider,
} = require('../lib/ai_stations/qwen_batch');
const { createAIResultStore } = require('../lib/ai_stations/results');

function jsonArray(value, name) {
  if (!String(value || '').trim()) return [];
  let parsed;
  try { parsed = JSON.parse(value); }
  catch (_error) { throw new Error(`${name} must be valid JSON`); }
  if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array`);
  return parsed;
}

function openDb(env = process.env) {
  const db = new Database(databasePath(env));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

function workerIdFromEnvironment(env = process.env, hostname = os.hostname()) {
  const configured = String(env.CRM_AI_QWEN_BATCH_WORKER_ID || '').trim();
  return configured || `qwen-batch-${String(hostname || 'local').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80)}`;
}

function extractOutput(remoteResponse) {
  if (remoteResponse && typeof remoteResponse === 'object') {
    const content = remoteResponse.body?.choices?.[0]?.message?.content
      ?? remoteResponse.choices?.[0]?.message?.content
      ?? remoteResponse.output;
    if (typeof content === 'string') return parseOutput(content);
    if (content && typeof content === 'object' && !Array.isArray(content)) return content;
    if (remoteResponse.version) return remoteResponse;
  }
  throw Object.assign(new Error('Qwen Batch item is missing structured output'), {
    code: 'AI_BATCH_INVALID_OUTPUT',
    statusCode: 422,
  });
}

async function runOnce(options = {}) {
  const env = options.env || process.env;
  const db = options.db || openDb(env);
  const close = !options.db;
  try {
    const jobs = createAIJobStore(db, {
      leaseMs: Number(env.CRM_AI_BATCH_JOB_LEASE_MS) || 3_600_000,
    });
    const results = createAIResultStore(db);
    const budgets = createAIBudgetStore(db, {
      companyId: String(env.CRM_AI_COMPANY_ID || 'default'),
      pricing: env.CRM_AI_PRICING_JSON ? JSON.parse(env.CRM_AI_PRICING_JSON) : {},
    });
    const pricing = createPricingStore(db);
    for (const item of jsonArray(env.CRM_AI_QWEN_PRICING_CATALOG_JSON, 'CRM_AI_QWEN_PRICING_CATALOG_JSON')) {
      pricing.upsertPricing(item);
    }
    for (const item of jsonArray(env.CRM_AI_CNY_USD_FX_JSON, 'CRM_AI_CNY_USD_FX_JSON')) pricing.upsertFx(item);

    const hardFlags = resolveAIHardFlags({}, env);
    const identities = new Map();
    const contexts = new Map();
    const validatedValues = new Map();
    function identity(job) {
      if (identities.has(job.id)) return identities.get(job.id);
      const row = db.prepare('SELECT * FROM sales_users WHERE id=? AND active=1').get(job.createdBy);
      if (!row) throw new Error('AI batch actor is inactive or missing');
      const actor = hydrateUserPermissions(db, row);
      for (const permission of ['use_ai_assistant', 'view_customers', ...(getStation(job.station).requiredPermissions || [])]) {
        if (!hasPermission(actor, permission)) throw new Error(`AI batch actor no longer has ${permission}`);
      }
      const accessContext = buildAccessContext(db, actor);
      assertExternalCustomerAccess(accessContext, job.customerId);
      const selected = { actor, accessContext };
      identities.set(job.id, selected);
      return selected;
    }
    function context(job, fresh = false) {
      if (!fresh && contexts.has(job.id)) return contexts.get(job.id);
      const selected = identity(job);
      const value = buildStationContext(db, {
        accessContext: selected.accessContext,
      }, job.station, job, results);
      if (!fresh) contexts.set(job.id, value);
      return value;
    }
    const coordinator = createQwenBatchCoordinator(db, {
      config: batchConfigurationFromEnvironment(env),
      jobs,
      results,
      budgets,
      pricing,
      provider: options.provider || createQwenBatchProvider(),
      workerId: workerIdFromEnvironment(env),
      enabled: () => featureState(db, hardFlags).qwen_batch.effectiveEnabled,
      authorizeJob: job => identity(job),
      snapshotForJob(job) {
        const selected = identity(job);
        const current = context(job);
        const prompt = renderPrompt(job.station, {
          actor: {
            id: selected.actor.id,
            role: selected.actor.role,
            teamId: selected.actor.team_id || selected.actor.teamId,
            permissions: Object.entries(selected.actor.permissions || {})
              .filter(([, allowed]) => allowed).map(([permission]) => permission),
          },
          trustedCrmContext: current.context,
          evidence: current.evidence,
          userContent: job.input.userContent || '',
          ...(current.anomalyIds ? {
            anomalyIds: current.anomalyIds,
            anomalyCodes: current.anomalyCodes,
            customerIds: current.customerIds,
          } : {}),
          ...(current.salesUserIds ? {
            salesUserIds: current.salesUserIds,
            sampleSizes: current.sampleSizes,
            sampleStatuses: current.sampleStatuses,
          } : {}),
        });
        return {
          contextHash: current.contextHash,
          evidenceIds: current.evidenceIds,
          teamId: selected.actor.team_id || selected.actor.teamId,
          request: { messages: stationMessages(prompt) },
        };
      },
      currentSnapshot(job) {
        const current = context(job, true);
        return { ...current, contextHash: current.contextHash, evidenceIds: current.evidenceIds };
      },
      validateResult(job, remoteResponse, current, item) {
        const value = extractOutput(remoteResponse);
        const validated = validateStationOutput(job.station, item.schema_version, value, stationValidationContext(current));
        if (!validated.ok) {
          throw Object.assign(new Error(`Batch output rejected: ${validated.errors.join('; ')}`), {
            code: 'AI_BATCH_INVALID_OUTPUT',
            statusCode: 422,
          });
        }
        validatedValues.set(item.id, validated.value);
      },
      importResult({ job, item, remote, current, workerId }) {
        const reservation = budgets.getReservation(item.reservation_id);
        const saved = results.saveResult({
          jobId: job.id,
          workerId,
          contextHash: current.contextHash,
          value: validatedValues.get(item.id),
          ...stationValidationContext(current),
          metadata: {
            engine: 'qwen',
            model: item.model,
            promptVersion: item.prompt_version,
            schemaVersion: item.schema_version,
            usage: remote.usage || {},
            cost: Number(reservation?.charged_micros || 0) / 1_000_000,
          },
        }, `ai-batch-result:${item.id}`);
        return { state: saved.reviewRequired ? 'review_required' : 'succeeded', result: saved };
      },
    });

    const reserving = db.prepare(`SELECT id FROM crm_ai_batch_runs
      WHERE state='reserving' ORDER BY created_at,id`).all();
    for (const run of reserving) await coordinator.resumeSubmission(run.id);
    const active = db.prepare(`SELECT id FROM crm_ai_batch_runs
      WHERE state IN ('submitted','running','importing','cancel_requested') ORDER BY created_at,id`).all();
    const polled = [];
    for (const run of active) polled.push(await coordinator.pollAndImport(run.id));
    let submitted = null;
    if (!options.pollOnly) {
      try {
        submitted = await coordinator.submitReady({
          dryRun: Boolean(options.dryRun),
          ignoreSchedule: Boolean(options.ignoreSchedule),
        });
      } catch (error) {
        if (error?.code !== 'AI_BATCH_DISABLED') throw error;
        submitted = { status: 'disabled' };
      }
    }
    return { ok: true, polled, submitted, reconciliation: coordinator.reconcile() };
  } finally {
    if (close) db.close();
  }
}

async function main() {
  const result = await runOnce({
    dryRun: process.argv.includes('--dry-run'),
    pollOnly: process.argv.includes('--poll-only'),
    ignoreSchedule: process.argv.includes('--ignore-schedule'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Qwen Batch worker failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { extractOutput, jsonArray, runOnce, workerIdFromEnvironment };
