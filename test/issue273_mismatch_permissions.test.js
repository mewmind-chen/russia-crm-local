'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { ROLE_PERMISSIONS, hasPermission } = require('../lib/access_control');

test('sales has narrow mismatch permissions without recycle management authority', () => {
  const salesUser = { role: 'sales', permissions: ROLE_PERMISSIONS.sales };
  assert.equal(hasPermission(salesUser, 'reject_own_customer_mismatch'), true);
  assert.equal(hasPermission(salesUser, 'view_own_mismatch_history'), true);
  assert.equal(hasPermission(salesUser, 'manage_customer_recycle'), false);
});

test('intake rows preserve rejection actor, time, and previous owner metadata', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());

  const columns = new Set(
    fx.db.prepare('PRAGMA table_info(crm_intake_items)').all().map(row => row.name),
  );
  for (const name of ['rejected_by', 'rejected_at', 'previous_owner_id']) {
    assert.equal(columns.has(name), true, `missing crm_intake_items.${name}`);
  }
});
