'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

test('A2-06 concurrent scans keep one intake item for the same customer', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: true });
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_intake_settings
    SET enabled=1,approval_mode='automatic',daily_per_sales=10,countries_json='[]',match_groups_json='["A"]'
    WHERE id='default'`).run();
  fx.db.prepare(`INSERT INTO customer_pool(customer_id,company_name,country,products)
    VALUES ('BR-9061','A2-06 Duplicate','巴西','MCU')`).run();
  fx.db.prepare(`INSERT INTO company_screening(customer_id,match_score,match_group,risk_level,checked_at,created_at,updated_at)
    VALUES ('BR-9061',80,'A','low','2026-07-24 10:00:00','2026-07-24 10:00:00','2026-07-24 10:00:00')`).run();

  const scans = await Promise.all([
    fx.request('/api/sales-crm/intake/scan', { cookie: fx.cookie, method: 'POST', body: {} }),
    fx.request('/api/sales-crm/intake/scan', { cookie: fx.cookie, method: 'POST', body: {} }),
  ]);
  assert.ok(scans.every(response => response.status === 200));
  const count = fx.db.prepare(`SELECT COUNT(*) n FROM crm_intake_items WHERE external_customer_id='BR-9061'`).get().n;
  assert.equal(count, 1);
});

test('A2-06 intake endpoint respects owner scope and returns bounded pages', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/intake?page=1&pageSize=20&search=Intake', { cookie: fx.cookie });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.page, 1);
  assert.ok(payload.items.every(item => item.assigned_owner_id === 'U-OTHER'));
  assert.ok(payload.items.length <= 20);
});

test('Issue #62 CSV export applies the current search filter and Excel BOM', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/export?format=csv&search=Owned', { cookie: fx.adminCookie });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.match(response.headers.get('content-disposition'), /\.csv/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /Owned Fixture/);
  assert.doesNotMatch(text, /Other Fixture/);
});
