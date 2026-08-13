'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

function progressPayload(overrides = {}) {
  return {
    customerId: 'CRM-OTHER',
    progressType: 'email',
    reactionOptionId: '',
    summary: '客户暂无回复，需要主管协助梳理联系人',
    occurredAt: '2026-08-13 13:50:00',
    managerRequired: true,
    nextAction: '希望主管协助查询联系人',
    nextActionAt: '2026-08-20 09:00:00',
    ...overrides,
  };
}

test('manager assistance requires a reason and snapshots original plan, contacts and deadline', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_account_contacts
    (id,customer_id,external_customer_id,name,title,department,phone,email,social,match_status,
     created_by,archived_at,created_at,updated_at)
    VALUES ('CT-1','CRM-OTHER','RU-9003','Ivan','Procurement','技术部','','','','mismatch',
      'U-OTHER','',?,?)`).run(
    '2026-08-10 08:00:00', '2026-08-10 08:00:00');

  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: progressPayload(),
  });
  assert.equal(response.status, 200, await response.clone().text());

  const task = fx.db.prepare(
    "SELECT * FROM crm_manager_tasks WHERE reason='manager_assistance'",
  ).get();
  assert.ok(task);
  const evidence = JSON.parse(task.evidence_json);
  assert.equal(evidence.requestReason, '客户暂无回复，需要主管协助梳理联系人');
  assert.equal(evidence.originalPlan, '希望主管协助查询联系人');
  assert.deepEqual(evidence.contacts, [
    { name: 'Ivan', title: 'Procurement', department: '技术部', matchStatus: 'mismatch' },
  ]);
  assert.match(evidence.dueAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('manager assistance without a reason is rejected before any write', async t => {
  const fx = await fixtures.adminFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: progressPayload({ summary: '' }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, '请求主管协助必须填写申请原因');
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) n FROM crm_manager_tasks WHERE reason='manager_assistance'").get().n,
    0,
  );
});
