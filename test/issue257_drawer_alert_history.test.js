'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { redactContactFields } = require('../lib/access_control');
const { seededFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');

test('alert copy survives redaction while contact fields remain hidden', () => {
  const redacted = redactContactFields({
    code: 'NO_NEXT',
    title: '缺少下一步计划',
    detail: '活跃客户没有明确动作与日期',
    action: '立即补充计划',
    email: 'secret@example.test',
    phone: '+7-secret',
    contactTitle: '采购总监',
    reasons: [{ code: 'OVERDUE', title: '跟进超期', detail: '已超期', action: '今天处理' }],
  }, { preserveAlertCopy: true });
  assert.equal(redacted.title, '缺少下一步计划');
  assert.equal(redacted.detail, '活跃客户没有明确动作与日期');
  assert.equal(redacted.action, '立即补充计划');
  assert.equal(redacted.reasons[0].title, '跟进超期');
  assert.equal(Object.hasOwn(redacted, 'email'), false);
  assert.equal(Object.hasOwn(redacted, 'phone'), false);
  assert.equal(Object.hasOwn(redacted, 'contactTitle'), false);
});

test('bootstrap keeps complete alert text without exposing contacts', async t => {
  const fx = await seededFixture({ permissions: { view_contacts: false } });
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET next_action='',next_action_at='',
    last_activity_at='2026-08-05 08:00:00' WHERE id='CRM-WU'`).run();
  const response = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  const alert = body.alerts.find(item => item.customerId === 'CRM-WU');
  assert.ok(alert);
  assert.ok(alert.title);
  assert.ok(alert.detail);
  assert.ok(alert.action);
  assert.doesNotMatch(JSON.stringify(body), /person@secret\.test|\+7-secret|Verified Buyer/);
});

test('drawer renders one guarded customer-history action with modal states', () => {
  const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
  const drawer = app.match(/function renderDrawer\(\)([\s\S]*?)\n  function openModal/)?.[1] || '';
  assert.match(drawer, /hasMeaningfulAlertCopy\(alert\)/);
  assert.equal((drawer.match(/data-customer-history/g) || []).length, 1);
  assert.doesNotMatch(drawer, /customerHistoryList|data-open-timeline-modal/);
  assert.match(app, /async function openCustomerHistoryModal/);
  assert.match(app, /正在读取客户历史/);
  assert.match(app, /暂无历史记录/);
  assert.match(app, /客户历史读取失败/);
});
