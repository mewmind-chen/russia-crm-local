'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

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

function noPlanPayload(reactionId, sequence, overrides = {}) {
  return {
    customerId: 'CRM-OWN',
    progressType: 'email',
    reactionOptionId: reactionId,
    summary: `Issue 243 暂无计划 ${sequence}`,
    noPlan: true,
    nextAction: '',
    nextActionAt: '',
    occurredAt: `2026-08-01 10:0${sequence}:00`,
    managerRequired: false,
    ...overrides,
  };
}

function planPayload(reactionId, sequence, overrides = {}) {
  return {
    customerId: 'CRM-OWN',
    progressType: 'email',
    reactionOptionId: reactionId,
    summary: `Issue 243 真实计划 ${sequence}`,
    noPlan: false,
    nextAction: '确认BOM后提交报价',
    nextActionAt: '2099-08-01 09:00:00',
    occurredAt: `2026-08-02 10:0${sequence}:00`,
    managerRequired: false,
    ...overrides,
  };
}

async function recordActivity(fx, cookie, body) {
  return json(await fx.request('/api/sales-crm/activities', {
    cookie,
    method: 'POST',
    body,
  }));
}

async function bootstrapAlerts(fx, cookie) {
  const { response, body } = await json(await fx.request('/api/sales-crm/bootstrap', { cookie }));
  assert.equal(response.status, 200);
  return body.alerts || [];
}

function streakAlert(alerts) {
  return alerts.find(item => (item.reasons || []).some(reason => reason.code === 'NO_PLAN_STREAK'));
}

function noPlanNotifications(fx, customerId) {
  return fx.db.prepare(`SELECT id,user_id,title,detail,dedupe_key
    FROM crm_notifications WHERE code='NO_PLAN_STREAK' AND customer_id=?
    ORDER BY user_id,dedupe_key`).all(customerId);
}

test('Issue 243 no-plan activity saves without plan and exposes noPlan in API and timeline', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const reaction = await firstReaction(fx, fx.adminCookie);

  const { response, body } = await recordActivity(fx, fx.adminCookie, noPlanPayload(reaction.id, 1));
  assert.equal(response.status, 200, body.error);
  assert.equal(body.noPlan, true);

  const stored = fx.db.prepare(`SELECT no_plan,next_action,next_action_at
    FROM crm_activities WHERE id=?`).get(body.activityId);
  assert.deepEqual(stored, { no_plan: 1, next_action: '', next_action_at: '' });
  const account = fx.db.prepare(`SELECT next_action,next_action_at
    FROM crm_accounts WHERE id='CRM-OWN'`).get();
  assert.deepEqual(account, { next_action: '', next_action_at: '' });

  const { body: boot } = await json(await fx.request('/api/sales-crm/bootstrap', {
    cookie: fx.adminCookie,
  }));
  const event = (boot.timeline || []).find(item => item.id === `activity:${body.activityId}`);
  assert.ok(event, 'activity timeline event missing');
  assert.equal(event.no_plan, 1);
  assert.equal(event.next_action, '');
});

test('Issue 243 without noPlan the plan-pair validation still applies and noPlan requires record_activity', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const reaction = await firstReaction(fx, fx.adminCookie);

  const missingPlan = await recordActivity(fx, fx.adminCookie, noPlanPayload(reaction.id, 2, {
    noPlan: false,
    nextAction: '只填计划不填时间',
  }));
  assert.equal(missingPlan.response.status, 400);
  assert.match(missingPlan.body.error, /下一步计划和计划时间必须同时填写/);

  fx.setUserPermissions('U-OTHER', { record_activity: false });
  const forbidden = await recordActivity(fx, fx.otherCookie, noPlanPayload(reaction.id, 3, { customerId: 'CRM-OTHER' }));
  assert.equal(forbidden.response.status, 403);
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_activities WHERE customer_id='CRM-OTHER'").get().count,
    0,
  );
});

test('Issue 243 three consecutive no-plan records push manager alert and in-app notification once', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const reaction = await firstReaction(fx, fx.adminCookie);

  for (let index = 1; index <= 2; index += 1) {
    const { response } = await recordActivity(fx, fx.adminCookie, noPlanPayload(reaction.id, index));
    assert.equal(response.status, 200);
  }
  let alerts = await bootstrapAlerts(fx, fx.adminCookie);
  assert.equal(streakAlert(alerts), undefined, 'two no-plan records must not create a streak alert');
  assert.equal(noPlanNotifications(fx, 'CRM-OWN').length, 0);

  const third = await recordActivity(fx, fx.adminCookie, noPlanPayload(reaction.id, 3));
  assert.equal(third.response.status, 200);
  alerts = await bootstrapAlerts(fx, fx.adminCookie);
  const alert = streakAlert(alerts);
  assert.ok(alert, 'NO_PLAN_STREAK alert missing after three no-plan records');
  const reason = alert.reasons.find(item => item.code === 'NO_PLAN_STREAK');
  assert.equal(reason.noPlanStreak, 3);
  assert.match(reason.title, /暂无计划/);
  assert.match(reason.detail, /当前负责人/);
  assert.match(reason.detail, /经理介入/);
  assert.match(reason.action, /经理介入/);

  const notifications = noPlanNotifications(fx, 'CRM-OWN');
  assert.ok(notifications.length >= 2, 'manager/admin recipients should be notified');
  assert.ok(notifications.every(row => row.title.includes('暂无计划')));
  assert.ok(notifications.every(row => row.detail.includes('建议经理介入并协助形成明确下一步')));

  const fourth = await recordActivity(fx, fx.adminCookie, noPlanPayload(reaction.id, 4));
  assert.equal(fourth.response.status, 200);
  alerts = await bootstrapAlerts(fx, fx.adminCookie);
  assert.equal(streakAlert(alerts).reasons.find(item => item.code === 'NO_PLAN_STREAK').noPlanStreak, 4);
  assert.equal(noPlanNotifications(fx, 'CRM-OWN').length, notifications.length, '4th record must not duplicate the push');

  const fifth = await recordActivity(fx, fx.adminCookie, noPlanPayload(reaction.id, 5));
  assert.equal(fifth.response.status, 200);
  alerts = await bootstrapAlerts(fx, fx.adminCookie);
  assert.equal(streakAlert(alerts).reasons.find(item => item.code === 'NO_PLAN_STREAK').noPlanStreak, 5);
  assert.equal(noPlanNotifications(fx, 'CRM-OWN').length, notifications.length, '5th record must not duplicate the push');
});

test('Issue 243 a real plan resets the streak and a new streak pushes again', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const reaction = await firstReaction(fx, fx.adminCookie);

  for (let index = 1; index <= 3; index += 1) {
    await recordActivity(fx, fx.adminCookie, noPlanPayload(reaction.id, index));
  }
  const firstPushCount = noPlanNotifications(fx, 'CRM-OWN').length;
  assert.ok(firstPushCount >= 2);

  const reset = await recordActivity(fx, fx.adminCookie, planPayload(reaction.id, 1, {
    occurredAt: '2026-08-01 10:05:00',
  }));
  assert.equal(reset.response.status, 200);
  let alerts = await bootstrapAlerts(fx, fx.adminCookie);
  assert.equal(streakAlert(alerts), undefined, 'a real plan must reset the no-plan streak');

  for (let index = 6; index <= 7; index += 1) {
    await recordActivity(fx, fx.adminCookie, noPlanPayload(reaction.id, index));
  }
  alerts = await bootstrapAlerts(fx, fx.adminCookie);
  assert.equal(streakAlert(alerts), undefined, 'two no-plan records after reset must stay below threshold');

  const newThird = await recordActivity(fx, fx.adminCookie, noPlanPayload(reaction.id, 8));
  assert.equal(newThird.response.status, 200);
  alerts = await bootstrapAlerts(fx, fx.adminCookie);
  const reason = streakAlert(alerts).reasons.find(item => item.code === 'NO_PLAN_STREAK');
  assert.equal(reason.noPlanStreak, 3);
  assert.equal(noPlanNotifications(fx, 'CRM-OWN').length, firstPushCount * 2, 'new streak should push again');
});

test('Issue 243 frontend exposes the no-plan mode, requires a reason and renders 暂无计划', () => {
  assert.match(app, /data-activity-mode="noPlan"/);
  assert.match(app, /name="noPlanReason"/);
  assert.match(app, /请填写暂无计划的原因/);
  assert.match(app, /暂无计划/);
  assert.match(app, /下一步：<\/strong>暂无计划/);
  assert.match(app, /activity\.noPlan \|\| event\.no_plan/);
});
