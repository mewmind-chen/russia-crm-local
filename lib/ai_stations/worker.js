'use strict';

const os = require('node:os');
const { buildAccessContext, hasPermission, assertExternalCustomerAccess } = require('../access_control');
const { hydrateUserPermissions } = require('../permission_groups');
const { createAIBudgetStore } = require('./budgets');
const {
  executeActionProposalJob,
  executeContactReadinessJob,
  executeCustomerFitJob,
  executeNextActionJob,
  executeSalesPackJob,
  executeManagerAnomalyJob,
} = require('./executor');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');
const { getStation } = require('./prompt_registry');
const { recordSalesPackNotification } = require('./sales_pack');

function workerIdentity(value = '') {
  return String(value || `${os.hostname()}-${process.pid}`).trim();
}

function createAIStationWorker(options = {}) {
  if (typeof options.openDb !== 'function') throw new Error('openDb is required');
  const id = workerIdentity(options.workerId);
  if (!id) throw new Error('workerId is required');
  const executors = {
    customer_fit: options.executeCustomerFitJob || executeCustomerFitJob,
    contact_readiness: options.executeContactReadinessJob || executeContactReadinessJob,
    sales_pack: options.executeSalesPackJob || executeSalesPackJob,
    action_proposal: options.executeActionProposalJob || executeActionProposalJob,
    next_action: options.executeNextActionJob || executeNextActionJob,
    manager_anomaly: options.executeManagerAnomalyJob || executeManagerAnomalyJob,
    ...(options.executors || {}),
  };
  const jobStoreOptions = options.jobStoreOptions || {};

  function executionIdentity(db, job) {
    const row = db.prepare('SELECT * FROM sales_users WHERE id=? AND active=1').get(job.createdBy);
    if (!row) throw new Error('AI job actor is inactive or missing');
    const actor = hydrateUserPermissions(db, row);
    const requiredPermissions = new Set([
      'use_ai_assistant',
      'view_customers',
      ...(getStation(job.station).requiredPermissions || []),
    ]);
    for (const permission of requiredPermissions) {
      if (!hasPermission(actor, permission)) throw new Error(`AI job actor no longer has ${permission}`);
    }
    const accessContext = buildAccessContext(db, actor);
    assertExternalCustomerAccess(accessContext, job.customerId);
    return { actor, accessContext };
  }

  function blockOrCompleteCancellation(jobs, job, reason) {
    const finishCancellation = current => {
      if (current?.state !== 'cancel_requested' || current.leaseOwner !== id) return null;
      try {
        return jobs.completeCancellation(job.id, id);
      } catch (error) {
        const latest = jobs.getJob(job.id);
        if (latest?.state === 'cancelled') return latest;
        throw error;
      }
    };
    let current = jobs.getJob(job.id);
    const cancelled = finishCancellation(current);
    if (cancelled) return { status: 'cancelled', job: cancelled };
    if (current?.state === 'cancelled') return { status: 'cancelled', job: current };
    try {
      return { status: 'blocked', job: jobs.block(job.id, id, reason) };
    } catch (error) {
      current = jobs.getJob(job.id);
      const racedCancellation = finishCancellation(current);
      if (racedCancellation) return { status: 'cancelled', job: racedCancellation };
      if (current?.state === 'cancelled') return { status: 'cancelled', job: current };
      throw error;
    }
  }

  async function runOnce() {
    const db = options.openDb();
    let heartbeatTimer;
    try {
      const jobs = createAIJobStore(db, jobStoreOptions);
      const results = createAIResultStore(db);
      const budgets = createAIBudgetStore(db, options.budgetOptions);
      if (Array.isArray(options.budgetPolicies) && options.budgetPolicies.length) {
        budgets.syncPolicies(options.budgetPolicies);
      }
      jobs.releaseExpiredLeases();
      budgets.releaseOrphanedReservations();
      if (typeof options.beforeClaim === 'function') {
        await options.beforeClaim({ db, jobs, workerId: id });
      }
      const queue = jobs.queueHealth(options.queueHealthOptions || {});
      if (queue.alerts.length && typeof options.onQueueAlert === 'function') options.onQueueAlert(queue);
      const job = jobs.claimNext(id, {
        stationAllowed: candidate => typeof options.isJobEnabled !== 'function'
          || options.isJobEnabled({ db, job: candidate }),
      });
      if (!job) return Object.freeze({ status: 'idle', workerId: id, job: null, queue });
      let identity;
      try {
        if (typeof options.beforeExecutionIdentity === 'function') await options.beforeExecutionIdentity(job);
        identity = executionIdentity(db, job);
      } catch (error) {
        const outcome = blockOrCompleteCancellation(jobs, job, error);
        return Object.freeze({ ...outcome, workerId: id, queue });
      }
      const execute = executors[job.station];
      if (typeof execute !== 'function') {
        const outcome = blockOrCompleteCancellation(jobs, job, `No executor registered for station ${job.station}`);
        return Object.freeze({ ...outcome, workerId: id, queue });
      }
      const heartbeatMs = Math.max(250, Math.floor(jobs.leaseMs / 3));
      heartbeatTimer = setInterval(() => {
        try { jobs.heartbeat(job.id, id); }
        catch (_error) { clearInterval(heartbeatTimer); }
      }, heartbeatMs);
      heartbeatTimer.unref?.();
      try {
        const execution = await execute({
          ...(options.executorOptions || {}),
          db,
          jobs,
          results,
          budgets,
          jobId: job.id,
          workerId: id,
          accessContext: identity.accessContext,
          actor: {
            id: identity.actor.id,
            role: identity.actor.role,
            teamId: identity.actor.team_id || identity.actor.teamId,
            permissions: Object.entries(identity.actor.permissions || {})
              .filter(([, allowed]) => allowed).map(([permission]) => permission),
          },
        });
        const completed = jobs.getJob(job.id);
        if (!['succeeded', 'needs_review'].includes(completed?.state)) {
          throw new Error('AI station executor returned without completing the job');
        }
        return Object.freeze({ status: 'succeeded', workerId: id, job: completed, execution, queue });
      } catch (error) {
        const current = jobs.getJob(job.id);
        if (current?.state === 'cancel_requested' && current.leaseOwner === id) {
          return Object.freeze({ status: 'cancelled', workerId: id, job: jobs.completeCancellation(job.id, id), queue });
        }
        if (error?.code === 'AI_BUDGET_EXHAUSTED' && current?.state === 'running' && current.leaseOwner === id) {
          const outcome = blockOrCompleteCancellation(jobs, job, error);
          return Object.freeze({ ...outcome, workerId: id, error, queue });
        }
        if (current?.state === 'running' && current.leaseOwner === id) jobs.fail(job.id, id, error);
        const failed = jobs.getJob(job.id);
        if (job.station === 'sales_pack' && failed?.state === 'dead_letter') {
          try { recordSalesPackNotification(db, failed, 'failed', failed.errorSummary); }
          catch (_notificationError) { /* A notification must not change task state. */ }
        }
        return Object.freeze({ status: 'failed', workerId: id, job: failed, error, queue });
      }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      db.close();
    }
  }

  async function run(optionsForRun = {}) {
    const once = Boolean(optionsForRun.once);
    const limit = Number.isInteger(optionsForRun.limit) && optionsForRun.limit > 0
      ? optionsForRun.limit : Number.POSITIVE_INFINITY;
    const idleMs = Number.isInteger(optionsForRun.idleMs) && optionsForRun.idleMs >= 10
      ? optionsForRun.idleMs : 1_000;
    const signal = optionsForRun.signal;
    let processed = 0;
    while (!signal?.aborted && processed < limit) {
      const outcome = await runOnce();
      if (outcome.status !== 'idle') processed += 1;
      if (once || processed >= limit) return { processed, last: outcome };
      if (outcome.status === 'idle') {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, idleMs);
          if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    }
    return { processed, last: null };
  }

  return Object.freeze({ workerId: id, runOnce, run });
}

module.exports = { createAIStationWorker, workerIdentity };
