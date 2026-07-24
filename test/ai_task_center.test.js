'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { buildCustomerContext } = require('../lib/ai_stations/context');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createAIResultStore } = require('../lib/ai_stations/results');
const { createAITaskCenterStore } = require('../lib/ai_stations/task_center');
const { createAIBudgetStore } = require('../lib/ai_stations/budgets');

function enqueue(db, id, customerId, crmAccountId, actorId) {
  return createAIJobStore(db, { idFactory: () => id }).enqueue({
    customerId,
    crmAccountId,
    station: 'customer_fit',
    contextHash: 'a'.repeat(64),
    payload: { secretPrompt: 'must never be returned' },
    createdBy: actorId,
  }, `task-center:${id}`);
}

test('task center unifies sources, paginates and enforces customer plus actor scope', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_customers: true },
  });
  t.after(() => fx.close());
  enqueue(fx.db, 'AIJ-OWN', 'RU-9002', 'CRM-OWN', 'U-MGR');
  enqueue(fx.db, 'AIJ-OTHER', 'RU-9003', 'CRM-OTHER', 'U-OTHER');
  const tasks = createAITaskCenterStore(fx.db, {
    idFactory: prefix => `${prefix}-FIXTURE`,
    now: () => new Date('2026-07-21T09:00:00Z'),
  });
  tasks.recordInteraction({ actorId: 'U-MGR', engine: 'openai', model: 'gpt-test', usage: { input_tokens: 10, output_tokens: 5 } });
  fx.db.prepare(`INSERT INTO crm_ai_interaction_runs
    (id,kind,actor_id,state,created_at,finished_at)
    VALUES ('AII-OTHER','assistant_chat','U-OTHER','succeeded','2026-07-21T09:01:00Z','2026-07-21T09:01:01Z')`).run();
  fx.db.prepare(`INSERT INTO prospect_tasks(task_id,created_by,status,created_at,updated_at)
    VALUES ('PROSPECT-OWN','U-MGR','queued','2026-07-21T09:02:00Z','2026-07-21T09:02:00Z'),
           ('PROSPECT-OTHER','U-OTHER','queued','2026-07-21T09:03:00Z','2026-07-21T09:03:00Z')`).run();

  const response = await fx.request('/api/sales-crm/ai/tasks?page=1&pageSize=3', { cookie: fx.cookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.page, 1);
  assert.equal(body.pageSize, 3);
  assert.equal(body.overview, null);
  assert.equal(body.total, 4);
  assert.ok(body.items.some(item => item.taskId === 'AIJ-OWN'));
  assert.ok(body.items.some(item => item.taskId === 'prospect:PROSPECT-OWN'));
  assert.ok(body.items.every(item => !['AIJ-OTHER', 'prospect:PROSPECT-OTHER', 'interaction:AII-OTHER'].includes(item.taskId)));

  const filtered = await fx.request('/api/sales-crm/ai/tasks?type=company_recon&customer=RU-9002', { cookie: fx.cookie });
  assert.deepEqual((await filtered.json()).items.map(item => item.taskId), ['recon:JOB-OWN']);
});

test('administrator, manager and sales task lists follow the role plus customer row matrix', async t => {
  const fx = await fixtures.adminFixture({ managerViewAll: false });
  t.after(() => fx.close());
  enqueue(fx.db, 'AIJ-MATRIX-MANAGER', 'RU-9002', 'CRM-OWN', 'U-MGR');
  enqueue(fx.db, 'AIJ-MATRIX-SALES', 'RU-9003', 'CRM-OTHER', 'U-OTHER');

  const manager = await (await fx.request('/api/sales-crm/ai/tasks?type=customer_fit', {
    cookie: fx.cookie,
  })).json();
  const sales = await (await fx.request('/api/sales-crm/ai/tasks?type=customer_fit', {
    cookie: fx.otherCookie,
  })).json();
  const admin = await (await fx.request('/api/sales-crm/ai/tasks?type=customer_fit', {
    cookie: fx.adminCookie,
  })).json();
  assert.deepEqual(manager.items.map(item => item.taskId), ['AIJ-MATRIX-MANAGER']);
  assert.deepEqual(sales.items.map(item => item.taskId), ['AIJ-MATRIX-SALES']);
  assert.deepEqual(new Set(admin.items.map(item => item.taskId)), new Set([
    'AIJ-MATRIX-MANAGER', 'AIJ-MATRIX-SALES',
  ]));
});

test('task detail exposes safe attempts, result evidence and timeline without queue internals', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_customers: true, use_ai_assistant: true },
  });
  t.after(() => fx.close());
  const context = buildCustomerContext(fx.db, {
    permissions: { view_contacts: false },
    accountIds: new Set(['CRM-OWN']),
    externalCustomerIds: new Set(['RU-9002']),
  }, 'RU-9002');
  const jobs = createAIJobStore(fx.db, { idFactory: () => 'AIJ-DETAIL' });
  jobs.enqueue({
    customerId: 'RU-9002', crmAccountId: 'CRM-OWN', station: 'customer_fit',
    contextHash: context.contextHash, payload: { fullPrompt: 'secret' }, createdBy: 'U-MGR',
  }, 'task-center:detail');
  jobs.claimById('AIJ-DETAIL', 'worker-secret');
  const results = createAIResultStore(fx.db, { idFactory: prefix => `${prefix}-DETAIL` });
  results.recordModelRun({
    jobId: 'AIJ-DETAIL', attempt: 1, engine: 'openai', model: 'gpt-test',
    status: 'succeeded', durationMs: 321, usage: { input_tokens: 20, output_tokens: 8 },
    startedAt: '2026-07-21T08:01:00Z', finishedAt: '2026-07-21T08:01:00.321Z',
  }, 'model-run:detail');
  results.saveResult({
    jobId: 'AIJ-DETAIL', workerId: 'worker-secret', contextHash: context.contextHash,
    value: {
      version: 'v1', confidence: 0.9, evidenceIds: context.evidenceIds,
      reasonCodes: ['PRODUCT_MATCH'], fitScore: 88, grade: 'A', reviewRequired: false,
    },
    evidenceIds: context.evidenceIds,
    metadata: {
      engine: 'openai', model: 'gpt-test', promptVersion: 'v1', schemaVersion: 'v1',
      usage: { input_tokens: 20, output_tokens: 8 }, cost: 0.001,
    },
  }, 'result:detail');

  const response = await fx.request('/api/sales-crm/ai/tasks/AIJ-DETAIL', { cookie: fx.cookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.task.result.value.fitScore, 88);
  assert.equal(body.task.attempts[0].durationMs, 321);
  assert.ok(body.task.timeline.some(item => item.kind === 'attempt_finished'));
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /worker-secret|fullPrompt|leaseOwner|input_json|idempotency/i);
});

test('review action is separately authorized, audited and finalizes a needs-review task', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_customers: true, review_ai_tasks: true },
  });
  t.after(() => fx.close());
  const context = buildCustomerContext(fx.db, {
    permissions: { view_contacts: false },
    accountIds: new Set(['CRM-OWN']),
    externalCustomerIds: new Set(['RU-9002']),
  }, 'RU-9002');
  const jobs = createAIJobStore(fx.db, { idFactory: () => 'AIJ-REVIEW' });
  jobs.enqueue({
    customerId: 'RU-9002', crmAccountId: 'CRM-OWN', station: 'customer_fit',
    contextHash: context.contextHash, createdBy: 'U-MGR',
  }, 'task-center:review');
  jobs.claimById('AIJ-REVIEW', 'review-worker');
  createAIResultStore(fx.db, { idFactory: prefix => `${prefix}-REVIEW` }).saveResult({
    jobId: 'AIJ-REVIEW', workerId: 'review-worker', contextHash: context.contextHash,
    value: {
      version: 'v1', confidence: 0.5, evidenceIds: context.evidenceIds,
      reasonCodes: ['DATA_GAP'], fitScore: 55, grade: 'C', reviewRequired: true,
    },
    evidenceIds: context.evidenceIds,
    metadata: {
      engine: 'openai', model: 'gpt-test', promptVersion: 'v1', schemaVersion: 'v1', usage: {}, cost: 0,
    },
  }, 'result:review');

  const response = await fx.request('/api/sales-crm/ai/jobs/AIJ-REVIEW/review', {
    cookie: fx.cookie,
    method: 'POST',
    body: { decision: 'approved', summary: '证据已核验' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.task.state, 'succeeded');
  assert.equal(body.task.reviews[0].summary, '证据已核验');
  await new Promise(resolve => setImmediate(resolve));
  const audit = fx.db.prepare(`SELECT action,detail_json FROM crm_audit_log
    WHERE entity_type='ai_station' ORDER BY rowid DESC LIMIT 1`).get();
  assert.equal(audit.action, 'POST /ai/jobs/:jobId/review');
  assert.doesNotMatch(audit.detail_json, /AIJ-REVIEW|证据已核验/);
});

test('only administrators receive global runtime metrics', async t => {
  const fx = await fixtures.adminFixture({ permissions: { view_customers: true } });
  t.after(() => fx.close());
  enqueue(fx.db, 'AIJ-ADMIN', 'RU-9003', 'CRM-OTHER', 'U-OTHER');
  createAIBudgetStore(fx.db).setPolicy({
    scopeType: 'company', scopeId: 'default', dailyLimit: 10, monthlyLimit: 100, perTaskLimit: 1,
  });
  const response = await fx.request('/api/sales-crm/ai/tasks', { cookie: fx.adminCookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.overview);
  assert.equal(body.overview.queue.queued, 1);
  assert.equal(body.overview.budget.policies.length, 1);
  assert.equal(body.overview.budget.policies[0].dailyLimit, 10);
  assert.equal(body.overview.budget.alertCount, 0);
  assert.equal(body.overview.monthlyCost, 0);
  assert.ok(body.items.some(item => item.taskId === 'AIJ-ADMIN'));
  assert.ok(body.items.some(item => item.taskId === 'recon:JOB-OTHER'));
});

test('assistant requests persist only safe runtime metadata and honor the AI feature flag', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_customers: true, use_ai_assistant: true },
  });
  t.after(() => fx.close());
  const response = await fx.request('/api/assistant/chat', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      message: '列出联系人',
      history: [{ role: 'user', content: 'history-secret-marker' }],
      context: {},
    },
  });
  assert.equal(response.status, 200);
  const row = fx.db.prepare('SELECT * FROM crm_ai_interaction_runs ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(row.kind, 'assistant_chat');
  assert.equal(row.customer_id, '');
  assert.equal(row.crm_account_id, null);
  assert.equal(row.actor_id, 'U-MGR');
  assert.doesNotMatch(JSON.stringify(row), /history-secret-marker/);
  const columns = fx.db.prepare('PRAGMA table_info(crm_ai_interaction_runs)').all().map(item => item.name);
  assert.ok(!columns.some(name => /prompt|message|history|input_json/.test(name)));
});

test('review requires its separate evaluation permission before resolving a task', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: {
      view_customers: true, manage_evaluations: true, review_ai_tasks: false, use_ai_assistant: true,
    },
  });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/ai/jobs/AIJ-NOT-EXPOSED/review', {
    cookie: fx.cookie,
    method: 'POST',
    body: { decision: 'approved' },
  });
  assert.equal(response.status, 403);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM sqlite_master
    WHERE type='table' AND name='crm_ai_task_reviews'`).get().count, 0);
});

test('task summaries and details redact contact plus Recon content independently', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_customers: true, view_contacts: false, view_recon: false },
  });
  t.after(() => fx.close());
  const now = '2026-07-21 08:00:00';
  fx.db.prepare(`INSERT INTO contact_recon_jobs
    (job_id,customer_id,company_name,status,failure_reason,created_at,updated_at)
    VALUES ('CONTACT-OWN','RU-9002','Owned Fixture','failed','buyer@secret.test +7 999 111 22 33',?,?)`)
    .run(now, now);
  fx.db.prepare(`UPDATE recon_jobs SET status='failed',error='https://secret-recon.test/report'
    WHERE job_id='JOB-OWN'`).run();

  const hidden = await (await fx.request('/api/sales-crm/ai/tasks', { cookie: fx.cookie })).json();
  const hiddenContact = hidden.items.find(item => item.taskId === 'contact:CONTACT-OWN');
  const hiddenRecon = hidden.items.find(item => item.taskId === 'recon:JOB-OWN');
  assert.equal(hiddenContact.contentRestricted, true);
  assert.equal(hiddenContact.restrictedContent, 'contacts');
  assert.equal(hiddenContact.errorSummary, '');
  assert.equal(hiddenRecon.contentRestricted, true);
  assert.equal(hiddenRecon.restrictedContent, 'recon');
  assert.equal(hiddenRecon.errorSummary, '');
  for (const taskId of ['contact:CONTACT-OWN', 'recon:JOB-OWN']) {
    const detail = await (await fx.request(`/api/sales-crm/ai/tasks/${encodeURIComponent(taskId)}`, {
      cookie: fx.cookie,
    })).json();
    assert.equal(detail.task.errorSummary, '');
    assert.doesNotMatch(JSON.stringify(detail), /buyer@secret|secret-recon|999 111/);
  }

  fx.setUserPermissions('U-MGR', { view_contacts: true, view_recon: false });
  const contactsOnly = await (await fx.request('/api/sales-crm/ai/tasks', { cookie: fx.cookie })).json();
  assert.match(contactsOnly.items.find(item => item.taskId === 'contact:CONTACT-OWN').errorSummary, /buyer@secret/);
  assert.equal(contactsOnly.items.find(item => item.taskId === 'recon:JOB-OWN').errorSummary, '');

  fx.setUserPermissions('U-MGR', { view_contacts: false, view_recon: true });
  const reconOnly = await (await fx.request('/api/sales-crm/ai/tasks', { cookie: fx.cookie })).json();
  assert.equal(reconOnly.items.find(item => item.taskId === 'contact:CONTACT-OWN').errorSummary, '');
  assert.match(reconOnly.items.find(item => item.taskId === 'recon:JOB-OWN').errorSummary, /secret-recon/);

  fx.setUserPermissions('U-MGR', { view_contacts: true, view_recon: true });
  const visible = await (await fx.request('/api/sales-crm/ai/tasks', { cookie: fx.cookie })).json();
  assert.match(visible.items.find(item => item.taskId === 'contact:CONTACT-OWN').errorSummary, /buyer@secret/);
  assert.match(visible.items.find(item => item.taskId === 'recon:JOB-OWN').errorSummary, /secret-recon/);
});

test('queued or failed AI execution never blocks CRM and historical task reads', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { view_customers: true, view_contacts: false, view_recon: false },
  });
  t.after(() => fx.close());
  const jobs = createAIJobStore(fx.db, { idFactory: () => 'AIJ-DEGRADED' });
  jobs.enqueue({
    customerId: 'RU-9002', crmAccountId: 'CRM-OWN', station: 'customer_fit',
    contextHash: 'd'.repeat(64), createdBy: 'U-MGR',
  }, 'degraded:queued');

  const queuedTasks = await fx.request('/api/sales-crm/ai/tasks', { cookie: fx.cookie });
  const profile = await fx.request('/api/sales-crm/profile/RU-9002', { cookie: fx.cookie });
  assert.equal(queuedTasks.status, 200);
  assert.equal(profile.status, 200);
  assert.ok((await queuedTasks.json()).items.some(item => item.taskId === 'AIJ-DEGRADED'));

  jobs.claimById('AIJ-DEGRADED', 'unavailable-router-worker');
  fx.db.prepare('UPDATE crm_ai_jobs SET max_attempts=1 WHERE id=?').run('AIJ-DEGRADED');
  jobs.fail('AIJ-DEGRADED', 'unavailable-router-worker', new Error('router unavailable buyer@secret.test'));
  const historical = await fx.request('/api/sales-crm/ai/tasks/AIJ-DEGRADED', { cookie: fx.cookie });
  assert.equal(historical.status, 200);
  assert.doesNotMatch(JSON.stringify(await historical.json()), /buyer@secret/);
  assert.equal((await fx.request('/api/sales-crm/profile/RU-9002', { cookie: fx.cookie })).status, 200);
});
