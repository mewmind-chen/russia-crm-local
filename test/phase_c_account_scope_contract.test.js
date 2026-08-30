'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seededFixture } = require('./helpers/permission_fixture');
const { accountScope } = require('../lib/business_page_filters');
const { buildAccessContext } = require('../lib/access_control');

// 阶段 C：列表范围解释器与 buildAccessContext 必须对同一权限组合给出
// 完全一致的账户可见性（SQL 条件集 ≡ ID 集），作为统一二者的契约护栏。

function scopedIds(db, user) {
  const scope = accountScope(user, 'a');
  return db.prepare(`SELECT a.id FROM crm_accounts a
    WHERE ${scope.conditions.join(' AND ')}`).all(...scope.params)
    .map(row => row.id).sort();
}

function contextIds(db, user) {
  return [...buildAccessContext(db, user).accountIds].sort();
}

function users() {
  return [
    { name: 'sales own only', user: { id: 'U-OTHER', role: 'sales', permissions: { view_customers: true, view_intake: true } } },
    { name: 'view_all with intake', user: { id: 'USR-ADMIN', role: 'admin', permissions: { view_all_customers: true, manage_intake: true } } },
    { name: 'view_all without intake (owner required)', user: { id: 'USR-ADMIN', role: 'admin', permissions: { view_all_customers: true, manage_intake: false } } },
  ];
}

test('accountScope conditions select the same accounts as buildAccessContext', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());
  // 布置异质状态：CRM-OWN 退回、CRM-WU 测试数据、CRM-OTHER 回收
  fx.db.prepare("UPDATE crm_accounts SET assignment_status='returned' WHERE id='CRM-WU'").run();
  fx.db.prepare("UPDATE crm_accounts SET is_test_data=1 WHERE id='CRM-OWN'").run();
  fx.db.prepare("UPDATE crm_accounts SET lifecycle_status='recycled' WHERE id='CRM-OTHER'").run();

  for (const { name, user } of users()) {
    assert.deepEqual(
      scopedIds(fx.db, user),
      contextIds(fx.db, user),
      `scope must equal context for ${name}`,
    );
  }
});

test('test-data and recycled are excluded but returned stays visible to view_all', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET assignment_status='returned' WHERE id='CRM-WU'").run();
  fx.db.prepare("UPDATE crm_accounts SET is_test_data=1 WHERE id='CRM-OWN'").run();
  fx.db.prepare("UPDATE crm_accounts SET lifecycle_status='recycled' WHERE id='CRM-OTHER'").run();

  const admin = { id: 'USR-ADMIN', role: 'admin', permissions: { view_all_customers: true, manage_intake: true } };
  const ids = contextIds(fx.db, admin);
  // view_all+manage_intake 不排除 returned：CRM-WU（returned/active/非测试）仍可见
  assert.deepEqual(ids, ['CRM-WU']);
  assert.deepEqual(scopedIds(fx.db, admin), ['CRM-WU'], 'scope and context must agree');
});