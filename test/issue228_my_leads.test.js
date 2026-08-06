'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');

test('Issue 228 sales lead list contains only pending-claim items', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('I228-CLAIMED','BATCH-TEST','BR-2281','My Claimed','claimed','U-OTHER',?,?)`).run(
    '2026-08-04 08:00:00', '2026-08-04 08:00:00');

  const result = await fx.requestJson('/api/sales-crm/lists/intake?page=1&pageSize=50', {
    cookie: fx.otherCookie,
  });
  assert.equal(result.rows.some(row => row.id === 'I228-CLAIMED'), false);
  assert.equal(result.rows.every(row => row.status === 'assigned'), true);
  assert.equal(result.total, result.rows.length);

  const stats = await fx.requestJson('/api/sales-crm/intake?page=1&pageSize=50', {
    cookie: fx.otherCookie,
  });
  assert.equal(stats.total, result.total);
  // 统计卡口径保留：已领取/已退回仍可跳转 CRM 与历史入口
  assert.equal(stats.stats.claimed, 1);
});

test('Issue 228 managers see the actionable lead list without claimed rows', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('I228-CLAIMED','BATCH-TEST','BR-2281','My Claimed','claimed','U-OTHER',?,?)`).run(
    '2026-08-04 08:00:00', '2026-08-04 08:00:00');
  const result = await fx.requestJson('/api/sales-crm/lists/intake?page=1&pageSize=50', {
    cookie: fx.adminCookie,
  });
  assert.equal(result.rows.some(row => row.status === 'claimed'), false);
  assert.equal(result.rows.some(row => row.status === 'assigned'), true);
});

test('Issue 228 sales UI removes claimed rows and keeps one pending-claim surface', () => {
  assert.doesNotMatch(appSource, /else if \(salesView && item\.status === 'claimed'\)/);
  assert.match(appSource, /item\.classList\.toggle\('hidden', salesView && !\['', 'assigned'\]\.includes\(status\)\)/);
  assert.match(appSource, /salesView\s*\?\s*Number\(stats\.assigned \|\| 0\)/);
  assert.match(appSource, /领取成功，客户已进入 CRM/);
  assert.doesNotMatch(appSource, /客户已领取，请在规定时间内完成首次触达/);
});
