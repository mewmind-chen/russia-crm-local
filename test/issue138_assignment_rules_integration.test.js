'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

function businessRule() {
  return {
    name: '巴西重点客户',
    enabled: true,
    conditions: {
      countries: ['巴西'],
      industries: [],
      products: [],
      customerTypes: [],
      tagIds: [],
      matchGroups: [],
    },
    targetMode: 'selected',
    salesUserIds: ['U-OTHER'],
    strategy: 'fixed_priority',
    dailyQuota: 2,
  };
}

async function publishRuleFirst(fx, rule = businessRule()) {
  let config = await fx.requestJson('/api/sales-crm/intake/assignment-rules', {
    cookie: fx.adminCookie,
  });
  let response = await fx.request('/api/sales-crm/intake/assignment-rules/draft', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { ...rule, expectedRevision: config.state.draftRevision },
  });
  const created = await response.json();
  assert.equal(response.status, 200, created.error);
  config = await fx.requestJson('/api/sales-crm/intake/assignment-rules', {
    cookie: fx.adminCookie,
  });
  response = await fx.request('/api/sales-crm/intake/assignment-rules/reorder', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      ruleIds: [
        created.rule.id,
        ...config.rules.filter(item => item.id !== created.rule.id).map(item => item.id),
      ],
      expectedRevision: config.state.draftRevision,
    },
  });
  const reordered = await response.json();
  assert.equal(response.status, 200, reordered.error);
  response = await fx.request('/api/sales-crm/intake/assignment-rules/publish', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { expectedRevision: reordered.state.draftRevision },
  });
  const published = await response.json();
  assert.equal(response.status, 200, published.error);
  return { rule: created.rule, version: published.version };
}

test('assignment rule APIs enforce roles, publish versions and keep simulation read-only', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const managerCookie = await fx.login('manager@example.com', 'Password123!');

  let response = await fx.request('/api/sales-crm/intake/assignment-rules', {
    cookie: fx.adminCookie,
  });
  let config = await response.json();
  assert.equal(response.status, 200, config.error);
  assert.equal(config.rules.length, 2);
  assert.equal(config.capabilities.canEdit, true);
  const revision = config.state.draftRevision;

  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-MANAGER','BATCH-TEST','BR-MANAGER','Manager Intake','assigned','U-MGR',
      '2026-07-29 08:00:00','2026-07-29 08:00:00')`).run();
  fx.setUserPermissions('U-OTHER', { manage_intake: true });
  const salesIntake = await fx.requestJson('/api/sales-crm/intake', {
    cookie: fx.otherCookie,
  });
  assert.equal(salesIntake.total, 1);
  assert.deepEqual(salesIntake.items.map(item => item.id), ['INTAKE-OTHER']);
  const ownItem = salesIntake.items.find(item => item.id === 'INTAKE-OTHER');
  assert.ok(ownItem);
  assert.equal(Object.hasOwn(ownItem, 'arbitration'), false);
  assert.equal(Object.hasOwn(ownItem, 'assignmentAudit'), false);
  assert.equal(Object.hasOwn(ownItem, 'decision_reason'), false);
  assert.equal(Object.hasOwn(ownItem, 'suggested_owner_id'), false);

  response = await fx.request('/api/sales-crm/intake/assignment-rules/draft', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { ...businessRule(), expectedRevision: revision },
  });
  const created = await response.json();
  assert.equal(response.status, 200, created.error);

  const current = await fx.requestJson('/api/sales-crm/intake/assignment-rules', {
    cookie: fx.adminCookie,
  });
  assert.equal(current.hasDraftChanges, true);
  assert.equal(current.changeSummary.added.length, 1);
  assert.equal(current.changeSummary.added[0].id, created.rule.id);
  const orderedIds = [
    created.rule.id,
    ...current.rules.filter(rule => rule.id !== created.rule.id).map(rule => rule.id),
  ];
  response = await fx.request('/api/sales-crm/intake/assignment-rules/reorder', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { ruleIds: orderedIds, expectedRevision: current.state.draftRevision },
  });
  const reordered = await response.json();
  assert.equal(response.status, 200, reordered.error);

  response = await fx.request('/api/sales-crm/intake/assignment-rules/publish', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { expectedRevision: reordered.state.draftRevision },
  });
  const published = await response.json();
  assert.equal(response.status, 200, published.error);
  assert.equal(published.version.versionNumber, 2);

  fx.db.prepare(`UPDATE crm_intake_items SET country='巴西',status='pending',
    assigned_owner_id='',assigned_at='' WHERE id='INTAKE-OTHER'`).run();
  const beforeUsage = fx.db.prepare(
    'SELECT COUNT(*) count FROM crm_intake_assignment_rule_usage',
  ).get().count;
  response = await fx.request('/api/sales-crm/intake/assignment-rules/simulate', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { itemId: 'INTAKE-OTHER' },
  });
  const simulation = await response.json();
  assert.equal(response.status, 200, simulation.error);
  assert.equal(simulation.simulation, true);
  assert.equal(simulation.decision.ruleId, created.rule.id);
  assert.equal(simulation.decision.selectedUserId, 'U-OTHER');
  assert.deepEqual(simulation.decision.candidateUserIds, ['U-OTHER']);
  assert.equal(
    fx.db.prepare('SELECT COUNT(*) count FROM crm_intake_assignment_rule_usage').get().count,
    beforeUsage,
  );
  assert.equal(
    fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='INTAKE-OTHER'").get().status,
    'pending',
  );

  response = await fx.request('/api/sales-crm/intake/assignment-rules', {
    cookie: managerCookie,
  });
  const managerConfig = await response.json();
  assert.equal(response.status, 200, managerConfig.error);
  assert.equal(managerConfig.capabilities.canEdit, false);
  assert.equal(managerConfig.rules.every(rule => !Object.hasOwn(rule, 'salesUserIds')), true);
  assert.equal(managerConfig.rules.every(rule => !Object.hasOwn(rule, 'dailyQuota')), true);
  assert.deepEqual(managerConfig.options.sales, []);
  assert.equal(managerConfig.changeSummary, null);

  response = await fx.request('/api/sales-crm/intake/assignment-rules/simulate', {
    cookie: managerCookie,
    method: 'POST',
    body: { itemId: 'INTAKE-OTHER' },
  });
  const managerSimulation = await response.json();
  assert.equal(response.status, 200, managerSimulation.error);
  assert.equal(managerSimulation.decision.ruleId, created.rule.id);
  assert.equal(managerSimulation.decision.selectedUserId, 'U-OTHER');
  assert.equal(Object.hasOwn(managerSimulation.decision, 'candidateUserIds'), false);
  assert.equal(Object.hasOwn(managerSimulation.decision, 'eligibleUserIds'), false);
  assert.equal(Object.hasOwn(managerSimulation.decision, 'excludedCandidates'), false);
  assert.equal(Object.hasOwn(managerSimulation.decision.matchedRule, 'dailyQuota'), false);

  assert.equal((await fx.request('/api/sales-crm/intake/assignment-rules', {
    cookie: fx.otherCookie,
  })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/intake/assignment-rules/draft', {
    cookie: managerCookie,
    method: 'POST',
    body: businessRule(),
  })).status, 403);

  const versions = await fx.requestJson('/api/sales-crm/intake/assignment-rules/versions', {
    cookie: managerCookie,
  });
  assert.equal(versions.versions.length, 2);
  assert.equal(versions.versions.every(version => !Object.hasOwn(version, 'rules')), true);
});

test('impersonation blocks every assignment rule write while preserving read-only access', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  await fx.startImpersonation('U-MGR');

  let response = await fx.request('/api/sales-crm/intake/assignment-rules', {
    cookie: fx.adminCookie,
  });
  const config = await response.json();
  assert.equal(response.status, 200, config.error);
  assert.equal(config.capabilities.canEdit, false);

  for (const [route, method, body] of [
    ['/api/sales-crm/intake/settings', 'PATCH', { dailyPerSales: 10 }],
    ['/api/sales-crm/intake/assignment-rules/draft', 'POST', businessRule()],
    ['/api/sales-crm/intake/assignment-rules/publish', 'POST', {}],
  ]) {
    response = await fx.request(route, { cookie: fx.adminCookie, method, body });
    assert.equal(response.status, 403, `${method} ${route}`);
  }
});

test('bulk assignment uses the published rule, enforces quota and continues after one unavailable lead', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  const configured = await publishRuleFirst(fx, {
    ...businessRule(),
    dailyQuota: 1,
  });
  const now = '2026-07-29 12:00:00';
  const insert = fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,country,match_score,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'pending',?,?)`);
  insert.run('INT-138-BR-1', 'BATCH-TEST', 'BR-138-1', 'Brazil First', '巴西', 80, now, now);
  insert.run('INT-138-BR-2', 'BATCH-TEST', 'BR-138-2', 'Brazil Second', '巴西', 70, now, now);
  insert.run('INT-138-DE', 'BATCH-TEST', 'DE-138-1', 'Germany Fallback', '德国', 60, now, now);

  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie: managerCookie,
    method: 'POST',
    body: {
      action: 'bulk_assign',
      itemIds: ['INT-138-BR-1', 'INT-138-BR-2', 'INT-138-DE'],
    },
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.error);
  assert.equal(result.considered, 3);
  assert.equal(result.assigned, 2);

  const rows = fx.db.prepare(`SELECT id,status,assigned_owner_id,decision_reason
    FROM crm_intake_items WHERE id LIKE 'INT-138-%' ORDER BY match_score DESC`).all();
  assert.deepEqual(rows.map(row => [row.id, row.status, row.assigned_owner_id]), [
    ['INT-138-BR-1', 'assigned', 'U-OTHER'],
    ['INT-138-BR-2', 'pending', ''],
    ['INT-138-DE', 'assigned', rows[2].assigned_owner_id],
  ]);
  assert.notEqual(rows[2].assigned_owner_id, '');
  assert.match(rows[1].decision_reason, /不可用|额度/);

  const usage = fx.db.prepare(`SELECT rule_id,sales_user_id,assigned_count
    FROM crm_intake_assignment_rule_usage
    WHERE rule_version_id=? ORDER BY rule_id`).all(configured.version.id);
  assert.equal(
    usage.some(row => row.rule_id === configured.rule.id
      && row.sales_user_id === 'U-OTHER' && row.assigned_count === 1),
    true,
  );
  assert.equal(
    fx.db.prepare(`SELECT COUNT(*) count FROM crm_intake_decisions
      WHERE intake_item_id IN ('INT-138-BR-1','INT-138-BR-2','INT-138-DE')`).get().count,
    3,
  );
});
