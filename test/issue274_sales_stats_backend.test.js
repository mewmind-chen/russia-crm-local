'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { businessDayUtcRange } = require('../lib/intake_metrics');

function addSeconds(timestamp, seconds) {
  const date = new Date(`${timestamp.replace(' ', 'T')}Z`);
  return new Date(date.getTime() + seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

async function bootstrap(fx, cookie) {
  const response = await fx.request('/api/sales-crm/bootstrap', { cookie });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  return body;
}

test('sales lead counts use assignment time and stay inside the authorized owner scope', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const range = businessDayUtcRange(new Date(), 'Asia/Shanghai');
  const assignedToday = addSeconds(range.start, 3600);
  const importedBeforeToday = addSeconds(range.start, -3600);
  const importedToday = addSeconds(range.start, 7200);

  fx.db.prepare(`UPDATE crm_intake_items SET status='assigned',assigned_owner_id='U-OTHER',
    assigned_at=?,created_at=?,updated_at=? WHERE id='INTAKE-OTHER'`)
    .run(assignedToday, importedBeforeToday, assignedToday);
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,
     assigned_at,created_at,updated_at)
    VALUES ('INTAKE-GLOBAL','BATCH-TEST','RU-274-GLOBAL','Global Intake','pending','',
      '',?,?)`).run(importedToday, importedToday);

  const sales = await bootstrap(fx, fx.otherCookie);
  assert.equal(sales.intake.stats.todayAssigned, 1);
  assert.equal(sales.intake.stats.todayImported, 0);
  assert.equal(sales.intake.stats.assigned, 1);

  const manager = await bootstrap(fx, fx.cookie);
  assert.equal(manager.intake.stats.todayAssigned, 1);
  assert.equal(manager.intake.stats.todayImported, 1);
  assert.equal(manager.intake.stats.assigned, 1);

  fx.setUserPermissions('U-OTHER', { view_pool: false });
  const salesWithoutPool = await bootstrap(fx, fx.otherCookie);
  assert.equal(Object.hasOwn(salesWithoutPool.researchTotals, 'pool'), false);
  assert.equal(Object.hasOwn(salesWithoutPool.researchTotals, 'poolAvailable'), false);
});
