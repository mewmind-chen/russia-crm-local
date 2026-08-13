'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

function seedReturned(fx) {
  const at = '2026-08-13 08:00:00';
  fx.db.prepare(`UPDATE crm_accounts SET owner_id=NULL,previous_owner_id='U-OTHER',
    assignment_status='returned',lifecycle_status='recycled',return_reason='暂时不跟进'
    WHERE id='CRM-OTHER'`).run();
  fx.db.prepare("UPDATE crm_intake_items SET status='returned',crm_customer_id='CRM-OTHER' WHERE id='INTAKE-OTHER'").run();
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,outcome,summary,stage_before,stage_after,
     occurred_at,created_at)
    VALUES ('ACT-R1','CRM-OTHER','U-OTHER','email','暂无回复','发了开发信，客户暂无回复',
      'qualified','contacted',?,?)`).run(at, at);
}

test('returning sales reads own returned history without reassigning', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  seedReturned(fx);
  const response = await fx.request('/api/sales-crm/accounts/CRM-OTHER/history', {
    cookie: fx.otherCookie,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.account.status, '已退回线索池');
  assert.ok(body.timeline.some(event => event.kind === 'activity' && event.summary.includes('暂无回复')));
  assert.ok(!body.timeline.some(event => event.kind === 'reassign' || event.kind === 'restore'));
});

test('a manager without team scope cannot read the returned history', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: { record_activity: true } });
  t.after(() => fx.close());
  seedReturned(fx);
  const response = await fx.request('/api/sales-crm/accounts/CRM-OTHER/history', {
    cookie: fx.cookie,
  });
  assert.equal(response.status, 403);
});
