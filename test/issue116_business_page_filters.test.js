'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const {
  listPipelineRows,
  listTodayTasks,
  listManagerEvaluationCustomers,
  businessFilterOptions,
} = require('../lib/business_page_filters');

function user(id, permissions) {
  return { id, permissions };
}

function ast(page, filters = []) {
  return { version: 1, page, filters };
}

function assertUnauthorized(callback, secret = '') {
  assert.throws(callback, error => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, 'FILTER_NOT_AUTHORIZED');
    assert.equal(error.message, '筛选条件未获授权');
    if (secret) assert.equal(error.message.includes(secret), false);
    return true;
  });
}

test('pipeline adapter applies account scope before filters, pagination, and option counts', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET stage='replied',priority='A',country='RU' WHERE id='CRM-OTHER'").run();
  fx.db.prepare("UPDATE crm_accounts SET stage='meeting',priority='B',country='CN' WHERE id='CRM-OWN'").run();
  fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,lifecycle_status,is_test_data,created_at,updated_at)
    VALUES ('CRM-UNASSIGNED','RU-UNASSIGNED','Unassigned Fixture',NULL,'qualified','claimed','active',0,?,?)`).run(
    '2026-07-21 08:00:00', '2026-07-21 08:00:00',
  );

  const sales = user('U-OTHER', { view_pipeline: true });
  const salesResult = listPipelineRows(fx.db, sales, ast('pipeline'), { page: 1, pageSize: 1 });
  assert.equal(salesResult.authorizedTotal, 1);
  assert.equal(salesResult.total, 1);
  assert.deepEqual(salesResult.rows.map(row => row.id), ['CRM-OTHER']);
  assert.equal(salesResult.hasMore, false);

  const manager = user('U-MGR', { view_pipeline: true, view_all_customers: true, manage_intake: false });
  const managerResult = listPipelineRows(fx.db, manager, ast('pipeline', [
    { key: 'priority', operator: 'in', values: ['A', 'B'] },
  ]), { page: 1, pageSize: 1 });
  assert.equal(managerResult.authorizedTotal, 3);
  assert.equal(managerResult.total, 3);
  assert.equal(managerResult.rows.length, 1);
  assert.equal(managerResult.hasMore, true);

  const admin = user('USR-ADMIN', { view_pipeline: true, view_all_customers: true, manage_intake: true });
  assert.equal(listPipelineRows(fx.db, admin, ast('pipeline')).authorizedTotal, 4);

  const options = businessFilterOptions(fx.db, sales, 'pipeline', ['owner', 'stage', 'priority']);
  assert.deepEqual(options.owner.map(option => option.value), ['U-OTHER']);
  assert.deepEqual(options.stage.map(option => option.value), ['replied']);
  assert.deepEqual(options.priority.map(option => option.value), ['A']);
});

test('pipeline adapter parameterizes values and returns one opaque authorization error', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const sales = user('U-OTHER', { view_pipeline: true });

  const injected = listPipelineRows(fx.db, sales, ast('pipeline', [
    { key: 'stage', operator: 'in', values: ["qualified') OR 1=1 --"] },
  ]));
  assert.equal(injected.total, 0);
  assert.deepEqual(injected.rows, []);

  assertUnauthorized(() => listPipelineRows(fx.db, sales, ast('pipeline', [
    { key: 'hidden_manager_score', operator: 'in', values: ['top-secret'] },
  ])), 'hidden_manager_score');
  assertUnauthorized(() => listPipelineRows(fx.db, sales, ast('alerts')), 'alerts');
  assertUnauthorized(() => listPipelineRows(fx.db, user('U-OTHER', {}), ast('pipeline')));
});

test('today task adapter preserves existing grouped-alert semantics and scoped pagination', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET priority='A',manager_required=1,manager_status='待介入',
    next_action='',next_action_at='',last_activity_at='2026-07-20 00:00:00' WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET manager_required=1,next_action='',next_action_at=''
    WHERE id='CRM-OWN'`).run();
  fx.db.prepare(`UPDATE crm_intake_items SET claim_due_at='2026-07-20 00:00:00'
    WHERE id='INTAKE-OTHER'`).run();

  const sales = user('U-OTHER', { view_alerts: true });
  const result = listTodayTasks(fx.db, sales, ast('alerts'), { page: 1, pageSize: 1 }, {
    nowText: '2026-07-28 12:00:00',
  });
  assert.equal(result.authorizedTotal, 2);
  assert.equal(result.total, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(result.hasMore, true);
  const complete = listTodayTasks(fx.db, sales, ast('alerts'), { pageSize: 20 }, {
    nowText: '2026-07-28 12:00:00',
  });
  const customer = complete.rows.find(row => row.customerId === 'CRM-OTHER');
  assert.ok(customer);
  assert.ok(customer.reasonCount >= 2);
  assert.equal(customer.reasons.some(reason => reason.code === 'MANAGER_NEEDED'), true);
  assert.deepEqual(complete.rows.filter(row => row.intakeItemId).map(row => row.intakeItemId), ['INTAKE-OTHER']);
  assert.equal(complete.rows.some(row => row.customerId === 'CRM-OWN'), false);

  const filtered = listTodayTasks(fx.db, sales, ast('alerts', [
    { key: 'owner', operator: 'in', values: ['U-OTHER'] },
  ]), { pageSize: 20 }, {
    nowText: '2026-07-28 12:00:00',
    urgency: 'immediate',
  });
  assert.ok(filtered.rows.length > 0);
  assert.equal(filtered.rows.every(row => row.urgency === 'immediate' && row.ownerId === 'U-OTHER'), true);

  const options = businessFilterOptions(fx.db, sales, 'alerts', ['owner', 'due_status'], {
    nowText: '2026-07-28 12:00:00',
  });
  assert.deepEqual(options.owner.map(option => option.value), ['U-OTHER']);
  assert.equal(options.owner[0].label, 'Other');
});

test('manager evaluation adapter aggregates latest visible evaluation and enforces insight permission', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const insert = fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,subject_id,subject_name,subject_title,evaluation_text,author_id,author_name,
     ai_status,ai_summary,ai_labels_json,ai_order_keys_json,ai_risks_json,ai_strategy,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,'completed',?,?,'[]',?,'',?,?)`);
  insert.run(
    'EVAL-COMPANY', 'CRM-OTHER', 'company', '', '', '', 'Company evaluation', 'U-MGR', 'Manager',
    'Company summary', '["stable"]', '["low-risk"]', '2026-07-25 08:00:00', '2026-07-25 08:00:00',
  );
  insert.run(
    'EVAL-CONTACT', 'CRM-OTHER', 'contact', 'CONTACT-SECRET', 'Secret Buyer', 'Buyer',
    'private-contact-marker', 'U-WU', 'Wu', 'Private summary', '["private"]', '["private"]',
    '2026-07-26 08:00:00', '2026-07-26 08:00:00',
  );
  insert.run(
    'EVAL-OTHER', 'CRM-OWN', 'company', '', '', '', 'Other account evaluation', 'U-WU', 'Wu',
    'Other summary', '[]', '[]', '2026-07-24 08:00:00', '2026-07-24 08:00:00',
  );

  const insightOnly = user('U-OTHER', { view_insights: true });
  const rows = listManagerEvaluationCustomers(fx.db, insightOnly, ast('insights'), { pageSize: 20 });
  assert.equal(rows.authorizedTotal, 1);
  assert.equal(rows.total, 1);
  assert.equal(rows.rows[0].customerId, 'CRM-OTHER');
  assert.equal(rows.rows[0].evaluationCount, 1);
  assert.equal(rows.rows[0].latestEvaluationId, 'EVAL-COMPANY');
  assert.equal(Object.hasOwn(rows.rows[0], 'evaluationText'), false);

  const hiddenSearch = listManagerEvaluationCustomers(fx.db, insightOnly, ast('insights', [
    { key: 'search', operator: 'contains', value: 'private-contact-marker' },
  ]));
  assert.equal(hiddenSearch.total, 0);

  const evaluated = listManagerEvaluationCustomers(fx.db, insightOnly, ast('insights', [
    { key: 'evaluation_status', operator: 'in', values: ['evaluated'] },
    { key: 'evaluation_author', operator: 'in', values: ['U-MGR'] },
  ]));
  assert.deepEqual(evaluated.rows.map(row => row.customerId), ['CRM-OTHER']);

  const withContacts = user('U-OTHER', { view_insights: true, view_contacts: true });
  const contactVisible = listManagerEvaluationCustomers(fx.db, withContacts, ast('insights'));
  assert.equal(contactVisible.rows[0].evaluationCount, 2);
  assert.equal(contactVisible.rows[0].latestEvaluationId, 'EVAL-CONTACT');

  assertUnauthorized(() => listManagerEvaluationCustomers(
    fx.db, user('U-OTHER', {}), ast('insights'),
  ));
});

test('manager evaluation options use the same scoped customer set', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,evaluation_text,author_id,author_name,created_at,updated_at)
    VALUES ('EVAL-OWNED','CRM-OTHER','company','Owned evaluation','U-MGR','Manager',?,?)`).run(
    '2026-07-25 08:00:00', '2026-07-25 08:00:00',
  );
  fx.db.prepare(`INSERT INTO crm_manager_evaluations
    (id,customer_id,subject_type,evaluation_text,author_id,author_name,created_at,updated_at)
    VALUES ('EVAL-HIDDEN','CRM-OWN','company','Hidden evaluation','U-WU','Wu',?,?)`).run(
    '2026-07-26 08:00:00', '2026-07-26 08:00:00',
  );

  const sales = user('U-OTHER', { view_insights: true });
  const options = businessFilterOptions(fx.db, sales, 'insights', [
    'owner', 'stage', 'priority', 'evaluation_status', 'evaluation_author',
  ]);
  assert.deepEqual(options.owner.map(option => option.value), ['U-OTHER']);
  assert.deepEqual(options.evaluation_status.map(option => option.value), ['evaluated']);
  assert.deepEqual(options.evaluation_author.map(option => option.value), ['U-MGR']);
  assert.deepEqual(options.priority.map(option => option.value), ['B']);
});
