'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');
const { redactContactFields } = require('../lib/access_control');

const ROOT = path.resolve(__dirname, '..');
const salesCrmSource = fs.readFileSync(path.join(ROOT, 'lib', 'sales_crm.js'), 'utf8');

function functionSlice(sourceText, functionName, nextFunctionName) {
  const start = sourceText.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = sourceText.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return sourceText.slice(start, end);
}

const loadIntakeBody = functionSlice(salesCrmSource, 'loadIntakeState', 'loadInsights');

const NESTED_SHAPE_INVENTORY = Object.freeze([
  'items[].developmentTimeline[]',
  'items[].developmentHistory',
  'items[].identityWarning',
  'items[].customerTags[]',
  'items[].signals.fit/readiness',
  'items[].arbitration.ruleDecision',
  'items[].arbitration.aiRecommendation.rankedCandidates[]',
  'items[].assignmentAudit[].ruleDecision',
  'items[].complementaryInfo',
  'batches[]',
]);

const SENSITIVE_MARKERS = Object.freeze({
  ruleReason: 'P1P3-RULE-REASON-CONTACT',
  auditReason: 'P1P3-AUDIT-REASON-CONTACT',
  historyNotes: 'P1P3-HISTORY-NOTES-CONTACT',
  lastActivitySummary: 'P1P3-LAST-ACTIVITY-SUMMARY-CONTACT',
});

function insertNestedDecisionAndHistory(fx) {
  const at = '2026-08-22 09:00:00';
  fx.db.prepare(`UPDATE crm_intake_items
    SET crm_customer_id='CRM-OTHER',updated_at=? WHERE id='INTAKE-OTHER'`).run(at);
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,occurred_at,created_at)
    VALUES ('ACT-P1P3-AUDIT','CRM-OTHER','U-OTHER','call','phone','connected',?,?,?)`)
    .run(SENSITIVE_MARKERS.lastActivitySummary, at, at);
  fx.db.prepare(`INSERT INTO crm_intake_decisions
    (id,intake_item_id,decision_type,actor_id,candidate_snapshot_id,
     ai_recommendation_json,rule_decision_json,manual_decision_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    'INTDEC-P1P3-AUDIT',
    'INTAKE-OTHER',
    'arbitration',
    'U-WU',
    'P1P3-SNAPSHOT',
    JSON.stringify({
      available: true,
      confidence: 0.8,
      rankedCandidates: [{ userId: 'U-OTHER', reasons: ['deterministic'] }],
    }),
    JSON.stringify({
      disposition: 'manager_review',
      reason: SENSITIVE_MARKERS.ruleReason,
      notes: SENSITIVE_MARKERS.historyNotes,
    }),
    JSON.stringify({ ownerId: 'U-OTHER', reason: SENSITIVE_MARKERS.auditReason }),
    at,
  );
}

function topLevelProjection(raw, keys) {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => keys.has(key)));
}

test('P1/P3 loadIntakeState keeps an explicit nested-shape inventory', () => {
  for (const marker of [
    'item.developmentTimeline =',
    'item.developmentHistory =',
    'item.identityWarning =',
    'item.customerTags =',
    'item.signals = intakeSignals',
    'item.arbitration =',
    'item.assignmentAudit =',
    'hydrateDuplicateLinkFields(value, item)',
    'const batches = scoped',
  ]) {
    assert.match(loadIntakeBody, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), marker);
  }
  assert.deepEqual(NESTED_SHAPE_INVENTORY, [
    'items[].developmentTimeline[]',
    'items[].developmentHistory',
    'items[].identityWarning',
    'items[].customerTags[]',
    'items[].signals.fit/readiness',
    'items[].arbitration.ruleDecision',
    'items[].arbitration.aiRecommendation.rankedCandidates[]',
    'items[].assignmentAudit[].ruleDecision',
    'items[].complementaryInfo',
    'batches[]',
  ]);
});

test('a top-level whitelist would leak nested P1/P3 contact fields', () => {
  const rawItem = {
    id: 'INTAKE-P1P3',
    company_name: 'Safe Company',
    arbitration: {
      ruleDecision: { disposition: 'manager_review', reason: SENSITIVE_MARKERS.ruleReason },
      aiRecommendation: {
        rankedCandidates: [{ userId: 'U-OTHER', reason: SENSITIVE_MARKERS.auditReason }],
      },
    },
    assignmentAudit: [{ ruleDecision: { reason: SENSITIVE_MARKERS.auditReason } }],
    developmentHistory: {
      accountId: 'CRM-OTHER',
      lastActivitySummary: SENSITIVE_MARKERS.lastActivitySummary,
      nested: { notes: SENSITIVE_MARKERS.historyNotes },
    },
    developmentTimeline: [{ summary: SENSITIVE_MARKERS.historyNotes }],
    customerTags: [{ id: 'TAG-1', name: '重点客户' }],
  };
  const redacted = redactContactFields(rawItem);
  const retainedTopLevelKeys = new Set(Object.keys(redacted));
  const unsafeProjection = topLevelProjection(rawItem, retainedTopLevelKeys);

  assert.equal(redacted.arbitration.ruleDecision.reason, undefined);
  assert.equal(redacted.assignmentAudit[0].ruleDecision.reason, undefined);
  assert.equal(redacted.developmentHistory.nested.notes, undefined);
  assert.equal(redacted.developmentTimeline[0].summary, undefined);
  assert.equal(
    redacted.developmentHistory.lastActivitySummary,
    SENSITIVE_MARKERS.lastActivitySummary,
    'compound lastActivitySummary is not in CONTACT_KEYS and is a concrete residual risk',
  );
  assert.equal(
    unsafeProjection.arbitration.ruleDecision.reason,
    SENSITIVE_MARKERS.ruleReason,
    'preserving arbitration at the top level also preserves its nested reason',
  );
  assert.equal(
    unsafeProjection.assignmentAudit[0].ruleDecision.reason,
    SENSITIVE_MARKERS.auditReason,
  );
  assert.notDeepEqual(unsafeProjection, redacted);
});

test('restricted P1/P3 endpoint recursively removes known contact keys but exposes the recorded residual', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: true } },
  });
  t.after(() => fx.close());
  insertNestedDecisionAndHistory(fx);

  const privileged = await fx.request('/api/sales-crm/intake?page=1&pageSize=50', {
    cookie: fx.adminCookie,
  });
  assert.equal(privileged.status, 200);
  const privilegedBody = await privileged.json();
  const privilegedItem = privilegedBody.items.find(item => item.id === 'INTAKE-OTHER');
  assert.ok(privilegedItem, 'privileged intake response must include the audit item');
  assert.equal(privilegedItem.arbitration.ruleDecision.reason, SENSITIVE_MARKERS.ruleReason);
  assert.equal(privilegedItem.assignmentAudit[0].manualDecision.reason, SENSITIVE_MARKERS.auditReason);
  assert.equal(
    privilegedItem.developmentHistory.lastActivitySummary,
    SENSITIVE_MARKERS.lastActivitySummary,
  );

  // seededFixture's default manager cookie is U-WU, whose view_contacts grant is
  // explicitly denied while manage_intake remains available. This exercises the
  // real P3 route-level redactContactFields(payload) boundary.
  const restricted = await fx.request('/api/sales-crm/intake?page=1&pageSize=50', {
    cookie: fx.cookie,
  });
  assert.equal(restricted.status, 200);
  const restrictedBody = await restricted.json();
  const restrictedItem = restrictedBody.items.find(item => item.id === 'INTAKE-OTHER');
  assert.ok(restrictedItem, 'restricted intake response must include the audit item');
  assert.equal(restrictedItem.arbitration.ruleDecision.reason, undefined);
  assert.equal(restrictedItem.assignmentAudit[0].manualDecision.reason, undefined);
  assert.equal(restrictedItem.developmentHistory.nested, undefined);
  assert.equal(
    restrictedItem.developmentHistory.lastActivitySummary,
    SENSITIVE_MARKERS.lastActivitySummary,
    'the current recursive blacklist leaves this compound narrative key visible',
  );

  // P1 bootstrap wraps the same loadIntakeState result; verify the shared
  // boundary instead of assuming the direct P3 route is representative.
  const privilegedBootstrap = await fx.request('/api/sales-crm/bootstrap', {
    cookie: fx.adminCookie,
  });
  assert.equal(privilegedBootstrap.status, 200);
  const privilegedBootstrapItem = (await privilegedBootstrap.json()).intake.items
    .find(item => item.id === 'INTAKE-OTHER');
  assert.equal(privilegedBootstrapItem.arbitration.ruleDecision.reason, SENSITIVE_MARKERS.ruleReason);

  const restrictedBootstrap = await fx.request('/api/sales-crm/bootstrap', {
    cookie: fx.cookie,
  });
  assert.equal(restrictedBootstrap.status, 200);
  const restrictedBootstrapItem = (await restrictedBootstrap.json()).intake.items
    .find(item => item.id === 'INTAKE-OTHER');
  assert.equal(restrictedBootstrapItem.arbitration.ruleDecision.reason, undefined);
  assert.equal(
    restrictedBootstrapItem.developmentHistory.lastActivitySummary,
    SENSITIVE_MARKERS.lastActivitySummary,
  );
});
