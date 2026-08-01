'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const ROOT = path.resolve(__dirname, '..');

const forbiddenAssignmentKeys = /^(?:candidateSnapshotId|aiRecommendation|rankedCandidates|suggested_owner_id|suggested_owner_name|suggestedOwnerId|suggestedOwnerName|decision_reason|decisionReason|assignmentReason|ruleDecision|manualDecision|dailyQuota|dailyPerSales|quota|approvalMode|matchGroups|excludedCandidates|exclusionReasons|assignmentAudit|arbitration)$/i;

function collectForbiddenKeys(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach(item => collectForbiddenKeys(item, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenAssignmentKeys.test(key)) found.push(key);
    collectForbiddenKeys(child, found);
  }
  return found;
}

test('sales bootstrap and intake API remove assignment-decision fields while manager keeps them', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  t.after(() => fx.close());

  const at = '2026-08-01 09:00:00';
  fx.db.prepare(`UPDATE crm_intake_items SET suggested_owner_id='U-WU',
    decision_reason='SENSITIVE_ASSIGNMENT_REASON',updated_at=? WHERE id='INTAKE-OTHER'`).run(at);
  fx.setUserPermissions('U-OTHER', { manage_intake: true });
  fx.db.prepare(`INSERT INTO crm_intake_decisions
    (id,intake_item_id,decision_type,actor_id,candidate_snapshot_id,
     ai_recommendation_json,rule_decision_json,manual_decision_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    'INTDEC-ISSUE196-SALES',
    'INTAKE-OTHER',
    'arbitration',
    'U-WU',
    'SENSITIVE_CANDIDATE_SNAPSHOT',
    JSON.stringify({
      available: true,
      rankedCandidates: [{
        userId: 'U-WU', score: 99, reasons: ['SENSITIVE_EXCLUSION_REASON'],
      }],
      dailyQuota: 7,
      excludedCandidates: [{ userId: 'U-OTHER', reason: 'SENSITIVE_QUOTA_REASON' }],
    }),
    JSON.stringify({
      disposition: 'manager_review',
      reason: 'SENSITIVE_RULE_REASON',
      exclusionReasons: ['SENSITIVE_EXCLUSION_REASON'],
    }),
    JSON.stringify({ ownerId: 'U-OTHER', reason: 'SENSITIVE_MANUAL_REASON' }),
    at,
  );
  fx.db.prepare(`UPDATE crm_intake_items SET suggested_owner_id='U-WU',
    decision_reason='SENSITIVE_ASSIGNMENT_REASON',updated_at=? WHERE id='INTAKE-OTHER'`).run(at);

  for (const route of ['/api/sales-crm/bootstrap', '/api/sales-crm/intake?page=1&pageSize=20']) {
    const response = await fx.request(route, { cookie: fx.otherCookie });
    assert.equal(response.status, 200, route);
    const body = await response.json();
    const item = body.intake
      ? body.intake.items.find(row => row.id === 'INTAKE-OTHER')
      : body.items.find(row => row.id === 'INTAKE-OTHER');
    assert.ok(item, route);
    assert.deepEqual(collectForbiddenKeys(item), [], route);
    const settings = body.intake ? body.intake.settings : body.settings;
    assert.deepEqual(Object.keys(settings).sort(), ['claimSlaHours', 'contactSlaHours'], route);
    assert.doesNotMatch(
      JSON.stringify(item),
      /SENSITIVE_(?:ASSIGNMENT|CANDIDATE|EXCLUSION|QUOTA|RULE|MANUAL)/,
      route,
    );
  }

  for (const pageKey of ['intake', 'lead_flow']) {
    const response = await fx.request(
      `/api/sales-crm/lists/${pageKey}?page=1&pageSize=20&filters=%7B%7D`,
      { cookie: fx.otherCookie },
    );
    assert.equal(response.status, 200, pageKey);
    const body = await response.json();
    const item = body.rows.find(row => row.id === 'INTAKE-OTHER');
    assert.ok(item, pageKey);
    assert.deepEqual(collectForbiddenKeys(item), [], pageKey);
    assert.doesNotMatch(JSON.stringify(item), /SENSITIVE_ASSIGNMENT_REASON/, pageKey);
    assert.equal(body.rows.some(row => row.id !== 'INTAKE-OTHER'), false, pageKey);
  }

  const manager = await fx.request('/api/sales-crm/intake?page=1&pageSize=20', {
    cookie: fx.cookie,
  });
  assert.equal(manager.status, 200);
  const managerBody = await manager.json();
  const managerItem = managerBody.items.find(row => row.id === 'INTAKE-OTHER');
  assert.equal(managerItem.arbitration.candidateSnapshotId, 'SENSITIVE_CANDIDATE_SNAPSHOT');
  assert.equal(managerItem.arbitration.aiRecommendation.rankedCandidates[0].userId, 'U-WU');
  assert.equal(managerItem.arbitration.ruleDecision.disposition, 'manager_review');
  assert.equal(managerBody.settings.dailyPerSales > 0, true);
});

test('sales UI gates assignment decisions by role and AI subfeatures gate cached content and actions', () => {
  const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
  assert.match(app, /function canViewAssignmentDecisions\(\) \{\s*return state\.data\?\.user\?\.role !== 'sales' && can\('manage_intake'\);/);
  assert.match(app, /const salesView = !canViewAssignmentDecisions\(\);/);
  assert.match(app, /const showAssignmentAI = showAI && !salesView;/);
  assert.match(app, /salesView \? '负责人' : '负责人 \/ 阻断原因'/);
  assert.match(app, /showAssignmentDecisions \? `<section class="decision-review">/);
  assert.match(app, /showAssignmentDecisions \? `<div><span>分配依据 \/ 阻断原因/);

  assert.match(app, /function renderSalesPack\(payload\) \{\s*if \(!salesPackEnabled\(\)\) return '';/);
  assert.match(app, /function renderCustomerEnrichment\(\) \{\s*if \(!customerEnrichmentEnabled\(\)\) return '';/);
  assert.match(app, /if \(!customerEnrichmentEnabled\(\) \|\| !customerId/);
  assert.match(app, /if \(!customerEnrichmentEnabled\(\) \|\| !runId/);
  assert.match(app, /if \(!customerEnrichmentEnabled\(\) \|\| !proposalId/);
  assert.match(app, /salesPackEnabled\(\) && salesPackJob/);
});

test('sales role cannot use intake management APIs even when manage_intake is mistakenly granted', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { manage_intake: true });

  const beforeItem = fx.db.prepare(`SELECT status,suggested_owner_id,assigned_owner_id,
    decision_reason,updated_at FROM crm_intake_items WHERE id='INTAKE-OTHER'`).get();
  const beforeSettings = fx.db.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
  const beforeBatches = Number(fx.db.prepare('SELECT COUNT(*) count FROM crm_intake_batches').get().count);
  const beforeRequests = Number(fx.db.prepare(
    'SELECT COUNT(*) count FROM crm_intake_manual_assignment_requests',
  ).get().count);

  const requests = [
    ['/api/sales-crm/intake/action', 'POST', {
      action: 'manual_assign_preview', scopeType: 'all',
    }],
    ['/api/sales-crm/intake/action', 'POST', {
      action: 'manual_assign', scopeType: 'all', ownerId: 'U-WU', amount: 1,
      idempotencyKey: 'issue196-sales-manual-assign',
    }],
    ['/api/sales-crm/intake/action', 'POST', {
      action: 'assign', itemId: 'INTAKE-OTHER', ownerId: 'U-WU',
    }],
    ['/api/sales-crm/intake/action', 'POST', {
      action: 'reassign', itemId: 'INTAKE-OTHER', ownerId: 'U-WU',
    }],
    ['/api/sales-crm/intake/scan', 'POST', { force: true }],
    ['/api/sales-crm/intake/settings', 'PATCH', {
      enabled: false,
      claimSlaHours: 72,
      contactSlaHours: 168,
      matchGroups: ['SENSITIVE_MATCH_GROUP'],
      countries: ['SENSITIVE_COUNTRY_RULE'],
    }],
  ];
  for (const [route, method, body] of requests) {
    const response = await fx.request(route, {
      cookie: fx.otherCookie, method, body,
    });
    assert.equal(response.status, 403, `${method} ${route}`);
    const payload = await response.json();
    assert.equal(payload.ok, false, `${method} ${route}`);
    assert.doesNotMatch(
      JSON.stringify(payload),
      /blockedReasons|candidate|sales|matchGroups|dailyPerSales|U-WU|SENSITIVE_/i,
      `${method} ${route}`,
    );
  }

  const afterItem = fx.db.prepare(`SELECT status,suggested_owner_id,assigned_owner_id,
    decision_reason,updated_at FROM crm_intake_items WHERE id='INTAKE-OTHER'`).get();
  const afterSettings = fx.db.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
  assert.deepEqual(afterItem, beforeItem);
  assert.deepEqual(afterSettings, beforeSettings);
  assert.equal(Number(fx.db.prepare('SELECT COUNT(*) count FROM crm_intake_batches').get().count), beforeBatches);
  assert.equal(Number(fx.db.prepare(
    'SELECT COUNT(*) count FROM crm_intake_manual_assignment_requests',
  ).get().count), beforeRequests);
});
