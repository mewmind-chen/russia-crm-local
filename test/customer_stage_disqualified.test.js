'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');
const {
  STAGES,
  buildAlerts,
} = require('../lib/sales_crm');
const {
  isActivePipelineStage,
  isFollowUpTerminalStage,
  hasReachedStage,
} = require('../lib/customer_stages');

test('disqualified is a distinct terminal stage with shared semantics', () => {
  assert.equal(STAGES.some(([key, label]) => key === 'disqualified' && label === '确认不对口'), true);
  assert.equal(isFollowUpTerminalStage('disqualified'), true);
  assert.equal(isActivePipelineStage('disqualified'), false);
  assert.equal(hasReachedStage('disqualified', 'contacted'), false);
  assert.equal(hasReachedStage('won', 'contacted'), true);

  const alerts = buildAlerts([{
    id: 'CRM-DISQUALIFIED',
    company_name: 'Not a fit',
    owner_id: 'U-1',
    stage: 'disqualified',
    created_at: '2025-01-01 00:00:00',
    last_activity_at: '2025-01-01 00:00:00',
    next_action: '',
    next_action_at: '2025-01-02 00:00:00',
    manager_required: 0,
    manager_status: '',
    assignment_status: 'claimed',
  }], [], [], []);
  assert.deepEqual(alerts, []);
});

test('stage updates validate values and disqualification clears follow-up without recycling', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  fx.db.prepare(`UPDATE crm_accounts SET next_action='明天跟进',next_action_at='2026-07-28 09:00:00',
    lifecycle_status='active',recycle_kind='',recycle_reason='' WHERE id='CRM-WU'`).run();
  const before = fx.db.prepare(`SELECT owner_id,created_by,assignment_status,lifecycle_status
    FROM crm_accounts WHERE id='CRM-WU'`).get();

  const changed = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { stage: 'disqualified', ownerId: before.owner_id },
  });
  assert.equal(changed.status, 200);
  assert.deepEqual(
    fx.db.prepare(`SELECT stage,next_action,next_action_at,owner_id,created_by,assignment_status,
      lifecycle_status,recycle_kind,recycle_reason FROM crm_accounts WHERE id='CRM-WU'`).get(),
    {
      stage: 'disqualified',
      next_action: '',
      next_action_at: '',
      owner_id: before.owner_id,
      created_by: before.created_by,
      assignment_status: before.assignment_status,
      lifecycle_status: before.lifecycle_status,
      recycle_kind: '',
      recycle_reason: '',
    },
  );

  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.equal(bootstrap.accounts.some(row => row.id === 'CRM-WU' && row.stage === 'disqualified'), true);
  assert.equal(bootstrap.alerts.some(row => row.customerId === 'CRM-WU'), false);
  assert.equal(bootstrap.summary.active,
    bootstrap.accounts.filter(row => !['won', 'repeat', 'lost', 'disqualified'].includes(row.stage)).length);

  const jsonExport = await fx.requestJson('/api/sales-crm/export?stages=disqualified', {
    cookie: fx.adminCookie,
  });
  const exported = jsonExport.customers.find(row => row.id === 'CRM-WU');
  assert.equal(exported.stage, 'disqualified');
  assert.equal(exported.stageLabel, '确认不对口');

  const csvResponse = await fx.request('/api/sales-crm/export?format=csv&stages=disqualified', {
    cookie: fx.adminCookie,
  });
  const csv = await csvResponse.text();
  assert.match(csv, /确认不对口/);
  assert.doesNotMatch(csv, /,disqualified,/);

  const invalid = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { stage: 'invented-stage' },
  });
  assert.equal(invalid.status, 400);
  assert.equal(fx.db.prepare("SELECT stage FROM crm_accounts WHERE id='CRM-WU'").get().stage, 'disqualified');

  const forbidden = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.otherCookie,
    method: 'PATCH',
    body: { stage: 'qualified' },
  });
  assert.equal(forbidden.status, 403);

  const restored = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { stage: 'qualified' },
  });
  assert.equal(restored.status, 200);
  assert.deepEqual(
    fx.db.prepare("SELECT stage,next_action,next_action_at FROM crm_accounts WHERE id='CRM-WU'").get(),
    { stage: 'qualified', next_action: '', next_action_at: '' },
  );
});
