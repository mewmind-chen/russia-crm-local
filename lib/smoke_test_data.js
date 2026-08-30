'use strict';

const crypto = require('node:crypto');
const { buildAccessContext } = require('./access_control');
const { enqueueNextAction } = require('./ai_stations/next_action');
const { hydrateUserPermissions } = require('./permission_groups');

const SMOKE_ACCOUNT_ID = 'CRM-SMOKE-NEXT-ACTION';
const SMOKE_EXTERNAL_CUSTOMER_ID = 'ZZ-1903';
const LEGACY_A303_RUN_ID = 'production-smoke-a3-03-20260725';
const LEGACY_A303_NEXT_ACTION = 'A3-03 smoke review only; do not adopt';
const LEGACY_A303_SUMMARY = 'A3-03 production smoke event; no customer outreach';

function clean(value, maxLength = 240) {
  return String(value || '').trim().slice(0, maxLength);
}

function isoNow(options = {}) {
  return options.now ? options.now() : new Date().toISOString();
}

function validateRunId(value) {
  const runId = clean(value, 120);
  if (!/^[a-z0-9][a-z0-9._:-]{5,119}$/i.test(runId)) {
    throw new Error('smoke run id must be a unique 6-120 character identifier');
  }
  return runId;
}

function audit(db, input) {
  db.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    `AUD-${crypto.randomUUID()}`,
    clean(input.userId, 160),
    input.action,
    input.entityType,
    clean(input.entityId, 180),
    JSON.stringify(input.detail || {}),
    input.at,
  );
}

function smokeAccount(db) {
  return db.prepare('SELECT * FROM crm_accounts WHERE id=?').get(SMOKE_ACCOUNT_ID);
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function prepareNextActionSmoke(db, options = {}) {
  const runId = validateRunId(options.runId);
  const actorRow = db.prepare("SELECT * FROM sales_users WHERE id=? AND active=1 AND role='admin'")
    .get(clean(options.actorId || 'USR-ADMIN', 160));
  if (!actorRow) throw new Error('an active administrator is required for a production smoke run');
  const actor = hydrateUserPermissions(db, actorRow);
  const existingRun = db.prepare('SELECT * FROM crm_smoke_runs WHERE run_id=?').get(runId);
  if (existingRun) {
    return { runId, accountId: existingRun.account_id, activityId: existingRun.activity_id,
      aiJobId: existingRun.ai_job_id, status: existingRun.status, deduplicated: true };
  }
  const activeRun = db.prepare(`SELECT run_id FROM crm_smoke_runs
    WHERE account_id=? AND status IN ('prepared','queued','failed') ORDER BY created_at DESC LIMIT 1`)
    .get(SMOKE_ACCOUNT_ID);
  if (activeRun) throw new Error(`smoke run ${activeRun.run_id} must be cleaned before starting another`);
  const current = smokeAccount(db);
  if (current && !current.is_test_data) {
    throw new Error('reserved smoke account id is occupied by business data');
  }
  const currentPool = db.prepare('SELECT * FROM customer_pool WHERE customer_id=?')
    .get(SMOKE_EXTERNAL_CUSTOMER_ID);
  if (currentPool && !currentPool.is_test_data) {
    throw new Error('reserved smoke customer-pool id is occupied by business data');
  }
  const serialCollision = db.prepare(`SELECT customer_id FROM customer_pool
    WHERE substr(customer_id,4,4)=substr(?,4,4) AND customer_id!=? LIMIT 1`)
    .get(SMOKE_EXTERNAL_CUSTOMER_ID, SMOKE_EXTERNAL_CUSTOMER_ID);
  if (serialCollision) {
    throw new Error(`reserved smoke customer-pool serial is occupied by ${serialCollision.customer_id}`);
  }

  const at = isoNow(options);
  const activityId = `SMOKE-ACT-${crypto.randomUUID()}`;
  const nextAction = `[SMOKE ${runId}] validate next-action review only`;
  const nextActionAt = new Date(new Date(at).getTime() + 24 * 3600000).toISOString();
  const snapshot = current ? {
    nextAction: current.next_action,
    nextActionAt: current.next_action_at,
    nextActionTimeBasis: current.next_action_time_basis,
    lastActivityAt: current.last_activity_at,
    stage: current.stage,
    testRunId: current.test_run_id,
  } : null;
  const expected = { nextAction, nextActionAt, lastActivityAt: at, stage: 'contacted', testRunId: runId };

  db.transaction(() => {
    if (currentPool) {
      db.prepare(`UPDATE customer_pool SET company_name=?,verified='test_only',
        notes='Dedicated production smoke identity',is_test_data=1,test_run_id=?
        WHERE customer_id=?`).run(
        '[SMOKE TEST] Next Action 专用测试客户',
        runId,
        SMOKE_EXTERNAL_CUSTOMER_ID,
      );
    } else {
      db.prepare(`INSERT INTO customer_pool
        (customer_id,company_name,verified,notes,is_test_data,test_run_id)
        VALUES (?,?,'test_only','Dedicated production smoke identity',1,?)`)
        .run(SMOKE_EXTERNAL_CUSTOMER_ID, '[SMOKE TEST] Next Action 专用测试客户', runId);
    }
    if (!current) {
      db.prepare(`INSERT INTO crm_accounts
        (id,external_customer_id,company_name,country,source,priority,stage,owner_id,created_by,
         last_activity_at,next_action,next_action_at,next_action_time_basis,created_at,updated_at,is_test_data,test_run_id)
        VALUES (?,?,?,'','production_smoke','C','contacted',?,?, ?,?,?, 'utc',?,?,1,?)`).run(
        SMOKE_ACCOUNT_ID,
        SMOKE_EXTERNAL_CUSTOMER_ID,
        '[SMOKE TEST] Next Action 专用测试客户',
        actor.id,
        actor.id,
        at,
        nextAction,
        nextActionAt,
        at,
        at,
        runId,
      );
    } else {
      db.prepare(`UPDATE crm_accounts SET external_customer_id=?,company_name=?,stage='contacted',
        owner_id=?,last_activity_at=?,next_action=?,next_action_at=?,next_action_time_basis='utc',updated_at=?,
        is_test_data=1,test_run_id=? WHERE id=?`).run(
        SMOKE_EXTERNAL_CUSTOMER_ID,
        '[SMOKE TEST] Next Action 专用测试客户',
        actor.id,
        at,
        nextAction,
        nextActionAt,
        at,
        runId,
        SMOKE_ACCOUNT_ID,
      );
    }
    db.prepare(`INSERT INTO crm_activities
      (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,
       stage_after,manager_required,is_test_data,test_run_id,occurred_at,created_at)
      VALUES (?,?,?,'email','test','not_sent',?,?,?,?,0,1,?,?,?)`).run(
      activityId,
      SMOKE_ACCOUNT_ID,
      actor.id,
      `[SMOKE ${runId}] no customer outreach`,
      nextAction,
      nextActionAt,
      'contacted',
      runId,
      at,
      at,
    );
    db.prepare(`INSERT INTO crm_smoke_runs
      (run_id,smoke_type,account_id,activity_id,status,snapshot_json,expected_json,created_by,created_at,updated_at)
      VALUES (?,'next_action',?,?, 'prepared',?,?,?,?,?)`).run(
      runId,
      SMOKE_ACCOUNT_ID,
      activityId,
      JSON.stringify(snapshot),
      JSON.stringify(expected),
      actor.id,
      at,
      at,
    );
    audit(db, {
      userId: actor.id,
      action: 'prepare_production_smoke',
      entityType: 'crm_smoke_run',
      entityId: runId,
      detail: { accountId: SMOKE_ACCOUNT_ID, activityId, testData: true },
      at,
    });
  }).immediate();

  let job;
  try {
    const enqueue = options.enqueue || (input => enqueueNextAction(input));
    job = enqueue({
      db,
      accessContext: buildAccessContext(db, actor, { includeTestData: true }),
      actor,
      customerId: SMOKE_EXTERNAL_CUSTOMER_ID,
      eventType: 'production_smoke',
      eventId: activityId,
      triggerSource: 'release_validation',
      triggerReason: `production-smoke:${runId}`,
    }) || {};
    const jobId = clean(job.id, 180);
    if (jobId) {
      db.prepare(`UPDATE crm_ai_jobs SET trigger_source='release_validation',trigger_reason=?
        WHERE id=?`).run(`production-smoke:${runId}`, jobId);
    }
    db.prepare(`UPDATE crm_smoke_runs SET ai_job_id=?,status='queued',updated_at=?,detail=''
      WHERE run_id=?`).run(jobId, isoNow(options), runId);
    return { runId, accountId: SMOKE_ACCOUNT_ID, activityId, aiJobId: jobId,
      status: 'queued', deduplicated: false };
  } catch (error) {
    db.prepare(`UPDATE crm_smoke_runs SET status='failed',updated_at=?,detail=? WHERE run_id=?`)
      .run(isoNow(options), clean(error.message, 1000), runId);
    throw error;
  }
}

function cleanupNextActionSmoke(db, options = {}) {
  const runId = validateRunId(options.runId);
  const run = db.prepare('SELECT * FROM crm_smoke_runs WHERE run_id=?').get(runId);
  if (!run) throw new Error('smoke run not found');
  if (run.status === 'cleaned' || run.status === 'preserved') {
    return { runId, status: run.status, deduplicated: true };
  }
  const account = db.prepare('SELECT * FROM crm_accounts WHERE id=?').get(run.account_id);
  const expected = JSON.parse(run.expected_json || '{}');
  const snapshot = JSON.parse(run.snapshot_json || 'null');
  const unchanged = account
    && Boolean(account.is_test_data)
    && account.test_run_id === runId
    && account.next_action === expected.nextAction
    && account.next_action_at === expected.nextActionAt
    && account.last_activity_at === expected.lastActivityAt;
  const at = isoNow(options);
  if (!unchanged) {
    db.prepare(`UPDATE crm_smoke_runs SET status='preserved',updated_at=?,detail=?
      WHERE run_id=?`).run(at, 'account changed after smoke write; business state preserved', runId);
    return { runId, status: 'preserved', deduplicated: false };
  }

  db.transaction(() => {
    db.prepare(`UPDATE crm_accounts SET next_action=?,next_action_at=?,next_action_time_basis=?,last_activity_at=?,stage=?,
      test_run_id=?,updated_at=? WHERE id=? AND test_run_id=?`).run(
      snapshot?.nextAction || '',
      snapshot?.nextActionAt || '',
      snapshot?.nextActionTimeBasis || '',
      snapshot?.lastActivityAt || '',
      snapshot?.stage || 'qualified',
      snapshot?.testRunId || '',
      at,
      run.account_id,
      runId,
    );
    db.prepare(`UPDATE customer_pool SET test_run_id=''
      WHERE customer_id=? AND is_test_data=1 AND test_run_id=?`)
      .run(SMOKE_EXTERNAL_CUSTOMER_ID, runId);
    db.prepare(`UPDATE crm_smoke_runs SET status='cleaned',updated_at=?,cleaned_at=?,detail=''
      WHERE run_id=?`).run(at, at, runId);
    audit(db, {
      userId: options.actorId || run.created_by,
      action: 'cleanup_production_smoke',
      entityType: 'crm_smoke_run',
      entityId: runId,
      detail: { accountId: run.account_id, activityId: run.activity_id, aiJobId: run.ai_job_id },
      at,
    });
  }).immediate();
  return { runId, status: 'cleaned', deduplicated: false };
}

function cleanupLegacyA303Smoke(db, options = {}) {
  const accountId = clean(options.accountId, 180);
  const expectedUpdatedAt = clean(options.expectedUpdatedAt, 80);
  const actorId = clean(options.actorId, 160);
  if (!accountId || !expectedUpdatedAt || !actorId) {
    throw new Error('accountId, expectedUpdatedAt, and actorId are required');
  }
  const account = db.prepare('SELECT * FROM crm_accounts WHERE id=?').get(accountId);
  if (!account) throw new Error('legacy smoke account not found');
  const activity = db.prepare(`SELECT * FROM crm_activities
    WHERE customer_id=? AND summary=? AND next_action=? ORDER BY created_at DESC LIMIT 1`)
    .get(accountId, LEGACY_A303_SUMMARY, LEGACY_A303_NEXT_ACTION);
  if (!activity) throw new Error('exact legacy smoke activity not found');
  const job = tableExists(db, 'crm_ai_jobs')
    ? db.prepare(`SELECT * FROM crm_ai_jobs
        WHERE crm_account_id=? AND station='next_action' AND event_id=? ORDER BY created_at DESC LIMIT 1`)
      .get(accountId, activity.id)
    : null;
  const alreadyCleaned = account.next_action === ''
    && account.next_action_at === ''
    && activity.is_test_data
    && activity.test_run_id === LEGACY_A303_RUN_ID
    && (!job || (job.trigger_source === 'release_validation'
      && job.trigger_reason === `production-smoke:${LEGACY_A303_RUN_ID}`));
  if (alreadyCleaned) return { status: 'cleaned', deduplicated: true, accountId, activityId: activity.id, aiJobId: job?.id || '' };
  if (account.next_action !== LEGACY_A303_NEXT_ACTION || account.updated_at !== expectedUpdatedAt) {
    return { status: 'preserved', deduplicated: false, accountId,
      reason: 'account has newer business data; no fields were changed' };
  }

  const at = isoNow(options);
  db.transaction(() => {
    const updated = db.prepare(`UPDATE crm_accounts SET next_action='',next_action_at='',next_action_time_basis='',updated_at=?
      WHERE id=? AND next_action=? AND updated_at=?`).run(
      at, accountId, LEGACY_A303_NEXT_ACTION, expectedUpdatedAt,
    );
    if (updated.changes !== 1) throw new Error('account changed concurrently; cleanup aborted');
    db.prepare(`UPDATE crm_activities SET is_test_data=1,test_run_id=?
      WHERE id=? AND summary=? AND next_action=?`).run(
      LEGACY_A303_RUN_ID, activity.id, LEGACY_A303_SUMMARY, LEGACY_A303_NEXT_ACTION,
    );
    if (job) {
      db.prepare(`UPDATE crm_ai_jobs SET trigger_source='release_validation',trigger_reason=?
        WHERE id=? AND event_id=?`).run(
        `production-smoke:${LEGACY_A303_RUN_ID}`, job.id, activity.id,
      );
    }
    audit(db, {
      userId: actorId,
      action: 'cleanup_production_smoke_residue',
      entityType: 'crm_account',
      entityId: accountId,
      detail: {
        runId: LEGACY_A303_RUN_ID,
        activityId: activity.id,
        aiJobId: job?.id || '',
        before: { nextAction: account.next_action, nextActionAt: account.next_action_at },
        after: { nextAction: '', nextActionAt: '' },
      },
      at,
    });
  }).immediate();
  return { status: 'cleaned', deduplicated: false, accountId, activityId: activity.id, aiJobId: job?.id || '' };
}

module.exports = {
  LEGACY_A303_NEXT_ACTION,
  LEGACY_A303_RUN_ID,
  LEGACY_A303_SUMMARY,
  SMOKE_ACCOUNT_ID,
  SMOKE_EXTERNAL_CUSTOMER_ID,
  cleanupLegacyA303Smoke,
  cleanupNextActionSmoke,
  prepareNextActionSmoke,
};
