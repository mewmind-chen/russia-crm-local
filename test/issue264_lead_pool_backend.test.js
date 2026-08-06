'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

function envelope(filters = {}) {
  return encodeURIComponent(JSON.stringify(filters));
}

function utcStamp(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function utcDay() {
  return utcStamp().slice(0, 10);
}

function seedIntakeItems(fx) {
  const insert = fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,
     assigned_at,claim_due_at,claimed_at,return_reason,decision_reason,
     duplicate_state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = utcStamp();
  const today = utcDay();
  insert.run('I264-PENDING', 'BATCH-TEST', 'BR-2641', 'Issue264 Pending', 'pending', '',
    '', '', '', '', '', 'cleared', `${today} 08:00:00`, now);
  insert.run('I264-APPROVED', 'BATCH-TEST', 'BR-2642', 'Issue264 Approved', 'approved', '',
    '', '', '', '', '', 'cleared', `${today} 08:30:00`, now);
  insert.run('I264-ASSIGNED', 'BATCH-TEST', 'BR-2643', 'Issue264 Assigned', 'assigned', 'U-OTHER',
    now, '2099-01-01 00:00:00', '', '', '待领取', 'cleared', `${today} 09:00:00`, now);
  insert.run('I264-CLAIMED', 'BATCH-TEST', 'BR-2644', 'Issue264 Claimed', 'claimed', 'U-OTHER',
    now, now, now, '', '', 'cleared', `${today} 10:00:00`, now);
  fx.db.prepare(`UPDATE crm_intake_items SET crm_customer_id='CRM-264-CLAIMED'
    WHERE id='I264-CLAIMED'`).run();
  insert.run('I264-RETURNED', 'BATCH-TEST', 'BR-2645', 'Issue264 Returned', 'returned', 'U-OTHER',
    now, '', '', '测试退回', '退回', 'cleared', `${today} 11:00:00`, now);
  insert.run('I264-REJECTED', 'BATCH-TEST', 'BR-2646', 'Issue264 Rejected', 'rejected', 'U-OTHER',
    now, '', '', '不对口', '不对口', 'cleared', `${today} 12:00:00`, now);
  insert.run('I264-DUPLICATE', 'BATCH-TEST', 'BR-2647', 'Issue264 Duplicate', 'duplicate', '',
    '', '', '', '', '客户已在CRM', 'exact', `${today} 13:00:00`, now);
}

test('Issue 264 lead pool default list only returns actionable statuses', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);

  const result = await fx.requestJson(`/api/sales-crm/lists/intake?filters=${envelope({
    search: { operator: 'contains', value: 'Issue264' },
  })}`, { cookie: fx.adminCookie });
  const ids = result.rows.map(row => row.id).sort();
  assert.deepEqual(ids, ['I264-APPROVED', 'I264-ASSIGNED', 'I264-PENDING', 'I264-RETURNED']);
});

test('Issue 264 status filter options only expose actionable statuses', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);

  const schema = await fx.requestJson('/api/sales-crm/filter-schema/intake', { cookie: fx.adminCookie });
  const statusField = schema.schema.fields.find(field => field.key === 'status');
  assert.deepEqual(
    Object.fromEntries(statusField.options.map(option => [option.value, option.label])),
    { approved: '待分配', assigned: '待领取', pending: '待分配', returned: '已退回' },
  );

  const salesSchema = await fx.requestJson('/api/sales-crm/filter-schema/intake', { cookie: fx.otherCookie });
  const salesStatus = salesSchema.schema.fields.find(field => field.key === 'status');
  assert.deepEqual(salesStatus.options.map(option => option.value), ['assigned']);
});

test('Issue 264 bootstrap intake items exclude claimed/rejected/duplicate but stats stay complete', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);

  const body = await fx.requestJson('/api/sales-crm/intake?page=1&pageSize=50', {
    cookie: fx.adminCookie,
  });
  const statuses = [...new Set(body.items.map(item => item.status))].sort();
  assert.deepEqual(statuses, ['approved', 'assigned', 'pending', 'returned']);
  assert.equal(body.stats.claimed, 1, 'claimed 统计保持全量');
  assert.equal(body.stats.rejected, 1, 'rejected 统计保持全量');
});
