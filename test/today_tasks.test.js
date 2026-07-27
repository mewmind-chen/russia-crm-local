'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAlerts, groupAlerts } = require('../lib/sales_crm');

function account(overrides = {}) {
  return {
    id: 'CRM-1',
    company_name: 'Priority Customer',
    owner_id: 'U-1',
    stage: 'replied',
    priority: 'A',
    assignment_status: 'claimed',
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-07-20 00:00:00',
    last_activity_at: '2026-07-20 00:00:00',
    next_action: '跟进报价',
    next_action_at: '2026-07-20 00:00:00',
    manager_required: 1,
    manager_status: '待介入',
    ...overrides,
  };
}

test('today tasks group every customer into one row without losing secondary reasons', () => {
  const value = account();
  const raw = buildAlerts(
    [value],
    [],
    [{ customer_id: value.id, quoted_at: '', received_at: '2026-07-20 00:00:00', bom_lines: 12 }],
    [],
  );
  assert.ok(raw.length >= 3);
  const grouped = groupAlerts(raw);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].code, 'RFQ_UNQUOTED');
  assert.equal(grouped[0].title, '询价超过24小时未报价');
  assert.equal(grouped[0].urgency, 'immediate');
  assert.equal(grouped[0].action, '立即协调采购报价');
  assert.equal(grouped[0].reasonCount, raw.length);
  assert.equal(grouped[0].reasons.some(reason => reason.code === 'MANAGER_NEEDED'), true);
  assert.equal(grouped[0].reasons.some(reason => reason.code === 'OVERDUE'), true);
});

test('priority overdue outranks general reminders and urgency sorts before customer grade', () => {
  const grouped = groupAlerts([
    {
      id: 'STALE-C', customerId: 'C', companyName: 'C', code: 'STALE', title: '停滞',
      action: '关注', customerPriority: 'A', overdueHours: 0, updatedAt: '2026-07-27',
    },
    {
      id: 'NO-NEXT-B', customerId: 'B', companyName: 'B', code: 'NO_NEXT', title: '缺少下一步',
      action: '补充计划', customerPriority: 'A', overdueHours: 0, updatedAt: '2026-07-26',
    },
    {
      id: 'OVERDUE-A', customerId: 'A', companyName: 'A', code: 'OVERDUE', title: '严重超期',
      action: '今天跟进', customerPriority: 'B', overdueHours: 96, updatedAt: '2026-07-25',
    },
  ]);
  assert.deepEqual(grouped.map(item => item.customerId), ['A', 'B', 'C']);
  assert.deepEqual(grouped.map(item => item.urgency), ['immediate', 'today', 'attention']);
});

test('intake alerts are grouped independently by intake item id', () => {
  const grouped = groupAlerts([
    {
      id: 'L1-A', intakeItemId: 'L1', companyName: 'Lead One', code: 'UNCLAIMED_LEAD',
      title: '未领取', action: '进入分配', customerPriority: 'B', overdueHours: 12,
    },
    {
      id: 'L1-B', intakeItemId: 'L1', companyName: 'Lead One', code: 'STALE',
      title: '资料停滞', action: '复核', customerPriority: 'B', overdueHours: 0,
    },
    {
      id: 'L2-A', intakeItemId: 'L2', companyName: 'Lead Two', code: 'UNCLAIMED_LEAD',
      title: '未领取', action: '进入分配', customerPriority: 'A', overdueHours: 24,
    },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped.find(item => item.intakeItemId === 'L1').reasonCount, 2);
  assert.equal(grouped[0].intakeItemId, 'L2');
});

test('grouped task ordering is deterministic by urgency, grade, overdue age, and update time', () => {
  const reasons = [
    ['C1', 'A', 10, '2026-07-25'],
    ['C2', 'A', 20, '2026-07-24'],
    ['C3', 'B', 100, '2026-07-27'],
    ['C4', 'A', 20, '2026-07-26'],
  ].map(([customerId, priority, overdueHours, updatedAt]) => ({
    id: `NO_NEXT-${customerId}`,
    customerId,
    companyName: customerId,
    code: 'NO_NEXT',
    title: '缺少下一步',
    action: '补充计划',
    customerPriority: priority,
    overdueHours,
    updatedAt,
  }));
  assert.deepEqual(groupAlerts(reasons).map(item => item.customerId), ['C4', 'C2', 'C1', 'C3']);
});
