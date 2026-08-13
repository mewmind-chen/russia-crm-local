'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

const appSource = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');

function functionBlock(source, name) {
  const marker = `function ${name}(`;
  const startAt = source.indexOf(marker);
  assert.notEqual(startAt, -1, `missing ${marker}`);
  const next = /\n  (?:async )?function [A-Za-z0-9_$]+\(/g;
  next.lastIndex = startAt + marker.length;
  const match = next.exec(source);
  return source.slice(startAt, match?.index ?? source.length);
}

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

test('ordinary profile editing protects historical mismatch customers', () => {
  const editBlock = functionBlock(appSource, 'openCustomerProfileEditModal');
  assert.match(editBlock, /item\.key !== 'disqualified'/);
  assert.match(editBlock, /历史不对口客户请先通过不对口记录恢复/);
  assert.match(appSource, /data-reject-customer/);
  assert.match(appSource, /rejectCustomerAsMismatch/);
});

test('disqualified stage remains available in bootstrap and exports', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  fx.db.prepare("UPDATE crm_accounts SET stage='disqualified' WHERE id='CRM-WU'").run();

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

});

test('ordinary account updates reject disqualified without side effects', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  fx.db.prepare(`UPDATE crm_accounts SET stage='qualified',updated_at='2026-07-27 08:00:00',
    lifecycle_status='active',recycle_kind='',recycle_reason='' WHERE id='CRM-WU'`).run();
  const before = fx.db.prepare(`SELECT stage,updated_at,lifecycle_status
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  const auditBefore = fx.db.prepare('SELECT COUNT(*) count FROM crm_audit_log').get().count;
  const mismatchBefore = fx.db.prepare(`SELECT COUNT(*) count FROM crm_accounts
    WHERE lifecycle_status='recycled' AND recycle_kind='mismatch'`).get().count;

  const response = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { stage: 'disqualified' },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, '请使用“标记不对口”操作');

  const after = fx.db.prepare(`SELECT stage,updated_at,lifecycle_status
    FROM crm_accounts WHERE id='CRM-WU'`).get();
  const auditAfter = fx.db.prepare('SELECT COUNT(*) count FROM crm_audit_log').get().count;
  const mismatchAfter = fx.db.prepare(`SELECT COUNT(*) count FROM crm_accounts
    WHERE lifecycle_status='recycled' AND recycle_kind='mismatch'`).get().count;
  assert.deepEqual(after, before);
  assert.equal(auditAfter, auditBefore);
  assert.equal(mismatchAfter, mismatchBefore);

});
