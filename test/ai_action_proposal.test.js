'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');
const { getStation, renderPrompt } = require('../lib/ai_stations/prompt_registry');
const { validateStationOutput } = require('../lib/ai_stations/contracts');
const { createAIStationWorker } = require('../lib/ai_stations/worker');

function output(overrides = {}) {
  return {
    version: 'v1',
    activityType: 'reply',
    channel: 'email',
    outcome: '有兴趣',
    summary: '客户确认正在整理BOM，预计本周提供。',
    nextAction: '周五追踪BOM',
    nextActionAt: '2026-07-31 09:00:00',
    missingFields: [],
    evidenceIds: [],
    confidence: 0.91,
    reviewRequired: true,
    ...overrides,
  };
}

test('action_proposal is a strict review-only auxiliary contract', () => {
  assert.equal(getStation('action_proposal').name, 'action_proposal');
  assert.equal(validateStationOutput('action_proposal', 'v1', output(), { evidenceIds: [] }).ok, true);
  assert.equal(validateStationOutput('action_proposal', 'v1', output({
    reviewRequired: false,
  }), { evidenceIds: [] }).ok, false);
  const prompt = renderPrompt('action_proposal', {
    actor: { id: 'U-SALES', role: 'sales', permissions: ['record_activity'] },
    trustedCrmContext: { customerId: 'RU-1' },
    evidence: [],
    userContent: '客户回复说周五发送BOM',
  });
  assert.match(prompt.systemPolicy, /Never create an activity or change CRM state/);
  assert.equal(prompt.untrustedUserContent, '客户回复说周五发送BOM');
});

test('natural-language result becomes an async proposal and confirmation writes one activity', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: {
      use_ai_assistant: true,
      record_activity: true,
      review_ai_tasks: true,
      view_customers: true,
    },
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  t.after(() => fx.close());

  const created = await fx.request('/api/sales-crm/ai/customers/RU-9002/action-proposals', {
    cookie: fx.cookie,
    method: 'POST',
    body: { input: '客户通过邮件回复，对产品有兴趣，周五会发BOM', clientRequestId: 'request-1' },
  });
  assert.equal(created.status, 202);
  const job = (await created.json()).job;
  assert.equal(job.station, 'action_proposal');

  let modelInput;
  const worker = createAIStationWorker({
    workerId: 'action-proposal-worker',
    openDb: () => new Database(fx.dbPath),
    executorOptions: {
      modelCall: async messages => {
        modelInput = JSON.parse(messages[1].content);
        return {
          answer: `Here is the structured proposal:\n${JSON.stringify(output())}\nPlease review it before saving.`,
          engine: 'test',
          model: 'action-proposal-fixture',
          usage: { inputTokens: 40, outputTokens: 50 },
          cost: 0,
        };
      },
    },
  });
  assert.equal((await worker.runOnce()).status, 'succeeded');
  assert.equal(modelInput.untrustedUserContent, '客户通过邮件回复，对产品有兴趣，周五会发BOM');
  assert.equal(fx.db.prepare('SELECT state FROM crm_ai_jobs WHERE id=?').get(job.id).state, 'needs_review');

  const bypass = await fx.request(`/api/sales-crm/ai/jobs/${job.id}/review`, {
    cookie: fx.cookie,
    method: 'POST',
    body: { decision: 'approved' },
  });
  assert.equal(bypass.status, 409);
  assert.equal((await bypass.json()).code, 'AI_ACTION_PROPOSAL_REQUIRES_ACTIVITY_CONFIRMATION');

  const payload = {
    customerId: 'CRM-OWN',
    proposalJobId: job.id,
    activityType: 'reply',
    channel: 'email',
    outcome: '有兴趣',
    summary: '客户确认正在整理BOM，预计本周提供。',
    nextAction: '周五追踪BOM',
    nextActionAt: '2026-07-31 09:00:00',
  };
  const confirmed = await fx.request('/api/sales-crm/activities', {
    cookie: fx.cookie, method: 'POST', body: payload,
  });
  assert.equal(confirmed.status, 200);
  const first = await confirmed.json();
  assert.match(first.activityId, /^ACT-/);
  assert.equal(first.deduplicated, false);

  const repeated = await fx.request('/api/sales-crm/activities', {
    cookie: fx.cookie, method: 'POST', body: payload,
  });
  assert.equal(repeated.status, 200);
  const second = await repeated.json();
  assert.equal(second.activityId, first.activityId);
  assert.equal(second.deduplicated, true);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_activities WHERE id=?').get(first.activityId).count, 1);
  assert.equal(fx.db.prepare('SELECT state FROM crm_ai_jobs WHERE id=?').get(job.id).state, 'succeeded');
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_action_proposal_consumptions WHERE job_id=?')
    .get(job.id).count, 1);
});

test('incomplete proposal confirmation stays in draft and writes no activity', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { use_ai_assistant: true, record_activity: true, view_customers: true },
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  t.after(() => fx.close());

  const created = await fx.request('/api/sales-crm/ai/customers/RU-9002/action-proposals', {
    cookie: fx.cookie,
    method: 'POST',
    body: { input: '客户回复了', clientRequestId: 'request-incomplete' },
  });
  const job = (await created.json()).job;
  const worker = createAIStationWorker({
    workerId: 'action-proposal-incomplete-worker',
    openDb: () => new Database(fx.dbPath),
    executorOptions: {
      modelCall: async () => ({
        answer: JSON.stringify(output({
          summary: '客户回复了。',
          nextAction: '',
          nextActionAt: '',
          missingFields: ['nextAction', 'nextActionAt'],
          confidence: 0.42,
        })),
        engine: 'test',
        model: 'action-proposal-fixture',
      }),
    },
  });
  await worker.runOnce();

  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN',
      proposalJobId: job.id,
      activityType: 'reply',
      channel: 'email',
      outcome: '需要跟进',
      summary: '客户回复了。',
      nextAction: '',
      nextActionAt: '',
    },
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, 'AI_ACTION_PROPOSAL_INCOMPLETE');
  assert.deepEqual(body.missingFields, ['nextAction', 'nextActionAt']);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_activities WHERE customer_id=?').get('CRM-OWN').count, 0);
  assert.equal(fx.db.prepare('SELECT state FROM crm_ai_jobs WHERE id=?').get(job.id).state, 'needs_review');
});

test('activity modal exposes AI draft generation but keeps the activity API as the only business write', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');
  assert.match(app, /id="actionProposalInput"/);
  assert.match(app, /action-proposals/);
  assert.match(app, /proposalJobId/);
  assert.match(app, /确认并记录/);
  assert.match(app, /\/api\/sales-crm\/activities/);
  assert.doesNotMatch(app, /autoConfirmActionProposal|autoCreateActivity/);
  assert.match(css, /\.action-proposal-compose/);
  assert.match(css, /@media\(max-width:780px\)\{\.action-proposal-compose/);
});
