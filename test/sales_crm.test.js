const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STAGES,
  ACTIVITY_STAGE,
  hashPassword,
  buildAlerts,
  buildCountryReport,
  buildCohortReport,
  buildTeamReport,
  chooseIntakeOwner,
  hasPermission,
} = require('../lib/sales_crm');

test('sales CRM has a complete electronic-components export funnel', () => {
  assert.deepEqual(STAGES.map(item => item[0]), [
    'new', 'qualified', 'contacted', 'replied', 'connected', 'meeting',
    'manager', 'rfq', 'quoted', 'negotiating', 'won', 'repeat', 'lost',
  ]);
  assert.equal(ACTIVITY_STAGE.meeting, 'meeting');
  assert.equal(ACTIVITY_STAGE.manager_join, 'manager');
  assert.equal(ACTIVITY_STAGE.rfq, 'rfq');
});

test('password hashing is salted and deterministic with the same salt', () => {
  const first = hashPassword('a-secure-password');
  const second = hashPassword('a-secure-password', first.salt);
  const third = hashPassword('a-secure-password');
  assert.equal(first.hash, second.hash);
  assert.notEqual(first.salt, third.salt);
  assert.notEqual(first.hash, third.hash);
});

test('role permissions can be narrowed per account without expanding sales data scope', () => {
  const sales = { role: 'sales', permissions_json: JSON.stringify({ view_recon: false, record_quote: false }) };
  assert.equal(hasPermission(sales, 'view_customers'), true);
  assert.equal(hasPermission(sales, 'view_all_customers'), false);
  assert.equal(hasPermission(sales, 'view_recon'), false);
  assert.equal(hasPermission(sales, 'record_quote'), false);
  const manager = { role: 'manager', permissions_json: JSON.stringify({ view_all_customers: false }) };
  assert.equal(hasPermission(manager, 'view_team'), true);
  assert.equal(hasPermission(manager, 'view_all_customers'), false);
});

test('meeting without RFQ becomes a manager-visible exception', () => {
  const account = {
    id: 'C1', company_name: 'Demo', owner_id: 'U1', stage: 'meeting',
    created_at: '2026-01-01 00:00:00', last_activity_at: '2026-01-01 00:00:00',
    next_action: '追踪BOM', next_action_at: '2099-01-01 00:00:00',
    manager_required: 0, manager_status: '',
  };
  const alerts = buildAlerts([account], [], [], []);
  assert.ok(alerts.some(item => item.code === 'MEETING_NO_RFQ'));
});

test('country report keeps conversion denominators and sample warning', () => {
  const accounts = [{ id: 'C1', country: '巴西' }];
  const activities = [
    { customer_id: 'C1', activity_type: 'email' },
    { customer_id: 'C1', activity_type: 'reply' },
    { customer_id: 'C1', activity_type: 'meeting' },
    { customer_id: 'C1', activity_type: 'rfq' },
  ];
  const report = buildCountryReport(accounts, activities, []);
  assert.equal(report[0].replyRate, 100);
  assert.equal(report[0].rfqRate, 100);
  assert.equal(report[0].sampleStatus, '样本不足');
});

test('cohort report groups conversion by assignment month', () => {
  const accounts = [
    { id: 'C1', stage: 'meeting', assigned_at: '2026-07-01 08:00:00' },
    { id: 'C2', stage: 'contacted', assigned_at: '2026-07-12 08:00:00' },
  ];
  const activities = [{ customer_id: 'C1', activity_type: 'rfq' }];
  const orders = [{ customer_id: 'C1', amount: 1200 }];
  const report = buildCohortReport(accounts, activities, orders);
  assert.equal(report[0].cohort, '2026-07');
  assert.equal(report[0].assigned, 2);
  assert.equal(report[0].contactRate, 100);
  assert.equal(report[0].rfqRate, 100);
});

test('team report creates a multi-dimensional capability profile', () => {
  const users = [{ id: 'U1', email: 'a@example.com', name: 'A', role: 'sales', active: 1, languages_json: '[]', countries_json: '[]', channels_json: '[]', created_at: '' }];
  const accounts = [{ id: 'C1', owner_id: 'U1', next_action: '跟进', next_action_at: '2099-01-01 00:00:00', manager_required: 0 }];
  const activities = [
    { customer_id: 'C1', activity_type: 'email', channel: 'email' },
    { customer_id: 'C1', activity_type: 'reply', channel: 'email' },
    { customer_id: 'C1', activity_type: 'meeting', channel: 'video' },
  ];
  const report = buildTeamReport(users, accounts, activities, [], [], []);
  assert.equal(report.length, 1);
  assert.equal(Object.keys(report[0].scores).length, 9);
  assert.equal(report[0].metrics.meetings, 1);
});

test('daily intake matching uses country, language, channel and quota', () => {
  const users = [
    { id: 'BR', role: 'sales', active: 1, countries_json: '["巴西"]', languages_json: '["葡萄牙语"]', channels_json: '["WhatsApp"]' },
    { id: 'RU', role: 'sales', active: 1, countries_json: '["俄罗斯"]', languages_json: '["俄语"]', channels_json: '["Telegram"]' },
  ];
  const picked = chooseIntakeOwner({ country: '巴西', contact_methods: 'WhatsApp:+55 11 1234' }, users, { BR: 2, RU: 0 }, { BR: 1, RU: 1 }, 5);
  assert.equal(picked.userId, 'BR');
  const quotaBlocked = chooseIntakeOwner({ country: '巴西', contact_methods: 'WhatsApp' }, users, {}, { BR: 5, RU: 1 }, 5);
  assert.equal(quotaBlocked.userId, 'RU');
});
