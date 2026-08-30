'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture, seededFixture } = require('./helpers/permission_fixture');
const { redactContactFields, contactSafeIntakeRecord } = require('../lib/access_control');

const root = path.join(__dirname, '..');
const intakeSource = fs.readFileSync(path.join(root, 'lib', 'intake_flow_filters.js'), 'utf8');

function functionSlice(sourceText, functionName, nextFunctionName) {
  const start = sourceText.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = nextFunctionName
    ? sourceText.indexOf(nextFunctionName, start + 1)
    : sourceText.length;
  if (nextFunctionName) assert.notEqual(end, -1, `missing ${nextFunctionName}`);
  return sourceText.slice(start, end);
}

const body = functionSlice(intakeSource, 'queryIntakeFlowPage', 'module.exports');

// 阶段 C：intake 页（无 view_contacts）由字段级白名单投影驱动。
test('intake flow page uses the intake whitelist instead of the blacklist', () => {
  assert.match(body, /contactSafeIntakeRecord\(/, 'intake page must use the intake whitelist');
  assert.doesNotMatch(body, /redactContactFields\(/, 'intake page must not use the blacklist');
});

// 等价性：对端点同款 intake 行形状，白名单与黑名单逐键等价。
test('intake whitelist is key-for-key equivalent to the blacklist on endpoint rows', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const rows = fx.db.prepare(`SELECT i.*,
    COALESCE((SELECT p.nickname FROM customer_pool p
      WHERE p.customer_id=i.external_customer_id LIMIT 1),'') nickname,
    COALESCE(NULLIF((SELECT p.company_name FROM customer_pool p
      WHERE p.customer_id=i.external_customer_id LIMIT 1),''),i.company_name) company_name,
    suggested.name suggested_owner_name,assigned.name assigned_owner_name
    FROM crm_intake_items i
    LEFT JOIN sales_users suggested ON suggested.id=i.suggested_owner_id
    LEFT JOIN sales_users assigned ON assigned.id=i.assigned_owner_id`).all();
  assert.ok(rows.length > 0, 'fixture must have intake rows');
  for (const raw of rows) {
    const black = redactContactFields(raw);
    const white = contactSafeIntakeRecord(raw);
    assert.deepEqual(white, black,
      `intake whitelist must mirror the blacklist on intake row ${raw.id}`);
  }
});

// 行为契约：无 view_contacts 用户看到业务字段、看不到联系方式。
test('intake page without view_contacts keeps business fields and hides contacts', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', {
    view_customers: true, view_contacts: false, view_insights: false,
  });
  const cookie = await fx.login('other@example.com', 'Password123!');
  const body = await (await fx.request('/api/sales-crm/lists/intake', { cookie })).json();
  assert.equal(body.rows.length > 0, true, 'intake items must be visible');
  const item = body.rows[0];
  for (const key of ['id', 'status', 'company_name', 'nickname', 'country']) {
    assert.ok(key in item, `intake item must keep business key ${key}`);
  }
  for (const key of ['contact_name', 'contact_title', 'contact_methods', 'contact_level',
    'evidence_urls', 'decision_reason', 'return_reason', 'product_focus', 'state']) {
    assert.ok(!(key in item), `intake item must not expose ${key}`);
  }
});