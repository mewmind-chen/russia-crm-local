'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');
const catalog = fs.readFileSync(path.join(root, 'lib', 'filter_catalog.js'), 'utf8');
const filters = fs.readFileSync(path.join(root, 'lib', 'business_page_filters.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

function stamp(offsetHours = 0) {
  const date = new Date(Date.now() + offsetHours * 3600000);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function seedOverdueLead(fx) {
  fx.db.prepare(`UPDATE crm_intake_items SET
    external_customer_id='RU-9003',company_name='Issue225 Overdue',status='assigned',
    assigned_owner_id='U-OTHER',suggested_owner_id='U-OTHER',assigned_at=?,
    claim_due_at=?,claimed_at='',return_reason='',crm_customer_id='CRM-OTHER',updated_at=?
    WHERE id='INTAKE-OTHER'`).run(stamp(-49), stamp(-25), stamp(-1));
  fx.db.prepare(`UPDATE crm_accounts SET intake_item_id='INTAKE-OTHER',owner_id='U-OTHER',
    assignment_status='assigned',assigned_at=?,claim_due_at=?,claimed_at='',return_reason='',
    next_action='完成首次触达',next_action_at=?,last_activity_at=?,updated_at=?
    WHERE id='CRM-OTHER'`).run(stamp(-49), stamp(-25), stamp(24), stamp(-1), stamp(-1));
}

test('Issue 225 today filter schema hides raw enums and user ids', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedOverdueLead(fx);

  const schema = await fx.requestJson('/api/sales-crm/filter-schema/alerts', {
    cookie: fx.adminCookie,
  });
  const keys = schema.schema.fields.map(field => field.key);
  assert.equal(keys.includes('urgency'), false);

  const due = schema.schema.fields.find(field => field.key === 'due_status');
  const dueLabels = Object.fromEntries(due.options.map(option => [option.value, option.label]));
  assert.equal(dueLabels.overdue, '已超期');
  assert.equal(dueLabels.unscheduled, '未安排');
  if (dueLabels.scheduled !== undefined) assert.equal(dueLabels.scheduled, '已安排');

  const owner = schema.schema.fields.find(field => field.key === 'owner');
  assert.equal(owner.options.find(option => option.value === 'U-OTHER')?.label, 'Other');
  assert.equal(owner.options.find(option => option.value === 'U-WU')?.label, 'Wu');
  assert.ok(owner.options.every(option => !/^U-|^USR-/.test(option.label)));

  const stage = schema.schema.fields.find(field => field.key === 'stage');
  assert.equal(stage.options.find(option => option.value === 'lead-assigned')?.label, '已分配待领取');
});

test('Issue 225 urgency is an explicit server-filtered tab with fresh facet counts', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedOverdueLead(fx);

  const before = await fx.requestJson('/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D', {
    cookie: fx.adminCookie,
  });
  const dueBefore = before.schema.fields.find(field => field.key === 'due_status');
  assert.equal(
    dueBefore.options.reduce((sum, option) => sum + Number(option.count || 0), 0),
    before.summary.objects,
  );

  const immediate = await fx.requestJson(
    `/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D&urgency=immediate`,
    { cookie: fx.adminCookie },
  );
  assert.equal(immediate.total, before.summary.immediate);
  assert.equal(immediate.rows.every(row => row.urgency === 'immediate'), true);

  const invalid = await fx.request(
    `/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D&urgency=urgent`,
    { cookie: fx.adminCookie },
  );
  assert.equal(invalid.status, 403);

  const resolved = await fx.request('/api/sales-crm/today-tasks/actions', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      actionType: 'resolve_overdue_lead',
      intakeItemId: 'INTAKE-OTHER',
      resolution: 'return_to_pool',
      idempotencyKey: 'issue225-return-once',
    },
  });
  assert.equal(resolved.status, 200, await resolved.clone().text());

  const after = await fx.requestJson('/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D', {
    cookie: fx.adminCookie,
  });
  assert.equal(after.total, before.total - 1);
  const dueAfter = after.schema.fields.find(field => field.key === 'due_status');
  assert.equal(
    dueAfter.options.reduce((sum, option) => sum + Number(option.count || 0), 0),
    after.summary.objects,
  );
});

test('Issue 225 frontend drops the duplicate urgency filter and refreshes schema with every list response', () => {
  assert.doesNotMatch(catalog, /key: 'urgency'/);
  assert.doesNotMatch(app, /controller\.setDraft\('urgency'/);
  assert.match(app, /if \(result\.schema\) \{\s*meta\.filterController\.updateSchema\(result\.schema\)/);
  assert.match(app, /pageKey === 'alerts'[\s\S]*urgency/);
  assert.doesNotMatch(app, /keys\.includes\('urgency'\)/);
  assert.match(filters, /DUE_STATUS_LABELS[\s\S]*?scheduled: '已安排'/);
  assert.match(filters, /STAGE_BUSINESS_LABELS[\s\S]*?'lead-assigned': '已分配待领取'/);
});
