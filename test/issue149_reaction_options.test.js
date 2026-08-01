'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

const DEFAULT_REACTIONS = ['已完成', '有兴趣', '需要跟进', '未接通', '暂无回复', '明确拒绝'];

async function responseJson(response) {
  return { response, body: await response.json() };
}

async function reactions(fx, cookie) {
  const { response, body } = await responseJson(
    await fx.request('/api/sales-crm/activity-reactions', { cookie }),
  );
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.reactions));
  return body.reactions;
}

async function createReaction(fx, cookie, name) {
  const { response, body } = await responseJson(await fx.request('/api/sales-crm/activity-reactions', {
    cookie,
    method: 'POST',
    body: { name },
  }));
  return { response, body, reaction: body.reaction };
}

test('reaction migration installs the six ordered defaults once', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const first = await reactions(fx, fx.adminCookie);
  assert.deepEqual(first.filter(item => item.active).map(item => item.name), DEFAULT_REACTIONS);
  assert.deepEqual(
    first.filter(item => item.active).map(item => item.sortOrder),
    [...first.filter(item => item.active).map(item => item.sortOrder)].sort((a, b) => a - b),
  );
  assert.equal(new Set(first.map(item => item.id)).size, first.length);

  const { installSalesCrm } = require('../lib/sales_crm');
  installSalesCrm();
  const second = await reactions(fx, fx.adminCookie);
  assert.deepEqual(second, first);
});

test('only a real administrator can create, rename, reorder or remove reactions', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const initial = (await reactions(fx, fx.adminCookie)).filter(item => item.active);
  const created = await createReaction(fx, fx.adminCookie, '等待样品确认');
  assert.equal(created.response.status, 200);
  assert.equal(created.reaction.name, '等待样品确认');
  assert.equal(created.reaction.active, true);

  const renamed = await responseJson(await fx.request(
    `/api/sales-crm/activity-reactions/${encodeURIComponent(created.reaction.id)}`,
    {
      cookie: fx.adminCookie,
      method: 'PATCH',
      body: { name: '等待技术确认' },
    },
  ));
  assert.equal(renamed.response.status, 200);
  assert.equal(renamed.body.reaction.name, '等待技术确认');

  const ids = [created.reaction.id, ...initial.map(item => item.id)];
  const reordered = await responseJson(await fx.request('/api/sales-crm/activity-reactions/order', {
    cookie: fx.adminCookie,
    method: 'PUT',
    body: { ids },
  }));
  assert.equal(reordered.response.status, 200);
  assert.deepEqual(
    reordered.body.reactions.filter(item => item.active).map(item => item.id),
    ids,
  );
  assert.deepEqual(
    reordered.body.reactions.filter(item => item.active).map(item => item.sortOrder),
    ids.map((_, index) => index),
  );

  const removed = await fx.request(
    `/api/sales-crm/activity-reactions/${encodeURIComponent(created.reaction.id)}`,
    { cookie: fx.adminCookie, method: 'DELETE' },
  );
  assert.equal(removed.status, 200);
  const adminRowsResponse = await responseJson(await fx.request(
    '/api/sales-crm/activity-reactions/admin',
    { cookie: fx.adminCookie },
  ));
  assert.equal(adminRowsResponse.response.status, 200);
  const adminRows = adminRowsResponse.body.reactions;
  const inactive = adminRows.find(item => item.id === created.reaction.id);
  if (inactive) assert.equal(inactive.active, false);
  assert.equal(
    (await reactions(fx, fx.otherCookie)).some(item => item.id === created.reaction.id),
    false,
  );

  for (const cookie of [fx.cookie, fx.otherCookie]) {
    assert.equal((await fx.request('/api/sales-crm/activity-reactions', {
      cookie, method: 'POST', body: { name: '越权选项' },
    })).status, 403);
    assert.equal((await fx.request(
      `/api/sales-crm/activity-reactions/${encodeURIComponent(initial[0].id)}`,
      { cookie, method: 'PATCH', body: { name: '越权改名' } },
    )).status, 403);
    assert.equal((await fx.request('/api/sales-crm/activity-reactions/order', {
      cookie, method: 'PUT', body: { ids: initial.map(item => item.id) },
    })).status, 403);
    assert.equal((await fx.request(
      `/api/sales-crm/activity-reactions/${encodeURIComponent(initial[0].id)}`,
      { cookie, method: 'DELETE' },
    )).status, 403);
  }
});

test('reaction management is blocked during identity inspection', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await fx.startImpersonation('U-MGR');
  const attempts = [
    ['/api/sales-crm/activity-reactions', 'POST', { name: '身份检查新增' }],
    ['/api/sales-crm/activity-reactions/REACTION-MISSING', 'PATCH', { name: '身份检查改名' }],
    ['/api/sales-crm/activity-reactions/order', 'PUT', { ids: [] }],
    ['/api/sales-crm/activity-reactions/REACTION-MISSING', 'DELETE'],
  ];
  for (const [route, method, body] of attempts) {
    const response = await fx.request(route, {
      cookie: fx.adminCookie,
      method,
      ...(body ? { body } : {}),
    });
    assert.equal(response.status, 403, `${method} ${route}`);
    assert.equal((await response.json()).code, 'IMPERSONATION_ACTION_BLOCKED');
  }
});

test('reaction names and complete active ordering are validated', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const active = (await reactions(fx, fx.adminCookie)).filter(item => item.active);
  const invalidNames = ['   ', '控制\n字符', '双向\u202E覆盖', '零宽\u200B空格', '超'.repeat(101)];
  for (const name of invalidNames) {
    const result = await createReaction(fx, fx.adminCookie, name);
    assert.equal(result.response.status, 400, JSON.stringify(name));
  }
  for (const name of ['已完成', '  已完成  ']) {
    const result = await createReaction(fx, fx.adminCookie, name);
    assert.ok([400, 409].includes(result.response.status), JSON.stringify(name));
  }

  const incomplete = await fx.request('/api/sales-crm/activity-reactions/order', {
    cookie: fx.adminCookie,
    method: 'PUT',
    body: { ids: active.slice(1).map(item => item.id) },
  });
  assert.ok([400, 409].includes(incomplete.status));
  const duplicate = await fx.request('/api/sales-crm/activity-reactions/order', {
    cookie: fx.adminCookie,
    method: 'PUT',
    body: { ids: active.map(item => item.id).concat(active[0].id) },
  });
  assert.equal(duplicate.status, 400);
  const unknown = await fx.request('/api/sales-crm/activity-reactions/order', {
    cookie: fx.adminCookie,
    method: 'PUT',
    body: { ids: active.map(item => item.id).concat('REACTION-UNKNOWN') },
  });
  assert.ok([400, 409].includes(unknown.status));
});

test('activity stores a stable reaction id and immutable text snapshot across rename and removal', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const created = await createReaction(fx, fx.adminCookie, '首次选择文字');
  assert.equal(created.response.status, 200);
  const saved = await responseJson(await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN',
      progressType: 'reply',
      reactionOptionId: created.reaction.id,
      summary: '客户已有明确反应',
      nextAction: '继续确认',
      nextActionAt: '2099-08-01 09:00:00',
    },
  }));
  assert.equal(saved.response.status, 200);

  assert.equal((await fx.request(
    `/api/sales-crm/activity-reactions/${encodeURIComponent(created.reaction.id)}`,
    { cookie: fx.adminCookie, method: 'PATCH', body: { name: '以后选择文字' } },
  )).status, 200);
  assert.equal((await fx.request(
    `/api/sales-crm/activity-reactions/${encodeURIComponent(created.reaction.id)}`,
    { cookie: fx.adminCookie, method: 'DELETE' },
  )).status, 200);

  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const activity = bootstrap.activities.find(item => item.id === saved.body.activityId);
  assert.ok(activity);
  assert.equal(activity.reactionOptionId, created.reaction.id);
  assert.equal(activity.reactionSnapshot, '首次选择文字');

  const exported = await fx.requestJson('/api/sales-crm/export', { cookie: fx.adminCookie });
  const exportedActivity = exported.activities.find(item => item.id === saved.body.activityId);
  assert.equal(exported.schemaVersion, 3);
  assert.equal(exportedActivity.externalCustomerId, 'RU-9002');
  assert.equal(exportedActivity.progressType, 'reply');
  assert.equal(exportedActivity.activityType, 'reply');
  assert.equal(exportedActivity.channel, 'other');
  assert.equal(exportedActivity.reactionOptionId, created.reaction.id);
  assert.equal(exportedActivity.reactionSnapshot, '首次选择文字');
  assert.equal(exportedActivity.summary, '客户已有明确反应');
  assert.equal(exportedActivity.nextAction, '继续确认');
  assert.equal(exportedActivity.nextActionAt, '2099-08-01 01:00:00');
  assert.equal(exportedActivity.managerRequired, false);

  fx.db.prepare('UPDATE crm_activities SET summary=? WHERE id=?')
    .run('=HYPERLINK("https://invalid.example","点击")', saved.body.activityId);
  const csvResponse = await fx.request('/api/sales-crm/export?format=csv&dataset=activities', {
    cookie: fx.adminCookie,
  });
  assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text();
  assert.match(csv, /客户编号,本次进展,活动类型,渠道,客户反应选项ID,客户反应,进展内容,下一步计划,下次跟进时间,需要经理协助/);
  assert.match(csv, /RU-9002,reply,reply,other/);
  assert.match(csv, /首次选择文字/);
  assert.match(csv, /'=HYPERLINK/);

  const stale = await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OWN',
      progressType: 'reply',
      reactionOptionId: created.reaction.id,
      summary: '不能继续使用已移除选项',
    },
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'ACTIVITY_REACTION_STALE');
});

test('reaction mutations write dedicated audits without rewriting history', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const created = await createReaction(fx, fx.adminCookie, '审计选项');
  const active = (await reactions(fx, fx.adminCookie)).filter(item => item.active);
  await fx.request(`/api/sales-crm/activity-reactions/${encodeURIComponent(created.reaction.id)}`, {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { name: '审计选项改名' },
  });
  await fx.request('/api/sales-crm/activity-reactions/order', {
    cookie: fx.adminCookie,
    method: 'PUT',
    body: { ids: [created.reaction.id, ...active.filter(item => item.id !== created.reaction.id).map(item => item.id)] },
  });
  await fx.request(`/api/sales-crm/activity-reactions/${encodeURIComponent(created.reaction.id)}`, {
    cookie: fx.adminCookie,
    method: 'DELETE',
  });

  const rows = fx.db.prepare(`SELECT action,entity_type,entity_id,detail_json,real_user_id,effective_user_id
    FROM crm_audit_log
    WHERE action LIKE 'activity_reaction%'
    ORDER BY rowid`).all();
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.action), [
    'activity_reaction_created',
    'activity_reaction_renamed',
    'activity_reaction_reordered',
    'activity_reaction_removed',
  ]);
  assert.ok(rows.every(row => row.entity_type === 'activity_reaction_option'));
  assert.equal(rows[0].entity_id, created.reaction.id);
  assert.equal(rows[0].real_user_id, 'USR-ADMIN');
  assert.equal(rows[0].effective_user_id, 'USR-ADMIN');
  const details = rows.map(row => JSON.parse(row.detail_json));
  assert.equal(details[0].name, '审计选项');
  assert.equal(details[1].oldName, '审计选项');
  assert.equal(details[1].newName, '审计选项改名');
  assert.ok(Array.isArray(details[2].before));
  assert.ok(Array.isArray(details[2].after));
  assert.equal(details[3].name, '审计选项改名');
});
