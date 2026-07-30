'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

async function json(response) {
  const body = await response.json();
  return { response, body };
}

async function firstReaction(fx, cookie) {
  const { response, body } = await json(await fx.request('/api/sales-crm/activity-reactions', { cookie }));
  assert.equal(response.status, 200);
  assert.ok(body.reactions.length > 0, 'expected at least one active reaction');
  return body.reactions[0];
}

function progressPayload(reactionOptionId, progressType, overrides = {}) {
  return {
    customerId: 'CRM-OWN',
    progressType,
    reactionOptionId,
    summary: `Issue 149 ${progressType}`,
    nextAction: '继续跟进',
    nextActionAt: '2099-08-01 09:00:00',
    occurredAt: '2026-07-31 09:00:00',
    managerRequired: false,
    ...overrides,
  };
}

test('activity customer search matches shared nickname, official name and stable code within scope', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { record_activity: true },
  });
  t.after(() => fx.close());
  fx.db.prepare("UPDATE customer_pool SET nickname='北方重点客户' WHERE customer_id='RU-9002'").run();
  fx.db.prepare("UPDATE customer_pool SET nickname='越权隐藏昵称' WHERE customer_id='RU-9003'").run();

  const searches = [
    ['北方重点', 'CRM-OWN'],
    ['Owned Fixture', 'CRM-OWN'],
    ['RU-9002', 'CRM-OWN'],
  ];
  for (const [query, expectedId] of searches) {
    const { response, body } = await json(await fx.request(
      `/api/sales-crm/activity-customers?q=${encodeURIComponent(query)}`,
      { cookie: fx.cookie },
    ));
    assert.equal(response.status, 200, query);
    assert.deepEqual(body.customers.map(item => item.id), [expectedId], query);
    assert.deepEqual(Object.keys(body.customers[0]).sort(), [
      'companyName', 'externalCustomerId', 'id', 'nickname', 'ownerId', 'ownerName', 'stage',
    ]);
    assert.equal(body.customers[0].nickname, '北方重点客户');
    assert.equal(body.customers[0].companyName, 'Owned Fixture');
    assert.equal(body.customers[0].externalCustomerId, 'RU-9002');
    assert.equal(body.customers[0].ownerId, 'U-MGR');
  }

  for (const query of ['越权隐藏昵称', 'Other Fixture', 'RU-9003']) {
    const { response, body } = await json(await fx.request(
      `/api/sales-crm/activity-customers?q=${encodeURIComponent(query)}`,
      { cookie: fx.cookie },
    ));
    assert.equal(response.status, 200, query);
    assert.deepEqual(body.customers, [], query);
    assert.doesNotMatch(JSON.stringify(body), /越权隐藏昵称|Other Fixture|RU-9003/);
  }
});

test('activity search and direct writes both enforce record_activity and customer scope', async t => {
  const fx = await fixtures.seededFixture({
    managerViewAll: false,
    permissions: { record_activity: true },
  });
  t.after(() => fx.close());
  const reaction = await firstReaction(fx, fx.cookie);

  const forbiddenCustomer = await fx.request('/api/sales-crm/activities', {
    cookie: fx.cookie,
    method: 'POST',
    body: progressPayload(reaction.id, 'email', { customerId: 'CRM-OTHER' }),
  });
  assert.equal(forbiddenCustomer.status, 403);
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_activities WHERE customer_id='CRM-OTHER'").get().count,
    0,
  );

  fx.setUserPermissions('U-MGR', { record_activity: false });
  assert.equal((await fx.request('/api/sales-crm/activity-customers?q=Owned', {
    cookie: fx.cookie,
  })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/activity-reactions', {
    cookie: fx.cookie,
  })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/activities', {
    cookie: fx.cookie,
    method: 'POST',
    body: progressPayload(reaction.id, 'email'),
  })).status, 403);
});

test('ten progress choices map to stable activity and channel keys and deterministic stages', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const reaction = await firstReaction(fx, fx.adminCookie);
  const mappings = [
    ['email', 'email', 'email', 'contacted'],
    ['call', 'call', 'call', 'contacted'],
    ['whatsapp', 'social', 'WhatsApp', 'connected'],
    ['telegram', 'social', 'Telegram', 'connected'],
    ['linkedin', 'social', 'LinkedIn', 'connected'],
    ['reply', 'reply', 'other', 'replied'],
    ['meeting', 'meeting', 'video', 'meeting'],
    ['rfq', 'rfq', 'business', 'rfq'],
    ['negotiation', 'negotiation', 'business', 'negotiating'],
    ['lost', 'lost', 'other', 'lost'],
  ];

  for (const [progressType, activityType, channel, stageAfter] of mappings) {
    fx.db.prepare(`DELETE FROM crm_activities WHERE customer_id='CRM-OWN'`).run();
    fx.db.prepare(`DELETE FROM crm_rfqs WHERE customer_id='CRM-OWN'`).run();
    fx.db.prepare(`UPDATE crm_accounts SET stage='qualified',next_action='旧计划',
      next_action_at='2099-01-01 00:00:00',manager_required=0,manager_status=''
      WHERE id='CRM-OWN'`).run();
    const extra = progressType === 'rfq'
      ? {
        reference: 'RFQ-ISSUE-149',
        bomLines: 2,
        expectedValue: 100,
        completeness: 90,
        productCategory: 'MCU',
      }
      : {};
    const { response, body } = await json(await fx.request('/api/sales-crm/activities', {
      cookie: fx.adminCookie,
      method: 'POST',
      body: progressPayload(reaction.id, progressType, {
        channel: 'client-must-not-control-channel',
        ...extra,
      }),
    }));
    assert.equal(response.status, 200, progressType);
    assert.equal(body.stageBefore, 'qualified', progressType);
    assert.equal(body.stageAfter, stageAfter, progressType);
    assert.equal(body.stageChanged, stageAfter !== 'qualified', progressType);
    const stored = fx.db.prepare(`SELECT activity_type,channel,stage_after
      FROM crm_activities WHERE id=?`).get(body.activityId);
    assert.deepEqual(stored, {
      activity_type: activityType,
      channel,
      stage_after: stageAfter,
    }, progressType);
  }

  assert.deepEqual(
    fx.db.prepare("SELECT stage,next_action,next_action_at FROM crm_accounts WHERE id='CRM-OWN'").get(),
    { stage: 'lost', next_action: '', next_action_at: '' },
  );
});

test('progress validation prevents forged meanings, reaction-driven stages and stage regression', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const reaction = await firstReaction(fx, fx.adminCookie);

  const unknown = await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: progressPayload(reaction.id, 'invented-progress'),
  });
  assert.equal(unknown.status, 400);

  fx.db.prepare("UPDATE crm_accounts SET stage='qualified' WHERE id='CRM-OWN'").run();
  const managerNeeded = await json(await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: progressPayload(reaction.id, 'email', { managerRequired: true }),
  }));
  assert.equal(managerNeeded.response.status, 200);
  assert.equal(managerNeeded.body.stageAfter, 'contacted');
  assert.equal(
    fx.db.prepare("SELECT manager_required FROM crm_accounts WHERE id='CRM-OWN'").get().manager_required,
    1,
  );

  fx.db.prepare("UPDATE crm_accounts SET stage='quoted' WHERE id='CRM-OWN'").run();
  const noRegression = await json(await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: progressPayload(reaction.id, 'call', { managerRequired: false }),
  }));
  assert.equal(noRegression.response.status, 200);
  assert.deepEqual({
    stageBefore: noRegression.body.stageBefore,
    stageAfter: noRegression.body.stageAfter,
    stageChanged: noRegression.body.stageChanged,
  }, {
    stageBefore: 'quoted',
    stageAfter: 'quoted',
    stageChanged: false,
  });
});

test('activity, stage and follow-up changes roll back together on a database failure', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const reaction = await firstReaction(fx, fx.adminCookie);
  const before = fx.db.prepare(`SELECT stage,last_activity_at,next_action,next_action_at,
    manager_required,manager_status FROM crm_accounts WHERE id='CRM-OWN'`).get();
  const activityCount = fx.db.prepare(
    "SELECT COUNT(*) count FROM crm_activities WHERE customer_id='CRM-OWN'",
  ).get().count;
  fx.db.exec(`CREATE TRIGGER issue149_abort_account_update
    BEFORE UPDATE ON crm_accounts
    WHEN OLD.id='CRM-OWN'
    BEGIN SELECT RAISE(ABORT, 'issue149 forced rollback'); END`);

  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: progressPayload(reaction.id, 'meeting', { managerRequired: true }),
  });
  assert.ok(response.status >= 400);
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_activities WHERE customer_id='CRM-OWN'").get().count,
    activityCount,
  );
  assert.deepEqual(
    fx.db.prepare(`SELECT stage,last_activity_at,next_action,next_action_at,
      manager_required,manager_status FROM crm_accounts WHERE id='CRM-OWN'`).get(),
    before,
  );
});

test('activity idempotency replays the original response and prevents duplicate RFQs', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const reaction = await firstReaction(fx, fx.adminCookie);
  fx.db.prepare("UPDATE crm_accounts SET stage='qualified' WHERE id='CRM-OWN'").run();
  const payload = progressPayload(reaction.id, 'rfq', {
    idempotencyKey: 'issue149-rfq-once',
    reference: 'RFQ-ONCE',
    bomLines: 3,
    expectedValue: 900,
    completeness: 80,
    productCategory: 'MCU',
  });
  const first = await json(await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie, method: 'POST', body: payload,
  }));
  const second = await json(await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie, method: 'POST', body: payload,
  }));
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(first.body.deduplicated, false);
  assert.equal(second.body.deduplicated, true);
  assert.equal(second.body.activityId, first.body.activityId);
  assert.deepEqual(
    {
      stageBefore: second.body.stageBefore,
      stageAfter: second.body.stageAfter,
      stageChanged: second.body.stageChanged,
    },
    {
      stageBefore: first.body.stageBefore,
      stageAfter: first.body.stageAfter,
      stageChanged: first.body.stageChanged,
    },
  );
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_activities WHERE id=?").get(first.body.activityId).count,
    1,
  );
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_rfqs WHERE reference='RFQ-ONCE'").get().count,
    1,
  );

  const conflict = await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { ...payload, summary: '同一个幂等键不能绑定不同内容' },
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'ACTIVITY_IDEMPOTENCY_CONFLICT');
});

test('migration backfills stable progress keys for historical social channels', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const insert = fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,summary,occurred_at,created_at,progress_key)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const [suffix, channel] of [['WA', 'WhatsApp'], ['TG', 'Telegram'], ['LI', 'LinkedIn']]) {
    insert.run(
      `ACT-LEGACY-${suffix}`, 'CRM-OWN', 'USR-ADMIN', 'social', channel,
      `legacy ${channel}`, '2026-07-01 09:00:00', '2026-07-01 09:00:00', '',
    );
  }

  const { installSalesCrm } = require('../lib/sales_crm');
  installSalesCrm();

  assert.deepEqual(
    fx.db.prepare(`SELECT id,progress_key FROM crm_activities
      WHERE id LIKE 'ACT-LEGACY-%' ORDER BY id`).all(),
    [
      { id: 'ACT-LEGACY-LI', progress_key: 'linkedin' },
      { id: 'ACT-LEGACY-TG', progress_key: 'telegram' },
      { id: 'ACT-LEGACY-WA', progress_key: 'whatsapp' },
    ],
  );
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const progress = Object.fromEntries(
    bootstrap.activities
      .filter(item => item.id.startsWith('ACT-LEGACY-'))
      .map(item => [item.id, item.progressType]),
  );
  assert.deepEqual(progress, {
    'ACT-LEGACY-LI': 'linkedin',
    'ACT-LEGACY-TG': 'telegram',
    'ACT-LEGACY-WA': 'whatsapp',
  });
});
