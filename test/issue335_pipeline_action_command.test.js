'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');
const { listPipelineRows } = require('../lib/business_page_filters');

function user(id, permissions, role = 'sales') {
  return { id, permissions, role };
}

function activity(db, id, customerId, reactionName, occurredAt) {
  const reaction = db.prepare(
    'SELECT id FROM crm_activity_reaction_options WHERE name=? AND active=1',
  ).get(reactionName);
  assert.ok(reaction, `missing reaction ${reactionName}`);
  db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,
     stage_before,stage_after,manager_required,progress_key,reaction_option_id,reaction_label_snapshot,
     occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, customerId, 'U-OTHER', 'reply', 'other', reactionName, reactionName,
    '继续跟进', '2099-09-01 09:00:00', 'replied', 'replied', 0, 'reply',
    reaction.id, reactionName, occurredAt, occurredAt,
  );
}

test('latest effective customer reaction replaces the old action queue without deleting history', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='replied',next_action_at='2099-09-01 09:00:00' WHERE id='CRM-OTHER'").run();
  activity(fx.db, 'ACT-PRICE-OLD', 'CRM-OTHER', '价格贵', '2026-08-20 08:00:00');
  activity(fx.db, 'ACT-ORDER-NEW', 'CRM-OTHER', '等待订单', '2026-08-21 08:00:00');

  const sales = user('U-OTHER', { view_pipeline: true });
  const all = listPipelineRows(fx.db, sales, { page: 'pipeline', filters: [] }, {
    pageSize: 50, nowText: '2026-08-21 12:00:00',
  });
  assert.equal(all.rows.length, 1);
  assert.equal(all.rows[0].latestReaction, '等待订单');
  assert.equal(all.rows[0].actionQueueKeys.includes('order_growth'), true);
  assert.equal(all.rows[0].actionQueueKeys.includes('price_objection'), false);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_activities WHERE customer_id='CRM-OTHER'").get().count >= 2, true);

  const oldQueue = listPipelineRows(fx.db, sales, { page: 'pipeline', filters: [] }, {
    pageSize: 50, actionQueue: 'price_objection', nowText: '2026-08-21 12:00:00',
  });
  assert.equal(oldQueue.total, 0);
  const currentQueue = listPipelineRows(fx.db, sales, { page: 'pipeline', filters: [] }, {
    pageSize: 50, actionQueue: 'order_growth', nowText: '2026-08-21 12:00:00',
  });
  assert.deepEqual(currentQueue.rows.map(row => row.id), ['CRM-OTHER']);
});

test('action queues keep customer scope and expose business milestones only', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='replied',manager_required=1,manager_status='待介入' WHERE id='CRM-OTHER'").run();
  fx.db.prepare("UPDATE crm_accounts SET stage='replied',manager_required=1,manager_status='待介入' WHERE id='CRM-OWN'").run();
  const sales = user('U-OTHER', { view_pipeline: true });
  const result = listPipelineRows(fx.db, sales, { page: 'pipeline', filters: [] }, {
    pageSize: 50, actionQueue: 'manager_assistance', nowText: '2026-08-21 12:00:00',
  });
  assert.deepEqual(result.rows.map(row => row.id), ['CRM-OTHER']);
  assert.equal(result.summary.managerAssistance, 1);
  assert.equal(typeof result.rows[0].rfqCount, 'number');
  assert.equal(Object.hasOwn(result.rows[0], 'bomLines'), false);
  assert.equal(Object.hasOwn(result.rows[0], 'expectedValue'), false);
  assert.throws(
    () => listPipelineRows(fx.db, sales, { page: 'pipeline', filters: [] }, {
      pageSize: 50, actionQueue: 'forged_queue', nowText: '2026-08-21 12:00:00',
    }),
    error => error.code === 'FILTER_NOT_AUTHORIZED' && error.statusCode === 403,
  );
});

test('sales can record a short custom reaction and it joins the matching current queue', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const saved = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OTHER',
      progressType: 'reply',
      reactionCustom: '报价太高，客户嫌贵',
      summary: '客户反馈价格偏高',
      nextAction: '重新确认可接受方案',
      nextActionAt: '2099-09-01 09:00:00',
    },
  });
  const savedBody = await saved.json();
  assert.equal(saved.status, 200, JSON.stringify(savedBody));
  const sales = user('U-OTHER', { view_pipeline: true });
  const result = listPipelineRows(fx.db, sales, { page: 'pipeline', filters: [] }, {
    pageSize: 50, actionQueue: 'price_objection', nowText: '2026-08-21 12:00:00',
  });
  assert.deepEqual(result.rows.map(row => row.id), ['CRM-OTHER']);
  assert.equal(result.rows[0].latestReaction, '报价太高,客户嫌贵');
  const stored = fx.db.prepare('SELECT reaction_option_id,reaction_label_snapshot FROM crm_activities WHERE id=?')
    .get(savedBody.activityId);
  assert.equal(stored.reaction_option_id, '');
  assert.equal(stored.reaction_label_snapshot, '报价太高,客户嫌贵');
});

test('pipeline UI defaults to the action workbench with clickable queues and business copy', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');
  const pipeline = app.slice(app.indexOf('function renderPipeline()'), app.indexOf('function normalizeTodayTaskAction'));
  assert.match(html, /推进动作台/);
  assert.doesNotMatch(html, /从资源到复购的完整推进/);
  for (const label of ['今日动作', '需要判断', '值得深挖', '到期跟进', '嫌贵未转',
    '问多买少', '关系升级', '订单增长', '暂停报价', '待主管协助']) {
    assert.match(pipeline, new RegExp(label));
  }
  assert.match(pipeline, /data-pipeline-queue/);
  assert.match(pipeline, /data-pipeline-progress/);
  assert.match(pipeline, /data-pipeline-assistance/);
  assert.match(pipeline, /data-pipeline-manager-tasks/);
  assert.match(app, /其他（手动填写）/);
  assert.match(app, /loadAuthorizedBusinessPage\('pipeline', \{ reset: true, force: true \}\)/);
  assert.doesNotMatch(pipeline, /active_sample_below_minimum|anomaly_customers_below_minimum/);
});
